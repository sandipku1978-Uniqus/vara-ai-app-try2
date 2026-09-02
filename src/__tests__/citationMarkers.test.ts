import { describe, expect, it } from 'vitest';
import { linkifyCitationMarkers, parseCitationMarkers } from '../lib/citation-markers';

describe('citation markers in grounded replies', () => {
  it('separates resolvable markers from ones naming excerpts that were never provided', () => {
    const result = parseCitationMarkers(
      'Single model [1]. Classification differs [1][2]. Threshold [2, 7]. Also [0].',
      2,
    );

    expect(result).toEqual({ cited: [1, 2], unresolved: [0, 7], hasMarkers: true });
  });

  it('reports a reply that carries no markers at all', () => {
    expect(parseCitationMarkers('No citations here; a year like [2024] is not a marker.', 3))
      .toEqual({ cited: [], unresolved: [], hasMarkers: false });
  });

  it('treats every marker as unresolved when no excerpt was provided', () => {
    expect(parseCitationMarkers('Recalled claim [1].', 0))
      .toEqual({ cited: [], unresolved: [1], hasMarkers: true });
  });

  it('links resolvable markers in rendered HTML and keeps unresolved ones visible but marked', () => {
    const html = '<p>Single model [1]. See [1, 3] and [9].</p>';

    expect(linkifyCitationMarkers(html, 3)).toBe(
      '<p>Single model <sup class="ai-citation"><a href="#asc-excerpt-1" class="ai-citation-link">[1]</a></sup>. '
      + 'See <sup class="ai-citation"><a href="#asc-excerpt-1" class="ai-citation-link">[1]</a>'
      + '<a href="#asc-excerpt-3" class="ai-citation-link">[3]</a></sup> and '
      + '<sup class="ai-citation"><span class="ai-citation-unresolved" title="No excerpt 9 was provided to the model">[9]</span></sup>.</p>',
    );
  });

  it('leaves a model-recall reply untouched because there is nothing to resolve to', () => {
    const html = '<p>ASC 718-20-35 applies [1].</p>';

    expect(linkifyCitationMarkers(html, 0)).toBe(html);
  });
});
