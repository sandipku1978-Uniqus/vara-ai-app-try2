import { Anthropic, APIConnectionTimeoutError } from '@anthropic-ai/sdk';

// Default AI calls must finish before the standard three-minute concurrency
// lease expires. Multi-call summaries also have their own eight-minute overall
// AbortController deadline and a ten-minute capacity lease.
export const AI_MODEL_CALL_TIMEOUT_MS = 165_000;

export interface AnthropicClientOptions {
  /**
   * Point the SDK at an Anthropic-compatible endpoint instead of the
   * Anthropic API — the Vercel AI Gateway serves `/v1/messages` at its root.
   */
  baseURL?: string;
}

export function createAnthropicClient(apiKey: string, options: AnthropicClientOptions = {}): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: AI_MODEL_CALL_TIMEOUT_MS,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
}

export function isAnthropicTimeout(error: unknown): boolean {
  return typeof APIConnectionTimeoutError === 'function' && error instanceof APIConnectionTimeoutError;
}
