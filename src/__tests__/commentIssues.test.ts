import { describe, expect, it } from 'vitest';
import {
  buildEpisodeIssues,
  cleanLetterText,
  isNoReviewLetter,
  isReviewCompleteLetter,
  priorLetterDate,
  similarCommentQuery,
  splitStaffComments,
  type EpisodeIssues,
  type IssueLetter,
} from '../services/commentIssues';
import { EPISODES, letterText, loadEpisode } from './fixtures/letters/loadEpisode';

function issue(result: EpisodeIssues, round: number, number: number) {
  const found = result.letters.find(letter => letter.round === round)?.issues.find(item => item.issueNumber === number);
  if (!found) throw new Error(`no issue ${round}#${number}`);
  return found;
}

describe('fixture hygiene', () => {
  it('keeps every real-letter fixture under 60 KB and named by its accession', () => {
    for (const episode of Object.values(EPISODES)) {
      for (const letter of episode.letters) {
        expect(letter.accession).toMatch(/^\d{10}-\d{2}-\d{6}$/);
        expect(Buffer.byteLength(letterText(letter.accession))).toBeLessThan(60 * 1024);
        expect(letter.source).toContain(letter.accession);
      }
    }
    expect(Object.keys(EPISODES).length).toBeGreaterThanOrEqual(6);
  });
});

describe('splitStaffComments on real Staff letters', () => {
  it('splits Apple 2024 (0000000000-24-002512) into two comments with their section headings', () => {
    const comments = splitStaffComments(letterText('0000000000-24-002512'));
    expect(comments.map(comment => comment.number)).toEqual([1, 2]);
    expect(comments[0].filingSectionRef).toBe(
      "Form 10-K for the fiscal year ended September 30, 2023 / Management's Discussion and Analysis of Financial Condition and Results of Operations / Products and Services Performance, page 22"
    );
    expect(comments[0].text).toMatch(/^You disclose that services net sales increased/);
    expect(comments[0].text).toMatch(/Refer to Item 303\(b\) of Regulation S-K\.$/);
    // The page-break furniture ("Luca Maestri ... Page 2", template residue) is gone.
    expect(comments[1].filingSectionRef).toBe('Notes to Consolidated Financial Statements / Note 2 - Revenue, page 35');
    expect(comments[1].text).not.toMatch(/FirstName|LastName|Comapany|Page 2/);
    expect(comments[1].text).toMatch(/for each period presented\.$/);
  });

  it('ends an unpunctuated comment at the next heading (NVIDIA 0000000000-23-006470)', () => {
    const comments = splitStaffComments(letterText('0000000000-23-006470'));
    expect(comments).toHaveLength(4);
    expect(comments[1].text).toMatch(/to mitigate inflationary pressures$/);
    expect(comments[1].text).not.toContain('Gross Profit');
    expect(comments[1].filingSectionInherited).toBe(true);
    expect(comments[2].filingSectionRef).toBe('Gross Profit and Gross Margin, page 42');
    expect(comments[3].filingSectionRef).toMatch(/Revenue Recognition, page 60$/);
  });

  it('inherits the previous heading for a comment that has none (Tesla 0000000000-23-010608 #3)', () => {
    const comments = splitStaffComments(letterText('0000000000-23-010608'));
    expect(comments).toHaveLength(3);
    expect(comments[2].filingSectionRef).toBe(comments[1].filingSectionRef);
    expect(comments[2].filingSectionInherited).toBe(true);
    expect(comments[1].filingSectionRef).toContain('Note 14 - Income Taxes, page 81');
  });

  it('reads prior-comment references, including spelled-out numbers', () => {
    expect(splitStaffComments(letterText('0000000000-24-003505')).map(comment => comment.priorCommentRefs)).toEqual([[1], [2]]);
    expect(splitStaffComments(letterText('0000000000-23-012801'))[0].priorCommentRefs).toEqual([3]);
    expect(priorLetterDate(letterText('0000000000-23-012801'))).toBe('2023-09-26');
    expect(priorLetterDate(letterText('0000000000-24-003505'))).toBe('2024-03-06');
  });

  it('accepts numbering only in sequence, so stray numbers cannot start comments', () => {
    const synthetic = [
      'Dear Ms. Example:',
      '',
      '2. This line is out of sequence and is not a comment.',
      '',
      'Form 10-K for the fiscal year ended December 31, 2025',
      'Revenue, page 40',
      '',
      '1. Please tell us how you identified performance obligations.',
      '4. 5-year projections were cited above; this is still comment one text.',
      '2. Please revise to disaggregate revenue.',
      '',
      'Please contact Jane Doe at 202-555-0100 with any questions.',
    ].join('\n');
    const comments = splitStaffComments(synthetic);
    expect(comments.map(comment => comment.number)).toEqual([1, 2]);
    expect(comments[0].text).toContain('still comment one text');
    expect(comments[1].text).toBe('Please revise to disaggregate revenue.');
    expect(comments[0].filingSectionRef).toBe('Form 10-K for the fiscal year ended December 31, 2025 / Revenue, page 40');
  });

  it('recognises completion and no-review letters, which carry no comments', () => {
    expect(isReviewCompleteLetter(letterText('0000000000-24-005673'))).toBe(true);
    expect(isReviewCompleteLetter(letterText('0000000000-24-002512'))).toBe(false);
    expect(isNoReviewLetter(letterText('0000000000-24-004905'))).toBe(true);
    expect(splitStaffComments(letterText('0000000000-24-004905'))).toEqual([]);
  });

  it('removes running page headers only where they repeat the letter header', () => {
    const cleaned = cleanLetterText(letterText('0000000000-21-013530'));
    expect(cleaned).not.toMatch(/FirstName|Comapany/);
    expect(cleaned).not.toMatch(/^\s*Brian T\. Olsavsky\s*\n2\. Your response/m);
    // The header itself (before "Re:") is untouched.
    expect(cleaned).toMatch(/Brian T\. Olsavsky\n\s*Chief Financial Officer/);
  });
});

describe('buildEpisodeIssues on real episodes', () => {
  it('Apple 10-K FY2023: two rounds, paired responses, follow-ups, closed by the completion letter', () => {
    const result = buildEpisodeIssues(loadEpisode('apple-10k-fy2023'));
    expect(result.letters.map(letter => [letter.round, letter.kind, letter.issues.length])).toEqual([
      [1, 'comments', 2], [2, 'comments', 2], [3, 'review-complete', 0],
    ]);
    expect(result.closedBy).toEqual({ accession: '0000000000-24-005673', date_filed: '2024-05-16' });

    const first = issue(result, 1, 1);
    expect(first.response?.accession).toBe('0000320193-24-000042');
    expect(first.response?.matchedBy).toBe('comment-number');
    expect(first.response?.excerptStart).toBe('after-repeated-comment');
    expect(first.response?.excerpt).toMatch(/^The Company respectfully advises the Staff that, when preparing the discussion/);
    expect(first.response?.excerpt).not.toContain('You disclose that services net sales increased');
    // The next comment's headings and the page furniture do not trail the answer.
    expect(first.response?.excerpt).not.toMatch(/Notes to Consolidated Financial Statements\s*$/);
    expect(first.response?.excerpt).not.toMatch(/Confidential Treatment Requested by Apple Inc\.\s*$/);
    expect(first.followUp.map(follow => [follow.staffAccession, follow.issueNumber])).toEqual([['0000000000-24-003505', 1]]);
    expect(first.status).toBe('resolved');
    expect(first.statusBasis).toContain('2024-05-16 states the review is complete');

    const second = issue(result, 2, 2);
    expect(second.followsUp).toEqual([{ staffAccession: '0000000000-24-002512', staffDate: '2024-03-06', issueNumber: 2 }]);
    // The extension letter of 2024-04-05 answers nothing; the 2024-04-29 letter does.
    expect(second.response?.accession).toBe('0000320193-24-000061');
    expect(second.response?.excerpt).toMatch(/^The Company respectfully advises the Staff that expanded descriptions/);
    expect(result.coverage).toMatchObject({ staffLetters: 3, responseLetters: 3, issues: 4, issuesWithResponse: 4 });
  });

  it('Tesla 10-K FY2022: skips the extension request and links "prior comment number three"', () => {
    const result = buildEpisodeIssues(loadEpisode('tesla-10k-fy2022'));
    const round1 = result.letters.find(letter => letter.round === 1)!;
    expect(round1.issues.map(item => item.response?.accession)).toEqual([
      '0001193125-23-265032', '0001193125-23-265032', '0001193125-23-265032',
    ]);
    expect(issue(result, 1, 1).response?.excerpt).toMatch(/^We acknowledge the Staff’s comment and as requested revised our disclosure/);
    expect(issue(result, 1, 2).response?.excerpt).toMatch(/^We respectfully advise the Staff that we considered both positive and negative evidence/);
    const followUp = issue(result, 2, 1);
    expect(followUp.followsUp).toEqual([{ staffAccession: '0000000000-23-010608', staffDate: '2023-09-26', issueNumber: 3 }]);
    // The December response recites the comment without its number; it is
    // found by the comment's text and flagged as such.
    expect(followUp.response?.accession).toBe('0001193125-23-296911');
    expect(followUp.response?.matchedBy).toBe('comment-text');
    expect(result.closedBy?.accession).toBe('0000000000-24-001022');
  });

  it('Amazon 10-K FY2020: four Staff rounds, "Response" labels, follow-ups across rounds', () => {
    const result = buildEpisodeIssues(loadEpisode('amazon-10k-fy2020'));
    expect(result.letters.map(letter => letter.issues.length)).toEqual([4, 4, 2, 0]);
    expect(issue(result, 1, 1).response?.excerptStart).toBe('response-label');
    expect(issue(result, 1, 1).response?.excerpt).toMatch(/^As you noted from our 2020 Sustainability Report/);
    // "Your\nresponse should address ..." inside the recited comment is prose, not a label.
    expect(issue(result, 2, 1).response?.excerpt).toMatch(/^Discrete capital expenditures in support of The Climate Pledge/);
    expect(issue(result, 2, 1).followsUp).toEqual([{ staffAccession: '0000000000-21-011629', staffDate: '2021-09-23', issueNumber: 2 }]);
    expect(issue(result, 1, 3).followUp.map(follow => `${follow.staffDate}#${follow.issueNumber}`)).toEqual(['2021-11-08#2', '2021-11-08#3']);
    expect(issue(result, 3, 2).followsUp).toEqual([{ staffAccession: '0000000000-21-013530', staffDate: '2021-11-08', issueNumber: 4 }]);
    expect(issue(result, 2, 2).filingSectionRef).not.toMatch(/Olsavsky|November/);
    expect(result.letters.flatMap(letter => letter.issues).every(item => item.status === 'resolved')).toBe(true);
  });

  it('Uber 10-K FY2022: "Response to Comment No. 1:" labels', () => {
    const result = buildEpisodeIssues(loadEpisode('uber-10k-fy2022'));
    expect(result.letters[0].issues).toHaveLength(2);
    expect(issue(result, 1, 1).response?.excerptStart).toBe('response-label');
    expect(issue(result, 1, 1).response?.excerpt).toMatch(/^In response to the Staff’s comment, the Company respectfully advises/);
    expect(issue(result, 1, 2).filingSectionRef).toContain('Revenue Recognition - Mobility and Delivery Agreements, page 86');
    expect(issue(result, 1, 2).response?.excerpt).toMatch(/^The Company respectfully advises the Staff that the Company believes it has complied/);
  });

  it('Microsoft: an 8-K review with two comments, and an S-4 the Staff declined to review', () => {
    const review = buildEpisodeIssues(loadEpisode('microsoft-8k-2024'));
    expect(review.letters[0].issues).toHaveLength(2);
    expect(issue(review, 1, 1).filingSectionRef).toContain('Item 1.05 Material Cybersecurity Incidents, page 1');
    expect(issue(review, 1, 1).response?.excerpt).toMatch(/^On January 12, 2024, we detected/);
    expect(issue(review, 1, 2).response?.excerpt).toMatch(/^As of the date of this response letter/);

    const noReview = buildEpisodeIssues(loadEpisode('microsoft-s4-2024'));
    expect(noReview.letters).toHaveLength(1);
    expect(noReview.letters[0].kind).toBe('no-review');
    expect(noReview.closedBy).toBeNull();
  });

  it('Palantir: five comments across a 10-K and a 10-Q, answered in the second response letter', () => {
    const result = buildEpisodeIssues(loadEpisode('palantir-10k-fy2021'));
    expect(result.letters[0].issues).toHaveLength(5);
    expect(issue(result, 1, 3).filingSectionRef).toMatch(/^Form 10-Q for the Interim Period Ended June 30, 2022/);
    expect(result.letters[0].issues.every(item => item.response?.accession === '0001193125-22-248335')).toBe(true);
    expect(issue(result, 1, 1).response?.excerpt).toMatch(/^We acknowledge the Staff’s comment and respectfully advise the Staff that in future filings, we will distinguish/);
  });

  it('Coinbase: a later round whose "prior comment 11" has no Staff letter in the set', () => {
    const result = buildEpisodeIssues(loadEpisode('coinbase-round-2025'));
    const pending = issue(result, 1, 2);
    expect(pending.staffComment).toMatch(/continuing to evaluate your response to our prior comment 11/);
    expect(pending.followsUp).toEqual([]);
    expect(pending.response?.excerpt).toMatch(/^The Company acknowledges that the Staff continues to evaluate/);
  });
});

describe('issue status rests on the letters on file', () => {
  const apple = loadEpisode('apple-10k-fy2023');
  const withoutCompletion = apple.filter(letter => letter.accession !== '0000000000-24-005673');

  it('is "responded", never "resolved", without a completion letter', () => {
    const result = buildEpisodeIssues(withoutCompletion);
    expect(result.closedBy).toBeNull();
    expect(issue(result, 1, 1).status).toBe('responded');
    expect(issue(result, 1, 1).statusBasis).toContain('the Staff followed up in its letter of 2024-04-02 (comment 1)');
    expect(issue(result, 2, 1).status).toBe('responded');
    expect(issue(result, 2, 1).statusBasis).toContain('no later Staff letter is on file');
  });

  it('marks a comment "responded" when the next round does not repeat it but nothing closes the review', () => {
    const tesla = loadEpisode('tesla-10k-fy2022').filter(letter => letter.accession !== '0000000000-24-001022');
    const result = buildEpisodeIssues(tesla);
    expect(issue(result, 1, 1).status).toBe('responded');
    expect(issue(result, 1, 1).statusBasis).toContain('not repeated in the Staff letter of 2023-11-22');
  });

  it('is "open" while the Staff letter is the latest word', () => {
    const result = buildEpisodeIssues(apple.slice(0, 1));
    expect(issue(result, 1, 1).status).toBe('open');
    expect(issue(result, 1, 1).response).toBeNull();
  });

  it('is "unclear" when the response letter has no extracted text', () => {
    const missing: IssueLetter[] = withoutCompletion.map(letter => (
      letter.accession === '0000320193-24-000042' ? { ...letter, content: null } : letter
    ));
    const result = buildEpisodeIssues(missing);
    expect(issue(result, 1, 1).status).toBe('unclear');
    expect(issue(result, 1, 1).statusBasis).toContain('no extracted text');
    expect(result.coverage.responseLettersWithText).toBe(2);
  });

  it('is "unclear", not "resolved", when the review closed but no response could be paired', () => {
    const noResponses = apple.filter(letter => letter.form === 'UPLOAD');
    const result = buildEpisodeIssues(noResponses);
    expect(result.closedBy?.accession).toBe('0000000000-24-005673');
    expect(issue(result, 1, 1).status).toBe('unclear');
    expect(issue(result, 2, 2).status).toBe('unclear');
  });

  it('reports a Staff letter whose text was never extracted', () => {
    const result = buildEpisodeIssues([{ ...apple[0], content: null }]);
    expect(result.letters[0].kind).toBe('text-missing');
    expect(result.coverage.staffLettersWithText).toBe(0);
  });
});

describe('similarCommentQuery', () => {
  it('keeps the standards citation as a phrase and adds distinctive words', () => {
    const comments = splitStaffComments(letterText('0000000000-24-002512'));
    const query = similarCommentQuery(comments[1].text, comments[1].filingSectionRef, 'Apple Inc.');
    expect(query?.terms[0]).toBe('"ASC 280-10-50-40"');
    expect(query?.terms).toContain('services');
    expect(query?.query.split(' ').length).toBeLessThanOrEqual(5);
  });

  it('declines a comment with nothing distinctive to search for', () => {
    expect(similarCommentQuery('We are continuing to evaluate your response to our prior comment 11 and may have additional comments.')).toBeNull();
  });
});
