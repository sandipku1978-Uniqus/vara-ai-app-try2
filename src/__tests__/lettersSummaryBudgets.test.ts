import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AI_MODEL_CALL_TIMEOUT_MS } from '../lib/ai-runtime';
import {
  COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS,
  COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS,
  COMMENT_LETTER_SUMMARY_PLATFORM_BUDGET_SECONDS,
} from '../services/commentLetterSummary';

/**
 * Audit 2026-09: "letters/summary: maxDuration 300 s is shorter than its own
 * 480 s deadline and 600 s lease. The platform kills the invocation; the lock
 * persists 10 minutes (next POST → 409), the concurrency slot stays leased,
 * the reservation is never refunded." The ordering below is what keeps the
 * route's own deadline — and therefore its cleanup — ahead of the platform's.
 */
describe('comment-letter summary budgets', () => {
  it('nests the generation deadline inside the lock and the lock inside the platform budget', () => {
    expect(COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS).toBeLessThan(COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS * 1_000);
    expect(COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS).toBeLessThanOrEqual(COMMENT_LETTER_SUMMARY_PLATFORM_BUDGET_SECONDS);
    // Room for the cache write and the finally-blocks after the deadline fires.
    expect(COMMENT_LETTER_SUMMARY_PLATFORM_BUDGET_SECONDS * 1_000 - COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS)
      .toBeGreaterThanOrEqual(20_000);
    // A single model call may still use its full timeout inside the budget.
    expect(COMMENT_LETTER_SUMMARY_GENERATION_BUDGET_MS).toBeGreaterThan(AI_MODEL_CALL_TIMEOUT_MS);
  });

  it('is the budget the route actually declares', () => {
    // Next extracts segment config statically, so the route must carry a
    // literal; this keeps the literal and the service constant in step.
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/letters/summary/route.ts'), 'utf8');
    const declared = Number(source.match(/^export const maxDuration = (\d+);/m)?.[1]);
    expect(declared).toBe(COMMENT_LETTER_SUMMARY_PLATFORM_BUDGET_SECONDS);
  });

  it('keeps the default AI routes inside their 180 s concurrency lease', () => {
    for (const route of ['claude', 'compare']) {
      const source = readFileSync(resolve(process.cwd(), `src/app/api/${route}/route.ts`), 'utf8');
      const budget = Number(source.match(/^export const maxDuration = (\d+);/m)?.[1]);
      expect(budget, route).toBeGreaterThan(AI_MODEL_CALL_TIMEOUT_MS / 1_000);
      expect(budget, route).toBeLessThanOrEqual(180);
    }
  });
});
