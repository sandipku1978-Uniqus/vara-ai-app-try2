/**
 * Resumable comment-letter TEXT fetcher.
 *
 * Pulls rows with content is null (and no recorded error), downloads the
 * EDGAR submission file, extracts readable text, and updates the row. Safe to
 * run repeatedly — it always continues where it left off, newest letters
 * first (memo.AI value concentrates in recent precedent).
 *
 * Older letters are sometimes scanned PDFs embedded as uuencoded blocks;
 * those are marked content_error='pdf_only' rather than stored as garbage
 * (OCR is a later, deliberate step).
 *
 * Usage:
 *   npx tsx data-pipeline/fetch-letter-text.ts --limit 200
 *   npx tsx data-pipeline/fetch-letter-text.ts --max-minutes 300   # nightly cron
 */

import { createServiceClient } from './supabase';
import { delay } from './edgar-index';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const EDGAR_BASE = 'https://www.sec.gov';
const USER_AGENT =
  process.env.EDGAR_USER_AGENT ||
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT ||
  'Uniqus Research Center contact@uniqus.com';

/** ~4 req/s — well under the SEC's 10 req/s ceiling, sustainable for hours. */
const REQUEST_INTERVAL_MS = 250;
const MAX_CONTENT_CHARS = 600_000; // keep below the tsvector guard in the schema
const BATCH = 500;

export interface LetterIdentifiers {
  subject: string | null;
  fileNumber: string | null;
  referencedAccession: string | null;
  reviewKey: string | null;
}

export interface LegacyIdentifierRow {
  accession: string;
  cik: number;
  content: string;
}

export function deriveStoredLetterIdentifierPatch(content: string, checkedAt: string) {
  const identifiers = extractLetterIdentifiers(content);
  return {
    subject: identifiers.subject,
    file_number: identifiers.fileNumber,
    referenced_accession: identifiers.referencedAccession,
    review_key: identifiers.reviewKey,
    identifier_checked_at: checkedAt,
  };
}

export function shouldRethreadLetters(identifierUpdates: number, contentUpdates: number): boolean {
  return identifierUpdates + contentUpdates > 0;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(p|div|br|hr|h[1-6]|tr|li|table)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x[0-9a-f]+;/gi, ' ').replace(/&#\d+;/g, ' ').replace(/&\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Derive a stable review identity from the SEC/registrant letter header.
 * A bare issuer file number is not enough because it spans many reviews; the
 * key requires either a referenced accession or file number + form + period. */
export function extractLetterIdentifiers(raw: string): LetterIdentifiers {
  // The SEC submission envelope contains the comment letter's own accession.
  // It is not the issuer filing under review and must never seed episode identity.
  const withoutSubmissionHeaders = raw
    .replace(/<SEC-HEADER>[\s\S]*?<\/SEC-HEADER>/gi, ' ')
    .replace(/<IMS-HEADER>[\s\S]*?<\/IMS-HEADER>/gi, ' ');
  const header = htmlToText(
    withoutSubmissionHeaders
      .slice(0, 250_000)
      .replace(/<PDF>[\s\S]*?<\/PDF>/gi, ' ')
      .replace(/^begin \d{3} [^\n]*[\s\S]*?^end$/gim, ' ')
  );
  const subject = header.match(/(?:^|\n)\s*Re\s*:\s*([^\n]{3,500})/i)?.[1]?.trim() || null;
  const fileNumber = header.match(/\bFile\s*(?:No\.?|Number)\s*[:#]?\s*([0-9]{3}-[0-9A-Za-z.-]+)/i)?.[1]?.toUpperCase() || null;
  const referencedAccession = header.match(
    /\b(?:referenced\s+)?accession(?:\s+(?:number|no\.?))?\s*[:#]?\s*(\d{10}-\d{2}-\d{6})\b/i
  )?.[1] || null;
  const form = header.match(/\bForm\s+(10-[KQ]|8-K|20-F|40-F|6-K|S-[1348]|F-[134]|DEF\s+14A)(?:\/A)?\b/i)?.[0]
    ?.replace(/^Form\s+/i, '')
    .replace(/\s+/g, '')
    .toUpperCase() || null;
  const explicitPeriodYear = header.match(
    /\b(?:fiscal\s+(?:year|quarter)|reporting\s+period|period)\b[^\n]{0,180}\b((?:19|20)\d{2})\b/i
  )?.[1] || header.match(
    /\bForm\s+(?:10-[KQ]|8-K|20-F|40-F|6-K|S-[1348]|F-[134]|DEF\s+14A)(?:\/A)?\b[^\n]{0,180}\b((?:19|20)\d{2})\b/i
  )?.[1];
  const subjectYears = subject?.match(/\b(?:19|20)\d{2}\b/g) || [];
  const periodYear = explicitPeriodYear || (subjectYears.length > 0 ? subjectYears[subjectYears.length - 1] : null);
  const basis = referencedAccession
    ? `accession:${referencedAccession}`
    : fileNumber && form && periodYear
      ? `file:${fileNumber}|form:${form}|period:${periodYear}`
      : null;
  const reviewKey = basis
    ? `review-${createHash('sha256').update(basis).digest('hex').slice(0, 24)}`
    : null;
  return { subject, fileNumber, referencedAccession, reviewKey };
}

/** Decode a classic uuencoded block (EDGAR embeds PDFs this way inside <PDF>). */
export function uudecode(block: string): Buffer {
  const chunks: Buffer[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed || /^begin \d{3} /.test(trimmed) || trimmed === 'end' || trimmed === '`') continue;
    const length = (trimmed.charCodeAt(0) - 32) & 0x3f;
    if (length <= 0) continue;
    const bytes: number[] = [];
    for (let i = 1; i + 3 < trimmed.length + 1 && bytes.length < length; i += 4) {
      const c = (index: number) => ((trimmed.charCodeAt(index) ?? 32) - 32) & 0x3f;
      const [a, b, cc, d] = [c(i), c(i + 1), c(i + 2), c(i + 3)];
      bytes.push((a << 2) | (b >> 4));
      if (bytes.length < length) bytes.push(((b & 0xf) << 4) | (cc >> 2));
      if (bytes.length < length) bytes.push(((cc & 0x3) << 6) | d);
    }
    chunks.push(Buffer.from(bytes));
  }
  return Buffer.concat(chunks);
}

async function pdfToText(buffer: Buffer): Promise<string | null> {
  try {
    // createRequire keeps bundlers/typecheckers (vite, next tsc) from trying
    // to statically resolve pdf-parse — this module only ever runs under tsx
    const { createRequire } = await import('node:module');
    const requireModule = createRequire(import.meta.url);
    const { PDFParse } = requireModule('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text || null;
  } catch {
    return null;
  }
}

/**
 * Extract letter text from a full EDGAR submission file. Walks each
 * <DOCUMENT> block: HTML/plain payloads are stripped to text; PDF payloads
 * (uuencoded inside <PDF> tags) are decoded and parsed — the SEC frequently
 * uploads Staff letters as born-digital PDFs, which the naive strip-tags
 * approach reduced to manifest junk like "LETTER 1 filename1.pdf".
 */
export async function extractLetterText(raw: string): Promise<{ text: string | null; error: string | null }> {
  const parts: string[] = [];
  let sawPdf = false;
  let pdfFailed = false;

  const documents = raw.match(/<DOCUMENT>[\s\S]*?<\/DOCUMENT>/gi) ?? [raw];
  for (const doc of documents) {
    const pdfBlock = doc.match(/<PDF>([\s\S]*?)<\/PDF>/i);
    if (pdfBlock) {
      sawPdf = true;
      const text = await pdfToText(uudecode(pdfBlock[1]));
      if (text && text.trim().length > 100) parts.push(text.trim());
      else pdfFailed = true;
      continue;
    }
    const textBlock = doc.match(/<TEXT>([\s\S]*?)<\/TEXT>/i);
    const payload = textBlock ? textBlock[1] : doc;
    if (/^begin \d{3} /m.test(payload)) { sawPdf = true; pdfFailed = true; continue; }
    const text = htmlToText(
      payload.replace(/<SEC-HEADER>[\s\S]*?<\/SEC-HEADER>/gi, ' ').replace(/<IMS-HEADER>[\s\S]*?<\/IMS-HEADER>/gi, ' ')
    );
    if (text.length > 100) parts.push(text);
  }

  const combined = parts.join('\n\n---\n\n').trim();
  if (combined.length < 200) {
    return { text: null, error: sawPdf ? (pdfFailed ? 'pdf_unreadable' : 'pdf_only') : 'no_text_extracted' };
  }
  return { text: combined.slice(0, MAX_CONTENT_CHARS), error: null };
}

async function fetchSubmission(filename: string): Promise<{ raw: string | null; error: string | null }> {
  const url = `${EDGAR_BASE}/Archives/${filename}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) return { raw: null, error: 'not_found' };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { raw: await response.text(), error: null };
    } catch {
      await delay(1000 * 2 ** attempt);
    }
  }
  return { raw: null, error: 'fetch_failed' };
}

export function nextLetterRetryAt(attempts: number, now = Date.now()): string {
  const delayMinutes = Math.min(15 * 2 ** Math.min(Math.max(attempts - 1, 0), 10), 7 * 24 * 60);
  return new Date(now + delayMinutes * 60_000).toISOString();
}

async function updateLetterIdentifiers(
  client: SupabaseClient,
  row: { accession: string; cik: number },
  patch: Record<string, unknown>
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { error } = await client
        .from('urc_comment_letters')
        .update(patch)
        .eq('accession', row.accession)
        .eq('cik', row.cik);
      if (!error) return true;
    } catch {
      // Retry below; leaving identifier_checked_at null makes the phase resumable.
    }
    if (attempt < 3) await delay(500 * 2 ** attempt);
  }
  return false;
}

/**
 * Reconcile identity columns added after the original text backfill.
 * Stored text is processed without SEC traffic first. Permanently unresolved
 * text rows then receive a bounded header-only refetch. identifier_checked_at
 * is the idempotent checkpoint; transient fetch failures remain eligible.
 */
async function backfillLegacyIdentifiers(
  client: SupabaseClient,
  deadline: number,
  localLimit: number,
  headerRefetchLimit: number
): Promise<number> {
  let updated = 0;
  let localProcessed = 0;
  while (Date.now() < deadline && localProcessed < localLimit) {
    const { data, error } = await client
      .from('urc_comment_letters')
      .select('accession, cik, content')
      .is('identifier_checked_at', null)
      .not('content', 'is', null)
      .order('date_filed', { ascending: false })
      .limit(Math.min(BATCH, localLimit - localProcessed));
    if (error) throw new Error(`stored identifier select failed: ${error.message}`);
    const rows = (data || []) as LegacyIdentifierRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (Date.now() >= deadline || localProcessed >= localLimit) break;
      localProcessed += 1;
      const checkedAt = new Date().toISOString();
      if (await updateLetterIdentifiers(client, row, deriveStoredLetterIdentifierPatch(row.content, checkedAt))) {
        updated += 1;
      }
    }
  }

  let remoteProcessed = 0;
  while (Date.now() < deadline && remoteProcessed < headerRefetchLimit) {
    const { data, error } = await client
      .from('urc_comment_letters')
      .select('accession, cik, filename')
      .is('identifier_checked_at', null)
      .is('content', null)
      .not('content_error', 'is', null)
      .neq('content_error', 'fetch_failed')
      .order('date_filed', { ascending: false })
      .limit(Math.min(BATCH, headerRefetchLimit - remoteProcessed));
    if (error) throw new Error(`header identifier select failed: ${error.message}`);
    const rows = (data || []) as Array<{ accession: string; cik: number; filename: string }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      if (Date.now() >= deadline || remoteProcessed >= headerRefetchLimit) break;
      remoteProcessed += 1;
      const fetchedSubmission = await fetchSubmission(row.filename);
      if (fetchedSubmission.error === 'fetch_failed') continue;
      const checkedAt = new Date().toISOString();
      const patch = fetchedSubmission.raw
        ? deriveStoredLetterIdentifierPatch(fetchedSubmission.raw, checkedAt)
        : { identifier_checked_at: checkedAt };
      if (await updateLetterIdentifiers(client, row, patch)) updated += 1;
      await delay(REQUEST_INTERVAL_MS);
    }
  }

  if (updated > 0) {
    console.log(`Identifier reconciliation: ${updated} legacy rows checked (${localProcessed} stored-text, ${remoteProcessed} header refetches).`);
  }
  return updated;
}

async function main() {
  const limit = Number(getArg('limit') || 0);
  const maxMinutes = Number(getArg('max-minutes') || 0);
  const identifierLimit = Math.max(0, Number(getArg('identifier-limit') ?? 20_000));
  const identifierRefetchLimit = Math.max(0, Number(getArg('identifier-refetch-limit') ?? 5_000));
  const deadline = maxMinutes > 0 ? Date.now() + maxMinutes * 60_000 : Infinity;

  const client = createServiceClient();
  const identifierUpdates = await backfillLegacyIdentifiers(
    client,
    deadline,
    identifierLimit,
    identifierRefetchLimit
  );
  let fetched = 0;
  let errored = 0;

  for (;;) {
    if (Date.now() >= deadline) break;
    if (limit > 0 && fetched + errored >= limit) break;

    const queueTime = new Date().toISOString();
    const { data: rows, error } = await client
      .from('urc_comment_letters')
      .select('accession, cik, filename, content_fetch_attempts')
      .is('content', null)
      .or('content_error.is.null,content_error.eq.fetch_failed')
      .or(`content_next_retry_at.is.null,content_next_retry_at.lte.${queueTime}`)
      .order('date_filed', { ascending: false })
      .limit(BATCH);
    if (error) throw new Error(`select failed: ${error.message}`);
    if (!rows || rows.length === 0) {
      console.log('Nothing left to fetch — corpus text is complete.');
      break;
    }

    for (const row of rows) {
      if (Date.now() >= deadline) break;
      if (limit > 0 && fetched + errored >= limit) break;

      const attemptCount = Number(row.content_fetch_attempts || 0) + 1;
      const attemptTime = new Date().toISOString();
      const fetchedSubmission = await fetchSubmission(row.filename);
      const identifiers = fetchedSubmission.raw ? extractLetterIdentifiers(fetchedSubmission.raw) : null;
      const { text, error: extractError } = fetchedSubmission.raw
        ? await extractLetterText(fetchedSubmission.raw)
        : { text: null, error: fetchedSubmission.error };
      const retryable = extractError === 'fetch_failed';
      const identifierPatch = identifiers
        ? {
            subject: identifiers.subject,
            file_number: identifiers.fileNumber,
            referenced_accession: identifiers.referencedAccession,
            review_key: identifiers.reviewKey,
            identifier_checked_at: attemptTime,
          }
        : fetchedSubmission.error === 'not_found'
          ? { identifier_checked_at: attemptTime }
          : {};

      // Transient network blips on the update must not kill a multi-hour run —
      // retry, then skip the row (it stays unfetched and is retried next run)
      let updated = false;
      for (let attempt = 0; attempt < 4 && !updated; attempt++) {
        try {
          const { error: updateError } = await client
            .from('urc_comment_letters')
            .update(
              text
                ? {
                    ...identifierPatch,
                    content: text,
                    content_fetched_at: attemptTime,
                    content_error: null,
                    content_fetch_attempts: attemptCount,
                    content_last_attempt_at: attemptTime,
                    content_next_retry_at: null,
                  }
                : {
                    ...identifierPatch,
                    content_error: extractError,
                    content_fetch_attempts: attemptCount,
                    content_last_attempt_at: attemptTime,
                    content_next_retry_at: retryable ? nextLetterRetryAt(attemptCount) : null,
                  }
            )
            .eq('accession', row.accession)
            .eq('cik', row.cik);
          if (!updateError) updated = true;
          else if (attempt + 1 < 4) await delay(1500 * 2 ** attempt);
        } catch {
          if (attempt + 1 < 4) await delay(1500 * 2 ** attempt);
        }
      }
      if (!updated) {
        console.error(`  update kept failing for ${row.accession}; skipping (will retry next run)`);
        continue;
      }

      if (text) fetched++; else errored++;
      if ((fetched + errored) % 500 === 0) {
        console.log(`  progress: ${fetched} fetched, ${errored} without text`);
      }
      await delay(REQUEST_INTERVAL_MS);
    }
  }

  if (shouldRethreadLetters(identifierUpdates, fetched + errored)) {
    const { data: threaded, error: threadError } = await client.rpc('urc_thread_letters');
    if (threadError) console.error('Threading failed (re-run later):', threadError.message);
    else console.log(`Threading: ${threaded} rows (re)assigned after header extraction.`);
  }

  console.log(`Done. ${identifierUpdates} legacy identifiers reconciled, ${fetched} letters stored, ${errored} unavailable or scheduled for retry.`);
}

if (process.argv[1]?.includes('fetch-letter-text')) {
  main().catch(error => {
    console.error('Letter text fetch failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
