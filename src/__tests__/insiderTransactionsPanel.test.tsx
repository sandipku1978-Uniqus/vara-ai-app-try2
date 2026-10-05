import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InsiderTransactionsResult } from '../services/insiderTransactions';
import { clearMemoTray, getMemoCitations } from '../services/memoTray';
import { buildCsv } from '../utils/csv';
import InsiderTransactionsPanel from '../components/insiders/InsiderTransactionsPanel';
import {
  filingDocumentUrl,
  filingIndexUrl,
  insiderCoverageLine,
  ownershipLabel,
  transactionCodeLabel,
} from '../components/insiders/insiderFormat';
// A real GET /api/insiders/transactions body for Apple (CIK 320193, limit 8),
// captured once from getInsiderTransactions against SEC on 2026-10-05.
import realResponse from './fixtures/insiders/transactions-response.json';

// The toolbar's copilot actions need the app provider; the export content is
// what matters here, so render the CSV it would download.
vi.mock('../components/tables/ResultsToolbar', () => ({
  default: ({ data, columns, label }: { data: Record<string, unknown>[]; columns: Array<{ key: string; header?: string }>; label: string }) => (
    <pre data-testid={`csv-${label}`}>{buildCsv(data, columns)}</pre>
  ),
}));

function fixture(): InsiderTransactionsResult {
  return structuredClone(realResponse) as InsiderTransactionsResult;
}

function respondWith(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => clearMemoTray());
afterEach(() => vi.restoreAllMocks());

describe('InsiderTransactionsPanel', () => {
  it('reads the issuer by CIK and states the coverage the service reported', async () => {
    const fetchMock = respondWith(fixture());
    render(<InsiderTransactionsPanel cik={320193} companyLabel="AAPL" />);

    await screen.findByRole('region', { name: /insider transactions for apple inc/i });
    expect(fetchMock).toHaveBeenCalledWith('/api/insiders/transactions?cik=320193', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const coverage = screen.getByTestId('insider-coverage');
    expect(coverage).toHaveTextContent(
      '609 Form 3/4/5 filings listed, 8 newest requested, 8 parsed, 0 failed, 0 about other issuers; 601 older listed filings not requested; 1 history segment not read.',
    );
    expect(coverage).toHaveTextContent('Filings requested span 2026-09-24 to 2026-10-01.');
    expect(coverage).not.toHaveTextContent(/partial/i);
  });

  it('labels transaction codes in plain language and links each row to its SEC filing', async () => {
    respondWith(fixture());
    render(<InsiderTransactionsPanel cik="320193" companyLabel="AAPL" />);
    await screen.findByRole('region', { name: /insider transactions/i });

    expect(screen.getAllByText('S · Open-market or private sale').length).toBe(2);
    expect(screen.getAllByText('A · Grant, award or other acquisition from the issuer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$336.18').length).toBe(1);
    const link = screen.getAllByRole('link', { name: /accession 0001140361-26-038307/ })[0];
    expect(link).toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/320193/000114036126038307/xslF345X06/form4.xml');
  });

  it('renders undisclosed shares and price as "not reported", never 0, on screen and in the CSV', async () => {
    const body = fixture();
    // Same real row with its share count and price withheld, as a footnote-only disclosure would be.
    body.transactions[0] = { ...body.transactions[0], shares: null, pricePerShare: null };
    body.coverage.rowsWithoutShares = 1;
    respondWith(body);
    render(<InsiderTransactionsPanel cik="320193" companyLabel="AAPL" />);
    await screen.findByRole('region', { name: /insider transactions/i });

    const sharesHeader = screen.getAllByRole('columnheader').find(cell => cell.textContent?.startsWith('Shares'));
    const table = sharesHeader!.closest('table')!;
    const firstRow = within(table).getAllByRole('row')[1];
    expect(within(firstRow).getAllByText('not reported')).toHaveLength(2);
    expect(firstRow).not.toHaveTextContent('$0.00');
    expect(screen.getByTestId('insider-coverage')).toHaveTextContent('1 transaction row disclosed no share count');

    const csv = screen.getByTestId('csv-insider transactions').textContent ?? '';
    const newsteadSale = csv.split('\r\n').find(line => line.startsWith('2026-09-29'));
    expect(newsteadSale).toContain('Disposed,not reported,not reported,41992,');
  });

  it('summarises owners with net open-market and all-code shares and their last transaction', async () => {
    respondWith(fixture());
    render(<InsiderTransactionsPanel cik="320193" companyLabel="AAPL" />);
    await screen.findByRole('region', { name: /insider transactions/i });

    const csv = screen.getByTestId('csv-insider owner summary').textContent ?? '';
    // Negative cells carry the shared CSV util's formula guard (a leading apostrophe).
    expect(csv).toContain("Newstead Jennifer,\"Officer (SVP, GC and Government Affairs)\",'-4798,'-4798,2026-09-29 · S,3,4,0");
    expect(screen.getAllByText('-4,798')).toHaveLength(2);
    expect(screen.getByText(/Non-derivative shares only/)).toBeInTheDocument();
  });

  it('cites a single transaction with its Form 4 accession and SEC URL', async () => {
    respondWith(fixture());
    render(<InsiderTransactionsPanel cik="320193" companyLabel="AAPL" />);
    await screen.findByRole('region', { name: /insider transactions/i });

    fireEvent.click(screen.getAllByRole('button', { name: /^Cite Apple Inc\. 4 filed 2026-10-01/ })[0]);
    const [citation] = getMemoCitations();
    expect(citation).toMatchObject({
      kind: 'filing',
      cik: '320193',
      accessionNumber: '0001140361-26-038307',
      form: '4',
      section: 'Insider transaction',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000114036126038307/xslF345X06/form4.xml',
    });
    expect(citation.excerpt).toContain('Newstead Jennifer');
    expect(citation.excerpt).toContain('2,399 shares');
  });

  it('marks a partial read and lists failed and other-issuer filings', async () => {
    const body = fixture();
    body.coverage = {
      ...body.coverage,
      filingsParsed: 6,
      filingsFailed: [{ accession: '0001140361-26-038021', reason: 'http-status:503' }],
      filingsAboutOtherIssuers: [{ accession: '0001140361-26-038022', issuerCik: '1418091', issuerName: 'Other Issuer Inc' }],
      filingsAboutOtherIssuersCount: 1,
      complete: false,
    };
    respondWith(body);
    render(<InsiderTransactionsPanel cik="320193" companyLabel="AAPL" />);
    await screen.findByRole('region', { name: /insider transactions/i });

    const coverage = screen.getByTestId('insider-coverage');
    expect(coverage).toHaveTextContent('6 parsed, 1 failed, 1 about other issuers');
    expect(coverage).toHaveTextContent(/Partial:/);
    expect(coverage).toHaveTextContent('0001140361-26-038021: http-status:503');
    expect(coverage).toHaveTextContent('Other Issuer Inc (CIK 1418091)');
  });

  it('reports a failed read and retries it', async () => {
    const fetchMock = respondWith({ error: 'SEC insider submissions request timed out.' }, 504);
    render(<InsiderTransactionsPanel cik="320193" companyLabel="AAPL" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('SEC insider transactions could not be read for AAPL (SEC insider submissions request timed out.)');

    fetchMock.mockResolvedValue(new Response(JSON.stringify(fixture()), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry insider transactions' }));
    await screen.findByRole('region', { name: /insider transactions/i });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('insider display rules', () => {
  it('keeps unknown or missing values explicit', () => {
    expect(transactionCodeLabel(null)).toBe('not reported');
    expect(transactionCodeLabel('Q')).toBe('Q · code not in the SEC code list');
    expect(ownershipLabel({ direct: false, natureOfOwnership: 'By Trust' })).toBe('Indirect (By Trust)');
    expect(ownershipLabel({ direct: null, natureOfOwnership: null })).toBe('not reported');
    expect(filingIndexUrl('0000320193', '0001140361-26-038307'))
      .toBe('https://www.sec.gov/Archives/edgar/data/320193/000114036126038307/0001140361-26-038307-index.htm');
    expect(filingDocumentUrl('0000320193', '0001140361-26-038307', 'xslF345X06/form4.xml'))
      .toBe('https://www.sec.gov/Archives/edgar/data/320193/000114036126038307/xslF345X06/form4.xml');
    // No usable document path: the index page, never a guessed file.
    for (const unusable of ['', null, '../form4.xml', 'a/b/form4.xml', 'https://evil.example/x.xml']) {
      expect(filingDocumentUrl('320193', '0001140361-26-038307', unusable))
        .toBe('https://www.sec.gov/Archives/edgar/data/320193/000114036126038307/0001140361-26-038307-index.htm');
    }
  });

  it('says history segments were not read even when there are none', () => {
    const coverage = { ...fixture().coverage, unreadHistoryFiles: 0, filingsOutsideLimit: 0 };
    expect(insiderCoverageLine(coverage)).toBe('609 Form 3/4/5 filings listed, 8 newest requested, 8 parsed, 0 failed, 0 about other issuers; history segments not read.');
  });
});
