/**
 * AI usage metering (audit 2026-09: "AI spend is estimated, never measured.
 * Token usage from every model call is discarded; reservations are never
 * reconciled").
 *
 * Every model call ends in exactly one `recordAiUsage()`: it settles the
 * daily-budget reservation against the tokens the API reported and writes
 * one JSON line (kind "ai-usage") a log drain can sum per day, per route and
 * per user key. Nothing here decides whether a call may run — that stays in
 * rate-limit.ts — this only makes the spend true after the fact.
 */

import { APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import {
  opaqueIdentityKey,
  settleAiTokenReservation,
  type AiTokenReservation,
} from './rate-limit';
import { currentCorrelationId } from './route-observability';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** The shape the API reports on messages, message_start and message_delta. */
export interface ApiUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function usageFromApi(usage: ApiUsageLike | null | undefined): ModelUsage | null {
  if (!usage || typeof usage !== 'object') return null;
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
    cacheReadTokens: count(usage.cache_read_input_tokens),
  };
}

export function usageFromMessage(message: { usage?: ApiUsageLike | null } | null | undefined): ModelUsage | null {
  return usageFromApi(message?.usage);
}

export function addUsage(first: ModelUsage | null, second: ModelUsage | null): ModelUsage | null {
  if (!first) return second;
  if (!second) return first;
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    cacheReadTokens: first.cacheReadTokens + second.cacheReadTokens,
    cacheWriteTokens: first.cacheWriteTokens + second.cacheWriteTokens,
  };
}

/**
 * Tokens as the budget counts them. Anthropic bills cache writes at 1.25×
 * and cache reads at 0.1× the input rate, so a budget stated in "input-rate
 * tokens" weights them the same way; output tokens are counted 1:1 (the
 * budget is a spend proxy, not a price list — the estimator that reserves
 * against it is deliberately coarser than this).
 */
export function billableTokens(usage: ModelUsage): number {
  return usage.inputTokens
    + usage.outputTokens
    + Math.ceil(usage.cacheWriteTokens * 1.25)
    + Math.ceil(usage.cacheReadTokens * 0.1);
}

/**
 * Streaming responses report input tokens on `message_start` and the final
 * output count on `message_delta`; the accumulator folds both into one usage.
 */
export class StreamUsageAccumulator {
  private usage: ModelUsage | null = null;

  observe(event: { type: string; message?: { usage?: ApiUsageLike | null } | null; usage?: ApiUsageLike | null }): void {
    if (event.type === 'message_start') {
      const started = usageFromApi(event.message?.usage);
      if (started) this.usage = started;
      return;
    }
    if (event.type === 'message_delta') {
      const delta = usageFromApi(event.usage);
      if (!delta) return;
      const previous = this.usage ?? EMPTY_USAGE;
      this.usage = {
        // Deltas carry the cumulative output count; newer API versions also
        // repeat the input counts, older ones leave them zero.
        outputTokens: delta.outputTokens || previous.outputTokens,
        inputTokens: delta.inputTokens || previous.inputTokens,
        cacheReadTokens: delta.cacheReadTokens || previous.cacheReadTokens,
        cacheWriteTokens: delta.cacheWriteTokens || previous.cacheWriteTokens,
      };
    }
  }

  current(): ModelUsage | null {
    return this.usage;
  }
}

export type AiCallOutcome = 'completed' | 'not-billed' | 'unknown';

/**
 * Answers the API rejects before generation bill nothing: malformed request,
 * auth, not found, oversized input, invalid parameters, rate limit, overload.
 */
const NOT_BILLED_STATUSES = new Set([400, 401, 403, 404, 413, 422, 429, 529]);

/**
 * What a failed call cost. A timeout or an abort means the request may have
 * reached the model and generated part of an answer, so the cost is unknown
 * and the conservative reservation stands. A connection failure without a
 * status is treated the same way: it can be a mid-response disconnect.
 */
export function classifyAnthropicFailure(error: unknown): AiCallOutcome {
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) return 'unknown';
  if (error instanceof APIError && typeof error.status === 'number' && NOT_BILLED_STATUSES.has(error.status)) {
    return 'not-billed';
  }
  return 'unknown';
}

export interface AiUsageRecord {
  /** Route name as logged by withRouteObservability. */
  route: string;
  model: string;
  userId: string;
  reservation?: AiTokenReservation;
  usage: ModelUsage | null;
  outcome: AiCallOutcome;
  startedAt: number;
  /** Model calls behind this record (hierarchical jobs make several). */
  calls?: number;
}

/**
 * Settle the reservation and write the usage line. Call exactly once per
 * request that reserved budget, on every exit path.
 */
export async function recordAiUsage(record: AiUsageRecord): Promise<void> {
  const billable = record.usage
    ? billableTokens(record.usage)
    : record.outcome === 'not-billed'
      ? 0
      : null;
  // Metering must never turn a delivered answer into an error: a settlement
  // or logging failure is reported and the caller's own result stands.
  let adjustmentTokens = 0;
  try {
    adjustmentTokens = await settleAiTokenReservation(record.reservation, billable);
  } catch (error) {
    console.error('AI usage settlement failed:', error);
  }
  try {
    console.info(JSON.stringify({
      kind: 'ai-usage',
      route: record.route,
      model: record.model,
      outcome: record.outcome,
      calls: record.calls ?? 1,
      reservedTokens: record.reservation?.tokens ?? 0,
      billableTokens: billable,
      inputTokens: record.usage?.inputTokens ?? null,
      outputTokens: record.usage?.outputTokens ?? null,
      cacheReadTokens: record.usage?.cacheReadTokens ?? null,
      cacheWriteTokens: record.usage?.cacheWriteTokens ?? null,
      adjustmentTokens,
      elapsedMs: Date.now() - record.startedAt,
      userKey: opaqueIdentityKey(record.userId),
      correlationId: currentCorrelationId(),
    }));
  } catch (error) {
    console.error('AI usage line could not be written:', error);
  }
}
