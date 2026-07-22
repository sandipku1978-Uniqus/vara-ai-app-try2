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
    { query: '"management\'s assessment"', text: 'management’s assessment concluded', expected: true },
    { query: '"management\'s assessment"', text: "management's assessment concluded", expected: true },
    { query: '"net income"', text: 'net-income increased', expected: true },
    { query: '"net income"', text: 'planet income increased', expected: false },
    { query: 'risk', text: 'brisk demand', expected: false },
    { query: 'audit', text: 'auditory signal', expected: false },
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
    expect(describeBooleanQueryIssue('lease OR auditor:KPMG')).toMatch(/only be combined with AND/i);
  });

  it('rejects NOT-composition', () => {
    expect(describeBooleanQueryIssue('lease AND NOT auditor:KPMG')).toMatch(/only be combined with AND/i);
  });
});
