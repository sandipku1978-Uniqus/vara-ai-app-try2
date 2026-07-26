import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import type { EdgarSearchHit } from '../services/secApi';

const secMocks = vi.hoisted(() => ({
  searchEdgarFilings: vi.fn(),
  fetchFilingText: vi.fn(),
  fetchCompanySubmissions: vi.fn(),
}));

vi.mock('../services/secApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/secApi')>();
  return {
    ...actual,
    searchEdgarFilings: secMocks.searchEdgarFilings,
    fetchFilingText: secMocks.fetchFilingText,
    fetchFilingTextOutcome: async (...a: unknown[]) => { const t = await secMocks.fetchFilingText(...a); return t ? { ok: true, text: t } : { ok: false, kind: "upstream", retryable: true }; },
    fetchCompanySubmissions: secMocks.fetchCompanySubmissions,
    resolveCompanyEntity: vi.fn().mockResolvedValue(null),
    isEnrichedSearchEnabled: vi.fn().mockReturnValue(false),
  };
});

import { executeFilingResearchSearch } from '../services/filingResearch';

function hit(document: string): EdgarSearchHit {
  return {
    _id: `0000320193:0000320193-23-000106:${document}`,
    _score: 10,
    _source: {
      display_names: ['Apple Inc (CIK 0000320193)'],
      form: '10-K',
      root_forms: ['10-K'],
      file_type: '10-K',
      file_date: '2023-11-02',
      adsh: '0000320193-23-000106',
      ciks: ['0000320193'],
      primary_document: document,
    },
  };
}

describe('executeFilingResearchSearch Boolean validation', () => {
  beforeEach(() => {
    secMocks.searchEdgarFilings.mockReset();
    secMocks.fetchFilingText.mockReset();
    secMocks.fetchCompanySubmissions.mockReset();
    secMocks.fetchCompanySubmissions.mockResolvedValue(null);
  });

  it('retains only filing text satisfying AND, NOT, and proximity', async () => {
    secMocks.searchEdgarFilings.mockResolvedValue([
      hit('valid.htm'),
      hit('fails-not.htm'),
      hit('fails-proximity.htm'),
      hit('fails-and.htm'),
    ]);
    secMocks.fetchFilingText.mockImplementation(async (_cik: string, _accession: string, document: string) => {
      const texts: Record<string, string> = {
        'valid.htm': 'The audit identified a material weakness in internal controls that remains open.',
        'fails-not.htm': 'The audit identified a material weakness that was remediated.',
        'fails-proximity.htm': 'A material issue was discussed through many unrelated words before the audit weakness disclosure.',
        'fails-and.htm': 'A material weakness remains open, but there is no discussion of the required assurance term.',
      };
      return texts[document] || '';
    });

    const results = await executeFilingResearchSearch({
      query: 'material W/3 weakness AND audit AND NOT remediated',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      defaultForms: '10-K',
      limit: 10,
      useEnrichedSearch: true,
      // This flag previously allowed raw metadata candidates to escape before
      // validation. Boolean mode must ignore that shortcut.
      deferTextValidation: true,
    });

    expect(results.map(result => result.primaryDocument)).toEqual(['valid.htm']);
    expect(secMocks.fetchFilingText).toHaveBeenCalledTimes(4);
  });

  it('reports an empty validated result as partial when candidate collection was bounded', async () => {
    secMocks.searchEdgarFilings.mockImplementation(async (...args: unknown[]) => {
      const extended = args[6] as { onCoverage?: (coverage: { examined: number; upstreamTotal: number; complete: boolean }) => void };
      extended.onCoverage?.({ examined: 1, upstreamTotal: 900, complete: false });
      return [hit('candidate.htm')];
    });
    secMocks.fetchFilingText.mockResolvedValue('The filing discusses revenue but not the required control terms.');
    const onCoverage = vi.fn();

    const results = await executeFilingResearchSearch({
      query: 'material AND weakness',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      defaultForms: '10-K',
      limit: 10,
      onCoverage,
    });

    expect(results).toEqual([]);
    expect(onCoverage).toHaveBeenLastCalledWith({ examined: 1, upstreamTotal: 900, complete: false, upstreamTotalIsFloor: false });
  });

  it('marks a filing-text validation deadline as degraded and incomplete', async () => {
    let now = 0;
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    secMocks.searchEdgarFilings.mockImplementation(async (...args: unknown[]) => {
      const extended = args[6] as { onCoverage?: (coverage: { examined: number; upstreamTotal: number; complete: boolean }) => void };
      extended.onCoverage?.({ examined: 1, upstreamTotal: 900, complete: false });
      now = 46_000;
      return [hit('deadline-candidate.htm')];
    });
    const onCoverage = vi.fn();
    const onDegraded = vi.fn();

    try {
      const results = await executeFilingResearchSearch({
        query: 'material AND weakness',
        filters: { ...defaultSearchFilters },
        mode: 'boolean',
        defaultForms: '10-K',
        limit: 10,
        onCoverage,
        onDegraded,
      });

      expect(results).toEqual([]);
      expect(onCoverage).toHaveBeenLastCalledWith({ examined: 0, upstreamTotal: 900, complete: false, upstreamTotalIsFloor: false });
      expect(onDegraded).toHaveBeenCalledWith(expect.stringContaining('time limit'));
      expect(secMocks.fetchFilingText).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('enriches missing EFTS SIC metadata from official company submissions before filtering', async () => {
    secMocks.searchEdgarFilings.mockResolvedValue([hit('annual-report.htm')]);
    secMocks.fetchCompanySubmissions.mockResolvedValue({
      cik: '0000320193',
      name: 'Apple Inc.',
      tickers: ['AAPL'],
      exchanges: ['Nasdaq'],
      ein: '',
      description: '',
      sic: '3571',
      sicDescription: 'Electronic Computers',
      filings: {
        recent: {
          accessionNumber: ['0000320193-23-000106'],
          filingDate: ['2023-11-02'],
          reportDate: ['2023-09-30'],
          acceptanceDateTime: ['2023-11-02T18:08:27.000Z'],
          act: ['34'],
          form: ['10-K'],
          fileNumber: ['001-36743'],
          primaryDocument: ['annual-report.htm'],
          primaryDocDescription: ['10-K'],
        },
      },
    });

    const results = await executeFilingResearchSearch({
      query: '',
      filters: { ...defaultSearchFilters, sicCode: '3571' },
      mode: 'semantic',
      defaultForms: '10-K',
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ sic: '3571', sicDescription: 'Electronic Computers' });
    expect(secMocks.fetchCompanySubmissions).toHaveBeenCalledWith('320193');
  });
});
