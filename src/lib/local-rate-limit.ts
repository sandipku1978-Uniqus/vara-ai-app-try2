/**
 * Per-instance request limiter for the PUBLIC routes (/api/health,
 * /api/version, /api/csp-report).
 *
 * The distributed limiter fails closed in production by design: when KV is
 * unreachable, every authenticated route answers 503 rather than run without
 * limits. That is the right posture for model spend and SEC egress and the
 * wrong one for the endpoints an uptime monitor and a release verifier use to
 * learn whether the platform is up — an Upstash incident must not make the
 * health check say "down" for a reason the health check itself cannot report
 * (audit 2026-09, "KV is a fail-closed single point of failure").
 *
 * Per instance means per serverless instance, so the bound is approximate
 * across instances. That is acceptable because these routes do no model,
 * database-write, or SEC work: the limit only protects log volume and the
 * short, cached schema read behind /api/version and /api/health.
 */

import { clientIpFrom } from './client-ip';

export interface LocalRateLimitOptions {
  operation: string;
  /** Requests per window per client address. */
  ipLimit: number;
  windowSeconds?: number;
}

export interface LocalRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: 'rate';
}

interface Window {
  count: number;
  resetAt: number;
}

const DEFAULT_WINDOW_SECONDS = 60;
const MAX_TRACKED_WINDOWS = 5_000;
const windows = new Map<string, Window>();

function prune(now: number): void {
  if (windows.size < MAX_TRACKED_WINDOWS) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // A flood of distinct addresses must not grow the map without bound: drop
  // the oldest entries once expiry alone did not bring it under the cap.
  if (windows.size >= MAX_TRACKED_WINDOWS) {
    const excess = windows.size - MAX_TRACKED_WINDOWS + 1;
    let dropped = 0;
    for (const key of windows.keys()) {
      windows.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

export function checkLocalRateLimit(request: Request, options: LocalRateLimitOptions): LocalRateLimitResult {
  const now = Date.now();
  const windowSeconds = options.windowSeconds && options.windowSeconds > 0
    ? options.windowSeconds
    : DEFAULT_WINDOW_SECONDS;
  const operation = options.operation.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const key = `${operation}:${clientIpFrom(request)}`;

  prune(now);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > options.ipLimit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      reason: 'rate',
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function localRateLimitResponse(result: LocalRateLimitResult): Response {
  return Response.json(
    { ok: false, error: 'Too many requests. Retry shortly.', errorClass: 'rate-limited' },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(Math.max(1, result.retryAfterSeconds)),
      },
    },
  );
}

/** Test-only: clear every tracked window. */
export function resetLocalRateLimitForTests(): void {
  windows.clear();
}
