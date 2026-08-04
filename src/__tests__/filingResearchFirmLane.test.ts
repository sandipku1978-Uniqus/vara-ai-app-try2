import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Audit R1 slice 2: the firm-scoped retrieval lane. The named regression is
 * `auditor:PwC AND (impairment OR NOT goodwill)` — a PwC filing satisfying
 * NOT goodwill WITHOUT mentioning impairment used to be silently omitted,
 * because the unanchored disjunct had no lane and the planner dropped it
 * without a trace. The firm-name lane is now that branch's required
 * retrieval; full-expression validation enforces the logic.
 */

const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchText: vi.fn() }));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingText: mocks.fetchText,
  fetchFilingTextOutcome: async (...a: unknown[]) => { const t = await mocks.fetchText(...a); return t ? { ok: true, text: t } : { ok: false, kind: 'upstream', retryable: true }; },
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

// F1: PwC filing about impairment — the anchored branch finds it.
// F2: PwC filing about LEASES — mentions neither impairment nor goodwill, so
//     ONLY the firm lane can surface it; it satisfies NOT goodwill. This is
//     the document the audit says was silently omitted.
// F3: PwC filing about goodwill — retrievable, but validation must REJECT it
//     (fails impairment AND fails NOT goodwill).
// F4: KPMG filing about leases — firm post-filter must exclude it.
const TEXT: Record<string, string> = {
  F1: 'annual report audited by PricewaterhouseCoopers LLP discussing impairment charges',
  F2: 'annual report audited by PricewaterhouseCoopers LLP discussing lease accounting matters',
  F3: 'annual report audited by PricewaterhouseCoopers LLP discussing goodwill balances',
  F4: 'annual report audited by KPMG LLP discussing lease accounting matters',
};

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

const DOC_IDS = Object.keys(TEXT);

beforeEach(() => {
  mocks.search.mockReset();
  mocks.fetchText.mockReset();
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

describe('firm-scoped lane covers the unanchored branch (audit R1)', () => {
  it('surfaces the NOT-goodwill-only PwC filing the old planner silently dropped', async () => {
    const results = await executeFilingResearchSearch({
      query: '(impairment OR NOT goodwill)',
      filters: { ...defaultSearchFilters, accountant: 'PwC' },
      mode: 'boolean',
    });
    const ids = results.map(r => r.id.split(':')[0]).sort();
    // F1 via the impairment branch; F2 via the firm lane + NOT-goodwill
    // validation. F3 fails both disjuncts; F4 fails the firm post-filter.
    expect(ids).toEqual(['F1', 'F2']);
  });

  it('issues the firm-name lane as a retrieval query in its own right', async () => {
    await executeFilingResearchSearch({
      query: '(impairment OR NOT goodwill)',
      filters: { ...defaultSearchFilters, accountant: 'PwC' },
      mode: 'boolean',
    });
    const queries = mocks.search.mock.calls.map(call => String(call[0]).toLowerCase());
    // At least one candidate query must be the firm term ALONE — not merely
    // firm-paired-with-branch precision boosts, which can never fetch a
    // document containing neither disjunct's tokens.
    expect(queries.some(q => q.includes('pricewaterhousecoopers') && !q.includes('impairment'))).toBe(true);
  });

  it('does not add a firm lane when every branch is anchored', async () => {
    await executeFilingResearchSearch({
      query: '(impairment OR restructuring)',
      filters: { ...defaultSearchFilters, accountant: 'PwC' },
      mode: 'boolean',
    });
    const queries = mocks.search.mock.calls.map(call => String(call[0]).toLowerCase());
    const firmAlone = queries.filter(q => q.includes('pricewaterhousecoopers') && !q.includes('impairment') && !q.includes('restructuring'));
    expect(firmAlone).toEqual([]);
  });
});
