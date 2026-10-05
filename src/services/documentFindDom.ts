/**
 * DOM side of find-in-document: read the sanitized filing document's text
 * as one string, and wrap / unwrap / scroll to ranges of it.
 *
 * Works on the inert document the viewer already renders (a sandboxed iframe
 * without scripts); nothing here runs inside that document or changes its
 * sandbox — the parent page reads and decorates it, exactly as the existing
 * query highlighting does.
 */

import type { TextRange } from '../utils/documentFind';

export interface DocumentTextMap {
  /** The document's visible text; block boundaries become a single space. */
  text: string;
  nodes: Text[];
  /** offsets[i] is where nodes[i] starts in `text`. */
  offsets: number[];
}

/** Find-bar matches. Distinct from the incoming query's data-vara-search-hit. */
export const FIND_MATCH_ATTRIBUTE = 'data-vara-find-hit';
/** The one incoming-query hit the researcher jumped to from the hit list. */
export const QUERY_FOCUS_ATTRIBUTE = 'data-vara-hit-focus';

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE', 'HEAD', 'TITLE', 'IX:HEADER']);
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CAPTION', 'CENTER', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'HTML', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT',
  'TH', 'THEAD', 'TR', 'UL',
]);

function isHidden(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName.toUpperCase())) return true;
  if (element.hasAttribute('hidden')) return true;
  const style = (element as HTMLElement).style;
  return Boolean(style && style.display === 'none');
}

function blockAncestor(node: Node): Element | null {
  let current = node.parentElement;
  while (current && !BLOCK_TAGS.has(current.tagName.toUpperCase())) current = current.parentElement;
  return current;
}

/**
 * The document's text in reading order. Text in separate blocks (cells,
 * paragraphs, list items) or across a <br> is joined with one space, so a
 * table row "Item 7" | "Management's Discussion" reads as words rather than
 * "Item 7Management's"; text split only by inline markup (<b>mat</b>erial)
 * stays one word. Hidden content (scripts, styles, the inline-XBRL header,
 * display:none) is not part of what a reader can find.
 */
export function buildDocumentTextMap(doc: Document): DocumentTextMap {
  const empty: DocumentTextMap = { text: '', nodes: [], offsets: [] };
  if (!doc.body) return empty;

  const view = doc.defaultView;
  const nodeFilter = view?.NodeFilter ?? NodeFilter;
  const walker = doc.createTreeWalker(doc.body, nodeFilter.SHOW_ELEMENT | nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        const element = node as Element;
        if (isHidden(element)) return nodeFilter.FILTER_REJECT;
        return element.tagName.toUpperCase() === 'BR' ? nodeFilter.FILTER_ACCEPT : nodeFilter.FILTER_SKIP;
      }
      return nodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  const nodes: Text[] = [];
  const offsets: number[] = [];
  let length = 0;
  let previousBlock: Element | null | undefined;
  let pendingBreak = false;

  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.nodeType === 1) {
      pendingBreak = true;
      continue;
    }
    const textNode = current as Text;
    const data = textNode.data;
    if (!data) continue;
    const block = blockAncestor(textNode);
    if (nodes.length > 0 && (pendingBreak || block !== previousBlock)) {
      parts.push(' ');
      length += 1;
    }
    pendingBreak = false;
    previousBlock = block;
    nodes.push(textNode);
    offsets.push(length);
    parts.push(data);
    length += data.length;
  }

  return { text: parts.join(''), nodes, offsets };
}

interface Segment {
  rangeIndex: number;
  nodeIndex: number;
  start: number;
  end: number;
}

function segmentsFor(map: DocumentTextMap, range: TextRange, rangeIndex: number): Segment[] {
  // Last node starting at or before range.start.
  let low = 0;
  let high = map.offsets.length - 1;
  let first = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (map.offsets[mid] <= range.start) {
      first = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const segments: Segment[] = [];
  for (let nodeIndex = first; nodeIndex < map.nodes.length && map.offsets[nodeIndex] < range.end; nodeIndex += 1) {
    const nodeStart = map.offsets[nodeIndex];
    const nodeLength = map.nodes[nodeIndex].data.length;
    const start = Math.max(0, range.start - nodeStart);
    const end = Math.min(nodeLength, range.end - nodeStart);
    if (start < end) segments.push({ rangeIndex, nodeIndex, start, end });
  }
  return segments;
}

/**
 * Wrap each range in <mark attribute> elements (one per text node the range
 * crosses). Returns the marks for each range, in document order. The map
 * must be fresh: build it immediately before calling, since wrapping splits
 * the text nodes it refers to.
 */
export function wrapRanges(
  doc: Document,
  map: DocumentTextMap,
  ranges: TextRange[],
  attribute: string,
  decorate: (mark: HTMLElement, rangeIndex: number) => void
): HTMLElement[][] {
  const segments = ranges.flatMap((range, index) => segmentsFor(map, range, index));
  // Last first: splitting a node keeps the original node as the prefix, so
  // every earlier segment's offsets stay valid.
  segments.sort((a, b) => b.nodeIndex - a.nodeIndex || b.start - a.start);

  const marks: HTMLElement[][] = ranges.map(() => []);
  for (const segment of segments) {
    const node = map.nodes[segment.nodeIndex];
    if (!node.parentNode) continue;
    const target = segment.start > 0 ? node.splitText(segment.start) : node;
    if (segment.end - segment.start < target.data.length) target.splitText(segment.end - segment.start);
    const mark = doc.createElement('mark');
    mark.setAttribute(attribute, 'true');
    decorate(mark, segment.rangeIndex);
    target.parentNode!.replaceChild(mark, target);
    mark.appendChild(target);
    marks[segment.rangeIndex].unshift(mark);
  }
  return marks;
}

/** Remove every mark carrying `attribute`, restoring the original text nodes. */
export function clearMarks(doc: Document | null | undefined, attribute: string): void {
  if (!doc?.body) return;
  const parents = new Set<Node>();
  for (const mark of Array.from(doc.querySelectorAll(`mark[${attribute}]`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parents.add(parent);
  }
  parents.forEach(parent => parent.normalize());
}

/** Scroll the viewer's frame so `element` sits comfortably in view. */
export function scrollFrameToElement(frame: HTMLIFrameElement | null, element: Element | null | undefined): void {
  const frameWindow = frame?.contentWindow;
  const doc = frame?.contentDocument;
  if (!frameWindow || !doc || !element) return;
  const rect = element.getBoundingClientRect();
  const currentOffset = frameWindow.scrollY ?? doc.documentElement.scrollTop ?? 0;
  const viewportHeight = frameWindow.innerHeight || frame.clientHeight || 0;
  const top = Math.max(currentOffset + rect.top - Math.max((viewportHeight - rect.height) / 2, 48), 0);
  frameWindow.scrollTo?.({ top, behavior: 'smooth' });
}

// Visual language: the incoming query is yellow (filingHighlights.ts). Find
// matches are blue, the current one solid orange with an outline so it reads
// as "you are here"; a hit opened from the hit list gets a magenta outline.
export function styleFindMatch(mark: HTMLElement, active: boolean): void {
  mark.style.background = active ? 'rgba(249, 115, 22, 0.9)' : 'rgba(56, 189, 248, 0.38)';
  mark.style.color = '#111827';
  mark.style.borderRadius = '2px';
  mark.style.outline = active ? '2px solid #c2410c' : 'none';
  mark.style.outlineOffset = '1px';
  if (active) mark.setAttribute('data-vara-find-active', 'true');
  else mark.removeAttribute('data-vara-find-active');
}

export function styleQueryFocus(mark: HTMLElement): void {
  mark.style.background = 'rgba(250, 204, 21, 0.55)';
  mark.style.color = '#111827';
  mark.style.outline = '2px solid #b31f7e';
  mark.style.outlineOffset = '1px';
  mark.style.borderRadius = '2px';
}
