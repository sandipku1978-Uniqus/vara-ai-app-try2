/**
 * SEC EDGAR Filing Ingestion Pipeline
 *
 * Downloads filings from SEC EDGAR, extracts text and metadata, and indexes
 * them into Elasticsearch. Supports both full backfill and incremental updates.
 *
 * Usage:
 *   # Full backfill (last 5 years, all form types)
 *   npx tsx elasticsearch/ingest.ts
 *
 *   # Incremental update (last 7 days)
 *   npx tsx elasticsearch/ingest.ts --since 7
 *
 *   # Specific date range
 *   npx tsx elasticsearch/ingest.ts --from 2024-01-01 --to 2024-06-30
 *
 *   # Dry run (show what would be indexed)
 *   npx tsx elasticsearch/ingest.ts --dry-run --since 30
 *
 * Requires: ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY env vars.
 *           EDGAR_USER_AGENT or VITE_EDGAR_USER_AGENT for SEC compliance.
 */

import { createElasticClient, ES_INDEX, delay, SEC_USER_AGENT, EDGAR_BASE, EDGAR_DATA_BASE } from './config.js';
import type { Client } from '@elastic/elasticsearch';

// ── CLI argument parsing ──

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const DRY_RUN = args.includes('--dry-run');
const SINCE_DAYS = getArg('since') ? Number(getArg('since')) : undefined;
const FROM_DATE = getArg('from');
const TO_DATE = getArg('to');
const BATCH_SIZE = Number(getArg('batch') || '500');
const MAX_CONTENT_LENGTH = 500_000; // Cap filing text at 500KB to keep index reasonable

// ── Date range ──

function computeDateRange(): { startDate: string; endDate: string } {
  const endDate = TO_DATE || new Date().toISOString().split('T')[0];

  if (FROM_DATE) {
    return { startDate: FROM_DATE, endDate };
  }

  if (SINCE_DAYS) {
    const start = new Date();
    start.setDate(start.getDate() - SINCE_DAYS);
    return { startDate: start.toISOString().split('T')[0], endDate };
  }

  // Default: last 5 years
  const start = new Date();
  start.setFullYear(start.getFullYear() - 5);
  return { startDate: start.toISOString().split('T')[0], endDate };
}

// ── SEC EDGAR helpers ──

const headers = {
  'User-Agent': SEC_USER_AGENT,
  'Accept-Encoding': 'gzip, deflate',
  Accept: 'application/json,text/html,*/*',
};

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    if (response.status === 404) return '';
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.text();
}

// ── HTML → plaintext (Node.js version, no DOM needed) ──

function stripHtmlToText(html: string): string {
  return html
    // Remove script/style/noscript blocks
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    // Remove XBRL/iXBRL metadata blocks
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, ' ')
    .replace(/<xbrli:context[\s\S]*?<\/xbrli:context>/gi, ' ')
    .replace(/<xbrli:unit[\s\S]*?<\/xbrli:unit>/gi, ' ')
    // Convert block elements to newlines
    .replace(/<\/?(p|div|br|hr|h[1-6]|tr|li|table|section|article|header|footer|blockquote|pre)[^>]*>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&\w+;/g, ' ')
    // Normalize whitespace
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Auditor detection (mirrors src/services/auditors.ts patterns) ──

const AUDITOR_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'Deloitte', re: /\bdeloitte(?:\s*&\s*touche)?(?:\s+llp)?\b/i },
  { label: 'PwC', re: /\bpricewaterhousecoopers(?:\s+llp)?\b/i },
  { label: 'PwC', re: /\bpwc\b/i },
  { label: 'EY', re: /\bernst\s*(?:&|and)\s*young(?:\s+llp)?\b/i },
  { label: 'EY', re: /\bey(?:\s+llp)?\b/i },
  { label: 'KPMG', re: /\bkpmg(?:\s+llp)?\b/i },
  { label: 'BDO', re: /\bbdo(?:\s+usa)?(?:\s+llp)?\b/i },
  { label: 'Grant Thornton', re: /\bgrant\s+thornton(?:\s+llp)?\b/i },
  { label: 'RSM', re: /\brsm(?:\s+us)?(?:\s+llp)?\b/i },
  { label: 'Crowe', re: /\bcrowe(?:\s+llp)?\b/i },
  { label: 'Baker Tilly', re: /\bbaker\s+tilly(?:\s+us)?(?:\s+llp)?\b/i },
  { label: 'Moss Adams', re: /\bmoss\s+adams(?:\s+llp)?\b/i },
  { label: 'Marcum', re: /\bmarcum(?:\s+llp)?\b/i },
  { label: 'Marcum', re: /\bcbiz\s+marcum\b/i },
];

function detectAuditor(text: string): string {
  const sample = text.slice(0, 60000);
  for (const { label, re } of AUDITOR_PATTERNS) {
    if (re.test(sample)) return label;
  }
  // Check tail for auditor report
  if (text.length > 80000) {
    const tail = text.slice(-40000);
    for (const { label, re } of AUDITOR_PATTERNS) {
      if (re.test(tail)) return label;
    }
  }
  return '';
}

// ── Accelerated filer detection (mirrors filingResearch.ts) ──

const FILER_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'Large Accelerated Filer', re: /large accelerated filer/i },
  { label: 'Accelerated Filer', re: /accelerated filer/i },
  { label: 'Non-Accelerated Filer', re: /non-accelerated filer/i },
  { label: 'Smaller Reporting Company', re: /smaller reporting company/i },
  { label: 'Emerging Growth Company', re: /emerging growth company/i },
];

function detectAcceleratedStatus(text: string): string[] {
  const sample = text.slice(0, 12000);
  return FILER_PATTERNS
    .filter(p => p.re.test(sample))
    .map(p => p.label);
}

// ── EDGAR full-index fetching ──

interface EdgarIndexEntry {
  cik: string;
  companyName: string;
  formType: string;
  dateFiled: string;
  filename: string; // e.g. "edgar/data/320193/0000320193-24-000006.txt"
  accessionNumber: string;
}

async function fetchFullIndex(year: number, quarter: number): Promise<EdgarIndexEntry[]> {
  const url = `${EDGAR_BASE}/Archives/edgar/full-index/${year}/QTR${quarter}/company.idx`;
  console.log(`  Fetching index: ${year}/QTR${quarter}...`);

  let text: string;
  try {
    text = await fetchText(url);
  } catch {
    console.log(`  Index ${year}/QTR${quarter} not available, skipping.`);
    return [];
  }

  if (!text.trim()) return [];

  const lines = text.split('\n');
  const entries: EdgarIndexEntry[] = [];

  // company.idx format: Company Name | Form Type | CIK | Date Filed | Filename
  // Header lines start with "Company Name" or contain dashes
  let headerDone = false;
  for (const line of lines) {
    if (!headerDone) {
      if (line.startsWith('---')) {
        headerDone = true;
      }
      continue;
    }

    // Fixed-width format — parse by position
    const companyName = line.slice(0, 62).trim();
    const formType = line.slice(62, 74).trim();
    const cik = line.slice(74, 86).trim();
    const dateFiled = line.slice(86, 98).trim();
    const filename = line.slice(98).trim();

    if (!cik || !formType || !dateFiled || !filename) continue;

    // Extract accession number from filename
    const accMatch = filename.match(/(\d{10}-\d{2}-\d{6})/);
    const accessionNumber = accMatch ? accMatch[1] : '';

    if (accessionNumber) {
      entries.push({
        cik: cik.replace(/^0+/, ''),
        companyName,
        formType,
        dateFiled,
        filename,
        accessionNumber,
      });
    }
  }

  return entries;
}

function getQuartersInRange(startDate: string, endDate: string): Array<{ year: number; quarter: number }> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const quarters: Array<{ year: number; quarter: number }> = [];

  let year = start.getFullYear();
  let quarter = Math.ceil((start.getMonth() + 1) / 3);

  while (year < end.getFullYear() || (year === end.getFullYear() && quarter <= Math.ceil((end.getMonth() + 1) / 3))) {
    quarters.push({ year, quarter });
    quarter++;
    if (quarter > 4) {
      quarter = 1;
      year++;
    }
  }

  return quarters;
}

// ── Fetch filing primary document ──

interface CompanySubmissions {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string;
  sicDescription: string;
  stateOfIncorporation: string;
  stateOfIncorporationDescription: string;
  fiscalYearEnd: string;
  addresses?: { business?: { city?: string; stateOrCountry?: string; stateOrCountryDescription?: string } };
  filings: {
    recent: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
      fileNumber: string[];
    };
  };
}

const submissionsCache = new Map<string, CompanySubmissions | null>();

async function fetchCompanySubmissions(cik: string): Promise<CompanySubmissions | null> {
  const paddedCik = cik.padStart(10, '0');
  if (submissionsCache.has(paddedCik)) return submissionsCache.get(paddedCik)!;

  try {
    const data = await fetchJson(`${EDGAR_DATA_BASE}/submissions/CIK${paddedCik}.json`) as CompanySubmissions;
    submissionsCache.set(paddedCik, data);
    return data;
  } catch {
    submissionsCache.set(paddedCik, null);
    return null;
  }
}

async function fetchFilingDocument(cik: string, accessionNumber: string, primaryDocument: string): Promise<string> {
  const cleanAccession = accessionNumber.replace(/-/g, '');
  const url = `${EDGAR_BASE}/Archives/edgar/data/${cik}/${cleanAccession}/${primaryDocument}`;
  try {
    return await fetchText(url);
  } catch {
    return '';
  }
}

// ── Build ES document from filing ──

interface FilingDocument {
  _id: string;
  cik: string;
  ciks: string[];
  entity_name: string;
  display_names: string[];
  tickers: string[];
  form: string;
  root_forms: string[];
  file_type: string;
  file_date: string;
  file_description: string;
  adsh: string;
  file_num: string;
  primary_document: string;
  sics: string[];
  sic_description: string;
  inc_states: string[];
  biz_locations: string[];
  exchange: string;
  state_of_incorporation: string;
  fiscal_year_end: string;
  auditor: string;
  accelerated_status: string[];
  content: string;
  indexed_at: string;
}

async function buildFilingDocument(entry: EdgarIndexEntry): Promise<FilingDocument | null> {
  // Fetch company metadata
  const submissions = await fetchCompanySubmissions(entry.cik);
  if (!submissions) return null;

  // Find the primary document for this accession
  const recent = submissions.filings.recent;
  const accIndex = recent.accessionNumber.findIndex(a => a === entry.accessionNumber);
  const primaryDocument = accIndex >= 0
    ? recent.primaryDocument[accIndex]
    : '';
  const fileNumber = accIndex >= 0
    ? recent.fileNumber[accIndex]
    : '';
  const primaryDocDescription = accIndex >= 0
    ? recent.primaryDocDescription[accIndex]
    : '';

  if (!primaryDocument) return null;

  // Fetch and parse filing text
  const html = await fetchFilingDocument(entry.cik, entry.accessionNumber, primaryDocument);
  if (!html) return null;

  let content = stripHtmlToText(html);
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH);
  }

  // Extract signals from text
  const auditor = detectAuditor(content);
  const acceleratedStatus = detectAcceleratedStatus(content);

  // Build business address
  const biz = submissions.addresses?.business;
  const bizLocation = [biz?.city, biz?.stateOrCountryDescription || biz?.stateOrCountry]
    .filter(Boolean)
    .join(', ');

  const paddedCik = entry.cik.padStart(10, '0');
  const baseForm = entry.formType.replace(/\/A$/, '');

  return {
    _id: `${paddedCik}:${entry.accessionNumber}:${primaryDocument}`,
    cik: entry.cik,
    ciks: [paddedCik],
    entity_name: submissions.name || entry.companyName,
    display_names: [`${submissions.name || entry.companyName} (CIK ${paddedCik})`],
    tickers: submissions.tickers || [],
    form: entry.formType,
    root_forms: baseForm !== entry.formType ? [baseForm, entry.formType] : [entry.formType],
    file_type: entry.formType,
    file_date: entry.dateFiled,
    file_description: primaryDocDescription || entry.formType,
    adsh: entry.accessionNumber,
    file_num: fileNumber,
    primary_document: primaryDocument,
    sics: submissions.sic ? [submissions.sic] : [],
    sic_description: submissions.sicDescription || '',
    inc_states: submissions.stateOfIncorporation ? [submissions.stateOfIncorporation] : [],
    biz_locations: bizLocation ? [bizLocation] : [],
    exchange: submissions.exchanges?.[0] || '',
    state_of_incorporation: submissions.stateOfIncorporationDescription || submissions.stateOfIncorporation || '',
    fiscal_year_end: submissions.fiscalYearEnd || '',
    auditor,
    accelerated_status: acceleratedStatus,
    content,
    indexed_at: new Date().toISOString(),
  };
}

// ── Bulk indexing ──

async function bulkIndex(client: Client, documents: FilingDocument[]): Promise<{ indexed: number; errors: number }> {
  if (documents.length === 0) return { indexed: 0, errors: 0 };

  const operations = documents.flatMap(doc => [
    { index: { _index: ES_INDEX, _id: doc._id } },
    doc,
  ]);

  const result = await client.bulk({ operations, refresh: false });

  let errors = 0;
  if (result.errors) {
    for (const item of result.items) {
      if (item.index?.error) {
        errors++;
        if (errors <= 3) {
          console.error(`  Index error: ${item.index.error.reason}`);
        }
      }
    }
  }

  return { indexed: documents.length - errors, errors };
}

// ── Progress tracking ──

interface ProgressState {
  totalProcessed: number;
  totalIndexed: number;
  totalErrors: number;
  totalSkipped: number;
  startTime: number;
}

function printProgress(state: ProgressState, currentQuarter: string) {
  const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(0);
  const rate = state.totalProcessed > 0 ? (state.totalProcessed / (Date.now() - state.startTime) * 1000).toFixed(1) : '0';
  console.log(
    `  [${currentQuarter}] Processed: ${state.totalProcessed} | Indexed: ${state.totalIndexed} | Skipped: ${state.totalSkipped} | Errors: ${state.totalErrors} | ${elapsed}s elapsed (${rate}/sec)`
  );
}

// ── Main ingestion loop ──

async function main() {
  const { startDate, endDate } = computeDateRange();
  console.log(`\nSEC EDGAR Filing Ingestion Pipeline`);
  console.log(`===================================`);
  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log(`Index: ${ES_INDEX}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log();

  const client = DRY_RUN ? null : createElasticClient();

  // Verify index exists
  if (client) {
    const exists = await client.indices.exists({ index: ES_INDEX });
    if (!exists) {
      console.error(`Index "${ES_INDEX}" does not exist. Run setup first:`);
      console.error(`  npx tsx elasticsearch/setup.ts`);
      process.exit(1);
    }
  }

  const quarters = getQuartersInRange(startDate, endDate);
  console.log(`Quarters to process: ${quarters.map(q => `${q.year}/Q${q.quarter}`).join(', ')}`);
  console.log();

  const state: ProgressState = {
    totalProcessed: 0,
    totalIndexed: 0,
    totalErrors: 0,
    totalSkipped: 0,
    startTime: Date.now(),
  };

  for (const { year, quarter } of quarters) {
    const quarterLabel = `${year}/Q${quarter}`;

    // Fetch the EDGAR index for this quarter
    let entries: EdgarIndexEntry[];
    try {
      entries = await fetchFullIndex(year, quarter);
    } catch (error) {
      console.error(`  Failed to fetch index for ${quarterLabel}:`, error);
      continue;
    }

    // Filter by date range
    entries = entries.filter(e => e.dateFiled >= startDate && e.dateFiled <= endDate);

    console.log(`  ${quarterLabel}: ${entries.length} filings in date range`);

    if (DRY_RUN) {
      const formCounts: Record<string, number> = {};
      for (const e of entries) {
        formCounts[e.formType] = (formCounts[e.formType] || 0) + 1;
      }
      console.log(`  Form breakdown:`, JSON.stringify(formCounts));
      state.totalProcessed += entries.length;
      continue;
    }

    // Process in batches
    const batch: FilingDocument[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      state.totalProcessed++;

      try {
        const doc = await buildFilingDocument(entry);
        if (doc) {
          batch.push(doc);
        } else {
          state.totalSkipped++;
        }
      } catch (error) {
        state.totalSkipped++;
        // Don't log every skip — too noisy
      }

      // Respect SEC rate limit (~10 req/sec)
      // Each filing requires 1-2 fetches (submissions + document)
      await delay(120);

      // Bulk index when batch is full
      if (batch.length >= BATCH_SIZE) {
        const result = await bulkIndex(client!, batch);
        state.totalIndexed += result.indexed;
        state.totalErrors += result.errors;
        batch.length = 0;
        printProgress(state, quarterLabel);
      }
    }

    // Index remaining batch
    if (batch.length > 0 && client) {
      const result = await bulkIndex(client, batch);
      state.totalIndexed += result.indexed;
      state.totalErrors += result.errors;
      batch.length = 0;
    }

    printProgress(state, quarterLabel);

    // Delay between quarters
    await delay(1000);
  }

  // Final refresh
  if (client) {
    console.log('\nRefreshing index...');
    await client.indices.refresh({ index: ES_INDEX });
  }

  const elapsed = ((Date.now() - state.startTime) / 1000 / 60).toFixed(1);
  console.log(`\nIngestion complete in ${elapsed} minutes.`);
  console.log(`  Total processed: ${state.totalProcessed}`);
  console.log(`  Total indexed:   ${state.totalIndexed}`);
  console.log(`  Total skipped:   ${state.totalSkipped}`);
  console.log(`  Total errors:    ${state.totalErrors}`);
}

main().catch(error => {
  console.error('\nIngestion failed:', error.message || error);
  process.exit(1);
});
