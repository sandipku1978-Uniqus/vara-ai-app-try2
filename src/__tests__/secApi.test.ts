import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CIK_MAP,
  MIN_SEC_COMPANY_DIRECTORY_ENTRIES,
  buildSecDataUrl,
  buildSecEftsUrl,
  buildSecIapdUrl,
  buildSecProxyUrl,
  projectSecCompanyDirectory,
} from '../services/secApi';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function fullTickerDirectory(
  first: { cik_str: number; ticker: string; title: string },
): Record<string, { cik_str: number; ticker: string; title: string }> {
  return Object.fromEntries(Array.from(
    { length: MIN_SEC_COMPANY_DIRECTORY_ENTRIES },
    (_, index) => index === 0
      ? ['0', first]
      : [String(index), {
          cik_str: 5_000_000 + index,
          ticker: `ZX${index.toString(36).toUpperCase().padStart(5, '0')}`,
          title: `Directory completeness fixture ${index}`,
        }],
  ));
}

describe('secApi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH;
  });

  describe('CIK_MAP', () => {
    it('contains AAPL', () => {
      expect(CIK_MAP.AAPL).toBe('0000320193');
    });

    it('contains MSFT', () => {
      expect(CIK_MAP.MSFT).toBe('0000789019');
    });

    it('contains GOOGL', () => {
      expect(CIK_MAP.GOOGL).toBe('0001652044');
    });

    it('contains TSLA', () => {
      expect(CIK_MAP.TSLA).toBe('0001318605');
    });

    it('contains JPM', () => {
      expect(CIK_MAP.JPM).toBe('0000019617');
    });

    it('contains AMZN', () => {
      expect(CIK_MAP.AMZN).toBe('0001018724');
    });

    it('contains META', () => {
      expect(CIK_MAP.META).toBe('0001326801');
    });

    it('contains NVDA', () => {
      expect(CIK_MAP.NVDA).toBe('0001045810');
    });

    it('has exactly 8 entries', () => {
      expect(Object.keys(CIK_MAP)).toHaveLength(8);
    });

    it('all CIKs are 10-digit padded', () => {
      for (const cik of Object.values(CIK_MAP)) {
        expect(cik).toHaveLength(10);
        expect(/^\d+$/.test(cik)).toBe(true);
      }
    });
  });

  describe('buildSecProxyUrl', () => {
    it('returns a string', () => {
      expect(typeof buildSecProxyUrl('test/path')).toBe('string');
    });

    it('includes the path', () => {
      const url = buildSecProxyUrl('cgi-bin/browse-edgar');
      expect(url).toContain('cgi-bin/browse-edgar');
    });

    it('strips leading slashes from path', () => {
      const url = buildSecProxyUrl('///test/path');
      expect(url).not.toContain('///');
    });

    it('includes query params when provided', () => {
      const url = buildSecProxyUrl('test', { action: 'getcompany', CIK: '320193' });
      expect(url).toContain('action=getcompany');
      expect(url).toContain('CIK=320193');
    });

    it('handles URLSearchParams', () => {
      const params = new URLSearchParams({ key: 'value' });
      const url = buildSecProxyUrl('test', params);
      expect(url).toContain('key=value');
    });

    it('omits undefined params', () => {
      const url = buildSecProxyUrl('test', { a: 'b', c: undefined });
      expect(url).toContain('a=b');
      expect(url).not.toContain('c=');
    });

    it('returns path without query when no params', () => {
      const url = buildSecProxyUrl('simple/path');
      expect(url).toContain('simple/path');
    });
  });

  describe('buildSecDataUrl', () => {
    it('returns a string', () => {
      expect(typeof buildSecDataUrl('api/xbrl/companyfacts')).toBe('string');
    });

    it('includes the path', () => {
      const url = buildSecDataUrl('api/xbrl/companyfacts/CIK0000320193.json');
      expect(url).toContain('CIK0000320193');
    });
  });

  describe('buildSecEftsUrl', () => {
    it('returns a string', () => {
      expect(typeof buildSecEftsUrl('LATEST/search-index')).toBe('string');
    });

    it('includes the path in params', () => {
      const url = buildSecEftsUrl('LATEST/search-index');
      expect(url).toContain('LATEST');
      expect(url).toContain('search-index');
    });

    it('includes additional params', () => {
      const url = buildSecEftsUrl('search', { q: 'revenue', forms: '10-K' });
      expect(url).toContain('q=revenue');
    });
  });

  describe('buildSecIapdUrl', () => {
    it('routes IAPD searches through the same-origin SEC proxy', () => {
      const url = buildSecIapdUrl('search/firm', new URLSearchParams({ query: 'BlackRock' }));
      expect(url).toContain('/api/sec-proxy?');
      expect(url).toContain('upstream=iapd');
      expect(url).toContain('path=search/firm');
      expect(url).not.toContain('api.adviserinfo.sec.gov');
    });
  });

  describe('SEC company directory loading', () => {
    it('validates the directory atomically before exposing any ticker mapping', () => {
      expect(projectSecCompanyDirectory({
        0: { cik_str: 320193, ticker: 'aapl', title: 'Apple Inc.' },
        1: { cik_str: '789019', ticker: 'MSFT', title: 'Microsoft Corp.' },
      })).toEqual({
        map: { AAPL: '320193', MSFT: '789019' },
        directory: [
          { cik: '320193', ticker: 'AAPL', title: 'Apple Inc.' },
          { cik: '789019', ticker: 'MSFT', title: 'Microsoft Corp.' },
        ],
      });

      expect(() => projectSecCompanyDirectory({})).toThrow('empty');
      expect(() => projectSecCompanyDirectory({
        0: { cik_str: '32abc0193', ticker: 'AAPL', title: 'Apple Inc.' },
      })).toThrow('invalid CIK');
      expect(() => projectSecCompanyDirectory({
        0: { cik_str: 320193, ticker: 'AAPL!', title: 'Apple Inc.' },
      })).toThrow('invalid ticker');
      expect(() => projectSecCompanyDirectory({
        0: { cik_str: 320193, ticker: 'AAPL', title: '' },
      })).toThrow('invalid title');
      expect(() => projectSecCompanyDirectory({
        0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
        1: { cik_str: 999999, ticker: 'aapl', title: 'Imposter Inc.' },
      })).toThrow('duplicate ticker AAPL');
    });

    it('retries after a transient failure instead of caching an empty map', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => fullTickerDirectory({
            cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.',
          }),
        });

      try {
        const { loadTickerMap } = await import('../services/secApi');
        await expect(loadTickerMap()).resolves.toEqual({});
        await expect(loadTickerMap()).resolves.toMatchObject({ AAPL: '320193' });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('retries after an HTTP 200 partial directory instead of caching it', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => fullTickerDirectory({
            cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp.',
          }),
        });

      try {
        const { loadTickerMap } = await import('../services/secApi');
        await expect(loadTickerMap()).resolves.toEqual({});
        await expect(loadTickerMap()).resolves.toMatchObject({ MSFT: '789019' });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('searchEdgarFilings backend selection', () => {
    it('uses the SEC EFTS endpoint when NEXT_PUBLIC_USE_ENRICHED_SEARCH is the string "false"', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'false';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 0, relation: 'eq' } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings('temporary equity', '10-K,10-Q', '2023-01-01', '2026-03-22', '', 5);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain('/api/sec-efts?');
      expect(String(mockFetch.mock.calls[0][0])).not.toContain('/api/es-search?');
    });

    it('keeps the SEC EFTS endpoint by default even when enriched search is enabled', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 0, relation: 'eq' } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings('temporary equity', '10-K,10-Q', '2023-01-01', '2026-03-22', '', 5);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain('/api/sec-efts?');
      expect(String(mockFetch.mock.calls[0][0])).not.toContain('/api/es-search?');
    });

    it('reports bounded plain-EFTS collection as partial candidate coverage', async () => {
      const onCoverage = vi.fn();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          hits: {
            hits: Array.from({ length: 10 }, (_, index) => ({
              _id: `hit-${index}`,
              _source: { file_date: '2026-01-15', form: '10-K' },
            })),
            total: { value: 5_000, relation: 'eq' },
          },
        }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      const hits = await searchEdgarFilings('controls', '10-K', '2023-01-01', '2026-03-22', '', 5, { onCoverage });

      expect(hits).toHaveLength(5);
      expect(onCoverage).toHaveBeenCalledWith({ examined: 5, upstreamTotal: 5_000, complete: false, upstreamTotalIsFloor: false });
    });

    it('reports an exhausted zero-hit plain-EFTS search as complete', async () => {
      const onCoverage = vi.fn();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 0, relation: 'eq' } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings('no-such-disclosure', '10-K', '2023-01-01', '2026-03-22', '', 10, { onCoverage });

      expect(onCoverage).toHaveBeenCalledWith({ examined: 0, upstreamTotal: 0, complete: true, upstreamTotalIsFloor: false });
    });

    it.each([
      {
        label: 'malformed payload',
        response: () => new Response(JSON.stringify({ message: 'temporarily unavailable' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
      {
        label: 'wrong content type',
        response: () => new Response(JSON.stringify({
          hits: { hits: [], total: { value: 0, relation: 'eq' } },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      },
    ])('never reports an EFTS HTTP 200 with $label as verified zero', async ({ response }) => {
      const onCoverage = vi.fn();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFetch.mockResolvedValue(response());

      try {
        const { searchEdgarFilings } = await import('../services/secApi');
        await expect(searchEdgarFilings(
          `invalid-efts-${Date.now()}`,
          '10-K',
          '2023-01-01',
          '2026-03-22',
          '',
          10,
          { onCoverage }
        )).rejects.toThrow(/SEC search returned/);
        expect(onCoverage).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    const enrichedHit = {
      _id: '0000320193-26-000001:aapl-10k.htm',
      _source: { file_date: '2026-01-15', form: '10-K' },
    };

    it('uses the enriched endpoint when the caller explicitly opts in', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [enrichedHit], total: { value: 1, relation: 'eq' } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings(
        'temporary equity',
        '10-K,10-Q',
        '2023-01-01',
        '2026-03-22',
        '',
        5,
        { useEnrichedSearch: true }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain('/api/es-search?');
    });

    it('reports enriched candidate coverage to the caller', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      const onCoverage = vi.fn();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          hits: { hits: [enrichedHit], total: { value: 1, relation: 'eq' } },
          meta: { candidateCoverage: { examined: 250, upstreamTotal: 1200, complete: false } },
        }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings('controls', '10-K', '2023-01-01', '2026-03-22', '', 5, {
        useEnrichedSearch: true,
        onCoverage,
      });

      expect(onCoverage).toHaveBeenCalledWith({ examined: 250, upstreamTotal: 1200, complete: false });
    });

    it('reconciles hidden server EFTS fan-out and shares one bounded budget across enriched pages', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      const requestedBudgets: number[] = [];
      let routePage = 0;
      mockFetch.mockImplementation(async (input: string | URL | Request) => {
        const url = new URL(String(input), 'http://localhost');
        expect(url.pathname).toBe('/api/es-search');
        requestedBudgets.push(Number(url.searchParams.get('eftsRequestBudget')));
        const pageIndex = routePage;
        routePage += 1;
        const requests = pageIndex === 0 ? 6 : 4;
        const hits = Array.from({ length: 100 }, (_, index) => ({
          _id: `server-budget-${pageIndex * 100 + index}`,
          _source: { file_date: '2026-01-15', form: '10-K' },
        }));
        return new Response(JSON.stringify({
          hits: { hits, total: { value: 500, relation: 'eq' } },
          meta: {
            candidateCoverage: {
              examined: (pageIndex + 1) * 100,
              upstreamTotal: 500,
              complete: false,
            },
            efts: { requests, requestBudget: requestedBudgets.at(-1) },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      const recordedRequestBatches: number[] = [];
      const coverages: Array<{ upstreamRequests?: number }> = [];

      const { searchEdgarFilings } = await import('../services/secApi');
      const hits = await searchEdgarFilings(
        'server-fanout-budget',
        '10-K',
        '2023-01-01',
        '2026-03-22',
        '',
        200,
        {
          useEnrichedSearch: true,
          upstreamRequestBudget: 10,
          onUpstreamPage: (requestCount = 1) => {
            recordedRequestBatches.push(requestCount);
            return true;
          },
          onCoverage: coverage => { coverages.push(coverage); },
        }
      );

      expect(hits).toHaveLength(200);
      expect(requestedBudgets).toEqual([10, 4]);
      expect(recordedRequestBatches).toEqual([1, 5, 1, 3]);
      expect(recordedRequestBatches.reduce((sum, count) => sum + count, 0)).toBe(10);
      expect(coverages.at(-1)).toMatchObject({ upstreamRequests: 10 });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('reconciles a zero-page error before authorizing an enriched retry', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      const requestedBudgets: number[] = [];
      mockFetch
        .mockImplementationOnce(async (input: string | URL | Request) => {
          const budget = Number(new URL(String(input), 'http://localhost').searchParams.get('eftsRequestBudget'));
          requestedBudgets.push(budget);
          return new Response(JSON.stringify({
            ok: false,
            error: 'temporary upstream failure',
            meta: { efts: { requests: 6, requestBudget: budget } },
          }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        })
        .mockImplementationOnce(async (input: string | URL | Request) => {
          const budget = Number(new URL(String(input), 'http://localhost').searchParams.get('eftsRequestBudget'));
          requestedBudgets.push(budget);
          return new Response(JSON.stringify({
            hits: { hits: [enrichedHit], total: { value: 1, relation: 'eq' } },
            meta: {
              candidateCoverage: { examined: 1, upstreamTotal: 1, complete: true },
              efts: { requests: 4, requestBudget: budget },
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
      const recordedRequestBatches: number[] = [];

      const { searchEdgarFilings } = await import('../services/secApi');
      const hits = await searchEdgarFilings(
        'retry-fanout-budget',
        '10-K',
        '2023-01-01',
        '2026-03-22',
        '',
        5,
        {
          useEnrichedSearch: true,
          upstreamRequestBudget: 10,
          onUpstreamPage: (requestCount = 1) => {
            recordedRequestBatches.push(requestCount);
            return true;
          },
        }
      );

      expect(hits).toEqual([enrichedHit]);
      expect(requestedBudgets).toEqual([10, 4]);
      expect(recordedRequestBatches).toEqual([1, 5, 1, 3]);
      expect(recordedRequestBatches.reduce((sum, count) => sum + count, 0)).toBe(10);
    });

    it('reserves a budgeted error call fully when legacy error metadata is missing', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue(new Response(JSON.stringify({
        ok: false,
        error: 'legacy error without accounting',
      }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
      const recordedRequestBatches: number[] = [];

      const { searchEdgarFilings } = await import('../services/secApi');
      const hits = await searchEdgarFilings(
        'legacy-error-budget-reserve',
        '10-K',
        '2023-01-01',
        '2026-03-22',
        '',
        5,
        {
          useEnrichedSearch: true,
          upstreamRequestBudget: 7,
          onUpstreamPage: (requestCount = 1) => {
            recordedRequestBatches.push(requestCount);
            return true;
          },
        }
      );

      expect(hits).toEqual([]);
      expect(recordedRequestBatches).toEqual([1, 6]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('accounts a non-retryable enriched error before falling back to plain EFTS', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      const plainHit = {
        _id: 'plain-after-accounted-422',
        _source: { file_date: '2026-01-16', form: '10-K' },
      };
      mockFetch
        .mockResolvedValueOnce(new Response(JSON.stringify({
          ok: false,
          error: 'unsupported candidate window',
          meta: { efts: { requests: 3, requestBudget: 10 } },
        }), { status: 422, headers: { 'Content-Type': 'application/json' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          hits: { hits: [plainHit], total: { value: 1, relation: 'eq' } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      const recordedRequestBatches: number[] = [];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        const { searchEdgarFilings } = await import('../services/secApi');
        const hits = await searchEdgarFilings(
          'accounted-nonretryable-error',
          '10-K',
          '2023-01-01',
          '2026-03-22',
          '',
          5,
          {
            useEnrichedSearch: true,
            upstreamRequestBudget: 10,
            onUpstreamPage: (requestCount = 1) => {
              recordedRequestBatches.push(requestCount);
              return true;
            },
          }
        );

        expect(hits).toEqual([plainHit]);
        expect(recordedRequestBatches).toEqual([1, 2, 1]);
        expect(recordedRequestBatches.reduce((sum, count) => sum + count, 0)).toBe(4);
        expect(String(mockFetch.mock.calls[1][0])).toContain('/api/sec-efts?');
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('does not send the client research mode to the enriched endpoint', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [enrichedHit], total: { value: 1, relation: 'eq' } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings(
        '"Temporary equity"',
        '10-K,10-Q',
        '2023-01-01',
        '2026-03-22',
        '',
        5,
        { useEnrichedSearch: true }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).not.toContain('mode=');
    });

    it('falls back to EDGAR EFTS when enriched search fails', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      const onDegraded = vi.fn();
      mockFetch.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/es-search?')) {
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        }
        return {
          ok: true,
          json: async () => ({ hits: { hits: [], total: { value: 0, relation: 'eq' } } }),
        };
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings(
        'temporary equity',
        '10-K,10-Q',
        '2023-01-01',
        '2026-03-22',
        '',
        5,
        { useEnrichedSearch: true, onDegraded }
      );

      const urls = mockFetch.mock.calls.map(call => String(call[0]));
      expect(urls[0]).toContain('/api/es-search?');
      expect(urls.some(url => url.includes('/api/sec-efts?'))).toBe(true);
      expect(onDegraded).toHaveBeenCalledWith(expect.stringContaining('live SEC EDGAR fallback'));
    });

    it('falls back to EDGAR EFTS when enriched search returns zero hits', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 0, relation: 'eq' } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings(
        'temporary equity',
        '10-K,10-Q',
        '2023-01-01',
        '2026-03-22',
        '',
        5,
        { useEnrichedSearch: true }
      );

      const urls = mockFetch.mock.calls.map(call => String(call[0]));
      expect(urls[0]).toContain('/api/es-search?');
      expect(urls.some(url => url.includes('/api/sec-efts?'))).toBe(true);
    });

    it('falls back to strict plain EFTS when the enriched endpoint returns malformed 200 JSON', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      const onDegraded = vi.fn();
      const plainHit = {
        _id: 'plain-fallback-hit',
        _source: { file_date: '2026-01-15', form: '10-K' },
      };
      mockFetch
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'upstream unavailable' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          hits: { hits: [plainHit], total: { value: 1, relation: 'eq' } },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        const { searchEdgarFilings } = await import('../services/secApi');
        const hits = await searchEdgarFilings(
          'malformed-enriched-fallback',
          '10-K',
          '2023-01-01',
          '2026-03-22',
          '',
          5,
          { useEnrichedSearch: true, onDegraded }
        );

        expect(hits).toEqual([plainHit]);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(String(mockFetch.mock.calls[0][0])).toContain('/api/es-search?');
        expect(String(mockFetch.mock.calls[1][0])).toContain('/api/sec-efts?');
        expect(onDegraded).toHaveBeenCalledWith(expect.stringContaining('live SEC EDGAR fallback'));
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('vetoes an enriched retry before it becomes an over-budget HTTP request', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });
      let remainingAttempts = 1;
      const onUpstreamPage = vi.fn(() => {
        if (remainingAttempts <= 0) return false;
        remainingAttempts -= 1;
        return true;
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      const hits = await searchEdgarFilings(
        'budget-veto-enriched',
        '10-K',
        '2023-01-01',
        '2026-03-22',
        '',
        5,
        { useEnrichedSearch: true, onUpstreamPage }
      );

      expect(hits).toEqual([]);
      expect(mockFetch, 'the vetoed retry must never reach fetch').toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain('/api/es-search?');
      expect(onUpstreamPage).toHaveBeenCalledTimes(2);
    });

    it('returns a partial EFTS page without issuing the next vetoed page request', async () => {
      const onCoverage = vi.fn();
      let remainingAttempts = 1;
      const onUpstreamPage = vi.fn(() => {
        if (remainingAttempts <= 0) return false;
        remainingAttempts -= 1;
        return true;
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          hits: {
            hits: Array.from({ length: 10 }, (_, index) => ({
              _id: `budget-hit-${index}`,
              _source: { file_date: '2026-01-15', form: '10-K' },
            })),
            total: { value: 100, relation: 'eq' },
          },
        }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      const hits = await searchEdgarFilings(
        'budget-veto-efts',
        '10-K',
        '2023-01-01',
        '2026-03-22',
        '',
        20,
        { onUpstreamPage, onCoverage }
      );

      expect(hits).toHaveLength(10);
      expect(mockFetch, 'the vetoed second page must never reach fetch').toHaveBeenCalledTimes(1);
      expect(onCoverage).toHaveBeenCalledWith(expect.objectContaining({ complete: false }));
    });
  });

  describe('authoritative totals and filing indexes', () => {
    it('returns the EDGAR total separately from a bounded result page', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 1171, relation: 'eq' } } }),
      });

      const { fetchEdgarSearchTotal } = await import('../services/secApi');
      await expect(fetchEdgarSearchTotal('', 'S-1,S-1/A,F-1,F-1/A,424B4', '2026-01-01', '2026-07-19'))
        .resolves.toEqual({ value: 1171, relation: 'eq' });

      const url = String(mockFetch.mock.calls[0][0]);
      expect(url).toContain('/api/sec-efts?');
      expect(url).toContain('forms=S-1%2CS-1/A%2CF-1%2CF-1/A%2C424B4');
      expect(url).toContain('size=10');
    });

    it('rejects a malformed EFTS total response instead of returning an authoritative zero', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ hits: { hits: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

      const { fetchEdgarSearchTotal } = await import('../services/secApi');
      await expect(fetchEdgarSearchTotal(
        'malformed-total',
        '10-K',
        '2026-01-01',
        '2026-07-19'
      )).rejects.toThrow(/SEC search returned/);
    });

    it('parses the official filing directory index into document URLs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          directory: {
            item: [
              { name: 'aapl-20230930.htm', type: 'text/html', size: 1442 },
              { name: 'Financial_Report.xlsx', type: 'application/vnd.ms-excel', size: '925' },
              { name: 'subdir', type: 'dir', size: 0 },
            ],
          },
        }),
      });

      const { fetchFilingIndex } = await import('../services/secApi');
      const documents = await fetchFilingIndex('0000320193-23-000106');

      expect(String(mockFetch.mock.calls[0][0])).toContain(
        'path=Archives/edgar/data/320193/000032019323000106/index.json'
      );
      expect(documents).toHaveLength(2);
      expect(documents[0]).toMatchObject({
        name: 'aapl-20230930.htm',
        description: 'aapl-20230930.htm',
        type: 'text/html',
        size: '1442',
      });
      expect(documents[0].url).toContain('/320193/000032019323000106/aapl-20230930.htm');
    });
  });
});
