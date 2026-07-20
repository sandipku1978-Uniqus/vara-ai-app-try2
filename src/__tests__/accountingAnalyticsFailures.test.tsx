import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const secApi = vi.hoisted(() => ({
  lookupCIK: vi.fn(),
  fetchCompanyFacts: vi.fn(),
  computeFinancialRatios: vi.fn(),
  extractComparableFinancials: vi.fn(),
  getAvailableYears: vi.fn(),
}));

vi.mock('../services/secApi', () => secApi);

vi.mock('../components/filters/CompanySearchInput', () => ({
  default: ({ onSelect }: { onSelect: (ticker: string, cik: string) => void }) => (
    <div>
      <button type="button" onClick={() => onSelect('AAPL', '1')}>Add AAPL</button>
      <button type="button" onClick={() => onSelect('MSFT', '2')}>Add MSFT</button>
    </div>
  ),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import AccountingAnalytics from '../views/AccountingAnalytics';

describe('Accounting Analytics XBRL coverage failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secApi.lookupCIK.mockResolvedValue(null);
    secApi.getAvailableYears.mockReturnValue([2025, 2024]);
    secApi.extractComparableFinancials.mockReturnValue({ revenue: { value: 100, unit: 'USD' } });
    secApi.computeFinancialRatios.mockReturnValue({ grossMargin: 50 });
  });

  it('renders a failed company load as a retryable error, not an empty-data conclusion', async () => {
    secApi.fetchCompanyFacts.mockResolvedValue(null);
    render(<AccountingAnalytics />);

    fireEvent.click(screen.getByRole('button', { name: 'Add AAPL' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ratio data could not be loaded for AAPL');
    expect(screen.getByRole('alert')).toHaveTextContent('No zero-data conclusion can be drawn');
    expect(screen.queryByText('No ratio data available.')).not.toBeInTheDocument();

    const attemptsBeforeRetry = secApi.fetchCompanyFacts.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry XBRL data' }));
    await waitFor(() => expect(secApi.fetchCompanyFacts.mock.calls.length).toBeGreaterThan(attemptsBeforeRetry));
  });

  it('keeps successful ratios visible while disclosing partial company coverage', async () => {
    secApi.fetchCompanyFacts.mockImplementation(async (cik: string) => cik === '1' ? {} : null);
    render(<AccountingAnalytics />);

    fireEvent.click(screen.getByRole('button', { name: 'Add AAPL' }));
    expect(await screen.findByRole('columnheader', { name: 'AAPL' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add MSFT' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Partial XBRL coverage');
    expect(screen.getByRole('alert')).toHaveTextContent('MSFT');
    expect(screen.getByRole('columnheader', { name: 'AAPL' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'MSFT' })).not.toBeInTheDocument();
  });
});
