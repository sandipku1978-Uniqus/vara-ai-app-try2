import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkLocalRateLimit,
  localRateLimitResponse,
  resetLocalRateLimitForTests,
} from '../lib/local-rate-limit';

/**
 * The public routes (/api/health, /api/version, /api/csp-report) are limited
 * per instance so a KV incident cannot make the health check itself
 * unavailable. The limiter must therefore need nothing but a clock.
 */

function request(ip: string): Request {
  return new Request('https://example.test/api/health', { headers: { 'x-real-ip': ip } });
}

describe('checkLocalRateLimit', () => {
  beforeEach(() => {
    resetLocalRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows ipLimit requests per window per address, then answers 429 with Retry-After', () => {
    const options = { operation: 'health', ipLimit: 3 };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(checkLocalRateLimit(request('203.0.113.1'), options)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    }

    const denied = checkLocalRateLimit(request('203.0.113.1'), options);
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 60, reason: 'rate' });

    const response = localRateLimitResponse(denied);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps addresses and operations separate', () => {
    const options = { operation: 'health', ipLimit: 1 };
    expect(checkLocalRateLimit(request('203.0.113.1'), options).allowed).toBe(true);
    expect(checkLocalRateLimit(request('203.0.113.1'), options).allowed).toBe(false);
    expect(checkLocalRateLimit(request('203.0.113.2'), options).allowed).toBe(true);
    expect(checkLocalRateLimit(request('203.0.113.1'), { operation: 'version', ipLimit: 1 }).allowed).toBe(true);
  });

  it('opens a fresh window when the previous one ends', () => {
    const options = { operation: 'health', ipLimit: 1, windowSeconds: 30 };
    expect(checkLocalRateLimit(request('203.0.113.1'), options).allowed).toBe(true);
    vi.advanceTimersByTime(29_000);
    expect(checkLocalRateLimit(request('203.0.113.1'), options)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
      reason: 'rate',
    });
    vi.advanceTimersByTime(1_001);
    expect(checkLocalRateLimit(request('203.0.113.1'), options).allowed).toBe(true);
  });

  it('does not depend on the KV-backed limiter module', async () => {
    // A static import of rate-limit.ts would pull @vercel/kv into the public
    // routes and reintroduce the dependency this limiter exists to avoid.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/lib/local-rate-limit.ts'), 'utf8');
    expect(source).not.toMatch(/from '\.\/rate-limit'/);
    expect(source).not.toMatch(/@vercel\/kv/);
  });
});
