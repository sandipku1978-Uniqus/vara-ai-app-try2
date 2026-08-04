import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  body: '',
  contentType: 'application/json; charset=utf-8',
  status: 200,
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => ({
    identity: { userId: 'efts-test', orgId: null, cacheScope: 'efts-test:personal' },
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
    fetchSecResponse: async () => new Response(mocks.body, {
      status: mocks.status,
      headers: { 'Content-Type': mocks.contentType },
    }),
    readResponseWithLimit: async () => new TextEncoder().encode(mocks.body),
  };
});

import { GET } from '../app/api/sec-efts/route';

function request(): Request {
  return new Request(
    'http://localhost/api/sec-efts?path=LATEST%2Fsearch-index&q=controls&from=0&size=10',
  );
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hits: {
      total: { value: 1, relation: 'eq' },
      hits: [{ _id: 'filing-1:aapl.htm', _source: { form: '10-K' } }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.body = JSON.stringify(validPayload());
  mocks.contentType = 'application/json; charset=utf-8';
  mocks.status = 200;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/sec-efts strict 2xx validation', () => {
  it('forwards a valid EFTS payload after validating its contract', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.total).toEqual({ value: 1, relation: 'eq' });
    expect(body.hits.hits[0]._id).toBe('filing-1:aapl.htm');
  });

  it('rejects a JSON-looking body served with a non-JSON media type', async () => {
    mocks.contentType = 'text/html';

    const response = await GET(request());

    expect(response.status).toBe(502);
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['a negative total', JSON.stringify(validPayload({
      hits: { total: { value: -1, relation: 'eq' }, hits: [] },
    }))],
    ['a non-finite total', '{"hits":{"total":{"value":1e400,"relation":"eq"},"hits":[]}}'],
    ['a missing relation', JSON.stringify(validPayload({
      hits: { total: { value: 1 }, hits: [] },
    }))],
    ['an unknown relation', JSON.stringify(validPayload({
      hits: { total: { value: 1, relation: 'approximate' }, hits: [] },
    }))],
    ['a non-array hit list', JSON.stringify(validPayload({
      hits: { total: { value: 1, relation: 'eq' }, hits: {} },
    }))],
    ['an empty hit id', JSON.stringify(validPayload({
      hits: { total: { value: 1, relation: 'eq' }, hits: [{ _id: '', _source: {} }] },
    }))],
    ['a control character in a hit id', JSON.stringify(validPayload({
      hits: { total: { value: 1, relation: 'eq' }, hits: [{ _id: 'bad\u0000id', _source: {} }] },
    }))],
    ['an array hit source', JSON.stringify(validPayload({
      hits: { total: { value: 1, relation: 'eq' }, hits: [{ _id: 'filing-1', _source: [] }] },
    }))],
  ])('rejects a malformed 200 response with %s', async (_label, body) => {
    mocks.body = body;

    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'SEC search proxy request failed.' });
  });
});
