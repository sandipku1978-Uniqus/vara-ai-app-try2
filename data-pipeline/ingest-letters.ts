/**
 * Comment-letter metadata ingest → urc_comment_letters.
 *
 * UPLOAD (SEC Staff letters) + CORRESP (company responses) from EDGAR
 * master.idx. Metadata only — text is fetched separately by
 * fetch-letter-text.ts, and threads are assigned by the urc_thread_letters()
 * SQL function (invoked here after each successful load).
 *
 * Usage:
 *   npx tsx data-pipeline/ingest-letters.ts --start 2005-01-01
 *   npx tsx data-pipeline/ingest-letters.ts --since 3        # daily cron
 *   npx tsx data-pipeline/ingest-letters.ts --start ... --dry-run [--limit N]
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchQuarterIndex, getQuartersInRange, delay, type EdgarIndexEntry } from './edgar-index';
import { chunkedUpsert, createServiceClient } from './supabase';

const LETTER_FORMS = new Set(['UPLOAD', 'CORRESP']);

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toRow(entry: EdgarIndexEntry) {
  return {
    accession: entry.accessionNumber,
    cik: entry.cik,
    company_name: entry.companyName,
    form: entry.formType,
    date_filed: entry.dateFiled,
    filename: entry.filename,
  };
}

async function main() {
  const sinceDays = getArg('since');
  const today = new Date().toISOString().slice(0, 10);
  let start = getArg('start');
  let end = getArg('end') || today;
  if (sinceDays) {
    start = new Date(Date.now() - Number(sinceDays) * 86_400_000).toISOString().slice(0, 10);
    end = today;
  }
  if (!start) {
    console.error('Usage: ingest-letters --start YYYY-MM-DD [--end YYYY-MM-DD] | --since N  [--dry-run] [--limit N]');
    process.exit(1);
  }

  const dryRun = hasFlag('dry-run');
  const limit = Number(getArg('limit') || 0);
  console.log(`Comment-letter metadata ingest: ${start} → ${end} ${dryRun ? '(DRY RUN)' : ''}`);

  const client = dryRun ? null : createServiceClient();
  let totalRows = 0;

  for (const { year, quarter } of getQuartersInRange(start, end)) {
    const entries = await fetchQuarterIndex(year, quarter);
    const seen = new Set<string>();
    let rows = entries
      .filter(e => LETTER_FORMS.has(e.formType) && e.dateFiled >= start! && e.dateFiled <= end)
      .filter(e => {
        const key = `${e.accessionNumber}:${e.cik}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(toRow);
    if (limit > 0 && totalRows + rows.length > limit) rows = rows.slice(0, limit - totalRows);

    console.log(`  ${year}/Q${quarter}: ${rows.length} letters`);
    if (dryRun) {
      const out = resolve(import.meta.dirname || '.', 'letters-sample.jsonl');
      writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n', { flag: totalRows === 0 ? 'w' : 'a' });
    } else if (rows.length > 0) {
      // Never overwrite fetched content: update only metadata columns on conflict
      await chunkedUpsert(client!, 'urc_comment_letters', rows, 'accession,cik', 1000);
    }
    totalRows += rows.length;
    if (limit > 0 && totalRows >= limit) break;
    await delay(300);
  }

  if (!dryRun && totalRows > 0) {
    const { data, error } = await client!.rpc('urc_thread_letters');
    if (error) console.error('Threading failed (re-run later):', error.message);
    else console.log(`Threading: ${data} rows (re)assigned.`);
  }
  console.log(`Done. ${totalRows} letter rows ${dryRun ? 'written locally' : 'upserted'}.`);
}

main().catch(error => {
  console.error('Letter ingest failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
