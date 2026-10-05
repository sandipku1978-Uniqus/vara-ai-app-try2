/**
 * Year-over-year section change measurement (benchmark C2 + C3).
 *
 * Given the same section from two periods of the same filer, measure how much
 * changed and classify it into the buckets a reviewer triages by. The
 * classification is DETERMINISTIC — token-level change ratio, plus
 * appeared/vanished — because an explainable bucket ("38% of Risk Factors
 * changed") is auditable in a way a model's opinion is not. A model can rank
 * within buckets later; it must not define them.
 *
 * Token diffing uses diff-match-patch in word mode (each token mapped to one
 * character before diffing), so a 10,000-word section diffs in linear-ish
 * time instead of character-level O(n²) blowup.
 */

import { diff_match_patch } from 'diff-match-patch';
import { normalizeForMatch } from './booleanSearch';

export type ChangeBucket = 'new' | 'deleted' | 'major' | 'moderate' | 'minor' | 'unchanged';

export interface SectionChange {
  bucket: ChangeBucket;
  /** Tokens present only in the current period. */
  addedTokens: number;
  /** Tokens present only in the prior period. */
  removedTokens: number;
  priorTokens: number;
  currentTokens: number;
  /**
   * (added + removed) / (prior + current), capped at 1 — symmetric churn.
   * Replacing k% of a section's tokens scores k%; a complete rewrite scores
   * 100%, never more.
   */
  changedRatio: number;
  /**
   * How many distinct places the section changed — contiguous runs of
   * added/removed tokens, with changes separated by fewer than
   * PASSAGE_GAP_TOKENS unchanged tokens counted as one passage. The honest
   * form of "count of changed subsections": derived from the diff itself,
   * with no pretence of knowing the filer's subsection names.
   */
  changedPassages: number;
}

/** Bucket thresholds on the changed ratio. Deliberately plain numbers. */
const MAJOR_THRESHOLD = 0.25;
const MODERATE_THRESHOLD = 0.10;
const MINOR_THRESHOLD = 0.02;
/** Unchanged tokens between two edits before they count as separate passages. */
const PASSAGE_GAP_TOKENS = 30;

function tokensOf(text: string): string[] {
  const normalized = normalizeForMatch(text || '');
  return normalized ? normalized.split(' ') : [];
}

export function computeSectionChange(priorText: string, currentText: string): SectionChange {
  const prior = tokensOf(priorText);
  const current = tokensOf(currentText);

  if (prior.length === 0 && current.length === 0) {
    return { bucket: 'unchanged', addedTokens: 0, removedTokens: 0, priorTokens: 0, currentTokens: 0, changedRatio: 0, changedPassages: 0 };
  }
  if (prior.length === 0) {
    return { bucket: 'new', addedTokens: current.length, removedTokens: 0, priorTokens: 0, currentTokens: current.length, changedRatio: 1, changedPassages: 1 };
  }
  if (current.length === 0) {
    return { bucket: 'deleted', addedTokens: 0, removedTokens: prior.length, priorTokens: prior.length, currentTokens: 0, changedRatio: 1, changedPassages: 1 };
  }

  // Word-mode diff: join tokens with newlines and let dmp's lines-to-chars
  // encoding treat each token as one character. The default 1-second diff
  // timeout degrades long comparisons into a coarse everything-changed
  // verdict — observed live as a stable section scoring far above 100% —
  // so give the word-encoded diff (already ~50x smaller than characters)
  // room to finish exactly.
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 10;
  const encoded = dmp.diff_linesToChars_(prior.join('\n') + '\n', current.join('\n') + '\n');
  const diffs = dmp.diff_main(encoded.chars1, encoded.chars2, false);

  let added = 0;
  let removed = 0;
  let changedPassages = 0;
  let inPassage = false;
  for (const [operation, chunk] of diffs) {
    if (operation === 0) {
      // A long-enough run of unchanged tokens closes the current passage;
      // a short gap keeps adjacent edits counted as one place.
      if (chunk.length >= PASSAGE_GAP_TOKENS) inPassage = false;
      continue;
    }
    if (operation === 1) added += chunk.length;
    else removed += chunk.length;
    if (!inPassage) {
      changedPassages += 1;
      inPassage = true;
    }
  }

  const changedRatio = Math.min(1, (added + removed) / (prior.length + current.length));
  const bucket: ChangeBucket =
    changedRatio >= MAJOR_THRESHOLD ? 'major'
    : changedRatio >= MODERATE_THRESHOLD ? 'moderate'
    : changedRatio > MINOR_THRESHOLD ? 'minor'
    : 'unchanged';

  return {
    bucket,
    addedTokens: added,
    removedTokens: removed,
    priorTokens: prior.length,
    currentTokens: current.length,
    changedRatio,
    changedPassages,
  };
}

/**
 * The change between two slices as the redline-summary prompt reads it:
 * every changed run marked [-removed-] / [+added+], with a few unchanged
 * tokens either side for context, runs separated by "…". Built from the same
 * word-level diff the bucket is measured on, so an explanation describes the
 * change that was counted — not a different, prettier diff.
 *
 * Bounded: a rewritten section would otherwise exceed what one model call may
 * carry. When runs are dropped the result says so (`truncated`), and the
 * caller must tell the reader the explanation covers part of the change.
 */
export interface MarkedDiff {
  text: string;
  /** Changed runs included / found. */
  runsIncluded: number;
  runsTotal: number;
  truncated: boolean;
}

const MARKED_DIFF_CONTEXT_TOKENS = 12;
const MARKED_DIFF_MAX_CHARS = 36_000;

export function buildMarkedDiff(priorText: string, currentText: string, maxChars = MARKED_DIFF_MAX_CHARS): MarkedDiff {
  const prior = tokensOf(priorText);
  const current = tokensOf(currentText);
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 10;
  const encoded = dmp.diff_linesToChars_(prior.join('\n') + '\n', current.join('\n') + '\n');
  const diffs = dmp.diff_main(encoded.chars1, encoded.chars2, false);
  dmp.diff_charsToLines_(diffs, encoded.lineArray);

  const ops = diffs.map(([operation, chunk]) => ({ operation, tokens: chunk.split('\n').filter(Boolean) }));

  const runs: string[] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].operation === 0) { index += 1; continue; }
    const before = index > 0 && ops[index - 1].operation === 0
      ? ops[index - 1].tokens.slice(-MARKED_DIFF_CONTEXT_TOKENS).join(' ')
      : '';
    const parts: string[] = [];
    // One run is consecutive edits joined by short unchanged gaps — the same
    // grouping that counts "passages" in computeSectionChange.
    while (index < ops.length) {
      const op = ops[index];
      if (op.operation === -1) parts.push(`[-${op.tokens.join(' ')}-]`);
      else if (op.operation === 1) parts.push(`[+${op.tokens.join(' ')}+]`);
      else if (op.tokens.length < PASSAGE_GAP_TOKENS && index + 1 < ops.length) parts.push(op.tokens.join(' '));
      else break;
      index += 1;
    }
    const after = index < ops.length && ops[index].operation === 0
      ? ops[index].tokens.slice(0, MARKED_DIFF_CONTEXT_TOKENS).join(' ')
      : '';
    runs.push([before, ...parts, after].filter(Boolean).join(' '));
  }

  const kept: string[] = [];
  let length = 0;
  for (const run of runs) {
    if (length + run.length + 3 > maxChars) break;
    kept.push(run);
    length += run.length + 3;
  }
  return {
    text: kept.join('\n…\n'),
    runsIncluded: kept.length,
    runsTotal: runs.length,
    truncated: kept.length < runs.length,
  };
}

export const CHANGE_BUCKET_LABELS: Record<ChangeBucket, string> = {
  new: 'New section',
  deleted: 'Section removed',
  major: 'Major changes',
  moderate: 'Moderate changes',
  minor: 'Minor changes',
  unchanged: 'Unchanged',
};
