import { describe, expect, it } from 'vitest';
import { deriveReviewedForms, letterReferenceBlock } from '../services/commentLetterForms';
import { EPISODES, letterText } from './fixtures/letters/loadEpisode';

describe('deriveReviewedForms on real letters', () => {
  const expected: Record<string, string[]> = {
    'apple-10k-fy2023': ['10-K'],
    'tesla-10k-fy2022': ['10-K'],
    'amazon-10k-fy2020': ['10-K'],
    'uber-10k-fy2022': ['10-K'],
    'nvidia-10k-fy2023': ['10-K'],
    'microsoft-8k-2024': ['8-K'],
    'microsoft-s4-2024': ['S-4'],
    'palantir-10k-fy2021': ['10-K', '10-Q'],
  };

  it('reads the form under review from the Re: block of Staff letters and responses alike', () => {
    for (const [name, forms] of Object.entries(expected)) {
      for (const letter of EPISODES[name].letters) {
        expect(deriveReviewedForms(letterText(letter.accession)).forms, `${name} ${letter.accession}`).toEqual(forms);
      }
    }
  });

  it('ignores forms the body mentions but the reference block does not', () => {
    // Apple's Staff letter cites "the December 30, 2023 Form 10-Q" in comment 1.
    const apple = letterText('0000000000-24-002512');
    expect(apple).toContain('December 30, 2023 Form 10-Q');
    expect(deriveReviewedForms(apple).forms).toEqual(['10-K']);
  });

  it('keeps the reference block as the basis shown to users', () => {
    const result = deriveReviewedForms(letterText('0000000000-24-006936'));
    expect(result.basis).toMatch(/^Microsoft Corporation Current Report on Form 8-K filed January 19, 2024/);
    expect(result.basis!.length).toBeLessThanOrEqual(300);
  });
});

describe('deriveReviewedForms canonical values', () => {
  const block = (lines: string) => `Dear Sir:\n`.replace('Dear Sir:', `Re: Example Co.\n${lines}\nDear Sir:`);

  it.each([
    ['Amendment No. 2 to Registration Statement on Form S-1/A\nFiled May 1, 2025', ['S-1']],
    ['Draft Registration Statement on Form F-1\nSubmitted March 3, 2025', ['F-1']],
    ['Preliminary Proxy Statement on Schedule 14A\nFiled April 2, 2025', ['Schedule 14A']],
    ['Form DEFM14A filed June 1, 2025', ['Schedule 14A']],
    ['Registration Statement on Form 10-12B', ['10']],
    ['Schedule TO-T filed by Acquirer', ['Schedule TO']],
    ['Offering Statement on Form 1-A', ['1-A']],
    ['Form 20-F for the Fiscal Year Ended December 31, 2024\nForm 6-K furnished May 2, 2025', ['20-F', '6-K']],
    ['Form 10-KT for the transition period', []],
  ])('%s', (lines, forms) => {
    expect(deriveReviewedForms(block(lines)).forms).toEqual(forms);
  });

  it('returns no forms and no basis when the letter has no reference block', () => {
    expect(deriveReviewedForms('Thank you for your letter about our Form 10-K.')).toEqual({ forms: [], basis: null });
    expect(deriveReviewedForms(null)).toEqual({ forms: [], basis: null });
    expect(letterReferenceBlock('no block here')).toBeNull();
  });
});
