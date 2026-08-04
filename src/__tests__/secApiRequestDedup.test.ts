import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchEdgarFilings, type SearchCandidateCoverage } from '../services/secApi';

/**
 * In-flight request dedup for the enriched facet path (chip task from the
 * 2026-08-04 filing-mix diagnosis): the dashboard's empty-query browse fired
 * FIVE identical /api/es-search requests in parallel, one per redundant
 * lane. Identical concurrent calls must share ONE network request; the
 * sharing is in-flight only, so a later call fetches fresh.
 */

const PAGE = {
  hits: {
    hits: [
      { _id: 'D1:doc.htm', _score: 1, _source: { adsh: '1', ciks: ['0000000001'], display_names: ['Issuer One'], file_date: '2026-08-01', file_type: '4' } },
    ],
    total: { value: 1, relation: 'eq' },
  },
  meta: { candidateCoverage: { examined: 1, upstreamTotal: 1, complete: true } },
};

let fetchCalls: string[] = [];
let release: () => void = () => {};

beforeEach(() => {
  fetchCalls = [];
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    // Hold every response until the test releases, so concurrency is real.
    await gate;
    return new Response(JSON.stringify(PAGE), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (forms: string, onCoverage?: (coverage: SearchCandidateCoverage) => void) =>
  searchEdgarFilings('', forms, '2001-01-01', '2026-08-04', '', 100, {
    useEnrichedSearch: true,
    onCoverage,
  });

describe('enriched facet request dedup', () => {
  it('shares one network request across identical concurrent calls', async () => {
    const coverages: SearchCandidateCoverage[] = [];
    const first = call('4', coverage => coverages.push(coverage));
    const second = call('4', coverage => coverages.push(coverage));
    const third = call('4', coverage => coverages.push(coverage));
    // All three are in flight before any response resolves.
    await Promise.resolve();
    release();
    const [a, b, c] = await Promise.all([first, second, third]);

    const esSearchCalls = fetchCalls.filter(url => url.includes('/api/es-search'));
    expect(esSearchCalls).toHaveLength(1);
    // Every caller still gets the full result set…
    expect(a).toHaveLength(1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // …and every caller's coverage accumulator hears the outcome.
    expect(coverages).toHaveLength(3);
    expect(coverages.every(coverage => coverage.complete)).toBe(true);
  });

  it('does not share across different parameters', async () => {
    const first = call('4');
    const second = call('8-K');
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(fetchCalls.filter(url => url.includes('/api/es-search'))).toHaveLength(2);
  });

  it('shares in-flight only — a later call fetches fresh', async () => {
    const first = call('4');
    await Promise.resolve();
    release();
    await first;

    // New gate for the second round.
    const gate = new Promise<void>(resolve => { release = resolve; });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      await gate;
      return new Response(JSON.stringify(PAGE), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const second = call('4');
    await Promise.resolve();
    release();
    await second;

    expect(fetchCalls.filter(url => url.includes('/api/es-search'))).toHaveLength(2);
  });

  it('does not make a same-query replacement inherit the aborted enriched owner', async () => {
    const firstController = new AbortController();
    const replacementController = new AbortController();
    let requestNumber = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(String(input));
      requestNumber += 1;
      if (requestNumber === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('superseded', 'AbortError')), { once: true });
        });
      }
      return Promise.resolve(new Response(JSON.stringify(PAGE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });

    const first = searchEdgarFilings('', '4', '2001-01-01', '2026-08-04', '', 100, {
      useEnrichedSearch: true,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(requestNumber).toBe(1));
    firstController.abort(new DOMException('superseded', 'AbortError'));
    const replacement = searchEdgarFilings('', '4', '2001-01-01', '2026-08-04', '', 100, {
      useEnrichedSearch: true,
      signal: replacementController.signal,
    });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(replacement).resolves.toHaveLength(1);
    expect(fetchCalls.filter(url => url.includes('/api/es-search'))).toHaveLength(2);
  });
});

describe('plain EFTS request ownership', () => {
  it('does not reuse an aborted same-query request and still caches the replacement success', async () => {
    const firstController = new AbortController();
    const replacementController = new AbortController();
    let requestNumber = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(String(input));
      requestNumber += 1;
      if (requestNumber === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('superseded', 'AbortError')), { once: true });
        });
      }
      return Promise.resolve(new Response(JSON.stringify(PAGE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });

    const first = searchEdgarFilings('same-query-abort-regression', '10-K', '2026-01-01', '2026-08-04', '', 100, {
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(requestNumber).toBe(1));
    firstController.abort(new DOMException('superseded', 'AbortError'));
    const replacement = searchEdgarFilings('same-query-abort-regression', '10-K', '2026-01-01', '2026-08-04', '', 100, {
      signal: replacementController.signal,
    });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(replacement).resolves.toHaveLength(1);
    await expect(searchEdgarFilings(
      'same-query-abort-regression', '10-K', '2026-01-01', '2026-08-04', '', 100
    )).resolves.toHaveLength(1);
    expect(fetchCalls.filter(url => url.includes('/api/sec-efts'))).toHaveLength(2);
  });
});
