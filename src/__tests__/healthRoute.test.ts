import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  provenance: vi.fn(),
  kvGet: vi.fn(),
  production: false,
}));

vi.mock('../lib/schema-provenance', () => ({
  readSchemaProvenanceWithinBudget: mocks.provenance,
}));

vi.mock('@vercel/kv', () => ({
  kv: { get: mocks.kvGet },
}));

vi.mock('../lib/clerk-config', () => ({
  isProductionDeployment: () => mocks.production,
}));

import { GET } from '../app/api/health/route';
import { resetLocalRateLimitForTests } from '../lib/local-rate-limit';

const LIVE_PROVENANCE = {
  schemaVersion: '025',
  schemaMigrationCount: 27,
  schemaChainChecksum: 'c'.repeat(64),
  schemaChecksumAlgorithm: 'sha256-v2',
};

const NULL_PROVENANCE = {
  schemaVersion: null,
  schemaMigrationCount: null,
  schemaChainChecksum: null,
  schemaChecksumAlgorithm: null,
};

function request(ip = '203.0.113.10'): Request {
  return new Request('https://example.test/api/health', { headers: { 'x-real-ip': ip } });
}

describe('GET /api/health', () => {
  beforeEach(() => {
    resetLocalRateLimitForTests();
    mocks.production = false;
    mocks.provenance.mockReset();
    mocks.provenance.mockResolvedValue(LIVE_PROVENANCE);
    mocks.kvGet.mockReset();
    mocks.kvGet.mockResolvedValue(null);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'candidate-sha');
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'deployment-id');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'must-never-be-returned');
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-never-be-returned-either');
    vi.stubEnv('URC_SUPABASE_SERVICE_KEY', 'must-never-be-returned-at-all');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('answers 200 with every dependency probe when the platform can serve requests', async () => {
    const response = await GET(request(), undefined);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=15, s-maxage=30, stale-while-revalidate=60');
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
    expect(body).toMatchObject({
      ok: true,
      status: 'ok',
      sha: 'candidate-sha',
      deploymentId: 'deployment-id',
      environment: 'preview',
      checks: {
        database: { ok: true, schemaVersion: '025' },
        kv: { configured: true, ok: true },
        ai: { configured: true },
      },
    });
    expect(typeof body.checks.database.latencyMs).toBe('number');
    expect(Date.parse(body.checkedAt)).not.toBeNaN();
    expect(Object.keys(body).sort()).toEqual(['checkedAt', 'checks', 'deploymentId', 'environment', 'ok', 'sha', 'status']);
    expect(Object.keys(body.checks).sort()).toEqual(['ai', 'database', 'kv']);
    expect(JSON.stringify(body)).not.toContain('must-never-be-returned');
    expect(mocks.kvGet).toHaveBeenCalledWith('urc:health:probe');
  });

  it('answers 503, uncached, when the restricted database read fails or exceeds its budget', async () => {
    mocks.provenance.mockResolvedValue(NULL_PROVENANCE);

    const response = await GET(request(), undefined);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      ok: false,
      status: 'degraded',
      checks: { database: { ok: false, schemaVersion: null }, kv: { ok: true } },
    });
    expect(body.checks.database.detail).toMatch(/budget/);
  });

  it('answers 503 when the configured KV store throws', async () => {
    mocks.kvGet.mockRejectedValue(new Error('ECONNRESET'));

    const response = await GET(request(), undefined);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.kv).toMatchObject({ configured: true, ok: false, detail: 'probe failed: Error' });
    expect(JSON.stringify(body)).not.toContain('ECONNRESET');
  });

  it('answers 503 when the KV probe exceeds its one-second budget', async () => {
    vi.useFakeTimers();
    mocks.kvGet.mockReturnValue(new Promise(() => {}));

    const pending = GET(request(), undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    const response = await pending;
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.kv).toMatchObject({ configured: true, ok: false, detail: 'probe exceeded its budget' });
  });

  it('treats a missing KV store as fine outside production and as degraded in production', async () => {
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');

    const local = await (await GET(request('203.0.113.11'), undefined)).json();
    expect(local.ok).toBe(true);
    expect(local.checks.kv).toMatchObject({ configured: false, ok: true });

    mocks.production = true;
    const response = await GET(request('203.0.113.12'), undefined);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.checks.kv).toMatchObject({ configured: false, ok: false });
    expect(body.checks.kv.detail).toMatch(/pacing/);
    expect(mocks.kvGet).not.toHaveBeenCalled();
  });

  it('rate-limits an address per instance without touching KV or the database', async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect((await GET(request('203.0.113.13'), undefined)).status).toBe(200);
    }
    const calls = mocks.provenance.mock.calls.length;

    const denied = await GET(request('203.0.113.13'), undefined);

    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).toBeTruthy();
    expect(mocks.provenance.mock.calls.length).toBe(calls);
  });
});
