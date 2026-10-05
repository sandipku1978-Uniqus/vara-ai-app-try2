import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// View wiring only: the panels have their own tests against real responses.
vi.mock('../components/enforcement/AaerReleasesPanel', () => ({
  default: () => <div data-testid="aaer-panel" />,
}));
vi.mock('../components/insiders/InsiderTransactionsPanel', () => ({
  default: ({ cik, companyLabel }: { cik: string | number; companyLabel: string }) => (
    <div data-testid="insider-transactions-panel">{`${cik}|${companyLabel}`}</div>
  ),
}));
vi.mock('../components/tables/ResultsToolbar', () => ({ default: () => null }));
vi.mock('../components/tables/AskCopilotButton', () => ({ default: () => null }));
vi.mock('../components/filters/CompanySearchInput', () => ({
  default: ({ onSelect }: { onSelect: (ticker: string, cik: string) => void }) => (
    <>
      <button type="button" onClick={() => onSelect('AAPL', '320193')}>pick AAPL</button>
      <button type="button" onClick={() => onSelect('MSFT', '789019')}>pick MSFT</button>
    </>
  ),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ ticker: 'AAPL' }) }));
vi.mock('../services/secApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/secApi')>()),
  fetchLitigationReleases: vi.fn(async () => [
    { date: '2026-09-30', title: 'SEC v. Example', url: 'https://www.sec.gov/lr-1', releaseNumber: 'LR-1' },
  ]),
  lookupCIK: vi.fn(async () => null),
  fetchCompanySubmissions: vi.fn(async () => null),
}));

import SECEnforcement from '../views/SECEnforcement';
import InsiderTrading from '../views/InsiderTrading';
import DossierTabs from '../app/company/[ticker]/DossierTabs';

describe('Enforcement page', () => {
  it('names both indexes and loads the AAER tab only when opened', async () => {
    render(<SECEnforcement />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SEC Enforcement: Litigation Releases and AAERs');
    expect(await screen.findByText('SEC v. Example')).toBeInTheDocument();
    expect(screen.queryByTestId('aaer-panel')).toBeNull();

    const litigationTab = screen.getByRole('tab', { name: 'SEC Litigation Releases' });
    expect(litigationTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(litigationTab, { key: 'ArrowRight' });
    const aaerTab = screen.getByRole('tab', { name: 'Accounting and Auditing Enforcement Releases' });
    expect(aaerTab).toHaveAttribute('aria-selected', 'true');
    expect(aaerTab).toHaveFocus();
    expect(screen.getByTestId('aaer-panel')).toBeInTheDocument();

    // Switching back keeps the AAER panel mounted (hidden), so its crawl is not repeated.
    fireEvent.click(screen.getByRole('tab', { name: 'SEC Litigation Releases' }));
    expect(screen.getByTestId('aaer-panel')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'SEC Litigation Releases' })).toBeVisible();
  });
});

describe('Insiders page', () => {
  it('reads transactions for the chosen company', () => {
    render(<InsiderTrading />);
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    expect(screen.getByText('Add a company above to read its insider transactions.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'pick AAPL' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick MSFT' }));
    expect(screen.getByTestId('insider-transactions-panel')).toHaveTextContent('320193|AAPL');

    fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), { target: { value: 'MSFT' } });
    expect(screen.getByTestId('insider-transactions-panel')).toHaveTextContent('789019|MSFT');
  });
});

describe('Company dossier', () => {
  it('shows insider transactions for the dossier CIK', () => {
    render(
      <DossierTabs
        cik={320193}
        companyName="Apple Inc."
        recentFilings={{ accessionNumber: [], filingDate: [], form: [], primaryDocument: [], primaryDocDescription: [] }}
      />,
    );
    expect(screen.queryByTestId('insider-transactions-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Insider Transactions' }));
    expect(screen.getByTestId('insider-transactions-panel')).toHaveTextContent('320193|Apple Inc.');
  });
});
