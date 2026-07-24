import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => ({ identity: { userId: 'u1', orgId: null, cacheScope: 'u1:personal' } }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));

import { POST } from '../app/api/client-error/route';

function post(body: unknown) {
  return new Request('http://localhost/api/client-error', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(String(args[0]));
  });
});

describe('POST /api/client-error', () => {
  it('records the error identity and digest as one structured line', async () => {
    const res = await POST(post({
      name: 'TypeError', message: 'x is not a function',
      digest: '38ab21', route: '/search', stack: 'at foo\nat bar',
    }));

    expect(res.status).toBe(200);
    const entry = JSON.parse(logged[0]);
    expect(entry).toMatchObject({
      kind: 'client-error',
      name: 'TypeError',
      digest: '38ab21',
      route: '/search',
    });
  });

  it('strips the query string — a route can carry the user\'s search terms', async () => {
    await POST(post({ name: 'Error', route: '/search?q=%22material+weakness%22&auditor=KPMG' }));
    const entry = JSON.parse(logged[0]);
    expect(entry.route).toBe('/search');
    expect(logged[0]).not.toContain('material');
    expect(logged[0]).not.toContain('KPMG');
  });

  it('drops unknown fields rather than trusting the client', async () => {
    await POST(post({
      name: 'Error',
      query: '"material weakness" AND auditor:KPMG',
      filingText: 'confidential extract',
      ticker: 'OGN',
    }));
    expect(logged[0]).not.toContain('material weakness');
    expect(logged[0]).not.toContain('confidential');
    expect(logged[0]).not.toContain('OGN');
  });

  it('rejects malformed and oversized bodies without logging', async () => {
    expect((await POST(post('not json'))).status).toBe(400);
    const huge = { name: 'Error', stack: 'x'.repeat(20_000) };
    expect((await POST(post(huge))).status).toBe(413);
    expect(logged).toHaveLength(0);
  });

  it('truncates a long stack instead of unbounded logging', async () => {
    await POST(post({ name: 'Error', stack: 'y'.repeat(9_000) }));
    expect(JSON.parse(logged[0]).stack.length).toBeLessThanOrEqual(4_000);
  });
});
