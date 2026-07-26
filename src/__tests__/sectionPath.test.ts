import { describe, it, expect } from 'vitest';
import { deriveSectionPath } from '../utils/sectionPath';
import { extractBooleanMatchSnippet } from '../utils/booleanSearch';

/**
 * Section breadcrumbs (benchmark A2) must be honest: named from the filing's
 * own structure, never guessed. These pin the derivation rules.
 */

const TEN_K = [
  'PART I',
  'Item 1. Business',
  'The company designs and sells widgets across three segments.',
  'Item 1A. Risk Factors',
  'Our operations depend on suppliers. See Item 7 for liquidity discussion.',
  'We identified a material weakness in our internal control over financial reporting.',
  'Item 2. Properties',
  'The company leases offices in Austin.',
  'PART II',
  'Item 9A. Controls and Procedures',
  'Management concluded the previously reported material weakness was remediated during the year.',
].join('\n');

const TEN_Q_PART_II = [
  'PART II — OTHER INFORMATION',
  'Item 2. Unregistered Sales of Equity Securities and Use of Proceeds',
  'During the quarter the company repurchased shares under its buyback program.',
].join('\n');

const EIGHT_K = [
  'Item 2.02 Results of Operations and Financial Condition.',
  'On July 25 the registrant issued a press release announcing a goodwill impairment charge of $206.6 million.',
].join('\n');

describe('deriveSectionPath', () => {
  it('names the item whose section contains the match', () => {
    const snippet = extractBooleanMatchSnippet('"material weakness"', TEN_K);
    // First occurrence lives under Item 1A, not the later 9A remediation.
    expect(deriveSectionPath(TEN_K, snippet!.excerpt)).toBe('Item 1A · Risk Factors');
  });

  it('is not fooled by a cross-reference between the heading and the match', () => {
    // "See Item 7" sits between the Item 1A heading and the matched sentence.
    const snippet = extractBooleanMatchSnippet('"internal control over financial reporting"', TEN_K);
    expect(deriveSectionPath(TEN_K, snippet!.excerpt)).toBe('Item 1A · Risk Factors');
  });

  it('uses the canonical title only when the filing text agrees with it', () => {
    // 10-Q Part II Item 2 is Unregistered Sales — it must NOT become the
    // 10-K's "Properties".
    const snippet = extractBooleanMatchSnippet('repurchased', TEN_Q_PART_II);
    const path = deriveSectionPath(TEN_Q_PART_II, snippet!.excerpt);
    expect(path.startsWith('Item 2')).toBe(true);
    expect(path).not.toContain('Properties');
    expect(path.toLowerCase()).toContain('unregistered sales');
  });

  it('handles dotted 8-K item numbers', () => {
    const snippet = extractBooleanMatchSnippet('"goodwill impairment" W/10 $#', EIGHT_K);
    expect(deriveSectionPath(EIGHT_K, snippet!.excerpt)).toBe(
      'Item 2.02 · Results of Operations and Financial Condition'
    );
  });

  it('returns nothing rather than guessing when no heading precedes the match', () => {
    const text = 'This exhibit describes a goodwill impairment with no item structure at all.';
    const snippet = extractBooleanMatchSnippet('"goodwill impairment"', text);
    expect(deriveSectionPath(text, snippet!.excerpt)).toBe('');
  });

  it('returns nothing for empty inputs', () => {
    expect(deriveSectionPath('', 'anything')).toBe('');
    expect(deriveSectionPath(TEN_K, '')).toBe('');
  });
});
