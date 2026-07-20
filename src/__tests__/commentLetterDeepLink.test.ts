import { describe, expect, it } from 'vitest';
import { mergeRequestedThreadLookup, summarizeThreadLetters, type ThreadLetter } from '../views/CommentLetters';

describe('comment-letter dossier deep links', () => {
  it('can synthesize the requested episode card even when it is outside the recent-thread page', () => {
    const letters: ThreadLetter[] = [
      { accession: 'staff', cik: 123, company_name: 'Example Co.', form: 'UPLOAD', date_filed: '2024-04-02', filename: 'staff.txt', has_text: true, preview: '' },
      { accession: 'response', cik: 123, company_name: 'Example Co.', form: 'CORRESP', date_filed: '2024-04-10', filename: 'response.txt', has_text: true, preview: '' },
    ];

    expect(summarizeThreadLetters('123:review-key', letters)).toEqual({
      thread_id: '123:review-key',
      cik: 123,
      company_name: 'Example Co.',
      letters: 2,
      uploads: 1,
      corresps: 1,
      first_letter: '2024-04-02',
      last_letter: '2024-04-10',
    });
  });

  it('distinguishes a failed requested-thread lookup from a successful miss', () => {
    expect(mergeRequestedThreadLookup('123:missing', [], null, true)).toMatchObject({
      error: expect.stringContaining('could not be loaded'),
      retryable: true,
    });
    expect(mergeRequestedThreadLookup('123:missing', [], null, false)).toMatchObject({
      error: expect.stringContaining('could not be found'),
      retryable: false,
    });
  });

  it('does not assert an error when the requested episode is merged into browse results', () => {
    const summary = summarizeThreadLetters('123:review-key', [{
      accession: 'staff',
      cik: 123,
      company_name: 'Example Co.',
      form: 'UPLOAD',
      date_filed: '2024-04-02',
      filename: 'staff.txt',
      has_text: true,
      preview: '',
    }]);

    expect(mergeRequestedThreadLookup('123:review-key', [], summary, false)).toEqual({
      threads: [summary],
      error: '',
      retryable: false,
    });
  });
});
