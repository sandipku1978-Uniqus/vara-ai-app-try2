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
  truncatedLetters: number;
  missingTextLetters: number;
  omittedLetters: number;
  method: string;
  evidenceFingerprint: string;
}

export interface CommentLetterSummaryPlan {
  chunks: string[];
  coverage: CommentLetterSummaryCoverage;
}

const MAX_CHUNK_LETTERS = 10;
const MAX_LETTER_CHARS = 8_000;
const HEAD_CHARS = 5_500;
const TAIL_CHARS = MAX_LETTER_CHARS - HEAD_CHARS;
export const MAX_COMMENT_LETTERS_PER_SUMMARY = 100;
export const MAX_COMMENT_LETTER_SUMMARY_CHUNKS = Math.ceil(
  MAX_COMMENT_LETTERS_PER_SUMMARY / MAX_CHUNK_LETTERS
);
export const MAX_COMMENT_LETTER_SUMMARY_CALLS = MAX_COMMENT_LETTER_SUMMARY_CHUNKS + 1;
export const COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS = 8 * 60 * 1_000;
export const COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS = 10 * 60;

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

export function isCommentLetterSummaryCacheCurrent(
  cached: { letters_count: number; input_coverage: Partial<CommentLetterSummaryCoverage> | null } | null,
  plan: CommentLetterSummaryPlan
): boolean {
  return Boolean(
    cached?.input_coverage?.evidenceFingerprint &&
    Number(cached.letters_count) === plan.coverage.totalLetters &&
    cached.input_coverage.lettersWithText === plan.coverage.lettersWithText &&
    cached.input_coverage.evidenceFingerprint === plan.coverage.evidenceFingerprint
  );
}

function evidenceForLetter(letter: CommentLetterSummaryInput): { text: string; truncated: boolean } {
  if (!letter.content) return { text: '[text not yet extracted]', truncated: false };
  if (letter.content.length <= MAX_LETTER_CHARS) return { text: letter.content, truncated: false };
  return {
    text: `${letter.content.slice(0, HEAD_CHARS)}\n\n[long letter middle excerpt omitted]\n\n${letter.content.slice(-TAIL_CHARS)}`,
    truncated: true,
  };
}

/** Build a bounded hierarchical-summary plan that represents every round.
 * Long letters keep both their opening issue statement and closing/resolution
 * language; no newest exchange is dropped because a thread exceeds a cap. */
export function buildCommentLetterSummaryPlan(
  letters: CommentLetterSummaryInput[]
): CommentLetterSummaryPlan {
  if (letters.length > MAX_COMMENT_LETTERS_PER_SUMMARY) {
    throw new CommentLetterSummaryLimitError();
  }
  let truncatedLetters = 0;
  const rendered = letters.map(letter => {
    const evidence = evidenceForLetter(letter);
    if (evidence.truncated) truncatedLetters += 1;
    return `--- ${letter.form === 'UPLOAD' ? 'SEC STAFF LETTER' : 'COMPANY RESPONSE'} · ${letter.date_filed} ---\n${evidence.text}`;
  });
  const chunks: string[] = [];
  for (let index = 0; index < rendered.length; index += MAX_CHUNK_LETTERS) {
    chunks.push(rendered.slice(index, index + MAX_CHUNK_LETTERS).join('\n\n'));
  }
  const lettersWithText = letters.filter(letter => Boolean(letter.content)).length;
  return {
    chunks,
    coverage: {
      totalLetters: letters.length,
      lettersWithText,
      lettersRepresented: letters.length,
      truncatedLetters,
      missingTextLetters: letters.length - lettersWithText,
      omittedLetters: 0,
      evidenceFingerprint: evidenceFingerprint(letters),
      method: chunks.length > 1
        ? 'Hierarchical synthesis across chronological round groups; long letters include opening and closing excerpts.'
        : 'Chronological full-thread synthesis; long letters include opening and closing excerpts.',
    },
  };
}
