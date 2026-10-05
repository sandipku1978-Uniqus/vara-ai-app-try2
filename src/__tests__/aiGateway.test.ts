import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import effortMatrix from './fixtures/ai-gateway/effort-matrix.json';
import {
  addAiUsage,
  aiErrorResponse,
  AiContentFilterError,
  AiModelUnavailableError,
  AiRateLimitedError,
  AiTimeoutError,
  AiUpstreamError,
  anthropicReasoningParams,
  complete,
  defaultAiModelId,
  EFFORT_WIRE_MAP,
  gatewayHttpError,
  legacyDirectAnthropicModel,
  lowestEffort,
  modelUsageFromAiUsage,
  normalizeAnthropicMessage,
  normalizeResponsesResult,
  outputTokenBudget,
  planAiCall,
  registryModelsListedBy,
  responsesReasoningParams,
  sseData,
  stream,
  wireEffortFor,
} from '../lib/ai-gateway';
import { AI_MODELS, DEFAULT_AI_MODEL_ID, findAiModel, REASONING_EFFORTS } from '../lib/ai-models';
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';

interface MatrixRow {
  model: string;
  effort: string;
  offered: boolean;
  wireEffort: string;
  accepted: boolean;
  reasoningTokens: number | null;
}

const rows = effortMatrix.rows as MatrixRow[];
const model = (id: string) => findAiModel(id)!;

function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = events.map(event => `event: x\ndata: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
  return new ReadableStream({
    start(controller) {
      // Split mid-event to prove the parser buffers across chunks.
      controller.enqueue(encoder.encode(text.slice(0, 17)));
      controller.enqueue(encoder.encode(text.slice(17)));
      controller.close();
    },
  });
}

describe('effort mapping table', () => {
  it('maps every level each registry model offers, and nothing else', () => {
    for (const entry of AI_MODELS) {
      expect(entry.effortLevels.length, entry.id).toBeGreaterThan(0);
      expect(entry.effortLevels, entry.id).toContain(entry.defaultEffort);
      for (const effort of REASONING_EFFORTS) {
        if (entry.effortLevels.includes(effort)) {
          expect(EFFORT_WIRE_MAP[entry.provider][effort], `${entry.id} ${effort}`).toBeDefined();
          expect(() => wireEffortFor(entry, effort)).not.toThrow();
        } else {
          expect(() => wireEffortFor(entry, effort), `${entry.id} ${effort}`).toThrow(RangeError);
        }
      }
    }
  });

  it('matches the live matrix: every offered pairing was sent with this wire value and accepted', () => {
    for (const entry of AI_MODELS) {
      for (const effort of entry.effortLevels) {
        const row = rows.find(candidate => candidate.model === entry.id && candidate.effort === effort && candidate.offered);
        expect(row, `${entry.id} ${effort} has live evidence`).toBeDefined();
        expect(row!.wireEffort).toBe(wireEffortFor(entry, effort));
        expect(row!.accepted).toBe(true);
      }
    }
  });

  it('offers an off switch only where the live call returned zero reasoning tokens', () => {
    for (const entry of AI_MODELS) {
      const none = rows.find(row => row.model === entry.id && row.effort === 'none');
      expect(none, `${entry.id} none was probed`).toBeDefined();
      if (entry.effortLevels.includes('none')) expect(none!.reasoningTokens, entry.id).toBe(0);
      else expect(none!.reasoningTokens ?? 0, `${entry.id} reasons even at none`).toBeGreaterThan(0);
    }
  });

  it('sends Anthropic effort natively (max stays max) and turns thinking off for none', () => {
    expect(anthropicReasoningParams('none')).toEqual({ thinking: { type: 'disabled' } });
    expect(anthropicReasoningParams('max')).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'max' },
    });
    // The pre-gateway direct path keeps its plain adaptive thinking.
    expect(anthropicReasoningParams('high', { legacyDirect: true })).toEqual({ thinking: { type: 'adaptive' } });
  });

  it('sends Responses effort with a summary request unless reasoning is off', () => {
    expect(responsesReasoningParams('none')).toEqual({ effort: 'none' });
    expect(responsesReasoningParams('xhigh')).toEqual({ effort: 'xhigh', summary: 'auto' });
    expect(wireEffortFor(model('spacexai/grok-4.7'), 'max')).toBe('xhigh');
  });

  it('adds reasoning headroom to the answer allowance, within the model ceiling', () => {
    const sonnet = model('anthropic/claude-sonnet-5.5');
    expect(outputTokenBudget(sonnet, 4096, 'none')).toBe(4096);
    expect(outputTokenBudget(sonnet, 4096, 'medium')).toBe(8192);
    expect(outputTokenBudget(model('deepseek/deepseek-v4.1-flash'), 30_000, 'max')).toBe(32_768);
    // Opus cannot switch reasoning off, so even its lowest level gets headroom.
    expect(lowestEffort(model('anthropic/claude-opus-5.5'))).toBe('low');
    expect(lowestEffort(sonnet)).toBe('none');
  });
});

describe('configuration and planning', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_MODEL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses ANTHROPIC_MODEL as the default only when it is a registry id', () => {
    expect(defaultAiModelId()).toBe(DEFAULT_AI_MODEL_ID);
    vi.stubEnv('ANTHROPIC_MODEL', 'anthropic/claude-opus-5.5');
    expect(defaultAiModelId()).toBe('anthropic/claude-opus-5.5');
    expect(legacyDirectAnthropicModel()).toBe('claude-sonnet-5');
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-sonnet-5-20260101');
    expect(defaultAiModelId()).toBe(DEFAULT_AI_MODEL_ID);
    expect(legacyDirectAnthropicModel()).toBe('claude-sonnet-5-20260101');
  });

  it('routes Anthropic models to /v1/messages and everything else to /v1/responses through the gateway', () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-key');
    expect(planAiCall('anthropic/claude-opus-5.5')).toMatchObject({ transport: 'gateway-messages', wireModel: 'anthropic/claude-opus-5.5' });
    expect(planAiCall('zai/glm-5.3')).toMatchObject({ transport: 'gateway-responses', wireModel: 'zai/glm-5.3' });
    expect(planAiCall('perplexity/sonar')).toMatchObject({ transport: 'gateway-responses' });
  });

  it('without a gateway runs only the default model, directly, on the legacy id', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'direct-key');
    expect(planAiCall(DEFAULT_AI_MODEL_ID)).toMatchObject({ transport: 'direct-anthropic', wireModel: 'claude-sonnet-5' });
    expect(() => planAiCall('openai/gpt-6.1-sol')).toThrow(AiModelUnavailableError);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(() => planAiCall(DEFAULT_AI_MODEL_ID)).toThrow('AI service is not configured.');
  });

  it('filters the registry to what the gateway lists, in registry order', () => {
    expect(registryModelsListedBy(['zai/glm-5.3', 'anthropic/claude-opus-5.5', 'someone/else'])).toEqual([
      'anthropic/claude-opus-5.5',
      'zai/glm-5.3',
    ]);
  });
});

describe('typed errors', () => {
  it('classifies gateway failures with their billing outcome', () => {
    const limited = gatewayHttpError(429, { error: { message: 'slow down', type: 'rate_limit_exceeded' } }, new Headers({ 'retry-after': '12' }));
    expect(limited).toBeInstanceOf(AiRateLimitedError);
    expect((limited as AiRateLimitedError).retryAfterSeconds).toBe(12);
    expect(limited.billingOutcome).toBe('not-billed');

    // The live refusal for perplexity/sonar under team-wide zero data retention.
    const zdr = gatewayHttpError(400, { error: { message: 'No ZDR providers', type: 'no_zdr_providers_available' } });
    expect(zdr).toBeInstanceOf(AiModelUnavailableError);
    expect(zdr.code).toBe('no_zdr_providers_available');
    expect(gatewayHttpError(404, { error: { type: 'model_not_found' } })).toBeInstanceOf(AiModelUnavailableError);
    expect(gatewayHttpError(504, null)).toBeInstanceOf(AiTimeoutError);

    const invalid = gatewayHttpError(400, { error: { type: 'invalid_request_error', message: 'bad' } });
    expect(invalid).toBeInstanceOf(AiUpstreamError);
    expect(invalid.billingOutcome).toBe('not-billed');
    expect(gatewayHttpError(500, null).billingOutcome).toBe('unknown');
  });

  it('maps typed errors to the statuses routes return', async () => {
    expect(aiErrorResponse(new AiTimeoutError())?.status).toBe(504);
    const busy = aiErrorResponse(new AiRateLimitedError(undefined, { retryAfterSeconds: 7 }));
    expect(busy?.status).toBe(503);
    expect(busy?.headers.get('Retry-After')).toBe('7');
    expect(aiErrorResponse(new AiModelUnavailableError())?.status).toBe(503);
    expect(aiErrorResponse(new AiContentFilterError())?.status).toBe(422);
    expect(aiErrorResponse(new Error('bug'))).toBeNull();
  });
});

describe('normalization', () => {
  it('normalizes an Anthropic message with thinking, web search and cached input', () => {
    const plan = planAiCallFor('anthropic/claude-sonnet-5.5');
    const message = {
      id: 'msg', type: 'message', role: 'assistant', model: 'anthropic/claude-sonnet-5.5',
      stop_reason: 'end_turn', stop_sequence: null,
      content: [
        { type: 'thinking', thinking: 'Look up the newsroom.', signature: 's' },
        { type: 'server_tool_use', id: 't1', name: 'web_search', input: { query: 'sec' } },
        { type: 'web_search_tool_result', tool_use_id: 't1', content: [
          { type: 'web_search_result', url: 'https://www.sec.gov/newsroom', title: 'SEC.gov', page_age: '4 days ago', encrypted_content: 'x' },
        ] },
        { type: 'text', text: 'The latest release is X.', citations: null },
      ],
      usage: {
        input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0,
        output_tokens_details: { thinking_tokens: 20 }, server_tool_use: { web_search_requests: 1 },
      },
      provider_metadata: { gateway: { routing: { finalProvider: 'anthropic' } } },
    } as unknown as Message;

    const completion = normalizeAnthropicMessage(message, plan);
    expect(completion).toMatchObject({
      text: 'The latest release is X.',
      reasoningSummary: 'Look up the newsroom.',
      model: 'anthropic/claude-sonnet-5.5',
      provider: 'anthropic',
      servedBy: 'anthropic',
      finishReason: 'stop',
      citations: [{ url: 'https://www.sec.gov/newsroom', title: 'SEC.gov' }],
      usage: { input: 1000, output: 50, reasoning: 20, cacheRead: 900, cacheWrite: 0, webSearchCalls: 1 },
    });
    expect(modelUsageFromAiUsage(completion.usage)).toEqual({
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 0, reasoningTokens: 20, webSearchCalls: 1,
    });
  });

  it('raises a content-filter error, with its billed usage, on a refusal', () => {
    const plan = planAiCallFor('anthropic/claude-sonnet-5.5');
    const refusal = { content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 2 } } as unknown as Message;
    try {
      normalizeAnthropicMessage(refusal, plan);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiContentFilterError);
      expect((error as AiContentFilterError).billingOutcome).toBe('completed');
      expect((error as AiContentFilterError).usage).toMatchObject({ input: 10, output: 2 });
    }
  });

  it('normalizes a Responses result: text, summary, url citations, search sources, cached usage', () => {
    const completion = normalizeResponsesResult({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Search the newsroom.' }] },
        { type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://www.sec.gov/newsroom' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'Release X.', annotations: [
          { type: 'url_citation', url: 'https://www.sec.gov/newsroom', title: 'SEC.gov | Newsroom' },
        ] }] },
      ],
      usage: { input_tokens: 8480, output_tokens: 85, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 4391 }, output_tokens_details: { reasoning_tokens: 35 } },
      provider_metadata: { openai: {}, gateway: { billableWebSearchCalls: 1, routing: { finalProvider: 'openai' } } },
    }, model('openai/gpt-5.6-luna'));
    expect(completion).toEqual({
      text: 'Release X.',
      reasoningSummary: 'Search the newsroom.',
      model: 'openai/gpt-5.6-luna',
      provider: 'openai',
      servedBy: 'openai',
      finishReason: 'stop',
      citations: [{ url: 'https://www.sec.gov/newsroom', title: 'SEC.gov | Newsroom' }],
      usage: { input: 8480, output: 85, reasoning: 35, cacheRead: 0, cacheWrite: 4391, webSearchCalls: 1 },
    });
  });

  it('reads Gemini grounding sources and reports a truncated answer as length', () => {
    const completion = normalizeResponsesResult({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Partial', annotations: [] }] }],
      usage: { input_tokens: 40, output_tokens: 47 },
      provider_metadata: { vertex: { groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.sec.gov/', title: 'sec.gov' } }] } } },
    }, model('google/gemini-3.8-flash'));
    expect(completion.finishReason).toBe('length');
    expect(completion.citations).toEqual([{ url: 'https://www.sec.gov/', title: 'sec.gov' }]);
  });

  it('turns a content-filtered Responses result into a typed error', () => {
    expect(() => normalizeResponsesResult({
      status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [], usage: { input_tokens: 5, output_tokens: 0 },
    }, model('zai/glm-5.3'))).toThrow(AiContentFilterError);
  });

  it('sums usage across sequential calls', () => {
    expect(addAiUsage({ input: 10, output: 5, reasoning: 2 }, { input: 1, output: 1, webSearchCalls: 1 })).toEqual({
      input: 11, output: 6, reasoning: 2, webSearchCalls: 1,
    });
    expect(addAiUsage(null, { input: 1, output: 1 })).toEqual({ input: 1, output: 1 });
  });
});

describe('Responses transport', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_AI_GATEWAY_KEY', 'gw-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends one request with the mapped effort, native web search and no storage', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
      usage: { input_tokens: 3, output_tokens: 1 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await complete({
      model: 'spacexai/grok-4.5',
      system: 'sys',
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q2' }],
      maxTokens: 500,
      reasoningEffort: 'high',
      webSearch: true,
    });

    expect(result.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/responses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gw-key');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'spacexai/grok-4.5',
      instructions: 'sys',
      input: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q2' }],
      max_output_tokens: 500,
      reasoning: { effort: 'high', summary: 'auto' },
      tools: [{ type: 'web_search' }],
      store: false,
    });
  });

  it('never sends a web-search tool to a model without native search', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(complete({
      model: 'zai/glm-5.3', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 10, reasoningEffort: 'high', webSearch: true,
    })).rejects.toThrow(RangeError);
  });

  it('surfaces a gateway refusal as a typed error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { error: { message: 'No ZDR providers', type: 'no_zdr_providers_available' } },
      { status: 400 }
    )));
    await expect(complete({
      model: 'perplexity/sonar', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 10, reasoningEffort: 'low',
    })).rejects.toBeInstanceOf(AiModelUnavailableError);
  });

  it('streams text deltas, then the normalized completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse([
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: 'Hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      { type: 'response.completed', response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] }],
        usage: { input_tokens: 4, output_tokens: 9, output_tokens_details: { reasoning_tokens: 7 } },
      } },
    ]), { headers: { 'Content-Type': 'text/event-stream' } })));

    const modelStream = stream({
      model: 'deepseek/deepseek-v4.1-flash', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 50, reasoningEffort: 'low',
    });
    const events = [];
    for await (const event of modelStream) events.push(event);
    expect(events.slice(0, 2)).toEqual([{ type: 'text-delta', text: 'Hel' }, { type: 'text-delta', text: 'lo' }]);
    expect(events[2]).toMatchObject({ type: 'finish', completion: { text: 'Hello', usage: { input: 4, output: 9, reasoning: 7 } } });
    expect(modelStream.partialUsage()).toEqual({ input: 4, output: 9, reasoning: 7 });
  });

  it('fails a stream that ends without a completed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse([{ type: 'response.output_text.delta', delta: 'x' }]))));
    const modelStream = stream({
      model: 'deepseek/deepseek-v4.1-flash', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 50, reasoningEffort: 'low',
    });
    await expect((async () => {
      for await (const event of modelStream) void event;
    })()).rejects.toBeInstanceOf(AiUpstreamError);
  });

  it('splits SSE events across chunk boundaries and CRLF framing', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: a\r\ndata: {"n":1}\r\n\r\nda'));
        controller.enqueue(encoder.encode('ta: {"n":2}\n\n'));
        controller.close();
      },
    });
    const payloads: string[] = [];
    for await (const data of sseData(body)) payloads.push(data);
    expect(payloads).toEqual(['{"n":1}', '{"n":2}']);
  });
});

function planAiCallFor(id: string) {
  return { model: model(id), transport: 'gateway-messages' as const, wireModel: id };
}
