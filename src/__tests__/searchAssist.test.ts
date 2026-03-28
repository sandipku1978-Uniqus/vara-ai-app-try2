import { describe, it, expect } from 'vitest';
import { interpretSearchPrompt, buildHighlightTerms } from '../services/searchAssist';

const emptyFilters = {
  keyword: '',
  dateFrom: '',
  dateTo: '',
  entityName: '',
  formTypes: [] as string[],
  sectionKeywords: '',
  sicCode: '',
  stateOfInc: '',
  headquarters: '',
  exchange: [] as string[],
  acceleratedStatus: [] as string[],
  accountant: '',
  accessionNumber: '',
  fileNumber: '',
  fiscalYearEnd: '',
};

describe('searchAssist', () => {
  // ── interpretSearchPrompt ──
  describe('interpretSearchPrompt', () => {
    it('returns empty query for empty prompt', () => {
      const result = interpretSearchPrompt('', emptyFilters);
      expect(result.query).toBe('');
      expect(result.appliedHints).toEqual([]);
    });

    it('extracts 10-K form type from prompt', () => {
      const result = interpretSearchPrompt('show me 10-K filings about revenue', emptyFilters);
      expect(result.filters.formTypes).toContain('10-K');
      expect(result.appliedHints.some(h => h.includes('10-K'))).toBe(true);
    });

    it('extracts 10-Q form type', () => {
      const result = interpretSearchPrompt('10-Q filings with goodwill impairment', emptyFilters);
      expect(result.filters.formTypes).toContain('10-Q');
    });

    it('extracts 8-K form type', () => {
      const result = interpretSearchPrompt('recent 8-K filings', emptyFilters);
      expect(result.filters.formTypes).toContain('8-K');
    });

    it('extracts DEF 14A form type', () => {
      const result = interpretSearchPrompt('DEF 14A proxy statements', emptyFilters);
      expect(result.filters.formTypes).toContain('DEF 14A');
    });

    it('extracts S-1 form type', () => {
      const result = interpretSearchPrompt('S-1 registration statements', emptyFilters);
      expect(result.filters.formTypes).toContain('S-1');
    });

    it('extracts date window "last 3 years"', () => {
      const result = interpretSearchPrompt('revenue recognition changes in the last 3 years', emptyFilters);
      expect(result.filters.dateFrom).toBeTruthy();
      expect(result.filters.dateTo).toBeTruthy();
      expect(result.appliedHints.some(h => h.includes('3 years'))).toBe(true);
    });

    it('extracts date window "past 5 years"', () => {
      const result = interpretSearchPrompt('cybersecurity disclosures past 5 years', emptyFilters);
      expect(result.filters.dateFrom).toBeTruthy();
    });

    it('extracts Deloitte auditor', () => {
      const result = interpretSearchPrompt('10-K filings audited by Deloitte', emptyFilters);
      expect(result.filters.accountant).toBe('Deloitte');
    });

    it('extracts PwC auditor', () => {
      const result = interpretSearchPrompt('PricewaterhouseCoopers audited filings', emptyFilters);
      expect(result.filters.accountant).toBe('PwC');
    });

    it('extracts "Big 4" auditor', () => {
      const result = interpretSearchPrompt('Big 4 audited companies with material weakness', emptyFilters);
      expect(result.filters.accountant).toBe('Big 4');
    });

    it('strips boilerplate phrases from query', () => {
      const result = interpretSearchPrompt('show me filings about cybersecurity risks', emptyFilters);
      expect(result.query.toLowerCase()).toContain('cybersecurity');
      expect(result.query.toLowerCase()).not.toContain('show me');
    });

    it('strips "I am trying to search for" prefix', () => {
      const result = interpretSearchPrompt("I am trying to search for goodwill impairment", emptyFilters);
      expect(result.query.toLowerCase()).toContain('goodwill');
    });

    it('preserves the core query after extraction', () => {
      const result = interpretSearchPrompt('revenue recognition changes', emptyFilters);
      expect(result.query).toBeTruthy();
    });

    it('does not mutate original filters', () => {
      const original = { ...emptyFilters };
      interpretSearchPrompt('10-K Deloitte', emptyFilters);
      expect(emptyFilters.formTypes).toEqual(original.formTypes);
      expect(emptyFilters.accountant).toBe(original.accountant);
    });

    it('handles multiple form types', () => {
      const result = interpretSearchPrompt('10-K and 10-Q filings about leases', emptyFilters);
      expect(result.filters.formTypes.length).toBeGreaterThanOrEqual(2);
    });

    it('extracts both auditor and form type together', () => {
      const result = interpretSearchPrompt('KPMG audited 10-K filings with restatement', emptyFilters);
      expect(result.filters.accountant).toBe('KPMG');
      expect(result.filters.formTypes).toContain('10-K');
    });

    it('rewrites the temporary equity prompt into a quoted semantic query with Deloitte and form filters extracted', () => {
      const result = interpretSearchPrompt(
        'Temporary equity in last 3 years in 10-Q / 10-K audited by Deloitte',
        emptyFilters
      );
      expect(result.query).toContain('"Temporary equity"');
      expect(result.filters.accountant).toBe('Deloitte');
      expect(result.filters.formTypes).toEqual(expect.arrayContaining(['10-K', '10-Q']));
      expect(result.filters.dateFrom).toBeTruthy();
      expect(result.filters.dateTo).toBeTruthy();
    });

    it('generates applied hints for complex queries', () => {
      const result = interpretSearchPrompt('EY audited 10-K filings in the last 2 years about ESG', emptyFilters);
      expect(result.appliedHints.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── buildHighlightTerms ──
  describe('buildHighlightTerms', () => {
    it('returns terms for a simple query', () => {
      const terms = buildHighlightTerms('revenue growth', 'semantic');
      expect(terms.length).toBeGreaterThan(0);
    });

    it('includes quoted phrases from query', () => {
      const terms = buildHighlightTerms('"material weakness" audit', 'semantic');
      expect(terms.some(t => t.toLowerCase().includes('material weakness'))).toBe(true);
    });

    it('includes section keywords', () => {
      const terms = buildHighlightTerms('revenue', 'semantic', 'risk factors, goodwill');
      expect(terms.some(t => t.toLowerCase().includes('risk'))).toBe(true);
    });

    it('filters out stopwords', () => {
      const terms = buildHighlightTerms('the and or for in', 'semantic');
      expect(terms.every(t => t.length >= 3)).toBe(true);
    });

    it('limits to 12 terms max', () => {
      const terms = buildHighlightTerms('a b c d e f g h i j k l m n o p', 'semantic', 'x, y, z');
      expect(terms.length).toBeLessThanOrEqual(12);
    });

    it('sorts longer phrases first', () => {
      const terms = buildHighlightTerms('"material weakness" revenue', 'semantic');
      if (terms.length >= 2) {
        const firstWordCount = terms[0].split(/\s+/).length;
        const lastWordCount = terms[terms.length - 1].split(/\s+/).length;
        expect(firstWordCount).toBeGreaterThanOrEqual(lastWordCount);
      }
    });

    it('handles boolean mode differently', () => {
      const terms = buildHighlightTerms('revenue AND growth', 'boolean');
      expect(terms.length).toBeGreaterThan(0);
    });

    it('handles empty query', () => {
      const terms = buildHighlightTerms('', 'semantic');
      expect(terms).toEqual([]);
    });
  });
});
