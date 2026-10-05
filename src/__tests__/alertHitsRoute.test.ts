import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  web: true,
  session: true as boolean,
  identity: { userId: 'user_1', orgId: null, cacheScope: 'user_1:personal' } as Record<string, unknown>,
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => (mocks.session
    ? { identity: mocks.identity }
    : { response: Response.json({ error: 'Authentication required.' }, { status: 401 }) }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => (mocks.web ? { rpc: mocks.rpc } : null),
}));

import { GET, PUT } from '../app/api/user/alert-hits/route';
import {
  ALERT_HITS_KIND,
  parseAlertHitsQuery,
  signAlertHitsAssertion,
  validateMarkSeenBody,
} from '../lib/user-data-alert-hits';
import { userDataAssertionMessage } from '../lib/user-data-auth';
import type { UserDataKind } from '../lib/user-data-kinds';

const SECRET = 'x'.repeat(40);
const HIT_ID = '00000000-0000-4000-8000-0000000000c3';

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.web = true;
  mocks.session = true;
  mocks.identity = { userId: 'user_1', orgId: null, cacheScope: 'user_1:personal' };
  vi.stubEnv('URC_USER_DATA_SIGNING_SECRET', SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe('alert-hits validators', () => {
  it('accepts the documented query parameters', () => {
    const parsed = parseAlertHitsQuery(new URLSearchParams('alertKey=alert-1&unseen=1&since=2026-10-03T12:00:00Z&offset=50&limit=100'));
    expect(parsed).toEqual({ query: { alertKey: 'alert-1', unseenOnly: true, since: '2026-10-03T12:00:00.000Z', offset: 50, limit: 100 } });
    expect(parseAlertHitsQuery(new URLSearchParams(''))).toEqual({ query: { alertKey: null, unseenOnly: false, since: null, offset: 0, limit: 50 } });
  });

  it('rejects identity parameters, unknown parameters and out-of-range paging', () => {
    expect(parseAlertHitsQuery(new URLSearchParams('userId=user_2'))).toHaveProperty('error');
    expect(parseAlertHitsQuery(new URLSearchParams('owner=user_2'))).toHaveProperty('error');
    expect(parseAlertHitsQuery(new URLSearchParams('sort=asc'))).toHaveProperty('error');
    expect(parseAlertHitsQuery(new URLSearchParams('limit=201'))).toHaveProperty('error');
    expect(parseAlertHitsQuery(new URLSearchParams('limit=0'))).toHaveProperty('error');
    expect(parseAlertHitsQuery(new URLSearchParams('offset=-1'))).toHaveProperty('error');
    expect(parseAlertHitsQuery(new URLSearchParams('since=yesterday'))).toHaveProperty('error');
    expect(parseAlertHitsQuery(new URLSearchParams('unseen=yes'))).toHaveProperty('error');
  });

  it('accepts exactly one mark-seen target', () => {
    expect(validateMarkSeenBody({ hitIds: [HIT_ID.toUpperCase(), HIT_ID] })).toEqual({ request: { mode: 'ids', hitIds: [HIT_ID] } });
    expect(validateMarkSeenBody({ alertKey: 'alert-1' })).toEqual({ request: { mode: 'alert', alertKey: 'alert-1' } });
    expect(validateMarkSeenBody({ all: true })).toEqual({ request: { mode: 'all' } });
    expect(validateMarkSeenBody({})).toHaveProperty('error');
    expect(validateMarkSeenBody({ all: true, alertKey: 'alert-1' })).toHaveProperty('error');
    expect(validateMarkSeenBody({ all: false })).toHaveProperty('error');
    expect(validateMarkSeenBody({ hitIds: [] })).toHaveProperty('error');
    expect(validateMarkSeenBody({ hitIds: ['not-a-uuid'] })).toHaveProperty('error');
    expect(validateMarkSeenBody({ hitIds: Array.from({ length: 501 }, () => HIT_ID) })).toHaveProperty('error');
    expect(validateMarkSeenBody({ all: true, ownerUserId: 'user_2' })).toHaveProperty('error');
  });

  it('signs the same message format the database verifies', () => {
    const assertion = signAlertHitsAssertion({ operation: 'list', userId: 'user_1', orgId: 'org_1', secret: SECRET, nowMs: 1_000_000 });
    const message = userDataAssertionMessage('list', ALERT_HITS_KIND as UserDataKind, 'user_1', 'org_1', assertion.p_expires_at);
    expect(assertion.p_signature).toBe(createHmac('sha256', SECRET).update(message, 'utf8').digest('hex'));
    expect(assertion.p_expires_at).toBe(1_000 + 120);
    const sql = readFileSync(resolve(process.cwd(), 'db', 'migrations', '029_alert_hits_and_scheduled_evaluation.sql'), 'utf8');
    expect(sql).toContain("perform public.urc_user_assume('list', 'alert-hits', p_user_id, p_org_id, p_expires_at, p_signature)");
    expect(sql).toContain("perform public.urc_user_assume('upsert', 'alert-hits', p_user_id, p_org_id, p_expires_at, p_signature)");
  });
});

describe('/api/user/alert-hits', () => {
  it('requires a session and a real account', async () => {
    mocks.session = false;
    expect((await GET(new Request('http://localhost/api/user/alert-hits'))).status).toBe(401);
    mocks.session = true;
    mocks.identity = { userId: 'local-e2e', orgId: null, cacheScope: 'local-e2e:personal' };
    expect((await GET(new Request('http://localhost/api/user/alert-hits'))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('answers 503 unavailable when storage is not provisioned', async () => {
    vi.stubEnv('URC_USER_DATA_SIGNING_SECRET', '');
    const res = await GET(new Request('http://localhost/api/user/alert-hits'));
    expect(res.status).toBe(503);
    expect((await res.json()).errorClass).toBe('unavailable');
  });

  it('pages hits with the session identity as a signed assertion', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 1, unseen: 1, unseenAmendments: 0, byAlert: { 'alert-1': 1 }, hits: [{ id: HIT_ID }] }, error: null });
    const res = await GET(new Request('http://localhost/api/user/alert-hits?unseen=1&limit=10'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, total: 1, unseen: 1, byAlert: { 'alert-1': 1 }, hits: [{ id: HIT_ID }] });
    const [rpc, args] = mocks.rpc.mock.calls[0];
    expect(rpc).toBe('urc_user_alert_hits_page');
    expect(args).toMatchObject({ p_alert_client_key: null, p_unseen_only: true, p_since: null, p_offset: 0, p_limit: 10, p_user_id: 'user_1', p_org_id: null });
    expect(args.p_signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a bad request before touching the database', async () => {
    expect((await GET(new Request('http://localhost/api/user/alert-hits?userId=user_2'))).status).toBe(400);
    const bad = await PUT(new Request('http://localhost/api/user/alert-hits', { method: 'PUT', body: JSON.stringify({ orgId: 'org_2', all: true }) }));
    expect(bad.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('marks hits seen', async () => {
    mocks.rpc.mockResolvedValue({ data: { marked: 1 }, error: null });
    const res = await PUT(new Request('http://localhost/api/user/alert-hits', { method: 'PUT', body: JSON.stringify({ hitIds: [HIT_ID] }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, marked: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('urc_user_alert_hits_mark_seen', expect.objectContaining({
      p_hit_ids: [HIT_ID], p_alert_client_key: null, p_all: false, p_user_id: 'user_1',
    }));
  });

  it('reports a rejected assertion or an unmigrated database as unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'rejected' } });
    expect((await GET(new Request('http://localhost/api/user/alert-hits'))).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    expect((await GET(new Request('http://localhost/api/user/alert-hits'))).status).toBe(503);
    consoleError.mockRestore();
  });
});
