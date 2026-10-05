// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchSec: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock('../lib/cache', () => ({ cacheService: { get: mocks.get, set: mocks.set } }));
vi.mock('../lib/sec-upstream', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/sec-upstream')>(), fetchSecResponse: mocks.fetchSec,
}));

import { collectAaerReleases, getAaerIndex, parseAaerIndexHtml } from '../services/aaer';
import { buildSecTargetUrl, SecUpstreamError, validateSecRedirect } from '../lib/sec-upstream';

const path = '/enforcement-litigation/accounting-auditing-enforcement-releases';
const url = `https://www.sec.gov${path}`;
const recent = readFileSync(new URL('./fixtures/aaer/page-0.html', import.meta.url), 'utf8');
const older = readFileSync(new URL('./fixtures/aaer/page-33.html', import.meta.url), 'utf8');
const corrected = readFileSync(new URL('./fixtures/aaer/page-10.html', import.meta.url), 'utf8');
const firstRelease = {
  releaseNo: 'AAER-4604', date: '2026-10-01', respondents: ['Latch, Inc.'], title: 'Latch, Inc.',
  url: 'https://www.sec.gov/files/litigation/admin/2026/33-11450.pdf',
  otherReleaseNumbers: ['33-11450', '34-106568'],
  relatedActions: [{ label: 'Administrative Summary', url: 'https://www.sec.gov/enforcement-litigation/administrative-proceedings/33-11450-s' }],
};

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.fetchSec.mockReset().mockImplementation(async (target: URL) => new Response(
    target.searchParams.get('page') === '33' ? older : recent,
    { headers: { 'Content-Type': 'text/html' } },
  ));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AAER SEC target allow-list', () => {
  it('allows only the exact AAER index with no query or one numeric page', () => {
    expect(buildSecTargetUrl('proxy', path, new URLSearchParams()).href).toBe(url);
    for (const page of ['0', '33', '9999', '0000']) {
      expect(buildSecTargetUrl('proxy', path, new URLSearchParams({ page })).href).toBe(`${url}?page=${page}`);
      expect(() => validateSecRedirect(new URL(`${url}?page=${page}`), 'proxy')).not.toThrow();
    }
    for (const query of ['page=-1', 'page=1.5', 'page=abc', 'page=', 'page=10000', 'page=1&page=2', 'page=1&search=x', 'search=x', 'page=1e2']) {
      expect(() => buildSecTargetUrl('proxy', path, new URLSearchParams(query)), query).toThrow(SecUpstreamError);
      expect(() => validateSecRedirect(new URL(`${url}?${query}`), 'proxy'), query).toThrow(SecUpstreamError);
    }
    for (const otherPath of ['/cgi-bin/browse-edgar', '/rules-regulations/rulemaking-activity', '/enforcement-litigation/litigation-releases', '/files/company_tickers.json']) {
      expect(() => buildSecTargetUrl('proxy', otherPath, new URLSearchParams({ page: '1' }))).toThrow(SecUpstreamError);
    }
    expect(() => buildSecTargetUrl('proxy', `${path}/extra`, new URLSearchParams())).toThrow(SecUpstreamError);
  });
});

describe('parseAaerIndexHtml real SEC fixtures', () => {
  it('parses all nine retained recent rows and the exact first release', () => {
    const result = parseAaerIndexHtml(recent, url);
    expect(result.rowsParsed).toBe(9);
    expect(result.unparsedRows).toBe(0);
    expect(result.pagesDiscovered).toBe(34);
    expect(result.releases[0]).toEqual(firstRelease);
    expect(result.releases[1]).toEqual({
      releaseNo: 'AAER-4603', date: '2026-09-30', respondents: ['Travel + Leisure Co.'], title: 'Travel + Leisure Co.',
      url: 'https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26657', otherReleaseNumbers: ['LR-26657'],
      relatedActions: [{ label: 'SEC Complaint', url: 'https://www.sec.gov/files/litigation/complaints/2026/comp26657.pdf' }],
    });
  });

  it('separates several respondents in a single anchor and preserves credentials and company suffixes', () => {
    const result = parseAaerIndexHtml(recent, url);
    expect(result.releases.find(row => row.releaseNo === 'AAER-4591')?.respondents)
      .toEqual(['Key Tronic Corporation', 'Brett R. Larsen, CPA', 'Nicholas S. Fasciana']);
    expect(result.releases.find(row => row.releaseNo === 'AAER-4583')?.respondents)
      .toEqual(['Anil Mathews', 'Rahul Agarwal', 'Kenneth M. Harlan', 'MobileFuse, LLC']);
    expect(result.releases.find(row => row.releaseNo === 'AAER-4602')?.respondents)
      .toEqual(['L&L Energy, Inc.', 'Dickson Lee, CPA (Order Granting Extension of Time to File a Reply)']);
    expect(result.releases.find(row => row.releaseNo === 'AAER-4571')?.relatedActions).toEqual([
      { label: 'Final Judgment - Edward O’Donnell', url: 'https://www.sec.gov/files/litigation/litreleases/2025/judg26334-odonnell.pdf' },
      { label: 'Final Judgment - Victor Bozzo', url: 'https://www.sec.gov/files/litigation/litreleases/2025/judg26334-bozzo.pdf' },
    ]);
  });

  it('parses ten older rows, including text-file URLs, suffixes, and America/New_York dates that differ from the UTC datetime attribute', () => {
    const result = parseAaerIndexHtml(older, `${url}?page=33`);
    expect(result.rowsParsed).toBe(10);
    expect(result.unparsedRows).toBe(0);
    expect(result.pagesDiscovered).toBe(34);
    expect(result.releases[0]).toEqual({
      releaseNo: 'AAER-1229', date: '2000-02-15',
      respondents: ['Itex Corporation', 'Terry L. Neal', 'Michael T. Baer', 'Graham H. Norris', 'Cynthia Pfaltzgraff', 'Joseph M. Morris'],
      title: 'Itex Corporation, Terry L. Neal, Michael T. Baer, Graham H. Norris, Cynthia Pfaltzgraff and Joseph M. Morris',
      url: 'https://www.sec.gov/enforcement-litigation/litigation-releases/lr-16437', otherReleaseNumbers: ['LR-16437'], relatedActions: [],
    });
    expect(result.releases.find(row => row.releaseNo === 'AAER-1227')?.respondents)
      .toEqual(['Fabri-Centers of America, Inc.', 'Robert L. Norton', 'Joseph E. Williams']);
    expect(result.releases.find(row => row.releaseNo === 'AAER-1218')?.respondents).toEqual([
      'Francis A. Tarkenton', 'Donald P. Addington', 'Rick W. Gossett', 'Lee R. Fontaine', 'William E. Hammersla, III', 'Eladio Alvarez', 'Edward Welch',
    ]);
    expect(result.releases.find(row => row.releaseNo === 'AAER-1193')?.respondents)
      .toEqual(['Albert Glenn Yesner, CPA', 'Robert G. Mahony, Administrative Law Judge']);
    expect(result.releases.find(row => row.releaseNo === 'AAER-992')?.url).toBe('https://www.sec.gov/files/litigation/admin/3439377.txt');
    expect(result.releases.find(row => row.releaseNo === 'AAER-1248')?.date).toBe('1968-03-11');
    expect(result.releases.at(-1)?.date).toBe('1965-03-29');
    expect(result.releases.find(row => row.releaseNo === 'AAER-2367')?.relatedActions)
      .toEqual([{ label: 'Finality Order', url: 'https://www.sec.gov/files/alj/aljdec/1966/34-7879.pdf' }]);
  });

  it('counts rows missing identifiers, dates or primary URLs instead of fabricating releases', () => {
    // Mutation stays in this test; on-disk fixtures retain verbatim SEC rows.
    const html = recent.replace('AAER-4604', 'not disclosed')
      .replace('2026-09-30T17:10:26Z', 'invalid date')
      .replace('https://www.sec.gov/files/litigation/opinions/2026/33-11440.pdf', 'javascript:alert(1)');
    const result = parseAaerIndexHtml(html, url);
    expect(result.rowsParsed).toBe(6);
    expect(result.unparsedRows).toBe(3);
    expect(result.releases.map(row => row.releaseNo)).toEqual(['AAER-4591', 'AAER-4582', 'AAER-4583', 'AAER-4571', 'AAER-4520', 'AAER-4493']);
    expect(() => parseAaerIndexHtml('<html>SEC unavailable</html>', url)).toThrow('no release rows');
  });

  it('preserves corrected-release suffixes from the real older index rather than dropping them', () => {
    const result = parseAaerIndexHtml(corrected, `${url}?page=10`);
    expect(result.rowsParsed).toBe(2);
    expect(result.unparsedRows).toBe(0);
    expect(result.pagesDiscovered).toBe(34);
    expect(result.releases).toEqual([
      { releaseNo: 'AAER-3582', date: '2014-09-11', respondents: ['Wilmington Trust Corporation'],
        title: 'Wilmington Trust Corporation', url: 'https://www.sec.gov/files/litigation/admin/2014/33-9646.pdf',
        otherReleaseNumbers: ['33-9646', '34-73076'], relatedActions: [] },
      { releaseNo: 'AAER-3578A', date: '2014-08-28', respondents: ['Lynn R. Blodgett', 'Kevin R. Kyser, CPA (Corrected)'],
        title: 'Lynn R. Blodgett and Kevin R. Kyser, CPA (Corrected)', url: 'https://www.sec.gov/files/litigation/admin/2014/34-72938a.pdf',
        otherReleaseNumbers: ['34-72938A'], relatedActions: [] },
    ]);
  });

  it('ignores pagination links to other paths or hosts', () => {
    const poisoned = recent.replace('</nav>', '<a href="https://evil.test/?page=9999">Last</a><a href="/cgi-bin/browse-edgar?page=9999">Last</a></nav>');
    expect(parseAaerIndexHtml(poisoned, url).pagesDiscovered).toBe(34);
  });
});

describe('collectAaerReleases coverage and deadlines', () => {
  it('discovers pages from page zero, deduplicates shifted rows, sorts numerically, and preserves exact coverage', async () => {
    const result = await collectAaerReleases({ userAgent: 'Uniqus Research Center contact@uniqus.com' });
    expect(mocks.fetchSec).toHaveBeenCalledTimes(34);
    expect(mocks.fetchSec.mock.calls.map(call => (call[0] as URL).searchParams.get('page')))
      .toEqual(Array.from({ length: 34 }, (_, page) => String(page)));
    expect(mocks.fetchSec).toHaveBeenCalledWith(new URL(`${url}?page=0`), 'proxy', expect.any(AbortSignal), 'Uniqus Research Center contact@uniqus.com');
    expect(result.releases).toHaveLength(19);
    expect(result.releases[0]).toEqual(firstRelease);
    expect(result.releases.slice(4, 6).map(row => row.releaseNo)).toEqual(['AAER-4583', 'AAER-4582']);
    expect(result.coverage).toEqual({
      pagesDiscovered: 34, pagesRequested: 34, pagesParsed: 34, pagesFailed: [], rowsParsed: 307, unparsedRows: 0,
      oldestDate: '1965-03-29', newestDate: '2026-10-01', complete: true,
      source: 'sec.gov accounting-auditing-enforcement-releases index', fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('records a failed page with its HTTP status and continues through the last page', async () => {
    mocks.fetchSec.mockImplementation(async (target: URL) => target.searchParams.get('page') === '1'
      ? new Response('SEC throttled', { status: 429 })
      : new Response(target.searchParams.get('page') === '33' ? older : recent));
    const result = await collectAaerReleases();
    expect(result.releases).toHaveLength(19);
    expect(result.coverage).toMatchObject({ pagesDiscovered: 34, pagesRequested: 34, pagesParsed: 33, rowsParsed: 298,
      pagesFailed: [{ page: 1, reason: 'SEC AAER index HTTP 429.' }], complete: false,
      incompleteReason: 'One or more index pages could not be read or parsed.' });
  });

  it('reports unknown extent if page zero fails and rejects HTTP 200 error pages', async () => {
    mocks.fetchSec.mockResolvedValueOnce(new Response('Your Request Originated from an Undeclared Automated Tool'));
    const result = await collectAaerReleases();
    expect(result.releases).toEqual([]);
    expect(result.coverage).toMatchObject({ pagesDiscovered: null, pagesRequested: 1, pagesParsed: 0,
      pagesFailed: [{ page: 0, reason: 'SEC returned an error page.' }], oldestDate: null, newestDate: null, complete: false });
    expect(mocks.fetchSec).toHaveBeenCalledOnce();
  });

  it('labels a requested page cap and counts unparsed source rows', async () => {
    mocks.fetchSec.mockResolvedValueOnce(new Response(recent.replace('AAER-4604', 'not present')));
    const result = await collectAaerReleases({ pagesToRead: 1 });
    expect(result.coverage).toMatchObject({ pagesDiscovered: 34, pagesRequested: 1, pagesParsed: 1,
      rowsParsed: 8, unparsedRows: 1, complete: false, incompleteReason: 'Requested page limit reached.' });
    await expect(collectAaerReleases({ pagesToRead: 0 })).rejects.toThrow('positive integer');
  });

  it('returns pages already read when the explicit 100 second deadline interrupts work', async () => {
    vi.useFakeTimers();
    mocks.fetchSec.mockImplementation(async (target: URL, _upstream: string, signal: AbortSignal) => {
      if (target.searchParams.get('page') === '0') return new Response(recent);
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const pending = collectAaerReleases();
    await vi.advanceTimersByTimeAsync(100_000);
    const result = await pending;
    expect(result.releases).toHaveLength(9);
    expect(result.coverage).toMatchObject({ pagesRequested: 2, pagesParsed: 1, complete: false,
      pagesFailed: [{ page: 1, reason: 'Collection deadline reached.' }], incompleteReason: 'Collection deadline reached.' });
    expect(mocks.fetchSec).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours an already aborted signal without starting requests', async () => {
    const controller = new AbortController(); controller.abort();
    const result = await collectAaerReleases({ signal: controller.signal });
    expect(result.coverage).toMatchObject({ complete: false, pagesRequested: 0, incompleteReason: 'Request cancelled.' });
    expect(mocks.fetchSec).not.toHaveBeenCalled();
  });

  it('rejects oversized pages using the central bounded body reader', async () => {
    mocks.fetchSec.mockResolvedValueOnce(new Response(recent, { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }));
    const result = await collectAaerReleases();
    expect(result.coverage).toMatchObject({ pagesParsed: 0, complete: false,
      pagesFailed: [{ page: 0, reason: 'SEC response exceeded the size limit.' }] });
    expect(result.releases).toEqual([]);
  });

  it('does not mark a fully read index complete when a source row lacks an AAER number', async () => {
    const singlePage = recent.replace(/<nav class="usa-pagination"[\s\S]*?<\/nav>/, '').replace('AAER-4604', 'not present');
    mocks.fetchSec.mockResolvedValueOnce(new Response(singlePage));
    const result = await collectAaerReleases();
    expect(result.coverage).toMatchObject({ pagesDiscovered: 1, pagesRequested: 1, pagesParsed: 1,
      rowsParsed: 8, unparsedRows: 1, complete: false, incompleteReason: 'One or more source rows could not be parsed.' });
  });
});

describe('AAER whole-index KV cache', () => {
  it('uses the versioned key and six-hour TTL for complete collections, then serves a cache hit without SEC I/O', async () => {
    const miss = await getAaerIndex();
    expect(miss.cache).toEqual({ hit: false, cachedAt: expect.any(String), ttlSeconds: 21600 });
    expect(mocks.get).toHaveBeenCalledWith('aaer:index:v1');
    expect(mocks.set).toHaveBeenCalledWith('aaer:index:v1', {
      collection: { releases: miss.releases, coverage: miss.coverage }, cachedAt: miss.cache.cachedAt, ttlSeconds: 21600,
    }, { ex: 21600 });
    mocks.get.mockResolvedValue(mocks.set.mock.calls[0][1]);
    mocks.fetchSec.mockClear(); mocks.set.mockClear();
    const hit = await getAaerIndex();
    expect(hit.releases[0]).toEqual(firstRelease);
    expect(hit.cache).toEqual({ ...miss.cache, hit: true });
    expect(mocks.fetchSec).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('caches partial results for at most five minutes and expires them independently of KV', async () => {
    vi.useFakeTimers();
    mocks.fetchSec.mockResolvedValueOnce(new Response('SEC unavailable', { status: 503 }));
    const miss = await getAaerIndex();
    expect(miss.coverage.complete).toBe(false);
    expect(miss.cache.ttlSeconds).toBe(300);
    expect(mocks.set.mock.calls[0][2]).toEqual({ ex: 300 });
    mocks.get.mockResolvedValue(mocks.set.mock.calls[0][1]);
    mocks.fetchSec.mockClear();
    const hit = await getAaerIndex();
    expect(hit.cache.hit).toBe(true);
    expect(mocks.fetchSec).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300_000);
    const fresh = await getAaerIndex();
    expect(fresh.cache.hit).toBe(false);
    expect(fresh.coverage.complete).toBe(true);
    expect(mocks.fetchSec).toHaveBeenCalledTimes(34);
  });

  it('continues after a two-second cache read deadline and bounds the cache write wait', async () => {
    vi.useFakeTimers();
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    mocks.set.mockImplementation(() => new Promise(() => undefined));
    const pending = getAaerIndex();
    await vi.advanceTimersByTimeAsync(4_001);
    const result = await pending;
    expect(result.releases[0]).toEqual(firstRelease);
    expect(result.coverage.complete).toBe(true);
    expect(result.cache).toEqual({ hit: false, cachedAt: null, ttlSeconds: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an in-progress collection without caching partial work', async () => {
    const controller = new AbortController();
    mocks.fetchSec.mockImplementation(async () => { controller.abort(); return new Response(recent); });
    const result = await getAaerIndex({ signal: controller.signal });
    expect(result.coverage).toMatchObject({ complete: false, pagesRequested: 1, pagesParsed: 0, incompleteReason: 'Request cancelled.' });
    expect(result.cache).toEqual({ hit: false, cachedAt: null, ttlSeconds: 0 });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
