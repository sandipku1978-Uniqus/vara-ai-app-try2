/**
 * ASU index — every Accounting Standards Update FASB lists as issued, plus the
 * proposed Updates currently open for comment, read from fasb.org.
 *
 * Codification text is licensed and out of scope. ASUs are not: FASB publishes
 * each one as a free PDF and lists them on three public pages. Those pages are
 * a client-rendered Next.js site whose lists come from FASB's own content API
 * (api.fasb.org), which returns JSON records whose bodies are HTML fragments.
 * This module reads those records:
 *
 *   issued         /standards/accounting-standard-updates — one record per
 *                  year ("Issued In 2023"), body = <p>Update 2023-07—Title</p>…
 *   effective      /standards/accounting-standard-updated-effective-date — one
 *                  record per ASU still inside its transition window, with the
 *                  month issued and FASB's own effective-date wording
 *   proposed       /projects/documents-open-for-comments — one record per
 *                  exposure draft, with its file reference and comment deadline
 *
 * Every field shown to a user is one of these records' values, never inferred:
 * an ASU that has left the effective-dates page carries no effective-date text
 * and says so, and an issue date is shown to the month only, because FASB's
 * timestamps are CMS publish times whose day does not always match the date
 * printed on the Update.
 *
 * Network access is injected (fetch, cache, snapshot) so this module stays
 * importable from client code and testable on saved fixtures.
 */

import type { FetchLike } from '../lib/fetch-with-deadline';

// ── Public shape ─────────────────────────────────────────────────────────────

export type AsuStatus = 'issued' | 'proposed';

export interface AsuDocumentLink {
  label: string;
  url: string;
}

export interface AsuEntry {
  /** "2023-07" for an issued Update; FASB's file reference ("2026-ED500") for a proposal. */
  number: string;
  title: string;
  /** Primary Codification topic named in the title ("ASC 280"), or null when the title names none. */
  topic: string | null;
  /** Every topic the title names, three-digit ("280", "350"). */
  ascTopics: string[];
  /** Subtopics the title names ("350-40", "205-40"). */
  ascSubtopics: string[];
  /** "2023-11" (month precision) or "2023" (year precision); null for proposals. */
  issuedDate: string | null;
  issuedDatePrecision: 'month' | 'year' | null;
  /** FASB's own effective-date wording, verbatim text; null when FASB no longer lists it. */
  effectiveDates: string | null;
  /** Primary PDF on fasb.org; null only when the listing carried no link. */
  pdfUrl: string | null;
  /** Multi-part Updates (2016-02, 2014-09) publish one PDF per section. */
  documents: AsuDocumentLink[];
  status: AsuStatus;
  /** Proposals only: comment deadline as printed, ISO date. */
  commentDeadline?: string | null;
  /** Where this row was read. */
  sourcePage: AsuSourcePageId;
}

export type AsuSourcePageId = 'issued' | 'effective-dates' | 'proposed';

export interface AsuSourcePageCoverage {
  id: AsuSourcePageId;
  label: string;
  /** Public page a person can open to check the row. */
  pageUrl: string;
  /** API endpoint the records were read from. */
  apiUrl: string;
  ok: boolean;
  /** Where this page's records came from on this request. */
  origin: 'live' | 'snapshot' | 'unavailable';
  httpStatus: number | null;
  /** ISO time the records were read from FASB. */
  readAt: string | null;
  recordsRead: number;
  /** totalRecords FASB reported for the listing. */
  totalRecords: number | null;
  complete: boolean;
  error?: string;
}

export interface AsuIndexCoverage {
  /** 'live' when every page was read from FASB on this build of the index. */
  source: 'live' | 'partial' | 'snapshot';
  /** ISO time this index was assembled. */
  assembledAt: string;
  /** True when this response was served from the 24-hour KV cache. */
  fromCache: boolean;
  pages: AsuSourcePageCoverage[];
  pagesRead: number;
  count: number;
  issuedCount: number;
  proposedCount: number;
  /** Issued Updates whose effective-date wording FASB still lists. */
  withEffectiveDates: number;
  issuedYears: { earliest: string; latest: string } | null;
  /** Why live reading failed, when it did. */
  liveError?: string;
  notes: string[];
}

export interface AsuIndex {
  entries: AsuEntry[];
  coverage: AsuIndexCoverage;
}

// ── Source endpoints ────────────────────────────────────────────────────────

export const FASB_ORIGIN = 'https://www.fasb.org';
const FASB_API = 'https://api.fasb.org/api/pagination/22';
/** One request returns the whole list; FASB's own pager offsets by one record per page, not by a page. */
export const FASB_PAGE_SIZE = 100;

export const ASU_SOURCE_PAGES: Record<AsuSourcePageId, { label: string; pageUrl: string; apiUrl: (size: number) => string }> = {
  issued: {
    label: 'Accounting Standards Updates Issued',
    pageUrl: `${FASB_ORIGIN}/standards/accounting-standard-updates`,
    apiUrl: size => `${FASB_API}/394009/1/${size}/All/NONE/NONE`,
  },
  'effective-dates': {
    label: 'Accounting Standards Updates — Effective Dates',
    pageUrl: `${FASB_ORIGIN}/standards/accounting-standard-updated-effective-date`,
    apiUrl: size => `${FASB_API}/394105/1/${size}/All/Type/ASU-Effective%20Dates`,
  },
  proposed: {
    label: 'Documents Open for Comment',
    pageUrl: `${FASB_ORIGIN}/projects/documents-open-for-comments`,
    apiUrl: size => `${FASB_API}/393996/1/${size}/All/NONE/NONE`,
  },
};

// ── HTML fragment helpers ───────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', reg: '®', copy: '©', sect: '§', hellip: '…',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export function fragmentText(html: string): string {
  return decodeEntities(html.replace(/<sup>[\s\S]*?<\/sup>/gi, '').replace(/<[^>]*>/g, ' '))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim();
}

/** Paragraph-preserving text (effective-date wording runs to several paragraphs). */
function fragmentParagraphs(html: string): string {
  // Paragraphs and list items, in document order: FASB states tiered
  // effective dates as an <ol> between two paragraphs (ASU 2016-02).
  const blocks = [...html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(match => {
      const text = fragmentText(match[2]);
      return text && match[1].toLowerCase() === 'li' ? `• ${text}` : text;
    })
    .filter(Boolean);
  if (blocks.length > 0) return blocks.join('\n\n');
  return fragmentText(html);
}

function hrefsIn(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)].map(match => match[1]);
}

/** Absolute, properly encoded fasb.org URL for a listing href ("/Page/Document?pdf=ASU 2025-04.pdf&…"). */
export function absoluteFasbUrl(href: string): string | null {
  const raw = decodeEntities(href.trim());
  // FASB's CMS occasionally swallows markup into an attribute (one ASU
  // 2014-09 section link carries "…>Section B</a>…"); such a URL is not a
  // document address and is dropped rather than linked.
  if (!raw || /[<>]|%3[ce]/i.test(raw)) return null;
  try {
    return new URL(raw, FASB_ORIGIN).href;
  } catch {
    return null;
  }
}

/** Normalize the dash forms FASB uses ("2009–05", "2016-11 ") to "2009-05". */
const UPDATE_NUMBER = /((?:19|20)\d{2})\s*[-–—]\s*(\d{1,2})\b/;

function normalizeUpdateNumber(text: string): string | null {
  const match = text.match(UPDATE_NUMBER);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}` : null;
}

/**
 * Codification topics a title names. FASB writes "(Topic 280)",
 * "(Subtopic 350-40)", "Liabilities (405)" and, in 2009, "Topic 105—…".
 */
export function extractAscTopics(title: string): { topics: string[]; subtopics: string[] } {
  const topics: string[] = [];
  const subtopics: string[] = [];
  const add = (topic: string, sub?: string) => {
    if (!topics.includes(topic)) topics.push(topic);
    if (sub) {
      const subtopic = `${topic}-${sub}`;
      if (!subtopics.includes(subtopic)) subtopics.push(subtopic);
    }
  };
  for (const match of title.matchAll(/\b(?:Sub)?[Tt]opics?\s+(\d{3})(?:-(\d{2,3}))?\b/g)) add(match[1], match[2]);
  for (const match of title.matchAll(/\((\d{3})(?:-(\d{2,3}))?\)/g)) add(match[1], match[2]);
  return { topics, subtopics };
}

function topicFields(title: string): Pick<AsuEntry, 'topic' | 'ascTopics' | 'ascSubtopics'> {
  const { topics, subtopics } = extractAscTopics(title);
  return { topic: topics[0] ? `ASC ${topics[0]}` : null, ascTopics: topics, ascSubtopics: subtopics };
}

// ── FASB API payload shape (only what is read) ───────────────────────────────

interface FasbPaginationPayload {
  totalRecords?: number;
  data?: Array<{
    node?: {
      itemId?: number;
      title?: string;
      content?: { data?: Record<string, unknown> };
    };
  }>;
}

function asPayload(value: unknown): FasbPaginationPayload {
  if (!value || typeof value !== 'object' || !Array.isArray((value as FasbPaginationPayload).data)) {
    throw new Error('FASB listing payload has no data array.');
  }
  return value as FasbPaginationPayload;
}

function stringField(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === 'string' ? value : '';
}

function linkField(data: Record<string, unknown> | undefined, key: string): { text: string; href: string } | null {
  const value = data?.[key];
  if (!value || typeof value !== 'object') return null;
  const link = value as Record<string, unknown>;
  return {
    text: typeof link.linkText === 'string' ? link.linkText.trim() : '',
    href: typeof link.externalLink === 'string' ? link.externalLink : '',
  };
}

export interface ParsedListing<T> {
  records: T[];
  /** Records the payload carried (after de-duplication by item id). */
  recordsRead: number;
  totalRecords: number | null;
  complete: boolean;
}

function uniqueNodes(payload: FasbPaginationPayload) {
  const seen = new Set<number | string>();
  const nodes = [];
  for (const item of payload.data ?? []) {
    const node = item.node;
    if (!node) continue;
    const key = node.itemId ?? node.title ?? nodes.length;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(node);
  }
  return nodes;
}

function listingCompleteness(payload: FasbPaginationPayload, recordsRead: number) {
  const totalRecords = typeof payload.totalRecords === 'number' ? payload.totalRecords : null;
  return { totalRecords, complete: totalRecords === null ? false : recordsRead >= totalRecords };
}

// ── Issued listing ──────────────────────────────────────────────────────────

export interface IssuedListingRecord {
  number: string;
  title: string;
  year: string;
  pdfUrl: string | null;
  documents: AsuDocumentLink[];
}

/**
 * Parse the "Accounting Standards Updates Issued" records. Each record is a
 * year whose body is a run of <p> entries; a multi-part Update is a <p>
 * heading followed by a <ul> of section PDFs.
 */
export function parseIssuedListing(payloadValue: unknown): ParsedListing<IssuedListingRecord> {
  const payload = asPayload(payloadValue);
  const nodes = uniqueNodes(payload);
  const records: IssuedListingRecord[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const year = (node.title || '').match(/(?:19|20)\d{2}/)?.[0] ?? '';
    const html = stringField(node.content?.data, 'content');
    let current: IssuedListingRecord | null = null;

    for (const block of html.matchAll(/<(p|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const [, tag, inner] = block;
      if (tag.toLowerCase() === 'ul') {
        // Section PDFs of the Update announced by the preceding paragraph.
        if (!current) continue;
        for (const item of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
          // First anchor with a usable address; its own text is the label.
          for (const anchor of item[1].matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>((?:(?!<a\b)[\s\S])*?)(?=<\/a>|<a\b)/gi)) {
            const url = absoluteFasbUrl(anchor[1]);
            if (!url) continue;
            current.documents.push({ label: fragmentText(anchor[2]) || 'Section', url });
            if (!current.pdfUrl) current.pdfUrl = url;
            break;
          }
        }
        continue;
      }

      const text = fragmentText(inner);
      const heading = text.match(/^Update\s+(?:No\.\s*)?((?:19|20)\d{2}\s*[-–]\s*\d{1,2})\s*[—–-]?\s*(.*)$/i);
      if (!heading) continue;
      const number = normalizeUpdateNumber(heading[1]);
      if (!number || seen.has(number)) {
        current = null;
        continue;
      }
      seen.add(number);
      const url = hrefsIn(inner).map(absoluteFasbUrl).find(Boolean) ?? null;
      current = {
        number,
        title: heading[2].replace(/^[—–-]\s*/, '').trim(),
        year: year || number.slice(0, 4),
        pdfUrl: url,
        documents: url ? [{ label: `ASU ${number}`, url }] : [],
      };
      records.push(current);
    }
  }

  return { records, recordsRead: nodes.length, ...listingCompleteness(payload, nodes.length) };
}

// ── Effective-dates listing ─────────────────────────────────────────────────

export interface EffectiveDateRecord {
  number: string;
  title: string;
  /** "2023-11" */
  issuedMonth: string | null;
  effectiveDates: string;
  pdfUrl: string | null;
}

export function parseEffectiveDates(payloadValue: unknown): ParsedListing<EffectiveDateRecord> {
  const payload = asPayload(payloadValue);
  const nodes = uniqueNodes(payload);
  const records: EffectiveDateRecord[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const data = node.content?.data;
    const finalDocument = fragmentText(stringField(data, 'final_document')) || fragmentText(node.title || '');
    const number = normalizeUpdateNumber(finalDocument);
    if (!number || seen.has(number)) continue;
    seen.add(number);
    const date = stringField(data, 'date').match(/^((?:19|20)\d{2})-(\d{2})/);
    const title = finalDocument.replace(/^.*?(?:19|20)\d{2}\s*[-–]\s*\d{1,2}\s*[—–-]?\s*/, '').trim();
    records.push({
      number,
      title,
      issuedMonth: date ? `${date[1]}-${date[2]}` : null,
      effectiveDates: fragmentParagraphs(stringField(data, 'effective_dates')),
      pdfUrl: absoluteFasbUrl(stringField(data, 'downloadLink')),
    });
  }

  return { records, recordsRead: nodes.length, ...listingCompleteness(payload, nodes.length) };
}

// ── Proposed (open for comment) ─────────────────────────────────────────────

export function parseProposedListing(payloadValue: unknown): ParsedListing<AsuEntry> {
  const payload = asPayload(payloadValue);
  const nodes = uniqueNodes(payload);
  const records: AsuEntry[] = [];

  for (const node of nodes) {
    const data = node.content?.data;
    const description = stringField(data, 'document_description');
    const emphasized = description.match(/<em>([\s\S]*?)<\/em>/i)?.[1];
    const title = emphasized
      ? fragmentText(emphasized)
      : fragmentText(node.title || '').replace(/^Proposed\s+(?:Accounting Standards Update|ASU)\s*[—–,:-]\s*/i, '');
    if (!title) continue;
    const fileReference = linkField(data, 'comment_letters')?.text || linkField(data, 'xbrl')?.text || '';
    const pdfUrl = hrefsIn(description).map(absoluteFasbUrl).find(url => Boolean(url && /fasb\.org\/page\/document/i.test(url))) ?? null;
    const deadline = stringField(data, 'date').match(/^((?:19|20)\d{2}-\d{2}-\d{2})/)?.[1] ?? null;
    records.push({
      number: fileReference || `Proposed: ${title}`,
      title,
      ...topicFields(title),
      issuedDate: null,
      issuedDatePrecision: null,
      effectiveDates: null,
      pdfUrl,
      documents: pdfUrl ? [{ label: 'Exposure draft', url: pdfUrl }] : [],
      status: 'proposed',
      commentDeadline: deadline,
      sourcePage: 'proposed',
    });
  }

  return { records, recordsRead: nodes.length, ...listingCompleteness(payload, nodes.length) };
}

// ── Merge ───────────────────────────────────────────────────────────────────

/**
 * One row per Update: the issued listing is the inventory; the effective-dates
 * listing contributes the month issued and FASB's effective-date wording for
 * the Updates it still carries. An Update on the effective-dates page that the
 * issued listing lacks (FASB's two pages disagree) is still indexed, sourced
 * to the page it came from.
 */
export function mergeAsuListings(
  issued: IssuedListingRecord[],
  effective: EffectiveDateRecord[],
  proposed: AsuEntry[],
): AsuEntry[] {
  const effectiveByNumber = new Map(effective.map(record => [record.number, record]));
  const entries: AsuEntry[] = [];
  const indexed = new Set<string>();

  for (const record of issued) {
    const dates = effectiveByNumber.get(record.number);
    indexed.add(record.number);
    entries.push({
      number: record.number,
      title: record.title,
      ...topicFields(record.title),
      issuedDate: dates?.issuedMonth ?? record.year ?? null,
      issuedDatePrecision: dates?.issuedMonth ? 'month' : record.year ? 'year' : null,
      effectiveDates: dates?.effectiveDates || null,
      pdfUrl: record.pdfUrl ?? dates?.pdfUrl ?? null,
      documents: record.documents.length > 0 ? record.documents : dates?.pdfUrl ? [{ label: `ASU ${record.number}`, url: dates.pdfUrl }] : [],
      status: 'issued',
      sourcePage: 'issued',
    });
  }

  for (const record of effective) {
    if (indexed.has(record.number)) continue;
    indexed.add(record.number);
    entries.push({
      number: record.number,
      title: record.title,
      ...topicFields(record.title),
      issuedDate: record.issuedMonth,
      issuedDatePrecision: record.issuedMonth ? 'month' : null,
      effectiveDates: record.effectiveDates || null,
      pdfUrl: record.pdfUrl,
      documents: record.pdfUrl ? [{ label: `ASU ${record.number}`, url: record.pdfUrl }] : [],
      status: 'issued',
      sourcePage: 'effective-dates',
    });
  }

  entries.sort((a, b) => b.number.localeCompare(a.number));
  return [...proposed, ...entries];
}

// ── Assembly with coverage ──────────────────────────────────────────────────

export interface AsuPageRead<T> {
  id: AsuSourcePageId;
  origin: 'live' | 'snapshot' | 'unavailable';
  httpStatus: number | null;
  readAt: string | null;
  parsed: ParsedListing<T> | null;
  error?: string;
}

export interface AsuSnapshot {
  /** ISO time the snapshot's pages were read from FASB. */
  readAt: string;
  issued: ParsedListing<IssuedListingRecord>;
  effective: ParsedListing<EffectiveDateRecord>;
  proposed: ParsedListing<AsuEntry>;
}

function pageCoverage<T>(read: AsuPageRead<T>): AsuSourcePageCoverage {
  const source = ASU_SOURCE_PAGES[read.id];
  return {
    id: read.id,
    label: source.label,
    pageUrl: source.pageUrl,
    apiUrl: source.apiUrl(FASB_PAGE_SIZE),
    ok: read.parsed !== null,
    origin: read.origin,
    httpStatus: read.httpStatus,
    readAt: read.readAt,
    recordsRead: read.parsed?.recordsRead ?? 0,
    totalRecords: read.parsed?.totalRecords ?? null,
    complete: read.parsed?.complete ?? false,
    ...(read.error ? { error: read.error } : {}),
  };
}

export function assembleAsuIndex(
  reads: {
    issued: AsuPageRead<IssuedListingRecord>;
    effective: AsuPageRead<EffectiveDateRecord>;
    proposed: AsuPageRead<AsuEntry>;
  },
  assembledAt: string,
): AsuIndex {
  const entries = mergeAsuListings(
    reads.issued.parsed?.records ?? [],
    reads.effective.parsed?.records ?? [],
    reads.proposed.parsed?.records ?? [],
  );
  const pages = [pageCoverage(reads.issued), pageCoverage(reads.effective), pageCoverage(reads.proposed)];
  const origins = pages.map(page => page.origin);
  const source: AsuIndexCoverage['source'] = origins.every(origin => origin === 'live')
    ? 'live'
    : origins.some(origin => origin === 'live') ? 'partial' : 'snapshot';

  const issuedEntries = entries.filter(entry => entry.status === 'issued');
  const years = issuedEntries.map(entry => (entry.issuedDate || entry.number).slice(0, 4)).filter(Boolean).sort();
  const notes: string[] = [];
  for (const page of pages) {
    if (page.origin === 'snapshot') {
      notes.push(`${page.label}: FASB could not be read on this request; showing the copy read from fasb.org on ${page.readAt?.slice(0, 10) ?? 'an earlier date'}.`);
    } else if (page.origin === 'unavailable') {
      notes.push(`${page.label}: not available — ${page.error || 'FASB could not be read and no saved copy exists'}.`);
    } else if (!page.complete) {
      notes.push(`${page.label}: read ${page.recordsRead} of ${page.totalRecords ?? 'an unreported number of'} records.`);
    }
  }
  notes.push('Issue dates are shown to the month (FASB effective-dates page) or to the year (issued listing) — never to a day FASB did not print.');
  notes.push('Effective-date wording appears only for Updates FASB still lists on its effective-dates page.');
  notes.push('Proposed Updates are those currently open for comment; closed exposure drafts are not indexed.');

  const errors = pages.filter(page => page.origin !== 'live' && page.error).map(page => `${page.label}: ${page.error}`);

  return {
    entries,
    coverage: {
      source,
      assembledAt,
      fromCache: false,
      pages,
      pagesRead: pages.filter(page => page.ok).length,
      count: entries.length,
      issuedCount: issuedEntries.length,
      proposedCount: entries.length - issuedEntries.length,
      withEffectiveDates: issuedEntries.filter(entry => entry.effectiveDates).length,
      issuedYears: years.length > 0 ? { earliest: years[0], latest: years[years.length - 1] } : null,
      ...(errors.length > 0 ? { liveError: errors.join(' · ') } : {}),
      notes,
    },
  };
}

// ── Live read ───────────────────────────────────────────────────────────────

/** Cloudflare answers a blocked client with an HTML interstitial, not JSON. */
function describeBlocked(status: number, body: string): string {
  if (/cloudflare/i.test(body) && /(blocked|attention required|challenge)/i.test(body)) {
    return `fasb.org refused the server's request (HTTP ${status}, Cloudflare bot protection).`;
  }
  return `fasb.org answered HTTP ${status}.`;
}

async function readPage<T>(
  id: AsuSourcePageId,
  fetchImpl: FetchLike,
  parse: (payload: unknown) => ParsedListing<T>,
  snapshot: ParsedListing<T> | null,
  snapshotReadAt: string | null,
  now: () => Date,
): Promise<AsuPageRead<T>> {
  const url = ASU_SOURCE_PAGES[id].apiUrl(FASB_PAGE_SIZE);
  let error = '';
  let httpStatus: number | null = null;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json, text/plain;q=0.9', 'User-Agent': 'UniqusResearchCenter/1.0 (ASU index)' },
    });
    httpStatus = response.status;
    const body = await response.text();
    if (!response.ok) {
      error = describeBlocked(response.status, body);
    } else {
      const parsed = parse(JSON.parse(body));
      return { id, origin: 'live', httpStatus, readAt: now().toISOString(), parsed };
    }
  } catch (caught) {
    const name = (caught as { name?: unknown } | null)?.name;
    const message = (caught as { message?: unknown } | null)?.message;
    error = name === 'TimeoutError' || name === 'AbortError'
      ? 'fasb.org did not answer within the deadline.'
      : caught instanceof SyntaxError
        ? 'fasb.org returned a payload that is not the listing JSON.'
        : `fasb.org could not be read (${typeof message === 'string' && message ? message : 'unknown error'}).`;
  }
  if (snapshot) return { id, origin: 'snapshot', httpStatus, readAt: snapshotReadAt, parsed: snapshot, error };
  return { id, origin: 'unavailable', httpStatus, readAt: null, parsed: null, error };
}

export interface AsuIndexCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ex?: number }): Promise<void>;
}

export const ASU_INDEX_CACHE_KEY = 'urc:asu-index:v1';
export const ASU_INDEX_TTL_SECONDS = 24 * 60 * 60;
/** A degraded build is cached briefly so a blocked upstream is not hammered, then retried. */
export const ASU_INDEX_DEGRADED_TTL_SECONDS = 60 * 60;

export interface LoadAsuIndexOptions {
  fetchImpl: FetchLike;
  cache?: AsuIndexCache | null;
  snapshot?: AsuSnapshot | null;
  now?: () => Date;
}

/**
 * Cached read of the index. A fully live build is cached for 24 hours; a
 * build that had to fall back to the saved copy is cached for one hour so
 * the next attempt at FASB is not a day away.
 */
export async function loadAsuIndex(options: LoadAsuIndexOptions): Promise<AsuIndex> {
  const now = options.now ?? (() => new Date());
  const cached = options.cache ? await options.cache.get<AsuIndex>(ASU_INDEX_CACHE_KEY) : null;
  if (cached && Array.isArray(cached.entries) && cached.coverage) {
    return { entries: cached.entries, coverage: { ...cached.coverage, fromCache: true } };
  }

  const snapshot = options.snapshot ?? null;
  const [issued, effective, proposed] = await Promise.all([
    readPage('issued', options.fetchImpl, parseIssuedListing, snapshot?.issued ?? null, snapshot?.readAt ?? null, now),
    readPage('effective-dates', options.fetchImpl, parseEffectiveDates, snapshot?.effective ?? null, snapshot?.readAt ?? null, now),
    readPage('proposed', options.fetchImpl, parseProposedListing, snapshot?.proposed ?? null, snapshot?.readAt ?? null, now),
  ]);
  const index = assembleAsuIndex({ issued, effective, proposed }, now().toISOString());

  if (options.cache && index.entries.length > 0) {
    await options.cache.set(ASU_INDEX_CACHE_KEY, index, {
      ex: index.coverage.source === 'live' ? ASU_INDEX_TTL_SECONDS : ASU_INDEX_DEGRADED_TTL_SECONDS,
    });
  }
  return index;
}

// ── Query helpers (client-safe) ─────────────────────────────────────────────

/** Parse an issue's ASC reference ("ASC 606", "ASC 205-40") into what ASU titles name. */
export function parseIssueAsc(asc: string | undefined | null): { topic: string; subtopic: string | null } | null {
  const match = (asc || '').match(/(\d{3})(?:-(\d{2,3}))?/);
  if (!match) return null;
  return { topic: match[1], subtopic: match[2] ? `${match[1]}-${match[2]}` : null };
}

/**
 * Updates whose titles name the issue's Codification topic. A subtopic issue
 * (going concern, ASC 205-40) matches only Updates naming that subtopic, not
 * every Update that touches Topic 205.
 */
export function asusForAscReference(entries: readonly AsuEntry[], asc: string | undefined | null): AsuEntry[] {
  const reference = parseIssueAsc(asc);
  if (!reference) return [];
  return entries.filter(entry => (
    reference.subtopic
      ? entry.ascSubtopics.includes(reference.subtopic)
      : entry.ascTopics.includes(reference.topic)
  ));
}

export function findAsu(entries: readonly AsuEntry[], number: string): AsuEntry | undefined {
  const normalized = normalizeUpdateNumber(number) ?? number.trim();
  return entries.find(entry => entry.number === normalized);
}

/** Every ASU number a piece of text cites ("ASU 2023-07", "ASU No. 2016-13", "Accounting Standards Update 2023-09"). */
export function asuCitationsInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  const pattern = /\b(?:ASU|Accounting\s+Standards\s+Update)(?:\s+(?:No\.|Topic))?\s*((?:19|20)\d{2})\s*[-–]\s*(\d{1,2})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const number = `${match[1]}-${match[2].padStart(2, '0')}`;
    if (!found.includes(number)) found.push(number);
  }
  return found;
}

/** Anchor id of an ASU row in the hub's ASU index. */
export function asuRowId(number: string): string {
  return `asu-${number.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

/** Link to an ASU row in the Accounting hub's ASU index. */
export function asuRowHref(number: string): string {
  const params = new URLSearchParams({ tab: 'asu', asu: number });
  return `/accounting?${params.toString()}#${asuRowId(number)}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Research Workbench URL for "filings citing ASU 2023-07, 10-K, last 2 years",
 * expressed in the search's own route parameters (see researchSessions
 * ROUTE_FILTER_KEYS: cites, forms, from, to).
 */
export function asuCitationSearchHref(
  number: string,
  options: { forms?: string[]; years?: number; now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - (options.years ?? 2));
  const params = new URLSearchParams();
  params.set('v', '1');
  params.set('cites', `ASU ${number}`);
  params.set('from', isoDate(from));
  params.set('to', isoDate(now));
  params.set('forms', (options.forms ?? ['10-K']).join(','));
  return `/search?${params.toString()}`;
}

/** "November 2023" / "2016" for display; null-safe. */
export function formatAsuIssued(entry: Pick<AsuEntry, 'issuedDate' | 'issuedDatePrecision'>): string {
  if (!entry.issuedDate) return 'Not stated';
  if (entry.issuedDatePrecision === 'month') {
    const [year, month] = entry.issuedDate.split('-').map(Number);
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return label;
  }
  return entry.issuedDate;
}

// ── Client fetch ────────────────────────────────────────────────────────────

export interface AsuIndexResponse extends AsuIndex {
  ok: true;
}

export async function fetchAsuIndex(
  query: { topic?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<AsuIndex> {
  const params = new URLSearchParams();
  if (query.topic) params.set('topic', query.topic);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetchImpl(`/api/asu${suffix}`);
  if (!response.ok) throw new Error(`ASU index request failed (HTTP ${response.status}).`);
  const payload = await response.json() as Partial<AsuIndexResponse>;
  if (!Array.isArray(payload.entries) || !payload.coverage) throw new Error('ASU index response is malformed.');
  return { entries: payload.entries, coverage: payload.coverage };
}
