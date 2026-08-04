import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({
  pathname: '/filing/invalid',
  push: vi.fn(),
  back: vi.fn(),
}));

const app = vi.hoisted(() => ({
  addToWatchlist: vi.fn(),
  setChatOpen: vi.fn(),
  setCurrentFilingContext: vi.fn(),
  setCurrentFilingSections: vi.fn(),
  pendingFilingSectionLabel: null as string | null,
  setPendingFilingSectionLabel: vi.fn(),
}));

const secApi = vi.hoisted(() => ({
  fetchCompanySubmissions: vi.fn(),
  fetchFilingText: vi.fn(),
  fetchSubmissionHistory: vi.fn(),
  resolvePrimaryDocumentPath: vi.fn(),
}));

const aiApi = vi.hoisted(() => ({
  aiSummarizeRedline: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, back: navigation.back }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../context/AppState', () => ({
  useApp: () => app,
}));

vi.mock('../services/secApi', () => ({
  buildSecDocumentUrl: (cik: string, accession: string, document: string) =>
    `https://www.sec.gov/Archives/${cik}/${accession}/${document}`,
  buildSecProxyUrl: (path: string) => `/api/sec-proxy?path=${encodeURIComponent(path)}`,
  fetchCompanySubmissions: secApi.fetchCompanySubmissions,
  fetchFilingText: secApi.fetchFilingText,
  fetchSubmissionHistory: secApi.fetchSubmissionHistory,
  resolvePrimaryDocumentPath: secApi.resolvePrimaryDocumentPath,
}));

vi.mock('../services/aiApi', () => ({
  aiSummarizeRedline: aiApi.aiSummarizeRedline,
}));

describe('FilingDetail hook order', () => {
  beforeEach(() => {
    navigation.pathname = '/filing/invalid';
    vi.clearAllMocks();
    secApi.fetchCompanySubmissions.mockResolvedValue(null);
    secApi.fetchFilingText.mockResolvedValue('');
    secApi.fetchSubmissionHistory.mockResolvedValue(null);
    secApi.resolvePrimaryDocumentPath.mockResolvedValue('resolved-primary.htm');
    aiApi.aiSummarizeRedline.mockResolvedValue('');
  });

  it('can rerender from an invalid route to a valid filing without changing hook order', async () => {
    const { rerender } = render(<FilingDetail />);

    expect(screen.getByRole('heading', { name: 'Invalid filing link' })).toBeInTheDocument();

    navigation.pathname = '/filing/0000320193_0000320193-24-000123_aapl-20240928.htm';
    await act(async () => {
      rerender(<FilingDetail />);
    });

    expect(screen.queryByRole('heading', { name: 'Invalid filing link' })).not.toBeInTheDocument();
    expect(screen.getByText('SEC EDGAR LIVE')).toBeInTheDocument();
  });

  it('omits invalid SEC links for a placeholder and retries resolution on a later visit', async () => {
    navigation.pathname = '/filing/0000320193_0000320193-24-000123_edgar/data/2024/QTR4/master.idx';
    secApi.resolvePrimaryDocumentPath
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('aapl-20240928.htm');

    const firstVisit = render(<FilingDetail />);
    expect(await screen.findByRole('heading', { name: 'Official filing document unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /SEC\.gov/i })).toBeNull();
    expect(screen.queryByTitle('SEC Document View')).toBeNull();
    firstVisit.unmount();

    render(<FilingDetail />);
    expect(await screen.findByText('SEC EDGAR LIVE')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /SEC\.gov/i }).length).toBeGreaterThan(0);
    expect(screen.getByTitle('SEC Document View')).toBeInTheDocument();
    expect(secApi.resolvePrimaryDocumentPath).toHaveBeenCalledTimes(2);
  });

  it('shows an explicit redline limitation when historical metadata cannot be resolved', async () => {
    navigation.pathname = '/filing/0000320193_0000320193-24-000123_aapl-20240928.htm';
    render(<FilingDetail />);

    fireEvent.click(screen.getByRole('button', { name: /YoY Redline/i }));
    expect(await screen.findByText(/Filing form and date metadata could not be resolved/)).toBeInTheDocument();
  });

  it('ends metadata loading with an unavailable state and retry when SEC metadata fails', async () => {
    navigation.pathname = '/filing/0000320193_0000320193-24-000123_aapl-20240928.htm';
    render(<FilingDetail />);

    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Filing metadata is unavailable');
    expect(screen.getByRole('button', { name: 'Retry SEC metadata' })).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(3);
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('formats unresolved metadata according to hydration state', () => {
    expect(formatFilingMetadataValue('', false)).toBe('Loading...');
    expect(formatFilingMetadataValue('', true)).toBe('Unavailable');
    expect(formatFilingMetadataValue('10-K', true)).toBe('10-K');
  });

  it('shows a retryable redline AI error without caching provider error copy as a summary', async () => {
    navigation.pathname = '/filing/0000320193_0000320193-24-000123_aapl-20240928.htm';
    secApi.fetchCompanySubmissions.mockResolvedValue({
      cik: '0000320193',
      name: 'Apple Inc.',
      tickers: ['AAPL'],
      exchanges: ['Nasdaq'],
      ein: '',
      description: '',
      sic: '3571',
      sicDescription: 'Electronic Computers',
      filings: {
        recent: {
          accessionNumber: ['0000320193-24-000123', '0000320193-23-000111'],
          filingDate: ['2024-09-28', '2023-09-30'],
          reportDate: ['2024-09-28', '2023-09-30'],
          acceptanceDateTime: ['', ''],
          act: ['', ''],
          form: ['10-K', '10-K'],
          fileNumber: ['001-36743', '001-36743'],
          primaryDocument: ['aapl-20240928.htm', 'aapl-20230930.htm'],
          primaryDocDescription: ['', ''],
        },
        files: [],
      },
    });
    secApi.fetchFilingText.mockImplementation(async (_cik: string, accession: string) => (
      accession.includes('-23-')
        ? 'Risk factors previously described supply constraints and market competition. '.repeat(12)
        : 'Risk factors now describe cybersecurity oversight and artificial intelligence regulation. '.repeat(12)
    ));
    aiApi.aiSummarizeRedline.mockRejectedValue(new Error('AI service is not configured.'));

    render(<FilingDetail />);
    fireEvent.click(screen.getByRole('button', { name: /YoY Redline/i }));

    expect(await screen.findByText(/The AI redline summary could not be generated/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry AI summary' })).toBeInTheDocument();
    expect(screen.queryByText('AI service is not configured.')).not.toBeInTheDocument();
  });

  it('reports unavailable section inspection while preserving the filing and can retry detection', async () => {
    navigation.pathname = '/filing/0000320193_0000320193-24-000123_aapl-20240928.htm';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<FilingDetail />);

    const frame = screen.getByTitle('SEC Document View') as HTMLIFrameElement;
    const retryDocument = document.implementation.createHTMLDocument('SEC filing');
    retryDocument.body.innerHTML = '<h2>Item 1. Business</h2><p>Source filing text.</p>';
    let inspectionUnavailable = true;
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => {
        if (inspectionUnavailable) throw new DOMException('Blocked document inspection', 'SecurityError');
        return retryDocument;
      },
    });

    fireEvent.load(frame);

    expect(await screen.findByRole('alert')).toHaveTextContent('Section navigation is unavailable');
    expect(screen.getByText(/filing remains available in the document viewer/i)).toBeInTheDocument();
    expect(screen.getByTitle('SEC Document View')).toBeInTheDocument();

    inspectionUnavailable = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry section detection' }));

    expect(await screen.findByRole('button', { name: /Item 1\. Business/ })).toBeInTheDocument();
    expect(screen.queryByText(/Section navigation is unavailable/)).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});

import FilingDetail, { formatFilingMetadataValue } from '../views/FilingDetail';
