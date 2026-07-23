import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchText: vi.fn() }));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingText: mocks.fetchText,
  isEnrichedSearchEnabled: () => false,
  fetchCompanySubmissions: async () => null,
  resolveCompanyInput: async () => null,
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectoryIndex: async () => ({}),
  loadSicDirectory: async () => [],
}));

import { executeFilingResearchSearch } from '../services/filingResearch';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';

const ACCESSION = '0000000001-26-000001';
const CIK = '0000000001';

/** One 8-K whose disclosure appears only in two exhibits, never in the parent. */
function exhibitHit(document: string, documentType: string) {
  return {
    _id: `${ACCESSION}:${document}`,
    _score: 1,
    _source: {
      display_names: ['Exhibit Only Corp  (CIK 0000000001)'],
      file_date: '2026-03-01',
      file_type: documentType,
      root_form: '8-K',
      adsh: ACCESSION,
      ciks: [CIK],
    },
  };
}

beforeEach(() => {
  mocks.search.mockReset();
  mocks.fetchText.mockReset();
  mocks.search.mockImplementation(async () => [
    exhibitHit('ex99-1.htm', 'EX-99.1'),
    exhibitHit('ex99-2.htm', 'EX-99.2'),
  ]);
  // Both exhibits carry the term; the parent document does not.
  mocks.fetchText.mockImplementation(async () => 'the registrant disclosed a clawback provision');
});

describe('exhibit roll-up', () => {
  it('surfaces an exhibit-only match instead of discarding it', async () => {
    const results = await executeFilingResearchSearch({
      query: 'clawback',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it('collapses several matching exhibits into one filing row with provenance', async () => {
    const results = await executeFilingResearchSearch({
      query: 'clawback',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
    });

    // Two matching documents in the same accession must not read as two filings.
    const forThisFiling = results.filter(r => r.accessionNumber === ACCESSION);
    expect(forThisFiling).toHaveLength(1);

    const [row] = forThisFiling;
    expect(row.matchedDocumentType).toMatch(/^EX-99\./);
    expect(row.matchedDocumentName).toBeTruthy();
    expect(row.matchedDocumentUrl).toContain(row.matchedDocumentName as string);
    expect(row.matchedDocumentCount).toBe(2);
  });

  it('leaves a parent-document match without exhibit provenance', async () => {
    mocks.search.mockImplementation(async () => [
      {
        _id: `${ACCESSION}:main.htm`,
        _score: 1,
        _source: {
          display_names: ['Parent Match Corp  (CIK 0000000001)'],
          file_date: '2026-03-01',
          file_type: '8-K',
          root_form: '8-K',
          adsh: ACCESSION,
          ciks: [CIK],
        },
      },
    ]);

    const results = await executeFilingResearchSearch({
      query: 'clawback',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
    });

    expect(results).toHaveLength(1);
    expect(results[0].matchedDocumentType).toBeUndefined();
  });
});
