import { parseHTML } from 'linkedom';
import { isValidIsoDate } from '../lib/api-query';
import { cacheService } from '../lib/cache';
import {
  buildSecTargetUrl, fetchSecResponse, readResponseWithLimit,
  looksLikeSecErrorResponse, SecUpstreamError,
} from '../lib/sec-upstream';

const INDEX_PATH = '/enforcement-litigation/accounting-auditing-enforcement-releases';
const CACHE_KEY = 'aaer:index:v1';
const FULL_TTL_SECONDS = 6 * 60 * 60;
const PARTIAL_TTL_SECONDS = 5 * 60;
const COLLECTION_DEADLINE_MS = 100_000;
const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

export interface AaerRelease {
  releaseNo: string;
  /** Eastern-time calendar date as shown on sec.gov (see easternIsoDate). */
  date: string;
  /** Best-effort split of the index's free-text respondents line (it can carry
   * annotations such as "(Corrected)" or "Hearing Examiner"); `title` is the
   * verbatim source text and is authoritative. */
  respondents: string[];
  title: string;
  url: string;
  otherReleaseNumbers: string[];
  relatedActions: Array<{ label: string; url: string; releaseNumbers?: string }>;
}

export interface AaerCoverage {
  /** null means page 0 could not be read, so the extent is unknown. */
  pagesDiscovered: number | null;
  pagesRequested: number;
  pagesParsed: number;
  pagesFailed: Array<{ page: number; reason: string }>;
  /** Successfully parsed source rows, before deduplication. */
  rowsParsed: number;
  unparsedRows: number;
  oldestDate: string | null;
  newestDate: string | null;
  complete: boolean;
  incompleteReason?: string;
  source: 'sec.gov accounting-auditing-enforcement-releases index';
  fetchedAt: string;
}

export interface AaerCollection {
  releases: AaerRelease[];
  coverage: AaerCoverage;
}

export interface AaerIndexResult extends AaerCollection {
  cache: { hit: boolean; cachedAt: string | null; ttlSeconds: number };
}

export interface ParsedAaerIndex {
  releases: AaerRelease[];
  rowsParsed: number;
  unparsedRows: number;
  pagesDiscovered: number;
}

const EASTERN_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * The index stores each release time as a UTC instant but DISPLAYS the
 * America/New_York calendar day (e.g. datetime 1968-03-12T04:41:41Z shows as
 * "March 11, 1968"). The published date is the Eastern one, so slicing the UTC
 * string would be a day late for evening and pre-1970s rows. Returns '' for
 * anything that is not a full ISO instant, so the row is counted as unparsed.
 */
function easternIsoDate(datetime: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(datetime)) return '';
  const instant = new Date(datetime);
  return Number.isNaN(instant.getTime()) ? '' : EASTERN_DATE.format(instant);
}

const normalizedText = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

function sourceUrl(href: string | null, pageUrl: string): string | null {
  if (!href?.trim()) return null;
  try {
    const url = new URL(href, pageUrl);
    return url.protocol === 'https:' && (url.hostname === 'sec.gov' || url.hostname.endsWith('.sec.gov'))
      ? url.href : null;
  } catch { return null; }
}

/** Some SEC rows put the whole list in ONE anchor. Split explicit list
 * separators outside parentheses, retaining suffixes/credentials and ambiguous
 * surname-first labels (e.g. "O’Donnell, Edward, CPA") as source text. */
function respondentNames(text: string): string[] {
  const parts = text.split(/([(),;]|\s+and\s+)/);
  const names: string[] = [];
  let current = '';
  let depth = 0;
  const suffix = /^(?:Inc\.?|LLC|L\.L\.C\.?|L\.L\.P\.?|LLP|Ltd\.?|P\.?C\.?|PA|CPA|C\.P\.A\.?|CA|Esq\.?|Jr\.?|Sr\.?|II|III|IV|et\.? al\.?|Company|Co\.?|Administrative Law Judge|Hearing Examiner)(?:\s|$)/i;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '(') depth += 1;
    if (part === ')') depth = Math.max(0, depth - 1);
    const next = normalizedText(parts[index + 1]);
    const delimiter = depth === 0 && (part === ',' || part === ';' || /^\s+and\s+$/.test(part));
    const separates = delimiter && next && !suffix.test(next)
      && (part === ';' || /\s/.test(next) || /^\s+and\s+$/.test(part));
    if (separates) {
      const name = normalizedText(current).replace(/[,;]\s*$/, '');
      if (name) names.push(name);
      current = '';
    } else {
      current += part;
    }
  }
  const last = normalizedText(current).replace(/^(?:and\s+)|[,;]\s*$/g, '');
  if (last) names.push(last);
  return names;
}

/** Pure parser of the public SEC index; never falls back to visible date text. */
export function parseAaerIndexHtml(html: string, pageUrl: string): ParsedAaerIndex {
  const { document } = parseHTML(html);
  const rows = [...document.querySelectorAll('tr.pr-list-page-row')];
  if (rows.length === 0) throw new Error('Could not parse AAER index: no release rows present.');
  const releases: AaerRelease[] = [];
  let unparsedRows = 0;
  for (const row of rows) {
    const identifiers = normalizedText(row.querySelector('.view-table_subfield_release_number .view-table_subfield_value')?.textContent)
      .match(/\b(?:AAER|LR|IA|IC|\d{1,2})-\d+[A-Z]?\b/gi) ?? [];
    const releaseNo = identifiers.find(value => /^AAER-/i.test(value))?.toUpperCase();
    const rawDate = row.querySelector('time[datetime]')?.getAttribute('datetime') ?? '';
    const date = easternIsoDate(rawDate);
    const respondentBlock = row.querySelector('.release-view__respondents');
    const title = normalizedText(respondentBlock?.textContent);
    const links = [...(respondentBlock?.querySelectorAll('a[href]') ?? [])];
    const url = sourceUrl(links[0]?.getAttribute('href') ?? null, pageUrl);
    if (!releaseNo || !isValidIsoDate(date) || !title || !url) {
      // Missing identifiers or malformed rows are observable, never invented.
      unparsedRows += 1;
      continue;
    }
    const relatedActions: AaerRelease['relatedActions'] = [];
    for (const link of row.querySelectorAll('.view-table_subfield_see_also a[href]')) {
      const actionUrl = sourceUrl(link.getAttribute('href'), pageUrl);
      const label = normalizedText(link.textContent);
      if (!actionUrl || !label) continue;
      const releaseNumbers = label.match(/\b(?:AAER|LR|IA|IC|\d{1,2})-\d+[A-Z]?\b/gi)?.join(', ');
      relatedActions.push({ label, url: actionUrl, ...(releaseNumbers ? { releaseNumbers } : {}) });
    }
    releases.push({
      releaseNo, date,
      respondents: links.length > 1
        ? links.flatMap(link => respondentNames(normalizedText(link.textContent)))
        : respondentNames(title),
      // The index has no title column. Preserve its respondents text as title,
      // and use the FIRST respondents anchor as the primary URL, even when it
      // points to an LR page rather than an administrative order/PDF.
      title, url,
      otherReleaseNumbers: [...new Set(identifiers.map(value => value.toUpperCase()).filter(value => value !== releaseNo))],
      relatedActions,
    });
  }
  let lastPage = Number(new URL(pageUrl).searchParams.get('page') ?? 0);
  for (const link of document.querySelectorAll('.usa-pagination a[href], .pager__items a[href]')) {
    const href = sourceUrl(link.getAttribute('href'), pageUrl);
    if (!href) continue;
    const target = new URL(href);
    if (target.origin !== new URL(pageUrl).origin || target.pathname !== INDEX_PATH) continue;
    const page = target.searchParams.get('page');
    if (target.searchParams.size === 1 && page && /^\d{1,4}$/.test(page)) lastPage = Math.max(lastPage, Number(page));
  }
  return { releases, rowsParsed: releases.length, unparsedRows, pagesDiscovered: lastPage + 1 };
}

export interface CollectAaerOptions {
  /** Maximum number of pages including page 0; omission reads all discovered pages. */
  pagesToRead?: number;
  signal?: AbortSignal;
  userAgent?: string;
}

export async function collectAaerReleases({ pagesToRead, signal, userAgent = USER_AGENT }: CollectAaerOptions = {}): Promise<AaerCollection> {
  if (pagesToRead !== undefined && (!Number.isSafeInteger(pagesToRead) || pagesToRead < 1)) {
    throw new RangeError('pagesToRead must be a positive integer.');
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('AAER collection deadline reached.', 'TimeoutError')), COLLECTION_DEADLINE_MS);
  const workSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const coverage: AaerCoverage = {
    pagesDiscovered: null, pagesRequested: 0, pagesParsed: 0, pagesFailed: [],
    rowsParsed: 0, unparsedRows: 0, oldestDate: null, newestDate: null,
    complete: false, source: 'sec.gov accounting-auditing-enforcement-releases index', fetchedAt: '',
  };
  const byNumber = new Map<string, AaerRelease>();
  try {
    // Sequential requests keep concurrency at one and avoid speculative work
    // before the first page supplies the real pagination extent.
    for (let page = 0; page < (coverage.pagesDiscovered ?? 1); page += 1) {
      if (workSignal.aborted) {
        coverage.incompleteReason = signal?.aborted ? 'Request cancelled.' : 'Collection deadline reached.';
        break;
      }
      if (pagesToRead !== undefined && page >= pagesToRead) {
        coverage.incompleteReason = 'Requested page limit reached.';
        break;
      }
      coverage.pagesRequested += 1;
      try {
        const target = buildSecTargetUrl('proxy', INDEX_PATH, new URLSearchParams({ page: String(page) }));
        const response = await fetchSecResponse(target, 'proxy', workSignal, userAgent);
        workSignal.throwIfAborted();
        if (!response.ok) throw new SecUpstreamError(`SEC AAER index HTTP ${response.status}.`, response.status);
        const bytes = await readResponseWithLimit(response, 2 * 1024 * 1024, workSignal);
        workSignal.throwIfAborted();
        if (looksLikeSecErrorResponse(bytes)) throw new Error('SEC returned an error page.');
        const parsed = parseAaerIndexHtml(new TextDecoder('utf-8', { fatal: true }).decode(bytes), target.href);
        if (page === 0) coverage.pagesDiscovered = parsed.pagesDiscovered;
        coverage.pagesParsed += 1;
        coverage.rowsParsed += parsed.rowsParsed;
        coverage.unparsedRows += parsed.unparsedRows;
        for (const release of parsed.releases) {
          // Keep the first observed row when pagination shifts during a crawl.
          if (!byNumber.has(release.releaseNo)) byNumber.set(release.releaseNo, release);
        }
      } catch (error) {
        const reason = workSignal.aborted
          ? signal?.aborted ? 'Request cancelled.' : 'Collection deadline reached.'
          : error instanceof Error ? error.message : 'Could not read or parse SEC AAER index page.';
        coverage.pagesFailed.push({ page, reason });
        if (workSignal.aborted) { coverage.incompleteReason = reason; break; }
      }
    }
  } finally { clearTimeout(timer); }
  const releases = [...byNumber.values()].sort((a, b) => b.date.localeCompare(a.date)
    || parseInt(b.releaseNo.slice(5), 10) - parseInt(a.releaseNo.slice(5), 10)
    || b.releaseNo.localeCompare(a.releaseNo));
  coverage.newestDate = releases[0]?.date ?? null;
  coverage.oldestDate = releases.at(-1)?.date ?? null;
  coverage.complete = coverage.pagesDiscovered !== null && coverage.pagesParsed === coverage.pagesDiscovered
    && coverage.pagesFailed.length === 0 && coverage.unparsedRows === 0;
  if (!coverage.complete && !coverage.incompleteReason) {
    coverage.incompleteReason = coverage.pagesFailed.length > 0 ? 'One or more index pages could not be read or parsed.'
      : coverage.unparsedRows > 0 ? 'One or more source rows could not be parsed.' : 'Pagination extent is unknown.';
  }
  coverage.fetchedAt = new Date().toISOString();
  return { releases, coverage };
}

/** The shared KV service has no signal argument. Bound each wait to 2 seconds
 * and the caller's cancellation; its underlying SDK operation may finish later. */
async function boundedCacheCall<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Request cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('AAER cache deadline reached.')); }, 2_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    signal?.addEventListener('abort', abort, { once: true });
    operation().then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

interface CachedAaerIndex {
  collection: AaerCollection;
  cachedAt: string;
  ttlSeconds: number;
}

/** Only full crawls use the shared index key; intentionally bounded collections
 * returned by collectAaerReleases never overwrite the full cache. */
export async function getAaerIndex({ signal, userAgent }: Omit<CollectAaerOptions, 'pagesToRead'> = {}): Promise<AaerIndexResult> {
  let cached: CachedAaerIndex | null = null;
  try { cached = await boundedCacheCall(() => cacheService.get<CachedAaerIndex>(CACHE_KEY), signal); }
  catch { signal?.throwIfAborted(); }
  if (cached) {
    const maximumTtl = cached.collection.coverage.complete ? FULL_TTL_SECONDS : PARTIAL_TTL_SECONDS;
    const ageSeconds = (Date.now() - Date.parse(cached.cachedAt)) / 1000;
    if (Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds < Math.min(cached.ttlSeconds, maximumTtl)) {
      return { ...cached.collection, cache: { hit: true, cachedAt: cached.cachedAt, ttlSeconds: Math.min(cached.ttlSeconds, maximumTtl) } };
    }
  }
  const collection = await collectAaerReleases({ signal, userAgent });
  const ttlSeconds = collection.coverage.complete ? FULL_TTL_SECONDS : PARTIAL_TTL_SECONDS;
  // Cancelled collections remain available to the caller but are not cached.
  if (signal?.aborted) return { ...collection, cache: { hit: false, cachedAt: null, ttlSeconds: 0 } };
  const cachedAt = new Date().toISOString();
  try {
    await boundedCacheCall(() => cacheService.set<CachedAaerIndex>(CACHE_KEY, { collection, cachedAt, ttlSeconds }, { ex: ttlSeconds }), signal);
  } catch {
    return { ...collection, cache: { hit: false, cachedAt: null, ttlSeconds: 0 } };
  }
  // TTL describes the cache policy. cacheService swallows SDK write failures,
  // so a successful cache write cannot be independently confirmed here.
  return { ...collection, cache: { hit: false, cachedAt, ttlSeconds } };
}
