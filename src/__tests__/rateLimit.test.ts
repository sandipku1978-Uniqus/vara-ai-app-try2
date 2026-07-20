import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/kv', () => ({
  kv: new Proxy({}, {
    get: () => () => {
      throw new Error('distributed store unreachable');
    },
  }),
}));

import {
  estimateModelTokenReservation,
  reserveAiTokenBudget,
} from '../lib/rate-limit';

describe('AI spend reservations', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('AI_DAILY_TOKEN_BUDGET_PER_USER', '200000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accounts conservatively for large model inputs as well as output', () => {
    const compareReservation = estimateModelTokenReservation(600_000, 16_384);
    expect(compareReservation).toBeGreaterThan(200_000);
    expect(estimateModelTokenReservation(60_000, 4_096)).toBeGreaterThan(24_000);
  });

  it('does not truncate legitimate reservations to the historical 32k cap', async () => {
    const identity = { userId: `budget-test-${Date.now()}`, orgId: null };
    expect((await reserveAiTokenBudget(identity, 150_000)).allowed).toBe(true);
    const overBudget = await reserveAiTokenBudget(identity, 60_000);
    expect(overBudget).toMatchObject({ allowed: false, reason: 'budget' });
  });

  it('falls back to in-memory controls in production when no KV store is configured (Option A)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await reserveAiTokenBudget({ userId: `prod-user-${Date.now()}`, orgId: null }, 1_000);
      expect(result).toMatchObject({ allowed: true });
    } finally {
      warn.mockRestore();
    }
  });

  it('still fails closed in production when a configured KV store is broken', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.invalid');
    vi.stubEnv('KV_REST_API_TOKEN', 'broken-token');
    const result = await reserveAiTokenBudget({ userId: 'prod-user-strict', orgId: null }, 1_000);
    expect(result).toMatchObject({ allowed: false, reason: 'unavailable' });
  });

  it('reserves model spend only after each route has ruled out a cache hit and acquired capacity', () => {
    const routes = [
      'src/app/api/claude/route.ts',
      'src/app/api/stream/route.ts',
      'src/app/api/compare/route.ts',
      'src/app/api/letters/summary/route.ts',
    ];

    for (const route of routes) {
      const source = readFileSync(resolve(process.cwd(), route), 'utf8');
      const cacheCheck = route.includes('letters/summary')
        ? source.lastIndexOf('if (cached && isCommentLetterSummaryCacheCurrent')
        : source.indexOf('if (cachedResponse)');
      const capacity = source.indexOf('acquireAiConcurrency(', cacheCheck);
      const reservation = source.indexOf('reserveAiTokenBudget(', cacheCheck);
      expect(cacheCheck, `${route} must check its cache`).toBeGreaterThanOrEqual(0);
      expect(capacity, `${route} must acquire capacity after cache lookup`).toBeGreaterThan(cacheCheck);
      expect(reservation, `${route} must reserve model spend after cache lookup`).toBeGreaterThan(cacheCheck);
      expect(reservation, `${route} must not reserve spend before capacity is available`).toBeGreaterThan(capacity);
    }
  });

  it('keeps the multi-call summary capacity lease longer than its generation deadline', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/api/letters/summary/route.ts'),
      'utf8'
    );

    expect(source).toMatch(
      /acquireAiConcurrency\(\s*prepared\.access,\s*COMMENT_LETTER_SUMMARY_LOCK_TTL_SECONDS\s*\)/
    );
  });

  it('bounds every model attempt below its capacity lease and disables hidden retries', () => {
    const runtime = readFileSync(resolve(process.cwd(), 'src/lib/ai-runtime.ts'), 'utf8');

    expect(runtime).toContain('AI_MODEL_CALL_TIMEOUT_MS = 165_000');
    expect(runtime).toContain('maxRetries: 0');
    expect(runtime).toContain('timeout: AI_MODEL_CALL_TIMEOUT_MS');
  });

  it('rate-limits summary reads before querying the corpus', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/api/letters/summary/route.ts'),
      'utf8'
    );
    const getHandler = source.indexOf('export async function GET');
    const readLimit = source.indexOf('await checkResourceRateLimit(', getHandler);
    const databaseRead = source.indexOf('await loadLettersAndCache(', getHandler);

    expect(readLimit).toBeGreaterThan(getHandler);
    expect(databaseRead).toBeGreaterThan(readLimit);
  });

  it('serializes expensive facet fan-out before the first SEC candidate request', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/es-search/route.ts'), 'utf8');
    const capacity = source.indexOf('await acquireResourceConcurrency(');
    const candidateFetch = source.indexOf('await fetchEftsCandidates(candidateRequest)', capacity);

    expect(capacity).toBeGreaterThanOrEqual(0);
    expect(candidateFetch).toBeGreaterThan(capacity);
    expect(source).toContain('globalLimit: 1');
  });
});
