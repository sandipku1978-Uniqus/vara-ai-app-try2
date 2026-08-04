import { describe, expect, it } from 'vitest';

import {
  buildFallbackEvidence,
  createInitialRuntimeState,
  dedupeCitations,
  deriveCompanyHintFromTitle,
  filingRouteFromResult,
  normalizeSearchFilters,
  routeForSurface,
} from '../components/AIQnAPanel.helpers';
import { defaultSearchFilters } from '../domain/searchFilters';
import type { AgentCitation, AgentRun } from '../types/agent';

describe('AIQnAPanel helpers', () => {
  it('maps copilot surfaces and filing results to internal routes', () => {
    expect(routeForSurface('search')).toBe('/search');
    expect(routeForSurface('accounting')).toBe('/accounting');
    expect(routeForSurface('comment-letters')).toBe('/comment-letters');
    expect(filingRouteFromResult({
      cik: '320193',
      accessionNumber: '0000320193-25-000079',
      primaryDocument: 'aapl-20250927.htm',
    } as never)).toBe('/filing/320193_0000320193-25-000079_aapl-20250927.htm');
  });

  it('normalizes malformed collection filters without dropping valid scalar filters', () => {
    expect(normalizeSearchFilters({
      entityName: 'Apple Inc.',
      formTypes: '10-K',
      exchange: null,
      acceleratedStatus: ['LAF'],
    })).toEqual({
      ...defaultSearchFilters,
      entityName: 'Apple Inc.',
      acceleratedStatus: ['LAF'],
    });
    expect(normalizeSearchFilters(null)).toEqual(defaultSearchFilters);
  });

  it('deduplicates identical citations while retaining distinct evidence targets', () => {
    const base: AgentCitation = {
      id: 'first',
      kind: 'filing',
      title: 'Apple 10-K',
      route: '/filing/apple',
      sectionLabel: 'Item 1A',
    };
    const citations = dedupeCitations([
      base,
      { ...base, id: 'duplicate' },
      { ...base, id: 'different-section', sectionLabel: 'Item 7' },
    ]);

    expect(citations.map(citation => citation.id)).toEqual(['first', 'different-section']);
  });

  it('derives company hints from planner titles and starts each runtime independently', () => {
    expect(deriveCompanyHintFromTitle('Resolve Apple Inc.')).toBe('Apple Inc.');
    expect(deriveCompanyHintFromTitle('Find latest 10-K for Microsoft')).toBe('Microsoft');
    expect(deriveCompanyHintFromTitle('Search filings')).toBe('');

    const first = createInitialRuntimeState();
    const second = createInitialRuntimeState();
    first.findings.push('first run');
    first.searchFilters.formTypes.push('10-K');
    expect(second.findings).toEqual([]);
    expect(second.searchFilters.formTypes).toEqual([]);
  });

  it('keeps structured evidence and supplies a stable fallback for legacy runs', () => {
    const run: AgentRun = {
      id: 'run-1',
      prompt: 'Summarize Apple',
      status: 'completed',
      startedAt: '2026-08-03T00:00:00.000Z',
      answer: 'Completed answer',
      actionLog: [],
      evidence: null,
    };

    expect(buildFallbackEvidence(run)).toEqual(expect.objectContaining({
      title: 'Copilot Result',
      summary: 'Completed answer',
      citations: [],
    }));
    expect(buildFallbackEvidence(null)).toBeNull();
  });
});
