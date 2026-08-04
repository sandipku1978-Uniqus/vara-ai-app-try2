import { beforeEach, describe, expect, it, vi } from 'vitest';

const tally = vi.hoisted(() => ({ documentHttpAttempts: 0 }));
const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchOutcome: vi.fn() }));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingTextOutcome: mocks.fetchOutcome,
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
import { defaultSearchFilters } from '../domain/searchFilters';
import type { SearchCandidateCoverage } from '../services/secApi';

function exhibitHit(index: number) {
  const cik = String(700_000 + index).padStart(10, '0');
  const serial = String(index).padStart(6, '0');
  const accession = `${cik}-26-${serial}`;
  return {
    _id: `${accession}:exhibit-${index}.htm`,
    _score: 1,
    _source: {
      display_names: [`Issuer ${index}`],
      file_date: '2026-01-01',
      file_type: '10-K',
      adsh: accession,
      ciks: [cik],
      primary_document: `parent-${index}.htm`,
    },
  };
}

beforeEach(() => {
  tally.documentHttpAttempts = 0;
  mocks.search.mockReset();
  mocks.fetchOutcome.mockReset();
  mocks.search.mockImplementation(async (_query: string, ...rest: unknown[]) => {
    const options = rest[5] as { onUpstreamPage?: () => boolean | void };
    if (options.onUpstreamPage?.() === false) return [];
    return Array.from({ length: 100 }, (_, index) => exhibitHit(index));
  });
  mocks.fetchOutcome.mockImplementation(async () => {
    // secApi retries a transient document read at most once. Each exhibit also
    // loads its parent, so one logical signal can cost four HTTP attempts.
    tally.documentHttpAttempts += 2;
    return { ok: true, text: 'alpha disclosure', attempts: 2 };
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

describe('retry-inclusive document HTTP ceiling', () => {
  it('reserves exhibit + parent retries before launching a concurrent chunk', async () => {
    let coverage: SearchCandidateCoverage | null = null;
    const degraded: string[] = [];

    await executeFilingResearchSearch({
      query: 'alpha',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 500,
      hydrateTextSignals: true,
      onCoverage: value => { coverage = value; },
      onDegraded: message => { degraded.push(message); },
    });

    const work = coverage!.work!;
    expect(tally.documentHttpAttempts).toBe(180);
    expect(work.docHttpAttempts).toBe(tally.documentHttpAttempts);
    expect(work.docHttpAttempts).toBeLessThanOrEqual(work.ceiling.docHttpAttempts);
    expect(degraded.some(message => /request budget/i.test(message))).toBe(true);
  });
});
