import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseOriginFingerprint } from '../lib/database-origin';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  db: true,
  checkRate: vi.fn(),
  rateResponse: vi.fn(),
}));

vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => (mocks.db ? { rpc: mocks.rpc } : null),
}));

// Per-instance limiter on purpose: the KV-backed limiter fails closed, and a
// release verifier must still read provenance during a KV incident.
vi.mock('../lib/local-rate-limit', () => ({
  checkLocalRateLimit: mocks.checkRate,
  localRateLimitResponse: mocks.rateResponse,
}));

import {
  effectiveFilingSearchBackend,
  GET,
  resetVersionProvenanceStateForTests,
} from '../app/api/version/route';

const request = (ip = '203.0.113.10') => new Request('https://example.test/api/version', {
  headers: { 'x-real-ip': ip },
});

describe('GET /api/version', () => {
  beforeEach(() => {
    mocks.db = true;
    mocks.rpc.mockReset();
    mocks.checkRate.mockReset();
    mocks.checkRate.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.rateResponse.mockReset();
    mocks.rateResponse.mockReturnValue(new Response(null, {
      status: 429,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
    }));
    resetVersionProvenanceStateForTests();
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'candidate-sha');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'deployment-id');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NEXT_PUBLIC_USE_ENRICHED_SEARCH', 'true');
    vi.stubEnv('URC_RELEASE_GATE_NOT_AFTER', '2026-08-04T16:00:00.000Z');
    vi.stubEnv('URC_SUPABASE_URL', 'https://example.supabase.co/');
    vi.stubEnv('URC_SUPABASE_SERVICE_KEY', 'must-never-be-returned');
    vi.stubEnv('CLERK_SECRET_KEY', 'must-never-be-returned-either');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('lets an anonymous release verifier read only nonsecret provenance', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        schemaVersion: '021',
        schemaMigrationCount: 23,
        schemaChainChecksum: 'a'.repeat(64),
        schemaChecksumAlgorithm: 'sha256-v2',
      },
      error: null,
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body).toMatchObject({
      ok: true,
      sha: 'candidate-sha',
      ref: 'main',
      deploymentId: 'deployment-id',
      environment: 'preview',
      filingSearchBackend: 'enriched',
      releaseGateNotAfter: '2026-08-04T16:00:00.000Z',
      schemaDatabaseFingerprint: supabaseOriginFingerprint('https://example.supabase.co'),
      schemaVersion: '021',
      schemaMigrationCount: 23,
      schemaChainChecksum: 'a'.repeat(64),
      schemaChecksumAlgorithm: 'sha256-v2',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_schema_provenance');
    expect(mocks.checkRate).toHaveBeenCalledWith(
      expect.any(Request),
      { operation: 'version', ipLimit: 60 }
    );
    expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual([
      'deploymentId',
      'environment',
      'filingSearchBackend',
      'ok',
      'ref',
      'releaseGateNotAfter',
      'schemaChainChecksum',
      'schemaChecksumAlgorithm',
      'schemaDatabaseFingerprint',
      'schemaMigrationCount',
      'schemaVersion',
      'sha',
    ].sort());
    expect(JSON.stringify(body)).not.toContain('must-never-be-returned');
  });

  it('reports the effective build-time filing search backend', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    vi.stubEnv('NEXT_PUBLIC_USE_ENRICHED_SEARCH', 'false');

    const body = await (await GET(request())).json();

    expect(body.filingSearchBackend).toBe('legacy-sec-efts');
  });

  it.each(['0', ' false ', 'NO', 'Off'])(
    'matches the client opt-out parser for %j',
    value => {
      vi.stubEnv('NEXT_PUBLIC_USE_ENRICHED_SEARCH', value);
      expect(effectiveFilingSearchBackend()).toBe('legacy-sec-efts');
    },
  );

  it.each(['', '1', 'true', 'yes', 'on', 'unexpected'])(
    'keeps the default-enriched client behavior for %j',
    value => {
      vi.stubEnv('NEXT_PUBLIC_USE_ENRICHED_SEARCH', value);
      expect(effectiveFilingSearchBackend()).toBe('enriched');
    },
  );

  it('reports only the legacy version while migration 021 is being rolled out', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'urc_schema_provenance'
      ? { data: null, error: { message: 'function does not exist' } }
      : { data: '020', error: null });

    const body = await (await GET(request())).json();

    expect(body).toMatchObject({
      schemaVersion: '020',
      schemaMigrationCount: null,
      schemaChainChecksum: null,
      schemaChecksumAlgorithm: null,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'urc_schema_provenance');
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'urc_schema_version');
  });

  it('returns explicit null provenance when the restricted database is unavailable', async () => {
    mocks.db = false;

    const body = await (await GET(request())).json();

    expect(body).toMatchObject({
      schemaVersion: null,
      schemaMigrationCount: null,
      schemaChainChecksum: null,
      schemaChecksumAlgorithm: null,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('serves repeated anonymous reads from a short in-process schema cache', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        schemaVersion: '021',
        schemaMigrationCount: 23,
        schemaChainChecksum: 'b'.repeat(64),
        schemaChecksumAlgorithm: 'sha256-v2',
      },
      error: null,
    });

    const first = await (await GET(request('203.0.113.11'))).json();
    const second = await (await GET(request('203.0.113.12'))).json();

    expect(first.schemaChainChecksum).toBe('b'.repeat(64));
    expect(second.schemaChainChecksum).toBe(first.schemaChainChecksum);
    expect(mocks.checkRate).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects an over-limit public IP before touching Supabase', async () => {
    mocks.checkRate.mockReturnValue({
      allowed: false,
      retryAfterSeconds: 30,
      reason: 'rate',
    });

    const response = await GET(request('203.0.113.13'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rateResponse).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed with null schema fields when the Supabase read exceeds its budget', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockReturnValue(new Promise(() => {}));

    const responsePromise = GET(request('203.0.113.14'));
    await vi.advanceTimersByTimeAsync(1_500);
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body).toMatchObject({
      schemaVersion: null,
      schemaMigrationCount: null,
      schemaChainChecksum: null,
      schemaChecksumAlgorithm: null,
    });

    const cachedFailure = await (await GET(request('203.0.113.15'))).json();
    expect(cachedFailure.schemaChainChecksum).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
