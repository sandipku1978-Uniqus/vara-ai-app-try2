import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchText: vi.fn() }));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingText: mocks.fetchText,
  fetchFilingTextOutcome: async (...a: unknown[]) => { const t = await mocks.fetchText(...a); return t ? { ok: true, text: t } : { ok: false, kind: "upstream", retryable: true }; },
  isEnrichedSearchEnabled: () => false,
  fetchCompanySubmissions: async () => null,
  resolveCompanyInput: async () => null,
  // null = pre-screen unavailable, so these cases exercise the local validation
  // path exactly as they did before it existed.
  prescreenBooleanCandidates: async () => null,
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

  it('lists every matched exhibit under the parent row with its own recorded evidence', async () => {
    const results = await executeFilingResearchSearch({
      query: 'clawback',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
    });

    const [row] = results.filter(r => r.accessionNumber === ACCESSION);
    expect(row.matchedExhibits?.map(exhibit => [exhibit.documentType, exhibit.documentName])).toEqual([
      ['EX-99.1', 'ex99-1.htm'],
      ['EX-99.2', 'ex99-2.htm'],
    ]);
    for (const exhibit of row.matchedExhibits || []) {
      expect(exhibit.matchSnippet).toContain('clawback');
      expect(exhibit.matchHitCount).toBe(1);
    }
  });

  it('records up to three distinct passages and the hit count from the text validation read', async () => {
    const filler = 'Directors reviewed staffing, facilities, suppliers, budgets, and long range planning matters at length. '.repeat(4);
    const text = [
      'Item 1. Business', 'The board adopted a clawback policy.', filler,
      'Item 1A. Risk Factors', 'A clawback may be difficult to enforce.', filler,
      'Item 9B. Other Information', 'The clawback policy is filed as an exhibit.', filler,
      'Item 10. Directors', 'The committee administers the clawback.',
    ].join('\n');
    mocks.search.mockImplementation(async () => [{
      _id: `${ACCESSION}:main.htm`,
      _score: 1,
      _source: {
        display_names: ['Parent Match Corp  (CIK 0000000001)'],
        file_date: '2026-03-01',
        file_type: '10-K',
        root_form: '10-K',
        adsh: ACCESSION,
        ciks: [CIK],
      },
    }]);
    mocks.fetchText.mockImplementation(async () => text);

    const results = await executeFilingResearchSearch({
      query: 'clawback',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
    });

    const [row] = results;
    expect(row.matchHitCount).toBe(4);
    expect(row.matchSnippets).toHaveLength(3);
    expect(row.matchSnippets?.[0]).toEqual({ excerpt: row.matchSnippet, sectionPath: row.matchSectionPath || '' });
    expect(row.matchSnippets?.slice(1).map(snippet => snippet.sectionPath)).toEqual([
      'Item 1A · Risk Factors',
      'Item 9B · Other Information',
    ]);
    // Passages come from the text already read for validation — one read.
    expect(mocks.fetchText).toHaveBeenCalledTimes(1);
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
