import { describe, it, expect } from 'vitest';
import { compileBooleanQuery, planBooleanBranches } from '../utils/booleanSearch';

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

  it('widens morphology-sensitive phrase retrieval before local validation', () => {
    const { branches } = planBooleanBranches('"material weakness" OR goodwill');
    expect(branches).toContain('((material OR materials) AND (weakness OR weaknesses))');
    expect(branches).toContain('goodwill');
  });

  it('preserves an exact quoted lane when the phrase has no local morphology alternatives', () => {
    expect(planBooleanBranches('"net ai"').branches).toEqual(['"net ai"']);
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

  it('caps a Cartesian DNF explosion during construction', () => {
    // 2^20 logical branches. The planner must stop at its 16-branch proof
    // boundary rather than materialising 1,048,576 arrays first.
    const explosive = Array.from({ length: 20 }, (_, i) => `(a${i} OR b${i})`).join(' AND ');
    const planned = planBooleanBranches(explosive, 16);
    expect(planned.truncated).toBe(true);
    expect(planned.branches.length).toBeLessThanOrEqual(16);
  });

  it('rejects an explosive expression deterministically at compile time', () => {
    const explosive = Array.from({ length: 20 }, (_, i) => `(left${i} OR right${i})`).join(' AND ');
    const result = compileBooleanQuery(explosive);
    expect(result).toMatchObject({ ok: false, code: 'too-complex' });
  });

  it('does not reject syntactically repeated branches that collapse to one lane', () => {
    const redundant = Array.from({ length: 20 }, () => '(alpha OR alpha)').join(' AND ');
    const result = compileBooleanQuery(redundant);
    expect(result).toMatchObject({ ok: true, branches: ['alpha'] });
  });

  it('returns no branches for a pure-negation query', () => {
    expect(planBooleanBranches('NOT goodwill').branches).toEqual([]);
  });

  it('counts dropped unanchored disjuncts instead of discarding them silently', () => {
    // Audit R1: this count is what lets the retrieval planner promote a
    // firm-scoped lane to cover the branch — the silent-omission fix.
    const mixed = planBooleanBranches('impairment OR NOT goodwill');
    expect(mixed.branches).toEqual(['impairment']);
    expect(mixed.droppedUnanchored).toBe(1);
    expect(planBooleanBranches('alpha OR beta').droppedUnanchored).toBe(0);
    expect(planBooleanBranches('NOT goodwill').droppedUnanchored).toBe(1);
  });
});
