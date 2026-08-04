import type {
  BranchCoverageEntry,
  SearchCandidateCoverage,
} from './secApi';

/**
 * Why a Boolean run stopped. Only `exhausted` is compatible with complete
 * coverage; every other value describes a bounded partial result window.
 */
export type BooleanStopReason =
  | 'exhausted'
  | 'candidate-cap'
  | 'request-budget'
  | 'deadline'
  | 'rate-limit'
  | 'fetch-failure'
  | 'unknown-upstream'
  | 'cancelled';

/** Inputs the coverage finalizer needs from a finished validation run. */
export interface RunCoverageInputs {
  upstreamCoverage: SearchCandidateCoverage | null;
  /** Deduplicated candidates collected across every lane (hitMap size). */
  collectedCandidates: number;
  validationExamined: number;
  validationTimedOut: boolean;
  budgetExhausted: boolean;
  aborted: boolean;
  unvalidatedFetchFailures: number;
  fetchFailureKinds: ReadonlyMap<string, number>;
  completedQueryVariants: number;
  totalQueryVariants: number;
  branchLedgers: readonly BranchCoverageEntry[];
  maxPageRequests: number;
  maxDocAttempts: number;
  /** Measured upstream work, retries and pre-screens included. */
  work: {
    pageRequests: number;
    docFetches: number;
    docHttpAttempts: number;
    prescreenRequests: number;
    prescreenCacheHits?: number;
    maxDocHttpAttempts: number;
    maxPrescreenRequests: number;
  };
}

/**
 * Build the coverage ledger and stop verdict from measured run state. Pure:
 * identical inputs always produce the same public coverage claim.
 *
 * Unknown upstream coverage is partial, never assumed complete. Fetch failures
 * and cancellation also forfeit completeness, and aggregate counters cannot
 * prove per-branch exhaustion, so every required lane must report exhausted.
 */
export function finalizeRunCoverage(inputs: RunCoverageInputs): {
  coverage: SearchCandidateCoverage;
  stopReason: BooleanStopReason;
  degradedMessage: string | null;
} {
  const {
    upstreamCoverage,
    collectedCandidates,
    validationExamined,
    validationTimedOut,
    budgetExhausted,
    aborted,
    unvalidatedFetchFailures,
    fetchFailureKinds,
    completedQueryVariants,
    totalQueryVariants,
    branchLedgers,
    maxPageRequests,
    maxDocAttempts,
  } = inputs;

  const upstreamTotal = Math.max(
    upstreamCoverage?.upstreamTotal ?? 0,
    upstreamCoverage?.examined ?? 0,
    collectedCandidates
  );
  const collectionComplete = upstreamCoverage?.complete ?? false;
  const validationComplete = (
    !validationTimedOut &&
    !budgetExhausted &&
    !aborted &&
    unvalidatedFetchFailures === 0 &&
    completedQueryVariants === totalQueryVariants &&
    collectionComplete &&
    validationExamined >= collectedCandidates &&
    branchLedgers.filter(entry => entry.required).every(entry => entry.exhausted)
  );

  const stopReason: BooleanStopReason =
    aborted ? 'cancelled'
    : validationTimedOut ? 'deadline'
    : budgetExhausted ? 'request-budget'
    : fetchFailureKinds.has('rate-limit') ? 'rate-limit'
    : unvalidatedFetchFailures > 0 ? 'fetch-failure'
    : !collectionComplete ? 'unknown-upstream'
    : validationComplete ? 'exhausted'
    : 'candidate-cap';

  const { work } = inputs;
  const totalUpstreamRequests = work.pageRequests + work.docHttpAttempts + work.prescreenRequests;

  let degradedMessage: string | null = null;
  if (stopReason === 'deadline') {
    degradedMessage = 'Filing-text validation reached its time limit; only a partial candidate window was verified.';
  } else if (stopReason === 'request-budget') {
    degradedMessage = `This search reached its per-run request budget: ${work.pageRequests}/${maxPageRequests} page requests, ${work.docHttpAttempts}/${work.maxDocHttpAttempts} document requests (retries included; ${work.docFetches}/${maxDocAttempts} documents), ${work.prescreenRequests}/${work.maxPrescreenRequests} pre-screen requests — ${totalUpstreamRequests} upstream requests in all. Results are a verified partial window, not the full corpus. Narrow the query, dates, or forms to validate more.`;
  } else if (stopReason === 'rate-limit') {
    degradedMessage = `SEC EDGAR rate-limited ${fetchFailureKinds.get('rate-limit')} document ${fetchFailureKinds.get('rate-limit') === 1 ? 'request' : 'requests'}; those filings could not be re-validated and are excluded. Retry shortly for a fuller window.`;
  } else if (stopReason === 'fetch-failure') {
    const unreadable = (fetchFailureKinds.get('unsupported') ?? 0) + (fetchFailureKinds.get('not-found') ?? 0);
    degradedMessage =
      `${unvalidatedFetchFailures} matching candidate ${unvalidatedFetchFailures === 1 ? 'filing was' : 'filings were'} excluded because the document text could not be retrieved for Boolean re-validation` +
      (unreadable > 0 ? ' (non-HTML primary document such as a scanned PDF or image).' : ' (upstream fetch failure).');
  }

  return {
    coverage: {
      examined: Math.min(validationExamined, upstreamTotal),
      upstreamTotal,
      complete: validationComplete,
      // Required-lane totals are maxima, not a known OR-union. Multiple lanes
      // therefore make the aggregate a floor even when each lane is complete.
      upstreamTotalIsFloor:
        Boolean(upstreamCoverage?.upstreamTotalIsFloor) ||
        branchLedgers.filter(entry => entry.required).length > 1,
      branches: branchLedgers.length > 0 ? [...branchLedgers] : undefined,
      work: {
        pageRequests: work.pageRequests,
        docFetches: work.docFetches,
        docHttpAttempts: work.docHttpAttempts,
        prescreenRequests: work.prescreenRequests,
        prescreenCacheHits: work.prescreenCacheHits ?? 0,
        totalUpstreamRequests,
        ceiling: {
          pages: maxPageRequests,
          docHttpAttempts: work.maxDocHttpAttempts,
          prescreenRequests: work.maxPrescreenRequests,
        },
      },
    },
    stopReason,
    degradedMessage,
  };
}
