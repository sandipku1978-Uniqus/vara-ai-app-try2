/**
 * A fetch that cannot hang.
 *
 * Audit 2026-09: "no Supabase call carries a timeout." The database side
 * bounds statement time (urc_web: 20 s, service_role: 600 s), but a TCP
 * connection that stalls before or after the statement is invisible to
 * Postgres, and supabase-js will wait for it until the platform kills the
 * function — leaving leases, locks and reservations un-released. Passing
 * this as the client's `global.fetch` gives every request an HTTP deadline
 * that fires just after the statement budget, so the caller receives an
 * AbortError it can classify instead of a platform kill.
 */

export function combineSignals(...signals: Array<AbortSignal | null | undefined>): AbortSignal {
  const present = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (present.length === 1) return present[0];
  const controller = new AbortController();
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Wrap `fetch` so every call aborts after `deadlineMs` unless the caller's
 * own signal fires first. The timer is cleared as soon as the response
 * headers arrive; body streaming is bounded by the callers' own readers.
 */
export function fetchWithDeadline(deadlineMs: number, baseFetch: FetchLike = fetch): FetchLike {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new RangeError('fetchWithDeadline needs a positive deadline in milliseconds.');
  }
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException(`Request exceeded its ${deadlineMs} ms deadline.`, 'TimeoutError')),
      deadlineMs,
    );
    try {
      return await baseFetch(input, { ...init, signal: combineSignals(init?.signal, controller.signal) });
    } finally {
      clearTimeout(timer);
    }
  };
}
