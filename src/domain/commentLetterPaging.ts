/**
 * Comment Letters paging and company-scope state.
 *
 * Pure so the "Showing X of Y" arithmetic and the CIK-versus-name filter
 * decision can be proven in Vitest without a browser. The view owns the
 * fetches; this module owns what a header may honestly claim.
 *
 * Server contract (src/app/api/letters/route.ts):
 *   - browse — urc_recent_threads (db/migrations/005_urc_dossier.sql):
 *     p_limit/p_offset, exact total_count, filterable by p_cik OR p_company
 *     (registrant-name ILIKE);
 *   - search — urc_search_letters (db/migrations/018_letters_search_deterministic.sql):
 *     p_limit 1..100, p_offset 0..999 inside a 1,000-deep ranked pool, total
 *     exact to 10,000 then a floor, filterable by p_company (name ILIKE)
 *     ONLY. There is no CIK parameter, so a resolved company can narrow
 *     full-text matches only by registrant name — and the UI must say so.
 */

import { companyNamePhrase } from '../services/secApi';

/** Episodes per browse page; a dossier deep link asks for a deeper first page so the requested episode is usually on it. */
export const BROWSE_PAGE_SIZE = 12;
export const DEEP_LINK_BROWSE_PAGE_SIZE = 25;
export const SEARCH_PAGE_SIZE = 50;
/** Depth of the ranked search pool; the route answers 422 for offsets at or beyond it. */
export const SEARCH_POOL_DEPTH = 1000;

export interface PagedList<T> {
  items: T[];
  /** Rows the API has returned so far — the offset of the next request. Locally merged rows do not count. */
  fetched: number;
  /** Server-reported total for the active scope (10,000 when totalIsFloor). */
  total: number;
  totalIsFloor: boolean;
  /** A follow-up page came back empty although the total said more existed. */
  exhausted: boolean;
}

export interface LetterPage<T> {
  items: T[];
  total: number;
  totalIsFloor?: boolean;
  /** Rows the server returned when that differs from items (a merged deep-link row is not a fetched row). */
  fetched?: number;
}

export function emptyPagedList<T>(): PagedList<T> {
  return { items: [], fetched: 0, total: 0, totalIsFloor: false, exhausted: false };
}

export function startPagedList<T>(page: LetterPage<T>): PagedList<T> {
  return {
    items: page.items,
    fetched: page.fetched ?? page.items.length,
    total: Math.max(0, page.total),
    totalIsFloor: Boolean(page.totalIsFloor),
    exhausted: false,
  };
}

/**
 * Append a later page. Rows already on screen (a deep-linked episode merged
 * ahead of its natural position, or an overlap after concurrent ingestion)
 * are dropped, but the offset still advances by what the server sent so the
 * next request never re-reads the same window.
 */
export function appendPagedList<T>(
  current: PagedList<T>,
  page: LetterPage<T>,
  key: (item: T) => string
): PagedList<T> {
  const seen = new Set(current.items.map(key));
  const fresh: T[] = [];
  for (const item of page.items) {
    const itemKey = key(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    fresh.push(item);
  }
  return {
    items: fresh.length > 0 ? [...current.items, ...fresh] : current.items,
    fetched: current.fetched + (page.fetched ?? page.items.length),
    total: Math.max(0, page.total),
    totalIsFloor: Boolean(page.totalIsFloor),
    exhausted: page.items.length === 0,
  };
}

export type PagingStatus =
  /** Every row the server reported is on screen. */
  | 'complete'
  /** More rows exist and the next offset is within reach. */
  | 'more'
  /** More rows exist beyond the depth the server will page to. */
  | 'capped'
  /** The server reported more rows but returned none for the next offset. */
  | 'exhausted';

export function pagingStatus(list: PagedList<unknown>, depth = Number.POSITIVE_INFINITY): PagingStatus {
  if (list.fetched >= list.total) return 'complete';
  if (list.exhausted) return 'exhausted';
  return list.fetched >= depth ? 'capped' : 'more';
}

export interface ListNoun {
  singular: string;
  plural: string;
}

export const EPISODE_NOUN: ListNoun = { singular: 'review episode', plural: 'review episodes' };
export const MATCH_NOUN: ListNoun = { singular: 'matching letter', plural: 'matching letters' };

/** "Showing 12 of 1,234 review episodes" — the on-screen count against the server total, never one for the other. */
export function describeShown(list: PagedList<unknown>, noun: ListNoun): string {
  const shown = list.items.length;
  const total = Math.max(list.total, shown);
  const label = total === 1 && !list.totalIsFloor ? noun.singular : noun.plural;
  return `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}${list.totalIsFloor ? '+' : ''} ${label}`;
}

/** Rows the server reports beyond what is on screen, phrased for a floor total. */
export function describeRemaining(list: PagedList<unknown>, noun: ListNoun): string {
  const remaining = Math.max(0, list.total - list.items.length);
  const label = remaining === 1 && !list.totalIsFloor ? noun.singular : noun.plural;
  return `${list.totalIsFloor ? 'at least ' : ''}${remaining.toLocaleString()} more ${label}`;
}

export type CompanyScope =
  /** A directory pick: the registrant is identified, not described. */
  | { kind: 'cik'; cik: string; title: string }
  /** Typed text that was never resolved — a substring of a registrant name. */
  | { kind: 'name'; text: string };

function normalizeCik(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{1,10}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed > 0 ? String(parsed) : null;
}

export function companyScopeFromSelection(title: string, cik: string): CompanyScope | null {
  const normalizedCik = normalizeCik(cik);
  const trimmedTitle = title.trim();
  if (!normalizedCik) return trimmedTitle ? { kind: 'name', text: title } : null;
  return { kind: 'cik', cik: normalizedCik, title: trimmedTitle || `CIK ${normalizedCik}` };
}

/**
 * Typed text keeps a CIK scope only while it still reads exactly as the
 * picked registrant; any edit turns it back into a name match. Raw text is
 * preserved (not trimmed) so a trailing space is not eaten mid-word.
 */
export function companyScopeFromText(current: CompanyScope | null, text: string): CompanyScope | null {
  if (!text.trim()) return null;
  if (current?.kind === 'cik' && current.title === text.trim()) return current;
  return { kind: 'name', text };
}

/** Deep links carry `company` (a name) and, from the dossier, `cik`. */
export function companyScopeFromUrl(company: string | null, cik: string | null): CompanyScope | null {
  const normalizedCik = cik ? normalizeCik(cik) : null;
  const name = (company || '').trim();
  if (normalizedCik) return { kind: 'cik', cik: normalizedCik, title: name || `CIK ${normalizedCik}` };
  return name ? { kind: 'name', text: name } : null;
}

/** What the company input should display for a scope. */
export function companyScopeText(scope: CompanyScope | null): string {
  if (!scope) return '';
  return scope.kind === 'cik' ? scope.title : scope.text;
}

/**
 * The registrant-name pattern to send when a CIK cannot be. The directory
 * title ("Microsoft Corporation") rarely equals the filer name in the letter
 * corpus ("MICROSOFT CORP"), so the corporate boilerplate is stripped the
 * same way the EDGAR issuer phrase is built.
 */
export function registrantNameStandIn(title: string): string {
  const phrase = companyNamePhrase(title).replace(/^"|"$/g, '').trim();
  return phrase || title.trim();
}

export type LetterListMode = 'browse' | 'search';

export interface CompanyScopeQuery {
  params: Record<string, string>;
  /** How the filter is really applied — this is what the label must say. */
  basis: 'cik' | 'name-stand-in' | 'name';
  /** The registrant-name pattern in force when the basis is not the CIK. */
  pattern: string | null;
}

export function companyScopeQuery(scope: CompanyScope | null, mode: LetterListMode): CompanyScopeQuery | null {
  if (!scope) return null;
  if (scope.kind === 'name') {
    const pattern = scope.text.trim();
    return pattern ? { params: { company: pattern }, basis: 'name', pattern } : null;
  }
  if (mode === 'browse') return { params: { cik: scope.cik }, basis: 'cik', pattern: null };
  const pattern = registrantNameStandIn(scope.title);
  return { params: { company: pattern }, basis: 'name-stand-in', pattern };
}

/** The scope label shown above a list — it names the basis actually applied. */
export function describeCompanyScope(scope: CompanyScope, mode: LetterListMode): string {
  const query = companyScopeQuery(scope, mode);
  const subject = mode === 'browse' ? 'Episodes' : 'Matches';
  if (!query) return '';
  if (scope.kind === 'cik') {
    return query.basis === 'cik'
      ? `${subject} filtered by CIK ${scope.cik} (${scope.title}).`
      : `${subject} narrowed to registrant names containing "${query.pattern}" as a stand-in for CIK ${scope.cik} — the full-text letter index cannot filter by CIK.`;
  }
  return `${subject} narrowed to registrant names containing "${query.pattern}" — a free-text name match; choose a company suggestion to filter by CIK.`;
}

export type LetterFormFilter = '' | 'UPLOAD' | 'CORRESP';

export interface LetterSearchCriteria {
  query: string;
  form: LetterFormFilter;
  scope: CompanyScope | null;
}

export interface LetterPageRequest {
  from: number;
  size: number;
}

function applyPage(params: URLSearchParams, page: LetterPageRequest): URLSearchParams {
  params.set('size', String(page.size));
  if (page.from > 0) params.set('from', String(page.from));
  return params;
}

export function letterBrowseParams(scope: CompanyScope | null, page: LetterPageRequest): URLSearchParams {
  const params = new URLSearchParams();
  const scoped = companyScopeQuery(scope, 'browse');
  if (scoped) for (const [name, value] of Object.entries(scoped.params)) params.set(name, value);
  return applyPage(params, page);
}

export function letterSearchParams(criteria: LetterSearchCriteria, page: LetterPageRequest): URLSearchParams {
  const params = new URLSearchParams({ q: criteria.query.trim() });
  if (criteria.form) params.set('form', criteria.form);
  const scoped = companyScopeQuery(criteria.scope, 'search');
  if (scoped) for (const [name, value] of Object.entries(scoped.params)) params.set(name, value);
  return applyPage(params, page);
}
