import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheText: new Map<string, string>(),
  fetchCalls: [] as string[],
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => ({ identity: { userId: 'u1', orgId: null, cacheScope: 'u1:personal' } }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
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
                return { data: key ? { text: mocks.cacheText.get(key) } : null };
              },
            }),
          }),
        }),
      }),
    }),
  }),
  getCacheWriterSupabase: () => null,
}));
vi.mock('../lib/filingTextServer', () => ({
  extractDocumentTextFromHtmlServer: (html: string) => html,
}));
vi.mock('../lib/sec-upstream', () => ({
  buildSecTargetUrl: (_u: string, path: string) => { mocks.fetchCalls.push(path); return new URL(`https://sec.gov/${path}`); },
  fetchSecResponse: async () => ({ ok: true }),
  readResponseWithLimit: async () => new TextEncoder().encode('the filing discloses a material weakness in controls'),
}));

import { POST } from '../app/api/boolean-validate/route';

function post(body: unknown) {
  return new Request('http://localhost/api/boolean-validate', { method: 'POST', body: JSON.stringify(body) });
}

const candidate = { cik: '320193', accession: '0000320193-24-000123', document: 'aapl.htm' };

beforeEach(() => {
  mocks.cacheText.clear();
  mocks.fetchCalls.length = 0;
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
  });

  it('summarises validation so the caller can keep coverage honest', async () => {
    const res = await POST(post({ query: '"material weakness"', candidates: [candidate] }));
    const body = await res.json();
    expect(body.summary).toEqual({ requested: 1, validated: 1, matched: 1 });
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

  it('bounds how much work one request can request', async () => {
    const many = Array.from({ length: 200 }, () => candidate);
    const res = await POST(post({ query: 'weakness', candidates: many }));
    const body = await res.json();
    expect(body.verdicts.length).toBeLessThanOrEqual(40);
  });
});
