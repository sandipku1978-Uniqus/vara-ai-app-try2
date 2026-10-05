import { createHash } from 'node:crypto';

export interface CommentLetterSummaryInput {
  form: string;
  date_filed: string;
  company_name: string;
  content: string | null;
}

export interface CommentLetterSummaryCoverage {
  totalLetters: number;
  lettersWithText: number;
  lettersRepresented: number;
  /** Letters whose middle had to be omitted to fit the episode budget. */
  truncatedLetters: number;
  missingTextLetters: number;
  omittedLetters: number;
  /** Characters of extracted letter text in the episode. */
  charactersInLetters?: number;
  /** Characters of that text the model was given. */
  charactersRead?: number;
  /** charactersInLetters − charactersRead: what the model never saw. */
  charactersOmitted?: number;
  /** 2 = whole-letter chunking; absent = the retired 8,000-character head/tail read. */
  planVersion?: number;
  method: string;
  evidenceFingerprint: string;
}

export interface CommentLetterSummaryPlan {
  chunks: string[];
  coverage: CommentLetterSummaryCoverage;
}

export const COMMENT_LETTER_SUMMARY_PLAN_VERSION = 2;
export const MAX_COMMENT_LETTERS_PER_SUMMARY = 100;
/**
 * Each round-group call reads at most this many characters (~12K tokens),
 * and an episode is read in at most MAX_COMMENT_LETTER_SUMMARY_CHUNKS such
 * groups, so the call count (and the route's time and token budgets below)
 * is unchanged from the head/tail plan while every letter is read whole up
 * to ~430K characters per episode.
 */
export const COMMENT_LETTER_SUMMARY_CHUNK_CHARS = 48_000;
export const MAX_COMMENT_LETTER_SUMMARY_CHUNKS = 10;
export const MAX_COMMENT_LETTER_SUMMARY_CALLS = MAX_COMMENT_LETTER_SUMMARY_CHUNKS + 1;
/**
 * Letter text the episode may carry in total. Kept under the chunk capacity
 * so per-letter headers and paragraph-aligned cuts always fit in ten groups.
 */
export const COMMENT_LETTER_SUMMARY_EPISODE_CHARS = Math.floor(COMMENT_LETTER_SUMMARY_CHUNK_CHARS * 9);
/** Round-group calls run this many at a time so ten groups fit the generation budget. */
export const COMMENT_LETTER_SUMMARY_PARALLEL_CALLS = 3;
/**
 * The route runs under a 300 s platform budget (letters/summary
 * `maxDuration`). These used to be 480 s and 600 s — longer than the
 * function was allowed to live — so a slow episode was killed by the
 * platform mid-generation: the lock then held for ten minutes (every retry
 * answered 409), the concurrency slot stayed leased, and the token
 * reservation was never refunded. Both now fit inside the platform budget
 * so the route's own deadline fires first and every finally-block runs:
 * 270 s of generation, a 300 s lock/lease that outlives it by the time the
 * cache write and cleanup need.
 */
export const COMMENT_LETTER_SUMMARY_PLATFORM_BUDGET_SECONDS = 300;
export const COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS = 270 * 1_000;
export const COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS = COMMENT_LETTER_SUMMARY_PLATFORM_BUDGET_SECONDS;

export class CommentLetterSummaryLimitError extends Error {
  constructor() {
    super(`A review episode may contain at most ${MAX_COMMENT_LETTERS_PER_SUMMARY} letters for AI summarization.`);
    this.name = 'CommentLetterSummaryLimitError';
  }
}

/** Reserve the exact maximum output budget used by the generation policy. */
export function getCommentLetterSummaryTokenCost(chunkCount: number): number {
  const normalized = Math.max(0, Math.floor(chunkCount));
  return normalized > 1 ? 1_500 + normalized * 800 : 1_500;
}

export function getCommentLetterSummaryCallCount(chunkCount: number): number {
  const normalized = Math.max(0, Math.floor(chunkCount));
  return normalized > 1 ? normalized + 1 : 1;
}

function evidenceFingerprint(letters: CommentLetterSummaryInput[]): string {
  const hash = createHash('sha256');
  for (const letter of letters) {
    hash.update(letter.form);
    hash.update('\0');
    hash.update(letter.date_filed);
    hash.update('\0');
    hash.update(letter.company_name);
    hash.update('\0');
    hash.update(letter.content ?? '[missing]');
    hash.update('\0\0');
  }
  return hash.digest('hex');
}

/**
 * A cached summary is current when it covers exactly this evidence AND was
 * produced by a plan that read as much as this one does. Summaries from the
 * retired head/tail plan stay current only if they truncated nothing (every
 * letter fit in 8,000 characters, so the whole-letter plan reads the same
 * text); otherwise they are regenerated rather than shown as complete.
 */
export function isCommentLetterSummaryCacheCurrent(
  cached: { letters_count: number; input_coverage: Partial<CommentLetterSummaryCoverage> | null } | null,
  plan: CommentLetterSummaryPlan
): boolean {
  const coverage = cached?.input_coverage;
  const planCurrent = coverage?.planVersion === COMMENT_LETTER_SUMMARY_PLAN_VERSION
    || (coverage?.planVersion === undefined && coverage?.truncatedLetters === 0);
  return Boolean(
    coverage?.evidenceFingerprint &&
    planCurrent &&
    Number(cached!.letters_count) === plan.coverage.totalLetters &&
    coverage.lettersWithText === plan.coverage.lettersWithText &&
    coverage.evidenceFingerprint === plan.coverage.evidenceFingerprint
  );
}

/**
 * Per-letter character allowances that sum to at most `budget`: letters
 * shorter than the fair share are read whole and their unused share goes to
 * the longer ones (water-filling), so truncation touches only the letters
 * that are genuinely too long, and only as much as needed.
 */
export function allocateLetterBudgets(lengths: number[], budget: number): number[] {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= budget) return [...lengths];
  const order = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
  const allowances = new Array<number>(lengths.length).fill(0);
  let remaining = budget;
  let left = lengths.length;
  for (const item of order) {
    const share = Math.floor(remaining / left);
    const allowance = Math.min(item.length, share);
    allowances[item.index] = allowance;
    remaining -= allowance;
    left -= 1;
  }
  return allowances;
}

/** Opening and closing text of a letter that exceeds its allowance. */
function excerptLetter(content: string, allowance: number): { text: string; read: number } {
  if (content.length <= allowance) return { text: content, read: content.length };
  const markerFor = (omitted: number) => `\n\n[${omitted.toLocaleString('en-US')} characters of this letter's middle omitted to fit the episode budget]\n\n`;
  const usable = Math.max(0, allowance - markerFor(content.length).length);
  const head = Math.ceil(usable * 0.6);
  const tail = usable - head;
  return {
    text: `${content.slice(0, head)}${markerFor(content.length - usable)}${tail > 0 ? content.slice(content.length - tail) : ''}`,
    read: usable,
  };
}

/** A cut at a paragraph or sentence boundary within the last 5% of the space, else at whitespace, else hard. */
function cutPoint(text: string, space: number): number {
  if (text.length <= space) return text.length;
  const floor = Math.floor(space * 0.95);
  const window = text.slice(floor, space);
  for (const pattern of [/\n\s*\n/g, /[.!?]["”’)]?\s/g, /\s/g]) {
    let last = -1;
    for (const match of window.matchAll(pattern)) last = (match.index ?? 0) + match[0].length;
    if (last > 0) return floor + last;
  }
  return space;
}

function letterLabel(letter: CommentLetterSummaryInput): string {
  return letter.form === 'UPLOAD' ? 'SEC STAFF LETTER' : 'COMPANY RESPONSE';
}

/**
 * Build a bounded hierarchical-summary plan that reads every letter whole.
 * The episode's letters are laid end to end in reading order and cut into
 * round groups of at most COMMENT_LETTER_SUMMARY_CHUNK_CHARS; a letter that
 * spans a cut continues in the next group under a "continued" header. Only
 * when an episode's text exceeds COMMENT_LETTER_SUMMARY_EPISODE_CHARS are the
 * middles of its longest letters omitted — and the coverage object says
 * which letters and how many characters.
 */
export function buildCommentLetterSummaryPlan(
  letters: CommentLetterSummaryInput[]
): CommentLetterSummaryPlan {
  if (letters.length > MAX_COMMENT_LETTERS_PER_SUMMARY) {
    throw new CommentLetterSummaryLimitError();
  }
  const lengths = letters.map(letter => letter.content?.length ?? 0);
  const charactersInLetters = lengths.reduce((sum, length) => sum + length, 0);
  // Headers cost characters too; reserve them out of the episode budget.
  const headerReserve = letters.length * 120;
  const allowances = allocateLetterBudgets(lengths, Math.max(0, COMMENT_LETTER_SUMMARY_EPISODE_CHARS - headerReserve));

  let truncatedLetters = 0;
  let charactersRead = 0;
  const texts = letters.map((letter, index) => {
    if (!letter.content) return '[text not yet extracted]';
    const excerpt = excerptLetter(letter.content, allowances[index]);
    if (excerpt.read < letter.content.length) truncatedLetters += 1;
    charactersRead += excerpt.read;
    return excerpt.text;
  });

  const chunks: string[] = [];
  let current = '';
  const close = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  letters.forEach((letter, index) => {
    let remaining = texts[index];
    let part = 1;
    while (remaining.length > 0) {
      const header = `--- ${letterLabel(letter)} · ${letter.date_filed}${part > 1 ? ' · continued' : ''} ---\n`;
      const separator = current ? '\n\n' : '';
      const space = COMMENT_LETTER_SUMMARY_CHUNK_CHARS - current.length - separator.length - header.length;
      // Do not open a letter in the last sliver of a group.
      if (space < 2_000 && current) {
        close();
        continue;
      }
      const cut = cutPoint(remaining, Math.max(space, 1));
      current += `${separator}${header}${remaining.slice(0, cut).trimEnd()}`;
      remaining = remaining.slice(cut).trimStart();
      part += 1;
      if (remaining.length > 0) close();
    }
  });
  close();

  const lettersWithText = letters.filter(letter => Boolean(letter.content)).length;
  const multi = chunks.length > 1;
  return {
    chunks,
    coverage: {
      totalLetters: letters.length,
      lettersWithText,
      lettersRepresented: letters.length,
      truncatedLetters,
      missingTextLetters: letters.length - lettersWithText,
      omittedLetters: 0,
      charactersInLetters,
      charactersRead,
      charactersOmitted: charactersInLetters - charactersRead,
      planVersion: COMMENT_LETTER_SUMMARY_PLAN_VERSION,
      evidenceFingerprint: evidenceFingerprint(letters),
      method: truncatedLetters > 0
        ? `${multi ? 'Hierarchical synthesis across chronological round groups' : 'Chronological full-thread synthesis'}; every letter read whole except the middles of ${truncatedLetters} of the longest, omitted to fit the episode budget.`
        : `${multi ? 'Hierarchical synthesis across chronological round groups' : 'Chronological full-thread synthesis'}; every letter read in full.`,
    },
  };
}
