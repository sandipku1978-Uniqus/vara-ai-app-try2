import { describe, expect, it } from 'vitest';
import {
  buildResearchEmptyResultMessage,
  buildResultsHeadline,
  formatUpstreamTotal,
  mergeCandidateCoverage,
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

  it('labels unverified retrieval totals as candidate populations, not matches', () => {
    expect(
      buildResultsHeadline(403, { examined: 497, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true }, 500)
    ).toBe('10,000+ upstream candidates — 403 validated matches shown');
    expect(
      buildResultsHeadline(50, { examined: 50, upstreamTotal: 2_340, complete: false }, 500)
    ).toBe('2,340 upstream candidates — 50 validated matches shown');
  });

  it('uses match wording only when an exact/delegated match total is present', () => {
    expect(buildResultsHeadline(50, {
      examined: 80,
      upstreamTotal: 2_340,
      complete: false,
      verifiedMatchTotal: 1_240,
      verifiedMatchTotalIsFloor: false,
    }, 500)).toBe('1,240 filings match — 50 validated and shown');
  });

  it('falls back to the plain shown count when upstream reported nothing larger', () => {
    expect(buildResultsHeadline(12, { examined: 12, upstreamTotal: 12, complete: true }, 500)).toBe('12 filings');
    expect(buildResultsHeadline(12, null, 500)).toBe('12 filings');
  });

  it('merges coverage widest-wins, complete only when both, floor when either', () => {
    const merged = mergeCandidateCoverage(
      { examined: 100, upstreamTotal: 500, complete: true },
      { examined: 40, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true }
    );
    expect(merged).toEqual({ examined: 100, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true });
    expect(mergeCandidateCoverage(null, merged)).toEqual(merged);
  });

  it('caps the shown label at the display limit', () => {
    expect(
      buildResultsHeadline(500, { examined: 600, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true }, 500)
    ).toBe('10,000+ upstream candidates — 500+ validated matches shown');
  });
});

describe('ledger preservation through merges (audit R1)', () => {
  const branch = (over: Record<string, unknown> = {}) => ({
    branch: 'alpha', required: true, pages: 1, candidatesSurfaced: 5,
    candidatesNew: 5, examined: 5, matched: 3, exhausted: true, ...over,
  });

  it('keeps branches and work from whichever side carries them', () => {
    const withLedger = {
      examined: 10, upstreamTotal: 100, complete: false,
      branches: [branch(), branch({ branch: 'beta', exhausted: false, incompleteReason: 'doc-budget' })],
      work: { pageRequests: 4, docFetches: 10, docHttpAttempts: 12, prescreenRequests: 1, totalUpstreamRequests: 17, ceiling: { pages: 60, docHttpAttempts: 180, prescreenRequests: 24 } },
    };
    // Page-accumulator event with no ledgers arrives AFTER the final report —
    // the merge must not flatten the story away.
    const merged = mergeCandidateCoverage(withLedger, { examined: 11, upstreamTotal: 100, complete: false });
    expect(merged.branches).toHaveLength(2);
    expect(merged.branches?.[1].incompleteReason).toBe('doc-budget');
    expect(merged.work?.totalUpstreamRequests).toBe(17);
    // And in the other order, incoming ledgers win.
    const merged2 = mergeCandidateCoverage({ examined: 3, upstreamTotal: 50, complete: true }, withLedger);
    expect(merged2.branches).toHaveLength(2);
  });
});
