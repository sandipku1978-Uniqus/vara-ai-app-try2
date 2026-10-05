import type { SearchFilters } from '../domain/searchFilters';
import type { BooleanSearchNode } from '../utils/booleanSearch';
import type {
  BooleanPrescreenCandidate,
  BooleanPrescreenVerdict,
  BooleanPrescreenWork,
  BranchCoverageEntry,
  EdgarSearchHit,
  SearchCandidateCoverage,
} from './secApi';
import type { ResearchSearchMode } from './filingResearchPlan';

/** Immutable limits and fair-share reservations for one deep-search run. */
export interface WaveExecutionPolicy {
  batchSize: number;
  progressInterval: number;
  maxWaveTimeMs: number;
  maxPageRequests: number;
  maxDocAttempts: number;
  maxDocHttpAttempts: number;
  maxPrescreenRequests: number;
  docReservePerBranch: number;
  pageReservePerBranch: number;
  timeReservePerBranchMs: number;
  prescreenChunk: number;
  prescreenMaxPerWave: number;
  prescreenMinWaveReserve: number;
}

/**
 * Compile the fixed run policy in one place. The values are deliberately kept
 * identical to the original executor constants: this extraction changes
 * ownership, not search depth, deadlines, concurrency, or request ceilings.
 */
export function buildWaveExecutionPolicy(
  delegatedToEfts: boolean,
  requiredBooleanBranches: number
): WaveExecutionPolicy {
  const maxDocAttempts = 120;

  return {
    // Four keeps burst pressure on /api/sec-proxy low enough to leave headroom
    // for filing previews while still validating quickly.
    batchSize: 4,
    progressInterval: 15,
    maxWaveTimeMs: 45_000,
    // A delegated phrase opens no documents, so EFTS paging may use the wider
    // ceiling without competing for the document proxy budget.
    maxPageRequests: delegatedToEfts ? 240 : 60,
    maxDocAttempts,
    // Retry-inclusive hard ceiling: primary, retry, and parent-document reads.
    maxDocHttpAttempts: 180,
    maxPrescreenRequests: 24,
    docReservePerBranch: Math.min(
      24,
      Math.floor(maxDocAttempts / Math.max(requiredBooleanBranches, 1))
    ),
    pageReservePerBranch: 2,
    timeReservePerBranchMs: 6_000,
    prescreenChunk: 40,
    prescreenMaxPerWave: 120,
    prescreenMinWaveReserve: 15_000,
  };
}

/**
 * Small structural contract for a row moving through the wave executor. The
 * public filing result owns many more display fields; the executor only needs
 * these identifiers and filing-level signals.
 */
export interface WaveResearchResult {
  id: string;
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  filingPrimaryDocument: string;
  formType: string;
  auditor: string;
  registeredAuditor?: string;
}

/** Document evidence retained across validation chunks. */
export interface WaveFilingSignal {
  text: string;
  failure?: string;
}

/** Mutable, measured work for one wave run. */
export interface WaveRunState {
  pageRequests: number;
  docAttempts: number;
  /** Document HTTP attempts, retries and parent-doc fallbacks included. */
  docHttpAttempts: number;
  /** Server pre-screen chunk requests issued. */
  prescreenRequests: number;
  /** Candidates served by the shared server cache, costing no SEC request. */
  prescreenCacheHits: number;
  validationExamined: number;
  unvalidatedFetchFailures: number;
  completedQueryVariants: number;
  lastProgressCount: number;
  budgetExhausted: boolean;
  validationTimedOut: boolean;
  branchDocBudgetTruncated: boolean;
  branchPageBudgetTruncated: boolean;
}

/** Cohesive state and immutable inputs shared by collection and validation. */
export interface WaveStageContext<
  TResult extends WaveResearchResult,
  TSignal extends WaveFilingSignal,
> {
  state: {
    run: WaveRunState;
    hitMap: Map<string, { hit: EdgarSearchHit; queryPriority: number; score: number }>;
    signalMap: Map<string, TSignal>;
    filteredResults: TResult[];
    fetchFailureKinds: Map<string, number>;
  };
  search: {
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
    displayLimit: number;
    wavePerQueryLimit: number;
    totalServerQueries: number;
  };
  policy: WaveExecutionPolicy;
  lifecycle: {
    waveStartTime: number;
    signal?: AbortSignal;
    onDegraded?: (message: string) => void;
    progressCallback?: (results: TResult[]) => void;
    captureUpstreamCoverage: (coverage: SearchCandidateCoverage) => void;
  };
}

export interface WaveLane {
  candidateQuery: string;
  queryIndex: number;
  laterRequiredBranches: number;
  ledger: BranchCoverageEntry;
  /** Resumable runs only: upstream offset this lane resumes paging from.
   *  The browser's single-run path omits it and pages from the start. */
  startOffset?: number;
  /** Resumable runs only: receives where paging stopped so the next wave
   *  continues from there instead of re-collecting the same window. */
  onWindow?: (window: CandidateWindow) => void;
}

/** Where one lane's upstream paging stopped (resumable runs). */
export interface CandidateWindow {
  /** Upstream offset of the first result NOT yet collected. */
  nextOffset: number;
  /** True when upstream has no further results for this query. */
  exhausted: boolean;
  /** True when upstream refuses to page further although results remain
   *  (EDGAR full-text search serves at most 10,000 hits per query). */
  windowCapped: boolean;
  upstreamTotal: number;
  upstreamTotalIsFloor: boolean;
}

export interface WaveValidationLane {
  ledger: BranchCoverageEntry;
  branchDocCap: number;
  branchTimeCapMs: number;
  isRequiredBooleanBranch: boolean;
  branchResultStart: number;
  /** Resumable runs only: told which candidates reached a verdict (server
   *  pre-screen rejects and every processed chunk), so a later wave can
   *  resume exactly the ones this wave did not reach. */
  onExamined?: (results: readonly WaveResearchResult[]) => void;
}

export interface WaveCandidateSearchInput {
  candidateQuery: string;
  formTypes: string;
  dateFrom?: string;
  dateTo?: string;
  entityName?: string;
  resultLimit: number;
  filters: SearchFilters;
  useEnrichedSearch: boolean;
  includeExhibits: boolean;
  entityCik?: string;
  signal?: AbortSignal;
  onDegraded?: (message: string) => void;
  onCoverage: (coverage: SearchCandidateCoverage) => void;
  upstreamRequestBudget: number;
  onUpstreamPage: (requestCount?: number) => boolean;
  /** Resumable runs only (see WaveLane.startOffset / onWindow). */
  startOffset?: number;
  onWindow?: (window: CandidateWindow) => void;
}

/**
 * All repository/network access and filing-domain behavior used by the two
 * execution stages. Keeping these injected prevents the executor from
 * importing the public filingResearch facade and makes stage tests possible
 * without changing that facade's API.
 */
export interface WaveExecutionClients<
  TResult extends WaveResearchResult,
  TSignal extends WaveFilingSignal,
> {
  searchCandidates: (input: WaveCandidateSearchInput) => Promise<EdgarSearchHit[]>;
  mapSearchHit: (hit: EdgarSearchHit) => TResult;
  uniqueById: (results: TResult[]) => TResult[];
  hydrateCompanyMetadataBatch: (results: TResult[]) => Promise<TResult[]>;
  matchesBaseFilters: (
    result: TResult,
    filters: SearchFilters,
    formScope: string[],
    excludeExhibits: boolean
  ) => boolean;
  delay: (milliseconds: number) => Promise<void>;
  prescreenBooleanCandidates: (
    query: string,
    candidates: BooleanPrescreenCandidate[],
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      maxUpstreamAttempts?: number;
      onWork?: (work: BooleanPrescreenWork) => void;
    }
  ) => Promise<BooleanPrescreenVerdict[] | null>;
  hydrateRegisteredAuditors: (results: TResult[]) => Promise<void>;
  getSignalCacheKey: (result: TResult) => string;
  hydrateResultSignals: (
    result: TResult,
    signal?: AbortSignal,
    onUpstreamAttempts?: (attempts: number) => void
  ) => Promise<TSignal>;
  resolveScopedText: (filingText: string, sectionScope: string, formType: string) => string;
  matchesBooleanQuery: (query: string, text: string) => boolean;
  matchesSignalFilters: (
    result: TResult,
    filters: SearchFilters,
    filingText: string,
    scopedText: string
  ) => boolean;
  annotateResultMatchContext: (
    result: TResult,
    query: string,
    filters: SearchFilters,
    mode: ResearchSearchMode,
    scopedText: string,
    delegatedToEfts: boolean
  ) => TResult;
  sortResearchResults: (results: TResult[], preferRelevance: boolean) => TResult[];
}

/** fetchFilingTextOutcome retries at most once. Exhibit candidates may also
 * fetch their parent filing, so reserve the maximum before launching a
 * concurrent chunk. Pessimistic reservation is what makes the HTTP-attempt
 * limit a hard ceiling even though each outcome reports its actual count only
 * after it settles. */
export function maxSignalHttpAttempts(result: WaveResearchResult): number {
  return result.filingPrimaryDocument && result.filingPrimaryDocument !== result.primaryDocument
    ? 4
    : 2;
}

/**
 * Candidate collection for one retrieval lane. Pages EDGAR within the lane's
 * fair-share reserve, records branch attribution before global dedup, then
 * hydrates and applies deterministic metadata filters.
 */
export async function collectLaneCandidates<
  TResult extends WaveResearchResult,
  TSignal extends WaveFilingSignal,
>(
  context: WaveStageContext<TResult, TSignal>,
  lane: WaveLane,
  clients: WaveExecutionClients<TResult, TSignal>
): Promise<
  | { status: 'error'; error: Error }
  | { status: 'empty' }
  | { status: 'ok'; waveCandidates: TResult[] }
> {
  const {
    state: { run, hitMap },
    search: {
      filters,
      mode,
      formTypes,
      formScope,
      excludeExhibits,
      needsCompanyMetadata,
      useEnrichedSearch,
      includeExhibits,
      entityCik,
      wavePerQueryLimit,
      totalServerQueries,
    },
    policy: { maxPageRequests, pageReservePerBranch },
    lifecycle: { signal, onDegraded, captureUpstreamCoverage },
  } = context;
  const { candidateQuery, queryIndex, laterRequiredBranches, ledger, startOffset, onWindow } = lane;

  let queryBatchHits: EdgarSearchHit[];
  try {
    // The page budget counts actual upstream attempts, not search calls. A
    // required lane retains its own reserve while leaving later required
    // branches their fair share.
    let remainingPages = Math.max(
      0,
      maxPageRequests - run.pageRequests - laterRequiredBranches * pageReservePerBranch
    );
    if (ledger.required) {
      remainingPages = Math.max(
        remainingPages,
        Math.min(pageReservePerBranch, maxPageRequests - run.pageRequests)
      );
    }
    const lanePageCeiling = run.pageRequests + remainingPages;
    if (remainingPages <= 0) {
      ledger.incompleteReason = 'page-budget';
      if (lanePageCeiling >= maxPageRequests) run.budgetExhausted = true;
      else run.branchPageBudgetTruncated = true;
      return { status: 'empty' };
    }

    queryBatchHits = await clients.searchCandidates({
      candidateQuery,
      formTypes,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      entityName: filters.entityName || undefined,
      resultLimit: Math.min(wavePerQueryLimit, remainingPages * 10),
      filters,
      useEnrichedSearch,
      includeExhibits,
      entityCik: entityCik || undefined,
      signal,
      onDegraded,
      upstreamRequestBudget: remainingPages,
      ...(startOffset !== undefined ? { startOffset } : {}),
      ...(onWindow ? { onWindow } : {}),
      onCoverage: coverage => {
        ledger.collectionComplete = coverage.complete;
        captureUpstreamCoverage(coverage);
      },
      onUpstreamPage: (requestCount = 1) => {
        if (!Number.isSafeInteger(requestCount) || requestCount < 1) {
          ledger.incompleteReason = 'page-budget';
          run.budgetExhausted = true;
          return false;
        }
        if (run.pageRequests + requestCount > lanePageCeiling) {
          ledger.incompleteReason = 'page-budget';
          if (lanePageCeiling >= maxPageRequests) run.budgetExhausted = true;
          else run.branchPageBudgetTruncated = true;
          return false;
        }
        run.pageRequests += requestCount;
        ledger.pages += requestCount;
        return true;
      },
    });
  } catch (error) {
    ledger.incompleteReason = 'error';
    return { status: 'error', error: error instanceof Error ? error : new Error('EDGAR search failed') };
  }

  // Attribute every surfaced hit to this lane before removing candidates
  // already collected by an earlier branch.
  ledger.candidatesSurfaced = queryBatchHits.length;
  const newHits: EdgarSearchHit[] = [];
  for (const hit of queryBatchHits) {
    if (!hitMap.has(hit._id)) {
      hitMap.set(hit._id, { hit, queryPriority: totalServerQueries - queryIndex, score: hit._score });
      newHits.push(hit);
    }
  }
  ledger.candidatesNew = newHits.length;

  if (newHits.length === 0) {
    run.completedQueryVariants += 1;
    ledger.exhausted = !ledger.incompleteReason && ledger.collectionComplete !== false;
    if (mode === 'boolean') await clients.delay(120);
    return { status: 'empty' };
  }

  let waveCandidates = clients.uniqueById(newHits.map(clients.mapSearchHit));
  if (needsCompanyMetadata) {
    waveCandidates = await clients.hydrateCompanyMetadataBatch(waveCandidates);
  }
  waveCandidates = waveCandidates.filter(result =>
    clients.matchesBaseFilters(result, filters, formScope, excludeExhibits)
  );
  const metadataRejects = Math.max(0, newHits.length - waveCandidates.length);
  run.validationExamined += metadataRejects;
  ledger.examined += metadataRejects;

  return { status: 'ok', waveCandidates };
}

/**
 * Validate one lane's candidates using server pre-screening, bounded document
 * hydration, section scoping, Boolean/signal filters, and progress publishing.
 */
export async function validateLaneCandidates<
  TResult extends WaveResearchResult,
  TSignal extends WaveFilingSignal,
>(
  context: WaveStageContext<TResult, TSignal>,
  lane: WaveValidationLane,
  waveCandidatesInput: TResult[],
  clients: WaveExecutionClients<TResult, TSignal>
): Promise<void> {
  const {
    state: { run, signalMap, filteredResults, fetchFailureKinds },
    search: {
      query,
      filters,
      mode,
      needsTextFiltering,
      booleanExpression,
      delegatedToEfts,
      hydratePerDocumentSignals,
      preferRelevance,
      displayLimit,
    },
    policy: {
      batchSize,
      progressInterval,
      maxWaveTimeMs,
      maxDocAttempts,
      maxDocHttpAttempts,
      maxPrescreenRequests,
      prescreenChunk,
      prescreenMaxPerWave,
      prescreenMinWaveReserve,
    },
    lifecycle: { waveStartTime, signal, progressCallback },
  } = context;
  const { ledger, branchDocCap, branchTimeCapMs, isRequiredBooleanBranch, branchResultStart, onExamined } = lane;
  let waveCandidates = waveCandidatesInput;

  // A full-document server verdict is transferable only when the caller did
  // not scope matching to one filing section. Unknown verdicts fall through.
  if (
    mode === 'boolean' &&
    needsTextFiltering &&
    booleanExpression &&
    !delegatedToEfts &&
    waveCandidates.length > 0 &&
    !(filters.sectionScope || '').trim()
  ) {
    const prescreenKey = (cik: string, accession: string, document: string) =>
      `${cik}:${accession.replace(/-/g, '')}:${document}`;
    const rejectedByServer = new Set<string>();

    for (
      let cursor = 0;
      cursor < Math.min(waveCandidates.length, prescreenMaxPerWave) && !signal?.aborted;
      cursor += prescreenChunk
    ) {
      const remainingWaveMs = maxWaveTimeMs - (Date.now() - waveStartTime);
      if (remainingWaveMs < prescreenMinWaveReserve) break;

      const remainingPrescreenAttempts = maxPrescreenRequests - run.prescreenRequests;
      if (remainingPrescreenAttempts <= 1) break;
      run.prescreenRequests += 1;
      const verdicts = await clients.prescreenBooleanCandidates(
        query,
        waveCandidates.slice(cursor, cursor + prescreenChunk).map(result => ({
          cik: result.cik,
          accession: result.accessionNumber.replace(/-/g, ''),
          document: result.primaryDocument,
        })),
        {
          signal,
          timeoutMs: Math.min(25_000, remainingWaveMs - prescreenMinWaveReserve + 5_000),
          maxUpstreamAttempts: remainingPrescreenAttempts - 1,
          onWork: work => {
            run.prescreenRequests = Math.min(
              maxPrescreenRequests,
              run.prescreenRequests + work.upstreamAttempts
            );
            run.prescreenCacheHits += work.cacheHits;
          },
        }
      );
      if (!verdicts) break;

      for (const verdict of verdicts) {
        if (verdict.validated && !verdict.matched) {
          rejectedByServer.add(prescreenKey(verdict.cik, verdict.accession, verdict.document));
        }
      }
    }

    if (rejectedByServer.size > 0) {
      const beforePrescreen = waveCandidates.length;
      waveCandidates = waveCandidates.filter(result =>
        !rejectedByServer.has(prescreenKey(result.cik, result.accessionNumber, result.primaryDocument))
      );
      const serverRejects = beforePrescreen - waveCandidates.length;
      run.validationExamined += serverRejects;
      ledger.examined += serverRejects;
      if (onExamined) {
        onExamined(waveCandidatesInput.filter(result =>
          rejectedByServer.has(prescreenKey(result.cik, result.accessionNumber, result.primaryDocument))
        ));
      }
    }
  }

  for (
    let index = 0;
    index < waveCandidates.length &&
    (filteredResults.length < displayLimit || isRequiredBooleanBranch) &&
    Date.now() - waveStartTime < branchTimeCapMs;
    index += batchSize
  ) {
    if (signal?.aborted) break;
    const chunk = waveCandidates.slice(index, Math.min(index + batchSize, waveCandidates.length));

    if (filters.accountant.trim()) await clients.hydrateRegisteredAuditors(chunk);

    const needsSignal = (result: TResult) =>
      hydratePerDocumentSignals ||
      Boolean(filters.accountant.trim() && !result.registeredAuditor?.trim());
    const remainingLogicalDocs = Math.max(0, branchDocCap - run.docAttempts);
    const remainingHttpAttempts = Math.max(0, maxDocHttpAttempts - run.docHttpAttempts);
    let reservedLogicalDocs = 0;
    let reservedHttpAttempts = 0;
    let blockedByLogicalBudget = false;
    let blockedByHttpBudget = false;
    const permittedSignals = new Set<string>();

    for (const result of chunk) {
      if (!needsSignal(result)) continue;
      const reservation = maxSignalHttpAttempts(result);
      if (reservedLogicalDocs >= remainingLogicalDocs) {
        blockedByLogicalBudget = true;
        continue;
      }
      if (reservedHttpAttempts + reservation > remainingHttpAttempts) {
        blockedByHttpBudget = true;
        continue;
      }
      reservedLogicalDocs += 1;
      reservedHttpAttempts += reservation;
      permittedSignals.add(clients.getSignalCacheKey(result));
    }

    const processableChunk = chunk.filter(result =>
      !needsSignal(result) || permittedSignals.has(clients.getSignalCacheKey(result))
    );
    const signalsToHydrate = processableChunk.filter(needsSignal);

    if (blockedByLogicalBudget || blockedByHttpBudget) {
      ledger.incompleteReason = 'doc-budget';
      if (blockedByHttpBudget || branchDocCap >= maxDocAttempts) run.budgetExhausted = true;
      else run.branchDocBudgetTruncated = true;
    }

    if (signalsToHydrate.length > 0) {
      await Promise.all(
        signalsToHydrate.map(async result => {
          const signalData = await clients.hydrateResultSignals(result, signal, attempts => {
            run.docHttpAttempts += attempts;
          });
          signalMap.set(clients.getSignalCacheKey(result), signalData);
        })
      );
      run.docAttempts += signalsToHydrate.length;
    }
    run.validationExamined += processableChunk.length;
    ledger.examined += processableChunk.length;
    onExamined?.(processableChunk);

    for (const result of processableChunk) {
      const filingText = signalMap.get(clients.getSignalCacheKey(result))?.text || '';
      const sectionScope = (filters.sectionScope || '').trim();
      const scopedText = sectionScope && filingText
        ? clients.resolveScopedText(filingText, sectionScope, result.formType)
        : filingText;

      if (needsTextFiltering && mode === 'boolean' && booleanExpression && !delegatedToEfts) {
        if (!filingText) {
          run.unvalidatedFetchFailures += 1;
          const kind = signalMap.get(clients.getSignalCacheKey(result))?.failure;
          if (kind) fetchFailureKinds.set(kind, (fetchFailureKinds.get(kind) ?? 0) + 1);
          continue;
        }
        if (!scopedText || !clients.matchesBooleanQuery(query, scopedText)) continue;
      }

      if (needsTextFiltering && !clients.matchesSignalFilters(result, filters, filingText, scopedText)) {
        continue;
      }

      filteredResults.push(
        clients.annotateResultMatchContext(result, query, filters, mode, scopedText, delegatedToEfts)
      );
    }

    if (progressCallback && filteredResults.length >= run.lastProgressCount + progressInterval) {
      run.lastProgressCount = filteredResults.length;
      progressCallback(
        clients.sortResearchResults([...filteredResults], preferRelevance).slice(0, displayLimit)
      );
    }

    if (
      signalsToHydrate.length > 0 &&
      index + batchSize < waveCandidates.length &&
      filteredResults.length < displayLimit
    ) {
      await clients.delay(150);
    }

    if (blockedByLogicalBudget || blockedByHttpBudget) break;
  }

  ledger.matched = filteredResults.length - branchResultStart;
  if (!ledger.incompleteReason) {
    if (signal?.aborted) {
      ledger.incompleteReason = 'cancelled';
    } else if (ledger.examined < ledger.candidatesNew) {
      ledger.incompleteReason = Date.now() - waveStartTime >= branchTimeCapMs
        ? 'deadline'
        : 'display-limit';
    }
  }
  ledger.exhausted =
    !ledger.incompleteReason &&
    ledger.examined >= ledger.candidatesNew &&
    ledger.collectionComplete !== false;
}

// ── Resumable entry point (search continuation jobs) ─────────────────────────
//
// A browser run validates one bounded wave and stops. A continuation job runs
// the SAME two stages again, wave after wave, on the server: each wave is
// bounded by the unchanged policy above, and everything needed to resume — per
// lane upstream offset, candidates collected but not yet examined, the set of
// candidate ids already seen, cumulative per-branch ledgers and measured work
// — travels in a JSON cursor. Nothing here changes how a single browser run
// behaves; the stages only gained optional hooks that the browser never sets.

export const RESUMABLE_CURSOR_VERSION = 1;

/** One retrieval lane's resumable state. */
export interface ResumableLaneState<TResult> {
  query: string;
  required: boolean;
  /** Upstream offset of the next page to collect. */
  nextOffset: number;
  /** Upstream reported no further results for this query. */
  collectionComplete: boolean;
  /** Upstream stopped paging although results remain (10,000-hit window). */
  windowCapped: boolean;
  upstreamTotal: number;
  upstreamTotalIsFloor: boolean;
  /** Candidates collected and metadata-filtered but not yet examined. */
  pending: TResult[];
  /** Collection attempts that failed in a row; a lane stalls after a few. */
  consecutiveErrors: number;
  /** Cumulative ledger across every wave. */
  ledger: BranchCoverageEntry;
}

export interface ResumableWaveTotals {
  waves: number;
  /** Candidates that reached a verdict (metadata, pre-screen or text). */
  examined: number;
  /** Matching documents found (before per-filing roll-up). */
  matchedDocuments: number;
  /** Candidates excluded because their text could not be read, retries spent. */
  unvalidatedFailures: number;
  failureKinds: Record<string, number>;
  pageRequests: number;
  docFetches: number;
  docHttpAttempts: number;
  prescreenRequests: number;
  /** Wall time spent inside waves, summed. */
  elapsedMs: number;
}

export interface ResumableWaveCursor<TResult> {
  version: typeof RESUMABLE_CURSOR_VERSION;
  lanes: ResumableLaneState<TResult>[];
  /** Every candidate id already collected by any lane in any wave. */
  seen: string[];
  /** Transient-failure retries spent, by candidate id. */
  retries: Record<string, number>;
  totals: ResumableWaveTotals;
}

/** Lanes stall after this many consecutive collection failures. */
export const RESUMABLE_MAX_CONSECUTIVE_LANE_ERRORS = 3;
/** A candidate whose text fetch failed transiently is retried this often. */
export const RESUMABLE_MAX_CANDIDATE_RETRIES = 1;
const TRANSIENT_FAILURE_KINDS = new Set(['rate-limit', 'timeout', 'upstream']);

export function createResumableCursor<TResult>(
  queries: readonly string[],
  requiredBranches: number
): ResumableWaveCursor<TResult> {
  return {
    version: RESUMABLE_CURSOR_VERSION,
    lanes: queries.map((query, index) => ({
      query,
      required: index < requiredBranches,
      nextOffset: 0,
      collectionComplete: false,
      windowCapped: false,
      upstreamTotal: 0,
      upstreamTotalIsFloor: false,
      pending: [],
      consecutiveErrors: 0,
      ledger: {
        branch: query,
        required: index < requiredBranches,
        pages: 0,
        candidatesSurfaced: 0,
        candidatesNew: 0,
        examined: 0,
        matched: 0,
        exhausted: false,
      },
    })),
    seen: [],
    retries: {},
    totals: {
      waves: 0,
      examined: 0,
      matchedDocuments: 0,
      unvalidatedFailures: 0,
      failureKinds: {},
      pageRequests: 0,
      docFetches: 0,
      docHttpAttempts: 0,
      prescreenRequests: 0,
      elapsedMs: 0,
    },
  };
}

/** A lane is finished when upstream is exhausted and nothing is pending. */
export function isLaneFinished(lane: ResumableLaneState<unknown>): boolean {
  return lane.collectionComplete && lane.pending.length === 0;
}

/** A lane can make no further progress although it is not finished. */
export function isLaneStalled(lane: ResumableLaneState<unknown>): boolean {
  if (isLaneFinished(lane)) return false;
  if (lane.pending.length > 0) return false;
  return lane.windowCapped || lane.consecutiveErrors >= RESUMABLE_MAX_CONSECUTIVE_LANE_ERRORS;
}

function laneHasWork(lane: ResumableLaneState<unknown>): boolean {
  return !isLaneFinished(lane) && !isLaneStalled(lane);
}

function emptyLedger(lane: ResumableLaneState<unknown>): BranchCoverageEntry {
  return {
    branch: lane.query,
    required: lane.required,
    pages: 0,
    candidatesSurfaced: 0,
    candidatesNew: 0,
    examined: 0,
    matched: 0,
    exhausted: false,
  };
}

export interface ResumableWaveInput<
  TResult extends WaveResearchResult,
  TSignal extends WaveFilingSignal,
> {
  cursor: ResumableWaveCursor<TResult>;
  /** The compiled plan's search block; display and per-query limits are
   *  owned by the resumable runner. */
  search: Omit<WaveStageContext<TResult, TSignal>['search'], 'displayLimit' | 'wavePerQueryLimit' | 'totalServerQueries'>;
  policy: WaveExecutionPolicy;
  clients: WaveExecutionClients<TResult, TSignal>;
  /** Job-level ceiling on candidates examined across every wave. */
  maxExamined: number;
  /** Ceiling on candidates one lane collects per window. */
  perQueryResultLimit: number;
  signal?: AbortSignal;
  onDegraded?: (message: string) => void;
}

export interface ResumableWaveOutcome<TResult> {
  cursor: ResumableWaveCursor<TResult>;
  /** Documents verified in THIS wave, annotated by the executor. */
  matches: TResult[];
  /** Measured work of this wave alone. */
  work: { pageRequests: number; docFetches: number; docHttpAttempts: number; elapsedMs: number };
}

function cloneCursor<TResult>(cursor: ResumableWaveCursor<TResult>): ResumableWaveCursor<TResult> {
  return JSON.parse(JSON.stringify(cursor)) as ResumableWaveCursor<TResult>;
}

/**
 * Advance a resumable search by exactly one bounded wave: the unchanged
 * policy, the unchanged collect/validate stages, the same fair-share
 * reservations for later required branches. The input cursor is cloned, never
 * mutated; all I/O goes through `clients`.
 */
export async function runResumableWave<
  TResult extends WaveResearchResult,
  TSignal extends WaveFilingSignal,
>(input: ResumableWaveInput<TResult, TSignal>): Promise<ResumableWaveOutcome<TResult>> {
  const { policy, signal, maxExamined } = input;
  const cursor = cloneCursor(input.cursor);
  const waveStartTime = Date.now();
  const run: WaveRunState = {
    pageRequests: 0,
    docAttempts: 0,
    docHttpAttempts: 0,
    prescreenRequests: 0,
    prescreenCacheHits: 0,
    validationExamined: 0,
    unvalidatedFetchFailures: 0,
    completedQueryVariants: 0,
    lastProgressCount: 0,
    budgetExhausted: false,
    validationTimedOut: false,
    branchDocBudgetTruncated: false,
    branchPageBudgetTruncated: false,
  };
  // Seed the dedup map with every id earlier waves collected. Only `.has` is
  // consulted for them, so a minimal placeholder hit is sufficient.
  const hitMap: WaveStageContext<TResult, TSignal>['state']['hitMap'] = new Map(
    cursor.seen.map(id => [id, { hit: { _id: id, _score: 0, _source: {} }, queryPriority: 0, score: 0 }])
  );
  const signalMap = new Map<string, TSignal>();
  const filteredResults: TResult[] = [];
  const fetchFailureKinds = new Map<string, number>();
  const failureBySignalKey = new Map<string, string>();
  // The stage counts a pre-screen request before calling the client. A client
  // that declines (returns null without doing any work) made no request, so
  // it must not appear in the job's measured work.
  let declinedPrescreens = 0;

  const clients: WaveExecutionClients<TResult, TSignal> = {
    ...input.clients,
    prescreenBooleanCandidates: async (query, candidates, options) => {
      let worked = false;
      const verdicts = await input.clients.prescreenBooleanCandidates(query, candidates, {
        ...options,
        onWork: work => {
          worked = true;
          options.onWork?.(work);
        },
      });
      if (!verdicts && !worked) declinedPrescreens += 1;
      return verdicts;
    },
    hydrateResultSignals: async (result, abortSignal, onUpstreamAttempts) => {
      const loaded = await input.clients.hydrateResultSignals(result, abortSignal, onUpstreamAttempts);
      const key = input.clients.getSignalCacheKey(result);
      // Only the latest read counts: a retry that succeeds clears the failure.
      if (!loaded.text && loaded.failure) failureBySignalKey.set(key, loaded.failure);
      else failureBySignalKey.delete(key);
      return loaded;
    },
  };

  const context: WaveStageContext<TResult, TSignal> = {
    state: { run, hitMap, signalMap, filteredResults, fetchFailureKinds },
    search: {
      ...input.search,
      // The job pages results server-side, so no display cap may end a lane.
      displayLimit: Number.MAX_SAFE_INTEGER,
      wavePerQueryLimit: input.perQueryResultLimit,
      totalServerQueries: cursor.lanes.length,
    },
    policy,
    lifecycle: {
      waveStartTime,
      signal,
      onDegraded: input.onDegraded,
      // Lane-level coverage arrives through onWindow; the job aggregates it.
      captureUpstreamCoverage: () => undefined,
    },
  };

  const elapsed = () => Date.now() - waveStartTime;
  const globalBudgetSpent = () =>
    run.pageRequests >= policy.maxPageRequests ||
    run.docAttempts >= policy.maxDocAttempts ||
    run.docHttpAttempts >= policy.maxDocHttpAttempts;

  for (const [laneIndex, lane] of cursor.lanes.entries()) {
    if (!laneHasWork(lane)) continue;
    if (signal?.aborted) break;
    if (cursor.totals.examined >= maxExamined) break;
    if (elapsed() >= policy.maxWaveTimeMs) break;
    if (globalBudgetSpent()) break;

    // Fair share: reserve documents, pages and time for every LATER required
    // lane that still has work — exactly the browser executor's reservation.
    const laterRequiredBranches = cursor.lanes
      .slice(laneIndex + 1)
      .filter(other => other.required && laneHasWork(other)).length;
    const branchDocCap = policy.maxDocAttempts - laterRequiredBranches * policy.docReservePerBranch;
    const branchTimeCapMs = policy.maxWaveTimeMs - laterRequiredBranches * policy.timeReservePerBranchMs;

    while (laneHasWork(lane)) {
      if (signal?.aborted) break;
      if (elapsed() >= branchTimeCapMs) break;
      if (run.docAttempts >= branchDocCap || run.docHttpAttempts >= policy.maxDocHttpAttempts) break;
      const examinable = maxExamined - cursor.totals.examined;
      if (examinable <= 0) break;

      let candidates: TResult[];
      let carried: TResult[] = [];
      if (lane.pending.length > 0) {
        candidates = lane.pending.slice(0, examinable);
        carried = lane.pending.slice(candidates.length);
      } else {
        if (run.pageRequests >= policy.maxPageRequests) break;
        // Collect only about what this lane can still validate in this wave,
        // so the carried-over pending list (and the cursor) stays small.
        const remainingDocs = Math.max(1, Math.min(branchDocCap - run.docAttempts, examinable));
        context.search.wavePerQueryLimit = Math.min(
          input.perQueryResultLimit,
          Math.max(10, Math.ceil(remainingDocs / 10) * 10)
        );
        const collectLedger = emptyLedger(lane);
        let window: CandidateWindow | null = null;
        const offsetBefore = lane.nextOffset;
        const collected = await collectLaneCandidates(
          context,
          {
            candidateQuery: lane.query,
            queryIndex: laneIndex,
            laterRequiredBranches,
            ledger: collectLedger,
            startOffset: lane.nextOffset,
            onWindow: reported => { window = reported; },
          },
          clients
        );
        lane.ledger.pages += collectLedger.pages;
        lane.ledger.candidatesSurfaced += collectLedger.candidatesSurfaced;
        lane.ledger.candidatesNew += collectLedger.candidatesNew;
        lane.ledger.examined += collectLedger.examined;
        cursor.totals.examined += collectLedger.examined;
        const reportedWindow = window as CandidateWindow | null;
        if (reportedWindow) {
          lane.nextOffset = Math.max(lane.nextOffset, reportedWindow.nextOffset);
          lane.collectionComplete = reportedWindow.exhausted;
          lane.windowCapped = !reportedWindow.exhausted && reportedWindow.windowCapped;
          lane.upstreamTotal = Math.max(lane.upstreamTotal, reportedWindow.upstreamTotal);
          lane.upstreamTotalIsFloor = reportedWindow.upstreamTotalIsFloor;
        }
        if (collected.status === 'error') {
          lane.consecutiveErrors += 1;
          lane.ledger.incompleteReason = 'error';
          input.onDegraded?.(collected.error.message);
          break;
        }
        lane.consecutiveErrors = 0;
        if (collected.status === 'empty') {
          if (collectLedger.incompleteReason === 'page-budget') {
            lane.ledger.incompleteReason = 'page-budget';
            break;
          }
          // Every hit in the window was a duplicate; keep paging only if the
          // window actually advanced (otherwise nothing new can arrive).
          if (lane.nextOffset <= offsetBefore) break;
          continue;
        }
        candidates = collected.waveCandidates;
        if (candidates.length > examinable) {
          carried = candidates.slice(examinable);
          candidates = candidates.slice(0, examinable);
        }
      }

      const examined = new Set<WaveResearchResult>();
      const branchResultStart = filteredResults.length;
      const validateLedger = emptyLedger(lane);
      await validateLaneCandidates(
        context,
        {
          ledger: validateLedger,
          branchDocCap,
          branchTimeCapMs,
          isRequiredBooleanBranch: input.search.mode === 'boolean' && lane.required,
          branchResultStart,
          onExamined: results => { for (const result of results) examined.add(result); },
        },
        candidates,
        clients
      );

      // A transient text-fetch failure is not a verdict: put it back once.
      // A permanent failure, or a retry already spent, is an honest exclusion.
      const matchedHere = new Set<WaveResearchResult>(filteredResults.slice(branchResultStart));
      const requeue: TResult[] = [];
      let excluded = 0;
      for (const result of candidates) {
        if (!examined.has(result) || matchedHere.has(result)) continue;
        const kind = failureBySignalKey.get(clients.getSignalCacheKey(result));
        if (!kind) continue;
        const spent = cursor.retries[result.id] ?? 0;
        if (TRANSIENT_FAILURE_KINDS.has(kind) && spent < RESUMABLE_MAX_CANDIDATE_RETRIES) {
          cursor.retries[result.id] = spent + 1;
          requeue.push(result);
        } else {
          excluded += 1;
          cursor.totals.failureKinds[kind] = (cursor.totals.failureKinds[kind] ?? 0) + 1;
        }
      }
      const verdicts = examined.size - requeue.length;
      cursor.totals.examined += verdicts;
      cursor.totals.unvalidatedFailures += excluded;
      cursor.totals.matchedDocuments += filteredResults.length - branchResultStart;
      lane.ledger.examined += verdicts;
      lane.ledger.matched += filteredResults.length - branchResultStart;

      const unexamined = candidates.filter(result => !examined.has(result));
      lane.pending = [...unexamined, ...carried, ...requeue];
      if (validateLedger.incompleteReason) lane.ledger.incompleteReason = validateLedger.incompleteReason;

      // The wave's budget or clock ended this lane's turn: move on so later
      // lanes still use their reserved share.
      if (unexamined.length > 0) break;
    }
  }

  for (const lane of cursor.lanes) {
    if (isLaneFinished(lane)) delete lane.ledger.incompleteReason;
    lane.ledger.collectionComplete = lane.collectionComplete;
    lane.ledger.exhausted = isLaneFinished(lane);
  }
  cursor.seen = Array.from(hitMap.keys());
  const waveElapsed = elapsed();
  cursor.totals.waves += 1;
  cursor.totals.pageRequests += run.pageRequests;
  cursor.totals.docFetches += run.docAttempts;
  cursor.totals.docHttpAttempts += run.docHttpAttempts;
  cursor.totals.prescreenRequests += Math.max(0, run.prescreenRequests - declinedPrescreens);
  cursor.totals.elapsedMs += waveElapsed;

  return {
    cursor,
    matches: filteredResults,
    work: {
      pageRequests: run.pageRequests,
      docFetches: run.docAttempts,
      docHttpAttempts: run.docHttpAttempts,
      elapsedMs: waveElapsed,
    },
  };
}
