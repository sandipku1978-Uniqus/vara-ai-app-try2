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

export const ORDINARY_ISSUER_REPORT_TYPE =
  'Issuer, other than Employee Benefit Plan or Investment Company';

export const KNOWN_AUDITOR_REPORT_TYPES = [
  ORDINARY_ISSUER_REPORT_TYPE,
  'Investment Company',
  'Employee Benefit Plan',
] as const;

export const REQUIRED_AUDITOR_CSV_HEADERS = [
  'Form Filing ID',
  'Latest Form AP Filing',
  'Firm ID',
  'Firm Name',
  'Firm Country',
  'Issuer CIK',
  'Issuer Name',
  'Audit Report Type',
  'Audit Fund Series',
  'Audit Report Date',
  'Fiscal Period End Date',
  'Filing Date',
] as const;

/**
 * Production completeness guardrails are deliberately below the official
 * Form AP file's observed scale, but high enough that a partial download can
 * never replace the authoritative corpus. On 2026-08-03 the PCAOB archive had
 * 155,269 valid rows, 149,652 rows marked latest, and 85,370 latest ordinary-
 * issuer rows with both CIK and report date coverage.
 *
 * The corpus is cumulative. Revisit these floors only after verifying a
 * genuine upstream schema or retention-policy change against PCAOB itself.
 */
export const MIN_PRODUCTION_AUDITOR_ROWS = 125_000;
export const MIN_PRODUCTION_LATEST_AUDITOR_ROWS = 120_000;
export const MIN_PRODUCTION_ORDINARY_ISSUER_ROWS = 65_000;
export const MAX_PRODUCTION_AUDITOR_SKIPPED_ROWS = 250;
export const MAX_PRODUCTION_AUDITOR_SKIPPED_RATIO = 0.001;

export type AuditorDatasetValidationMode = 'production' | 'fixture' | 'dry-run';

export interface AuditorDatasetSummary {
  sourceRowCount: number;
  validRowCount: number;
  skippedRowCount: number;
  latestRowCount: number;
  ordinaryIssuerCoverage: number;
}

export interface AuditorDatasetValidationOptions {
  mode?: AuditorDatasetValidationMode;
  sourceRowCount?: number;
  skippedRowCount?: number;
}

export interface AuditorRow {
  form_filing_id: number;
  is_latest: boolean;
  firm_id: number | null;
  firm_name: string;
  firm_canonical: string;
  firm_country: string | null;
  issuer_cik: number | null;
  issuer_name: string | null;
  audit_report_type: string | null;
  audit_fund_series: string | null;
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

export function validateAuditorLoadMode(
  dryRun: boolean,
  limitValue: string | undefined,
  limitSupplied = limitValue !== undefined
): number {
  if (!limitSupplied) return 0;
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer.');
  }
  if (!dryRun) {
    throw new Error('--limit is allowed only with --dry-run; refusing a partial production auditor load.');
  }
  return limit;
}

export function normalizeAndValidateAuditorHeaders(headers: string[]): string[] {
  const normalized = headers.map(header => header.replace(/\s+/g, ' ').trim());
  const emptyAt = normalized.findIndex(header => header.length === 0);
  if (emptyAt >= 0) {
    throw new Error(`PCAOB CSV schema is invalid: header ${emptyAt + 1} is empty.`);
  }
  const duplicates = Array.from(new Set(
    normalized.filter((header, index) => normalized.indexOf(header) !== index)
  ));
  if (duplicates.length > 0) {
    throw new Error(`PCAOB CSV schema is invalid: duplicate header(s): ${duplicates.join(', ')}.`);
  }
  const available = new Set(normalized);
  const missing = REQUIRED_AUDITOR_CSV_HEADERS.filter(header => !available.has(header));
  if (missing.length > 0) {
    throw new Error(`PCAOB CSV schema changed; missing required header(s): ${missing.join(', ')}.`);
  }
  return normalized;
}

export function auditorCsvParseOptions() {
  return {
    columns: normalizeAndValidateAuditorHeaders,
    bom: true,
    relax_quotes: true,
    // A short/long row is evidence of a truncated or schema-drifted archive.
    // Do not let csv-parse silently coerce it into a superficially valid row.
    relax_column_count: false,
    skip_empty_lines: true,
  } as const;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`PCAOB dataset summary ${label} must be a non-negative integer.`);
  }
}

export function validateAuditorDatasetSummaryBeforeWrite(
  summary: Readonly<AuditorDatasetSummary>,
  mode: AuditorDatasetValidationMode = 'production'
): void {
  for (const [label, value] of Object.entries(summary)) {
    assertNonNegativeInteger(value, label);
  }
  if (summary.validRowCount === 0) {
    throw new Error('PCAOB CSV produced zero valid auditor rows; refusing to write.');
  }
  if (summary.validRowCount + summary.skippedRowCount !== summary.sourceRowCount) {
    throw new Error(
      `PCAOB dataset summary is inconsistent: ${formatCount(summary.validRowCount)} valid + ` +
      `${formatCount(summary.skippedRowCount)} skipped != ` +
      `${formatCount(summary.sourceRowCount)} source rows.`
    );
  }
  if (
    summary.ordinaryIssuerCoverage > summary.latestRowCount
    || summary.latestRowCount > summary.validRowCount
  ) {
    throw new Error('PCAOB dataset summary has impossible coverage counts; refusing to write.');
  }

  // Small fixtures and bounded dry runs are explicit non-production modes.
  // They still receive row/schema/report-type validation in the caller, but
  // cannot be mistaken for a complete corpus eligible for a database write.
  if (mode !== 'production') return;

  const skippedRatio = summary.skippedRowCount / summary.sourceRowCount;
  if (
    summary.skippedRowCount > MAX_PRODUCTION_AUDITOR_SKIPPED_ROWS
    || skippedRatio > MAX_PRODUCTION_AUDITOR_SKIPPED_RATIO
  ) {
    throw new Error(
      `PCAOB CSV skipped ${formatCount(summary.skippedRowCount)}/` +
      `${formatCount(summary.sourceRowCount)} rows (${(skippedRatio * 100).toFixed(3)}%); ` +
      `production allows at most ${formatCount(MAX_PRODUCTION_AUDITOR_SKIPPED_ROWS)} rows ` +
      `and ${(MAX_PRODUCTION_AUDITOR_SKIPPED_RATIO * 100).toFixed(3)}%. Refusing to write.`
    );
  }

  const shortfalls = [
    summary.validRowCount < MIN_PRODUCTION_AUDITOR_ROWS
      ? `valid rows ${formatCount(summary.validRowCount)} < ${formatCount(MIN_PRODUCTION_AUDITOR_ROWS)}`
      : null,
    summary.latestRowCount < MIN_PRODUCTION_LATEST_AUDITOR_ROWS
      ? `latest rows ${formatCount(summary.latestRowCount)} < ${formatCount(MIN_PRODUCTION_LATEST_AUDITOR_ROWS)}`
      : null,
    summary.ordinaryIssuerCoverage < MIN_PRODUCTION_ORDINARY_ISSUER_ROWS
      ? `latest ordinary-issuer coverage ${formatCount(summary.ordinaryIssuerCoverage)} < ` +
        formatCount(MIN_PRODUCTION_ORDINARY_ISSUER_ROWS)
      : null,
  ].filter((reason): reason is string => reason !== null);
  if (shortfalls.length > 0) {
    throw new Error(
      `PCAOB dataset is below the production completeness floor (${shortfalls.join('; ')}); ` +
      `refusing to write any rows.`
    );
  }
}

export function validateAuditorDatasetBeforeWrite(
  rows: readonly AuditorRow[],
  options: AuditorDatasetValidationOptions = {}
): {
  ordinaryIssuerCoverage: number;
} {
  if (rows.length === 0) {
    throw new Error('PCAOB CSV produced zero valid auditor rows; refusing to write.');
  }
  const seenFormFilingIds = new Set<number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.form_filing_id) || row.form_filing_id <= 0) {
      throw new Error('PCAOB dataset contains an invalid Form Filing ID; refusing to write any rows.');
    }
    if (seenFormFilingIds.has(row.form_filing_id)) {
      throw new Error(
        `PCAOB dataset contains duplicate Form Filing ID ${row.form_filing_id}; refusing to write any rows.`
      );
    }
    seenFormFilingIds.add(row.form_filing_id);
    if (typeof row.is_latest !== 'boolean') {
      throw new Error('PCAOB dataset contains an invalid Latest Form AP Filing flag; refusing to write any rows.');
    }
    if (typeof row.firm_name !== 'string' || !row.firm_name.trim()) {
      throw new Error('PCAOB dataset contains a blank Firm Name; refusing to write any rows.');
    }
    if (row.firm_id !== null && (!Number.isSafeInteger(row.firm_id) || row.firm_id <= 0)) {
      throw new Error('PCAOB dataset contains an invalid Firm ID; refusing to write any rows.');
    }
    if (
      row.issuer_cik !== null
      && (!Number.isSafeInteger(row.issuer_cik) || row.issuer_cik <= 0 || row.issuer_cik > 9_999_999_999)
    ) {
      throw new Error('PCAOB dataset contains an invalid Issuer CIK; refusing to write any rows.');
    }
    for (const [label, value] of [
      ['Audit Report Date', row.audit_report_date],
      ['Fiscal Period End Date', row.fiscal_period_end],
      ['Filing Date', row.filing_date],
    ] as const) {
      if (value !== null && parseUsDate(value) !== value) {
        throw new Error(`PCAOB dataset contains an invalid ${label}; refusing to write any rows.`);
      }
    }
  }
  const knownReportTypes = new Set<string>(KNOWN_AUDITOR_REPORT_TYPES);
  const missingReportType = rows.filter(row => !row.audit_report_type).length;
  const unknownReportTypes = Array.from(new Set(
    rows
      .map(row => row.audit_report_type)
      .filter((reportType): reportType is string => Boolean(reportType) && !knownReportTypes.has(reportType!))
  ));
  if (missingReportType > 0 || unknownReportTypes.length > 0) {
    const reasons = [
      missingReportType > 0 ? `${missingReportType}/${rows.length} rows have a blank Audit Report Type` : null,
      unknownReportTypes.length > 0
        ? `unrecognized Audit Report Type value(s): ${unknownReportTypes.join(', ')}`
        : null,
    ].filter((reason): reason is string => reason !== null);
    throw new Error(
      `PCAOB Audit Report Type coverage is invalid (${reasons.join('; ')}); refusing to write any rows.`
    );
  }
  const ordinaryIssuerCoverage = rows.filter(row =>
    row.is_latest
    && row.issuer_cik !== null
    && row.audit_report_date !== null
    && row.audit_report_type === ORDINARY_ISSUER_REPORT_TYPE
  ).length;
  const mode = options.mode ?? 'production';
  if (ordinaryIssuerCoverage === 0 && mode !== 'dry-run') {
    throw new Error(
      `PCAOB CSV produced zero latest ordinary-issuer Form AP rows with CIK/report-date coverage; ` +
      `refusing to write ${rows.length} rows.`
    );
  }
  const skippedRowCount = options.skippedRowCount ?? 0;
  validateAuditorDatasetSummaryBeforeWrite({
    sourceRowCount: options.sourceRowCount ?? rows.length + skippedRowCount,
    validRowCount: rows.length,
    skippedRowCount,
    latestRowCount: rows.filter(row => row.is_latest).length,
    ordinaryIssuerCoverage,
  }, mode);
  return { ordinaryIssuerCoverage };
}

/** "1/31/2017 12:00:00 AM" | "2017-01-31" → "2017-01-31" (null if unparseable) */
export function parseUsDate(value: string | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?\s+(?:AM|PM))?$/i
  );
  const year = Number(iso?.[1] ?? us?.[3]);
  const month = Number(iso?.[2] ?? us?.[1]);
  const day = Number(iso?.[3] ?? us?.[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Canonical label for facet filtering; falls back to the raw firm name so
 *  non-network firms remain filterable by exact name. */
export function canonicalFirm(firmName: string): string {
  const canonical = canonicalizeAuditorInput(firmName);
  return canonical || firmName.trim();
}

export function toAuditorRow(record: Record<string, string>): AuditorRow | null {
  const idRaw = (record['Form Filing ID'] || '').trim();
  const latestRaw = (record['Latest Form AP Filing'] || '').trim();
  const firmIdRaw = (record['Firm ID'] || '').trim();
  const cikRaw = (record['Issuer CIK'] || '').trim();
  const firmName = (record['Firm Name'] || '').trim();
  if (!/^\d+$/.test(idRaw) || !firmName || !/^[01]$/.test(latestRaw)) return null;
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (firmIdRaw && !/^\d+$/.test(firmIdRaw)) return null;
  const firmId = firmIdRaw ? Number(firmIdRaw) : null;
  if (firmId !== null && (!Number.isSafeInteger(firmId) || firmId <= 0)) return null;
  if (cikRaw && !/^\d{1,10}$/.test(cikRaw)) return null;
  const issuerCik = cikRaw ? Number(cikRaw) : null;
  if (issuerCik !== null && (!Number.isSafeInteger(issuerCik) || issuerCik <= 0 || issuerCik > 9_999_999_999)) {
    return null;
  }

  const dateValues = [
    record['Audit Report Date'],
    record['Fiscal Period End Date'],
    record['Filing Date'],
  ];
  const parsedDates = dateValues.map(value => parseUsDate(value));
  if (dateValues.some((value, index) => Boolean(value?.trim()) && parsedDates[index] === null)) return null;

  return {
    form_filing_id: id,
    is_latest: latestRaw === '1',
    firm_id: firmId,
    firm_name: firmName,
    firm_canonical: canonicalFirm(firmName),
    firm_country: (record['Firm Country'] || '').trim() || null,
    issuer_cik: issuerCik,
    issuer_name: (record['Issuer Name'] || '').trim() || null,
    audit_report_type: (record['Audit Report Type'] || '').trim() || null,
    audit_fund_series: (record['Audit Fund Series'] || '').trim() || null,
    audit_report_date: parsedDates[0],
    fiscal_period_end: parsedDates[1],
    filing_date: parsedDates[2],
  };
}

/** Refresh every auditor projection after a complete Form AP upsert. A stale
 * projection is a failed ingestion, not a warning: search treats the temporal
 * relation as authoritative and must never report a green data job otherwise. */
export async function refreshAuditorViews(
  client: ReturnType<typeof createServiceClient>
): Promise<void> {
  for (const [rpc, label] of [
    ['urc_refresh_auditor_periods', 'urc_auditor_periods_mat'],
    ['urc_refresh_current_auditors', 'urc_current_auditors_mat'],
  ] as const) {
    const { error: refreshError } = await client.rpc(rpc);
    if (refreshError) {
      throw new Error(`${label} refresh failed after Form AP upsert: ${refreshError.message}`);
    }
    console.log(`Refreshed ${label}.`);
  }
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
  const limit = validateAuditorLoadMode(dryRun, getArg('limit'), hasFlag('limit'));
  const csvPath = await resolveCsvPath();

  console.log(`Parsing ${csvPath} ${dryRun ? '(DRY RUN)' : ''}...`);

  const rows: AuditorRow[] = [];
  let parsed = 0;
  let skipped = 0;

  const parser = createReadStream(csvPath).pipe(parse(auditorCsvParseOptions()));

  for await (const record of parser as AsyncIterable<Record<string, string>>) {
    parsed++;
    const row = toAuditorRow(record);
    if (!row) { skipped++; continue; }
    rows.push(row);
    if (limit > 0 && rows.length >= limit) break;
  }

  console.log(`Parsed ${parsed} records → ${rows.length} rows (${skipped} without id/firm).`);
  const coverage = validateAuditorDatasetBeforeWrite(rows, {
    mode: dryRun ? 'dry-run' : 'production',
    sourceRowCount: parsed,
    skippedRowCount: skipped,
  });
  console.log(
    `Validated ${coverage.ordinaryIssuerCoverage} latest ordinary-issuer Form AP rows ` +
    `${dryRun ? 'for a bounded dry run' : 'before production write'}.`
  );
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

  // Current-issuer views support issuer profile enrichment and are derived
  // from the date-effective intervals introduced in 022. Refresh the temporal
  // source first, then its current-state projection, only after the complete
  // Form AP upsert.
  await refreshAuditorViews(client);
}

// Run only when executed directly — this module is also imported by tests
// for parseUsDate/canonicalFirm/toAuditorRow.
if (process.argv[1]?.includes('load-auditors')) {
  main().catch(error => {
    console.error('Auditor load failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
