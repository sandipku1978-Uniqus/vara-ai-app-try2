import { describe, expect, it } from 'vitest';
import {
  attributeProxyFiling,
  describeBoardFailure,
  describeHeadcount,
  describeProxyAttribution,
  describeRecentFilingWindow,
  findLatestProxyFiling,
  parseFiscalYearEnd,
  resolveHeadcount,
  type BoardLoadFailure,
  type ProxyFilingRef,
} from '../lib/boardProxy';

/**
 * September 2026 audit, Board Profiles (High): the say-on-pay figure was
 * labelled with the meeting the proxy was filed BEFORE; headcounts were
 * rounded percentages presented as counts; every failure read "not found in
 * EDGAR". These rules are what the page now labels values with.
 */

const FILING: ProxyFilingRef = {
  form: 'DEF 14A',
  filingDate: '2026-04-10',
  reportDate: '2026-05-20',
  accessionNumber: '0000320193-26-000001',
  primaryDocument: 'aapl-proxy.htm',
};

describe('attributeProxyFiling', () => {
  it('a spring proxy with an EDGAR meeting date covers that meeting and the fiscal year that ended before it', () => {
    expect(attributeProxyFiling(FILING, '1231')).toEqual({
      meetingYear: 2026,
      meetingDate: '2026-05-20',
      meetingYearBasis: 'report-date',
      fiscalYear: 2025,
      fiscalYearEndDate: '2025-12-31',
      fiscalYearBasis: 'fiscal-year-end',
      latestPriorMeetingYear: 2025,
    });
  });

  it('ignores a period of report that precedes the filing date — a proxy is filed before its meeting', () => {
    const attribution = attributeProxyFiling({ filingDate: '2026-04-10', reportDate: '2025-12-31' }, '1231');
    expect(attribution?.meetingYear).toBe(2026);
    expect(attribution?.meetingYearBasis).toBe('filing-date');
    expect(attribution?.meetingDate).toBeNull();
  });

  it('derives the meeting year from the filing date when EDGAR lists no period, and says so', () => {
    for (const reportDate of ['', undefined, null, 'not-a-date']) {
      const attribution = attributeProxyFiling({ filingDate: '2026-04-10', reportDate }, '1231');
      expect(attribution?.meetingYear).toBe(2026);
      expect(attribution?.meetingYearBasis).toBe('filing-date');
    }
  });

  it('a December filing for a January meeting belongs to the meeting year, not the filing year', () => {
    const attribution = attributeProxyFiling({ filingDate: '2025-12-15', reportDate: '2026-01-20' }, '0930');
    expect(attribution).toMatchObject({
      meetingYear: 2026,
      meetingDate: '2026-01-20',
      fiscalYear: 2025,
      fiscalYearEndDate: '2025-09-30',
      latestPriorMeetingYear: 2025,
    });
  });

  it('names the fiscal year by the last year-end on or before the filing date (September filer, January proxy)', () => {
    const attribution = attributeProxyFiling({ filingDate: '2026-01-10', reportDate: '2026-02-24' }, '0927');
    expect(attribution).toMatchObject({ meetingYear: 2026, fiscalYear: 2025, fiscalYearEndDate: '2025-09-27' });
  });

  it('a June filer’s autumn proxy covers the fiscal year that ended that June', () => {
    const attribution = attributeProxyFiling({ filingDate: '2025-10-20', reportDate: '2025-12-05' }, '0630');
    expect(attribution).toMatchObject({ meetingYear: 2025, fiscalYear: 2025, fiscalYearEndDate: '2025-06-30', latestPriorMeetingYear: 2024 });
  });

  it('a proxy filed on the fiscal year-end day counts that year as completed', () => {
    const attribution = attributeProxyFiling({ filingDate: '2025-12-31' }, '1231');
    expect(attribution).toMatchObject({ fiscalYear: 2025, fiscalYearEndDate: '2025-12-31' });
  });

  it('assumes — and flags — a calendar year-end only when EDGAR lists none or lists nonsense', () => {
    for (const fiscalYearEnd of [undefined, null, '', '0000', 'abcd', '1332', '123']) {
      const attribution = attributeProxyFiling({ filingDate: '2026-04-10' }, fiscalYearEnd);
      expect(attribution).toMatchObject({ fiscalYear: 2025, fiscalYearEndDate: '2025-12-31', fiscalYearBasis: 'assumed-calendar-year-end' });
    }
    expect(parseFiscalYearEnd('0930')).toEqual({ month: 9, day: 30 });
    expect(parseFiscalYearEnd(930)).toBeNull();
  });

  it('clamps a 29 February year-end to 28 February in a non-leap year', () => {
    expect(attributeProxyFiling({ filingDate: '2025-06-01' }, '0229')).toMatchObject({ fiscalYear: 2025, fiscalYearEndDate: '2025-02-28' });
    expect(attributeProxyFiling({ filingDate: '2024-06-01' }, '0229')).toMatchObject({ fiscalYear: 2024, fiscalYearEndDate: '2024-02-29' });
  });

  it('returns null only when the filing date itself is unreadable', () => {
    expect(attributeProxyFiling({ filingDate: '2026-13-40' })).toBeNull();
    expect(attributeProxyFiling({ filingDate: '' })).toBeNull();
    expect(attributeProxyFiling({ filingDate: '2026-02-30' })).toBeNull();
  });
});

describe('describeProxyAttribution', () => {
  it('states the meeting, the fiscal year, and that say-on-pay is an earlier meeting’s vote', () => {
    const labels = describeProxyAttribution(attributeProxyFiling(FILING, '1231')!, FILING);
    expect(labels.meetingLabel).toBe('2026 annual meeting (meeting date 2026-05-20, EDGAR period of report)');
    expect(labels.fiscalLabel).toBe('fiscal 2025 (fiscal year ended 2025-12-31)');
    expect(labels.sayOnPayLabel).toContain('Reported in the DEF 14A for the 2026 annual meeting (filed 2026-04-10)');
    expect(labels.sayOnPayLabel).toContain('an annual meeting no later than 2025');
    expect(labels.sayOnPayLabel).toContain("not the 2026 meeting's vote");
    expect(labels.sayOnPayLabel).toContain('Form 8-K (Item 5.07)');
    expect(labels.sayOnPayShort).toBe(
      'Earlier vote (meeting no later than 2025) as reported in the 2026-meeting proxy filed 2026-04-10; not the 2026 meeting result.',
    );
  });

  it('says when the meeting year and the fiscal year are derived rather than listed by EDGAR', () => {
    const filing = { form: 'DEF 14A', filingDate: '2026-04-10' };
    const labels = describeProxyAttribution(attributeProxyFiling(filing)!, filing);
    expect(labels.meetingLabel).toBe('2026 annual meeting (year derived from the 2026-04-10 filing date; EDGAR lists no meeting date)');
    expect(labels.fiscalLabel).toBe('fiscal 2025 (calendar year-end assumed; EDGAR lists no fiscal year-end)');
  });
});

describe('resolveHeadcount', () => {
  it('a count the proxy states is disclosed, and wins over the percentage', () => {
    expect(resolveHeadcount(3, 37.5, 8)).toEqual({ kind: 'disclosed', count: 3, boardSize: 8 });
    expect(resolveHeadcount(3, null, null)).toEqual({ kind: 'disclosed', count: 3, boardSize: null });
    expect(resolveHeadcount(0, 0, 8)).toEqual({ kind: 'disclosed', count: 0, boardSize: 8 });
  });

  it('derives a headcount only when exactly one whole number rounds to the disclosed percentage', () => {
    expect(resolveHeadcount(null, 50, 8)).toEqual({ kind: 'derived', count: 4, percent: 50, boardSize: 8 });
    expect(resolveHeadcount(undefined, 33, 9)).toEqual({ kind: 'derived', count: 3, percent: 33, boardSize: 9 });
    expect(resolveHeadcount(null, 44.4, 9)).toEqual({ kind: 'derived', count: 4, percent: 44.4, boardSize: 9 });
    expect(resolveHeadcount(null, 36, 11)).toEqual({ kind: 'derived', count: 4, percent: 36, boardSize: 11 });
    expect(resolveHeadcount(null, 100, 7)).toEqual({ kind: 'derived', count: 7, percent: 100, boardSize: 7 });
  });

  it('refuses to invent a headcount when the percentage does not round from a whole number', () => {
    // The old page rendered Math.round(7 * 0.5) = 4 here, as a count.
    expect(resolveHeadcount(null, 50, 7)).toEqual({ kind: 'unavailable', reason: 'ambiguous', percent: 50, boardSize: 7 });
    expect(resolveHeadcount(null, 30, 8)).toEqual({ kind: 'unavailable', reason: 'ambiguous', percent: 30, boardSize: 8 });
  });

  it('needs a stated board size and a percentage inside 0–100', () => {
    expect(resolveHeadcount(null, 50, null)).toEqual({ kind: 'unavailable', reason: 'no-board-size', percent: 50, boardSize: null });
    expect(resolveHeadcount(null, 50, 0)).toEqual({ kind: 'unavailable', reason: 'no-board-size', percent: 50, boardSize: 0 });
    expect(resolveHeadcount(null, 50, 8.5)).toEqual({ kind: 'unavailable', reason: 'no-board-size', percent: 50, boardSize: null });
    expect(resolveHeadcount(null, null, 8)).toEqual({ kind: 'unavailable', reason: 'no-percent', percent: null, boardSize: 8 });
    expect(resolveHeadcount(null, 120, 8)).toEqual({ kind: 'unavailable', reason: 'no-percent', percent: null, boardSize: 8 });
    expect(resolveHeadcount(null, Number.NaN, 8)).toEqual({ kind: 'unavailable', reason: 'no-percent', percent: null, boardSize: 8 });
  });

  it('a fractional or negative "count" is not a count and does not become one', () => {
    expect(resolveHeadcount(3.5, 50, 8)).toEqual({ kind: 'derived', count: 4, percent: 50, boardSize: 8 });
    expect(resolveHeadcount(-1, 50, 8)).toEqual({ kind: 'derived', count: 4, percent: 50, boardSize: 8 });
  });
});

describe('describeHeadcount', () => {
  it('labels a disclosed count as disclosed', () => {
    expect(describeHeadcount({ kind: 'disclosed', count: 3, boardSize: 8 })).toBe('3 of 8 directors — count disclosed in the proxy');
    expect(describeHeadcount({ kind: 'disclosed', count: 3, boardSize: null })).toBe('3 directors — count disclosed in the proxy');
  });

  it('never presents a derivation as a headcount', () => {
    const derived = describeHeadcount({ kind: 'derived', count: 4, percent: 50, boardSize: 8 });
    expect(derived).toBe('≈ 4 of 8 — derived from a rounded 50% of 8 directors, not a disclosed count');
    expect(derived).toContain('derived');
    expect(describeHeadcount({ kind: 'disclosed', count: 4, boardSize: 8 })).not.toContain('≈');
  });

  it('says why no headcount can be shown', () => {
    expect(describeHeadcount({ kind: 'unavailable', reason: 'ambiguous', percent: 50, boardSize: 7 }))
      .toBe('Headcount not derivable: 50% of 7 directors is not a whole number');
    expect(describeHeadcount({ kind: 'unavailable', reason: 'no-percent', percent: null, boardSize: 8 })).toBe('Share not stated in this proxy');
    expect(describeHeadcount({ kind: 'unavailable', reason: 'no-board-size', percent: 50, boardSize: null }))
      .toBe('Headcount not derivable: board size not stated');
  });
});

describe('findLatestProxyFiling', () => {
  const recent = {
    form: ['10-K', 'DEF 14A', 'DEFA14A', 'DEF 14A', 'PRE 14A'],
    filingDate: ['2026-02-20', '2025-04-11', '2026-04-12', '2026-04-10', '2026-03-01'],
    reportDate: ['2025-12-31', '2025-05-21', '', '2026-05-20', ''],
    accessionNumber: ['0000320193-26-000002', '0000320193-25-000001', '0000320193-26-000004', '0000320193-26-000001', '0000320193-26-000003'],
    primaryDocument: ['aapl-10k.htm', 'aapl-proxy-2025.htm', 'aapl-defa.htm', 'aapl-proxy.htm', 'aapl-pre.htm'],
  };

  it('picks the most recently FILED definitive proxy even when the series is not newest-first', () => {
    expect(findLatestProxyFiling(recent)).toEqual(FILING);
  });

  it('ignores additional and preliminary proxy materials, and returns null when there is no DEF 14A', () => {
    expect(findLatestProxyFiling({ ...recent, form: ['10-K', 'DEFA14A', 'DEFA14A', 'PRE 14A', 'PRE 14A'] })).toBeNull();
    expect(findLatestProxyFiling({ form: [], filingDate: [], accessionNumber: [], primaryDocument: [] })).toBeNull();
  });

  it('tolerates a series without report dates', () => {
    const { reportDate: _omitted, ...withoutReportDate } = recent;
    void _omitted;
    expect(findLatestProxyFiling(withoutReportDate)).toEqual({ ...FILING, reportDate: '' });
  });
});

describe('describeRecentFilingWindow', () => {
  it('reports how many filings were checked and their date span', () => {
    expect(describeRecentFilingWindow({ filingDate: ['2026-04-10', '2026-02-20', '2026-07-08'] }))
      .toEqual({ count: 3, from: '2026-02-20', to: '2026-07-08' });
    expect(describeRecentFilingWindow({ filingDate: [] })).toEqual({ count: 0, from: null, to: null });
  });
});

describe('describeBoardFailure', () => {
  const cik = '0000320193';
  const failures: BoardLoadFailure[] = [
    { kind: 'ticker-unknown', ticker: 'ZZZZ' },
    { kind: 'lookup-failed', stage: 'directory', ticker: 'ZZZZ' },
    { kind: 'lookup-failed', stage: 'submissions', ticker: 'AAPL', cik },
    { kind: 'lookup-failed', stage: 'proxy-text', ticker: 'AAPL', cik, filing: FILING, transport: 'rate-limit', status: 429 },
    { kind: 'lookup-failed', stage: 'proxy-text', ticker: 'AAPL', cik, filing: FILING, transport: 'timeout' },
    { kind: 'lookup-failed', stage: 'proxy-text', ticker: 'AAPL', cik, filing: FILING, transport: 'upstream', status: 503 },
    { kind: 'no-proxy', ticker: 'AAPL', cik, companyName: 'Apple Inc.', window: { count: 5, from: '2026-02-20', to: '2026-07-08' } },
    { kind: 'proxy-unreadable', ticker: 'AAPL', cik, filing: FILING, reason: 'not-found', status: 404 },
    { kind: 'proxy-unreadable', ticker: 'AAPL', cik, filing: FILING, reason: 'unsupported', status: 415 },
    { kind: 'proxy-unreadable', ticker: 'AAPL', cik, filing: FILING, reason: 'too-short' },
    { kind: 'proxy-unreadable', ticker: 'AAPL', cik, filing: FILING, reason: 'cancelled' },
    { kind: 'extraction-failed', ticker: 'AAPL', cik, filing: FILING },
  ];

  it('gives every failure its own message and never the old catch-all', () => {
    const messages = failures.map(failure => describeBoardFailure(failure).message);
    expect(new Set(messages).size).toBe(failures.length);
    for (const message of messages) {
      expect(message).not.toMatch(/not found in (?:SEC )?EDGAR/i);
      expect(message.length).toBeGreaterThan(40);
    }
  });

  it('renders truthful absence as a status and a failed operation as an alert', () => {
    const byKind = (predicate: (failure: BoardLoadFailure) => boolean) => failures.filter(predicate).map(describeBoardFailure);
    for (const description of byKind(f => f.kind === 'ticker-unknown' || f.kind === 'no-proxy')) {
      expect(description.severity).toBe('absence');
      expect(description.retryable).toBe(false);
    }
    for (const description of byKind(f => f.kind === 'lookup-failed' || f.kind === 'extraction-failed')) {
      expect(description.severity).toBe('error');
      expect(description.retryable).toBe(true);
    }
    for (const description of byKind(f => f.kind === 'proxy-unreadable')) {
      expect(description.severity).toBe('error');
      expect(description.retryable).toBe(false);
    }
  });

  it('a lookup failure says so and denies nothing about the issuer or the filing', () => {
    const directory = describeBoardFailure(failures[1]);
    expect(directory.message).toContain('could not be resolved to a CIK');
    expect(directory.message).toContain('lookup failure');
    expect(directory.message).toContain('not evidence that the ticker is unknown');

    const submissions = describeBoardFailure(failures[2]);
    expect(submissions.message).toContain('CIK 320193 (AAPL)');
    expect(submissions.message).toContain('not evidence that the issuer has no proxy statement on record');

    const rateLimited = describeBoardFailure(failures[3]);
    expect(rateLimited.message).toContain('DEF 14A filed 2026-04-10 (accession 0000320193-26-000001) is on record');
    expect(rateLimited.message).toContain('SEC rate-limited the request (HTTP 429)');
    expect(rateLimited.message).toContain("not evidence about the filing's contents");
    expect(describeBoardFailure(failures[4]).message).toContain('the request timed out');
    expect(describeBoardFailure(failures[5]).message).toContain('SEC returned an upstream error (HTTP 503)');
  });

  it('an unknown ticker is distinct from a directory that failed to load', () => {
    const unknown = describeBoardFailure(failures[0]);
    expect(unknown.title).toBe('Ticker not in SEC directory');
    expect(unknown.message).toBe('No issuer with ticker "ZZZZ" in the SEC company directory. Try a listed ticker such as AAPL, MSFT, or GOOGL.');
    expect(describeBoardFailure(failures[1]).title).toBe('SEC lookup failed');
  });

  it('a missing proxy names the CIK, the company, and the window that was checked', () => {
    const missing = describeBoardFailure(failures[6]);
    expect(missing.title).toBe('No DEF 14A on record');
    expect(missing.message).toBe(
      "No DEF 14A proxy statement on record for CIK 320193 (Apple Inc.) in EDGAR's recent-filings window — "
      + '5 filings from 2026-02-20 to 2026-07-08 were checked. Nothing was extracted.',
    );
    const empty = describeBoardFailure({ kind: 'no-proxy', ticker: 'AAPL', cik, companyName: 'Apple Inc.', window: { count: 0, from: null, to: null } });
    expect(empty.message).toContain('the recent-filings window is empty');
  });

  it('an unreadable proxy names the filing, the document, and the reason', () => {
    const notFound = describeBoardFailure(failures[7]);
    expect(notFound.title).toBe('Proxy document unreadable');
    expect(notFound.message).toContain('accession 0000320193-26-000001');
    expect(notFound.message).toContain('its document aapl-proxy.htm could not be read: SEC returned 404 for the document');
    expect(describeBoardFailure(failures[8]).message).toContain('not supported for text extraction');
    expect(describeBoardFailure(failures[9]).message).toContain('shorter than 500 characters');
    expect(describeBoardFailure(failures[10]).message).toContain('cancelled');
  });

  it('an extraction failure is never presented as absence of disclosure', () => {
    const extraction = describeBoardFailure(failures[11]);
    expect(extraction.title).toBe('Extraction failed');
    expect(extraction.message).toContain('was read, but AI extraction returned no usable data');
    expect(extraction.message).toContain('not evidence that the proxy lacks these disclosures');
  });
});
