import { describe, it, expect } from 'vitest';
import {
  parseBooleanQuery,
  booleanQueryMatches,
  buildBooleanCandidateQueries,
  describeBooleanQueryIssue,
} from '../utils/booleanSearch';

describe('boolean proximity with more than two operands', () => {
  // A trailing term after a proximity pair must fall through to implicit AND,
  // NOT be merged into a forced adjacent phrase with the right operand.
  it('parses "a w/5 b c" as (a w/5 b) AND c', () => {
    const parsed = parseBooleanQuery('lease w/5 modification accounting');
    expect(parsed.expression?.type).toBe('AND');
    // The proximity node survives as the AND's left branch.
    expect(parsed.expression && 'left' in parsed.expression && parsed.expression.left.type).toBe('PROX');
  });

  it('matches when the proximity pair is close and the extra term appears anywhere', () => {
    const doc = 'The office lease modification took effect. Separately, our accounting policy was updated.';
    expect(booleanQueryMatches('lease w/5 modification accounting', doc)).toBe(true);
  });

  it('does not force the leading terms into an adjacent phrase', () => {
    // "lease" and "modification" never appear adjacently here, but "modification"
    // sits right next to "ASC". Old greedy-merge behavior required the literal
    // phrase "lease modification" and wrongly returned false.
    const doc = 'Leases are common in our industry. Separately, ASC 842 modification guidance applies.';
    expect(booleanQueryMatches('lease modification w/5 asc', doc)).toBe(true);
  });

  it('still enforces the proximity distance', () => {
    const doc = 'Material issues were noted, and much later a significant weakness surfaced in a distant paragraph.';
    expect(booleanQueryMatches('material w/1 weakness', doc)).toBe(false);
  });
});

describe('candidate query hygiene', () => {
  it('offers an OR union candidate for an OR query', () => {
    const cands = buildBooleanCandidateQueries('impairment OR restructuring');
    expect(cands.some(c => c.includes(' OR '))).toBe(true);
  });

  it('no longer emits non-word "-ation" stems', () => {
    const cands = buildBooleanCandidateQueries('lease modification').join(' ');
    expect(cands).not.toMatch(/modific(ed|ing|s)?\b/);
  });
});

describe('describeBooleanQueryIssue', () => {
  it('accepts a well-formed query', () => {
    expect(describeBooleanQueryIssue('revenue AND (lease OR sublease)')).toBeNull();
    expect(describeBooleanQueryIssue('material w/5 weakness')).toBeNull();
  });

  it('flags a dangling operator', () => {
    expect(describeBooleanQueryIssue('lease AND')).toMatch(/operator/i);
  });

  it('flags unbalanced parentheses', () => {
    expect(describeBooleanQueryIssue('(revenue AND growth')).toMatch(/parenthes/i);
  });

  it('tolerates an unclosed quote by treating the rest as a phrase', () => {
    // The tokenizer closes a dangling quote at end-of-input, so this still runs.
    expect(describeBooleanQueryIssue('"lease modification')).toBeNull();
  });

  it('flags a negation-only query', () => {
    expect(describeBooleanQueryIssue('NOT goodwill')).toMatch(/negated/i);
  });

  it('ignores an empty query (nothing to run)', () => {
    expect(describeBooleanQueryIssue('   ')).toBeNull();
  });
});
