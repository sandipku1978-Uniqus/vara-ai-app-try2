import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  createMessage: vi.fn(),
  release: vi.fn(),
  reserve: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: class MockAnthropic {
    messages = { create: mocks.createMessage };
  },
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn(async () => ({
    response: null,
    identity: { userId: 'user-1', orgId: null, cacheScope: 'user:user-1' },
  })),
}));

vi.mock('../lib/ai-input', () => ({
  validateCompareRequest: vi.fn(async () => ({
    value: {
      tickers: ['AAPL', 'MSFT'],
      section: 'risk factors',
      filingContexts: [
        { ticker: 'AAPL', companyName: 'Apple', text: 'Evidence A' },
        { ticker: 'MSFT', companyName: 'Microsoft', text: 'Evidence B' },
      ],
    },
  })),
}));

vi.mock('../lib/cache', () => ({
  cacheService: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
  },
}));

vi.mock('../lib/rate-limit', () => ({
  checkAiRateLimit: vi.fn(async () => ({ allowed: true })),
  acquireAiConcurrency: mocks.acquire,
  estimateModelTokenReservation: vi.fn(() => 10_000),
  reserveAiTokenBudget: mocks.reserve,
  releaseAiConcurrency: mocks.release,
  rateLimitResponse: vi.fn((result: { reason?: string }) => Response.json(
    { error: result.reason || 'rate limited' },
    { status: 429 }
  )),
}));

describe('AI capacity and spend ordering', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    mocks.acquire.mockReset().mockResolvedValue({
      allowed: false,
      reason: 'concurrency',
      retryAfter: 1,
    });
    mocks.reserve.mockReset().mockResolvedValue({ allowed: true });
    mocks.release.mockReset().mockResolvedValue(undefined);
    mocks.createMessage.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not reserve daily model spend when concurrency is denied', async () => {
    const { POST } = await import('../app/api/compare/route');
    const response = await POST(new Request('http://localhost/api/compare', {
      method: 'POST',
      body: '{}',
    }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'concurrency' });
    expect(mocks.acquire).toHaveBeenCalledOnce();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
