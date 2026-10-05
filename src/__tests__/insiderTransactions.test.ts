// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/sec-request-pacer', () => ({ paceSecRequestStart: vi.fn(), SecRequestPacerUnavailableError: class extends Error {} }));
vi.mock('../lib/sec-upstream', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/sec-upstream')>();
  return { ...actual, fetchSecJson: vi.fn(), fetchSecResponse: vi.fn(), readResponseWithLimit: vi.fn() };
});
import { fetchSecJson, fetchSecResponse, readResponseWithLimit, SecUpstreamError } from '../lib/sec-upstream';
import { aggregateInsiderOwners, getInsiderTransactions, listRecentInsiderFilings, parseInsiderSubmissionPayload, rawOwnershipPath, type InsiderSubmission, type InsiderTransaction } from '../services/insiderTransactions';
import { parseOwnershipXml } from '../services/ownershipXml';

/* Real EDGAR fixtures, fetched 2026-10-04 with the application's declared UA.
 * Raw paths verified by removing xslF345X06/ from primaryDocument in submissions.
 * All XML files are <30 KB (wc -c):
 * apple-sale.xml (3294): officer Newstead's 2399-share priced sale, accession
 * 0001140361-26-038307, https://www.sec.gov/Archives/edgar/data/320193/000114036126038307/form4.xml
 * apple-rsu.xml (6638): Khan's two derivative A grants; disclosed zero price,
 * footnote-only exercise price, and absent natureOfOwnership, accession
 * 0001140361-26-038028, https://www.sec.gov/Archives/edgar/data/320193/000114036126038028/form4.xml
 * tesla-exercise.xml (8817): Taneja's M exercise, fractional priced S sale,
 * derivative disposal and an indirect holding to SKIP, accession
 * 0001104659-26-106432, https://www.sec.gov/Archives/edgar/data/1318605/000110465926106432/tm2625055d1_4seq1.xml
 * joint-purchases.xml (14474): five P transactions jointly reported by Berkshire
 * and Buffett, ten-percent flags, indirect nature and footnotes, accession
 * 0001193125-26-409451, https://www.sec.gov/Archives/edgar/data/1067983/000119312526409451/ownership.xml
 * (Issuer is Lennar 920760; this path is also filed under the reporting owner's CIK.)
 * apple-form3.xml (12109): Ternus's eight holdings, zero transactions, accession
 * 0001140361-26-035359, https://www.sec.gov/Archives/edgar/data/320193/000114036126035359/form3.xml
 * submissions.json: https://data.sec.gov/submissions/CIK0000320193.json,
 * filings.recent trimmed to its first 17 aligned entries; history references kept.
 * Explicit mutations below exercise malformed/omitted values and network failures;
 * assertions for unmodified fixtures always use their actual disclosed values.
 */
function fixture(name: string): string { return readFileSync(new URL(`./fixtures/insiders/${name}`, import.meta.url), 'utf8'); }
const submissionPayload: unknown = JSON.parse(fixture('submissions.json'));
function submission() {
  const parsed = parseInsiderSubmissionPayload(structuredClone(submissionPayload), '320193');
  if (!parsed) throw new Error('Invalid real submissions fixture');
  return parsed;
}
function rows(name: string, accession: string, filedAt: string): InsiderTransaction[] {
  return parseOwnershipXml(fixture(name)).transactions.map(row => ({ ...row, accession, filedAt, formType: '4', primaryDocument: 'xslF345X06/form4.xml' }));
}

/** Generated boundary-test data, not an EDGAR fixture: only the four columns
 * this service consumes, with three ownership filings among 26,300 total rows. */
function largeSubmission(rowCount = 26_300): InsiderSubmission {
  const form = Array.from({ length: rowCount }, (_, index) => [0, 13_000, 26_299].includes(index) ? '4' : '10-K');
  return { cik: '0000019617', name: 'Generated large filer', tickers: ['JPM'], filings: { recent: {
    accessionNumber: Array.from({ length: rowCount }, (_, index) => `0000019617-26-${String(index).padStart(6, '0')}`),
    filingDate: Array.from({ length: rowCount }, () => '2026-09-01'), form,
    primaryDocument: form.map(value => value === '4' ? 'xslF345X06/form4.xml' : ''),
  } } };
}

beforeEach(() => {
  vi.mocked(fetchSecJson).mockReset().mockResolvedValue(submissionPayload);
  vi.mocked(fetchSecResponse).mockReset().mockResolvedValue(new Response('unused'));
  vi.mocked(readResponseWithLimit).mockReset().mockResolvedValue(new TextEncoder().encode(fixture('apple-sale.xml')));
});
afterEach(() => { vi.useRealTimers(); });

describe('local insider submissions validation', () => {
  it('validates and lists 26,300 rows using only the four needed columns', async () => {
    const payload = largeSubmission();
    const parsed = parseInsiderSubmissionPayload(payload, '19617');
    expect(parsed?.cik).toBe('19617');
    expect(parsed?.filings.recent.form).toHaveLength(26_300);
    expect(parsed && listRecentInsiderFilings(parsed).map(filing => filing.accession)).toEqual([
      '0000019617-26-026299', '0000019617-26-013000', '0000019617-26-000000',
    ]);
    vi.mocked(fetchSecJson).mockResolvedValue(payload);
    const result = await getInsiderTransactions({ cik: '19617', maxFilings: 1 });
    expect(result.coverage).toMatchObject({ filingsListed: 3, filingsRequested: 1, filingsOutsideLimit: 2, complete: true });
    expect(fetchSecJson).toHaveBeenCalledWith(expect.objectContaining({ maxBytes: 25 * 1024 * 1024 }));
  });
  it('compares CIK digits, including zero padding and numeric SEC CIKs', () => {
    const payload = largeSubmission(1);
    expect(parseInsiderSubmissionPayload(payload, '0000019617')?.cik).toBe('19617');
    expect(parseInsiderSubmissionPayload({ ...payload, cik: 19617 }, '19617')?.cik).toBe('19617');
    expect(parseInsiderSubmissionPayload(payload, '320193')).toBeNull();
    expect(parseInsiderSubmissionPayload({ ...payload, cik: '19617x' }, '19617')).toBeNull();
  });
  it.each(['accessionNumber', 'filingDate', 'form', 'primaryDocument'] as const)('rejects misaligned %s columns', column => {
    const payload = largeSubmission(2);
    payload.filings.recent[column].pop();
    expect(parseInsiderSubmissionPayload(payload, '19617')).toBeNull();
  });
  it('rejects a bad accession or impossible ISO date, even on non-ownership rows', () => {
    const payload = largeSubmission(2);
    payload.filings.recent.accessionNumber[1] = '0000019617-26-12345';
    expect(parseInsiderSubmissionPayload(payload, '19617')).toBeNull();
    payload.filings.recent.accessionNumber[1] = '0000019617-26-000001';
    payload.filings.recent.filingDate[1] = '2026-02-30';
    expect(parseInsiderSubmissionPayload(payload, '19617')).toBeNull();
  });
  it('accepts 100,000 rows and rejects more than 100,000', () => {
    expect(parseInsiderSubmissionPayload(largeSubmission(100_000), '19617')?.filings.recent.form).toHaveLength(100_000);
    expect(parseInsiderSubmissionPayload(largeSubmission(100_001), '19617')).toBeNull();
  });
  it('validates bounded identity/column strings, sparse arrays and the optional history array', () => {
    const payload = largeSubmission(2);
    expect(parseInsiderSubmissionPayload({ ...payload, name: '   ' }, '19617')).toBeNull();
    expect(parseInsiderSubmissionPayload({ ...payload, name: 'x'.repeat(1001) }, '19617')).toBeNull();
    expect(parseInsiderSubmissionPayload({ ...payload, tickers: ['x'.repeat(65)] }, '19617')).toBeNull();
    expect(parseInsiderSubmissionPayload({ ...payload, tickers: [123] }, '19617')).toBeNull();
    expect(parseInsiderSubmissionPayload({ ...payload, filings: { ...payload.filings, files: {} } }, '19617')).toBeNull();
    expect(parseInsiderSubmissionPayload({ ...payload, filings: { ...payload.filings, files: [] } }, '19617')?.filings.files).toEqual([]);
    payload.filings.recent.form[1] = 'x'.repeat(41);
    expect(parseInsiderSubmissionPayload(payload, '19617')).toBeNull();
    payload.filings.recent.form[1] = '10-K';
    payload.filings.recent.primaryDocument[1] = 'x'.repeat(1001);
    expect(parseInsiderSubmissionPayload(payload, '19617')).toBeNull();
    delete payload.filings.recent.primaryDocument[1];
    expect(parseInsiderSubmissionPayload(payload, '19617')).toBeNull();
  });
});

describe('real ownership XML parsing', () => {
  it('reads exact officer sale numbers, flags, name, date and code', () => {
    const parsed = parseOwnershipXml(fixture('apple-sale.xml'));
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]).toEqual({
      reportingOwner: { name: 'Newstead Jennifer', cik: '1780525' },
      relationship: { isDirector: false, isOfficer: true, isTenPercentOwner: false, isOther: false, officerTitle: 'SVP, GC and Government Affairs' },
      jointFiling: false, security: 'Common Stock', derivative: false, transactionDate: '2026-09-29', code: 'S',
      acquiredDisposed: 'D', shares: 2399, pricePerShare: 336.18, sharesOwnedAfter: 41992,
      direct: true, natureOfOwnership: null, footnoteIds: ['F1'],
    });
    expect(parsed.holdingsRowsSkipped).toBe(0);
    expect(parsed.issuer).toEqual({ cik: '320193', name: 'Apple Inc.', tradingSymbol: 'AAPL' });
  });
  it('keeps both RSU grants and distinguishes disclosed zero from footnote-only exercise price', () => {
    const parsed = parseOwnershipXml(fixture('apple-rsu.xml'));
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions.map(row => [row.reportingOwner.name, row.code, row.acquiredDisposed, row.shares, row.pricePerShare, row.exercisePrice, row.underlyingShares, row.sharesOwnedAfter, row.direct])).toEqual([
      ['Khan Sabih', 'A', 'A', 47645, 0, null, 47645, 47645, true],
      ['Khan Sabih', 'A', 'A', 47645, 0, null, 47645, 47645, true],
    ]);
    expect(parsed.transactions.map(row => row.footnoteIds)).toEqual([['F1', 'F2'], ['F1', 'F3']]);
    expect(parsed.transactions.every(row => row.derivative && row.underlyingSecurity === 'Common Stock')).toBe(true);
    expect(parsed.holdingsRowsSkipped).toBe(0);
  });
  it('preserves fractional exercise/sale figures and skips the holding', () => {
    const parsed = parseOwnershipXml(fixture('tesla-exercise.xml'));
    expect(parsed.transactions.map(row => [row.code, row.acquiredDisposed, row.shares, row.pricePerShare, row.sharesOwnedAfter, row.derivative, row.direct])).toEqual([
      ['M', 'A', 6539, 0, 28578, false, true], ['S', 'D', 2605.75, 360.134, 25972.25, false, true], ['M', 'D', 6539, 0, 52305, true, true],
    ]);
    expect(parsed.transactions[0].reportingOwner).toEqual({ name: 'Taneja Vaibhav', cik: '1771340' });
    expect(parsed.transactions[0].relationship.officerTitle).toBe('Chief Financial Officer');
    expect(parsed.transactions[2]).toMatchObject({ exercisePrice: 0, underlyingShares: 6539 });
    expect(parsed.holdingsRowsSkipped).toBe(1);
  });
  it('duplicates five indirect purchases for each joint ten-percent owner', () => {
    const parsed = parseOwnershipXml(fixture('joint-purchases.xml'));
    expect(parsed.reportingOwners.map(entry => entry.owner)).toEqual([
      { name: 'BERKSHIRE HATHAWAY INC', cik: '1067983' }, { name: 'BUFFETT WARREN E', cik: '315090' },
    ]);
    expect(parsed.transactions).toHaveLength(10);
    expect(parsed.transactions.filter(row => row.reportingOwner.cik === '315090').map(row => [row.shares, row.pricePerShare, row.sharesOwnedAfter, row.code, row.acquiredDisposed, row.direct])).toEqual([
      [5200, 81.96, 25383334, 'P', 'A', false], [12289, 81.95, 25395623, 'P', 'A', false],
      [638813, 81.59, 26034436, 'P', 'A', false], [100, 80, 548992, 'P', 'A', false], [4008, 79.98, 553000, 'P', 'A', false],
    ]);
    expect(parsed.transactions.every(row => row.jointFiling && row.relationship.isTenPercentOwner && row.natureOfOwnership === 'See footnote')).toBe(true);
    expect(parsed.transactions[0].footnoteIds).toEqual(['F3', 'F1']);
    expect(parsed.holdingsRowsSkipped).toBe(0);
  });
  it('never turns Form 3 holdings into transactions', () => {
    const parsed = parseOwnershipXml(fixture('apple-form3.xml'));
    expect(parsed.formType).toBe('3');
    expect(parsed.reportingOwners[0].owner.name).toBe('Ternus John');
    expect(parsed.transactions).toEqual([]);
    expect(parsed.holdingsRowsSkipped).toBe(8);
  });
  it('returns null for footnote-only/omitted fields and rejects malformed disclosed values', () => {
    const xml = fixture('apple-sale.xml').replace('<value>2399</value>', '<footnoteId id="F9"/>')
      .replace('<value>336.18</value>', '<footnoteId id="F8"/>').replace('<value>41992</value>', '')
      .replace('<value>D</value>', '').replace('<transactionCode>S</transactionCode>', '');
    expect(parseOwnershipXml(xml).transactions[0]).toMatchObject({ shares: null, pricePerShare: null, sharesOwnedAfter: null, acquiredDisposed: null, code: null, footnoteIds: ['F1', 'F9', 'F8'] });
    expect(() => parseOwnershipXml(fixture('apple-sale.xml').replace('336.18', 'undisclosed'))).toThrow('invalid-number:transactionPricePerShare');
    expect(() => parseOwnershipXml(fixture('apple-sale.xml').replace(/2026-09-29/g, '2026-02-30'))).toThrow('invalid-transaction-date');
    expect(() => parseOwnershipXml('<html>blocked</html>')).toThrow('not-ownership-xml');
    expect(() => parseOwnershipXml('<html><!-- <ownershipDocument> --><body>blocked</body></html>')).toThrow('not-ownership-xml');
    expect(() => parseOwnershipXml(fixture('apple-sale.xml').replace('</transactionShares>', ''))).toThrow('malformed-ownership-xml');
  });
});

describe('listing, aggregation and I/O coverage', () => {
  it('filters 17 real recent filings to 13 ownership filings, including the Form 3, newest first', () => {
    const listed = listRecentInsiderFilings(submission());
    expect(listed).toHaveLength(13);
    expect(listed[0]).toEqual({ accession: '0001140361-26-038307', filedAt: '2026-10-01', formType: '4', primaryDocument: 'xslF345X06/form4.xml' });
    expect(listed.at(-1)?.filedAt).toBe('2026-09-01');
    expect(listRecentInsiderFilings(submission(), ['3']).map(row => row.accession)).toEqual(['0001140361-26-035359']);
    const changed = submission(); changed.filings.recent.form[3] = '4/A';
    expect(listRecentInsiderFilings(changed, ['4'])[0].formType).toBe('4/A');
    expect(listRecentInsiderFilings(changed, ['5'])).toEqual([]);
  });
  it('rewrites the XSLT prefix only, pads submissions CIK and passes UA/abort/byte budget', async () => {
    expect(rawOwnershipPath('0000320193', listRecentInsiderFilings(submission())[0])).toBe('/Archives/edgar/data/320193/000114036126038307/form4.xml');
    expect(rawOwnershipPath('320193', { ...listRecentInsiderFilings(submission())[0], primaryDocument: 'xslF345X05/wk-form4_1773786674.xml' })).toBe('/Archives/edgar/data/320193/000114036126038307/wk-form4_1773786674.xml');
    expect(() => rawOwnershipPath('320193', { ...listRecentInsiderFilings(submission())[0], primaryDocument: '../form4.xml' })).toThrow('invalid-ownership-document-path');
    const result = await getInsiderTransactions({ cik: '0000320193', maxFilings: 1, userAgent: 'test@example.com' });
    expect(fetchSecJson).toHaveBeenCalledWith(expect.objectContaining({ upstream: 'data', path: '/submissions/CIK0000320193.json', userAgent: 'test@example.com', maxBytes: 25 * 1024 * 1024, signal: expect.any(AbortSignal) }));
    expect(String(vi.mocked(fetchSecResponse).mock.calls[0][0])).toBe('https://www.sec.gov/Archives/edgar/data/320193/000114036126038307/form4.xml');
    expect(readResponseWithLimit).toHaveBeenCalledWith(expect.any(Response), 1048576, expect.any(AbortSignal));
    expect(result.coverage).toMatchObject({ filingsListed: 13, filingsRequested: 1, filingsParsed: 1, filingsNotAttempted: 0, filingsOutsideLimit: 12, transactionRows: 1, rowsWithoutShares: 0, complete: true, olderHistoryNotRead: true, unreadHistoryFiles: submission().filings.files?.length, oldestFiledAt: '2026-10-01', newestFiledAt: '2026-10-01' });
    expect(result.issuer).toEqual({ name: 'Apple Inc.', tradingSymbol: 'AAPL' });
    // Each row names the filing's primary document, so the UI links to the form itself.
    expect(result.transactions[0]).toMatchObject({ accession: '0001140361-26-038307', formType: '4', primaryDocument: 'xslF345X06/form4.xml' });
  });
  it('computes hand-checked nets without including derivatives or combining joint owners', () => {
    const all = [...rows('apple-sale.xml', 'sale', '2026-10-01'), ...rows('apple-rsu.xml', 'rsu', '2026-09-29'), ...rows('tesla-exercise.xml', 'exercise', '2026-09-09'), ...rows('joint-purchases.xml', 'joint', '2026-09-30')];
    const owners = aggregateInsiderOwners(all);
    expect(owners.find(owner => owner.owner.cik === '1780525')).toMatchObject({ filingsCount: 1, transactionsCount: 1, netSharesOpenMarket: -2399, netSharesAllCodes: -2399, purchasesShares: 0, salesShares: 2399, latestSharesOwnedAfter: 41992 });
    expect(owners.find(owner => owner.owner.cik === '2078476')).toMatchObject({ transactionsCount: 2, netSharesOpenMarket: 0, netSharesAllCodes: 0, latestSharesOwnedAfter: null });
    expect(owners.find(owner => owner.owner.cik === '1771340')).toMatchObject({ transactionsCount: 3, netSharesOpenMarket: -2605.75, netSharesAllCodes: 3933.25, purchasesShares: 0, salesShares: 2605.75, lastTransactionDate: '2026-09-08', lastTransactionCode: 'S', latestSharesOwnedAfter: 25972.25 });
    // 5200 + 12289 + 638813 + 100 + 4008 = 660410 PER owner.
    for (const cik of ['1067983', '315090']) expect(owners.find(owner => owner.owner.cik === cik)).toMatchObject({ filingsCount: 1, transactionsCount: 5, netSharesOpenMarket: 660410, netSharesAllCodes: 660410, purchasesShares: 660410, salesShares: 0, latestSharesOwnedAfter: 553000 });
    const nullShare = { ...all[0], shares: null, sharesOwnedAfter: null, reportingOwner: { name: 'Newstead Jennifer', cik: null } };
    expect(aggregateInsiderOwners([nullShare, nullShare])[0]).toMatchObject({ filingsCount: 1, transactionsCount: 2, rowsWithoutShares: 2, netSharesAllCodes: 0, netSharesOpenMarket: 0, latestSharesOwnedAfter: null });
  });
  it('counts holdings-only filings and their owner without manufacturing transactions', async () => {
    vi.mocked(readResponseWithLimit).mockResolvedValue(new TextEncoder().encode(fixture('apple-form3.xml')));
    const result = await getInsiderTransactions({ cik: '320193', formTypes: ['3'] });
    expect(result.transactions).toEqual([]);
    expect(result.owners[0]).toMatchObject({ owner: { name: 'Ternus John' }, filingsCount: 1, transactionsCount: 0, latestSharesOwnedAfter: null });
    expect(result.coverage).toMatchObject({ holdingsRowsSkipped: 8, filingsParsed: 1, complete: true });
  });
  it('reports HTTP failure and non-ownership HTML separately, with successes retained', async () => {
    vi.mocked(fetchSecResponse).mockResolvedValueOnce(new Response('blocked', { status: 403 })).mockResolvedValueOnce(new Response('unused')).mockResolvedValueOnce(new Response('unused'));
    vi.mocked(readResponseWithLimit).mockResolvedValueOnce(new TextEncoder().encode('<html>SEC unavailable</html>')).mockResolvedValueOnce(new TextEncoder().encode(fixture('apple-sale.xml')));
    const result = await getInsiderTransactions({ cik: '320193', maxFilings: 3 });
    expect(result.coverage).toMatchObject({ filingsParsed: 1, filingsNotAttempted: 0, complete: false, transactionRows: 1 });
    expect(result.coverage.filingsFailed).toEqual([
      { accession: '0001140361-26-038307', reason: 'http-status:403' }, { accession: '0001140361-26-038028', reason: 'not-ownership-xml' },
    ]);
  });
  it('limits concurrency to two and reports work left unattempted at the overall deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchSecResponse).mockImplementation(() => new Promise<Response>(() => undefined));
    const pending = getInsiderTransactions({ cik: '320193', maxFilings: 5, deadlineMs: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSecResponse).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result.coverage).toMatchObject({ filingsRequested: 5, filingsParsed: 0, filingsNotAttempted: 3, complete: false });
    expect(result.coverage.filingsFailed.map(filing => filing.reason)).toEqual(['service-deadline-exceeded', 'service-deadline-exceeded']);
    expect(vi.mocked(fetchSecResponse).mock.calls[0][2].aborted).toBe(true);
    expect(fetchSecResponse).toHaveBeenCalledTimes(2);
  });
  it('counts valid other-issuer XML separately, excluding its transactions and owners without making coverage incomplete', async () => {
    vi.mocked(readResponseWithLimit).mockResolvedValue(new TextEncoder().encode(fixture('joint-purchases.xml')));
    const result = await getInsiderTransactions({ cik: '320193', maxFilings: 1 });
    expect(result.transactions).toEqual([]);
    expect(result.owners).toEqual([]);
    expect(result.coverage.filingsFailed).toEqual([]);
    expect(result.coverage.filingsAboutOtherIssuers).toEqual([{ accession: '0001140361-26-038307', issuerCik: '920760', issuerName: 'LENNAR CORP /NEW/' }]);
    expect(result.coverage).toMatchObject({ filingsParsed: 0, filingsAboutOtherIssuersCount: 1, filingsNotAttempted: 0, complete: true });
    expect(result.coverage.filingsParsed + result.coverage.filingsAboutOtherIssuersCount + result.coverage.filingsFailed.length + result.coverage.filingsNotAttempted).toBe(result.coverage.filingsRequested);
  });
  it('accounts for parsed, other-issuer, failed and unattempted filings in a mixed deadline result', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchSecResponse).mockResolvedValueOnce(new Response('unused')).mockResolvedValueOnce(new Response('unused'))
      .mockResolvedValueOnce(new Response('blocked', { status: 403 }))
      .mockImplementation(() => new Promise<Response>(() => undefined));
    vi.mocked(readResponseWithLimit).mockResolvedValueOnce(new TextEncoder().encode(fixture('apple-sale.xml')))
      .mockResolvedValueOnce(new TextEncoder().encode(fixture('joint-purchases.xml')));
    const pending = getInsiderTransactions({ cik: '320193', maxFilings: 6, deadlineMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(result.coverage).toMatchObject({ filingsParsed: 1, filingsAboutOtherIssuersCount: 1, filingsNotAttempted: 1, transactionRows: 1, complete: false });
    expect(result.coverage.filingsFailed.map(filing => filing.reason)).toEqual(['http-status:403', 'service-deadline-exceeded', 'service-deadline-exceeded']);
    expect(result.owners.map(owner => owner.owner.cik)).toEqual(['1780525']);
    expect(result.coverage.filingsParsed + result.coverage.filingsAboutOtherIssuersCount + result.coverage.filingsFailed.length + result.coverage.filingsNotAttempted).toBe(6);
  });
  it('keeps submissions size-cap errors distinct from validation failures', async () => {
    vi.mocked(fetchSecJson).mockRejectedValue(new SecUpstreamError('SEC response exceeded the size limit.', 413));
    await expect(getInsiderTransactions({ cik: '19617' })).rejects.toMatchObject({ status: 413, message: 'SEC response exceeded the size limit.' });
    vi.mocked(fetchSecJson).mockResolvedValue({ cik: '19617' });
    await expect(getInsiderTransactions({ cik: '19617' })).rejects.toMatchObject({ status: 502, message: 'SEC submissions payload failed validation.' });
  });
  it('rejects cancelled or invalid submissions rather than returning a false empty result', async () => {
    const controller = new AbortController(); controller.abort(new DOMException('cancel', 'AbortError'));
    await expect(getInsiderTransactions({ cik: '320193', signal: controller.signal })).rejects.toThrow('cancel');
    expect(fetchSecJson).not.toHaveBeenCalled();
    vi.mocked(fetchSecJson).mockResolvedValue({ cik: '1' });
    await expect(getInsiderTransactions({ cik: '320193' })).rejects.toThrow('SEC submissions payload failed validation');
    await expect(getInsiderTransactions({ cik: '320193', maxFilings: 101 })).rejects.toThrow('Invalid insider transactions options');
  });
});
