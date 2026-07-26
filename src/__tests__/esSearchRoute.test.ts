import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));
const concurrencyMock = vi.hoisted(() => vi.fn());
const releaseConcurrencyMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => dbMock),
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn().mockResolvedValue({
    identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' },
  }),
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  acquireResourceConcurrency: concurrencyMock,
  releaseAiConcurrency: releaseConcurrencyMock,
  rateLimitResponse: vi.fn((result: { reason?: string }) => Response.json(
    { error: result.reason || 'rate limited' },
    { status: 429 }
  )),
}));

import { GET } from '../app/api/es-search/route';

function eftsPage(url: string) {
  const params = new URL(url).searchParams;
  const from = Number(params.get('from') || 0);
  const size = Math.min(Number(params.get('size') || 10), 100);
  const total = 250;
  const hits = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, index) => {
    const position = from + index;
    return {
      _id: `filing-${position}`,
      _score: 1,
      _source: {
        ciks: ['0000320193'],
        adsh: `0000320193-23-${String(position).padStart(6, '0')}`,
        form: '10-K',
        file_date: '2023-11-02',
        // 3571 is deliberately secondary: SEARCH-03 must not inspect only [0].
        sics: ['2834', '3571'],
      },
    };
  });
  return { hits: { total: { value: total }, hits } };
}

describe('/api/es-search paging and coverage contract', () => {
  beforeEach(() => {
    process.env.URC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.URC_SUPABASE_SERVICE_KEY = 'test-key';
    dbMock.rpc.mockReset();
    concurrencyMock.mockReset().mockResolvedValue({
      allowed: true,
      lease: { token: 'test', keys: [], local: true, released: false },
    });
    releaseConcurrencyMock.mockReset().mockResolvedValue(undefined);
    dbMock.from.mockImplementation(() => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      new Response(JSON.stringify(eftsPage(String(input))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ));
  });

  it('serves the second 100-row page without treating the server clamp as EOF', async () => {
    const response = await GET(new Request('http://localhost/api/es-search?q=controls&from=100&size=100'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(100);
    expect(body.hits.hits[0]._id).toBe('filing-100');
    expect(body.hits.hits[99]._id).toBe('filing-199');
    expect(body.hits.total).toEqual({ value: 250, relation: 'eq' });
  });

  it('matches a secondary SIC across the complete upstream candidate set', async () => {
    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&size=20'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(20);
    expect(body.hits.hits[0]._source.sics).toContain('3571');
    expect(body.hits.total).toEqual({ value: 250, relation: 'eq' });
    expect(body.meta.candidateCoverage).toEqual({
      examined: 250,
      upstreamTotal: 250,
      complete: true,
      upstreamTotalIsFloor: false,
    });
  });

  it('fills a sparse facet page when matches occur after the former three-times window', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const total = 500;
      const hits = Array.from({ length: Math.min(size, total - from) }, (_, index) => {
        const position = from + index;
        return {
          _id: `sparse-${position}`,
          _source: {
            ciks: ['0000320193'],
            adsh: `sparse-${position}`,
            form: '10-K',
            sics: position >= 300 && position < 320 ? ['3571'] : ['2834'],
          },
        };
      });
      return new Response(JSON.stringify({ hits: { total: { value: total, relation: 'eq' }, hits } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&size=20'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(20);
    expect(body.hits.hits[0]._id).toBe('sparse-300');
    expect(body.meta.candidateCoverage).toEqual({ examined: 500, upstreamTotal: 500, complete: true, upstreamTotalIsFloor: false });
  });

  it('fetches a no-facet page beyond candidate 1,000 directly from the requested offset', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const total = 2_000;
      const hits = Array.from({ length: Math.min(size, total - from) }, (_, index) => ({
        _id: `deep-${from + index}`,
        _source: { ciks: ['0000320193'], adsh: `deep-${from + index}`, form: '10-K' },
      }));
      return new Response(JSON.stringify({ hits: { total: { value: total, relation: 'eq' }, hits } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&from=1100&size=100'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(100);
    expect(body.hits.hits[0]._id).toBe('deep-1100');
    expect(body.hits.total).toEqual({ value: 2_000, relation: 'eq' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('rejects facet pagination beyond the bounded candidate window instead of returning a false empty page', async () => {
    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&from=1100&size=20'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain('bounded to the first 1000');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('rejects a heavy facet scan before SEC fan-out when global capacity is unavailable', async () => {
    concurrencyMock.mockResolvedValueOnce({ allowed: false, reason: 'concurrency', retryAfterSeconds: 5 });

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&size=20'));

    expect(response.status).toBe(429);
    expect(concurrencyMock).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(releaseConcurrencyMock).not.toHaveBeenCalled();
  });

  it('preserves an upstream gte total relation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const hits = Array.from({ length: size }, (_, index) => ({
        _id: `gte-${from + index}`,
        _source: { ciks: ['0000320193'], adsh: `gte-${from + index}`, form: '10-K' },
      }));
      return new Response(JSON.stringify({ hits: { total: { value: 10_000, relation: 'gte' }, hits } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&size=25'));
    const body = await response.json();
    expect(body.hits.total).toEqual({ value: 10_000, relation: 'gte' });
  });

  it('bounds sequential EFTS candidate requests even when upstream returns one hit per page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      return new Response(JSON.stringify({
        hits: {
          total: { value: 5_000, relation: 'eq' },
          hits: [{
            _id: `slow-${from}`,
            _source: { ciks: ['0000320193'], adsh: `slow-${from}`, form: '10-K', sics: ['3571'] },
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&from=900&size=100'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(100);
    expect(body.meta.candidateCoverage).toEqual({ examined: 100, upstreamTotal: 5_000, complete: false, upstreamTotalIsFloor: false });
    expect(body.hits.total).toEqual({ value: 100, relation: 'gte' });
  });
});
