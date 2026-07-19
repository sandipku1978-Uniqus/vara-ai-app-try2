/**
 * PCAOB Form AP dataset → urc_sec_auditors (Supabase Postgres).
 *
 * Source: https://assets.pcaobus.org/firm-filings/FirmFilings.zip (free,
 * refreshed continuously) — every Form AP audit-report filing with firm name,
 * issuer CIK, and fiscal period end. This replaces regex-scraping auditors
 * out of filing text (which was truncation-broken and unreliable) with the
 * regulator's own structured data.
 *
 * Usage:
 *   npx tsx data-pipeline/load-auditors.ts                       # download + upsert
 *   npx tsx data-pipeline/load-auditors.ts --file FirmFilings.csv
 *   npx tsx data-pipeline/load-auditors.ts --dry-run [--limit 5000]
 *
 * --dry-run writes data-pipeline/auditors-sample.jsonl instead of Supabase.
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse';
import { canonicalizeAuditorInput } from '../src/services/auditors';
import { chunkedUpsert, createServiceClient } from './supabase';

const DATASET_URL = 'https://assets.pcaobus.org/firm-filings/FirmFilings.zip';

interface AuditorRow {
  form_filing_id: number;
  is_latest: boolean;
  firm_id: number | null;
  firm_name: string;
  firm_canonical: string;
  firm_country: string | null;
  issuer_cik: number | null;
  issuer_name: string | null;
  audit_report_date: string | null;
  fiscal_period_end: string | null;
  filing_date: string | null;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** "1/31/2017 12:00:00 AM" | "2017-01-31" → "2017-01-31" (null if unparseable) */
export function parseUsDate(value: string | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

/** Canonical label for facet filtering; falls back to the raw firm name so
 *  non-network firms remain filterable by exact name. */
export function canonicalFirm(firmName: string): string {
  const canonical = canonicalizeAuditorInput(firmName);
  return canonical || firmName.trim();
}

export function toAuditorRow(record: Record<string, string>): AuditorRow | null {
  const idRaw = (record['Form Filing ID'] || '').trim();
  const id = Number(idRaw);
  const firmName = (record['Firm Name'] || '').trim();
  if (!idRaw || !Number.isFinite(id) || !firmName) return null;

  const cikRaw = (record['Issuer CIK'] || '').replace(/\D/g, '');
  return {
    form_filing_id: id,
    is_latest: (record['Latest Form AP Filing'] || '').trim() === '1',
    firm_id: Number(record['Firm ID']) || null,
    firm_name: firmName,
    firm_canonical: canonicalFirm(firmName),
    firm_country: (record['Firm Country'] || '').trim() || null,
    issuer_cik: cikRaw ? Number(cikRaw) : null,
    issuer_name: (record['Issuer Name'] || '').trim() || null,
    audit_report_date: parseUsDate(record['Audit Report Date']),
    fiscal_period_end: parseUsDate(record['Fiscal Period End Date']),
    filing_date: parseUsDate(record['Filing Date']),
  };
}

async function resolveCsvPath(): Promise<string> {
  const fileArg = getArg('file');
  if (fileArg) {
    if (!existsSync(fileArg)) throw new Error(`--file not found: ${fileArg}`);
    return fileArg;
  }
  const dir = mkdtempSync(join(tmpdir(), 'formap-'));
  const zipPath = join(dir, 'FirmFilings.zip');
  console.log(`Downloading ${DATASET_URL} ...`);
  execFileSync('curl', ['-sL', '--max-time', '300', '-A', 'Mozilla/5.0', DATASET_URL, '-o', zipPath]);
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', dir]);
  const csvPath = join(dir, 'FirmFilings.csv');
  if (!existsSync(csvPath)) throw new Error('FirmFilings.csv not found in downloaded zip');
  return csvPath;
}

async function main() {
  const dryRun = hasFlag('dry-run');
  const limit = Number(getArg('limit') || 0);
  const csvPath = await resolveCsvPath();

  console.log(`Parsing ${csvPath} ${dryRun ? '(DRY RUN)' : ''}...`);

  const rows: AuditorRow[] = [];
  let parsed = 0;
  let skipped = 0;

  const parser = createReadStream(csvPath).pipe(parse({
    columns: header => header.map((h: string) => h.replace(/\s+/g, ' ').trim()),
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }));

  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    parsed++;
    const row = toAuditorRow(record);
    if (!row) { skipped++; continue; }
    rows.push(row);
    if (limit > 0 && rows.length >= limit) break;
  }

  console.log(`Parsed ${parsed} records → ${rows.length} rows (${skipped} without id/firm).`);
  const canonicalCounts: Record<string, number> = {};
  for (const row of rows) {
    if (row.is_latest) canonicalCounts[row.firm_canonical] = (canonicalCounts[row.firm_canonical] || 0) + 1;
  }
  const top = Object.entries(canonicalCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('Top current auditors:', top.map(([name, count]) => `${name}=${count}`).join(', '));

  if (dryRun) {
    const out = resolve(import.meta.dirname || '.', 'auditors-sample.jsonl');
    writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log(`Done. ${rows.length} rows written to ${out}`);
    return;
  }

  const client = createServiceClient();
  await chunkedUpsert(client, 'urc_sec_auditors', rows as unknown as Record<string, unknown>[], 'form_filing_id', 1000,
    (done, total) => { if (done % 20_000 === 0 || done === total) console.log(`  upserted ${done}/${total}`); });
  console.log(`Done. ${rows.length} rows upserted to urc_sec_auditors.`);
}

// Run only when executed directly — this module is also imported by tests
// for parseUsDate/canonicalFirm/toAuditorRow.
if (process.argv[1]?.includes('load-auditors')) {
  main().catch(error => {
    console.error('Auditor load failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
