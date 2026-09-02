/**
 * Typed database failure classes + correlated diagnostics (handoff WP0/WP1).
 *
 * Routes used to flatten every Supabase error into a generic 502, which made
 * an outage indistinguishable from a deployment defect. The distinction
 * matters operationally: a statement timeout or transient outage heals by
 * itself; a permission failure (42501) or missing/stale RPC (PGRST202) means
 * the deployed code and the database contract have drifted and MUST fail a
 * release gate. Each failure logs one structured line keyed by a correlation
 * ID that is also returned to the client, so a user report can be joined to
 * the server-side diagnostic without guessing. Public messages never carry
 * SQL, table names, or credentials.
 */

import { NextResponse } from 'next/server';
import { currentCorrelationId, generateCorrelationId } from './route-observability';

export type DbErrorClass =
  | 'permission'
  | 'missing-rpc'
  | 'statement-timeout'
  | 'rate-limited'
  | 'invalid-request'
  | 'unexpected';

export interface SupabaseErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export function classifyDbError(error: SupabaseErrorLike | null | undefined): {
  errorClass: DbErrorClass;
  status: number;
  publicMessage: string;
} {
  const code = (error?.code || '').toUpperCase();
  switch (code) {
    case '42501':
      // Deployment defect: the web identity lacks a grant the route needs.
      return { errorClass: 'permission', status: 500, publicMessage: 'The data service is misconfigured (permission). This is a deployment defect, not a data condition.' };
    case 'PGRST202':
      // Deployment defect: the RPC the code calls is missing or the PostgREST
      // schema cache is stale after a migration.
      return { errorClass: 'missing-rpc', status: 500, publicMessage: 'The data service is misconfigured (missing function). This is a deployment defect, not a data condition.' };
    case '57014':
      return { errorClass: 'statement-timeout', status: 504, publicMessage: 'The query exceeded its time limit. Narrow the filters and retry.' };
    case 'PGRST429':
    case '53400':
      return { errorClass: 'rate-limited', status: 429, publicMessage: 'The data service is briefly rate-limited. Retry shortly.' };
    case '22P02':
    case '22007':
      return { errorClass: 'invalid-request', status: 400, publicMessage: 'The request carried an invalid parameter value.' };
    default:
      return { errorClass: 'unexpected', status: 502, publicMessage: 'The data service failed unexpectedly. Retry; results are not a verified zero.' };
  }
}

/**
 * Inside a route wrapped by withRouteObservability this is the request's
 * correlation ID, so the route line and the db-failure line join on one
 * value; outside one (tests, scripts) it mints a fresh ID.
 */
export function newCorrelationId(): string {
  return currentCorrelationId() ?? generateCorrelationId();
}

/**
 * One structured diagnostic line + one stable public error envelope for a
 * failed database call. The private line carries route, RPC, class, code and
 * elapsed time; the public body carries only the class, a safe message, and
 * the correlation ID that joins the two.
 */
export function dbErrorResponse(options: {
  route: string;
  rpc: string;
  error: SupabaseErrorLike | null | undefined;
  correlationId: string;
  startedAt: number;
}): NextResponse {
  const { route, rpc, error, correlationId, startedAt } = options;
  const classified = classifyDbError(error);
  console.error(
    JSON.stringify({
      kind: 'db-failure',
      route,
      rpc,
      errorClass: classified.errorClass,
      code: error?.code ?? null,
      message: error?.message ?? null,
      elapsedMs: Date.now() - startedAt,
      correlationId,
    }),
  );
  return NextResponse.json(
    { ok: false, error: classified.publicMessage, errorClass: classified.errorClass, correlationId },
    { status: classified.status },
  );
}
