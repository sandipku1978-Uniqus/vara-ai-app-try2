import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiIdentity } from '../lib/api-auth';

const mocks = vi.hoisted(() => ({
  identity: { userId: 'user_alice', orgId: 'org_acme', cacheScope: 'user_alice:org_acme' } as ApiIdentity,
  configured: true,
  rpc: vi.fn(),
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn(async () => ({ identity: mocks.identity })),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
}));
vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => (mocks.configured ? { rpc: mocks.rpc } : null),
}));

import { GET as getWatchlist, PUT as putWatchlist, DELETE as deleteWatchlist } from '../app/api/user/watchlist/route';
import { PUT as putMemo } from '../app/api/user/memo/route';
import { GET as getAlerts } from '../app/api/user/alerts/route';
import { userDataAssertionMessage } from '../lib/user-data-auth';

const SECRET = 'test-signing-secret-0123456789abcdef0123';

function request(method: string, body?: unknown, path = '/api/user/watchlist'): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function expectSignedFor(args: Record<string, unknown>, operation: string, kind: string, userId: string, orgId: string | null) {
  expect(args.p_user_id).toBe(userId);
  expect(args.p_org_id).toBe(orgId);
  const message = userDataAssertionMessage(operation as never, kind as never, userId, orgId, args.p_expires_at as number);
  expect(args.p_signature).toBe(createHmac('sha256', SECRET).update(message).digest('hex'));
}

beforeEach(() => {
  process.env.URC_USER_DATA_SIGNING_SECRET = SECRET;
  mocks.identity = { userId: 'user_alice', orgId: 'org_acme', cacheScope: 'user_alice:org_acme' };
  mocks.configured = true;
  mocks.rpc.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.URC_USER_DATA_SIGNING_SECRET;
  vi.restoreAllMocks();
});

describe('/api/user/* takes identity from the session, never from the body', () => {
  it('rejects a body that names another owner and never reaches the database', async () => {
    for (const forged of [
      { items: [{ clientKey: 'AAPL', ticker: 'AAPL', ownerUserId: 'user_mallory' }] },
      { items: [{ clientKey: 'AAPL', ticker: 'AAPL', orgId: 'org_victim' }] },
      { items: [{ clientKey: 'AAPL', ticker: 'AAPL' }], userId: 'user_mallory' },
      { items: [{ clientKey: 'AAPL', ticker: 'AAPL' }], owner_user_id: 'user_mallory' },
    ]) {
      const response = await putWatchlist(request('PUT', forged));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('taken from the signed-in session');
    }
    const forgedDelete = await deleteWatchlist(request('DELETE', { clientKeys: ['AAPL'], orgId: 'org_victim' }));
    expect(forgedDelete.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('writes rows without identity columns and signs the session identity', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'row-1', client_key: 'c1', updated_at: '2026-10-04T00:00:00Z' }], error: null });
    // Identity-shaped keys inside an opaque payload are content, not identity.
    const response = await putMemo(request('PUT', {
      items: [{ clientKey: 'c1', itemKind: 'citation', payload: { id: 'c1', owner_user_id: 'user_mallory', orgId: 'org_victim' } }],
    }, '/api/user/memo'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, items: [{ id: 'row-1', clientKey: 'c1' }] });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [rpc, args] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpc).toBe('urc_user_upsert');
    expect(args.p_kind).toBe('memo');
    const rows = args.p_items as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0])).not.toContain('owner_user_id');
    expect(Object.keys(rows[0])).not.toContain('org_id');
    expectSignedFor(args, 'upsert', 'memo', 'user_alice', 'org_acme');
  });

  it('lists with the session identity and strips server-only columns from the response', async () => {
    mocks.identity = { userId: 'user_bob', orgId: null, cacheScope: 'user_bob:personal' };
    mocks.rpc.mockResolvedValue({
      data: [{ id: 'r1', client_key: 'MSFT', ticker: 'MSFT', position: 0, project_id: null, created_at: 'c', updated_at: 'u', owner_user_id: 'leak' }],
      error: null,
    });
    const response = await getWatchlist(request('GET'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([{ id: 'r1', clientKey: 'MSFT', ticker: 'MSFT', position: 0, projectId: null, createdAt: 'c', updatedAt: 'u' }]);
    const [rpc, args] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpc).toBe('urc_user_list');
    expectSignedFor(args, 'list', 'watchlist', 'user_bob', null);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('deletes by client key for the session identity', async () => {
    mocks.rpc.mockResolvedValue({ data: { deleted: 2 }, error: null });
    const response = await deleteWatchlist(request('DELETE', { clientKeys: ['AAPL', 'MSFT'] }));
    expect(await response.json()).toMatchObject({ ok: true, deleted: 2 });
    const [rpc, args] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpc).toBe('urc_user_delete');
    expect(args.p_client_keys).toEqual(['AAPL', 'MSFT']);
    expectSignedFor(args, 'delete', 'watchlist', 'user_alice', 'org_acme');
  });
});

describe('/api/user/* availability and failure classes', () => {
  it('answers 503 "unavailable" when storage is not provisioned, so the browser stays local', async () => {
    delete process.env.URC_USER_DATA_SIGNING_SECRET;
    const noSecret = await getAlerts(request('GET', undefined, '/api/user/alerts'));
    expect(noSecret.status).toBe(503);
    expect((await noSecret.json()).errorClass).toBe('unavailable');

    process.env.URC_USER_DATA_SIGNING_SECRET = SECRET;
    mocks.configured = false;
    const noDb = await getAlerts(request('GET', undefined, '/api/user/alerts'));
    expect(noDb.status).toBe(503);

    mocks.configured = true;
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'urc_user: signing key is not provisioned' } });
    const noKey = await getAlerts(request('GET', undefined, '/api/user/alerts'));
    expect(noKey.status).toBe(503);
    expect((await noKey.json()).errorClass).toBe('unavailable');
  });

  it('refuses machine identities', async () => {
    mocks.identity = { userId: 'release-gate:dpl_1', orgId: null, cacheScope: 'release-gate', releaseGate: true };
    expect((await getWatchlist(request('GET'))).status).toBe(403);
    mocks.identity = { userId: 'local-e2e', orgId: null, cacheScope: 'local-e2e:personal' };
    expect((await getWatchlist(request('GET'))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps the database row cap to 413 and contract violations to 400', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '54000', message: 'urc_user: object limit reached' } });
    const capped = await putWatchlist(request('PUT', { items: [{ clientKey: 'AAPL', ticker: 'AAPL' }] }));
    expect(capped.status).toBe(413);
    expect((await capped.json()).errorClass).toBe('limit');

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'check violation' } });
    expect((await putWatchlist(request('PUT', { items: [{ clientKey: 'AAPL', ticker: 'AAPL' }] }))).status).toBe(400);
  });

  it('classifies a transport failure without throwing past the route', async () => {
    const timeout = new Error('deadline');
    timeout.name = 'AbortError';
    mocks.rpc.mockRejectedValueOnce(timeout);
    const response = await getWatchlist(request('GET'));
    expect(response.status).toBe(504);
    expect((await response.json()).errorClass).toBe('transport');
  });

  it('rejects an oversized body before reading it all', async () => {
    const response = await putWatchlist(new Request('http://localhost/api/user/watchlist', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'content-length': String(10 * 1024 * 1024) },
      body: '{}',
    }));
    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
