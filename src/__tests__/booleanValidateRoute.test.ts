import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheText: new Map<string, string>(),
  fetchCalls: [] as string[],
  fetchSec: vi.fn(),
  cacheDelete: vi.fn(),
  cacheUpsert: vi.fn(),
  cacheValidationVersion: 1 as number | null,
  acquireCapacity: vi.fn(),
  releaseCapacity: vi.fn(),
  responseText: 'the filing discloses a material weakness in controls',
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => ({ identity: { userId: 'u1', orgId: null, cacheScope: 'u1:personal' } }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  acquireResourceConcurrency: mocks.acquireCapacity,
  releaseAiConcurrency: mocks.releaseCapacity,
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const key = [...mocks.cacheText.keys()][0];
                return {
                  data: key ? {
                    text: mocks.cacheText.get(key),
                    source_validation_version: mocks.cacheValidationVersion,
                  } : null,
                };
              },
            }),
          }),
        }),
      }),
    }),
  }),
  getCacheWriterSupabase: () => ({
    from: () => ({
      delete: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => {
              return mocks.cacheDelete();
            },
          }),
        }),
      }),
      upsert: (...args: unknown[]) => {
        return mocks.cacheUpsert(...args);
      },
    }),
  }),
}));
vi.mock('../lib/filingTextServer', () => ({
  extractDocumentTextFromHtmlServer: (html: string) => html,
}));
vi.mock('../lib/sec-upstream', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/sec-upstream')>();
  return {
    ...actual, // keeps the REAL assertSecDocumentResponse guard in the route path
    buildSecTargetUrl: (_u: string, path: string) => { mocks.fetchCalls.push(path); return new URL(`https://sec.gov/${path}`); },
    fetchSecResponse: async (...args: unknown[]) => {
      const authorizeAttempt = args[4] as (() => boolean | void) | undefined;
      if (authorizeAttempt?.() === false) throw new Error('request budget exhausted');
      return mocks.fetchSec(...args);
    },
    readResponseWithLimit: async () => new TextEncoder().encode(mocks.responseText),
  };
});

import { POST } from '../app/api/boolean-validate/route';
import { GET as GET_FILING_TEXT } from '../app/api/filing-text/route';
import { SEC_DOCUMENT_CONCURRENCY_OPTIONS } from '../lib/sec-upstream';

function post(body: unknown) {
  return new Request('http://localhost/api/boolean-validate', { method: 'POST', body: JSON.stringify(body) });
}

const candidate = { cik: '320193', accession: '0000320193-24-000123', document: 'aapl.htm' };

beforeEach(() => {
  mocks.cacheText.clear();
  mocks.fetchCalls.length = 0;
  mocks.cacheDelete.mockReset().mockResolvedValue({ error: null });
  mocks.cacheUpsert.mockReset().mockResolvedValue({ error: null });
  mocks.cacheValidationVersion = 1;
  mocks.acquireCapacity.mockReset().mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    lease: { token: 'sec-test', keys: [], local: true, released: false },
  });
  mocks.releaseCapacity.mockReset().mockResolvedValue(undefined);
  mocks.responseText = 'the filing discloses a material weakness in controls';
  mocks.fetchSec.mockReset();
  mocks.fetchSec.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/html' }),
  }));
});

describe('POST /api/boolean-validate', () => {
  it('returns a match verdict with an excerpt, without shipping the document', async () => {
    const res = await POST(post({ query: '"material weakness"', candidates: [candidate] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.verdicts[0]).toMatchObject({ matched: true, validated: true });
    expect(body.verdicts[0].excerpt).toContain('material weakness');
    // The full filing text must never be returned — that is the point.
    expect(JSON.stringify(body).length).toBeLessThan(2000);
  });

  it('reports a non-match without an excerpt', async () => {
    const res = await POST(post({ query: 'zebra', candidates: [candidate] }));
    const body = await res.json();
    expect(body.verdicts[0]).toMatchObject({ matched: false, validated: true });
    expect(body.verdicts[0].excerpt).toBeUndefined();
  });

  it('issues ZERO document fetches for an invalid expression', async () => {
    const res = await POST(post({ query: 'lease AND', candidates: [candidate] }));
    expect(res.status).toBe(400);
    expect(mocks.fetchCalls).toHaveLength(0);
  });

  it('rejects a Cartesian branch explosion before any document fetch', async () => {
    const query = Array.from({ length: 20 }, (_, i) => `(a${i} OR b${i})`).join(' AND ');
    const res = await POST(post({ query, candidates: [candidate] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/too many OR branches/i);
    expect(mocks.fetchCalls).toHaveLength(0);
  });

  it('rejects auditor: in OR context, like every other caller', async () => {
    const res = await POST(post({ query: 'lease OR auditor:KPMG', candidates: [candidate] }));
    expect(res.status).toBe(400);
    expect(mocks.fetchCalls).toHaveLength(0);
  });

  it('serves from the shared cache without touching SEC', async () => {
    mocks.cacheText.set('k', 'a cached filing mentioning material weakness');
    const res = await POST(post({ query: '"material weakness"', candidates: [candidate] }));
    const body = await res.json();

    expect(body.verdicts[0].matched).toBe(true);
    expect(mocks.fetchCalls, 'a cache hit must cost SEC nothing').toHaveLength(0);
    expect(mocks.acquireCapacity, 'a cache hit must not occupy SEC capacity').not.toHaveBeenCalled();
    expect(body.summary).toMatchObject({ upstreamAttempts: 0, cacheHits: 1, budgetExhausted: false });
  });

  it('purges a poisoned cached SEC error page and validates against a fresh document', async () => {
    mocks.cacheText.set(
      'k',
      'Your Request Originated from an Undeclared Automated Tool',
    );

    const res = await POST(post({ query: '"material weakness"', candidates: [candidate] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.verdicts[0]).toMatchObject({ matched: true, validated: true });
    expect(mocks.fetchCalls, 'poison must be treated as a cache miss').toHaveLength(1);
    expect(mocks.cacheDelete, 'the poisoned row should be purged best-effort').toHaveBeenCalledOnce();
  });

  it('awaits a bounded poison purge before starting the replacement SEC fetch', async () => {
    mocks.cacheText.set('k', 'Request Rate Threshold Exceeded');
    let resolvePurge: (result: { error: null }) => void = () => undefined;
    mocks.cacheDelete.mockReturnValue(new Promise(resolve => { resolvePurge = resolve; }));

    const pending = POST(post({ query: 'weakness', candidates: [candidate] }));
    await vi.waitFor(() => expect(mocks.cacheDelete).toHaveBeenCalledOnce());
    expect(mocks.fetchSec).not.toHaveBeenCalled();

    resolvePurge({ error: null });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(mocks.fetchSec).toHaveBeenCalledOnce();
  });

  it('summarises validation so the caller can keep coverage honest', async () => {
    const res = await POST(post({ query: '"material weakness"', candidates: [candidate] }));
    const body = await res.json();
    expect(body.summary).toEqual({
      requested: 1,
      validated: 1,
      matched: 1,
      upstreamAttempts: 1,
      cacheHits: 0,
      budgetExhausted: false,
    });
  });

  it('stops SEC fan-out before exceeding the caller-supplied attempt budget', async () => {
    const second = { cik: '789019', accession: '0000789019-24-000456', document: 'msft.htm' };
    const res = await POST(post({
      query: 'weakness',
      candidates: [candidate, second],
      maxUpstreamAttempts: 1,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.fetchSec, 'only one real SEC attempt is authorized').toHaveBeenCalledTimes(1);
    expect(body.verdicts).toHaveLength(2);
    expect(body.summary).toMatchObject({
      upstreamAttempts: 1,
      cacheHits: 0,
      budgetExhausted: true,
    });
  });

  it('drops malformed candidates instead of trusting them into an SEC path', async () => {
    const res = await POST(post({
      query: 'weakness',
      candidates: [{ cik: 'abc', accession: '', document: '../../etc/passwd' }],
    }));
    const body = await res.json();
    expect(body.verdicts).toEqual([]);
    expect(mocks.fetchCalls).toHaveLength(0);
  });

  it.each([
    ['overlong CIK', { ...candidate, cik: '00000320193' }],
    ['non-decimal CIK', { ...candidate, cik: 'CIK0000320193' }],
    ['zero CIK', { ...candidate, cik: '0000000000' }],
    ['overlong accession', { ...candidate, accession: '0000320193-24-0001239' }],
    ['malformed accession', { ...candidate, accession: '0000320193--24-000123' }],
    ['dot-segment document', { ...candidate, document: '..' }],
    ['embedded dot segment', { ...candidate, document: 'aapl..htm' }],
    ['overlong document', { ...candidate, document: `${'a'.repeat(252)}.htm` }],
  ])('drops a %s candidate before any SEC fetch', async (_label, malformed) => {
    const res = await POST(post({ query: 'weakness', candidates: [malformed] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.verdicts).toEqual([]);
    expect(mocks.fetchCalls).toHaveLength(0);
    expect(mocks.fetchSec).not.toHaveBeenCalled();
    expect(mocks.acquireCapacity).not.toHaveBeenCalled();
  });

  it('canonicalizes padded CIK and accession punctuation before deduplication', async () => {
    const res = await POST(post({
      query: 'weakness',
      candidates: [
        candidate,
        { ...candidate, cik: '0000320193', accession: '000032019324000123' },
      ],
    }));
    const body = await res.json();

    expect(body.verdicts).toHaveLength(1);
    expect(body.verdicts[0]).toMatchObject({
      cik: '320193',
      accession: '000032019324000123',
      document: 'aapl.htm',
    });
    expect(mocks.fetchSec).toHaveBeenCalledOnce();
    expect(mocks.fetchCalls[0]).toContain(
      'Archives/edgar/data/320193/000032019324000123/aapl.htm'
    );
  });

  it('bounds how much work one request can request', async () => {
    const many = Array.from({ length: 200 }, () => candidate);
    const res = await POST(post({ query: 'weakness', candidates: many }));
    const body = await res.json();
    expect(body.verdicts.length).toBeLessThanOrEqual(40);
  });

  it('deduplicates canonical candidates before applying the 40-document cap', async () => {
    const second = { cik: '789019', accession: '0000789019-24-000456', document: 'msft.htm' };
    const res = await POST(post({
      query: 'weakness',
      candidates: [...Array.from({ length: 40 }, () => candidate), second],
    }));
    const body = await res.json();

    expect(body.verdicts).toHaveLength(2);
    expect(body.verdicts.map((verdict: { cik: string }) => verdict.cik)).toEqual(['320193', '789019']);
    expect(mocks.fetchSec).toHaveBeenCalledTimes(2);
  });

  it('rejects a newly fetched 2xx SEC error page before validation or cache write', async () => {
    mocks.responseText = 'Your Request Originated from an Undeclared Automated Tool';

    const res = await POST(post({ query: 'weakness', candidates: [candidate] }));
    const body = await res.json();

    expect(body.verdicts[0]).toMatchObject({ matched: false, validated: false });
    expect(mocks.cacheUpsert).not.toHaveBeenCalled();
    expect(mocks.releaseCapacity).toHaveBeenCalledOnce();
  });

  it('rejects a padded fresh 2xx SEC error page before validation or cache write', async () => {
    mocks.responseText = `${'padding '.repeat(800)}Request Rate Threshold Exceeded`;
    expect(mocks.responseText.length).toBeGreaterThan(5_000);

    const res = await POST(post({ query: 'weakness', candidates: [candidate] }));
    const body = await res.json();

    expect(body.verdicts[0]).toMatchObject({ matched: false, validated: false });
    expect(mocks.cacheUpsert).not.toHaveBeenCalled();
    expect(mocks.releaseCapacity).toHaveBeenCalledOnce();
  });

  it('purges a legacy padded cached error page instead of scoring it', async () => {
    mocks.cacheText.set('k', `${'padding '.repeat(800)}Request Rate Threshold Exceeded`);
    mocks.cacheValidationVersion = null;

    const res = await POST(post({ query: 'weakness', candidates: [candidate] }));
    const body = await res.json();

    expect(body.verdicts[0]).toMatchObject({ matched: true, validated: true });
    expect(mocks.cacheDelete).toHaveBeenCalledOnce();
    expect(mocks.fetchSec).toHaveBeenCalledOnce();
  });
});

describe('shared SEC document fair-access lease', () => {
  function filingTextRequest() {
    return new Request(
      'http://localhost/api/filing-text?cik=320193&accession=0000320193-24-000123&document=aapl.htm',
    );
  }

  it('protects the first SEC attempt in both routes with the same conservative global pool', async () => {
    const booleanResponse = await POST(post({ query: 'weakness', candidates: [candidate] }));
    const filingResponse = await GET_FILING_TEXT(filingTextRequest());

    expect(booleanResponse.status).toBe(200);
    expect(filingResponse.status).toBe(200);
    expect(mocks.acquireCapacity).toHaveBeenCalledTimes(2);
    expect(mocks.acquireCapacity.mock.calls[0][2]).toEqual(SEC_DOCUMENT_CONCURRENCY_OPTIONS);
    expect(mocks.acquireCapacity.mock.calls[1][2]).toEqual(SEC_DOCUMENT_CONCURRENCY_OPTIONS);
    expect(SEC_DOCUMENT_CONCURRENCY_OPTIONS).toMatchObject({
      operation: 'sec-filing-document-fetch',
      globalLimit: 4,
    });
    expect(mocks.acquireCapacity.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.fetchSec.mock.invocationCallOrder[0]);
    expect(mocks.acquireCapacity.mock.invocationCallOrder[1])
      .toBeLessThan(mocks.fetchSec.mock.invocationCallOrder[1]);
    expect(mocks.releaseCapacity).toHaveBeenCalledTimes(2);
  });

  it('checks the filing-text cache before occupying shared SEC capacity', async () => {
    mocks.cacheText.set('k', 'cached filing text');

    const response = await GET_FILING_TEXT(filingTextRequest());

    expect(response.status).toBe(200);
    expect(mocks.acquireCapacity).not.toHaveBeenCalled();
    expect(mocks.fetchSec).not.toHaveBeenCalled();
  });

  it('releases filing-text capacity when the first SEC request throws', async () => {
    mocks.fetchSec.mockRejectedValueOnce(new Error('SEC unavailable'));

    const response = await GET_FILING_TEXT(filingTextRequest());

    expect(response.status).toBe(502);
    expect(mocks.releaseCapacity).toHaveBeenCalledOnce();
  });

  it('rejects a newly fetched filing-text 2xx error page and never caches it', async () => {
    mocks.responseText = 'Request Rate Threshold Exceeded';

    const response = await GET_FILING_TEXT(filingTextRequest());

    expect(response.status).toBe(502);
    expect(mocks.cacheUpsert).not.toHaveBeenCalled();
    expect(mocks.releaseCapacity).toHaveBeenCalledOnce();
  });

  it('rejects a padded fresh filing-text error page and never caches it', async () => {
    mocks.responseText = `${'padding '.repeat(800)}Request Rate Threshold Exceeded`;
    expect(mocks.responseText.length).toBeGreaterThan(5_000);

    const response = await GET_FILING_TEXT(filingTextRequest());

    expect(response.status).toBe(502);
    expect(mocks.cacheUpsert).not.toHaveBeenCalled();
    expect(mocks.releaseCapacity).toHaveBeenCalledOnce();
  });

  it('purges a legacy padded filing-text cache row before refetching', async () => {
    mocks.cacheText.set('k', `${'padding '.repeat(800)}Request Rate Threshold Exceeded`);
    mocks.cacheValidationVersion = null;

    const response = await GET_FILING_TEXT(filingTextRequest());

    expect(response.status).toBe(200);
    expect(mocks.cacheDelete).toHaveBeenCalledOnce();
    expect(mocks.fetchSec).toHaveBeenCalledOnce();
  });

  it('does not repeatedly purge a validated long filing that quotes an SEC notice', async () => {
    mocks.cacheText.set('k', `${'filing disclosure '.repeat(500)}Request Rate Threshold Exceeded`);
    mocks.cacheValidationVersion = 1;

    const response = await GET_FILING_TEXT(filingTextRequest());

    expect(response.status).toBe(200);
    expect(mocks.cacheDelete).not.toHaveBeenCalled();
    expect(mocks.fetchSec).not.toHaveBeenCalled();
  });

  it.each([
    ['repaired CIK prefix', 'CIK0000320193', '0000320193-24-000123', 'aapl.htm'],
    ['overlong CIK', '12345678901', '0000320193-24-000123', 'aapl.htm'],
    ['zero CIK', '0000000000', '0000320193-24-000123', 'aapl.htm'],
    ['short accession', '320193', '123', 'aapl.htm'],
    ['repaired accession punctuation', '320193', '0000320193x24x000123', 'aapl.htm'],
    ['dot segment document', '320193', '0000320193-24-000123', '..'],
    ['embedded dot segment document', '320193', '0000320193-24-000123', 'aapl..htm'],
    ['overlong document', '320193', '0000320193-24-000123', `${'a'.repeat(252)}.htm`],
  ])('rejects %s before cache or SEC work', async (_label, cik, accession, document) => {
    const request = new Request(`http://localhost/api/filing-text?${new URLSearchParams({
      cik,
      accession,
      document,
    })}`);

    const response = await GET_FILING_TEXT(request);

    expect(response.status).toBe(400);
    expect(mocks.acquireCapacity).not.toHaveBeenCalled();
    expect(mocks.fetchSec).not.toHaveBeenCalled();
    expect(mocks.cacheDelete).not.toHaveBeenCalled();
    expect(mocks.cacheUpsert).not.toHaveBeenCalled();
  });

  it('awaits the bounded filing-text cache write before returning success', async () => {
    let resolveWrite: (result: { error: null }) => void = () => undefined;
    mocks.cacheUpsert.mockReturnValue(new Promise(resolve => { resolveWrite = resolve; }));
    let completed = false;

    const pending = GET_FILING_TEXT(filingTextRequest()).then(response => {
      completed = true;
      return response;
    });
    await vi.waitFor(() => expect(mocks.cacheUpsert).toHaveBeenCalledOnce());
    expect(completed).toBe(false);

    resolveWrite({ error: null });
    const response = await pending;
    expect(response.status).toBe(200);
  });
});

describe('upstream failure injection (WP4/T13): error pages are never filing text', () => {
  it.each([
    ['403 rate-threshold page', { ok: false, status: 403, headers: new Headers({ 'content-type': 'text/html' }) }],
    ['404 not found', { ok: false, status: 404, headers: new Headers({ 'content-type': 'text/html' }) }],
    ['429 rate limited', { ok: false, status: 429, headers: new Headers({ 'content-type': 'text/html' }) }],
    ['500 server error', { ok: false, status: 500, headers: new Headers({ 'content-type': 'text/html' }) }],
    ['200 with a binary content type', { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/pdf' }) }],
  ])('%s yields an unvalidated verdict, never a non-match, and caches nothing', async (_label, response) => {
    mocks.fetchSec.mockImplementation(async () => response);

    const res = await POST(post({ query: '"material weakness"', candidates: [candidate] }));
    const body = await res.json();

    // Unvalidated — NOT a validated non-match: the matcher never saw prose.
    expect(body.verdicts[0].validated).toBe(false);
    expect(body.verdicts[0].matched).toBe(false);
    // Nothing was written to the shared text cache.
    expect(mocks.cacheText.size).toBe(0);
  });

  it('a clean fetch still validates and caches (guard is not over-broad)', async () => {
    const res = await POST(post({ query: '"material weakness"', candidates: [candidate] }));
    const body = await res.json();
    expect(body.verdicts[0].validated).toBe(true);
    expect(body.verdicts[0].matched).toBe(true);
  });
});
