import { describe, it, expect } from 'vitest';
import {
  createSearchFilters,
  pickDefaultSummarySectionLabels,
  buildSearchResultCitation,
  buildCommentLetterCitation,
  buildFilingCitation,
  inferSurfaceFromPath,
} from '../services/agentEvidence';

describe('agentEvidence', () => {
  // ── createSearchFilters ──
  describe('createSearchFilters', () => {
    it('returns default filters', () => {
      const filters = createSearchFilters();
      expect(filters.keyword).toBe('');
      expect(filters.formTypes).toEqual([]);
      expect(filters.exchange).toEqual([]);
      expect(filters.acceleratedStatus).toEqual([]);
    });

    it('returns a new object each time', () => {
      const f1 = createSearchFilters();
      const f2 = createSearchFilters();
      expect(f1).not.toBe(f2);
    });

    it('has all expected filter fields', () => {
      const filters = createSearchFilters();
      expect(filters).toHaveProperty('keyword');
      expect(filters).toHaveProperty('dateFrom');
      expect(filters).toHaveProperty('dateTo');
      expect(filters).toHaveProperty('entityName');
      expect(filters).toHaveProperty('formTypes');
      expect(filters).toHaveProperty('sicCode');
      expect(filters).toHaveProperty('accountant');
    });
  });

  // ── pickDefaultSummarySectionLabels ──
  describe('pickDefaultSummarySectionLabels', () => {
    it('returns 10-K sections', () => {
      const labels = pickDefaultSummarySectionLabels('10-K');
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.some(l => l.includes('Risk Factors'))).toBe(true);
      expect(labels.some(l => l.includes('MD&A'))).toBe(true);
    });

    it('returns 10-Q sections', () => {
      const labels = pickDefaultSummarySectionLabels('10-Q');
      expect(labels.length).toBeGreaterThan(0);
    });

    it('returns S-1 sections', () => {
      const labels = pickDefaultSummarySectionLabels('S-1');
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.some(l => l.includes('Prospectus'))).toBe(true);
    });

    it('returns default sections for unknown form types', () => {
      const labels = pickDefaultSummarySectionLabels('8-K');
      expect(labels.length).toBeGreaterThan(0);
    });

    it('is case insensitive', () => {
      const upper = pickDefaultSummarySectionLabels('10-K');
      const lower = pickDefaultSummarySectionLabels('10-k');
      expect(upper).toEqual(lower);
    });

    it('10-K includes business and financial statements', () => {
      const labels = pickDefaultSummarySectionLabels('10-K');
      expect(labels.some(l => l.includes('Business'))).toBe(true);
      expect(labels.some(l => l.includes('Financial'))).toBe(true);
    });

    it('S-1 includes Use of Proceeds', () => {
      const labels = pickDefaultSummarySectionLabels('S-1');
      expect(labels.some(l => l.includes('Use of Proceeds'))).toBe(true);
    });
  });

  // ── buildSearchResultCitation ──
  describe('buildSearchResultCitation', () => {
    it('creates citation with correct kind', () => {
      const citation = buildSearchResultCitation({
        companyName: 'Apple Inc.',
        formType: '10-K',
        filingDate: '2023-11-02',
        description: 'Annual report',
        route: '/filing/123',
        externalUrl: 'https://sec.gov/filing/123',
      });
      expect(citation.kind).toBe('search-result');
      expect(citation.title).toContain('Apple');
      expect(citation.title).toContain('10-K');
    });

    it('sets subtitle to filing date', () => {
      const citation = buildSearchResultCitation({
        companyName: 'Test',
        formType: '10-K',
        filingDate: '2023-01-15',
        description: '',
        route: '/r',
        externalUrl: '',
      });
      expect(citation.subtitle).toBe('2023-01-15');
    });

    it('generates unique IDs', () => {
      const c1 = buildSearchResultCitation({ companyName: 'A', formType: '10-K', filingDate: '', description: '', route: '', externalUrl: '' });
      const c2 = buildSearchResultCitation({ companyName: 'A', formType: '10-K', filingDate: '', description: '', route: '', externalUrl: '' });
      expect(c1.id).not.toBe(c2.id);
    });

    it('includes route', () => {
      const citation = buildSearchResultCitation({
        companyName: 'Test',
        formType: '10-K',
        filingDate: '',
        description: '',
        route: '/filing/abc',
        externalUrl: '',
      });
      expect(citation.route).toBe('/filing/abc');
    });
  });

  // ── buildCommentLetterCitation ──
  describe('buildCommentLetterCitation', () => {
    it('creates citation with comment-letter kind', () => {
      const citation = buildCommentLetterCitation({
        companyName: 'Tesla',
        formType: 'CORRESP',
        filingDate: '2023-06-15',
        route: '/filing/456',
        externalUrl: '',
        description: 'SEC comment',
      });
      expect(citation.kind).toBe('comment-letter');
      expect(citation.title).toContain('Tesla');
    });

    it('includes description as meta', () => {
      const citation = buildCommentLetterCitation({
        companyName: 'A',
        formType: 'CORRESP',
        filingDate: '',
        route: '',
        externalUrl: '',
        description: 'Revenue recognition concerns',
      });
      expect(citation.meta).toBe('Revenue recognition concerns');
    });
  });

  // ── buildFilingCitation ──
  describe('buildFilingCitation', () => {
    const locator = {
      cik: '320193',
      accessionNumber: '0000320193-23-000106',
      filingDate: '2023-11-02',
      formType: '10-K',
      primaryDocument: 'aapl-20230930.htm',
      companyName: 'Apple Inc.',
    };

    it('creates citation with filing kind', () => {
      const citation = buildFilingCitation(locator);
      expect(citation.kind).toBe('filing');
    });

    it('includes company name and form type in title', () => {
      const citation = buildFilingCitation(locator);
      expect(citation.title).toContain('Apple');
      expect(citation.title).toContain('10-K');
    });

    it('builds route from locator', () => {
      const citation = buildFilingCitation(locator);
      expect(citation.route).toContain('/filing/');
    });

    it('builds external URL', () => {
      const citation = buildFilingCitation(locator);
      expect(citation.externalUrl).toBeTruthy();
    });

    it('includes optional note as meta', () => {
      const citation = buildFilingCitation(locator, 'Important filing');
      expect(citation.meta).toBe('Important filing');
    });

    it('generates unique IDs', () => {
      const c1 = buildFilingCitation(locator);
      const c2 = buildFilingCitation(locator);
      expect(c1.id).not.toBe(c2.id);
    });
  });

  // ── inferSurfaceFromPath ──
  describe('inferSurfaceFromPath', () => {
    it('returns "accounting" for /accounting path', () => {
      expect(inferSurfaceFromPath('/accounting')).toBe('accounting');
    });

    it('returns "accounting" for /accounting-analytics path', () => {
      expect(inferSurfaceFromPath('/accounting-analytics')).toBe('accounting');
    });

    it('returns "comment-letters" for /comment-letters path', () => {
      expect(inferSurfaceFromPath('/comment-letters')).toBe('comment-letters');
    });

    it('returns "research" for /search path', () => {
      expect(inferSurfaceFromPath('/search')).toBe('research');
    });

    it('returns "research" for /dashboard path', () => {
      expect(inferSurfaceFromPath('/dashboard')).toBe('research');
    });

    it('returns "research" for unknown paths', () => {
      expect(inferSurfaceFromPath('/unknown')).toBe('research');
    });

    it('returns "research" for root path', () => {
      expect(inferSurfaceFromPath('/')).toBe('research');
    });
  });
});
