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
import { DOMParser } from 'linkedom';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  looksLikeSecErrorResponse,
  readResponseWithLimit,
  SecUpstreamError,
} from '../src/lib/sec-upstream';

const EDGAR_BASE = 'https://www.sec.gov';
const USER_AGENT =
  process.env.EDGAR_USER_AGENT ||
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT ||
  'Uniqus Research Center contact@uniqus.com';

/** ~4 req/s — well under the SEC's 10 req/s ceiling, sustainable for hours. */
const REQUEST_INTERVAL_MS = 250;
const MAX_CONTENT_CHARS = 600_000; // keep below the tsvector guard in the schema
const MAX_SUBMISSION_BYTES = 50 * 1024 * 1024;
const SEC_SUBMISSION_CONTENT_TYPE = /^(?:text\/plain|text\/html|application\/xhtml\+xml)(?:;|$)/i;
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

export interface AuthoritativeWriteHealth {
  attempted: number;
  succeeded: number;
  exhausted: number;
}

export interface IdentifierReconciliationStats {
  updated: number;
  attemptedUpdates: number;
  exhaustedUpdates: number;
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

/** Every exhausted authoritative update fails the job. The row remains
 * resumable, but a green pipeline run must mean every attempted write landed. */
export function authoritativeWriteFailureReason(health: AuthoritativeWriteHealth): string | null {
  if (health.attempted <= 0 || health.exhausted <= 0) return null;
  if (health.succeeded <= 0 && health.exhausted >= health.attempted) {
    return `all ${health.attempted} authoritative comment-letter DB writes exhausted retries`;
  }
  return `${health.exhausted}/${health.attempted} authoritative comment-letter DB writes exhausted retries`;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function htmlToText(html: string): string {
  // SEC submissions are malformed often enough that regex-based tag removal
  // is both incomplete and unsafe. Parse as HTML so script/style contents are
  // discarded structurally and character references are decoded exactly once.
  const document = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html'
  ) as unknown as Document;
  for (const node of Array.from(document.querySelectorAll('script, style'))) {
    node.remove();
  }
  for (const node of Array.from(
    document.querySelectorAll('p, div, br, hr, h1, h2, h3, h4, h5, h6, tr, li, table')
  )) {
    node.before(document.createTextNode('\n'));
  }

  return (document.documentElement?.textContent || '')
    .replace(/\u00a0/g, ' ')
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

export async function fetchSubmission(
  filename: string,
  options: { maxAttempts?: number; retryBaseMs?: number; maxBytes?: number } = {}
): Promise<{ raw: string | null; error: string | null }> {
  const url = `${EDGAR_BASE}/Archives/${filename}`;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 1_000;
  const maxBytes = options.maxBytes ?? MAX_SUBMISSION_BYTES;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const signal = AbortSignal.timeout(30_000);
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
        signal,
      });
      if (response.status === 404) return { raw: null, error: 'not_found' };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type')?.trim() || '';
      if (!SEC_SUBMISSION_CONTENT_TYPE.test(contentType)) {
        throw new SecUpstreamError('SEC submission is not a text document.', 415);
      }
      const bytes = await readResponseWithLimit(response, maxBytes, signal, 30_000);
      if (looksLikeSecErrorResponse(bytes)) {
        throw new SecUpstreamError('SEC upstream returned an error page.', 502);
      }
      return { raw: new TextDecoder('utf-8').decode(bytes), error: null };
    } catch (error) {
      if (error instanceof SecUpstreamError && error.status === 413) {
        return { raw: null, error: 'too_large' };
      }
      if (attempt + 1 < maxAttempts && retryBaseMs > 0) {
        await delay(retryBaseMs * 2 ** attempt);
      }
    }
  }
  return { raw: null, error: 'fetch_failed' };
}

export function nextLetterRetryAt(attempts: number, now = Date.now()): string {
  const delayMinutes = Math.min(15 * 2 ** Math.min(Math.max(attempts - 1, 0), 10), 7 * 24 * 60);
  return new Date(now + delayMinutes * 60_000).toISOString();
}

export async function updateCommentLetterWithRetry(
  client: SupabaseClient,
  row: { accession: string; cik: number },
  patch: Record<string, unknown>,
  options: { maxAttempts?: number; retryBaseMs?: number } = {}
): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 4;
  const retryBaseMs = options.retryBaseMs ?? 500;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
    if (attempt + 1 < maxAttempts && retryBaseMs > 0) {
      await delay(retryBaseMs * 2 ** attempt);
    }
  }
  return false;
}

export async function rethreadLetterDerivations(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('urc_thread_letters');
  if (error) {
    throw new Error(
      `urc_thread_letters failed after authoritative comment-letter writes: ${error.message}`
    );
  }
  return Number(data ?? 0);
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
): Promise<IdentifierReconciliationStats> {
  let updated = 0;
  let attemptedUpdates = 0;
  let exhaustedUpdates = 0;
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
      attemptedUpdates += 1;
      if (await updateCommentLetterWithRetry(client, row, deriveStoredLetterIdentifierPatch(row.content, checkedAt))) {
        updated += 1;
      } else {
        exhaustedUpdates += 1;
        return { updated, attemptedUpdates, exhaustedUpdates };
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
      attemptedUpdates += 1;
      if (await updateCommentLetterWithRetry(client, row, patch)) updated += 1;
      else {
        exhaustedUpdates += 1;
        return { updated, attemptedUpdates, exhaustedUpdates };
      }
      await delay(REQUEST_INTERVAL_MS);
    }
  }

  if (updated > 0) {
    console.log(`Identifier reconciliation: ${updated} legacy rows checked (${localProcessed} stored-text, ${remoteProcessed} header refetches).`);
  }
  return { updated, attemptedUpdates, exhaustedUpdates };
}

async function main() {
  const limit = Number(getArg('limit') || 0);
  const maxMinutes = Number(getArg('max-minutes') || 0);
  const identifierLimit = Math.max(0, Number(getArg('identifier-limit') ?? 20_000));
  const identifierRefetchLimit = Math.max(0, Number(getArg('identifier-refetch-limit') ?? 5_000));
  const deadline = maxMinutes > 0 ? Date.now() + maxMinutes * 60_000 : Infinity;

  const client = createServiceClient();
  const identifierStats = await backfillLegacyIdentifiers(
    client,
    deadline,
    identifierLimit,
    identifierRefetchLimit
  );
  const identifierWriteFailure = authoritativeWriteFailureReason({
    attempted: identifierStats.attemptedUpdates,
    succeeded: identifierStats.updated,
    exhausted: identifierStats.exhaustedUpdates,
  });
  if (identifierWriteFailure) {
    if (identifierStats.updated > 0) {
      const threaded = await rethreadLetterDerivations(client);
      console.log(`Threading: ${threaded} rows (re)assigned after partial identifier reconciliation.`);
    }
    throw new Error(`${identifierWriteFailure}; successful writes were retained and the remaining rows are resumable.`);
  }
  let fetched = 0;
  let errored = 0;
  let contentUpdateAttempts = 0;
  let contentUpdateExhausted = 0;

  contentQueue: for (;;) {
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

      const contentPatch = text
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
          };

      // A failed update leaves the row resumable, but the run now records the
      // exhausted write and fails if the DB is broadly unavailable.
      contentUpdateAttempts += 1;
      const updated = await updateCommentLetterWithRetry(client, row, contentPatch, {
        retryBaseMs: 1_500,
      });
      if (!updated) {
        contentUpdateExhausted += 1;
        console.error(`  update kept failing for ${row.accession}; skipping (will retry next run)`);
        break contentQueue;
      }

      if (text) fetched++; else errored++;
      if ((fetched + errored) % 500 === 0) {
        console.log(`  progress: ${fetched} fetched, ${errored} without text`);
      }
      await delay(REQUEST_INTERVAL_MS);
    }
  }

  if (shouldRethreadLetters(identifierStats.updated, fetched + errored)) {
    const threaded = await rethreadLetterDerivations(client);
    console.log(`Threading: ${threaded} rows (re)assigned after header extraction.`);
  }

  const writeHealth: AuthoritativeWriteHealth = {
    attempted: identifierStats.attemptedUpdates + contentUpdateAttempts,
    succeeded: identifierStats.updated + fetched + errored,
    exhausted: identifierStats.exhaustedUpdates + contentUpdateExhausted,
  };
  const writeFailure = authoritativeWriteFailureReason(writeHealth);
  if (writeFailure) {
    throw new Error(`${writeFailure}; successful writes were retained and the remaining rows are resumable.`);
  }
  console.log(
    `Done. ${identifierStats.updated} legacy identifiers reconciled, ${fetched} letters stored, ` +
    `${errored} unavailable or scheduled for retry, ${writeHealth.exhausted} DB writes exhausted.`
  );
}

if (process.argv[1]?.includes('fetch-letter-text')) {
  main().catch(error => {
    console.error('Letter text fetch failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
