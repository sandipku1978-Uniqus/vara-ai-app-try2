import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import {
  buildSecTargetUrl,
  bytesToArrayBuffer,
  fetchSecResponse,
  parseAndValidateEftsPayload,
  readResponseWithLimit,
  SecUpstreamError,
} from '../../../lib/sec-upstream';
import { withRouteObservability } from '../../../lib/route-observability';

/** Platform budget (seconds). One paced EFTS request; pacing waits under load can precede the 12 s fetch and 12 s body read. */
export const maxDuration = 60;

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

async function handleGet(request: Request) {
  const access = await requireApiAccess(true, '/api/sec-efts', 'GET');
  if (access.response) return access.response;

  const requestUrl = new URL(request.url);
  const rawPath = requestUrl.searchParams.get('path');
  if (!rawPath) return NextResponse.json({ error: 'Invalid SEC search request.' }, { status: 400 });
  const proxyParams = new URLSearchParams(requestUrl.searchParams);
  proxyParams.delete('path');

  try {
    const targetUrl = buildSecTargetUrl('efts', rawPath, proxyParams);
    const rate = await checkResourceRateLimit(request, access.identity, {
      operation: 'sec-efts',
      userLimit: 120,
      orgLimit: 600,
      ipLimit: 180,
    });
    if (!rate.allowed) return rateLimitResponse(rate);

    const upstreamResponse = await fetchSecResponse(targetUrl, 'efts', request.signal, USER_AGENT);
    if (!upstreamResponse.ok) {
      const status = upstreamResponse.status >= 400 && upstreamResponse.status <= 599
        ? upstreamResponse.status
        : 502;
      return NextResponse.json({ error: 'SEC search upstream request failed.' }, { status });
    }
    const bytes = await readResponseWithLimit(upstreamResponse, MAX_RESPONSE_BYTES, request.signal);
    parseAndValidateEftsPayload(upstreamResponse.headers.get('content-type'), bytes);
    return new NextResponse(bytesToArrayBuffer(bytes), {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof SecUpstreamError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (request.signal.aborted) {
      return NextResponse.json({ error: 'Request cancelled.' }, { status: 499 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'SEC search upstream timed out.' }, { status: 504 });
    }
    console.error('SEC EFTS proxy failed:', error);
    return NextResponse.json({ error: 'SEC search proxy request failed.' }, { status: 502 });
  }
}

export const GET = withRouteObservability('sec-efts', handleGet);
