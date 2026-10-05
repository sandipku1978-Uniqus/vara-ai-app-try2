import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  validateChatRequest,
  validateCompareRequest,
  validateModelSelection,
  validateOptionalModelSelection,
} from '../lib/ai-input';
import { lowestEffort } from '../lib/ai-gateway';
import { billableTokens } from '../lib/ai-usage';
import {
  DEFAULT_MODEL_COST_WEIGHTS,
  estimateModelTokenReservation,
  modelCostWeights,
  WEB_SEARCH_CALL_TOKEN_EQUIVALENT,
} from '../lib/rate-limit';
import { DEFAULT_AI_MODEL_ID, findAiModel } from '../lib/ai-models';

const post = (body: unknown) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });
const compareBody = {
  tickers: ['AAPL', 'MSFT'],
  section: 'Risk Factors',
  filingContexts: [
    { ticker: 'AAPL', companyName: 'Apple Inc.', text: 'A' },
    { ticker: 'MSFT', companyName: 'Microsoft', text: 'B' },
  ],
};

describe('model selection validation', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_MODEL', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to the registry default, its default effort, and no web search', async () => {
    const result = await validateChatRequest(post({ prompt: 'q' }));
    const sonnet = findAiModel(DEFAULT_AI_MODEL_ID)!;
    expect(result.value).toMatchObject({ model: DEFAULT_AI_MODEL_ID, reasoningEffort: sonnet.defaultEffort, webSearch: false });
  });

  it('honours ANTHROPIC_MODEL as the default when it names a registry model', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'openai/gpt-6.1-sol');
    const result = await validateChatRequest(post({ prompt: 'q' }));
    expect(result.value).toMatchObject({ model: 'openai/gpt-6.1-sol', reasoningEffort: 'medium' });
  });

  it("uses the chosen model's own default effort", async () => {
    const result = await validateChatRequest(post({ prompt: 'q', model: 'google/gemini-3.8-flash' }));
    expect(result.value).toMatchObject({ model: 'google/gemini-3.8-flash', reasoningEffort: 'high', webSearch: false });
  });

  it('accepts an explicit model, effort and web search', async () => {
    const result = await validateChatRequest(post({ prompt: 'q', model: 'zai/glm-5.3', reasoningEffort: 'max', webSearch: true }));
    expect(result.value).toMatchObject({ model: 'zai/glm-5.3', reasoningEffort: 'max', webSearch: true });
  });

  it('rejects an unknown model with 400 instead of substituting one', async () => {
    for (const model of ['openai/gpt-4', 'perplexity/sonar', 42]) {
      const result = await validateChatRequest(post({ prompt: 'q', model }));
      expect(result.response?.status, String(model)).toBe(400);
    }
    const body = await (await validateChatRequest(post({ prompt: 'q', model: 'openai/gpt-4' }))).response!.json();
    expect(body.error).toBe('Unknown model "openai/gpt-4".');
  });

  it('rejects an effort that is not a level, or that the model does not offer', async () => {
    const notALevel = await validateChatRequest(post({ prompt: 'q', reasoningEffort: 'xhigh' }));
    expect(notALevel.response?.status).toBe(400);
    expect((await notALevel.response!.json()).error).toBe('Reasoning effort must be one of none, low, medium, high, max.');

    // Opus 5.5 cannot turn thinking off; Gemini 3.8 Flash has no medium.
    for (const body of [
      { model: 'anthropic/claude-opus-5.5', reasoningEffort: 'none' },
      { model: 'google/gemini-3.8-flash', reasoningEffort: 'medium' },
      { model: 'spacexai/grok-4.5', reasoningEffort: 'max' },
    ]) {
      const result = await validateChatRequest(post({ prompt: 'q', ...body }));
      expect(result.response?.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('rejects a non-boolean webSearch', async () => {
    const result = await validateChatRequest(post({ prompt: 'q', webSearch: 'yes' }));
    expect(result.response?.status).toBe(400);
  });

  it('validates the same fields on compare requests', async () => {
    const plain = await validateCompareRequest(post(compareBody));
    expect(plain.value).toMatchObject({ model: DEFAULT_AI_MODEL_ID, webSearch: false });
    const chosen = await validateCompareRequest(post({ ...compareBody, model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'low' }));
    expect(chosen.value).toMatchObject({ model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'low' });
    const unknown = await validateCompareRequest(post({ ...compareBody, model: 'nope/nope' }));
    expect(unknown.response?.status).toBe(400);
  });

  it('reads an optional selection body for summaries, defaulting to reasoning off', async () => {
    const empty = await validateOptionalModelSelection(new Request('http://localhost', { method: 'POST' }), lowestEffort);
    expect(empty.value).toEqual({ model: DEFAULT_AI_MODEL_ID, reasoningEffort: 'none', webSearch: false });

    const opus = await validateOptionalModelSelection(post({ model: 'anthropic/claude-opus-5.5' }), lowestEffort);
    expect(opus.value).toEqual({ model: 'anthropic/claude-opus-5.5', reasoningEffort: 'low', webSearch: false });

    const web = await validateOptionalModelSelection(post({ webSearch: true }), lowestEffort);
    expect(web.response?.status).toBe(400);
    const notObject = await validateOptionalModelSelection(post(['x']), lowestEffort);
    expect(notObject.response?.status).toBe(400);
  });

  it('exposes the selection validator for other request shapes', () => {
    expect(validateModelSelection({ model: 'openai/gpt-5.6-luna', reasoningEffort: 'none' }).value)
      .toEqual({ model: 'openai/gpt-5.6-luna', reasoningEffort: 'none', webSearch: false });
  });
});

describe('budget weighting by model price', () => {
  it('weights tokens against the default model and floors near-free models', () => {
    expect(modelCostWeights(findAiModel(DEFAULT_AI_MODEL_ID)!.pricing)).toEqual({ input: 1, output: 1 });
    expect(modelCostWeights(findAiModel('anthropic/claude-opus-5.5')!.pricing)).toEqual({ input: 2, output: 2 });
    const glmFlash = modelCostWeights(findAiModel('zai/glm-5.3-flash')!.pricing);
    expect(glmFlash.input).toBeCloseTo(0.075);
    expect(glmFlash.output).toBeCloseTo(0.05);
    expect(modelCostWeights({ input: 0, output: 1e-12 })).toEqual({ input: 1, output: 0.01 });
    expect(modelCostWeights(null)).toBe(DEFAULT_MODEL_COST_WEIGHTS);
  });

  it('reserves with the same weights settlement charges, plus searches', () => {
    // Unweighted calls keep their old reservation exactly.
    expect(estimateModelTokenReservation(3_000, 1_000)).toBe(1_000 + 1_000 + 512);
    const opus = modelCostWeights(findAiModel('anthropic/claude-opus-5.5')!.pricing);
    expect(estimateModelTokenReservation(3_000, 1_000, 1, { weights: opus, webSearchCalls: 3 }))
      .toBe(2_000 + 2_000 + 512 + 3 * WEB_SEARCH_CALL_TOKEN_EQUIVALENT);

    const usage = { inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchCalls: 2 };
    expect(billableTokens(usage)).toBe(2_000 + 2 * WEB_SEARCH_CALL_TOKEN_EQUIVALENT);
    expect(billableTokens(usage, opus)).toBe(4_000 + 2 * WEB_SEARCH_CALL_TOKEN_EQUIVALENT);
  });
});
