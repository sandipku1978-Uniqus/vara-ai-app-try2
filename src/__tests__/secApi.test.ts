import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CIK_MAP, buildSecDataUrl, buildSecEftsUrl, buildSecProxyUrl } from '../services/secApi';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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

  describe('searchEdgarFilings backend selection', () => {
    it('uses the SEC EFTS endpoint when NEXT_PUBLIC_USE_ENRICHED_SEARCH is the string "false"', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'false';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 0 } } }),
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
        json: async () => ({ hits: { hits: [], total: { value: 0 } } }),
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
      expect(onCoverage).toHaveBeenCalledWith({ examined: 5, upstreamTotal: 5_000, complete: false });
    });

    it('reports an exhausted zero-hit plain-EFTS search as complete', async () => {
      const onCoverage = vi.fn();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 0, relation: 'eq' } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings('no-such-disclosure', '10-K', '2023-01-01', '2026-03-22', '', 10, { onCoverage });

      expect(onCoverage).toHaveBeenCalledWith({ examined: 0, upstreamTotal: 0, complete: true });
    });

    const enrichedHit = {
      _id: '0000320193-26-000001:aapl-10k.htm',
      _source: { file_date: '2026-01-15', form: '10-K' },
    };

    it('uses the enriched endpoint when the caller explicitly opts in', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [enrichedHit], total: { value: 1 } } }),
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

    it('does not send the client research mode to the enriched endpoint', async () => {
      process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH = 'true';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [enrichedHit], total: { value: 1 } } }),
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
          json: async () => ({ hits: { hits: [], total: { value: 0 } } }),
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
        json: async () => ({ hits: { hits: [], total: { value: 0 } } }),
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
