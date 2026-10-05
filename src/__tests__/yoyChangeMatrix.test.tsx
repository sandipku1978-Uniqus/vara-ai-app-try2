import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchFilingText: vi.fn(),
  aiSummarizeRedline: vi.fn(),
}));

vi.mock('../services/secApi', () => ({
  fetchFilingText: mocks.fetchFilingText,
  buildSecDocumentUrl: (cik: string, accession: string, doc: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/${doc}`,
}));
vi.mock('../services/aiApi', () => ({ aiSummarizeRedline: mocks.aiSummarizeRedline }));

import YoYChangeMatrix from '../components/research/YoYChangeMatrix';
import type { SecSubmission } from '../services/secApi';

/**
 * The YoY matrix: rows grouped from the taxonomy, a form choice that includes
 * DEF 14A, and "Explain changes" — on demand, for one cell, through the
 * redline-summary path, with the compared filings cited.
 */

const PRIOR = [
  'Item 1A. Risk Factors',
  'Our operations depend on suppliers in Asia. Currency movements affect results.',
  'Item 1B. Unresolved Staff Comments',
  'None.',
].join('\n');
const CURRENT = [
  'Item 1A. Risk Factors',
  'Our operations depend on suppliers in Asia and on new export controls on advanced chips. Currency movements affect results.',
  'Item 1B. Unresolved Staff Comments',
  'None.',
].join('\n');

const submission = {
  cik: '320193',
  name: 'Apple Inc.',
  filings: {
    recent: {
      form: ['10-K', '10-K', 'DEF 14A'],
      accessionNumber: ['0000320193-25-000079', '0000320193-24-000123', '0001308179-26-000008'],
      primaryDocument: ['aapl-20250927.htm', 'aapl-20240928.htm', 'def14a.htm'],
      filingDate: ['2025-10-31', '2024-11-01', '2026-01-08'],
      reportDate: ['2025-09-27', '2024-09-28', '2026-02-24'],
    },
  },
} as unknown as SecSubmission;

beforeEach(() => {
  mocks.fetchFilingText.mockReset().mockImplementation(async (_cik: string, accession: string) =>
    accession.startsWith('000032019325') ? CURRENT : PRIOR);
  mocks.aiSummarizeRedline.mockReset();
});

describe('YoYChangeMatrix', () => {
  it('groups taxonomy rows and offers DEF 14A as a form', async () => {
    render(<YoYChangeMatrix tickers={['AAPL']} companiesData={{ AAPL: submission }} />);
    expect(screen.getByRole('columnheader', { name: 'Items' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Leases' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DEF 14A' })).toHaveAttribute('aria-pressed', 'false');
    await screen.findByText('FY2024 → FY2025');
  });

  it('explains one cell on demand through the redline-summary path, and cites both filings', async () => {
    let resolveSummary: (value: string) => void = () => {};
    mocks.aiSummarizeRedline.mockImplementation(() => new Promise<string>(resolve => { resolveSummary = resolve; }));
    render(<YoYChangeMatrix tickers={['AAPL']} companiesData={{ AAPL: submission }} />);

    const row = (await screen.findByRole('rowheader', { name: 'Risk Factors' })).closest('tr')!;
    const cell = await within(row).findByRole('button', { name: /changes/i });
    fireEvent.click(cell);
    // Nothing is sent until asked.
    expect(mocks.aiSummarizeRedline).not.toHaveBeenCalled();

    const explain = screen.getByRole('button', { name: /explain changes/i });
    fireEvent.click(explain);
    expect(mocks.aiSummarizeRedline).toHaveBeenCalledTimes(1);
    const [diffText, options] = mocks.aiSummarizeRedline.mock.calls[0];
    expect(diffText).toContain('[+and on new export controls on advanced chips+]');
    expect(options).toEqual({ throwOnError: true });
    // One at a time: the action is disabled while a request is in flight.
    expect(screen.getByRole('button', { name: /explain changes/i })).toBeDisabled();

    resolveSummary('- New export-control risk added — may affect supply. \n  Evidence: “new export controls on advanced chips”');
    expect(await screen.findByText(/New export-control risk added/)).toBeInTheDocument();
    const sources = screen.getAllByRole('link', { name: /10-K 0000320193-/ });
    expect(sources.map(link => link.textContent)).toEqual([
      '10-K 0000320193-24-000123 (period of report 2024-09-28)',
      '10-K 0000320193-25-000079 (period of report 2025-09-27)',
    ]);
  });

  it('shows a retryable error without discarding the redline', async () => {
    mocks.aiSummarizeRedline.mockRejectedValue(new Error('429'));
    // Different filings than the test above: explanations are cached per pair.
    const other = structuredClone(submission);
    other.filings.recent.accessionNumber = ['0000320193-25-000999', '0000320193-24-000888', '0001308179-26-000008'];
    render(<YoYChangeMatrix tickers={['AAPL']} companiesData={{ AAPL: other }} />);
    const row = (await screen.findByRole('rowheader', { name: 'Risk Factors' })).closest('tr')!;
    fireEvent.click(await within(row).findByRole('button', { name: /changes/i }));
    fireEvent.click(screen.getByRole('button', { name: /explain changes/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be generated/);
    await waitFor(() => expect(screen.getByRole('button', { name: /explain changes/i })).not.toBeDisabled());
  });

  it('labels a section the slicer could not locate instead of measuring it', async () => {
    render(<YoYChangeMatrix tickers={['AAPL']} companiesData={{ AAPL: submission }} />);
    const row = (await screen.findByRole('rowheader', { name: 'Leases' })).closest('tr')!;
    // Neither synthetic filing has notes: "could not extract", never "New section".
    expect(await within(row).findByText('Could not extract')).toBeInTheDocument();
  });
});
