import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  delay: vi.fn(),
}));

vi.mock('../../data-pipeline/supabase', () => ({
  createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

vi.mock('../../data-pipeline/edgar-index', () => ({
  delay: mocks.delay,
}));

import {
  bulkTickers,
  fetchSecJson,
  isTickerExchangePayload,
  sicPass,
} from '../../data-pipeline/enrich-companies';

type FailureFixture = {
  label: string;
  reason: 'network' | 'rate-limited' | 'server-error' | 'invalid-json';
  status: number | null;
  response: () => Promise<Response>;
};

const failureFixtures: FailureFixture[] = [
  {
    label: 'network failure',
    reason: 'network',
    status: null,
    response: async () => { throw new TypeError('socket closed'); },
  },
  {
    label: 'SEC rate limiting',
    reason: 'rate-limited',
    status: 429,
    response: async () => new Response('rate limited', { status: 429 }),
  },
  {
    label: 'SEC server failure',
    reason: 'server-error',
    status: 503,
    response: async () => new Response('unavailable', { status: 503 }),
  },
  {
    label: 'invalid JSON',
    reason: 'invalid-json',
    status: 200,
    response: async () => new Response('{not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  },
];

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ cik: 320193 }], error: null });
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.from.mockReset().mockReturnValue({ upsert: mocks.upsert });
  mocks.delay.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SEC company enrichment fetch classification', () => {
  it('returns decoded successful JSON without retrying', async () => {
    const payload = { name: 'Apple Inc.', sic: '3571' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecJson('https://data.sec.gov/submissions/example.json', {
      retryBaseMs: 0,
    })).resolves.toEqual({ kind: 'success', data: payload, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('treats an SEC 404 as authoritative and does not retry it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecJson('https://data.sec.gov/submissions/missing.json', {
      retryBaseMs: 0,
    })).resolves.toEqual({ kind: 'not-found', status: 404, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(failureFixtures)('classifies retry-exhausted $label', async ({ reason, status, response }) => {
    const fetchMock = vi.fn().mockImplementation(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecJson('https://data.sec.gov/submissions/retry.json', {
      maxAttempts: 3,
      retryBaseMs: 0,
    })).resolves.toEqual({ kind: 'retry-exhausted', reason, status, attempts: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('classifies a decoded but invalid endpoint shape as invalid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecJson('https://data.sec.gov/submissions/invalid-shape.json', {
      maxAttempts: 2,
      retryBaseMs: 0,
      validate: value => Boolean(value && typeof value === 'object' && 'sic' in value),
    })).resolves.toEqual({
      kind: 'retry-exhausted',
      reason: 'invalid-json',
      status: 200,
      attempts: 2,
    });
  });

  it.each([
    {
      label: 'reordered headers',
      payload: {
        fields: ['name', 'cik', 'ticker', 'exchange'],
        data: [[320193, 'Apple Inc.', 'AAPL', 'Nasdaq']],
      },
    },
    {
      label: 'an extra header and column',
      payload: {
        fields: ['cik', 'name', 'ticker', 'exchange', 'unexpected'],
        data: [[320193, 'Apple Inc.', 'AAPL', 'Nasdaq', 'value']],
      },
    },
    {
      label: 'a short row',
      payload: {
        fields: ['cik', 'name', 'ticker', 'exchange'],
        data: [[320193, 'Apple Inc.', 'AAPL']],
      },
    },
  ])('rejects ticker exchange schema with $label', ({ payload }) => {
    expect(isTickerExchangePayload(payload)).toBe(false);
  });

  it('accepts only the exact four-column SEC ticker exchange schema', () => {
    expect(isTickerExchangePayload({
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [[320193, 'Apple Inc.', 'AAPL', 'Nasdaq']],
    })).toBe(true);
  });

  it('fails before any ticker upsert when the downloaded schema is reordered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      fields: ['name', 'cik', 'ticker', 'exchange'],
      data: [[320193, 'Apple Inc.', 'AAPL', 'Nasdaq']],
    }), { status: 200 })));

    await expect(bulkTickers()).rejects.toThrow('invalid-json');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('SIC sentinel persistence', () => {
  it('persists SIC 0000 only for an authoritative SEC 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));

    await sicPass(1, { retryBaseMs: 0, requestDelayMs: 0 });

    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      cik: 320193,
      sic: '0000',
      sic_description: 'UNKNOWN (no submissions record)',
    }), { onConflict: 'cik' });
  });

  it('persists the SEC SIC on a validated successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: 'Apple Inc.',
      sic: '3571',
      sicDescription: 'Electronic Computers',
      tickers: ['AAPL'],
      exchanges: ['Nasdaq'],
    }), { status: 200 })));

    await sicPass(1, { retryBaseMs: 0, requestDelayMs: 0 });

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      cik: 320193,
      sic: '3571',
      sic_description: 'Electronic Computers',
    }), { onConflict: 'cik' });
    expect(mocks.upsert.mock.calls[0][0]).not.toHaveProperty('sic', '0000');
  });

  it.each(failureFixtures)('leaves the database untouched after retry-exhausted $label', async ({ reason, response }) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(response));

    await expect(sicPass(1, {
      maxAttempts: 2,
      retryBaseMs: 0,
      requestDelayMs: 0,
    })).rejects.toThrow(reason);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
