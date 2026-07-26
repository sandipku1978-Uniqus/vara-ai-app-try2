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
}

/** Bucket thresholds on the changed ratio. Deliberately plain numbers. */
const MAJOR_THRESHOLD = 0.25;
const MODERATE_THRESHOLD = 0.10;
const MINOR_THRESHOLD = 0.02;

function tokensOf(text: string): string[] {
  const normalized = normalizeForMatch(text || '');
  return normalized ? normalized.split(' ') : [];
}

export function computeSectionChange(priorText: string, currentText: string): SectionChange {
  const prior = tokensOf(priorText);
  const current = tokensOf(currentText);

  if (prior.length === 0 && current.length === 0) {
    return { bucket: 'unchanged', addedTokens: 0, removedTokens: 0, priorTokens: 0, currentTokens: 0, changedRatio: 0 };
  }
  if (prior.length === 0) {
    return { bucket: 'new', addedTokens: current.length, removedTokens: 0, priorTokens: 0, currentTokens: current.length, changedRatio: 1 };
  }
  if (current.length === 0) {
    return { bucket: 'deleted', addedTokens: 0, removedTokens: prior.length, priorTokens: prior.length, currentTokens: 0, changedRatio: 1 };
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
  for (const [operation, chunk] of diffs) {
    if (operation === 1) added += chunk.length;
    else if (operation === -1) removed += chunk.length;
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
