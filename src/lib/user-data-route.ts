/**
 * Shared handler behind /api/user/{kind} (migration 026).
 *
 *   GET    → every object of this kind owned by the signed-in identity
 *   PUT    → { items: [...] } upserted by clientKey (idempotent)
 *   DELETE → { clientKeys: [...] } removed
 *
 * The identity (Clerk user id and org id) comes from requireApiAccess only,
 * called by each route file and passed in.
 * The body is validated against a strict per-kind whitelist that rejects
 * identity keys, and the RPC receives the session identity as a signed
 * assertion that the database verifies before it scopes the transaction —
 * see user-data-auth.ts and the migration header.
 *
 * Reads and writes use the restricted web client (publishable key, HTTP
 * deadline from getWebSupabase); production never escalates to the service
 * key. When storage is not provisioned (no signing secret, no web client, or
 * the database has no signing key yet) the route answers 503 with
 * errorClass "unavailable", and the browser keeps its local behaviour.
 */

import type { ApiIdentity } from './api-auth';
import { checkResourceRateLimit, rateLimitResponse } from './rate-limit';
import { getWebSupabase } from './supabase-web';
import { classifyDbError, newCorrelationId, type SupabaseErrorLike } from './db-observability';
import { signUserDataAssertion, userDataSigningSecret, type UserDataOperation } from './user-data-auth';
import { readUserDataDelete, readUserDataPut, rowToWireItem } from './user-data-input';
import type { UserDataKind } from './user-data-kinds';

const NO_STORE = { 'Cache-Control': 'no-store' };

function envelope(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function unavailable(correlationId: string, reason: string): Response {
  return envelope(503, {
    ok: false,
    error: 'Saved research storage is not available; your work stays in this browser.',
    errorClass: 'unavailable',
    reason,
    correlationId,
  });
}

/**
 * Only real Clerk sessions own server-side research. The signed release
 * probe and the local e2e bypass are machine identities: they never write.
 */
export function isEligibleUserDataIdentity(identity: ApiIdentity): boolean {
  if (identity.releaseGate) return false;
  if (identity.userId === 'local-e2e') return false;
  return /^[A-Za-z0-9_:-]{1,128}$/.test(identity.userId)
    && (identity.orgId === null || /^[A-Za-z0-9_:-]{1,128}$/.test(identity.orgId));
}

function logDbFailure(kind: UserDataKind, rpc: string, error: SupabaseErrorLike | null, correlationId: string, startedAt: number) {
  console.error(JSON.stringify({
    kind: 'db-failure',
    route: `user/${kind}`,
    rpc,
    errorClass: error?.code === '28000' ? 'unavailable' : classifyDbError(error).errorClass,
    code: error?.code ?? null,
    message: error?.message ?? null,
    elapsedMs: Date.now() - startedAt,
    correlationId,
  }));
}

function dbFailureResponse(
  kind: UserDataKind,
  rpc: string,
  error: SupabaseErrorLike,
  correlationId: string,
  startedAt: number,
): Response {
  logDbFailure(kind, rpc, error, correlationId, startedAt);
  const code = (error.code || '').toUpperCase();
  // 28000: the assertion was rejected or the signing key is not provisioned.
  // Either way the user's data is unreachable, not absent.
  if (code === '28000') return unavailable(correlationId, 'identity-assertion');
  if (code === '54000') {
    return envelope(413, {
      ok: false,
      error: 'The saved-research limit for this kind of object was reached. Remove some items and retry.',
      errorClass: 'limit',
      correlationId,
    });
  }
  // Check, foreign-key and parameter violations: the item shape is wrong.
  if (code === '23514' || code === '23503' || code === '22023' || code === '22P02' || code === '22007' || code === '23502') {
    return envelope(400, {
      ok: false,
      error: 'An item did not satisfy the saved-research contract.',
      errorClass: 'invalid-request',
      correlationId,
    });
  }
  const classified = classifyDbError(error);
  return envelope(classified.status, {
    ok: false,
    error: classified.publicMessage,
    errorClass: classified.errorClass,
    correlationId,
  });
}

async function callRpc(
  db: NonNullable<ReturnType<typeof getWebSupabase>>,
  rpc: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: SupabaseErrorLike | null; transport?: unknown }> {
  try {
    const { data, error } = await db.rpc(rpc, args);
    return { data, error: error ?? null };
  } catch (transport) {
    // A transport rejection (network, the getWebSupabase HTTP deadline)
    // throws rather than returning {error}.
    return { data: null, error: null, transport };
  }
}

/**
 * `identity` must come from requireApiAccess() in the route file (the
 * apiAuth guard test requires every route to call it itself).
 */
export async function handleUserDataRequest(kind: UserDataKind, request: Request, identity: ApiIdentity): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
    return envelope(405, { ok: false, error: 'Method not allowed.', errorClass: 'invalid-request' });
  }
  const correlationId = newCorrelationId();
  const startedAt = Date.now();

  if (!isEligibleUserDataIdentity(identity)) {
    return envelope(403, {
      ok: false,
      error: 'Saved research belongs to a signed-in account.',
      errorClass: 'denied',
      correlationId,
    });
  }

  const rate = await checkResourceRateLimit(request, identity, {
    operation: 'user-data',
    userLimit: 600,
    ipLimit: 900,
  });
  if (!rate.allowed) return rateLimitResponse(rate);

  const secret = userDataSigningSecret();
  if (!secret) return unavailable(correlationId, 'signing-secret');
  const db = getWebSupabase();
  if (!db) return unavailable(correlationId, 'database');

  // Body first: a malformed request is rejected before any database work.
  let operation: UserDataOperation;
  let payload: Record<string, unknown> = {};
  if (method === 'PUT') {
    const parsed = await readUserDataPut(request, kind);
    if (parsed.response) return parsed.response;
    operation = 'upsert';
    payload = { p_items: parsed.value };
  } else if (method === 'DELETE') {
    const parsed = await readUserDataDelete(request);
    if (parsed.response) return parsed.response;
    operation = 'delete';
    payload = { p_client_keys: parsed.value };
  } else {
    operation = 'list';
  }

  // Identity from the session only — never from the body.
  const assertion = signUserDataAssertion({
    operation,
    kind,
    userId: identity.userId,
    orgId: identity.orgId,
    secret,
  });
  const rpc = operation === 'list' ? 'urc_user_list' : operation === 'upsert' ? 'urc_user_upsert' : 'urc_user_delete';
  const result = await callRpc(db, rpc, { p_kind: kind, ...payload, ...assertion });

  if (result.transport !== undefined) {
    const name = result.transport instanceof Error ? result.transport.name : 'UnknownError';
    console.error(JSON.stringify({
      kind: 'db-failure', route: `user/${kind}`, rpc, errorClass: 'transport', errorName: name,
      elapsedMs: Date.now() - startedAt, correlationId,
    }));
    return envelope(name === 'AbortError' || name === 'TimeoutError' ? 504 : 502, {
      ok: false,
      error: 'Saved research storage did not answer in time. Your changes are kept in this browser and will retry.',
      errorClass: 'transport',
      correlationId,
    });
  }
  if (result.error) return dbFailureResponse(kind, rpc, result.error, correlationId, startedAt);

  if (operation === 'list') {
    const rows = Array.isArray(result.data) ? result.data : [];
    const items = rows
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
      .map(row => rowToWireItem(kind, row));
    return envelope(200, { ok: true, kind, items, correlationId });
  }
  if (operation === 'upsert') {
    const written = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
    return envelope(200, {
      ok: true,
      kind,
      items: written.map(row => ({ id: row.id, clientKey: row.client_key, updatedAt: row.updated_at })),
      correlationId,
    });
  }
  const deleted = Number((result.data as { deleted?: unknown } | null)?.deleted ?? 0);
  return envelope(200, { ok: true, kind, deleted: Number.isFinite(deleted) ? deleted : 0, correlationId });
}
