import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractItemSection, normalizeItemNumber } from '../utils/sectionPath';

/**
 * Benchmark P1-B3: "Item 1A contains X". The slicer must cut at real Item
 * headings (last occurrence wins — the table of contents precedes the body),
 * and scoping must never silently widen back to the whole document.
 */

const TEN_K = [
  'TABLE OF CONTENTS',
  'Item 1. Business 3',
  'Item 1A. Risk Factors 12',
  'Item 7. Management’s Discussion and Analysis 30',
  'PART I',
  'Item 1. Business',
  'The company designs widgets. Cybersecurity is central to our products.',
  'Item 1A. Risk Factors',
  'A cybersecurity incident could disrupt operations. See Item 7 for liquidity.',
  'Supply chain concentration is a further risk.',
  'Item 7. Management’s Discussion and Analysis',
  'Revenue grew nine percent. No cybersecurity incidents occurred this year.',
].join('\n');

describe('normalizeItemNumber', () => {
  it('accepts bare, prefixed and dotted forms', () => {
    expect(normalizeItemNumber('1A')).toBe('1a');
    expect(normalizeItemNumber('item 9a')).toBe('9a');
    expect(normalizeItemNumber('Item 2.02')).toBe('2.02');
    expect(normalizeItemNumber('7')).toBe('7');
    expect(normalizeItemNumber('risk factors')).toBe('');
  });
});

describe('extractItemSection', () => {
  it('slices from the body heading (not the table of contents) to the next item', () => {
    const slice = extractItemSection(TEN_K, '1A');
    expect(slice).toContain('cybersecurity incident could disrupt');
    expect(slice).toContain('supply chain concentration');
    // Boundaries: nothing from Item 1's body, nothing from Item 7's body.
    expect(slice).not.toContain('designs widgets');
    expect(slice).not.toContain('revenue grew');
  });

  it('is not terminated early by a cross-reference inside the section', () => {
    // "See Item 7" appears inside 1A; the slice must run to the REAL Item 7.
    const slice = extractItemSection(TEN_K, '1A');
    expect(slice).toContain('supply chain concentration');
  });

  it('is not fragmented by running page headers repeating the same item', () => {
    // Many filers print "Item 1A" atop every page of the section. Those
    // repeats must not end the slice — only the next DIFFERENT item does.
    const withRunningHeaders = [
      'Item 1A. Risk Factors',
      'Competition may reduce margins across our segments.',
      'Item 1A.',
      'Supply chain concentration is a further material risk to operations.',
      'Item 1A.',
      'Cyberattacks could disrupt our services and harm our reputation badly.',
      'Item 1B. Unresolved Staff Comments',
      'None.',
    ].join('\n');
    const slice = extractItemSection(withRunningHeaders, '1A');
    expect(slice).toContain('competition may reduce');
    expect(slice).toContain('supply chain concentration');
    expect(slice).toContain('cyberattacks could disrupt');
    expect(slice).not.toContain('unresolved staff');
  });

  it('returns empty for a section the filing does not have', () => {
    expect(extractItemSection(TEN_K, '1C')).toBe('');
    expect(extractItemSection('no items here at all', '1A')).toBe('');
  });
});

/* ── Pipeline: the scope discriminates between filings ── */

const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchText: vi.fn(), prescreen: vi.fn() }));

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
  // Whole-document verdicts are not transferable under an Item scope; the
  // loop must not consult the pre-screen at all for scoped runs. The spy
  // proves it (null = "pre-screen unavailable" on the unscoped path).
  prescreenBooleanCandidates: (...args: unknown[]) => mocks.prescreen(...args),
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectoryIndex: async () => ({}),
  loadSicDirectory: async () => [],
}));

import { executeFilingResearchSearch } from '../services/filingResearch';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';

const TEXT: Record<string, string> = {
  // D1: cybersecurity discussed IN Item 1A.
  D1: TEN_K,
  // D2: cybersecurity discussed only in MD&A, not in 1A.
  D2: [
    'Item 1A. Risk Factors',
    'Competition may reduce margins.',
    'Item 7. Management’s Discussion and Analysis',
    'We invested in cybersecurity infrastructure this year.',
  ].join('\n'),
  // D3: no Item structure at all.
  D3: 'This exhibit mentions cybersecurity without any item structure.',
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
  mocks.prescreen.mockReset().mockResolvedValue(null);
  mocks.search.mockImplementation(async () => Object.keys(TEXT).map(hit));
  mocks.fetchText.mockImplementation(async (cik: string) => {
    const id = Object.keys(TEXT).find(d => d.slice(1) === String(cik).replace(/^0+/, ''));
    return id ? TEXT[id] : '';
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

describe('section-scoped search in the pipeline', () => {
  it('keeps only the filing whose Item 1A contains the term', async () => {
    const results = await executeFilingResearchSearch({
      query: 'cybersecurity',
      filters: { ...defaultSearchFilters, sectionScope: '1A' },
      mode: 'boolean',
      limit: 50,
      hydrateTextSignals: true,
    });
    expect(results.map(r => r.cik.replace(/^0+/, ''))).toEqual(['1']);
    // The snippet comes from inside the section, and the breadcrumb names it.
    expect(results[0].matchSnippet).toContain('cybersecurity incident');
    expect(results[0].matchSectionPath).toBe('Item 1A · Risk Factors');
    // Whole-document pre-screen verdicts are not transferable under a scope.
    expect(mocks.prescreen).not.toHaveBeenCalled();
  });

  it('an unscoped run of the same query keeps all three', async () => {
    const results = await executeFilingResearchSearch({
      query: 'cybersecurity',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
      hydrateTextSignals: true,
    });
    expect(results).toHaveLength(3);
  });
});
