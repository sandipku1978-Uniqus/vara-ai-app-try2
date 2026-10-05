import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  addSavedAlert: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('../context/AppState', () => ({
  useApp: () => ({ addSavedAlert: mocks.addSavedAlert, savedAlerts: [] }),
}));

import { SavedSearchesList, savedSearchRoute } from '../components/alerts/SavedSearchesList';
import {
  SAVED_SEARCH_CONTEXT_KEY,
  buildSavedSearchItem,
  itemToSavedSearch,
  listSavedSearches,
  resetSavedSearchesForTests,
  saveSearch,
} from '../services/savedSearches';
import { parseResearchRouteParams } from '../services/researchSessions';
import { setActiveBrowserStorageScope, scopedStorageKey } from '../services/storageNamespace';
import { SAVED_SEARCHES_STORAGE_KEY } from '../services/userDataCodecs';
import { defaultSearchFilters } from '../domain/searchFilters';

const FILTERS = { ...defaultSearchFilters, formTypes: ['10-K', '10-Q'], entityName: 'Apple Inc.', dateFrom: '2024-01-01' };
const INPUT = {
  label: 'Material weakness at Apple',
  query: '"material weakness"',
  mode: 'boolean' as const,
  filters: FILTERS,
  defaultForms: '10-K,10-K/A',
  coverageHeadline: '12 filings · complete coverage',
  resultCount: 12,
};

beforeEach(() => {
  window.localStorage.clear();
  setActiveBrowserStorageScope('signed-out');
  resetSavedSearchesForTests();
  mocks.push.mockReset();
  mocks.addSavedAlert.mockReset();
});
afterEach(() => setActiveBrowserStorageScope(null));

describe('saved search records', () => {
  it('records query, mode, filters, forms and the coverage headline at save time', () => {
    const item = buildSavedSearchItem(INPUT, new Date('2026-10-04T12:00:00.000Z'), 'search-1');
    expect(item).toMatchObject({ clientKey: 'search-1', label: INPUT.label, query: INPUT.query, mode: 'boolean' });
    expect(item.filters[SAVED_SEARCH_CONTEXT_KEY]).toEqual({
      defaultForms: '10-K,10-K/A',
      coverageHeadline: '12 filings · complete coverage',
      resultCount: 12,
      savedAt: '2026-10-04T12:00:00.000Z',
    });
    const saved = itemToSavedSearch(item);
    // The save-time context never leaks into the executable filters.
    expect(saved.filters).toEqual(FILTERS);
    expect(saved.filters).not.toHaveProperty(SAVED_SEARCH_CONTEXT_KEY);
    expect(saved.context?.coverageHeadline).toBe('12 filings · complete coverage');
  });

  it('persists under the scoped key and saves the same search once', () => {
    const first = saveSearch(INPUT, new Date('2026-10-04T12:00:00.000Z'));
    expect(first?.duplicate).toBe(false);
    const again = saveSearch({ ...INPUT, label: 'Renamed', coverageHeadline: '14 filings · partial coverage' }, new Date('2026-10-05T12:00:00.000Z'));
    expect(again?.duplicate).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem(scopedStorageKey(SAVED_SEARCHES_STORAGE_KEY)!)!);
    expect(stored).toHaveLength(1);
    expect(listSavedSearches()[0]).toMatchObject({ label: 'Renamed', context: { coverageHeadline: '14 filings · partial coverage' } });
  });

  it('does not save before the browser storage scope is known', () => {
    setActiveBrowserStorageScope(null);
    resetSavedSearchesForTests();
    expect(saveSearch(INPUT)).toBeNull();
  });
});

describe('SavedSearchesList', () => {
  it('re-runs a saved search with exactly its query, mode and filters', () => {
    saveSearch(INPUT);
    render(<SavedSearchesList />);
    expect(screen.getByText(/When saved .*12 filings · complete coverage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Re-run saved search ${INPUT.label}` }));
    const route = mocks.push.mock.calls[0][0] as string;
    expect(route).toBe(savedSearchRoute(listSavedSearches()[0]));
    const parsed = parseResearchRouteParams(new URLSearchParams(route.split('?')[1]));
    expect(parsed).toMatchObject({ query: INPUT.query, mode: 'boolean' });
    expect(parsed?.filters.formTypes).toEqual(['10-K', '10-Q']);
    expect(parsed?.filters.entityName).toBe('Apple Inc.');
    expect(parsed?.filters.dateFrom).toBe('2024-01-01');
  });

  it('converts a saved search to a daily alert and deletes one', () => {
    saveSearch(INPUT);
    render(<SavedSearchesList />);
    fireEvent.click(screen.getByRole('button', { name: `Convert saved search ${INPUT.label} to an alert` }));
    expect(mocks.addSavedAlert).toHaveBeenCalledWith({
      name: INPUT.label,
      query: INPUT.query,
      mode: 'boolean',
      filters: FILTERS,
      defaultForms: '10-K,10-K/A',
      cadence: 'daily',
      enabled: true,
    });
    fireEvent.click(screen.getByRole('button', { name: `Delete saved search ${INPUT.label}` }));
    expect(listSavedSearches()).toEqual([]);
    expect(screen.getByText(/No saved searches yet/)).toBeInTheDocument();
  });
});
