import { describe, it, expect } from 'vitest';
import { finalizeRunCoverage, type RunCoverageInputs } from '../services/filingResearch';
import type { BranchCoverageEntry } from '../services/secApi';

/**
 * WP7: the coverage finalizer is now a pure stage, so the honesty rules it
 * encodes get direct fixtures instead of only surfacing through full
 * executor runs.
 */

function branch(overrides: Partial<BranchCoverageEntry> = {}): BranchCoverageEntry {
  return {
    branch: 'alpha',
    required: true,
    pages: 1,
    candidatesSurfaced: 5,
    candidatesNew: 5,
    examined: 5,
    matched: 3,
    exhausted: true,
    ...overrides,
  };
}

function inputs(overrides: Partial<RunCoverageInputs> = {}): RunCoverageInputs {
  return {
    upstreamCoverage: { examined: 5, upstreamTotal: 5, complete: true },
    collectedCandidates: 5,
    validationExamined: 5,
    validationTimedOut: false,
    budgetExhausted: false,
    aborted: false,
    unvalidatedFetchFailures: 0,
    fetchFailureKinds: new Map(),
    completedQueryVariants: 2,
    totalQueryVariants: 2,
    branchLedgers: [branch()],
    maxPageRequests: 60,
    maxDocAttempts: 120,
    ...overrides,
  };
}

describe('finalizeRunCoverage', () => {
  it('a fully validated run is complete and exhausted with no degraded message', () => {
    const result = finalizeRunCoverage(inputs());
    expect(result.coverage.complete).toBe(true);
    expect(result.stopReason).toBe('exhausted');
    expect(result.degradedMessage).toBeNull();
  });

  it('unknown upstream coverage is partial, never assumed complete (F-07)', () => {
    const result = finalizeRunCoverage(inputs({ upstreamCoverage: null }));
    expect(result.coverage.complete).toBe(false);
    expect(result.stopReason).toBe('unknown-upstream');
  });

  it('an unexhausted required branch forfeits completeness even when aggregates look full', () => {
    const result = finalizeRunCoverage(inputs({
      branchLedgers: [branch(), branch({ branch: 'beta', exhausted: false, incompleteReason: 'doc-budget' })],
    }));
    expect(result.coverage.complete).toBe(false);
    expect(result.stopReason).toBe('candidate-cap');
  });

  it('a non-required fill lane left unexhausted does not forfeit completeness alone', () => {
    const result = finalizeRunCoverage(inputs({
      branchLedgers: [branch(), branch({ branch: 'fill', required: false, exhausted: false })],
    }));
    expect(result.coverage.complete).toBe(true);
  });

  it('stop-reason precedence: cancellation beats every other cause', () => {
    const result = finalizeRunCoverage(inputs({
      aborted: true,
      validationTimedOut: true,
      budgetExhausted: true,
      unvalidatedFetchFailures: 3,
    }));
    expect(result.stopReason).toBe('cancelled');
    expect(result.coverage.complete).toBe(false);
    expect(result.degradedMessage).toBeNull(); // a superseded run says nothing
  });

  it('request-budget carries the actionable message with the real budget numbers', () => {
    const result = finalizeRunCoverage(inputs({ budgetExhausted: true, maxPageRequests: 240, maxDocAttempts: 120 }));
    expect(result.stopReason).toBe('request-budget');
    expect(result.degradedMessage).toContain('240 pages / 120 documents');
    expect(result.degradedMessage).toContain('not the full corpus');
  });

  it('rate-limited fetches name the count and pluralize correctly', () => {
    const single = finalizeRunCoverage(inputs({
      unvalidatedFetchFailures: 1,
      fetchFailureKinds: new Map([['rate-limit', 1]]),
    }));
    expect(single.stopReason).toBe('rate-limit');
    expect(single.degradedMessage).toContain('1 document request');

    const plural = finalizeRunCoverage(inputs({
      unvalidatedFetchFailures: 4,
      fetchFailureKinds: new Map([['rate-limit', 4]]),
    }));
    expect(plural.degradedMessage).toContain('4 document requests');
  });

  it('unreadable documents are named as the cause when present', () => {
    const result = finalizeRunCoverage(inputs({
      unvalidatedFetchFailures: 2,
      fetchFailureKinds: new Map([['unsupported', 2]]),
    }));
    expect(result.stopReason).toBe('fetch-failure');
    expect(result.degradedMessage).toContain('non-HTML primary document');
  });

  it('examined never exceeds the upstream total in the published coverage', () => {
    const result = finalizeRunCoverage(inputs({
      validationExamined: 50,
      collectedCandidates: 10,
      upstreamCoverage: { examined: 10, upstreamTotal: 10, complete: true },
    }));
    expect(result.coverage.examined).toBe(10);
  });

  it('the upstream floor flag passes through untouched', () => {
    const result = finalizeRunCoverage(inputs({
      upstreamCoverage: { examined: 10_000, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true },
    }));
    expect(result.coverage.upstreamTotalIsFloor).toBe(true);
  });
});
