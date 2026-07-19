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

const EDGAR_BASE = 'https://www.sec.gov';
const USER_AGENT =
  process.env.EDGAR_USER_AGENT ||
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT ||
  'Uniqus Research Center contact@uniqus.com';

/** ~4 req/s — well under the SEC's 10 req/s ceiling, sustainable for hours. */
const REQUEST_INTERVAL_MS = 250;
const MAX_CONTENT_CHARS = 600_000; // keep below the tsvector guard in the schema
const BATCH = 500;

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

async function fetchSubmission(filename: string): Promise<string | null> {
  const url = `${EDGAR_BASE}/Archives/${filename}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch {
      await delay(1000 * 2 ** attempt);
    }
  }
  return null;
}

async function main() {
  const limit = Number(getArg('limit') || 0);
  const maxMinutes = Number(getArg('max-minutes') || 0);
  const deadline = maxMinutes > 0 ? Date.now() + maxMinutes * 60_000 : Infinity;

  const client = createServiceClient();
  let fetched = 0;
  let errored = 0;

  for (;;) {
    if (Date.now() >= deadline) break;
    if (limit > 0 && fetched + errored >= limit) break;

    const { data: rows, error } = await client
      .from('urc_comment_letters')
      .select('accession, cik, filename')
      .is('content', null)
      .is('content_error', null)
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

      const raw = await fetchSubmission(row.filename);
      const { text, error: extractError } = raw
        ? await extractLetterText(raw)
        : { text: null, error: 'fetch_failed' as string | null };

      // Transient network blips on the update must not kill a multi-hour run —
      // retry, then skip the row (it stays unfetched and is retried next run)
      let updated = false;
      for (let attempt = 0; attempt < 4 && !updated; attempt++) {
        try {
          const { error: updateError } = await client
            .from('urc_comment_letters')
            .update(
              text
                ? { content: text, content_fetched_at: new Date().toISOString(), content_error: null }
                : { content_error: extractError, content_fetched_at: new Date().toISOString() }
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

  console.log(`Done. ${fetched} letters stored, ${errored} marked (pdf_only / no_text / fetch_failed).`);
}

if (process.argv[1]?.includes('fetch-letter-text')) {
  main().catch(error => {
    console.error('Letter text fetch failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
