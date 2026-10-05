/**
 * /api/user/alert-hits (migration 029) — the signed-in identity's alert hits.
 *
 *   GET → one page of hits, unseen first then newest first, with unread
 *         counts. Query: alertKey (one alert), unseen=1 (unseen only),
 *         since=<ISO timestamp> (recorded since then), offset, limit (≤200).
 *   PUT → mark hits seen: { hitIds: [...] } | { alertKey } | { all: true },
 *         exactly one.
 *
 * Same contract as the 026 user-data routes (user-data-route.ts): identity
 * from the Clerk session only, a short-lived HMAC assertion the database
 * verifies (urc_user_assume) before it scopes the transaction, the
 * restricted web client, and 503 "unavailable" when storage is not
 * provisioned. Hits are written only by the scheduled evaluator; this route
 * can read them and set seen_at, nothing else.
 */

import { createHmac } from 'node:crypto';
import type { ApiIdentity } from './api-auth';
import { readJsonBody } from './ai-input';
import { classifyDbError, newCorrelationId, type SupabaseErrorLike } from './db-observability';
import { checkResourceRateLimit, rateLimitResponse } from './rate-limit';
import { getWebSupabase } from './supabase-web';
import {
  USER_DATA_ASSERTION_PURPOSE,
  USER_DATA_ASSERTION_TTL_SECONDS,
  userDataSigningSecret,
  type UserDataAssertion,
} from './user-data-auth';
import { isIdentityKey } from './user-data-input';
import { CLIENT_KEY_PATTERN } from './user-data-kinds';
import { isEligibleUserDataIdentity } from './user-data-route';

/** The object kind named in the signed assertion (urc_user_assume's p_kind). */
export const ALERT_HITS_KIND = 'alert-hits';
export const ALERT_HITS_PAGE_SIZE = 50;
export const ALERT_HITS_MAX_PAGE_SIZE = 200;
export const ALERT_HITS_MAX_OFFSET = 10_000;
export const ALERT_HITS_MAX_MARK = 500;
const MARK_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = { 'Cache-Control': 'no-store' };

function envelope(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function invalid(error: string): Response {
  return envelope(400, { ok: false, error, errorClass: 'invalid-request' });
}

/**
 * Sign for the 'alert-hits' kind. The message is byte for byte the 026
 * format (user-data-auth.ts, urc_user_assume): purpose, operation, kind,
 * user, org, expiry — a test holds the two together.
 */
export function signAlertHitsAssertion(options: {
  operation: 'list' | 'upsert';
  userId: string;
  orgId: string | null;
  secret: string;
  nowMs?: number;
}): UserDataAssertion {
  const expiresAt = Math.floor((options.nowMs ?? Date.now()) / 1000) + USER_DATA_ASSERTION_TTL_SECONDS;
  const orgId = options.orgId || null;
  const message = [USER_DATA_ASSERTION_PURPOSE, options.operation, ALERT_HITS_KIND, options.userId, orgId ?? '', String(expiresAt)].join('\n');
  const signature = createHmac('sha256', options.secret).update(message, 'utf8').digest('hex');
  return { p_user_id: options.userId, p_org_id: orgId, p_expires_at: expiresAt, p_signature: signature };
}

export interface AlertHitsQuery {
  alertKey: string | null;
  unseenOnly: boolean;
  since: string | null;
  offset: number;
  limit: number;
}

/** Validate GET parameters. Unknown parameters and identity names are rejected. */
export function parseAlertHitsQuery(params: URLSearchParams): { query: AlertHitsQuery } | { error: string } {
  const allowed = new Set(['alertKey', 'unseen', 'since', 'offset', 'limit']);
  for (const key of params.keys()) {
    if (isIdentityKey(key)) return { error: `"${key}" is not accepted. The account is taken from the signed-in session.` };
    if (!allowed.has(key)) return { error: `Unknown parameter "${key}".` };
  }
  const alertKey = params.get('alertKey');
  if (alertKey !== null && !CLIENT_KEY_PATTERN.test(alertKey)) return { error: 'alertKey has an invalid format.' };
  const unseen = params.get('unseen');
  if (unseen !== null && unseen !== '1' && unseen !== '0') return { error: 'unseen must be 1 or 0.' };
  const since = params.get('since');
  if (since !== null && (since.length > 40 || Number.isNaN(Date.parse(since)))) return { error: 'since must be an ISO timestamp.' };
  const integer = (name: string, fallback: number, max: number): number | string => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (!/^\d{1,6}$/.test(raw)) return `${name} must be a non-negative integer.`;
    const value = Number(raw);
    return value > max ? `${name} must be at most ${max}.` : value;
  };
  const offset = integer('offset', 0, ALERT_HITS_MAX_OFFSET);
  if (typeof offset === 'string') return { error: offset };
  const limit = integer('limit', ALERT_HITS_PAGE_SIZE, ALERT_HITS_MAX_PAGE_SIZE);
  if (typeof limit === 'string') return { error: limit };
  if (limit < 1) return { error: 'limit must be at least 1.' };
  return {
    query: {
      alertKey,
      unseenOnly: unseen === '1',
      since: since === null ? null : new Date(since).toISOString(),
      offset,
      limit,
    },
  };
}

export type MarkSeenRequest =
  | { mode: 'ids'; hitIds: string[] }
  | { mode: 'alert'; alertKey: string }
  | { mode: 'all' };

/** Validate a PUT body: exactly one of hitIds, alertKey, all:true. */
export function validateMarkSeenBody(body: unknown): { request: MarkSeenRequest } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be a JSON object.' };
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (isIdentityKey(key)) return { error: `body: "${key}" is not accepted. The account is taken from the signed-in session.` };
    if (!['hitIds', 'alertKey', 'all'].includes(key)) return { error: `body: unknown field "${key}".` };
  }
  const named = ['hitIds', 'alertKey', 'all'].filter(key => record[key] !== undefined);
  if (named.length !== 1) return { error: 'Provide exactly one of hitIds, alertKey or all.' };
  if (record.all !== undefined) {
    if (record.all !== true) return { error: 'all must be true.' };
    return { request: { mode: 'all' } };
  }
  if (record.alertKey !== undefined) {
    if (typeof record.alertKey !== 'string' || !CLIENT_KEY_PATTERN.test(record.alertKey)) return { error: 'alertKey has an invalid format.' };
    return { request: { mode: 'alert', alertKey: record.alertKey } };
  }
  if (!Array.isArray(record.hitIds) || record.hitIds.length === 0) return { error: 'hitIds must be a non-empty array.' };
  if (record.hitIds.length > ALERT_HITS_MAX_MARK) return { error: `Too many hits (max ${ALERT_HITS_MAX_MARK} per request).` };
  if (!record.hitIds.every(id => typeof id === 'string' && UUID.test(id))) return { error: 'Each hit id must be a UUID.' };
  return { request: { mode: 'ids', hitIds: Array.from(new Set((record.hitIds as string[]).map(id => id.toLowerCase()))) } };
}

function logFailure(rpc: string, details: Record<string, unknown>, correlationId: string, startedAt: number) {
  console.error(JSON.stringify({
    kind: 'db-failure', route: 'user/alert-hits', rpc, ...details, elapsedMs: Date.now() - startedAt, correlationId,
  }));
}

function unavailable(correlationId: string, reason: string): Response {
  return envelope(503, {
    ok: false,
    error: 'Alert notifications are not available for this deployment.',
    errorClass: 'unavailable',
    reason,
    correlationId,
  });
}

function dbFailure(rpc: string, error: SupabaseErrorLike, correlationId: string, startedAt: number): Response {
  const code = (error.code || '').toUpperCase();
  logFailure(rpc, { errorClass: code === '28000' ? 'unavailable' : classifyDbError(error).errorClass, code: error.code ?? null, message: error.message ?? null }, correlationId, startedAt);
  if (code === '28000') return unavailable(correlationId, 'identity-assertion');
  // 42883: the 029 functions are not deployed yet — storage, not the request.
  if (code === '42883' || code === 'PGRST202') return unavailable(correlationId, 'not-migrated');
  if (code === '54000') return envelope(413, { ok: false, error: 'Too many hits in one request.', errorClass: 'limit', correlationId });
  if (code === '22023' || code === '22P02' || code === '22007') {
    return envelope(400, { ok: false, error: 'The request did not satisfy the alert-hit contract.', errorClass: 'invalid-request', correlationId });
  }
  const classified = classifyDbError(error);
  return envelope(classified.status, { ok: false, error: classified.publicMessage, errorClass: classified.errorClass, correlationId });
}

/** `identity` must come from requireApiAccess() in the route file. */
export async function handleAlertHitsRequest(request: Request, identity: ApiIdentity): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'PUT') {
    return envelope(405, { ok: false, error: 'Method not allowed.', errorClass: 'invalid-request' });
  }
  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  if (!isEligibleUserDataIdentity(identity)) {
    return envelope(403, { ok: false, error: 'Alert notifications belong to a signed-in account.', errorClass: 'denied', correlationId });
  }
  const rate = await checkResourceRateLimit(request, identity, { operation: 'alert-hits', userLimit: 600, ipLimit: 900 });
  if (!rate.allowed) return rateLimitResponse(rate);

  // Body or parameters first: a malformed request is rejected before any database work.
  let rpc: string;
  let args: Record<string, unknown>;
  let operation: 'list' | 'upsert';
  if (method === 'GET') {
    const parsed = parseAlertHitsQuery(new URL(request.url).searchParams);
    if ('error' in parsed) return invalid(parsed.error);
    operation = 'list';
    rpc = 'urc_user_alert_hits_page';
    args = {
      p_alert_client_key: parsed.query.alertKey,
      p_unseen_only: parsed.query.unseenOnly,
      p_since: parsed.query.since,
      p_offset: parsed.query.offset,
      p_limit: parsed.query.limit,
    };
  } else {
    const body = await readJsonBody(request, MARK_BODY_BYTES);
    if (body.response) return body.response;
    const parsed = validateMarkSeenBody(body.value);
    if ('error' in parsed) return invalid(parsed.error);
    operation = 'upsert';
    rpc = 'urc_user_alert_hits_mark_seen';
    args = {
      p_hit_ids: parsed.request.mode === 'ids' ? parsed.request.hitIds : null,
      p_alert_client_key: parsed.request.mode === 'alert' ? parsed.request.alertKey : null,
      p_all: parsed.request.mode === 'all',
    };
  }

  const secret = userDataSigningSecret();
  if (!secret) return unavailable(correlationId, 'signing-secret');
  const db = getWebSupabase();
  if (!db) return unavailable(correlationId, 'database');

  const assertion = signAlertHitsAssertion({ operation, userId: identity.userId, orgId: identity.orgId, secret });
  let data: unknown;
  try {
    const result = await db.rpc(rpc, { ...args, ...assertion });
    if (result.error) return dbFailure(rpc, result.error, correlationId, startedAt);
    data = result.data;
  } catch (transport) {
    const name = transport instanceof Error ? transport.name : 'UnknownError';
    logFailure(rpc, { errorClass: 'transport', errorName: name }, correlationId, startedAt);
    return envelope(name === 'AbortError' || name === 'TimeoutError' ? 504 : 502, {
      ok: false,
      error: 'Alert notifications did not answer in time. Retry shortly.',
      errorClass: 'transport',
      correlationId,
    });
  }

  const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  if (operation === 'list') {
    return envelope(200, {
      ok: true,
      total: Number(record.total) || 0,
      unseen: Number(record.unseen) || 0,
      unseenAmendments: Number(record.unseenAmendments) || 0,
      byAlert: record.byAlert && typeof record.byAlert === 'object' && !Array.isArray(record.byAlert) ? record.byAlert : {},
      hits: Array.isArray(record.hits) ? record.hits : [],
      correlationId,
    });
  }
  return envelope(200, { ok: true, marked: Number(record.marked) || 0, correlationId });
}
