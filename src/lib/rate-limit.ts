/**
 * Per-IP sliding-window rate limiter for the Claude-backed routes, which are
 * currently reachable without auth — anyone who finds the URL can burn
 * Anthropic tokens. In-memory per serverless instance: not airtight across
 * lambdas, but it stops sustained abuse from a single source, which is the
 * realistic attack. Upgrade path: Upstash Redis when auth tiers land.
 */

interface Window {
  timestamps: number[];
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20; // per IP per 5 minutes across AI endpoints

const windows = new Map<string, Window>();

function prune(now: number): void {
  // Bound memory: drop empty/expired windows opportunistically
  if (windows.size < 5000) return;
  for (const [key, value] of windows) {
    if (value.timestamps.length === 0 || now - value.timestamps[value.timestamps.length - 1] > WINDOW_MS) {
      windows.delete(key);
    }
  }
}

export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export function checkAiRateLimit(request: Request): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  prune(now);
  const key = clientIpFrom(request);
  const window = windows.get(key) ?? { timestamps: [] };
  window.timestamps = window.timestamps.filter(t => now - t < WINDOW_MS);

  if (window.timestamps.length >= MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((window.timestamps[0] + WINDOW_MS - now) / 1000);
    windows.set(key, window);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  window.timestamps.push(now);
  windows.set(key, window);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded — try again shortly.' }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSeconds) },
    }
  );
}
