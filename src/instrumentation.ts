/**
 * Next.js instrumentation hooks (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 *
 * `onRequestError` is the framework's own catch-all: it fires for server
 * errors that escape rendering, server actions, the proxy, and any route
 * handler that is not wrapped by withRouteObservability. One JSON line per
 * error, so the log drain's "unhandled error" alert covers the whole server
 * surface rather than only the routes that remembered to log.
 */

import type { Instrumentation } from 'next';
import { describeRequestError } from './lib/request-error';

export function register(): void {
  // Nothing to boot yet. Reserved for an OpenTelemetry registration when a
  // trace backend is provisioned; until then the structured log lines are
  // the observability surface.
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  console.error(JSON.stringify(describeRequestError(error, request, context)));
};
