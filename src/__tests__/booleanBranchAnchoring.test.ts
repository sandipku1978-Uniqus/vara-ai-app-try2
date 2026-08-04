import { describe, it, expect } from 'vitest';
import {
  booleanQueryMatches,
  compileBooleanQuery,
  findUnanchoredBranch,
  parseBooleanQuery,
  planBooleanBranches,
} from '../utils/booleanSearch';

/**
 * Remediation handoff 2026-07-31, WP3: an accepted Boolean expression must
 * never have a silently discarded retrieval branch. Before this fixture set,
 * planBooleanBranches dropped a NOT-only OR disjunct on the floor — "A OR
 * NOT B" retrieved only A while presenting results as the full expression.
 * The rule is the house style everywhere else: reject honestly, never
 * approximate silently.
 */

function expectRejected(query: string, code: string, messagePart: string) {
  const result = compileBooleanQuery(query);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    expect(result.message.toLowerCase()).toContain(messagePart.toLowerCase());
  }
}

describe('unanchored OR branch rejection', () => {
  it('rejects A OR NOT B — the negative branch cannot be retrieved', () => {
    expectRejected('impairment OR NOT goodwill', 'unanchored-branch', 'NOT goodwill');
  });

  it('rejects a wildcard-only OR branch', () => {
    expectRejected('impairment OR crypto*', 'unanchored-branch', 'crypto*');
  });

  it('rejects a numeric-only OR branch', () => {
    expectRejected('impairment OR $#', 'unanchored-branch', '$#');
  });

  it('rejects an unanchored branch buried in nesting', () => {
    expectRejected('("material weakness" AND remediation) OR (NOT restatement)', 'unanchored-branch', 'NOT restatement');
  });

  it('an all-negative query still gets the more specific whole-query message', () => {
    // Zero positive terms anywhere → the earlier negative-only check owns it.
    expectRejected('NOT impairment OR NOT goodwill', 'negative-only', 'not negated');
  });

  it('rejects when only ONE distributed branch lacks an anchor', () => {
    // (a OR NOT b) AND c distributes to [a c] and [NOT b c] — both anchored by
    // c. But (a AND b) OR (NOT c AND NOT d) leaves a pure-negative branch.
    expectRejected('(impairment AND goodwill) OR (NOT restatement AND NOT weakness)', 'unanchored-branch', 'NOT restatement');
  });

  it('names the branch and gives an actionable rewrite in the message', () => {
    const result = compileBooleanQuery('cyber OR NOT breach');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('NOT breach');
      expect(result.message).toContain('AND');
    }
  });
});

describe('branches that carry their own anchor stay accepted', () => {
  it('accepts NOT inside an anchored conjunction: (a AND NOT b) OR c', () => {
    const result = compileBooleanQuery('(impairment AND NOT goodwill) OR restatement');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.branches).toEqual(['impairment', 'restatement']);
    }
  });

  it('accepts a wildcard branch anchored by a concrete companion', () => {
    const result = compileBooleanQuery('impairment OR (crypto* AND blockchain)');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.branches).toContain('impairment');
      expect(result.branches.some(branch => branch.includes('blockchain'))).toBe(true);
    }
  });

  it('accepts a numeric operand anchored through proximity', () => {
    const result = compileBooleanQuery('restatement OR ("goodwill impairment" w/10 $#)');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.branches.some(branch => branch.includes('goodwill impairment'))).toBe(true);
    }
  });

  it('accepts the MIXED residual: the firm lane is the negative branch\'s retrieval (slice 2)', () => {
    // Audit R1 history: the old waiver accepted this and silently DROPPED
    // the "NOT goodwill" lane; slice 1 rejected it with a remedy; slice 2
    // added the required firm-scoped lane, making acceptance honest.
    const result = compileBooleanQuery('auditor:PwC AND (impairment OR NOT goodwill)');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.auditor).toBe('PwC');
  });

  it('keeps the firm-anchored PURE-negative form accepted (executable today)', () => {
    // One firm-scoped lane retrieves; NOT validates everything it returns.
    const result = compileBooleanQuery('auditor:PwC AND NOT goodwill');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.auditor).toBe('PwC');
  });
});

describe('double negation is decided by parity', () => {
  it('NOT NOT a compiles as a positive query', () => {
    const result = compileBooleanQuery('NOT NOT cyber');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.branches).toEqual(['cyber']);
  });

  it('NOT NOT a OR b plans both branches', () => {
    expect(planBooleanBranches('NOT NOT cyber OR breach').branches).toEqual(['cyber', 'breach']);
  });

  it('parse tree collapses NOT NOT and keeps odd parity negative', () => {
    expect(parseBooleanQuery('NOT NOT cyber').expression).toEqual({ type: 'TERM', value: 'cyber' });
    expect(parseBooleanQuery('NOT NOT NOT cyber').expression).toEqual({
      type: 'NOT',
      child: { type: 'TERM', value: 'cyber' },
    });
  });

  it('evaluation semantics are unchanged by normalization', () => {
    expect(booleanQueryMatches('NOT NOT cyber', 'a cyber incident occurred')).toBe(true);
    expect(booleanQueryMatches('NOT NOT cyber', 'nothing relevant here')).toBe(false);
    expect(booleanQueryMatches('NOT NOT NOT cyber', 'a cyber incident occurred')).toBe(false);
  });
});

describe('findUnanchoredBranch', () => {
  it('returns null for fully anchored expressions', () => {
    const parsed = parseBooleanQuery('(a AND NOT b) OR c');
    expect(parsed.expression && findUnanchoredBranch(parsed.expression)).toBeNull();
  });

  it('reports wildcard over negation when a branch mixes both', () => {
    const parsed = parseBooleanQuery('a OR (crypto* AND NOT breach)');
    const issue = parsed.expression && findUnanchoredBranch(parsed.expression);
    expect(issue?.reason).toBe('wildcard');
  });

  it('gives up (returns null) past the expansion cap instead of mislabeling', () => {
    // 2^10 = 1024 branches > 256 cap; the too-complex check owns this case.
    const clause = '(a OR NOT b)';
    const parsed = parseBooleanQuery(Array.from({ length: 10 }, () => clause).join(' AND '));
    expect(parsed.expression && findUnanchoredBranch(parsed.expression)).toBeNull();
  });
});
