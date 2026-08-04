import { describe, it, expect } from 'vitest';
import { booleanQueryMatches, describeBooleanQueryIssue } from '../utils/booleanSearch';

// Contract fixtures from the Boolean remediation plan §4. These pin the
// normalized-matcher behavior: token boundaries, symmetric punctuation, and no
// substring/stemming surprises.
describe('Boolean matching contract', () => {
  const cases: Array<{ query: string; text: string; expected: boolean }> = [
    { query: '10-K', text: 'Form 10-K', expected: true },
    { query: 'non-GAAP', text: 'non GAAP measure', expected: true },
    { query: 'R&D', text: 'R & D expenditures', expected: true },
    { query: 'U.S. GAAP', text: 'US GAAP', expected: true },
    { query: 'ASC-842', text: 'adopted ASC 842 in fiscal 2026', expected: true },
    { query: '"management\'s assessment"', text: 'management’s assessment concluded', expected: true },
    { query: '"management\'s assessment"', text: "management's assessment concluded", expected: true },
    { query: '"net income"', text: 'net-income increased', expected: true },
    { query: '"net income"', text: 'planet income increased', expected: false },
    { query: 'risk', text: 'brisk demand', expected: false },
    { query: 'audit', text: 'auditory signal', expected: false },
    // Singular/plural equivalence (symmetric), but not broad stemming.
    { query: 'lease', text: 'several operating leases', expected: true },
    { query: 'weaknesses', text: 'a material weakness', expected: true },
    { query: 'company', text: 'the companies reported', expected: true },
    { query: '"material weakness"', text: 'two material weaknesses were noted', expected: true },
    { query: 'filing', text: 'the company filed a report', expected: false },
  ];

  for (const { query, text, expected } of cases) {
    it(`${JSON.stringify(query)} vs ${JSON.stringify(text)} → ${expected ? 'match' : 'no match'}`, () => {
      expect(booleanQueryMatches(query, text)).toBe(expected);
    });
  }
});

describe('auditor: token is AND-only', () => {
  it('accepts AND-composition', () => {
    expect(describeBooleanQueryIssue('"material weakness" AND auditor:KPMG')).toBeNull();
    expect(describeBooleanQueryIssue('auditor:Deloitte')).toBeNull();
  });

  it('rejects OR-composition', () => {
    // Audit R1: placement is judged on the AST now; the message explains the
    // precedence problem instead of just naming the rule.
    expect(describeBooleanQueryIssue('lease OR auditor:KPMG')).toMatch(/applies to only part of this query/i);
  });

  it('rejects NOT-composition', () => {
    expect(describeBooleanQueryIssue('lease AND NOT auditor:KPMG')).toMatch(/applies to only part of this query/i);
  });
});

describe('proximity operand forms (plan §4 "Complex proximity")', () => {
  it('accepts term/phrase operands', () => {
    expect(describeBooleanQueryIssue('material w/5 weakness')).toBeNull();
    expect(describeBooleanQueryIssue('"internal control" w/5 weakness')).toBeNull();
  });

  it('rejects a grouped operand instead of returning a silent zero', () => {
    // "(a OR b) w/5 c" parses cleanly but can never match, because span lookup
    // is only defined for terms and phrases — it must not look authoritative.
    expect(describeBooleanQueryIssue('(lease OR rent) w/5 modification')).toMatch(/proximity/i);
  });

  it('rejects chained proximity with specific guidance, not a generic parse error', () => {
    expect(describeBooleanQueryIssue('a w/5 b w/5 c')).toMatch(/proximity/i);
  });
});
