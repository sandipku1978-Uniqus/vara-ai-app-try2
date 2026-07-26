import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Regression: the 110-filing recall ceiling on delegated phrase searches.
 *
 * SearchPage passes hydrateTextSignals=true for EVERY Boolean deep-refinement
 * run. For a delegated phrase (whole query = one quoted phrase, proved by
 * EDGAR's own index) nothing downstream reads the document text — but the wave
 * loop used to hydrate each candidate anyway, spending the 120-document budget
 * on fetches nobody consumed. Validation then died at 120 of ~500 collected
 * candidates and the run reported `request-budget` (measured live: 498
 * collected, 120 examined, 110 shown, for a phrase EFTS reports at ≥10,000).
 *
 * These pin the two halves of the fix: a delegated run must (a) examine every
 * collected candidate rather than stopping at the document budget, and
 * (b) open zero documents while doing so.
 */

const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchText: vi.fn() }));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingText: mocks.fetchText,
  fetchFilingTextOutcome: async (...a: unknown[]) => {
    const t = await mocks.fetchText(...a);
    return t ? { ok: true, text: t } : { ok: false, kind: 'upstream', retryable: true };
  },
  isEnrichedSearchEnabled: () => false,
  fetchCompanySubmissions: async () => null,
  resolveCompanyInput: async () => null,
  prescreenBooleanCandidates: async () => null,
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectoryIndex: async () => ({}),
  loadSicDirectory: async () => [],
}));

import { executeFilingResearchSearch } from '../services/filingResearch';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';

// Well past the 120-document budget, so the old behaviour caps the result set
// and the fixed behaviour does not.
const CANDIDATE_COUNT = 300;

function hit(index: number) {
  const serial = String(index).padStart(4, '0');
  return {
    _id: `0000000000-26-00${serial}:doc.htm`,
    _score: 1,
    _source: {
      display_names: [`Issuer ${serial}`],
      file_date: '2026-01-01',
      file_type: '10-K',
      adsh: `0000000000-26-00${serial}`,
      ciks: [`000000${serial}`],
    },
  };
}

beforeEach(() => {
  mocks.search.mockReset();
  mocks.fetchText.mockReset();
  mocks.search.mockImplementation(async () =>
    Array.from({ length: CANDIDATE_COUNT }, (_, i) => hit(i))
  );
  mocks.fetchText.mockImplementation(async () => 'material weakness discussed here');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

describe('delegated phrase recall vs the document budget', () => {
  it('examines every collected candidate and opens zero documents', async () => {
    const coverage: Array<{ examined: number; upstreamTotal: number; complete: boolean }> = [];
    const degraded: string[] = [];

    const results = await executeFilingResearchSearch({
      query: '"material weakness"',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 500,
      // What SearchPage's Boolean deep-refinement pass always sends — the
      // combination that used to re-enable per-document hydration.
      hydrateTextSignals: true,
      deferTextValidation: false,
      onCoverage: c => coverage.push(c),
      onDegraded: reason => degraded.push(reason),
    });

    // (a) Recall: every candidate becomes a row; the run must not stop at the
    // 120-document budget.
    expect(results.length).toBe(CANDIDATE_COUNT);

    // (b) Cost: a delegated phrase is proved upstream — no document opens.
    expect(mocks.fetchText).not.toHaveBeenCalled();

    // The run must not report itself budget-capped.
    expect(degraded.filter(reason => reason.includes('request budget'))).toEqual([]);

    // Validation coverage spans the whole collected set.
    const final = coverage.at(-1);
    expect(final?.examined).toBe(CANDIDATE_COUNT);
  });

  it('still opens documents when the expression genuinely needs local validation', async () => {
    // AND-composition is never delegated; hydration must keep working there.
    const results = await executeFilingResearchSearch({
      query: 'material AND weakness',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
      hydrateTextSignals: true,
      deferTextValidation: false,
    });

    expect(mocks.fetchText).toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
  });
});
