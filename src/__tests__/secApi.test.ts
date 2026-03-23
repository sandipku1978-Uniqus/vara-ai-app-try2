import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CIK_MAP, buildSecDataUrl, buildSecEftsUrl, buildSecProxyUrl } from '../services/secApi';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('secApi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.resetModules();
    delete (import.meta.env as Record<string, unknown>).VITE_USE_ELASTICSEARCH;
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
    it('uses the legacy EFTS endpoint when VITE_USE_ELASTICSEARCH is the string "false"', async () => {
      (import.meta.env as Record<string, unknown>).VITE_USE_ELASTICSEARCH = 'false';
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

    it('uses the Elasticsearch endpoint when VITE_USE_ELASTICSEARCH is the string "true"', async () => {
      (import.meta.env as Record<string, unknown>).VITE_USE_ELASTICSEARCH = 'true';
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ hits: { hits: [], total: { value: 0 } } }),
      });

      const { searchEdgarFilings } = await import('../services/secApi');
      await searchEdgarFilings('temporary equity', '10-K,10-Q', '2023-01-01', '2026-03-22', '', 5);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain('/api/es-search?');
    });
  });
});
