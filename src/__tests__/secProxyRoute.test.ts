import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  fetchSec: vi.fn(),
  read: vi.fn(),
  body: '<html><body>Annual report disclosure</body></html>',
  contentType: 'text/html; charset=utf-8',
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => ({
    identity: { userId: 'proxy-test', orgId: null, cacheScope: 'proxy-test:personal' },
  }),
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  acquireResourceConcurrency: mocks.acquire,
  releaseAiConcurrency: mocks.release,
  rateLimitResponse: () => Response.json({ error: 'concurrency' }, { status: 429 }),
}));

vi.mock('../lib/sec-upstream', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/sec-upstream')>();
  return {
    ...actual,
    fetchSecResponse: mocks.fetchSec,
    readResponseWithLimit: mocks.read,
  };
});

import { GET } from '../app/api/sec-proxy/route';
import { SEC_DOCUMENT_CONCURRENCY_OPTIONS } from '../lib/sec-upstream';

function archiveRequest(): Request {
  return new Request(
    'http://localhost/api/sec-proxy?upstream=proxy&path=Archives%2Fedgar%2Fdata%2F1%2Ffiling.htm',
  );
}

function iapdRequest(): Request {
  const params = new URLSearchParams({
    upstream: 'iapd',
    path: 'search/firm',
    query: 'BlackRock',
    hl: 'true',
    nrows: '12',
    start: '0',
    r: '25',
    sort: 'score desc',
    wt: 'json',
  });
  return new Request(`http://localhost/api/sec-proxy?${params.toString()}`);
}

beforeEach(() => {
  mocks.body = '<html><body>Annual report disclosure</body></html>';
  mocks.contentType = 'text/html; charset=utf-8';
  mocks.acquire.mockReset().mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    lease: { token: 'proxy-sec', keys: [], local: true, released: false },
  });
  mocks.release.mockReset().mockResolvedValue(undefined);
  mocks.fetchSec.mockReset().mockImplementation(async () => new Response(mocks.body, {
    status: 200,
    headers: { 'Content-Type': mocks.contentType },
  }));
  mocks.read.mockReset().mockImplementation(async () => new TextEncoder().encode(mocks.body));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/sec-proxy filing document safety', () => {
  it('holds the shared document lease across the first fetch and complete body read', async () => {
    const response = await GET(archiveRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Annual report disclosure');
    expect(mocks.acquire).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ userId: 'proxy-test' }),
      SEC_DOCUMENT_CONCURRENCY_OPTIONS,
    );
    expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetchSec.mock.invocationCallOrder[0]);
    expect(mocks.fetchSec.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);
    expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(mocks.release.mock.invocationCallOrder[0]);
  });

  it('rejects fresh HTTP 200 SEC throttle prose before sanitizing or returning it', async () => {
    mocks.body = '<html><body>Your Request Originated from an Undeclared Automated Tool</body></html>';

    const response = await GET(archiveRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'SEC upstream returned an error page.' });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rejects a padded HTTP 200 SEC throttle page larger than the cached-text guard', async () => {
    mocks.body = `<html><body>${'padding '.repeat(900)}Request Rate Threshold Exceeded</body></html>`;

    const response = await GET(archiveRequest());

    expect(mocks.body.length).toBeGreaterThan(5_000);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'SEC upstream returned an error page.' });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('fails closed on malformed HTTP 200 JSON from the paced IAPD upstream', async () => {
    mocks.body = '{"hits":';
    mocks.contentType = 'application/json';

    const response = await GET(iapdRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'SEC upstream returned malformed JSON.' });
    expect(String(mocks.fetchSec.mock.calls[0]?.[0])).toBe(
      'https://api.adviserinfo.sec.gov/search/firm?query=BlackRock&hl=true&nrows=12&start=0&r=25&sort=score+desc&wt=json',
    );
    expect(mocks.read).toHaveBeenCalledWith(expect.any(Response), 5 * 1024 * 1024, expect.any(AbortSignal), 12_000, false);
  });

  it('releases document capacity when the upstream fetch throws', async () => {
    mocks.fetchSec.mockRejectedValueOnce(new Error('SEC unavailable'));

    const response = await GET(archiveRequest());

    expect(response.status).toBe(502);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not start the SEC fetch when shared document capacity is denied', async () => {
    mocks.acquire.mockResolvedValueOnce({
      allowed: false,
      reason: 'concurrency',
      retryAfterSeconds: 5,
    });

    const response = await GET(archiveRequest());

    expect(response.status).toBe(429);
    expect(mocks.fetchSec).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
