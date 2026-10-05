import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import snapshotRows from './fixtures/company-tickers-snapshot.json';
import type { CompanyDirectoryEntry, SecSubmission } from '../services/secApi';
import {
  __clearProxyPeerGroupCache,
  buildPeerNameIndex,
  describeProxyPeerFailure,
  loadProxyPeerGroup,
  normalizeRegistrantName,
  peerMentionExcerpts,
  resolveExtractedPeers,
  resolvePeerName,
  verifyModelNames,
  type ProxyPeerLoaderDeps,
} from '../services/proxyPeerGroup';

/**
 * Name → registrant resolution runs against a real snapshot of SEC's
 * company_tickers.json; the loader runs against a real trimmed DEF 14A with
 * the network seams injected.
 */

const directory = snapshotRows as CompanyDirectoryEntry[];
const index = buildPeerNameIndex(directory);
const FIXTURES = join(process.cwd(), 'src', '__tests__', 'fixtures', 'proxies');

function ticker(name: string, tickerHint: string | null = null): string | null {
  const resolution = resolvePeerName(index, { name, tickerHint });
  return resolution.ok ? resolution.entry.ticker : null;
}

describe('normalizeRegistrantName', () => {
  it('reduces proxy and EDGAR spellings of one company to the same key', () => {
    expect(normalizeRegistrantName('The Procter & Gamble Company')).toBe(normalizeRegistrantName('PROCTER & GAMBLE Co'));
    expect(normalizeRegistrantName("McDonald's Corporation")).toBe(normalizeRegistrantName('MCDONALDS CORP'));
    expect(normalizeRegistrantName('QUALCOMM INC/DE')).toBe('qualcomm');
    expect(normalizeRegistrantName('Merck & Co., Inc.')).toBe('merck');
    expect(normalizeRegistrantName('Intl Business Machines Corp.')).toBe('international business machines');
    expect(normalizeRegistrantName('The J.M. Smucker Company')).toBe(normalizeRegistrantName('J M SMUCKER Co'));
  });
});

describe('resolvePeerName against the SEC directory snapshot', () => {
  it("resolves Apple's 2026 peer list, short names included", () => {
    const disclosed = ['Alphabet', 'Cisco', 'Mastercard', 'NVIDIA', 'Verizon', 'Amazon', 'Comcast', 'Meta', 'Oracle', 'Visa',
      'AT&T', 'Disney', 'Microsoft', 'Qualcomm', 'Warner Bros. Discovery', 'Broadcom', 'Intel', 'Netflix', 'Salesforce'];
    expect(disclosed.map(name => ticker(name))).toEqual([
      'GOOGL', 'CSCO', 'MA', 'NVDA', 'VZ', 'AMZN', 'CMCSA', 'META', 'ORCL', 'V',
      'T', 'DIS', 'MSFT', 'QCOM', 'WBD', 'AVGO', 'INTC', 'NFLX', 'CRM',
    ]);
  });

  it('labels how each name was matched', () => {
    const match = (name: string, hint: string | null = null) => {
      const resolution = resolvePeerName(index, { name, tickerHint: hint });
      return resolution.ok ? resolution.entry.match : resolution.reason;
    };
    expect(match('eBay', 'EBAY')).toBe('printed-ticker');
    expect(match('Hewlett Packard Enterprise')).toBe('exact-name');
    expect(match('IBM Corporation')).toBe('acronym');
    expect(match('Cisco')).toBe('name-prefix');
    expect(match('Disney')).toBe('name-words');
    expect(match('A.O. Smith Corporation')).toBe('name-words');
  });

  it('never guesses between comparable registrants and never invents one', () => {
    const small: CompanyDirectoryEntry[] = [
      { cik: '1', ticker: 'AAA', title: 'Acme Widgets Inc.' },
      { cik: '2', ticker: 'BBB', title: 'Acme Holdings Corp' },
      { cik: '3', ticker: 'CCC', title: 'Other Co' },
    ];
    const ambiguous = resolvePeerName(buildPeerNameIndex(small), { name: 'Acme', tickerHint: null });
    expect(ambiguous).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidates: [
        { ticker: 'AAA', cik: '1', title: 'Acme Widgets Inc.' },
        { ticker: 'BBB', cik: '2', title: 'Acme Holdings Corp' },
      ],
    });
    expect(resolvePeerName(index, { name: 'Nestlé S.A.', tickerHint: null })).toEqual({ ok: false, reason: 'no-match', candidates: [] });
  });

  it('treats share classes of one registrant as one company', () => {
    expect(resolvePeerName(index, { name: 'Alphabet Inc.', tickerHint: null })).toMatchObject({ ok: true, entry: { cik: '1652044' } });
  });
});

describe('resolveExtractedPeers', () => {
  it('carries the accession, keeps unresolved names, and drops the issuer itself', () => {
    const result = resolveExtractedPeers(index, [
      { name: 'Advanced Micro Devices, Inc.', tickerHint: null, group: 'Technology Peer Group' },
      { name: 'Intel Corporation', tickerHint: null, group: 'Technology Peer Group' },
      { name: 'Samsung Electronics', tickerHint: null, group: 'Technology Peer Group' },
      { name: 'AMD', tickerHint: 'AMD', group: 'Technology Peer Group' },
    ], '0000050863', '0000050863-26-000061');
    expect(result.listsSubject).toBe(true);
    expect(result.peers).toEqual([
      expect.objectContaining({ ticker: 'AMD', disclosedName: 'Advanced Micro Devices, Inc.', accession: '0000050863-26-000061', group: 'Technology Peer Group' }),
    ]);
    expect(result.unresolved).toEqual([
      expect.objectContaining({ disclosedName: 'Samsung Electronics', reason: 'no-match', accession: '0000050863-26-000061' }),
    ]);
  });
});

describe('model fallback guardrails', () => {
  it('keeps only names the proxy text contains', () => {
    const text = 'Our compensation peer group consists of Acme Widgets Inc. and Globex Corporation, among others.';
    expect(verifyModelNames(['Acme Widgets Inc.', 'Globex Corporation', 'Initech LLC', 42], text)).toEqual({
      accepted: [
        { name: 'Acme Widgets Inc.', tickerHint: null },
        { name: 'Globex Corporation', tickerHint: null },
      ],
      discarded: ['Initech LLC'],
    });
    expect(verifyModelNames({ not: 'a list' }, text)).toEqual({ accepted: [], discarded: [] });
  });

  it('sends the model only text around peer-group mentions', () => {
    const text = `${'x'.repeat(10_000)} our peer group includes several companies ${'y'.repeat(10_000)}`;
    const excerpts = peerMentionExcerpts(text, 200);
    expect(excerpts).toContain('peer group includes');
    expect(excerpts.length).toBeLessThan(1_000);
    expect(peerMentionExcerpts('No mention here at all.')).toBe('');
  });
});

function submissions(forms: string[], name = 'Apple Inc.'): SecSubmission {
  return {
    cik: '320193',
    name,
    tickers: ['AAPL'],
    exchanges: ['Nasdaq'],
    ein: '',
    description: '',
    sic: '3571',
    sicDescription: 'Electronic Computers',
    fiscalYearEnd: '0927',
    filings: {
      recent: {
        accessionNumber: forms.map((_, i) => `0001308179-26-00000${i}`),
        filingDate: forms.map((_, i) => `2026-01-0${i + 1}`),
        reportDate: forms.map(() => ''),
        acceptanceDateTime: forms.map(() => ''),
        act: forms.map(() => '34'),
        form: forms,
        fileNumber: forms.map(() => ''),
        primaryDocument: forms.map((_, i) => `doc${i}.htm`),
        primaryDocDescription: forms.map(() => ''),
      },
      files: [],
    },
  } as unknown as SecSubmission;
}

function deps(overrides: Partial<ProxyPeerLoaderDeps> = {}): ProxyPeerLoaderDeps {
  return {
    fetchSubmissions: vi.fn().mockResolvedValue(submissions(['10-K', 'DEF 14A'])),
    fetchDocument: vi.fn().mockResolvedValue({ ok: true, html: readFileSync(join(FIXTURES, 'apple-2026.html'), 'utf8') }),
    loadDirectory: vi.fn().mockResolvedValue(directory),
    askModel: vi.fn(),
    ...overrides,
  };
}

describe('loadProxyPeerGroup', () => {
  beforeEach(() => __clearProxyPeerGroupCache());

  it('reads the latest DEF 14A deterministically and cites it on every peer', async () => {
    const seams = deps();
    const outcome = await loadProxyPeerGroup('0000320193', seams);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.group.method).toBe('table');
    expect(outcome.group.filing).toMatchObject({ accessionNumber: '0001308179-26-000001', form: 'DEF 14A', cik: '320193' });
    expect(outcome.group.peers).toHaveLength(19);
    expect(outcome.group.peers.every(peer => peer.accession === '0001308179-26-000001')).toBe(true);
    expect(outcome.group.unresolved).toEqual([]);
    expect(seams.askModel).not.toHaveBeenCalled();
    expect(seams.fetchDocument).toHaveBeenCalledWith('320193', '0001308179-26-000001', 'doc1.htm');

    // Cached: a second request does not refetch.
    await loadProxyPeerGroup('320193', seams);
    expect(seams.fetchSubmissions).toHaveBeenCalledTimes(1);
  });

  it('falls back to the model only when no table or list is found, and labels the result', async () => {
    const html = `<html><body>
      <p>Compensation Peer Group</p>
      <p>In 2025 the committee benchmarked pay against a peer group that included Acme Widgets Inc. as well as
      Apple Inc. and, for retail roles, Walmart Inc.; it also referenced survey data.</p>
    </body></html>`;
    const askModel = vi.fn().mockResolvedValue(['Acme Widgets Inc.', 'Walmart Inc.', 'Costco Wholesale Corporation']);
    const outcome = await loadProxyPeerGroup('320193', deps({
      fetchDocument: vi.fn().mockResolvedValue({ ok: true, html }),
      askModel,
    }));
    expect(askModel).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.group.method).toBe('ai');
    expect(outcome.group.peers.map(peer => peer.ticker)).toEqual(['WMT']);
    expect(outcome.group.unresolved.map(peer => peer.disclosedName)).toEqual(['Acme Widgets Inc.']);
    expect(outcome.group.discardedModelNames).toEqual(['Costco Wholesale Corporation']);
  });

  it('reports each way it can stop distinctly, and does not cache failures', async () => {
    const noProxy = await loadProxyPeerGroup('320193', deps({ fetchSubmissions: vi.fn().mockResolvedValue(submissions(['10-K', '8-K'])) }));
    expect(noProxy).toMatchObject({ ok: false, failure: { kind: 'no-proxy', companyName: 'Apple Inc.' } });

    const unreadable = await loadProxyPeerGroup('320193', deps({ fetchDocument: vi.fn().mockResolvedValue({ ok: false, status: 429 }) }));
    expect(unreadable).toMatchObject({ ok: false, failure: { kind: 'proxy-unreadable', status: 429 } });
    if (!unreadable.ok) expect(describeProxyPeerFailure(unreadable.failure)).toMatch(/HTTP 429/);

    const modelDown = await loadProxyPeerGroup('320193', deps({
      fetchDocument: vi.fn().mockResolvedValue({ ok: true, html: '<p>The peer group is reviewed annually.</p>' }),
      askModel: vi.fn().mockRejectedValue(new Error('503')),
    }));
    expect(modelDown).toMatchObject({ ok: false, failure: { kind: 'no-peer-group', modelConsulted: true, modelFailed: true } });

    const silent = await loadProxyPeerGroup('320193', deps({
      fetchDocument: vi.fn().mockResolvedValue({ ok: true, html: '<p>Executive pay is set by the committee.</p>' }),
    }));
    expect(silent).toMatchObject({ ok: false, failure: { kind: 'no-peer-group', modelConsulted: false } });
    if (!silent.ok) expect(describeProxyPeerFailure(silent.failure)).toMatch(/does not disclose a compensation peer group/);

    const noDirectory = await loadProxyPeerGroup('320193', deps({ loadDirectory: vi.fn().mockResolvedValue([]) }));
    expect(noDirectory).toMatchObject({ ok: false, failure: { kind: 'directory-unavailable' } });
  });
});
