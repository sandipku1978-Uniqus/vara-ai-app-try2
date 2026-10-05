import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  writer: true,
  session: true as boolean,
  identity: { userId: 'user_1', orgId: 'org_1', cacheScope: 'user_1:org_1' } as Record<string, unknown>,
  evaluate: vi.fn(),
  capacity: true,
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => (mocks.session
    ? { identity: mocks.identity }
    : { response: Response.json({ error: 'Authentication required.' }, { status: 401 }) }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  acquireResourceConcurrency: async () => ({ allowed: mocks.capacity, lease: undefined }),
  releaseAiConcurrency: async () => undefined,
}));
vi.mock('../lib/supabase-web', () => ({
  getUserWriterSupabase: () => (mocks.writer ? { rpc: mocks.rpc } : null),
  getWebSupabase: () => null,
}));
vi.mock('../app/api/search-jobs/_server/clients', () => ({
  buildServerWaveClients: () => ({}),
}));
vi.mock('../services/alertEvaluation', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/alertEvaluation')>();
  return { ...actual, evaluateClaimedAlert: (...args: unknown[]) => mocks.evaluate(...args) };
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GET, POST, maxDuration } from '../app/api/alerts/evaluate/route';
import { ALERT_EVALUATION_LIMITS } from '../services/alertEvaluation';

const SECRET = 'a-long-enough-cron-secret';
const ALERT_ID = '00000000-0000-4000-8000-0000000000a1';
const LEASE = '00000000-0000-4000-8000-0000000000b2';

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ALERT_ID,
    ownerUserId: 'user_1',
    orgId: 'org_1',
    clientKey: 'alert-1',
    name: 'Material weakness',
    query: '"material weakness"',
    mode: 'boolean',
    filters: {},
    defaultForms: '10-K',
    cadence: 'daily',
    enabled: true,
    lastCheckedAt: null,
    lastSeenAccessions: [],
    engineVersion: null,
    lastCheckCoverage: null,
    leaseToken: LEASE,
    ...overrides,
  };
}

const cron = (authorization?: string) => new Request('http://localhost/api/alerts/evaluate', {
  headers: authorization ? { authorization } : {},
});
const post = (body: unknown) => new Request('http://localhost/api/alerts/evaluate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.evaluate.mockReset().mockResolvedValue({ kind: 'checked', alertId: ALERT_ID, clientKey: 'alert-1', complete: true, newFilings: 2, storedHits: 2, reason: null });
  mocks.session = true;
  mocks.writer = true;
  mocks.capacity = true;
  mocks.identity = { userId: 'user_1', orgId: 'org_1', cacheScope: 'user_1:org_1' };
});
afterEach(() => vi.unstubAllEnvs());

describe('alert evaluation schedule', () => {
  const crons = (JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
    crons: Array<{ path: string; schedule: string }>;
  }).crons;

  it('runs the alert pass four times an hour, evenly spaced, and leaves the search-job worker every minute', () => {
    expect(crons.find(cron => cron.path === '/api/alerts/evaluate')?.schedule).toBe('7,22,37,52 * * * *');
    expect(crons.find(cron => cron.path === '/api/search-jobs/continue')?.schedule).toBe('* * * * *');
    const minutes = '7,22,37,52'.split(',').map(Number);
    const gaps = minutes.map((minute, index) => ((minutes[(index + 1) % minutes.length] - minute + 60) % 60) * 60_000);
    expect(new Set(gaps)).toEqual(new Set([ALERT_EVALUATION_LIMITS.passIntervalMs]));
  });

  it('finishes a pass, its last check and the recording well before the next pass starts', () => {
    const recordDeadlineMs = 15_000;
    const worstCaseMs = ALERT_EVALUATION_LIMITS.runBudgetMs + ALERT_EVALUATION_LIMITS.waveHardDeadlineMs + recordDeadlineMs;
    expect(worstCaseMs).toBeLessThanOrEqual(maxDuration * 1000);
    expect(maxDuration * 1000).toBeLessThan(ALERT_EVALUATION_LIMITS.passIntervalMs);
    expect(ALERT_EVALUATION_LIMITS.leaseSeconds * 1000).toBeLessThan(ALERT_EVALUATION_LIMITS.passIntervalMs);
  });
});

describe('GET /api/alerts/evaluate (Vercel Cron)', () => {
  it('fails closed without a configured secret, or with the wrong one', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(cron(`Bearer ${SECRET}`))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', SECRET);
    expect((await GET(cron())).status).toBe(401);
    expect((await GET(cron('Bearer nope'))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not accept a signed-in session in place of the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    // requireApiAccess would succeed, but GET never consults it.
    expect((await GET(cron())).status).toBe(401);
  });

  it('answers 503 when the deployment has no writer credential', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    mocks.writer = false;
    expect((await GET(cron(`Bearer ${SECRET}`))).status).toBe(503);
  });

  it('claims due alerts with the cadence thresholds and checks each one', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    let claims = 0;
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'urc_alert_eval_claim') return { data: claims++ === 0 ? claimRow() : null, error: null };
      return { data: null, error: null };
    });
    const res = await GET(cron(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, claimed: 1, stoppedBy: 'no-due-alerts' });
    expect(body.checks).toEqual([{ outcome: 'checked', alertId: ALERT_ID, complete: true, newFilings: 2, storedHits: 2 }]);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_alert_eval_claim', {
      p_owner_user_id: null, p_org_id: null, p_client_key: null,
      p_daily_after_seconds: 72000, p_weekly_after_seconds: 518400, p_lease_seconds: 180,
    });
  });

  it('hands the lease back and stops when deployment capacity is full', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    mocks.capacity = false;
    mocks.rpc.mockImplementation(async (fn: string) => (fn === 'urc_alert_eval_claim' ? { data: claimRow(), error: null } : { data: true, error: null }));
    const res = await GET(cron(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, stoppedBy: 'capacity', checks: [] });
    // Both parallel workers may have claimed before the first saw capacity
    // full; every claimed lease is handed back.
    const releases = mocks.rpc.mock.calls.filter(([fn]) => fn === 'urc_alert_eval_release');
    expect(releases).toHaveLength(body.claimed);
    expect(releases[0][1]).toEqual({ p_alert_id: ALERT_ID, p_lease_token: LEASE });
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});

describe('POST /api/alerts/evaluate (owner "Run now")', () => {
  it('requires a session', async () => {
    mocks.session = false;
    expect((await POST(post({ alertKey: 'alert-1' }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses machine identities', async () => {
    mocks.identity = { userId: 'local-e2e', orgId: null, cacheScope: 'local-e2e:personal' };
    expect((await POST(post({ alertKey: 'alert-1' }))).status).toBe(403);
  });

  it('claims only the caller’s alert, scoped by the session — never by the body', async () => {
    mocks.rpc.mockResolvedValue({ data: claimRow(), error: null });
    const res = await POST(post({ alertKey: 'alert-1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).check).toMatchObject({ outcome: 'checked', newFilings: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith('urc_alert_eval_claim', expect.objectContaining({
      p_owner_user_id: 'user_1', p_org_id: 'org_1', p_client_key: 'alert-1',
    }));
    expect(mocks.evaluate).toHaveBeenCalledOnce();
  });

  it('rejects a missing alert key and reports busy and unknown alerts', async () => {
    expect((await POST(post({}))).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: { error: 'busy' }, error: null });
    expect((await POST(post({ alertKey: 'alert-1' }))).status).toBe(409);
    mocks.rpc.mockResolvedValue({ data: { error: 'not-found' }, error: null });
    expect((await POST(post({ alertKey: 'alert-1' }))).status).toBe(404);
  });

  it('refuses an alert the claim returned for another owner', async () => {
    mocks.rpc.mockResolvedValue({ data: claimRow({ ownerUserId: 'user_2' }), error: null });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await POST(post({ alertKey: 'alert-1' }))).status).toBe(502);
    expect(mocks.evaluate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
