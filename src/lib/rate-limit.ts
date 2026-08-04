import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { isLocalE2eBypass, isProductionDeployment } from './clerk-config';
import {
  configuredReleaseGateNotAfter,
  isReleaseGateWindowActive,
} from './release-gate-window';

const WINDOW_SECONDS = 5 * 60;
const DEFAULT_DAILY_TOKEN_BUDGET = 250_000;
const MAX_LOCAL_WINDOWS = 10_000;
const CONCURRENCY_LEASE_SECONDS = 180;
const MAX_CONCURRENCY_LEASE_SECONDS = 15 * 60;
const MAX_TOKEN_RESERVATION = 500_000;

interface LocalCounter {
  count: number;
  expiresAt: number;
}

export interface RateLimitIdentity {
  userId: string;
  orgId: string | null;
  releaseGate?: boolean;
  releaseGateHost?: string;
}

/**
 * Passing-run upper bound for one staged candidate's complete lifetime:
 * 15,000 ticker issuers + 7,120 bounded e2e requests + 449 semantic requests +
 * five auth/scope probes = 22,574. The 25k ceiling leaves ~11% scheduling/headroom.
 * The e2e and semantic figures are retry-inclusive hard ceilings; remaining
 * headroom keeps this finite bridge resilient to small evaluator changes.
 */
export const RELEASE_GATE_PASSING_REQUEST_BOUND = {
  ticker: 15_000,
  e2e: 7_120,
  semantic: 449,
  credentialProbe: 5,
} as const;
export const RELEASE_GATE_RESOURCE_WINDOW_LIMIT = 25_000;
const RELEASE_GATE_RESOURCE_OPERATIONS = new Map([
  ['GET /api/es-search', 'enriched-search'],
  ['GET /api/letters', 'letters'],
  ['GET /api/enrich', 'enrich'],
  ['POST /api/enrich', 'filing-auditor-enrich'],
  ['GET /api/filing-text', 'filing-text'],
  ['POST /api/boolean-validate', 'boolean-validate'],
  ['GET /api/sec-efts', 'sec-efts'],
]);

export interface RateLimitOptions {
  operation: string;
}

export interface ResourceRateLimitOptions {
  operation: string;
  userLimit?: number;
  orgLimit?: number;
  ipLimit?: number;
}

export interface ResourceConcurrencyOptions {
  operation: string;
  userLimit?: number;
  orgLimit?: number;
  ipLimit?: number;
  globalLimit?: number;
  leaseSeconds?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: 'rate' | 'budget' | 'concurrency' | 'unavailable';
}

export interface AiConcurrencyLease {
  token: string;
  keys: string[];
  local: boolean;
  released: boolean;
}

export interface AiConcurrencyResult extends RateLimitResult {
  lease?: AiConcurrencyLease;
}

const localCounters = new Map<string, LocalCounter>();
const localConcurrency = new Map<string, Map<string, number>>();

function boundedPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function dailyTokenBudget(): number {
  return boundedPositiveInteger(process.env.AI_DAILY_TOKEN_BUDGET_PER_USER, DEFAULT_DAILY_TOKEN_BUDGET);
}

/**
 * Deployment-wide daily AI ceiling. Per-user budgets scale linearly with
 * headcount, so a wider rollout needs one aggregate number: default is
 * 8× the per-user budget (2M tokens at defaults), tunable via
 * AI_DAILY_TOKEN_BUDGET_GLOBAL.
 */
function globalDailyTokenBudget(): number {
  return boundedPositiveInteger(process.env.AI_DAILY_TOKEN_BUDGET_GLOBAL, dailyTokenBudget() * 8);
}

function hasDistributedStore(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

let warnedLocalControlsInProduction = false;

/**
 * Option A (2026-07-20): with no KV store provisioned, production falls back
 * to per-instance in-memory limits — the pre-rollout posture — instead of
 * failing closed. Configuring KV_REST_API_URL/KV_REST_API_TOKEN activates
 * distributed limits, and a configured-but-broken store still fails closed.
 */
function noteLocalControlsFallback(): void {
  if (!warnedLocalControlsInProduction && isProductionDeployment()) {
    warnedLocalControlsInProduction = true;
    console.warn('[rate-limit] KV_REST_API_URL/KV_REST_API_TOKEN not set — using per-instance in-memory request controls. Provision Upstash/Vercel KV to activate distributed limits.');
  }
}

function opaqueKeyPart(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url').slice(0, 24);
}

export function clientIpFrom(request: Request): string {
  // Vercel overwrites these headers at the trusted edge. Do not trust a raw
  // caller-supplied x-forwarded-for header in production.
  const trusted = request.headers.get('x-real-ip')
    || request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (trusted) return trusted;

  if (!isProductionDeployment()) {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  }
  return 'unknown';
}

function pruneLocalCounters(now: number): void {
  if (localCounters.size < MAX_LOCAL_WINDOWS) return;
  for (const [key, value] of localCounters) {
    if (value.expiresAt <= now) localCounters.delete(key);
  }
}

function incrementLocal(key: string, increment: number, ttlSeconds: number): number {
  const now = Date.now();
  pruneLocalCounters(now);
  const current = localCounters.get(key);
  if (!current || current.expiresAt <= now) {
    localCounters.set(key, { count: increment, expiresAt: now + ttlSeconds * 1000 });
    return increment;
  }
  current.count += increment;
  return current.count;
}

async function incrementDistributed(key: string, increment: number, ttlSeconds: number): Promise<number> {
  const count = increment === 1 ? await kv.incr(key) : await kv.incrby(key, increment);
  if (count === increment) await kv.expire(key, ttlSeconds);
  return count;
}

async function incrementCounter(key: string, increment: number, ttlSeconds: number): Promise<number> {
  if (isLocalE2eBypass()) return 0;
  if (hasDistributedStore()) return incrementDistributed(key, increment, ttlSeconds);
  noteLocalControlsFallback();
  return incrementLocal(key, increment, ttlSeconds);
}

function secondsUntilWindowReset(windowSeconds: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.max(windowSeconds - (nowSeconds % windowSeconds), 1);
}

export async function checkAiRateLimit(
  request: Request,
  identity: RateLimitIdentity,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const operation = options.operation.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const ip = clientIpFrom(request);
  const scopes: Array<{ key: string; limit: number }> = [
    { key: `user:${opaqueKeyPart(identity.userId)}:all:${bucket}`, limit: 30 },
    { key: `user:${opaqueKeyPart(identity.userId)}:${operation}:${bucket}`, limit: 20 },
    { key: `ip:${opaqueKeyPart(ip)}:all:${bucket}`, limit: 60 },
  ];
  if (identity.orgId) {
    scopes.push({ key: `org:${opaqueKeyPart(identity.orgId)}:all:${bucket}`, limit: 150 });
  }

  try {
    for (const scope of scopes) {
      const count = await incrementCounter(`ai-rate:${scope.key}`, 1, WINDOW_SECONDS + 5);
      if (count > scope.limit) {
        return { allowed: false, retryAfterSeconds: secondsUntilWindowReset(WINDOW_SECONDS), reason: 'rate' };
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  } catch (error) {
    console.error('AI rate limiter unavailable:', error);
    if (isProductionDeployment()) {
      return { allowed: false, retryAfterSeconds: 30, reason: 'unavailable' };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Conservative reservation for model input plus requested output. Three
 * characters per input token intentionally errs above the common four-char
 * approximation, and per-call overhead covers message framing/tokenization.
 */
export function estimateModelTokenReservation(
  inputCharacters: number,
  maxOutputTokens: number,
  callCount = 1
): number {
  const safeCharacters = Number.isFinite(inputCharacters) ? Math.max(0, Math.ceil(inputCharacters)) : 0;
  const safeOutput = Number.isFinite(maxOutputTokens) ? Math.max(0, Math.ceil(maxOutputTokens)) : 0;
  const safeCalls = Number.isFinite(callCount) ? Math.max(1, Math.ceil(callCount)) : 1;
  return Math.min(
    Math.ceil(safeCharacters / 3) + safeOutput + safeCalls * 512,
    MAX_TOKEN_RESERVATION
  );
}

/** Reserve spend only after a cache miss, immediately before model work. */
export async function reserveAiTokenBudget(
  identity: RateLimitIdentity,
  estimatedTokens: number
): Promise<RateLimitResult> {
  const tokenCost = Math.min(Math.max(Math.ceil(estimatedTokens || 0), 0), MAX_TOKEN_RESERVATION);
  if (tokenCost === 0) return { allowed: true, retryAfterSeconds: 0 };

  try {
    const day = new Date().toISOString().slice(0, 10);
    const budgetKey = `ai-budget:${opaqueKeyPart(identity.userId)}:${day}`;
    const globalKey = `ai-budget:global:${day}`;
    const reserved = await incrementCounter(budgetKey, tokenCost, 26 * 60 * 60);
    if (reserved > dailyTokenBudget()) {
      // A DENIED reservation must not stay counted: without the refund, a
      // user who tripped the cap once was pinned for the whole day even
      // though no model call was made.
      await incrementCounter(budgetKey, -tokenCost, 26 * 60 * 60).catch(() => {});
      return { allowed: false, retryAfterSeconds: secondsUntilWindowReset(24 * 60 * 60), reason: 'budget' };
    }
    // Deployment-wide daily ceiling: per-user budgets scale linearly with
    // headcount (20 users × 250k = 5M tokens/day), so a wider rollout needs
    // one aggregate number a finance owner can set.
    const reservedGlobal = await incrementCounter(globalKey, tokenCost, 26 * 60 * 60);
    if (reservedGlobal > globalDailyTokenBudget()) {
      await incrementCounter(globalKey, -tokenCost, 26 * 60 * 60).catch(() => {});
      await incrementCounter(budgetKey, -tokenCost, 26 * 60 * 60).catch(() => {});
      return { allowed: false, retryAfterSeconds: secondsUntilWindowReset(24 * 60 * 60), reason: 'budget' };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (error) {
    console.error('AI budget limiter unavailable:', error);
    if (isProductionDeployment()) {
      return { allowed: false, retryAfterSeconds: 30, reason: 'unavailable' };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export async function checkResourceRateLimit(
  request: Request,
  identity: RateLimitIdentity,
  options: ResourceRateLimitOptions
): Promise<RateLimitResult> {
  const operation = options.operation.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const nowEpochSeconds = Math.floor(Date.now() / 1_000);
  const ip = clientIpFrom(request);
  let releaseGatePolicy = false;
  let releaseGateNotAfter: number | null = null;
  if (
    identity.releaseGate === true &&
    process.env.VERCEL === '1' &&
    process.env.VERCEL_ENV === 'production' &&
    process.env.VERCEL_TARGET_ENV === 'production'
  ) {
    try {
      const url = new URL(request.url);
      const canonicalHost = (identity.releaseGateHost || '').toLowerCase();
      const deploymentHost = (process.env.VERCEL_URL || '').trim().toLowerCase();
      releaseGateNotAfter = configuredReleaseGateNotAfter();
      releaseGatePolicy = Boolean(
        isReleaseGateWindowActive(nowEpochSeconds) &&
        /^[a-z0-9-]+\.vercel\.app$/.test(canonicalHost) &&
        canonicalHost === deploymentHost &&
        url.hostname.toLowerCase() === canonicalHost &&
        RELEASE_GATE_RESOURCE_OPERATIONS.get(`${request.method.toUpperCase()} ${url.pathname}`) === operation,
      );
    } catch {
      releaseGatePolicy = false;
    }
  }
  // The signed release identity is limited to seven read-only method/path
  // pairs and one exact staged production deployment. Give the sweep a bounded counter ceiling;
  // this is not an unlimited bypass and does not alter concurrency or EDGAR
  // upstream pacing controls.
  const userLimit = releaseGatePolicy
    ? RELEASE_GATE_RESOURCE_WINDOW_LIMIT
    : options.userLimit || 120;
  const ipLimit = releaseGatePolicy
    ? RELEASE_GATE_RESOURCE_WINDOW_LIMIT
    : options.ipLimit || 180;
  if (releaseGatePolicy && !hasDistributedStore()) {
    console.error('[rate-limit] distributed KV is required for the staged-release lifetime quota');
    return { allowed: false, retryAfterSeconds: 30, reason: 'unavailable' };
  }

  const scopes: Array<{ key: string; limit: number; ttlSeconds?: number }> = [
    { key: `user:${opaqueKeyPart(identity.userId)}:${operation}:${bucket}`, limit: userLimit },
    { key: `ip:${opaqueKeyPart(ip)}:${operation}:${bucket}`, limit: ipLimit },
  ];
  if (releaseGatePolicy && releaseGateNotAfter) {
    // The documented bound is for the whole candidate sweep, not separately
    // for search, letters, and enrichment. This deployment-scoped key has no
    // five-minute bucket and lives through the candidate's absolute not-after,
    // so time or serverless-instance rollover cannot reset the 25k ceiling.
    scopes.unshift({
      key: `release-gate:${opaqueKeyPart(identity.userId)}:lifetime`,
      limit: RELEASE_GATE_RESOURCE_WINDOW_LIMIT,
      ttlSeconds: Math.max(releaseGateNotAfter - nowEpochSeconds + 5, 5),
    });
  }
  if (identity.orgId) {
    scopes.push({ key: `org:${opaqueKeyPart(identity.orgId)}:${operation}:${bucket}`, limit: options.orgLimit || 600 });
  }

  try {
    for (const scope of scopes) {
      const count = await incrementCounter(
        `resource-rate:${scope.key}`,
        1,
        scope.ttlSeconds || WINDOW_SECONDS + 5,
      );
      if (count > scope.limit) {
        return { allowed: false, retryAfterSeconds: secondsUntilWindowReset(WINDOW_SECONDS), reason: 'rate' };
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (error) {
    console.error('Resource rate limiter unavailable:', error);
    if (isProductionDeployment()) {
      return { allowed: false, retryAfterSeconds: 30, reason: 'unavailable' };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

function normalizedLeaseSeconds(requestedSeconds: number): number {
  if (!Number.isFinite(requestedSeconds)) return CONCURRENCY_LEASE_SECONDS;
  return Math.min(Math.max(Math.ceil(requestedSeconds), 30), MAX_CONCURRENCY_LEASE_SECONDS);
}

function acquireLocalConcurrency(key: string, token: string, limit: number, leaseSeconds: number): boolean {
  const now = Date.now();
  const leases = localConcurrency.get(key) || new Map<string, number>();
  for (const [member, expiresAt] of leases) {
    if (expiresAt <= now) leases.delete(member);
  }
  if (leases.size >= limit) {
    localConcurrency.set(key, leases);
    return false;
  }
  leases.set(token, now + leaseSeconds * 1000);
  localConcurrency.set(key, leases);
  return true;
}

async function acquireDistributedConcurrency(
  key: string,
  token: string,
  limit: number,
  leaseSeconds: number
): Promise<boolean> {
  const now = Date.now();
  await kv.zremrangebyscore(key, 0, now);
  await kv.zadd(key, { score: now + leaseSeconds * 1000, member: token });
  // Members carry their individual expiries in their scores. Keep the ZSET
  // itself alive for the longest lease we permit so a later short acquisition
  // cannot truncate an earlier long lease by shortening the key TTL.
  await kv.expire(key, MAX_CONCURRENCY_LEASE_SECONDS + 5);
  const count = await kv.zcard(key);
  if (count <= limit) return true;
  await kv.zrem(key, token);
  return false;
}

export async function acquireAiConcurrency(
  identity: RateLimitIdentity,
  requestedLeaseSeconds = CONCURRENCY_LEASE_SECONDS
): Promise<AiConcurrencyResult> {
  if (isLocalE2eBypass()) return { allowed: true, retryAfterSeconds: 0 };
  const token = crypto.randomUUID();
  const leaseSeconds = normalizedLeaseSeconds(requestedLeaseSeconds);
  const local = !hasDistributedStore();
  if (local) noteLocalControlsFallback();

  const scopes: Array<{ key: string; limit: number }> = [
    {
      key: `ai-concurrency:user:${opaqueKeyPart(identity.userId)}`,
      limit: boundedPositiveInteger(process.env.AI_MAX_CONCURRENT_PER_USER, 2),
    },
  ];
  if (identity.orgId) {
    scopes.push({
      key: `ai-concurrency:org:${opaqueKeyPart(identity.orgId)}`,
      limit: boundedPositiveInteger(process.env.AI_MAX_CONCURRENT_PER_ORG, 10),
    });
  }

  const lease: AiConcurrencyLease = { token, keys: [], local, released: false };
  try {
    for (const scope of scopes) {
      const acquired = local
        ? acquireLocalConcurrency(scope.key, token, scope.limit, leaseSeconds)
        : await acquireDistributedConcurrency(scope.key, token, scope.limit, leaseSeconds);
      if (!acquired) {
        await releaseAiConcurrency(lease);
        return { allowed: false, retryAfterSeconds: 5, reason: 'concurrency' };
      }
      lease.keys.push(scope.key);
    }
    return { allowed: true, retryAfterSeconds: 0, lease };
  } catch (error) {
    console.error('AI concurrency limiter unavailable:', error);
    await releaseAiConcurrency(lease);
    if (isProductionDeployment()) {
      return { allowed: false, retryAfterSeconds: 30, reason: 'unavailable' };
    }
    return { allowed: true, retryAfterSeconds: 0, lease };
  }
}

/** Bound expensive non-AI fan-out work independently from model capacity. */
export async function acquireResourceConcurrency(
  request: Request,
  identity: RateLimitIdentity,
  options: ResourceConcurrencyOptions
): Promise<AiConcurrencyResult> {
  if (isLocalE2eBypass()) return { allowed: true, retryAfterSeconds: 0 };
  const token = crypto.randomUUID();
  const local = !hasDistributedStore();
  if (local) noteLocalControlsFallback();

  const operation = options.operation.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const leaseSeconds = normalizedLeaseSeconds(options.leaseSeconds ?? 60);
  const limit = (value: number | undefined, fallback: number) => (
    Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
  );
  const scopes: Array<{ key: string; limit: number }> = [
    {
      key: `resource-concurrency:user:${opaqueKeyPart(identity.userId)}:${operation}`,
      limit: limit(options.userLimit, 2),
    },
    {
      key: `resource-concurrency:ip:${opaqueKeyPart(clientIpFrom(request))}:${operation}`,
      limit: limit(options.ipLimit, 4),
    },
  ];
  if (identity.orgId) {
    scopes.push({
      key: `resource-concurrency:org:${opaqueKeyPart(identity.orgId)}:${operation}`,
      limit: limit(options.orgLimit, 10),
    });
  }
  if (options.globalLimit) {
    scopes.push({
      key: `resource-concurrency:global:${operation}`,
      limit: limit(options.globalLimit, 2),
    });
  }

  const lease: AiConcurrencyLease = { token, keys: [], local, released: false };
  try {
    for (const scope of scopes) {
      const acquired = local
        ? acquireLocalConcurrency(scope.key, token, scope.limit, leaseSeconds)
        : await acquireDistributedConcurrency(scope.key, token, scope.limit, leaseSeconds);
      if (!acquired) {
        await releaseAiConcurrency(lease);
        return { allowed: false, retryAfterSeconds: 5, reason: 'concurrency' };
      }
      lease.keys.push(scope.key);
    }
    return { allowed: true, retryAfterSeconds: 0, lease };
  } catch (error) {
    console.error('Resource concurrency limiter unavailable:', error);
    await releaseAiConcurrency(lease);
    if (isProductionDeployment()) {
      return { allowed: false, retryAfterSeconds: 30, reason: 'unavailable' };
    }
    return { allowed: true, retryAfterSeconds: 0, lease };
  }
}

export async function releaseAiConcurrency(lease: AiConcurrencyLease | undefined): Promise<void> {
  if (!lease || lease.released) return;
  lease.released = true;
  try {
    for (const key of lease.keys) {
      if (lease.local) {
        const leases = localConcurrency.get(key);
        leases?.delete(lease.token);
        if (leases?.size === 0) localConcurrency.delete(key);
      } else {
        await kv.zrem(key, lease.token);
      }
    }
  } catch (error) {
    // TTL expiry is the final safety net if release fails.
    console.error('AI concurrency lease cleanup failed:', error);
  }
}

export function rateLimitResponse(result: RateLimitResult): Response {
  const unavailable = result.reason === 'unavailable';
  const budget = result.reason === 'budget';
  const concurrency = result.reason === 'concurrency';
  const status = unavailable ? 503 : 429;
  const error = unavailable
    ? 'Request controls are temporarily unavailable.'
    : budget
      ? 'Daily AI usage budget reached.'
      : concurrency
        ? 'Too many requests are already in progress.'
      : 'Rate limit exceeded — try again shortly.';

  return Response.json({ error }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': String(Math.max(result.retryAfterSeconds, 1)),
    },
  });
}
