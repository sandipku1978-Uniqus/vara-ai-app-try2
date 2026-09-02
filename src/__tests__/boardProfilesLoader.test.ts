import { beforeEach, describe, expect, it, vi } from 'vitest';

const secApi = vi.hoisted(() => ({
  lookupCIKFlexible: vi.fn(),
  getCompanyDirectory: vi.fn(),
  fetchCompanySubmissions: vi.fn(),
  fetchFilingTextOutcome: vi.fn(),
}));

const aiApi = vi.hoisted(() => ({
  aiExtractBoardData: vi.fn(),
}));

vi.mock('../services/secApi', async importOriginal => ({
  ...await importOriginal<typeof import('../services/secApi')>(),
  lookupCIKFlexible: secApi.lookupCIKFlexible,
  getCompanyDirectory: secApi.getCompanyDirectory,
  fetchCompanySubmissions: secApi.fetchCompanySubmissions,
  fetchFilingTextOutcome: secApi.fetchFilingTextOutcome,
}));

vi.mock('../services/aiApi', () => ({
  aiExtractBoardData: aiApi.aiExtractBoardData,
}));

import { __clearBoardProfileCache, loadBoardProfile, normalizeBoardData } from '../services/boardProfiles';
import type { SecSubmission } from '../services/secApi';

/**
 * One loader now serves the target company and every comparison column. Each
 * way it can stop must come back as the specific thing that happened — the
 * audit's complaint was that all of them rendered as "not found in EDGAR".
 */

const CIK = '0000320193';

function submissions(overrides: Partial<SecSubmission> = {}): SecSubmission {
  return {
    cik: '320193',
    name: 'Apple Inc.',
    tickers: ['AAPL'],
    exchanges: ['Nasdaq'],
    ein: '',
    description: '',
    sic: '3571',
    sicDescription: 'Electronic Computers',
    fiscalYearEnd: '0927',
    filings: {
      recent: {
        accessionNumber: ['0000320193-26-000001', '0000320193-25-000009', '0000320193-25-000004'],
        filingDate: ['2026-01-09', '2025-10-31', '2025-01-10'],
        reportDate: ['2026-02-24', '2025-09-27', '2025-02-25'],
        acceptanceDateTime: ['', '', ''],
        act: ['34', '34', '34'],
        form: ['DEF 14A', '10-K', 'DEF 14A'],
        fileNumber: ['001-36743', '001-36743', '001-36743'],
        primaryDocument: ['aapl-2026-proxy.htm', 'aapl-20250927.htm', 'aapl-2025-proxy.htm'],
        primaryDocDescription: ['', '', ''],
      },
      files: [],
    },
    ...overrides,
  };
}

const PROXY_TEXT = 'Proxy statement for the 2026 annual meeting of shareholders. '.repeat(20);

const BOARD = {
  directors: [{ name: 'Arthur D. Levinson', role: 'Chair', independent: true, committees: [] as string[] }],
  compensation: [],
  boardSize: 8,
  independencePercent: 88,
  diversity: { malePercent: 62.5, femalePercent: 37.5, maleCount: null, femaleCount: 3 },
  ceoPayRatio: '1,447:1',
  sayOnPayApproval: '93%',
};

function failure(outcome: Awaited<ReturnType<typeof loadBoardProfile>>) {
  if (outcome.ok) throw new Error('expected a failure outcome');
  return outcome;
}

describe('loadBoardProfile', () => {
  beforeEach(() => {
    __clearBoardProfileCache();
    vi.clearAllMocks();
    secApi.getCompanyDirectory.mockResolvedValue([{ cik: '320193', ticker: 'AAPL', title: 'Apple Inc.' }]);
    secApi.lookupCIKFlexible.mockResolvedValue(CIK);
    secApi.fetchCompanySubmissions.mockResolvedValue(submissions());
    secApi.fetchFilingTextOutcome.mockResolvedValue({ ok: true, text: PROXY_TEXT });
    aiApi.aiExtractBoardData.mockResolvedValue(BOARD);
  });

  it('distinguishes a directory that failed to load from a ticker the directory does not have', async () => {
    secApi.lookupCIKFlexible.mockResolvedValue(null);

    secApi.getCompanyDirectory.mockResolvedValueOnce([]);
    expect(failure(await loadBoardProfile('zzzz')).failure).toEqual({ kind: 'lookup-failed', stage: 'directory', ticker: 'ZZZZ' });

    expect(failure(await loadBoardProfile('ZZZZ')).failure).toEqual({ kind: 'ticker-unknown', ticker: 'ZZZZ' });
    expect(secApi.fetchCompanySubmissions).not.toHaveBeenCalled();
  });

  it('a submissions outage is a lookup failure, not an absent proxy', async () => {
    secApi.fetchCompanySubmissions.mockResolvedValue(null);
    const outcome = failure(await loadBoardProfile('AAPL'));
    expect(outcome.failure).toEqual({ kind: 'lookup-failed', stage: 'submissions', ticker: 'AAPL', cik: CIK });
    expect(outcome.companyData).toBeNull();
    expect(secApi.fetchFilingTextOutcome).not.toHaveBeenCalled();
    expect(aiApi.aiExtractBoardData).not.toHaveBeenCalled();
  });

  it('no DEF 14A in the recent window is reported with the window that was checked, and keeps the issuer', async () => {
    const withoutProxy = submissions();
    withoutProxy.filings.recent.form = ['DEFA14A', '10-K', 'PRE 14A'];
    secApi.fetchCompanySubmissions.mockResolvedValue(withoutProxy);

    const outcome = failure(await loadBoardProfile('AAPL'));
    expect(outcome.failure).toEqual({
      kind: 'no-proxy',
      ticker: 'AAPL',
      cik: CIK,
      companyName: 'Apple Inc.',
      window: { count: 3, from: '2025-01-10', to: '2026-01-09' },
    });
    expect(outcome.companyData?.name).toBe('Apple Inc.');
    expect(secApi.fetchFilingTextOutcome).not.toHaveBeenCalled();
  });

  it('a 404 or unsupported document is unreadable; a rate limit, timeout, or upstream error is a retryable lookup failure', async () => {
    const filing = {
      form: 'DEF 14A',
      filingDate: '2026-01-09',
      reportDate: '2026-02-24',
      accessionNumber: '0000320193-26-000001',
      primaryDocument: 'aapl-2026-proxy.htm',
    };

    secApi.fetchFilingTextOutcome.mockResolvedValueOnce({ ok: false, kind: 'not-found', status: 404, retryable: false });
    expect(failure(await loadBoardProfile('AAPL')).failure)
      .toEqual({ kind: 'proxy-unreadable', ticker: 'AAPL', cik: CIK, filing, reason: 'not-found', status: 404 });

    secApi.fetchFilingTextOutcome.mockResolvedValueOnce({ ok: false, kind: 'unsupported', status: 415, retryable: false });
    expect(failure(await loadBoardProfile('AAPL')).failure).toMatchObject({ kind: 'proxy-unreadable', reason: 'unsupported' });

    secApi.fetchFilingTextOutcome.mockResolvedValueOnce({ ok: false, kind: 'rate-limit', status: 429, retryable: true });
    expect(failure(await loadBoardProfile('AAPL')).failure)
      .toEqual({ kind: 'lookup-failed', stage: 'proxy-text', ticker: 'AAPL', cik: CIK, filing, transport: 'rate-limit', status: 429 });

    secApi.fetchFilingTextOutcome.mockResolvedValueOnce({ ok: false, kind: 'timeout', retryable: true });
    expect(failure(await loadBoardProfile('AAPL')).failure).toMatchObject({ kind: 'lookup-failed', stage: 'proxy-text', transport: 'timeout' });

    secApi.fetchFilingTextOutcome.mockResolvedValueOnce({ ok: false, kind: 'upstream', status: 503, retryable: true });
    expect(failure(await loadBoardProfile('AAPL')).failure).toMatchObject({ kind: 'lookup-failed', stage: 'proxy-text', transport: 'upstream' });

    expect(aiApi.aiExtractBoardData).not.toHaveBeenCalled();
  });

  it('a document too short to be a proxy is unreadable, not an extraction failure', async () => {
    secApi.fetchFilingTextOutcome.mockResolvedValueOnce({ ok: true, text: '<html>Moved</html>' });
    expect(failure(await loadBoardProfile('AAPL')).failure).toMatchObject({ kind: 'proxy-unreadable', reason: 'too-short' });
    expect(aiApi.aiExtractBoardData).not.toHaveBeenCalled();
  });

  it('an extraction that yields nothing is an extraction failure, after the extractor was given the proxy text', async () => {
    aiApi.aiExtractBoardData.mockResolvedValueOnce(null);
    const outcome = failure(await loadBoardProfile('AAPL'));
    expect(outcome.failure).toMatchObject({ kind: 'extraction-failed', ticker: 'AAPL', cik: CIK });
    expect(outcome.companyData?.name).toBe('Apple Inc.');
    expect(aiApi.aiExtractBoardData).toHaveBeenCalledWith(PROXY_TEXT);

    aiApi.aiExtractBoardData.mockResolvedValueOnce({ directors: [], compensation: [], boardSize: null });
    expect(failure(await loadBoardProfile('AAPL')).failure).toMatchObject({ kind: 'extraction-failed' });
  });

  it('a profile carries the latest DEF 14A, its SEC links, and attribution from the filing dates and fiscal year-end', async () => {
    const outcome = await loadBoardProfile('aapl');
    if (!outcome.ok) throw new Error(`unexpected failure ${outcome.failure.kind}`);

    expect(secApi.fetchFilingTextOutcome).toHaveBeenCalledWith(CIK, '0000320193-26-000001', 'aapl-2026-proxy.htm');
    expect(outcome.profile.ticker).toBe('AAPL');
    expect(outcome.profile.cik).toBe(CIK);
    expect(outcome.profile.source).toEqual({
      form: 'DEF 14A',
      filingDate: '2026-01-09',
      reportDate: '2026-02-24',
      accessionNumber: '0000320193-26-000001',
      primaryDocument: 'aapl-2026-proxy.htm',
      cik: '320193',
      documentUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026-proxy.htm',
      indexUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm',
    });
    expect(outcome.profile.attribution).toEqual({
      meetingYear: 2026,
      meetingDate: '2026-02-24',
      meetingYearBasis: 'report-date',
      fiscalYear: 2025,
      fiscalYearEndDate: '2025-09-27',
      fiscalYearBasis: 'fiscal-year-end',
      latestPriorMeetingYear: 2025,
    });
    expect(outcome.profile.boardData.diversity).toEqual({ malePercent: 62.5, femalePercent: 37.5, maleCount: null, femaleCount: 3 });
    expect(outcome.profile.boardData.sayOnPayApproval).toBe('93%');
  });

  it('caches successes, shares an in-flight load between concurrent callers, and never caches a failure', async () => {
    aiApi.aiExtractBoardData.mockResolvedValueOnce(null);
    expect((await loadBoardProfile('AAPL')).ok).toBe(false);

    const [first, second] = await Promise.all([loadBoardProfile('AAPL'), loadBoardProfile('aapl')]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // One failed attempt, then one shared successful load.
    expect(aiApi.aiExtractBoardData).toHaveBeenCalledTimes(2);
    expect(secApi.fetchFilingTextOutcome).toHaveBeenCalledTimes(2);

    const cached = await loadBoardProfile('AAPL');
    expect(cached.ok).toBe(true);
    expect(aiApi.aiExtractBoardData).toHaveBeenCalledTimes(2);
    expect(secApi.fetchCompanySubmissions).toHaveBeenCalledTimes(2);
  });
});

describe('normalizeBoardData', () => {
  it('turns missing lists into empty lists and non-numbers into null — never 0', () => {
    expect(normalizeBoardData({ boardSize: '8', independencePercent: 75, diversity: { femalePercent: 50 } })).toEqual({
      directors: [],
      compensation: [],
      boardSize: null,
      independencePercent: 75,
      diversity: { malePercent: null, femalePercent: 50, maleCount: null, femaleCount: null },
      ceoPayRatio: null,
      sayOnPayApproval: null,
    });
  });

  it('treats placeholder strings as not stated', () => {
    for (const placeholder of ['N/A', 'n/a', 'NA', 'none', 'Not disclosed', 'not stated', '—', '-', 'null', 'unknown', '  ']) {
      expect(normalizeBoardData({ boardSize: 8, ceoPayRatio: placeholder, sayOnPayApproval: placeholder })?.ceoPayRatio).toBeNull();
    }
    expect(normalizeBoardData({ boardSize: 8, ceoPayRatio: '256:1' })?.ceoPayRatio).toBe('256:1');
  });

  it('keeps only well-formed director and officer rows', () => {
    const normalized = normalizeBoardData({
      directors: [
        { name: 'Jane Doe', role: 'Lead Independent Director', independent: 'yes', committees: ['Audit', 3, ''] },
        { role: 'nameless' },
        'not a row',
      ],
      compensation: [{ name: 'John Roe', title: 'CFO', salary: '$900,000' }],
    });
    expect(normalized?.directors).toEqual([{ name: 'Jane Doe', role: 'Lead Independent Director', independent: false, committees: ['Audit'] }]);
    expect(normalized?.compensation).toEqual([{ name: 'John Roe', title: 'CFO', salary: '$900,000', stockAwards: '', total: '' }]);
  });

  it('returns null when nothing usable survives', () => {
    expect(normalizeBoardData(null)).toBeNull();
    expect(normalizeBoardData('{}')).toBeNull();
    expect(normalizeBoardData([])).toBeNull();
    expect(normalizeBoardData({ directors: 'x', ceoPayRatio: 'N/A' })).toBeNull();
  });
});
