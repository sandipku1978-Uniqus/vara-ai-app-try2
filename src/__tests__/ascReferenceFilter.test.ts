import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The ASC/ASU citation filter end-to-end through the search pipeline: the
 * retrieval lanes must include citation spellings, and validation must drop
 * candidates whose text does not cite the standard in any accepted form.
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

const TEXT: Record<string, string> = {
  D1: 'The company adopted ASC Topic 842 and recognised lease liabilities.',
  D2: 'Operating lease commitments are disclosed under legacy guidance.',
  D3: 'Adoption of ASU No. 2023-07 expanded segment disclosures for the lease business.',
};

function hit(id: string) {
  return {
    _id: `${id}:doc.htm`,
    _score: 1,
    _source: {
      display_names: [`Co ${id}`],
      file_date: '2026-01-01',
      file_type: '10-K',
      adsh: `0000000000-26-0000${id.slice(1)}`,
      ciks: [`000000000${id.slice(1)}`],
    },
  };
}

beforeEach(() => {
  mocks.search.mockReset();
  mocks.fetchText.mockReset();
  mocks.search.mockImplementation(async () => Object.keys(TEXT).map(hit));
  mocks.fetchText.mockImplementation(async (cik: string) => {
    const id = Object.keys(TEXT).find(d => d.slice(1) === String(cik).replace(/^0+/, ''));
    return id ? TEXT[id] : '';
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

describe('ASC/ASU citation filter in the pipeline', () => {
  it('keeps only filings citing the topic, in any spelling', async () => {
    const results = await executeFilingResearchSearch({
      query: 'lease',
      filters: { ...defaultSearchFilters, ascReference: 'ASC 842' },
      mode: 'semantic',
      limit: 50,
      hydrateTextSignals: true,
    });
    expect(results.map(r => r.cik.replace(/^0+/, ''))).toEqual(['1']);
  });

  it('supports a citation-only search with citation-phrase retrieval lanes', async () => {
    const results = await executeFilingResearchSearch({
      query: '',
      filters: { ...defaultSearchFilters, ascReference: 'ASU 2023-07' },
      mode: 'boolean',
      limit: 50,
      hydrateTextSignals: true,
    });
    expect(results.map(r => r.cik.replace(/^0+/, ''))).toEqual(['3']);

    // Retrieval was anchored on citation spellings, not an empty browse.
    const issued = mocks.search.mock.calls.map(call => String(call[0]));
    expect(issued.some(q => q.includes('ASU 2023-07'))).toBe(true);
  });

  it('unparseable filter input matches nothing rather than everything', async () => {
    const results = await executeFilingResearchSearch({
      query: 'lease',
      filters: { ...defaultSearchFilters, ascReference: 'IFRS 16' },
      mode: 'semantic',
      limit: 50,
      hydrateTextSignals: true,
    });
    expect(results).toEqual([]);
  });
});
