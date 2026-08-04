import { describe, it, expect } from 'vitest';
import { defaultSearchFilters } from '../domain/searchFilters';
import {
  aggregateExactCount,
  isEftsExactCountEquivalent,
  planMonthSlices,
  planYearSlices,
  type SliceCounter,
} from '../services/exactCount';

/**
 * Exact counting above EDGAR's 10,000 ceiling: date slices count exactly and
 * sum; a saturated year splits into months; a saturated MONTH keeps the
 * result an honest floor — precision is upgraded, exactness is never faked.
 */

describe('slice planning', () => {
  it('covers the full-text-search era by default', () => {
    const slices = planYearSlices(undefined, undefined);
    expect(slices[0].start).toBe('2001-01-01');
    expect(slices[slices.length - 1].end.slice(0, 4)).toBe(String(new Date().getFullYear()));
  });

  it('respects a custom window at the edges', () => {
    const slices = planYearSlices('2023-03-15', '2025-06-30');
    expect(slices).toHaveLength(3);
    expect(slices[0]).toEqual({ start: '2023-03-15', end: '2023-12-31' });
    expect(slices[2]).toEqual({ start: '2025-01-01', end: '2025-06-30' });
  });

  it('plans month slices with correct end-of-month days, clipped to the window', () => {
    const months = planMonthSlices('2024-01-01', '2024-12-31');
    expect(months).toHaveLength(12);
    expect(months[1]).toEqual({ start: '2024-02-01', end: '2024-02-29' }); // leap year
    const clipped = planMonthSlices('2024-11-15', '2024-12-31');
    expect(clipped).toHaveLength(2);
    expect(clipped[0]).toEqual({ start: '2024-11-15', end: '2024-11-30' });
  });
});

describe('EFTS exact-count eligibility', () => {
  it('accepts only the demonstrated delegated exact-phrase predicate', () => {
    expect(isEftsExactCountEquivalent('"net ai"', { ...defaultSearchFilters })).toBe(true);
  });

  it.each([
    ['NOT', 'goodwill AND NOT impairment'],
    ['proximity', 'goodwill W/5 impairment'],
    ['wildcard', 'blockchain AND crypto*'],
    ['local singular/plural term matching', 'lease'],
    ['multi-branch Boolean', 'lease OR impairment'],
  ])('refuses %s semantics that raw EFTS totals do not count', (_label, query) => {
    expect(isEftsExactCountEquivalent(query, { ...defaultSearchFilters })).toBe(false);
  });

  it('refuses local metadata/text filters omitted from the EFTS count request', () => {
    expect(isEftsExactCountEquivalent('"material weakness"', {
      ...defaultSearchFilters,
      sectionScope: '9A',
    })).toBe(false);
  });
});

describe('aggregation', () => {
  it('sums exact yearly counts', async () => {
    const counter: SliceCounter = async () => ({ total: 100, saturated: false });
    const result = await aggregateExactCount(counter, '2020-01-01', '2022-12-31');
    expect(result).toEqual({ total: 300, floor: false, requests: 3 });
  });

  it('splits a saturated year into months and sums those instead', async () => {
    const counter: SliceCounter = async (start, end) => {
      const isFullYear = start.endsWith('-01-01') && end.endsWith('-12-31');
      if (isFullYear && start.startsWith('2021')) return { total: 10_000, saturated: true };
      if (start.startsWith('2021')) return { total: 900, saturated: false }; // each month
      return { total: 50, saturated: false };
    };
    const result = await aggregateExactCount(counter, '2020-01-01', '2022-12-31');
    // 2020: 50 · 2021: 12 × 900 (year count of 10,000 discarded) · 2022: 50
    expect(result.total).toBe(50 + 12 * 900 + 50);
    expect(result.floor).toBe(false);
    expect(result.requests).toBe(3 + 12);
  });

  it('keeps the result a floor when even a month saturates', async () => {
    const counter: SliceCounter = async (start, end) => {
      const isFullYear = start.endsWith('-01-01') && end.endsWith('-12-31');
      if (isFullYear) return { total: 10_000, saturated: true };
      return { total: 10_000, saturated: true }; // every month saturates too
    };
    const result = await aggregateExactCount(counter, '2024-01-01', '2024-12-31');
    expect(result.floor).toBe(true);
    expect(result.total).toBe(12 * 10_000);
  });

  it('a failed slice is skipped and the sum becomes a floor, never an abort', async () => {
    const counter: SliceCounter = async start => {
      if (start.startsWith('2021')) throw new Error('SEC 500');
      return { total: 100, saturated: false };
    };
    const result = await aggregateExactCount(counter, '2020-01-01', '2022-12-31');
    expect(result.total).toBe(200);
    expect(result.floor).toBe(true);
    expect(result.requests).toBe(3);
  });

  it('reports progress labels per slice', async () => {
    const labels: string[] = [];
    const counter: SliceCounter = async start =>
      start.endsWith('-01-01') && start.startsWith('2020') ? { total: 10_000, saturated: true } : { total: 1, saturated: false };
    await aggregateExactCount(counter, '2020-01-01', '2020-12-31', label => labels.push(label));
    expect(labels[0]).toBe('2020');
    expect(labels).toContain('2020-01');
    expect(labels).toContain('2020-12');
  });
});
