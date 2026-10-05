import { timingSafeEqual } from 'node:crypto';
import { BODY_READ_TIMEOUT_MS, BodyReadError, readBodyBytes } from '../../../../lib/ai-input';
import { getUserWriterSupabase } from '../../../../lib/supabase-web';
import { createSupabaseSearchJobStore, type SearchJobStore } from './store';

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ ok: false, error, ...extra }, status);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** The writer-backed store, or null when the deployment has no writer
 *  credential (routes answer 503 rather than degrade silently). */
export function searchJobStore(): SearchJobStore | null {
  const db = getUserWriterSupabase();
  return db ? createSupabaseSearchJobStore(db) : null;
}

export const STORE_UNAVAILABLE = 'Search continuation is not configured for this deployment.';

/**
 * Vercel Cron authenticates with `Authorization: Bearer $CRON_SECRET`. Fails
 * closed when the secret is not configured; constant-time comparison.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const presented = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The JSON body of a worker/owner route (search-jobs, alerts evaluate), read
 * through the bounded reader: at most `maxBytes` bytes, never buffered past
 * the cap, with a read timeout. An empty body is `{}`; failures are the
 * routes' `{ ok: false, error }` envelope (413 too large, 400 not JSON, 408
 * timed out, 499 client cancelled).
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
  timeoutMs = BODY_READ_TIMEOUT_MS,
): Promise<unknown | Response> {
  let bytes: Uint8Array;
  try {
    bytes = await readBodyBytes(request, maxBytes, timeoutMs);
  } catch (error) {
    if (error instanceof BodyReadError) return jsonError(error.status, error.message);
    return jsonError(400, 'Request body must be valid JSON.');
  }
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return jsonError(400, 'Request body must be valid JSON.');
  }
}
