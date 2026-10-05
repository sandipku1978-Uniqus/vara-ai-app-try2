/**
 * Map engine-normalized text back to the filing's own words.
 *
 * Search, the section slicers and the YoY diff all work on normalizeForMatch
 * output — lowercase tokens joined by single spaces — because matching and
 * change measurement must not care about case or punctuation. A reader, a
 * memo citation and a Word export do care: "Item 1A. Risk Factors" must come
 * out as the filing wrote it, not as "item 1a risk factors".
 *
 * This tokenizer reproduces normalizeForMatch token for token while keeping
 * each token's offsets in the ORIGINAL string, so a normalized slice (a token
 * range) maps back to an exact span of the filing text. It verifies itself:
 * if its tokens ever disagree with normalizeForMatch (the engine's
 * tokenization changed), it returns null and callers fall back to the
 * normalized slice rather than quoting the wrong span.
 */

import { normalizeForMatch } from './booleanSearch';

// Must stay identical to booleanSearch's MATCH_TOKEN_RE and the two
// rewrites in normalizeMatchText; the self-check below enforces it.
const TOKEN_RE = /[$£¥€]\d+(?:\.\d+)?%?|(?<![a-z0-9])\d+(?:\.\d+)?%?(?![a-z0-9])|[a-z0-9]+/g;

export interface TokenOffsets {
  /** normalizeForMatch(text). */
  normalized: string;
  /** Per token: [start, end) in the original text. */
  starts: Int32Array;
  ends: Int32Array;
}

export function normalizedTokenOffsets(text: string): TokenOffsets | null {
  // 1. Lowercase. Almost always length-preserving; when a character changes
  //    length, keep a per-char map back to the source index.
  let lowered = text.toLowerCase();
  let loweredOrigin: Int32Array | null = null;
  if (lowered.length !== text.length) {
    const chars: string[] = [];
    const origin: number[] = [];
    for (let index = 0; index < text.length; index += 1) {
      for (const char of text[index].toLowerCase()) {
        chars.push(char);
        origin.push(index);
      }
    }
    lowered = chars.join('');
    loweredOrigin = Int32Array.from(origin);
  }

  // 2. The engine's two rewrites, as deletions so offsets survive: "u.s." →
  //    "us", "1,234" → "1234". Deleting a dot after a letter can never create
  //    a new digit-comma-digit run, so both sets come from the same string.
  const drops: number[] = [];
  for (const match of lowered.matchAll(/\b([a-z])\./g)) drops.push((match.index ?? 0) + 1);
  for (const match of lowered.matchAll(/(\d),(?=\d)/g)) drops.push((match.index ?? 0) + 1);
  drops.sort((a, b) => a - b);

  const keptOrigin = new Int32Array(lowered.length - drops.length);
  const pieces: string[] = [];
  let cursor = 0;
  let written = 0;
  for (const drop of [...drops, lowered.length]) {
    pieces.push(lowered.slice(cursor, drop));
    for (let index = cursor; index < drop; index += 1) {
      keptOrigin[written] = loweredOrigin ? loweredOrigin[index] : index;
      written += 1;
    }
    cursor = drop + 1;
  }
  const working = pieces.join('');

  // 3. Tokens, with their original spans.
  const starts: number[] = [];
  const ends: number[] = [];
  const tokens: string[] = [];
  for (const match of working.matchAll(TOKEN_RE)) {
    const at = match.index ?? 0;
    tokens.push(match[0]);
    starts.push(keptOrigin[at]);
    ends.push(keptOrigin[at + match[0].length - 1] + 1);
  }
  const normalized = tokens.join(' ');
  if (normalized !== normalizeForMatch(text)) return null;
  return { normalized, starts: Int32Array.from(starts), ends: Int32Array.from(ends) };
}

/**
 * The original-text span behind a range of the normalized text. The range
 * must start and end on token boundaries (the slicers' ranges do).
 */
export function originalSpan(offsets: TokenOffsets, start: number, end: number): { start: number; end: number } | null {
  const { normalized } = offsets;
  if (start < 0 || end > normalized.length || end <= start) return null;
  // Token index = spaces before the offset.
  let firstToken = 0;
  for (let index = 0; index < start; index += 1) if (normalized.charCodeAt(index) === 32) firstToken += 1;
  let lastToken = firstToken;
  for (let index = start; index < end; index += 1) if (normalized.charCodeAt(index) === 32) lastToken += 1;
  if (lastToken >= offsets.starts.length) return null;
  return { start: offsets.starts[firstToken], end: offsets.ends[lastToken] };
}

// Sentence and clause punctuation, closing brackets and closing quotes: what
// can end a filing's sentence after its last word ("regions.", "Agreement.”)").
const CLOSING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', '…', ')', ']', '}', '"', '\'', '”', '’', '»', '›']);

/**
 * Extend an original-text span end over the punctuation that immediately
 * follows its last word, so an as-filed slice keeps its final full stop and
 * closing quote. Stops at the first other character (whitespace included),
 * so it never reaches the next line, let alone the next heading.
 */
export function extendOverClosingPunctuation(text: string, end: number): number {
  let cursor = end;
  while (cursor < text.length && CLOSING_PUNCTUATION.has(text[cursor])) cursor += 1;
  return cursor;
}
