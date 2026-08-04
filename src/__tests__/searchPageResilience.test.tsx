import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSearchFilters } from '../domain/searchFilters';
import type { FilingResearchResult } from '../services/filingResearch';
import type { ResearchSearchSession } from '../services/researchSessions';

const navigation = vi.hoisted(() => ({
  pathname: '/search',
  params: new URLSearchParams('tab=session-a'),
  push: vi.fn(),
  replace: vi.fn(),
}));

const app = vi.hoisted(() => ({
  addSavedAlert: vi.fn(),
  pendingSearchIntent: null,
  setPendingSearchIntent: vi.fn(),
  setActiveSearchContext: vi.fn(),
  setChatOpen: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  executeSearch: vi.fn(),
  resolvePrimaryDocumentPath: vi.fn(),
  addCitation: vi.fn(),
  removeCitation: vi.fn(),
  savedSessions: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.params,
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}));

vi.mock('../context/AppState', () => ({ useApp: () => app }));

vi.mock('../components/filters/SearchFilterBar', async () => {
  const domain = await import('../domain/searchFilters');
  return { default: () => null, defaultSearchFilters: domain.defaultSearchFilters };
});

vi.mock('../services/filingResearch', () => ({
  buildSearchTrendSummary: vi.fn(async () => ''),
  executeFilingResearchSearch: mocks.executeSearch,
  mergeVerifiedResultWindows: (left: FilingResearchResult[], right: FilingResearchResult[]) => [...left, ...right],
  canUseInstantEnrichedSearch: () => true,
}));

vi.mock('../services/secApi', () => ({
  buildSecDocumentUrl: (cik: string, accession: string, document: string) =>
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/${document}`,
  buildSecProxyUrl: (path: string) => `/api/sec-proxy?path=${encodeURIComponent(path)}`,
  isPlaceholderPrimaryDocument: (document: string, accession: string) =>
    document.startsWith('edgar/') || document === `${accession}.txt`,
  resolvePrimaryDocumentPath: mocks.resolvePrimaryDocumentPath,
  computeCompanySuggestions: () => [],
  fetchCompanySubmissions: vi.fn(async () => null),
  getCompanyDirectory: vi.fn(async () => []),
}));

vi.mock('../services/issuerFreshness', () => ({ buildIssuerFreshnessNotice: () => null }));

vi.mock('../services/researchSessions', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/researchSessions')>();
  return {
    ...actual,
    loadResearchSessions: () => mocks.savedSessions,
    saveResearchSessions: vi.fn(),
  };
});

vi.mock('../services/resultExport', () => ({ exportResultsWorkbook: vi.fn(async () => undefined) }));
vi.mock('../services/searchTrendReport', () => ({
  generateSearchTrendReport: vi.fn(async () => ({ report: '', aiError: '' })),
  SEARCH_TREND_AI_FALLBACK: 'fallback',
}));
vi.mock('../services/memoTray', () => ({
  addCitation: mocks.addCitation,
  removeCitation: mocks.removeCitation,
  citationId: (cik: string, accession: string) => `${cik}:${accession}`,
}));
vi.mock('../hooks/useMemoTray', () => ({ useMemoTray: () => [] }));

vi.mock('../components/research/ResearchResultsWorkspace', () => ({
  default: (props: {
    activeSession: ResearchSearchSession | null;
    loading: boolean;
    errorMsg: string;
    selectedResult: FilingResearchResult | null;
    selectedDocumentUrl: string;
    selectedIsCited: boolean;
    onToggleCitation: () => void;
    results: FilingResearchResult[];
    onSelectResult: (id: string) => void;
  }) => (
    <div data-testid="workspace">
      <span data-testid="active-session">{props.activeSession?.id || 'none'}</span>
      <span data-testid="workspace-loading">{String(props.loading)}</span>
      <span data-testid="workspace-error">{props.errorMsg}</span>
      <span data-testid="selected-company">{props.selectedResult?.entityName || ''}</span>
      <span data-testid="selected-url">{props.selectedDocumentUrl}</span>
      <button
        type="button"
        onClick={props.onToggleCitation}
        disabled={!props.selectedDocumentUrl && !props.selectedIsCited}
      >
        Cite selected
      </button>
      {props.results.map(result => (
        <button key={result.id} type="button" onClick={() => props.onSelectResult(result.id)}>
          Select {result.entityName}
        </button>
      ))}
    </div>
  ),
}));

import SearchPage from '../views/SearchPage';

function filing(overrides: Partial<FilingResearchResult> = {}): FilingResearchResult {
  return {
    id: 'filing-1',
    entityName: 'Issuer One',
    companyName: 'Issuer One',
    fileDate: '2026-01-15',
    formType: '10-K',
    documentType: '10-K',
    cik: '320193',
    accessionNumber: '0000320193-26-000001',
    primaryDocument: 'report.htm',
    filingPrimaryDocument: 'report.htm',
    filingUrl: 'https://www.sec.gov/valid.htm',
    description: 'Annual report',
    matchSnippet: 'material weakness',
    matchReason: 'Validated filing text',
    score: 1,
    relevanceScore: 1,
    tickers: ['AAPL'],
    sic: '',
    sicDescription: '',
    exchange: '',
    stateOfIncorporation: '',
    fiscalYearEnd: '',
    headquarters: '',
    fileNumber: '',
    auditor: '',
    acceleratedStatus: '',
    ...overrides,
  };
}

function session(
  id: string,
  title: string,
  overrides: Partial<ResearchSearchSession> = {}
): ResearchSearchSession {
  return {
    id,
    title,
    query: 'existing query',
    mode: 'semantic',
    filters: { ...defaultSearchFilters },
    results: [],
    isRefining: false,
    searched: true,
    errorMsg: '',
    interpretation: [],
    resolvedSearch: { query: 'existing query', mode: 'semantic', filters: { ...defaultSearchFilters } },
    selectedResultId: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    coverage: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function updateRoute(url: string) {
  const query = url.split('?')[1] || '';
  navigation.params = new URLSearchParams(query);
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = '/search';
  navigation.params = new URLSearchParams('tab=session-a');
  navigation.push.mockImplementation((url: string) => updateRoute(url));
  navigation.replace.mockImplementation((url: string) => updateRoute(url));
  mocks.resolvePrimaryDocumentPath.mockResolvedValue('resolved-primary.htm');
  mocks.savedSessions = [session('session-a', 'Session A')];
});

afterEach(() => cleanup());

describe('SearchPage async ownership', () => {
  it('keeps run B loading when aborting run A settles A first', async () => {
    mocks.savedSessions = [session('session-a', 'Session A', { searched: false })];
    const replacement = deferred<FilingResearchResult[]>();
    mocks.executeSearch
      .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise<FilingResearchResult[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('superseded', 'AbortError')), { once: true });
      }))
      .mockReturnValueOnce(replacement.promise);

    render(<SearchPage />);
    const searchButton = screen.getByRole('button', { name: 'Search' });
    fireEvent.click(screen.getByRole('button', { name: 'ASC 842 adoption w/10 lease' }));
    await waitFor(() => expect(mocks.executeSearch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'ASR w/5 derivative' }));
    await waitFor(() => expect(mocks.executeSearch).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(screen.getByTestId('workspace-loading')).toHaveTextContent('true'));
    expect(searchButton).toBeDisabled();

    replacement.resolve([]);
    await waitFor(() => expect(screen.getByTestId('workspace-loading')).toHaveTextContent('false'));
    expect(searchButton).not.toBeDisabled();
  });

  it('persists a late resolved run without routing or global context back from the selected tab', async () => {
    const late = deferred<FilingResearchResult[]>();
    const bResult = filing({ id: 'b-result', entityName: 'Visible B' });
    mocks.savedSessions = [
      session('session-a', 'Session A'),
      session('session-b', 'Session B', { results: [bResult], selectedResultId: bResult.id }),
    ];
    mocks.executeSearch.mockReturnValueOnce(late.promise);

    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ASC 842 adoption w/10 lease' }));
    await waitFor(() => expect(mocks.executeSearch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('tab', { name: /Session B/ }));
    late.resolve([filing({ id: 'late-a', entityName: 'Late A' })]);

    await waitFor(() => expect(screen.getByTestId('active-session')).toHaveTextContent('session-b'));
    expect(screen.getByTestId('selected-company')).toHaveTextContent('Visible B');
    expect(screen.getByTestId('workspace-loading')).toHaveTextContent('false');
    expect(String(navigation.push.mock.calls.at(-1)?.[0])).toContain('tab=session-b');
    expect(app.setActiveSearchContext.mock.calls.at(-1)?.[0]?.results?.[0]?.entityName).toBe('Visible B');
  });

  it('keeps a hidden late rejection from replacing the selected tab error or route', async () => {
    const late = deferred<FilingResearchResult[]>();
    const bResult = filing({ id: 'b-result', entityName: 'Visible B' });
    mocks.savedSessions = [
      session('session-a', 'Session A'),
      session('session-b', 'Session B', { results: [bResult], selectedResultId: bResult.id }),
    ];
    mocks.executeSearch.mockReturnValueOnce(late.promise);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ASC 842 adoption w/10 lease' }));
    await waitFor(() => expect(mocks.executeSearch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('tab', { name: /Session B/ }));
    late.reject(new Error('late A failed'));

    await waitFor(() => expect(screen.getByTestId('active-session')).toHaveTextContent('session-b'));
    expect(screen.getByTestId('workspace-error')).toHaveTextContent('');
    expect(screen.getByTestId('selected-company')).toHaveTextContent('Visible B');
    expect(String(navigation.push.mock.calls.at(-1)?.[0])).toContain('tab=session-b');
    errorSpy.mockRestore();
  });
});

describe('SearchPage official-source citation integrity', () => {
  it('replaces a facet placeholder and cites only the resolved SEC URL', async () => {
    const placeholder = filing({
      id: 'facet-hit',
      primaryDocument: 'edgar/data/320193/0000320193-26-000001.txt',
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/320193/edgar/data/320193/0000320193-26-000001.txt',
    });
    mocks.savedSessions = [session('session-a', 'Facet result', {
      results: [placeholder],
      selectedResultId: placeholder.id,
    })];
    const resolution = deferred<string>();
    mocks.resolvePrimaryDocumentPath.mockReturnValueOnce(resolution.promise);

    render(<SearchPage />);
    expect(screen.getByRole('button', { name: 'Cite selected' })).toBeDisabled();
    expect(screen.getByTestId('selected-url')).toHaveTextContent('');

    resolution.resolve('aapl-20260926.htm');
    await waitFor(() => expect(screen.getByTestId('selected-url')).toHaveTextContent('/aapl-20260926.htm'));
    fireEvent.click(screen.getByRole('button', { name: 'Cite selected' }));

    expect(mocks.addCitation).toHaveBeenCalledOnce();
    expect(mocks.addCitation.mock.calls[0][0].sourceUrl).toBe(
      'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-20260926.htm'
    );
    expect(mocks.addCitation.mock.calls[0][0].sourceUrl).not.toContain('/edgar/data/320193/edgar/');
  });

  it('retries one failed placeholder lookup only after the visitor leaves and revisits the result', async () => {
    const placeholder = filing({
      id: 'facet-hit',
      entityName: 'Facet issuer',
      primaryDocument: 'edgar/data/320193/0000320193-26-000001.txt',
    });
    const other = filing({ id: 'other-hit', entityName: 'Other issuer' });
    mocks.savedSessions = [session('session-a', 'Facet result', {
      results: [placeholder, other],
      selectedResultId: placeholder.id,
    })];
    mocks.resolvePrimaryDocumentPath
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('aapl-20260926.htm');

    render(<SearchPage />);
    await waitFor(() => expect(mocks.resolvePrimaryDocumentPath).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Research Library/ }));
    expect(mocks.resolvePrimaryDocumentPath).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Select Other issuer' }));
    await waitFor(() => expect(screen.getByTestId('selected-company')).toHaveTextContent('Other issuer'));
    fireEvent.click(screen.getByRole('button', { name: 'Select Facet issuer' }));

    await waitFor(() => expect(mocks.resolvePrimaryDocumentPath).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('selected-url')).toHaveTextContent('/aapl-20260926.htm'));
  });
});
