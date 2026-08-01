import { describe, it, expect } from 'vitest';
import { compileSearchPlan } from '../services/filingResearch';
import { defaultSearchFilters } from '../domain/searchFilters';

/**
 * WP7: the plan compiler is a pure stage, so the retrieval-shaping rules get
 * direct fixtures instead of only surfacing through mocked executor runs.
 */

function plan(overrides: Partial<Parameters<typeof compileSearchPlan>[0]> = {}) {
  return compileSearchPlan({
    query: '',
    filters: { ...defaultSearchFilters },
    mode: 'semantic',
    defaultForms: '',
    limit: 50,
    includeExhibits: false,
    deferTextValidation: false,
    preferFastCandidateCollection: false,
    hydrateTextSignals: false,
    useEnrichedSearch: false,
    ...overrides,
  });
}

describe('compileSearchPlan', () => {
  it('returns null for an invalid Boolean expression — zero retrieval', () => {
    expect(plan({ mode: 'boolean', query: 'revenue AND' })).toBeNull();
    expect(plan({ mode: 'boolean', query: 'impairment OR NOT goodwill' })).toBeNull();
  });

  it('lifts auditor: into the structured filter and searches the residual', () => {
    const result = plan({ mode: 'boolean', query: '"material weakness" AND auditor:KPMG' });
    expect(result).not.toBeNull();
    expect(result!.filters.accountant).toBe('KPMG');
    expect(result!.query).toBe('"material weakness"');
  });

  it('an explicitly chosen auditor filter is never overwritten by the token', () => {
    const result = plan({
      mode: 'boolean',
      query: '"material weakness" AND auditor:KPMG',
      filters: { ...defaultSearchFilters, accountant: 'Deloitte & Touche LLP' },
    });
    expect(result!.filters.accountant).toBe('Deloitte & Touche LLP');
  });

  it('a bare quoted phrase delegates to EDGAR and opens no documents', () => {
    const result = plan({ mode: 'boolean', query: '"climate remediation"', hydrateTextSignals: true });
    expect(result!.delegatedToEfts).toBe(true);
    expect(result!.hydratePerDocumentSignals).toBe(false);
    expect(result!.perQueryResultLimit).toBeGreaterThanOrEqual(500);
  });

  it('an OR expression keeps one retrieval lane per required branch', () => {
    const result = plan({ mode: 'boolean', query: 'impairment OR restatement OR "material weakness"', hydrateTextSignals: true });
    expect(result!.requiredBooleanBranches).toBe(3);
    expect(result!.filteredServerQueries.slice(0, 3)).toEqual(['impairment', 'restatement', '"material weakness"']);
  });

  it('exhibits are admitted as candidates only in Boolean mode', () => {
    expect(plan({ mode: 'boolean', query: 'impairment' })!.excludeExhibits).toBe(false);
    expect(plan({ mode: 'semantic', query: 'impairment' })!.excludeExhibits).toBe(true);
    expect(plan({ mode: 'semantic', query: 'impairment', includeExhibits: true })!.excludeExhibits).toBe(false);
  });

  it('an issuer-scoped browse keeps one empty query lane instead of dying silently', () => {
    const result = plan({ filters: { ...defaultSearchFilters, entityName: 'Organon & Co.' } });
    expect(result!.filteredServerQueries).toEqual(['']);
  });

  it('the display limit is capped at 500 regardless of the requested limit', () => {
    expect(plan({ limit: 5000 })!.displayLimit).toBe(500);
    expect(plan({ limit: 0 })!.displayLimit).toBe(1);
  });
});
