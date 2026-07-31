/**
 * POST /api/client-error — structured client-error sink.
 *
 * Pilot bug reports used to arrive as "it didn't work" with nothing to
 * correlate: 97 console.* calls only ever reached the reporter's own devtools.
 * This writes one structured line per unhandled client error into the platform
 * function logs, which a log drain can forward to a real tracker later without
 * changing any calling code.
 *
 * Privacy contract (same rule the analytics layer follows): never accept or
 * emit raw queries, filing text, issuer names, tickers, accessions, URL
 * parameters, or filter values. Only the error identity, a trimmed stack, and
 * the route path are recorded — everything else is dropped here rather than
 * trusted from the client.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';

const MAX_FIELD = 512;
const MAX_STACK = 4_000;
const MAX_BODY_BYTES = 16_000;

/** Path only — a query string can carry the user's search terms. */
function safePath(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const path = value.split(/[?#]/, 1)[0];
  return path.slice(0, MAX_FIELD);
}

function safeText(value: unknown, limit = MAX_FIELD): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

export async function POST(request: Request) {
  // Authenticated like every other handler — an unauthenticated write endpoint
  // is log-flood surface, and in an internal pilot the errors worth seeing all
  // happen in signed-in views. Entitlement is NOT required: an unentitled user
  // hitting a bug is exactly who we want to hear from. Known limitation: errors
  // on public pages (/, /support, /privacy, /terms) and during auth failure are
  // not captured.
  const access = await requireApiAccess(false);
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(
    request,
    access.identity,
    { operation: 'client-error', userLimit: 60, ipLimit: 120 }
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'Report too large.' }, { status: 413 });
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid report body.' }, { status: 400 });
  }

  const report = {
    kind: 'client-error',
    name: safeText(payload.name) || 'Error',
    message: safeText(payload.message),
    // `digest` is Next's server-error correlation id — the single most useful
    // field for matching a user report to a server log line.
    digest: safeText(payload.digest, 64),
    route: safePath(payload.route),
    stack: safeText(payload.stack, MAX_STACK),
    at: new Date().toISOString(),
  };

  // One line, structured: greppable in `vercel logs`, parseable by a drain.
  console.error(JSON.stringify(report));

  return NextResponse.json({ ok: true });
}
