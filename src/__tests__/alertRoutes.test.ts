import { describe, expect, it } from 'vitest';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { buildSavedAlertRouteParams, snapshotSavedAlertCoverage } from '../services/alertRoutes';
import { hasResearchSearchCriteria, parseResearchRouteParams } from '../services/researchSessions';

function filters() {
  return {
    keyword: 'internal controls',
    dateFrom: '2024-01-01',
    dateTo: '2026-07-19',
    entityName: 'Apple Inc.',
    entityCik: '',
    formTypes: [] as string[],
    sectionKeywords: 'risk factors',
    sicCode: '3571',
    stateOfInc: 'CA',
    headquarters: 'CA',
    exchange: ['NASDAQ'],
    acceleratedStatus: ['LAF'],
    accountant: 'EY',
    accessionNumber: '',
    fileNumber: '001-36743',
    fiscalYearEnd: '0930',
    accountingFramework: 'US GAAP',
    ascReference: 'ASC 842',
    sectionScope: '1A',
  };
}

describe('saved-alert route contract', () => {
  it('reopens the complete query, mode, filters, and default form scope', () => {
    const originalFilters = filters();
    const params = buildSavedAlertRouteParams({
      query: 'cybersecurity AND incident',
      mode: 'boolean',
      filters: originalFilters,
      defaultForms: '10-K, 10-Q',
    });

    expect(parseResearchRouteParams(params)).toEqual({
      query: 'cybersecurity AND incident',
      mode: 'boolean',
      filters: { ...originalFilters, formTypes: ['10-K', '10-Q'] },
    });
    expect(originalFilters.formTypes).toEqual([]);
  });

  it('preserves explicit form filters instead of replacing them with defaults', () => {
    const originalFilters = { ...filters(), formTypes: ['8-K'] };
    const parsed = parseResearchRouteParams(buildSavedAlertRouteParams({
      query: '',
      mode: 'semantic',
      filters: originalFilters,
      defaultForms: '10-K,10-Q',
    }));

    expect(parsed?.filters.formTypes).toEqual(['8-K']);
  });

  it('supports a queryless date, form, and SIC saved alert', () => {
    const filterOnly = {
      ...filters(),
      keyword: '',
      entityName: '',
      sectionKeywords: '',
      accountant: '',
      stateOfInc: '',
      headquarters: '',
      exchange: [],
      acceleratedStatus: [],
      fileNumber: '',
      fiscalYearEnd: '',
      accountingFramework: '',
      ascReference: '',
      sectionScope: '',
      dateFrom: '2026-01-01',
      dateTo: '2026-07-19',
      sicCode: '3571',
      formTypes: ['10-K'],
    };

    expect(hasResearchSearchCriteria('', filterOnly)).toBe(true);
    expect(parseResearchRouteParams(buildSavedAlertRouteParams({
      query: '',
      mode: 'semantic',
      filters: filterOnly,
      defaultForms: '',
    }))).toEqual({ query: '', mode: 'semantic', filters: filterOnly });
  });

  it('enables Save Alert for form/date-only research criteria', () => {
    const filterOnly = {
      ...defaultSearchFilters,
      dateFrom: '2026-01-01',
      dateTo: '2026-07-19',
      formTypes: ['10-K'],
    };

    expect(hasResearchSearchCriteria('', filterOnly)).toBe(true);
  });
});

describe('saved alert coverage snapshots', () => {
  it('deep-copies branch verdicts, incomplete reasons, and measured work', () => {
    const source = {
      complete: false,
      examined: 8,
      upstreamTotal: 12,
      branches: [{
        branch: 'going concern',
        required: true,
        pages: 2,
        candidatesSurfaced: 9,
        candidatesNew: 8,
        examined: 8,
        matched: 3,
        exhausted: false,
        collectionComplete: false,
        incompleteReason: 'page-budget' as const,
      }],
      work: {
        pageRequests: 2,
        docFetches: 8,
        docHttpAttempts: 10,
        prescreenRequests: 1,
        totalUpstreamRequests: 13,
        ceiling: { pages: 2, docHttpAttempts: 12, prescreenRequests: 2 },
      },
    };

    const snapshot = snapshotSavedAlertCoverage(source);

    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot.branches).not.toBe(source.branches);
    expect(snapshot.branches?.[0]).not.toBe(source.branches[0]);
    expect(snapshot.work).not.toBe(source.work);
    expect(snapshot.work?.ceiling).not.toBe(source.work.ceiling);
  });
});
