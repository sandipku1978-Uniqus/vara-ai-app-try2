import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<[string, ...unknown[]]>,
  result: { data: [] as unknown[] | null, error: null as unknown, count: 0 as number | null },
}));

vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => db,
}));
vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn().mockResolvedValue({
    identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' },
  }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitResponse: vi.fn(),
}));

import { GET, MAX_PEER_CANDIDATES } from '../app/api/peer-candidates/route';

function chain() {
  const builder = {
    select: (...args: unknown[]) => { db.calls.push(['select', ...args]); return builder; },
    eq: (...args: unknown[]) => { db.calls.push(['eq', ...args]); return builder; },
    neq: (...args: unknown[]) => { db.calls.push(['neq', ...args]); return builder; },
    order: (...args: unknown[]) => { db.calls.push(['order', ...args]); return builder; },
    limit: async (...args: unknown[]) => { db.calls.push(['limit', ...args]); return db.result; },
  };
  return builder;
}

describe('/api/peer-candidates', () => {
  beforeEach(() => {
    db.calls = [];
    db.from.mockReset().mockImplementation((table: string) => { db.calls.push(['from', table]); return chain(); });
    db.result = {
      data: [
        { cik: 320193, name: 'Apple Inc.', tickers: ['AAPL'], exchanges: ['Nasdaq'], sic: '3571', sic_description: 'Electronic Computers' },
        { cik: 1571996, name: 'Dell Technologies Inc.', tickers: ['DELL'], exchanges: ['NYSE'], sic: '3571', sic_description: null },
        { cik: 99, name: 'Delisted Co', tickers: [''], exchanges: [], sic: '3571', sic_description: null },
      ],
      error: null,
      count: 3,
    };
  });

  it('reads one SIC population from the company store, listed registrants only', async () => {
    const response = await GET(new Request('http://localhost/api/peer-candidates?sic=3571'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(db.calls).toEqual([
      ['from', 'urc_sec_companies'],
      ['select', 'cik, name, tickers, exchanges, sic, sic_description', { count: 'exact' }],
      ['eq', 'sic', '3571'],
      ['neq', 'tickers', '{}'],
      ['order', 'cik', { ascending: true }],
      ['limit', MAX_PEER_CANDIDATES],
    ]);
    expect(body).toMatchObject({ sic: '3571', matched: 3, returned: 2, capped: false, source: 'urc_sec_companies' });
    expect(body.companies).toEqual([
      { cik: '320193', name: 'Apple Inc.', tickers: ['AAPL'], exchanges: ['Nasdaq'], sic: '3571', sicDescription: 'Electronic Computers' },
      { cik: '1571996', name: 'Dell Technologies Inc.', tickers: ['DELL'], exchanges: ['NYSE'], sic: '3571', sicDescription: null },
    ]);
  });

  it('says when the population was larger than one read', async () => {
    db.result = { ...db.result, count: 812 };
    const body = await (await GET(new Request('http://localhost/api/peer-candidates?sic=6798'))).json();
    expect(body).toMatchObject({ matched: 812, capped: true });
  });

  it('rejects a malformed SIC code before touching the database', async () => {
    const response = await GET(new Request('http://localhost/api/peer-candidates?sic=35%2771'));
    expect(response.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('surfaces a store outage as 503, never as an empty industry', async () => {
    db.result = { data: null, error: { message: 'timeout' }, count: null };
    const response = await GET(new Request('http://localhost/api/peer-candidates?sic=7372'));
    expect(response.status).toBe(503);
  });
});
