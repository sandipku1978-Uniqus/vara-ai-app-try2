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

function normalizePath(value) {
  if (Array.isArray(value)) {
    return value.join('/');
  }
  return String(value || '').replace(/^\/+/, '');
}

function appendQueryParams(url, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (key === 'path' || value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.append(key, String(value));
    }
  }
}

function copyRequestHeaders(req) {
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
  };

  for (const [key, value] of Object.entries(req.headers || {})) {
    const lower = key.toLowerCase();
    if (!REQUEST_HEADER_ALLOWLIST.has(lower)) continue;
    if (value == null) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  return headers;
}

function rewriteSecAbsoluteLinks(text) {
  return text
    .replace(/https:\/\/www\.sec\.gov\/assets\//gi, '/sec-proxy/assets/')
    .replace(/https:\/\/www\.sec\.gov\/(Archives|ix|ixviewer|include|files|cdata|js|css|images)\//gi, '/$1/')
    .replace(/https:\/\/www\.sec\.gov\//gi, '/sec-proxy/')
    .replace(/https:\/\/data\.sec\.gov\//gi, '/sec-data/')
    .replace(/https:\/\/efts\.sec\.gov\//gi, '/sec-efts/')
    .replace(/([("'=\s])\/assets\//g, '$1/sec-proxy/assets/');
}

function writeResponseHeaders(res, headers) {
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (RESPONSE_HEADER_BLACKLIST.has(lower)) continue;
    res.setHeader(key, value);
  }
}

export async function proxySecRequest(req, res, upstreamBaseUrl) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  const path = normalizePath(req.query?.path);
  const targetUrl = new URL(path, `${upstreamBaseUrl.replace(/\/$/, '')}/`);
  appendQueryParams(targetUrl, req.query);

  const upstreamResponse = await fetch(targetUrl, {
    method: req.method,
    headers: copyRequestHeaders(req),
    redirect: 'follow',
  });

  res.statusCode = upstreamResponse.status;
  writeResponseHeaders(res, upstreamResponse.headers);

  const contentType = upstreamResponse.headers.get('content-type') || '';
  if (contentType.includes('text/html') || contentType.includes('text/css') || contentType.includes('application/xhtml+xml')) {
    const text = await upstreamResponse.text();
    res.end(rewriteSecAbsoluteLinks(text));
    return;
  }

  const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
  res.end(buffer);
}
