import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAMEWORK_KB_ENTRIES,
  MAX_EXCERPT_CHARS,
  MAX_EXCERPT_COUNT,
  extractStandardIds,
  selectFrameworkExcerpts,
  type FrameworkKbEntry,
} from '../lib/framework-excerpts';

function syntheticEntry(index: number, body: string): FrameworkKbEntry {
  return {
    framework: 'IFRS',
    id: `IFRS ${90 + index}`,
    title: 'Leases',
    equivalentTo: 'ASC 842',
    keyDifferences: [body],
  };
}

describe('framework knowledge base excerpt selection', () => {
  it('loads every curated entry from both framework knowledge bases', () => {
    expect(DEFAULT_FRAMEWORK_KB_ENTRIES.map(entry => entry.id)).toEqual([
      'IFRS 15', 'IFRS 16', 'IFRS 9', 'Ind AS 115', 'Ind AS 116', 'Ind AS 109',
    ]);
  });

  it('detects standard identifiers in free text', () => {
    expect(extractStandardIds('Compare ASC 842 with IFRS 16 and Ind AS 116 (not IAS 17), then ASC 606-10-25.'))
      .toEqual(['ASC 842', 'IFRS 16', 'Ind AS 116', 'IAS 17', 'ASC 606']);
  });

  it('ranks the entries that name the question\'s standard first and numbers them densely', () => {
    const selection = selectFrameworkExcerpts('How does a lessee account for leases under ASC 842 versus IFRS 16?');

    expect(selection.coverage).toBe('grounded');
    expect(selection.matchedTopics).toEqual(['ASC 842', 'IFRS 16']);
    expect(selection.excerpts.map(excerpt => excerpt.id)).toEqual(['IFRS 16', 'Ind AS 116']);
    expect(selection.excerpts.map(excerpt => excerpt.n)).toEqual([1, 2]);
    expect(selection.excerpts[0]).toMatchObject({ framework: 'IFRS', title: 'Leases', reference: 'ASC 842' });
    expect(selection.excerpts[0].text).toContain('- Under IFRS 16, there is a single lessee accounting model');
  });

  it('uses a chosen Codification topic even when the question never names a standard', () => {
    const selection = selectFrameworkExcerpts('Is there a low-value asset exemption?', '842');

    expect(selection.coverage).toBe('grounded');
    expect(selection.matchedTopics).toEqual(['ASC 842']);
    expect(selection.excerpts[0].id).toBe('IFRS 16');
    expect(selection.excerpts.map(excerpt => excerpt.id)).not.toContain('IFRS 15');
  });

  it('finds relevant entries by keyword overlap when no identifier is given', () => {
    const selection = selectFrameworkExcerpts('What collectibility threshold applies to revenue contracts?');

    expect(selection.coverage).toBe('grounded');
    expect(selection.matchedTopics).toEqual([]);
    expect(selection.excerpts.map(excerpt => excerpt.id)).toEqual(['IFRS 15', 'Ind AS 115']);
    expect(selection.excerpts[0].text).toContain('Disclosure requirements:');
  });

  it('reports no coverage for a question the knowledge base does not address', () => {
    const selection = selectFrameworkExcerpts('How do I account for a modification of a stock option under ASC 718?');

    expect(selection).toEqual({ coverage: 'none', excerpts: [], matchedTopics: ['ASC 718'] });
  });

  it('never sends the whole knowledge base: the character budget bounds the selection', () => {
    const entries = Array.from({ length: 12 }, (_, index) => (
      syntheticEntry(index, `Lease entry ${index}. ${'The lessee recognizes a lease liability. '.repeat(55)}`)
    ));
    const selection = selectFrameworkExcerpts('lease accounting for a lessee under ASC 842', null, entries);
    const totalChars = selection.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0);

    expect(selection.coverage).toBe('grounded');
    expect(totalChars).toBeLessThanOrEqual(MAX_EXCERPT_CHARS);
    expect(selection.excerpts.length).toBeGreaterThan(1);
    expect(selection.excerpts.length).toBeLessThan(entries.length);
    expect(selection.excerpts.map(excerpt => excerpt.n)).toEqual(selection.excerpts.map((_, index) => index + 1));
  });

  it('caps the number of excerpts even when they are small', () => {
    const entries = Array.from({ length: 12 }, (_, index) => syntheticEntry(index, `Short lease point ${index}.`));
    const selection = selectFrameworkExcerpts('lease question', null, entries);

    expect(selection.excerpts).toHaveLength(MAX_EXCERPT_COUNT);
  });

  it('truncates a single oversized top excerpt instead of dropping all coverage', () => {
    const entries = [syntheticEntry(0, 'lease '.repeat(4_000))];
    const selection = selectFrameworkExcerpts('leases', null, entries);

    expect(selection.coverage).toBe('grounded');
    expect(selection.excerpts[0].text.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS);
    expect(selection.excerpts[0].text.endsWith('[excerpt truncated]')).toBe(true);
  });
});
