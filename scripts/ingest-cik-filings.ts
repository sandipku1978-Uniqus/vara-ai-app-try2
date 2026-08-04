/**
 * Targeted per-CIK filing ingest from EDGAR submissions JSON.
 *
 * The quarterly master.idx pipeline keeps the common research forms. Issuers
 * whose post-2010 activity falls outside that set are completed from both the
 * SEC submissions `recent` block and every archive page whose date range
 * overlaps the requested floor.
 *
 *   npx tsx scripts/ingest-cik-filings.ts --ciks 1114859,2126221 [--floor 2010-01-01] [--dry]
 */
import { pathToFileURL } from 'node:url';
import { isValidEdgarDate, shouldIngestTargetedCikForm } from '../data-pipeline/edgar-index';
import { chunkedUpsert, createServiceClient } from '../data-pipeline/supabase';

const USER_AGENT = 'Uniqus Research Center contact@uniqus.com';
const SEC_REQUEST_INTERVAL_MS = 125;

export interface FilingRow {
  accession: string;
  cik: number;
  company_name: string;
  form: string;
  root_form: string;
  is_amendment: boolean;
  date_filed: string;
  filename: string;
}

interface FilingRecord {
  accession: string;
  form: string;
  dateFiled: string;
}

interface ArchiveDescriptor {
  name: string;
  filingFrom: string;
  filingTo: string;
  filingCount: number;
}

interface ParsedMainSubmissions {
  companyName: string;
  recent: FilingRecord[];
  requiredArchives: ArchiveDescriptor[];
}

export type SubmissionJsonFetcher = (url: string) => Promise<unknown>;

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function normalizeAccession(value: unknown, context: string, index: number): string {
  if (typeof value !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(value.trim())) {
    throw new Error(`${context} accessionNumber[${index}] is malformed`);
  }
  return value.trim();
}

function normalizeForm(value: unknown, context: string, index: number): string {
  if (typeof value !== 'string') throw new Error(`${context} form[${index}] is malformed`);
  const form = value.trim().toUpperCase();
  if (!form || form.length > 40 || !/^[A-Z0-9][A-Z0-9 /-]*$/.test(form)) {
    throw new Error(`${context} form[${index}] is malformed`);
  }
  return form;
}

function normalizeFilingDate(value: unknown, context: string, index: number): string {
  if (typeof value !== 'string' || !isValidEdgarDate(value)) {
    throw new Error(`${context} filingDate[${index}] is not a real ISO date`);
  }
  return value;
}

/** Validate the parallel SEC arrays before consuming any row. */
export function parseSubmissionArrays(value: unknown, context: string): FilingRecord[] {
  if (!value || typeof value !== 'object') throw new Error(`${context} filing arrays are missing`);
  const block = value as {
    accessionNumber?: unknown;
    filingDate?: unknown;
    form?: unknown;
  };
  if (!Array.isArray(block.accessionNumber) || !Array.isArray(block.filingDate) || !Array.isArray(block.form)) {
    throw new Error(`${context} filing arrays are missing`);
  }
  const accessions = block.accessionNumber;
  const filingDates = block.filingDate;
  const forms = block.form;
  const lengths = [accessions.length, filingDates.length, forms.length];
  if (!lengths.every(length => length === lengths[0])) {
    throw new Error(`${context} filing arrays have inconsistent lengths (${lengths.join('/')})`);
  }

  return accessions.map((accession, index) => ({
    accession: normalizeAccession(accession, context, index),
    form: normalizeForm(forms[index], context, index),
    dateFiled: normalizeFilingDate(filingDates[index], context, index),
  }));
}

function parseArchiveDescriptors(value: unknown, floor: string): ArchiveDescriptor[] {
  if (!Array.isArray(value)) throw new Error('main submissions filings.files is missing');
  const required: ArchiveDescriptor[] = [];
  const seen = new Set<string>();

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') throw new Error(`archive descriptor ${index} is malformed`);
    const descriptor = item as {
      name?: unknown;
      filingFrom?: unknown;
      filingTo?: unknown;
      filingCount?: unknown;
    };
    const name = typeof descriptor.name === 'string' ? descriptor.name.trim() : '';
    const filingFrom = typeof descriptor.filingFrom === 'string' ? descriptor.filingFrom : '';
    const filingTo = typeof descriptor.filingTo === 'string' ? descriptor.filingTo : '';
    const filingCount = descriptor.filingCount;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name) || name.includes('..')) {
      throw new Error(`archive descriptor ${index} has an unsafe or missing name`);
    }
    if (!isValidEdgarDate(filingFrom) || !isValidEdgarDate(filingTo) || filingFrom > filingTo) {
      throw new Error(`archive descriptor ${name} has an invalid filing range`);
    }
    if (typeof filingCount !== 'number' || !Number.isSafeInteger(filingCount) || filingCount < 0) {
      throw new Error(`archive descriptor ${name} has an invalid filingCount`);
    }
    if (seen.has(name)) throw new Error(`archive descriptor ${name} is duplicated`);
    seen.add(name);
    if (filingTo >= floor) required.push({
      name,
      filingFrom,
      filingTo,
      filingCount,
    });
  }

  return required.sort((left, right) => left.name.localeCompare(right.name));
}

function parseMainSubmissions(payload: unknown, cik: number, floor: string): ParsedMainSubmissions {
  if (!payload || typeof payload !== 'object') throw new Error(`main submissions for CIK ${cik} is not an object`);
  const main = payload as {
    cik?: unknown;
    name?: unknown;
    filings?: { recent?: unknown; files?: unknown };
  };
  const returnedCik = typeof main.cik === 'string' || typeof main.cik === 'number'
    ? Number(main.cik)
    : NaN;
  if (!Number.isSafeInteger(returnedCik) || returnedCik !== cik) {
    throw new Error(`main submissions returned CIK ${String(main.cik ?? 'missing')}, expected ${cik}`);
  }
  const companyName = typeof main.name === 'string' ? main.name.trim() : '';
  if (!companyName) throw new Error(`main submissions for CIK ${cik} has no company name`);
  if (!main.filings || typeof main.filings !== 'object') {
    throw new Error(`main submissions for CIK ${cik} has no filings object`);
  }

  return {
    companyName,
    recent: parseSubmissionArrays(main.filings.recent, `CIK ${cik} recent`),
    requiredArchives: parseArchiveDescriptors(main.filings.files, floor),
  };
}

function mergeFilingRecords(
  cik: number,
  companyName: string,
  floor: string,
  groups: FilingRecord[][],
): FilingRow[] {
  const byAccession = new Map<string, FilingRecord>();
  for (const record of groups.flat()) {
    const existing = byAccession.get(record.accession);
    if (existing) {
      if (existing.form !== record.form || existing.dateFiled !== record.dateFiled) {
        throw new Error(
          `conflicting duplicate accession ${record.accession}: ${existing.form} ${existing.dateFiled} vs ${record.form} ${record.dateFiled}`,
        );
      }
      continue;
    }
    byAccession.set(record.accession, record);
  }

  return Array.from(byAccession.values())
    .filter(record => record.dateFiled >= floor && shouldIngestTargetedCikForm(record.form))
    .map(record => {
      const rootForm = record.form.replace(/\/A$/, '');
      return {
        accession: record.accession,
        cik,
        company_name: companyName,
        form: record.form,
        root_form: rootForm,
        is_amendment: rootForm !== record.form,
        date_filed: record.dateFiled,
        filename: `edgar/data/${cik}/${record.accession}.txt`,
      };
    })
    .sort((left, right) => (
      right.date_filed.localeCompare(left.date_filed)
      || left.accession.localeCompare(right.accession)
    ));
}

function mainSubmissionsUrl(cik: number): string {
  return `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
}

function archiveSubmissionsUrl(name: string): string {
  return `https://data.sec.gov/submissions/${encodeURIComponent(name)}`;
}

/**
 * Load a complete post-floor issuer slice. Every overlapping archive is
 * mandatory: a failed fetch or invalid shape rejects the whole ingest rather
 * than silently writing a partial history.
 */
export async function loadTargetedFilingRows(
  cik: number,
  floor: string,
  fetchJson: SubmissionJsonFetcher,
): Promise<FilingRow[]> {
  if (!Number.isSafeInteger(cik) || cik <= 0 || cik > 9_999_999_999) {
    throw new Error(`invalid CIK ${cik}`);
  }
  if (!isValidEdgarDate(floor)) throw new Error(`invalid floor date ${floor}`);

  const main = parseMainSubmissions(await fetchJson(mainSubmissionsUrl(cik)), cik, floor);
  const groups: FilingRecord[][] = [main.recent];
  for (const archive of main.requiredArchives) {
    const payload = await fetchJson(archiveSubmissionsUrl(archive.name));
    // Archive files are arrays at the document root, unlike main.recent.
    const records = parseSubmissionArrays(payload, `CIK ${cik} archive ${archive.name}`);
    if (records.length !== archive.filingCount) {
      throw new Error(
        `CIK ${cik} archive ${archive.name} returned ${records.length}/${archive.filingCount} declared filings`,
      );
    }
    groups.push(records);
  }
  return mergeFilingRecords(cik, main.companyName, floor, groups);
}

let lastSecRequestAt = 0;

async function waitForSecSlot(): Promise<void> {
  const remaining = lastSecRequestAt + SEC_REQUEST_INTERVAL_MS - Date.now();
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  lastSecRequestAt = Date.now();
}

async function fetchSecJson(url: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForSecSlot();
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response.json();
      lastError = new Error(`${url} returned HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw lastError || new Error(`${url} could not be fetched`);
}

function parseCiks(value: string): number[] {
  const tokens = value.split(',').map(token => token.trim());
  if (tokens.length === 0 || tokens.some(token => !/^\d{1,10}$/.test(token))) {
    throw new Error('--ciks must be a comma-separated list of positive numeric CIKs');
  }
  const ciks = tokens.map(Number);
  if (ciks.some(cik => !Number.isSafeInteger(cik) || cik <= 0 || cik > 9_999_999_999)) {
    throw new Error('--ciks contains an out-of-range CIK');
  }
  return Array.from(new Set(ciks));
}

async function main() {
  const ciksArg = getArg('ciks');
  if (!ciksArg) {
    throw new Error('Usage: tsx scripts/ingest-cik-filings.ts --ciks <cik,cik,...> [--floor YYYY-MM-DD] [--dry]');
  }
  const floor = getArg('floor') || '2010-01-01';
  if (!isValidEdgarDate(floor)) throw new Error(`--floor must be a real YYYY-MM-DD date; received ${floor}`);
  const dryRun = process.argv.includes('--dry');
  const ciks = parseCiks(ciksArg);

  const client = dryRun ? null : createServiceClient();
  let total = 0;

  for (const cik of ciks) {
    const rows = await loadTargetedFilingRows(cik, floor, fetchSecJson);
    const companyName = rows[0]?.company_name || 'no eligible filings';
    console.log(`CIK ${cik} (${companyName}): ${rows.length} filings since ${floor}`);
    if (!dryRun && rows.length > 0) {
      await chunkedUpsert(
        client!,
        'urc_sec_filings',
        rows as unknown as Record<string, unknown>[],
        'accession,cik',
        500,
        () => {},
      );
    }
    total += rows.length;
  }

  console.log(`Done. ${total} rows ${dryRun ? 'inspected (dry run)' : 'upserted to urc_sec_filings'}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Targeted ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
