import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SavedAlert } from '../context/AppState';
import type { SearchCandidateCoverage } from '../services/secApi';
import { BOOLEAN_ENGINE_VERSION } from '../utils/booleanSearch';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  updateSavedAlert: vi.fn(),
  removeSavedAlert: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
  executeSearch: vi.fn(),
  watchlist: [] as string[],
  savedAlerts: [] as SavedAlert[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('../context/AppState', () => ({
  useApp: () => ({
    watchlist: mocks.watchlist,
    addToWatchlist: mocks.addToWatchlist,
    removeFromWatchlist: mocks.removeFromWatchlist,
    savedAlerts: mocks.savedAlerts,
    updateSavedAlert: mocks.updateSavedAlert,
    removeSavedAlert: mocks.removeSavedAlert,
  }),
}));

vi.mock('../services/filingResearch', () => ({
  executeFilingResearchSearch: (...args: unknown[]) => mocks.executeSearch(...args),
}));

vi.mock('../services/secApi', () => ({
  lookupCIK: vi.fn(),
  fetchCompanySubmissions: vi.fn(),
}));

vi.mock('../components/filters/CompanySearchInput', () => ({
  default: () => null,
}));

import Dashboard from '../views/Dashboard';

const coverage: SearchCandidateCoverage = {
  complete: false,
  examined: 17,
  upstreamTotal: 10_000,
  upstreamTotalIsFloor: true,
  branches: [
    {
      branch: 'revenue',
      required: true,
      pages: 2,
      candidatesSurfaced: 14,
      candidatesNew: 12,
      examined: 12,
      matched: 4,
      exhausted: true,
      collectionComplete: true,
    },
    {
      branch: 'material weakness',
      required: true,
      pages: 3,
      candidatesSurfaced: 9,
      candidatesNew: 7,
      examined: 5,
      matched: 1,
      exhausted: false,
      collectionComplete: false,
      incompleteReason: 'deadline',
    },
  ],
  work: {
    pageRequests: 5,
    docFetches: 17,
    docHttpAttempts: 19,
    prescreenRequests: 2,
    totalUpstreamRequests: 26,
    ceiling: { pages: 60, docHttpAttempts: 120, prescreenRequests: 20 },
  },
};

function alertWithCoverage(lastCheckCoverage: SearchCandidateCoverage = coverage): SavedAlert {
  return {
    id: 'alert-1',
    name: 'Revenue or material weakness',
    query: 'revenue OR "material weakness"',
    mode: 'boolean',
    filters: {} as SavedAlert['filters'],
    defaultForms: '10-K',
    createdAt: '2026-08-03T12:00:00.000Z',
    lastCheckedAt: new Date().toISOString(),
    lastSeenAccessions: ['old-accession'],
    latestNewAccessions: [],
    latestResultCount: 4,
    engineVersion: 5,
    lastCheckCoverage,
  };
}

describe('Dashboard saved-alert coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.savedAlerts = [alertWithCoverage()];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  it('shows the check status, unfinished branch reason, and measured work', () => {
    render(<Dashboard />);

    expect(screen.getByText('Partial coverage')).toBeVisible();
    expect(screen.getByText('Examined 17 of 10,000+ upstream candidates')).toBeVisible();
    expect(screen.getByText('1/2 required branches complete')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Unfinished Boolean branches' })).toHaveTextContent('material weakness');
    expect(screen.getByRole('list', { name: 'Unfinished Boolean branches' })).toHaveTextContent('time limit reached · 5 examined · 3 pages');
    expect(screen.getByText(/Measured work: 26 upstream requests/)).toHaveTextContent(
      'pages 5/60 · document attempts 19/120 · documents hydrated 17 · pre-screen 2/20'
    );
  });

  it('stores the complete executor ledger when Check Now finishes', async () => {
    mocks.executeSearch.mockImplementation(async (options: { onCoverage: (value: SearchCandidateCoverage) => void }) => {
      options.onCoverage(coverage);
      return [{ accessionNumber: 'new-accession' }];
    });
    render(<Dashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));

    await waitFor(() => expect(mocks.updateSavedAlert).toHaveBeenCalledOnce());
    const [, update] = mocks.updateSavedAlert.mock.calls[0] as [string, Partial<SavedAlert>];
    expect(update.lastCheckCoverage).toEqual(coverage);
    expect(update.lastCheckCoverage).not.toBe(coverage);
    expect(update.lastCheckCoverage?.branches).not.toBe(coverage.branches);
    expect(update.lastCheckCoverage?.branches?.[1]).toMatchObject({
      branch: 'material weakness',
      exhausted: false,
      incompleteReason: 'deadline',
    });
    expect(update.lastCheckCoverage?.work).toEqual(coverage.work);
    expect(update.lastCheckCoverage?.work).not.toBe(coverage.work);
  });

  it('keeps a stale engine marker through a partial run and re-baselines on the next complete run', async () => {
    const staleAlert = alertWithCoverage();
    staleAlert.engineVersion = BOOLEAN_ENGINE_VERSION - 1;
    mocks.savedAlerts = [staleAlert];
    const partialResult = [{ accessionNumber: 'partial-accession' }];
    const completeCoverage: SearchCandidateCoverage = {
      ...coverage,
      complete: true,
      examined: 20,
      upstreamTotal: 20,
      upstreamTotalIsFloor: false,
      branches: coverage.branches?.map(branch => ({
        ...branch,
        exhausted: true,
        collectionComplete: true,
        incompleteReason: undefined,
      })),
    };
    mocks.executeSearch.mockImplementationOnce(async (
      options: { onCoverage: (value: SearchCandidateCoverage) => void }
    ) => {
      options.onCoverage(coverage);
      return partialResult;
    });
    const view = render(<Dashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));
    await waitFor(() => expect(mocks.updateSavedAlert).toHaveBeenCalledOnce());
    const [, partialUpdate] = mocks.updateSavedAlert.mock.calls[0] as [string, Partial<SavedAlert>];
    expect(partialUpdate).not.toHaveProperty('engineVersion');

    mocks.savedAlerts = [{ ...staleAlert, ...partialUpdate }];
    mocks.updateSavedAlert.mockReset();
    mocks.executeSearch.mockImplementationOnce(async (
      options: { onCoverage: (value: SearchCandidateCoverage) => void }
    ) => {
      options.onCoverage(completeCoverage);
      return [{ accessionNumber: 'complete-accession' }];
    });
    view.rerender(<Dashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));
    await waitFor(() => expect(mocks.updateSavedAlert).toHaveBeenCalledOnce());
    const [, completeUpdate] = mocks.updateSavedAlert.mock.calls[0] as [string, Partial<SavedAlert>];
    expect(completeUpdate.engineVersion).toBe(BOOLEAN_ENGINE_VERSION);
    expect(completeUpdate.latestNewAccessions).toEqual([]);
    expect(completeUpdate.lastSeenAccessions).toEqual(['complete-accession']);
  });

  it('preserves the prior baseline when a check returns no coverage evidence', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.executeSearch.mockResolvedValue([{ accessionNumber: 'unmeasured-accession' }]);
    render(<Dashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Existing counts were not replaced',
    );
    expect(mocks.updateSavedAlert).not.toHaveBeenCalled();
    expect(screen.getByText('Partial coverage')).toBeVisible();
    expect(screen.getByText('Examined 17 of 10,000+ upstream candidates')).toBeVisible();
    expect(consoleError).toHaveBeenCalledWith(
      'Alert check failed:',
      expect.objectContaining({ message: 'The saved search completed without coverage evidence.' }),
    );
  });
});
