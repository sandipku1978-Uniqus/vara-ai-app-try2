const MAX_TEXT_LENGTH = 256;
const MAX_REPORTS = 10;

interface JsonRecord {
  [key: string]: unknown;
}

export interface SanitizedCspReport {
  kind: 'csp-violation';
  document: string;
  blocked: string;
  source: string;
  directive: string;
  disposition: string;
  statusCode: number | null;
  line: number | null;
  column: number | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_TEXT_LENGTH);
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function redactDynamicRoute(pathname: string): string {
  return pathname
    .replace(/\/(company|filing)\/[^/]+(?:\/[^/]+)*/gi, '/$1/[redacted]')
    .slice(0, MAX_TEXT_LENGTH);
}

/** Remove query strings, fragments, credentials, and dynamic filing/company ids. */
function safeUrl(value: unknown): string {
  const text = safeText(value);
  if (!text) return '';
  if (/^(inline|eval|wasm-eval|data|blob)$/i.test(text)) return text.toLowerCase();

  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return parsed.protocol;
    return `${parsed.origin}${redactDynamicRoute(parsed.pathname)}`.slice(0, MAX_TEXT_LENGTH);
  } catch {
    return redactDynamicRoute(text.split(/[?#]/, 1)[0]);
  }
}

function normalizeBody(value: JsonRecord): JsonRecord {
  if (isRecord(value['csp-report'])) return value['csp-report'];
  if (isRecord(value.body)) return value.body;
  return value;
}

function sanitizeOne(value: unknown): SanitizedCspReport | null {
  if (!isRecord(value)) return null;
  const body = normalizeBody(value);
  const directive = safeText(body.effectiveDirective ?? body['effective-directive']
    ?? body.violatedDirective ?? body['violated-directive']);

  if (!directive) return null;

  return {
    kind: 'csp-violation',
    document: safeUrl(body.documentURL ?? body['document-uri'] ?? value.url),
    blocked: safeUrl(body.blockedURL ?? body['blocked-uri']),
    source: safeUrl(body.sourceFile ?? body['source-file']),
    directive,
    disposition: safeText(body.disposition),
    statusCode: safeNumber(body.statusCode ?? body['status-code']),
    line: safeNumber(body.lineNumber ?? body['line-number']),
    column: safeNumber(body.columnNumber ?? body['column-number']),
  };
}

/** Supports both legacy application/csp-report and Reporting API payloads. */
export function sanitizeCspReports(value: unknown): SanitizedCspReport[] {
  const candidates = Array.isArray(value) ? value.slice(0, MAX_REPORTS) : [value];
  return candidates
    .map(sanitizeOne)
    .filter((report): report is SanitizedCspReport => report !== null);
}
