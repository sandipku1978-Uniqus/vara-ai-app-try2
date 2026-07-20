import { Anthropic, APIConnectionTimeoutError } from '@anthropic-ai/sdk';

// Default AI calls must finish before the standard three-minute concurrency
// lease expires. Multi-call summaries also have their own eight-minute overall
// AbortController deadline and a ten-minute capacity lease.
export const AI_MODEL_CALL_TIMEOUT_MS = 165_000;

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: AI_MODEL_CALL_TIMEOUT_MS,
  });
}

export function isAnthropicTimeout(error: unknown): boolean {
  return error instanceof APIConnectionTimeoutError;
}
