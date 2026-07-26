import { describe, expect, it } from 'vitest';
import {
  buildResearchEmptyResultMessage,
  buildResultsHeadline,
  formatUpstreamTotal,
} from '../services/searchCoverage';

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

describe('corpus total display', () => {
  it('presents an exact upstream count as exact', () => {
    expect(formatUpstreamTotal({ examined: 50, upstreamTotal: 2_340, complete: false })).toBe('2,340');
  });

  it('never presents an EFTS counting floor as an exact number', () => {
    // EDGAR EFTS stops counting at 10,000 (hits.total.relation === 'gte');
    // "10,000 filings" would be a fabricated exact count.
    expect(
      formatUpstreamTotal({ examined: 500, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true })
    ).toBe('10,000+');
  });

  it('leads with the corpus answer, then the validated window', () => {
    expect(
      buildResultsHeadline(403, { examined: 497, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true }, 500)
    ).toBe('10,000+ filings match — 403 validated and shown');
    expect(
      buildResultsHeadline(50, { examined: 50, upstreamTotal: 2_340, complete: false }, 500)
    ).toBe('2,340 filings match — 50 validated and shown');
  });

  it('falls back to the plain shown count when upstream reported nothing larger', () => {
    expect(buildResultsHeadline(12, { examined: 12, upstreamTotal: 12, complete: true }, 500)).toBe('12 filings');
    expect(buildResultsHeadline(12, null, 500)).toBe('12 filings');
  });

  it('caps the shown label at the display limit', () => {
    expect(
      buildResultsHeadline(500, { examined: 600, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true }, 500)
    ).toBe('10,000+ filings match — 500+ validated and shown');
  });
});
