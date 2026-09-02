/**
 * The one structured line Next's `onRequestError` hook emits for a server
 * error the framework caught outside a wrapped route handler (rendering,
 * server actions, the proxy). Pure so it can be unit-tested; the hook itself
 * lives in src/instrumentation.ts.
 *
 * Privacy: the path is recorded without its query string (search terms, and
 * on the hosted identity pages a Clerk browser token, travel there), and
 * request headers are never recorded (cookies, authorization).
 */

export interface RequestErrorInput {
  path: string;
  method: string;
}

export interface RequestErrorContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  renderType?: string;
  revalidateReason?: string;
}

export interface RequestErrorLine {
  kind: 'unhandled-request-error';
  method: string;
  path: string;
  routePath: string | null;
  routeType: string | null;
  renderSource: string | null;
  errorName: string;
  errorMessage: string;
  digest: string | null;
  stack: string | null;
}

const MAX_MESSAGE = 300;
const MAX_STACK = 1_500;
const MAX_PATH = 512;

export function describeRequestError(
  error: unknown,
  request: RequestErrorInput,
  context: RequestErrorContext,
): RequestErrorLine {
  const path = (request.path || '').split(/[?#]/, 1)[0].slice(0, MAX_PATH);
  const digest = typeof error === 'object' && error !== null && 'digest' in error
    ? String((error as { digest: unknown }).digest).slice(0, 64)
    : null;
  const errorName = error instanceof Error ? error.name || 'Error' : 'NonError';
  const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, MAX_MESSAGE);
  const stack = error instanceof Error && typeof error.stack === 'string'
    ? error.stack.slice(0, MAX_STACK)
    : null;
  return {
    kind: 'unhandled-request-error',
    method: (request.method || 'GET').toUpperCase(),
    path,
    routePath: context.routePath ?? null,
    routeType: context.routeType ?? null,
    renderSource: context.renderSource ?? null,
    errorName,
    errorMessage,
    digest,
    stack,
  };
}
