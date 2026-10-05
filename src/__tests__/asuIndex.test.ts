import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ASU_INDEX_CACHE_KEY,
  ASU_INDEX_DEGRADED_TTL_SECONDS,
  ASU_INDEX_TTL_SECONDS,
  asuCitationSearchHref,
  asuCitationsInText,
  asuRowHref,
  asusForAscReference,
  extractAscTopics,
  findAsu,
  formatAsuIssued,
  loadAsuIndex,
  mergeAsuListings,
  parseEffectiveDates,
  parseIssuedListing,
  parseProposedListing,
  type AsuIndex,
  type AsuSnapshot,
} from '../services/asuIndex';
import { parseResearchRouteParams } from '../services/researchSessions';
import snapshotJson from '../data/fasb/asu-index-snapshot.json';

/**
 * Fixtures are FASB's own listing payloads (api.fasb.org, which serves the
 * fasb.org listing pages), saved 2026-10-05. Each record body is the HTML
 * fragment the page renders; the parser reads those fragments.
 */
const FIXTURES = join(process.cwd(), 'src', '__tests__', 'fixtures', 'fasb');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const json = (name: string): unknown => JSON.parse(fixture(name));

describe('issued ASU listing parser', () => {
  const listing = parseIssuedListing(json('issued-listing.json'));

  it('reads every year group FASB reported and every Update in them', () => {
    expect(listing.totalRecords).toBe(18);
    expect(listing.recordsRead).toBe(18);
    expect(listing.complete).toBe(true);
    expect(listing.records).toHaveLength(233);
    // The count is the number of distinct "Update YYYY-NN" headings in the payload, not a guess.
    const raw = fixture('issued-listing.json');
    const headings = new Set([...raw.matchAll(/>Update (?:No\. )?((?:19|20)\d{2})\s*[-–]\s*(\d{2})/g)].map(match => `${match[1]}-${match[2]}`));
    expect(listing.records.map(record => record.number).sort()).toEqual([...headings].sort());
  });

  it('parses a single-PDF Update into number, title, year, and an absolute PDF link', () => {
    const asu = listing.records.find(record => record.number === '2023-07');
    expect(asu).toMatchObject({
      number: '2023-07',
      title: 'Segment Reporting (Topic 280): Improvements to Reportable Segment Disclosures',
      year: '2023',
    });
    expect(asu?.pdfUrl).toMatch(/^https:\/\/www\.fasb\.org\/page\/Document\?pdf=ASU%202023-07\.pdf/i);
  });

  it('collects the section PDFs of a multi-part Update and drops FASB’s malformed section link', () => {
    const leases = listing.records.find(record => record.number === '2016-02');
    expect(leases?.title).toBe('Leases (Topic 842)');
    expect(leases?.documents.map(document => document.label)).toEqual(['Section A', 'Section B', 'Section C']);
    expect(leases?.pdfUrl).toContain('ASU+2016-02_Section+A.pdf');

    const revenue = listing.records.find(record => record.number === '2014-09');
    expect(revenue?.documents.map(document => document.label)).toEqual(['Section A', 'Section B', 'Section C']);
    for (const document of revenue?.documents ?? []) {
      expect(document.url).not.toMatch(/%3C|%3E/i);
    }
  });

  it('normalizes en-dash and "No." spellings of 2009 Update numbers', () => {
    expect(listing.records.find(record => record.number === '2009-05')?.title).toMatch(/^Fair Value Measurements and Disclosures \(Topic 820\)/);
    expect(listing.records.find(record => record.number === '2009-17')?.title).toMatch(/^Consolidations \(Topic 810\)/);
  });
});

describe('effective-dates listing parser', () => {
  const listing = parseEffectiveDates(json('effective-dates-first-40.json'));

  it('reports a partial read when FASB lists more records than the payload carried', () => {
    expect(listing.totalRecords).toBe(86);
    expect(listing.recordsRead).toBe(40);
    expect(listing.complete).toBe(false);
  });

  it('reads the month issued and FASB’s effective-date wording', () => {
    const segment = listing.records.find(record => record.number === '2023-07');
    expect(segment?.issuedMonth).toBe('2023-11');
    expect(segment?.effectiveDates).toMatch(/^The amendments apply to all public entities/);
    expect(segment?.effectiveDates).toContain('annual periods beginning after December 15, 2023');
    expect(segment?.effectiveDates).not.toMatch(/<[a-z]/i);
  });
});

describe('proposed (open for comment) parser', () => {
  const listing = parseProposedListing(json('documents-open-for-comment.json'));

  it('reads each exposure draft with its file reference, topic, deadline, and PDF', () => {
    expect(listing.complete).toBe(true);
    expect(listing.records.map(record => record.number)).toEqual(['2026-ED500', '2026-ED400', '2026-ED600']);
    const cash = listing.records.find(record => record.number === '2026-ED400');
    expect(cash).toMatchObject({
      status: 'proposed',
      topic: 'ASC 230',
      commentDeadline: '2026-11-19',
      issuedDate: null,
      effectiveDates: null,
    });
    expect(cash?.title).toBe('Statement of Cash Flows (Topic 230): Cash Equivalents—Disclosure Enhancement and Evaluation of Certain Digital Assets');
    expect(cash?.pdfUrl).toMatch(/^https:\/\/www\.fasb\.org\/Page\/Document\?pdf=Proposed%20ASU/);
    const servicing = listing.records.find(record => record.number === '2026-ED600');
    expect(servicing?.ascSubtopics).toEqual(['860-50']);
  });
});

describe('merged index rows', () => {
  const issued = parseIssuedListing(json('issued-listing.json')).records;
  const effective = parseEffectiveDates(json('effective-dates-first-40.json')).records;
  const proposed = parseProposedListing(json('documents-open-for-comment.json')).records;
  const entries = mergeAsuListings(issued, effective, proposed);

  it('produces the required row shape for an issued Update', () => {
    expect(findAsu(entries, 'ASU 2023-07')).toMatchObject({
      number: '2023-07',
      title: 'Segment Reporting (Topic 280): Improvements to Reportable Segment Disclosures',
      topic: 'ASC 280',
      issuedDate: '2023-11',
      issuedDatePrecision: 'month',
      status: 'issued',
    });
    expect(findAsu(entries, '2023-07')?.effectiveDates).toBeTruthy();
    expect(findAsu(entries, '2023-07')?.pdfUrl).toBeTruthy();
  });

  it('falls back to the listing year, and to no effective-date text, for Updates FASB no longer lists as in transition', () => {
    const goingConcern = findAsu(entries, '2014-15');
    expect(goingConcern).toMatchObject({ issuedDate: '2014', issuedDatePrecision: 'year', effectiveDates: null });
    expect(formatAsuIssued(goingConcern!)).toBe('2014');
    expect(formatAsuIssued(findAsu(entries, '2023-07')!)).toBe('November 2023');
  });

  it('lists proposals first, then issued Updates newest first', () => {
    expect(entries.slice(0, 3).every(entry => entry.status === 'proposed')).toBe(true);
    expect(entries[3].number).toBe('2026-03');
  });

  it('matches issue pages to Updates by topic, and subtopic issues only by subtopic', () => {
    const segment = asusForAscReference(entries, 'ASC 280').map(entry => entry.number);
    expect(segment).toContain('2023-07');
    expect(segment).not.toContain('2016-02');

    const goingConcern = asusForAscReference(entries, 'ASC 205-40').map(entry => entry.number);
    expect(goingConcern).toContain('2014-15');
    // Topic 205 Updates that do not name Subtopic 205-40 are not going-concern Updates.
    expect(goingConcern).not.toContain('2021-06');
    expect(asusForAscReference(entries, undefined)).toEqual([]);
  });
});

describe('Codification topic extraction', () => {
  it.each([
    ['Segment Reporting (Topic 280): Improvements', ['280'], []],
    ['Intangibles—Goodwill and Other—Internal-Use Software (Subtopic 350-40): Targeted Improvements', ['350'], ['350-40']],
    ['Liabilities (405): Amendments to SEC Paragraphs', ['405'], []],
    ['Topic 105—Generally Accepted Accounting Principles', ['105'], []],
    ['Compensation—Stock Compensation (Topic 718) and Revenue from Contracts with Customers (Topic 606)', ['718', '606'], []],
    ['Codification Improvements', [], []],
  ])('%s', (title, topics, subtopics) => {
    expect(extractAscTopics(title)).toEqual({ topics, subtopics });
  });
});

describe('ASU links', () => {
  it('builds a Research Workbench URL the search route parser reads back as a citation filter', () => {
    const href = asuCitationSearchHref('2023-07', { now: new Date('2026-10-04T12:00:00Z') });
    const parsed = parseResearchRouteParams(new URL(href, 'https://urc.test').searchParams);
    expect(parsed?.query).toBe('');
    expect(parsed?.filters.ascReference).toBe('ASU 2023-07');
    expect(parsed?.filters.formTypes).toEqual(['10-K']);
    expect(parsed?.filters.dateFrom).toBe('2024-10-04');
    expect(parsed?.filters.dateTo).toBe('2026-10-04');
  });

  it('finds ASU citations in filing snippets in every spelling the citation filter accepts', () => {
    expect(asuCitationsInText('adopted ASU 2023-07 and ASU No. 2016-13; see Accounting Standards Update 2023-09 and ASU Topic 2023-07')).toEqual([
      '2023-07', '2016-13', '2023-09',
    ]);
    expect(asuCitationsInText('Topic 842 only')).toEqual([]);
    expect(asuRowHref('2023-07')).toBe('/accounting?tab=asu&asu=2023-07#asu-2023-07');
  });
});

describe('loadAsuIndex', () => {
  const snapshot = snapshotJson as unknown as AsuSnapshot;
  const blockedPage = fixture('cloudflare-blocked.html');

  function memoryCache(initial: AsuIndex | null = null) {
    let stored: unknown = initial;
    return {
      get: vi.fn(async () => stored as never),
      set: vi.fn(async (_key: string, value: unknown) => { stored = value; }),
    };
  }

  it('reads all three pages live, labels the index live, and caches it for 24 hours', async () => {
    const payloads: Record<string, string> = {
      '394009': fixture('issued-listing.json'),
      '394105': fixture('effective-dates-first-40.json'),
      '393996': fixture('documents-open-for-comment.json'),
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const id = String(input).match(/pagination\/22\/(\d+)\//)?.[1] ?? '';
      return new Response(payloads[id], { status: 200 });
    });
    const cache = memoryCache();
    const index = await loadAsuIndex({ fetchImpl, cache, snapshot, now: () => new Date('2026-10-05T00:00:00Z') });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(index.coverage.source).toBe('live');
    expect(index.coverage.pagesRead).toBe(3);
    expect(index.coverage.issuedCount).toBe(233);
    expect(index.coverage.proposedCount).toBe(3);
    expect(index.coverage.pages.find(page => page.id === 'effective-dates')).toMatchObject({ origin: 'live', recordsRead: 40, totalRecords: 86, complete: false });
    expect(index.coverage.notes.join(' ')).toContain('read 40 of 86 records');
    expect(cache.set).toHaveBeenCalledWith(ASU_INDEX_CACHE_KEY, index, { ex: ASU_INDEX_TTL_SECONDS });
  });

  it('serves the saved copy, page by page, when fasb.org blocks the server, and says so', async () => {
    const fetchImpl = vi.fn(async () => new Response(blockedPage, { status: 403, headers: { 'content-type': 'text/html' } }));
    const cache = memoryCache();
    const index = await loadAsuIndex({ fetchImpl, cache, snapshot });

    expect(index.coverage.source).toBe('snapshot');
    expect(index.entries.length).toBeGreaterThan(200);
    for (const page of index.coverage.pages) {
      expect(page.origin).toBe('snapshot');
      expect(page.readAt).toBe(snapshot.readAt);
      expect(page.error).toMatch(/Cloudflare bot protection/);
    }
    expect(index.coverage.liveError).toMatch(/HTTP 403/);
    expect(cache.set).toHaveBeenCalledWith(ASU_INDEX_CACHE_KEY, index, { ex: ASU_INDEX_DEGRADED_TTL_SECONDS });
  });

  it('reports a page as unavailable, never empty-but-fine, when there is no saved copy', async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException('deadline', 'TimeoutError'); });
    const index = await loadAsuIndex({ fetchImpl, cache: null, snapshot: null });
    expect(index.entries).toEqual([]);
    expect(index.coverage.pagesRead).toBe(0);
    expect(index.coverage.pages.every(page => page.origin === 'unavailable' && /deadline/.test(page.error || ''))).toBe(true);
  });

  it('answers from the KV cache without touching FASB, marked as cached', async () => {
    const fetchImpl = vi.fn();
    const cachedIndex: AsuIndex = {
      entries: [],
      coverage: { source: 'live', assembledAt: '2026-10-04T00:00:00.000Z', fromCache: false, pages: [], pagesRead: 3, count: 0, issuedCount: 0, proposedCount: 0, withEffectiveDates: 0, issuedYears: null, notes: [] },
    };
    const index = await loadAsuIndex({ fetchImpl, cache: memoryCache(cachedIndex), snapshot });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(index.coverage.fromCache).toBe(true);
  });

  it('keeps every saved fixture under 150 KB', () => {
    for (const name of ['issued-listing.json', 'effective-dates-first-40.json', 'documents-open-for-comment.json', 'cloudflare-blocked.html']) {
      expect(Buffer.byteLength(fixture(name)), name).toBeLessThan(150 * 1024);
    }
  });
});
