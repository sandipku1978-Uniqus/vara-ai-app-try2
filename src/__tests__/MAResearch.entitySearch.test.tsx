import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression for the onsemi / Synaptics miss (2026-08-22): the M&A screener
 * fetched 64 deal filings for "Onsemi" and rendered "No M&A filings found",
 * because a leftover client-side filter re-checked server results against
 * the FILER'S NAME — and counterparty filings carry the other company's name.
 */

const searchEdgarFilings = vi.hoisted(() => vi.fn());
const resolveEntityScope = vi.hoisted(() => vi.fn());

vi.mock('../services/secApi', () => ({
  searchEdgarFilings,
  fetchFilingText: vi.fn(async () => ''),
  buildSecFilingIndexUrl: () => 'https://www.sec.gov/',
  getCompanyDirectory: vi.fn(async () => []),
  computeCompanySuggestions: () => [],
}));
vi.mock('../services/filingResearch', () => ({ resolveEntityScope }));
vi.mock('../services/aiApi', () => ({ aiExtractDealDetails: vi.fn(), aiExtractClauses: vi.fn() }));
vi.mock('../components/tables/AIResultsSummary', () => ({ default: () => null }));
vi.mock('../components/tables/ResultsToolbar', () => ({ default: () => null }));
vi.mock('../components/tables/AskCopilotButton', () => ({ default: () => null }));

import MAResearch from '../views/MAResearch';

function hit(name: string, cik: string, adsh: string, form: string, date: string) {
  return {
    _id: `${adsh}:${adsh.replace(/-/g, '')}_${form.toLowerCase()}.htm`,
    _score: 1,
    _source: { display_names: [`${name}  (CIK ${cik})`], ciks: [cik], adsh, form, file_type: form, file_date: date },
  };
}

const FEED = [
  hit('Newbury Street II Acquisition Corp', '0001000001', '0001000001-26-000001', '8-K', '2026-08-18'),
  hit('AEVEX Corp.', '0001000002', '0001000002-26-000002', '8-K', '2026-08-12'),
];
// What EDGAR actually returns for the bare word "Onsemi": the target's 425s
// and the acquirer's own 8-K — neither filer name contains "onsemi".
const ONSEMI_TEXT_HITS = [
  hit('SYNAPTICS Inc  (SYNA)', '0000817720', '0001140361-26-026398', '425', '2026-06-25'),
  hit('ON SEMICONDUCTOR CORP  (ON)', '0001097864', '0001140361-26-026395', '8-K', '2026-06-25'),
];

describe('M&A screener: company search keeps counterparty filings', () => {
  beforeEach(() => {
    searchEdgarFilings.mockReset();
    resolveEntityScope.mockReset();
    searchEdgarFilings.mockImplementation(async (query: string) =>
      query === 'merger agreement OR acquisition' ? FEED : ONSEMI_TEXT_HITS
    );
  });

  it('renders full-text deal hits whose filer name does not contain the typed text', async () => {
    resolveEntityScope.mockResolvedValue({ entityName: '', cik: '', query: 'Onsemi' });
    const user = userEvent.setup();
    render(<MAResearch />);
    await screen.findByText(/Newbury Street II/);

    await user.type(screen.getByRole('combobox', { name: 'Filter M&A filings by entity name' }), 'Onsemi{Enter}');

    // The target's Form 425 about the onsemi deal must survive: its filer is
    // Synaptics, and the typed word lives in the document, not the name.
    expect(await screen.findByText(/SYNAPTICS Inc/)).toBeInTheDocument();
    expect(screen.getByText(/ON SEMICONDUCTOR CORP/)).toBeInTheDocument();
    expect(screen.queryByText('No M&A filings found.')).not.toBeInTheDocument();
  });

  it('runs both sides of a resolved company: the issuer lane and the counterparty text lane', async () => {
    resolveEntityScope.mockResolvedValue({ entityName: 'ON SEMICONDUCTOR CORP', cik: '1097864', query: '' });
    searchEdgarFilings.mockImplementation(async (query: string, _forms: string, _from: string, _to: string, _entity?: string, _max?: number, extended?: { entityCik?: string }) => {
      if (query === 'merger agreement OR acquisition' && extended?.entityCik === '1097864') return [ONSEMI_TEXT_HITS[1]];
      if (query === '"ON SEMICONDUCTOR"') return [ONSEMI_TEXT_HITS[0]];
      return FEED;
    });
    const user = userEvent.setup();
    render(<MAResearch />);
    await screen.findByText(/Newbury Street II/);

    await user.type(screen.getByRole('combobox', { name: 'Filter M&A filings by entity name' }), 'onsemi{Enter}');

    expect(await screen.findByText(/ON SEMICONDUCTOR CORP/)).toBeInTheDocument();
    expect(screen.getByText(/SYNAPTICS Inc/)).toBeInTheDocument();
    const calls = searchEdgarFilings.mock.calls.map(call => ({ query: call[0], entityCik: call[6]?.entityCik }));
    expect(calls).toContainEqual({ query: 'merger agreement OR acquisition', entityCik: '1097864' });
    // The counterparty lane searches the resolved NAME phrase, never the typed
    // text: picking a suggestion hands the view the ticker, and "ON" as full
    // text would match every filing containing the word.
    expect(calls).toContainEqual({ query: '"ON SEMICONDUCTOR"', entityCik: undefined });
    expect(calls.map(call => call.query)).not.toContain('onsemi');
  });

  it('a prolific filer cannot starve the counterparty lane out of the row cap', async () => {
    resolveEntityScope.mockResolvedValue({ entityName: 'DOMINION ENERGY, INC', cik: '715957', query: '' });
    // The issuer lane alone exceeds the 30-row cap (a Form 425 nearly every day).
    const issuerStorm = Array.from({ length: 40 }, (_, i) =>
      hit('DOMINION ENERGY, INC  (D)', '0000715957', `0000715957-26-${String(100 + i).padStart(6, '0')}`, '425', `2026-07-${String(1 + (i % 28)).padStart(2, '0')}`)
    );
    const counterparty = [
      hit('NEXTERA ENERGY INC  (NEE)', '0000753308', '0000753308-26-000001', '8-K', '2026-05-18'),
      hit('NEXTERA ENERGY INC  (NEE)', '0000753308', '0000753308-26-000002', 'S-4', '2026-08-11'),
    ];
    searchEdgarFilings.mockImplementation(async (query: string, _f: string, _a: string, _b: string, _e?: string, _m?: number, extended?: { entityCik?: string }) => {
      if (extended?.entityCik === '715957') return issuerStorm;
      if (query === '"DOMINION ENERGY"') return counterparty;
      return FEED;
    });
    const user = userEvent.setup();
    render(<MAResearch />);
    await screen.findByText(/Newbury Street II/);

    await user.type(screen.getByRole('combobox', { name: 'Filter M&A filings by entity name' }), 'Dominion Energy{Enter}');

    // Both NextEra filings survive the cap; concatenation would have dropped them.
    expect(await screen.findAllByText(/NEXTERA ENERGY INC/)).toHaveLength(2);
    expect(screen.getAllByText(/DOMINION ENERGY, INC/).length).toBeGreaterThanOrEqual(20);
  });

  it('discovers the counterparty from the issuer filings metadata and runs a scoped lane for it', async () => {
    resolveEntityScope.mockResolvedValue({ entityName: 'DOMINION ENERGY, INC', cik: '715957', query: '' });
    // Dominion's own 425s carry NextEra's CIK alongside its own.
    const dominion425s = Array.from({ length: 6 }, (_, i) => ({
      ...hit('DOMINION ENERGY, INC  (D)', '0000715957', `0000715957-26-00020${i}`, '425', `2026-08-0${1 + i}`),
      _source: { ...hit('DOMINION ENERGY, INC  (D)', '0000715957', `0000715957-26-00020${i}`, '425', `2026-08-0${1 + i}`)._source, ciks: ['0000715957', '0000753308'] },
    }));
    const nextEraOwn = [hit('NEXTERA ENERGY INC  (NEE)', '0000753308', '0000753308-26-000009', 'S-4', '2026-08-11')];
    searchEdgarFilings.mockImplementation(async (query: string, _f: string, _a: string, _b: string, _e?: string, _m?: number, extended?: { entityCik?: string }) => {
      if (extended?.entityCik === '715957') return dominion425s;
      if (extended?.entityCik === '753308') return nextEraOwn;
      if (query === '"DOMINION ENERGY"') return []; // the name phrase returns nothing useful in a 425 storm
      return FEED;
    });
    const user = userEvent.setup();
    render(<MAResearch />);
    await screen.findByText(/Newbury Street II/);

    await user.type(screen.getByRole('combobox', { name: 'Filter M&A filings by entity name' }), 'Dominion Energy{Enter}');

    expect(await screen.findByText(/NEXTERA ENERGY INC/)).toBeInTheDocument();
    const scopedLanes = searchEdgarFilings.mock.calls.map(call => call[6]?.entityCik).filter(Boolean);
    expect(scopedLanes).toContain('753308');
  });

  it('discoverCounterpartCiks excludes the issuer, needs two sightings, caps at two', async () => {
    const { discoverCounterpartCiks } = await import('../views/MAResearch');
    const h = (ciks: string[]) => ({ _source: { ciks } });
    expect(discoverCounterpartCiks([h(['0000715957', '0000753308']), h(['0000715957', '0000753308'])], '715957')).toEqual(['753308']);
    expect(discoverCounterpartCiks([h(['0000715957', '0000999999'])], '715957')).toEqual([]); // one sighting is noise
    // '2' and '4' are seen three times, '3' twice — the cap keeps the two most frequent.
    expect(discoverCounterpartCiks([h(['1', '2', '3']), h(['1', '2', '3']), h(['1', '2', '4']), h(['1', '4']), h(['1', '4'])], '1')).toEqual(['2', '4']);
  });

  it('counterpartyPhrase strips corporate boilerplate and quotes the core name', async () => {
    const { counterpartyPhrase } = await import('../views/MAResearch');
    expect(counterpartyPhrase('ON SEMICONDUCTOR CORP')).toBe('"ON SEMICONDUCTOR"');
    expect(counterpartyPhrase('SYNAPTICS Inc')).toBe('"SYNAPTICS"');
    expect(counterpartyPhrase('Ferguson Enterprises Inc. /DE/')).toBe('"Ferguson Enterprises"');
    expect(counterpartyPhrase('Co')).toBe('');
  });

  it('still narrows the generic feed as the user types, before any search runs', async () => {
    const user = userEvent.setup();
    render(<MAResearch />);
    await screen.findByText(/AEVEX/);

    await user.type(screen.getByRole('combobox', { name: 'Filter M&A filings by entity name' }), 'Newbury');

    expect(screen.getByText(/Newbury Street II/)).toBeInTheDocument();
    expect(screen.queryByText(/AEVEX/)).not.toBeInTheDocument();
    expect(searchEdgarFilings).toHaveBeenCalledTimes(1); // feed only — no server search without Enter
  });
});
