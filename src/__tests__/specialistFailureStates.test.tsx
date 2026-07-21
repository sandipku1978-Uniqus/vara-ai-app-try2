import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  filingResearch: vi.fn(),
  searchEdgar: vi.fn(),
  fetchFilingText: vi.fn(),
  extractDeal: vi.fn(),
  extractClauses: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../services/filingResearch', () => ({
  executeFilingResearchSearch: mocks.filingResearch,
}));
vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.searchEdgar,
  fetchFilingText: mocks.fetchFilingText,
  getCompanyDirectory: async () => [],
  computeCompanySuggestions: () => [],
  buildSecFilingIndexUrl: (cik: string, acc: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}-index.htm`,
}));
vi.mock('../services/aiApi', () => ({
  aiExtractDealDetails: mocks.extractDeal,
  aiExtractClauses: mocks.extractClauses,
}));
vi.mock('../components/tables/DataTable', () => ({ default: () => null }));
vi.mock('../components/tables/ResultsToolbar', () => ({ default: () => null }));
vi.mock('../components/tables/AskCopilotButton', () => ({ default: () => null }));
vi.mock('../components/tables/AIResultsSummary', () => ({ default: () => null }));
vi.mock('../components/filters/SearchFilterBar', () => ({
  default: () => null,
  defaultSearchFilters: { keyword: '' },
}));

import ExemptOfferings from '../views/ExemptOfferings';
import MAResearch from '../views/MAResearch';

const dealHit = {
  _id: '0000000001:deal.htm',
  _source: {
    display_names: ['Example Target'],
    file_date: '2026-07-01',
    file_type: '8-K',
    adsh: '0000000001-26-000001',
    ciks: ['0000000001'],
  },
};

describe('specialist workflow failure states', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it('uses a real queryless Form D browse and exposes recent-source failure with retry', async () => {
    mocks.filingResearch.mockRejectedValue(new Error('SEC unavailable'));
    render(<ExemptOfferings />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not be loaded from SEC EDGAR');
    expect(screen.getByRole('button', { name: 'Retry recent filings' })).toBeInTheDocument();
    expect(mocks.filingResearch).toHaveBeenCalledWith(expect.objectContaining({
      query: '',
      defaultForms: 'D,D/A',
    }));
  });

  it('distinguishes a Form D search failure from a legitimate zero', async () => {
    mocks.filingResearch
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('search failed'));
    render(<ExemptOfferings />);

    await screen.findByText('No recent Form D or D/A filings were returned.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Form D filings' }), {
      target: { value: 'solar fund' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No zero-result conclusion can be drawn');
    expect(mocks.filingResearch).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'solar fund' }));
  });

  it('distinguishes an M&A feed failure from an empty feed', async () => {
    mocks.searchEdgar.mockRejectedValue(new Error('SEC unavailable'));
    render(<MAResearch />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not be loaded from SEC EDGAR');
    expect(screen.getByRole('button', { name: 'Retry filings' })).toBeInTheDocument();
  });

  it('keeps a failed row extraction retryable instead of displaying no details', async () => {
    mocks.searchEdgar.mockResolvedValue([dealHit]);
    mocks.fetchFilingText.mockRejectedValue(new Error('source failed'));
    render(<MAResearch />);

    const extract = await screen.findByRole('button', { name: 'Extract with AI' });
    fireEvent.click(extract);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Analysis failed'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No details found')).not.toBeInTheDocument();
  });
});
