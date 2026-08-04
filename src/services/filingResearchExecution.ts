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
}

export interface WaveValidationLane {
  ledger: BranchCoverageEntry;
  branchDocCap: number;
  branchTimeCapMs: number;
  isRequiredBooleanBranch: boolean;
  branchResultStart: number;
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
  const { candidateQuery, queryIndex, laterRequiredBranches, ledger } = lane;

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
  const { ledger, branchDocCap, branchTimeCapMs, isRequiredBooleanBranch, branchResultStart } = lane;
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
