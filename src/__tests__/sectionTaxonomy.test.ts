import { describe, it, expect } from 'vitest';
import { describeSectionScope, extractResolvedSection, formFamily, resolveSectionScope } from '../utils/sectionTaxonomy';
import { extractItemSection } from '../utils/sectionPath';

/**
 * Benchmark P2-C1: the cross-form section taxonomy. The whole point is that
 * one concept resolves DIFFERENTLY per form — Risk Factors is Item 1A on a
 * 10-K but Part II Item 1A on a 10-Q, and MD&A is Item 7 vs Part I Item 2 —
 * and that an unmapped form yields no slice rather than a wrong one.
 */

describe('formFamily', () => {
  it('roots amendments and transition forms to their family', () => {
    expect(formFamily('10-K/A')).toBe('10-K');
    expect(formFamily('10-KT')).toBe('10-K');
    expect(formFamily('10-Q/A')).toBe('10-Q');
    expect(formFamily('20-F')).toBe('20-F');
    expect(formFamily('8-K')).toBeNull();
    expect(formFamily('S-1')).toBe('S-1');
  });
});

describe('resolveSectionScope', () => {
  it('resolves a concept per form family', () => {
    expect(resolveSectionScope('risk factors', '10-K')).toEqual({ kind: 'item', item: '1a', options: {}, label: 'Risk Factors' });
    expect(resolveSectionScope('risk factors', '10-Q')).toEqual({ kind: 'item', item: '1a', options: { part: 2 }, label: 'Risk Factors' });
    expect(resolveSectionScope('MD&A', '10-K')).toEqual({ kind: 'item', item: '7', options: {}, label: 'MD&A' });
    expect(resolveSectionScope('MD&A', '10-Q/A')).toEqual({ kind: 'item', item: '2', options: { part: 1 }, label: 'MD&A' });
    expect(resolveSectionScope('mdna', '20-F')).toEqual({ kind: 'item', item: '5', options: {}, label: 'MD&A' });
  });

  it('passes explicit item numbers through to any form', () => {
    expect(resolveSectionScope('9A', '10-K')).toEqual({ kind: 'item', item: '9a', options: {}, label: 'Item 9A' });
    expect(resolveSectionScope('2.02', '8-K')).toEqual({ kind: 'item', item: '2.02', options: {}, label: 'Item 2.02' });
  });

  it('returns null for unmapped forms and unknown concepts — never a guess', () => {
    expect(resolveSectionScope('business', '10-Q')).toBeNull();
    // risk factors on an S-1 now resolves as a HEADING scope (see headingSlicing tests).
    expect(resolveSectionScope('controls', 'S-1')).toBeNull();
    expect(resolveSectionScope('prospectus summary', '10-K')).toBeNull();
  });

  it('describes scopes for UI chips', () => {
    expect(describeSectionScope('risk factors')).toBe('Risk Factors');
    expect(describeSectionScope('1a')).toBe('Item 1A');
  });
});

describe('part-aware slicing on a 10-Q', () => {
  const TEN_Q = [
    'TABLE OF CONTENTS',
    'Part I Item 1. Financial Statements 2',
    'Part I Item 2. Management’s Discussion and Analysis 20',
    'Part II Item 1. Legal Proceedings 30',
    'Part II Item 2. Unregistered Sales 31',
    'PART I',
    'Item 1. Financial Statements',
    'The condensed consolidated balance sheets present cash of $12.5 million.',
    'Item 2. Management’s Discussion and Analysis of Financial Condition',
    'Revenue increased due to volume growth. Liquidity remains sufficient for operations.',
    'PART II',
    'Item 1. Legal Proceedings',
    'A supplier dispute is pending in Delaware.',
    'Item 2. Unregistered Sales of Equity Securities',
    'The company repurchased shares under its program.',
  ].join('\n');

  it('MD&A resolves to Part I Item 2, not Unregistered Sales', () => {
    const resolved = resolveSectionScope('MD&A', '10-Q')!;
    const slice = extractResolvedSection(TEN_Q, resolved);
    expect(slice).toContain('revenue increased');
    expect(slice).not.toContain('repurchased shares');
  });

  it('Legal Proceedings resolves to Part II Item 1, not Financial Statements', () => {
    const resolved = resolveSectionScope('legal proceedings', '10-Q')!;
    const slice = extractResolvedSection(TEN_Q, resolved);
    expect(slice).toContain('supplier dispute');
    expect(slice).not.toContain('balance sheets');
  });

  it('a part-2 request on a filing without a Part II yields nothing', () => {
    const noPartTwo = 'PART I\nItem 1. Financial Statements\nnumbers here';
    expect(extractItemSection(noPartTwo, '1', { part: 2 })).toBe('');
  });
});
