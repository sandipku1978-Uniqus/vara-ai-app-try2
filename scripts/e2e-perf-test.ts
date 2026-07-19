/**
 * End-to-end performance + correctness test for the URC production stack.
 *
 *   npx tsx scripts/e2e-perf-test.ts [--base https://uniqus-research.vercel.app] [--points 1000]
 *
 * Builds a ~1,000-point suite from ground truth sampled directly out of the
 * Supabase facet store, then exercises the deployed HTTP APIs end to end:
 *
 *   A  filing facet lookups   /api/es-search (facet path)   known filing must appear
 *   B  auditor facet queries  /api/es-search (facet path)   hits>0, auditor labels correct
 *   C  comment letters        /api/letters                  thread details + topic search
 *   D  full-text search       /api/es-search (EFTS path)    known filing found by text
 *   E  issuer enrichment      /api/enrich                   tickers match ground truth
 *
 * Reports pass rate and latency (p50/p95/max) per class. EFTS-backed class D
 * is throttled to stay well inside SEC's courtesy limits.
 *
 * Requires URC_SUPABASE_URL + URC_SUPABASE_SERVICE_KEY in the environment
 * (source .env.local) for ground-truth sampling only — the tests themselves
 * hit the public HTTP APIs.
 */

import { createClient } from '@supabase/supabase-js';

const BASE = argValue('base') || 'https://uniqus-research.vercel.app';
const TOTAL = Number(argValue('points') || 1000);

const SUPABASE_URL = process.env.URC_SUPABASE_URL;
const SUPABASE_KEY = process.env.URC_SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set URC_SUPABASE_URL and URC_SUPABASE_SERVICE_KEY (source .env.local)');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Deterministic RNG so a re-run compares like with like.
let seed = 20260719;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

interface FilingRow {
  accession: string;
  cik: number;
  company_name: string;
  root_form: string;
  date_filed: string;
}

interface TestPoint {
  cls: 'A' | 'B' | 'C' | 'D' | 'E';
  label: string;
  url: string;
  check: (json: unknown) => string | null; // null = pass, string = failure reason
}

interface Result {
  cls: string;
  label: string;
  ms: number;
  status: number;
  failure: string | null;
}

// ---------------------------------------------------------------- sampling

const yearCounts = new Map<number, number>();

async function sampleFilings(perYear: number, years: number[]): Promise<FilingRow[]> {
  const rows: FilingRow[] = [];
  for (const year of years) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const { count } = await db
      .from('urc_sec_filings')
      .select('accession', { count: 'exact', head: true })
      .gte('date_filed', start)
      .lte('date_filed', end);
    yearCounts.set(year, count ?? 0);
    if (!count) continue;
    // three random pockets per year so samples spread across the calendar
    const pockets = 3;
    for (let p = 0; p < pockets; p++) {
      const offset = Math.floor(rand() * Math.max(1, count - 400));
      const { data } = await db
        .from('urc_sec_filings')
        .select('accession, cik, company_name, root_form, date_filed')
        .gte('date_filed', start)
        .lte('date_filed', end)
        .order('accession')
        .range(offset, offset + 399);
      if (data?.length) rows.push(...sample(data as FilingRow[], Math.ceil(perYear / pockets)));
    }
  }
  return rows;
}

// -------------------------------------------------------------- generation

async function generatePoints(): Promise<TestPoint[]> {
  const points: TestPoint[] = [];
  const nA = Math.round(TOTAL * 0.45);
  const nB = Math.round(TOTAL * 0.15);
  const nCthreads = Math.round(TOTAL * 0.10);
  const nCsearch = Math.round(TOTAL * 0.05);
  const nD = Math.round(TOTAL * 0.15);
  const nE = TOTAL - nA - nB - nCthreads - nCsearch - nD;

  // Which years actually have data (2010 backfill may still be in flight)
  const { data: yearProbe } = await db
    .from('urc_sec_filings')
    .select('date_filed')
    .order('date_filed', { ascending: true })
    .limit(1);
  const minYear = yearProbe?.[0] ? Number(String(yearProbe[0].date_filed).slice(0, 4)) : 2019;
  const years: number[] = [];
  for (let y = minYear; y <= 2026; y++) years.push(y);
  console.log(`Sampling ground truth across ${years[0]}–2026...`);

  // --- Class A: facet lookups — the known filing must come back
  const filingsA = await sampleFilings(Math.ceil(nA / years.length), years);
  for (const f of sample(filingsA, nA)) {
    const qs = new URLSearchParams({
      forms: f.root_form,
      startdt: f.date_filed,
      enddt: f.date_filed,
      entityName: f.company_name.slice(0, 40),
      size: '100',
    });
    points.push({
      cls: 'A',
      label: `${f.company_name} ${f.root_form} ${f.date_filed}`,
      url: `${BASE}/api/es-search?${qs}`,
      check: (json) => {
        const hits = (json as any)?.hits?.hits ?? [];
        return hits.some((h: any) => String(h._id).startsWith(f.accession))
          ? null
          : `accession ${f.accession} not in ${hits.length} hits`;
      },
    });
  }

  // --- Class B: auditor facets — labels must match the API's canonical names
  const FIRMS = [
    'Deloitte', 'EY', 'PwC', 'KPMG', 'BDO', 'Grant Thornton',
    'RSM', 'Marcum', 'Crowe', 'Moss Adams',
  ];
  // Form AP coverage starts 2017; only use years whose filings are loaded
  const auditorYears = years.filter((y) => y >= 2017 && (yearCounts.get(y) ?? 0) > 10_000);
  let b = 0;
  outer: for (let round = 0; round < 10; round++) {
    for (const firm of FIRMS) {
      if (b >= nB) break outer;
      const y = auditorYears[Math.floor(rand() * auditorYears.length)];
      const form = ['10-K', '10-Q', '8-K'][Math.floor(rand() * 3)];
      const qs = new URLSearchParams({
        forms: form,
        startdt: `${y}-01-01`,
        enddt: `${y}-12-31`,
        auditor: firm,
        size: '20',
      });
      points.push({
        cls: 'B',
        label: `${firm} ${form} ${y}`,
        url: `${BASE}/api/es-search?${qs}`,
        check: (json) => {
          const hits = (json as any)?.hits?.hits ?? [];
          if (hits.length === 0) return 'zero hits';
          const bad = hits.find((h: any) => h._source?.auditor !== firm);
          return bad ? `wrong auditor label: ${bad._source?.auditor}` : null;
        },
      });
      b++;
    }
  }

  // --- Class C1: thread details — every thread must return its letters
  const threadRes = await fetch(`${BASE}/api/letters?size=${Math.min(nCthreads * 2, 100)}`);
  const threadJson = await threadRes.json();
  const threads = (threadJson?.threads ?? []) as Array<Record<string, unknown>>;
  for (const t of sample(threads, nCthreads)) {
    const id = String(t.thread_id ?? t.id ?? '');
    const expected = Number(t.letters_count ?? t.letter_count ?? 0);
    points.push({
      cls: 'C',
      label: `thread ${id}`,
      url: `${BASE}/api/letters?thread=${encodeURIComponent(id)}`,
      check: (json) => {
        const letters = (json as any)?.letters ?? [];
        if (letters.length === 0) return 'empty thread';
        if (expected > 0 && letters.length !== expected)
          return `letters ${letters.length} != expected ${expected}`;
        return null;
      },
    });
  }

  // --- Class C2: topic search — common SEC-comment topics must match
  const TOPICS = [
    'revenue recognition', 'segment reporting', 'goodwill impairment',
    'non-GAAP measures', 'internal control over financial reporting',
    'material weakness', 'going concern', 'income taxes', 'fair value',
    'business combination', 'stock compensation', 'lease accounting',
    'cybersecurity', 'climate', 'disaggregation of revenue',
    'critical accounting estimates', 'earnings per share', 'restatement',
    'impairment of long-lived assets', 'related party transactions',
    'contingencies', 'debt covenants', 'warrants', 'deferred revenue',
    'risk factors',
  ];
  for (let i = 0; i < nCsearch; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const form = i % 2 === 0 ? '' : '&form=UPLOAD';
    points.push({
      cls: 'C',
      label: `search "${topic}"${form ? ' UPLOAD' : ''}`,
      url: `${BASE}/api/letters?q=${encodeURIComponent(topic)}${form}&size=10`,
      check: (json) => {
        const j = json as any;
        if (!Array.isArray(j?.matches)) return 'no matches array';
        if (j.total === 0) return 'zero matches for common topic';
        const noExcerpt = j.matches.find((m: any) => !m.excerpt && !m.headline);
        return noExcerpt ? 'match without excerpt' : null;
      },
    });
  }

  // --- Class D: EFTS full-text — find the known filing by company text
  const dYears = years.filter((y) => y >= 2010);
  const filingsD = sample(
    filingsA.filter((f) => ['10-K', '10-Q', '8-K', 'DEF 14A', 'S-1'].includes(f.root_form)),
    nD,
  );
  const GENERIC = new Set([
    'GROUP', 'INC', 'CORP', 'COMPANY', 'HOLDINGS', 'HOLDING', 'INTERNATIONAL',
    'INDUSTRIES', 'TRUST', 'FUND', 'CAPITAL', 'FINANCIAL', 'TECHNOLOGIES',
    'ENTERPRISES', 'PARTNERS', 'RESOURCES', 'SYSTEMS', 'BANCORP', 'THE',
    'CORPORATION', 'LTD', 'LLC', 'PLC', 'CO', 'NEW', 'FIRST', 'GLOBAL',
  ]);
  for (const f of filingsD) {
    // Rarest-looking word of the company name: distinctive, survives the
    // punctuation differences that break exact multi-word phrases in EFTS
    const words = f.company_name.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 2);
    const distinctive = words.filter((w) => !GENERIC.has(w)).sort((a, b) => b.length - a.length);
    const nameToken = distinctive[0] || words[0] || f.company_name;
    const qs = new URLSearchParams({
      q: `"${nameToken}"`,
      forms: f.root_form,
      startdt: f.date_filed,
      enddt: f.date_filed,
      size: '50',
    });
    points.push({
      cls: 'D',
      label: `EFTS "${nameToken}" ${f.root_form} ${f.date_filed}`,
      url: `${BASE}/api/es-search?${qs}`,
      check: (json) => {
        const hits = (json as any)?.hits?.hits ?? [];
        if (hits.length === 0) return 'zero hits';
        return hits.some((h: any) => String(h._id).startsWith(f.accession))
          ? null
          : `accession ${f.accession} not among ${hits.length} text hits`;
      },
    });
  }
  void dYears;

  // --- Class E: enrichment — tickers must match the facet store
  const { data: companies } = await db
    .from('urc_sec_companies')
    .select('cik, tickers')
    .not('tickers', 'is', null)
    .limit(2000);
  const withTickers = (companies ?? []).filter(
    (c: any) => Array.isArray(c.tickers) && c.tickers.length > 0,
  );
  const batches = sample(withTickers, Math.min(nE * 10, withTickers.length));
  for (let i = 0; i < nE; i++) {
    const group = batches.slice(i * 10, i * 10 + 10);
    if (group.length === 0) break;
    const ciks = group.map((g: any) => g.cik).join(',');
    points.push({
      cls: 'E',
      label: `enrich ${group.length} ciks`,
      url: `${BASE}/api/enrich?ciks=${ciks}`,
      check: (json) => {
        for (const g of group as any[]) {
          const entry = (json as any)?.companies?.[String(g.cik)];
          if (!entry) return `cik ${g.cik} missing`;
          const got: string[] = entry.tickers ?? [];
          if (!g.tickers.every((t: string) => got.includes(t)))
            return `cik ${g.cik} tickers ${JSON.stringify(got)} != ${JSON.stringify(g.tickers)}`;
        }
        return null;
      },
    });
  }

  return points;
}

// ---------------------------------------------------------------- runner

async function runOne(p: TestPoint): Promise<Result> {
  const t0 = performance.now();
  try {
    let res = await fetch(p.url, { signal: AbortSignal.timeout(45_000) });
    if (res.status >= 500) {
      // one retry on transient 5xx — real clients get the same second chance
      await new Promise((r) => setTimeout(r, 750));
      res = await fetch(p.url, { signal: AbortSignal.timeout(45_000) });
    }
    const ms = performance.now() - t0;
    if (!res.ok) return { cls: p.cls, label: p.label, ms, status: res.status, failure: `HTTP ${res.status}` };
    const json = await res.json();
    return { cls: p.cls, label: p.label, ms, status: res.status, failure: p.check(json) };
  } catch (e) {
    return {
      cls: p.cls, label: p.label, ms: performance.now() - t0, status: 0,
      failure: `request error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function runPool(points: TestPoint[], concurrency: number, spacingMs = 0): Promise<Result[]> {
  const results: Result[] = [];
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < points.length) {
      const p = points[i++];
      results.push(await runOne(p));
      done++;
      if (done % 50 === 0) console.log(`  ...${done}/${points.length}`);
      if (spacingMs) await new Promise((r) => setTimeout(r, spacingMs));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// ------------------------------------------------------------------ main

(async () => {
  console.log(`Target: ${BASE}  |  points: ${TOTAL}`);
  const points = await generatePoints();
  const byClass = (c: string) => points.filter((p) => p.cls === c);
  console.log(
    `Generated ${points.length} points — A:${byClass('A').length} B:${byClass('B').length} ` +
    `C:${byClass('C').length} D:${byClass('D').length} E:${byClass('E').length}`,
  );

  const started = new Date().toISOString();
  const t0 = performance.now();
  // Supabase-backed classes run wide; the EFTS class runs narrow + spaced so
  // the server-side EDGAR calls stay far inside SEC courtesy limits.
  const fast = points.filter((p) => p.cls !== 'D');
  const efts = points.filter((p) => p.cls === 'D');
  console.log(`Running ${fast.length} Supabase-backed points (concurrency 8)...`);
  const fastResults = await runPool(sample(fast, fast.length), 8);
  console.log(`Running ${efts.length} EFTS-backed points (concurrency 2, spaced)...`);
  const eftsResults = await runPool(efts, 2, 350);
  const results = [...fastResults, ...eftsResults];
  const wallSeconds = (performance.now() - t0) / 1000;

  const classes = ['A', 'B', 'C', 'D', 'E'];
  const summary = classes.map((c) => {
    const rs = results.filter((r) => r.cls === c);
    const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
    const pass = rs.filter((r) => r.failure === null).length;
    return {
      cls: c, n: rs.length, pass, passRate: rs.length ? (pass / rs.length) * 100 : 0,
      p50: pct(lat, 50), p95: pct(lat, 95), max: lat[lat.length - 1] ?? 0,
    };
  });

  console.log('\n=== RESULTS ===');
  for (const s of summary) {
    console.log(
      `${s.cls}  n=${String(s.n).padStart(4)}  pass=${s.passRate.toFixed(1).padStart(5)}%  ` +
      `p50=${Math.round(s.p50)}ms  p95=${Math.round(s.p95)}ms  max=${Math.round(s.max)}ms`,
    );
  }
  const totalPass = results.filter((r) => r.failure === null).length;
  console.log(`TOTAL ${totalPass}/${results.length} (${((totalPass / results.length) * 100).toFixed(1)}%) in ${wallSeconds.toFixed(0)}s`);

  const failures = results.filter((r) => r.failure !== null);
  const outPath = argValue('out') || '/tmp/e2e-perf-results.json';
  const fs = await import('fs');
  fs.writeFileSync(outPath, JSON.stringify({ base: BASE, started, wallSeconds, summary, totalPass, total: results.length, failures }, null, 2));
  console.log(`\nFailures: ${failures.length} — full detail in ${outPath}`);
  for (const f of failures.slice(0, 25)) console.log(`  [${f.cls}] ${f.label} → ${f.failure}`);
})();
