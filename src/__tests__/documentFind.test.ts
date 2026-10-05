import { describe, expect, it } from 'vitest';

import {
  findBooleanHitSpans,
  normalizeForMatch,
  tokenizeForMatchWithOffsets,
} from '../utils/booleanSearch';
import {
  buildFindPattern,
  buildHitQuery,
  findTextMatches,
  formatMatchCount,
  isFindShortcut,
  locateQueryHits,
  sectionPathsForSpans,
  stepMatchIndex,
  summarizeDocumentHits,
} from '../utils/documentFind';
import { deriveSectionPath } from '../utils/sectionPath';
import {
  buildDocumentTextMap,
  clearMarks,
  FIND_MATCH_ATTRIBUTE,
  wrapRanges,
} from '../services/documentFindDom';

// Neutral prose that keeps passages far enough apart to be distinct.
const FILLER = Array(2)
  .fill('The board reviewed operating results, staffing levels, supplier contracts, facility plans, and capital allocation priorities for the coming fiscal period in detail.')
  .join(' ');

const TEN_K = [
  'PART I',
  'Item 1. Business',
  'The company designs widgets. Management identified a material weakness in prior years.',
  FILLER,
  'Item 1A. Risk Factors',
  'A material weakness could recur. See Item 9A for remediation.',
  FILLER,
  'Item 7. Management’s Discussion and Analysis',
  'Revenue grew 12% to $1,204.5 million in the U.S. market.',
  FILLER,
  'PART II',
  'Item 9A. Controls and Procedures',
  'Management concluded the previously reported material weaknesses were remediated during the year.',
  FILLER,
  'The material weakness related to revenue cut-off.',
].join('\n');

describe('engine tokenization with offsets', () => {
  const corpus = [
    TEN_K,
    'U.S. GAAP and e.g. non-GAAP measures; 1,234,567 shares at $206.6 (5.2%).',
    'İstanbul ŞİRKETİ — Straße “quoted” ‘single’ 10-K/A 3m 10k 1.5x $5x',
    '',
    '   leading and trailing   ',
  ];

  it('produces exactly the tokens normalizeForMatch produces', () => {
    for (const text of corpus) {
      const { tokens } = tokenizeForMatchWithOffsets(text);
      expect(tokens.join(' ')).toBe(normalizeForMatch(text));
    }
  });

  it('maps every token back to the source text it came from', () => {
    for (const text of corpus) {
      const { tokens, starts, ends } = tokenizeForMatchWithOffsets(text);
      tokens.forEach((token, index) => {
        expect(normalizeForMatch(text.slice(starts[index], ends[index]))).toBe(token);
      });
    }
  });

  it('normalization is idempotent, which the breadcrumb windows rely on', () => {
    for (const text of corpus) {
      const once = normalizeForMatch(text);
      expect(normalizeForMatch(once)).toBe(once);
    }
  });
});

describe('findBooleanHitSpans', () => {
  const tokens = normalizeForMatch(TEN_K).split(' ');
  const textOf = (span: { start: number; end: number }) => tokens.slice(span.start, span.end + 1).join(' ');

  it('lists every phrase occurrence, singular and plural alike', () => {
    const spans = findBooleanHitSpans('"material weakness"', tokens)!;
    expect(spans.map(textOf)).toEqual([
      'material weakness',
      'material weakness',
      'material weaknesses',
      'material weakness',
    ]);
  });

  it('lists every qualifying W/n pair as one hit spanning both operands', () => {
    const spans = findBooleanHitSpans('"material weakness" W/3 remediated', tokens)!;
    expect(spans.map(textOf)).toEqual(['material weaknesses were remediated']);
  });

  it('keeps alternating proximity operands as separate hits instead of one chained span', () => {
    const dense = normalizeForMatch(
      'Revenue rose; the material weakness was noted. Revenue rose; the material weakness was noted. Revenue rose.'
    ).split(' ');
    const spans = findBooleanHitSpans('"material weakness" W/5 revenue', dense)!;
    expect(spans.map(span => dense.slice(span.start, span.end + 1).join(' '))).toEqual([
      'material weakness was noted revenue',
      'material weakness was noted revenue',
    ]);
  });

  it('respects P/n order', () => {
    expect(findBooleanHitSpans('remediated P/3 weaknesses', tokens)).toEqual([]);
  });

  it('contributes no hits from negated branches', () => {
    const spans = findBooleanHitSpans('revenue AND NOT goodwill', tokens)!;
    expect(spans.map(textOf)).toEqual(['revenue', 'revenue']);
  });

  it('returns no hits when the full expression rejects the text, and null when it cannot parse', () => {
    expect(findBooleanHitSpans('revenue AND NOT widgets', tokens)).toEqual([]);
    expect(findBooleanHitSpans('"unbalanced', tokens)).toBeNull();
  });

  it('merges overlapping hits', () => {
    const spans = findBooleanHitSpans('"material weakness" OR weakness', tokens)!;
    expect(spans).toHaveLength(4);
  });
});

describe('find bar matching', () => {
  it('is case-insensitive and treats any whitespace run as a space', () => {
    const { ranges } = findTextMatches('Material\n  Weakness and material weakness', 'material weakness', { wholeWord: false });
    expect(ranges).toEqual([{ start: 0, end: 19 }, { start: 24, end: 41 }]);
  });

  it('matches straight and curly apostrophes interchangeably', () => {
    const { ranges } = findTextMatches('Management’s Discussion', "management's", { wholeWord: false });
    expect(ranges).toHaveLength(1);
  });

  it('honours the whole-word rule', () => {
    const text = 'lease leases leaseback lease-term';
    expect(findTextMatches(text, 'lease', { wholeWord: false }).ranges).toHaveLength(4);
    expect(findTextMatches(text, 'lease', { wholeWord: true }).ranges.map(range => text.slice(range.start, range.end)))
      .toEqual(['lease', 'lease']);
  });

  it('treats regex characters literally and reports truncation', () => {
    expect(findTextMatches('cost (net) $1.5', '(net) $1.5', { wholeWord: false }).ranges).toHaveLength(1);
    expect(findTextMatches('a a a a', 'a', { wholeWord: true }, 2)).toEqual({
      ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
      truncated: true,
    });
    expect(buildFindPattern('   ', { wholeWord: false })).toBeNull();
  });

  it('steps through matches with wrap-around and labels the position', () => {
    expect(stepMatchIndex(-1, 41, 1)).toBe(0);
    expect(stepMatchIndex(-1, 41, -1)).toBe(40);
    expect(stepMatchIndex(40, 41, 1)).toBe(0);
    expect(stepMatchIndex(0, 41, -1)).toBe(40);
    expect(stepMatchIndex(0, 0, 1)).toBe(-1);
    expect(formatMatchCount(2, 41)).toBe('3 of 41');
    expect(formatMatchCount(0, 2000, true)).toBe('1 of 2000+');
    expect(formatMatchCount(-1, 0)).toBe('No matches');
  });

  it('recognises Cmd+F and Ctrl+F only', () => {
    expect(isFindShortcut({ key: 'f', metaKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect(isFindShortcut({ key: 'F', metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(isFindShortcut({ key: 'f', metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(isFindShortcut({ key: 'f', metaKey: true, ctrlKey: false, altKey: true })).toBe(false);
    expect(isFindShortcut({ key: 'g', metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
  });
});

describe('incoming-query hits', () => {
  it('uses the Boolean query as validated, and keyword terms as phrases', () => {
    expect(buildHitQuery(' "going concern" W/5 doubt ', 'boolean', [])).toBe('"going concern" W/5 doubt');
    expect(buildHitQuery('material weakness', 'semantic', ['material weakness', 'material', '"x"', '—']))
      .toBe('"material weakness" OR "material" OR "x"');
  });

  it('locates every hit in the displayed text with excerpt and breadcrumb', () => {
    const located = locateQueryHits(TEN_K, '"material weakness"');
    expect(located.status).toBe('ok');
    expect(located.total).toBe(4);
    expect(located.hits.map(hit => TEN_K.slice(hit.start, hit.end))).toEqual([
      'material weakness',
      'material weakness',
      'material weaknesses',
      'material weakness',
    ]);
    expect(located.hits.map(hit => hit.sectionPath)).toEqual([
      'Item 1 · Business',
      'Item 1A · Risk Factors',
      'Item 9A · Controls and Procedures',
      'Item 9A · Controls and Procedures',
    ]);
    expect(located.hits[2].match).toBe('material weaknesses');
    expect(located.hits[2].before).toMatch(/previously reported $/);
  });

  it('names the section each repeated hit actually sits in', () => {
    const tokens = normalizeForMatch(TEN_K).split(' ');
    const joined = tokens.join(' ');
    const spans = findBooleanHitSpans('revenue OR "material weakness" OR widgets', tokens)!;
    const starts: number[] = [];
    let cursor = 0;
    for (const token of tokens) {
      starts.push(cursor);
      cursor += token.length + 1;
    }
    const ranges = spans.map(span => ({ start: starts[span.start], end: starts[span.end] + tokens[span.end].length }));
    const paths = sectionPathsForSpans(joined, ranges);
    expect(paths).toEqual([
      'Item 1 · Business', // widgets
      'Item 1 · Business', // material weakness
      'Item 1A · Risk Factors', // material weakness (the cross-reference to 9A is not a heading)
      'Item 7 · Management’s Discussion and Analysis', // revenue
      'Item 9A · Controls and Procedures', // material weaknesses
      'Item 9A · Controls and Procedures', // material weakness
      'Item 9A · Controls and Procedures', // revenue
    ]);
    // A first occurrence resolves exactly as the result-row deriver does; the
    // whole-text deriver cannot place REPEATED passages (it finds the first
    // occurrence), which is why the linear pass exists.
    expect(paths[0]).toBe(deriveSectionPath(joined, joined.slice(ranges[0].start, ranges[0].end)));
    expect(paths[3]).toBe(deriveSectionPath(joined, joined.slice(ranges[3].start, ranges[3].end)));
  });

  it('reports no-match and invalid queries distinctly, and caps the listing but not the count', () => {
    expect(locateQueryHits(TEN_K, 'goodwill').status).toBe('no-match');
    expect(locateQueryHits(TEN_K, '"open').status).toBe('invalid-query');
    const capped = locateQueryHits(TEN_K, '"material weakness"', { limit: 1 });
    expect(capped.total).toBe(4);
    expect(capped.hits).toHaveLength(1);
  });
});

describe('result-row passages', () => {
  it('keeps the lead passage first and adds distinct later passages with breadcrumbs', () => {
    const lead = { excerpt: 'identified a material weakness in prior years', sectionPath: 'Item 1 · Business' };
    const summary = summarizeDocumentHits(TEN_K, '"material weakness"', { lead })!;
    expect(summary.hitCount).toBe(4);
    expect(summary.snippets).toHaveLength(3);
    expect(summary.snippets[0]).toEqual(lead);
    expect(summary.snippets.slice(1).map(snippet => snippet.sectionPath)).toEqual([
      'Item 1A · Risk Factors',
      'Item 9A · Controls and Procedures',
    ]);
    // Every passage is a different place in the filing.
    const cores = summary.snippets.map(snippet => normalizeForMatch(snippet.excerpt.replace(/\.\.\./g, ' ')));
    const joined = normalizeForMatch(TEN_K);
    const offsets = cores.map(core => joined.indexOf(core));
    expect(offsets.every(offset => offset >= 0)).toBe(true);
    expect(new Set(offsets).size).toBe(3);
  });

  it('returns nothing when the query has no hits in the text that was read', () => {
    expect(summarizeDocumentHits(TEN_K, 'goodwill')).toBeNull();
    expect(summarizeDocumentHits('', '"material weakness"')).toBeNull();
  });
});

describe('document text map and marks', () => {
  function makeDocument(html: string): Document {
    return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
  }

  it('separates blocks, joins inline splits, and skips hidden content', () => {
    const doc = makeDocument(
      '<table><tr><td>Item 7</td><td>Management<b>’s</b> Discussion</td></tr></table>' +
      '<p>mat<i>erial</i> weak<br>ness</p>' +
      '<div style="display:none">hidden fact</div><script>var x = 1;</script>'
    );
    const map = buildDocumentTextMap(doc);
    expect(map.text).toBe('Item 7 Management’s Discussion material weak ness');
  });

  it('wraps ranges across nodes and clears them back to the original text', () => {
    const doc = makeDocument('<p>A material <b>weak</b>ness here; another material weakness.</p>');
    const original = doc.body.innerHTML;
    const map = buildDocumentTextMap(doc);
    const { ranges } = findTextMatches(map.text, 'material weakness', { wholeWord: true });
    expect(ranges).toHaveLength(2);
    const marks = wrapRanges(doc, map, ranges, FIND_MATCH_ATTRIBUTE, () => undefined);
    expect(marks[0].map(mark => mark.textContent).join('')).toBe('material weakness');
    // One mark per text node the match crosses: "material ", "weak", "ness".
    expect(marks[0].map(mark => mark.textContent)).toEqual(['material ', 'weak', 'ness']);
    expect(marks[1].map(mark => mark.textContent)).toEqual(['material weakness']);
    expect(doc.querySelectorAll(`mark[${FIND_MATCH_ATTRIBUTE}]`)).toHaveLength(4);
    // The incoming-query marks use a different attribute and are untouched.
    expect(doc.querySelectorAll('mark[data-vara-search-hit]')).toHaveLength(0);

    clearMarks(doc, FIND_MATCH_ATTRIBUTE);
    expect(doc.body.innerHTML).toBe(original);
    expect(buildDocumentTextMap(doc).text).toBe(map.text);
  });
});
