const DEFAULT_USER_AGENT =
  process.env.EDGAR_USER_AGENT ||
  process.env.VITE_EDGAR_USER_AGENT ||
  'Vara AI Research App contact@vara.ai';

const RESPONSE_HEADER_BLACKLIST = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'server',
]);

const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'content-type',
  'if-none-match',
  'if-modified-since',
  'range',
]);

function rewriteSecAbsoluteLinks(text) {
  return text
    .replace(/https:\/\/www\.sec\.gov\/assets\//gi, '/sec-proxy/assets/')
    .replace(/https:\/\/www\.sec\.gov\/(Archives|ix|ixviewer|include|files|cdata|js|css|images)\//gi, '/$1/')
    .replace(/https:\/\/www\.sec\.gov\//gi, '/sec-proxy/')
    .replace(/https:\/\/data\.sec\.gov\//gi, '/sec-data/')
    .replace(/https:\/\/efts\.sec\.gov\//gi, '/sec-efts/')
    .replace(/([("'=\s])\/assets\//g, '$1/sec-proxy/assets/');
}

function copyRequestHeaders(request) {
  const headers = new Headers();
  headers.set('User-Agent', DEFAULT_USER_AGENT);

  for (const [key, value] of request.headers.entries()) {
    if (REQUEST_HEADER_ALLOWLIST.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  return headers;
}

function buildTargetUrl(request, upstreamBaseUrl) {
  const incomingUrl = new URL(request.url);
  const path = (incomingUrl.searchParams.get('path') || '').replace(/^\/+/, '');
  const targetUrl = new URL(path, `${upstreamBaseUrl.replace(/\/$/, '')}/`);

  for (const [key, value] of incomingUrl.searchParams.entries()) {
    if (key !== 'path') {
      targetUrl.searchParams.append(key, value);
    }
  }

  return targetUrl;
}

function filterResponseHeaders(upstreamHeaders) {
  const headers = new Headers();
  for (const [key, value] of upstreamHeaders.entries()) {
    if (!RESPONSE_HEADER_BLACKLIST.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function proxySecRequest(request, upstreamBaseUrl) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  try {
    const upstreamResponse = await fetch(buildTargetUrl(request, upstreamBaseUrl), {
      method: request.method,
      headers: copyRequestHeaders(request),
      redirect: 'follow',
    });

    const headers = filterResponseHeaders(upstreamResponse.headers);
    const contentType = upstreamResponse.headers.get('content-type') || '';

    if (contentType.includes('text/html') || contentType.includes('text/css') || contentType.includes('application/xhtml+xml')) {
      const rewrittenText = rewriteSecAbsoluteLinks(await upstreamResponse.text());
      return new Response(rewrittenText, {
        status: upstreamResponse.status,
        headers,
      });
    }

    return new Response(await upstreamResponse.arrayBuffer(), {
      status: upstreamResponse.status,
      headers,
    });
  } catch (error) {
    console.error('SEC proxy request failed:', error);
    return Response.json({ error: 'SEC proxy request failed' }, { status: 502 });
  }
}
