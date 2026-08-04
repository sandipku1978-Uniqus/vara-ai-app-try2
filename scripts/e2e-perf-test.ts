/**
 * End-to-end performance + correctness test for a URC release candidate.
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
import { createHash } from 'node:crypto';
import { candidateRequestHeaders } from './accuracy/request';
import { secJson } from './accuracy/sources';
import {
  buildE2eQuotaPlan,
  completeFilingSearchPageProblem,
  deriveRawAuditorTruth,
  hitMatchesExpectedFiling,
  inspectFilingSearchPage,
  isDisjointEntityNameControl,
  quotaShortfalls,
  validateCompanyEnrichment,
  validateFilingSearchPagePrecision,
  validateThreadDetails,
  validateTopicSearchResult,
  type ExpectedFilingTarget,
  type TopicSearchTruth,
} from './accuracy/evaluator-validity';

const BASE = (argValue('base') || 'https://uniqus-research.vercel.app').replace(/\/$/, '');
const TOTAL = Number(argValue('points') || 1000);
const QUOTA_PLAN = buildE2eQuotaPlan(TOTAL);
const MAX_TARGET_PAGES = 10;
// Auditor targets already carry exact CIK + filing date + form + auditor
// predicates. If that filing is not on the first 100-row page, the temporal
// facet is broken; paging it only consumes release-gate headroom. The broader
// A/D/F targets retain bounded pagination.
const PAGINATED_TARGET_CASES = QUOTA_PLAN.classes.A + QUOTA_PLAN.classes.D + QUOTA_PLAN.classes.F;
const MAX_LOGICAL_CANDIDATE_REQUESTS = TOTAL + PAGINATED_TARGET_CASES * (MAX_TARGET_PAGES - 1);
const MAX_HTTP_CANDIDATE_ATTEMPTS = MAX_LOGICAL_CANDIDATE_REQUESTS * 2;
const MAX_EXAMINED_FILINGS = (QUOTA_PLAN.classes.A * 100 * MAX_TARGET_PAGES)
  + (QUOTA_PLAN.classes.B * 100)
  + (QUOTA_PLAN.classes.D * 50 * MAX_TARGET_PAGES)
  + (QUOTA_PLAN.classes.F * 100 * MAX_TARGET_PAGES);

const SUPABASE_URL = process.env.URC_SUPABASE_URL;
const SUPABASE_KEY = process.env.URC_SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set URC_SUPABASE_URL and URC_SUPABASE_SERVICE_KEY (source .env.local)');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Deterministic RNG so a re-run compares like with like.
const RNG_SEED = 20260719;
let seed = RNG_SEED;
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

interface OfficialCompanyTickers {
  cik: number;
  title: string;
  tickers: string[];
}

async function officialCompanyTickers(): Promise<OfficialCompanyTickers[]> {
  const directory = await secJson<Record<string, {
    cik_str?: unknown;
    ticker?: unknown;
    title?: unknown;
  }>>('https://www.sec.gov/files/company_tickers.json');
  if (!directory) throw new Error('official SEC company ticker directory is unavailable');
  const grouped = new Map<number, OfficialCompanyTickers>();
  for (const row of Object.values(directory)) {
    const cik = Number(row.cik_str);
    const ticker = String(row.ticker ?? '').trim().toUpperCase();
    if (!Number.isInteger(cik) || cik <= 0 || !ticker) continue;
    const existing = grouped.get(cik) || {
      cik,
      title: String(row.title ?? '').trim(),
      tickers: [],
    };
    if (!existing.tickers.includes(ticker)) existing.tickers.push(ticker);
    grouped.set(cik, existing);
  }
  const companies = [...grouped.values()].sort((a, b) => a.cik - b.cik);
  if (companies.length < 1_000) throw new Error(`official SEC directory returned only ${companies.length} companies`);
  return companies;
}

interface AuditorPeriodRow {
  issuer_cik: number;
  effective_from: string;
  effective_to: string | null;
  resolution_status: string;
  firm_canonical: string | null;
}

interface RawBoundaryAuditorRowEvidence {
  formFilingId: number;
  issuerCik: number;
  auditReportDate: string;
  auditReportType: string | null;
  firmCanonical: string | null;
  filingDate: string | null;
  isLatest: true;
}

interface AuditorBoundaryIntervalEvidence {
  /** Stable materialized-view key. The view's unique index is
   * (issuer_cik, effective_from), so no synthetic row id is needed. */
  intervalId: string;
  issuerCik: number;
  firmName: string;
  effectiveFromInclusive: string;
  effectiveToExclusive: string | null;
  rawEvent: {
    source: 'urc_sec_auditors.direct-event';
    auditReportDate: string;
    resolvedFirmName: string;
    rows: RawBoundaryAuditorRowEvidence[];
    digest: string;
  };
}

interface AuditorBoundaryRawTransitionWitness {
  contract: 'urc.raw-form-ap-transition-range.v1';
  source: 'urc_sec_auditors.direct-range+direct-next-event';
  issuerCik: number;
  fromAuditReportDateInclusive: string;
  toAuditReportDateInclusive: string;
  exactRowCount: number;
  returnedRowCount: number;
  complete: true;
  eventDates: [string, string];
  rows: RawBoundaryAuditorRowEvidence[];
  nextEventAfterPredecessor: {
    source: 'urc_sec_auditors.direct-next-event';
    afterAuditReportDateExclusive: string;
    auditReportDate: string;
    firstFormFilingId: number;
  };
  digest: string;
}

interface AuditorBoundaryCaseEvidence {
  contract: 'urc.auditor-boundary-selection.v1';
  intervalIdScheme: 'issuer_cik:effective_from';
  pairId: string;
  boundaryDate: string;
  issuerCik: number;
  side: 'before' | 'after';
  predecessor: AuditorBoundaryIntervalEvidence;
  successor: AuditorBoundaryIntervalEvidence;
  rawTransitionWitness: AuditorBoundaryRawTransitionWitness;
  selection: {
    accession: string;
    dateFiled: string;
    selectedIntervalId: string;
    effectiveFromInclusive: string;
    effectiveToExclusive: string | null;
    selectionWindow: {
      fromInclusive: string;
      toExclusive: string;
    };
    expectedFirmName: string;
    reciprocalRejectedFirmName: string;
    intervalPredicate: 'effectiveFromInclusive <= dateFiled AND (effectiveToExclusive IS NULL OR dateFiled < effectiveToExclusive)';
    selectionPredicate: 'selectionWindow.fromInclusive <= dateFiled < selectionWindow.toExclusive';
  };
  pair: {
    before: { accession: string; dateFiled: string; intervalId: string };
    after: { accession: string; dateFiled: string; intervalId: string };
  };
}

interface AuditorTruthRow {
  request_key: string;
  auditor: string | null;
  auditor_resolution_status: string;
  auditor_basis: string | null;
}

interface RawAuditorRow {
  form_filing_id: number;
  issuer_cik: number;
  is_latest: boolean;
  audit_report_date: string;
  audit_report_type: string | null;
  firm_canonical: string | null;
  filing_date: string | null;
}

interface AuditorSearchHit {
  _id?: unknown;
  _source?: {
    adsh?: unknown;
    ciks?: unknown;
    cik?: unknown;
    auditor?: unknown;
    file_date?: unknown;
  };
}

interface TestPoint {
  caseId?: string;
  cls: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  criticalPath?: 'auditor' | 'topic';
  label: string;
  url: string;
  check: (json: unknown) => string | null | Promise<string | null>; // null = pass
  validatePage?: (json: unknown) => string | null;
  /** When present, the runner follows bounded pages until this exact filing is
   * found. A large total without the target is never accepted as a pass. */
  expectedFiling?: ExpectedFilingTarget;
  /** Negative-control target that must be absent across the complete bounded
   * result window. A first-page miss alone is not proof. */
  forbiddenFiling?: ExpectedFilingTarget;
  /** Bounded independent oracle serialized into the replay artifact. */
  oracleEvidence: Record<string, unknown>;
}

interface Result {
  caseId?: string;
  cls: string;
  criticalPath?: 'auditor' | 'topic';
  label: string;
  ms: number;
  status: number;
  statusHistory: number[];
  failure: string | null;
  pages: number;
  examined: number;
  observation: {
    pages: Array<{
      requestPath: string;
      status: number;
      contentType: string;
      payloadBytes: number;
      payloadSha256: string;
      projection: unknown;
      projectionSha256: string;
    }>;
  };
}

function boundedCandidateProjection(cls: TestPoint['cls'], payload: unknown): unknown {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (cls === 'A' || cls === 'B' || cls === 'D' || cls === 'F') {
    const hitsEnvelope = data.hits && typeof data.hits === 'object'
      ? data.hits as Record<string, unknown>
      : {};
    const rawHits = Array.isArray(hitsEnvelope.hits) ? hitsEnvelope.hits.slice(0, 100) : [];
    return {
      hits: {
        total: hitsEnvelope.total ?? null,
        hits: rawHits.map(value => {
          const hit = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          const source = hit._source && typeof hit._source === 'object'
            ? hit._source as Record<string, unknown>
            : {};
          return {
            _id: hit._id ?? null,
            _source: {
              adsh: source.adsh ?? null,
              ciks: source.ciks ?? null,
              cik: source.cik ?? null,
              form: source.form ?? source.root_form ?? null,
              file_date: source.file_date ?? null,
              display_names: source.display_names ?? null,
              auditor: source.auditor ?? null,
            },
          };
        }),
      },
    };
  }
  if (cls === 'C') {
    const matches = Array.isArray(data.matches) ? data.matches.slice(0, 10) : undefined;
    const letters = Array.isArray(data.letters) ? data.letters.slice(0, 200) : undefined;
    return {
      thread: data.thread ?? null,
      total: data.total ?? null,
      totalIsFloor: data.totalIsFloor ?? null,
      matches: matches?.map(value => {
        const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return {
          accession: row.accession ?? null, cik: row.cik ?? null, form: row.form ?? null,
          date_filed: row.date_filed ?? null, rank: row.rank ?? null,
          headline: row.headline ?? row.excerpt ?? null,
        };
      }),
      letters: letters?.map(value => {
        const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return {
          accession: row.accession ?? null, cik: row.cik ?? null, form: row.form ?? null,
          date_filed: row.date_filed ?? null, filename: row.filename ?? null,
        };
      }),
    };
  }
  if (cls === 'E') {
    const companies = data.companies && typeof data.companies === 'object'
      ? data.companies as Record<string, unknown>
      : {};
    return {
      companies: Object.fromEntries(Object.entries(companies).slice(0, 10).map(([cik, value]) => {
        const company = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        return [cik, { tickers: company.tickers ?? null }];
      })),
    };
  }
  return null;
}

const topicTruthCache = new Map<string, Promise<TopicSearchTruth>>();

async function loadTopicTruth(topic: string, expectedForm: string | undefined): Promise<TopicSearchTruth> {
  const cacheKey = `${expectedForm || '*'}\u0000${topic}`;
  let truthPromise = topicTruthCache.get(cacheKey);
  if (!truthPromise) {
    truthPromise = (async () => {
      let countQuery = db
        .from('urc_comment_letters')
        .select('accession', { count: 'exact', head: true })
        .textSearch('fts', topic, { type: 'websearch', config: 'english' });
      if (expectedForm) countQuery = countQuery.eq('form', expectedForm);
      let poolQuery = db
        .from('urc_comment_letters')
        .select('accession,cik,form,date_filed')
        .textSearch('fts', topic, { type: 'websearch', config: 'english' })
        .order('date_filed', { ascending: false })
        .order('accession', { ascending: true })
        .order('cik', { ascending: true })
        .limit(1_000);
      if (expectedForm) poolQuery = poolQuery.eq('form', expectedForm);
      const [countResult, pageResult] = await Promise.all([countQuery, poolQuery]);
      if (countResult.error) {
        throw new Error(`direct topic count truth failed for "${topic}": ${countResult.error.message}`);
      }
      if (pageResult.error) {
        throw new Error(`direct topic FTS pool failed for "${topic}": ${pageResult.error.message}`);
      }
      const exactTotal = countResult.count;
      if (exactTotal === null || !Number.isInteger(exactTotal) || exactTotal <= 0) {
        throw new Error(`direct topic count truth is invalid for "${topic}": ${String(exactTotal)}`);
      }
      if (!Array.isArray(pageResult.data)) {
        throw new Error(`direct ranked topic truth returned no rows for "${topic}"`);
      }
      const truthMatches = pageResult.data.map(row => ({
        accession: String(row.accession ?? ''),
        cik: String(row.cik ?? ''),
        form: String(row.form ?? ''),
        date_filed: String(row.date_filed ?? ''),
      }));
      const expectedRows = Math.min(1_000, exactTotal);
      if (truthMatches.length !== expectedRows) {
        throw new Error(
          `direct topic FTS pool returned ${truthMatches.length}/${expectedRows} rows for "${topic}"`,
        );
      }
      return {
        total: exactTotal,
        pageSize: 10,
        poolDepth: expectedRows,
        matches: truthMatches,
        countSource: 'urc_comment_letters.direct-fts-count',
        rankSource: 'candidate-rank-order-with-independent-fts-pool',
        predicateSource: 'urc_comment_letters.direct-fts-identity',
        predicateEvidenceSha256: createHash('sha256').update(JSON.stringify(truthMatches)).digest('hex'),
      };
    })();
    topicTruthCache.set(cacheKey, truthPromise);
  }
  return truthPromise;
}

let logicalRequests = 0;
let httpAttempts = 0;
let serverErrorResponses = 0;
let casesWith5xx = 0;

class CandidateFetchError extends Error {
  constructor(message: string, readonly statusHistory: number[]) {
    super(message);
  }
}

async function candidateFetchWithRetry(url: string): Promise<{ response: Response; statusHistory: number[] }> {
  logicalRequests += 1;
  const statusHistory: number[] = [];
  const pathname = new URL(url).pathname;
  const request = async () => {
    httpAttempts += 1;
    const response = await fetch(url, {
      headers: candidateRequestHeaders(pathname, 'GET', {
        requestOrigin: new URL(url).origin,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(45_000),
    });
    statusHistory.push(response.status);
    if (response.status >= 500) serverErrorResponses += 1;
    return response;
  };

  try {
    let response = await request();
    if (response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      response = await request();
    }
    if (statusHistory.some(status => status >= 500)) casesWith5xx += 1;
    return { response, statusHistory };
  } catch (error) {
    if (statusHistory.some(status => status >= 500)) casesWith5xx += 1;
    throw new CandidateFetchError(error instanceof Error ? error.message : String(error), statusHistory);
  }
}

// ---------------------------------------------------------------- sampling

const yearCounts = new Map<number, number>();
const AUDITOR_START_YEAR = 2017;
const AUDITOR_YEAR_CANDIDATE_CAP = 500;
const AUDITOR_BOUNDARY_PREDECESSOR_CAP_PER_YEAR = 200;
const AUDITOR_BOUNDARY_TRANSITION_HARD_CAP = 500;
const AUDITOR_BOUNDARY_SIDE_CANDIDATE_LIMIT = 10;
const AUDITOR_BOUNDARY_RAW_RANGE_LIMIT = 1_000;
const AUDITOR_BASIS = 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date';
const samplingDiagnostics = {
  filingCandidatesRead: 0,
  filingDuplicateReplacements: 0,
  auditorCandidatePages: 0,
  auditorCandidatesExamined: 0,
  auditorUnresolvedReplacements: 0,
  auditorDuplicateReplacements: 0,
  auditorCandidateHardCap: 0,
  auditorYears: [] as number[],
  auditorYearTargets: {} as Record<string, number>,
  auditorYearGenerated: {} as Record<string, number>,
  auditorYearPositiveGenerated: {} as Record<string, number>,
  auditorYearNegativeGenerated: {} as Record<string, number>,
  auditorPositiveCases: 0,
  auditorNegativeControls: 0,
  auditorRawPages: 0,
  auditorRawRowsRead: 0,
  auditorRawRowHardCapPerChunk: 5_000,
  auditorRawResolverMismatches: 0,
  auditorRawMaxFormFilingId: 0,
  auditorRawMaxFilingDate: null as string | null,
  auditorBoundaryPairTarget: 0,
  auditorBoundaryPairsGenerated: 0,
  auditorBoundaryPredecessorHardCap: 0,
  auditorBoundaryPredecessorsExamined: 0,
  auditorBoundaryTransitionHardCap: AUDITOR_BOUNDARY_TRANSITION_HARD_CAP,
  auditorBoundaryTransitionsExamined: 0,
  auditorBoundaryCandidateHardCap:
    AUDITOR_BOUNDARY_TRANSITION_HARD_CAP * AUDITOR_BOUNDARY_SIDE_CANDIDATE_LIMIT * 2,
  auditorBoundaryCandidatesExamined: 0,
  auditorBoundaryRejected: 0,
  auditorBoundaryRawEventRowsRead: 0,
  auditorBoundaryRawEventMismatches: 0,
  auditorBoundaryRawRangeRowsRead: 0,
  auditorBoundaryRawRangeMismatches: 0,
  auditorBoundaryRawNextEventProbes: 0,
};

async function groundTruthWatermark(): Promise<Record<string, unknown>> {
  const [filingCount, latestFiling, letterCount, latestLetter, auditorCount, latestAuditor] = await Promise.all([
    db.from('urc_sec_filings').select('accession', { count: 'exact', head: true }),
    db.from('urc_sec_filings')
      .select('accession,cik,date_filed')
      .order('date_filed', { ascending: false })
      .order('accession', { ascending: false })
      .limit(1),
    db.from('urc_comment_letters').select('accession', { count: 'exact', head: true }),
    db.from('urc_comment_letters')
      .select('accession,cik,thread_id,date_filed,review_key')
      .order('date_filed', { ascending: false })
      .order('accession', { ascending: false })
      .limit(1),
    db.from('urc_sec_auditors').select('form_filing_id', { count: 'exact', head: true }),
    db.from('urc_sec_auditors')
      .select('form_filing_id,filing_date,audit_report_date')
      .order('form_filing_id', { ascending: false })
      .limit(1),
  ]);
  for (const [label, response] of [
    ['filing count', filingCount],
    ['latest filing', latestFiling],
    ['letter count', letterCount],
    ['latest letter', latestLetter],
    ['Form AP count', auditorCount],
    ['latest Form AP row', latestAuditor],
  ] as const) {
    if (response.error) throw new Error(`ground-truth watermark ${label} failed: ${response.error.message}`);
  }
  if (
    !Number.isInteger(filingCount.count)
    || !Number.isInteger(letterCount.count)
    || !Number.isInteger(auditorCount.count)
    || !latestFiling.data?.[0]
    || !latestLetter.data?.[0]
    || !latestAuditor.data?.[0]
  ) {
    throw new Error('ground-truth watermark is incomplete');
  }
  return {
    capturedAt: new Date().toISOString(),
    filings: { count: filingCount.count, latest: latestFiling.data[0] },
    commentLetters: { count: letterCount.count, latest: latestLetter.data[0] },
    rawFormAp: { count: auditorCount.count, latest: latestAuditor.data[0] },
  };
}

function auditorFilingKey(filing: FilingRow): string {
  return `${filing.accession}:${filing.cik}`;
}

function filingYear(filing: FilingRow): number {
  return Number(filing.date_filed.slice(0, 4));
}

async function resolveAuditorTruth(filings: FilingRow[]): Promise<Map<string, AuditorTruthRow>> {
  if (filings.length === 0) return new Map();
  const requests = filings.map((filing) => ({
    key: auditorFilingKey(filing),
    cik: String(filing.cik),
    file_date: filing.date_filed,
  }));
  const { data, error } = await db.rpc('urc_resolve_filing_auditors', { p_filings: requests });
  if (error) throw new Error(`temporal auditor resolver failed: ${error.message}`);
  const resolver = new Map(
    ((data ?? []) as unknown as AuditorTruthRow[]).map((row) => [String(row.request_key), row]),
  );

  // Independent oracle: derive the evidence-effective firm straight from raw
  // non-superseded PCAOB Form AP rows. The candidate search and resolver both
  // read the materialized interval relation, so using only that relation as
  // expected truth would let a stale/corrupt refresh self-confirm.
  const rawRows: RawAuditorRow[] = [];
  const ciks = [...new Set(filings.map(filing => filing.cik))].sort((a, b) => a - b);
  const latestDate = filings.reduce(
    (latest, filing) => filing.date_filed > latest ? filing.date_filed : latest,
    '2017-01-01',
  );
  const chunkSize = 50;
  const pageSize = 1_000;
  for (let chunkStart = 0; chunkStart < ciks.length; chunkStart += chunkSize) {
    const chunk = ciks.slice(chunkStart, chunkStart + chunkSize);
    let chunkRows = 0;
    for (let offset = 0; offset < samplingDiagnostics.auditorRawRowHardCapPerChunk; offset += pageSize) {
      const { data: page, error: pageError } = await db
        .from('urc_sec_auditors')
        .select('form_filing_id,issuer_cik,is_latest,audit_report_date,audit_report_type,firm_canonical,filing_date')
        .in('issuer_cik', chunk)
        .eq('is_latest', true)
        .not('audit_report_date', 'is', null)
        .lte('audit_report_date', latestDate)
        .order('issuer_cik', { ascending: true })
        .order('audit_report_date', { ascending: true })
        .order('form_filing_id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (pageError) throw new Error(`raw Form AP truth query failed: ${pageError.message}`);
      if (!Array.isArray(page)) throw new Error('raw Form AP truth query returned no row array');
      const typedPage = page as unknown as RawAuditorRow[];
      rawRows.push(...typedPage);
      chunkRows += typedPage.length;
      samplingDiagnostics.auditorRawPages += 1;
      samplingDiagnostics.auditorRawRowsRead += typedPage.length;
      for (const row of typedPage) {
        samplingDiagnostics.auditorRawMaxFormFilingId = Math.max(
          samplingDiagnostics.auditorRawMaxFormFilingId,
          Number(row.form_filing_id) || 0,
        );
        if (
          row.filing_date
          && (!samplingDiagnostics.auditorRawMaxFilingDate || row.filing_date > samplingDiagnostics.auditorRawMaxFilingDate)
        ) {
          samplingDiagnostics.auditorRawMaxFilingDate = row.filing_date;
        }
      }
      if (typedPage.length < pageSize) break;
      if (chunkRows >= samplingDiagnostics.auditorRawRowHardCapPerChunk) {
        throw new Error(`raw Form AP truth exceeded ${samplingDiagnostics.auditorRawRowHardCapPerChunk} rows for a CIK chunk`);
      }
    }
  }

  const rawByCik = new Map<number, RawAuditorRow[]>();
  for (const row of rawRows) {
    const rows = rawByCik.get(Number(row.issuer_cik)) || [];
    rows.push(row);
    rawByCik.set(Number(row.issuer_cik), rows);
  }
  const rawTruth = new Map<string, AuditorTruthRow>();
  for (const filing of filings) {
    const derived = deriveRawAuditorTruth(filing.date_filed, rawByCik.get(filing.cik) || []);
    const key = auditorFilingKey(filing);
    rawTruth.set(key, {
      request_key: key,
      auditor: derived.auditor,
      auditor_resolution_status: derived.resolutionStatus,
      auditor_basis: derived.resolutionStatus === 'resolved' ? AUDITOR_BASIS : null,
    });
  }

  for (const filing of filings) {
    const key = auditorFilingKey(filing);
    const raw = rawTruth.get(key);
    const materialized = resolver.get(key);
    if (resolvedAuditor(raw) !== resolvedAuditor(materialized)) {
      samplingDiagnostics.auditorRawResolverMismatches += 1;
      throw new Error(
        `raw Form AP truth ${resolvedAuditor(raw) || raw?.auditor_resolution_status || 'missing'} `
        + `!= materialized resolver ${resolvedAuditor(materialized) || materialized?.auditor_resolution_status || 'missing'} for ${key}`,
      );
    }
  }
  return rawTruth;
}

function resolvedAuditor(truth: AuditorTruthRow | undefined): string | null {
  const auditor = String(truth?.auditor ?? '').trim();
  return truth?.auditor_resolution_status === 'resolved'
    && truth.auditor_basis === AUDITOR_BASIS
    && auditor.length > 0
    ? auditor
    : null;
}

function auditorIntervalId(period: AuditorPeriodRow): string {
  return `${period.issuer_cik}:${period.effective_from}`;
}

function assertDate(value: string, label: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid ISO filing date: ${value}`);
  }
}

function projectRawBoundaryAuditorRow(row: RawAuditorRow): RawBoundaryAuditorRowEvidence {
  return {
    formFilingId: row.form_filing_id,
    issuerCik: row.issuer_cik,
    auditReportDate: row.audit_report_date,
    auditReportType: row.audit_report_type,
    firmCanonical: row.firm_canonical,
    filingDate: row.filing_date,
    isLatest: true,
  };
}

async function directRawBoundaryEvent(
  period: AuditorPeriodRow,
): Promise<AuditorBoundaryIntervalEvidence['rawEvent']> {
  const { data, error } = await db
    .from('urc_sec_auditors')
    .select('form_filing_id,issuer_cik,is_latest,audit_report_date,audit_report_type,firm_canonical,filing_date')
    .eq('issuer_cik', period.issuer_cik)
    .eq('audit_report_date', period.effective_from)
    .eq('is_latest', true)
    .order('form_filing_id', { ascending: true });
  if (error) throw new Error(`raw boundary event query failed for ${auditorIntervalId(period)}: ${error.message}`);
  const rows = (data ?? []) as unknown as RawAuditorRow[];
  samplingDiagnostics.auditorBoundaryRawEventRowsRead += rows.length;
  const derived = deriveRawAuditorTruth(period.effective_from, rows);
  if (rows.length === 0 || derived.resolutionStatus !== 'resolved' || derived.auditor !== period.firm_canonical) {
    samplingDiagnostics.auditorBoundaryRawEventMismatches += 1;
    throw new Error(`raw boundary event does not reproduce ${auditorIntervalId(period)} / ${String(period.firm_canonical)}`);
  }
  if (rows.some(row => row.is_latest !== true)) {
    throw new Error(`raw boundary event returned a superseded row for ${auditorIntervalId(period)}`);
  }
  const projected = rows.map(projectRawBoundaryAuditorRow);
  return {
    source: 'urc_sec_auditors.direct-event',
    auditReportDate: period.effective_from,
    resolvedFirmName: derived.auditor,
    rows: projected,
    digest: createHash('sha256').update(JSON.stringify(projected)).digest('hex'),
  };
}

async function directRawBoundaryTransitionWitness(
  predecessor: AuditorPeriodRow,
  successor: AuditorPeriodRow,
): Promise<AuditorBoundaryRawTransitionWitness> {
  const fields = 'form_filing_id,issuer_cik,is_latest,audit_report_date,audit_report_type,firm_canonical,filing_date';
  const [rangeResult, nextResult] = await Promise.all([
    db.from('urc_sec_auditors')
      .select(fields, { count: 'exact' })
      .eq('issuer_cik', predecessor.issuer_cik)
      .eq('is_latest', true)
      .gte('audit_report_date', predecessor.effective_from)
      .lte('audit_report_date', successor.effective_from)
      .order('audit_report_date', { ascending: true })
      .order('form_filing_id', { ascending: true })
      .range(0, AUDITOR_BOUNDARY_RAW_RANGE_LIMIT - 1),
    db.from('urc_sec_auditors')
      .select(fields)
      .eq('issuer_cik', predecessor.issuer_cik)
      .eq('is_latest', true)
      .gt('audit_report_date', predecessor.effective_from)
      .order('audit_report_date', { ascending: true })
      .order('form_filing_id', { ascending: true })
      .limit(1),
  ]);
  if (rangeResult.error) {
    throw new Error(`raw boundary range query failed for ${auditorIntervalId(predecessor)}: ${rangeResult.error.message}`);
  }
  if (nextResult.error) {
    throw new Error(`raw boundary next-event query failed for ${auditorIntervalId(predecessor)}: ${nextResult.error.message}`);
  }
  const rows = (rangeResult.data ?? []) as unknown as RawAuditorRow[];
  const nextRows = (nextResult.data ?? []) as unknown as RawAuditorRow[];
  const exactRowCount = rangeResult.count;
  samplingDiagnostics.auditorBoundaryRawRangeRowsRead += rows.length;
  samplingDiagnostics.auditorBoundaryRawNextEventProbes += 1;
  const projected = rows.map(projectRawBoundaryAuditorRow);
  const eventDates = [...new Set(projected.map(row => row.auditReportDate))];
  const ids = projected.map(row => row.formFilingId);
  const next = nextRows[0];
  const successorIds = projected
    .filter(row => row.auditReportDate === successor.effective_from)
    .map(row => row.formFilingId);
  if (
    predecessor.issuer_cik !== successor.issuer_cik
    || predecessor.effective_to !== successor.effective_from
    || !Number.isSafeInteger(exactRowCount)
    || exactRowCount === null
    || exactRowCount <= 1
    || exactRowCount > AUDITOR_BOUNDARY_RAW_RANGE_LIMIT
    || rows.length !== exactRowCount
    || rows.some(row => (
      row.is_latest !== true
      || row.issuer_cik !== predecessor.issuer_cik
      || row.audit_report_date < predecessor.effective_from
      || row.audit_report_date > successor.effective_from
    ))
    || new Set(ids).size !== ids.length
    || eventDates.length !== 2
    || eventDates[0] !== predecessor.effective_from
    || eventDates[1] !== successor.effective_from
    || !next
    || next.is_latest !== true
    || next.issuer_cik !== predecessor.issuer_cik
    || next.audit_report_date !== successor.effective_from
    || successorIds.length === 0
    || next.form_filing_id !== Math.min(...successorIds)
  ) {
    samplingDiagnostics.auditorBoundaryRawRangeMismatches += 1;
    throw new Error(
      `raw Form AP range does not prove ${auditorIntervalId(successor)} is the immediate event after ${auditorIntervalId(predecessor)}`,
    );
  }
  const nextEventAfterPredecessor = {
    source: 'urc_sec_auditors.direct-next-event' as const,
    afterAuditReportDateExclusive: predecessor.effective_from,
    auditReportDate: successor.effective_from,
    firstFormFilingId: next.form_filing_id,
  };
  const digestPayload = {
    issuerCik: predecessor.issuer_cik,
    fromAuditReportDateInclusive: predecessor.effective_from,
    toAuditReportDateInclusive: successor.effective_from,
    exactRowCount,
    returnedRowCount: projected.length,
    complete: true as const,
    eventDates: eventDates as [string, string],
    rows: projected,
    nextEventAfterPredecessor,
  };
  return {
    contract: 'urc.raw-form-ap-transition-range.v1',
    source: 'urc_sec_auditors.direct-range+direct-next-event',
    ...digestPayload,
    digest: createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex'),
  };
}

function boundaryIntervalEvidence(
  period: AuditorPeriodRow,
  rawEvent: AuditorBoundaryIntervalEvidence['rawEvent'],
): AuditorBoundaryIntervalEvidence {
  if (!period.firm_canonical) throw new Error(`boundary interval ${auditorIntervalId(period)} has no firm`);
  return {
    intervalId: auditorIntervalId(period),
    issuerCik: period.issuer_cik,
    firmName: period.firm_canonical,
    effectiveFromInclusive: period.effective_from,
    effectiveToExclusive: period.effective_to,
    rawEvent,
  };
}

function auditorBoundarySelectionWindow(
  period: AuditorPeriodRow,
  currentYear: number,
): { fromInclusive: string; toExclusive: string } {
  const corpusStart = `${AUDITOR_START_YEAR}-01-01`;
  const corpusEnd = `${currentYear + 1}-01-01`;
  return {
    fromInclusive: period.effective_from < corpusStart ? corpusStart : period.effective_from,
    toExclusive: period.effective_to && period.effective_to < corpusEnd
      ? period.effective_to
      : corpusEnd,
  };
}

/**
 * Build the evidence only after proving both sampled filings satisfy the
 * materialized relation's half-open interval predicate. This prevents a
 * nearby filing from being labelled "before" or "after" merely because the
 * sampler happened to fetch it next to a transition.
 */
function buildAuditorBoundaryEvidence(
  predecessorRow: AuditorPeriodRow,
  successorRow: AuditorPeriodRow,
  before: FilingRow,
  after: FilingRow,
  currentYear: number,
  predecessorRawEvent: AuditorBoundaryIntervalEvidence['rawEvent'],
  successorRawEvent: AuditorBoundaryIntervalEvidence['rawEvent'],
  rawTransitionWitness: AuditorBoundaryRawTransitionWitness,
): { before: AuditorBoundaryCaseEvidence; after: AuditorBoundaryCaseEvidence } {
  const boundaryDate = predecessorRow.effective_to;
  assertDate(predecessorRow.effective_from, 'predecessor effective_from');
  assertDate(successorRow.effective_from, 'successor effective_from');
  assertDate(before.date_filed, 'before filing date');
  assertDate(after.date_filed, 'after filing date');
  if (predecessorRow.effective_to) assertDate(predecessorRow.effective_to, 'predecessor effective_to');
  if (successorRow.effective_to) assertDate(successorRow.effective_to, 'successor effective_to');
  if (
    predecessorRow.resolution_status !== 'resolved'
    || successorRow.resolution_status !== 'resolved'
    || !predecessorRow.firm_canonical
    || !successorRow.firm_canonical
  ) {
    throw new Error('auditor boundary evidence requires two resolved intervals with firms');
  }
  if (!boundaryDate || boundaryDate !== successorRow.effective_from) {
    throw new Error(
      `auditor boundary intervals are not adjacent: ${String(boundaryDate)} != ${successorRow.effective_from}`,
    );
  }
  if (predecessorRow.issuer_cik !== successorRow.issuer_cik) {
    throw new Error('auditor boundary intervals have different issuer CIKs');
  }
  if (predecessorRow.firm_canonical === successorRow.firm_canonical) {
    throw new Error('auditor boundary is not a firm transition');
  }
  if (predecessorRow.effective_from >= boundaryDate) {
    throw new Error('predecessor auditor interval is empty or reversed');
  }
  if (successorRow.effective_to && successorRow.effective_from >= successorRow.effective_to) {
    throw new Error('successor auditor interval is empty or reversed');
  }
  if (before.cik !== predecessorRow.issuer_cik || after.cik !== successorRow.issuer_cik) {
    throw new Error('auditor boundary filings do not belong to the transition issuer');
  }
  if (before.date_filed < predecessorRow.effective_from || before.date_filed >= boundaryDate) {
    throw new Error(
      `before filing ${before.accession} (${before.date_filed}) is outside `
      + `[${predecessorRow.effective_from}, ${boundaryDate})`,
    );
  }
  if (
    after.date_filed < successorRow.effective_from
    || (successorRow.effective_to !== null && after.date_filed >= successorRow.effective_to)
  ) {
    throw new Error(
      `after filing ${after.accession} (${after.date_filed}) is outside `
      + `[${successorRow.effective_from}, ${String(successorRow.effective_to)})`,
    );
  }
  if (auditorFilingKey(before) === auditorFilingKey(after)) {
    throw new Error('auditor boundary pair selected the same filing on both sides');
  }

  const predecessor = boundaryIntervalEvidence(predecessorRow, predecessorRawEvent);
  const successor = boundaryIntervalEvidence(successorRow, successorRawEvent);
  const witnessPredecessorRows = rawTransitionWitness.rows.filter(
    row => row.auditReportDate === predecessorRow.effective_from,
  );
  const witnessSuccessorRows = rawTransitionWitness.rows.filter(
    row => row.auditReportDate === successorRow.effective_from,
  );
  if (
    rawTransitionWitness.issuerCik !== predecessorRow.issuer_cik
    || rawTransitionWitness.fromAuditReportDateInclusive !== predecessorRow.effective_from
    || rawTransitionWitness.toAuditReportDateInclusive !== successorRow.effective_from
    || JSON.stringify(witnessPredecessorRows) !== JSON.stringify(predecessorRawEvent.rows)
    || JSON.stringify(witnessSuccessorRows) !== JSON.stringify(successorRawEvent.rows)
  ) {
    throw new Error('raw transition range is not identical to its endpoint event evidence');
  }
  const beforeSelectionWindow = auditorBoundarySelectionWindow(predecessorRow, currentYear);
  const afterSelectionWindow = auditorBoundarySelectionWindow(successorRow, currentYear);
  if (
    before.date_filed < beforeSelectionWindow.fromInclusive
    || before.date_filed >= beforeSelectionWindow.toExclusive
    || after.date_filed < afterSelectionWindow.fromInclusive
    || after.date_filed >= afterSelectionWindow.toExclusive
  ) {
    throw new Error('auditor boundary filing is outside the exact corpus-clamped selection window');
  }
  const pair = {
    before: {
      accession: before.accession,
      dateFiled: before.date_filed,
      intervalId: predecessor.intervalId,
    },
    after: {
      accession: after.accession,
      dateFiled: after.date_filed,
      intervalId: successor.intervalId,
    },
  };
  const pairId = createHash('sha256').update(JSON.stringify({
    boundaryDate,
    issuerCik: predecessorRow.issuer_cik,
    predecessorIntervalId: predecessor.intervalId,
    successorIntervalId: successor.intervalId,
    beforeAccession: before.accession,
    afterAccession: after.accession,
  })).digest('hex');
  const common = {
    contract: 'urc.auditor-boundary-selection.v1' as const,
    intervalIdScheme: 'issuer_cik:effective_from' as const,
    pairId,
    boundaryDate,
    issuerCik: predecessorRow.issuer_cik,
    predecessor,
    successor,
    rawTransitionWitness,
    pair,
  };
  return {
    before: {
      ...common,
      side: 'before',
      selection: {
        accession: before.accession,
        dateFiled: before.date_filed,
        selectedIntervalId: predecessor.intervalId,
        effectiveFromInclusive: predecessor.effectiveFromInclusive,
        effectiveToExclusive: predecessor.effectiveToExclusive,
        selectionWindow: beforeSelectionWindow,
        expectedFirmName: predecessor.firmName,
        reciprocalRejectedFirmName: successor.firmName,
        intervalPredicate: 'effectiveFromInclusive <= dateFiled AND (effectiveToExclusive IS NULL OR dateFiled < effectiveToExclusive)',
        selectionPredicate: 'selectionWindow.fromInclusive <= dateFiled < selectionWindow.toExclusive',
      },
    },
    after: {
      ...common,
      side: 'after',
      selection: {
        accession: after.accession,
        dateFiled: after.date_filed,
        selectedIntervalId: successor.intervalId,
        effectiveFromInclusive: successor.effectiveFromInclusive,
        effectiveToExclusive: successor.effectiveToExclusive,
        selectionWindow: afterSelectionWindow,
        expectedFirmName: successor.firmName,
        reciprocalRejectedFirmName: predecessor.firmName,
        intervalPredicate: 'effectiveFromInclusive <= dateFiled AND (effectiveToExclusive IS NULL OR dateFiled < effectiveToExclusive)',
        selectionPredicate: 'selectionWindow.fromInclusive <= dateFiled < selectionWindow.toExclusive',
      },
    },
  };
}

function assertBoundaryPointSemantics(
  filing: FilingRow,
  actualAuditor: string,
  boundary: AuditorBoundaryCaseEvidence | undefined,
  rejectedAuditor?: string,
): void {
  if (!boundary) return;
  if (
    boundary.selection.accession !== filing.accession
    || boundary.selection.dateFiled !== filing.date_filed
    || boundary.issuerCik !== filing.cik
  ) {
    throw new Error(`boundary oracle does not identify selected filing ${filing.accession}`);
  }
  if (boundary.selection.expectedFirmName !== actualAuditor) {
    throw new Error(`boundary oracle firm ${boundary.selection.expectedFirmName} != ${actualAuditor}`);
  }
  if (
    rejectedAuditor !== undefined
    && boundary.selection.reciprocalRejectedFirmName !== rejectedAuditor
  ) {
    throw new Error(
      `boundary reciprocal negative must reject ${boundary.selection.reciprocalRejectedFirmName}, not ${rejectedAuditor}`,
    );
  }
}

function auditorQuery(filing: FilingRow, auditor: string): string {
  const query = new URLSearchParams({
    cik: String(filing.cik),
    forms: filing.root_form.replace(/\/A$/i, ''),
    startdt: filing.date_filed,
    enddt: filing.date_filed,
    auditor,
    size: '100',
  });
  return `${BASE}/api/es-search?${query}`;
}

function auditorPositivePoint(
  filing: FilingRow,
  auditor: string,
  sampleKind: 'boundary-before' | 'boundary-after' | 'year-stratum',
  boundary?: AuditorBoundaryCaseEvidence,
): TestPoint {
  if ((sampleKind === 'year-stratum') === Boolean(boundary)) {
    throw new Error(`${sampleKind} point has inconsistent boundary evidence`);
  }
  assertBoundaryPointSemantics(filing, auditor, boundary);
  const target = {
    accession: filing.accession, cik: filing.cik, form: filing.root_form, dateFiled: filing.date_filed,
  };
  return {
    cls: 'B',
    criticalPath: 'auditor',
    label: `${sampleKind} ${filing.accession} ${filing.cik} -> ${auditor} as of ${filing.date_filed}`,
    url: auditorQuery(filing, auditor),
    expectedFiling: target,
    validatePage: json => validateFilingSearchPagePrecision(json, {
      cik: filing.cik, form: filing.root_form, dateFiled: filing.date_filed, auditor,
    }),
    oracleEvidence: {
      kind: 'auditor-target',
      polarity: 'positive',
      sampleKind,
      accession: filing.accession,
      cik: filing.cik,
      form: filing.root_form,
      dateFiled: filing.date_filed,
      auditor,
      resolutionStatus: 'resolved',
      basis: AUDITOR_BASIS,
      ...(boundary ? { boundaryOracle: boundary } : {}),
    },
    check: (json) => {
      const payload = json && typeof json === 'object'
        ? json as { hits?: { hits?: unknown } }
        : {};
      const hits = Array.isArray(payload.hits?.hits)
        ? payload.hits.hits as AuditorSearchHit[]
        : [];
      const hit = hits.find((candidate) => hitMatchesExpectedFiling(candidate, target));
      if (!hit) return `expected temporal-auditor filing ${filing.accession} missing from page`;
      if (String(hit._source?.auditor ?? '') !== auditor) {
        return `filing-date auditor ${String(hit._source?.auditor ?? 'missing')} != Form AP truth ${auditor}`;
      }
      if (String(hit._source?.file_date ?? '') !== filing.date_filed) {
        return `filing date ${String(hit._source?.file_date ?? 'missing')} != ${filing.date_filed}`;
      }
      return null;
    },
  };
}

function auditorNegativePoint(
  filing: FilingRow,
  actualAuditor: string,
  wrongAuditor: string,
  sampleKind: 'boundary-before' | 'boundary-after',
  boundary: AuditorBoundaryCaseEvidence,
): TestPoint {
  assertBoundaryPointSemantics(filing, actualAuditor, boundary, wrongAuditor);
  if (actualAuditor === wrongAuditor) {
    throw new Error('auditor boundary negative control cannot query the actual firm');
  }
  const target = {
    accession: filing.accession, cik: filing.cik, form: filing.root_form, dateFiled: filing.date_filed,
  };
  return {
    cls: 'B',
    criticalPath: 'auditor',
    label: `${sampleKind} negative ${filing.accession} ${filing.cik}: reject ${wrongAuditor}; truth ${actualAuditor}`,
    url: auditorQuery(filing, wrongAuditor),
    forbiddenFiling: target,
    validatePage: json => validateFilingSearchPagePrecision(json, {
      cik: filing.cik, form: filing.root_form, dateFiled: filing.date_filed, auditor: wrongAuditor,
    }),
    oracleEvidence: {
      kind: 'auditor-target',
      polarity: 'negative',
      sampleKind,
      accession: filing.accession,
      cik: filing.cik,
      form: filing.root_form,
      dateFiled: filing.date_filed,
      auditor: actualAuditor,
      rejectedAuditor: wrongAuditor,
      resolutionStatus: 'resolved',
      basis: AUDITOR_BASIS,
      boundaryOracle: boundary,
    },
    check: (json) => {
      const inspection = inspectFilingSearchPage(json, target);
      if (inspection.found) {
        return `wrong-firm filter ${wrongAuditor} leaked filing whose Form AP truth is ${actualAuditor}`;
      }
      if (inspection.total === null || inspection.relation === null) {
        return 'wrong-firm control did not report valid total coverage';
      }
      if (inspection.total !== 0 || inspection.received !== 0) {
        return `wrong-firm control returned ${inspection.received} hits (total ${inspection.total})`;
      }
      return null;
    },
  };
}

async function sampleFilings(perYear: number, years: number[]): Promise<FilingRow[]> {
  const rows = new Map<string, FilingRow>();
  for (const year of years) {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const { count, error: countError } = await db
      .from('urc_sec_filings')
      .select('accession', { count: 'exact', head: true })
      .gte('date_filed', start)
      .lte('date_filed', end);
    if (countError) throw new Error(`filing count sampling failed for ${year}: ${countError.message}`);
    if (count === null || !Number.isInteger(count) || count < 0) {
      throw new Error(`filing count sampling returned invalid count for ${year}: ${String(count)}`);
    }
    yearCounts.set(year, count ?? 0);
    if (!count) continue;
    // three random pockets per year so samples spread across the calendar
    const pockets = 3;
    for (let p = 0; p < pockets; p++) {
      const offset = Math.floor(rand() * Math.max(1, count - 400));
      const { data, error: pageError } = await db
        .from('urc_sec_filings')
        .select('accession, cik, company_name, root_form, date_filed')
        .gte('date_filed', start)
        .lte('date_filed', end)
        .order('accession')
        .range(offset, offset + 399);
      if (pageError) throw new Error(`filing page sampling failed for ${year}: ${pageError.message}`);
      if (!Array.isArray(data)) throw new Error(`filing page sampling returned no row array for ${year}`);
      const selected = sample(data as FilingRow[], Math.ceil(perYear / pockets));
      samplingDiagnostics.filingCandidatesRead += selected.length;
      for (const filing of selected) {
        const key = auditorFilingKey(filing);
        if (rows.has(key)) samplingDiagnostics.filingDuplicateReplacements += 1;
        else rows.set(key, filing);
      }
    }
  }
  return [...rows.values()];
}

// -------------------------------------------------------------- generation

async function generatePoints(): Promise<TestPoint[]> {
  const points: TestPoint[] = [];
  const nA = QUOTA_PLAN.classes.A;
  const nB = QUOTA_PLAN.classes.B;
  const nCsearch = QUOTA_PLAN.criticalPaths.topic;
  const nCthreads = QUOTA_PLAN.classes.C - nCsearch;
  const nD = QUOTA_PLAN.classes.D;
  const nE = QUOTA_PLAN.classes.E;
  const nF = QUOTA_PLAN.classes.F;

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
  // Fail CLOSED on empty ground truth (WP5): when the corpus DB is under
  // load or unreachable, the sampling queries come back empty and the old
  // behavior was to generate a degenerate suite — zero class-A points and
  // auditor cases with literally undefined years (observed: startdt=
  // "undefined-01-01" → HTTP 400 for every class-B case). A suite that
  // cannot see its ground truth must refuse to run, not measure noise.
  if (filingsA.length === 0) {
    throw new Error('Ground-truth sampling returned no filings — corpus DB unreachable or under load. Refusing to generate a degenerate suite; re-run when the database is responsive.');
  }
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
      expectedFiling: {
        accession: f.accession, cik: f.cik, form: f.root_form, dateFiled: f.date_filed,
      },
      validatePage: json => validateFilingSearchPagePrecision(json, {
        cik: f.cik,
        form: f.root_form,
        dateFiled: f.date_filed,
        entityName: f.company_name.slice(0, 40),
      }),
      oracleEvidence: {
        kind: 'filing-target',
        source: 'urc_sec_filings',
        accession: f.accession,
        cik: f.cik,
        form: f.root_form,
        dateFiled: f.date_filed,
        companyName: f.company_name,
      },
      check: () => null,
    });
  }

  // --- Class B: filing-date-effective auditor truth -----------------------
  // Every year from the beginning of Form AP coverage through the current
  // year has a fixed share of the denominator. Transition controls are drawn
  // first, then ordinary resolved filings fill the remaining per-year slots.
  // Missing strata and missing transition controls are fatal below.
  const auditorCurrentYear = new Date().getUTCFullYear();
  const auditorYears = Array.from(
    { length: auditorCurrentYear - AUDITOR_START_YEAR + 1 },
    (_, index) => AUDITOR_START_YEAR + index,
  );
  if (auditorYears.length > nB) {
    throw new Error(`Class B quota ${nB} cannot cover ${auditorYears.length} annual strata`);
  }
  const yearTargets = Object.fromEntries(auditorYears.map((year, index) => [
    String(year),
    Math.floor(nB / auditorYears.length) + (index < nB % auditorYears.length ? 1 : 0),
  ])) as Record<string, number>;
  const yearGenerated = Object.fromEntries(auditorYears.map((year) => [String(year), 0])) as Record<string, number>;
  const yearPositiveGenerated = Object.fromEntries(
    auditorYears.map((year) => [String(year), 0]),
  ) as Record<string, number>;
  const yearNegativeGenerated = Object.fromEntries(
    auditorYears.map((year) => [String(year), 0]),
  ) as Record<string, number>;
  const boundaryPairTarget = Math.max(1, Math.min(10, Math.floor(nB / 15)));
  const usedAuditorFilings = new Set<string>();

  samplingDiagnostics.auditorYears = [...auditorYears];
  samplingDiagnostics.auditorYearTargets = yearTargets;
  samplingDiagnostics.auditorYearGenerated = yearGenerated;
  samplingDiagnostics.auditorYearPositiveGenerated = yearPositiveGenerated;
  samplingDiagnostics.auditorYearNegativeGenerated = yearNegativeGenerated;
  samplingDiagnostics.auditorCandidateHardCap = auditorYears.length * AUDITOR_YEAR_CANDIDATE_CAP;
  samplingDiagnostics.auditorBoundaryPairTarget = boundaryPairTarget;
  samplingDiagnostics.auditorBoundaryPredecessorHardCap =
    auditorYears.length * AUDITOR_BOUNDARY_PREDECESSOR_CAP_PER_YEAR;

  const incrementYear = (filing: FilingRow, kind: 'positive' | 'negative') => {
    const year = String(filingYear(filing));
    yearGenerated[year] = (yearGenerated[year] ?? 0) + 1;
    if (kind === 'positive') yearPositiveGenerated[year] = (yearPositiveGenerated[year] ?? 0) + 1;
    else yearNegativeGenerated[year] = (yearNegativeGenerated[year] ?? 0) + 1;
  };
  const addPositive = (
    filing: FilingRow,
    auditor: string,
    kind: 'boundary-before' | 'boundary-after' | 'year-stratum',
    boundary?: AuditorBoundaryCaseEvidence,
  ) => {
    points.push(auditorPositivePoint(filing, auditor, kind, boundary));
    samplingDiagnostics.auditorPositiveCases += 1;
    incrementYear(filing, 'positive');
  };
  const addNegative = (
    filing: FilingRow,
    actualAuditor: string,
    wrongAuditor: string,
    kind: 'boundary-before' | 'boundary-after',
    boundary: AuditorBoundaryCaseEvidence,
  ) => {
    points.push(auditorNegativePoint(filing, actualAuditor, wrongAuditor, kind, boundary));
    samplingDiagnostics.auditorNegativeControls += 1;
    incrementYear(filing, 'negative');
  };
  const hasYearCapacity = (filings: FilingRow[]) => {
    const deltas = new Map<number, number>();
    for (const filing of filings) {
      const year = filingYear(filing);
      deltas.set(year, (deltas.get(year) ?? 0) + 2); // positive + reciprocal negative
    }
    return [...deltas].every(([year, delta]) => (
      yearGenerated[String(year)] != null
      && yearGenerated[String(year)] + delta <= yearTargets[String(year)]
    ));
  };

  // Explicit firm-change boundaries come from consecutive rows in the
  // materialized Form AP period relation. Query predecessor intervals by the
  // year in which they end, then look up their exact successor row. The
  // round-robin ordering prevents a single recent year from consuming all
  // boundary controls.
  const predecessorsByYear = new Map<number, AuditorPeriodRow[]>();
  for (const year of auditorYears) {
    const { data, error } = await db
      .from('urc_auditor_periods_mat')
      .select('issuer_cik,effective_from,effective_to,resolution_status,firm_canonical')
      .eq('resolution_status', 'resolved')
      .not('firm_canonical', 'is', null)
      .gte('effective_to', `${year}-01-01`)
      .lt('effective_to', `${year + 1}-01-01`)
      .order('effective_to', { ascending: true })
      .order('issuer_cik', { ascending: true })
      .limit(AUDITOR_BOUNDARY_PREDECESSOR_CAP_PER_YEAR);
    if (error) throw new Error(`auditor-boundary predecessor query failed for ${year}: ${error.message}`);
    const rows = (data ?? []) as unknown as AuditorPeriodRow[];
    predecessorsByYear.set(year, rows);
    samplingDiagnostics.auditorBoundaryPredecessorsExamined += rows.length;
  }
  const predecessorCandidates: AuditorPeriodRow[] = [];
  for (let index = 0; index < AUDITOR_BOUNDARY_PREDECESSOR_CAP_PER_YEAR; index += 1) {
    for (const year of auditorYears) {
      const predecessor = predecessorsByYear.get(year)?.[index];
      if (predecessor) predecessorCandidates.push(predecessor);
    }
  }

  const intervalFilings = async (
    period: AuditorPeriodRow,
    ascending: boolean,
  ): Promise<FilingRow[]> => {
    const { fromInclusive: start, toExclusive: end } = auditorBoundarySelectionWindow(
      period,
      auditorCurrentYear,
    );
    if (start >= end) return [];
    const { data, error } = await db
      .from('urc_sec_filings')
      .select('accession,cik,company_name,root_form,date_filed')
      .eq('cik', period.issuer_cik)
      .gte('date_filed', start)
      .lt('date_filed', end)
      .order('date_filed', { ascending })
      .order('accession', { ascending: true })
      .limit(AUDITOR_BOUNDARY_SIDE_CANDIDATE_LIMIT);
    if (error) throw new Error(`auditor-boundary filing query failed for CIK ${period.issuer_cik}: ${error.message}`);
    const rows = (data ?? []) as unknown as FilingRow[];
    samplingDiagnostics.auditorBoundaryCandidatesExamined += rows.length;
    return rows;
  };

  for (const previous of predecessorCandidates) {
    if (samplingDiagnostics.auditorBoundaryPairsGenerated >= boundaryPairTarget) break;
    if (samplingDiagnostics.auditorBoundaryTransitionsExamined >= AUDITOR_BOUNDARY_TRANSITION_HARD_CAP) break;
    const boundaryDate = previous.effective_to;
    if (!boundaryDate || !previous.firm_canonical) continue;
    samplingDiagnostics.auditorBoundaryTransitionsExamined += 1;
    const { data: successorData, error: successorError } = await db
      .from('urc_auditor_periods_mat')
      .select('issuer_cik,effective_from,effective_to,resolution_status,firm_canonical')
      .eq('issuer_cik', previous.issuer_cik)
      .eq('effective_from', boundaryDate)
      .limit(1);
    if (successorError) {
      throw new Error(`auditor-boundary successor query failed for CIK ${previous.issuer_cik}: ${successorError.message}`);
    }
    const successor = ((successorData ?? []) as unknown as AuditorPeriodRow[])[0];
    if (
      !successor
      || successor.resolution_status !== 'resolved'
      || !successor.firm_canonical
      || successor.firm_canonical === previous.firm_canonical
    ) {
      samplingDiagnostics.auditorBoundaryRejected += 1;
      continue;
    }

    const beforeCandidates = await intervalFilings(previous, false);
    const afterCandidates = await intervalFilings(successor, true);
    const truthByKey = await resolveAuditorTruth([...beforeCandidates, ...afterCandidates]);
    const scoreableBefore = beforeCandidates.filter((filing) => {
      const auditor = resolvedAuditor(truthByKey.get(auditorFilingKey(filing)));
      if (!auditor) samplingDiagnostics.auditorUnresolvedReplacements += 1;
      return auditor === previous.firm_canonical && !usedAuditorFilings.has(auditorFilingKey(filing));
    });
    const scoreableAfter = afterCandidates.filter((filing) => {
      const auditor = resolvedAuditor(truthByKey.get(auditorFilingKey(filing)));
      if (!auditor) samplingDiagnostics.auditorUnresolvedReplacements += 1;
      return auditor === successor.firm_canonical && !usedAuditorFilings.has(auditorFilingKey(filing));
    });

    let selected: [FilingRow, FilingRow] | null = null;
    for (const before of scoreableBefore) {
      for (const after of scoreableAfter) {
        if (hasYearCapacity([before, after])) {
          selected = [before, after];
          break;
        }
      }
      if (selected) break;
    }
    if (!selected) {
      samplingDiagnostics.auditorBoundaryRejected += 1;
      continue;
    }

    const [before, after] = selected;
    const [predecessorRawEvent, successorRawEvent, rawTransitionWitness] = await Promise.all([
      directRawBoundaryEvent(previous),
      directRawBoundaryEvent(successor),
      directRawBoundaryTransitionWitness(previous, successor),
    ]);
    const boundaryEvidence = buildAuditorBoundaryEvidence(
      previous,
      successor,
      before,
      after,
      auditorCurrentYear,
      predecessorRawEvent,
      successorRawEvent,
      rawTransitionWitness,
    );
    addPositive(before, previous.firm_canonical, 'boundary-before', boundaryEvidence.before);
    addNegative(
      before,
      previous.firm_canonical,
      successor.firm_canonical,
      'boundary-before',
      boundaryEvidence.before,
    );
    addPositive(after, successor.firm_canonical, 'boundary-after', boundaryEvidence.after);
    addNegative(
      after,
      successor.firm_canonical,
      previous.firm_canonical,
      'boundary-after',
      boundaryEvidence.after,
    );
    usedAuditorFilings.add(auditorFilingKey(before));
    usedAuditorFilings.add(auditorFilingKey(after));
    samplingDiagnostics.auditorBoundaryPairsGenerated += 1;
  }

  // Fill each annual stratum with independently selected SEC filings. The
  // temporal resolver remains the sole expected-value oracle, and candidates
  // skipped for ambiguity/no-prior-Form-AP remain visible in diagnostics.
  for (const year of auditorYears) {
    const yearKey = String(year);
    if (yearGenerated[yearKey] >= yearTargets[yearKey]) continue;
    const { data, error } = await db
      .from('urc_sec_filings')
      .select('accession,cik,company_name,root_form,date_filed')
      .gte('date_filed', `${year}-01-01`)
      .lt('date_filed', `${year + 1}-01-01`)
      .order('date_filed', { ascending: true })
      .order('accession', { ascending: true })
      .limit(AUDITOR_YEAR_CANDIDATE_CAP);
    if (error) throw new Error(`temporal auditor stratum query failed for ${year}: ${error.message}`);
    const candidates = (data ?? []) as unknown as FilingRow[];
    samplingDiagnostics.auditorCandidatePages += 1;
    samplingDiagnostics.auditorCandidatesExamined += candidates.length;
    const truthByKey = await resolveAuditorTruth(candidates);
    for (const filing of candidates) {
      if (yearGenerated[yearKey] >= yearTargets[yearKey]) break;
      const key = auditorFilingKey(filing);
      if (usedAuditorFilings.has(key)) {
        samplingDiagnostics.auditorDuplicateReplacements += 1;
        continue;
      }
      const auditor = resolvedAuditor(truthByKey.get(key));
      if (!auditor) {
        samplingDiagnostics.auditorUnresolvedReplacements += 1;
        continue;
      }
      addPositive(filing, auditor, 'year-stratum');
      usedAuditorFilings.add(key);
    }
  }

  const classBGenerated = samplingDiagnostics.auditorPositiveCases
    + samplingDiagnostics.auditorNegativeControls;
  const temporalShortfalls: string[] = [];
  if (samplingDiagnostics.auditorBoundaryPairsGenerated !== boundaryPairTarget) {
    temporalShortfalls.push(
      `boundary pairs ${samplingDiagnostics.auditorBoundaryPairsGenerated}/${boundaryPairTarget}`,
    );
  }
  if (samplingDiagnostics.auditorNegativeControls !== boundaryPairTarget * 2) {
    temporalShortfalls.push(
      `wrong-firm controls ${samplingDiagnostics.auditorNegativeControls}/${boundaryPairTarget * 2}`,
    );
  }
  for (const year of auditorYears) {
    if (yearGenerated[String(year)] !== yearTargets[String(year)]) {
      temporalShortfalls.push(
        `${year} stratum ${yearGenerated[String(year)]}/${yearTargets[String(year)]}`,
      );
    }
  }
  if (classBGenerated !== nB) temporalShortfalls.push(`Class B ${classBGenerated}/${nB}`);
  if (temporalShortfalls.length > 0) {
    throw new Error(
      `Class B temporal sampling quota was not filled within hard caps: ${temporalShortfalls.join('; ')}; `
      + `diagnostics=${JSON.stringify(samplingDiagnostics)}`,
    );
  }

  // --- Class C1: thread details — every thread must return its letters
  // Ground truth comes directly from the corpus, not from the candidate route
  // that is about to be tested. Using /api/letters both to choose a thread and
  // to assert its count was circular and could self-confirm the same bug.
  const THREAD_ORACLE_LETTER_CAP = 200;
  const { data: threadData, error: threadError } = await db.rpc('urc_recent_threads', {
    p_limit: Math.min(nCthreads * 2, 200),
    p_offset: 0,
    p_company: null,
    p_cik: null,
  });
  if (threadError) throw new Error(`comment-letter ground-truth query failed: ${threadError.message}`);
  const threads = (threadData ?? []) as Array<Record<string, unknown>>;
  for (const t of sample(threads, nCthreads)) {
    const id = String(t.thread_id ?? t.id ?? '');
    const expected = Number(t.letters);
    if (!id || !Number.isInteger(expected) || expected <= 0 || expected > THREAD_ORACLE_LETTER_CAP) continue;
    const { data: expectedRows, error: detailError } = await db
      .from('urc_comment_letters')
      .select('accession,cik,form,date_filed,filename,review_key')
      .eq('thread_id', id)
      .order('date_filed', { ascending: true })
      .order('form', { ascending: false })
      .order('accession', { ascending: true })
      .limit(THREAD_ORACLE_LETTER_CAP + 1);
    if (detailError) throw new Error(`direct comment-letter truth failed for ${id}: ${detailError.message}`);
    const expectedLetters = ((expectedRows ?? []) as Array<Record<string, unknown>>).map(row => ({
      accession: String(row.accession ?? ''),
      cik: String(row.cik ?? ''),
      form: String(row.form ?? ''),
      date_filed: String(row.date_filed ?? ''),
      filename: String(row.filename ?? ''),
      review_key: typeof row.review_key === 'string' ? row.review_key : null,
    }));
    if (expectedLetters.length !== expected) {
      throw new Error(`thread ${id} detail rows ${expectedLetters.length} != independent thread count ${expected}`);
    }
    points.push({
      cls: 'C',
      label: `thread ${id}`,
      url: `${BASE}/api/letters?thread=${encodeURIComponent(id)}`,
      oracleEvidence: {
        kind: 'thread-direct-table',
        threadId: id,
        letters: expectedLetters,
      },
      check: (json) => validateThreadDetails(id, expectedLetters, json),
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
    const expectedForm = i % 2 === 0 ? undefined : 'UPLOAD';
    const form = expectedForm ? '&form=UPLOAD' : '';
    const truth = await loadTopicTruth(topic, expectedForm);
    points.push({
      cls: 'C',
      criticalPath: 'topic',
      label: `search "${topic}"${form ? ' UPLOAD' : ''}`,
      url: `${BASE}/api/letters?q=${encodeURIComponent(topic)}${form}&size=10`,
      oracleEvidence: {
        kind: 'topic-direct-fts',
        topic,
        form: expectedForm ?? null,
        total: truth.total,
        pageSize: truth.pageSize,
        poolDepth: truth.poolDepth,
        matches: truth.matches,
        countSource: truth.countSource,
        rankSource: truth.rankSource,
        predicateSource: truth.predicateSource,
        predicateEvidenceSha256: truth.predicateEvidenceSha256,
        rankingClaim: {
          contract: 'urc.topic-ranking-claim.v1',
          claimLevel: 'independent-fts-membership-pool',
          topKIdentityClaimed: false,
          rankEquivalenceClaimed: false,
          productRpcUsedAsOracle: false,
          independentSource: 'urc_comment_letters.direct-table-fts',
          directPoolOrder: [
            { field: 'date_filed', direction: 'desc' },
            { field: 'accession', direction: 'asc' },
            { field: 'cik', direction: 'asc' },
          ],
          poolDepth: truth.poolDepth,
        },
      },
      check: (json) => validateTopicSearchResult(topic, json, expectedForm, truth),
    });
  }

  // --- Class D: EFTS full-text — find the known filing by company text
  const dYears = years.filter((y) => y >= 2010);
  const D_FORMS = ['10-K', '10-Q', '8-K', 'DEF 14A', 'S-1'];
  // D gets its OWN draw. It used to filter class A's already-drawn pool, so
  // whatever survived the form filter was all D got — the class-gate's first
  // live run caught it at 129 of ~146 planned (the same silent-shortfall
  // disease the audit found in B, different vector). Top up with dedicated
  // oversampled draws until the plan is filled or the budget is spent.
  const filingsD: FilingRow[] = filingsA.filter((f) => D_FORMS.includes(f.root_form));
  for (let round = 0; round < 4 && filingsD.length < nD; round++) {
    const extra = await sampleFilings(Math.ceil((nD * 2) / years.length), years);
    const have = new Set(filingsD.map((f) => f.accession));
    for (const f of extra) {
      if (D_FORMS.includes(f.root_form) && !have.has(f.accession)) {
        filingsD.push(f);
        have.add(f.accession);
      }
    }
  }
  if (filingsD.length < nD) {
    console.log(`Class D: SAMPLING SHORTFALL — ${filingsD.length} of ${nD} planned cases after top-up rounds`);
  }
  const filingsDFinal = sample(filingsD, nD);
  const GENERIC = new Set([
    'GROUP', 'INC', 'CORP', 'COMPANY', 'HOLDINGS', 'HOLDING', 'INTERNATIONAL',
    'INDUSTRIES', 'TRUST', 'FUND', 'CAPITAL', 'FINANCIAL', 'TECHNOLOGIES',
    'ENTERPRISES', 'PARTNERS', 'RESOURCES', 'SYSTEMS', 'BANCORP', 'THE',
    'CORPORATION', 'LTD', 'LLC', 'PLC', 'CO', 'NEW', 'FIRST', 'GLOBAL',
  ]);
  for (const f of filingsDFinal) {
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
      expectedFiling: {
        accession: f.accession, cik: f.cik, form: f.root_form, dateFiled: f.date_filed,
      },
      validatePage: json => validateFilingSearchPagePrecision(json, {
        form: f.root_form,
        dateFiled: f.date_filed,
        queryToken: nameToken,
      }),
      oracleEvidence: {
        kind: 'filing-text-target',
        source: 'urc_sec_filings+SEC_EFTS',
        accession: f.accession,
        cik: f.cik,
        form: f.root_form,
        dateFiled: f.date_filed,
        queryToken: nameToken,
      },
      check: () => null,
    });
  }
  void dYears;

  const officialCompanies = await officialCompanyTickers();

  // --- Class F: entity searchability — positive exact targets plus bounded
  // wrong-entity controls that fail if entityName is silently ignored.
  // ticker directory must return filings via the deployed entity path.
  // Guards the "Organon was silently unsearchable" class of failure.
  // Use an independently sampled corpus filing as the expected relation. An
  // arbitrary listed entity may legitimately have no filing in the owned
  // corpus; accepting any hit for a similar name made that ambiguity pass.
  const entityCandidates = new Map<string, FilingRow>();
  const addEntityCandidates = (rows: FilingRow[]) => {
    for (const row of rows) {
      if (!entityCandidates.has(row.accession)) entityCandidates.set(row.accession, row);
    }
  };
  addEntityCandidates(filingsA);
  const entityNegativeControls = Math.min(20, Math.floor(nF / 4));
  const entityPositiveTarget = nF - entityNegativeControls;
  for (let round = 0; round < 4 && entityCandidates.size < entityPositiveTarget; round += 1) {
    addEntityCandidates(await sampleFilings(Math.ceil((nF * 2) / years.length), years));
  }
  const entityFilings = sample([...entityCandidates.values()], entityPositiveTarget);
  for (const [index, f] of entityFilings.entries()) {
    const qs = new URLSearchParams({
      entityName: f.company_name.slice(0, 60),
      forms: f.root_form,
      startdt: f.date_filed,
      enddt: f.date_filed,
      size: '100',
    });
    points.push({
      cls: 'F',
      label: `entity ${f.company_name.slice(0, 30)} → ${f.accession}`,
      url: `${BASE}/api/es-search?${qs}`,
      expectedFiling: {
        accession: f.accession, cik: f.cik, form: f.root_form, dateFiled: f.date_filed,
      },
      validatePage: json => validateFilingSearchPagePrecision(json, {
        cik: f.cik,
        form: f.root_form,
        dateFiled: f.date_filed,
        entityName: f.company_name.slice(0, 60),
      }),
      oracleEvidence: {
        kind: 'entity-target',
        polarity: 'positive',
        accession: f.accession,
        cik: f.cik,
        form: f.root_form,
        dateFiled: f.date_filed,
        entityName: f.company_name.slice(0, 60),
      },
      check: () => null,
    });
    if (index < entityNegativeControls) {
      let wrong = officialCompanies[(index * 7_919) % officialCompanies.length];
      let cursor = 0;
      while (
        (
          wrong.cik === f.cik
          || !wrong.title
          || !isDisjointEntityNameControl(f.company_name, wrong.title.slice(0, 60))
        )
        && cursor < officialCompanies.length
      ) {
        cursor += 1;
        wrong = officialCompanies[(index * 7_919 + cursor) % officialCompanies.length];
      }
      if (
        wrong.cik === f.cik
        || !wrong.title
        || !isDisjointEntityNameControl(f.company_name, wrong.title.slice(0, 60))
      ) continue;
      const negativeQuery = new URLSearchParams({
        entityName: wrong.title.slice(0, 60),
        forms: f.root_form,
        startdt: f.date_filed,
        enddt: f.date_filed,
        size: '100',
      });
      points.push({
        cls: 'F',
        label: `wrong entity ${wrong.cik} must exclude ${f.accession}/${f.cik}`,
        url: `${BASE}/api/es-search?${negativeQuery}`,
        forbiddenFiling: {
          accession: f.accession, cik: f.cik, form: f.root_form, dateFiled: f.date_filed,
        },
        validatePage: json => validateFilingSearchPagePrecision(json, {
          cik: wrong.cik,
          form: f.root_form,
          dateFiled: f.date_filed,
          entityName: wrong.title.slice(0, 60),
        }),
        oracleEvidence: {
          kind: 'entity-target',
          polarity: 'negative',
          accession: f.accession,
          cik: f.cik,
          form: f.root_form,
          dateFiled: f.date_filed,
          targetEntityName: f.company_name,
          disjointControlCik: wrong.cik,
          disjointControlName: wrong.title.slice(0, 60),
        },
        check: () => null,
      });
    }
  }

  // --- Class E: enrichment — expected CIK/tickers come from SEC's official
  // directory, not the urc_sec_companies table read by the candidate route.
  const batches = sample(officialCompanies, Math.min(nE * 10, officialCompanies.length));
  for (let i = 0; i < nE; i++) {
    const group = batches.slice(i * 10, i * 10 + 10);
    if (group.length === 0) break;
    const ciks = group.map((company) => company.cik).join(',');
    points.push({
      cls: 'E',
      label: `enrich ${group.length} official SEC ciks`,
      url: `${BASE}/api/enrich?ciks=${ciks}`,
      oracleEvidence: {
        kind: 'official-sec-ticker-set',
        source: 'https://www.sec.gov/files/company_tickers.json',
        companies: group,
      },
      check: (json) => validateCompanyEnrichment(group, json),
    });
  }

  const generated = Object.fromEntries(
    (['A', 'B', 'C', 'D', 'E', 'F'] as const).map(cls => [cls, points.filter(point => point.cls === cls).length]),
  );
  const generatedCritical = {
    auditor: points.filter(point => point.criticalPath === 'auditor').length,
    topic: points.filter(point => point.criticalPath === 'topic').length,
  };
  const shortfalls = quotaShortfalls(QUOTA_PLAN, generated, generatedCritical);
  if (shortfalls.length > 0) {
    throw new Error(`Accuracy sampling quota was not filled within its hard caps: ${shortfalls.join('; ')}`);
  }

  return points;
}

// ---------------------------------------------------------------- runner

async function runOne(p: TestPoint): Promise<Result> {
  const t0 = performance.now();
  const statusHistory: number[] = [];
  let pages = 0;
  let examined = 0;
  const observedPages: Result['observation']['pages'] = [];
  let lastRequestPath = '';
  const negativeSeenIdentities = new Set<string>();
  let negativeExactTotal: number | null = null;
  try {
    const nextUrl = new URL(p.url);
    const maxTargetPages = p.cls === 'B' ? 1 : MAX_TARGET_PAGES;

    while (true) {
      lastRequestPath = `${nextUrl.pathname}${nextUrl.search}`;
      pages += 1;
      const fetched = await candidateFetchWithRetry(nextUrl.toString());
      const res = fetched.response;
      statusHistory.push(...fetched.statusHistory);
      const ms = performance.now() - t0;
      const responseText = await res.text();
      observedPages.push({
        requestPath: lastRequestPath,
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        payloadBytes: Buffer.byteLength(responseText),
        payloadSha256: createHash('sha256').update(responseText).digest('hex'),
        projection: null,
        projectionSha256: createHash('sha256').update('null').digest('hex'),
      });
      if (!res.ok) {
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory, failure: `HTTP ${res.status}`, pages, examined,
          observation: { pages: observedPages },
        };
      }

      const json = JSON.parse(responseText) as unknown;
      const projection = boundedCandidateProjection(p.cls, json);
      observedPages[observedPages.length - 1].projection = projection;
      observedPages[observedPages.length - 1].projectionSha256 = createHash('sha256')
        .update(JSON.stringify(projection))
        .digest('hex');
      const pageFailure = p.validatePage?.(json) ?? null;
      if (pageFailure) {
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory, failure: pageFailure, pages, examined,
          observation: { pages: observedPages },
        };
      }
      const target = p.expectedFiling || p.forbiddenFiling;
      if (!target) {
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory, failure: await p.check(json), pages, examined,
          observation: { pages: observedPages },
        };
      }

      const inspection = inspectFilingSearchPage(json, target);
      examined += inspection.received;
      if (p.forbiddenFiling && inspection.found) {
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory,
          failure: `forbidden target ${target.accession}/${String(target.cik ?? '')} leaked through negative filter`,
          pages, examined, observation: { pages: observedPages },
        };
      }
      if (p.forbiddenFiling) {
        const pageSize = Number(nextUrl.searchParams.get('size') || inspection.received);
        const from = Number(nextUrl.searchParams.get('from') || 0);
        const pageProblem = completeFilingSearchPageProblem(inspection, from, pageSize);
        if (pageProblem) {
          return {
            cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
            status: res.status, statusHistory,
            failure: `forbidden-target absence proof is incomplete: ${pageProblem}`,
            pages, examined, observation: { pages: observedPages },
          };
        }
        if (negativeExactTotal !== null && inspection.total !== negativeExactTotal) {
          return {
            cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
            status: res.status, statusHistory,
            failure: `forbidden-target exact total changed from ${negativeExactTotal} to ${inspection.total}`,
            pages, examined, observation: { pages: observedPages },
          };
        }
        negativeExactTotal = inspection.total;
        if (inspection.identities.some(identity => negativeSeenIdentities.has(identity))) {
          return {
            cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
            status: res.status, statusHistory,
            failure: 'forbidden-target absence proof repeats a filing identity across pages',
            pages, examined, observation: { pages: observedPages },
          };
        }
        inspection.identities.forEach(identity => negativeSeenIdentities.add(identity));
      }
      if (inspection.found) {
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory, failure: await p.check(json), pages, examined,
          observation: { pages: observedPages },
        };
      }

      if (inspection.total === null || inspection.relation === null) {
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory,
          failure: `search did not report valid total coverage for target ${target.accession}`,
          pages, examined, observation: { pages: observedPages },
        };
      }
      if (inspection.received === 0) {
        const currentFrom = Number(nextUrl.searchParams.get('from') || 0);
        const absenceProven = inspection.relation === 'eq'
          && (inspection.total === 0 || currentFrom >= inspection.total);
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory,
          failure: p.forbiddenFiling && absenceProven
            ? await p.check(json)
            : p.forbiddenFiling
              ? `absence of forbidden target ${target.accession} was not proven by an empty page with reported total ${inspection.total}`
              : `target ${target.accession} absent after ${examined} examined hits`,
          pages, examined, observation: { pages: observedPages },
        };
      }

      const pageSize = Number(nextUrl.searchParams.get('size') || inspection.received);
      const from = Number(nextUrl.searchParams.get('from') || 0);
      const nextFrom = from + pageSize;
      const knownExhausted = inspection.relation === 'eq' && nextFrom >= inspection.total;
      if (p.forbiddenFiling && knownExhausted) {
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory, failure: await p.check(json), pages, examined,
          observation: { pages: observedPages },
        };
      }
      if (knownExhausted || pages >= maxTargetPages || nextFrom > 10_000) {
        const boundary = knownExhausted
          ? `all ${inspection.total} reported hits`
          : `${maxTargetPages}-page/${examined}-hit hard cap`;
        return {
          cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms,
          status: res.status, statusHistory,
          failure: p.forbiddenFiling
            ? `absence of forbidden target ${target.accession} was not proven within ${boundary}`
            : `target ${target.accession} not found within ${boundary}`,
          pages, examined, observation: { pages: observedPages },
        };
      }
      nextUrl.searchParams.set('from', String(nextFrom));
      // Class D pages trigger server-side EFTS work. Pace *within* a paginated
      // case as well as between cases; otherwise two workers can burst ten
      // consecutive candidate requests before runPool's spacing runs.
      if (p.cls === 'D') await new Promise(resolve => setTimeout(resolve, 350));
    }
  } catch (e) {
    if (e instanceof CandidateFetchError) statusHistory.push(...e.statusHistory);
    if (statusHistory[statusHistory.length - 1] !== 0) statusHistory.push(0);
    if (observedPages.length < pages) {
      const failureBody = e instanceof Error ? e.message : String(e);
      observedPages.push({
        requestPath: lastRequestPath,
        status: 0,
        contentType: '',
        payloadBytes: Buffer.byteLength(failureBody),
        payloadSha256: createHash('sha256').update(failureBody).digest('hex'),
        projection: null,
        projectionSha256: createHash('sha256').update('null').digest('hex'),
      });
    }
    return {
      cls: p.cls, criticalPath: p.criticalPath, label: p.label, ms: performance.now() - t0, status: 0, statusHistory,
      failure: `request error: ${e instanceof Error ? e.message : String(e)}`, pages, examined,
      observation: { pages: observedPages },
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
      const result = await runOne(p);
      result.caseId = p.caseId;
      results.push(result);
      done++;
      if (done % 50 === 0) console.log(`  ...${done}/${points.length}`);
      if (spacingMs) await new Promise((r) => setTimeout(r, spacingMs));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// ------------------------------------------------------------------ main

(async () => {
  console.log(`Target: ${BASE}  |  points: ${TOTAL}`);
  const points = await generatePoints();
  points.forEach((point, index) => {
    point.caseId = `${point.cls}-${String(index + 1).padStart(4, '0')}`;
  });
  const databaseWatermark = await groundTruthWatermark();
  const byClass = (c: string) => points.filter((p) => p.cls === c);
  console.log(
    `Generated ${points.length} points — A:${byClass('A').length} B:${byClass('B').length} ` +
    `C:${byClass('C').length} D:${byClass('D').length} E:${byClass('E').length} F:${byClass('F').length}`,
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

  const classes = ['A', 'B', 'C', 'D', 'E', 'F'];
  const summary = classes.map((c) => {
    const rs = results.filter((r) => r.cls === c);
    const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
    const pass = rs.filter((r) => r.failure === null).length;
    return {
      cls: c, n: rs.length, pass, passRate: rs.length ? (pass / rs.length) * 100 : 0,
      p50: pct(lat, 50), p95: pct(lat, 95), max: lat[lat.length - 1] ?? 0,
    };
  });
  const criticalPaths = (['auditor', 'topic'] as const).map((name) => {
    const rs = results.filter((result) => result.criticalPath === name);
    const lat = rs.map((result) => result.ms).sort((a, b) => a - b);
    const pass = rs.filter((result) => result.failure === null).length;
    return {
      name,
      n: rs.length,
      pass,
      passRate: rs.length ? (pass / rs.length) * 100 : 0,
      p50: pct(lat, 50),
      p95: pct(lat, 95),
      max: lat[lat.length - 1] ?? 0,
      serverErrorCases: rs.filter((result) => result.statusHistory.some(status => status >= 500)).length,
      requestErrors: rs.filter((result) => result.status === 0).length,
    };
  });

  console.log('\n=== RESULTS ===');
  for (const s of summary) {
    console.log(
      `${s.cls}  n=${String(s.n).padStart(4)}  pass=${s.passRate.toFixed(1).padStart(5)}%  ` +
      `p50=${Math.round(s.p50)}ms  p95=${Math.round(s.p95)}ms  max=${Math.round(s.max)}ms`,
    );
  }
  for (const path of criticalPaths) {
    console.log(
      `${path.name.toUpperCase()}  n=${String(path.n).padStart(4)}  pass=${path.passRate.toFixed(1).padStart(5)}%  ` +
      `p50=${Math.round(path.p50)}ms  p95=${Math.round(path.p95)}ms  max=${Math.round(path.max)}ms`,
    );
  }
  const totalPass = results.filter((r) => r.failure === null).length;
  console.log(`TOTAL ${totalPass}/${results.length} (${((totalPass / results.length) * 100).toFixed(1)}%) in ${wallSeconds.toFixed(0)}s`);

  const failures = results.filter((r) => r.failure !== null);
  const outPath = argValue('out') || '/tmp/e2e-perf-results.json';
  const fs = await import('fs');
  const availability = {
    logicalRequests,
    httpAttempts,
    serverErrorResponses,
    casesWith5xx,
    requestErrors: results.filter((result) => result.status === 0).length,
  };
  const serverErrorCases = results
    .filter((result) => result.statusHistory.some(status => status >= 500))
    .map((result) => ({
      cls: result.cls,
      criticalPath: result.criticalPath ?? null,
      label: result.label,
      statusHistory: result.statusHistory,
      ms: result.ms,
    }));
  const resultById = new Map(results.map(result => [result.caseId, result]));
  const selectionManifest = points.map(point => {
    const url = new URL(point.url);
    return {
      caseId: point.caseId,
      cls: point.cls,
      criticalPath: point.criticalPath ?? null,
      label: point.label,
      requestPath: `${url.pathname}${url.search}`,
      expectedFiling: point.expectedFiling ?? null,
      forbiddenFiling: point.forbiddenFiling ?? null,
      oracleEvidence: point.oracleEvidence,
    };
  });
  const caseManifest = selectionManifest.map(selection => {
    const result = resultById.get(selection.caseId);
    return {
      ...selection,
      outcome: result ? {
        pass: result.failure === null,
        status: result.status,
        statusHistory: result.statusHistory,
        failure: result.failure,
        pages: result.pages,
        examined: result.examined,
        ms: result.ms,
      } : null,
      observation: result?.observation ?? null,
    };
  });
  const selectionSha256 = createHash('sha256')
    .update(JSON.stringify(selectionManifest))
    .digest('hex');
  const evidenceSha256 = createHash('sha256')
    .update(JSON.stringify(caseManifest))
    .digest('hex');
  const boundarySelectionByPair = new Map<string, Record<string, unknown>>();
  for (const point of points) {
    const oracle = point.oracleEvidence && typeof point.oracleEvidence === 'object'
      ? point.oracleEvidence as Record<string, unknown> : null;
    const boundary = oracle?.boundaryOracle && typeof oracle.boundaryOracle === 'object'
      ? oracle.boundaryOracle as Record<string, unknown> : null;
    const pairId = String(boundary?.pairId ?? '');
    if (!pairId || boundarySelectionByPair.has(pairId)) continue;
    boundarySelectionByPair.set(pairId, {
      pairId,
      boundaryDate: boundary?.boundaryDate,
      issuerCik: boundary?.issuerCik,
      predecessor: boundary?.predecessor,
      successor: boundary?.successor,
      rawTransitionWitness: boundary?.rawTransitionWitness,
      pair: boundary?.pair,
    });
  }
  const boundarySelectionRows = [...boundarySelectionByPair.values()]
    .sort((left, right) => String(left.pairId).localeCompare(String(right.pairId)));
  const auditorBoundarySelectionManifest = {
    source: 'urc_auditor_periods_mat+urc_sec_filings+urc_sec_auditors',
    algorithm: 'sha256',
    count: boundarySelectionRows.length,
    digest: createHash('sha256').update(JSON.stringify(boundarySelectionRows)).digest('hex'),
    rows: boundarySelectionRows,
  };
  fs.writeFileSync(outPath, JSON.stringify({
    base: BASE,
    started,
    wallSeconds,
    summary,
    criticalPaths,
    totalPass,
    total: results.length,
    sampling: {
      complete: true,
      planned: QUOTA_PLAN,
      generated: Object.fromEntries(classes.map(cls => [cls, results.filter(result => result.cls === cls).length])),
      criticalGenerated: Object.fromEntries(
        criticalPaths.map(path => [path.name, path.n]),
      ),
      groundTruth: { ...samplingDiagnostics, auditorBoundarySelectionManifest },
      replay: {
        rngSeed: RNG_SEED,
        databaseWatermark,
        selectionSha256,
        evidenceSha256,
        cases: caseManifest,
      },
      targetPagination: {
        maxPagesPerCase: MAX_TARGET_PAGES,
        maxLogicalCandidateRequests: MAX_LOGICAL_CANDIDATE_REQUESTS,
        maxHttpCandidateAttempts: MAX_HTTP_CANDIDATE_ATTEMPTS,
        maxExaminedFilings: MAX_EXAMINED_FILINGS,
        cases: results.filter(result => result.pages > 1).length,
        examined: results.reduce((sum, result) => sum + result.examined, 0),
      },
    },
    availability,
    serverErrorCases,
    failures,
  }, null, 2));
  console.log(`\nFailures: ${failures.length} — full detail in ${outPath}`);
  console.log(
    `Availability: ${serverErrorResponses} HTTP 5xx response(s) across ${casesWith5xx} case(s); ` +
    `${availability.requestErrors} request error(s)`,
  );
  for (const f of failures.slice(0, 25)) console.log(`  [${f.cls}] ${f.label} → ${f.failure}`);

  // Release-gate mode: --min-pass 97 makes the run exit non-zero when the
  // pass rate regresses below the threshold. Without the flag, informational.
  const minPassRate = Number(argValue('min-pass') || 0);
  const passRate = (totalPass / results.length) * 100;
  if (minPassRate > 0 && passRate < minPassRate) {
    console.error(`GATE FAILED: pass rate ${passRate.toFixed(1)}% is below the required ${minPassRate}%`);
    process.exit(1);
  }
  if (serverErrorResponses > 0 || availability.requestErrors > 0) {
    console.error('GATE FAILED: release candidates require zero HTTP 5xx responses and zero request errors');
    process.exit(1);
  }
})();
