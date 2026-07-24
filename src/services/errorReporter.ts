/**
 * Client-error reporting.
 *
 * Sends unhandled client errors to /api/client-error so they land in the
 * platform logs instead of only the reporter's devtools. Deliberately tiny and
 * dependency-free: no vendor account is required to make pilot bug reports
 * actionable, and a log drain can forward these to a real tracker later.
 *
 * Reporting must never itself break the page, so every failure path is silent.
 */

interface ReportableError {
  name?: string;
  message?: string;
  stack?: string;
  digest?: string;
}

/** Same-error storms (render loops) should not become log floods. */
const recentlyReported = new Set<string>();
const REPORT_TTL_MS = 30_000;

export function reportClientError(error: ReportableError, context?: { route?: string }): void {
  if (typeof window === 'undefined') return;

  const signature = `${error.name}:${error.message}`.slice(0, 200);
  if (recentlyReported.has(signature)) return;
  recentlyReported.add(signature);
  window.setTimeout(() => recentlyReported.delete(signature), REPORT_TTL_MS);

  const body = JSON.stringify({
    name: error.name,
    message: error.message,
    stack: error.stack,
    digest: error.digest,
    // Path only — the server strips any query string too, but never send one.
    route: context?.route ?? window.location.pathname,
  });

  try {
    // keepalive lets the report survive the navigation/reload that often
    // follows a crash; fetch failures are swallowed by design.
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let telemetry throw into the error path it is reporting on.
  }
}
