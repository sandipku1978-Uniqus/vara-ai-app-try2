import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The citation contract only protects the accountant if it is in the prompt
 * the model actually receives. These tests drive the real route and the real
 * request validator against a mocked Anthropic client and assert on the
 * system prompt, the user turn, the grounding report, and the cache identity.
 */

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: class MockAnthropic {
    messages = { create: mocks.createMessage, stream: vi.fn() };
  },
  APIConnectionTimeoutError: class MockTimeout extends Error {},
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
  reserveAiTokenBudget: vi.fn(async () => ({ allowed: true })),
  releaseAiConcurrency: vi.fn(async () => undefined),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
}));

interface ModelCall {
  system: Array<{ text: string; cache_control?: unknown }>;
  messages: Array<{ role: string; content: string }>;
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) });
}

function modelCall(index = 0): ModelCall {
  return mocks.createMessage.mock.calls[index][0] as ModelCall;
}

describe('/api/claude grounded ASC guidance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    mocks.createMessage.mockReset().mockResolvedValue({
      content: [{ type: 'text', text: 'Single lessee model [1].' }],
    });
    mocks.cacheGet.mockReset().mockResolvedValue(null);
    mocks.cacheSet.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('puts the selected excerpts and the citation contract in the system prompt the model receives', async () => {
    const { POST } = await import('../app/api/claude/route');
    const question = 'How does a lessee classify leases under IFRS 16 compared with ASC 842?';

    const response = await POST(post('/api/claude', { prompt: question, grounding: { source: 'framework-kb', topic: '842' } }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.text).toBe('Single lessee model [1].');
    expect(payload.grounding.source).toBe('framework-kb');
    expect(payload.grounding.coverage).toBe('grounded');
    expect(payload.grounding.excerpts.map((excerpt: { n: number; id: string }) => [excerpt.n, excerpt.id]))
      .toEqual([[1, 'IFRS 16'], [2, 'Ind AS 116']]);

    const call = modelCall();
    expect(call.system).toHaveLength(1);
    expect(call.system[0].text).toContain('## Citation contract (mandatory)');
    expect(call.system[0].text).toContain('[1] IFRS 16 — Leases (equivalent reference: ASC 842;');
    expect(call.system[0].text).toContain('[2] Ind AS 116 — Leases');
    // Only the relevant entries travel, never the whole knowledge base.
    expect(call.system[0].text).not.toContain('IFRS 15');
    expect(call.system[0].text).not.toContain('IFRS 9');
    expect(call.system[0].cache_control).toBeUndefined();
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe('user');
    expect(call.messages[0].content).toContain('cite [n] after each claim');
    expect(call.messages[0].content.endsWith(question)).toBe(true);
  });

  it('falls back to the labeled model-recall prompt when the knowledge base has no relevant excerpt', async () => {
    const { POST } = await import('../app/api/claude/route');
    const { SEC_RESEARCH_SYSTEM_PROMPT } = await import('../lib/systemPrompts');
    const question = 'How do I account for a modification of a stock option under ASC 718?';

    const response = await POST(post('/api/claude', { prompt: question, grounding: { source: 'framework-kb' } }));

    const payload = await response.json();
    expect(payload.grounding).toEqual({ source: 'framework-kb', coverage: 'none', excerpts: [] });
    const call = modelCall();
    expect(call.system[0].text).toBe(SEC_RESEARCH_SYSTEM_PROMPT);
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.messages[0].content).toContain('your reply is model recall');
    expect(call.messages[0].content).toContain(`USER QUERY: ${question}`);
  });

  it('leaves requests without grounding exactly as before', async () => {
    const { POST } = await import('../app/api/claude/route');
    const { SEC_RESEARCH_SYSTEM_PROMPT } = await import('../lib/systemPrompts');

    const response = await POST(post('/api/claude', { prompt: 'Summarize this filing.' }));

    const payload = await response.json();
    expect(payload).toEqual({ text: 'Single lessee model [1].', cached: false });
    const call = modelCall();
    expect(call.system[0].text).toBe(SEC_RESEARCH_SYSTEM_PROMPT);
    expect(call.messages).toEqual([{ role: 'user', content: 'Summarize this filing.' }]);
  });

  it('keeps grounded and ungrounded answers to the same question in separate cache entries', async () => {
    const { POST } = await import('../app/api/claude/route');
    const question = 'How does a lessee classify leases under IFRS 16?';

    await POST(post('/api/claude', { prompt: question }));
    await POST(post('/api/claude', { prompt: question, grounding: { source: 'framework-kb' } }));

    const keys = mocks.cacheSet.mock.calls.map(call => call[0]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('returns the grounding report alongside a cached answer', async () => {
    mocks.cacheGet.mockResolvedValue('Cached lessee model [1].');
    const { POST } = await import('../app/api/claude/route');

    const response = await POST(post('/api/claude', {
      prompt: 'How does a lessee classify leases under IFRS 16?',
      grounding: { source: 'framework-kb' },
    }));

    const payload = await response.json();
    expect(payload.cached).toBe(true);
    expect(payload.text).toBe('Cached lessee model [1].');
    expect(payload.grounding.coverage).toBe('grounded');
    expect(payload.grounding.excerpts[0].id).toBe('IFRS 16');
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('does not answer grounded requests from the streaming route', async () => {
    const { POST } = await import('../app/api/stream/route');

    const response = await POST(post('/api/stream', { prompt: 'leases', grounding: { source: 'framework-kb' } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Grounded requests must use /api/claude.' });
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });
});
