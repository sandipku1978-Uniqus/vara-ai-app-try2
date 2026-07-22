import { describe, it, expect, beforeEach, vi } from 'vitest';

// Query-dependent EDGAR mock: each candidate query returns only the filings that
// contain ALL of its bare tokens (mirrors EFTS AND-of-terms). This is what makes
// the test able to prove OR-branch coverage — returning the same docs for every
// query would hide the bug.
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

const TEXT: Record<string, string> = {
  D1: 'alpha only appears here',
  D2: 'beta only appears here',
  D3: 'alpha and beta together',
  D4: 'beta and gamma together',
  D5: 'alpha beta gamma all present',
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

const DOC_IDS = Object.keys(TEXT);

beforeEach(() => {
  mocks.search.mockReset();
  mocks.fetchText.mockReset();
  // Return docs whose text contains every bare token of the candidate query.
  mocks.search.mockImplementation(async (query: string) => {
    const tokens = String(query).replace(/["()]/g, ' ').split(/\s+/)
      .filter(t => t && !/^(AND|OR|NOT)$/i.test(t)).map(t => t.toLowerCase());
    return DOC_IDS.filter(id => tokens.every(tok => TEXT[id].toLowerCase().includes(tok))).map(hit);
  });
  mocks.fetchText.mockImplementation(async (cik: string) => {
    const id = DOC_IDS.find(d => d.slice(1) === String(cik).replace(/^0+/, ''));
    return id ? TEXT[id] : '';
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

describe('Boolean OR-branch coverage', () => {
  it('retrieves every OR disjunct, including the rare beta-only branch', async () => {
    const results = await executeFilingResearchSearch({
      query: 'alpha OR beta',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
    });
    const ids = results.map(r => r.cik.replace(/^0+/, ''));
    // Union: D1..D5 (beta-only D2 and D4 must be present).
    expect(ids).toContain('2'); // D2 beta-only
    expect(ids).toContain('4'); // D4 beta+gamma
    expect(ids).toContain('1'); // D1 alpha-only
  });

  it('AND is a subset of OR over the same corpus', async () => {
    const or = await executeFilingResearchSearch({
      query: 'alpha OR beta', filters: { ...defaultSearchFilters }, mode: 'boolean', limit: 50,
    });
    const and = await executeFilingResearchSearch({
      query: 'alpha AND beta', filters: { ...defaultSearchFilters }, mode: 'boolean', limit: 50,
    });
    const orIds = new Set(or.map(r => r.cik));
    const andIds = and.map(r => r.cik);
    expect(andIds.length).toBeGreaterThan(0);
    for (const id of andIds) expect(orIds.has(id)).toBe(true);
    // AND is exactly {D3, D5}
    expect(new Set(and.map(r => r.cik.replace(/^0+/, '')))).toEqual(new Set(['3', '5']));
  });

  it('queries the second OR branch even when the first branch fills the display limit', async () => {
    // "alpha" returns a full page; "beta" returns the rare doc. With the bug the
    // loop breaks after the display limit fills on the alpha branch and never
    // queries beta.
    const bulk = Array.from({ length: 60 }, (_, i) => hit(`A${i}`));
    mocks.search.mockImplementation(async (query: string) => {
      const q = String(query).toLowerCase();
      if (q === 'alpha') return bulk;
      if (q === 'beta') return [hit('D2')];
      return [];
    });
    mocks.fetchText.mockImplementation(async () => 'alpha beta'); // everything validates
    await executeFilingResearchSearch({
      query: 'alpha OR beta', filters: { ...defaultSearchFilters }, mode: 'boolean', limit: 5,
    });
    const queried = mocks.search.mock.calls.map(c => String(c[0]).toLowerCase());
    expect(queried).toContain('beta');
  });

  it('stops at the per-run document budget and reports the run as partial', async () => {
    // One branch returns far more candidates than the 120-document cap.
    const many = Array.from({ length: 300 }, (_, i) => hit(`B${i}`));
    mocks.search.mockImplementation(async () => many);
    mocks.fetchText.mockImplementation(async () => 'alpha present');
    const onDegraded = vi.fn();
    await executeFilingResearchSearch({
      query: 'alpha',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 500,
      onDegraded,
    });
    // Never exceeds the 120 document-attempt budget.
    expect(mocks.fetchText.mock.calls.length).toBeLessThanOrEqual(120);
    // And the run is honestly disclosed as a bounded partial.
    expect(onDegraded).toHaveBeenCalledWith(expect.stringMatching(/request budget/i));
  });
});
