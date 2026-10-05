import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyFacts, XbrlFact } from '../services/secApi';
import {
  __clearCompanySizeCache,
  classifyAgainstSeed,
  DEFAULT_SIZE_BAND,
  formatMultiple,
  loadCompanySizes,
  rankByBand,
  readAnnualRevenue,
  readPublicFloat,
  sizeFromFacts,
  type CompanySize,
} from '../services/peerSizing';

function fact(val: number, end: string, extra: Partial<XbrlFact> = {}): XbrlFact {
  return { val, end, accn: `acc-${end}`, fy: Number(end.slice(0, 4)), fp: 'FY', form: '10-K', filed: `${end.slice(0, 4)}-11-01`, ...extra };
}

function facts(overrides: Partial<CompanyFacts['facts']> = {}): CompanyFacts {
  return {
    cik: 1,
    entityName: 'Test Co',
    facts: {
      dei: {
        EntityPublicFloat: {
          label: 'Entity Public Float',
          description: '',
          units: { USD: [fact(800e9, '2023-03-31'), fact(1_000e9, '2024-03-29', { accn: '0000000001-24-000001' })] },
        },
      },
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          label: 'Revenue',
          description: '',
          units: {
            USD: [
              fact(380e9, '2023-09-30', { start: '2022-10-01' }),
              fact(390e9, '2024-09-28', { start: '2023-10-01', accn: '0000000001-24-000123' }),
            ],
          },
        },
      },
      ...overrides,
    },
  };
}

function size(cik: string, float: number | null, currency = 'USD', status: CompanySize['status'] = 'read'): CompanySize {
  return {
    cik,
    status,
    publicFloat: float === null ? null : { value: float, currency, asOf: '2025-06-30', accession: `acc-${cik}`, form: '10-K', filed: '2026-02-01', concept: 'dei:EntityPublicFloat' },
    revenue: null,
  };
}

describe('reading size facts', () => {
  it('takes the newest public float with its accession', () => {
    expect(readPublicFloat(facts())).toEqual({
      value: 1_000e9,
      currency: 'USD',
      asOf: '2024-03-29',
      accession: '0000000001-24-000001',
      form: '10-K',
      filed: '2024-11-01',
      concept: 'dei:EntityPublicFloat',
    });
  });

  it('returns null, not zero, when no float is tagged', () => {
    expect(readPublicFloat(facts({ dei: {} }))).toBeNull();
  });

  it('reads annual revenue through the financial grid selection and cites the fact', () => {
    expect(readAnnualRevenue(facts())).toMatchObject({
      value: 390e9,
      currency: 'USD',
      asOf: '2024-09-28',
      accession: '0000000001-24-000123',
      concept: 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
    });
  });

  it('marks a failed read as unavailable rather than empty', () => {
    expect(sizeFromFacts('5', null)).toEqual({ cik: '5', status: 'facts-unavailable', publicFloat: null, revenue: null });
  });
});

describe('band filter', () => {
  const seed = size('1', 100e9);

  it('places candidates in or out of the 0.5x–2x band, inclusive', () => {
    expect(classifyAgainstSeed(seed, size('2', 50e9), DEFAULT_SIZE_BAND)).toMatchObject({ kind: 'in-band', ratio: 0.5 });
    expect(classifyAgainstSeed(seed, size('3', 200e9), DEFAULT_SIZE_BAND)).toMatchObject({ kind: 'in-band', ratio: 2 });
    expect(classifyAgainstSeed(seed, size('4', 49e9), DEFAULT_SIZE_BAND)).toMatchObject({ kind: 'out-of-band' });
    expect(classifyAgainstSeed(seed, size('5', 201e9), DEFAULT_SIZE_BAND)).toMatchObject({ kind: 'out-of-band' });
  });

  it('distinguishes unread, not reported, and not comparable from out of band', () => {
    expect(classifyAgainstSeed(seed, null, DEFAULT_SIZE_BAND)).toEqual({ kind: 'unsized' });
    expect(classifyAgainstSeed(seed, size('6', null, 'USD', 'facts-unavailable'), DEFAULT_SIZE_BAND)).toEqual({ kind: 'unsized' });
    expect(classifyAgainstSeed(seed, size('7', null), DEFAULT_SIZE_BAND)).toEqual({ kind: 'not-reported' });
    expect(classifyAgainstSeed(seed, size('8', 90e9, 'EUR'), DEFAULT_SIZE_BAND)).toMatchObject({ kind: 'not-comparable', reason: 'currency' });
    expect(classifyAgainstSeed(seed, size('9', 0), DEFAULT_SIZE_BAND)).toMatchObject({ kind: 'not-comparable', reason: 'non-positive' });
  });

  it('has no band when the seed has no usable value', () => {
    expect(classifyAgainstSeed(size('1', null), size('2', 50e9), DEFAULT_SIZE_BAND)).toBeNull();
    expect(classifyAgainstSeed(size('1', 0), size('2', 50e9), DEFAULT_SIZE_BAND)).toBeNull();
  });

  it('ranks in-band by closeness on a log scale, then out-of-band, then the rest', () => {
    const candidates = [size('a', 30e9), size('b', 190e9), size('c', null), size('d', 105e9), size('e', 52e9), size('f', 900e9)];
    const ranked = rankByBand(candidates, candidate => classifyAgainstSeed(seed, candidate, DEFAULT_SIZE_BAND));
    expect(ranked.map(entry => entry.item.cik)).toEqual(['d', 'b', 'e', 'a', 'f', 'c']);
  });

  it('formats multiples at a readable precision', () => {
    expect(formatMultiple(12.4)).toBe('12x');
    expect(formatMultiple(1.25)).toBe('1.3x');
    expect(formatMultiple(0.5)).toBe('0.50x');
    expect(formatMultiple(0.042)).toBe('0.042x');
  });
});

describe('loadCompanySizes', () => {
  beforeEach(() => __clearCompanySizeCache());

  it('reads each candidate once, caches successes, and retries failures', async () => {
    const fetchFacts = vi.fn(async (cik: string) => (cik === '2' ? null : facts()));
    const seen: string[] = [];
    const first = await loadCompanySizes(['0000000001', '2', '1'], { fetchFacts, onSize: s => seen.push(s.cik) });
    expect(fetchFacts).toHaveBeenCalledTimes(2);
    expect(first.get('1')?.status).toBe('read');
    expect(first.get('2')?.status).toBe('facts-unavailable');
    expect(seen.sort()).toEqual(['1', '2']);

    await loadCompanySizes(['1', '2'], { fetchFacts });
    // '1' came from the cache; '2' failed before and was asked again.
    expect(fetchFacts).toHaveBeenCalledTimes(3);
    expect(fetchFacts).toHaveBeenLastCalledWith('2');
  });

  it('bounds concurrency', async () => {
    let active = 0;
    let peak = 0;
    const fetchFacts = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return facts();
    });
    await loadCompanySizes(['1', '2', '3', '4', '5', '6', '7'], { fetchFacts, concurrency: 2 });
    expect(peak).toBe(2);
    expect(fetchFacts).toHaveBeenCalledTimes(7);
  });
});
