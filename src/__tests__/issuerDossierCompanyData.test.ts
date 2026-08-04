import { afterEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({
  unstableCache: vi.fn((callback: (...args: unknown[]) => unknown) => callback),
}));

vi.mock('next/cache', () => ({ unstable_cache: cacheMock.unstableCache }));

import {
  fetchDossierCompanyData,
  projectDossierCompanyData,
} from '../app/company/[ticker]/companyData';
import {
  projectCompanyTickerDirectory,
  resolveDossierCik,
} from '../app/company/[ticker]/companyTickerDirectory';
import {
  LOCAL_E2E_DOSSIER_CIK,
  LOCAL_E2E_DOSSIER_COMPANY,
} from '../app/company/[ticker]/dossierE2eFixture';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('issuer dossier company-data projection', () => {
  it('keeps only rendered identity fields and the first 15 recent filings', () => {
    const values = Array.from({ length: 20 }, (_, index) => String(index));
    const projected = projectDossierCompanyData({
      name: 'Example Corp',
      tickers: ['EX', 'EX.A'],
      exchanges: ['NYSE', 'Nasdaq'],
      sicDescription: 'Example industry',
      sic: '1234',
      stateOfIncorporation: 'DE',
      unusedLargeField: 'x'.repeat(3_000_000),
      filings: {
        files: [{ name: 'old-submissions.json' }],
        recent: {
          accessionNumber: values.map(value => `accession-${value}`),
          filingDate: values.map(value => `date-${value}`),
          form: values.map(value => `form-${value}`),
          primaryDocument: values.map(value => `document-${value}`),
          primaryDocDescription: values.map(value => `description-${value}`),
          reportDate: values,
        },
      },
    });

    expect(projected).not.toBeNull();
    expect(projected?.filings.recent.accessionNumber).toHaveLength(15);
    expect(projected?.filings.recent.accessionNumber.at(-1)).toBe('accession-14');
    expect(projected).toEqual({
      name: 'Example Corp',
      tickers: ['EX', 'EX.A'],
      exchanges: ['NYSE', 'Nasdaq'],
      sicDescription: 'Example industry',
      sic: '1234',
      stateOfIncorporation: 'DE',
      filings: {
        recent: {
          accessionNumber: values.slice(0, 15).map(value => `accession-${value}`),
          filingDate: values.slice(0, 15).map(value => `date-${value}`),
          form: values.slice(0, 15).map(value => `form-${value}`),
          primaryDocument: values.slice(0, 15).map(value => `document-${value}`),
          primaryDocDescription: values.slice(0, 15).map(value => `description-${value}`),
        },
      },
    });
    expect(JSON.stringify(projected)).not.toContain('unusedLargeField');
    expect(JSON.stringify(projected)).not.toContain('reportDate');
    expect(JSON.stringify(projected).length).toBeLessThan(10_000);
  });

  it('rejects malformed submissions instead of caching an unusable shape', () => {
    expect(projectDossierCompanyData(null)).toBeNull();
    expect(projectDossierCompanyData({ name: 'Missing filings' })).toBeNull();
    expect(projectDossierCompanyData({ filings: { recent: {} } })).toBeNull();
  });

  it('caches the projection for 24 hours and deduplicates concurrent SEC loads', async () => {
    expect(cacheMock.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ['issuer-dossier-company-data-v1'],
      { revalidate: 86_400 },
    );

    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>(resolve => { resolveResponse = resolve; });
    const fetchMock = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>>(() => response);
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchDossierCompanyData('0000019617');
    const second = fetchDossierCompanyData('0000019617');
    expect(second).toBe(first);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://data.sec.gov/submissions/CIK0000019617.json',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: 'no-store' }));

    resolveResponse?.(new Response(JSON.stringify({
      name: 'JPMorgan Chase & Co.',
      filings: { recent: { accessionNumber: [] } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(first).resolves.toMatchObject({ name: 'JPMorgan Chase & Co.' });
  });

  it('serves deterministic dossier evidence only through the localhost E2E bypass', async () => {
    vi.stubEnv('URC_E2E_BYPASS_AUTH', '1');
    vi.stubEnv('VERCEL', '');
    const fetchMock = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDossierCompanyData(LOCAL_E2E_DOSSIER_CIK)).resolves.toMatchObject({
      name: LOCAL_E2E_DOSSIER_COMPANY,
      filings: { recent: { accessionNumber: ['0001000003-26-000003', '0001000003-26-000002'] } },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Vercel presence closes the bypass even if the local test flag was
    // accidentally copied into a hosted environment.
    vi.stubEnv('VERCEL', '1');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      name: 'Hosted SEC result',
      filings: { recent: { accessionNumber: [] } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(fetchDossierCompanyData(LOCAL_E2E_DOSSIER_CIK)).resolves.toMatchObject({ name: 'Hosted SEC result' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://data.sec.gov/submissions/CIK${LOCAL_E2E_DOSSIER_CIK}.json`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: 'no-store' }));
  });

  it('fails closed when the SEC returns malformed JSON with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"name":', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(fetchDossierCompanyData('0000000042')).resolves.toBeNull();
  });
});

describe('issuer dossier ticker resolution', () => {
  it('validates and projects the official ticker directory', () => {
    expect(projectCompanyTickerDirectory({
      0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
      1: { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp.' },
    })).toEqual({
      AAPL: '0000320193',
      MSFT: '0000789019',
    });
    expect(projectCompanyTickerDirectory({
      0: { cik_str: '320193', ticker: 'AAPL' },
    })).toBeNull();
  });

  it('resolves ticker and raw CIK inputs through the cached paced directory loader', async () => {
    const fetchMock = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>>(async () => new Response(JSON.stringify({
      0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveDossierCik('CIK789019')).resolves.toBe('0000789019');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(resolveDossierCik('aapl')).resolves.toBe('0000320193');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://www.sec.gov/files/company_tickers.json');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: 'no-store' }));
  });
});
