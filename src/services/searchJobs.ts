/**
 * Search continuation jobs — the pure half (gap analysis row 10).
 *
 * A browser search validates one bounded wave. When the question needs filing
 * text to answer it, that wave cannot say how many filings match: EDGAR's
 * total counts candidates, not answers. A continuation job keeps validating on
 * the server, wave after wave, until the candidate set is exhausted or a hard
 * cap is reached, and only then may the headline say "N filings match
 * (verified)".
 *
 * This module owns everything about a job that is not I/O: validating the
 * request, compiling and pinning its plan, the cursor's wire format, the
 * coverage claim derived from the cursor, the status decision after a wave,
 * the headline, and merging a filing found again through another document.
 * The worker (src/app/api/search-jobs/_server) supplies the I/O.
 */

import { defaultSearchFilters, type SearchFilters } from '../domain/searchFilters';
import { BOOLEAN_ENGINE_VERSION, type BooleanSearchNode } from '../utils/booleanSearch';
import {
  compileSearchPlan,
  type ResearchSearchMode,
  type SearchExecutionPlan,
} from './filingResearchPlan';
import { finalizeRunCoverage } from './filingResearchCoverage';
import {
  buildWaveExecutionPolicy,
  createResumableCursor,
  isLaneFinished,
  isLaneStalled,
  RESUMABLE_CURSOR_VERSION,
  type ResumableLaneState,
  type ResumableWaveCursor,
} from './filingResearchExecution';
import { formatUpstreamTotal, type CandidateCoverageNotice } from './searchCoverage';
import type { FilingResearchResult } from './filingResearch';

/**
 * Bumped whenever the executor's semantics change. A job compiled under one
 * engine is never advanced by another — mixing two engines' verdicts in one
 * count would make the count mean nothing.
 */
export const SEARCH_JOB_ENGINE_VERSION = `wave-cursor-${RESUMABLE_CURSOR_VERSION}.boolean-${BOOLEAN_ENGINE_VERSION}`;

/** Hard caps for one job. Per-wave limits stay the executor's own policy. */
export const SEARCH_JOB_LIMITS = {
  /** Candidates examined across every wave. */
  maxExamined: 5_000,
  /** Wall time spent inside waves, summed. */
  maxWorkMs: 60 * 60 * 1000,
  /** A job that has not finished by then is closed as expired. */
  ttlSeconds: 24 * 60 * 60,
  /** Lease one worker holds on a job for one wave. */
  leaseSeconds: 150,
  hitsPageSize: 50,
  maxHitsPageSize: 200,
} as const;

export type SearchJobStatus = 'running' | 'finished' | 'capped' | 'expired' | 'failed' | 'cancelled';

export const SEARCH_JOB_STATUSES: readonly SearchJobStatus[] = [
  'running', 'finished', 'capped', 'expired', 'failed', 'cancelled',
];

/** What the browser asks the job to answer — the run's resolved search. */
export interface SearchJobPlanInput {
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
  defaultForms: string;
  includeExhibits: boolean;
  hydrateTextSignals: boolean;
}

/** What is stored as `plan`: the inputs, the pinned date, and the compiled
 *  lanes, so a later wave can prove it is executing the same plan. */
export interface SearchJobPlan {
  engineVersion: string;
  input: SearchJobPlanInput;
  /** The upper filing date fixed at creation, so filings arriving while the
   *  job runs cannot shift upstream offsets or change the population. */
  pinnedDateTo: string;
  lanes: string[];
  requiredBranches: number;
}

// ── Request validation ───────────────────────────────────────────────────────

const MAX_QUERY_LENGTH = 2_000;
const MAX_FILTER_STRING = 500;
const MAX_FILTER_ARRAY = 50;
const FORM_LIST = /^[A-Za-z0-9 ,/.-]{0,500}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Strictly typed copy of a client-supplied filter object. Unknown keys are
 *  dropped; a wrongly typed known key rejects the request. */
export function parseSearchJobFilters(value: unknown): SearchFilters | null {
  if (!isRecord(value)) return null;
  const filters: SearchFilters = { ...defaultSearchFilters, exchange: [], formTypes: [], acceleratedStatus: [] };
  for (const [key, fallback] of Object.entries(defaultSearchFilters) as Array<[keyof SearchFilters, unknown]>) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(fallback)) {
      if (!Array.isArray(raw) || raw.length > MAX_FILTER_ARRAY) return null;
      if (raw.some(item => typeof item !== 'string' || item.length > 100)) return null;
      (filters[key] as string[]) = raw.map(item => (item as string).trim()).filter(Boolean);
    } else {
      if (typeof raw !== 'string' || raw.length > MAX_FILTER_STRING) return null;
      (filters[key] as string) = raw;
    }
  }
  if (filters.dateFrom && !ISO_DATE.test(filters.dateFrom)) return null;
  if (filters.dateTo && !ISO_DATE.test(filters.dateTo)) return null;
  if (filters.entityCik && !/^\d{1,10}$/.test(filters.entityCik)) return null;
  return filters;
}

export function parseSearchJobPlanInput(value: unknown): SearchJobPlanInput | null {
  if (!isRecord(value)) return null;
  const { query, mode, filters, defaultForms, includeExhibits, hydrateTextSignals } = value;
  if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) return null;
  if (mode !== 'boolean' && mode !== 'semantic') return null;
  if (typeof defaultForms !== 'string' || !FORM_LIST.test(defaultForms)) return null;
  if (typeof includeExhibits !== 'boolean' || typeof hydrateTextSignals !== 'boolean') return null;
  const parsedFilters = parseSearchJobFilters(filters);
  if (!parsedFilters) return null;
  return { query, mode, filters: parsedFilters, defaultForms, includeExhibits, hydrateTextSignals };
}

// ── Plan compilation ─────────────────────────────────────────────────────────

export type CompileSearchJobResult =
  | { ok: true; plan: SearchJobPlan; compiled: SearchExecutionPlan }
  | { ok: false; code: 'invalid-query' | 'not-needed' | 'unsupported'; message: string };

/**
 * Compile a job's plan. Deterministic: the same input and pinned date always
 * produce the same lanes, which is what lets every later wave re-derive the
 * executor context and check it still matches what was stored.
 *
 * The job collects candidates from paced EDGAR full-text search only. The
 * enriched facet lane (/api/es-search) is a browser route; compiling with
 * useEnrichedSearch=false makes the planner emit the text lanes it already
 * uses as that lane's fallback, so every lane is one the worker can page.
 */
export function compileSearchJobPlan(input: SearchJobPlanInput, today: string): CompileSearchJobResult {
  const pinnedDateTo = input.filters.dateTo && input.filters.dateTo < today ? input.filters.dateTo : today;
  const compiled = compileSearchPlan({
    query: input.query,
    filters: { ...input.filters, dateTo: pinnedDateTo },
    mode: input.mode,
    defaultForms: input.defaultForms,
    limit: 500,
    includeExhibits: input.includeExhibits,
    deferTextValidation: false,
    preferFastCandidateCollection: false,
    hydrateTextSignals: input.hydrateTextSignals,
    useEnrichedSearch: false,
  });
  if (!compiled) {
    return { ok: false, code: 'invalid-query', message: 'The Boolean expression could not be compiled.' };
  }
  if (!compiled.shouldHydrateSignals || compiled.delegatedToEfts) {
    return {
      ok: false,
      code: 'not-needed',
      message: 'EDGAR already answers this search without reading filing text, so there is nothing to keep validating.',
    };
  }
  const hasIssuer = Boolean(compiled.filters.entityName.trim() || (compiled.filters.entityCik || '').trim());
  if (compiled.filteredServerQueries.some(lane => !lane.trim()) && !hasIssuer) {
    return {
      ok: false,
      code: 'unsupported',
      message: 'This search has no text EDGAR full-text search can page (a filter-only browse). Add a query term to keep validating.',
    };
  }
  return {
    ok: true,
    compiled,
    plan: {
      engineVersion: SEARCH_JOB_ENGINE_VERSION,
      input,
      pinnedDateTo,
      lanes: [...compiled.filteredServerQueries],
      requiredBranches: compiled.requiredBooleanBranches,
    },
  };
}

/** Re-derive a stored plan for a wave, refusing drift. */
export function recompileStoredPlan(
  plan: SearchJobPlan
): { ok: true; compiled: SearchExecutionPlan } | { ok: false; reason: string } {
  if (plan.engineVersion !== SEARCH_JOB_ENGINE_VERSION) {
    return { ok: false, reason: `The search engine changed (${plan.engineVersion} → ${SEARCH_JOB_ENGINE_VERSION}); start a new job.` };
  }
  const result = compileSearchJobPlan(
    { ...plan.input, filters: { ...plan.input.filters, dateTo: plan.pinnedDateTo } },
    plan.pinnedDateTo
  );
  if (!result.ok) return { ok: false, reason: result.message };
  const sameLanes =
    result.plan.lanes.length === plan.lanes.length &&
    result.plan.lanes.every((lane, index) => lane === plan.lanes[index]) &&
    result.plan.requiredBranches === plan.requiredBranches;
  if (!sameLanes) return { ok: false, reason: 'The stored plan no longer compiles to the same retrieval lanes; start a new job.' };
  return { ok: true, compiled: result.compiled };
}

export function parseStoredSearchJobPlan(value: unknown): SearchJobPlan | null {
  if (!isRecord(value)) return null;
  const input = parseSearchJobPlanInput(value.input);
  if (!input) return null;
  if (typeof value.engineVersion !== 'string') return null;
  if (typeof value.pinnedDateTo !== 'string' || !ISO_DATE.test(value.pinnedDateTo)) return null;
  if (!Array.isArray(value.lanes) || value.lanes.some(lane => typeof lane !== 'string')) return null;
  if (!Number.isSafeInteger(value.requiredBranches) || Number(value.requiredBranches) < 0) return null;
  return {
    engineVersion: value.engineVersion,
    input,
    pinnedDateTo: value.pinnedDateTo,
    lanes: value.lanes as string[],
    requiredBranches: Number(value.requiredBranches),
  };
}

/** The executor's `search` block for a compiled job plan. */
export function searchJobContext(compiled: SearchExecutionPlan, input: SearchJobPlanInput): {
  query: string;
  filters: SearchFilters;
  mode: ResearchSearchMode;
  formTypes: string;
  formScope: string[];
  excludeExhibits: boolean;
  needsCompanyMetadata: boolean;
  needsTextFiltering: boolean;
  booleanExpression: BooleanSearchNode | null;
  delegatedToEfts: boolean;
  hydratePerDocumentSignals: boolean;
  useEnrichedSearch: boolean;
  includeExhibits: boolean;
  entityCik: string;
  preferRelevance: boolean;
} {
  return {
    query: compiled.query,
    filters: compiled.filters,
    mode: input.mode,
    formTypes: compiled.formTypes,
    formScope: compiled.formScope,
    excludeExhibits: compiled.excludeExhibits,
    needsCompanyMetadata: compiled.needsCompanyMetadata,
    needsTextFiltering: compiled.needsTextFiltering,
    booleanExpression: compiled.parsedBooleanQuery.expression,
    delegatedToEfts: compiled.delegatedToEfts,
    hydratePerDocumentSignals: compiled.hydratePerDocumentSignals,
    useEnrichedSearch: false,
    includeExhibits: input.includeExhibits,
    entityCik: (compiled.filters.entityCik || '').trim(),
    preferRelevance: compiled.preferRelevance,
  };
}

/** The fixed per-wave policy for a compiled job plan (unchanged values). */
export function searchJobPolicy(compiled: SearchExecutionPlan) {
  return buildWaveExecutionPolicy(compiled.delegatedToEfts, compiled.requiredBooleanBranches);
}

// ── Cursor wire format ───────────────────────────────────────────────────────

export type SearchJobCursor = ResumableWaveCursor<FilingResearchResult>;

/** Stored cursor: the resumable cursor plus a digest of the seen set, so a
 *  truncated or hand-edited cursor is detected instead of silently
 *  re-examining (or skipping) candidates. */
export interface StoredSearchJobCursor extends SearchJobCursor {
  seenDigest: string;
}

/** FNV-1a (64-bit) over the sorted seen ids — a stable integrity digest. */
export function digestSeenSet(seen: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const id of [...seen].sort()) {
    for (const byte of new TextEncoder().encode(`${id}\n`)) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

export function createSearchJobCursor(plan: SearchJobPlan): StoredSearchJobCursor {
  return serializeSearchJobCursor(createResumableCursor<FilingResearchResult>(plan.lanes, plan.requiredBranches));
}

export function serializeSearchJobCursor(cursor: SearchJobCursor): StoredSearchJobCursor {
  const plain = JSON.parse(JSON.stringify(cursor)) as SearchJobCursor;
  return { ...plain, seenDigest: digestSeenSet(plain.seen) };
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPendingResult(value: unknown): value is FilingResearchResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.cik === 'string' &&
    typeof value.accessionNumber === 'string' &&
    typeof value.primaryDocument === 'string' &&
    typeof value.filingPrimaryDocument === 'string' &&
    typeof value.formType === 'string'
  );
}

function parseLane(value: unknown): ResumableLaneState<FilingResearchResult> | null {
  if (!isRecord(value)) return null;
  const ledger = value.ledger;
  if (
    typeof value.query !== 'string' ||
    typeof value.required !== 'boolean' ||
    !nonNegativeInteger(value.nextOffset) ||
    typeof value.collectionComplete !== 'boolean' ||
    typeof value.windowCapped !== 'boolean' ||
    !nonNegativeInteger(value.upstreamTotal) ||
    typeof value.upstreamTotalIsFloor !== 'boolean' ||
    !Array.isArray(value.pending) ||
    !value.pending.every(isPendingResult) ||
    !nonNegativeInteger(value.consecutiveErrors) ||
    !isRecord(ledger) ||
    typeof ledger.branch !== 'string' ||
    typeof ledger.required !== 'boolean' ||
    !['pages', 'candidatesSurfaced', 'candidatesNew', 'examined', 'matched'].every(key => nonNegativeInteger(ledger[key])) ||
    typeof ledger.exhausted !== 'boolean'
  ) {
    return null;
  }
  return value as unknown as ResumableLaneState<FilingResearchResult>;
}

/** Validate a stored cursor. Returns null for anything malformed, a wrong
 *  version, or a seen set that does not match its digest. */
export function parseSearchJobCursor(value: unknown): StoredSearchJobCursor | null {
  if (!isRecord(value)) return null;
  if (value.version !== RESUMABLE_CURSOR_VERSION) return null;
  if (!Array.isArray(value.lanes) || value.lanes.length === 0) return null;
  const lanes = value.lanes.map(parseLane);
  if (lanes.some(lane => lane === null)) return null;
  if (!Array.isArray(value.seen) || value.seen.some(id => typeof id !== 'string')) return null;
  if (typeof value.seenDigest !== 'string' || value.seenDigest !== digestSeenSet(value.seen as string[])) return null;
  if (!isRecord(value.retries) || Object.values(value.retries).some(count => !nonNegativeInteger(count))) return null;
  const totals = value.totals;
  if (
    !isRecord(totals) ||
    !['waves', 'examined', 'matchedDocuments', 'unvalidatedFailures', 'pageRequests', 'docFetches', 'docHttpAttempts', 'prescreenRequests', 'elapsedMs']
      .every(key => nonNegativeInteger(totals[key])) ||
    !isRecord(totals.failureKinds) ||
    Object.values(totals.failureKinds).some(count => !nonNegativeInteger(count))
  ) {
    return null;
  }
  return value as unknown as StoredSearchJobCursor;
}

// ── Coverage, status and headline ────────────────────────────────────────────

/**
 * The job's coverage claim, from the cursor alone, through the SAME finalizer
 * a browser run uses: complete only when every lane's upstream is exhausted,
 * every collected candidate reached a verdict, every required branch is
 * exhausted, and no candidate was excluded for unreadable text.
 */
export function buildSearchJobCoverage(
  cursor: SearchJobCursor,
  options: { stoppedEarly: boolean; cancelled: boolean; verifiedFilings: number; perWavePolicy: ReturnType<typeof buildWaveExecutionPolicy> }
): CandidateCoverageNotice {
  const { totals, lanes } = cursor;
  const failureKinds = new Map(Object.entries(totals.failureKinds));
  const finalized = finalizeRunCoverage({
    upstreamCoverage: {
      examined: cursor.seen.length,
      upstreamTotal: Math.max(0, ...lanes.map(lane => lane.upstreamTotal)),
      complete: lanes.every(lane => lane.collectionComplete),
      upstreamTotalIsFloor: lanes.some(lane => lane.upstreamTotalIsFloor),
    },
    collectedCandidates: cursor.seen.length,
    validationExamined: totals.examined,
    validationTimedOut: false,
    budgetExhausted: options.stoppedEarly,
    aborted: options.cancelled,
    unvalidatedFetchFailures: totals.unvalidatedFailures,
    fetchFailureKinds: failureKinds,
    completedQueryVariants: lanes.filter(isLaneFinished).length,
    totalQueryVariants: lanes.length,
    branchLedgers: lanes.map(lane => ({ ...lane.ledger })),
    // Ceilings scale with the waves actually run: each wave had the policy's
    // own ceiling, so the job's ceiling is that times the waves.
    maxPageRequests: options.perWavePolicy.maxPageRequests * Math.max(totals.waves, 1),
    maxDocAttempts: options.perWavePolicy.maxDocAttempts * Math.max(totals.waves, 1),
    work: {
      pageRequests: totals.pageRequests,
      docFetches: totals.docFetches,
      docHttpAttempts: totals.docHttpAttempts,
      prescreenRequests: totals.prescreenRequests,
      maxDocHttpAttempts: options.perWavePolicy.maxDocHttpAttempts * Math.max(totals.waves, 1),
      maxPrescreenRequests: options.perWavePolicy.maxPrescreenRequests * Math.max(totals.waves, 1),
    },
  });
  const coverage: CandidateCoverageNotice = { ...finalized.coverage };
  // A complete job has read every candidate: its verified filings ARE the
  // match population. Anything short of complete is a floor.
  coverage.verifiedMatchTotal = options.verifiedFilings;
  coverage.verifiedMatchTotalIsFloor = !finalized.coverage.complete;
  return coverage;
}

/** What the job should become after a wave. */
export function decideSearchJobStatus(
  cursor: SearchJobCursor,
  options: { now: number; expiresAt: number }
): { status: SearchJobStatus; reason: string | null } {
  const { lanes, totals } = cursor;
  if (lanes.every(isLaneFinished)) return { status: 'finished', reason: null };
  const working = lanes.filter(lane => !isLaneFinished(lane) && !isLaneStalled(lane));
  if (working.length === 0) {
    const capped = lanes.some(lane => lane.windowCapped);
    return {
      status: 'capped',
      reason: capped
        ? 'EDGAR full-text search serves at most 10,000 results per query; narrow the dates or forms to reach the rest.'
        : 'EDGAR full-text search failed repeatedly for a retrieval lane.',
    };
  }
  if (totals.examined >= SEARCH_JOB_LIMITS.maxExamined) {
    return { status: 'capped', reason: `Reached the ${SEARCH_JOB_LIMITS.maxExamined.toLocaleString()}-document limit for one job.` };
  }
  if (totals.elapsedMs >= SEARCH_JOB_LIMITS.maxWorkMs) {
    return { status: 'capped', reason: 'Reached the 60-minute work limit for one job.' };
  }
  if (options.now >= options.expiresAt) return { status: 'expired', reason: 'Expired before finishing.' };
  return { status: 'running', reason: null };
}

/** The job as the API reports it. */
export interface SearchJobSummary {
  id: string;
  status: SearchJobStatus;
  statusReason: string | null;
  plan: SearchJobPlan;
  examined: number;
  verified: number;
  upstreamTotal: number | null;
  upstreamTotalIsFloor: boolean;
  coverage: CandidateCoverageNotice | null;
  waves: number;
  leased: boolean;
  lastWaveAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export function parseSearchJobSummary(value: unknown): SearchJobSummary | null {
  if (!isRecord(value)) return null;
  const plan = parseStoredSearchJobPlan(value.plan);
  if (!plan) return null;
  if (typeof value.id !== 'string' || !SEARCH_JOB_STATUSES.includes(value.status as SearchJobStatus)) return null;
  if (!nonNegativeInteger(value.examined) || !nonNegativeInteger(value.verified) || !nonNegativeInteger(value.waves)) return null;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || typeof value.expiresAt !== 'string') return null;
  const coverage = isRecord(value.coverage) &&
    nonNegativeInteger(value.coverage.examined) &&
    nonNegativeInteger(value.coverage.upstreamTotal) &&
    typeof value.coverage.complete === 'boolean'
    ? value.coverage as unknown as CandidateCoverageNotice
    : null;
  return {
    id: value.id,
    status: value.status as SearchJobStatus,
    statusReason: typeof value.statusReason === 'string' ? value.statusReason : null,
    plan,
    examined: Number(value.examined),
    verified: Number(value.verified),
    upstreamTotal: nonNegativeInteger(value.upstreamTotal) ? Number(value.upstreamTotal) : null,
    upstreamTotalIsFloor: value.upstreamTotalIsFloor === true,
    coverage,
    waves: Number(value.waves),
    leased: value.leased === true,
    lastWaveAt: typeof value.lastWaveAt === 'string' ? value.lastWaveAt : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
  };
}

const STOP_LABELS: Record<Exclude<SearchJobStatus, 'running' | 'finished'>, string> = {
  capped: 'stopped at a limit',
  expired: 'expired',
  failed: 'stopped after repeated errors',
  cancelled: 'cancelled',
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * The job's headline. It may say "N filings match (verified)" only once the
 * job finished with complete coverage; before that it reports validated
 * matches against the upstream candidate count, with the same exact/floor
 * formatting as the run headline (formatUpstreamTotal).
 */
export function buildSearchJobHeadline(job: Pick<SearchJobSummary, 'status' | 'verified' | 'coverage' | 'examined'>): string {
  const { status, verified, coverage } = job;
  if (status === 'finished' && coverage?.complete) {
    return `${plural(verified, 'filing')} match (verified)`;
  }
  const matches = plural(verified, 'validated match', 'validated matches');
  const upstream = coverage && coverage.upstreamTotal > 0
    ? `${formatUpstreamTotal(coverage)} upstream candidates — `
    : '';
  if (status === 'running') return `${upstream}${matches} so far`;
  if (status === 'finished') {
    // Every candidate was reached, but some could not be read: the count is a
    // floor, never presented as the population.
    return `${upstream}${matches} — every candidate reached, but some filings could not be read`;
  }
  return `${upstream}${matches} — ${STOP_LABELS[status]}`;
}

/** One line on how much of the population the job has read. */
export function buildSearchJobProgressLine(job: Pick<SearchJobSummary, 'examined' | 'coverage' | 'waves'>): string {
  const coverage = job.coverage;
  const of = coverage && coverage.upstreamTotal > 0 ? ` of ${formatUpstreamTotal(coverage)}` : '';
  return `Examined ${job.examined.toLocaleString()}${of} candidates in ${plural(job.waves, 'wave')}.`;
}

export function isSearchJobActive(job: Pick<SearchJobSummary, 'status'>): boolean {
  return job.status === 'running';
}

/** True when a finished browser run left a question only a job can answer. */
export function shouldOfferSearchContinuation(
  coverage: CandidateCoverageNotice | null,
  mode: ResearchSearchMode,
  hydrateTextSignals: boolean
): boolean {
  if (!coverage || coverage.complete) return false;
  // EDGAR's own count already answers a delegated or exact-count search.
  if (coverage.verifiedMatchTotal !== undefined && !coverage.verifiedMatchTotalIsFloor) return false;
  return mode === 'boolean' || hydrateTextSignals;
}

// ── Hits ─────────────────────────────────────────────────────────────────────

/** A verified filing as stored: the executor's annotated row plus every
 *  document of the filing that matched across all waves. */
export type SearchJobHit = FilingResearchResult & { jobDocuments: string[] };

export interface SearchJobHitWrite {
  accession: string;
  fileDate: string;
  hit: SearchJobHit;
}

const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

/**
 * Fold one wave's matching documents into per-filing hit records. A filing
 * is one row however many of its documents matched, and however many waves
 * found them: the parent document is the representative when it matched,
 * otherwise the first matching exhibit is named as the evidence — the same
 * rule as the browser's roll-up, applied across waves.
 */
export function mergeSearchJobHits(
  existing: readonly SearchJobHit[],
  matches: readonly FilingResearchResult[],
  isExhibitDocumentType: (documentType: string) => boolean
): { writes: SearchJobHitWrite[]; skipped: number } {
  const byAccession = new Map<string, SearchJobHit>();
  for (const hit of existing) byAccession.set(hit.accessionNumber, hit);
  const touched = new Set<string>();
  let skipped = 0;

  for (const match of matches) {
    const accession = match.accessionNumber;
    if (!ACCESSION.test(accession)) {
      skipped += 1;
      continue;
    }
    const document = match.primaryDocument || match.documentType;
    const previous = byAccession.get(accession);
    const documents = Array.from(new Set([...(previous?.jobDocuments ?? []), document])).sort();
    const previousIsExhibit = previous ? isExhibitDocumentType(previous.documentType) : false;
    const matchIsExhibit = isExhibitDocumentType(match.documentType);
    const representative = !previous || (previousIsExhibit && !matchIsExhibit) ? match : previous;
    const representativeIsExhibit = isExhibitDocumentType(representative.documentType);

    const base: FilingResearchResult = { ...representative };
    delete base.matchedDocumentName;
    delete base.matchedDocumentType;
    delete base.matchedDocumentUrl;
    delete base.matchedDocumentCount;
    delete (base as Partial<SearchJobHit>).jobDocuments;

    const hit: SearchJobHit = { ...base, jobDocuments: documents };
    if (representativeIsExhibit) {
      const cleanAccession = accession.replace(/-/g, '');
      hit.matchedDocumentName = representative.primaryDocument;
      hit.matchedDocumentType = representative.documentType;
      hit.matchedDocumentUrl = `https://www.sec.gov/Archives/edgar/data/${representative.cik}/${cleanAccession}/${representative.primaryDocument}`;
      hit.matchedDocumentCount = documents.length;
    } else if (documents.length > 1) {
      hit.matchedDocumentCount = documents.length;
    }
    byAccession.set(accession, hit);
    touched.add(accession);
  }

  return {
    writes: Array.from(touched).sort().map(accession => {
      const hit = byAccession.get(accession)!;
      return { accession, fileDate: hit.fileDate, hit };
    }),
    skipped,
  };
}
