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

async function fetchJson(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch {
      await delay(1000 * 2 ** attempt);
    }
  }
  return null;
}

async function bulkTickers(): Promise<void> {
  const client = createServiceClient();
  console.log('Fetching company_tickers_exchange.json ...');
  const data = await fetchJson('https://www.sec.gov/files/company_tickers_exchange.json') as {
    fields: string[];
    data: Array<[number, string, string, string]>; // cik, name, ticker, exchange
  } | null;
  if (!data?.data) throw new Error('Unexpected company_tickers_exchange.json shape');

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

async function sicPass(limit: number): Promise<void> {
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
    const submissions = await fetchJson(`https://data.sec.gov/submissions/CIK${padded}.json`) as {
      name?: string; sic?: string; sicDescription?: string; stateOfIncorporation?: string;
      tickers?: string[]; exchanges?: string[];
    } | null;

    const row = submissions
      ? {
          cik,
          name: submissions.name ?? null,
          sic: submissions.sic || null,
          sic_description: submissions.sicDescription || null,
          state_of_incorporation: submissions.stateOfIncorporation || null,
          ...(submissions.tickers?.length ? { tickers: submissions.tickers } : {}),
          ...(submissions.exchanges?.length ? { exchanges: submissions.exchanges.filter(Boolean) } : {}),
          updated_at: new Date().toISOString(),
        }
      : { cik, sic: '0000', sic_description: 'UNKNOWN (no submissions record)', updated_at: new Date().toISOString() };

    const { error: upsertError } = await client.from('urc_sec_companies').upsert(row, { onConflict: 'cik' });
    if (upsertError) throw new Error(`upsert cik ${cik} failed: ${upsertError.message}`);

    done++;
    if (done % 250 === 0) console.log(`  ${done}/${ciks.length}`);
    await delay(220); // ~4.5 req/s
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

main().catch(error => {
  console.error('Company enrichment failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
