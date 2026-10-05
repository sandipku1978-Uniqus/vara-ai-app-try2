/**
 * Find-in-document and "all hits" logic for the filing viewer and the
 * search result rows (gap analysis 2026-10-04, row 7).
 *
 * Two different questions, kept apart on purpose:
 *
 * - FIND (the find bar): plain text the researcher types, matched
 *   case-insensitively against the document as displayed — like a browser's
 *   find, with an optional whole-word rule. No Boolean semantics.
 * - HITS (the incoming search query): every place the Boolean engine itself
 *   says the query matched — phrases as phrases, `W/n` as qualifying pairs —
 *   located through the engine's own tokenization so the list cannot drift
 *   from what validation accepted.
 *
 * Everything here is pure: text in, offsets out. The DOM side (walking the
 * sanitized document, wrapping marks, scrolling) lives in
 * services/documentFindDom.ts.
 */

import {
  findBooleanHitSpans,
  normalizeForMatch,
  tokenizeForMatchWithOffsets,
  type BooleanHitSpan,
} from './booleanSearch';
import { deriveSectionPath } from './sectionPath';

/** A half-open `[start, end)` range of code units in some text. */
export interface TextRange {
  start: number;
  end: number;
}

// ── Find bar ────────────────────────────────────────────────────────────────

export interface FindOptions {
  /** Only match where the query is not part of a longer word. */
  wholeWord: boolean;
}

/** Highlighting more than this many matches stops helping and starts costing. */
export const MAX_FIND_MATCHES = 2000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The find pattern for a typed query, or null for an empty one.
 *
 * Case-insensitive. Any run of whitespace in the query matches any run of
 * whitespace in the document (filings break lines and use non-breaking
 * spaces freely), and straight and curly quotes match each other — EDGAR
 * HTML writes "Management’s" far more often than anyone types it.
 */
export function buildFindPattern(query: string, options: FindOptions): RegExp | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const body = words
    .map(word =>
      escapeRegExp(word)
        .replace(/['’‘]/g, "['’‘]")
        .replace(/["“”]/g, '["“”]')
    )
    .join('\\s+');
  const source = options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`
    : body;
  return new RegExp(source, 'giu');
}

/** Every find match in document order, capped at `limit`. */
export function findTextMatches(
  text: string,
  query: string,
  options: FindOptions,
  limit = MAX_FIND_MATCHES
): { ranges: TextRange[]; truncated: boolean } {
  const pattern = buildFindPattern(query, options);
  if (!pattern || !text) return { ranges: [], truncated: false };
  const ranges: TextRange[] = [];
  for (let hit = pattern.exec(text); hit; hit = pattern.exec(text)) {
    if (hit[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (ranges.length >= limit) return { ranges, truncated: true };
    ranges.push({ start: hit.index, end: hit.index + hit[0].length });
  }
  return { ranges, truncated: false };
}

/** Next / previous match index, wrapping at either end; -1 when none. */
export function stepMatchIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0 || current >= total) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

/** "3 of 41", "3 of 2000+" when capped, or "No matches". */
export function formatMatchCount(activeIndex: number, total: number, truncated = false): string {
  if (total <= 0) return 'No matches';
  const position = activeIndex >= 0 && activeIndex < total ? activeIndex + 1 : 0;
  return `${position} of ${total}${truncated ? '+' : ''}`;
}

export interface FindShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Cmd+F on macOS, Ctrl+F elsewhere (either is accepted everywhere). */
export function isFindShortcut(event: FindShortcutEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f';
}

// ── Incoming-query hits ─────────────────────────────────────────────────────

export type HitQueryMode = 'boolean' | 'semantic';

/**
 * The Boolean expression whose hits are listed. Boolean mode uses the query
 * exactly as the engine validated it. Keyword ("semantic") mode has no
 * expression of its own; its hits are the occurrences of its search terms —
 * the same terms its snippet and highlighting use — each as a phrase.
 */
export function buildHitQuery(query: string, mode: HitQueryMode, terms: string[]): string {
  if (mode === 'boolean') return query.trim();
  const phrases = Array.from(
    new Set(
      terms
        .map(term => term.replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(term => normalizeForMatch(term).length > 0)
    )
  );
  return phrases.map(term => `"${term}"`).join(' OR ');
}

/** Start offset of every token inside `tokens.join(' ')`. */
function joinedTokenStarts(tokens: string[]): number[] {
  const starts: number[] = new Array(tokens.length);
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    starts[index] = cursor;
    cursor += tokens[index].length + 1;
  }
  return starts;
}

function toJoinedRange(span: BooleanHitSpan, tokens: string[], joinedStarts: number[]): TextRange {
  return { start: joinedStarts[span.start], end: joinedStarts[span.end] + tokens[span.end].length };
}

/**
 * Section breadcrumbs ("Item 9A · Controls and Procedures") for hits in
 * engine-normalized text, using the same deriver as the result-row
 * breadcrumb, in one linear pass.
 *
 * `spans` must be CONSECUTIVE hits of one query, sorted and non-overlapping.
 * Each hit is resolved against a window that starts where the previous hit's
 * resolution stopped: a heading inside the window names the section; no
 * heading means the hit sits in the same section as the previous one.
 * Because no other occurrence of the hit's text lies inside its window, a
 * phrase that repeats through the filing is placed where THIS occurrence is —
 * deriveSectionPath over the whole text would find the first occurrence
 * every time, and would re-normalize a 10-K once per hit.
 */
export function sectionPathsForSpans(normalizedText: string, spans: TextRange[]): string[] {
  const paths: string[] = [];
  let previousPath = '';
  let windowStart = 0;
  for (const span of spans) {
    const start = Math.max(span.start, windowStart);
    const core = normalizedText.slice(start, span.end);
    // A bounded tail so the deriver can read a heading's title words when
    // the heading sits right before the hit.
    const window = normalizedText.slice(windowStart, Math.min(normalizedText.length, span.end + 200));
    const path = core ? deriveSectionPath(window, core) : '';
    if (path) previousPath = path;
    paths.push(previousPath);

    // deriveSectionPath scans up to the hit's midpoint; the next window picks
    // up from there, snapped forward to a token boundary.
    const midpoint = span.start + Math.floor((span.end - span.start) / 2);
    const boundary = normalizedText.indexOf(' ', midpoint);
    windowStart = boundary < 0 ? normalizedText.length : Math.min(boundary + 1, span.end);
  }
  return paths;
}

function buildTokenExcerpt(tokens: string[], span: BooleanHitSpan, contextWords = 14): { excerpt: string; range: BooleanHitSpan } {
  const start = Math.max(0, span.start - contextWords);
  const end = Math.min(tokens.length - 1, span.end + contextWords);
  const body = tokens.slice(start, end + 1).join(' ').trim();
  return {
    excerpt: `${start > 0 ? '... ' : ''}${body}${end < tokens.length - 1 ? ' ...' : ''}`,
    range: { start, end },
  };
}

export interface HitSnippet {
  excerpt: string;
  /** Section breadcrumb, or '' when no heading precedes the passage. */
  sectionPath: string;
}

export interface DocumentHitSummary {
  /** Distinct hits of the query in the text that was read. */
  hitCount: number;
  /** Lead passage first, then further non-overlapping passages in document order. */
  snippets: HitSnippet[];
}

/** How many passages a result row carries. */
export const MAX_RESULT_SNIPPETS = 3;

/**
 * Hit count and up to `maxSnippets` distinct passages for one document,
 * computed from the text the validation stage already read — never a second
 * fetch. The lead passage (the snippet validation chose) stays first; extra
 * passages are later hits whose context does not overlap any passage already
 * chosen, so three snippets are three different places in the filing.
 *
 * Returns null when the query has no hits in the text (or cannot be parsed),
 * so callers never present a count the engine did not produce.
 */
export function summarizeDocumentHits(
  text: string,
  hitQuery: string,
  options: { lead?: HitSnippet; maxSnippets?: number } = {}
): DocumentHitSummary | null {
  if (!text || !hitQuery.trim()) return null;
  const tokens = normalizeForMatch(text).split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const spans = findBooleanHitSpans(hitQuery, tokens);
  if (!spans || spans.length === 0) return null;

  const maxSnippets = Math.max(1, options.maxSnippets ?? MAX_RESULT_SNIPPETS);
  const joined = tokens.join(' ');
  const joinedStarts = joinedTokenStarts(tokens);

  const occupied: TextRange[] = [];
  const lead = options.lead?.excerpt.trim() ? options.lead : undefined;
  if (lead) {
    const core = normalizeForMatch(lead.excerpt.replace(/\.\.\./g, ' '));
    const offset = core ? joined.indexOf(core) : -1;
    if (offset >= 0) occupied.push({ start: offset, end: offset + core.length });
  }

  const chosen: Array<{ spanIndex: number; excerpt: string }> = [];
  const budget = maxSnippets - (lead ? 1 : 0);
  for (let spanIndex = 0; spanIndex < spans.length && chosen.length < budget; spanIndex += 1) {
    const { excerpt, range } = buildTokenExcerpt(tokens, spans[spanIndex]);
    const context = toJoinedRange(range, tokens, joinedStarts);
    if (occupied.some(taken => context.start < taken.end && taken.start < context.end)) continue;
    occupied.push(context);
    chosen.push({ spanIndex, excerpt });
  }
  if (chosen.length === 0) {
    return { hitCount: spans.length, snippets: lead ? [{ excerpt: lead.excerpt, sectionPath: lead.sectionPath || '' }] : [] };
  }

  // Breadcrumbs are resolved over every hit up to the last chosen one, not
  // just the chosen ones: the linear pass needs consecutive hits to place a
  // repeated phrase (see sectionPathsForSpans).
  const lastChosen = chosen[chosen.length - 1].spanIndex;
  const paths = sectionPathsForSpans(
    joined,
    spans.slice(0, lastChosen + 1).map(span => toJoinedRange(span, tokens, joinedStarts))
  );
  const extras = chosen.map(({ spanIndex, excerpt }) => ({ excerpt, sectionPath: paths[spanIndex] || '' }));
  return {
    hitCount: spans.length,
    snippets: lead ? [{ excerpt: lead.excerpt, sectionPath: lead.sectionPath || '' }, ...extras] : extras,
  };
}

export interface DocumentQueryHit extends TextRange {
  /** Display text around the hit, from the document as rendered. */
  before: string;
  match: string;
  after: string;
  sectionPath: string;
}

export type QueryHitStatus = 'ok' | 'no-match' | 'invalid-query';

export interface DocumentQueryHits {
  status: QueryHitStatus;
  /** Every hit in the text; `hits` may hold fewer when capped. */
  total: number;
  hits: DocumentQueryHit[];
}

/** The side list stops listing (but keeps counting) past this many hits. */
export const MAX_LISTED_HITS = 500;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ');
}

/**
 * Every hit of the incoming query in a document's displayed text, with
 * offsets into that text (for scrolling to it), a readable excerpt, and the
 * section breadcrumb it sits in.
 */
export function locateQueryHits(
  text: string,
  hitQuery: string,
  options: { limit?: number; contextChars?: number } = {}
): DocumentQueryHits {
  if (!hitQuery.trim()) return { status: 'invalid-query', total: 0, hits: [] };
  const { tokens, starts, ends } = tokenizeForMatchWithOffsets(text);
  const spans = findBooleanHitSpans(hitQuery, tokens);
  if (spans === null) return { status: 'invalid-query', total: 0, hits: [] };
  if (spans.length === 0) return { status: 'no-match', total: 0, hits: [] };

  const limit = Math.max(0, options.limit ?? MAX_LISTED_HITS);
  const contextChars = options.contextChars ?? 90;
  const listed = spans.slice(0, limit);
  const joined = tokens.join(' ');
  const joinedStarts = joinedTokenStarts(tokens);
  const paths = sectionPathsForSpans(joined, listed.map(span => toJoinedRange(span, tokens, joinedStarts)));

  const hits = listed.map((span, index) => {
    const start = starts[span.start];
    const end = ends[span.end];
    const beforeStart = Math.max(0, start - contextChars);
    const afterEnd = Math.min(text.length, end + contextChars);
    return {
      start,
      end,
      before: `${beforeStart > 0 ? '…' : ''}${collapse(text.slice(beforeStart, start)).trimStart()}`,
      match: collapse(text.slice(start, end)),
      after: `${collapse(text.slice(end, afterEnd)).trimEnd()}${afterEnd < text.length ? '…' : ''}`,
      sectionPath: paths[index] || '',
    };
  });
  return { status: 'ok', total: spans.length, hits };
}
