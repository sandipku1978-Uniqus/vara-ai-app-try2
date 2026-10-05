/**
 * Provider-neutral model client over the Vercel AI Gateway.
 *
 * Every AI route calls `complete()` or `stream()` with a registry model id
 * (`lib/ai-models`), a reasoning effort and an optional web-search flag, and
 * gets back one normalized shape whatever the provider: text, an optional
 * reasoning summary, usage, the model and provider that answered, the finish
 * reason and any web citations.
 *
 * Transport, chosen from live calls on 2026-10-04 (evidence:
 * `src/__tests__/fixtures/ai-gateway/*.json`):
 *
 * - Anthropic models go through the gateway's Anthropic-compatible
 *   `/v1/messages` with the Anthropic SDK pointed at the gateway. It is the
 *   only surface that keeps native `max` effort (the OpenAI-compatible
 *   surfaces map `max` to `xhigh` for Claude), `thinking: disabled`, prompt
 *   caching (`cache_control`) and Anthropic's own web-search tool with
 *   structured results.
 * - Every other model goes through the gateway's OpenAI-compatible
 *   `/v1/responses` with plain fetch. Chat Completions rejects provider web
 *   search outright ("Expected 'function' | 'custom' | 'vercel:…'"), while
 *   Responses runs native search for OpenAI, Gemini and Grok and reports
 *   effort, reasoning tokens and usage for all eleven non-Anthropic models.
 * - Without a gateway key but with ANTHROPIC_API_KEY (the pre-gateway
 *   deployment), the default model still runs directly against Anthropic on
 *   the legacy model id, exactly as before; other models report unavailable.
 *
 * Every call is a single attempt with the same deadline as before
 * (AI_MODEL_CALL_TIMEOUT_MS), and failures surface as typed errors that
 * carry their billing outcome so routes can settle budgets truthfully.
 */

import type { Anthropic } from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  Message,
  MessageCreateParamsNonStreaming,
  RawMessageStreamEvent,
  TextBlockParam,
  ToolUnion,
} from '@anthropic-ai/sdk/resources/messages/messages';
import {
  AI_MODELS,
  DEFAULT_AI_MODEL_ID,
  findAiModel,
  WEB_SEARCH_FALLBACK_MODEL_ID,
  type AiModelDefinition,
  type AiProvider,
  type ReasoningEffort,
} from './ai-models';
import { AI_MODEL_CALL_TIMEOUT_MS, createAnthropicClient, isAnthropicTimeout } from './ai-runtime';
import type { AiCallOutcome, ModelUsage } from './ai-usage';
import { combineSignals } from './fetch-with-deadline';

export const AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh';

/** Model the direct Anthropic path has always run when ANTHROPIC_MODEL is unset. */
export const LEGACY_DIRECT_ANTHROPIC_MODEL = 'claude-sonnet-5';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The gateway key. `VERCEL_AI_GATEWAY_KEY` is the name this deployment uses;
 * `AI_GATEWAY_API_KEY` is the gateway's documented name and works too.
 */
export function aiGatewayApiKey(): string | null {
  const key = (process.env.VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY || '').trim();
  return key || null;
}

export function isAiGatewayConfigured(): boolean {
  return aiGatewayApiKey() !== null;
}

function directAnthropicKey(): string | null {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  return key || null;
}

/** Whether any model can run at all (the routes' 503 "not configured" check). */
export function isAiServiceConfigured(): boolean {
  return isAiGatewayConfigured() || directAnthropicKey() !== null;
}

/**
 * The model a request runs when it names none. ANTHROPIC_MODEL keeps working
 * as the override when it is set to a registry id; any other value is the
 * legacy direct-API model name and leaves the registry default in place.
 */
export function defaultAiModelId(): string {
  const configured = (process.env.ANTHROPIC_MODEL || '').trim();
  return configured && findAiModel(configured) ? configured : DEFAULT_AI_MODEL_ID;
}

/** The Anthropic API model id the direct (no-gateway) path runs. */
export function legacyDirectAnthropicModel(): string {
  const configured = (process.env.ANTHROPIC_MODEL || '').trim();
  return configured && !findAiModel(configured) ? configured : LEGACY_DIRECT_ANTHROPIC_MODEL;
}

/** Providers the client can call: the registry's, plus retrieval-only Perplexity. */
export type AiServingProvider = AiProvider | 'perplexity';

/**
 * A model the client can call. Registry models are user-selectable;
 * retrieval-only models (Perplexity Sonar) serve lib/ai-web-search and are
 * never offered in the selector.
 */
export type AiCallableModel =
  | AiModelDefinition
  | (Omit<AiModelDefinition, 'provider'> & { provider: 'perplexity' });

/**
 * Perplexity Sonar as the gateway lists it on 2026-10-04 (8,000 output
 * tokens; effort none…xhigh). Not in the registry: it is a search engine
 * with an answer attached, used only to fetch web context for models that
 * cannot search themselves.
 */
export const WEB_RETRIEVAL_ONLY_MODELS: readonly AiCallableModel[] = [
  {
    id: WEB_SEARCH_FALLBACK_MODEL_ID,
    provider: 'perplexity',
    providerLabel: 'Perplexity',
    label: 'Perplexity Sonar',
    shortLabel: 'Sonar',
    supportsReasoning: true,
    effortLevels: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'low',
    nativeWebSearch: true,
    contextWindow: 127_000,
    maxOutputTokens: 8_000,
    pricing: { input: 0.00000025, output: 0.0000025 },
  },
];

export function findCallableModel(id: string | null | undefined): AiCallableModel | undefined {
  return findAiModel(id) ?? WEB_RETRIEVAL_ONLY_MODELS.find(model => model.id === id);
}

export type AiTransport = 'gateway-messages' | 'gateway-responses' | 'direct-anthropic';

export interface AiCallPlan {
  model: AiCallableModel;
  transport: AiTransport;
  /** The id sent on the wire (gateway id, or the legacy Anthropic id). */
  wireModel: string;
}

/**
 * How a registry model will be called right now, or a typed error when it
 * cannot be: no gateway key for a non-default or non-Anthropic model, or no
 * key at all.
 */
export function planAiCall(modelId: string): AiCallPlan {
  const model = findCallableModel(modelId);
  if (!model) {
    throw new AiModelUnavailableError(`Unknown model "${modelId}".`, { code: 'unknown-model' });
  }
  if (isAiGatewayConfigured()) {
    return {
      model,
      transport: model.provider === 'anthropic' ? 'gateway-messages' : 'gateway-responses',
      wireModel: model.id,
    };
  }
  if (directAnthropicKey() && model.id === defaultAiModelId()) {
    return { model, transport: 'direct-anthropic', wireModel: legacyDirectAnthropicModel() };
  }
  throw new AiModelUnavailableError(
    directAnthropicKey()
      ? `${model.label} needs the AI Gateway, which is not configured on this deployment.`
      : 'AI service is not configured.',
    { code: 'not-configured' }
  );
}

// ---------------------------------------------------------------------------
// Effort mapping — one table, every provider
// ---------------------------------------------------------------------------

/** Effort values the gateway accepts on the wire. */
export type WireEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * The user's effort level → what each provider is sent. A level missing from
 * a provider's row is not offered (the registry's `effortLevels` never list
 * it). Rows follow each model's `reasoning_options` in `GET /v1/models`, and
 * every pairing was sent live on 2026-10-04 (fixture: effort-matrix.json):
 *
 * - anthropic: `none` → `thinking: {type: 'disabled'}`; the rest →
 *   adaptive thinking with `output_config.effort` of the same name (native
 *   `max` survives only on /v1/messages).
 * - openai: named effort; `max` is native on both GPT models.
 * - moonshotai / deepseek: none · low · high · max (no `medium` in the catalog).
 * - spacexai: low · medium · high; the catalog tops out at `xhigh`, which is
 *   what `max` sends (Grok 4.5 offers neither).
 * - google: Gemini 3 has two thinking levels; the gateway maps everything
 *   but `low` to `high`, so only those two are offered.
 * - zai: low · high · max (no off switch: `none` still reasoned live).
 */
export const EFFORT_WIRE_MAP: Readonly<Record<AiServingProvider, Readonly<Partial<Record<ReasoningEffort, WireEffort>>>>> = {
  anthropic: { none: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
  openai: { none: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
  moonshotai: { none: 'none', low: 'low', high: 'high', max: 'max' },
  spacexai: { low: 'low', medium: 'medium', high: 'high', max: 'xhigh' },
  google: { low: 'low', high: 'high' },
  deepseek: { none: 'none', low: 'low', high: 'high', max: 'max' },
  zai: { low: 'low', high: 'high', max: 'max' },
  // Retrieval only: Sonar always searches; effort only shapes its answer.
  perplexity: { none: 'none', low: 'low', medium: 'medium', high: 'high' },
};

export function wireEffortFor(model: AiCallableModel, effort: ReasoningEffort): WireEffort {
  const wire = model.effortLevels.includes(effort) ? EFFORT_WIRE_MAP[model.provider][effort] : undefined;
  if (!wire) {
    throw new RangeError(`${model.label} does not offer "${effort}" reasoning effort.`);
  }
  return wire;
}

/**
 * The lowest effort a model offers: what background jobs that used to run
 * with thinking off (comment-letter summaries) use when the model cannot
 * turn reasoning off entirely.
 */
export function lowestEffort(model: AiCallableModel): ReasoningEffort {
  return model.effortLevels.includes('none') ? 'none' : model.effortLevels[0];
}

/** Anthropic `/v1/messages` thinking fields for an effort. */
export function anthropicReasoningParams(
  wire: WireEffort,
  options: { legacyDirect?: boolean } = {}
): Pick<MessageCreateParamsNonStreaming, 'thinking' | 'output_config'> {
  if (wire === 'none') return { thinking: { type: 'disabled' } };
  // The legacy direct model (Sonnet 5) has always run plain adaptive
  // thinking; effort tiers are a gateway-era addition.
  if (options.legacyDirect) return { thinking: { type: 'adaptive' } };
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: wire },
  };
}

/** Responses API `reasoning` field for an effort. */
export function responsesReasoningParams(wire: WireEffort): { effort: WireEffort; summary?: 'auto' } {
  return wire === 'none' ? { effort: 'none' } : { effort: wire, summary: 'auto' };
}

/**
 * Reasoning tokens come out of the same output allowance as the answer on
 * every provider, so a request that asks for N answer tokens at a reasoning
 * effort gets this much on top (bounded by the model's output ceiling).
 */
export const REASONING_HEADROOM_TOKENS: Readonly<Record<ReasoningEffort, number>> = {
  none: 0,
  low: 1_024,
  medium: 4_096,
  high: 8_192,
  max: 16_384,
};

export function outputTokenBudget(model: AiCallableModel, answerTokens: number, effort: ReasoningEffort): number {
  const answer = Number.isFinite(answerTokens) ? Math.max(1, Math.floor(answerTokens)) : 1;
  // Models that cannot switch reasoning off still think at their lowest level.
  const headroom = effort === 'none' && !model.effortLevels.includes('none')
    ? REASONING_HEADROOM_TOKENS.low
    : REASONING_HEADROOM_TOKENS[effort];
  return Math.min(answer + headroom, model.maxOutputTokens);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiErrorKind = 'timeout' | 'rate-limited' | 'model-unavailable' | 'content-filter' | 'aborted' | 'upstream';

interface AiErrorOptions {
  status?: number;
  code?: string;
  cause?: unknown;
  usage?: AiUsage | null;
}

/** Base class: every failure the client raises, with what it cost. */
export class AiGatewayError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  readonly code?: string;
  /** Read by lib/ai-usage to settle the reservation. */
  readonly billingOutcome: AiCallOutcome;
  /** Usage reported before the failure, when any was. */
  readonly usage: AiUsage | null;

  constructor(kind: AiErrorKind, message: string, billingOutcome: AiCallOutcome, options: AiErrorOptions = {}) {
    super(message);
    if (options.cause !== undefined) Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false });
    this.name = new.target.name;
    this.kind = kind;
    this.status = options.status;
    this.code = options.code;
    this.billingOutcome = billingOutcome;
    this.usage = options.usage ?? null;
  }
}

/** The call hit its deadline; it may have generated (cost unknown). */
export class AiTimeoutError extends AiGatewayError {
  constructor(message = 'AI generation timed out.', options: AiErrorOptions = {}) {
    super('timeout', message, 'unknown', options);
  }
}

/** The provider or gateway refused for rate; nothing was generated. */
export class AiRateLimitedError extends AiGatewayError {
  readonly retryAfterSeconds: number | null;

  constructor(message = 'The AI provider is rate-limiting requests.', options: AiErrorOptions & { retryAfterSeconds?: number | null } = {}) {
    super('rate-limited', message, 'not-billed', { ...options, status: options.status ?? 429 });
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/**
 * The model cannot be served: unknown to the gateway, no provider (including
 * none that satisfies the team's zero-data-retention policy), overloaded, or
 * not configured on this deployment. Nothing was generated.
 */
export class AiModelUnavailableError extends AiGatewayError {
  constructor(message = 'The selected model is currently unavailable.', options: AiErrorOptions = {}) {
    super('model-unavailable', message, 'not-billed', options);
  }
}

/** The model refused or its output was filtered; the tokens were billed. */
export class AiContentFilterError extends AiGatewayError {
  constructor(message = 'The model declined to answer this request.', options: AiErrorOptions = {}) {
    super('content-filter', message, options.usage ? 'completed' : 'unknown', options);
  }
}

/** The caller's signal aborted the call. */
export class AiAbortedError extends AiGatewayError {
  constructor(message = 'AI request was cancelled.', options: AiErrorOptions = {}) {
    super('aborted', message, 'unknown', options);
  }
}

/** Any other upstream failure. */
export class AiUpstreamError extends AiGatewayError {
  constructor(message: string, options: AiErrorOptions = {}) {
    super('upstream', message, isNotBilledStatus(options.status) ? 'not-billed' : 'unknown', options);
  }
}

const NOT_BILLED_STATUSES = new Set([400, 401, 403, 404, 413, 422, 429, 529]);
const MODEL_UNAVAILABLE_CODES = new Set([
  'model_not_found',
  'no_providers_available',
  'no_zdr_providers_available',
  'overloaded_error',
]);

function isNotBilledStatus(status: number | undefined): boolean {
  return typeof status === 'number' && NOT_BILLED_STATUSES.has(status);
}

/** Error type/code out of a gateway or Anthropic error body. */
function errorCodeFrom(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null;
  const code = nested?.type ?? nested?.code ?? record.type ?? record.code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessageFrom(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as Record<string, unknown>;
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null;
  const message = nested?.message ?? (typeof record.error === 'string' ? record.error : undefined) ?? record.message;
  return typeof message === 'string' && message ? message.slice(0, 500) : fallback;
}

function retryAfterFrom(headers: Headers | Record<string, string | null | undefined> | undefined | null): number | null {
  if (!headers) return null;
  const raw = headers instanceof Headers ? headers.get('retry-after') : headers['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/** Map an HTTP failure from the gateway (either surface) to a typed error. */
export function gatewayHttpError(
  status: number,
  body: unknown,
  headers?: Headers | Record<string, string | null | undefined> | null,
  cause?: unknown
): AiGatewayError {
  const code = errorCodeFrom(body);
  const message = errorMessageFrom(body, `AI gateway returned HTTP ${status}.`);
  if (status === 429 || code === 'rate_limit_exceeded' || code === 'rate_limit_error') {
    return new AiRateLimitedError(message, { status, code, cause, retryAfterSeconds: retryAfterFrom(headers) });
  }
  if (status === 404 || status === 503 || status === 529 || (code && MODEL_UNAVAILABLE_CODES.has(code))) {
    return new AiModelUnavailableError(message, { status, code, cause });
  }
  if (status === 408 || status === 504) {
    return new AiTimeoutError('AI generation timed out.', { status, code, cause });
  }
  if (code === 'content_filter' || code === 'content_policy_violation') {
    return new AiContentFilterError(message, { status, code, cause });
  }
  return new AiUpstreamError(message, { status, code, cause });
}

/** Normalize anything a call threw into a typed error. */
export function toAiGatewayError(error: unknown, signal?: AbortSignal | null): AiGatewayError {
  if (error instanceof AiGatewayError) return error;
  if (isAnthropicTimeout(error)) return new AiTimeoutError(undefined, { cause: error });
  if (signal?.aborted) return new AiAbortedError(undefined, { cause: error });
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    const sdkError = error as { error?: unknown; headers?: Headers | Record<string, string> | null };
    return gatewayHttpError(status, sdkError.error, sdkError.headers ?? null, error);
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'APIUserAbortError' || name === 'AbortError') return new AiAbortedError(undefined, { cause: error });
  const message = error instanceof Error ? error.message : 'AI request failed.';
  return new AiUpstreamError(message, { cause: error });
}

export function isAiTimeout(error: unknown): boolean {
  return error instanceof AiTimeoutError || isAnthropicTimeout(error);
}

/**
 * HTTP response for a typed model failure, or null for anything a route
 * should treat as its own 500. Timeouts keep their 504 (the client does not
 * retry it); unavailable and upstream rate limits are 503 (the client
 * retries once); a refusal is 422.
 */
export function aiErrorResponse(error: unknown): Response | null {
  const headers = { 'Cache-Control': 'no-store' };
  if (isAiTimeout(error)) return Response.json({ error: 'AI generation timed out.' }, { status: 504, headers });
  if (error instanceof AiRateLimitedError) {
    return Response.json({ error: 'The AI provider is busy. Try again shortly.' }, {
      status: 503,
      headers: { ...headers, 'Retry-After': String(Math.max(error.retryAfterSeconds ?? 5, 1)) },
    });
  }
  if (error instanceof AiModelUnavailableError) {
    const notConfigured = error.code === 'not-configured';
    return Response.json({
      error: notConfigured ? error.message : 'The selected model is currently unavailable. Choose another model or try again shortly.',
    }, { status: 503, headers });
  }
  if (error instanceof AiContentFilterError) {
    return Response.json({ error: 'The model declined to answer this request.' }, { status: 422, headers });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Request / result shapes
// ---------------------------------------------------------------------------

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A caller-defined function tool (no route uses one yet). */
export interface AiFunctionTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  inputSchema: Record<string, unknown>;
}

export interface AiCompletionRequest {
  /** Registry id. */
  model: string;
  system: string;
  messages: AiChatMessage[];
  /** Total output allowance, reasoning included (see outputTokenBudget). */
  maxTokens: number;
  reasoningEffort: ReasoningEffort;
  /** Run the provider's own web-search tool (models with `nativeWebSearch`). */
  webSearch?: boolean;
  tools?: AiFunctionTool[];
  signal?: AbortSignal;
  /** Anthropic prompt caching for the system prompt; default true. */
  cacheSystemPrompt?: boolean;
  /** Upper bound on native web-search tool uses; default 3. */
  maxWebSearches?: number;
  /** Override the call deadline (retrieval calls use a shorter one). */
  timeoutMs?: number;
}

export interface AiUsage {
  /** All input tokens, cached ones included. */
  input: number;
  /** All output tokens, reasoning included. */
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  webSearchCalls?: number;
}

export interface AiCitation {
  url: string;
  title: string | null;
}

export type AiFinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'other';

export interface AiToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AiCompletion {
  text: string;
  reasoningSummary?: string;
  usage: AiUsage;
  /** The model that answered: registry id, or the legacy Anthropic id. */
  model: string;
  provider: AiServingProvider;
  /** The serving provider the gateway routed to (e.g. vertex, baseten), when reported. */
  servedBy?: string;
  finishReason: AiFinishReason;
  citations?: AiCitation[];
  toolCalls?: AiToolCall[];
}

export type AiStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; completion: AiCompletion };

export interface AiStream extends AsyncIterable<AiStreamEvent> {
  /** Stop the upstream request (client went away). */
  abort(): void;
  /** Usage observed so far, for settling a stream that ended early. */
  partialUsage(): AiUsage | null;
}

/** Budget-side view of normalized usage (uncached input counted separately). */
export function modelUsageFromAiUsage(usage: AiUsage | null | undefined): ModelUsage | null {
  if (!usage) return null;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const result: ModelUsage = {
    inputTokens: Math.max(0, usage.input - cacheRead - cacheWrite),
    outputTokens: usage.output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
  if (usage.reasoning !== undefined) result.reasoningTokens = usage.reasoning;
  if (usage.webSearchCalls !== undefined) result.webSearchCalls = usage.webSearchCalls;
  return result;
}

/** Sum normalized usage across sequential calls (multi-call jobs). */
export function addAiUsage(first: AiUsage | null, second: AiUsage | null): AiUsage | null {
  if (!first) return second;
  if (!second) return first;
  const sum: AiUsage = { input: first.input + second.input, output: first.output + second.output };
  for (const key of ['reasoning', 'cacheRead', 'cacheWrite', 'webSearchCalls'] as const) {
    if (first[key] !== undefined || second[key] !== undefined) sum[key] = (first[key] ?? 0) + (second[key] ?? 0);
  }
  return sum;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function dedupeCitations(citations: AiCitation[]): AiCitation[] {
  const seen = new Map<string, AiCitation>();
  for (const citation of citations) {
    const url = citation.url.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const existing = seen.get(url);
    if (!existing) seen.set(url, { url, title: citation.title?.trim() || null });
    else if (!existing.title && citation.title) existing.title = citation.title.trim();
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Anthropic transport (/v1/messages through the gateway, or direct)
// ---------------------------------------------------------------------------

const anthropicClients = new Map<string, Anthropic>();

function anthropicClientFor(plan: AiCallPlan): Anthropic {
  const gateway = plan.transport === 'gateway-messages';
  const key = gateway ? aiGatewayApiKey() : directAnthropicKey();
  if (!key) throw new AiModelUnavailableError('AI service is not configured.', { code: 'not-configured' });
  const cacheKey = `${gateway ? 'gateway' : 'direct'}:${key}`;
  let client = anthropicClients.get(cacheKey);
  if (!client) {
    client = createAnthropicClient(key, gateway ? { baseURL: AI_GATEWAY_BASE_URL } : {});
    anthropicClients.set(cacheKey, client);
  }
  return client;
}

function anthropicParams(plan: AiCallPlan, request: AiCompletionRequest): MessageCreateParamsNonStreaming {
  const wire = wireEffortFor(plan.model, request.reasoningEffort);
  const system: TextBlockParam = {
    type: 'text',
    text: request.system,
    ...(request.cacheSystemPrompt === false ? {} : { cache_control: { type: 'ephemeral' as const } }),
  };
  const tools: ToolUnion[] = [];
  if (request.webSearch) {
    tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: request.maxWebSearches ?? 3 });
  }
  for (const tool of request.tools ?? []) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: { type: 'object', ...tool.inputSchema },
    });
  }
  return {
    model: plan.wireModel,
    max_tokens: request.maxTokens,
    ...anthropicReasoningParams(wire, { legacyDirect: plan.transport === 'direct-anthropic' }),
    system: [system],
    messages: request.messages.map(message => ({ role: message.role, content: message.content })),
    ...(tools.length > 0 ? { tools } : {}),
  };
}

interface AnthropicUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens_details?: { thinking_tokens?: number | null } | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function usageFromAnthropic(usage: AnthropicUsageLike | null | undefined): AiUsage | null {
  if (!usage || typeof usage !== 'object') return null;
  const cacheRead = count(usage.cache_read_input_tokens);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const result: AiUsage = {
    input: count(usage.input_tokens) + cacheRead + cacheWrite,
    output: count(usage.output_tokens),
    cacheRead,
    cacheWrite,
  };
  const reasoning = optionalCount(usage.output_tokens_details?.thinking_tokens);
  if (reasoning !== undefined) result.reasoning = reasoning;
  const searches = optionalCount(usage.server_tool_use?.web_search_requests);
  if (searches !== undefined) result.webSearchCalls = searches;
  return result;
}

function anthropicFinishReason(stopReason: string | null | undefined): AiFinishReason {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'tool_use':
      return 'tool-calls';
    case 'refusal':
      return 'content-filter';
    default:
      return 'other';
  }
}

/** Normalize a complete Anthropic message (exported for tests). */
export function normalizeAnthropicMessage(message: Message, plan: AiCallPlan): AiCompletion {
  const blocks: ContentBlock[] = Array.isArray(message.content) ? message.content : [];
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('');
  const reasoningSummary = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'thinking' }> => block.type === 'thinking')
    .map(block => block.thinking)
    .join('\n')
    .trim();
  const citations: AiCitation[] = [];
  const toolCalls: AiToolCall[] = [];
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === 'web_search_result') citations.push({ url: result.url, title: result.title ?? null });
      }
    } else if (block.type === 'text' && Array.isArray(block.citations)) {
      for (const citation of block.citations) {
        if (citation.type === 'web_search_result_location') {
          citations.push({ url: citation.url, title: citation.title ?? null });
        }
      }
    } else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
    }
  }
  const usage = usageFromAnthropic(message.usage as AnthropicUsageLike) ?? { input: 0, output: 0 };
  const finishReason = anthropicFinishReason(message.stop_reason);
  if (finishReason === 'content-filter') {
    throw new AiContentFilterError(undefined, { usage, code: 'refusal' });
  }
  const completion: AiCompletion = {
    text,
    usage,
    model: plan.transport === 'direct-anthropic' ? plan.wireModel : plan.model.id,
    provider: plan.model.provider,
    finishReason,
  };
  if (reasoningSummary) completion.reasoningSummary = reasoningSummary;
  const unique = dedupeCitations(citations);
  if (unique.length > 0) completion.citations = unique;
  if (toolCalls.length > 0) completion.toolCalls = toolCalls;
  const servedBy = gatewayServedBy((message as unknown as { provider_metadata?: unknown }).provider_metadata);
  if (servedBy) completion.servedBy = servedBy;
  return completion;
}

function withDeadline(request: AiCompletionRequest): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('AI model call exceeded its deadline.', 'TimeoutError'));
  }, request.timeoutMs ?? AI_MODEL_CALL_TIMEOUT_MS);
  return {
    signal: combineSignals(request.signal, controller.signal),
    timedOut: () => timedOut,
    clear: () => clearTimeout(timer),
  };
}

async function completeAnthropic(plan: AiCallPlan, request: AiCompletionRequest): Promise<AiCompletion> {
  const client = anthropicClientFor(plan);
  const deadline = withDeadline(request);
  try {
    const message = await client.messages.create(anthropicParams(plan, request), { signal: deadline.signal });
    return normalizeAnthropicMessage(message, plan);
  } catch (error) {
    if (deadline.timedOut()) throw new AiTimeoutError(undefined, { cause: error });
    throw toAiGatewayError(error, request.signal);
  } finally {
    deadline.clear();
  }
}

function streamAnthropic(plan: AiCallPlan, request: AiCompletionRequest): AiStream {
  const client = anthropicClientFor(plan);
  const deadline = withDeadline(request);
  const upstream = client.messages.stream(anthropicParams(plan, request), { signal: deadline.signal });
  let observed: AiUsage | null = null;

  async function* events(): AsyncGenerator<AiStreamEvent> {
    try {
      for await (const event of upstream as AsyncIterable<RawMessageStreamEvent>) {
        if (event.type === 'message_start') {
          observed = usageFromAnthropic(event.message.usage as AnthropicUsageLike);
        } else if (event.type === 'message_delta') {
          const delta = usageFromAnthropic(event.usage as AnthropicUsageLike);
          if (delta) {
            const previous: AiUsage = observed ?? { input: 0, output: 0 };
            // Deltas carry cumulative counts; zero means "not repeated here".
            observed = {
              ...previous,
              ...delta,
              input: delta.input || previous.input,
              output: delta.output || previous.output,
            };
          }
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text-delta', text: event.delta.text };
        }
      }
      const final = await upstream.finalMessage();
      const completion = normalizeAnthropicMessage(final, plan);
      observed = completion.usage;
      yield { type: 'finish', completion };
    } catch (error) {
      if (error instanceof AiGatewayError) throw error;
      if (deadline.timedOut()) throw new AiTimeoutError(undefined, { cause: error, usage: observed });
      throw toAiGatewayError(error, request.signal);
    } finally {
      deadline.clear();
    }
  }

  const iterator = events();
  return {
    [Symbol.asyncIterator]: () => iterator,
    abort: () => upstream.abort(),
    partialUsage: () => observed,
  };
}

// ---------------------------------------------------------------------------
// Responses transport (/v1/responses through the gateway)
// ---------------------------------------------------------------------------

interface ResponsesBody {
  model: string;
  instructions: string;
  input: Array<{ role: 'user' | 'assistant'; content: string }>;
  max_output_tokens: number;
  reasoning: { effort: WireEffort; summary?: 'auto' };
  tools?: Array<Record<string, unknown>>;
  stream?: boolean;
  store: false;
}

export function responsesBody(model: AiCallableModel, request: AiCompletionRequest, stream = false): ResponsesBody {
  const tools: Array<Record<string, unknown>> = [];
  if (request.webSearch) tools.push({ type: 'web_search' });
  for (const tool of request.tools ?? []) {
    tools.push({ type: 'function', name: tool.name, description: tool.description, parameters: { type: 'object', ...tool.inputSchema } });
  }
  return {
    model: model.id,
    instructions: request.system,
    input: request.messages.map(message => ({ role: message.role, content: message.content })),
    max_output_tokens: request.maxTokens,
    reasoning: responsesReasoningParams(wireEffortFor(model, request.reasoningEffort)),
    ...(tools.length > 0 ? { tools } : {}),
    ...(stream ? { stream: true } : {}),
    store: false,
  };
}

interface ResponsesUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
  output_tokens_details?: { reasoning_tokens?: number } | null;
}

function gatewayServedBy(providerMetadata: unknown): string | undefined {
  const gateway = (providerMetadata as { gateway?: { routing?: { finalProvider?: unknown } } } | null | undefined)?.gateway;
  const provider = gateway?.routing?.finalProvider;
  return typeof provider === 'string' && provider ? provider : undefined;
}

type ResponsesOutputItem = Record<string, unknown> & { type?: string };

/** Normalize a final Responses API object (exported for tests). */
export function normalizeResponsesResult(response: Record<string, unknown>, model: AiCallableModel): AiCompletion {
  const output = Array.isArray(response.output) ? response.output as ResponsesOutputItem[] : [];
  const textParts: string[] = [];
  const summaries: string[] = [];
  const citations: AiCitation[] = [];
  const toolCalls: AiToolCall[] = [];
  let searchCalls = 0;
  for (const item of output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (part.type === 'output_text' && typeof part.text === 'string') textParts.push(part.text);
        for (const annotation of Array.isArray(part.annotations) ? part.annotations as Array<Record<string, unknown>> : []) {
          if (annotation.type === 'url_citation' && typeof annotation.url === 'string') {
            citations.push({ url: annotation.url, title: typeof annotation.title === 'string' ? annotation.title : null });
          }
        }
      }
    } else if (item.type === 'reasoning' && Array.isArray(item.summary)) {
      for (const summary of item.summary as Array<Record<string, unknown>>) {
        if (typeof summary.text === 'string' && summary.text.trim()) summaries.push(summary.text.trim());
      }
    } else if (item.type === 'web_search_call') {
      searchCalls += 1;
      const sources = (item.action as { sources?: unknown } | undefined)?.sources;
      for (const source of Array.isArray(sources) ? sources as Array<Record<string, unknown>> : []) {
        if (typeof source.url === 'string') citations.push({ url: source.url, title: typeof source.title === 'string' ? source.title : null });
      }
    } else if (item.type === 'function_call' && typeof item.name === 'string') {
      let args: unknown = item.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          // Leave malformed arguments as the raw string for the caller to judge.
        }
      }
      toolCalls.push({ id: String(item.call_id ?? item.id ?? ''), name: item.name, arguments: args });
    }
  }

  // Gemini reports Google Search grounding in provider metadata, not in
  // annotations.
  const providerMetadata = response.provider_metadata as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(providerMetadata ?? {})) {
    if (key === 'gateway' || !value || typeof value !== 'object') continue;
    const chunks = (value as { groundingMetadata?: { groundingChunks?: unknown } }).groundingMetadata?.groundingChunks;
    for (const chunk of Array.isArray(chunks) ? chunks as Array<{ web?: { uri?: unknown; title?: unknown } }> : []) {
      if (typeof chunk.web?.uri === 'string') {
        citations.push({ url: chunk.web.uri, title: typeof chunk.web.title === 'string' ? chunk.web.title : null });
      }
    }
  }

  const rawUsage = (response.usage ?? null) as ResponsesUsageLike | null;
  const usage: AiUsage = {
    input: count(rawUsage?.input_tokens),
    output: count(rawUsage?.output_tokens),
  };
  const reasoning = optionalCount(rawUsage?.output_tokens_details?.reasoning_tokens);
  if (reasoning !== undefined) usage.reasoning = reasoning;
  const cacheRead = optionalCount(rawUsage?.input_tokens_details?.cached_tokens);
  if (cacheRead !== undefined) usage.cacheRead = cacheRead;
  const cacheWrite = optionalCount(rawUsage?.input_tokens_details?.cache_write_tokens);
  if (cacheWrite !== undefined) usage.cacheWrite = cacheWrite;
  const billedSearches = optionalCount((providerMetadata?.gateway as { billableWebSearchCalls?: unknown } | undefined)?.billableWebSearchCalls);
  if (billedSearches !== undefined || searchCalls > 0) usage.webSearchCalls = billedSearches ?? searchCalls;

  const incompleteReason = (response.incomplete_details as { reason?: unknown } | null | undefined)?.reason;
  let finishReason: AiFinishReason = 'stop';
  if (response.status === 'incomplete') {
    finishReason = incompleteReason === 'max_output_tokens' ? 'length'
      : incompleteReason === 'content_filter' ? 'content-filter'
        : 'other';
  } else if (response.status !== 'completed') {
    finishReason = 'other';
  } else if (toolCalls.length > 0) {
    finishReason = 'tool-calls';
  }
  if (finishReason === 'content-filter') {
    throw new AiContentFilterError(undefined, { usage, code: 'content_filter' });
  }

  const completion: AiCompletion = {
    text: textParts.join(''),
    usage,
    model: model.id,
    provider: model.provider,
    finishReason,
  };
  if (summaries.length > 0) completion.reasoningSummary = summaries.join('\n');
  const unique = dedupeCitations(citations);
  if (unique.length > 0) completion.citations = unique;
  if (toolCalls.length > 0) completion.toolCalls = toolCalls;
  const servedBy = gatewayServedBy(providerMetadata);
  if (servedBy) completion.servedBy = servedBy;
  return completion;
}

async function postResponses(body: ResponsesBody, signal: AbortSignal): Promise<Response> {
  const key = aiGatewayApiKey();
  if (!key) throw new AiModelUnavailableError('AI service is not configured.', { code: 'not-configured' });
  return fetch(`${AI_GATEWAY_BASE_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(body.stream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function failedResponse(response: Response): Promise<AiGatewayError> {
  const body = await response.json().catch(() => null);
  return gatewayHttpError(response.status, body, response.headers);
}

async function completeResponses(plan: AiCallPlan, request: AiCompletionRequest): Promise<AiCompletion> {
  const deadline = withDeadline(request);
  try {
    const response = await postResponses(responsesBody(plan.model, request), deadline.signal);
    if (!response.ok) throw await failedResponse(response);
    const json = await response.json() as Record<string, unknown>;
    if (json.status === 'failed') {
      throw gatewayHttpError(502, json.error ?? json, response.headers);
    }
    return normalizeResponsesResult(json, plan.model);
  } catch (error) {
    if (error instanceof AiGatewayError) throw error;
    if (deadline.timedOut()) throw new AiTimeoutError(undefined, { cause: error });
    throw toAiGatewayError(error, request.signal);
  } finally {
    deadline.clear();
  }
}

/** Split an SSE byte stream into `data:` payloads (exported for tests). */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(buffer[boundary] === '\r' ? boundary + 4 : boundary + 2);
        const data = rawEvent
          .split(/\r?\n/)
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield data;
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
    buffer += decoder.decode();
    const tail = buffer
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function streamResponses(plan: AiCallPlan, request: AiCompletionRequest): AiStream {
  const deadline = withDeadline(request);
  const abortController = new AbortController();
  const signal = combineSignals(deadline.signal, abortController.signal);
  let observed: AiUsage | null = null;

  async function* events(): AsyncGenerator<AiStreamEvent> {
    try {
      const response = await postResponses(responsesBody(plan.model, request, true), signal);
      if (!response.ok) throw await failedResponse(response);
      if (!response.body) throw new AiUpstreamError('AI gateway returned an empty stream.');
      let finished = false;
      for await (const data of sseData(response.body)) {
        if (data === '[DONE]') break;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          yield { type: 'text-delta', text: event.delta };
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          const completion = normalizeResponsesResult(event.response as Record<string, unknown>, plan.model);
          observed = completion.usage;
          finished = true;
          yield { type: 'finish', completion };
        } else if (event.type === 'response.failed' || event.type === 'error') {
          const failure = (event.response as { error?: unknown } | undefined)?.error ?? event.error ?? event;
          const status = typeof (event as { status?: unknown }).status === 'number' ? (event as { status: number }).status : 502;
          throw gatewayHttpError(status, { error: failure });
        }
      }
      if (!finished) throw new AiUpstreamError('AI stream ended before the response completed.');
    } catch (error) {
      if (error instanceof AiGatewayError) throw error;
      if (deadline.timedOut()) throw new AiTimeoutError(undefined, { cause: error, usage: observed });
      if (abortController.signal.aborted) throw new AiAbortedError(undefined, { cause: error });
      throw toAiGatewayError(error, request.signal);
    } finally {
      deadline.clear();
    }
  }

  const iterator = events();
  return {
    [Symbol.asyncIterator]: () => iterator,
    abort: () => abortController.abort(new DOMException('Client cancelled the stream.', 'AbortError')),
    partialUsage: () => observed,
  };
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

function checkedPlan(request: AiCompletionRequest): AiCallPlan {
  const plan = planAiCall(request.model);
  // Validate the effort up front so a bad pairing never reaches the wire.
  wireEffortFor(plan.model, request.reasoningEffort);
  if (request.webSearch && !plan.model.nativeWebSearch) {
    throw new RangeError(`${plan.model.label} has no native web search; use lib/ai-web-search retrieval instead.`);
  }
  return plan;
}

/** One model call, one attempt, normalized result. */
export async function complete(request: AiCompletionRequest): Promise<AiCompletion> {
  const plan = checkedPlan(request);
  return plan.transport === 'gateway-responses'
    ? completeResponses(plan, request)
    : completeAnthropic(plan, request);
}

/**
 * One streamed model call. Iterate for `text-delta` events; the last event
 * is `finish` with the normalized completion. Errors surface as typed
 * AiGatewayErrors from the iterator.
 */
export function stream(request: AiCompletionRequest): AiStream {
  const plan = checkedPlan(request);
  return plan.transport === 'gateway-responses'
    ? streamResponses(plan, request)
    : streamAnthropic(plan, request);
}

/** Registry ids, in registry order, for the given gateway model listing. */
export function registryModelsListedBy(listedIds: Iterable<string>): string[] {
  const listed = new Set(listedIds);
  return AI_MODELS.filter(model => listed.has(model.id)).map(model => model.id);
}
