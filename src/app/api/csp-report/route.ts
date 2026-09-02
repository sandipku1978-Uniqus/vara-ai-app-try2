import { sanitizeCspReports } from '../../../lib/csp-report';
import { checkLocalRateLimit, localRateLimitResponse } from '../../../lib/local-rate-limit';
import { withRouteObservability } from '../../../lib/route-observability';

export const maxDuration = 10;

const MAX_BODY_BYTES = 16_384;
const ACCEPTED_CONTENT_TYPES = new Set([
  'application/csp-report',
  'application/reports+json',
  'application/json',
]);

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    result += decoder.decode(value, { stream: true });
  }

  return result + decoder.decode();
}

/**
 * Public by browser necessity: CSP reports are sent outside application auth.
 * The handler is IP-limited, byte-bounded, and logs only an allowlisted,
 * query-free representation of a violation. The limit is per instance, not
 * KV: browsers send these outside any session, and a KV incident must not
 * turn violation reports into 503 noise.
 */
async function handlePost(request: Request) {
  const rate = checkLocalRateLimit(request, { operation: 'csp-report', ipLimit: 120 });
  if (!rate.allowed) return localRateLimitResponse(rate);

  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    return new Response(null, { status: 415, headers: { 'Cache-Control': 'no-store' } });
  }

  const raw = await readBoundedBody(request);
  if (raw === null) {
    return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const reports = sanitizeCspReports(JSON.parse(raw));
    for (const report of reports) console.warn(JSON.stringify(report));
  } catch {
    return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export const POST = withRouteObservability('csp-report', handlePost);
