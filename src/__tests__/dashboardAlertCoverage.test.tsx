import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SavedAlert } from '../context/AppState';
import type { SearchCandidateCoverage } from '../services/secApi';
import { resetAlertHitsForTests, setAlertHitsFetchForTests } from '../services/alertHits';
import { setActiveBrowserStorageScope } from '../services/storageNamespace';
import { prepareUserDataScope, resetUserDataForTests } from '../services/userData';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  updateSavedAlert: vi.fn(),
  removeSavedAlert: vi.fn(),
  addSavedAlert: vi.fn(),
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
    addSavedAlert: mocks.addSavedAlert,
  }),
}));

// The Dashboard must never run alert searches itself any more.
vi.mock('../services/filingResearch', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/filingResearch')>();
  return { ...actual, executeFilingResearchSearch: (...args: unknown[]) => mocks.executeSearch(...args) };
});

vi.mock('../services/secApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/secApi')>();
  return { ...actual, lookupCIK: vi.fn(), fetchCompanySubmissions: vi.fn() };
});

vi.mock('../components/filters/CompanySearchInput', () => ({
  default: () => null,
}));
vi.mock('../components/projects/ProjectSelector', () => ({
  default: () => null,
}));
vi.mock('../components/research/SearchJobsCard', () => ({
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

const serverCoverage = {
  ...coverage,
  source: 'server',
  reason: 'The check reached its per-check budget (documents, pages or 45 seconds) before every candidate was read; the unexamined part of the window is carried into the next check.',
  windowFrom: '2026-10-03',
  windowTo: '2026-10-04',
};

function alert(overrides: Partial<SavedAlert> = {}): SavedAlert {
  return {
    id: 'alert-1',
    name: 'Revenue or material weakness',
    query: 'revenue OR "material weakness"',
    mode: 'boolean',
    filters: {} as SavedAlert['filters'],
    defaultForms: '10-K',
    createdAt: '2026-08-03T12:00:00.000Z',
    lastCheckedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    lastSeenAccessions: ['0000320193-26-000001'],
    latestNewAccessions: [],
    latestResultCount: 4,
    engineVersion: 6,
    lastCheckCoverage: serverCoverage as unknown as SearchCandidateCoverage,
    cadence: 'daily',
    enabled: true,
    ...overrides,
  };
}

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };
let handler: Handler;
const calls: Array<{ url: string; init?: RequestInit }> = [];

describe('Dashboard Alert Center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAlertHitsForTests();
    resetUserDataForTests();
    // A signed-in account: the Alert Center reports server checks for it.
    setActiveBrowserStorageScope('user:user_1:org:personal');
    prepareUserDataScope('user:user_1:org:personal');
    calls.length = 0;
    mocks.savedAlerts = [alert()];
    handler = url => (url.startsWith('/api/user/alert-hits')
      ? { status: 200, body: { ok: true, total: 3, unseen: 3, unseenAmendments: 0, byAlert: { 'alert-1': 3 }, hits: [] } }
      : { status: 200, body: { ok: true, check: { outcome: 'checked', complete: true, newFilings: 2, storedHits: 2 } } });
    setAlertHitsFetchForTests(async (url, init) => {
      calls.push({ url, init });
      const { status, body } = handler(url, init);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  });
  afterEach(() => {
    resetAlertHitsForTests();
    resetUserDataForTests();
    setActiveBrowserStorageScope(null);
    vi.unstubAllGlobals();
  });

  it('reports when the alert was last checked, what is new since the user looked, and coverage', async () => {
    render(<Dashboard />);
    expect(screen.getByText(/Last checked/)).toHaveTextContent('Last checked 3 hours ago · daily');
    expect(await screen.findByText('new since you last looked')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('new since you last looked').parentElement).toHaveTextContent('3 new since you last looked'));
    expect(screen.getByText('coverage partial')).toBeInTheDocument();
    expect(screen.getByText('Partial coverage')).toBeVisible();
    expect(screen.getByText('Examined 17 of 10,000+ upstream candidates')).toBeVisible();
    expect(screen.getByText(/carried into the next check/)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Unfinished Boolean branches' })).toHaveTextContent('time limit reached · 5 examined · 3 pages');
    expect(screen.getByText(/Measured work: 26 upstream requests/)).toHaveTextContent(
      'pages 5/60 · document attempts 19/120 · documents hydrated 17 · pre-screen 2/20'
    );
  });

  it('never runs alert searches in the browser', async () => {
    mocks.savedAlerts = [alert({ lastCheckedAt: undefined }), alert({ id: 'alert-2', lastCheckedAt: undefined })];
    render(<Dashboard />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(mocks.executeSearch).not.toHaveBeenCalled();
    expect(mocks.updateSavedAlert).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Check Now/ })).toBeNull();
  });

  it('Run now asks the server to check the alert', async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Run now/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Run now/ })); });
    const run = calls.find(call => call.url === '/api/alerts/evaluate');
    expect(run?.init?.method).toBe('POST');
    expect(JSON.parse(String(run?.init?.body))).toEqual({ alertKey: 'alert-1' });
    expect(await screen.findByText('Checked: 2 new filings.')).toBeInTheDocument();
    expect(mocks.executeSearch).not.toHaveBeenCalled();
  });

  it('says the alert lives only in this browser when background checks are unavailable', async () => {
    handler = () => ({ status: 503, body: { ok: false, errorClass: 'unavailable', error: 'not provisioned' } });
    render(<Dashboard />);
    expect(await screen.findByText(/Background checks are not available in this environment/)).toBeInTheDocument();
    // No unread count is claimed where nothing checks the alert.
    expect(screen.queryByText('new since you last looked')).toBeNull();
    // Run now stays reachable and explains itself rather than asking a server that cannot answer.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Run now/ })); });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Not checked: background checks are not available in this environment. The counts shown are from before and were not changed.'
    );
    expect(calls.some(call => call.url === '/api/alerts/evaluate')).toBe(false);
    expect(mocks.updateSavedAlert).not.toHaveBeenCalled();
    expect(mocks.executeSearch).not.toHaveBeenCalled();
    expect(screen.getByText('4 matched in the last check window')).toBeInTheDocument();
  });

  it('reports a 503 from Run now as unavailable, never as a check, and keeps prior evidence', async () => {
    handler = url => (url.startsWith('/api/user/alert-hits')
      ? { status: 200, body: { ok: true, total: 0, unseen: 0, unseenAmendments: 0, byAlert: {}, hits: [] } }
      : { status: 503, body: { ok: false, error: 'Scheduled alert checks are not configured for this deployment.' } });
    render(<Dashboard />);
    await waitFor(() => expect(calls.some(call => call.url.startsWith('/api/user/alert-hits'))).toBe(true));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Run now/ })); });
    expect(calls.filter(call => call.url === '/api/alerts/evaluate')).toHaveLength(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(/background checks are not available in this environment/);
    expect(screen.queryByText(/^Checked:/)).toBeNull();
    expect(screen.getByText(/Last checked/)).toHaveTextContent('Last checked 3 hours ago · daily');
    expect(screen.getByText('4 matched in the last check window')).toBeInTheDocument();
    expect(mocks.updateSavedAlert).not.toHaveBeenCalled();
  });

  it('asks nothing of the server for a browser-only identity and says checks are unavailable here', async () => {
    resetUserDataForTests();
    setActiveBrowserStorageScope('signed-out');
    prepareUserDataScope('signed-out');
    render(<Dashboard />);
    expect(await screen.findByText(/Background checks are not available in this environment/)).toBeInTheDocument();
    expect(screen.getByText('This browser only')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Run now/ })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/^Not checked: background checks are not available in this environment/);
    expect(calls).toHaveLength(0);
    expect(mocks.updateSavedAlert).not.toHaveBeenCalled();
    expect(screen.getByText('4 matched in the last check window')).toBeInTheDocument();
  });

  it('shows a never-checked alert with the evidence it was saved with', async () => {
    mocks.savedAlerts = [alert({ lastCheckedAt: undefined, lastCheckCoverage: undefined, latestResultCount: 3, lastSeenAccessions: ['a', 'b', 'c'] })];
    render(<Dashboard />);
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument();
    expect(screen.getByText('3 filings in the results when saved (2026-08-03)')).toBeInTheDocument();
  });

  it('claims no save-time evidence for an alert made from a search that was never run', async () => {
    mocks.savedAlerts = [alert({ lastCheckedAt: undefined, lastCheckCoverage: undefined, latestResultCount: 0, lastSeenAccessions: [] })];
    render(<Dashboard />);
    expect(screen.queryByText(/in the results when saved/)).toBeNull();
  });
});
