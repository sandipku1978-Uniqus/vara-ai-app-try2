import { describe, expect, it } from 'vitest';
import {
  BROWSE_PAGE_SIZE,
  EPISODE_NOUN,
  MATCH_NOUN,
  SEARCH_PAGE_SIZE,
  SEARCH_POOL_DEPTH,
  appendPagedList,
  companyScopeFromSelection,
  companyScopeFromText,
  companyScopeFromUrl,
  companyScopeQuery,
  companyScopeText,
  describeCompanyScope,
  describeRemaining,
  describeShown,
  emptyPagedList,
  letterBrowseParams,
  letterSearchParams,
  pagingStatus,
  registrantNameStandIn,
  startPagedList,
  type CompanyScope,
} from '../domain/commentLetterPaging';

interface Row { id: string }

const rows = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: `row-${from + index}` }));
const byId = (row: Row) => row.id;

describe('comment-letter paging state', () => {
  it('starts from the first page and reports what is on screen against the server total', () => {
    const list = startPagedList({ items: rows(0, 12), total: 30 });
    expect(list).toMatchObject({ fetched: 12, total: 30, totalIsFloor: false, exhausted: false });
    expect(describeShown(list, EPISODE_NOUN)).toBe('Showing 12 of 30 review episodes');
    expect(describeRemaining(list, EPISODE_NOUN)).toBe('18 more review episodes');
    expect(pagingStatus(list)).toBe('more');
  });

  it('appends the next page, advances the offset, and disappears once every reported row is shown', () => {
    const first = startPagedList({ items: rows(0, 12), total: 14 });
    const second = appendPagedList(first, { items: rows(12, 2), total: 14 }, byId);
    expect(second.items.map(byId)).toEqual(rows(0, 14).map(byId));
    expect(second.fetched).toBe(14);
    expect(pagingStatus(second)).toBe('complete');
    expect(describeShown(second, EPISODE_NOUN)).toBe('Showing 14 of 14 review episodes');
  });

  it('drops rows already on screen without losing the server offset', () => {
    // A dossier deep link merges the requested episode ahead of the page it
    // naturally sits on; when that page arrives the episode must not appear twice.
    const requested: Row = { id: 'row-13' };
    const first = startPagedList({ items: [requested, ...rows(0, 12)], fetched: 12, total: 14 });
    expect(describeShown(first, EPISODE_NOUN)).toBe('Showing 13 of 14 review episodes');
    const second = appendPagedList(first, { items: rows(12, 2), total: 14 }, byId);
    expect(second.items.filter(row => row.id === 'row-13')).toHaveLength(1);
    expect(second.items).toHaveLength(14);
    expect(second.fetched).toBe(14);
    expect(pagingStatus(second)).toBe('complete');
  });

  it('never claims a total below what is on screen', () => {
    // The merged deep-link episode is outside the scoped total: the header
    // counts it, and Load more does not fabricate a page for it.
    const list = startPagedList({ items: [{ id: 'requested' }], fetched: 0, total: 0 });
    expect(describeShown(list, EPISODE_NOUN)).toBe('Showing 1 of 1 review episode');
    expect(pagingStatus(list)).toBe('complete');
  });

  it('stops at the ranked pool depth and says how many matches lie beyond it', () => {
    let list = startPagedList({ items: rows(0, SEARCH_PAGE_SIZE), total: 1_450 });
    while (pagingStatus(list, SEARCH_POOL_DEPTH) === 'more') {
      list = appendPagedList(list, { items: rows(list.fetched, SEARCH_PAGE_SIZE), total: 1_450 }, byId);
    }
    expect(list.fetched).toBe(SEARCH_POOL_DEPTH);
    expect(pagingStatus(list, SEARCH_POOL_DEPTH)).toBe('capped');
    expect(describeShown(list, MATCH_NOUN)).toBe('Showing 1,000 of 1,450 matching letters');
    expect(describeRemaining(list, MATCH_NOUN)).toBe('450 more matching letters');
  });

  it('keeps the 10,000+ floor visible in the shown-of-total header', () => {
    const list = startPagedList({ items: rows(0, SEARCH_PAGE_SIZE), total: 10_000, totalIsFloor: true });
    expect(describeShown(list, MATCH_NOUN)).toBe('Showing 50 of 10,000+ matching letters');
    expect(describeRemaining(list, MATCH_NOUN)).toBe('at least 9,950 more matching letters');
    expect(pagingStatus(list, SEARCH_POOL_DEPTH)).toBe('more');
  });

  it('reports an empty follow-up page as exhausted rather than offering an endless Load more', () => {
    const first = startPagedList({ items: rows(0, BROWSE_PAGE_SIZE), total: 20 });
    const stalled = appendPagedList(first, { items: [], total: 20 }, byId);
    expect(stalled.items).toHaveLength(BROWSE_PAGE_SIZE);
    expect(stalled.fetched).toBe(BROWSE_PAGE_SIZE);
    expect(pagingStatus(stalled)).toBe('exhausted');
    // …but a recovered total that matches the screen is simply complete.
    const settled = appendPagedList(first, { items: [], total: BROWSE_PAGE_SIZE }, byId);
    expect(pagingStatus(settled)).toBe('complete');
  });

  it('uses singular nouns only for a genuine total of one', () => {
    expect(describeShown(startPagedList({ items: rows(0, 1), total: 1 }), MATCH_NOUN)).toBe('Showing 1 of 1 matching letter');
    expect(describeShown(startPagedList({ items: rows(0, 1), total: 2 }), MATCH_NOUN)).toBe('Showing 1 of 2 matching letters');
    expect(describeShown(emptyPagedList(), EPISODE_NOUN)).toBe('Showing 0 of 0 review episodes');
  });
});

describe('comment-letter company scope', () => {
  const apple: CompanyScope = { kind: 'cik', cik: '320193', title: 'Apple Inc.' };

  it('resolves a suggestion pick to its CIK and keeps that scope while the text still reads as the pick', () => {
    expect(companyScopeFromSelection('Apple Inc.', '0000320193')).toEqual(apple);
    expect(companyScopeFromText(apple, 'Apple Inc.')).toBe(apple);
    expect(companyScopeFromText(apple, 'Apple Inc')).toEqual({ kind: 'name', text: 'Apple Inc' });
    expect(companyScopeFromText(apple, '')).toBeNull();
    expect(companyScopeFromText(null, '   ')).toBeNull();
    expect(companyScopeText(apple)).toBe('Apple Inc.');
  });

  it('preserves typed text exactly so a trailing space is not eaten mid-name', () => {
    const scope = companyScopeFromText(null, 'Meta ');
    expect(scope).toEqual({ kind: 'name', text: 'Meta ' });
    expect(companyScopeText(scope)).toBe('Meta ');
    expect(companyScopeQuery(scope, 'browse')).toEqual({ params: { company: 'Meta' }, basis: 'name', pattern: 'Meta' });
  });

  it('refuses an unusable CIK from a suggestion rather than filtering by nothing', () => {
    expect(companyScopeFromSelection('Odd Co', 'n/a')).toEqual({ kind: 'name', text: 'Odd Co' });
    expect(companyScopeFromSelection('', '')).toBeNull();
  });

  it('reads deep links: a dossier link carries the CIK, an older link only the name', () => {
    expect(companyScopeFromUrl('Apple Inc.', '320193')).toEqual(apple);
    expect(companyScopeFromUrl(null, '320193')).toEqual({ kind: 'cik', cik: '320193', title: 'CIK 320193' });
    expect(companyScopeFromUrl('Apple Inc.', null)).toEqual({ kind: 'name', text: 'Apple Inc.' });
    expect(companyScopeFromUrl('Apple Inc.', 'not-a-cik')).toEqual({ kind: 'name', text: 'Apple Inc.' });
    expect(companyScopeFromUrl('', '')).toBeNull();
  });

  it('filters the episode list by CIK and only falls back to the registrant name where the search index cannot take one', () => {
    expect(companyScopeQuery(apple, 'browse')).toEqual({ params: { cik: '320193' }, basis: 'cik', pattern: null });
    expect(companyScopeQuery(apple, 'search')).toEqual({ params: { company: 'Apple' }, basis: 'name-stand-in', pattern: 'Apple' });
    expect(companyScopeQuery({ kind: 'name', text: 'app' }, 'search')).toEqual({ params: { company: 'app' }, basis: 'name', pattern: 'app' });
    expect(companyScopeQuery(null, 'browse')).toBeNull();
  });

  it('strips corporate boilerplate for the stand-in so directory titles reach corpus filer names', () => {
    expect(registrantNameStandIn('Microsoft Corporation')).toBe('Microsoft');
    expect(registrantNameStandIn('Letterhaven Industries')).toBe('Letterhaven Industries');
    expect(registrantNameStandIn('AB')).toBe('AB');
  });

  it('labels every list with the basis actually applied', () => {
    expect(describeCompanyScope(apple, 'browse')).toBe('Episodes filtered by CIK 320193 (Apple Inc.).');
    expect(describeCompanyScope(apple, 'search')).toContain('as a stand-in for CIK 320193');
    expect(describeCompanyScope(apple, 'search')).toContain('cannot filter by CIK');
    expect(describeCompanyScope({ kind: 'name', text: 'app' }, 'browse')).toContain('free-text name match');
  });

  it('builds the page requests the route understands', () => {
    expect(letterBrowseParams(null, { from: 0, size: BROWSE_PAGE_SIZE }).toString()).toBe('size=12');
    expect(letterBrowseParams(apple, { from: 12, size: BROWSE_PAGE_SIZE }).toString()).toBe('cik=320193&size=12&from=12');
    const search = letterSearchParams({ query: ' revenue ', form: 'CORRESP', scope: apple }, { from: 50, size: SEARCH_PAGE_SIZE });
    expect(Object.fromEntries(search)).toEqual({ q: 'revenue', form: 'CORRESP', company: 'Apple', size: '50', from: '50' });
    expect(letterSearchParams({ query: 'revenue', form: '', scope: null }, { from: 0, size: SEARCH_PAGE_SIZE }).toString()).toBe('q=revenue&size=50');
  });
});
