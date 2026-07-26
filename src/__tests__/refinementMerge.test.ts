import { describe, it, expect } from 'vitest';
import { mergeVerifiedResultWindows, type FilingResearchResult } from '../services/filingResearch';

/**
 * Regression: a Boolean deep-refinement pass that timed out with 0 verified
 * rows replaced the initial pass's 9 visible verified filings with an empty
 * set. Both windows are verified for the same query, so the settled view must
 * be their union, never the smaller window alone.
 */

function row(accession: string, id = accession): FilingResearchResult {
  return { accessionNumber: accession, id } as FilingResearchResult;
}

describe('mergeVerifiedResultWindows', () => {
  it('keeps the baseline when the refinement verified nothing (the observed bug)', () => {
    const baseline = Array.from({ length: 9 }, (_, i) => row(`acc-${i}`));
    expect(mergeVerifiedResultWindows([], baseline, 500)).toHaveLength(9);
  });

  it('unions the two windows, refined rows first', () => {
    const merged = mergeVerifiedResultWindows(
      [row('r-1'), row('shared')],
      [row('shared'), row('b-1')],
      500
    );
    expect(merged.map(r => r.accessionNumber)).toEqual(['r-1', 'shared', 'b-1']);
  });

  it('dedupes by accession even when the matched document differs', () => {
    // The initial pass can surface a filing via EX-99.1 while the refinement
    // surfaces the same accession via the primary document.
    const merged = mergeVerifiedResultWindows(
      [row('0001-24-0001', '0001-24-0001:primary.htm')],
      [row('0001-24-0001', '0001-24-0001:ex991.htm')],
      500
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toContain('primary.htm'); // refined row wins
  });

  it('respects the display limit', () => {
    const refined = Array.from({ length: 3 }, (_, i) => row(`r-${i}`));
    const baseline = Array.from({ length: 5 }, (_, i) => row(`b-${i}`));
    expect(mergeVerifiedResultWindows(refined, baseline, 4)).toHaveLength(4);
  });

  it('falls back to id when accession is empty', () => {
    const merged = mergeVerifiedResultWindows(
      [row('', 'id-1')],
      [row('', 'id-1'), row('', 'id-2')],
      500
    );
    expect(merged.map(r => r.id)).toEqual(['id-1', 'id-2']);
  });
});
