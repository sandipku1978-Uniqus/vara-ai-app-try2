import { afterEach, describe, expect, it, vi } from 'vitest';

const cacheMock = vi.hoisted(() => ({
  unstableCache: vi.fn((callback: (...args: unknown[]) => unknown) => callback),
}));

vi.mock('next/cache', () => ({ unstable_cache: cacheMock.unstableCache }));

import {
  fetchDossierCompanyData,
  projectDossierCompanyData,
} from '../app/company/[ticker]/companyData';

afterEach(() => {
  vi.unstubAllGlobals();
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
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchDossierCompanyData('0000019617');
    const second = fetchDossierCompanyData('0000019617');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://data.sec.gov/submissions/CIK0000019617.json',
      expect.objectContaining({ cache: 'no-store' }),
    );

    resolveResponse?.(new Response(JSON.stringify({
      name: 'JPMorgan Chase & Co.',
      filings: { recent: { accessionNumber: [] } },
    }), { status: 200 }));

    await expect(first).resolves.toMatchObject({ name: 'JPMorgan Chase & Co.' });
  });
});
