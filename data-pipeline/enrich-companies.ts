/**
 * Company enrichment → urc_sec_companies (SIC, tickers, exchange, state).
 *
 * Two passes:
 *   1. Bulk: EDGAR company_tickers_exchange.json — every listed issuer's
 *      cik/name/ticker/exchange in one free download.
 *   2. Incremental: EDGAR submissions JSON per CIK for SIC + state — walks
 *      issuers appearing in our filings/auditor tables that still lack SIC,
 *      most-recently-active first. Resumable; run with --limit as a budget.
 *
 * Usage:
 *   npx tsx data-pipeline/enrich-companies.ts --tickers        # bulk pass
 *   npx tsx data-pipeline/enrich-companies.ts --sic --limit 2000
 */

import { createServiceClient } from './supabase';
import { delay } from './edgar-index';

const USER_AGENT =
  process.env.EDGAR_USER_AGENT ||
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT ||
  'Uniqus Research Center contact@uniqus.com';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

export type SecJsonFailureReason =
  | 'network'
  | 'rate-limited'
  | 'server-error'
  | 'invalid-json'
  | 'http-error';

export type SecJsonResult =
  | { kind: 'success'; data: unknown; attempts: number }
  | { kind: 'not-found'; status: 404; attempts: number }
  | {
      kind: 'retry-exhausted';
      reason: SecJsonFailureReason;
      status: number | null;
      attempts: number;
    };

interface FetchSecJsonOptions {
  maxAttempts?: number;
  retryBaseMs?: number;
  validate?: (data: unknown) => boolean;
}

/**
 * Keep an authoritative SEC 404 distinct from a transport or decoding outage.
 * Callers may persist an explicit "not found" sentinel only for the former;
 * every other exhausted result must leave the database untouched and fail the
 * pipeline so the issuer remains eligible for a later retry.
 */
export async function fetchSecJson(
  url: string,
  options: FetchSecJsonOptions = {},
): Promise<SecJsonResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 1_000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(retryBaseMs) || retryBaseMs < 0) {
    throw new Error('retryBaseMs must be a non-negative number');
  }

  let lastFailure: Omit<Extract<SecJsonResult, { kind: 'retry-exhausted' }>, 'kind' | 'attempts'> = {
    reason: 'network',
    status: null,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      lastFailure = { reason: 'network', status: null };
      if (attempt < maxAttempts) await delay(retryBaseMs * 2 ** (attempt - 1));
      continue;
    }

    // A real SEC 404 is authoritative and should not be retried. It is the only
    // outcome that permits the SIC 0000 sentinel in sicPass.
    if (response.status === 404) {
      return { kind: 'not-found', status: 404, attempts: attempt };
    }

    if (!response.ok) {
      lastFailure = {
        reason: response.status === 429
          ? 'rate-limited'
          : response.status >= 500
            ? 'server-error'
            : 'http-error',
        status: response.status,
      };
      if (attempt < maxAttempts) await delay(retryBaseMs * 2 ** (attempt - 1));
      continue;
    }

    try {
      const data: unknown = await response.json();
      if (options.validate && !options.validate(data)) {
        lastFailure = { reason: 'invalid-json', status: response.status };
      } else {
        return { kind: 'success', data, attempts: attempt };
      }
    } catch {
      lastFailure = { reason: 'invalid-json', status: response.status };
    }
    if (attempt < maxAttempts) await delay(retryBaseMs * 2 ** (attempt - 1));
  }

  return { kind: 'retry-exhausted', ...lastFailure, attempts: maxAttempts };
}

interface TickerExchangePayload {
  fields: string[];
  data: Array<[number, string, string, string]>;
}

interface SubmissionsPayload {
  name: string;
  sic: string;
  sicDescription?: string;
  stateOfIncorporation?: string;
  tickers?: string[];
  exchanges?: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

const TICKER_EXCHANGE_FIELDS = ['cik', 'name', 'ticker', 'exchange'] as const;

export function isTickerExchangePayload(value: unknown): value is TickerExchangePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isStringArray(candidate.fields)
    && candidate.fields.length === TICKER_EXCHANGE_FIELDS.length
    && candidate.fields.every((field, index) => field === TICKER_EXCHANGE_FIELDS[index])
    && Array.isArray(candidate.data)
    && candidate.data.every(row => Array.isArray(row)
      && row.length === TICKER_EXCHANGE_FIELDS.length
      && Number.isSafeInteger(row[0])
      && typeof row[1] === 'string'
      && typeof row[2] === 'string'
      && typeof row[3] === 'string');
}

function isSubmissionsPayload(value: unknown): value is SubmissionsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === 'string'
    && typeof candidate.sic === 'string'
    && (candidate.sicDescription === undefined || typeof candidate.sicDescription === 'string')
    && (candidate.stateOfIncorporation === undefined || typeof candidate.stateOfIncorporation === 'string')
    && (candidate.tickers === undefined || isStringArray(candidate.tickers))
    && (candidate.exchanges === undefined || isStringArray(candidate.exchanges));
}

function exhaustedFetchError(label: string, result: Extract<SecJsonResult, { kind: 'retry-exhausted' }>): Error {
  const status = result.status === null ? '' : ` (HTTP ${result.status})`;
  return new Error(`${label} failed after ${result.attempts} attempts: ${result.reason}${status}`);
}

export async function bulkTickers(): Promise<void> {
  const client = createServiceClient();
  console.log('Fetching company_tickers_exchange.json ...');
  const fetched = await fetchSecJson('https://www.sec.gov/files/company_tickers_exchange.json', {
    validate: isTickerExchangePayload,
  });
  if (fetched.kind === 'not-found') {
    throw new Error('company_tickers_exchange.json returned an authoritative SEC 404');
  }
  if (fetched.kind === 'retry-exhausted') {
    throw exhaustedFetchError('company_tickers_exchange.json', fetched);
  }
  const data = fetched.data as TickerExchangePayload;

  // Merge multiple listings per CIK (share classes)
  const byCik = new Map<number, { name: string; tickers: Set<string>; exchanges: Set<string> }>();
  for (const [cik, name, ticker, exchange] of data.data) {
    const entry = byCik.get(cik) ?? { name, tickers: new Set(), exchanges: new Set() };
    if (ticker) entry.tickers.add(ticker);
    if (exchange) entry.exchanges.add(exchange);
    byCik.set(cik, entry);
  }

  const rows = Array.from(byCik.entries()).map(([cik, entry]) => ({
    cik,
    name: entry.name,
    tickers: Array.from(entry.tickers),
    exchanges: Array.from(entry.exchanges),
    updated_at: new Date().toISOString(),
  }));

  console.log(`Upserting ${rows.length} listed issuers ...`);
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await client.from('urc_sec_companies').upsert(rows.slice(i, i + 1000), { onConflict: 'cik' });
    if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
  }
  console.log('Bulk ticker/exchange pass done.');
}

interface SicPassOptions {
  maxAttempts?: number;
  retryBaseMs?: number;
  requestDelayMs?: number;
}

export async function sicPass(limit: number, options: SicPassOptions = {}): Promise<void> {
  const client = createServiceClient();

  // Issuers we care about: present in auditor or filing data, lacking SIC.
  // Newest filing activity first so active registrants enrich soonest.
  const { data: candidates, error } = await client.rpc('urc_companies_needing_sic', { p_limit: limit });
  if (error) throw new Error(`candidate query failed: ${error.message}`);
  const ciks: number[] = (candidates ?? []).map((row: { cik: number }) => row.cik);
  console.log(`Enriching SIC/state for ${ciks.length} issuers ...`);

  let done = 0;
  for (const cik of ciks) {
    const padded = String(cik).padStart(10, '0');
    const fetched = await fetchSecJson(`https://data.sec.gov/submissions/CIK${padded}.json`, {
      maxAttempts: options.maxAttempts,
      retryBaseMs: options.retryBaseMs,
      validate: isSubmissionsPayload,
    });
    if (fetched.kind === 'retry-exhausted') {
      throw exhaustedFetchError(`SEC submissions for CIK ${cik}`, fetched);
    }

    let row: Record<string, unknown>;
    if (fetched.kind === 'success') {
      const submissions = fetched.data as SubmissionsPayload;
      row = {
        cik,
        name: submissions.name,
        sic: submissions.sic || null,
        sic_description: submissions.sicDescription || null,
        state_of_incorporation: submissions.stateOfIncorporation || null,
        ...(submissions.tickers?.length ? { tickers: submissions.tickers } : {}),
        ...(submissions.exchanges?.length ? { exchanges: submissions.exchanges.filter(Boolean) } : {}),
        updated_at: new Date().toISOString(),
      };
    } else {
      row = {
        cik,
        sic: '0000',
        sic_description: 'UNKNOWN (no submissions record)',
        updated_at: new Date().toISOString(),
      };
    }

    const { error: upsertError } = await client.from('urc_sec_companies').upsert(row, { onConflict: 'cik' });
    if (upsertError) throw new Error(`upsert cik ${cik} failed: ${upsertError.message}`);

    done++;
    if (done % 250 === 0) console.log(`  ${done}/${ciks.length}`);
    const requestDelayMs = options.requestDelayMs ?? 220;
    if (requestDelayMs > 0) await delay(requestDelayMs); // ~4.5 req/s
  }
  console.log(`SIC pass done: ${done} issuers enriched.`);
}

async function main() {
  if (hasFlag('tickers')) await bulkTickers();
  if (hasFlag('sic')) await sicPass(Number(getArg('limit') || 2000));
  if (!hasFlag('tickers') && !hasFlag('sic')) {
    console.error('Usage: enrich-companies --tickers | --sic [--limit N]');
    process.exit(1);
  }
}

if (process.argv[1]?.includes('enrich-companies')) {
  main().catch(error => {
    console.error('Company enrichment failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
