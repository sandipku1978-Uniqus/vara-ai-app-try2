import { describe, it, expect } from 'vitest';
import {
  parseBooleanQuery,
  booleanQueryMatches,
  buildBooleanCandidateQueries,
  describeBooleanQueryIssue,
  extractAuditorFilterToken,
  looksLikeBooleanQuery,
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
    const doc = 'A lease is common in our industry. Separately, ASC 842 modification guidance applies.';
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

  it('rejects an unclosed quote', () => {
    expect(describeBooleanQueryIssue('"lease modification')).toMatch(/quot/i);
  });

  it('flags a negation-only query', () => {
    expect(describeBooleanQueryIssue('NOT goodwill')).toMatch(/negated/i);
  });

  it('ignores an empty query (nothing to run)', () => {
    expect(describeBooleanQueryIssue('   ')).toBeNull();
  });

  it('accepts an auditor-only query as valid (no residual expression needed)', () => {
    expect(describeBooleanQueryIssue('auditor:KPMG')).toBeNull();
  });

  it('accepts a negation combined with an auditor anchor', () => {
    expect(describeBooleanQueryIssue('NOT goodwill AND auditor:PwC')).toBeNull();
  });
});

describe('inline auditor field token', () => {
  it('extracts a bare firm and leaves the residual expression clean', () => {
    const { auditor, residual } = extractAuditorFilterToken('"material weakness" AND auditor:Deloitte');
    expect(auditor).toBe('Deloitte');
    expect(residual).toBe('"material weakness"');
  });

  it('supports a quoted multi-word firm', () => {
    const { auditor, residual } = extractAuditorFilterToken('lease AND auditor:"Ernst & Young"');
    expect(auditor).toBe('Ernst & Young');
    expect(residual).toBe('lease');
  });

  it('handles the token at the front of the query', () => {
    const { auditor, residual } = extractAuditorFilterToken('auditor:KPMG OR restructuring');
    expect(auditor).toBe('KPMG');
    expect(residual).toBe('restructuring');
  });

  it('returns an empty residual for an auditor-only query', () => {
    const { auditor, residual } = extractAuditorFilterToken('auditor:PwC');
    expect(auditor).toBe('PwC');
    expect(residual).toBe('');
  });

  it('accepts accountant: and audited_by: aliases', () => {
    expect(extractAuditorFilterToken('accountant:BDO').auditor).toBe('BDO');
    expect(extractAuditorFilterToken('audited_by:Deloitte').auditor).toBe('Deloitte');
  });

  it('is a no-op when no field token is present', () => {
    const { auditor, residual } = extractAuditorFilterToken('lease AND modification');
    expect(auditor).toBe('');
    expect(residual).toBe('lease AND modification');
  });

  it('auto-detects the auditor field as Boolean syntax', () => {
    expect(looksLikeBooleanQuery('auditor:Deloitte')).toBe(true);
  });
});
