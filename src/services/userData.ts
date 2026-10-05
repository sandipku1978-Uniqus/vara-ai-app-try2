/**
 * Durable user research (migration 026): the typed client for /api/user/*
 * and a small write-through cache over the browser stores.
 *
 * How it fits the existing stores
 *   - The stores keep reading and writing their scoped local keys exactly as
 *     before, so every read stays synchronous and signed-out use is
 *     unchanged. When the identity is a signed-in account they also hand
 *     their collection to syncUserCollection(); the engine diffs it against
 *     what it last knew and queues upserts/deletes in a persisted outbox,
 *     flushed to the server shortly after.
 *   - On the first authenticated load the engine probes the API, ensures a
 *     personal project, uploads the existing local data once (by clientKey,
 *     so a retry is harmless), records the migration in a scoped flag, and
 *     hydrates each local cache from the server. Hydration notifies
 *     onUserDataHydrated() listeners so a mounted view can re-read.
 *   - The local copy is never deleted: before the first hydration rewrites a
 *     key, its raw value is kept under a scoped pre-migration backup key.
 *   - If the API is unreachable or not provisioned (503), the mode becomes
 *     'unavailable' and everything stays local, as before this package.
 *
 * Signed-out (scope 'signed-out' or no scope): every function here is a
 * no-op and the stores behave exactly as they did.
 */

import {
  USER_DATA_FIELDS,
  USER_DATA_KINDS,
  USER_DATA_LIMITS,
  USER_DATA_MAX_DELETE_KEYS,
  userDataRoutePath,
  type UserDataKind,
} from '../lib/user-data-kinds';
import { validateUserDataItem } from '../lib/user-data-input';
import {
  LOCAL_CODECS,
  PERSONAL_PROJECT_KEY,
  readRawLocalValues,
  type UserDataItem,
  type UserDataItemMap,
  type UserProjectItem,
} from './userDataCodecs';
import { getActiveBrowserStorageScope, isAccountStorageScope, scopedStorageKey } from './storageNamespace';

export type {
  UserAlertItem,
  UserAnnotationItem,
  UserChecklistItem,
  UserDataItem,
  UserDataItemMap,
  UserMemoItem,
  UserPeerSetItem,
  UserProjectItem,
  UserResearchTabItem,
  UserSavedSearchItem,
  UserWatchlistItem,
} from './userDataCodecs';
export type { UserDataKind } from '../lib/user-data-kinds';

// ── Typed API client ─────────────────────────────────────────────────────────

export type UserDataApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; errorClass: string; error: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike | null = null;

function activeFetch(): FetchLike | null {
  if (fetchImpl) return fetchImpl;
  return typeof fetch === 'function' ? (input, init) => fetch(input, init) : null;
}

async function callApi<T>(kind: UserDataKind, method: 'GET' | 'PUT' | 'DELETE', body?: unknown): Promise<UserDataApiResult<T>> {
  const doFetch = activeFetch();
  if (!doFetch) return { ok: false, status: 0, errorClass: 'transport', error: 'fetch is unavailable' };
  let response: Response;
  try {
    response = await doFetch(userDataRoutePath(kind), {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, status: 0, errorClass: 'transport', error: error instanceof Error ? error.message : 'network error' };
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = await response.json() as Record<string, unknown>;
  } catch {
    // Non-JSON (e.g. a proxy page) is a failure below.
  }
  if (!response.ok || parsed.ok !== true) {
    return {
      ok: false,
      status: response.status,
      errorClass: typeof parsed.errorClass === 'string' ? parsed.errorClass : 'unexpected',
      error: typeof parsed.error === 'string' ? parsed.error : `HTTP ${response.status}`,
    };
  }
  return { ok: true, value: parsed as T };
}

/** Every object of `kind` the signed-in identity owns. */
export async function fetchUserData<K extends UserDataKind>(kind: K): Promise<UserDataApiResult<UserDataItemMap[K][]>> {
  const result = await callApi<{ items: UserDataItemMap[K][] }>(kind, 'GET');
  return result.ok ? { ok: true, value: Array.isArray(result.value.items) ? result.value.items : [] } : result;
}

/** Upsert by clientKey. Server-managed fields (updatedAt) are stripped before sending. */
export async function putUserData<K extends UserDataKind>(
  kind: K,
  items: UserDataItemMap[K][],
): Promise<UserDataApiResult<Array<{ id: string; clientKey: string; updatedAt: string }>>> {
  const result = await callApi<{ items: Array<{ id: string; clientKey: string; updatedAt: string }> }>(
    kind, 'PUT', { items: items.map(item => toWire(kind, item)) },
  );
  return result.ok ? { ok: true, value: result.value.items || [] } : result;
}

export async function deleteUserData(kind: UserDataKind, clientKeys: string[]): Promise<UserDataApiResult<number>> {
  const result = await callApi<{ deleted: number }>(kind, 'DELETE', { clientKeys });
  return result.ok ? { ok: true, value: Number(result.value.deleted) || 0 } : result;
}

/** Only the writable fields of a kind, as the route's whitelist expects. */
export function toWire(kind: UserDataKind, item: object): Record<string, unknown> {
  const source = item as Record<string, unknown>;
  const wire: Record<string, unknown> = {};
  for (const name of Object.keys(USER_DATA_FIELDS[kind])) {
    if (source[name] !== undefined) wire[name] = source[name];
  }
  return wire;
}

// ── Pure sync helpers (exported for tests) ───────────────────────────────────

/** Fields that never change after creation; excluded when comparing versions. */
const COMPARISON_EXCLUDED = new Set(['projectId', 'createdAt', 'id', 'updatedAt', 'savedSearchId']);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function comparableJson(kind: UserDataKind, item: object): string {
  const wire = toWire(kind, item);
  for (const key of COMPARISON_EXCLUDED) delete wire[key];
  return stableStringify(wire);
}

export type OutboxOp = { op: 'put'; item: Record<string, unknown> } | { op: 'delete' };
export type Outbox = Partial<Record<UserDataKind, Record<string, OutboxOp>>>;

/** Server items with not-yet-flushed local operations applied on top. */
export function overlayOutbox<T extends { clientKey: string }>(serverItems: T[], ops: Record<string, OutboxOp> | undefined): T[] {
  const merged = new Map(serverItems.map(item => [item.clientKey, item]));
  for (const [clientKey, op] of Object.entries(ops || {})) {
    if (op.op === 'delete') merged.delete(clientKey);
    else merged.set(clientKey, { ...(merged.get(clientKey) || {}), ...op.item, clientKey } as T);
  }
  return [...merged.values()];
}

/** Splits puts into request-sized chunks by count and serialized size. */
export function chunkForRequest<T>(items: T[], maxItems: number, maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 16;
  for (const item of items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).byteLength + 1;
    if (current.length > 0 && (current.length >= maxItems || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 16;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ── Engine state ─────────────────────────────────────────────────────────────

export type UserDataMode = 'local' | 'connecting' | 'server' | 'unavailable';

export interface UserDataStatus {
  mode: UserDataMode;
  scope: string | null;
  pendingWrites: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  migratedAt: string | null;
}

interface SnapshotEntry {
  item: Record<string, unknown>;
  json: string;
}

interface ScopeState {
  scope: string;
  generation: number;
  bootstrapStarted: boolean;
  snapshot: Map<UserDataKind, Map<string, SnapshotEntry>>;
  /** Kinds with nothing stored locally when the scope was prepared (a new device or session). */
  cold: Set<UserDataKind>;
  coldBaseline: Map<UserDataKind, Set<string>>;
  coldPending: Map<UserDataKind, Map<string, Record<string, unknown>>>;
  hydrated: Set<UserDataKind>;
  outbox: Outbox;
  projects: UserProjectItem[];
  /** For windowed kinds: every clientKey the local store has handed to syncUserCollection on this page. */
  held: Map<UserDataKind, Set<string>>;
}

const OUTBOX_KEY = 'urc.userdata.outbox.v1';
const MIGRATED_KEY = 'urc.userdata.migrated.v1';
const ACTIVE_PROJECT_KEY = 'urc.userdata.active-project.v1';
const BACKUP_KEY_PREFIX = 'urc.userdata.premigration.';
const FLUSH_DELAY_MS = 800;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
/** Projects first so references resolve; saved searches before the alerts that may point at them. */
const FLUSH_ORDER: UserDataKind[] = [
  'projects', 'saved-searches', 'alerts', 'peer-sets', 'memo', 'annotations', 'research-tabs', 'watchlist', 'checklists',
];
const MIGRATION_KINDS = USER_DATA_KINDS.filter(kind => kind !== 'projects');
/**
 * Kinds whose local store holds only a window of the account's rows: the
 * search page keeps at most MAX_RESEARCH_TABS tabs, while the account may
 * hold more (tabs from another device, or restored from a project). A row
 * absent from such a store's collection is deleted only when the store held
 * it earlier on this page, i.e. the user closed it; a row the store never
 * loaded is left alone.
 */
const WINDOWED_KINDS: ReadonlySet<UserDataKind> = new Set<UserDataKind>(['research-tabs']);

let state: ScopeState | null = null;
let status: UserDataStatus = {
  mode: 'local', scope: null, pendingWrites: 0, lastError: null, lastSyncedAt: null, migratedAt: null,
};
const statusListeners = new Set<() => void>();
const hydrationListeners = new Map<UserDataKind, Set<() => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let flushRequested = false;
let retryAttempt = 0;
/** An item the contract rejects stays local; this message outlives successful flushes. */
let validationError: string | null = null;

function reportInvalid(message: string): void {
  validationError = `Not saved to your account: ${message}`;
  setStatus({ lastError: validationError });
}

let notifyQueued = false;

function setStatus(update: Partial<UserDataStatus>): void {
  // Publish only a real change: the object identity is the snapshot that
  // useSyncExternalStore compares, and ensureState() re-prepares a signed-out
  // scope on every call, so an unchanged status must stay the same object.
  const changed = (Object.keys(update) as Array<keyof UserDataStatus>)
    .some(key => !Object.is(update[key], status[key]));
  if (!changed) return;
  publishStatus({ ...status, ...update });
}

/**
 * Replace the status object and notify subscribers. Also used directly when
 * the project list or active project changed: those live outside the status
 * fields, so a fresh object is what makes subscribers re-read them.
 */
function publishStatus(next: UserDataStatus): void {
  status = next;
  // Deferred: prepareUserDataScope runs while the AppProvider renders, and a
  // subscriber must not be updated in the middle of another component's render.
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    statusListeners.forEach(listener => listener());
  });
}

function countPending(outbox: Outbox): number {
  return Object.values(outbox).reduce((total, ops) => total + Object.keys(ops || {}).length, 0);
}

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function readScoped(baseKey: string, scope: string): string | null {
  const key = scopedStorageKey(baseKey, scope);
  try {
    return key ? storage()?.getItem(key) ?? null : null;
  } catch {
    return null;
  }
}

function writeScoped(baseKey: string, scope: string, value: string | null): void {
  const key = scopedStorageKey(baseKey, scope);
  if (!key) return;
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // Quota/private mode: the outbox still lives in memory for this page.
  }
}

function loadOutbox(scope: string): Outbox {
  try {
    const raw = readScoped(OUTBOX_KEY, scope);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Outbox : {};
  } catch {
    return {};
  }
}

function persistOutbox(current: ScopeState): void {
  const pending = countPending(current.outbox);
  writeScoped(OUTBOX_KEY, current.scope, pending > 0 ? JSON.stringify(current.outbox) : null);
  setStatus({ pendingWrites: pending });
}

function snapshotFrom(kind: UserDataKind, items: object[]): Map<string, SnapshotEntry> {
  const map = new Map<string, SnapshotEntry>();
  for (const item of items) {
    const record = item as Record<string, unknown>;
    if (typeof record.clientKey !== 'string') continue;
    map.set(record.clientKey, { item: { ...record }, json: comparableJson(kind, record) });
  }
  return map;
}

/**
 * Prepare the engine for an identity scope. Synchronous and idempotent; the
 * AppProvider calls it while rendering, before any store effect can write,
 * so "what was stored locally before this page load" is captured exactly.
 */
export function prepareUserDataScope(scope: string | null): void {
  if (state && state.scope === scope) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  retryAttempt = 0;
  validationError = null;
  if (!isAccountStorageScope(scope) || typeof window === 'undefined') {
    state = null;
    setStatus({ mode: 'local', scope, pendingWrites: 0, lastError: null, lastSyncedAt: null, migratedAt: null });
    return;
  }
  const next: ScopeState = {
    scope,
    generation: (state?.generation ?? 0) + 1,
    bootstrapStarted: false,
    snapshot: new Map(),
    cold: new Set(),
    coldBaseline: new Map(),
    coldPending: new Map(),
    hydrated: new Set(),
    outbox: loadOutbox(scope),
    projects: [],
    held: new Map(),
  };
  for (const kind of USER_DATA_KINDS) {
    const items = LOCAL_CODECS[kind].read(scope) as object[] | null;
    if (items === null) next.cold.add(kind);
    next.snapshot.set(kind, snapshotFrom(kind, items || []));
  }
  next.projects = (LOCAL_CODECS.projects.read(scope) || []) as UserProjectItem[];
  state = next;
  setStatus({
    mode: 'connecting',
    scope,
    pendingWrites: countPending(next.outbox),
    lastError: null,
    lastSyncedAt: null,
    migratedAt: readScoped(MIGRATED_KEY, scope),
  });
}

function ensureState(): ScopeState | null {
  const scope = getActiveBrowserStorageScope();
  if (!state || state.scope !== scope) prepareUserDataScope(scope);
  return state;
}

/** True when the active identity is an account (writes are queued for the server). */
export function isAccountUserDataScope(): boolean {
  return Boolean(ensureState());
}

export function getUserDataStatus(): UserDataStatus {
  return status;
}

export function subscribeUserDataStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

/** Called after the server copy of `kind` has been written into the local cache. */
export function onUserDataHydrated(kind: UserDataKind, listener: () => void): () => void {
  let listeners = hydrationListeners.get(kind);
  if (!listeners) {
    listeners = new Set();
    hydrationListeners.set(kind, listeners);
  }
  listeners.add(listener);
  return () => { listeners?.delete(listener); };
}

function notifyHydrated(kind: UserDataKind): void {
  hydrationListeners.get(kind)?.forEach(listener => listener());
}

function enqueue(current: ScopeState, kind: UserDataKind, clientKey: string, op: OutboxOp): void {
  const ops = current.outbox[kind] || (current.outbox[kind] = {});
  ops[clientKey] = op;
}

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (!state || status.mode !== 'server') return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushUserData();
  }, delay);
}

/** The project new objects are filed under: the chosen one, else the personal project. */
export function getActiveProjectId(): string | null {
  const current = ensureState();
  if (!current) return null;
  const chosen = readScoped(ACTIVE_PROJECT_KEY, current.scope);
  const live = current.projects.filter(project => !project.archivedAt && project.id);
  if (chosen && live.some(project => project.id === chosen)) return chosen;
  return live.find(project => project.clientKey === PERSONAL_PROJECT_KEY)?.id ?? null;
}

export function listUserProjects(): UserProjectItem[] {
  const current = ensureState();
  return current ? current.projects.filter(project => !project.archivedAt) : [];
}

export function setActiveProject(projectId: string): void {
  const current = ensureState();
  if (!current || !current.projects.some(project => project.id === projectId)) return;
  writeScoped(ACTIVE_PROJECT_KEY, current.scope, projectId);
  publishStatus({ ...status });
}

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Create a project (name + question) and make it active. Returns it, or null when signed out. */
export function createUserProject(input: { name: string; question: string }): UserProjectItem | null {
  const current = ensureState();
  const name = input.name.trim().slice(0, 120);
  if (!current || !name) return null;
  const project: UserProjectItem = {
    id: newUuid(),
    clientKey: `project-${newUuid()}`,
    name,
    question: input.question.trim().slice(0, 2000),
    position: current.projects.length,
    archivedAt: null,
  };
  current.projects = [...current.projects, project];
  LOCAL_CODECS.projects.write(current.scope, current.projects);
  syncUserCollection('projects', current.projects);
  setActiveProject(project.id as string);
  return project;
}

/**
 * Hand the current local collection of `kind` to the engine. It queues an
 * upsert for every new or changed item and a delete for every item that was
 * known and is gone. `partition` limits deletes to a slice of the kind (one
 * filing's annotations, the memo draft vs. the citations).
 */
export function syncUserCollection<K extends UserDataKind>(
  kind: K,
  items: UserDataItem<K>[],
  options: { partition?: (item: Record<string, unknown>) => boolean } = {},
): void {
  const current = ensureState();
  if (!current) return;
  const next = new Map<string, Record<string, unknown>>();
  for (const item of items as object[]) {
    const record = item as Record<string, unknown>;
    if (typeof record.clientKey === 'string') next.set(record.clientKey, record);
  }
  const inPartition = options.partition || (() => true);
  // Keys from earlier collections only: this collection's keys are added
  // after the diff (a key it contains is never deleted by it anyway).
  const windowed = WINDOWED_KINDS.has(kind);
  const held = current.held.get(kind) || new Set<string>();
  if (windowed) current.held.set(kind, held);

  // A cold kind (nothing was stored here) is not diffed until the server has
  // answered: the store's first collection is defaults, not the user's work,
  // and pushing it could resurrect what another device removed. Only items
  // added after that first collection are kept for hydration.
  if (current.cold.has(kind) && !current.hydrated.has(kind)) {
    let baseline = current.coldBaseline.get(kind);
    if (!baseline) {
      baseline = new Set(next.keys());
      current.coldBaseline.set(kind, baseline);
    }
    const pending = new Map(
      [...(current.coldPending.get(kind) || new Map<string, Record<string, unknown>>()).entries()]
        .filter(([, item]) => !inPartition(item)),
    );
    for (const [clientKey, item] of next) {
      if (!baseline.has(clientKey)) pending.set(clientKey, item);
    }
    current.coldPending.set(kind, pending);
    if (windowed) for (const clientKey of next.keys()) held.add(clientKey);
    return;
  }

  const snapshot = current.snapshot.get(kind) || new Map<string, SnapshotEntry>();
  current.snapshot.set(kind, snapshot);
  let changed = false;
  for (const [clientKey, record] of next) {
    const json = comparableJson(kind, record);
    const previous = snapshot.get(clientKey);
    if (previous && previous.json === json) continue;
    const projectId = record.projectId ?? previous?.item.projectId ?? (previous ? null : getActiveProjectId());
    const full: Record<string, unknown> = kind === 'projects' ? { ...record } : { ...record, projectId: projectId ?? null };
    snapshot.set(clientKey, { item: full, json });
    const wire = toWire(kind, full);
    const validation = validateUserDataItem(kind, wire, kind);
    if ('error' in validation) {
      // Kept locally; reported, never sent (it would fail the whole batch).
      reportInvalid(validation.error);
      continue;
    }
    enqueue(current, kind, clientKey, { op: 'put', item: wire });
    changed = true;
  }
  for (const [clientKey, entry] of [...snapshot.entries()]) {
    if (next.has(clientKey) || !inPartition(entry.item)) continue;
    if (windowed && !held.has(clientKey)) continue;
    snapshot.delete(clientKey);
    held.delete(clientKey);
    enqueue(current, kind, clientKey, { op: 'delete' });
    changed = true;
  }
  if (windowed) for (const clientKey of next.keys()) held.add(clientKey);
  if (changed) {
    persistOutbox(current);
    scheduleFlush();
  }
}

// ── Flush ────────────────────────────────────────────────────────────────────

async function sendKind(current: ScopeState, kind: UserDataKind): Promise<UserDataApiResult<null>> {
  const ops = current.outbox[kind] || {};
  const deletes = Object.entries(ops).filter(([, op]) => op.op === 'delete');
  const puts = Object.entries(ops).filter(([, op]) => op.op === 'put') as Array<[string, Extract<OutboxOp, { op: 'put' }>]>;

  for (const chunk of chunkForRequest(deletes, USER_DATA_MAX_DELETE_KEYS, Number.MAX_SAFE_INTEGER)) {
    const result = await deleteUserData(kind, chunk.map(([clientKey]) => clientKey));
    if (!result.ok) return result;
    for (const [clientKey, op] of chunk) {
      if (current.outbox[kind]?.[clientKey] === op) delete current.outbox[kind]![clientKey];
    }
    persistOutbox(current);
  }
  const limits = USER_DATA_LIMITS[kind];
  for (const chunk of chunkForRequest(puts, limits.maxItemsPerRequest, Math.floor(limits.maxBodyBytes * 0.9))) {
    const result = await callApi<{ items: unknown[] }>(kind, 'PUT', { items: chunk.map(([, op]) => op.item) });
    if (!result.ok) return result;
    for (const [clientKey, op] of chunk) {
      if (current.outbox[kind]?.[clientKey] === op) delete current.outbox[kind]![clientKey];
    }
    persistOutbox(current);
  }
  if (current.outbox[kind] && Object.keys(current.outbox[kind]!).length === 0) delete current.outbox[kind];
  return { ok: true, value: null };
}

/** Send every queued operation now. Resolves when the outbox is empty or a request failed. */
export async function flushUserData(): Promise<void> {
  const current = state;
  if (!current || status.mode !== 'server') return;
  if (flushing) {
    flushRequested = true;
    return;
  }
  flushing = true;
  try {
    for (const kind of FLUSH_ORDER) {
      if (state !== current) return;
      if (!current.outbox[kind] || Object.keys(current.outbox[kind]!).length === 0) continue;
      const result = await sendKind(current, kind);
      if (!result.ok) {
        handleFailure(result);
        return;
      }
    }
    retryAttempt = 0;
    persistOutbox(current);
    setStatus({ lastError: validationError, lastSyncedAt: new Date().toISOString() });
  } finally {
    flushing = false;
    if (flushRequested) {
      flushRequested = false;
      scheduleFlush(0);
    }
  }
}

function handleFailure(result: Extract<UserDataApiResult<unknown>, { ok: false }>): void {
  if (result.status === 400 || result.status === 413) {
    // A rejected batch will be rejected again; surface it and stop retrying
    // until the next change rather than hammering the API.
    setStatus({ lastError: result.error });
    return;
  }
  if (result.status === 503 || result.status === 401 || result.status === 403) {
    setStatus({ mode: 'unavailable', lastError: result.error });
    return;
  }
  setStatus({ lastError: result.error });
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt += 1;
  scheduleFlush(delay);
}

// ── Bootstrap: probe, migrate once, hydrate ─────────────────────────────────

function backupBeforeFirstHydration(scope: string): void {
  for (const kind of USER_DATA_KINDS) {
    for (const { storage: area, baseKey, raw } of readRawLocalValues(kind, scope)) {
      const backupBase = `${BACKUP_KEY_PREFIX}${area}.${baseKey}`;
      if (readScoped(backupBase, scope) === null) writeScoped(backupBase, scope, raw);
    }
  }
}

async function ensurePersonalProject(serverProjects: UserProjectItem[]): Promise<UserProjectItem[] | null> {
  if (serverProjects.some(project => project.clientKey === PERSONAL_PROJECT_KEY)) return serverProjects;
  const personal: UserProjectItem = {
    id: newUuid(),
    clientKey: PERSONAL_PROJECT_KEY,
    name: 'Personal research',
    question: '',
    position: 0,
    archivedAt: null,
  };
  const result = await putUserData('projects', [personal]);
  if (!result.ok) return null;
  const written = result.value.find(row => row.clientKey === PERSONAL_PROJECT_KEY);
  return [{ ...personal, id: written?.id ?? personal.id }, ...serverProjects.filter(project => project.clientKey !== PERSONAL_PROJECT_KEY)];
}

async function migrateLocalData(current: ScopeState, personalProjectId: string | null): Promise<boolean> {
  for (const kind of MIGRATION_KINDS) {
    if (current.cold.has(kind)) continue;
    const items = (LOCAL_CODECS[kind].read(current.scope) || []) as object[];
    const wires: Record<string, unknown>[] = [];
    for (const item of items) {
      const wire = toWire(kind, { ...item, projectId: (item as { projectId?: string | null }).projectId ?? personalProjectId });
      const validation = validateUserDataItem(kind, wire, kind);
      // Kept in this browser (the local copy is never removed) and reported.
      if ('error' in validation) reportInvalid(validation.error);
      else wires.push(wire);
    }
    if (wires.length === 0) continue;
    const limits = USER_DATA_LIMITS[kind];
    for (const chunk of chunkForRequest(wires, limits.maxItemsPerRequest, Math.floor(limits.maxBodyBytes * 0.9))) {
      const result = await callApi(kind, 'PUT', { items: chunk });
      if (!result.ok) {
        handleBootstrapFailure(result);
        return false;
      }
    }
  }
  return true;
}

function hydrateKind<K extends UserDataKind>(current: ScopeState, kind: K, serverItems: UserDataItem<K>[]): void {
  let items: Record<string, unknown>[] = serverItems.map(item => ({ ...item }) as Record<string, unknown>);
  if (current.cold.has(kind)) {
    if (serverItems.length === 0) {
      // Nothing on the server yet: whatever the store holds now is the user's.
      const localItems = (LOCAL_CODECS[kind].read(current.scope) || []) as object[];
      for (const item of localItems) {
        const record = { ...item, projectId: getActiveProjectId() } as Record<string, unknown>;
        const wire = toWire(kind, record);
        if (!('error' in validateUserDataItem(kind, wire, kind))) {
          enqueue(current, kind, String(record.clientKey), { op: 'put', item: wire });
        }
        items.push(record);
      }
    } else {
      for (const [clientKey, item] of current.coldPending.get(kind) || []) {
        const record = { ...item, projectId: getActiveProjectId() };
        const wire = toWire(kind, record);
        if (!('error' in validateUserDataItem(kind, wire, kind))) {
          enqueue(current, kind, clientKey, { op: 'put', item: wire });
        }
        items = items.filter(existing => existing.clientKey !== clientKey);
        items.push(record);
      }
    }
  }
  items = overlayOutbox(items as Array<{ clientKey: string }>, current.outbox[kind]) as Record<string, unknown>[];
  LOCAL_CODECS[kind].write(current.scope, items as unknown as UserDataItem<K>[]);
  current.snapshot.set(kind, snapshotFrom(kind, items));
  current.hydrated.add(kind);
  if (kind === 'projects') current.projects = items as unknown as UserProjectItem[];
  notifyHydrated(kind);
}

function handleBootstrapFailure(result: Extract<UserDataApiResult<unknown>, { ok: false }>): void {
  setStatus({ mode: 'unavailable', lastError: result.error });
}

async function bootstrap(current: ScopeState): Promise<void> {
  const generation = current.generation;
  const stale = () => state !== current || current.generation !== generation;

  const projectsResult = await fetchUserData('projects');
  if (stale()) return;
  if (!projectsResult.ok) {
    handleBootstrapFailure(projectsResult);
    return;
  }
  const projects = await ensurePersonalProject(projectsResult.value);
  if (stale()) return;
  if (!projects) {
    setStatus({ mode: 'unavailable', lastError: 'The personal project could not be created.' });
    return;
  }
  current.projects = projects;
  const personalId = projects.find(project => project.clientKey === PERSONAL_PROJECT_KEY)?.id ?? null;

  if (!readScoped(MIGRATED_KEY, current.scope)) {
    backupBeforeFirstHydration(current.scope);
    const migrated = await migrateLocalData(current, personalId);
    if (stale() || !migrated) return;
    const migratedAt = new Date().toISOString();
    writeScoped(MIGRATED_KEY, current.scope, migratedAt);
    setStatus({ migratedAt });
  }

  const kinds = USER_DATA_KINDS.filter(kind => kind !== 'projects');
  const results = await Promise.all(kinds.map(kind => fetchUserData(kind)));
  if (stale()) return;
  const failed = results.find(result => !result.ok);
  if (failed && !failed.ok) {
    handleBootstrapFailure(failed);
    return;
  }
  hydrateKind(current, 'projects', projects);
  kinds.forEach((kind, index) => {
    const result = results[index];
    if (result.ok) hydrateKind(current, kind, result.value as UserDataItem<typeof kind>[]);
  });
  persistOutbox(current);
  setStatus({ mode: 'server', lastError: validationError, lastSyncedAt: new Date().toISOString() });
  await flushUserData();
}

/**
 * Start durable sync for `scope` (once per scope). Signed-out scopes stay
 * local. `fetch` may be injected for tests.
 */
export function startUserDataSync(scope: string | null, options: { fetch?: FetchLike } = {}): void {
  if (options.fetch) fetchImpl = options.fetch;
  prepareUserDataScope(scope);
  const current = state;
  if (!current || current.bootstrapStarted) return;
  current.bootstrapStarted = true;
  setStatus({ mode: 'connecting' });
  void bootstrap(current).catch(error => {
    if (state === current) setStatus({ mode: 'unavailable', lastError: error instanceof Error ? error.message : 'sync failed' });
  });
}

/** Test seam: forget engine state and the injected fetch (subscriptions are kept). */
export function resetUserDataForTests(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = false;
  flushRequested = false;
  retryAttempt = 0;
  validationError = null;
  state = null;
  fetchImpl = null;
  status = { mode: 'local', scope: null, pendingWrites: 0, lastError: null, lastSyncedAt: null, migratedAt: null };
  notifyQueued = false;
  // Listeners stay: modules (memoTray) register theirs once at import.

}
