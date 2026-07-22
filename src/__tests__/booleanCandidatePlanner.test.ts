import { describe, it, expect } from 'vitest';
import { planBooleanBranches } from '../utils/booleanSearch';

const norm = (branches: string[]) => branches.map(b => b.toLowerCase()).sort();

describe('planBooleanBranches', () => {
  it('gives each OR disjunct its own retrieval lane', () => {
    const { branches } = planBooleanBranches('mezzanine OR temporary');
    expect(norm(branches)).toEqual(['mezzanine', 'temporary']);
  });

  it('distributes AND across OR branches', () => {
    const { branches } = planBooleanBranches('(alpha OR beta) AND gamma');
    expect(norm(branches)).toEqual(['alpha gamma', 'beta gamma']);
  });

  it('keeps a single lane for a pure conjunction', () => {
    const { branches } = planBooleanBranches('alpha AND beta');
    expect(branches).toHaveLength(1);
    expect(branches[0].toLowerCase()).toContain('alpha');
    expect(branches[0].toLowerCase()).toContain('beta');
  });

  it('never lets NOT anchor a retrieval branch', () => {
    const { branches } = planBooleanBranches('alpha AND NOT beta');
    expect(norm(branches)).toEqual(['alpha']);
  });

  it('quotes multi-word phrase operands', () => {
    const { branches } = planBooleanBranches('"material weakness" OR goodwill');
    expect(branches).toContain('"material weakness"');
    expect(branches).toContain('goodwill');
  });

  it('preserves branches through nesting', () => {
    const { branches } = planBooleanBranches('(a OR b) AND (c OR d)');
    // a·c, a·d, b·c, b·d
    expect(branches).toHaveLength(4);
  });

  it('flags an over-complex query past the branch cap', () => {
    const huge = Array.from({ length: 20 }, (_, i) => `t${i}`).join(' OR ');
    const { truncated } = planBooleanBranches(huge, 16);
    expect(truncated).toBe(true);
  });

  it('returns no branches for a pure-negation query', () => {
    expect(planBooleanBranches('NOT goodwill').branches).toEqual([]);
  });
});
