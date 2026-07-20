import { describe, expect, it } from 'vitest';
import {
  buildCommentLetterSummaryPlan,
  CommentLetterSummaryLimitError,
  getCommentLetterSummaryCallCount,
  getCommentLetterSummaryTokenCost,
  isCommentLetterSummaryCacheCurrent,
  MAX_COMMENT_LETTER_SUMMARY_CALLS,
  MAX_COMMENT_LETTERS_PER_SUMMARY,
  COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS,
  COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS,
} from '../services/commentLetterSummary';

describe('comment-letter hierarchical summary coverage', () => {
  it('represents every round, including threads longer than the old 24-letter cap', () => {
    const letters = Array.from({ length: 35 }, (_, index) => ({
      form: index % 2 === 0 ? 'UPLOAD' : 'CORRESP',
      date_filed: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      company_name: 'Example Corp',
      content: `Letter evidence ${index + 1}`,
    }));

    const plan = buildCommentLetterSummaryPlan(letters);

    expect(plan.chunks).toHaveLength(4);
    expect(plan.chunks.join('\n')).toContain('Letter evidence 1');
    expect(plan.chunks.join('\n')).toContain('Letter evidence 35');
    expect(plan.coverage).toMatchObject({
      totalLetters: 35,
      lettersWithText: 35,
      lettersRepresented: 35,
      omittedLetters: 0,
    });
  });

  it('retains the opening and closing evidence of a long letter and reports truncation', () => {
    const content = `OPENING ISSUE\n${'x'.repeat(10_000)}\nCLOSING RESOLUTION`;
    const plan = buildCommentLetterSummaryPlan([{ form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content }]);

    expect(plan.chunks[0]).toContain('OPENING ISSUE');
    expect(plan.chunks[0]).toContain('CLOSING RESOLUTION');
    expect(plan.chunks[0]).toContain('middle excerpt omitted');
    expect(plan.coverage.truncatedLetters).toBe(1);
  });

  it('counts missing text without silently omitting the round', () => {
    const plan = buildCommentLetterSummaryPlan([
      { form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content: null },
      { form: 'CORRESP', date_filed: '2026-01-02', company_name: 'Example', content: 'Response' },
    ]);

    expect(plan.chunks[0]).toContain('[text not yet extracted]');
    expect(plan.coverage).toMatchObject({ lettersRepresented: 2, lettersWithText: 1, missingTextLetters: 1, omittedLetters: 0 });
  });

  it('reserves every chunk-note output plus the final synthesis output', () => {
    expect(getCommentLetterSummaryTokenCost(1)).toBe(1_500);
    expect(getCommentLetterSummaryTokenCost(4)).toBe(4_700);
    expect(getCommentLetterSummaryCallCount(4)).toBe(5);
  });

  it('bounds pathological request volume without silently truncating rounds', () => {
    const letters = Array.from({ length: MAX_COMMENT_LETTERS_PER_SUMMARY + 1 }, (_, index) => ({
      form: 'UPLOAD',
      date_filed: '2026-01-01',
      company_name: 'Example',
      content: `Letter ${index}`,
    }));

    expect(() => buildCommentLetterSummaryPlan(letters)).toThrow(CommentLetterSummaryLimitError);
    expect(MAX_COMMENT_LETTER_SUMMARY_CALLS).toBe(11);
    expect(COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS * 1_000)
      .toBeGreaterThan(COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS);
  });

  it('invalidates a same-count cache when missing letter text is backfilled', () => {
    const missingPlan = buildCommentLetterSummaryPlan([
      { form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content: null },
      { form: 'CORRESP', date_filed: '2026-01-02', company_name: 'Example', content: 'Response' },
    ]);
    const backfilledPlan = buildCommentLetterSummaryPlan([
      { form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content: 'Staff issue' },
      { form: 'CORRESP', date_filed: '2026-01-02', company_name: 'Example', content: 'Response' },
    ]);
    const cached = { letters_count: 2, input_coverage: missingPlan.coverage };

    expect(isCommentLetterSummaryCacheCurrent(cached, missingPlan)).toBe(true);
    expect(isCommentLetterSummaryCacheCurrent(cached, backfilledPlan)).toBe(false);
    expect(backfilledPlan.coverage.evidenceFingerprint).not.toBe(missingPlan.coverage.evidenceFingerprint);
  });
});
