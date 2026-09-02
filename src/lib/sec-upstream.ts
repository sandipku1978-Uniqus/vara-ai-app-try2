import sanitizeHtml from 'sanitize-html';
import { currentCorrelationId } from './route-observability';
import {
  paceSecRequestStart,
  SecRequestPacerUnavailableError,
} from './sec-request-pacer';

export {
  InvalidEftsResponseError,
  parseAndValidateEftsPayload,
  type EftsPayload,
  type EftsPayloadHit,
} from './efts-response';

export type SecUpstream = 'proxy' | 'data' | 'efts' | 'iapd';

export type SecUpstreamFailureReason =
  | 'http-status'
  | 'error-page'
  | 'non-json'
  | 'malformed-json'
  | 'timeout'
  | 'pacer-unavailable'
  | 'redirect-rejected';

/**
 * One structured line per SEC-side failure (audit 2026-09: "SEC throttles,
 * blocks and error pages produce zero server-side signal"). Host and path
 * only — the query string can carry search terms. The correlation ID joins
 * the line to the route line of the request that made the call.
 */
export function logSecUpstreamFailure(details: {
  upstream: SecUpstream;
  target?: URL | null;
  status?: number | null;
  reason: SecUpstreamFailureReason;
  elapsedMs?: number;
}): void {
  console.error(JSON.stringify({
    kind: 'sec-upstream-failure',
    upstream: details.upstream,
    host: details.target?.host ?? null,
    path: details.target?.pathname ?? null,
    status: details.status ?? null,
    reason: details.reason,
    elapsedMs: details.elapsedMs ?? null,
    correlationId: currentCorrelationId(),
  }));
}

/**
 * One document-level in-flight pool shared by every route that can miss the
 * filing-text cache. This bounds open response/body work; the separate central
 * request-start pacer enforces SEC request-rate spacing. The lease covers the
 * response body read as well as the initial request and validated redirects.
 */
export const SEC_DOCUMENT_CONCURRENCY_OPTIONS = {
  operation: 'sec-filing-document-fetch',
  userLimit: 4,
  orgLimit: 4,
  ipLimit: 4,
  globalLimit: 4,
  leaseSeconds: 30,
} as const;

const UPSTREAM_ORIGINS: Record<SecUpstream, string> = {
  proxy: 'https://www.sec.gov',
  data: 'https://data.sec.gov',
  efts: 'https://efts.sec.gov',
  iapd: 'https://api.adviserinfo.sec.gov',
};

const QUERY_KEYS: Record<SecUpstream, Set<string>> = {
  // 'ticker' is browse-edgar's own lookup key. It is needed to re-resolve a
  // ticker whose directory entry points at a non-filing successor entity.
  proxy: new Set(['action', 'CIK', 'ticker', 'type', 'dateb', 'owner', 'count', 'output', 'search']),
  data: new Set(),
  efts: new Set(['q', 'forms', 'dateRange', 'startdt', 'enddt', 'entityName', 'ciks', 'from', 'size']),
  iapd: new Set(['query', 'hl', 'nrows', 'start', 'r', 'sort', 'wt']),
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
  // buildSecTargetUrl already decodes one layer. Any remaining percent escape
  // could be decoded again by URL normalization or the upstream server and
  // turn into a dot/slash segment outside the audited allowlist.
  if (pathname.length > 2048 || !pathname.startsWith('/') || pathname.includes('%')) return false;
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
      || /^\/Archives\/edgar\/data\/\d{1,10}\/[A-Za-z0-9._~!$&'()+,;=@-]+(?:\/[A-Za-z0-9._~!$&'()+,;=@-]+)*$/.test(pathname);
  }
  if (upstream === 'data') {
    return /^\/submissions\/[A-Za-z0-9._-]+\.json$/.test(pathname)
      || /^\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(pathname);
  }
  if (upstream === 'efts') return pathname === '/LATEST/search-index';
  return pathname === '/search/firm';
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
  if (![...params].every(([key, value]) => allowed.has(key) && value.length <= 4000)) return false;
  if (upstream !== 'iapd') return true;

  const requiredKeys = ['query', 'hl', 'nrows', 'start', 'r', 'sort', 'wt'] as const;
  if (params.size !== requiredKeys.length || requiredKeys.some(key => params.getAll(key).length !== 1)) {
    return false;
  }
  const query = params.get('query')?.trim() || '';
  const integerInRange = (key: string, minimum: number, maximum: number) => {
    const value = params.get(key) || '';
    return /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum;
  };
  return query.length > 0
    && query.length <= 200
    && params.get('hl') === 'true'
    && integerInRange('nrows', 1, 100)
    && integerInRange('start', 0, 10_000)
    && integerInRange('r', 1, 100)
    && params.get('sort') === 'score desc'
    && params.get('wt') === 'json';
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
  // WHATWG URL construction normalizes encoded dot segments. Re-check the
  // canonical URL, including the exact pathname, so validation can never be
  // performed on a different path than the one fetch() will receive.
  if (
    target.pathname !== pathname
    || !validPath(upstream, target.pathname)
    || !queryAllowed(upstream, target.pathname, target.searchParams)
  ) {
    throw new SecUpstreamError('SEC path or query is not allowed.', 400);
  }
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

/**
 * Gate between fetching an SEC document and extracting/caching its text.
 *
 * fetchSecResponse deliberately returns non-OK responses (some callers pass
 * status through), so a text-extraction caller MUST reject them here first:
 * SEC serves rate-threshold and error pages as prose HTML, and extracting one
 * would write it into the shared urc_filing_text cache as the filing's
 * permanent text — every later Boolean validation for that accession would
 * run against the error page. The content-type check stops the same poisoning
 * via binary documents (PDF/image primary documents decoded as mojibake).
 * A missing content-type header is tolerated; a wrong one is not.
 */
const SEC_TEXT_DOCUMENT_TYPES = /^(?:text\/html|application\/xhtml\+xml|text\/plain|text\/xml|application\/xml)(?:;|$)/i;

/**
 * SEC error-page signatures as they appear in EXTRACTED TEXT. Response-level
 * validation (below) stops new poison at fetch time; this catches rows cached
 * BEFORE that guard existed (audit R1: "invalidate or revalidate previously
 * cached SEC error content"). Length-bounded on purpose: error pages are a
 * few hundred bytes, while a real filing QUOTING one of these phrases is a
 * full document — never flag those.
 */
const SEC_ERROR_TEXT_SIGNATURES = [
  'Your Request Originated from an Undeclared Automated Tool',
  'Request Rate Threshold Exceeded',
  'For security purposes, and to ensure that the public service remains available',
  'This page is temporarily unavailable',
] as const;

const SEC_ERROR_RESPONSE_SCAN_BYTES = 64 * 1024;
const SEC_JSON_MAX_BYTES = 25 * 1024 * 1024;
const SEC_JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:;|$)/i;

function findSecErrorSignature(text: string): string | null {
  for (const signature of SEC_ERROR_TEXT_SIGNATURES) {
    if (text.includes(signature)) return signature;
  }
  return null;
}

export function looksLikeSecErrorText(text: string): string | null {
  if (!text || text.length > 5_000) return null;
  return findSecErrorSignature(text);
}

/**
 * Inspect only a bounded prefix of a fresh raw response for the SEC's known
 * fair-access/error-page signatures. Unlike looksLikeSecErrorText, this guard
 * deliberately does not trust total body length: SEC can pad an HTTP 200
 * throttle page beyond 5 KB, and the proxy must reject it before returning or
 * caching it. Keeping the scan bounded avoids decoding a full 25 MB filing.
 */
export function looksLikeSecErrorResponse(body: string | Uint8Array): string | null {
  const sample = typeof body === 'string'
    ? body.slice(0, SEC_ERROR_RESPONSE_SCAN_BYTES)
    : new TextDecoder('utf-8').decode(body.subarray(0, SEC_ERROR_RESPONSE_SCAN_BYTES));
  return findSecErrorSignature(sample);
}

/** Parse a size-bounded SEC response only after its media type and JSON syntax
 * have been validated. Domain-specific callers must still validate the shape. */
export function parseSecJsonResponse(
  bytes: Uint8Array,
  contentType: string | null,
  /** When given, a rejected body is logged as an SEC upstream failure. */
  source?: { upstream: SecUpstream; target: URL },
): unknown {
  const failure = (reason: SecUpstreamFailureReason) => {
    if (source) logSecUpstreamFailure({ upstream: source.upstream, target: source.target, status: 200, reason });
  };
  if (looksLikeSecErrorResponse(bytes)) {
    failure('error-page');
    throw new SecUpstreamError('SEC upstream returned an error page.', 502);
  }
  if (!contentType || !SEC_JSON_CONTENT_TYPE.test(contentType.trim())) {
    failure('non-json');
    throw new SecUpstreamError('SEC upstream returned a non-JSON response.', 502);
  }

  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    failure('malformed-json');
    throw new SecUpstreamError('SEC upstream returned invalid UTF-8 JSON.', 502);
  }

  try {
    return JSON.parse(body.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    failure('malformed-json');
    throw new SecUpstreamError('SEC upstream returned malformed JSON.', 502);
  }
}

export interface FetchSecJsonOptions {
  upstream: SecUpstream;
  path: string;
  params?: URLSearchParams;
  userAgent: string;
  maxBytes: number;
  signal?: AbortSignal;
}

/**
 * The single server-side path for SEC JSON: strict target allow-list, central
 * fair-access pacing (including redirects), bounded body read, media-type
 * validation, UTF-8 validation, and fail-closed JSON parsing.
 */
export async function fetchSecJson({
  upstream,
  path,
  params = new URLSearchParams(),
  userAgent,
  maxBytes,
  signal = new AbortController().signal,
}: FetchSecJsonOptions): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > SEC_JSON_MAX_BYTES) {
    throw new SecUpstreamError('Invalid SEC JSON response size limit.', 500);
  }

  const target = buildSecTargetUrl(upstream, path, new URLSearchParams(params));
  const response = await fetchSecResponse(target, upstream, signal, userAgent);
  if (!response.ok) {
    const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
    throw new SecUpstreamError('SEC upstream request failed.', status);
  }
  const bytes = await readResponseWithLimit(response, maxBytes, signal);
  return parseSecJsonResponse(bytes, response.headers.get('content-type'), { upstream, target });
}

export function assertSecDocumentResponse(response: Response): void {
  if (!response.ok) {
    const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
    throw new SecUpstreamError('SEC upstream request failed.', status);
  }
  const contentType = (response.headers.get('content-type') || '').trim().toLowerCase();
  if (contentType && !SEC_TEXT_DOCUMENT_TYPES.test(contentType)) {
    throw new SecUpstreamError('SEC document is not a text document.', 415);
  }
}

export async function fetchSecResponse(
  initialTarget: URL,
  upstream: SecUpstream,
  requestSignal: AbortSignal,
  userAgent: string,
  /** Called immediately before each real SEC HTTP attempt, redirects included.
   * Returning false vetoes the attempt so callers can enforce a hard fan-out
   * budget instead of learning they overspent after fetch resolves. */
  onRequestAttempt?: () => boolean | void
): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const abortFromRequest = () => controller.abort(requestSignal.reason);
  // AbortSignal does not replay an abort event to listeners attached after it
  // fired. Propagate that state synchronously so a request cancelled before
  // this function starts cannot authorize, pace, fetch, or later cache data.
  if (requestSignal.aborted) controller.abort(requestSignal.reason);
  else requestSignal.addEventListener('abort', abortFromRequest, { once: true });
  let target = initialTarget;
  const failure = (reason: SecUpstreamFailureReason, status?: number | null) => logSecUpstreamFailure({
    upstream,
    target,
    status: status ?? null,
    reason,
    elapsedMs: Date.now() - startedAt,
  });

  try {
    controller.signal.throwIfAborted();
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      if (onRequestAttempt?.() === false) {
        throw new SecUpstreamError('SEC upstream request budget exhausted.', 429);
      }
      try {
        // Central fair-access gate: every real request start, including each
        // redirect, is spaced before fetch() regardless of which route called.
        await paceSecRequestStart(controller.signal);
      } catch (error) {
        if (error instanceof SecRequestPacerUnavailableError) {
          failure('pacer-unavailable');
          throw new SecUpstreamError('SEC request pacing is unavailable.', 503);
        }
        throw error;
      }
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
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        // SEC's throttle (429), block (403) and outage (5xx) answers used to
        // leave no server-side trace: each caller mapped them to its own
        // status and moved on. Callers still receive the response unchanged.
        if (!response.ok) failure('http-status', response.status);
        return response;
      }
      if (redirect === 3) {
        failure('redirect-rejected', response.status);
        throw new SecUpstreamError('Too many SEC redirects.', 502);
      }
      const location = response.headers.get('location');
      if (!location) {
        failure('redirect-rejected', response.status);
        throw new SecUpstreamError('SEC redirect was missing a target.', 502);
      }
      target = new URL(location, target);
      try {
        validateSecRedirect(target, upstream);
      } catch (error) {
        failure('redirect-rejected', response.status);
        throw error;
      }
    }
    throw new SecUpstreamError('SEC request failed.', 502);
  } catch (error) {
    // This function's own 12-second deadline, as opposed to the caller going
    // away (not a failure of SEC's) or a failure already logged above.
    if (!requestSignal.aborted && controller.signal.aborted && !(error instanceof SecUpstreamError)) {
      failure('timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener('abort', abortFromRequest);
  }
}

export async function readResponseWithLimit(
  response: Response,
  maxBytes: number,
  requestSignal?: AbortSignal,
  timeoutMs = 12_000,
  // When true, an oversized body is truncated to maxBytes and returned instead
  // of throwing 413. Used for filing-text validation, where the first maxBytes
  // is enough to run Boolean/keyword matching — far better than dropping the
  // whole filing. The preview lane leaves this false so it never shows a
  // silently clipped document.
  truncate = false
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (!truncate && Number.isFinite(contentLength) && contentLength > maxBytes) {
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
      if (total + value.byteLength > maxBytes) {
        if (truncate) {
          const remaining = maxBytes - total;
          if (remaining > 0) {
            chunks.push(value.subarray(0, remaining));
            total += remaining;
          }
          await reader.cancel();
          break;
        }
        await reader.cancel();
        throw new SecUpstreamError('SEC response exceeded the size limit.', 413);
      }
      total += value.byteLength;
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
].join('; ');
