import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Audit R1 budget proof: "observed upstream requests must never exceed the
 * declared end-to-end ceiling" — and the displayed ledger must EQUAL the
 * measured work, retries and server pre-screens included. The mocks here
 * simulate an unreliable upstream (every document fetched twice via the
 * outcome's attempts field, pages re-attempted) and tally every simulated
 * HTTP attempt on the mock side; the run's coverage.work must agree with
 * that tally exactly and stay inside its own declared ceilings.
 */

const tally = vi.hoisted(() => ({ pageAttempts: 0, docAttempts: 0, prescreens: 0 }));
const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchOutcome: vi.fn(), prescreen: vi.fn() }));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingText: vi.fn(async () => ''),
  fetchFilingTextOutcome: mocks.fetchOutcome,
  isEnrichedSearchEnabled: () => false,
  fetchCompanySubmissions: async () => null,
  resolveCompanyInput: async () => null,
  prescreenBooleanCandidates: mocks.prescreen,
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectoryIndex: async () => ({}),
  loadSicDirectory: async () => [],
}));

import { executeFilingResearchSearch } from '../services/filingResearch';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import type { SearchCandidateCoverage } from '../services/secApi';

const TEXT: Record<string, string> = {
  B1: 'alpha disclosure text one',
  B2: 'alpha disclosure text two',
  B3: 'beta disclosure text three',
  B4: 'alpha and beta disclosure four',
};
const DOC_IDS = Object.keys(TEXT);

function hit(id: string) {
  return {
    _id: `${id}:doc.htm`,
    _score: 1,
    _source: {
      display_names: [`Issuer ${id}`],
      file_date: '2026-01-01',
      file_type: '10-K',
      adsh: `0000000000-26-0000${id.slice(1)}`,
      ciks: [`000000000${id.slice(1)}`],
    },
  };
}

beforeEach(() => {
  tally.pageAttempts = 0;
  tally.docAttempts = 0;
  tally.prescreens = 0;
  mocks.search.mockReset();
  mocks.fetchOutcome.mockReset();
  mocks.prescreen.mockReset();

  // Each candidate query costs TWO page attempts (one simulated retry), both
  // reported through onUpstreamPage — mirroring secApi, which fires the
  // callback per HTTP attempt inside its retry loop.
  // Real signature: (query, formTypes, dateFrom, dateTo, entityName, max, options)
  mocks.search.mockImplementation(async (query: string, ...rest: unknown[]) => {
    const options = rest[5] as { onUpstreamPage?: () => void } | undefined;
    tally.pageAttempts += 2;
    options?.onUpstreamPage?.();
    options?.onUpstreamPage?.();
    const tokens = String(query).replace(/["()]/g, ' ').split(/\s+/)
      .filter(t => t && !/^(AND|OR|NOT)$/i.test(t)).map(t => t.toLowerCase());
    return DOC_IDS.filter(id => tokens.every(tok => TEXT[id].toLowerCase().includes(tok))).map(hit);
  });

  // Every document costs TWO HTTP attempts (first fails, retry succeeds),
  // reported via the outcome's attempts field — mirroring secApi.
  mocks.fetchOutcome.mockImplementation(async (cik: string) => {
    tally.docAttempts += 2;
    const id = DOC_IDS.find(d => d.slice(1) === String(cik).replace(/^0+/, ''));
    return { ok: true, text: id ? TEXT[id] : '', attempts: 2 };
  });

  // Pre-screen answers nothing useful (no filtering) but each call is work.
  mocks.prescreen.mockImplementation(async () => {
    tally.prescreens += 1;
    return null;
  });

  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

describe('end-to-end budget proof (audit R1)', () => {
  it('reports measured work equal to the mock-side tally, retries included', async () => {
    let coverage: SearchCandidateCoverage | null = null;
    await executeFilingResearchSearch({
      query: 'alpha OR beta',
      filters: defaultSearchFilters,
      mode: 'boolean',
      onCoverage: c => { coverage = c; },
    });

    expect(coverage).not.toBeNull();
    const work = coverage!.work;
    expect(work, 'coverage must carry the work ledger').toBeDefined();
    // Pages: every attempt the mock reported must be in the ledger.
    expect(work!.pageRequests).toBe(tally.pageAttempts);
    // Documents: HTTP attempts (2 per doc) — the ledger must reflect the
    // retry-inclusive number, not the logical fetch count.
    expect(work!.docHttpAttempts).toBe(tally.docAttempts);
    expect(work!.docHttpAttempts).toBe(work!.docFetches * 2);
    // Pre-screen calls issued by the run are measured work too. The mock
    // returns null (unavailable), which the executor counts and then stops
    // asking — the request still happened.
    expect(work!.prescreenRequests).toBe(tally.prescreens);
    // The total is the sum of its parts, no hidden classes.
    expect(work!.totalUpstreamRequests).toBe(
      work!.pageRequests + work!.docHttpAttempts + work!.prescreenRequests
    );
  });

  it('never exceeds its own declared ceilings', async () => {
    let coverage: SearchCandidateCoverage | null = null;
    await executeFilingResearchSearch({
      query: 'alpha OR beta',
      filters: defaultSearchFilters,
      mode: 'boolean',
      onCoverage: c => { coverage = c; },
    });

    const work = coverage!.work!;
    expect(work.pageRequests).toBeLessThanOrEqual(work.ceiling.pages);
    expect(work.docHttpAttempts).toBeLessThanOrEqual(work.ceiling.docHttpAttempts);
    expect(work.prescreenRequests).toBeLessThanOrEqual(work.ceiling.prescreenRequests);
  });
});
