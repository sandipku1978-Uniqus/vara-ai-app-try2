/**
 * Display rules for the AAER tab. Client-safe: the service module parses HTML
 * with linkedom on the server, so the view imports only its types.
 */
import type { AaerCoverage, AaerRelease } from '../../services/aaer';

/** GET /api/aaer response body. */
export interface AaerResponse {
  releases: AaerRelease[];
  /** Releases matching the query, before the limit. */
  total: number;
  returned: number;
  coverage: AaerCoverage;
  cache: { hit: boolean; cachedAt: string | null; ttlSeconds: number };
}

/** Largest page the route accepts (`limit` 1..500). */
export const AAER_ROUTE_LIMIT = 500;

export function formatReadAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** "3,347 releases across 34 index pages, read Oct 4, 2026, 9:12 AM", then a
 * partial notice whenever the service says the crawl was not complete. */
export function aaerCoverageLine(coverage: AaerCoverage): string {
  const pages = coverage.pagesDiscovered === null
    ? `${count(coverage.pagesParsed)} index page${coverage.pagesParsed === 1 ? '' : 's'} (index extent unknown)`
    : coverage.pagesParsed === coverage.pagesDiscovered
      ? `${count(coverage.pagesDiscovered)} index page${coverage.pagesDiscovered === 1 ? '' : 's'}`
      : `${count(coverage.pagesParsed)} of ${count(coverage.pagesDiscovered)} index pages`;
  const span = coverage.oldestDate && coverage.newestDate ? ` (${coverage.oldestDate} to ${coverage.newestDate})` : '';
  const base = `${count(coverage.rowsParsed)} release${coverage.rowsParsed === 1 ? '' : 's'} across ${pages}${span}, read ${formatReadAt(coverage.fetchedAt)}`;
  if (coverage.complete) return `${base}.`;
  const detail = [
    coverage.incompleteReason ?? 'The crawl did not complete.',
    coverage.pagesFailed.length > 0 ? `${count(coverage.pagesFailed.length)} page${coverage.pagesFailed.length === 1 ? '' : 's'} failed` : '',
    coverage.unparsedRows > 0 ? `${count(coverage.unparsedRows)} row${coverage.unparsedRows === 1 ? '' : 's'} could not be parsed` : '',
  ].filter(Boolean).join(' ');
  return `${base}. Partial: ${detail}${/[.]$/.test(detail) ? '' : '.'}`;
}

export interface AaerQuery {
  q: string;
  fromYear: string;
  toYear: string;
}

/** Route query string; the route filters the full index, then applies limit. */
export function aaerQueryString({ q, fromYear, toYear }: AaerQuery): string {
  const params = new URLSearchParams({ limit: String(AAER_ROUTE_LIMIT) });
  const text = q.trim();
  if (text) params.set('q', text.slice(0, 200));
  if (/^\d{4}$/.test(fromYear)) params.set('from', `${fromYear}-01-01`);
  if (/^\d{4}$/.test(toYear)) params.set('to', `${toYear}-12-31`);
  return params.toString();
}

export function relatedActionsText(release: AaerRelease): string {
  return release.relatedActions.map(action => `${action.label} <${action.url}>`).join('; ');
}
