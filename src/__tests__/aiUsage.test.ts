import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import {
  addUsage,
  billableTokens,
  classifyAnthropicFailure,
  recordAiUsage,
  StreamUsageAccumulator,
  usageFromApi,
  usageFromMessage,
} from '../lib/ai-usage';
import { reserveAiTokenBudget } from '../lib/rate-limit';

/**
 * Audit 2026-09: "AI spend is estimated, never measured. Token usage from
 * every model call is discarded; reservations are never reconciled." These
 * pin the arithmetic a finance owner will read off the ai-usage lines and
 * the settlement rule that turns an estimate into the measured spend.
 */

describe('usage extraction', () => {
  it('reads a message usage block, treating null cache counts as zero', () => {
    expect(usageFromMessage({
      usage: { input_tokens: 1_200, output_tokens: 340, cache_creation_input_tokens: null, cache_read_input_tokens: 800 },
    })).toEqual({ inputTokens: 1_200, outputTokens: 340, cacheWriteTokens: 0, cacheReadTokens: 800 });
  });

  it('reports null when the API sent no usage at all', () => {
    expect(usageFromMessage({})).toBeNull();
    expect(usageFromMessage(null)).toBeNull();
    expect(usageFromApi(undefined)).toBeNull();
  });

  it('ignores malformed counts instead of inventing spend', () => {
    expect(usageFromApi({ input_tokens: -5, output_tokens: Number.NaN, cache_read_input_tokens: 12.7 }))
      .toEqual({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 12 });
  });

  it('sums usage across calls and tolerates missing sides', () => {
    const first = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 1, cacheWriteTokens: 2 };
    const second = { inputTokens: 20, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 0 };
    expect(addUsage(first, second)).toEqual({ inputTokens: 30, outputTokens: 12, cacheReadTokens: 4, cacheWriteTokens: 2 });
    expect(addUsage(null, second)).toBe(second);
    expect(addUsage(first, null)).toBe(first);
  });

  it('weights cache writes at 1.25x and cache reads at 0.1x of the input rate', () => {
    expect(billableTokens({ inputTokens: 1_000, outputTokens: 200, cacheWriteTokens: 100, cacheReadTokens: 1_000 }))
      .toBe(1_000 + 200 + 125 + 100);
    // Fractions round up per component so a single cached token is never free.
    expect(billableTokens({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1, cacheReadTokens: 1 })).toBe(3);
  });
});

describe('StreamUsageAccumulator', () => {
  it('takes input counts from message_start and the final output count from message_delta', () => {
    const accumulator = new StreamUsageAccumulator();
    expect(accumulator.current()).toBeNull();

    accumulator.observe({ type: 'message_start', message: { usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 300 } } });
    accumulator.observe({ type: 'content_block_delta' });
    accumulator.observe({ type: 'message_delta', usage: { output_tokens: 250 } });

    expect(accumulator.current()).toEqual({ inputTokens: 900, outputTokens: 250, cacheReadTokens: 300, cacheWriteTokens: 0 });
  });

  it('accepts a delta that repeats the input counts without losing the start values', () => {
    const accumulator = new StreamUsageAccumulator();
    accumulator.observe({ type: 'message_start', message: { usage: { input_tokens: 900, output_tokens: 1 } } });
    accumulator.observe({ type: 'message_delta', usage: { input_tokens: 900, output_tokens: 80, cache_creation_input_tokens: 50 } });
    expect(accumulator.current()).toEqual({ inputTokens: 900, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 50 });
  });

  it('stays null when the stream ended before any usage arrived', () => {
    const accumulator = new StreamUsageAccumulator();
    accumulator.observe({ type: 'message_delta' });
    expect(accumulator.current()).toBeNull();
  });
});

describe('classifyAnthropicFailure', () => {
  it('treats answers rejected before generation as not billed', () => {
    for (const status of [400, 401, 403, 404, 413, 422, 429, 529]) {
      expect(classifyAnthropicFailure(new APIError(status, undefined, `status ${status}`, undefined)), String(status)).toBe('not-billed');
    }
  });

  it('treats timeouts, aborts, server errors and unknown throwables as unknown cost', () => {
    expect(classifyAnthropicFailure(new APIConnectionTimeoutError({ message: 'timed out' }))).toBe('unknown');
    expect(classifyAnthropicFailure(new APIUserAbortError({ message: 'aborted' }))).toBe('unknown');
    expect(classifyAnthropicFailure(new APIError(500, undefined, 'server error', undefined))).toBe('unknown');
    expect(classifyAnthropicFailure(new Error('network'))).toBe('unknown');
    expect(classifyAnthropicFailure('string')).toBe('unknown');
  });
});

describe('recordAiUsage', () => {
  let info: MockInstance;

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('AI_DAILY_TOKEN_BUDGET_PER_USER', '200000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function line(call = 0): Record<string, unknown> {
    return JSON.parse(String(info.mock.calls[call][0])) as Record<string, unknown>;
  }

  it('settles a completed call down to the measured tokens and writes one usage line', async () => {
    const identity = { userId: `usage-${Date.now()}-a`, orgId: null };
    const budget = await reserveAiTokenBudget(identity, 150_000);
    expect(budget.reservation).toMatchObject({ userId: identity.userId, tokens: 150_000, settled: false });

    await recordAiUsage({
      route: 'compare',
      model: 'claude-sonnet-5',
      userId: identity.userId,
      reservation: budget.reservation,
      usage: { inputTokens: 40_000, outputTokens: 6_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outcome: 'completed',
      startedAt: Date.now() - 1_500,
    });

    expect(budget.reservation?.settled).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    expect(line()).toMatchObject({
      kind: 'ai-usage',
      route: 'compare',
      model: 'claude-sonnet-5',
      outcome: 'completed',
      calls: 1,
      reservedTokens: 150_000,
      billableTokens: 46_000,
      inputTokens: 40_000,
      outputTokens: 6_000,
      adjustmentTokens: -104_000,
      correlationId: null,
    });
    expect(String(line().userKey)).not.toContain(identity.userId);
    expect(typeof line().elapsedMs).toBe('number');

    // The refund is real: 46k spent of 200k leaves room for another 150k.
    expect((await reserveAiTokenBudget(identity, 150_000)).allowed).toBe(true);
  });

  it('refunds the whole reservation for a call the API rejected before generation', async () => {
    const identity = { userId: `usage-${Date.now()}-b`, orgId: null };
    const budget = await reserveAiTokenBudget(identity, 150_000);

    await recordAiUsage({
      route: 'claude', model: 'm', userId: identity.userId, reservation: budget.reservation,
      usage: null, outcome: 'not-billed', startedAt: Date.now(),
    });

    expect(line()).toMatchObject({ outcome: 'not-billed', billableTokens: 0, adjustmentTokens: -150_000 });
    expect((await reserveAiTokenBudget(identity, 200_000)).allowed).toBe(true);
  });

  it('keeps the estimate when the cost is unknown and charges an overage without denying it', async () => {
    const identity = { userId: `usage-${Date.now()}-c`, orgId: null };
    const timedOut = await reserveAiTokenBudget(identity, 100_000);
    await recordAiUsage({
      route: 'claude', model: 'm', userId: identity.userId, reservation: timedOut.reservation,
      usage: null, outcome: 'unknown', startedAt: Date.now(),
    });
    expect(line(0)).toMatchObject({ outcome: 'unknown', billableTokens: null, adjustmentTokens: 0 });

    const overran = await reserveAiTokenBudget(identity, 50_000);
    await recordAiUsage({
      route: 'claude', model: 'm', userId: identity.userId, reservation: overran.reservation,
      usage: { inputTokens: 70_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outcome: 'completed', startedAt: Date.now(),
    });
    expect(line(1)).toMatchObject({ billableTokens: 80_000, adjustmentTokens: 30_000 });

    // 100k (unknown) + 80k (measured) = 180k of 200k: 30k more fits, 40k does not.
    expect((await reserveAiTokenBudget(identity, 20_000)).allowed).toBe(true);
    expect((await reserveAiTokenBudget(identity, 40_000)).allowed).toBe(false);
  });

  it('never lets a settlement failure escape into the route', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const record = {
      route: 'claude', model: 'm', userId: 'u', startedAt: Date.now(),
      // A reservation whose settlement throws: the counter store is gone.
      reservation: { userId: 'u', day: 'not-a-day', tokens: Number.NaN, settled: false },
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outcome: 'completed' as const,
    };
    Object.defineProperty(record.reservation, 'settled', {
      get() { throw new Error('store unavailable'); },
    });

    await expect(recordAiUsage(record)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('AI usage settlement failed:', expect.any(Error));
    expect(line()).toMatchObject({ kind: 'ai-usage', adjustmentTokens: 0, billableTokens: 2 });
  });

  it('settles a reservation only once and still logs when there was none', async () => {
    const identity = { userId: `usage-${Date.now()}-d`, orgId: null };
    const budget = await reserveAiTokenBudget(identity, 100_000);
    const usage = { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const record = { route: 'stream', model: 'm', userId: identity.userId, reservation: budget.reservation, usage, outcome: 'completed' as const, startedAt: Date.now() };

    await recordAiUsage(record);
    await recordAiUsage(record);
    await recordAiUsage({ ...record, reservation: undefined });

    expect(line(0).adjustmentTokens).toBe(-98_900);
    expect(line(1).adjustmentTokens).toBe(0);
    expect(line(2)).toMatchObject({ reservedTokens: 0, adjustmentTokens: 0, billableTokens: 1_100 });
  });
});
