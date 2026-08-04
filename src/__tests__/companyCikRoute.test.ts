import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchSec: vi.fn(),
  read: vi.fn(),
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => ({
    identity: { userId: 'company-cik-test', orgId: null, cacheScope: 'company-cik-test:personal' },
  }),
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
}));

vi.mock('../lib/sec-upstream', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/sec-upstream')>();
  return {
    ...actual,
    fetchSecResponse: mocks.fetchSec,
    readResponseWithLimit: mocks.read,
  };
});

import { GET } from '../app/api/company-cik/route';

function request(): Request {
  return new Request('http://localhost/api/company-cik?ticker=XOM');
}

function atom(cik = '0000034088'): string {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><company-info><cik>${cik}</cik></company-info></feed>`;
}

beforeEach(() => {
  mocks.fetchSec.mockReset().mockResolvedValue(new Response(null, {
    status: 200,
    headers: { 'Content-Type': 'application/atom+xml' },
  }));
  mocks.read.mockReset().mockImplementation(async () => new TextEncoder().encode(atom()));
});

describe('GET /api/company-cik raw Atom validation', () => {
  it('returns one validated, normalized CIK from SEC Atom', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, cik: '34088' });
    expect(String(mocks.fetchSec.mock.calls[0]?.[0])).toContain('ticker=XOM');
    expect(mocks.read).toHaveBeenCalledWith(expect.any(Response), 512 * 1024, expect.any(AbortSignal));
  });

  it('rejects a wrong media type before reading the response body', async () => {
    mocks.fetchSec.mockResolvedValueOnce(new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));

    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ ok: false, cik: null });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects padded SEC throttle prose before extracting a CIK', async () => {
    mocks.read.mockResolvedValueOnce(new TextEncoder().encode(
      `Your Request Originated from an Undeclared Automated Tool${' '.repeat(8_000)}<cik>34088</cik>`,
    ));

    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      cik: null,
      error: expect.stringContaining('error page'),
    });
  });

  it('rejects malformed or ambiguous HTTP 200 Atom evidence', async () => {
    mocks.read.mockResolvedValueOnce(new TextEncoder().encode('<cik>34088</cik>'));
    const malformed = await GET(request());
    expect(malformed.status).toBe(502);

    mocks.read.mockResolvedValueOnce(new TextEncoder().encode(
      '<feed><cik>34088</cik><cik>2115436</cik></feed>',
    ));
    const ambiguous = await GET(request());
    expect(ambiguous.status).toBe(502);
  });

  it('distinguishes a valid no-match feed from an invalid upstream response', async () => {
    mocks.read.mockResolvedValueOnce(new TextEncoder().encode('<feed></feed>'));
    const noMatch = await GET(request());
    expect(noMatch.status).toBe(200);
    await expect(noMatch.json()).resolves.toEqual({ ok: true, cik: null });

    mocks.fetchSec.mockResolvedValueOnce(new Response(null, {
      status: 503,
      headers: { 'Content-Type': 'application/atom+xml' },
    }));
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(502);
    await expect(unavailable.json()).resolves.toMatchObject({ ok: false, cik: null });
  });
});
