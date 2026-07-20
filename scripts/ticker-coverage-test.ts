/**
 * Full-directory ticker coverage test — every listed issuer, 100% accuracy.
 *
 *   npx tsx scripts/ticker-coverage-test.ts [--base https://uniqus-research.vercel.app] [--out results.json]
 *
 * Downloads the complete SEC ticker directory (company_tickers.json,
 * ~10,400 rows) and pushes EVERY ticker through the full product chain:
 *
 *   1. RESOLUTION  — the shared matcher must map the ticker to its own
 *                    directory row (imports the real matchCompanyEntry).
 *   2. RETRIEVAL   — the production facet API must return filings for the
 *                    resolved CIK (exact p_cik browse, no name matching).
 *   3. IDENTITY    — every returned filing must belong to that CIK.
 *   4. ORDERING    — results must be newest-first.
 *
 * A ticker with zero filings is only accepted when EDGAR itself confirms the
 * issuer has no post-2010 filings (EMPTY_VERIFIED, listed in the report) —
 * otherwise it is a FAIL. 100% accuracy means FAIL count = 0: every ticker
 * either returns its own issuer's filings correctly or is proven empty
 * against the primary source.
 *
 * Exit code is non-zero when any ticker FAILs, so this can gate releases.
 */

import { matchCompanyEntry, type CompanyDirectoryEntry } from '../src/services/secApi';

const BASE = argValue('base') || 'https://uniqus-research.vercel.app';
const OUT = argValue('out') || '/tmp/ticker-coverage-results.json';
const CONCURRENCY = Number(argValue('concurrency') || 8);
const USER_AGENT = 'Uniqus Research Center contact@uniqus.com';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

interface DirectoryRow { cik: string; ticker: string; title: string }

type Status = 'PASS' | 'EMPTY_VERIFIED' | 'FAIL';

interface TickerResult {
  ticker: string;
  title: string;
  cik: string;
  status: Status;
  detail: string;
  filings: number;
  newest: string;
  ms: number;
}

async function fetchDirectory(): Promise<DirectoryRow[]> {
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`directory fetch: HTTP ${res.status}`);
  const data = await res.json();
  return Object.values(data as Record<string, { cik_str: number; ticker: string; title: string }>)
    .map(e => ({ cik: String(e.cik_str), ticker: String(e.ticker).toUpperCase(), title: String(e.title || '') }));
}

/** Search the production facet API by exact CIK. */
async function searchByCik(cik: string): Promise<{ hits: any[]; ms: number; status: number }> {
  const t0 = performance.now();
  const url = `${BASE}/api/es-search?${new URLSearchParams({ cik, size: '5' })}`;
  let res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status >= 500) {
    await new Promise(r => setTimeout(r, 750));
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  }
  const ms = performance.now() - t0;
  if (!res.ok) return { hits: [], ms, status: res.status };
  const json = await res.json();
  return { hits: json?.hits?.hits ?? [], ms, status: res.status };
}

/** EDGAR ground truth: does this issuer have ANY filings since 2010? */
async function edgarHasFilingsSince2010(cik: string): Promise<{ has: boolean; detail: string }> {
  try {
    const padded = cik.padStart(10, '0');
    const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return { has: false, detail: 'no EDGAR submissions record' };
    if (!res.ok) return { has: true, detail: `submissions HTTP ${res.status} — treat as FAIL` };
    const json = await res.json();
    const dates: string[] = json?.filings?.recent?.filingDate ?? [];
    const post2010 = dates.filter((d: string) => d >= '2010-01-01');
    if (post2010.length === 0 && !json?.filings?.files?.length) {
      return { has: false, detail: 'EDGAR confirms no filings since 2010' };
    }
    if (post2010.length === 0) {
      // Older filings exist in archive pages only — still nothing post-2010 in recent
      return { has: false, detail: 'no post-2010 filings in EDGAR recent window' };
    }
    return { has: true, detail: `EDGAR shows ${post2010.length} post-2010 filings` };
  } catch (e) {
    return { has: true, detail: `EDGAR check failed (${e instanceof Error ? e.message : e}) — treat as FAIL` };
  }
}

(async () => {
  console.log(`Target: ${BASE}`);
  const directory = await fetchDirectory();
  console.log(`Directory: ${directory.length} tickers`);

  // Stage 1: resolution for every ticker via the real matcher (pure, local)
  const resolutionFailures: TickerResult[] = [];
  for (const row of directory) {
    const hit = matchCompanyEntry(directory as CompanyDirectoryEntry[], row.ticker);
    if (!hit || hit.ticker !== row.ticker) {
      resolutionFailures.push({
        ticker: row.ticker, title: row.title, cik: row.cik,
        status: 'FAIL', detail: `resolution: ${hit ? `wrong row ${hit.ticker}` : 'null'}`,
        filings: 0, newest: '', ms: 0,
      });
    }
  }
  console.log(`Stage 1 — resolution: ${directory.length - resolutionFailures.length}/${directory.length} resolve to their own row`);

  // Stage 2-4: production retrieval per unique CIK (share classes share filings)
  const byCik = new Map<string, DirectoryRow[]>();
  for (const row of directory) {
    const list = byCik.get(row.cik) || [];
    list.push(row);
    byCik.set(row.cik, list);
  }
  const ciks = Array.from(byCik.keys());
  console.log(`Stage 2 — retrieval: ${ciks.length} unique issuers (concurrency ${CONCURRENCY})...`);

  const cikOutcome = new Map<string, { status: Status; detail: string; filings: number; newest: string; ms: number }>();
  let done = 0;
  let index = 0;

  async function worker() {
    while (index < ciks.length) {
      const cik = ciks[index++];
      try {
        const { hits, ms, status } = await searchByCik(cik);
        if (status !== 200) {
          cikOutcome.set(cik, { status: 'FAIL', detail: `API HTTP ${status}`, filings: 0, newest: '', ms });
        } else if (hits.length === 0) {
          const edgar = await edgarHasFilingsSince2010(cik);
          cikOutcome.set(cik, edgar.has
            ? { status: 'FAIL', detail: `zero results but ${edgar.detail}`, filings: 0, newest: '', ms }
            : { status: 'EMPTY_VERIFIED', detail: edgar.detail, filings: 0, newest: '', ms });
        } else {
          const padded = cik.padStart(10, '0');
          const wrongIssuer = hits.find((h: any) => !(h._source?.ciks ?? []).includes(padded));
          const dates = hits.map((h: any) => String(h._source?.file_date || ''));
          const sorted = [...dates].sort((a, b) => b.localeCompare(a));
          if (wrongIssuer) {
            cikOutcome.set(cik, { status: 'FAIL', detail: `foreign issuer in results: ${wrongIssuer._source?.display_names?.[0] || wrongIssuer._id}`, filings: hits.length, newest: dates[0] || '', ms });
          } else if (dates.join('|') !== sorted.join('|')) {
            cikOutcome.set(cik, { status: 'FAIL', detail: `not newest-first: ${dates.join(',')}`, filings: hits.length, newest: dates[0] || '', ms });
          } else {
            cikOutcome.set(cik, { status: 'PASS', detail: '', filings: hits.length, newest: dates[0] || '', ms });
          }
        }
      } catch (e) {
        cikOutcome.set(cik, { status: 'FAIL', detail: `request error: ${e instanceof Error ? e.message : e}`, filings: 0, newest: '', ms: 0 });
      }
      done++;
      if (done % 500 === 0) console.log(`  ...${done}/${ciks.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Assemble per-ticker results
  const results: TickerResult[] = [...resolutionFailures];
  const failedResolutionTickers = new Set(resolutionFailures.map(r => r.ticker));
  for (const row of directory) {
    if (failedResolutionTickers.has(row.ticker)) continue;
    const o = cikOutcome.get(row.cik)!;
    results.push({ ticker: row.ticker, title: row.title, cik: row.cik, ...o });
  }

  const pass = results.filter(r => r.status === 'PASS');
  const empty = results.filter(r => r.status === 'EMPTY_VERIFIED');
  const fail = results.filter(r => r.status === 'FAIL');
  const lat = Array.from(cikOutcome.values()).map(o => o.ms).sort((a, b) => a - b);
  const pct = (p: number) => Math.round(lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] || 0);

  console.log('\n=== TICKER COVERAGE RESULTS ===');
  console.log(`Tickers:          ${results.length}`);
  console.log(`PASS:             ${pass.length}`);
  console.log(`EMPTY_VERIFIED:   ${empty.length}  (no post-2010 filings per EDGAR itself)`);
  console.log(`FAIL:             ${fail.length}`);
  console.log(`Accuracy:         ${(((pass.length + empty.length) / results.length) * 100).toFixed(2)}% (target 100.00%)`);
  console.log(`Latency:          p50=${pct(50)}ms  p95=${pct(95)}ms`);
  for (const f of fail.slice(0, 30)) console.log(`  FAIL ${f.ticker} (${f.title}): ${f.detail}`);
  if (empty.length > 0) {
    console.log(`\nEMPTY_VERIFIED sample:`);
    for (const e of empty.slice(0, 10)) console.log(`  ${e.ticker} (${e.title}): ${e.detail}`);
  }

  const fs = await import('fs');
  fs.writeFileSync(OUT, JSON.stringify({
    base: BASE,
    tickers: results.length,
    uniqueIssuers: ciks.length,
    pass: pass.length,
    emptyVerified: empty.length,
    fail: fail.length,
    latency: { p50: pct(50), p95: pct(95) },
    failures: fail,
    emptyVerifiedList: empty.map(e => ({ ticker: e.ticker, title: e.title, detail: e.detail })),
  }, null, 2));
  console.log(`\nFull results: ${OUT}`);

  process.exit(fail.length > 0 ? 1 : 0);
})();
