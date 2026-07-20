import { describe, expect, it } from 'vitest';
import { buildResearchEmptyResultMessage } from '../services/searchCoverage';

describe('search empty-result trust state', () => {
  it('does not present a partial candidate scan as an authoritative zero', () => {
    expect(buildResearchEmptyResultMessage('', '', {
      examined: 100,
      upstreamTotal: 5_000,
      complete: false,
    })).toContain('not an authoritative zero');
  });

  it('does not let routine no-match session copy mask partial coverage', () => {
    expect(buildResearchEmptyResultMessage(
      'No filings matched that search. Try widening the date range.',
      '',
      { examined: 25, upstreamTotal: 500, complete: false }
    )).toContain('not an authoritative zero');
  });

  it('retains explicit errors and degraded-source context', () => {
    expect(buildResearchEmptyResultMessage('Search failed.', 'fallback', null)).toBe('Search failed.');
    expect(buildResearchEmptyResultMessage('', 'fallback', null)).toContain('source was degraded');
  });
});
