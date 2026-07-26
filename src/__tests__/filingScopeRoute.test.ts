import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  db: true,
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => ({ identity: { userId: 'u1', orgId: null, cacheScope: 'u1:personal' } }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => (mocks.db ? { rpc: mocks.rpc } : null),
}));

import { GET } from '../app/api/filing-scope/route';

const get = (qs: string) => new Request(`http://localhost/api/filing-scope?${qs}`);

beforeEach(() => {
  mocks.db = true;
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({
    data: [
      { year: 2024, filings: 7739, total_count: 137379 },
      { year: 2025, filings: 7403, total_count: 137379 },
    ],
    error: null,
  });
});

describe('GET /api/filing-scope', () => {
  it('reports the in-scope population and its shape by year', async () => {
    const res = await GET(get('forms=10-K&start=2011-01-01'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scope.total).toBe(137379);
    expect(body.scope.byYear).toEqual([
      { year: 2024, filings: 7739 },
      { year: 2025, filings: 7403 },
    ]);
    // The reader must never be told we hold filings older than we do.
    expect(body.scope.coverageStart).toBe('2010-01-02');
  });

  it('passes the scope through to the RPC, uppercasing forms', async () => {
    await GET(get('forms=10-k,8-K&start=2015-01-01&end=2020-12-31&cik=320193'));
    expect(mocks.rpc).toHaveBeenCalledWith('urc_filing_scope_stats', {
      p_forms: ['10-K', '8-K'],
      p_start: '2015-01-01',
      p_end: '2020-12-31',
      p_cik: 320193,
    });
  });

  it('answers an unscoped request — the case that most needs a denominator', async () => {
    // Served from the year/form rollup (migration 013) in ~130ms, so the
    // broadest search still gets told how large its population was.
    const res = await GET(get(''));
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_filing_scope_stats', {
      p_forms: null, p_start: null, p_end: null, p_cik: null,
    });
  });

  it('rejects malformed dates and CIKs', async () => {
    expect((await GET(get('forms=10-K&start=01/01/2011'))).status).toBe(400);
    expect((await GET(get('cik=abc'))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reports zero rather than a wrong number when the scope is empty', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const body = await (await GET(get('forms=10-K&start=2030-01-01'))).json();
    expect(body.scope.total).toBe(0);
    expect(body.scope.byYear).toEqual([]);
  });

  it('degrades to no-denominator instead of failing the search', async () => {
    // The caller falls back to showing results without a scope line; a missing
    // metadata layer must never take the result list down with it.
    mocks.db = false;
    expect((await GET(get('forms=10-K'))).status).toBe(503);

    mocks.db = true;
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await GET(get('forms=10-K'))).status).toBe(502);
  });
});
