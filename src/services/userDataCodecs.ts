/**
 * Browser-side shapes of the user research objects (migration 026) and the
 * codecs between them and the browser stores that already exist.
 *
 * The stores keep their own local formats (the watchlist is a string array,
 * annotations are a map keyed by filing, and so on) because signed-out use
 * must stay exactly as it was. Each codec reads a store's scoped local key as
 * wire items and writes wire items back in the store's format; the sync
 * engine in userData.ts uses them for the one-time migration and for
 * hydrating local caches from the server.
 *
 * Deliberately imports no store module: the stores import this one, and the
 * dependency-cycle check counts type imports.
 */

import type { AiAnswerMeta } from '../types/aiMeta';
import {
  ACCESSION_PATTERN,
  CIK_PATTERN,
  TICKER_PATTERN,
  type UserDataKind,
} from '../lib/user-data-kinds';
import { scopedStorageKey } from './storageNamespace';

// ── Local keys (the stores import these) ─────────────────────────────────────
export const WATCHLIST_STORAGE_KEY = 'vara.watchlist.v1';
export const ALERTS_STORAGE_KEY = 'vara.alerts.v1';
export const PEER_SETS_STORAGE_KEY = 'urc.benchmark.peersets.v1';
export const MEMO_TRAY_STORAGE_KEY = 'urc.memo.tray.v1';
export const MEMO_DRAFT_STORAGE_KEY = 'urc.memo.draft.v1';
export const ANNOTATIONS_STORAGE_KEY = 'vara.filing.annotations.v1';
export const RESEARCH_TABS_STORAGE_KEY = 'vara.research.sessions.v1';
export const CHECKLIST_STORAGE_KEY = 'urc.accounting-review-checklist.v1';
export const PROJECTS_STORAGE_KEY = 'urc.userdata.projects.v1';
export const SAVED_SEARCHES_STORAGE_KEY = 'urc.userdata.saved-searches.v1';

export const MAX_RESEARCH_TABS = 8;
export const PERSONAL_PROJECT_KEY = 'personal';
export const ACCOUNTING_CHECKLIST_KEY = 'accounting-review';
export const MEMO_DRAFT_CLIENT_KEY = 'draft';
/** A tab whose serialized form exceeds this keeps its query but not its rows on the server. */
export const MAX_DURABLE_TAB_BYTES = 400_000;
/** Seen-accession memory kept per alert; the oldest fall off first. */
export const MAX_ALERT_ACCESSIONS = 5000;

// ── Wire items ───────────────────────────────────────────────────────────────
interface ItemBase {
  clientKey: string;
  /** Omitted or null on an update keeps the project already stored. */
  projectId?: string | null;
  position?: number;
  createdAt?: string | null;
  /** Server-managed, present on listed items. */
  id?: string | null;
  updatedAt?: string;
}

export interface UserProjectItem extends Omit<ItemBase, 'projectId'> {
  id?: string | null;
  name: string;
  question: string;
  archivedAt?: string | null;
}

export interface UserSavedSearchItem extends ItemBase {
  label: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters: Record<string, unknown>;
}

export interface UserAlertItem extends ItemBase {
  savedSearchId?: string | null;
  name: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters: Record<string, unknown>;
  defaultForms: string;
  cadence: 'daily' | 'weekly';
  enabled: boolean;
  lastCheckedAt: string | null;
  lastHitCount: number;
  lastSeenAccessions: string[];
  latestNewAccessions: string[];
  engineVersion: number | null;
  lastCheckCoverage: Record<string, unknown> | null;
}

export interface UserPeerSetItem extends ItemBase {
  name: string;
  tickers: string[];
  ciks: string[];
  asOf: string | null;
}

export interface UserMemoItem extends ItemBase {
  itemKind: 'citation' | 'draft';
  accession: string | null;
  cik: string | null;
  payload: Record<string, unknown>;
}

export interface UserAnnotationItem extends ItemBase {
  filingKey: string;
  accession: string | null;
  anchor: { quote?: string; section?: string | null };
  note: string;
}

export interface UserResearchTabItem extends ItemBase {
  title: string;
  payload: Record<string, unknown>;
}

export interface UserWatchlistItem extends ItemBase {
  ticker: string;
}

export interface UserChecklistItem extends ItemBase {
  name: string;
  items: unknown[];
}

export interface UserDataItemMap {
  projects: UserProjectItem;
  'saved-searches': UserSavedSearchItem;
  alerts: UserAlertItem;
  'peer-sets': UserPeerSetItem;
  memo: UserMemoItem;
  annotations: UserAnnotationItem;
  'research-tabs': UserResearchTabItem;
  watchlist: UserWatchlistItem;
  checklists: UserChecklistItem;
}

export type UserDataItem<K extends UserDataKind = UserDataKind> = UserDataItemMap[K];

// ── Local record shapes (structural, so this module imports no store) ───────
export interface LocalAlertRecord {
  id: string;
  name: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters: object;
  defaultForms: string;
  createdAt: string;
  lastCheckedAt?: string;
  lastSeenAccessions: string[];
  latestNewAccessions: string[];
  latestResultCount: number;
  engineVersion?: number;
  lastCheckCoverage?: object;
  cadence?: 'daily' | 'weekly';
  enabled?: boolean;
}

export interface LocalPeerSetRecord {
  name: string;
  tickers: string[];
  savedAt: string;
}

export interface LocalCitationRecord {
  id: string;
  cik: string;
  accessionNumber: string;
  addedAt: string;
}

export interface LocalMemoDraftRecord {
  text: string;
  generatedAt: string;
  citationIds: string[];
  /** The draft call's reported AI metadata (memoTray), carried through unchanged. */
  aiMetadata?: AiAnswerMeta;
}

export interface LocalAnnotationRecord {
  id: string;
  quote: string;
  note: string;
  section: string | null;
  createdAt: string;
}

export interface LocalResearchTabRecord {
  id: string;
  title: string;
}

export interface LocalChecklistRecord {
  id: number;
  text: string;
  done: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validTimestamp(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function readJson(storage: Storage | undefined, key: string | null): { present: boolean; value: unknown } {
  if (!storage || !key) return { present: false, value: null };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { present: false, value: null };
    return { present: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { present: false, value: null };
  }
}

function writeJson(storage: Storage | undefined, key: string | null, value: unknown): void {
  if (!storage || !key) return;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or privacy mode: the in-memory stores still hold the state.
  }
}

function local(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function session(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

function byCreatedDesc<T extends { createdAt?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
}

function byPosition<T extends { position?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// ── Pure mappings (exported for the stores and tests) ────────────────────────
export function watchlistToItems(tickers: string[]): UserWatchlistItem[] {
  return tickers
    .filter(ticker => typeof ticker === 'string' && TICKER_PATTERN.test(ticker))
    .map((ticker, position) => ({ clientKey: ticker, ticker, position }));
}

export function itemsToWatchlist(items: UserWatchlistItem[]): string[] {
  return Array.from(new Set(byPosition(items).map(item => item.ticker)));
}

function boundedAccessions(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const valid = Array.from(new Set(values.filter((value): value is string => (
    typeof value === 'string' && ACCESSION_PATTERN.test(value)
  ))));
  return valid.slice(-MAX_ALERT_ACCESSIONS);
}

export function alertToItem(alert: LocalAlertRecord): UserAlertItem {
  return {
    clientKey: alert.id,
    name: (alert.name || '').slice(0, 200),
    query: alert.query || '',
    mode: alert.mode === 'boolean' ? 'boolean' : 'semantic',
    filters: isRecord(alert.filters) ? alert.filters : {},
    defaultForms: alert.defaultForms || '',
    cadence: alert.cadence === 'weekly' ? 'weekly' : 'daily',
    enabled: alert.enabled !== false,
    lastCheckedAt: validTimestamp(alert.lastCheckedAt),
    lastHitCount: Math.max(0, Math.floor(Number(alert.latestResultCount) || 0)),
    lastSeenAccessions: boundedAccessions(alert.lastSeenAccessions),
    latestNewAccessions: boundedAccessions(alert.latestNewAccessions),
    engineVersion: typeof alert.engineVersion === 'number' ? alert.engineVersion : null,
    lastCheckCoverage: isRecord(alert.lastCheckCoverage) ? alert.lastCheckCoverage : null,
    createdAt: validTimestamp(alert.createdAt),
    position: 0,
  };
}

export function itemToAlert(item: UserAlertItem): LocalAlertRecord {
  const alert: LocalAlertRecord = {
    id: item.clientKey,
    name: item.name,
    query: item.query,
    mode: item.mode,
    filters: item.filters,
    defaultForms: item.defaultForms,
    createdAt: item.createdAt || new Date(0).toISOString(),
    lastSeenAccessions: item.lastSeenAccessions || [],
    latestNewAccessions: item.latestNewAccessions || [],
    latestResultCount: item.lastHitCount || 0,
    cadence: item.cadence,
    enabled: item.enabled,
  };
  if (item.lastCheckedAt) alert.lastCheckedAt = item.lastCheckedAt;
  if (typeof item.engineVersion === 'number') alert.engineVersion = item.engineVersion;
  if (item.lastCheckCoverage) alert.lastCheckCoverage = item.lastCheckCoverage;
  return alert;
}

export function peerSetToItem(set: LocalPeerSetRecord): UserPeerSetItem {
  return {
    clientKey: set.name.trim().toLowerCase(),
    name: set.name.slice(0, 120),
    tickers: set.tickers.filter(ticker => TICKER_PATTERN.test(ticker)).slice(0, 200),
    ciks: [],
    asOf: validTimestamp(set.savedAt),
    position: 0,
  };
}

export function itemsToPeerSets(items: UserPeerSetItem[]): LocalPeerSetRecord[] {
  return [...items]
    .sort((a, b) => (Date.parse(b.asOf || '') || 0) - (Date.parse(a.asOf || '') || 0))
    .map(item => ({ name: item.name, tickers: [...item.tickers], savedAt: item.asOf || item.createdAt || '' }));
}

export function citationToItem<T extends LocalCitationRecord>(citation: T): UserMemoItem {
  return {
    clientKey: citation.id,
    itemKind: 'citation',
    accession: ACCESSION_PATTERN.test(citation.accessionNumber || '') ? citation.accessionNumber : null,
    cik: CIK_PATTERN.test(citation.cik || '') ? citation.cik : null,
    payload: { ...citation } as Record<string, unknown>,
    createdAt: validTimestamp(citation.addedAt),
    position: 0,
  };
}

export function draftToItem(draft: LocalMemoDraftRecord): UserMemoItem {
  return {
    clientKey: MEMO_DRAFT_CLIENT_KEY,
    itemKind: 'draft',
    accession: null,
    cik: null,
    payload: { ...draft } as Record<string, unknown>,
    position: 0,
  };
}

export function itemsToCitations(items: UserMemoItem[]): Record<string, unknown>[] {
  return items
    .filter(item => item.itemKind === 'citation' && isRecord(item.payload) && typeof item.payload.id === 'string')
    .map(item => item.payload)
    .sort((a, b) => (Date.parse(String(a.addedAt || '')) || 0) - (Date.parse(String(b.addedAt || '')) || 0));
}

export function itemsToDraft(items: UserMemoItem[]): LocalMemoDraftRecord | null {
  const draft = items.find(item => item.itemKind === 'draft' && item.clientKey === MEMO_DRAFT_CLIENT_KEY);
  if (!draft || !isRecord(draft.payload) || typeof draft.payload.text !== 'string') return null;
  const record: LocalMemoDraftRecord = {
    text: draft.payload.text,
    generatedAt: typeof draft.payload.generatedAt === 'string' ? draft.payload.generatedAt : '',
    citationIds: Array.isArray(draft.payload.citationIds)
      ? draft.payload.citationIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
  // The memo payload is a free-form object on the server (≤ 256 KB), so the
  // draft's AI metadata travels inside it; readers parse it defensively.
  // A record-shaped value is what the tray wrote (AiAnswerMeta); anything else
  // is dropped so a malformed payload cannot masquerade as model metadata.
  if (isRecord(draft.payload.aiMetadata)) record.aiMetadata = draft.payload.aiMetadata as unknown as AiAnswerMeta;
  return record;
}

/** One filing's notes. The client key is scoped by filing so a note id can never move between filings. */
export function annotationsToItems(filingKey: string, notes: LocalAnnotationRecord[]): UserAnnotationItem[] {
  const accession = filingKey.split('_')[1] || '';
  return notes
    .filter(note => typeof note.note === 'string' && note.note.trim())
    .map(note => ({
      clientKey: `${filingKey}#${note.id}`.slice(0, 300),
      filingKey: filingKey.slice(0, 400),
      accession: ACCESSION_PATTERN.test(accession) ? accession : null,
      anchor: { quote: note.quote, section: note.section ?? null },
      note: note.note.slice(0, 8000),
      createdAt: validTimestamp(note.createdAt),
      position: 0,
    }));
}

export function itemsToAnnotationMap(items: UserAnnotationItem[]): Record<string, LocalAnnotationRecord[]> {
  const map: Record<string, LocalAnnotationRecord[]> = {};
  for (const item of byCreatedDesc(items)) {
    const prefix = `${item.filingKey}#`;
    const id = item.clientKey.startsWith(prefix) ? item.clientKey.slice(prefix.length) : item.clientKey;
    (map[item.filingKey] ||= []).push({
      id,
      quote: typeof item.anchor?.quote === 'string' ? item.anchor.quote : '',
      note: item.note,
      section: typeof item.anchor?.section === 'string' ? item.anchor.section : null,
      createdAt: item.createdAt || '',
    });
  }
  return map;
}

/**
 * A tab is stored whole when it fits. A tab too large to keep (hundreds of
 * result rows with snippets) keeps its query, filters and coverage on the
 * server and says so on reopen, instead of being cut to a silent subset.
 */
export function researchTabToItem<T extends LocalResearchTabRecord>(tab: T, position: number): UserResearchTabItem {
  const payload = { ...tab, isRefining: false } as unknown as Record<string, unknown>;
  let serialized = JSON.stringify(payload);
  if (byteLength(serialized) > MAX_DURABLE_TAB_BYTES) {
    payload.results = [];
    payload.selectedResultId = null;
    payload.errorMsg = 'This tab’s results were too large to save to your account. Run the search again to refresh them.';
    serialized = JSON.stringify(payload);
  }
  return {
    clientKey: tab.id,
    title: (tab.title || '').slice(0, 200),
    payload: byteLength(serialized) > MAX_DURABLE_TAB_BYTES ? { id: tab.id, title: tab.title } : payload,
    position,
  };
}

export function itemsToResearchTabs(items: UserResearchTabItem[]): Record<string, unknown>[] {
  return byPosition(items)
    .filter(item => isRecord(item.payload) && typeof item.payload.id === 'string')
    .map(item => item.payload)
    .slice(0, MAX_RESEARCH_TABS);
}

export function checklistToItem(items: LocalChecklistRecord[]): UserChecklistItem {
  return {
    clientKey: ACCOUNTING_CHECKLIST_KEY,
    name: 'Technical Accounting Review Checklist',
    items: items.slice(0, 500).map(item => ({ id: item.id, text: item.text, done: item.done })),
    position: 0,
  };
}

export function itemToChecklist(item: UserChecklistItem | undefined): LocalChecklistRecord[] | null {
  if (!item || !Array.isArray(item.items)) return null;
  const valid = item.items.filter((entry): entry is LocalChecklistRecord => (
    isRecord(entry) && typeof entry.id === 'number' && typeof entry.text === 'string' && typeof entry.done === 'boolean'
  ));
  return valid.length > 0 ? valid : null;
}

// ── Local codecs ─────────────────────────────────────────────────────────────
export interface LocalCodec<K extends UserDataKind> {
  /** The browser keys this kind lives under (for the pre-migration backup). */
  keys: Array<{ storage: 'local' | 'session'; baseKey: string }>;
  /** Items stored locally for `scope`, or null when nothing is stored at all. */
  read(scope: string): UserDataItem<K>[] | null;
  /** Replace the local copy for `scope` with these items, in the store's format. */
  write(scope: string, items: UserDataItem<K>[]): void;
}

function listCodec<K extends UserDataKind>(baseKey: string): LocalCodec<K> {
  return {
    keys: [{ storage: 'local', baseKey }],
    read(scope) {
      const stored = readJson(local(), scopedStorageKey(baseKey, scope));
      if (!stored.present) return null;
      return Array.isArray(stored.value)
        ? stored.value.filter(isRecord).filter(item => typeof item.clientKey === 'string') as unknown as UserDataItem<K>[]
        : [];
    },
    write(scope, items) {
      writeJson(local(), scopedStorageKey(baseKey, scope), byPosition(items as Array<{ position?: number }>));
    },
  };
}

export const LOCAL_CODECS: { [K in UserDataKind]: LocalCodec<K> } = {
  projects: listCodec<'projects'>(PROJECTS_STORAGE_KEY),
  'saved-searches': listCodec<'saved-searches'>(SAVED_SEARCHES_STORAGE_KEY),
  watchlist: {
    keys: [{ storage: 'local', baseKey: WATCHLIST_STORAGE_KEY }],
    read(scope) {
      const stored = readJson(local(), scopedStorageKey(WATCHLIST_STORAGE_KEY, scope));
      if (!stored.present) return null;
      return Array.isArray(stored.value)
        ? watchlistToItems(stored.value.filter((value): value is string => typeof value === 'string'))
        : [];
    },
    write(scope, items) {
      writeJson(local(), scopedStorageKey(WATCHLIST_STORAGE_KEY, scope), itemsToWatchlist(items));
    },
  },
  alerts: {
    keys: [{ storage: 'local', baseKey: ALERTS_STORAGE_KEY }],
    read(scope) {
      const stored = readJson(local(), scopedStorageKey(ALERTS_STORAGE_KEY, scope));
      if (!stored.present) return null;
      return Array.isArray(stored.value)
        ? stored.value
          .filter((alert): alert is LocalAlertRecord => isRecord(alert) && typeof alert.id === 'string')
          .map(alertToItem)
        : [];
    },
    write(scope, items) {
      writeJson(local(), scopedStorageKey(ALERTS_STORAGE_KEY, scope), byCreatedDesc(items).map(itemToAlert));
    },
  },
  'peer-sets': {
    keys: [{ storage: 'local', baseKey: PEER_SETS_STORAGE_KEY }],
    read(scope) {
      const stored = readJson(local(), scopedStorageKey(PEER_SETS_STORAGE_KEY, scope));
      if (!stored.present) return null;
      return Array.isArray(stored.value)
        ? stored.value
          .filter((set): set is LocalPeerSetRecord => (
            isRecord(set) && typeof set.name === 'string' && set.name.trim() !== '' && Array.isArray(set.tickers)
          ))
          .map(peerSetToItem)
        : [];
    },
    write(scope, items) {
      writeJson(local(), scopedStorageKey(PEER_SETS_STORAGE_KEY, scope), itemsToPeerSets(items));
    },
  },
  memo: {
    keys: [
      { storage: 'local', baseKey: MEMO_TRAY_STORAGE_KEY },
      { storage: 'local', baseKey: MEMO_DRAFT_STORAGE_KEY },
    ],
    read(scope) {
      const tray = readJson(local(), scopedStorageKey(MEMO_TRAY_STORAGE_KEY, scope));
      const draft = readJson(local(), scopedStorageKey(MEMO_DRAFT_STORAGE_KEY, scope));
      if (!tray.present && !draft.present) return null;
      const items: UserMemoItem[] = Array.isArray(tray.value)
        ? tray.value
          .filter((citation): citation is LocalCitationRecord => isRecord(citation) && typeof citation.id === 'string')
          .map(citationToItem)
        : [];
      if (isRecord(draft.value) && typeof draft.value.text === 'string') {
        items.push(draftToItem(draft.value as unknown as LocalMemoDraftRecord));
      }
      return items;
    },
    write(scope, items) {
      writeJson(local(), scopedStorageKey(MEMO_TRAY_STORAGE_KEY, scope), itemsToCitations(items));
      writeJson(local(), scopedStorageKey(MEMO_DRAFT_STORAGE_KEY, scope), itemsToDraft(items));
    },
  },
  annotations: {
    keys: [{ storage: 'local', baseKey: ANNOTATIONS_STORAGE_KEY }],
    read(scope) {
      const stored = readJson(local(), scopedStorageKey(ANNOTATIONS_STORAGE_KEY, scope));
      if (!stored.present) return null;
      if (!isRecord(stored.value)) return [];
      return Object.entries(stored.value).flatMap(([filingKey, notes]) => (
        Array.isArray(notes)
          ? annotationsToItems(filingKey, notes.filter((note): note is LocalAnnotationRecord => (
            isRecord(note) && typeof note.id === 'string'
          )))
          : []
      ));
    },
    write(scope, items) {
      writeJson(local(), scopedStorageKey(ANNOTATIONS_STORAGE_KEY, scope), itemsToAnnotationMap(items));
    },
  },
  'research-tabs': {
    // Signed-in tabs keep the session-scoped cache they always had; the
    // server copy is what survives a browser restart.
    keys: [{ storage: 'session', baseKey: RESEARCH_TABS_STORAGE_KEY }],
    read(scope) {
      const stored = readJson(session(), scopedStorageKey(RESEARCH_TABS_STORAGE_KEY, scope));
      if (!stored.present) return null;
      return Array.isArray(stored.value)
        ? stored.value
          .filter((tab): tab is LocalResearchTabRecord => isRecord(tab) && typeof tab.id === 'string')
          .slice(0, MAX_RESEARCH_TABS)
          .map((tab, position) => researchTabToItem(tab, position))
        : [];
    },
    write(scope, items) {
      writeJson(session(), scopedStorageKey(RESEARCH_TABS_STORAGE_KEY, scope), itemsToResearchTabs(items));
    },
  },
  checklists: {
    keys: [{ storage: 'local', baseKey: CHECKLIST_STORAGE_KEY }],
    read(scope) {
      const stored = readJson(local(), scopedStorageKey(CHECKLIST_STORAGE_KEY, scope));
      if (!stored.present) return null;
      if (!Array.isArray(stored.value)) return [];
      const valid = stored.value.filter((entry): entry is LocalChecklistRecord => (
        isRecord(entry) && typeof entry.id === 'number' && typeof entry.text === 'string' && typeof entry.done === 'boolean'
      ));
      return valid.length > 0 ? [checklistToItem(valid)] : [];
    },
    write(scope, items) {
      const checklist = itemToChecklist(items.find(item => item.clientKey === ACCOUNTING_CHECKLIST_KEY));
      if (checklist) writeJson(local(), scopedStorageKey(CHECKLIST_STORAGE_KEY, scope), checklist);
    },
  },
};

/** Raw local values for every key a kind uses (the pre-migration backup reads these). */
export function readRawLocalValues(kind: UserDataKind, scope: string): Array<{ storage: 'local' | 'session'; baseKey: string; raw: string }> {
  const values: Array<{ storage: 'local' | 'session'; baseKey: string; raw: string }> = [];
  for (const { storage, baseKey } of LOCAL_CODECS[kind].keys) {
    const store = storage === 'local' ? local() : session();
    const key = scopedStorageKey(baseKey, scope);
    if (!store || !key) continue;
    try {
      const raw = store.getItem(key);
      if (raw !== null) values.push({ storage, baseKey, raw });
    } catch {
      // Unreadable storage has nothing to back up.
    }
  }
  return values;
}
