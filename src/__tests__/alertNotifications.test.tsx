import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Packer } from 'docx';
import JSZip from 'jszip';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import AlertBell from '../components/alerts/AlertBell';
import AlertsDigest from '../views/AlertsDigest';
import {
  groupHitsByAlert,
  hitToCitation,
  parseAlertHitsPage,
  resetAlertHitsForTests,
  setAlertHitsFetchForTests,
  viewerPathForHit,
  type AlertHit,
} from '../services/alertHits';
import { buildAlertDigestDocument, summarizeDigest } from '../services/alertDigestExport';

function hit(overrides: Partial<AlertHit> = {}): AlertHit {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    alertClientKey: 'alert-mw',
    alertName: 'Material weakness',
    accession: '0000320193-26-000001',
    cik: '0000320193',
    company: 'Apple Inc.',
    form: '10-K',
    filedAt: '2026-10-03',
    periodEnding: '2026-09-27',
    document: 'aapl-2026.htm',
    sectionPath: 'Item 9A · Controls and Procedures',
    passage: 'Management identified a material weakness in internal control over financial reporting.',
    passageBasis: 'validated-text',
    isAmendment: false,
    amendsAccession: null,
    seenAt: null,
    createdAt: '2026-10-04T08:00:00.000Z',
    ...overrides,
  };
}

const HITS: AlertHit[] = [
  hit(),
  hit({
    id: '00000000-0000-4000-8000-000000000002',
    accession: '0000789019-26-000002',
    cik: '789019',
    company: 'Microsoft Corporation',
    passage: '',
    passageBasis: 'not-read',
    sectionPath: '',
  }),
  hit({
    id: '00000000-0000-4000-8000-000000000003',
    alertClientKey: 'alert-leases',
    alertName: 'ASC 842 leases',
    accession: '0000320193-26-000009',
    form: '10-K/A',
    isAmendment: true,
    amendsAccession: '0000320193-26-000001',
  }),
];

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };
let handler: Handler;
const calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  resetAlertHitsForTests();
  calls.length = 0;
  handler = () => ({ status: 200, body: { ok: true, total: HITS.length, unseen: 2, unseenAmendments: 1, byAlert: { 'alert-mw': 2 }, hits: HITS } });
  setAlertHitsFetchForTests(async (url, init) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => resetAlertHitsForTests());

describe('alert hit helpers', () => {
  it('groups by alert, links to the viewer and quotes only validated text', () => {
    expect(groupHitsByAlert(HITS).map(group => [group.alertName, group.hits.length])).toEqual([
      ['Material weakness', 2],
      ['ASC 842 leases', 1],
    ]);
    expect(viewerPathForHit(HITS[0])).toBe('/filing/320193_0000320193-26-000001_aapl-2026.htm');
    expect(viewerPathForHit({ ...HITS[0], document: '' })).toBeNull();
    expect(hitToCitation(HITS[0])).toMatchObject({ excerpt: HITS[0].passage, section: 'Item 9A · Controls and Procedures', cik: '320193' });
    expect(hitToCitation(HITS[1]).excerpt).toBe('');
  });

  it('drops malformed wire rows', () => {
    const page = parseAlertHitsPage({ total: 2, unseen: 1, hits: [HITS[0], { id: 'x', accession: 'bad' }], byAlert: { a: 2, b: 0 } });
    expect(page.hits).toHaveLength(1);
    expect(page.byAlert).toEqual({ a: 2 });
  });
});

describe('AlertBell', () => {
  it('shows the unread count and lists new hits grouped by alert with their passages', async () => {
    render(<AlertBell />);
    const trigger = await screen.findByRole('button', { name: /alert notifications \(2 new hits\)/i });
    fireEvent.click(trigger);
    const panel = await screen.findByRole('complementary', { name: 'Alert notifications' });
    await within(panel).findAllByText('Apple Inc.');
    expect(within(panel).getByRole('region', { name: 'Material weakness: 2 new' })).toBeInTheDocument();
    expect(within(panel).getAllByText(/Management identified a material weakness/)).toHaveLength(2);
    expect(within(panel).getByText(/its text was not read, so no passage is quoted/)).toBeInTheDocument();
    expect(within(panel).getByText(/Amendment of accession 0000320193-26-000001/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('link', { name: /Open in viewer/ })[0]).toHaveAttribute('href', '/filing/320193_0000320193-26-000001_aapl-2026.htm');
    expect(within(panel).getAllByRole('button', { name: /^Cite / }).length).toBe(3);
    expect(within(panel).getAllByRole('checkbox', { name: /document cart/ }).length).toBe(3);
  });

  it('marks one hit seen through the API', async () => {
    render(<AlertBell />);
    fireEvent.click(await screen.findByRole('button', { name: /alert notifications/i }));
    const button = await screen.findByRole('button', { name: 'Mark Apple Inc. 10-K as seen' });
    handler = (_url, init) => (init?.method === 'PUT'
      ? { status: 200, body: { ok: true, marked: 1 } }
      : { status: 200, body: { ok: true, total: 2, unseen: 1, unseenAmendments: 1, byAlert: {}, hits: HITS.slice(1) } });
    await act(async () => { fireEvent.click(button); });
    const put = calls.find(call => call.init?.method === 'PUT');
    expect(put?.url).toBe('/api/user/alert-hits');
    expect(JSON.parse(String(put?.init?.body))).toEqual({ hitIds: [HITS[0].id] });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark Apple Inc. 10-K as seen' })).toBeNull());
  });

  it('stays hidden when notifications are unavailable', async () => {
    handler = () => ({ status: 503, body: { ok: false, errorClass: 'unavailable', error: 'not provisioned' } });
    const { container } = render(<AlertBell />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('AlertsDigest', () => {
  it('summarises the last 24 hours across alerts and switches to 7 days', async () => {
    const now = Date.parse('2026-10-04T12:00:00.000Z');
    render(<AlertsDigest now={() => now} />);
    expect(await screen.findByText('3 hits in the last 24 hours')).toBeInTheDocument();
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
    expect(screen.getByText('1 amendment')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ASC 842 leases/ })).toBeInTheDocument();
    expect(calls[0].url).toContain(`since=${encodeURIComponent('2026-10-03T12:00:00.000Z')}`);

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(calls.at(-1)?.url).toContain(`since=${encodeURIComponent('2026-09-27T12:00:00.000Z')}`));
  });

  it('explains when notifications are unavailable', async () => {
    handler = () => ({ status: 503, body: { ok: false, errorClass: 'unavailable', error: 'not provisioned' } });
    render(<AlertsDigest />);
    expect(await screen.findByText('Alert notifications are not available for this session.')).toBeInTheDocument();
  });
});

describe('Word digest', () => {
  it('builds a document with one table per alert, passages, links and the method note', async () => {
    const document = buildAlertDigestDocument({
      window: '24h',
      generatedAt: new Date('2026-10-04T12:00:00.000Z'),
      author: 'Sandy Analyst',
      hits: HITS,
      total: 5,
    });
    const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
    const xml = await zip.file('word/document.xml')!.async('string');
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const text = Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(match => match[1]).join('');
    expect(text).toContain('Alert digest — last 24 hours');
    expect(text).toContain('Sandy Analyst');
    expect(text).toContain('first 3 of 5 hits');
    expect(text).toContain('Material weakness');
    expect(text).toContain('ASC 842 leases');
    expect(text).toContain('Management identified a material weakness');
    expect(text).toContain('its text was not read, so no passage is quoted');
    expect(text).toContain('amends 0000320193-26-000001');
    expect(text).toContain('Method');
    expect(rels).toContain('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm');
    expect(summarizeDigest(HITS)).toEqual({ hits: 3, alerts: 2, newFilings: 2, amendments: 1, unseen: 3 });
  });
});
