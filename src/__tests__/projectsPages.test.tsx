/**
 * /projects and /projects/[id] against an in-memory account: every read and
 * write goes through the real userData.ts client and is answered at the
 * fetch boundary (/api/user/*, /api/search-jobs, /api/version).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const app = vi.hoisted(() => ({ setPendingCompareIntent: vi.fn() }));
const exports = vi.hoisted(() => ({ exportMemoDocx: vi.fn<(input: unknown) => Promise<void>>(async () => undefined) }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('../context/AppState', () => ({ useApp: () => app }));
vi.mock('../services/memoExport', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/memoExport')>()),
  exportMemoDocx: exports.exportMemoDocx,
}));

import ProjectsIndex from '../views/ProjectsIndex';
import ProjectsWorkspace from '../views/ProjectsWorkspace';
import { pageReload } from '../components/projects/pageReload';
import { addToDocumentCart, clearDocumentCart } from '../services/documentCart';
import { loadResearchSessions } from '../services/researchSessions';
import { buildStorageScope, setActiveBrowserStorageScope } from '../services/storageNamespace';
import { getUserDataStatus, resetUserDataForTests, startUserDataSync } from '../services/userData';
import { SEARCH_JOB_ENGINE_VERSION } from '../services/searchJobs';
import { defaultSearchFilters } from '../domain/searchFilters';

const PERSONAL_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const SCOPE = buildStorageScope('user_alice', null);

const TAB_SESSION = {
  id: 'research-1', title: 'CODM tab', query: 'CODM', mode: 'semantic', filters: { ...defaultSearchFilters },
  results: [], isRefining: false, searched: true, errorMsg: '', interpretation: [],
  resolvedSearch: { query: 'CODM', mode: 'semantic', filters: { ...defaultSearchFilters } },
  selectedResultId: null, createdAt: '2026-09-06T10:00:00.000Z', updatedAt: '2026-09-06T10:05:00.000Z',
};

function initialRows(): Record<string, Array<Record<string, unknown>>> {
  return {
    projects: [
      { id: PERSONAL_ID, clientKey: 'personal', name: 'Personal research', question: '', position: 0, archivedAt: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: PROJECT_ID, clientKey: 'project-a', name: 'Segments', question: 'How do peers disclose segment expenses?', position: 1, archivedAt: null, createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-01T09:00:00.000Z' },
      { id: OTHER_ID, clientKey: 'project-b', name: 'Leases', question: '', position: 2, archivedAt: null, createdAt: '2026-09-02T09:00:00.000Z', updatedAt: '2026-09-02T09:00:00.000Z' },
    ],
    'saved-searches': [
      { id: '44444444-4444-4444-8444-444444444444', clientKey: 'ss-1', projectId: PROJECT_ID, label: 'Segment expense', query: '"segment expenses"', mode: 'boolean', filters: { formTypes: ['10-K'] }, position: 0, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' },
      { id: '55555555-5555-4555-8555-555555555555', clientKey: 'ss-2', projectId: OTHER_ID, label: 'Lease search', query: 'lease', mode: 'semantic', filters: {}, position: 0, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' },
    ],
    alerts: [{
      clientKey: 'alert-1', projectId: PROJECT_ID, savedSearchId: null, name: 'New segment disclosures', query: 'segment', mode: 'semantic', filters: {},
      defaultForms: '10-K', cadence: 'weekly', enabled: true, lastCheckedAt: '2026-10-01T08:00:00.000Z', lastHitCount: 12,
      lastSeenAccessions: [], latestNewAccessions: ['0000001-26-000002', '0000001-26-000003'], engineVersion: 3,
      lastCheckCoverage: { examined: 40, upstreamTotal: 120, complete: false }, position: 0, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
    }],
    'peer-sets': [{ clientKey: 'big tech', projectId: PROJECT_ID, name: 'Big tech', tickers: ['AAPL', 'MSFT'], ciks: [], asOf: '2026-09-07T00:00:00.000Z', position: 0, createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z' }],
    memo: [
      {
        clientKey: '320193:0000320193-26-000001', projectId: PROJECT_ID, itemKind: 'citation', accession: '0000320193-26-000001', cik: '320193', position: 0,
        payload: { id: '320193:0000320193-26-000001', kind: 'filing', cik: '320193', accessionNumber: '0000320193-26-000001', company: 'Apple Inc.', form: '10-K', fileDate: '2026-01-30', excerpt: 'Segment expenses are presented by segment.', sourceUrl: 'https://www.sec.gov/apple', note: 'Model disclosure', addedAt: '2026-09-03T10:00:00.000Z' },
        createdAt: '2026-09-03T10:00:00.000Z', updatedAt: '2026-09-03T10:00:00.000Z',
      },
      { clientKey: 'draft', projectId: PROJECT_ID, itemKind: 'draft', accession: null, cik: null, position: 0, payload: { text: '# Segments\n\nApple presents [1].', generatedAt: '2026-09-04T10:00:00.000Z', citationIds: ['320193:0000320193-26-000001'] }, updatedAt: '2026-09-04T10:00:00.000Z' },
    ],
    annotations: [{ clientKey: '320193_0000320193-26-000001_aapl.htm#n1', projectId: PROJECT_ID, filingKey: '320193_0000320193-26-000001_aapl.htm', accession: '0000320193-26-000001', anchor: { quote: 'chief operating decision maker', section: 'Note 13' }, note: 'CODM is the CEO', position: 0, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' }],
    'research-tabs': [{ clientKey: 'research-1', projectId: PROJECT_ID, title: 'CODM tab', payload: TAB_SESSION, position: 0, updatedAt: '2026-09-06T10:05:00.000Z' }],
    watchlist: [],
    checklists: [],
  };
}

const JOB = {
  id: 'job-1', status: 'running', statusReason: null,
  plan: {
    engineVersion: SEARCH_JOB_ENGINE_VERSION, pinnedDateTo: '2026-10-01', lanes: ['lane-a'], requiredBranches: 1,
    input: { query: 'segment w/5 expenses', mode: 'boolean', filters: {}, defaultForms: '10-K', includeExhibits: false, hydrateTextSignals: false },
  },
  examined: 200, verified: 14, upstreamTotal: 900, upstreamTotalIsFloor: false, coverage: null, waves: 3, leased: false,
  lastWaveAt: '2026-10-03T00:00:00.000Z', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', expiresAt: '2026-10-05T00:00:00.000Z',
};

function accountServer(options: { unavailableKinds?: string[] } = {}) {
  // Applied after connect(): the engine's own bootstrap must succeed first.
  const failing = new Set<string>();
  const rows = initialRows();
  const puts: Array<{ kind: string; items: Array<Record<string, unknown>> }> = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.startsWith('/api/search-jobs')) return Response.json({ ok: true, jobs: [JOB] });
    if (input === '/api/version') return Response.json({ sha: 'abc1234', ref: 'main', deploymentId: null, environment: 'test' });
    const kind = input.replace('/api/user/', '');
    if (failing.has(kind)) {
      return Response.json({ ok: false, errorClass: 'unavailable', error: 'not provisioned' }, { status: 503 });
    }
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { items: Array<Record<string, unknown>> };
      puts.push({ kind, items: body.items });
      return Response.json({ ok: true, items: body.items.map(item => ({ clientKey: item.clientKey, id: item.id ?? 'x', updatedAt: 'u' })) });
    }
    return Response.json({ ok: true, items: rows[kind] || [] });
  });
  return { fetch, puts, failAfterConnect: () => options.unavailableKinds?.forEach(kind => failing.add(kind)) };
}

async function connect(server: ReturnType<typeof accountServer>) {
  window.localStorage.setItem(`urc.identity.${encodeURIComponent(SCOPE)}.urc.userdata.migrated.v1`, 'earlier');
  setActiveBrowserStorageScope(SCOPE);
  vi.stubGlobal('fetch', server.fetch);
  startUserDataSync(SCOPE, { fetch: server.fetch as never });
  await waitFor(() => expect(getUserDataStatus().mode).toBe('server'));
  server.failAfterConnect();
}

let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetUserDataForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
  navigation.push.mockReset();
  app.setPendingCompareIntent.mockReset();
  exports.exportMemoDocx.mockClear();
  reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => undefined);
});

afterEach(() => {
  clearDocumentCart();
  resetUserDataForTests();
  setActiveBrowserStorageScope(null);
  vi.unstubAllGlobals();
  reload.mockRestore();
});

describe('/projects list page', () => {
  it('lists each project with its question, per-kind counts, last activity and archive', async () => {
    const server = accountServer();
    await connect(server);
    render(<ProjectsIndex />);

    const table = await screen.findByRole('table', { name: /number of saved objects/ });
    const segments = within(table).getByRole('row', { name: /Segments/ });
    await waitFor(() => expect(within(segments).getAllByRole('cell').map(cell => cell.textContent).slice(0, 6)).toEqual(['1', '1', '1', '2', '1', '1']));
    expect(within(segments).getByText('How do peers disclose segment expenses?')).toBeInTheDocument();
    expect(within(segments).getByRole('link', { name: 'Segments' })).toHaveAttribute('href', `/projects/${PROJECT_ID}`);
    expect(within(segments).getByText('2026-10-01 08:00 UTC')).toBeInTheDocument();
    expect(within(within(table).getByRole('row', { name: /Personal research/ })).getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Account-synced')).toBeInTheDocument();

    await userEvent.click(within(segments).getByRole('button', { name: 'Archive Segments' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    const put = server.puts.find(entry => entry.kind === 'projects');
    expect(put?.items[0]).toEqual(expect.objectContaining({ id: PROJECT_ID, clientKey: 'project-a', name: 'Segments', archivedAt: expect.any(String) }));
  });

  it('shows no count rather than a zero for a kind that could not be read', async () => {
    const server = accountServer();
    await connect(server);
    server.fetch.mockImplementation(async (input: string) => (
      input === '/api/user/alerts'
        ? Response.json({ ok: false, errorClass: 'unavailable', error: 'off' }, { status: 503 })
        : Response.json({ ok: true, items: initialRows()[input.replace('/api/user/', '')] || [] })
    ));
    render(<ProjectsIndex />);
    expect(await screen.findByText(/Could not read alerts; their counts show “—”, not zero/)).toBeInTheDocument();
    const segments = within(screen.getByRole('table')).getByRole('row', { name: /Segments/ });
    expect(within(segments).getAllByRole('cell')[1]).toHaveTextContent('—');
  });

  it('says projects need an account when signed out', () => {
    setActiveBrowserStorageScope('signed-out');
    startUserDataSync('signed-out');
    render(<ProjectsIndex />);
    return waitFor(() => expect(screen.getByText(/Projects belong to a signed-in account/)).toBeInTheDocument());
  });
});

describe('/projects/[id] workspace', () => {
  it('renders the header and every section scoped to the project, each with its source and storage', async () => {
    const server = accountServer();
    await connect(server);
    render(<ProjectsWorkspace projectId={PROJECT_ID} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Segments' })).toBeInTheDocument();
    expect(screen.getByText('How do peers disclose segment expenses?')).toBeInTheDocument();
    expect(screen.getByText('Created 2026-09-01 09:00 UTC')).toBeInTheDocument();
    expect(screen.getByText(/Owner: your account/)).toBeInTheDocument();
    expect(screen.getByLabelText('Switch project')).toHaveValue(PROJECT_ID);

    const section = (name: string) => screen.getByRole('region', { name });

    const saved = section('Saved searches');
    expect(within(saved).getByText('Source: GET /api/user/saved-searches')).toBeInTheDocument();
    expect(within(saved).getByText('Account-synced')).toBeInTheDocument();
    const rerun = await within(saved).findByRole('link', { name: 'Re-run' });
    expect(rerun.getAttribute('href')).toContain('/search?v=1&q=%22segment+expenses%22&mode=boolean&forms=10-K');
    expect(within(saved).queryByText('Lease search')).not.toBeInTheDocument();

    const alerts = section('Alerts');
    expect(await within(alerts).findByText(/Enabled · weekly · last checked 2026-10-01 08:00 UTC · 12 results · 2 new since the check before · partial candidate coverage/)).toBeInTheDocument();
    expect(within(alerts).getByRole('link', { name: 'Alert Center on the Dashboard' })).toHaveAttribute('href', '/dashboard');

    const peers = section('Peer sets');
    await userEvent.click(await within(peers).findByRole('button', { name: 'Open in Benchmarking' }));
    expect(app.setPendingCompareIntent).toHaveBeenCalledWith(expect.objectContaining({ tickers: ['AAPL', 'MSFT'] }));
    expect(navigation.push).toHaveBeenCalledWith('/compare');

    const memo = section('Memo');
    expect(await within(memo).findByText('Apple Inc. 10-K 2026-01-30')).toBeInTheDocument();
    expect(within(memo).getByText(/AI draft — generated 2026-09-04 10:00 UTC from 1 citation/)).toBeInTheDocument();
    await userEvent.click(within(memo).getByRole('button', { name: 'Export Word' }));
    await waitFor(() => expect(exports.exportMemoDocx).toHaveBeenCalledTimes(1));
    expect(exports.exportMemoDocx.mock.calls[0][0]).toEqual(expect.objectContaining({
      title: 'Segments',
      question: 'How do peers disclose segment expenses?',
      citations: [expect.objectContaining({ accessionNumber: '0000320193-26-000001' })],
      draft: expect.objectContaining({ citationIds: ['320193:0000320193-26-000001'] }),
      draftIsStale: false,
      evidencePackage: expect.objectContaining({ appVersion: expect.objectContaining({ sha: 'abc1234' }) }),
    }));

    const annotations = section('Annotations');
    expect(await within(annotations).findByText(/CODM is the CEO/)).toBeInTheDocument();
    expect(within(annotations).getByRole('link', { name: 'Open in viewer' })).toHaveAttribute('href', '/filing/320193_0000320193-26-000001_aapl.htm');

    const tabs = section('Research tabs');
    await userEvent.click(await within(tabs).findByRole('button', { name: 'Restore into search' }));
    expect(loadResearchSessions().map(session => session.id)).toEqual(['research-1']);
    expect(navigation.push).toHaveBeenLastCalledWith(expect.stringContaining('tab=research-1'));

    const jobs = section('Continuation jobs');
    expect(within(jobs).getByText('Server job records for your account')).toBeInTheDocument();
    expect(await within(jobs).findByText(/Job records do not name a project/)).toBeInTheDocument();
    expect(within(jobs).getByRole('link', { name: 'Open results' })).toHaveAttribute('href', '/search?searchJob=job-1');

    const cart = section('Document cart');
    expect(within(cart).getByText('Browser-only (this browser session)')).toBeInTheDocument();
    expect(within(cart).getByText(/The document cart is empty/)).toBeInTheDocument();
  });

  it('shows unfiled objects under the personal project and nothing from other projects', async () => {
    const server = accountServer();
    await connect(server);
    server.fetch.mockImplementation(async (input: string) => {
      const rows = initialRows();
      rows['peer-sets'] = [{ ...rows['peer-sets'][0], projectId: null }];
      return Response.json({ ok: true, items: rows[input.replace('/api/user/', '')] || [] });
    });
    render(<ProjectsWorkspace projectId={PERSONAL_ID} />);
    const peers = await screen.findByRole('region', { name: 'Peer sets' });
    expect(await within(peers).findByText('Big tech')).toBeInTheDocument();
    expect(within(peers).getByText('Unfiled')).toBeInTheDocument();
    expect(await within(screen.getByRole('region', { name: 'Memo' })).findByText('No memo items are filed under this project.')).toBeInTheDocument();
  });

  it('moves an object to another project with a PUT naming the new project, then reloads', async () => {
    const server = accountServer();
    await connect(server);
    render(<ProjectsWorkspace projectId={PROJECT_ID} />);
    const peers = await screen.findByRole('region', { name: 'Peer sets' });
    await userEvent.selectOptions(await within(peers).findByLabelText('Move Big tech to project'), OTHER_ID);
    await userEvent.click(within(peers).getByRole('button', { name: 'Move Big tech' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(server.puts).toEqual([{ kind: 'peer-sets', items: [expect.objectContaining({ clientKey: 'big tech', name: 'Big tech', tickers: ['AAPL', 'MSFT'], projectId: OTHER_ID })] }]);
  });

  it('saves the session cart into the project memo as citations tagged cart, skipping filings already in the memo', async () => {
    const server = accountServer();
    await connect(server);
    addToDocumentCart({ cik: '320193', accessionNumber: '0000320193-26-000001', company: 'Apple Inc.', form: '10-K', fileDate: '2026-01-30', sourceUrl: 'https://www.sec.gov/apple', origin: 'search' });
    addToDocumentCart({ cik: '789019', accessionNumber: '0000789019-26-000003', company: 'Microsoft', form: '10-K', fileDate: '2026-02-01', sourceUrl: 'https://www.sec.gov/msft', origin: 'search', description: 'Segment note' });
    render(<ProjectsWorkspace projectId={PROJECT_ID} />);
    const cart = await screen.findByRole('region', { name: 'Document cart' });
    await userEvent.click(within(cart).getByRole('button', { name: 'Save cart to project' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    const put = server.puts.find(entry => entry.kind === 'memo');
    expect(put?.items).toEqual([expect.objectContaining({
      clientKey: '789019:0000789019-26-000003',
      projectId: PROJECT_ID,
      itemKind: 'citation',
      payload: expect.objectContaining({ tags: ['cart'], company: 'Microsoft', excerpt: 'Segment note' }),
    })]);
    expect(within(cart).getByText(/Saved 1 filing to this project’s memo \(1 already in your memo were left as they were\)/)).toBeInTheDocument();
  });

  it('says why a section is empty when account storage answers 503', async () => {
    const server = accountServer({ unavailableKinds: ['memo'] });
    await connect(server);
    render(<ProjectsWorkspace projectId={PROJECT_ID} />);
    const memo = await screen.findByRole('region', { name: 'Memo' });
    expect(await within(memo).findByRole('alert')).toHaveTextContent(/Account storage is not available right now \(HTTP 503\)/);
  });

  it('downloads the project evidence package labelled with time and app version', async () => {
    const server = accountServer();
    await connect(server);
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<ProjectsWorkspace projectId={PROJECT_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: /Download evidence package/ }));
    expect(await screen.findByText(/Downloaded URC_project_Segments_evidence_.* \(\.json and \.docx\): 2 memo items, 3 searches; generated .*; app version commit abc1234/)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });
});
