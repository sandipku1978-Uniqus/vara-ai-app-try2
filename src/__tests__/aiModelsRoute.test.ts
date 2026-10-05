import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn(async () => ({
    response: null,
    identity: { userId: 'user-1', orgId: null, cacheScope: 'user:user-1' },
  })),
}));

vi.mock('../lib/cache', () => ({
  cacheService: { get: mocks.cacheGet, set: mocks.cacheSet },
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
  modelCostWeights: vi.fn(() => ({ input: 1, output: 1 })),
  DEFAULT_MODEL_COST_WEIGHTS: { input: 1, output: 1 },
  WEB_SEARCH_CALL_TOKEN_EQUIVALENT: 1_000,
}));

const get = () => new Request('http://localhost/api/ai/models');

describe('/api/ai/models', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'gw-key');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_MODEL', '');
    mocks.cacheGet.mockReset().mockResolvedValue(null);
    mocks.cacheSet.mockReset().mockResolvedValue(undefined);
    fetchMock = vi.fn(async () => Response.json({
      object: 'list',
      data: [{ id: 'zai/glm-5.3' }, { id: 'anthropic/claude-sonnet-5.5' }, { id: 'someone/unlisted' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('offers only registry models the gateway lists, and caches the listing for an hour', async () => {
    const { GET } = await import('../app/api/ai/models/route');
    const payload = await (await GET(get())).json();

    expect(payload.models.map((model: { id: string }) => model.id)).toEqual(['anthropic/claude-sonnet-5.5', 'zai/glm-5.3']);
    expect(payload.defaultModelId).toBe('anthropic/claude-sonnet-5.5');
    expect(payload.gateway).toMatchObject({ configured: true, listing: 'live' });
    expect(fetchMock).toHaveBeenCalledWith('https://ai-gateway.vercel.sh/v1/models', expect.anything());
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      'ai-gateway:listed-models:v1',
      expect.objectContaining({ ids: ['zai/glm-5.3', 'anthropic/claude-sonnet-5.5', 'someone/unlisted'] }),
      { ex: 3600 }
    );
  });

  it('uses the cached listing without calling the gateway', async () => {
    mocks.cacheGet.mockResolvedValue({ ids: ['openai/gpt-6.1-sol'], checkedAt: '2026-10-04T00:00:00.000Z' });
    const { GET } = await import('../app/api/ai/models/route');
    const payload = await (await GET(get())).json();
    expect(payload.models.map((model: { id: string }) => model.id)).toEqual(['openai/gpt-6.1-sol']);
    // The configured default is not listed, so the first available model is the default.
    expect(payload.defaultModelId).toBe('openai/gpt-6.1-sol');
    expect(payload.gateway).toEqual({ configured: true, listing: 'cached', checkedAt: '2026-10-04T00:00:00.000Z' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('also keeps a longer-lived copy of a listing it reads, for when the gateway is down', async () => {
    const { GET } = await import('../app/api/ai/models/route');
    await GET(get());
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      'ai-gateway:listed-models:last-good:v1',
      expect.objectContaining({ ids: ['zai/glm-5.3', 'anthropic/claude-sonnet-5.5', 'someone/unlisted'] }),
      { ex: 7 * 24 * 3600 }
    );
  });

  it('offers the full registry, marked unavailable, when the listing cannot be read and none was read before', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 502 }));
    const { GET } = await import('../app/api/ai/models/route');
    const { AI_MODELS } = await import('../lib/ai-models');
    const payload = await (await GET(get())).json();
    expect(payload.models.map((model: { id: string }) => model.id)).toEqual(AI_MODELS.map(model => model.id));
    expect(payload.defaultModelId).toBe('anthropic/claude-sonnet-5.5');
    expect(payload.gateway).toEqual({ configured: true, listing: 'unavailable', checkedAt: null });
    // The failure is remembered for five minutes; no listing is cached.
    expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
    expect(mocks.cacheSet).toHaveBeenCalledWith('ai-gateway:listed-models:failed:v1', expect.anything(), { ex: 300 });
  });

  it('serves the last listing that was read when the gateway fails, still marked unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 502 }));
    mocks.cacheGet.mockImplementation(async (key: string) => (key === 'ai-gateway:listed-models:last-good:v1'
      ? { ids: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5'], checkedAt: '2026-10-03T00:00:00.000Z' }
      : null));
    const { GET } = await import('../app/api/ai/models/route');
    const payload = await (await GET(get())).json();
    expect(payload.models.map((model: { id: string }) => model.id)).toEqual(['anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-sol']);
    expect(payload.gateway).toEqual({ configured: true, listing: 'unavailable', checkedAt: null });
  });

  it('does not call the gateway again within five minutes of a failed listing', async () => {
    mocks.cacheGet.mockImplementation(async (key: string) => (key === 'ai-gateway:listed-models:failed:v1'
      ? { failedAt: '2026-10-04T00:00:00.000Z' }
      : null));
    const { GET } = await import('../app/api/ai/models/route');
    const { AI_MODELS } = await import('../lib/ai-models');
    const payload = await (await GET(get())).json();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.models).toHaveLength(AI_MODELS.length);
    expect(payload.gateway.listing).toBe('unavailable');
  });

  it('without the gateway offers the default model only when Anthropic is configured', async () => {
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'direct-key');
    let { GET } = await import('../app/api/ai/models/route');
    let payload = await (await GET(get())).json();
    expect(payload.models.map((model: { id: string }) => model.id)).toEqual(['anthropic/claude-sonnet-5.5']);
    expect(payload.gateway).toEqual({ configured: false, listing: 'not-configured', checkedAt: null });

    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.resetModules();
    ({ GET } = await import('../app/api/ai/models/route'));
    payload = await (await GET(get())).json();
    expect(payload).toMatchObject({ models: [], defaultModelId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
