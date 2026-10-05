import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanySize } from '../services/peerSizing';
import type { ProxyPeerGroupOutcome } from '../services/proxyPeerGroup';

const mocks = vi.hoisted(() => ({
  loadProxyPeerGroup: vi.fn(),
  getCompanyDirectory: vi.fn(),
  loadCompanySizes: vi.fn(),
}));

vi.mock('../services/proxyPeerGroup', async importOriginal => ({
  ...await importOriginal<typeof import('../services/proxyPeerGroup')>(),
  loadProxyPeerGroup: mocks.loadProxyPeerGroup,
}));
vi.mock('../services/secApi', async importOriginal => ({
  ...await importOriginal<typeof import('../services/secApi')>(),
  getCompanyDirectory: mocks.getCompanyDirectory,
  loadTickerMap: vi.fn(async () => ({})),
}));
vi.mock('../services/peerSizing', async importOriginal => ({
  ...await importOriginal<typeof import('../services/peerSizing')>(),
  loadCompanySizes: mocks.loadCompanySizes,
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectory: vi.fn(async () => [{ code: '3571', office: 'Office of Technology', title: 'Electronic Computers' }]),
}));

import PeerGroupBuilder from '../components/research/PeerGroupBuilder';
import { sicPeerFixtures } from './peerGroupBuilderFixtures';

const proxyOutcome: ProxyPeerGroupOutcome = {
  ok: true,
  group: {
    subject: { cik: '320193', name: 'Apple Inc.' },
    filing: {
      form: 'DEF 14A',
      filingDate: '2026-01-08',
      reportDate: '',
      accessionNumber: '0001308179-26-000008',
      primaryDocument: 'aapl4359751-def14a.htm',
      cik: '320193',
      documentUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000130817926000008/aapl4359751-def14a.htm',
      indexUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000130817926000008/',
    },
    method: 'table',
    anchorText: 'The chart below lists the companies in our 2025 primary peer group.',
    peers: [
      { ticker: 'CSCO', cik: '858877', title: 'Cisco Systems, Inc.', match: 'name-prefix', disclosedName: 'Cisco', group: '2025 Primary Peer Group', accession: '0001308179-26-000008' },
      { ticker: 'MSFT', cik: '789019', title: 'MICROSOFT CORP', match: 'exact-name', disclosedName: 'Microsoft', group: '2025 Primary Peer Group', accession: '0001308179-26-000008' },
    ],
    unresolved: [
      { disclosedName: 'Samsung Electronics', group: '2025 Primary Peer Group', tickerHint: null, reason: 'no-match', candidates: [], accession: '0001308179-26-000008' },
    ],
    listsSubject: false,
    discardedModelNames: [],
  },
};

function size(cik: string, float: number): CompanySize {
  return {
    cik,
    status: 'read',
    publicFloat: { value: float, currency: 'USD', asOf: '2025-06-30', accession: `000000000${cik}-26-000001`, form: '10-K', filed: '2026-02-01', concept: 'dei:EntityPublicFloat' },
    revenue: null,
  };
}

describe('PeerGroupBuilder', () => {
  beforeEach(() => {
    mocks.loadProxyPeerGroup.mockReset().mockResolvedValue(proxyOutcome);
    mocks.getCompanyDirectory.mockReset().mockResolvedValue(sicPeerFixtures.directory);
    mocks.loadCompanySizes.mockReset().mockImplementation(async (ciks: string[], options: { onSize?: (s: CompanySize) => void }) => {
      const floats: Record<string, number> = { '320193': 100e9, '1571996': 80e9, '1375365': 15e9, '926326': 1.3e9 };
      const map = new Map<string, CompanySize>();
      for (const cik of ciks) {
        const s = size(cik, floats[cik] ?? 0);
        map.set(cik, s);
        options.onSize?.(s);
      }
      return map;
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/peer-candidates')) {
        return new Response(JSON.stringify(sicPeerFixtures.route), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }));
  });

  it('shows the proxy group with counts and citation, and adds with provenance', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <PeerGroupBuilder seedTicker="AAPL" seedCik="320193" sicCode="3571" onSicChange={() => {}}
        selectedTickers={['AAPL', 'MSFT']} maxTickers={20} sources={{}} onAdd={onAdd} />,
    );

    await user.click(screen.getByRole('button', { name: "Read AAPL's DEF 14A" }));
    const column = screen.getByRole('region', { name: 'From proxy' });
    await waitFor(() => expect(within(column).getByText('(2 resolved, 1 unresolved)')).toBeInTheDocument());
    expect(within(column).getByRole('link', { name: 'DEF 14A filed 2026-01-08 · 0001308179-26-000008' }))
      .toHaveAttribute('href', proxyOutcome.ok ? proxyOutcome.group.filing.documentUrl : '');
    expect(within(column).getByText("Read from the proxy's peer table")).toBeInTheDocument();
    expect(within(column).getByText('1 named but not matched to a listed registrant')).toBeInTheDocument();
    // Already selected: shown as such, not addable again.
    expect(within(column).getByRole('button', { name: 'MSFT is in the peer set' })).toBeDisabled();

    await user.click(within(column).getByRole('button', { name: 'Add all (1)' }));
    expect(onAdd).toHaveBeenCalledWith([{
      ticker: 'CSCO',
      source: {
        kind: 'proxy',
        subjectTicker: 'AAPL',
        accession: '0001308179-26-000008',
        filingDate: '2026-01-08',
        disclosedName: 'Cisco',
        group: '2025 Primary Peer Group',
        method: 'table',
        match: 'name-prefix',
      },
    }]);
  });

  it('ranks the SIC population by public float against the seed and adds the in-band peers', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <PeerGroupBuilder seedTicker="AAPL" seedCik="320193" sicCode="3571" onSicChange={() => {}}
        selectedTickers={['AAPL']} maxTickers={20} sources={{}} onAdd={onAdd} />,
    );
    const column = screen.getByRole('region', { name: 'Same SIC, sized like AAPL' });
    await user.click(within(column).getByRole('button', { name: 'Find' }));

    const list = await within(column).findByRole('list', { name: 'Same-SIC candidates, closest in size first' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('DELL'),
      expect.stringContaining('SMCI'),
      expect.stringContaining('OMCL'),
    ]);
    expect(rows[0]).toHaveTextContent('0.80x');
    expect(within(column).getByText(/3 other registrants with a ticker in SIC 3571 \(Electronic Computers\)/)).toBeInTheDocument();
    // The seed is read along with the candidates, nearest-ranked first.
    expect(mocks.loadCompanySizes.mock.calls[0][0]).toEqual(['320193', '1571996', '1375365', '926326']);

    await user.click(within(column).getByRole('button', { name: 'Add in band (1)' }));
    expect(onAdd).toHaveBeenCalledWith([{
      ticker: 'DELL',
      source: {
        kind: 'sic',
        sic: '3571',
        seedTicker: 'AAPL',
        band: { metric: 'publicFloat', low: 0.5, high: 2, ratio: 0.8, asOf: '2025-06-30', accession: '0000000001571996-26-000001' },
      },
    }]);
  });

  it('says why each selected company is there', () => {
    render(
      <PeerGroupBuilder seedTicker="AAPL" seedCik="320193" sicCode="" onSicChange={() => {}}
        selectedTickers={['AAPL', 'CSCO', 'IBM']} maxTickers={3}
        sources={{
          CSCO: proxyOutcome.ok ? { kind: 'proxy', subjectTicker: 'AAPL', accession: '0001308179-26-000008', filingDate: '2026-01-08', disclosedName: 'Cisco', group: '', method: 'table', match: 'name-prefix' } : { kind: 'manual' },
          IBM: { kind: 'manual' },
        }}
        onAdd={() => {}} />,
    );
    const manual = screen.getByRole('region', { name: 'Manual' });
    expect(within(manual).getByText('Source not recorded')).toBeInTheDocument();
    expect(within(manual).getByText(/Named in AAPL's DEF 14A filed 2026-01-08 \(0001308179-26-000008\) as "Cisco"/)).toBeInTheDocument();
    expect(within(manual).getByText('Added manually')).toBeInTheDocument();
    expect(screen.getByText('The comparison is full; remove a company to add another.')).toBeInTheDocument();
  });
});
