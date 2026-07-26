import { describe, it, expect } from 'vitest';
import { eftsDelegablePhrase, parseBooleanQuery } from '../utils/booleanSearch';

/**
 * Delegating a match to an index we do not control is only defensible where
 * the semantics have been demonstrated. These pin the boundary.
 */

const phraseOf = (query: string) => eftsDelegablePhrase(parseBooleanQuery(query).expression);

describe('eftsDelegablePhrase', () => {
  it('delegates a bare quoted phrase', () => {
    // Verified against the live index: "material weakness" reports ≥10,000
    // hits, the reversed "weakness material" reports 414 — EFTS quoted
    // phrases are exact adjacent matches, not bags of words.
    expect(phraseOf('"material weakness"')).toBe('material weakness');
    expect(phraseOf('  "revenue recognition"  ')).toBe('revenue recognition');
  });

  it('refuses every operator whose semantics are not demonstrated', () => {
    // Each of these would need EFTS to agree with our matcher on something we
    // have not tested, so they keep local validation.
    for (const query of [
      'lease AND impairment',
      '"material weakness" AND auditor:KPMG',
      'mezzanine OR "temporary equity"',
      'goodwill NOT impairment',
      'goodwill W/5 impairment',
      '"material weakness" OR restatement',
      'lease AND (842 OR 840)',
    ]) {
      expect(phraseOf(query), query).toBeNull();
    }
  });

  it('refuses a bare term and a single quoted word', () => {
    // Nothing to gain from phrase semantics, and a lone quoted word is more
    // often a stray quote than an intent.
    expect(phraseOf('restatement')).toBeNull();
    expect(phraseOf('"restatement"')).toBeNull();
  });

  it('refuses an unparseable expression rather than guessing', () => {
    expect(phraseOf('lease AND')).toBeNull();
    expect(phraseOf('')).toBeNull();
    expect(eftsDelegablePhrase(null)).toBeNull();
  });

  it('returns the phrase without its quotes, ready to re-issue', () => {
    const phrase = phraseOf('"internal control over financial reporting"');
    expect(phrase).toBe('internal control over financial reporting');
    expect(phrase).not.toContain('"');
  });
});
