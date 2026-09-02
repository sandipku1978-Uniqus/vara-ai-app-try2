/**
 * One observability wrapper for every route handler.
 *
 * Audit 2026-09 ("no operational nervous system"): three of eighteen routes
 * logged a structured completion line and carried a correlation ID; the rest
 * ended in bare console output or nothing, and an unhandled exception surfaced
 * as Next's generic 500 with no server-side record a user report could be
 * joined to.
 *
 * Every wrapped handler now
 *   - runs inside an AsyncLocalStorage scope holding one correlation ID, so
 *     newCorrelationId() in db-observability and any nested diagnostic reuse
 *     it instead of minting a second one;
 *   - returns `x-correlation-id` on the response;
 *   - logs exactly one JSON line per request — kind "route" — with the route
 *     name, method, status, elapsed time, outcome and correlation ID. Never
 *     the query string, body, identity, or headers;
 *   - turns an unhandled exception into a stable envelope
 *     ({ ok: false, error, errorClass: 'unexpected', correlationId }) after
 *     logging kind "route-failure" with the error's name and message.
 *
 * The log lines are the alerting surface: docs/operations/observability.md
 * names the three alerts a log drain should raise on them.
 */

// No `next/server` import on purpose: sec-upstream and db-observability
// import this module, and the Playwright suites load sec-upstream under
// Node's own resolver, where `next/server` does not resolve (see the note in
// the auth spec). The Web `Response` API is all the envelope needs.
import { AsyncLocalStorage } from 'node:async_hooks';

/** What a route module implements: Next passes (request, context). */
export type RouteHandler<Context = unknown> = (
  request: Request,
  context?: Context,
) => Response | Promise<Response>;

/** What the wrapper exports: always async, so callers can `.then()` it. */
export type ObservedRouteHandler<Context = unknown> = (
  request: Request,
  context?: Context,
) => Promise<Response>;

export type RouteOutcome =
  | 'success'
  | 'denied'
  | 'rate-limited'
  | 'client-error'
  | 'error'
  | 'failure'
  | 'cancelled';

interface RouteScope {
  correlationId: string;
  route: string;
}

const scope = new AsyncLocalStorage<RouteScope>();

const CORRELATION_HEADER = 'x-correlation-id';
const MAX_ERROR_MESSAGE = 300;
const MAX_ERROR_STACK = 1_500;
/** Vercel's own request identifier, e.g. "iad1::abcde-1712345678901-0123456789ab". */
const VERCEL_ID = /^[A-Za-z0-9:._-]{1,128}$/;

export function generateCorrelationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** The correlation ID of the request currently being handled, if any. */
export function currentCorrelationId(): string | null {
  return scope.getStore()?.correlationId ?? null;
}

/** The wrapped route currently being handled, if any. */
export function currentRoute(): string | null {
  return scope.getStore()?.route ?? null;
}

export function outcomeForStatus(status: number): RouteOutcome {
  if (status === 401 || status === 403) return 'denied';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'error';
  if (status >= 400) return 'client-error';
  return 'success';
}

function vercelRequestId(request: Request): string | null {
  const value = request.headers.get('x-vercel-id');
  return value && VERCEL_ID.test(value) ? value : null;
}

function withCorrelationHeader(response: Response, correlationId: string): Response {
  try {
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  } catch {
    // Responses built by Response.redirect()/Response.error() and responses
    // passed through from fetch() carry immutable headers. Re-wrap the same
    // body and status so the ID is still returned.
    const copy = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    copy.headers.set(CORRELATION_HEADER, correlationId);
    return copy;
  }
}

function describeError(error: unknown): { errorName: string; errorMessage: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      errorName: error.name || 'Error',
      errorMessage: (error.message || '').slice(0, MAX_ERROR_MESSAGE),
      stack: typeof error.stack === 'string' ? error.stack.slice(0, MAX_ERROR_STACK) : null,
    };
  }
  return { errorName: 'NonError', errorMessage: String(error).slice(0, MAX_ERROR_MESSAGE), stack: null };
}

interface RouteLogLine {
  kind: 'route' | 'route-failure';
  route: string;
  method: string;
  status: number;
  outcome: RouteOutcome;
  elapsedMs: number;
  correlationId: string;
  vercelId?: string;
  errorName?: string;
  errorMessage?: string;
  stack?: string | null;
}

function emit(line: RouteLogLine): void {
  const serialized = JSON.stringify(line);
  if (line.status >= 500) console.error(serialized);
  else console.info(serialized);
}

/**
 * Wrap a route handler. `route` is a stable, low-cardinality name (the path
 * under /api, e.g. 'letters/summary') — never derived from the request URL, so
 * an alert query cannot be diluted by path variants.
 */
export function withRouteObservability<Context = unknown>(
  route: string,
  handler: RouteHandler<Context>,
): ObservedRouteHandler<Context> {
  return async function observedRoute(request: Request, context?: Context): Promise<Response> {
    const correlationId = generateCorrelationId();
    const startedAt = Date.now();
    const method = (request?.method || 'GET').toUpperCase();
    const vercelId = request ? vercelRequestId(request) : null;
    const base = { route, method, correlationId, ...(vercelId ? { vercelId } : {}) };

    return scope.run({ correlationId, route }, async () => {
      try {
        const response = withCorrelationHeader(await handler(request, context), correlationId);
        emit({
          kind: 'route',
          ...base,
          status: response.status,
          outcome: outcomeForStatus(response.status),
          elapsedMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        const cancelled = request?.signal?.aborted === true;
        const status = cancelled ? 499 : 500;
        emit({
          kind: 'route-failure',
          ...base,
          status,
          outcome: cancelled ? 'cancelled' : 'failure',
          elapsedMs: Date.now() - startedAt,
          ...describeError(error),
        });
        return Response.json(
          {
            ok: false,
            error: cancelled
              ? 'Request cancelled.'
              : 'The request failed unexpectedly. Retry; quote the correlation ID if it persists.',
            errorClass: cancelled ? 'cancelled' : 'unexpected',
            correlationId,
          },
          { status, headers: { 'Cache-Control': 'no-store', [CORRELATION_HEADER]: correlationId } },
        );
      }
    });
  };
}
