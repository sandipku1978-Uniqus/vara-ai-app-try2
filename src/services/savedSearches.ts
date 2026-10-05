/**
 * Saved searches (urc_user_saved_searches, migration 026) — distinct from
 * saved alerts: a saved search is a bookmark of a research question to
 * re-run by hand; an alert is checked on the server and announces new hits.
 *
 * Storage follows the other research stores: the scoped local key that
 * userDataCodecs already defines for this kind (one array of wire items),
 * handed to syncUserCollection so a signed-in account keeps it on the server,
 * and re-read when the server copy hydrates.
 *
 * What a save records: the query, mode and filters (including form types),
 * the default form scope the search ran with, and — so the list can say what
 * the user saw when they saved it — the coverage headline at save time and
 * the number of rows shown. The 026 row has no columns for those, so they
 * ride in the filters object under one reserved key, `_saved`, which
 * savedSearchFilters() strips before the filters are used to search.
 */

import { useSyncExternalStore } from 'react';
import { cloneSearchFilters } from './researchSessions';
import { defaultSearchFilters, type SearchFilters } from '../domain/searchFilters';
import { SAVED_SEARCHES_STORAGE_KEY, type UserSavedSearchItem } from './userDataCodecs';
import { onUserDataHydrated, syncUserCollection } from './userData';
import { scopedStorageKey } from './storageNamespace';

export const SAVED_SEARCH_CONTEXT_KEY = '_saved';
export const MAX_SAVED_SEARCHES = 500;

export interface SavedSearchContext {
  defaultForms: string;
  /** The result headline the user saw when saving ("120 filings · complete coverage"). */
  coverageHeadline: string;
  /** Rows on screen at save time. */
  resultCount: number;
  savedAt: string;
}

export interface SavedSearch {
  clientKey: string;
  label: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters: SearchFilters;
  context: SavedSearchContext | null;
  createdAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The executable filters of a stored item, without the save-time context. */
export function savedSearchFilters(stored: Record<string, unknown>): SearchFilters {
  const rest: Record<string, unknown> = { ...stored };
  delete rest[SAVED_SEARCH_CONTEXT_KEY];
  const merged = { ...defaultSearchFilters, ...rest } as SearchFilters;
  return cloneSearchFilters({
    ...merged,
    formTypes: Array.isArray(merged.formTypes) ? merged.formTypes.filter(item => typeof item === 'string') : [],
    exchange: Array.isArray(merged.exchange) ? merged.exchange.filter(item => typeof item === 'string') : [],
    acceleratedStatus: Array.isArray(merged.acceleratedStatus) ? merged.acceleratedStatus.filter(item => typeof item === 'string') : [],
  });
}

export function parseSavedSearchContext(stored: Record<string, unknown>): SavedSearchContext | null {
  const raw = stored[SAVED_SEARCH_CONTEXT_KEY];
  if (!isRecord(raw)) return null;
  return {
    defaultForms: typeof raw.defaultForms === 'string' ? raw.defaultForms.slice(0, 400) : '',
    coverageHeadline: typeof raw.coverageHeadline === 'string' ? raw.coverageHeadline.slice(0, 300) : '',
    resultCount: Number.isSafeInteger(raw.resultCount) && Number(raw.resultCount) >= 0 ? Number(raw.resultCount) : 0,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
  };
}

export function itemToSavedSearch(item: UserSavedSearchItem): SavedSearch {
  const stored = isRecord(item.filters) ? item.filters : {};
  return {
    clientKey: item.clientKey,
    label: item.label,
    query: item.query,
    mode: item.mode === 'boolean' ? 'boolean' : 'semantic',
    filters: savedSearchFilters(stored),
    context: parseSavedSearchContext(stored),
    createdAt: item.createdAt || null,
  };
}

export interface SaveSearchInput {
  label: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters: SearchFilters;
  defaultForms: string;
  coverageHeadline: string;
  resultCount: number;
}

/** The wire item for a new saved search. Pure; exported for tests. */
export function buildSavedSearchItem(input: SaveSearchInput, now: Date, clientKey: string): UserSavedSearchItem {
  const context: SavedSearchContext = {
    defaultForms: input.defaultForms.slice(0, 400),
    coverageHeadline: input.coverageHeadline.slice(0, 300),
    resultCount: Math.max(0, Math.floor(input.resultCount)),
    savedAt: now.toISOString(),
  };
  return {
    clientKey,
    label: (input.label.trim() || input.query.trim() || 'Saved search').slice(0, 200),
    query: input.query.slice(0, 4000),
    mode: input.mode,
    filters: { ...cloneSearchFilters(input.filters), [SAVED_SEARCH_CONTEXT_KEY]: context } as unknown as Record<string, unknown>,
    createdAt: now.toISOString(),
    position: 0,
  };
}

/** Same search (query, mode, filters, forms) — the save is idempotent on these. */
export function sameSavedSearch(a: Pick<SavedSearch, 'query' | 'mode' | 'filters' | 'context'>, b: Pick<SavedSearch, 'query' | 'mode' | 'filters' | 'context'>): boolean {
  return a.query.trim() === b.query.trim()
    && a.mode === b.mode
    && JSON.stringify(a.filters) === JSON.stringify(b.filters)
    && (a.context?.defaultForms || '') === (b.context?.defaultForms || '');
}

// ── Store ────────────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let cache: { key: string | null; items: UserSavedSearchItem[] } | null = null;
const EMPTY: SavedSearch[] = [];
let snapshot: { source: UserSavedSearchItem[] | null; value: SavedSearch[] } = { source: null, value: EMPTY };

function storageKey(): string | null {
  return scopedStorageKey(SAVED_SEARCHES_STORAGE_KEY);
}

function readItems(): UserSavedSearchItem[] {
  if (typeof window === 'undefined') return [];
  const key = storageKey();
  if (cache && cache.key === key) return cache.items;
  let items: UserSavedSearchItem[] = [];
  if (key) {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) as unknown : [];
      items = Array.isArray(parsed)
        ? parsed.filter((item): item is UserSavedSearchItem => isRecord(item) && typeof item.clientKey === 'string')
        : [];
    } catch {
      items = [];
    }
  }
  cache = { key, items };
  return items;
}

function writeItems(items: UserSavedSearchItem[]): void {
  const key = storageKey();
  cache = { key, items };
  if (key && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // Quota/private mode: the list stays in memory for this page.
    }
    // Signed in: queue the change for the account copy (no-op signed out).
    syncUserCollection('saved-searches', items);
  }
  listeners.forEach(listener => listener());
}

if (typeof window !== 'undefined') {
  onUserDataHydrated('saved-searches', () => {
    cache = null;
    listeners.forEach(listener => listener());
  });
}

export function listSavedSearches(): SavedSearch[] {
  const items = readItems();
  if (snapshot.source !== items) {
    snapshot = {
      source: items,
      value: [...items]
        .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
        .map(itemToSavedSearch),
    };
  }
  return snapshot.value;
}

/** Save (or refresh the label/context of) a search. Returns the saved search, or null when nothing can be stored. */
export function saveSearch(input: SaveSearchInput, now: Date = new Date()): { saved: SavedSearch; duplicate: boolean } | null {
  if (!storageKey()) return null;
  const items = readItems();
  const clientKey = `search-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const item = buildSavedSearchItem(input, now, clientKey);
  const candidate = itemToSavedSearch(item);
  const existing = items.find(stored => sameSavedSearch(itemToSavedSearch(stored), candidate));
  if (existing) {
    const updated = { ...existing, label: item.label, filters: item.filters };
    writeItems(items.map(stored => (stored.clientKey === existing.clientKey ? updated : stored)));
    return { saved: itemToSavedSearch(updated), duplicate: true };
  }
  writeItems([item, ...items].slice(0, MAX_SAVED_SEARCHES));
  return { saved: candidate, duplicate: false };
}

export function deleteSavedSearch(clientKey: string): void {
  const items = readItems();
  writeItems(items.filter(item => item.clientKey !== clientKey));
}

export function subscribeSavedSearches(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSavedSearches(): SavedSearch[] {
  return useSyncExternalStore(subscribeSavedSearches, listSavedSearches, () => EMPTY);
}

export function resetSavedSearchesForTests(): void {
  cache = null;
  snapshot = { source: null, value: EMPTY };
  listeners.clear();
}
