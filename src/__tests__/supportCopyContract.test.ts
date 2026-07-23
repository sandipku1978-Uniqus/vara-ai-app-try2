import { describe, it, expect } from 'vitest';
import { booleanQueryMatches, describeBooleanQueryIssue } from '../utils/booleanSearch';

/**
 * Executable fixtures for the Boolean behaviour promised in Support Center copy
 * (src/views/SupportCenter.tsx → "Research Workbench Deep Dive") and the
 * Workbench sample chips. If we change matching semantics, these fail — so the
 * help text can never quietly describe behaviour we no longer ship.
 */

// Every example query printed in help must be syntactically valid and runnable.
const DOCUMENTED_EXAMPLES = [
  '"material weakness" AND auditor:KPMG',
  'auditor:"Ernst & Young"',
  '(impairment OR restructuring) AND lease',
  'ASC 842 adoption w/10 lease',
  'ASR w/5 derivative',
  'material w/5 weakness',
  'goodwill near/10 impairment',
];

describe('Support Center Boolean copy is executable', () => {
  it.each(DOCUMENTED_EXAMPLES)('documented example parses and runs: %s', example => {
    expect(describeBooleanQueryIssue(example)).toBeNull();
  });

  it('bare terms: whole words with singular/plural equivalence, no broad stemming', () => {
    expect(booleanQueryMatches('lease', 'several operating leases')).toBe(true);
    expect(booleanQueryMatches('weakness', 'two material weaknesses')).toBe(true);
    expect(booleanQueryMatches('audit', 'an auditory signal')).toBe(false);
  });

  it('quoted phrases are bounded to whole words', () => {
    expect(booleanQueryMatches('"net income"', 'net income rose')).toBe(true);
    expect(booleanQueryMatches('"net income"', 'planet income rose')).toBe(false);
  });

  it('punctuation normalises symmetrically', () => {
    expect(booleanQueryMatches('10-K', 'filed its Form 10 K')).toBe(true);
    expect(booleanQueryMatches('non-GAAP', 'a non GAAP measure')).toBe(true);
    expect(booleanQueryMatches('R&D', 'R & D expenditures')).toBe(true);
    expect(booleanQueryMatches('U.S. GAAP', 'prepared under US GAAP')).toBe(true);
  });

  it('invalid syntax is reported and runs no search', () => {
    expect(describeBooleanQueryIssue('lease AND')).toMatch(/operator/i);
    expect(describeBooleanQueryIssue('(revenue AND growth')).toMatch(/parenthes/i);
    expect(describeBooleanQueryIssue('NOT goodwill')).toMatch(/negated/i);
  });

  it('auditor: is allowed in AND context and rejected inside OR/NOT', () => {
    expect(describeBooleanQueryIssue('"material weakness" AND auditor:KPMG')).toBeNull();
    expect(describeBooleanQueryIssue('lease OR auditor:KPMG')).toMatch(/auditor/i);
    expect(describeBooleanQueryIssue('lease AND NOT auditor:KPMG')).toMatch(/auditor/i);
  });
});
