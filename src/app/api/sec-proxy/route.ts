import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import {
  buildSecTargetUrl,
  bytesToArrayBuffer,
  fetchSecResponse,
  readResponseWithLimit,
  sanitizeSecHtml,
  SEC_DOCUMENT_CSP,
  SecUpstreamError,
  type SecUpstream,
} from '../../../lib/sec-upstream';

/** The platform default would kill this route mid-flight; see the in-route budgets. */
export const maxDuration = 60;

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

function safeHeaders(contentType: string, html: boolean): Headers {
  const headers = new Headers({
    'Cache-Control': 'private, max-age=300',
    'Content-Type': contentType,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  if (html) headers.set('Content-Security-Policy', SEC_DOCUMENT_CSP);
  return headers;
}

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const requestUrl = new URL(request.url);
  const rawUpstream = requestUrl.searchParams.get('upstream') || 'proxy';
  const rawPath = requestUrl.searchParams.get('path');
  if (!rawPath || !['proxy', 'data'].includes(rawUpstream)) {
    return NextResponse.json({ error: 'Invalid SEC proxy request.' }, { status: 400 });
  }

  const upstream = rawUpstream as SecUpstream;
  // Callers doing text validation pass trunc=1 so an oversized filing is
  // clipped to the byte cap and still validated, rather than 413-dropped.
  const truncateOversized = requestUrl.searchParams.get('trunc') === '1';
  const proxyParams = new URLSearchParams(requestUrl.searchParams);
  proxyParams.delete('upstream');
  proxyParams.delete('path');
  proxyParams.delete('trunc');

  try {
    const targetUrl = buildSecTargetUrl(upstream, rawPath, proxyParams);
    const rate = await checkResourceRateLimit(request, access.identity, {
      operation: 'sec-proxy',
      userLimit: 180,
      orgLimit: 900,
      ipLimit: 240,
    });
    if (!rate.allowed) return rateLimitResponse(rate);

    const upstreamResponse = await fetchSecResponse(targetUrl, upstream, request.signal, USER_AGENT);
    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status >= 400 && upstreamResponse.status <= 599
        ? upstreamResponse.status
        : 502;
      return NextResponse.json({ error: 'SEC upstream request failed.' }, { status });
    }

    const bytes = await readResponseWithLimit(upstreamResponse, MAX_RESPONSE_BYTES, request.signal, 12_000, truncateOversized);
    const contentType = (upstreamResponse.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      const html = new TextDecoder('utf-8').decode(bytes);
      const sanitized = sanitizeSecHtml(html, targetUrl);
      return new NextResponse(sanitized, {
        status: 200,
        headers: safeHeaders('text/html; charset=utf-8', true),
      });
    }
    if (contentType.includes('json')) {
      return new NextResponse(bytesToArrayBuffer(bytes), {
        status: 200,
        headers: safeHeaders('application/json; charset=utf-8', false),
      });
    }
    if (contentType.startsWith('image/')) {
      if (!/^image\/(?:png|jpe?g|gif|webp)(?:;|$)/i.test(contentType)) {
        return NextResponse.json({ error: 'Unsupported SEC image type.' }, { status: 415 });
      }
      return new NextResponse(bytesToArrayBuffer(bytes), {
        status: 200,
        headers: safeHeaders(contentType, false),
      });
    }
    if (contentType.includes('text/plain') || contentType.includes('xml')) {
      return new NextResponse(bytesToArrayBuffer(bytes), {
        status: 200,
        headers: safeHeaders('text/plain; charset=utf-8', false),
      });
    }
    return NextResponse.json({ error: 'Unsupported SEC response type.' }, { status: 415 });
  } catch (error) {
    if (error instanceof SecUpstreamError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (request.signal.aborted) {
      return NextResponse.json({ error: 'Request cancelled.' }, { status: 499 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'SEC upstream timed out.' }, { status: 504 });
    }
    console.error('SEC proxy failed:', error);
    return NextResponse.json({ error: 'SEC proxy request failed.' }, { status: 502 });
  }
}
