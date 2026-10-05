import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The four AI routes through the gateway client: model, effort and web search
 * reach the provider as chosen, every response reports how it was produced,
 * and the KV cache never serves one model's (or effort's) answer for another.
 */

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  streamMessage: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: class MockAnthropic {
    messages = { create: mocks.createMessage, stream: mocks.streamMessage };
  },
  APIConnectionTimeoutError: class MockTimeout extends Error {},
  APIUserAbortError: class MockAbort extends Error {},
  APIError: class MockApiError extends Error {},
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
  checkAiRateLimit: vi.fn(async () => ({ allowed: true })),
  acquireAiConcurrency: vi.fn(async () => ({ allowed: true, lease: 'lease-1' })),
  estimateModelTokenReservation: vi.fn(() => 10_000),
  modelCostWeights: vi.fn(() => ({ input: 1, output: 1 })),
  DEFAULT_MODEL_COST_WEIGHTS: { input: 1, output: 1 },
  WEB_SEARCH_CALL_TOKEN_EQUIVALENT: 1_000,
  reserveAiTokenBudget: vi.fn(async () => ({ allowed: true })),
  releaseAiConcurrency: vi.fn(async () => undefined),
  settleAiTokenReservation: vi.fn(async () => 0),
  opaqueIdentityKey: vi.fn((value: string) => `key:${value}`),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
}));

const ANTHROPIC_ANSWER = {
  content: [{ type: 'text', text: 'Answer.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 120, output_tokens: 30, output_tokens_details: { thinking_tokens: 10 } },
};

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) });
}

function anthropicCall(index = 0): Record<string, unknown> {
  return mocks.createMessage.mock.calls[index][0] as Record<string, unknown>;
}

const compareBody = {
  tickers: ['AAPL', 'MSFT'],
  section: 'Risk Factors',
  filingContexts: [
    { ticker: 'AAPL', companyName: 'Apple Inc.', text: 'Evidence A' },
    { ticker: 'MSFT', companyName: 'Microsoft', text: 'Evidence B' },
  ],
};

describe('AI routes through the gateway', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'gw-key');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_MODEL', '');
    mocks.createMessage.mockReset().mockResolvedValue(ANTHROPIC_ANSWER);
    mocks.streamMessage.mockReset();
    mocks.cacheGet.mockReset().mockResolvedValue(null);
    mocks.cacheSet.mockReset().mockResolvedValue(undefined);
    fetchMock = vi.fn(async () => Response.json({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Thought briefly.' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'GLM answer.', annotations: [] }] },
      ],
      usage: { input_tokens: 50, output_tokens: 20, output_tokens_details: { reasoning_tokens: 12 } },
      provider_metadata: { gateway: { routing: { finalProvider: 'baseten' } } },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('/api/claude runs the default model at its default effort and reports how it answered', async () => {
    const { POST } = await import('../app/api/claude/route');
    const response = await POST(post('/api/claude', { prompt: 'Summarize this filing.', maxTokens: 1000 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: 'Answer.',
      cached: false,
      model: 'anthropic/claude-sonnet-5.5',
      provider: 'anthropic',
      reasoningEffort: 'medium',
      usage: { input: 120, output: 30, reasoning: 10, cacheRead: 0, cacheWrite: 0 },
      webSources: [],
      webSearch: { requested: false, mode: 'off' },
    });
    const call = anthropicCall();
    expect(call.model).toBe('anthropic/claude-sonnet-5.5');
    expect(call.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(call.output_config).toEqual({ effort: 'medium' });
    expect(call.max_tokens).toBe(1000 + 4096);
    // Web search is off unless asked for.
    expect(call.tools).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keys the cache by model and effort, so one never answers for another', async () => {
    const { POST } = await import('../app/api/claude/route');
    const question = { prompt: 'Same question.', maxTokens: 1000 };
    await POST(post('/api/claude', question));
    await POST(post('/api/claude', { ...question, model: 'anthropic/claude-opus-5.5' }));
    await POST(post('/api/claude', { ...question, reasoningEffort: 'high' }));
    await POST(post('/api/claude', { ...question, webSearch: true }));
    await POST(post('/api/claude', question));

    const keys = mocks.cacheSet.mock.calls.map(call => call[0] as string);
    expect(keys).toHaveLength(5);
    expect(new Set(keys.slice(0, 4)).size).toBe(4);
    expect(keys[4]).toBe(keys[0]);
    expect(keys.every(key => key.startsWith('ai-cache:v2:'))).toBe(true);
  });

  it('serves a cached answer with the metadata it was generated with', async () => {
    mocks.cacheGet.mockResolvedValue({
      text: 'Cached.', model: 'zai/glm-5.3', provider: 'zai', reasoningEffort: 'high',
      usage: { input: 5, output: 5 }, webSources: [], webSearch: { requested: false, mode: 'off' },
    });
    const { POST } = await import('../app/api/claude/route');
    const payload = await (await POST(post('/api/claude', { prompt: 'q', model: 'zai/glm-5.3' }))).json();
    expect(payload).toMatchObject({ text: 'Cached.', cached: true, model: 'zai/glm-5.3', provider: 'zai' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown model before any model call', async () => {
    const { POST } = await import('../app/api/claude/route');
    const response = await POST(post('/api/claude', { prompt: 'q', model: 'openai/gpt-4' }));
    expect(response.status).toBe(400);
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs non-Anthropic models through the Responses API with their mapped effort', async () => {
    const { POST } = await import('../app/api/claude/route');
    const payload = await (await POST(post('/api/claude', { prompt: 'q', model: 'zai/glm-5.3', reasoningEffort: 'low' }))).json();
    expect(payload).toMatchObject({
      text: 'GLM answer.',
      model: 'zai/glm-5.3',
      provider: 'zai',
      servedBy: 'baseten',
      reasoningEffort: 'low',
      reasoningSummary: 'Thought briefly.',
      usage: { input: 50, output: 20, reasoning: 12 },
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ model: 'zai/glm-5.3', reasoning: { effort: 'low', summary: 'auto' } });
    expect(body.tools).toBeUndefined();
  });

  it('keeps the grounded Accounting Hub path off the web unless the request turns search on', async () => {
    const { POST } = await import('../app/api/claude/route');
    const grounded = { prompt: 'How does a lessee classify leases under IFRS 16?', grounding: { source: 'framework-kb', topic: '842' } };

    await POST(post('/api/claude', grounded));
    expect(anthropicCall(0).tools).toBeUndefined();

    mocks.createMessage.mockResolvedValueOnce({
      ...ANTHROPIC_ANSWER,
      content: [
        { type: 'web_search_tool_result', tool_use_id: 't', content: [{ type: 'web_search_result', url: 'https://www.ifrs.org/ifrs-16', title: 'IFRS 16' }] },
        { type: 'text', text: 'Single lessee model [1].' },
      ],
      usage: { ...ANTHROPIC_ANSWER.usage, server_tool_use: { web_search_requests: 1 } },
    });
    const payload = await (await POST(post('/api/claude', { ...grounded, webSearch: true }))).json();
    expect(anthropicCall(1).tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
    expect(payload.grounding.coverage).toBe('grounded');
    expect(payload.webSearch).toMatchObject({ requested: true, mode: 'native', retriever: 'anthropic/claude-sonnet-5.5' });
    expect(payload.webSources).toEqual([expect.objectContaining({ id: 'W1', url: 'https://www.ifrs.org/ifrs-16', origin: 'native-search' })]);
  });

  it('maps a refusal to 422 and a provider rate limit to 503', async () => {
    const { POST } = await import('../app/api/claude/route');
    mocks.createMessage.mockResolvedValueOnce({ content: [], stop_reason: 'refusal', usage: { input_tokens: 5, output_tokens: 1 } });
    expect((await POST(post('/api/claude', { prompt: 'q' }))).status).toBe(422);

    mocks.createMessage.mockRejectedValueOnce(Object.assign(new Error('rate'), { status: 429, headers: { 'retry-after': '9' }, error: { error: { type: 'rate_limit_error' } } }));
    const limited = await POST(post('/api/claude', { prompt: 'q2' }));
    expect(limited.status).toBe(503);
    expect(limited.headers.get('Retry-After')).toBe('9');
  });

  it('answers 503 for a model this deployment cannot reach without the gateway', async () => {
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'direct-key');
    const { POST } = await import('../app/api/claude/route');
    const response = await POST(post('/api/claude', { prompt: 'q', model: 'anthropic/claude-opus-5.5' }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('needs the AI Gateway');
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('/api/compare reports metadata and keys its cache by model', async () => {
    const { POST } = await import('../app/api/compare/route');
    const first = await (await POST(post('/api/compare', compareBody))).json();
    expect(first).toMatchObject({ analysis: 'Answer.', cached: false, model: 'anthropic/claude-sonnet-5.5', provider: 'anthropic', reasoningEffort: 'medium', webSources: [] });
    // The comparison keeps its 16,384-token allowance at the default effort.
    expect(anthropicCall(0).max_tokens).toBe(16_384);

    await POST(post('/api/compare', { ...compareBody, model: 'zai/glm-5.3' }));
    const keys = mocks.cacheSet.mock.calls.map(call => call[0] as string);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every(key => key.startsWith('ai-compare:v2:'))).toBe(true);
  });

  it('/api/stream ends the SSE stream with a metadata event before [DONE]', async () => {
    mocks.streamMessage.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_start', message: { usage: { input_tokens: 0, output_tokens: 0 } } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } };
        yield { type: 'message_delta', usage: { input_tokens: 40, output_tokens: 2 } };
      },
      finalMessage: async () => ({ content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn', usage: { input_tokens: 40, output_tokens: 2 } }),
      abort: vi.fn(),
    }));
    const { POST } = await import('../app/api/stream/route');
    const response = await POST(post('/api/stream', { prompt: 'q', reasoningEffort: 'none' }));
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const events = (await response.text()).split('\n\n').filter(Boolean).map(line => line.replace(/^data: /, ''));

    expect(events.slice(0, 2).map(event => JSON.parse(event))).toEqual([{ text: 'Hel' }, { text: 'lo' }]);
    expect(JSON.parse(events[2])).toEqual({
      done: true,
      model: 'anthropic/claude-sonnet-5.5',
      provider: 'anthropic',
      reasoningEffort: 'none',
      usage: { input: 40, output: 2, cacheRead: 0, cacheWrite: 0 },
      webSources: [],
      webSearch: { requested: false, mode: 'off' },
    });
    expect(events[3]).toBe('[DONE]');
    const streamParams = mocks.streamMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(streamParams.thinking).toEqual({ type: 'disabled' });
    expect(mocks.cacheSet).toHaveBeenCalledWith(expect.stringMatching(/^ai-cache:v2:/), expect.objectContaining({ text: 'Hello', reasoningEffort: 'none' }), { ex: 3600 });
  });
});
