import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCitation,
  getMemoCitations,
  getMemoDraft,
  setMemoDraft,
} from '../services/memoTray';
import { buildStorageScope, scopedStorageKey, setActiveBrowserStorageScope } from '../services/storageNamespace';
import { MEMO_TRAY_STORAGE_KEY } from '../services/userDataCodecs';
import { resetUserDataForTests, startUserDataSync, getUserDataStatus } from '../services/userData';

const ALICE = buildStorageScope('user_alice', null);
const BOB = buildStorageScope('user_bob', null);

const CITATION = {
  kind: 'filing' as const,
  cik: '320193',
  accessionNumber: '0000320193-24-000123',
  company: 'Apple Inc.',
  form: '10-K',
  fileDate: '2024-11-01',
  excerpt: 'material weakness',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm',
};

beforeEach(() => {
  resetUserDataForTests();
});

afterEach(() => {
  resetUserDataForTests();
  setActiveBrowserStorageScope(null);
});

describe('memo tray identity switch', () => {
  it("never carries user A's citations or draft into user B's tray", () => {
    setActiveBrowserStorageScope(ALICE);
    addCitation(CITATION);
    setMemoDraft('Alice draft', ['x']);
    expect(getMemoCitations()).toHaveLength(1);

    setActiveBrowserStorageScope(BOB);
    expect(getMemoCitations()).toEqual([]);
    expect(getMemoDraft()).toBeNull();
    expect(window.localStorage.getItem(scopedStorageKey(MEMO_TRAY_STORAGE_KEY, BOB)!)).toBeNull();

    // And A's tray is intact when A returns.
    setActiveBrowserStorageScope(ALICE);
    expect(getMemoCitations().map(citation => citation.company)).toEqual(['Apple Inc.']);
    expect(getMemoDraft()?.text).toBe('Alice draft');
  });

  it("does not let B's first-login migration upload A's citations", async () => {
    setActiveBrowserStorageScope(ALICE);
    addCitation(CITATION);

    const uploaded: string[] = [];
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { items: Array<{ clientKey: string; id?: string }> };
        uploaded.push(...body.items.map(item => `${input}:${item.clientKey}`));
        return Response.json({ ok: true, items: body.items.map(item => ({ clientKey: item.clientKey, id: item.id ?? crypto.randomUUID() })) });
      }
      return Response.json({ ok: true, items: [] });
    });
    setActiveBrowserStorageScope(BOB);
    getMemoCitations();
    startUserDataSync(BOB, { fetch: fetch as never });
    await vi.waitFor(() => expect(getUserDataStatus().mode).toBe('server'));
    expect(uploaded.filter(entry => entry.startsWith('/api/user/memo'))).toEqual([]);
    expect(getMemoCitations()).toEqual([]);
  });

  it('still keeps a citation captured before the identity first loaded', () => {
    setActiveBrowserStorageScope(null);
    addCitation(CITATION);
    setActiveBrowserStorageScope(ALICE);
    expect(getMemoCitations()).toHaveLength(1);
  });
});
