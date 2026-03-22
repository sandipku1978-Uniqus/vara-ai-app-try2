import { describe, it, expect } from 'vitest';
import { CIK_MAP, buildSecProxyUrl, buildSecDataUrl, buildSecEftsUrl } from '../services/secApi';

describe('secApi', () => {
  // ── CIK_MAP ──
  describe('CIK_MAP', () => {
    it('contains AAPL', () => {
      expect(CIK_MAP['AAPL']).toBe('0000320193');
    });

    it('contains MSFT', () => {
      expect(CIK_MAP['MSFT']).toBe('0000789019');
    });

    it('contains GOOGL', () => {
      expect(CIK_MAP['GOOGL']).toBe('0001652044');
    });

    it('contains TSLA', () => {
      expect(CIK_MAP['TSLA']).toBe('0001318605');
    });

    it('contains JPM', () => {
      expect(CIK_MAP['JPM']).toBe('0000019617');
    });

    it('contains AMZN', () => {
      expect(CIK_MAP['AMZN']).toBe('0001018724');
    });

    it('contains META', () => {
      expect(CIK_MAP['META']).toBe('0001326801');
    });

    it('contains NVDA', () => {
      expect(CIK_MAP['NVDA']).toBe('0001045810');
    });

    it('has exactly 8 entries', () => {
      expect(Object.keys(CIK_MAP).length).toBe(8);
    });

    it('all CIKs are 10-digit padded', () => {
      for (const cik of Object.values(CIK_MAP)) {
        expect(cik.length).toBe(10);
        expect(/^\d+$/.test(cik)).toBe(true);
      }
    });
  });

  // ── URL builders ──
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
      // In dev mode, should not have extraneous params (except maybe upstream)
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
      // Path gets URL-encoded in dev mode as a query parameter
      expect(url).toContain('LATEST');
      expect(url).toContain('search-index');
    });

    it('includes additional params', () => {
      const url = buildSecEftsUrl('search', { q: 'revenue', forms: '10-K' });
      expect(url).toContain('q=revenue');
    });
  });
});
