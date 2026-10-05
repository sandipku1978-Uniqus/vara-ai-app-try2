import { describe, expect, it } from 'vitest';
import {
  MAX_ALERT_ACCESSIONS,
  alertToItem,
  annotationsToItems,
  citationToItem,
  draftToItem,
  itemToAlert,
  itemsToAnnotationMap,
  itemsToCitations,
  itemsToDraft,
  itemsToPeerSets,
  itemsToResearchTabs,
  itemsToWatchlist,
  peerSetToItem,
  researchTabToItem,
  watchlistToItems,
} from '../services/userDataCodecs';
import { mergeRestoredResearchSessions, type ResearchSearchSession } from '../services/researchSessions';
import { validateUserDataItem } from '../lib/user-data-input';

describe('user data codecs', () => {
  it('round-trips the watchlist in order and drops tickers the contract cannot hold', () => {
    const items = watchlistToItems(['AAPL', 'BRK-B', 'bad ticker']);
    expect(items.map(item => item.clientKey)).toEqual(['AAPL', 'BRK-B']);
    expect(itemsToWatchlist([...items].reverse())).toEqual(['AAPL', 'BRK-B']);
  });

  it('round-trips an alert, bounding and cleaning its accession memory', () => {
    const seen = Array.from({ length: MAX_ALERT_ACCESSIONS + 5 }, (_, index) => `0000000000-26-${String(index).padStart(6, '0')}`);
    const item = alertToItem({
      id: 'alert-1', name: 'MW', query: 'q', mode: 'boolean', filters: { formTypes: ['10-K'] }, defaultForms: '10-K',
      createdAt: '2026-09-01T00:00:00.000Z', lastSeenAccessions: ['', ...seen], latestNewAccessions: [], latestResultCount: 9,
      engineVersion: 3,
    });
    expect(item.lastSeenAccessions).toHaveLength(MAX_ALERT_ACCESSIONS);
    expect(item.lastSeenAccessions.at(-1)).toBe(seen.at(-1));
    expect('row' in validateUserDataItem('alerts', item)).toBe(true);
    expect(itemToAlert(item)).toMatchObject({ id: 'alert-1', latestResultCount: 9, engineVersion: 3, cadence: 'daily', enabled: true });
  });

  it('keys peer sets by lower-cased name and restores newest first', () => {
    const older = peerSetToItem({ name: 'Banks', tickers: ['JPM'], savedAt: '2026-01-01T00:00:00.000Z' });
    const newer = peerSetToItem({ name: 'Big Tech', tickers: ['AAPL'], savedAt: '2026-02-01T00:00:00.000Z' });
    expect(newer.clientKey).toBe('big tech');
    expect(itemsToPeerSets([older, newer]).map(set => set.name)).toEqual(['Big Tech', 'Banks']);
  });

  it('carries citations and the draft as separate memo rows', () => {
    const citation = citationToItem({ id: 'c1', cik: '320193', accessionNumber: '0000320193-24-000123', addedAt: '2026-01-01T00:00:00.000Z' });
    const draft = draftToItem({ text: 'memo', generatedAt: 'g', citationIds: ['c1'] });
    expect(citation).toMatchObject({ itemKind: 'citation', cik: '320193', accession: '0000320193-24-000123' });
    expect(itemsToCitations([citation, draft])).toEqual([citation.payload]);
    expect(itemsToDraft([citation, draft])).toEqual({ text: 'memo', generatedAt: 'g', citationIds: ['c1'] });
  });

  it('scopes annotation keys by filing so a note id never moves between filings', () => {
    const note = { id: 'note-1', quote: 'q', note: 'n', section: 'Item 9A', createdAt: '2026-01-01T00:00:00.000Z' };
    const first = annotationsToItems('320193_0000320193-24-000123_a.htm', [note]);
    const second = annotationsToItems('320193_0000320193-25-000001_b.htm', [note]);
    expect(first[0].clientKey).not.toBe(second[0].clientKey);
    expect(first[0].accession).toBe('0000320193-24-000123');
    expect(itemsToAnnotationMap([...first, ...second])).toEqual({
      '320193_0000320193-24-000123_a.htm': [note],
      '320193_0000320193-25-000001_b.htm': [note],
    });
  });

  it('keeps an oversized research tab’s query but says its rows were not saved', () => {
    const tab = {
      id: 'research-1', title: 'Big', query: 'revenue', isRefining: true,
      results: Array.from({ length: 400 }, (_, index) => ({ id: `r${index}`, snippet: 'x'.repeat(2_000) })),
    };
    const item = researchTabToItem(tab, 0);
    expect(item.payload).toMatchObject({ id: 'research-1', query: 'revenue', results: [], isRefining: false });
    expect(String(item.payload.errorMsg)).toContain('too large to save');
    expect('row' in validateUserDataItem('research-tabs', item)).toBe(true);
    expect(researchTabToItem({ id: 'small', title: 's' }, 1).payload).toMatchObject({ id: 'small', isRefining: false });
  });

  it('restores at most eight tabs in position order', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ clientKey: `t${index}`, title: '', payload: { id: `t${index}` }, position: 9 - index }));
    expect(itemsToResearchTabs(items).map(tab => tab.id)).toEqual(['t9', 't8', 't7', 't6', 't5', 't4', 't3', 't2']);
  });

  it('merges restored tabs after the open page’s tabs, within the cap', () => {
    const tab = (id: string) => ({ id }) as ResearchSearchSession;
    const current = [tab('a'), tab('b')];
    expect(mergeRestoredResearchSessions(current, [tab('b'), tab('c')]).map(session => session.id)).toEqual(['a', 'b', 'c']);
    expect(mergeRestoredResearchSessions(current, [tab('a')])).toBe(current);
    const many = Array.from({ length: 10 }, (_, index) => tab(`r${index}`));
    expect(mergeRestoredResearchSessions(current, many)).toHaveLength(8);
  });
});
