/**
 * The project workspace's data layer: which saved objects belong to a
 * project, where each one reopens, and the few writes the workspace makes.
 *
 * Every read goes through userData.ts (GET /api/user/{kind}) — the server
 * copy is the record of what is filed under which project; the browser
 * stores do not carry project ids for most kinds. Writes are explicit PUTs
 * with the full item and its new projectId (the upsert keeps an omitted
 * projectId, so a move must name the target).
 *
 * Pure helpers are exported for tests; nothing here touches storage keys
 * directly.
 */

import { MAX_RESEARCH_TABS, PERSONAL_PROJECT_KEY, citationToItem } from '../../services/userDataCodecs';
import {
  fetchUserData,
  getUserDataStatus,
  putUserData,
  type UserAlertItem,
  type UserDataItemMap,
  type UserMemoItem,
  type UserProjectItem,
  type UserResearchTabItem,
} from '../../services/userData';
import { buildResearchRouteParams, loadResearchSessions, saveResearchSessions, type ResearchSearchSession } from '../../services/researchSessions';
import { buildSavedAlertRouteParams } from '../../services/alertRoutes';
import { parseSearchJobFilters, parseSearchJobSummary, type SearchJobSummary } from '../../services/searchJobs';
import { citationId, type MemoCitation } from '../../services/memoTray';
import type { CartFiling } from '../../services/documentCart';
import type { SearchFilters } from '../../domain/searchFilters';
import type { UserDataKind } from '../../lib/user-data-kinds';

/** The kinds a project workspace shows, in section order. */
export const WORKSPACE_KINDS = ['saved-searches', 'alerts', 'peer-sets', 'memo', 'annotations', 'research-tabs'] as const;
export type WorkspaceKind = typeof WORKSPACE_KINDS[number];

export const WORKSPACE_KIND_LABELS: Record<WorkspaceKind, string> = {
  'saved-searches': 'Saved searches',
  alerts: 'Alerts',
  'peer-sets': 'Peer sets',
  memo: 'Memo items',
  annotations: 'Annotations',
  'research-tabs': 'Research tabs',
};

/** A listed item: writable fields plus the server-managed ones the GET adds. */
export type Listed<K extends UserDataKind> = UserDataItemMap[K] & {
  id?: string | null;
  createdAt?: string | null;
  updatedAt?: string;
};

export type KindLoad<K extends UserDataKind> =
  | { status: 'loading' }
  | { status: 'ready'; items: Listed<K>[] }
  | { status: 'failed'; httpStatus: number; error: string };

// ── Membership ───────────────────────────────────────────────────────────────

export function personalProjectId(projects: UserProjectItem[]): string | null {
  return projects.find(project => project.clientKey === PERSONAL_PROJECT_KEY)?.id ?? null;
}

export function isPersonalProject(project: Pick<UserProjectItem, 'clientKey'>): boolean {
  return project.clientKey === PERSONAL_PROJECT_KEY;
}

/**
 * An object belongs to the project it names. Objects that name no project
 * (stored before projects existed, or whose project was deleted — the
 * foreign key sets null) are shown under the personal project, where new
 * objects default, and flagged as unfiled.
 */
export function belongsToProject(
  item: { projectId?: string | null },
  projectId: string,
  personalId: string | null,
): boolean {
  if (item.projectId) return item.projectId === projectId;
  return personalId !== null && projectId === personalId;
}

export function projectItems<T extends { projectId?: string | null }>(items: T[], projectId: string, personalId: string | null): T[] {
  return items.filter(item => belongsToProject(item, projectId, personalId));
}

/** Most recent updatedAt (else createdAt) across items; null when none carries one. */
export function latestActivity(items: Array<{ updatedAt?: string | null; createdAt?: string | null }>): string | null {
  let best: number | null = null;
  let bestText: string | null = null;
  for (const item of items) {
    for (const value of [item.updatedAt, item.createdAt]) {
      const time = value ? Date.parse(value) : Number.NaN;
      if (!Number.isNaN(time) && (best === null || time > best)) {
        best = time;
        bestText = value as string;
      }
    }
  }
  return bestText;
}

export interface ProjectSummary {
  project: Listed<'projects'>;
  counts: Record<WorkspaceKind, number>;
  lastActivity: string | null;
}

export function summarizeProjects(
  projects: Listed<'projects'>[],
  itemsByKind: { [K in WorkspaceKind]: Listed<K>[] },
): ProjectSummary[] {
  const personalId = personalProjectId(projects);
  return projects.map(project => {
    const counts = {} as Record<WorkspaceKind, number>;
    const activity: Array<{ updatedAt?: string | null; createdAt?: string | null }> = [project];
    for (const kind of WORKSPACE_KINDS) {
      const mine = project.id ? projectItems(itemsByKind[kind] as Array<Listed<WorkspaceKind>>, project.id, personalId) : [];
      counts[kind] = mine.length;
      activity.push(...mine);
    }
    return { project, counts, lastActivity: latestActivity(activity) };
  });
}

// ── Loading ──────────────────────────────────────────────────────────────────

export async function loadKind<K extends UserDataKind>(kind: K): Promise<KindLoad<K>> {
  const result = await fetchUserData(kind);
  if (result.ok) return { status: 'ready', items: result.value as Listed<K>[] };
  return { status: 'failed', httpStatus: result.status, error: result.error };
}

/** Plain-language reason for a failed load; a 503 is "not provisioned", not "empty". */
export function describeLoadFailure(failure: { httpStatus: number; error: string }): string {
  if (failure.httpStatus === 503) {
    return 'Account storage is not available right now (HTTP 503), so nothing filed under this project can be listed. Work saved since then is kept in this browser.';
  }
  if (failure.httpStatus === 401 || failure.httpStatus === 403) {
    return `Saved research belongs to a signed-in account (HTTP ${failure.httpStatus}).`;
  }
  if (failure.httpStatus === 0) return `Account storage could not be reached: ${failure.error}`;
  return `Account storage answered HTTP ${failure.httpStatus}: ${failure.error}`;
}

export type JobsLoad =
  | { status: 'loading' }
  | { status: 'ready'; jobs: SearchJobSummary[] }
  | { status: 'unavailable'; httpStatus: number }
  | { status: 'failed'; error: string };

/** GET /api/search-jobs: the owner's continuation jobs (the record has no project). */
export async function loadSearchJobs(limit = 20, fetchImpl: typeof fetch = fetch): Promise<JobsLoad> {
  try {
    const response = await fetchImpl(`/api/search-jobs?limit=${limit}`, { cache: 'no-store' });
    if (response.status === 503 || response.status === 401 || response.status === 403) {
      return { status: 'unavailable', httpStatus: response.status };
    }
    if (!response.ok) return { status: 'failed', error: `HTTP ${response.status}` };
    const payload = await response.json() as { jobs?: unknown[] };
    return {
      status: 'ready',
      jobs: (payload.jobs ?? []).map(parseSearchJobSummary).filter((job): job is SearchJobSummary => job !== null),
    };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'network error' };
  }
}

/** True when a job record names a project (none does today; see the report). */
export function jobProjectId(job: SearchJobSummary): string | null {
  const value = (job as unknown as { projectId?: unknown }).projectId;
  return typeof value === 'string' && value ? value : null;
}

// ── Reopening ────────────────────────────────────────────────────────────────

/** A saved filter object in the current SearchFilters shape, or null when it no longer parses. */
export function readStoredFilters(filters: unknown): SearchFilters | null {
  return parseSearchJobFilters(filters ?? {});
}

/** /search URL that re-runs a saved search; filters that no longer parse are dropped and reported. */
export function savedSearchHref(search: { query: string; mode: 'semantic' | 'boolean'; filters: unknown }): {
  href: string;
  filtersDropped: boolean;
} {
  const parsed = readStoredFilters(search.filters);
  const filters = parsed ?? readStoredFilters({})!;
  const params = buildResearchRouteParams(search.query, search.mode, filters);
  return { href: `/search?${params.toString()}`, filtersDropped: parsed === null };
}

export function alertSearchHref(alert: Pick<UserAlertItem, 'query' | 'mode' | 'filters' | 'defaultForms'>): {
  href: string;
  filtersDropped: boolean;
} {
  const parsed = readStoredFilters(alert.filters);
  const filters = parsed ?? readStoredFilters({})!;
  const params = buildSavedAlertRouteParams({ query: alert.query, mode: alert.mode, filters, defaultForms: alert.defaultForms });
  return { href: `/search?${params.toString()}`, filtersDropped: parsed === null };
}

/** The viewer address an annotation was saved under (cik_accession_document). */
export function annotationHref(filingKey: string): string {
  return `/filing/${filingKey.split('/').map(encodeURIComponent).join('/')}`;
}

export function describeFilingKey(filingKey: string): { cik: string; accession: string; document: string } {
  const [cik = '', accession = '', ...rest] = filingKey.split('_');
  return { cik, accession, document: rest.join('_') };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isFilterShape(value: unknown): boolean {
  return isRecord(value) && isStringArray(value.formTypes) && isStringArray(value.exchange) && isStringArray(value.acceleratedStatus);
}

/**
 * A stored tab can be put back into the search page only when it has the
 * whole session shape the page reads; a tab too large to keep whole was
 * saved as id + title, and restoring that would break the page's tab list.
 */
export function isRestorableResearchTab(payload: unknown): payload is ResearchSearchSession {
  if (!isRecord(payload)) return false;
  if (typeof payload.id !== 'string' || typeof payload.title !== 'string') return false;
  if (typeof payload.query !== 'string' || (payload.mode !== 'semantic' && payload.mode !== 'boolean')) return false;
  if (!isFilterShape(payload.filters) || !Array.isArray(payload.results) || !isStringArray(payload.interpretation)) return false;
  const resolved = payload.resolvedSearch;
  if (!isRecord(resolved) || typeof resolved.query !== 'string' || !isFilterShape(resolved.filters)) return false;
  return typeof payload.createdAt === 'string' && typeof payload.updatedAt === 'string';
}

export type RestoreOutcome =
  | { ok: true; href: string; alreadyOpen: boolean }
  | { ok: false; reason: string };

/**
 * Put a project's research tab back into this browser's search tabs and
 * return the URL that opens it. Never drops another tab to make room: the
 * search page keeps at most MAX_RESEARCH_TABS, and the oldest would be cut.
 */
export function restoreResearchTab(item: Pick<UserResearchTabItem, 'payload'>): RestoreOutcome {
  const payload = item.payload;
  if (!isRestorableResearchTab(payload)) {
    return { ok: false, reason: 'This tab was saved without its full search (it was too large to keep whole), so it cannot be restored. Re-run its query instead.' };
  }
  const href = `/search?${buildResearchRouteParams(payload.query, payload.mode, payload.filters, payload.id).toString()}`;
  const sessions = loadResearchSessions();
  if (sessions.some(session => session.id === payload.id)) return { ok: true, href, alreadyOpen: true };
  if (sessions.length >= MAX_RESEARCH_TABS) {
    return { ok: false, reason: `The search page already has ${MAX_RESEARCH_TABS} tabs open. Close one there, then restore this tab.` };
  }
  saveResearchSessions([...sessions, payload]);
  return { ok: true, href, alreadyOpen: false };
}

/** Re-run URL for a tab whose full session was not kept. */
export function researchTabRerunHref(item: Pick<UserResearchTabItem, 'payload'>): string | null {
  const payload = item.payload as Record<string, unknown>;
  if (typeof payload.query !== 'string' || !payload.query.trim()) return null;
  return savedSearchHref({
    query: payload.query,
    mode: payload.mode === 'boolean' ? 'boolean' : 'semantic',
    filters: payload.filters,
  }).href;
}

// ── Memo ─────────────────────────────────────────────────────────────────────

export const CART_MEMO_TAG = 'cart';

/** A memo item's payload as a citation, when it has the fields the export needs. */
export function memoItemCitation(item: Pick<UserMemoItem, 'itemKind' | 'payload'>): MemoCitation | null {
  if (item.itemKind !== 'citation' || !isRecord(item.payload)) return null;
  const payload = item.payload;
  if (typeof payload.id !== 'string' || typeof payload.cik !== 'string' || typeof payload.accessionNumber !== 'string') return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    ...(payload as unknown as MemoCitation),
    kind: payload.kind === 'letter' ? 'letter' : 'filing',
    company: text(payload.company),
    form: text(payload.form),
    fileDate: text(payload.fileDate),
    excerpt: text(payload.excerpt),
    sourceUrl: text(payload.sourceUrl),
    note: text(payload.note),
    addedAt: text(payload.addedAt),
  };
}

export function memoItemTags(item: Pick<UserMemoItem, 'payload'>): string[] {
  const tags = isRecord(item.payload) ? item.payload.tags : null;
  return isStringArray(tags) ? tags : [];
}

/** Citations in tray order (by addedAt), skipping payloads without a filing identity. */
export function projectCitations(items: Array<Pick<UserMemoItem, 'itemKind' | 'payload'>>): MemoCitation[] {
  return items
    .map(memoItemCitation)
    .filter((citation): citation is MemoCitation => citation !== null)
    .sort((a, b) => (Date.parse(a.addedAt) || 0) - (Date.parse(b.addedAt) || 0));
}

export interface CartSavePlan {
  items: UserMemoItem[];
  /** Filings already saved as memo items (anywhere in the account): never overwritten. */
  alreadySaved: CartFiling[];
}

/**
 * Cart filings as memo citations tagged `cart`, filed under `projectId`. A
 * filing whose citation key already exists in the account's memo is left
 * alone — overwriting would discard its excerpt and note, and would move it.
 */
export function planCartSave(
  cart: readonly CartFiling[],
  projectId: string,
  existingMemoKeys: ReadonlySet<string>,
  now: Date = new Date(),
): CartSavePlan {
  const items: UserMemoItem[] = [];
  const alreadySaved: CartFiling[] = [];
  for (const filing of cart) {
    const id = citationId(filing.cik, filing.accessionNumber);
    if (existingMemoKeys.has(id)) {
      alreadySaved.push(filing);
      continue;
    }
    const citation: MemoCitation & { tags: string[]; cartOrigin: string } = {
      id,
      kind: 'filing',
      cik: filing.cik,
      accessionNumber: filing.accessionNumber,
      company: filing.company,
      form: filing.form,
      fileDate: filing.fileDate,
      excerpt: filing.description || '',
      sourceUrl: filing.sourceUrl,
      note: '',
      addedAt: now.toISOString(),
      tags: [CART_MEMO_TAG],
      cartOrigin: filing.origin,
    };
    items.push({ ...citationToItem(citation), projectId });
  }
  return { items, alreadySaved };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type WriteOutcome = { ok: true } | { ok: false; error: string };

/**
 * Structural writes (move, archive, save cart) go straight to the route. The
 * open page's sync engine still remembers each object's previous project
 * and the tray does not know the new memo items, so after one the caller
 * reloads the page and the engine re-hydrates from the account. They are
 * refused while local changes are queued, so a reload never races a write.
 */
export function structuralWriteBlocker(): string | null {
  const status = getUserDataStatus();
  if (status.mode !== 'server') return 'This needs account storage, which is not connected right now.';
  if (status.pendingWrites > 0) return 'Waiting for your latest changes to reach your account; try again in a moment.';
  return null;
}

export async function moveToProject<K extends WorkspaceKind>(kind: K, item: Listed<K>, targetProjectId: string): Promise<WriteOutcome> {
  const blocker = structuralWriteBlocker();
  if (blocker) return { ok: false, error: blocker };
  const result = await putUserData(kind, [{ ...item, projectId: targetProjectId } as UserDataItemMap[K]]);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function setProjectArchived(project: Listed<'projects'>, archived: boolean, now: Date = new Date()): Promise<WriteOutcome> {
  if (isPersonalProject(project)) return { ok: false, error: 'The personal project is where new research is filed by default and cannot be archived.' };
  const blocker = structuralWriteBlocker();
  if (blocker) return { ok: false, error: blocker };
  const result = await putUserData('projects', [{ ...project, archivedAt: archived ? now.toISOString() : null }]);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function saveCartToProject(items: UserMemoItem[]): Promise<WriteOutcome> {
  if (items.length === 0) return { ok: true };
  const blocker = structuralWriteBlocker();
  if (blocker) return { ok: false, error: blocker };
  const result = await putUserData('memo', items);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'not recorded';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return 'not recorded';
  return new Date(time).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
