import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASE_AUTH_PROBE_HTTP_ATTEMPTS } from '../../scripts/accuracy/probe-auth';

const kvState = vi.hoisted(() => ({
  broken: false,
  values: new Map<string, number>(),
  expiresAt: new Map<string, number>(),
  sortedSets: new Map<string, Map<string, number>>(),
}));

vi.mock('@vercel/kv', () => ({
  kv: {
    incr: async (key: string) => {
      if (kvState.broken) throw new Error('distributed store unreachable');
      if ((kvState.expiresAt.get(key) || Infinity) <= Date.now()) {
        kvState.values.delete(key);
        kvState.expiresAt.delete(key);
      }
      const value = (kvState.values.get(key) || 0) + 1;
      kvState.values.set(key, value);
      return value;
    },
    incrby: async (key: string, increment: number) => {
      if (kvState.broken) throw new Error('distributed store unreachable');
      if ((kvState.expiresAt.get(key) || Infinity) <= Date.now()) {
        kvState.values.delete(key);
        kvState.expiresAt.delete(key);
      }
      const value = (kvState.values.get(key) || 0) + increment;
      kvState.values.set(key, value);
      return value;
    },
    expire: async (key: string, ttlSeconds: number) => {
      if (kvState.broken) throw new Error('distributed store unreachable');
      kvState.expiresAt.set(key, Date.now() + ttlSeconds * 1_000);
      return 1;
    },
    zremrangebyscore: async (key: string, minimum: number, maximum: number) => {
      if (kvState.broken) throw new Error('distributed store unreachable');
      if ((kvState.expiresAt.get(key) || Infinity) <= Date.now()) {
        kvState.sortedSets.delete(key);
        kvState.expiresAt.delete(key);
      }
      const members = kvState.sortedSets.get(key);
      if (!members) return 0;
      let removed = 0;
      for (const [member, score] of members) {
        if (score >= minimum && score <= maximum) {
          members.delete(member);
          removed += 1;
        }
      }
      return removed;
    },
    zadd: async (key: string, entry: { score: number; member: string }) => {
      if (kvState.broken) throw new Error('distributed store unreachable');
      if ((kvState.expiresAt.get(key) || Infinity) <= Date.now()) {
        kvState.sortedSets.delete(key);
        kvState.expiresAt.delete(key);
      }
      const members = kvState.sortedSets.get(key) || new Map<string, number>();
      members.set(entry.member, entry.score);
      kvState.sortedSets.set(key, members);
      return 1;
    },
    zcard: async (key: string) => {
      if (kvState.broken) throw new Error('distributed store unreachable');
      if ((kvState.expiresAt.get(key) || Infinity) <= Date.now()) {
        kvState.sortedSets.delete(key);
        kvState.expiresAt.delete(key);
      }
      return kvState.sortedSets.get(key)?.size || 0;
    },
    zrem: async (key: string, member: string) => {
      if (kvState.broken) throw new Error('distributed store unreachable');
      return kvState.sortedSets.get(key)?.delete(member) ? 1 : 0;
    },
  },
}));

import {
  acquireAiConcurrency,
  checkResourceRateLimit,
  estimateModelTokenReservation,
  rateLimitResponse,
  RELEASE_GATE_PASSING_REQUEST_BOUND,
  RELEASE_GATE_RESOURCE_WINDOW_LIMIT,
  releaseAiConcurrency,
  reserveAiTokenBudget,
} from '../lib/rate-limit';

describe('AI spend reservations', () => {
  beforeEach(() => {
    kvState.broken = false;
    kvState.values.clear();
    kvState.expiresAt.clear();
    kvState.sortedSets.clear();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('AI_DAILY_TOKEN_BUDGET_PER_USER', '200000');
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('refunds a denied reservation instead of pinning the user for the day', async () => {
    const identity = { userId: `refund-test-${Date.now()}`, orgId: null };
    expect((await reserveAiTokenBudget(identity, 150_000)).allowed).toBe(true);
    // Denied — but the 60k attempt must not stay counted…
    expect((await reserveAiTokenBudget(identity, 60_000)).allowed).toBe(false);
    // …so a request that fits the remaining 50k headroom still succeeds.
    expect((await reserveAiTokenBudget(identity, 40_000)).allowed).toBe(true);
  });

  it('enforces the deployment-wide daily ceiling on top of per-user budgets', async () => {
    vi.stubEnv('AI_DAILY_TOKEN_BUDGET_GLOBAL', '1');
    const identity = { userId: `global-test-${Date.now()}`, orgId: null };
    // Well under the per-user budget, but the aggregate ceiling binds.
    const result = await reserveAiTokenBudget(identity, 10_000);
    expect(result).toMatchObject({ allowed: false, reason: 'budget' });
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
    kvState.broken = true;
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

  it('does not let a short distributed acquisition truncate a longer live lease', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example');
    vi.stubEnv('KV_REST_API_TOKEN', 'concurrency-test-token');
    vi.stubEnv('AI_MAX_CONCURRENT_PER_USER', '1');
    const identity = { userId: 'mixed-lease-user', orgId: null };

    const longLease = await acquireAiConcurrency(identity, 10 * 60);
    expect(longLease.allowed).toBe(true);

    vi.advanceTimersByTime(60 * 1_000);
    const deniedShortLease = await acquireAiConcurrency(identity, 3 * 60);
    expect(deniedShortLease).toMatchObject({ allowed: false, reason: 'concurrency' });

    // The denied short acquisition must not expire the ZSET while the original
    // ten-minute member is still live.
    vi.advanceTimersByTime(4 * 60 * 1_000);
    const stillBlocked = await acquireAiConcurrency(identity, 30);
    expect(stillBlocked).toMatchObject({ allowed: false, reason: 'concurrency' });

    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
    const afterLongLease = await acquireAiConcurrency(identity, 30);
    expect(afterLongLease.allowed).toBe(true);
    await releaseAiConcurrency(afterLongLease.lease);
    await releaseAiConcurrency(longLease.lease);
  });

  it('uses generic wording for resource concurrency responses', async () => {
    const response = rateLimitResponse({
      allowed: false,
      retryAfterSeconds: 5,
      reason: 'concurrency',
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(429);
    expect(body.error).toBe('Too many requests are already in progress.');
    expect(body.error).not.toMatch(/AI/i);
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

  describe('staged-production release-candidate resource limits', () => {
    const host = 'candidate-rate-test.vercel.app';

    function request(path = '/api/es-search', ip = '198.51.100.20', method = 'GET') {
      return new Request(`https://${host}${path}`, { method, headers: { 'x-real-ip': ip } });
    }

    function configureReleaseCandidate() {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('VERCEL_ENV', 'production');
      vi.stubEnv('VERCEL_TARGET_ENV', 'production');
      vi.stubEnv('VERCEL_URL', host);
      vi.stubEnv('URC_RELEASE_GATE_NOT_AFTER', new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString());
      vi.stubEnv('KV_REST_API_URL', 'https://kv.example');
      vi.stubEnv('KV_REST_API_TOKEN', 'release-test-token');
    }

    it('allows more than the ordinary 90 requests while retaining a finite ceiling', async () => {
      configureReleaseCandidate();
      const identity = { userId: `release-gate-${Date.now()}`, orgId: null, releaseGate: true, releaseGateHost: host };
      for (let index = 0; index < 100; index += 1) {
        const result = await checkResourceRateLimit(request(), identity, {
          operation: 'enriched-search',
          userLimit: 90,
          ipLimit: 120,
        });
        expect(result.allowed, `release request ${index + 1}`).toBe(true);
      }
      const passingBound = Object.values(RELEASE_GATE_PASSING_REQUEST_BOUND)
        .reduce((total, value) => total + value, 0);
      const semanticGateSource = readFileSync(
        resolve(process.cwd(), 'scripts/accuracy/gate.ts'),
        'utf8',
      );
      const semanticMaximum = semanticGateSource
        .match(/export const MAX_SEMANTIC_CANDIDATE_REQUESTS = ([\d_]+);/)?.[1]
        .replace(/_/g, '');
      expect(RELEASE_GATE_PASSING_REQUEST_BOUND.e2e).toBe(7_120);
      expect(RELEASE_GATE_PASSING_REQUEST_BOUND.semantic).toBe(449);
      expect(RELEASE_GATE_PASSING_REQUEST_BOUND.credentialProbe).toBe(5);
      expect(RELEASE_GATE_PASSING_REQUEST_BOUND.credentialProbe).toBe(RELEASE_AUTH_PROBE_HTTP_ATTEMPTS);
      expect(Number(semanticMaximum)).toBe(RELEASE_GATE_PASSING_REQUEST_BOUND.semantic);
      expect(passingBound).toBe(22_574);
      expect(RELEASE_GATE_RESOURCE_WINDOW_LIMIT).toBe(25_000);
      expect(RELEASE_GATE_RESOURCE_WINDOW_LIMIT).toBeGreaterThanOrEqual(Math.ceil(passingBound * 1.1));
    });

    it('enforces one shared 25k identity ceiling across operations and five-minute rollover', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
      configureReleaseCandidate();
      const identity = {
        userId: `release-gate-aggregate-${Date.now()}`,
        orgId: null,
        releaseGate: true,
        releaseGateHost: host,
      };
      const operations = [
        { request: request('/api/es-search', '198.51.100.25'), operation: 'enriched-search' },
        { request: request('/api/letters', '198.51.100.25'), operation: 'letters' },
        { request: request('/api/enrich', '198.51.100.25'), operation: 'enrich' },
        { request: request('/api/enrich', '198.51.100.25', 'POST'), operation: 'filing-auditor-enrich' },
        { request: request('/api/filing-text', '198.51.100.25'), operation: 'filing-text' },
        { request: request('/api/boolean-validate', '198.51.100.25', 'POST'), operation: 'boolean-validate' },
        { request: request('/api/sec-efts', '198.51.100.25'), operation: 'sec-efts' },
      ];

      let boundary = { allowed: false };
      for (let index = 0; index < RELEASE_GATE_RESOURCE_WINDOW_LIMIT; index += 1) {
        if (index === Math.floor(RELEASE_GATE_RESOURCE_WINDOW_LIMIT / 2)) {
          vi.advanceTimersByTime(6 * 60 * 1_000);
        }
        const selected = operations[index % operations.length];
        boundary = await checkResourceRateLimit(selected.request, identity, {
          operation: selected.operation,
          userLimit: 90,
          ipLimit: 120,
        });
      }
      expect(boundary.allowed).toBe(true);

      const rejected = await checkResourceRateLimit(operations[1].request, identity, {
        operation: operations[1].operation,
        userLimit: 90,
        ipLimit: 120,
      });
      expect(rejected).toMatchObject({ allowed: false, reason: 'rate' });
    }, 30_000);

    it('fails closed when distributed KV cannot enforce the candidate-lifetime quota', async () => {
      configureReleaseCandidate();
      vi.stubEnv('KV_REST_API_URL', '');
      vi.stubEnv('KV_REST_API_TOKEN', '');
      const result = await checkResourceRateLimit(
        request('/api/es-search', '198.51.100.26'),
        { userId: 'release-gate-no-kv', orgId: null, releaseGate: true, releaseGateHost: host },
        { operation: 'enriched-search', userLimit: 90, ipLimit: 120 },
      );
      expect(result).toMatchObject({ allowed: false, reason: 'unavailable' });
    });

    it('fails closed when configured distributed KV breaks during the candidate lifetime', async () => {
      configureReleaseCandidate();
      kvState.broken = true;
      const result = await checkResourceRateLimit(
        request('/api/es-search', '198.51.100.27'),
        { userId: 'release-gate-broken-kv', orgId: null, releaseGate: true, releaseGateHost: host },
        { operation: 'enriched-search', userLimit: 90, ipLimit: 120 },
      );
      expect(result).toMatchObject({ allowed: false, reason: 'unavailable' });
    });

    it('does not relax ordinary users, previews, production aliases, or a non-allowlisted path', async () => {
      configureReleaseCandidate();

      const ordinary = { userId: `ordinary-${Date.now()}`, orgId: null };
      let ordinaryResult = { allowed: true };
      for (let index = 0; index < 91; index += 1) {
        ordinaryResult = await checkResourceRateLimit(request('/api/es-search', '198.51.100.21'), ordinary, {
          operation: 'enriched-search', userLimit: 90, ipLimit: 120,
        });
      }
      expect(ordinaryResult.allowed).toBe(false);

      const wrongPath = { userId: `wrong-path-${Date.now()}`, orgId: null, releaseGate: true, releaseGateHost: host };
      let wrongPathResult = { allowed: true };
      for (let index = 0; index < 91; index += 1) {
        wrongPathResult = await checkResourceRateLimit(request('/api/claude', '198.51.100.22'), wrongPath, {
          operation: 'enriched-search', userLimit: 90, ipLimit: 120,
        });
      }
      expect(wrongPathResult.allowed).toBe(false);

      const wrongMethodIdentity = {
        userId: `wrong-method-${Date.now()}`,
        orgId: null,
        releaseGate: true,
        releaseGateHost: host,
      };
      let wrongMethodResult = { allowed: true };
      for (let index = 0; index < 91; index += 1) {
        wrongMethodResult = await checkResourceRateLimit(
          request('/api/enrich', '198.51.100.29', 'POST'),
          wrongMethodIdentity,
          { operation: 'enrich', userLimit: 90, ipLimit: 120 },
        );
      }
      expect(wrongMethodResult.allowed).toBe(false);

      vi.stubEnv('VERCEL_ENV', 'preview');
      vi.stubEnv('VERCEL_TARGET_ENV', 'preview');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const preview = { userId: `preview-gate-${Date.now()}`, orgId: null, releaseGate: true, releaseGateHost: host };
      let previewResult = { allowed: true };
      try {
        for (let index = 0; index < 91; index += 1) {
          previewResult = await checkResourceRateLimit(request('/api/es-search', '198.51.100.23'), preview, {
            operation: 'enriched-search', userLimit: 90, ipLimit: 120,
          });
        }
      } finally {
        warn.mockRestore();
      }
      expect(previewResult.allowed).toBe(false);

      configureReleaseCandidate();
      const aliasIdentity = { userId: `alias-gate-${Date.now()}`, orgId: null, releaseGate: true, releaseGateHost: host };
      let aliasResult = { allowed: true };
      const aliasRequest = () => new Request('https://production.example.com/api/es-search', {
        headers: { 'x-real-ip': '198.51.100.24' },
      });
      for (let index = 0; index < 91; index += 1) {
        aliasResult = await checkResourceRateLimit(aliasRequest(), aliasIdentity, {
          operation: 'enriched-search', userLimit: 90, ipLimit: 120,
        });
      }
      expect(aliasResult.allowed).toBe(false);

      const alternateVercelHost = 'production-alias-rate-test.vercel.app';
      const alternateIdentity = {
        userId: `alternate-alias-gate-${Date.now()}`,
        orgId: null,
        releaseGate: true,
        releaseGateHost: alternateVercelHost,
      };
      let alternateResult = { allowed: true };
      const alternateRequest = new Request(`https://${alternateVercelHost}/api/es-search`, {
        headers: { 'x-real-ip': '198.51.100.28' },
      });
      for (let index = 0; index < 91; index += 1) {
        alternateResult = await checkResourceRateLimit(alternateRequest, alternateIdentity, {
          operation: 'enriched-search', userLimit: 90, ipLimit: 120,
        });
      }
      expect(alternateResult.allowed).toBe(false);
    });
  });
});
