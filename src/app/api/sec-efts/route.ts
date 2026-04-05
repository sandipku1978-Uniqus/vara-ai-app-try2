import { NextResponse } from 'next/server';

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');

  if (!path) {
    return new NextResponse('Missing path parameter', { status: 400 });
  }

  const baseUrl = 'https://efts.sec.gov';

  const proxyParams = new URLSearchParams(url.searchParams);
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
    });

    if (!upstreamRes.ok) {
      return new NextResponse(upstreamRes.statusText, { status: upstreamRes.status });
    }

    const buffer = await upstreamRes.arrayBuffer();

    const headers = new Headers();
    const contentType = upstreamRes.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    headers.set('Access-Control-Allow-Origin', '*');

    return new NextResponse(buffer, {
      status: 200,
      headers
    });
  } catch (error: any) {
    console.error('SEC EFTS Proxy Error:', error);
    return new NextResponse('Proxy Fetch Error', { status: 500 });
  }
}
