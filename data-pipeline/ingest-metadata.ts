/**
 * Metadata-only EDGAR ingest → urc_sec_filings (Supabase Postgres).
 *
 * Replaces the deleted Elastic full-text pipeline: no document downloads, no
 * truncation, no bulk timeouts — one master.idx fetch per quarter, then
 * chunked upserts of ~1KB rows. A full multi-year backfill is minutes, not days.
 *
 * Usage:
 *   npx tsx data-pipeline/ingest-metadata.ts --start 2021-01-01 --end 2026-07-19
 *   npx tsx data-pipeline/ingest-metadata.ts --since 3            # last 3 days (daily cron)
 *   npx tsx data-pipeline/ingest-metadata.ts --start ... --all-forms
 *   npx tsx data-pipeline/ingest-metadata.ts --start ... --dry-run [--limit 1000]
 *
 * --dry-run writes rows to data-pipeline/metadata-sample.jsonl instead of Supabase.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CORE_FORMS, fetchQuarterIndex, getQuartersInRange, delay, type EdgarIndexEntry } from './edgar-index';
import { chunkedUpsert, createServiceClient } from './supabase';

interface FilingRow {
  accession: string;
  cik: number;
  company_name: string;
  form: string;
  root_form: string;
  is_amendment: boolean;
  date_filed: string;
  filename: string;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toRow(entry: EdgarIndexEntry): FilingRow {
  const rootForm = entry.formType.replace(/\/A$/, '');
  return {
    accession: entry.accessionNumber,
    cik: entry.cik,
    company_name: entry.companyName,
    form: entry.formType,
    root_form: rootForm,
    is_amendment: rootForm !== entry.formType,
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
    const startDate = new Date(Date.now() - Number(sinceDays) * 86_400_000);
    start = startDate.toISOString().slice(0, 10);
    end = today;
  }
  if (!start) {
    console.error('Usage: ingest-metadata --start YYYY-MM-DD [--end YYYY-MM-DD] | --since N  [--all-forms] [--dry-run] [--limit N]');
    process.exit(1);
  }

  const allForms = hasFlag('all-forms');
  const dryRun = hasFlag('dry-run');
  const limit = Number(getArg('limit') || 0);

  console.log(`EDGAR metadata ingest: ${start} → ${end} | forms: ${allForms ? 'ALL' : 'core'} | ${dryRun ? 'DRY RUN' : 'upsert to Supabase'}`);

  const client = dryRun ? null : createServiceClient();
  const quarters = getQuartersInRange(start, end);
  let totalRows = 0;

  for (const { year, quarter } of quarters) {
    console.log(`  Fetching ${year}/QTR${quarter} master.idx...`);
    const entries = await fetchQuarterIndex(year, quarter);
    let filtered = entries.filter(e => e.dateFiled >= start! && e.dateFiled <= end);
    if (!allForms) filtered = filtered.filter(e => CORE_FORMS.has(e.formType));

    // Dedupe within the quarter on (accession, cik) — the table's PK
    const seen = new Set<string>();
    let rows: FilingRow[] = [];
    for (const entry of filtered) {
      const key = `${entry.accessionNumber}:${entry.cik}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(toRow(entry));
    }
    if (limit > 0 && totalRows + rows.length > limit) {
      rows = rows.slice(0, limit - totalRows);
    }

    console.log(`  ${year}/Q${quarter}: ${rows.length} rows (${entries.length} raw index lines)`);

    if (dryRun) {
      const out = resolve(import.meta.dirname || '.', 'metadata-sample.jsonl');
      writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n', { flag: totalRows === 0 ? 'w' : 'a' });
    } else if (rows.length > 0) {
      await chunkedUpsert(client!, 'urc_sec_filings', rows as unknown as Record<string, unknown>[], 'accession,cik', 1000,
        (done, total) => { if (done % 10_000 === 0 || done === total) console.log(`    upserted ${done}/${total}`); });
    }

    totalRows += rows.length;
    if (limit > 0 && totalRows >= limit) break;
    await delay(300); // be polite to SEC between quarter downloads
  }

  console.log(`Done. ${totalRows} rows ${dryRun ? 'written to metadata-sample.jsonl' : 'upserted to urc_sec_filings'}.`);
}

main().catch(error => {
  console.error('Ingest failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
