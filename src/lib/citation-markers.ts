/**
 * `[n]` citation markers in a grounded model reply.
 *
 * The grounded Ask AI prompt tells the model to end every claim with the
 * number of the knowledge base excerpt it came from. These helpers read those
 * markers back so the UI can (a) link each marker to the excerpt it names and
 * (b) flag the two integrity failures a reader cannot see for themselves: a
 * reply with no citations at all, and markers that point at excerpts that were
 * never provided.
 */

export interface CitationParseResult {
  /** Marker numbers that resolve to a provided excerpt, ascending, unique. */
  cited: number[];
  /** Marker numbers that resolve to nothing, ascending, unique. */
  unresolved: number[];
  /** Whether the text contains any `[n]` marker at all. */
  hasMarkers: boolean;
}

// `[1]`, `[1, 3]`, `[1,3]`; consecutive groups such as `[1][2]` are two matches.
const MARKER_PATTERN = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

function markerNumbers(group: string): number[] {
  return group.split(',').map(value => Number(value.trim()));
}

function isResolvable(n: number, excerptCount: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= excerptCount;
}

export function parseCitationMarkers(text: string, excerptCount: number): CitationParseResult {
  const cited = new Set<number>();
  const unresolved = new Set<number>();
  let hasMarkers = false;
  for (const match of text.matchAll(MARKER_PATTERN)) {
    hasMarkers = true;
    for (const n of markerNumbers(match[1])) {
      (isResolvable(n, excerptCount) ? cited : unresolved).add(n);
    }
  }
  const ascending = (a: number, b: number) => a - b;
  return {
    cited: [...cited].sort(ascending),
    unresolved: [...unresolved].sort(ascending),
    hasMarkers,
  };
}

/**
 * Replace resolvable `[n]` markers in already-rendered HTML with in-page links
 * to `#<anchorPrefix>-n`. Unresolvable numbers are kept visible but marked so
 * the reader can see the model cited something it was not given. With no
 * excerpts (a model-recall reply) the HTML is returned untouched: there is
 * nothing for a marker to resolve to.
 */
export function linkifyCitationMarkers(html: string, excerptCount: number, anchorPrefix = 'asc-excerpt'): string {
  if (excerptCount <= 0) return html;
  return html.replace(MARKER_PATTERN, (_match, group: string) => {
    const parts = markerNumbers(group).map(n => (
      isResolvable(n, excerptCount)
        ? `<a href="#${anchorPrefix}-${n}" class="ai-citation-link">[${n}]</a>`
        : `<span class="ai-citation-unresolved" title="No excerpt ${n} was provided to the model">[${n}]</span>`
    ));
    return `<sup class="ai-citation">${parts.join('')}</sup>`;
  });
}
