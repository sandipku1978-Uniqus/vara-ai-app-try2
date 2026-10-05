// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), index: vi.fn() }));
vi.mock('../lib/api-auth', () => ({ requireApiAccess: mocks.auth }));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: mocks.rate,
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
}));
vi.mock('../services/aaer', async importOriginal => ({
  ...await importOriginal<typeof import('../services/aaer')>(), getAaerIndex: mocks.index,
}));

import { GET, maxDuration } from '../app/api/aaer/route';
import { parseAaerIndexHtml, type AaerIndexResult } from '../services/aaer';

const fixture = readFileSync(new URL('./fixtures/aaer/page-0.html', import.meta.url), 'utf8');
const releases = parseAaerIndexHtml(fixture, 'https://www.sec.gov/enforcement-litigation/accounting-auditing-enforcement-releases').releases
  .sort((a, b) => b.date.localeCompare(a.date) || Number(b.releaseNo.slice(5)) - Number(a.releaseNo.slice(5)));
const index: AaerIndexResult = {
  releases,
  coverage: {
    pagesDiscovered: 34, pagesRequested: 1, pagesParsed: 1, pagesFailed: [], rowsParsed: 9, unparsedRows: 0,
    oldestDate: '2024-03-15', newestDate: '2026-10-01', complete: false, incompleteReason: 'Requested page limit reached.',
    source: 'sec.gov accounting-auditing-enforcement-releases index', fetchedAt: '2026-10-04T00:00:00.000Z',
  },
  cache: { hit: true, cachedAt: '2026-10-04T00:00:00.000Z', ttlSeconds: 300 },
};

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ identity: { userId: 'aaer-test', orgId: null, cacheScope: 'aaer-test:personal' } });
  mocks.rate.mockReset().mockResolvedValue({ allowed: true });
  mocks.index.mockReset().mockResolvedValue(index);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const request = (query = '') => new Request(`http://localhost/api/aaer${query ? `?${query}` : ''}`);

describe('GET /api/aaer', () => {
  it('returns the collected releases with matching total, coverage and cache metadata', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ releases, total: 9, returned: 9, coverage: index.coverage, cache: index.cache });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('x-correlation-id')).toEqual(expect.any(String));
    expect(maxDuration).toBe(120);
    expect(mocks.auth).toHaveBeenCalledWith(true, '/api/aaer', 'GET');
    expect(mocks.index).toHaveBeenCalledWith({ signal: expect.any(AbortSignal), userAgent: expect.any(String) });
  });

  it.each([
    ['q=lAtCh', ['AAER-4604']],
    ['q=aaer-4603', ['AAER-4603']],
    ['q=33-11450', ['AAER-4604']],
    ['q=lr-26657', ['AAER-4603']],
    ['q=BRETT%20R.%20LARSEN', ['AAER-4591']],
    ['q=no%20matching%20respondent', []],
  ])('applies case-insensitive substring searches for %s', async (query, expected) => {
    const response = await GET(request(query));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.releases.map((row: { releaseNo: string }) => row.releaseNo)).toEqual(expected);
    expect(body.total).toBe(expected.length);
    expect(body.returned).toBe(expected.length);
    expect(body.coverage).toEqual(index.coverage);
  });

  it('combines inclusive dates, search and limit while counting matches before truncation', async () => {
    const response = await GET(request('from=2026-01-27&to=2026-01-27&limit=1'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.returned).toBe(1);
    expect(body.releases[0].releaseNo).toBe('AAER-4583');
    const searched = await GET(request('q=Young&from=2026-01-27&to=2026-01-27'));
    expect((await searched.json()).releases.map((row: { releaseNo: string }) => row.releaseNo)).toEqual(['AAER-4582']);
  });

  it.each([
    'q=' + 'x'.repeat(201), 'from=2026-02-30', 'from=2026-1-01', 'to=invalid', 'from=', 'to=',
    'from=2026-10-01&to=2026-01-01', 'limit=0', 'limit=501', 'limit=1.5', 'limit=-1', 'limit=abc', 'limit=',
    'refresh=true', 'refresh=false', 'q=one&q=two', 'page=1',
  ])('rejects invalid parameters before collection: %s', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid AAER query');
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it('accepts leap dates and the maximum limit', async () => {
    const response = await GET(request('from=2024-02-29&limit=500'));
    expect(response.status).toBe(200);
    expect((await response.json()).total).toBe(9);
  });

  it('returns auth rejection before validation, rate limiting or cache I/O', async () => {
    mocks.auth.mockResolvedValueOnce({ response: Response.json({ error: 'Authentication required.' }, { status: 401 }) });
    const response = await GET(request('refresh=true'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required.' });
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.index).not.toHaveBeenCalled();
  });

  it('applies rate limits before any collection', async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: false });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate limited' });
    expect(mocks.index).not.toHaveBeenCalled();
  });

  it('returns a JSON error when collection unexpectedly fails', async () => {
    mocks.index.mockRejectedValueOnce(new Error('unavailable'));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Could not collect SEC AAER releases.' });
  });
});
