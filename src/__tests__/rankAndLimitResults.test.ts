import { describe, it, expect } from 'vitest';
import { rankAndLimitResults, type FilingResearchResult } from '../services/filingResearch';

/**
 * WP7: result finishing is a pure stage, so the roll-up/order/cap rules get
 * direct fixtures instead of only surfacing through full executor runs.
 */

function row(overrides: Partial<FilingResearchResult>): FilingResearchResult {
  return {
    id: 'r1',
    entityName: 'Issuer Co',
    fileDate: '2026-01-01',
    formType: '8-K',
    documentType: '8-K',
    cik: '100',
    accessionNumber: '0000000100-26-000001',
    primaryDocument: 'main.htm',
    filingPrimaryDocument: 'main.htm',
    description: '',
    matchSnippet: '',
    matchReason: '',
    score: 1,
    relevanceScore: 1,
    ...overrides,
  } as FilingResearchResult;
}

describe('rankAndLimitResults', () => {
  it('collapses multi-exhibit matches of one accession into a single row', () => {
    const results = [
      row({ id: 'a', documentType: 'EX-99.1', primaryDocument: 'ex991.htm' }),
      row({ id: 'b', documentType: 'EX-99.2', primaryDocument: 'ex992.htm' }),
      row({ id: 'c', cik: '200', accessionNumber: '0000000200-26-000001' }),
    ];
    const finished = rankAndLimitResults(results, { rollUpExhibits: true, preferRelevance: false, displayLimit: 50 });
    expect(finished).toHaveLength(2);
    const collapsed = finished.find(entry => entry.cik === '100');
    expect(collapsed?.matchedDocumentCount).toBe(2);
  });

  it('prefers the parent document as the representative over an exhibit', () => {
    const results = [
      row({ id: 'ex', documentType: 'EX-10.1', primaryDocument: 'ex101.htm' }),
      row({ id: 'parent', documentType: '8-K', primaryDocument: 'main.htm' }),
    ];
    const finished = rankAndLimitResults(results, { rollUpExhibits: true, preferRelevance: false, displayLimit: 50 });
    expect(finished).toHaveLength(1);
    expect(finished[0].documentType).toBe('8-K');
  });

  it('leaves rows untouched when roll-up is off (Exhibit Search opts in to per-document rows)', () => {
    const results = [
      row({ id: 'a', documentType: 'EX-99.1', primaryDocument: 'ex991.htm' }),
      row({ id: 'b', documentType: 'EX-99.2', primaryDocument: 'ex992.htm' }),
    ];
    const finished = rankAndLimitResults(results, { rollUpExhibits: false, preferRelevance: false, displayLimit: 50 });
    expect(finished).toHaveLength(2);
  });

  it('date order rules when relevance is not preferred; relevance rules when it is', () => {
    const results = [
      row({ id: 'older-strong', fileDate: '2024-01-01', relevanceScore: 90, score: 90 }),
      row({ id: 'newer-weak', cik: '300', accessionNumber: '0000000300-26-000001', fileDate: '2026-01-01', relevanceScore: 5, score: 5 }),
    ];
    const byDate = rankAndLimitResults(results, { rollUpExhibits: false, preferRelevance: false, displayLimit: 50 });
    expect(byDate[0].id).toBe('newer-weak');
    const byRelevance = rankAndLimitResults(results, { rollUpExhibits: false, preferRelevance: true, displayLimit: 50 });
    expect(byRelevance[0].id).toBe('older-strong');
  });

  it('caps at the display limit and never returns a negative slice', () => {
    const results = Array.from({ length: 10 }, (_, index) =>
      row({ id: `r${index}`, cik: String(400 + index), accessionNumber: `00000004${index}0-26-000001` })
    );
    expect(rankAndLimitResults(results, { rollUpExhibits: false, preferRelevance: false, displayLimit: 3 })).toHaveLength(3);
    expect(rankAndLimitResults(results, { rollUpExhibits: false, preferRelevance: false, displayLimit: -5 })).toHaveLength(0);
  });
});
