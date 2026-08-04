/**
 * Full-directory ticker coverage test — every listed issuer, 100% accuracy.
 *
 *   npx tsx scripts/ticker-coverage-test.ts [--base https://uniqus-research.vercel.app] [--out results.json]
 *
 * Downloads the complete SEC ticker directory (~10,400 rows) and exercises
 * every ticker through the product chain:
 *
 *   1. RESOLUTION  — the shared resolver must return the ticker's official CIK.
 *   2. RETRIEVAL   — the candidate API is queried with that resolved CIK.
 *   3. IDENTITY    — every hit must belong to the resolved CIK and have a real
 *                    accession, form, and calendar date in SEC submissions.
 *   4. FRESHNESS   — the first hit must be an independently observed newest
 *                    eligible SEC filing (not merely first within stale data).
 *
 * EMPTY_VERIFIED is reserved for an issuer whose successful SEC submissions
 * response contains no eligible post-2010 filings. Missing or malformed SEC
 * evidence fails closed. The process exits non-zero on any accuracy or
 * availability failure, so this report can gate a release.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { shouldIngestTargetedCikForm } from '../data-pipeline/edgar-index';
import {
  MIN_SEC_COMPANY_DIRECTORY_ENTRIES,
  matchCompanyEntry,
  projectSecCompanyDirectory,
  resolveCompanyInput,
  type CompanyDirectoryEntry,
} from '../src/services/secApi';
import { candidateRequestHeaders } from './accuracy/request';

const BASE = (argValue('base') || 'https://uniqus-research.vercel.app').replace(/\/$/, '');
const OUT = argValue('out') || '/tmp/ticker-coverage-results.json';
const requestedConcurrency = Number(argValue('concurrency') || 8);
const CONCURRENCY = Number.isSafeInteger(requestedConcurrency) && requestedConcurrency > 0
  ? Math.min(requestedConcurrency, 16)
  : 8;
const USER_AGENT = 'Uniqus Research Center contact@uniqus.com';
const COVERAGE_FLOOR = '2010-01-01';
const CANDIDATE_PAGE_SIZE = 5;
const SEC_REQUEST_INTERVAL_MS = 125; // 8 requests/second, below SEC's 10 rps ceiling.
const DIRECTORY_SOURCE = 'https://www.sec.gov/files/company_tickers.json';
const DIRECTORY_SCHEMA = 'urc.sec-company-directory-universe.v1';
const RESOLVER_CANARY_SCHEMA = 'urc.ticker-resolver-canary.v1';
const RESOLVER_CANARY_SIZE = 60;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

export interface DirectoryRow {
  cik: string;
  ticker: string;
  title: string;
}

export interface DirectoryUniverseEvidence {
  schema: typeof DIRECTORY_SCHEMA;
  source: typeof DIRECTORY_SOURCE;
  responseStatus: 200;
  contentType: string;
  fetchedAt: string;
  lastModified: string;
  etag: string;
  payloadBytes: number;
  payloadSha256: string;
  algorithm: 'sha256';
  minimumExpectedCount: number;
  complete: true;
  count: number;
  projectionDigest: string;
  keyDigest: string;
}

export interface ResolverCanaryRow {
  ticker: string;
  officialCik: string;
  resolvedCik: string;
  title: string;
  resolvedTitle: string;
  deployedStatus: Status | 'MISSING';
  pass: boolean;
}

export interface ResolverCanaryEvidence {
  schema: typeof RESOLVER_CANARY_SCHEMA;
  mode: 'exact-sha-product-resolver-with-bound-official-directory';
  productFunction: 'resolveCompanyInput';
  verifyFilingHistory: false;
  expectedSha: string;
  deploymentId: string;
  candidateBase: string;
  directDeployedResolverRoute: false;
  dependencyScope: {
    directory: 'direct-sec-cryptographically-bound-payload';
    submissionsTruth: 'direct-sec-complete-submissions';
    search: 'immutable-candidate-api-es-search';
  };
  routeLimitation: string;
  directoryProjectionDigest: string;
  sampleMethod: 'canonical-even-spread-v1';
  requested: number;
  tested: number;
  passed: number;
  sourceFiles: Array<{ path: string; sha256: string }>;
  rows: ResolverCanaryRow[];
  algorithm: 'sha256';
  digest: string;
  pass: boolean;
  problems: string[];
}

type Status = 'PASS' | 'EMPTY_VERIFIED' | 'FAIL';

export interface TickerResult {
  ticker: string;
  title: string;
  /** Official CIK from company_tickers.json. */
  cik: string;
  /** Actual numeric-string output of the shared product resolver. */
  resolvedCik: string;
  status: Status;
  detail: string;
  filings: number;
  newest: string;
  newestAccession: string;
  secNewest: string;
  secNewestAccessions: string[];
  secEligibleFilings: number;
  secSubmissionsEvidenceSha256: string;
  secSourceCik: string;
  secRecentRawFilings: number;
  secArchivePlanComplete: boolean;
  secArchiveDescriptorCount: number;
  secRelevantArchiveCount: number;
  secArchivePlanSha256: string;
  secArchiveEvidence: SecArchiveEvidence[];
  candidatePage: SecFilingTruth[];
  secExpectedPage: SecFilingTruth[];
  ms: number;
  serverErrorResponses: number;
}

export interface ProductSearchHit {
  _id?: unknown;
  _source?: {
    adsh?: unknown;
    ciks?: unknown;
    display_names?: unknown;
    form?: unknown;
    file_date?: unknown;
  };
}

export interface SecFilingTruth {
  accession: string;
  form: string;
  filingDate: string;
}

export interface SecSubmissionsTruth {
  ok: boolean;
  detail: string;
  filings: SecFilingTruth[];
  newestDate: string;
  newestFilings: SecFilingTruth[];
  evidenceSha256: string;
  sourceCik: string;
  recentRawFilings: number;
  archivePlanComplete: boolean;
  archiveDescriptorCount: number;
  relevantArchiveCount: number;
  archivePlanSha256: string;
  archiveEvidence: SecArchiveEvidence[];
}

export interface SecArchiveEvidence {
  name: string;
  filingTo: string;
  declaredFilings: number;
  observedFilings: number;
}

interface CikOutcome {
  status: Status;
  detail: string;
  filings: number;
  newest: string;
  newestAccession: string;
  secNewest: string;
  secNewestAccessions: string[];
  secEligibleFilings: number;
  secSubmissionsEvidenceSha256: string;
  secSourceCik: string;
  secRecentRawFilings: number;
  secArchivePlanComplete: boolean;
  secArchiveDescriptorCount: number;
  secRelevantArchiveCount: number;
  secArchivePlanSha256: string;
  secArchiveEvidence: SecArchiveEvidence[];
  candidatePage: SecFilingTruth[];
  secExpectedPage: SecFilingTruth[];
  ms: number;
  serverErrorResponses: number;
}

export interface PassEvidenceRow {
  ticker: string;
  officialCik: string;
  resolvedCik: string;
  candidateNewestAccession: string;
  candidateNewestDate: string;
  secNewestAccessions: string[];
  secNewestDate: string;
  returnedFilings: number;
}

export interface CoverageEvidenceRow extends PassEvidenceRow {
  status: 'PASS' | 'EMPTY_VERIFIED';
  title: string;
  secEligibleFilings: number;
  secSubmissionsEvidenceSha256: string;
  secSourceCik: string;
  secRecentRawFilings: number;
  secArchivePlanComplete: boolean;
  secArchiveDescriptorCount: number;
  secRelevantArchiveCount: number;
  secArchivePlanSha256: string;
  secArchiveEvidence: SecArchiveEvidence[];
  secTruthDetail: string;
  candidatePage: Array<SecFilingTruth & { cik: string }>;
  secExpectedPage: Array<SecFilingTruth & { cik: string }>;
}

interface DirectoryProjectionRow {
  ticker: string;
  officialCik: string;
  title: string;
}

interface DirectoryEvidenceMetadata {
  responseStatus: number;
  contentType: string;
  fetchedAt: string;
  lastModified?: string;
  etag?: string;
  payloadBytes: number;
  payloadSha256: string;
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function compareDirectoryKey(
  left: Pick<DirectoryProjectionRow, 'ticker' | 'officialCik'>,
  right: Pick<DirectoryProjectionRow, 'ticker' | 'officialCik'>,
): number {
  return left.ticker < right.ticker ? -1
    : left.ticker > right.ticker ? 1
      : left.officialCik < right.officialCik ? -1
        : left.officialCik > right.officialCik ? 1 : 0;
}

export function canonicalDirectoryProjection(directory: DirectoryRow[]): DirectoryProjectionRow[] {
  const rows: DirectoryProjectionRow[] = [];
  const tickers = new Set<string>();
  for (const [index, row] of directory.entries()) {
    const officialCik = normalizeCoverageCik(row.cik);
    const ticker = String(row.ticker || '').trim().toUpperCase();
    const title = String(row.title || '').trim();
    if (!officialCik) throw new Error(`official directory row ${index} has an invalid CIK`);
    if (!/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(ticker)) {
      throw new Error(`official directory row ${index} has an invalid ticker`);
    }
    if (!title || title.length > 500 || /[\u0000-\u001F\u007F]/.test(title)) {
      throw new Error(`official directory row ${index} has an invalid title`);
    }
    if (tickers.has(ticker)) throw new Error(`official directory contains duplicate ticker ${ticker}`);
    tickers.add(ticker);
    rows.push({ ticker, officialCik, title });
  }
  return rows.sort(compareDirectoryKey);
}

export function buildDirectoryUniverseEvidence(
  directory: DirectoryRow[],
  metadata: DirectoryEvidenceMetadata,
): DirectoryUniverseEvidence {
  if (metadata.responseStatus !== 200) throw new Error(`official directory returned HTTP ${metadata.responseStatus}`);
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(metadata.contentType)) {
    throw new Error(`official directory returned non-JSON content type ${metadata.contentType || 'missing'}`);
  }
  if (!isRealIsoTimestamp(metadata.fetchedAt)) throw new Error('official directory fetchedAt is invalid');
  if (!Number.isSafeInteger(metadata.payloadBytes) || metadata.payloadBytes <= 0) {
    throw new Error('official directory payload byte count is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(metadata.payloadSha256)) {
    throw new Error('official directory payload digest is invalid');
  }
  const projection = canonicalDirectoryProjection(directory);
  if (projection.length < MIN_SEC_COMPANY_DIRECTORY_ENTRIES) {
    throw new Error(
      `official directory is incomplete (${projection.length} < ${MIN_SEC_COMPANY_DIRECTORY_ENTRIES})`,
    );
  }
  const keys = projection.map(row => `${row.ticker}\u0000${row.officialCik}`);
  return {
    schema: DIRECTORY_SCHEMA,
    source: DIRECTORY_SOURCE,
    responseStatus: 200,
    contentType: metadata.contentType,
    fetchedAt: metadata.fetchedAt,
    lastModified: metadata.lastModified || '',
    etag: metadata.etag || '',
    payloadBytes: metadata.payloadBytes,
    payloadSha256: metadata.payloadSha256,
    algorithm: 'sha256',
    minimumExpectedCount: MIN_SEC_COMPANY_DIRECTORY_ENTRIES,
    complete: true,
    count: projection.length,
    projectionDigest: sha256Json(projection),
    keyDigest: sha256Json(keys),
  };
}

function isRealIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function buildPassEvidenceManifest(results: TickerResult[]): {
  rows: PassEvidenceRow[];
  sha256: string;
} {
  const rows = results
    .filter(result => result.status === 'PASS')
    .map(result => ({
      ticker: result.ticker,
      officialCik: result.cik,
      resolvedCik: result.resolvedCik,
      candidateNewestAccession: result.newestAccession,
      candidateNewestDate: result.newest,
      secNewestAccessions: [...result.secNewestAccessions].sort(),
      secNewestDate: result.secNewest,
      returnedFilings: result.filings,
    }))
    .sort((left, right) => left.ticker.localeCompare(right.ticker) || left.officialCik.localeCompare(right.officialCik));
  const sha256 = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return { rows, sha256 };
}

export interface CoverageEvidenceManifest {
  rows: CoverageEvidenceRow[];
  sha256: string;
  keyDigest: string;
  projectionDigest: string;
}

export function buildCoverageEvidenceManifest(results: TickerResult[]): CoverageEvidenceManifest {
  const rows = results
    .filter((result): result is TickerResult & { status: 'PASS' | 'EMPTY_VERIFIED' } => (
      result.status === 'PASS' || result.status === 'EMPTY_VERIFIED'
    ))
    .map(result => ({
      ticker: result.ticker,
      title: result.title,
      officialCik: result.cik,
      resolvedCik: result.resolvedCik,
      status: result.status,
      candidateNewestAccession: result.newestAccession,
      candidateNewestDate: result.newest,
      secNewestAccessions: [...result.secNewestAccessions].sort(),
      secNewestDate: result.secNewest,
      returnedFilings: result.filings,
      secEligibleFilings: result.secEligibleFilings,
      secSubmissionsEvidenceSha256: result.secSubmissionsEvidenceSha256,
      secSourceCik: result.secSourceCik,
      secRecentRawFilings: result.secRecentRawFilings,
      secArchivePlanComplete: result.secArchivePlanComplete,
      secArchiveDescriptorCount: result.secArchiveDescriptorCount,
      secRelevantArchiveCount: result.secRelevantArchiveCount,
      secArchivePlanSha256: result.secArchivePlanSha256,
      secArchiveEvidence: result.secArchiveEvidence,
      secTruthDetail: result.detail,
      candidatePage: result.candidatePage.map(filing => ({ ...filing, cik: result.cik })),
      secExpectedPage: result.secExpectedPage.map(filing => ({ ...filing, cik: result.cik })),
    }))
    .sort((left, right) => compareDirectoryKey(left, right));
  const keys = rows.map(row => `${row.ticker}\u0000${normalizeCoverageCik(row.officialCik) || ''}`);
  const projection: DirectoryProjectionRow[] = rows.map(row => ({
    ticker: row.ticker,
    officialCik: normalizeCoverageCik(row.officialCik) || '',
    title: row.title,
  }));
  return {
    rows,
    sha256: sha256Json(rows),
    keyDigest: sha256Json(keys),
    projectionDigest: sha256Json(projection),
  };
}

export function coverageCompletenessProblems(
  directory: DirectoryUniverseEvidence,
  manifest: CoverageEvidenceManifest,
): string[] {
  const problems: string[] = [];
  if (!directory.complete || directory.count < directory.minimumExpectedCount) {
    problems.push('official directory universe is not complete');
  }
  if (manifest.rows.length !== directory.count) {
    problems.push(`coverage manifest contains ${manifest.rows.length}/${directory.count} directory rows`);
  }
  if (manifest.sha256 !== sha256Json(manifest.rows)) problems.push('coverage row digest mismatch');
  const keys = manifest.rows.map(row => `${row.ticker}\u0000${normalizeCoverageCik(row.officialCik) || ''}`);
  const sortedKeys = [...keys].sort();
  if (new Set(keys).size !== keys.length) problems.push('coverage manifest has duplicate directory keys');
  if (keys.some((key, index) => key !== sortedKeys[index])) {
    problems.push('coverage manifest rows are not in canonical key order');
  }
  if (manifest.keyDigest !== sha256Json(keys) || manifest.keyDigest !== directory.keyDigest) {
    problems.push('coverage key digest does not bind the official directory universe');
  }
  const projection: DirectoryProjectionRow[] = manifest.rows.map(row => ({
    ticker: row.ticker,
    officialCik: normalizeCoverageCik(row.officialCik) || '',
    title: row.title,
  }));
  if (
    manifest.projectionDigest !== sha256Json(projection)
    || manifest.projectionDigest !== directory.projectionDigest
  ) {
    problems.push('coverage projection digest does not bind the official directory universe');
  }
  if (!manifest.rows.some(row => row.status === 'PASS')) {
    problems.push('coverage manifest cannot certify the entire directory as empty');
  }
  for (const row of manifest.rows) {
    const officialCik = normalizeCoverageCik(row.officialCik);
    const archiveEvidenceValid = (
      row.secArchivePlanComplete
      && Number.isSafeInteger(row.secArchiveDescriptorCount)
      && row.secArchiveDescriptorCount >= 0
      && Number.isSafeInteger(row.secRelevantArchiveCount)
      && row.secRelevantArchiveCount >= 0
      && row.secRelevantArchiveCount <= row.secArchiveDescriptorCount
      && /^[0-9a-f]{64}$/.test(row.secArchivePlanSha256)
      && row.secArchiveEvidence.length === row.secRelevantArchiveCount
      && row.secArchiveEvidence.every(item => (
        item.name.startsWith(`CIK${String(officialCik || '').padStart(10, '0')}-submissions-`)
        && isRealIsoDate(item.filingTo)
        && item.filingTo >= COVERAGE_FLOOR
        && item.declaredFilings === item.observedFilings
      ))
    );
    if (
      !officialCik
      || normalizeCoverageCik(row.resolvedCik) !== officialCik
      || normalizeCoverageCik(row.secSourceCik) !== officialCik
      || !/^[0-9a-f]{64}$/.test(row.secSubmissionsEvidenceSha256)
      || !Number.isSafeInteger(row.secRecentRawFilings)
      || row.secRecentRawFilings < 0
    ) {
      problems.push(`coverage row ${row.ticker} has unbound SEC source provenance`);
    }
    if (row.status === 'EMPTY_VERIFIED' && !archiveEvidenceValid) {
      problems.push(`EMPTY_VERIFIED row ${row.ticker} lacks complete archive provenance`);
    }
  }
  return problems;
}

interface ResolvedDirectoryRow {
  row: DirectoryRow;
  resolvedCik: string;
}

export interface ResolutionPlan {
  failures: TickerResult[];
  resolvedRows: ResolvedDirectoryRow[];
  /** Exact CIK values that Stage 2 must search. Derived from resolver output. */
  retrievalCiks: string[];
}

class CandidateSearchError extends Error {
  constructor(message: string, readonly serverErrorResponses: number, readonly ms: number) {
    super(message);
  }
}

/**
 * Shared host-level dispatcher for data.sec.gov. Candidate concurrency must
 * not multiply SEC traffic. Only request starts are serialized; responses can
 * remain in flight concurrently.
 */
export class SecRequestPacer {
  private tail: Promise<void> = Promise.resolve();
  private lastDispatchAt: number | null = null;

  constructor(
    private readonly intervalMs = SEC_REQUEST_INTERVAL_MS,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  ) {}

  async waitTurn(): Promise<number> {
    let release = () => {};
    let dispatchedAt = 0;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (this.lastDispatchAt !== null) {
        const remaining = this.lastDispatchAt + this.intervalMs - this.now();
        if (remaining > 0) await this.sleep(remaining);
      }
      this.lastDispatchAt = this.now();
      dispatchedAt = this.lastDispatchAt;
    } finally {
      release();
    }
    return dispatchedAt;
  }
}

const secRequestPacer = new SecRequestPacer();

async function pacedSecFetch(input: string, init: RequestInit): Promise<Response> {
  await secRequestPacer.waitTurn();
  return fetch(input, init);
}

function emptyOutcome(
  status: Status,
  detail: string,
  ms: number,
  serverErrorResponses: number,
  truth?: SecSubmissionsTruth,
): CikOutcome {
  return {
    status,
    detail,
    filings: 0,
    newest: '',
    newestAccession: '',
    secNewest: truth?.newestDate || '',
    secNewestAccessions: truth?.newestFilings.map(filing => filing.accession) || [],
    secEligibleFilings: truth?.ok ? truth.filings.length : -1,
    secSubmissionsEvidenceSha256: truth?.evidenceSha256 || '',
    secSourceCik: truth?.sourceCik || '',
    secRecentRawFilings: truth?.recentRawFilings ?? -1,
    secArchivePlanComplete: truth?.archivePlanComplete ?? false,
    secArchiveDescriptorCount: truth?.archiveDescriptorCount ?? -1,
    secRelevantArchiveCount: truth?.relevantArchiveCount ?? -1,
    secArchivePlanSha256: truth?.archivePlanSha256 || '',
    secArchiveEvidence: truth?.archiveEvidence ?? [],
    candidatePage: [],
    secExpectedPage: [],
    ms,
    serverErrorResponses,
  };
}

export function normalizeCoverageCik(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,10}$/.test(raw)) return null;
  const normalized = raw.replace(/^0+/, '') || '0';
  return normalized === '0' ? null : normalized;
}

function normalizeAccession(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!/^(?:\d{10}-\d{2}-\d{6}|\d{18})$/.test(raw)) return null;
  return raw.replace(/-/g, '');
}

function displayAccession(value: unknown): string {
  const normalized = normalizeAccession(value);
  if (!normalized) return String(value ?? '');
  return `${normalized.slice(0, 10)}-${normalized.slice(10, 12)}-${normalized.slice(12)}`;
}

function normalizeForm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const form = value.trim().toUpperCase();
  if (!form || form.length > 40 || !/^[A-Z0-9][A-Z0-9 /-]*$/.test(form)) return null;
  return form;
}

/** Shape plus calendar validation. Date.parse alone normalizes 2026-02-30. */
export function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function failedResolution(
  row: DirectoryRow,
  resolvedCik: string,
  detail: string,
): TickerResult {
  return {
    ticker: row.ticker,
    title: row.title,
    cik: row.cik,
    resolvedCik,
    status: 'FAIL',
    detail,
    filings: 0,
    newest: '',
    newestAccession: '',
    secNewest: '',
    secNewestAccessions: [],
    secEligibleFilings: -1,
    secSubmissionsEvidenceSha256: '',
    secSourceCik: '',
    secRecentRawFilings: -1,
    secArchivePlanComplete: false,
    secArchiveDescriptorCount: -1,
    secRelevantArchiveCount: -1,
    secArchivePlanSha256: '',
    secArchiveEvidence: [],
    candidatePage: [],
    secExpectedPage: [],
    ms: 0,
    serverErrorResponses: 0,
  };
}

/**
 * Resolve all official directory rows and retain the resolver's CIK as the
 * sole Stage-2 input. Comparing only ticker text allowed a resolver that
 * returned the right symbol for the wrong issuer to pass.
 */
export function buildResolutionPlan(
  directory: DirectoryRow[],
  resolver: (
    entries: CompanyDirectoryEntry[],
    ticker: string,
  ) => CompanyDirectoryEntry | null = matchCompanyEntry,
): ResolutionPlan {
  const failures: TickerResult[] = [];
  const resolvedRows: ResolvedDirectoryRow[] = [];

  for (const row of directory) {
    const expectedCik = normalizeCoverageCik(row.cik);
    const hit = resolver(directory as CompanyDirectoryEntry[], row.ticker);
    const resolvedCikRaw = typeof hit?.cik === 'string' ? hit.cik.trim() : '';
    const normalizedResolvedCik = normalizeCoverageCik(resolvedCikRaw);
    const resolvedTicker = hit?.ticker?.toUpperCase() || '';

    if (!expectedCik) {
      failures.push(failedResolution(row, resolvedCikRaw, `resolution: invalid official CIK ${row.cik}`));
    } else if (!hit || !normalizedResolvedCik) {
      failures.push(failedResolution(row, '', 'resolution: null or invalid CIK'));
    } else if (resolvedTicker !== row.ticker.toUpperCase()) {
      failures.push(failedResolution(
        row,
        resolvedCikRaw,
        `resolution: wrong ticker ${hit.ticker} (CIK ${normalizedResolvedCik})`,
      ));
    } else if (normalizedResolvedCik !== expectedCik) {
      failures.push(failedResolution(
        row,
        resolvedCikRaw,
        `resolution: ${row.ticker} mapped to CIK ${normalizedResolvedCik}, expected ${expectedCik}`,
      ));
    } else {
      // Do not substitute row.cik here. Stage 2 must consume the actual
      // resolver output so this remains a test of the chained product path.
      resolvedRows.push({ row, resolvedCik: resolvedCikRaw });
    }
  }

  return {
    failures,
    resolvedRows,
    retrievalCiks: Array.from(new Set(resolvedRows.map(item => item.resolvedCik))),
  };
}

/**
 * Parse an official submissions response into independent product truth.
 * The facet corpus intentionally excludes institutional-manager reports;
 * every other form is eligible for issuer-level targeted ingestion.
 */
interface ParsedSecFilingBlock {
  ok: boolean;
  detail: string;
  rawCount: number;
  filings: SecFilingTruth[];
}

interface SecTruthArchiveDescriptor {
  name: string;
  filingTo: string;
  filingCount: number;
}

function unavailableSecTruth(detail: string): SecSubmissionsTruth {
  return {
    ok: false, detail, filings: [], newestDate: '', newestFilings: [], evidenceSha256: '',
    sourceCik: '', recentRawFilings: -1,
    archivePlanComplete: false, archiveDescriptorCount: -1, relevantArchiveCount: -1,
    archivePlanSha256: '', archiveEvidence: [],
  };
}

function buildSecTruth(
  filings: SecFilingTruth[],
  evidence: unknown,
  provenance: Pick<
    SecSubmissionsTruth,
    | 'sourceCik'
    | 'recentRawFilings'
    | 'archivePlanComplete'
    | 'archiveDescriptorCount'
    | 'relevantArchiveCount'
    | 'archivePlanSha256'
    | 'archiveEvidence'
  >,
): SecSubmissionsTruth {
  const byAccession = new Map<string, SecFilingTruth>();
  for (const filing of filings) {
    const existing = byAccession.get(filing.accession);
    if (existing && (existing.form !== filing.form || existing.filingDate !== filing.filingDate)) {
      return unavailableSecTruth(`SEC submissions has conflicting metadata for accession ${displayAccession(filing.accession)}`);
    }
    byAccession.set(filing.accession, filing);
  }
  const uniqueFilings = Array.from(byAccession.values());
  const newestDate = uniqueFilings.reduce(
    (latest, filing) => filing.filingDate > latest ? filing.filingDate : latest,
    '',
  );
  return {
    ok: true,
    detail: uniqueFilings.length > 0
      ? `SEC submissions shows ${uniqueFilings.length} eligible post-2010 filings`
      : 'SEC submissions confirms no eligible post-2010 filings',
    filings: uniqueFilings,
    newestDate,
    newestFilings: uniqueFilings.filter(filing => filing.filingDate === newestDate),
    evidenceSha256: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
    ...provenance,
  };
}

function parseSecFilingBlock(value: unknown, context: string, expectedCik?: string): ParsedSecFilingBlock {
  if (!value || typeof value !== 'object') {
    return { ok: false, detail: `${context} arrays are missing`, rawCount: 0, filings: [] };
  }
  const block = value as { accessionNumber?: unknown; filingDate?: unknown; form?: unknown };
  const accessions = block.accessionNumber;
  const dates = block.filingDate;
  const forms = block.form;
  if (!Array.isArray(accessions) || !Array.isArray(dates) || !Array.isArray(forms)) {
    return { ok: false, detail: `${context} arrays are missing`, rawCount: 0, filings: [] };
  }
  if (accessions.length !== dates.length || accessions.length !== forms.length) {
    return { ok: false, detail: `${context} arrays have inconsistent lengths`, rawCount: 0, filings: [] };
  }

  const filings: SecFilingTruth[] = [];
  for (let index = 0; index < accessions.length; index += 1) {
    const accession = normalizeAccession(accessions[index]);
    const form = normalizeForm(forms[index]);
    const filingDate = dates[index];
    if (!accession || !form || !isRealIsoDate(filingDate)) {
      return {
        ok: false,
        detail: `${context} contains malformed filing fields at index ${index}`,
        rawCount: accessions.length,
        filings: [],
      };
    }
    if (expectedCik && accession.slice(0, 10) !== expectedCik.padStart(10, '0')) {
      return {
        ok: false,
        detail: `${context} accession at index ${index} belongs to another CIK`,
        rawCount: accessions.length,
        filings: [],
      };
    }
    if (filingDate < COVERAGE_FLOOR || !shouldIngestTargetedCikForm(form)) continue;
    filings.push({ accession, form, filingDate });
  }
  return { ok: true, detail: '', rawCount: accessions.length, filings };
}

export function parseSecSubmissionsTruth(payload: unknown, expectedCik?: string): SecSubmissionsTruth {
  if (!payload || typeof payload !== 'object') return unavailableSecTruth('SEC submissions payload is not an object');
  const sourceCik = normalizeCoverageCik((payload as { cik?: unknown }).cik);
  if (expectedCik && sourceCik !== normalizeCoverageCik(expectedCik)) {
    return unavailableSecTruth(
      `SEC submissions payload CIK ${String((payload as { cik?: unknown }).cik ?? 'missing')} != requested ${expectedCik}`,
    );
  }
  const recent = (payload as { filings?: { recent?: unknown } }).filings?.recent;
  const parsed = parseSecFilingBlock(recent, 'SEC submissions recent', expectedCik);
  const archivePlan = parseSecTruthArchiveDescriptors(payload);
  const relevantArchives = archivePlan.ok
    ? archivePlan.descriptors.filter(descriptor => descriptor.filingTo >= COVERAGE_FLOOR)
    : [];
  return parsed.ok ? buildSecTruth(parsed.filings, payload, {
    sourceCik: sourceCik || '',
    recentRawFilings: parsed.rawCount,
    archivePlanComplete: archivePlan.ok && relevantArchives.length === 0,
    archiveDescriptorCount: archivePlan.ok ? archivePlan.descriptors.length : -1,
    relevantArchiveCount: archivePlan.ok ? relevantArchives.length : -1,
    archivePlanSha256: archivePlan.ok ? sha256Json(archivePlan.descriptors) : '',
    archiveEvidence: [],
  }) : unavailableSecTruth(parsed.detail);
}

function parseSecTruthArchiveDescriptors(payload: unknown): {
  ok: boolean;
  detail: string;
  descriptors: SecTruthArchiveDescriptor[];
} {
  const files = payload && typeof payload === 'object'
    ? (payload as { filings?: { files?: unknown } }).filings?.files
    : undefined;
  if (!Array.isArray(files)) {
    return { ok: false, detail: 'SEC submissions filings.files is missing', descriptors: [] };
  }
  const descriptors: SecTruthArchiveDescriptor[] = [];
  const seen = new Set<string>();
  for (const [index, item] of files.entries()) {
    if (!item || typeof item !== 'object') {
      return { ok: false, detail: `SEC archive descriptor ${index} is malformed`, descriptors: [] };
    }
    const descriptor = item as {
      name?: unknown;
      filingTo?: unknown;
      filingCount?: unknown;
    };
    const name = typeof descriptor.name === 'string' ? descriptor.name.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name) || name.includes('..')) {
      return { ok: false, detail: `SEC archive descriptor ${index} has an unsafe or missing name`, descriptors: [] };
    }
    if (seen.has(name)) {
      return { ok: false, detail: `SEC archive descriptor ${name} is duplicated`, descriptors: [] };
    }
    seen.add(name);
    if (typeof descriptor.filingTo !== 'string' || !isRealIsoDate(descriptor.filingTo)) {
      return { ok: false, detail: `SEC archive descriptor ${name} has an invalid filingTo`, descriptors: [] };
    }
    if (typeof descriptor.filingCount !== 'number'
      || !Number.isSafeInteger(descriptor.filingCount)
      || descriptor.filingCount < 0) {
      return { ok: false, detail: `SEC archive descriptor ${name} has an invalid filingCount`, descriptors: [] };
    }
    descriptors.push({ name, filingTo: descriptor.filingTo, filingCount: descriptor.filingCount });
  }
  descriptors.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return { ok: true, detail: '', descriptors };
}

/**
 * Recent is sufficient only when it can independently validate the complete
 * five-hit candidate page. With fewer eligible recent records, merge every
 * post-floor archive before evaluating hits or certifying an issuer empty.
 */
export async function completeSecSubmissionsTruth(
  mainPayload: unknown,
  fetchArchive: (name: string) => Promise<unknown>,
  expectedCik?: string,
): Promise<SecSubmissionsTruth> {
  const recentTruth = parseSecSubmissionsTruth(mainPayload, expectedCik);
  if (!recentTruth.ok || recentTruth.filings.length >= CANDIDATE_PAGE_SIZE) return recentTruth;

  const archivePlan = parseSecTruthArchiveDescriptors(mainPayload);
  if (!archivePlan.ok) return unavailableSecTruth(archivePlan.detail);
  const relevantArchives = archivePlan.descriptors
    .filter(descriptor => descriptor.filingTo >= COVERAGE_FLOOR);
  const archivedFilings: SecFilingTruth[] = [...recentTruth.filings];
  const evidencePayloads: unknown[] = [mainPayload];
  const archiveEvidence: SecSubmissionsTruth['archiveEvidence'] = [];
  for (const descriptor of relevantArchives) {
    if (expectedCik && !descriptor.name.startsWith(`CIK${expectedCik.padStart(10, '0')}-submissions-`)) {
      return unavailableSecTruth(`SEC archive ${descriptor.name} is not bound to requested CIK ${expectedCik}`);
    }
    let payload: unknown;
    try {
      payload = await fetchArchive(descriptor.name);
    } catch (error) {
      return unavailableSecTruth(
        `SEC archive ${descriptor.name} could not be fetched (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const parsed = parseSecFilingBlock(payload, `SEC archive ${descriptor.name}`, expectedCik);
    if (!parsed.ok) return unavailableSecTruth(parsed.detail);
    if (parsed.rawCount !== descriptor.filingCount) {
      return unavailableSecTruth(
        `SEC archive ${descriptor.name} returned ${parsed.rawCount}/${descriptor.filingCount} declared filings`,
      );
    }
    evidencePayloads.push(payload);
    archiveEvidence.push({
      name: descriptor.name,
      filingTo: descriptor.filingTo,
      declaredFilings: descriptor.filingCount,
      observedFilings: parsed.rawCount,
    });
    archivedFilings.push(...parsed.filings);
  }
  return buildSecTruth(archivedFilings, evidencePayloads, {
    sourceCik: recentTruth.sourceCik,
    recentRawFilings: recentTruth.recentRawFilings,
    archivePlanComplete: true,
    archiveDescriptorCount: archivePlan.descriptors.length,
    relevantArchiveCount: relevantArchives.length,
    archivePlanSha256: sha256Json(archivePlan.descriptors),
    archiveEvidence,
  });
}

interface ParsedProductHit extends SecFilingTruth {
  ciks: string[];
}

function parseProductHit(hit: ProductSearchHit, index: number): { value?: ParsedProductHit; error?: string } {
  const source = hit?._source;
  if (!source || typeof source !== 'object') return { error: `hit ${index + 1} has no _source` };

  const accession = normalizeAccession(source.adsh);
  if (!accession) return { error: `hit ${index + 1} has malformed accession` };
  const form = normalizeForm(source.form);
  if (!form) return { error: `hit ${index + 1} has malformed form` };
  if (!isRealIsoDate(source.file_date)) return { error: `hit ${index + 1} has malformed filing date` };
  if (!Array.isArray(source.ciks)) return { error: `hit ${index + 1} has malformed CIKs` };
  const ciks = source.ciks.map(normalizeCoverageCik);
  if (ciks.some(cik => cik === null)) return { error: `hit ${index + 1} has malformed CIKs` };

  return {
    value: {
      accession,
      form,
      filingDate: source.file_date,
      ciks: ciks as string[],
    },
  };
}

/**
 * Validate one deployed response against independent SEC submissions truth.
 * This pure boundary is intentionally exported for false-pass regressions.
 */
export function evaluateCikSearch(
  cik: string,
  hits: ProductSearchHit[],
  truth: SecSubmissionsTruth,
  ms = 0,
  serverErrorResponses = 0,
): CikOutcome {
  if (!truth.ok) {
    return emptyOutcome('FAIL', `SEC ground truth unavailable: ${truth.detail}`, ms, serverErrorResponses, truth);
  }
  const expectedCik = normalizeCoverageCik(cik);
  if (!expectedCik) {
    return emptyOutcome('FAIL', `invalid resolved CIK ${cik}`, ms, serverErrorResponses, truth);
  }
  if (normalizeCoverageCik(truth.sourceCik) !== expectedCik) {
    return emptyOutcome(
      'FAIL',
      `SEC ground truth source CIK ${truth.sourceCik || 'missing'} does not match resolved CIK ${expectedCik}`,
      ms,
      serverErrorResponses,
      truth,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(truth.evidenceSha256) || truth.recentRawFilings < 0) {
    return emptyOutcome('FAIL', 'SEC ground truth provenance is incomplete', ms, serverErrorResponses, truth);
  }
  if (truth.filings.length < CANDIDATE_PAGE_SIZE) {
    const archiveEvidenceValid = (
      truth.archivePlanComplete
      && Number.isSafeInteger(truth.archiveDescriptorCount)
      && truth.archiveDescriptorCount >= 0
      && Number.isSafeInteger(truth.relevantArchiveCount)
      && truth.relevantArchiveCount >= 0
      && truth.relevantArchiveCount <= truth.archiveDescriptorCount
      && /^[0-9a-f]{64}$/.test(truth.archivePlanSha256)
      && truth.archiveEvidence.length === truth.relevantArchiveCount
      && new Set(truth.archiveEvidence.map(item => item.name)).size === truth.archiveEvidence.length
      && truth.archiveEvidence.every((item, index) => (
        /^CIK\d{10}-submissions-[A-Za-z0-9._-]*\.json$/.test(item.name)
        && item.name.startsWith(`CIK${expectedCik.padStart(10, '0')}-submissions-`)
        && isRealIsoDate(item.filingTo)
        && item.filingTo >= COVERAGE_FLOOR
        && Number.isSafeInteger(item.declaredFilings)
        && item.declaredFilings >= 0
        && item.observedFilings === item.declaredFilings
        && (index === 0 || truth.archiveEvidence[index - 1].name < item.name)
      ))
    );
    if (!archiveEvidenceValid) {
      return emptyOutcome(
        'FAIL',
        'SEC ground truth did not prove a complete post-2010 archive plan',
        ms,
        serverErrorResponses,
        truth,
      );
    }
  }
  if (hits.length === 0) {
    return truth.filings.length === 0
      ? emptyOutcome('EMPTY_VERIFIED', truth.detail, ms, serverErrorResponses, truth)
      : emptyOutcome('FAIL', `zero results but ${truth.detail}`, ms, serverErrorResponses, truth);
  }
  if (truth.filings.length === 0) {
    return emptyOutcome(
      'FAIL',
      'candidate returned filings but SEC submissions has no eligible post-2010 filing',
      ms,
      serverErrorResponses,
      truth,
    );
  }

  const parsedHits: ParsedProductHit[] = [];
  for (let index = 0; index < hits.length; index += 1) {
    const parsed = parseProductHit(hits[index], index);
    if (!parsed.value) {
      return emptyOutcome('FAIL', parsed.error || `hit ${index + 1} is malformed`, ms, serverErrorResponses, truth);
    }
    if (!parsed.value.ciks.includes(expectedCik)) {
      const displayNames = hits[index]._source?.display_names;
      const displayName = Array.isArray(displayNames) ? displayNames[0] : hits[index]._id;
      return emptyOutcome(
        'FAIL',
        `foreign issuer in results: ${String(displayName || hits[index]._id || `hit ${index + 1}`)}`,
        ms,
        serverErrorResponses,
        truth,
      );
    }
    parsedHits.push(parsed.value);
  }

  const seen = new Set<string>();
  const truthByAccession = new Map(truth.filings.map(filing => [filing.accession, filing]));
  for (const [index, hit] of parsedHits.entries()) {
    if (seen.has(hit.accession)) {
      return emptyOutcome('FAIL', `duplicate accession at hit ${index + 1}`, ms, serverErrorResponses, truth);
    }
    seen.add(hit.accession);
    const official = truthByAccession.get(hit.accession);
    if (!official) {
      return emptyOutcome(
        'FAIL',
        `hit ${index + 1} accession ${displayAccession(hit.accession)} is absent from SEC submissions`,
        ms,
        serverErrorResponses,
        truth,
      );
    }
    if (hit.form !== official.form || hit.filingDate !== official.filingDate) {
      return emptyOutcome(
        'FAIL',
        `hit ${index + 1} fields disagree with SEC submissions for ${displayAccession(hit.accession)}`,
        ms,
        serverErrorResponses,
        truth,
      );
    }
  }

  const dates = parsedHits.map(hit => hit.filingDate);
  const sorted = [...dates].sort((a, b) => b.localeCompare(a));
  if (dates.join('|') !== sorted.join('|')) {
    return emptyOutcome('FAIL', `not newest-first: ${dates.join(',')}`, ms, serverErrorResponses, truth);
  }

  const newestAccessions = new Set(truth.newestFilings.map(filing => filing.accession));
  const first = parsedHits[0];
  if (first.filingDate !== truth.newestDate || !newestAccessions.has(first.accession)) {
    return {
      status: 'FAIL',
      detail: `stale newest filing: candidate ${displayAccession(first.accession)} ${first.form} ${first.filingDate}; SEC newest ${truth.newestFilings.map(filing => `${displayAccession(filing.accession)} ${filing.form} ${filing.filingDate}`).join(' or ')}`,
      filings: hits.length,
      newest: first.filingDate,
      newestAccession: displayAccession(first.accession),
      secNewest: truth.newestDate,
      secNewestAccessions: truth.newestFilings.map(filing => displayAccession(filing.accession)),
      secEligibleFilings: truth.filings.length,
      secSubmissionsEvidenceSha256: truth.evidenceSha256,
      secSourceCik: truth.sourceCik,
      secRecentRawFilings: truth.recentRawFilings,
      secArchivePlanComplete: truth.archivePlanComplete,
      secArchiveDescriptorCount: truth.archiveDescriptorCount,
      secRelevantArchiveCount: truth.relevantArchiveCount,
      secArchivePlanSha256: truth.archivePlanSha256,
      secArchiveEvidence: truth.archiveEvidence,
      candidatePage: parsedHits.map(hit => ({
        accession: hit.accession, form: hit.form, filingDate: hit.filingDate,
      })),
      secExpectedPage: [],
      ms,
      serverErrorResponses,
    };
  }

  // The candidate was asked for a five-row page. One genuine newest filing is
  // freshness evidence, not retrieval-coverage evidence: require the complete
  // independently known page (or every eligible filing when fewer than five
  // exist), in the product RPC's date-desc/accession-asc order.
  const expectedPage = [...truth.filings]
    .sort((left, right) => (
      right.filingDate.localeCompare(left.filingDate)
      || left.accession.localeCompare(right.accession)
    ))
    .slice(0, CANDIDATE_PAGE_SIZE);
  if (parsedHits.length !== expectedPage.length) {
    return emptyOutcome(
      'FAIL',
      `candidate returned ${parsedHits.length}/${expectedPage.length} independently expected page hits`,
      ms,
      serverErrorResponses,
      truth,
    );
  }
  for (const [index, expected] of expectedPage.entries()) {
    const actual = parsedHits[index];
    if (
      actual.accession !== expected.accession
      || actual.form !== expected.form
      || actual.filingDate !== expected.filingDate
    ) {
      return emptyOutcome(
        'FAIL',
        `candidate page hit ${index + 1} ${displayAccession(actual.accession)} does not match SEC expected ${displayAccession(expected.accession)}`,
        ms,
        serverErrorResponses,
        truth,
      );
    }
  }

  return {
    status: 'PASS',
    detail: '',
    filings: hits.length,
    newest: first.filingDate,
    newestAccession: displayAccession(first.accession),
    secNewest: truth.newestDate,
    secNewestAccessions: truth.newestFilings.map(filing => displayAccession(filing.accession)),
    secEligibleFilings: truth.filings.length,
    secSubmissionsEvidenceSha256: truth.evidenceSha256,
    secSourceCik: truth.sourceCik,
    secRecentRawFilings: truth.recentRawFilings,
    secArchivePlanComplete: truth.archivePlanComplete,
    secArchiveDescriptorCount: truth.archiveDescriptorCount,
    secRelevantArchiveCount: truth.relevantArchiveCount,
    secArchivePlanSha256: truth.archivePlanSha256,
    secArchiveEvidence: truth.archiveEvidence,
    candidatePage: parsedHits.map(hit => ({
      accession: hit.accession, form: hit.form, filingDate: hit.filingDate,
    })),
    secExpectedPage: expectedPage,
    ms,
    serverErrorResponses,
  };
}

interface FetchedDirectory {
  rows: DirectoryRow[];
  payload: unknown;
  evidence: DirectoryUniverseEvidence;
}

async function fetchDirectory(): Promise<FetchedDirectory> {
  const res = await fetch(DIRECTORY_SOURCE, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`directory fetch: HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  const rawPayload = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new Error('directory fetch returned malformed JSON');
  }
  const { directory } = projectSecCompanyDirectory(payload);
  const rows = directory.map(entry => ({ ...entry }));
  const fetchedAt = new Date().toISOString();
  return {
    rows,
    payload,
    evidence: buildDirectoryUniverseEvidence(rows, {
      responseStatus: res.status,
      contentType,
      fetchedAt,
      lastModified: res.headers.get('last-modified') || '',
      etag: res.headers.get('etag') || '',
      payloadBytes: Buffer.byteLength(rawPayload),
      payloadSha256: createHash('sha256').update(rawPayload).digest('hex'),
    }),
  };
}

/** Search the deployed candidate facet API by exact resolved CIK. */
async function searchByCik(cik: string): Promise<{
  hits: ProductSearchHit[];
  ms: number;
  status: number;
  serverErrorResponses: number;
}> {
  const t0 = performance.now();
  const url = `${BASE}/api/es-search?${new URLSearchParams({ cik, size: String(CANDIDATE_PAGE_SIZE) })}`;
  let serverErrors = 0;
  try {
    let res = await fetch(url, {
      headers: candidateRequestHeaders('/api/es-search', 'GET', { requestOrigin: BASE }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status >= 500) serverErrors += 1;
    if (res.status >= 500) {
      await new Promise(resolve => setTimeout(resolve, 750));
      res = await fetch(url, {
        headers: candidateRequestHeaders('/api/es-search', 'GET', { requestOrigin: BASE }),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status >= 500) serverErrors += 1;
    }
    const ms = performance.now() - t0;
    if (!res.ok) return { hits: [], ms, status: res.status, serverErrorResponses: serverErrors };
    const json = await res.json();
    if (!Array.isArray(json?.hits?.hits)) {
      throw new CandidateSearchError('candidate returned malformed hits', serverErrors, ms);
    }
    return { hits: json.hits.hits as ProductSearchHit[], ms, status: res.status, serverErrorResponses: serverErrors };
  } catch (error) {
    if (error instanceof CandidateSearchError) throw error;
    throw new CandidateSearchError(
      error instanceof Error ? error.message : String(error),
      serverErrors,
      performance.now() - t0,
    );
  }
}

async function fetchSecJson(url: string): Promise<unknown> {
  let lastDetail = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await pacedSecFetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return res.json();
      lastDetail = `${url} returned HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (error) {
      lastDetail = `${url} request failed (${error instanceof Error ? error.message : String(error)})`;
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(lastDetail || `${url} could not be fetched`);
}

/** Fetch the independent filing list; an unavailable source never proves empty. */
async function fetchSecSubmissionsTruth(cik: string): Promise<SecSubmissionsTruth> {
  const padded = cik.padStart(10, '0');
  try {
    const mainPayload = await fetchSecJson(`https://data.sec.gov/submissions/CIK${padded}.json`);
    return completeSecSubmissionsTruth(
      mainPayload,
      name => fetchSecJson(`https://data.sec.gov/submissions/${encodeURIComponent(name)}`),
      cik,
    );
  } catch (error) {
    return unavailableSecTruth(
      `${error instanceof Error ? error.message : String(error)} — cannot establish ground truth`,
    );
  }
}

export function selectResolverCanaryRows(
  directory: DirectoryRow[],
  requested = RESOLVER_CANARY_SIZE,
): DirectoryRow[] {
  const canonical = canonicalDirectoryProjection(directory);
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('resolver canary size is invalid');
  if (canonical.length < requested) throw new Error(`resolver canary requires ${requested} directory rows`);
  return Array.from({ length: requested }, (_, index) => {
    const position = Math.floor((index * canonical.length) / requested);
    const row = canonical[position];
    return { ticker: row.ticker, cik: row.officialCik, title: row.title };
  });
}

async function withBoundDirectoryProductFetch<T>(payload: unknown, run: () => Promise<T>): Promise<T> {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!raw.startsWith('/api/')) return nativeFetch(input, init);
    const local = new URL(raw, 'https://ticker-coverage.invalid');
    if (
      local.pathname === '/api/sec-proxy'
      && local.searchParams.get('path') === 'files/company_tickers.json'
    ) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`ticker resolver canary refuses unexpected product route ${local.pathname}`);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function runExactShaResolverCanary(
  directory: DirectoryRow[],
  directoryPayload: unknown,
  directoryEvidence: DirectoryUniverseEvidence,
  outcomes: Map<string, CikOutcome>,
): Promise<ResolverCanaryEvidence> {
  const expectedSha = String(process.env.EXPECTED_SHA || '').trim().toLowerCase();
  const deploymentId = String(process.env.CANDIDATE_DEPLOYMENT_ID || '').trim();
  const sourceUrls = [
    new URL('../src/services/secApi.ts', import.meta.url),
  ];
  const sourceFiles = sourceUrls.map(url => ({
    path: url.pathname.split('/').slice(-3).join('/'),
    sha256: createHash('sha256').update(readFileSync(url)).digest('hex'),
  }));
  const problems: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) problems.push('EXPECTED_SHA is missing or invalid');
  if (!deploymentId) problems.push('CANDIDATE_DEPLOYMENT_ID is missing');
  const sample = selectResolverCanaryRows(directory);
  const outcomesByCik = new Map<string, CikOutcome>();
  for (const [rawCik, outcome] of outcomes) {
    const normalized = normalizeCoverageCik(rawCik);
    if (normalized) outcomesByCik.set(normalized, outcome);
  }

  const rows = await withBoundDirectoryProductFetch(directoryPayload, async () => {
    const checked: ResolverCanaryRow[] = [];
    for (const row of sample) {
      const resolved = await resolveCompanyInput(row.ticker, { verifyFilingHistory: false });
      const resolvedCik = normalizeCoverageCik(resolved?.cik) || '';
      const deployedStatus = outcomesByCik.get(resolvedCik)?.status || 'MISSING';
      checked.push({
        ticker: row.ticker,
        officialCik: normalizeCoverageCik(row.cik) || '',
        resolvedCik,
        title: row.title,
        resolvedTitle: resolved?.title || '',
        deployedStatus,
        pass: Boolean(
          resolved
          && resolved.ticker === row.ticker
          && resolvedCik === normalizeCoverageCik(row.cik)
          && resolved.title === row.title
          && (deployedStatus === 'PASS' || deployedStatus === 'EMPTY_VERIFIED')
        ),
      });
    }
    return checked;
  });
  const passed = rows.filter(row => row.pass).length;
  if (rows.length !== RESOLVER_CANARY_SIZE) {
    problems.push(`resolver canary tested ${rows.length}/${RESOLVER_CANARY_SIZE} rows`);
  }
  if (passed !== rows.length) problems.push(`resolver canary passed ${passed}/${rows.length} rows`);
  const digest = sha256Json({
    expectedSha,
    deploymentId,
    candidateBase: BASE,
    directoryProjectionDigest: directoryEvidence.projectionDigest,
    sourceFiles,
    rows,
  });
  return {
    schema: RESOLVER_CANARY_SCHEMA,
    mode: 'exact-sha-product-resolver-with-bound-official-directory',
    productFunction: 'resolveCompanyInput',
    verifyFilingHistory: false,
    expectedSha,
    deploymentId,
    candidateBase: BASE,
    directDeployedResolverRoute: false,
    dependencyScope: {
      directory: 'direct-sec-cryptographically-bound-payload',
      submissionsTruth: 'direct-sec-complete-submissions',
      search: 'immutable-candidate-api-es-search',
    },
    routeLimitation: '/api/sec-proxy is intentionally outside the staged release-token allowlist; no deployed resolver route is claimed. The exact-SHA product resolver runs locally against the cryptographically bound direct-SEC directory payload, direct-SEC submissions supplies truth, and only /api/es-search is candidate-deployed',
    directoryProjectionDigest: directoryEvidence.projectionDigest,
    sampleMethod: 'canonical-even-spread-v1',
    requested: RESOLVER_CANARY_SIZE,
    tested: rows.length,
    passed,
    sourceFiles,
    rows,
    algorithm: 'sha256',
    digest,
    pass: problems.length === 0,
    problems,
  };
}

async function main() {
  console.log(`Target: ${BASE}`);
  const fetchedDirectory = await fetchDirectory();
  const directory = fetchedDirectory.rows;
  console.log(`Directory: ${directory.length} tickers`);

  const resolution = buildResolutionPlan(directory);
  console.log(`Stage 1 — resolution: ${resolution.resolvedRows.length}/${directory.length} resolve to their official CIK`);

  // Share classes reuse a single resolved-CIK retrieval and truth request.
  const resolvedCikByTicker = new Map(
    resolution.resolvedRows.map(item => [item.row.ticker, item.resolvedCik]),
  );
  const ciks = resolution.retrievalCiks;
  console.log(`Stage 2 — retrieval and independent SEC freshness: ${ciks.length} unique issuers (concurrency ${CONCURRENCY})...`);

  const cikOutcome = new Map<string, CikOutcome>();
  let done = 0;
  let index = 0;

  async function worker() {
    while (index < ciks.length) {
      const cik = ciks[index++];
      try {
        // The candidate result cannot be accepted until the independent SEC
        // request succeeds, even when it is non-empty and internally sorted.
        const [{ hits, ms, status, serverErrorResponses }, truth] = await Promise.all([
          searchByCik(cik),
          fetchSecSubmissionsTruth(cik),
        ]);
        if (status !== 200) {
          cikOutcome.set(cik, emptyOutcome('FAIL', `API HTTP ${status}`, ms, serverErrorResponses, truth));
        } else {
          cikOutcome.set(cik, evaluateCikSearch(cik, hits, truth, ms, serverErrorResponses));
        }
      } catch (error) {
        cikOutcome.set(cik, emptyOutcome(
          'FAIL',
          `request error: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof CandidateSearchError ? error.ms : 0,
          error instanceof CandidateSearchError ? error.serverErrorResponses : 0,
        ));
      }
      done += 1;
      if (done % 500 === 0) console.log(`  ...${done}/${ciks.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const results: TickerResult[] = [...resolution.failures];
  const failedResolutionTickers = new Set(resolution.failures.map(result => result.ticker));
  for (const row of directory) {
    if (failedResolutionTickers.has(row.ticker)) continue;
    const resolvedCik = resolvedCikByTicker.get(row.ticker);
    const outcome = resolvedCik ? cikOutcome.get(resolvedCik) : undefined;
    if (!resolvedCik || !outcome) {
      results.push(failedResolution(row, resolvedCik || '', 'internal coverage plan omitted resolved issuer'));
      continue;
    }
    results.push({ ticker: row.ticker, title: row.title, cik: row.cik, resolvedCik, ...outcome });
  }

  const resolverCanary = await runExactShaResolverCanary(
    directory,
    fetchedDirectory.payload,
    fetchedDirectory.evidence,
    cikOutcome,
  );

  const pass = results.filter(result => result.status === 'PASS');
  const empty = results.filter(result => result.status === 'EMPTY_VERIFIED');
  const fail = results.filter(result => result.status === 'FAIL');
  const serverErrorResponses = Array.from(cikOutcome.values())
    .reduce((total, outcome) => total + outcome.serverErrorResponses, 0);
  const casesWith5xx = Array.from(cikOutcome.values())
    .filter(outcome => outcome.serverErrorResponses > 0).length;
  const requestErrors = fail.filter(result => result.detail.startsWith('request error:')).length;
  const groundTruthErrors = fail.filter(result => result.detail.startsWith('SEC ground truth unavailable:')).length;
  const lat = Array.from(cikOutcome.values()).map(outcome => outcome.ms).sort((a, b) => a - b);
  const pct = (percentile: number) => Math.round(
    lat[Math.min(lat.length - 1, Math.floor((percentile / 100) * lat.length))] || 0,
  );

  console.log('\n=== TICKER COVERAGE RESULTS ===');
  console.log(`Tickers:          ${results.length}`);
  console.log(`PASS:             ${pass.length}`);
  console.log(`EMPTY_VERIFIED:   ${empty.length}  (no eligible post-2010 filings per SEC submissions)`);
  console.log(`FAIL:             ${fail.length}`);
  console.log(`Accuracy:         ${(((pass.length + empty.length) / results.length) * 100).toFixed(2)}% (target 100.00%)`);
  console.log(`Latency:          p50=${pct(50)}ms  p95=${pct(95)}ms`);
  console.log(`Availability:     ${serverErrorResponses} HTTP 5xx response(s) across ${casesWith5xx} issuer(s); ${requestErrors} candidate request error(s); ${groundTruthErrors} SEC evidence error(s)`);
  console.log(`Resolver canary:  ${resolverCanary.passed}/${resolverCanary.tested} exact-SHA product resolver/deployed retrieval pairs`);
  for (const failure of fail.slice(0, 30)) {
    console.log(`  FAIL ${failure.ticker} (${failure.title}): ${failure.detail}`);
  }
  if (empty.length > 0) {
    console.log('\nEMPTY_VERIFIED sample:');
    for (const result of empty.slice(0, 10)) {
      console.log(`  ${result.ticker} (${result.title}): ${result.detail}`);
    }
  }

  const generatedAt = new Date().toISOString();
  const coverageEvidence = buildCoverageEvidenceManifest(results);
  const coverageProblems = coverageCompletenessProblems(fetchedDirectory.evidence, coverageEvidence);
  if (fail.length > 0) coverageProblems.push(`${fail.length} ticker result(s) failed`);
  const coverageComplete = coverageProblems.length === 0;
  writeFileSync(OUT, JSON.stringify({
    base: BASE,
    generatedAt,
    tickers: results.length,
    uniqueIssuers: ciks.length,
    pass: pass.length,
    emptyVerified: empty.length,
    fail: fail.length,
    evidence: {
      resolverCikMatches: resolution.resolvedRows.length,
      candidateSearchInput: 'resolved CIK',
      independentSource: 'SEC submissions',
      independentChecks: cikOutcome.size,
      newestFilingMatches: Array.from(cikOutcome.values()).filter(outcome => outcome.status === 'PASS').length,
      requiredHitFields: ['accession', 'form', 'file_date', 'ciks'],
      groundTruthErrors,
      resolverCanary,
    },
    coverageManifest: {
      generatedAt,
      directorySource: DIRECTORY_SOURCE,
      source: 'https://data.sec.gov/submissions/CIK##########.json',
      algorithm: 'sha256',
      digest: coverageEvidence.sha256,
      keyDigest: coverageEvidence.keyDigest,
      projectionDigest: coverageEvidence.projectionDigest,
      count: coverageEvidence.rows.length,
      complete: coverageComplete,
      problems: coverageProblems,
      directoryUniverse: fetchedDirectory.evidence,
      rows: coverageEvidence.rows,
    },
    latency: { p50: pct(50), p95: pct(95) },
    availability: { serverErrorResponses, casesWith5xx, requestErrors },
    serverErrorCases: results
      .filter(result => result.serverErrorResponses > 0)
      .map(result => ({
        ticker: result.ticker,
        cik: result.cik,
        resolvedCik: result.resolvedCik,
        serverErrorResponses: result.serverErrorResponses,
        finalStatus: result.status,
        ms: result.ms,
      })),
    failures: fail,
    emptyVerifiedList: empty.map(result => ({
      ticker: result.ticker,
      title: result.title,
      detail: result.detail,
    })),
  }, null, 2));
  console.log(`\nFull results: ${OUT}`);

  process.exit(
    fail.length > 0
    || serverErrorResponses > 0
    || requestErrors > 0
    || !coverageComplete
    || !resolverCanary.pass
      ? 1
      : 0,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Ticker coverage failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
