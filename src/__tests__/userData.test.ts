import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStorageScope, scopedStorageKey, setActiveBrowserStorageScope } from '../services/storageNamespace';
import {
  chunkForRequest,
  comparableJson,
  flushUserData,
  getActiveProjectId,
  getUserDataStatus,
  isAccountUserDataScope,
  onUserDataHydrated,
  overlayOutbox,
  prepareUserDataScope,
  resetUserDataForTests,
  startUserDataSync,
  subscribeUserDataStatus,
  syncUserCollection,
} from '../services/userData';
import {
  ALERTS_STORAGE_KEY,
  ANNOTATIONS_STORAGE_KEY,
  MEMO_TRAY_STORAGE_KEY,
  PEER_SETS_STORAGE_KEY,
  RESEARCH_TABS_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  watchlistToItems,
} from '../services/userDataCodecs';
import { USER_DATA_KINDS, type UserDataKind } from '../lib/user-data-kinds';
import { validateUserDataItem } from '../lib/user-data-input';
import { loadResearchSessions, saveResearchSessions, type ResearchSearchSession } from '../services/researchSessions';

/** In-memory stand-in for one identity's /api/user/* rows, validating like the route. */
function fakeServer(initial: Partial<Record<UserDataKind, Array<Record<string, unknown>>>> = {}) {
  const rows = new Map<UserDataKind, Map<string, Record<string, unknown>>>(
    USER_DATA_KINDS.map(kind => [kind, new Map((initial[kind] || []).map(item => [String(item.clientKey), { ...item }]))]),
  );
  const calls: Array<{ method: string; kind: UserDataKind; body: unknown }> = [];
  let available = true;
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const kind = input.replace('/api/user/', '') as UserDataKind;
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, kind, body });
    if (!available) {
      return Response.json({ ok: false, errorClass: 'unavailable', error: 'not provisioned' }, { status: 503 });
    }
    const table = rows.get(kind)!;
    if (method === 'GET') {
      return Response.json({ ok: true, items: [...table.values()].map(item => ({ ...item, updatedAt: 'u' })) });
    }
    if (method === 'PUT') {
      for (const item of body.items) {
        const result = validateUserDataItem(kind, item);
        if ('error' in result) return Response.json({ ok: false, error: result.error }, { status: 400 });
        const existing = table.get(item.clientKey);
        table.set(item.clientKey, {
          ...existing,
          ...item,
          projectId: item.projectId ?? existing?.projectId ?? null,
          id: existing?.id ?? item.id ?? globalThis.crypto.randomUUID(),
        });
      }
      return Response.json({ ok: true, items: body.items.map((item: { clientKey: string }) => ({ clientKey: item.clientKey, id: table.get(item.clientKey)!.id })) });
    }
    let deleted = 0;
    for (const key of body.clientKeys) deleted += table.delete(key) ? 1 : 0;
    return Response.json({ ok: true, deleted });
  });
  return {
    fetch,
    rows,
    calls,
    setAvailable(value: boolean) { available = value; },
    keys(kind: UserDataKind) { return [...rows.get(kind)!.keys()]; },
  };
}

const ALICE = buildStorageScope('user_alice', null);
const BOB = buildStorageScope('user_bob', null);

function setLocal(baseKey: string, scope: string, value: unknown) {
  window.localStorage.setItem(scopedStorageKey(baseKey, scope)!, JSON.stringify(value));
}

function getLocal(baseKey: string, scope: string): unknown {
  const raw = window.localStorage.getItem(scopedStorageKey(baseKey, scope)!);
  return raw === null ? null : JSON.parse(raw);
}

async function signIn(scope: string, server: ReturnType<typeof fakeServer>) {
  setActiveBrowserStorageScope(scope);
  startUserDataSync(scope, { fetch: server.fetch as never });
  await vi.waitFor(() => expect(['server', 'unavailable']).toContain(getUserDataStatus().mode));
}

beforeEach(() => {
  resetUserDataForTests();
});

afterEach(() => {
  resetUserDataForTests();
  setActiveBrowserStorageScope(null);
});

describe('pure helpers', () => {
  it('overlays pending local operations on the server copy', () => {
    const merged = overlayOutbox(
      [{ clientKey: 'a', v: 1 }, { clientKey: 'b', v: 1 }],
      { a: { op: 'put', item: { clientKey: 'a', v: 2 } }, b: { op: 'delete' }, c: { op: 'put', item: { clientKey: 'c', v: 1 } } },
    );
    expect(merged).toEqual([{ clientKey: 'a', v: 2 }, { clientKey: 'c', v: 1 }]);
  });

  it('chunks by count and bytes', () => {
    expect(chunkForRequest([1, 2, 3, 4, 5], 2, 1_000).map(chunk => chunk.length)).toEqual([2, 2, 1]);
    expect(chunkForRequest(['x'.repeat(60), 'y'.repeat(60)], 10, 100).length).toBe(2);
  });

  it('compares versions without server-managed or creation-only fields', () => {
    expect(comparableJson('watchlist', { clientKey: 'A', ticker: 'A', position: 0, projectId: 'p', createdAt: 'c', id: 'i' }))
      .toBe(comparableJson('watchlist', { ticker: 'A', position: 0, clientKey: 'A' }));
  });
});

describe('signed out', () => {
  it('never calls the API and keeps local behaviour', async () => {
    const server = fakeServer();
    setActiveBrowserStorageScope('signed-out');
    startUserDataSync('signed-out', { fetch: server.fetch as never });
    syncUserCollection('watchlist', watchlistToItems(['AAPL']));
    await flushUserData();
    expect(server.fetch).not.toHaveBeenCalled();
    expect(getUserDataStatus().mode).toBe('local');
    expect(getActiveProjectId()).toBeNull();
  });

  it('asking whether the scope is an account does not publish a status change', async () => {
    setActiveBrowserStorageScope('signed-out');
    prepareUserDataScope('signed-out');
    await Promise.resolve();
    const before = getUserDataStatus();
    const listener = vi.fn();
    const unsubscribe = subscribeUserDataStatus(listener);
    try {
      for (let i = 0; i < 10; i += 1) expect(isAccountUserDataScope()).toBe(false);
      await Promise.resolve();
      await Promise.resolve();
      expect(listener).toHaveBeenCalledTimes(0);
      expect(getUserDataStatus()).toBe(before);
    } finally {
      unsubscribe();
    }
  });
});

function researchTab(id: string): ResearchSearchSession {
  const filters = {
    keyword: '', dateFrom: '', dateTo: '', entityName: '', entityCik: '', formTypes: [], sectionKeywords: '',
    sicCode: '', stateOfInc: '', headquarters: '', exchange: [], acceleratedStatus: [], accountant: '',
    accessionNumber: '', fileNumber: '', fiscalYearEnd: '', accountingFramework: '', ascReference: '', sectionScope: '',
  };
  return {
    id, title: `Tab ${id}`, query: id, mode: 'semantic', filters, results: [], isRefining: false, searched: true,
    errorMsg: '', interpretation: [], resolvedSearch: { query: id, mode: 'semantic', filters }, selectedResultId: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  } as ResearchSearchSession;
}

describe('research tabs beyond the tab cap', () => {
  it('a tab save never deletes account tabs the search page did not load', async () => {
    const originals = Array.from({ length: 10 }, (_, index) => researchTab(`research-${index}`));
    const server = fakeServer({
      'research-tabs': originals.map((tab, position) => ({ clientKey: tab.id, title: tab.title, payload: tab, position })),
    });
    window.localStorage.setItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!, 'earlier');
    await signIn(ALICE, server);

    // The search page loads at most 8 tabs and saves them on mount.
    const loaded = loadResearchSessions();
    expect(loaded).toHaveLength(8);
    saveResearchSessions(loaded);
    // The user closes one tab and opens a new one.
    const closed = loaded[0].id;
    saveResearchSessions([...loaded.slice(1), researchTab('research-new')]);
    await flushUserData();

    const keys = new Set(server.keys('research-tabs'));
    for (const tab of originals) {
      if (tab.id === closed) expect(keys.has(tab.id)).toBe(false);
      else expect(keys.has(tab.id)).toBe(true);
    }
    expect(keys.has('research-new')).toBe(true);
  });
});

describe('one-time migration from localStorage', () => {
  it('uploads existing local objects by clientKey, marks the scope migrated, and keeps the local copy', async () => {
    setLocal(WATCHLIST_STORAGE_KEY, ALICE, ['AAPL', 'MSFT']);
    setLocal(PEER_SETS_STORAGE_KEY, ALICE, [{ name: 'Big Tech', tickers: ['AAPL', 'MSFT'], savedAt: '2026-09-01T00:00:00.000Z' }]);
    setLocal(ALERTS_STORAGE_KEY, ALICE, [{
      id: 'alert-1', name: 'MW', query: 'material weakness', mode: 'semantic', filters: { formTypes: ['10-K'] },
      defaultForms: '10-K', createdAt: '2026-09-01T00:00:00.000Z', lastSeenAccessions: ['0000320193-24-000123', ''],
      latestNewAccessions: [], latestResultCount: 4,
    }]);
    setLocal(MEMO_TRAY_STORAGE_KEY, ALICE, [{
      id: '320193:0000320193-24-000123', kind: 'filing', cik: '320193', accessionNumber: '0000320193-24-000123',
      company: 'Apple', form: '10-K', fileDate: '2024-11-01', excerpt: 'x', sourceUrl: 'https://www.sec.gov/x', note: '', addedAt: '2026-09-02T00:00:00.000Z',
    }]);
    setLocal(ANNOTATIONS_STORAGE_KEY, ALICE, {
      '320193_0000320193-24-000123_a.htm': [{ id: 'note-1', quote: 'q', note: 'check this', section: null, createdAt: '2026-09-03T00:00:00.000Z' }],
    });
    window.sessionStorage.setItem(scopedStorageKey(RESEARCH_TABS_STORAGE_KEY, ALICE)!, JSON.stringify([{ id: 'research-1', title: 'MW', results: [] }]));
    // Another identity's local data on the same browser must never be imported.
    setLocal(WATCHLIST_STORAGE_KEY, BOB, ['BOBCO']);
    setLocal(MEMO_TRAY_STORAGE_KEY, BOB, [{ id: 'bob-citation', cik: '1', accessionNumber: '1', addedAt: '2026-01-01T00:00:00.000Z' }]);

    const server = fakeServer();
    await signIn(ALICE, server);
    expect(getUserDataStatus().mode).toBe('server');

    expect(server.keys('projects')).toEqual(['personal']);
    expect(server.keys('watchlist')).toEqual(['AAPL', 'MSFT']);
    expect(server.keys('peer-sets')).toEqual(['big tech']);
    expect(server.keys('alerts')).toEqual(['alert-1']);
    expect(server.rows.get('alerts')!.get('alert-1')).toMatchObject({ lastSeenAccessions: ['0000320193-24-000123'], lastHitCount: 4 });
    expect(server.keys('memo')).toEqual(['320193:0000320193-24-000123']);
    expect(server.keys('annotations')).toEqual(['320193_0000320193-24-000123_a.htm#note-1']);
    expect(server.keys('research-tabs')).toEqual(['research-1']);
    // Everything migrated is filed under the personal project.
    const personalId = server.rows.get('projects')!.get('personal')!.id;
    expect(server.rows.get('watchlist')!.get('AAPL')!.projectId).toBe(personalId);
    expect(getActiveProjectId()).toBe(personalId);

    expect(JSON.stringify([...server.rows.values()].map(table => [...table.keys()]))).not.toContain('BOB');
    expect(JSON.stringify([...server.rows.values()].map(table => [...table.keys()]))).not.toContain('bob-citation');

    expect(getUserDataStatus().migratedAt).toBeTruthy();
    expect(window.localStorage.getItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!)).toBeTruthy();
    // The local copy stays, and a raw pre-migration backup is kept beside it.
    expect(getLocal(WATCHLIST_STORAGE_KEY, ALICE)).toEqual(['AAPL', 'MSFT']);
    expect(getLocal(`urc.userdata.premigration.local.${WATCHLIST_STORAGE_KEY}`, ALICE)).toEqual(['AAPL', 'MSFT']);
    expect(getLocal(WATCHLIST_STORAGE_KEY, BOB)).toEqual(['BOBCO']);
  });

  it('does not migrate twice, and a retry after failure is idempotent', async () => {
    setLocal(WATCHLIST_STORAGE_KEY, ALICE, ['AAPL']);
    const server = fakeServer();
    server.setAvailable(false);
    await signIn(ALICE, server);
    expect(getUserDataStatus().mode).toBe('unavailable');
    expect(window.localStorage.getItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!)).toBeNull();
    expect(getLocal(WATCHLIST_STORAGE_KEY, ALICE)).toEqual(['AAPL']);

    resetUserDataForTests();
    server.setAvailable(true);
    await signIn(ALICE, server);
    expect(server.keys('watchlist')).toEqual(['AAPL']);
    const putsAfterFirstMigration = server.calls.filter(call => call.method === 'PUT' && call.kind === 'watchlist').length;

    resetUserDataForTests();
    await signIn(ALICE, server);
    expect(server.calls.filter(call => call.method === 'PUT' && call.kind === 'watchlist').length).toBe(putsAfterFirstMigration);
  });
});

describe('hydration and the outbox', () => {
  it('hydrates local caches from the account and notifies listeners', async () => {
    const server = fakeServer({
      projects: [{ id: '11111111-1111-4111-8111-111111111111', clientKey: 'personal', name: 'Personal research', question: '' }],
      watchlist: [{ clientKey: 'NVDA', ticker: 'NVDA', position: 0 }],
      'research-tabs': [{ clientKey: 'research-9', title: 'Leases', payload: { id: 'research-9', title: 'Leases', results: [] }, position: 0 }],
    });
    // A signed-in user on a new browser session: nothing stored locally.
    window.localStorage.setItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!, 'earlier');
    const hydrated: string[] = [];
    const offTabs = onUserDataHydrated('research-tabs', () => hydrated.push('research-tabs'));
    await signIn(ALICE, server);
    offTabs();
    expect(getLocal(WATCHLIST_STORAGE_KEY, ALICE)).toEqual(['NVDA']);
    expect(JSON.parse(window.sessionStorage.getItem(scopedStorageKey(RESEARCH_TABS_STORAGE_KEY, ALICE)!)!))
      .toEqual([{ id: 'research-9', title: 'Leases', results: [] }]);
    expect(hydrated).toEqual(['research-tabs']);
  });

  it('queues upserts and deletes from collection diffs and flushes them', async () => {
    const server = fakeServer({ watchlist: [{ clientKey: 'AAPL', ticker: 'AAPL', position: 0 }] });
    window.localStorage.setItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!, 'earlier');
    await signIn(ALICE, server);
    server.calls.length = 0;

    syncUserCollection('watchlist', watchlistToItems(['AAPL', 'TSLA']));
    syncUserCollection('watchlist', watchlistToItems(['TSLA']));
    expect(getUserDataStatus().pendingWrites).toBe(2);
    await flushUserData();
    expect(server.keys('watchlist')).toEqual(['TSLA']);
    expect(server.calls.map(call => call.method)).toEqual(['DELETE', 'PUT']);
    expect(getUserDataStatus().pendingWrites).toBe(0);

    // An unchanged collection sends nothing.
    server.calls.length = 0;
    syncUserCollection('watchlist', watchlistToItems(['TSLA']));
    await flushUserData();
    expect(server.calls).toEqual([]);
  });

  it('keeps failed writes in a persisted outbox and replays them on the next load', async () => {
    const server = fakeServer();
    window.localStorage.setItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!, 'earlier');
    await signIn(ALICE, server);
    server.setAvailable(false);
    syncUserCollection('watchlist', watchlistToItems(['AMZN']));
    await flushUserData();
    expect(server.keys('watchlist')).toEqual([]);
    expect(window.localStorage.getItem(scopedStorageKey('urc.userdata.outbox.v1', ALICE)!)).toContain('AMZN');

    resetUserDataForTests();
    server.setAvailable(true);
    await signIn(ALICE, server);
    await vi.waitFor(() => expect(server.keys('watchlist')).toEqual(['AMZN']));
    expect(getLocal(WATCHLIST_STORAGE_KEY, ALICE)).toEqual(['AMZN']);
  });

  it('on a new device, store defaults do not overwrite what the account already holds', async () => {
    const server = fakeServer({ watchlist: [{ clientKey: 'NVDA', ticker: 'NVDA', position: 0 }] });
    window.localStorage.setItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!, 'earlier');
    setActiveBrowserStorageScope(ALICE);
    prepareUserDataScope(ALICE);
    // The AppProvider writes its default watchlist before the account answers…
    setLocal(WATCHLIST_STORAGE_KEY, ALICE, ['AAPL', 'MSFT']);
    syncUserCollection('watchlist', watchlistToItems(['AAPL', 'MSFT']));
    // …and the user adds one ticker in that window.
    syncUserCollection('watchlist', watchlistToItems(['AAPL', 'MSFT', 'AMD']));
    await signIn(ALICE, server);
    await flushUserData();
    expect(server.keys('watchlist').sort()).toEqual(['AMD', 'NVDA']);
    expect(getLocal(WATCHLIST_STORAGE_KEY, ALICE)).toEqual(['NVDA', 'AMD']);
  });

  it('never sends an item the server contract would reject, and reports it', async () => {
    const server = fakeServer();
    window.localStorage.setItem(scopedStorageKey('urc.userdata.migrated.v1', ALICE)!, 'earlier');
    await signIn(ALICE, server);
    syncUserCollection('annotations', [{ clientKey: 'k', filingKey: 'f', accession: null, anchor: {}, note: 'x'.repeat(9000) }]);
    await flushUserData();
    expect(server.keys('annotations')).toEqual([]);
    expect(getUserDataStatus().lastError).toContain('note exceeds');
  });
});
