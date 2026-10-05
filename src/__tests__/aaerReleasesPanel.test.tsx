import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMemoTray, getMemoCitations } from '../services/memoTray';
import { buildCsv } from '../utils/csv';
import AaerReleasesPanel from '../components/enforcement/AaerReleasesPanel';
import { aaerCoverageLine, aaerQueryString, type AaerResponse } from '../components/enforcement/aaerFormat';
// A real GET /api/aaer body: the first 12 releases of collectAaerReleases
// ({ pagesToRead: 1 }) captured from sec.gov on 2026-10-05, with its coverage
// object as the service returned it (page 0 of 34, so partial).
import realResponse from './fixtures/aaer/api-response.json';

vi.mock('../components/tables/ResultsToolbar', () => ({
  default: ({ data, columns, label }: { data: Record<string, unknown>[]; columns: Array<{ key: string; header?: string }>; label: string }) => (
    <pre data-testid={`csv-${label}`}>{buildCsv(data, columns)}</pre>
  ),
}));

function fixture(): AaerResponse {
  return structuredClone(realResponse) as AaerResponse;
}

function respondWith(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => clearMemoTray());
afterEach(() => vi.restoreAllMocks());

describe('AaerReleasesPanel', () => {
  it('lists releases with respondents, SEC links and related actions', async () => {
    const fetchMock = respondWith(fixture());
    render(<AaerReleasesPanel />);

    const title = await screen.findByRole('link', { name: 'Latch, Inc. (AAER-4604) on SEC.gov' });
    expect(fetchMock).toHaveBeenCalledWith('/api/aaer?limit=500', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(title).toHaveAttribute('href', 'https://www.sec.gov/files/litigation/admin/2026/33-11450.pdf');
    expect(screen.getByText('also 33-11450, 34-106568')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Administrative Summary' }))
      .toHaveAttribute('href', 'https://www.sec.gov/enforcement-litigation/administrative-proceedings/33-11450-s');
    expect(screen.getByText('L&L Energy, Inc.; Dickson Lee, CPA (Order Granting Extension of Time to File a Reply)')).toBeInTheDocument();
    expect(screen.getByText('12 matching releases.')).toBeInTheDocument();
  });

  it('shows the service coverage as the source line, marked partial when the crawl was', async () => {
    respondWith(fixture());
    render(<AaerReleasesPanel />);

    const coverage = await screen.findByTestId('aaer-coverage');
    expect(coverage).toHaveTextContent('100 releases across 1 of 34 index pages (2024-02-12 to 2026-10-01), read');
    expect(coverage).toHaveTextContent('Partial: Requested page limit reached.');
  });

  it('states a complete crawl without a partial notice', () => {
    const coverage = {
      ...fixture().coverage,
      pagesRequested: 34, pagesParsed: 34, rowsParsed: 3347, oldestDate: '1982-04-15', complete: true, incompleteReason: undefined,
    };
    const line = aaerCoverageLine(coverage);
    expect(line).toMatch(/^3,347 releases across 34 index pages \(1982-04-15 to 2026-10-01\), read .+\.$/);
    expect(line).not.toMatch(/partial/i);
  });

  it('sends the year range and text filter to the route', async () => {
    const fetchMock = respondWith(fixture());
    render(<AaerReleasesPanel />);
    await screen.findByTestId('aaer-coverage');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  Latch ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'From year' }), { target: { value: '2025' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To year' }), { target: { value: '2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/aaer?limit=500&q=Latch&from=2025-01-01&to=2026-12-31', expect.anything(),
    ));
    expect(aaerQueryString({ q: '', fromYear: '', toYear: '2001' })).toBe('limit=500&to=2001-12-31');
  });

  it('blocks an inverted year range instead of sending a request the route rejects', async () => {
    const fetchMock = respondWith(fixture());
    render(<AaerReleasesPanel />);
    await screen.findByTestId('aaer-coverage');

    fireEvent.change(screen.getByRole('combobox', { name: 'From year' }), { target: { value: '2026' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To year' }), { target: { value: '2025' } });
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The from year must not be after the to year.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says when the route limit hides older matches', async () => {
    respondWith({ ...fixture(), total: 3347, returned: 12 });
    render(<AaerReleasesPanel />);
    expect(await screen.findByText(/Showing the newest 12 of 3,347 matching releases/)).toBeInTheDocument();
  });

  it('exports the listed releases as CSV', async () => {
    respondWith(fixture());
    render(<AaerReleasesPanel />);
    await screen.findByTestId('aaer-coverage');

    const csv = screen.getByTestId('csv-AAER releases').textContent ?? '';
    expect(csv.split('\r\n')[0]).toBe('Release no.,Date,Respondents,Title,SEC URL,Other release numbers,Related actions');
    expect(csv).toContain('AAER-4604,2026-10-01,"Latch, Inc.","Latch, Inc.",https://www.sec.gov/files/litigation/admin/2026/33-11450.pdf,33-11450; 34-106568,Administrative Summary <https://www.sec.gov/enforcement-litigation/administrative-proceedings/33-11450-s>');
    expect(csv.split('\r\n')).toHaveLength(13);
  });

  it('cites a release with its SEC URL as the source', async () => {
    respondWith(fixture());
    render(<AaerReleasesPanel />);
    await screen.findByTestId('aaer-coverage');

    fireEvent.click(screen.getByRole('button', { name: 'Cite AAER-4604, SEC, 2026-10-01 — Latch, Inc. in memo tray' }));
    expect(getMemoCitations()[0]).toMatchObject({
      kind: 'release',
      cik: 'SEC',
      accessionNumber: 'AAER-4604',
      form: 'AAER',
      fileDate: '2026-10-01',
      sourceUrl: 'https://www.sec.gov/files/litigation/admin/2026/33-11450.pdf',
    });
  });

  it('reports a failed read and retries it', async () => {
    const fetchMock = respondWith({ error: 'Could not collect SEC AAER releases.' }, 502);
    render(<AaerReleasesPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The SEC AAER index could not be read (Could not collect SEC AAER releases.).');

    fetchMock.mockImplementation(async () => new Response(JSON.stringify(fixture()), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry SEC AAER index' }));
    expect(await screen.findByTestId('aaer-coverage')).toBeInTheDocument();
  });
});
