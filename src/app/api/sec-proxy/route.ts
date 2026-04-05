import { NextResponse } from 'next/server';

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

const UPSTREAM_URLS: Record<string, string> = {
  proxy: 'https://www.sec.gov',
  data: 'https://data.sec.gov',
  efts: 'https://efts.sec.gov',
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const upstream = url.searchParams.get('upstream') || 'proxy';
  const path = url.searchParams.get('path');

  if (!path || path.includes('..')) {
    return new NextResponse('Invalid path parameter', { status: 400 });
  }

  const baseUrl = UPSTREAM_URLS[upstream];
  if (!baseUrl) {
    return new NextResponse('Invalid upstream parameter', { status: 400 });
  }

  // Forward remaining search params as query string for the upstream URL.
  // We need to strip out our internal routing params first.
  const proxyParams = new URLSearchParams(url.searchParams);
  proxyParams.delete('upstream');
  proxyParams.delete('path');
  const qs = proxyParams.toString();
  const targetUrl = `${baseUrl}/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate',
      },
      next: { revalidate: 3600 } // Add Next.js static cache proxying for 1 hr
    });

    // If it's a 403 or 429, forward it back
    if (!upstreamRes.ok) {
      return new NextResponse(upstreamRes.statusText, { status: upstreamRes.status });
    }

    // Stream the buffer data back directly bypassing text parsing to support binary too
    const buffer = await upstreamRes.arrayBuffer();

    const headers = new Headers();
    // Copy the exact content-type back
    const contentType = upstreamRes.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    

    return new NextResponse(buffer, {
      status: 200,
      headers
    });
  } catch (error: unknown) {
    console.error('SEC Proxy API Error:', error);
    return new NextResponse('Proxy Fetch Error', { status: 500 });
  }
}
