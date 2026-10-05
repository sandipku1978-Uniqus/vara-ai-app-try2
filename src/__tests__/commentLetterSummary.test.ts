import { describe, expect, it } from 'vitest';
import {
  allocateLetterBudgets,
  buildCommentLetterSummaryPlan,
  COMMENT_LETTER_SUMMARY_CHUNK_CHARS,
  COMMENT_LETTER_SUMMARY_EPISODE_CHARS,
  COMMENT_LETTER_SUMMARY_PLAN_VERSION,
  MAX_COMMENT_LETTER_SUMMARY_CHUNKS,
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

    // Short letters share one group; nothing is dropped.
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks.join('\n')).toContain('Letter evidence 1');
    expect(plan.chunks.join('\n')).toContain('Letter evidence 35');
    expect(plan.coverage).toMatchObject({
      totalLetters: 35,
      lettersWithText: 35,
      lettersRepresented: 35,
      omittedLetters: 0,
      truncatedLetters: 0,
      charactersOmitted: 0,
      planVersion: COMMENT_LETTER_SUMMARY_PLAN_VERSION,
    });
  });

  it('reads the middle of a long letter that the old 8,000-character head/tail read never saw', () => {
    const content = `OPENING ISSUE\n${'x'.repeat(10_000)}\nMIDDLE CONCESSION\n${'y'.repeat(10_000)}\nCLOSING RESOLUTION`;
    const plan = buildCommentLetterSummaryPlan([{ form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content }]);

    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]).toContain('OPENING ISSUE');
    expect(plan.chunks[0]).toContain('MIDDLE CONCESSION');
    expect(plan.chunks[0]).toContain('CLOSING RESOLUTION');
    expect(plan.coverage).toMatchObject({ truncatedLetters: 0, charactersRead: content.length, charactersOmitted: 0 });
    expect(plan.coverage.method).toContain('every letter read in full');
  });

  it('continues a letter longer than one group into the next group, in order', () => {
    const paragraphs = Array.from({ length: 300 }, (_, index) => `Paragraph ${index + 1}. ${'Analysis text. '.repeat(20)}`);
    const content = paragraphs.join('\n\n');
    expect(content.length).toBeGreaterThan(COMMENT_LETTER_SUMMARY_CHUNK_CHARS * 1.5);
    const plan = buildCommentLetterSummaryPlan([
      { form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content: 'Staff comment 1.' },
      { form: 'CORRESP', date_filed: '2026-01-15', company_name: 'Example', content },
    ]);

    expect(plan.chunks.length).toBeGreaterThanOrEqual(2);
    expect(plan.chunks.every(chunk => chunk.length <= COMMENT_LETTER_SUMMARY_CHUNK_CHARS)).toBe(true);
    expect(plan.chunks[1]).toMatch(/^--- COMPANY RESPONSE · 2026-01-15 · continued ---/);
    const joined = plan.chunks.join('\n');
    expect(joined.indexOf('Paragraph 1.')).toBeLessThan(joined.indexOf('Paragraph 150.'));
    expect(joined).toContain('Paragraph 300.');
    expect(plan.coverage.charactersOmitted).toBe(0);
  });

  it('omits only the middles of the longest letters when an episode exceeds its budget, and says so', () => {
    const huge = (label: string) => `${label} OPENING\n${'z'.repeat(400_000)}\n${label} CLOSING`;
    const letters = [
      { form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content: 'Short staff letter with three comments.' },
      { form: 'CORRESP', date_filed: '2026-01-20', company_name: 'Example', content: huge('FIRST') },
      { form: 'CORRESP', date_filed: '2026-02-20', company_name: 'Example', content: huge('SECOND') },
    ];
    const plan = buildCommentLetterSummaryPlan(letters);
    const joined = plan.chunks.join('\n');

    expect(plan.chunks.length).toBeLessThanOrEqual(MAX_COMMENT_LETTER_SUMMARY_CHUNKS);
    expect(plan.chunks.every(chunk => chunk.length <= COMMENT_LETTER_SUMMARY_CHUNK_CHARS)).toBe(true);
    expect(joined).toContain('Short staff letter with three comments.');
    for (const label of ['FIRST', 'SECOND']) {
      expect(joined).toContain(`${label} OPENING`);
      expect(joined).toContain(`${label} CLOSING`);
    }
    expect(joined).toMatch(/characters of this letter's middle omitted to fit the episode budget/);
    const total = letters.reduce((sum, letter) => sum + letter.content.length, 0);
    expect(plan.coverage).toMatchObject({ truncatedLetters: 2, charactersInLetters: total, omittedLetters: 0 });
    expect(plan.coverage.charactersRead! + plan.coverage.charactersOmitted!).toBe(total);
    expect(plan.coverage.charactersRead).toBeLessThanOrEqual(COMMENT_LETTER_SUMMARY_EPISODE_CHARS);
    expect(plan.coverage.method).toContain('except the middles of 2 of the longest');
  });

  it('never needs more than ten groups, whatever the mix of letter sizes', () => {
    for (const size of [1_000, 30_000, 47_000, 49_000, 95_000, 200_000]) {
      const letters = Array.from({ length: 40 }, (_, index) => ({
        form: index % 2 === 0 ? 'UPLOAD' : 'CORRESP',
        date_filed: '2026-03-01',
        company_name: 'Example',
        content: `Letter ${index}. ${'word '.repeat(Math.floor(size / 5))}`,
      }));
      const plan = buildCommentLetterSummaryPlan(letters);
      expect(plan.chunks.length, `size ${size}`).toBeLessThanOrEqual(MAX_COMMENT_LETTER_SUMMARY_CHUNKS);
      expect(plan.chunks.every(chunk => chunk.length <= COMMENT_LETTER_SUMMARY_CHUNK_CHARS)).toBe(true);
    }
  });

  it('shares the episode budget so short letters are never cut for a long one', () => {
    expect(allocateLetterBudgets([100, 200, 10_000], 5_000)).toEqual([100, 200, 4_700]);
    expect(allocateLetterBudgets([3_000, 3_000, 3_000], 6_000)).toEqual([2_000, 2_000, 2_000]);
    expect(allocateLetterBudgets([10, 20], 1_000)).toEqual([10, 20]);
  });

  it('regenerates a cached head/tail summary that truncated letters, but keeps one that did not', () => {
    const plan = buildCommentLetterSummaryPlan([
      { form: 'UPLOAD', date_filed: '2026-01-01', company_name: 'Example', content: 'Staff issue' },
    ]);
    const legacy = (truncatedLetters: number) => ({
      letters_count: 1,
      input_coverage: {
        lettersWithText: 1,
        truncatedLetters,
        evidenceFingerprint: plan.coverage.evidenceFingerprint,
      },
    });
    expect(isCommentLetterSummaryCacheCurrent(legacy(0), plan)).toBe(true);
    expect(isCommentLetterSummaryCacheCurrent(legacy(1), plan)).toBe(false);
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
