/**
 * AI model registry — the single list of models the application can route
 * through the Vercel AI Gateway, shared by the server routes (which validate
 * and dispatch) and the model selector UI (which only reads it).
 *
 * This module must stay client-safe: no secrets, no server imports.
 *
 * Ids are the gateway's own ids (`provider/model`), confirmed against
 * `GET https://ai-gateway.vercel.sh/v1/models` on 2026-10-04. Capability
 * flags come from the gateway's `tags` for each model on that date; a model
 * without `nativeWebSearch` gets web results through `perplexity/sonar`
 * when the user turns web search on.
 *
 * `effortLevels` are the levels the gateway catalog lists for the model
 * (`reasoning_options`) that a live call through the gateway also honoured
 * on 2026-10-04; the evidence is in
 * `src/__tests__/fixtures/ai-gateway/effort-matrix.json`. Two catalog
 * omissions were confirmed by calls rather than taken on trust: Claude Opus
 * 5.5 accepts `thinking: disabled` but still thinks (no `none`), while
 * Claude Sonnet 5.5 honours it (zero thinking tokens). Models whose catalog
 * has no `medium` default to `high`, the level the gateway itself translates
 * `medium` to on Gemini 3.
 */

export type AiProvider =
  | 'anthropic'
  | 'openai'
  | 'moonshotai'
  | 'spacexai'
  | 'google'
  | 'deepseek'
  | 'zai';

/** Reasoning effort as the user picks it; each provider maps it its own way. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max';

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'max'];

export interface AiModelDefinition {
  /** Gateway id, e.g. `anthropic/claude-sonnet-5.5`. */
  id: string;
  provider: AiProvider;
  /** Vendor label for grouping in the selector. */
  providerLabel: string;
  /** Full display name. */
  label: string;
  /** Short name for the compact selector trigger (≤ 14 chars). */
  shortLabel: string;
  /** Whether the model exposes configurable reasoning at all. */
  supportsReasoning: boolean;
  /** Effort levels the UI may offer for this model. */
  effortLevels: readonly ReasoningEffort[];
  /** Effort used when the user has not chosen one. */
  defaultEffort: ReasoningEffort;
  /** Gateway reports native web-search support (`web-search` tag). */
  nativeWebSearch: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  /** USD per token, from the gateway listing; informational only. */
  pricing: { input: number; output: number };
}

const ALL_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'max'];
const NO_NONE: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'max'];

export const AI_MODELS: readonly AiModelDefinition[] = [
  {
    id: 'anthropic/claude-opus-5.5',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    label: 'Claude Opus 5.5',
    shortLabel: 'Opus 5.5',
    supportsReasoning: true,
    effortLevels: NO_NONE,
    defaultEffort: 'medium',
    nativeWebSearch: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: { input: 0.000004, output: 0.00002 },
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    label: 'Claude Sonnet 5.5',
    shortLabel: 'Sonnet 5.5',
    supportsReasoning: true,
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'medium',
    nativeWebSearch: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: { input: 0.000002, output: 0.00001 },
  },
  {
    id: 'openai/gpt-6.1-sol',
    provider: 'openai',
    providerLabel: 'OpenAI',
    label: 'GPT-6.1 Sol',
    shortLabel: 'GPT-6.1 Sol',
    supportsReasoning: true,
    effortLevels: NO_NONE,
    defaultEffort: 'medium',
    nativeWebSearch: true,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    pricing: { input: 0.000002, output: 0.00001 },
  },
  {
    id: 'openai/gpt-5.6-luna',
    provider: 'openai',
    providerLabel: 'OpenAI',
    label: 'GPT-5.6 Luna',
    shortLabel: 'GPT-5.6 Luna',
    supportsReasoning: true,
    effortLevels: ALL_EFFORTS,
    defaultEffort: 'medium',
    nativeWebSearch: true,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    pricing: { input: 0.0000002, output: 0.0000012 },
  },
  {
    id: 'moonshotai/kimi-k3',
    provider: 'moonshotai',
    providerLabel: 'Moonshot AI',
    label: 'Kimi K3',
    shortLabel: 'Kimi K3',
    supportsReasoning: true,
    effortLevels: ['none', 'low', 'high', 'max'],
    defaultEffort: 'high',
    nativeWebSearch: false,
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    pricing: { input: 0.000003, output: 0.000015 },
  },
  {
    id: 'spacexai/grok-4.5',
    provider: 'spacexai',
    providerLabel: 'xAI',
    label: 'Grok 4.5',
    shortLabel: 'Grok 4.5',
    supportsReasoning: true,
    effortLevels: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
    nativeWebSearch: true,
    contextWindow: 500_000,
    maxOutputTokens: 500_000,
    pricing: { input: 0.000002, output: 0.000006 },
  },
  {
    id: 'spacexai/grok-4.6',
    provider: 'spacexai',
    providerLabel: 'xAI',
    label: 'Grok 4.6',
    shortLabel: 'Grok 4.6',
    supportsReasoning: true,
    effortLevels: NO_NONE,
    defaultEffort: 'medium',
    nativeWebSearch: false,
    contextWindow: 500_000,
    maxOutputTokens: 500_000,
    pricing: { input: 0.000002, output: 0.000006 },
  },
  {
    id: 'spacexai/grok-4.7',
    provider: 'spacexai',
    providerLabel: 'xAI',
    label: 'Grok 4.7',
    shortLabel: 'Grok 4.7',
    supportsReasoning: true,
    effortLevels: NO_NONE,
    defaultEffort: 'medium',
    nativeWebSearch: false,
    contextWindow: 500_000,
    maxOutputTokens: 500_000,
    pricing: { input: 0.000002, output: 0.000006 },
  },
  {
    id: 'google/gemini-3.8-flash',
    provider: 'google',
    providerLabel: 'Google',
    label: 'Gemini 3.8 Flash',
    shortLabel: 'Gemini 3.8',
    supportsReasoning: true,
    effortLevels: ['low', 'high'],
    defaultEffort: 'high',
    nativeWebSearch: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 65_535,
    pricing: { input: 0.00000075, output: 0.00000375 },
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    label: 'DeepSeek V4.1 Flash',
    shortLabel: 'DS V4.1 Flash',
    supportsReasoning: true,
    effortLevels: ['none', 'low', 'high', 'max'],
    defaultEffort: 'high',
    nativeWebSearch: false,
    contextWindow: 1_048_576,
    maxOutputTokens: 32_768,
    pricing: { input: 0.0000003, output: 0.0000012 },
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    label: 'DeepSeek V4 Pro',
    shortLabel: 'DS V4 Pro',
    supportsReasoning: true,
    effortLevels: ['none', 'low', 'high', 'max'],
    defaultEffort: 'high',
    nativeWebSearch: false,
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    pricing: { input: 0.00000066, output: 0.00000198 },
  },
  {
    id: 'zai/glm-5.3',
    provider: 'zai',
    providerLabel: 'Z.ai',
    label: 'GLM 5.3',
    shortLabel: 'GLM 5.3',
    supportsReasoning: true,
    effortLevels: ['low', 'high', 'max'],
    defaultEffort: 'high',
    nativeWebSearch: false,
    contextWindow: 1_000_000,
    maxOutputTokens: 1_000_000,
    pricing: { input: 0.0000014, output: 0.0000044 },
  },
  {
    id: 'zai/glm-5.3-flash',
    provider: 'zai',
    providerLabel: 'Z.ai',
    label: 'GLM 5.3 Flash',
    shortLabel: 'GLM 5.3 Flash',
    supportsReasoning: true,
    effortLevels: ['low', 'high', 'max'],
    defaultEffort: 'high',
    nativeWebSearch: false,
    contextWindow: 1_000_000,
    maxOutputTokens: 131_000,
    pricing: { input: 0.00000015, output: 0.0000005 },
  },
];

/** Used when a request names no model, and for every existing caller. */
export const DEFAULT_AI_MODEL_ID = 'anthropic/claude-sonnet-5.5';

/** Web results for models without native search are fetched through this gateway model. */
export const WEB_SEARCH_FALLBACK_MODEL_ID = 'perplexity/sonar';

export function findAiModel(id: string | null | undefined): AiModelDefinition | undefined {
  if (!id) return undefined;
  return AI_MODELS.find(model => model.id === id);
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * The fields every AI route accepts on top of its existing body. Absent fields
 * mean: default model, that model's default effort, no web search.
 */
export interface AiModelSelection {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  webSearch?: boolean;
}
