import { describe, it, expect } from 'vitest';
import { planResearchSearch } from '../services/researchSearchPlan';
import { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';

const base = (over: Partial<SearchFilters> = {}): SearchFilters => ({ ...defaultSearchFilters, ...over });

describe('planResearchSearch', () => {
  it('reports nothing to search when query and filters are both empty', () => {
    expect(planResearchSearch('   ', base(), 'semantic').status).toBe('empty');
  });

  describe('Boolean validation ordering (readiness finding F-05)', () => {
    it('rejects auditor: in OR context instead of silently rewriting it', () => {
      // If the auditor token were extracted BEFORE validation, this would
      // become "lease" + a global KPMG filter — a silent AND, not the OR the
      // user typed. The whole expression must be judged first.
      const plan = planResearchSearch('lease OR auditor:KPMG', base(), 'boolean');
      expect(plan.status).toBe('rejected');
      if (plan.status === 'rejected') expect(plan.message).toMatch(/applies to only part of this query/i);
    });

    it('rejects auditor: under NOT for the same reason', () => {
      expect(planResearchSearch('lease AND NOT auditor:KPMG', base(), 'boolean').status).toBe('rejected');
    });

    it('accepts AND composition and lifts the firm into a structured filter', () => {
      const plan = planResearchSearch('"material weakness" AND auditor:KPMG', base(), 'boolean');
      expect(plan.status).toBe('ready');
      if (plan.status !== 'ready') return;

      expect(plan.filters.accountant).toBe('KPMG');
      expect(plan.query).not.toMatch(/auditor:/i);
      expect(plan.query).toContain('material weakness');
      expect(plan.promotedAuditor?.canonical).toBe('KPMG');
      expect(plan.appliedHints).toContain('Audit firm: KPMG');
    });

    it('does not overwrite an auditor already chosen in Advanced Filters', () => {
      const plan = planResearchSearch('lease AND auditor:KPMG', base({ accountant: 'Deloitte' }), 'boolean');
      if (plan.status !== 'ready') throw new Error('expected ready');
      expect(plan.filters.accountant).toBe('Deloitte');
    });

    it('rejects malformed syntax so the caller can issue zero requests', () => {
      expect(planResearchSearch('lease AND', base(), 'boolean').status).toBe('rejected');
      expect(planResearchSearch('(revenue AND growth', base(), 'boolean').status).toBe('rejected');
      expect(planResearchSearch('NOT goodwill', base(), 'boolean').status).toBe('rejected');
    });
  });

  describe('mode detection', () => {
    it('switches to Boolean when the text carries Boolean syntax', () => {
      const plan = planResearchSearch('"material weakness" AND cybersecurity', base(), 'semantic');
      if (plan.status !== 'ready') throw new Error('expected ready');
      expect(plan.mode).toBe('boolean');
      expect(plan.appliedHints).toContain('Detected Boolean / proximity syntax');
    });

    it('leaves ordinary prose in Filing Research mode', () => {
      const plan = planResearchSearch('companies discussing supply chain risk', base(), 'semantic');
      if (plan.status !== 'ready') throw new Error('expected ready');
      expect(plan.mode).toBe('semantic');
    });
  });

  describe('legacy form-scope widening', () => {
    it('clears a stale 10-K/10-Q default the user never chose', () => {
      const plan = planResearchSearch('climate disclosure', base({ formTypes: ['10-K', '10-Q'] }), 'boolean');
      if (plan.status !== 'ready') throw new Error('expected ready');
      expect(plan.filters.formTypes).toEqual([]);
      expect(plan.appliedHints).toContain('Form scope: all core filings');
    });

    it('keeps the scope when the query itself names a form', () => {
      const plan = planResearchSearch('10-K climate disclosure', base({ formTypes: ['10-K', '10-Q'] }), 'boolean');
      if (plan.status !== 'ready') throw new Error('expected ready');
      expect(plan.filters.formTypes).toEqual(['10-K', '10-Q']);
    });

    it('keeps a scope the user deliberately set alongside other filters', () => {
      const plan = planResearchSearch('lease', base({ formTypes: ['10-K', '10-Q'], accountant: 'KPMG' }), 'boolean');
      if (plan.status !== 'ready') throw new Error('expected ready');
      expect(plan.filters.formTypes).toEqual(['10-K', '10-Q']);
    });
  });

  it('does not mutate the caller\'s filters object', () => {
    const original = base({ formTypes: ['10-K', '10-Q'] });
    const snapshot = JSON.stringify(original);
    planResearchSearch('climate', original, 'boolean');
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
