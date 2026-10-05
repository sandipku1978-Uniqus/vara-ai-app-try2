import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn().mockResolvedValue({
    identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' },
  }),
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
}));

vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => ({ rpc: mocks.rpc }),
}));

import { GET } from '../app/api/letters/route';

let completionSpy: MockInstance;

function get(query: string): Request {
  return new Request(`http://localhost/api/letters?${query}`);
}

beforeEach(() => {
  mocks.rpc.mockReset();
  completionSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  completionSpy.mockRestore();
});

describe('GET /api/letters browse pagination', () => {
  it('preserves the filtered total when an empty deep page has no total_count carrier', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ thread_id: 'first-thread', total_count: 137 }],
        error: null,
      });

    const response = await GET(get('from=200&size=20&company=Apple%20Inc.&cik=320193'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ total: 137, threads: [] });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'urc_recent_threads', {
      p_limit: 20,
      p_offset: 200,
      p_company: 'Apple Inc.',
      p_cik: 320193,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'urc_recent_threads', {
      p_limit: 1,
      p_offset: 0,
      p_company: 'Apple Inc.',
      p_cik: 320193,
    });
  });

  it('reports a genuine zero when the bounded page-0 probe is also empty', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(get('from=80&size=20&company=No%20Such%20Company'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ total: 0, threads: [] });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('fails closed when total recovery fails instead of returning a false zero', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: '57014', message: 'statement timeout' },
      });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await GET(get('from=80&size=20'));
      const body = await response.json();

      expect(response.status).toBe(504);
      expect(body).toMatchObject({ ok: false, errorClass: 'statement-timeout' });
      expect(body).not.toHaveProperty('total');
      expect(body).not.toHaveProperty('threads');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns a correlated typed envelope for an early invalid request', async () => {
    const response = await GET(get('cik=not-a-cik'));
    const body = await response.json();
    const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      errorClass: 'invalid-request',
      correlationId: expect.any(String),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
    expect(completion).toMatchObject({
      kind: 'route-completion',
      route: 'letters',
      outcome: 'rejected',
      mode: 'request',
      errorClass: 'invalid-request',
      dbCallCount: 0,
      correlationId: body.correlationId,
    });
  });

  it('logs one safe browse completion with only aggregate counts', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ thread_id: 'thread-1', total_count: 1 }],
      error: null,
    });

    const response = await GET(get('size=20'));
    const body = await response.json();
    const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    // The route's own completion record plus the platform-wide route line
    // from withRouteObservability, joined by one correlation ID.
    expect(completionSpy).toHaveBeenCalledTimes(2);
    const routeLine = JSON.parse(String(completionSpy.mock.calls[1][0]));
    expect(routeLine).toMatchObject({ kind: 'route', route: 'letters', status: 200, correlationId: completion.correlationId });
    expect(completion).toMatchObject({
      kind: 'route-completion',
      route: 'letters',
      outcome: 'success',
      mode: 'browse',
      returnedCount: 1,
      total: 1,
      dbCallCount: 1,
    });
    expect(response.headers.get('x-correlation-id')).toBe(completion.correlationId);
    expect(String(completionSpy.mock.calls[0][0])).not.toContain('thread-1');
  });

  it('sends exactly the original seven arguments for an unfiltered text search', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ accession: 'a', total_count: 1 }], error: null });

    const response = await GET(get('q=segment%20reporting&size=10'));

    expect(response.status).toBe(200);
    expect(Object.keys(mocks.rpc.mock.calls[0][1]).sort()).toEqual([
      'p_company', 'p_end', 'p_form', 'p_limit', 'p_offset', 'p_query', 'p_start',
    ]);
    expect(await response.json()).toMatchObject({ total: 1, ordering: 'relevance' });
  });

  it('passes date, CIK, industry and reviewed-form filters to urc_search_letters', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ accession: 'a', total_count: 10001 }], error: null });

    const response = await GET(get(
      'q=segment&form=UPLOAD&startdt=2024-01-01&enddt=2025-12-31&cik=320193&sic=3571&forms=10-K,10-Q,10-K&size=50'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_search_letters', {
      p_query: 'segment',
      p_form: 'UPLOAD',
      p_start: '2024-01-01',
      p_end: '2025-12-31',
      p_limit: 50,
      p_offset: 0,
      p_company: null,
      p_cik: 320193,
      p_sic: '3571',
      p_reviewed_forms: ['10-K', '10-Q'],
    });
    expect(body).toMatchObject({ total: 10000, totalIsFloor: true });
  });

  it('runs a filter-only search, newest first, when a structured filter has no query text', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await GET(get('forms=S-1&sic=2834&size=50'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_search_letters', expect.objectContaining({
      p_query: '', p_sic: '2834', p_reviewed_forms: ['S-1'],
    }));
    expect(body).toEqual({ total: 0, totalIsFloor: false, ordering: 'newest', matches: [] });
  });

  it('keeps a company-only request on the episode browse', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await GET(get('cik=320193&size=12'));
    expect(mocks.rpc.mock.calls[0][0]).toBe('urc_recent_threads');
  });

  it.each([
    ['sic=12a4'],
    ['forms=' + Array.from({ length: 13 }, (_, index) => `F${index}`).join(',')],
    ['forms=10-K;drop'],
  ])('rejects malformed filter %s before any database call', async query => {
    const response = await GET(get(`q=x&${query}`));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns a safe correlated generic envelope when the RPC throws', async () => {
    const secretQuery = 'private-query-must-not-be-logged';
    mocks.rpc.mockRejectedValue(new Error(`failure while processing ${secretQuery}`));

    const response = await GET(get(`q=${secretQuery}`));
    const body = await response.json();
    const rawCompletion = String(completionSpy.mock.calls[0][0]);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      errorClass: 'unexpected',
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain(secretQuery);
    expect(rawCompletion).not.toContain(secretQuery);
    expect(JSON.parse(rawCompletion)).toMatchObject({
      kind: 'route-completion',
      route: 'letters',
      outcome: 'error',
      mode: 'search',
      errorClass: 'unexpected',
      dbCallCount: 1,
      correlationId: body.correlationId,
    });
  });
});
