/**
 * SEC EDGAR Filing Ingestion Pipeline (resilient, unattended)
 *
 * Downloads filings from SEC EDGAR, extracts text and metadata, and indexes
 * them into Elasticsearch. Designed to run unattended for hours.
 *
 * Features:
 *   - Retries on all transient failures (network, rate limits, timeouts)
 *   - Saves progress to disk so it can resume after crashes
 *   - Caps memory usage by limiting the submissions cache
 *   - Logs progress every batch so you can monitor via tail -f
 *
 * Usage:
 *   # Full backfill (last 5 years) — use --expose-gc for inter-quarter memory cleanup
 *   node --expose-gc --max-old-space-size=2048 ./node_modules/.bin/tsx elasticsearch/ingest.ts
 *
 *   # Or simpler (works fine for most quarters, may OOM on Q2 2021-size quarters):
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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── CLI argument parsing ──

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const DRY_RUN = args.includes('--dry-run');
const ALL_FORMS = args.includes('--all-forms');
const SINCE_DAYS = getArg('since') ? Number(getArg('since')) : undefined;
const FROM_DATE = getArg('from');
const TO_DATE = getArg('to');
const BATCH_SIZE = Number(getArg('batch') || '200');
const MAX_CONTENT_LENGTH = 500_000;
const MAX_RETRIES = 3;
const MAX_CACHE_SIZE = 1500; // Reduced from 5000 — each entry was ~500KB, causing OOM on large quarters
const PROGRESS_FILE = resolve(import.meta.dirname || '.', '.ingest-progress.json');

// Core forms that matter for research searches (~20% of total volume, 95% of search value)
const CORE_FORMS = new Set([
  '10-K', '10-K/A', '10-KT',
  '10-Q', '10-Q/A',
  '8-K', '8-K/A',
  'DEF 14A', 'DEFA14A', 'DFAN14A', 'PRE 14A', 'PRER14A',
  'S-1', 'S-1/A', 'S-3', 'S-3/A', 'S-4', 'S-4/A',
  '20-F', '20-F/A', '6-K', '6-K/A',
  'CORRESP', 'UPLOAD',
  'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A',
  'SC TO-T', 'SC TO-T/A', 'SC 14D9', 'SC 14D9/A',
  // 'D', 'D/A', // Exempt offerings — high volume, rarely full-text searched
  '424B4',
  'N-CSR', 'N-CSRS',
  '11-K',
  'SD',
]);

// ── Date range ──

function computeDateRange(): { startDate: string; endDate: string } {
  const endDate = TO_DATE || new Date().toISOString().split('T')[0];
  if (FROM_DATE) return { startDate: FROM_DATE, endDate };
  if (SINCE_DAYS) {
    const start = new Date();
    start.setDate(start.getDate() - SINCE_DAYS);
    return { startDate: start.toISOString().split('T')[0], endDate };
  }
  const start = new Date();
  start.setFullYear(start.getFullYear() - 5);
  return { startDate: start.toISOString().split('T')[0], endDate };
}

// ── Progress persistence (resume after crash) ──

interface ProgressFile {
  startDate: string;
  endDate: string;
  lastQuarter: string;
  lastEntryIndex: number;
  totalIndexed: number;
}

function loadProgress(startDate: string, endDate: string): ProgressFile | null {
  try {
    if (!existsSync(PROGRESS_FILE)) return null;
    const data = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8')) as ProgressFile;
    if (data.startDate === startDate && data.endDate === endDate) return data;
    return null; // Different run — start fresh
  } catch {
    return null;
  }
}

function saveProgress(progress: ProgressFile): void {
  try {
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch {
    // Non-critical — don't crash over progress file
  }
}

function clearProgress(): void {
  try {
    if (existsSync(PROGRESS_FILE)) writeFileSync(PROGRESS_FILE, '');
  } catch { /* ignore */ }
}

// ── Fetch with retries ──

const baseHeaders = {
  'User-Agent': SEC_USER_AGENT,
  'Accept-Encoding': 'gzip, deflate',
  Accept: 'application/json,text/html,*/*',
};

async function fetchWithRetry(
  url: string,
  timeoutMs = 20_000,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: baseHeaders,
          signal: controller.signal,
        });

        if (response.ok || response.status === 404) return response;

        // Rate limited or server error — retry after backoff
        if (response.status === 429 || response.status === 403 || response.status >= 500) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10_000);
          console.log(`    Rate limited (${response.status}), waiting ${backoff}ms...`);
          await delay(backoff);
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }

        return response; // Other errors — don't retry
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === 'AbortError') {
        console.log(`    Timeout fetching ${url.slice(0, 80)}..., attempt ${attempt + 1}/${retries}`);
      }
      const backoff = Math.min(1000 * Math.pow(2, attempt), 8_000);
      await delay(backoff);
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const response = await fetchWithRetry(url, timeoutMs);
  if (response.status === 404) return '';
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// ── HTML → plaintext ──

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, ' ')
    .replace(/<xbrli:context[\s\S]*?<\/xbrli:context>/gi, ' ')
    .replace(/<xbrli:unit[\s\S]*?<\/xbrli:unit>/gi, ' ')
    .replace(/<\/?(p|div|br|hr|h[1-6]|tr|li|table|section|article|header|footer|blockquote|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ').replace(/&\w+;/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Auditor detection ──

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
  if (text.length > 80000) {
    const tail = text.slice(-40000);
    for (const { label, re } of AUDITOR_PATTERNS) {
      if (re.test(tail)) return label;
    }
  }
  return '';
}

// ── Accelerated filer detection ──

const FILER_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'Large Accelerated Filer', re: /large accelerated filer/i },
  { label: 'Accelerated Filer', re: /accelerated filer/i },
  { label: 'Non-Accelerated Filer', re: /non-accelerated filer/i },
  { label: 'Smaller Reporting Company', re: /smaller reporting company/i },
  { label: 'Emerging Growth Company', re: /emerging growth company/i },
];

function detectAcceleratedStatus(text: string): string[] {
  const sample = text.slice(0, 12000);
  return FILER_PATTERNS.filter(p => p.re.test(sample)).map(p => p.label);
}

// ── EDGAR full-index fetching ──

interface EdgarIndexEntry {
  cik: string;
  companyName: string;
  formType: string;
  dateFiled: string;
  filename: string;
  accessionNumber: string;
}

async function fetchFullIndex(year: number, quarter: number): Promise<EdgarIndexEntry[]> {
  const url = `${EDGAR_BASE}/Archives/edgar/full-index/${year}/QTR${quarter}/company.idx`;
  console.log(`  Fetching index: ${year}/QTR${quarter}...`);

  let text: string;
  try {
    text = await fetchText(url, 90_000); // Large file
  } catch {
    console.log(`  Index ${year}/QTR${quarter} not available, skipping.`);
    return [];
  }

  if (!text.trim()) return [];

  const lines = text.split('\n');
  const entries: EdgarIndexEntry[] = [];
  const dataLineRe = /^(.+?)\s{2,}(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(edgar\/data\/\S+)\s*$/;

  let headerDone = false;
  for (const line of lines) {
    if (!headerDone) {
      if (line.startsWith('---')) headerDone = true;
      continue;
    }

    const match = dataLineRe.exec(line);
    if (!match) continue;

    const accMatch = match[5].match(/(\d{10}-\d{2}-\d{6})/);
    if (!accMatch) continue;

    entries.push({
      cik: match[3].trim().replace(/^0+/, ''),
      companyName: match[1].trim(),
      formType: match[2].trim(),
      dateFiled: match[4].trim(),
      filename: match[5].trim(),
      accessionNumber: accMatch[1],
    });
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
    if (quarter > 4) { quarter = 1; year++; }
  }
  return quarters;
}

// ── Company submissions (with bounded cache, slimmed to save memory) ──

/** Full SEC response — only used transiently before slimming */
interface RawCompanySubmissions {
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

/** Slimmed version we actually cache — drops huge filing arrays, keeps only metadata + a Map for fast lookup */
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
  bizCity: string;
  bizState: string;
  /** Map<accessionNumber, { primaryDocument, primaryDocDescription, fileNumber }> */
  filingIndex: Map<string, { primaryDocument: string; primaryDocDescription: string; fileNumber: string }>;
}

/** Slim the raw SEC response down to only what we need for indexing */
function slimSubmissions(raw: RawCompanySubmissions): CompanySubmissions {
  const recent = raw.filings.recent;
  const filingIndex = new Map<string, { primaryDocument: string; primaryDocDescription: string; fileNumber: string }>();
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    filingIndex.set(recent.accessionNumber[i], {
      primaryDocument: recent.primaryDocument[i] || '',
      primaryDocDescription: recent.primaryDocDescription[i] || '',
      fileNumber: recent.fileNumber[i] || '',
    });
  }
  const biz = raw.addresses?.business;
  return {
    cik: raw.cik,
    name: raw.name,
    tickers: raw.tickers || [],
    exchanges: raw.exchanges || [],
    sic: raw.sic,
    sicDescription: raw.sicDescription || '',
    stateOfIncorporation: raw.stateOfIncorporation || '',
    stateOfIncorporationDescription: raw.stateOfIncorporationDescription || '',
    fiscalYearEnd: raw.fiscalYearEnd || '',
    bizCity: biz?.city || '',
    bizState: biz?.stateOrCountryDescription || biz?.stateOrCountry || '',
    filingIndex,
  };
}

const submissionsCache = new Map<string, CompanySubmissions | null>();

function evictCacheIfNeeded(): void {
  if (submissionsCache.size > MAX_CACHE_SIZE) {
    // Evict oldest half
    const keysToDelete = Array.from(submissionsCache.keys()).slice(0, MAX_CACHE_SIZE / 2);
    for (const key of keysToDelete) submissionsCache.delete(key);
    console.log(`    Cache evicted ${keysToDelete.length} entries (${submissionsCache.size} remaining)`);
  }
}

async function fetchCompanySubmissions(cik: string): Promise<CompanySubmissions | null> {
  const paddedCik = cik.padStart(10, '0');
  if (submissionsCache.has(paddedCik)) return submissionsCache.get(paddedCik)!;
  evictCacheIfNeeded();

  try {
    const raw = await fetchJson(`${EDGAR_DATA_BASE}/submissions/CIK${paddedCik}.json`) as RawCompanySubmissions;
    const slim = slimSubmissions(raw);
    submissionsCache.set(paddedCik, slim);
    return slim;
  } catch {
    submissionsCache.set(paddedCik, null);
    return null;
  }
}

// ── Filing document fetch ──

async function fetchFilingDocument(cik: string, accessionNumber: string, primaryDocument: string): Promise<string> {
  const cleanAccession = accessionNumber.replace(/-/g, '');
  const url = `${EDGAR_BASE}/Archives/edgar/data/${cik}/${cleanAccession}/${primaryDocument}`;
  try {
    return await fetchText(url, 30_000);
  } catch {
    return '';
  }
}

// ── Build ES document ──

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
  const submissions = await fetchCompanySubmissions(entry.cik);
  if (!submissions) return null;

  const filingInfo = submissions.filingIndex.get(entry.accessionNumber);
  const primaryDocument = filingInfo?.primaryDocument || '';
  const fileNumber = filingInfo?.fileNumber || '';
  const primaryDocDescription = filingInfo?.primaryDocDescription || '';

  if (!primaryDocument) return null;

  const html = await fetchFilingDocument(entry.cik, entry.accessionNumber, primaryDocument);
  if (!html) return null;

  let content = stripHtmlToText(html);
  if (content.length > MAX_CONTENT_LENGTH) content = content.slice(0, MAX_CONTENT_LENGTH);

  const auditor = detectAuditor(content);
  const acceleratedStatus = detectAcceleratedStatus(content);

  const bizLocation = [submissions.bizCity, submissions.bizState]
    .filter(Boolean).join(', ');

  const paddedCik = entry.cik.padStart(10, '0');
  const baseForm = entry.formType.replace(/\/A$/, '');

  return {
    _id: `${paddedCik}:${entry.accessionNumber}:${primaryDocument.replace(/\//g, '_')}`,
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

// ── Bulk indexing with retry ──

async function bulkIndex(client: Client, documents: FilingDocument[]): Promise<{ indexed: number; errors: number }> {
  if (documents.length === 0) return { indexed: 0, errors: 0 };

  const operations = documents.flatMap(doc => {
    const { _id, ...body } = doc;
    return [{ index: { _index: ES_INDEX, _id } }, body];
  });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await client.bulk({ operations, refresh: false });

      let errors = 0;
      if (result.errors) {
        for (const item of result.items) {
          if (item.index?.error) {
            errors++;
            if (errors <= 3) console.error(`  Index error: ${item.index.error.reason}`);
          }
        }
      }
      return { indexed: documents.length - errors, errors };
    } catch (error) {
      console.error(`  Bulk index attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error instanceof Error ? error.message : error);
      if (attempt + 1 < MAX_RETRIES) {
        await delay(2000 * Math.pow(2, attempt));
      }
    }
  }

  return { indexed: 0, errors: documents.length };
}

// ── Progress display ──

interface ProgressState {
  totalProcessed: number;
  totalIndexed: number;
  totalErrors: number;
  totalSkipped: number;
  startTime: number;
}

function printProgress(state: ProgressState, currentQuarter: string, totalInQuarter: number) {
  const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(0);
  const rate = state.totalProcessed > 0 ? (state.totalProcessed / (Date.now() - state.startTime) * 1000).toFixed(1) : '0';
  const eta = state.totalProcessed > 0
    ? ((totalInQuarter - state.totalProcessed) / (state.totalProcessed / (Date.now() - state.startTime) * 1000) / 60).toFixed(0)
    : '?';
  console.log(
    `  [${currentQuarter}] ${state.totalProcessed}/${totalInQuarter} | Indexed: ${state.totalIndexed} | Skipped: ${state.totalSkipped} | Errors: ${state.totalErrors} | ${elapsed}s (${rate}/sec, ~${eta}min left)`
  );
}

// ── Main ──

async function main() {
  const { startDate, endDate } = computeDateRange();
  console.log(`\nSEC EDGAR Filing Ingestion Pipeline`);
  console.log(`===================================`);
  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log(`Index: ${ES_INDEX}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Form filter: ${ALL_FORMS ? 'ALL forms' : 'Core forms only (use --all-forms to index everything)'}`);
  console.log(`Progress file: ${PROGRESS_FILE}`);
  console.log();

  const client = DRY_RUN ? null : createElasticClient();

  if (client) {
    const exists = await client.indices.exists({ index: ES_INDEX });
    if (!exists) {
      console.error(`Index "${ES_INDEX}" does not exist. Run: npx tsx elasticsearch/setup.ts`);
      process.exit(1);
    }
  }

  const quarters = getQuartersInRange(startDate, endDate);
  console.log(`Quarters to process: ${quarters.map(q => `${q.year}/Q${q.quarter}`).join(', ')}`);

  // Check for saved progress
  const savedProgress = loadProgress(startDate, endDate);
  if (savedProgress) {
    console.log(`\nResuming from ${savedProgress.lastQuarter} entry ${savedProgress.lastEntryIndex} (${savedProgress.totalIndexed} already indexed)`);
  }
  console.log();

  const state: ProgressState = {
    totalProcessed: 0,
    totalIndexed: savedProgress?.totalIndexed || 0,
    totalErrors: 0,
    totalSkipped: 0,
    startTime: Date.now(),
  };

  for (const { year, quarter } of quarters) {
    const quarterLabel = `${year}/Q${quarter}`;

    // Skip quarters we've already completed
    if (savedProgress && savedProgress.lastQuarter > quarterLabel) {
      console.log(`  ${quarterLabel}: already completed, skipping.`);
      continue;
    }

    let entries: EdgarIndexEntry[];
    try {
      entries = await fetchFullIndex(year, quarter);
    } catch (error) {
      console.error(`  Failed to fetch index for ${quarterLabel}:`, error);
      continue;
    }

    const totalBeforeFilter = entries.length;
    entries = entries.filter(e => e.dateFiled >= startDate && e.dateFiled <= endDate);
    if (!ALL_FORMS) {
      entries = entries.filter(e => CORE_FORMS.has(e.formType));
    }
    console.log(`  ${quarterLabel}: ${entries.length} filings to index${!ALL_FORMS ? ` (filtered from ${totalBeforeFilter} total)` : ''}`);

    if (DRY_RUN) {
      const formCounts: Record<string, number> = {};
      for (const e of entries) formCounts[e.formType] = (formCounts[e.formType] || 0) + 1;
      console.log(`  Form breakdown:`, JSON.stringify(formCounts));
      state.totalProcessed += entries.length;
      continue;
    }

    // Resume within a quarter if we have saved progress
    const startIndex =
      savedProgress && savedProgress.lastQuarter === quarterLabel
        ? savedProgress.lastEntryIndex
        : 0;

    if (startIndex > 0) {
      console.log(`  Resuming from entry ${startIndex}/${entries.length}`);
      state.totalProcessed += startIndex;
    }

    const batch: FilingDocument[] = [];

    for (let i = startIndex; i < entries.length; i++) {
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
        // Individual filing failures are expected — don't crash
      }

      // SEC rate limit (~10 req/sec, but each filing = 2 requests)
      await delay(150);

      // Bulk index when batch is full
      if (batch.length >= BATCH_SIZE) {
        const result = await bulkIndex(client!, batch);
        state.totalIndexed += result.indexed;
        state.totalErrors += result.errors;
        batch.length = 0;
        printProgress(state, quarterLabel, entries.length);

        // Save progress after each batch
        saveProgress({
          startDate,
          endDate,
          lastQuarter: quarterLabel,
          lastEntryIndex: i + 1,
          totalIndexed: state.totalIndexed,
        });
      }
    }

    // Index remaining batch
    if (batch.length > 0 && client) {
      const result = await bulkIndex(client, batch);
      state.totalIndexed += result.indexed;
      state.totalErrors += result.errors;
      batch.length = 0;
    }

    printProgress(state, quarterLabel, entries.length);

    // Save progress for this completed quarter
    saveProgress({
      startDate,
      endDate,
      lastQuarter: quarterLabel,
      lastEntryIndex: entries.length,
      totalIndexed: state.totalIndexed,
    });

    // Free the entries array for GC (can be 50k+ objects for large quarters)
    entries.length = 0;

    // Periodic refresh every quarter
    if (client) {
      try { await client.indices.refresh({ index: ES_INDEX }); } catch { /* non-critical */ }
    }

    // Clear half the submissions cache between quarters to keep memory in check
    if (submissionsCache.size > MAX_CACHE_SIZE / 2) {
      const before = submissionsCache.size;
      const keysToDelete = Array.from(submissionsCache.keys()).slice(0, Math.floor(before * 0.6));
      for (const key of keysToDelete) submissionsCache.delete(key);
      console.log(`  Inter-quarter cache cleanup: ${before} → ${submissionsCache.size} entries`);
    }

    // Hint GC to reclaim memory between quarters
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
      console.log('  Forced GC between quarters');
    }

    await delay(2000); // Pause between quarters
  }

  // Final refresh
  if (client) {
    console.log('\nRefreshing index...');
    try { await client.indices.refresh({ index: ES_INDEX }); } catch { /* non-critical */ }
  }

  clearProgress(); // Clean up progress file on successful completion

  const elapsed = ((Date.now() - state.startTime) / 1000 / 60).toFixed(1);
  console.log(`\nIngestion complete in ${elapsed} minutes.`);
  console.log(`  Total processed: ${state.totalProcessed}`);
  console.log(`  Total indexed:   ${state.totalIndexed}`);
  console.log(`  Total skipped:   ${state.totalSkipped}`);
  console.log(`  Total errors:    ${state.totalErrors}`);
}

main().catch(error => {
  console.error('\nIngestion failed:', error.message || error);
  console.error('Progress has been saved. Re-run the same command to resume.');
  process.exit(1);
});
