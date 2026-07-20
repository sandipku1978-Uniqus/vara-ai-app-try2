import sanitizeHtml from 'sanitize-html';

export type SecUpstream = 'proxy' | 'data' | 'efts';

const UPSTREAM_ORIGINS: Record<SecUpstream, string> = {
  proxy: 'https://www.sec.gov',
  data: 'https://data.sec.gov',
  efts: 'https://efts.sec.gov',
};

const QUERY_KEYS: Record<SecUpstream, Set<string>> = {
  proxy: new Set(['action', 'CIK', 'type', 'dateb', 'owner', 'count', 'output', 'search']),
  data: new Set(),
  efts: new Set(['q', 'forms', 'dateRange', 'startdt', 'enddt', 'entityName', 'from', 'size']),
};

const SAFE_HTML_TAGS = [
  'html', 'head', 'body', 'title', 'main', 'header', 'footer', 'nav', 'article', 'section',
  'div', 'span', 'p', 'br', 'hr', 'address', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'i', 'em', 'u', 's', 'small',
  'sup', 'sub', 'mark', 'abbr', 'time', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'a', 'img',
  'ix:header', 'ix:hidden', 'ix:references', 'ix:resources', 'ix:nonnumeric',
  'ix:nonfraction', 'ix:continuation', 'xbrli:context', 'xbrli:unit',
];

const SAFE_STYLE_RULES: Record<string, RegExp[]> = {
  color: [/^[-#(),.%\sa-z0-9]+$/i],
  'background-color': [/^[-#(),.%\sa-z0-9]+$/i],
  'font-family': [/^[-,"'\sa-z0-9]+$/i],
  'font-size': [/^[-.\sa-z0-9%]+$/i],
  'font-style': [/^[a-z-]+$/i],
  'font-weight': [/^[a-z0-9-]+$/i],
  'line-height': [/^[-.\sa-z0-9%]+$/i],
  'text-align': [/^[a-z-]+$/i],
  'text-decoration': [/^[a-z\s-]+$/i],
  'text-indent': [/^[-.\sa-z0-9%]+$/i],
  'vertical-align': [/^[-.\sa-z0-9%]+$/i],
  'white-space': [/^[a-z-]+$/i],
  width: [/^[-.\sa-z0-9%]+$/i],
  height: [/^[-.\sa-z0-9%]+$/i],
  'max-width': [/^[-.\sa-z0-9%]+$/i],
  'min-width': [/^[-.\sa-z0-9%]+$/i],
  display: [/^(?:block|inline|inline-block|table|table-row|table-cell|none)$/i],
  margin: [/^[-.\sa-z0-9%]+$/i],
  'margin-top': [/^[-.\sa-z0-9%]+$/i],
  'margin-right': [/^[-.\sa-z0-9%]+$/i],
  'margin-bottom': [/^[-.\sa-z0-9%]+$/i],
  'margin-left': [/^[-.\sa-z0-9%]+$/i],
  padding: [/^[-.\sa-z0-9%]+$/i],
  'padding-top': [/^[-.\sa-z0-9%]+$/i],
  'padding-right': [/^[-.\sa-z0-9%]+$/i],
  'padding-bottom': [/^[-.\sa-z0-9%]+$/i],
  'padding-left': [/^[-.\sa-z0-9%]+$/i],
  border: [/^[-#(),.%\sa-z0-9]+$/i],
  'border-top': [/^[-#(),.%\sa-z0-9]+$/i],
  'border-right': [/^[-#(),.%\sa-z0-9]+$/i],
  'border-bottom': [/^[-#(),.%\sa-z0-9]+$/i],
  'border-left': [/^[-#(),.%\sa-z0-9]+$/i],
  'border-collapse': [/^(?:collapse|separate)$/i],
};

export class SecUpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

function validPath(upstream: SecUpstream, pathname: string): boolean {
  if (pathname.length > 2048 || !pathname.startsWith('/')) return false;
  const segments = pathname.split('/');
  if (segments.some(segment => segment === '.' || segment === '..')) return false;

  if (upstream === 'proxy') {
    return pathname === '/files/company_tickers.json'
      || pathname === '/cgi-bin/browse-edgar'
      || pathname === '/search-filings/standard-industrial-classification-sic-code-list'
      || pathname === '/litigation/litreleases.htm'
      || pathname === '/enforcement-litigation/litigation-releases'
      || /^\/enforcement-litigation\/litigation-releases\/lr-\d+$/.test(pathname)
      || pathname === '/rules-regulations/rulemaking-activity'
      || pathname === '/rules-regulations/staff-guidance'
      || pathname === '/rules-regulations/no-action-interpretive-exemptive-letters/division-corporation-finance-no-action'
      || pathname === '/rules-regulations/no-action-interpretive-exemptive-letters/division-trading-markets-no-action'
      || pathname === '/divisions/investment/noaction/noaction.htm'
      || /^\/rules-regulations\/\d{4}\/\d{2}\/[A-Za-z0-9._~-]+$/.test(pathname)
      || /^\/Archives\/edgar\/data\/\d{1,10}\/[A-Za-z0-9._~!$&'()+,;=@%-]+(?:\/[A-Za-z0-9._~!$&'()+,;=@%-]+)*$/.test(pathname);
  }
  if (upstream === 'data') {
    return /^\/submissions\/[A-Za-z0-9._-]+\.json$/.test(pathname)
      || /^\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(pathname);
  }
  return pathname === '/LATEST/search-index';
}

function queryAllowed(upstream: SecUpstream, pathname: string, params: URLSearchParams): boolean {
  if (params.toString().length > 6000 || [...params].length > 20) return false;
  if (
    upstream === 'proxy'
    && pathname !== '/cgi-bin/browse-edgar'
    && pathname !== '/rules-regulations/rulemaking-activity'
    && params.size > 0
  ) return false;
  const allowed = QUERY_KEYS[upstream];
  return [...params].every(([key, value]) => allowed.has(key) && value.length <= 4000);
}

export function buildSecTargetUrl(
  upstream: SecUpstream,
  rawPath: string,
  params: URLSearchParams
): URL {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new SecUpstreamError('Invalid SEC path.', 400);
  }
  const pathname = `/${decodedPath.replace(/^\/+/, '')}`;
  if (!validPath(upstream, pathname) || !queryAllowed(upstream, pathname, params)) {
    throw new SecUpstreamError('SEC path or query is not allowed.', 400);
  }
  const target = new URL(pathname, UPSTREAM_ORIGINS[upstream]);
  target.search = params.toString();
  return target;
}

export function validateSecRedirect(target: URL, upstream: SecUpstream): void {
  const expected = new URL(UPSTREAM_ORIGINS[upstream]);
  if (
    target.protocol !== 'https:'
    || target.origin !== expected.origin
    || !validPath(upstream, target.pathname)
    || !queryAllowed(upstream, target.pathname, target.searchParams)
  ) {
    throw new SecUpstreamError('SEC redirect target was rejected.', 502);
  }
}

function safeImageUrl(value: string | undefined, documentUrl: URL): string | undefined {
  if (!value) return undefined;
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  try {
    const parsed = new URL(value, documentUrl);
    const secHost = parsed.hostname === 'sec.gov' || parsed.hostname.endsWith('.sec.gov');
    return parsed.protocol === 'https:' && secHost ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeLinkUrl(value: string | undefined, documentUrl: URL): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('#')) return value;
  try {
    const parsed = new URL(value, documentUrl);
    const secHost = parsed.hostname === 'sec.gov' || parsed.hostname.endsWith('.sec.gov');
    return parsed.protocol === 'https:' && secHost ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Remove all executable/navigating markup while retaining filing structure. */
export function sanitizeSecHtml(html: string, documentUrl: URL): string {
  return sanitizeHtml(html, {
    allowedTags: SAFE_HTML_TAGS,
    allowedAttributes: {
      '*': ['class', 'id', 'title', 'lang', 'dir', 'style', 'aria-*', 'data-*'],
      a: ['href', 'name', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      col: ['span', 'width'],
      th: ['colspan', 'rowspan', 'scope', 'headers', 'width', 'height'],
      td: ['colspan', 'rowspan', 'headers', 'width', 'height'],
      time: ['datetime'],
      'ix:nonnumeric': ['contextref', 'name', 'format', 'continuedat', 'escape'],
      'ix:nonfraction': ['contextref', 'name', 'format', 'unitref', 'decimals', 'scale', 'sign'],
      'ix:continuation': ['continuedat'],
    },
    allowedSchemes: ['https'],
    allowedSchemesByTag: { img: ['https', 'data'] },
    allowedStyles: { '*': SAFE_STYLE_RULES },
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template'],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          href: safeLinkUrl(attribs.href, documentUrl) || '',
        },
      }),
      img: (_tagName, attribs) => {
        const src = safeImageUrl(attribs.src, documentUrl);
        const safeAttributes: Record<string, string> = {};
        for (const key of ['alt', 'title', 'width', 'height']) {
          if (attribs[key]) safeAttributes[key] = attribs[key];
        }
        if (src) safeAttributes.src = src;
        return {
          tagName: 'img',
          attribs: safeAttributes,
        };
      },
    },
  });
}

export async function fetchSecResponse(
  initialTarget: URL,
  upstream: SecUpstream,
  requestSignal: AbortSignal,
  userAgent: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const abortFromRequest = () => controller.abort(requestSignal.reason);
  requestSignal.addEventListener('abort', abortFromRequest, { once: true });
  let target = initialTarget;

  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await fetch(target, {
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,application/json,text/plain,application/xml;q=0.8,image/*;q=0.5',
        },
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (redirect === 3) throw new SecUpstreamError('Too many SEC redirects.', 502);
      const location = response.headers.get('location');
      if (!location) throw new SecUpstreamError('SEC redirect was missing a target.', 502);
      target = new URL(location, target);
      validateSecRedirect(target, upstream);
    }
    throw new SecUpstreamError('SEC request failed.', 502);
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener('abort', abortFromRequest);
  }
}

export async function readResponseWithLimit(
  response: Response,
  maxBytes: number,
  requestSignal?: AbortSignal,
  timeoutMs = 12_000
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SecUpstreamError('SEC response exceeded the size limit.', 413);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancellation: 'request' | 'timeout' | null = null;
  const cancelForRequest = () => {
    cancellation = 'request';
    void reader.cancel(requestSignal?.reason).catch(() => undefined);
  };
  const timeout = setTimeout(() => {
    cancellation = 'timeout';
    void reader.cancel('SEC response body timed out.').catch(() => undefined);
  }, timeoutMs);
  requestSignal?.addEventListener('abort', cancelForRequest, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (cancellation === 'request') throw new SecUpstreamError('Request cancelled.', 499);
      if (cancellation === 'timeout') throw new SecUpstreamError('SEC response body timed out.', 504);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SecUpstreamError('SEC response exceeded the size limit.', 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (cancellation === 'request') throw new SecUpstreamError('Request cancelled.', 499);
    if (cancellation === 'timeout') throw new SecUpstreamError('SEC response body timed out.', 504);
    throw error;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener('abort', cancelForRequest);
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export const SEC_DOCUMENT_CSP = [
  "sandbox allow-same-origin",
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "connect-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: https://www.sec.gov https://*.sec.gov",
  "font-src https://www.sec.gov https://*.sec.gov",
  "navigate-to 'none'",
].join('; ');
