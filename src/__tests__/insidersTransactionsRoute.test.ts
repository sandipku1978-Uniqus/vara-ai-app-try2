// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api-auth', () => ({ requireApiAccess: vi.fn() }));
vi.mock('../lib/rate-limit', () => ({ checkResourceRateLimit: vi.fn(), rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })) }));
vi.mock('../lib/cache', () => ({ cacheService: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../lib/route-observability', () => ({ currentCorrelationId: () => null, withRouteObservability: (_name: string, handler: (request: Request) => Promise<Response>) => handler }));
vi.mock('../services/insiderTransactions', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/insiderTransactions')>();
  return { ...actual, getInsiderTransactions: vi.fn() };
});
import { requireApiAccess } from '../lib/api-auth';
import { checkResourceRateLimit } from '../lib/rate-limit';
import { cacheService } from '../lib/cache';
import { SecUpstreamError } from '../lib/sec-upstream';
import { getInsiderTransactions, type InsiderTransactionsResult } from '../services/insiderTransactions';
import { parseOwnershipXml } from '../services/ownershipXml';
import { GET, maxDuration } from '../app/api/insiders/transactions/route';

function fixtureResult(): InsiderTransactionsResult {
  const document = parseOwnershipXml(readFileSync(new URL('./fixtures/insiders/apple-sale.xml', import.meta.url), 'utf8'));
  return { cik: '320193', issuer: { name: document.issuer.name!, tradingSymbol: document.issuer.tradingSymbol },
    transactions: document.transactions.map(row => ({ ...row, accession: '0001140361-26-038307', filedAt: '2026-10-01', formType: '4' })), owners: [],
    coverage: { source: 'SEC submissions filings.recent and raw ownership XML', scope: 'requested-recent-filings', cik: '320193',
      filingsListed: 13, filingsRequested: 1, filingsParsed: 1, filingsFailed: [], filingsNotAttempted: 0, filingsOutsideLimit: 12,
      filingsAboutOtherIssuers: [], filingsAboutOtherIssuersCount: 0,
      transactionRows: 1, rowsWithoutShares: 0, holdingsRowsSkipped: 0, olderHistoryNotRead: true, unreadHistoryFiles: 1,
      recentHistoryNote: 'Recent only', oldestFiledAt: '2026-10-01', newestFiledAt: '2026-10-01', complete: true,
      fetchedAt: '2026-10-04T00:00:00.000Z', aggregationNote: 'Reported transactions',
    } };
}
function request(query = 'cik=320193') { return new Request(`http://localhost/api/insiders/transactions?${query}`); }
beforeEach(() => {
  vi.mocked(requireApiAccess).mockReset().mockResolvedValue({ identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' } });
  vi.mocked(checkResourceRateLimit).mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  vi.mocked(cacheService.get).mockReset().mockResolvedValue(null);
  vi.mocked(cacheService.set).mockReset().mockResolvedValue(undefined);
  vi.mocked(getInsiderTransactions).mockReset().mockResolvedValue(fixtureResult());
});
afterEach(() => { vi.useRealTimers(); });

describe('insider transactions route', () => {
  it.each(['cik=abc', 'cik=0', 'cik=12345678901', '', 'cik=320193&limit=101', 'cik=320193&limit=0', 'cik=320193&limit=1.5', 'cik=320193&forms=4/A', 'cik=320193&forms=4,6', 'cik=320193&forms='])('rejects invalid query %s', async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid cik, limit (1..100), or forms (3,4,5).' });
    expect(getInsiderTransactions).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
  });
  it('checks authentication first, including for invalid inputs', async () => {
    vi.mocked(requireApiAccess).mockResolvedValue({ response: Response.json({ error: 'unauthorized' }, { status: 401 }) });
    const response = await GET(request('cik=bad'));
    expect(response.status).toBe(401);
    expect(requireApiAccess).toHaveBeenCalledWith(true, '/api/insiders/transactions', 'GET');
    expect(checkResourceRateLimit).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
  });
  it('checks resource limits before cached reads or SEC requests', async () => {
    vi.mocked(checkResourceRateLimit).mockResolvedValue({ allowed: false, reason: 'rate', retryAfterSeconds: 60 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(cacheService.get).not.toHaveBeenCalled();
  });
  it('uses validated defaults, request cancellation and one-hour TTL for complete requested coverage', async () => {
    const input = request();
    const response = await GET(input);
    expect(response.status).toBe(200);
    expect((await response.json()).transactions[0].shares).toBe(2399);
    expect(getInsiderTransactions).toHaveBeenCalledWith({ cik: 320193, maxFilings: 40, formTypes: ['3', '4', '5'], signal: input.signal, userAgent: expect.any(String), deadlineMs: 40000 });
    expect(maxDuration).toBeGreaterThan(40);
    expect(cacheService.set).toHaveBeenCalledWith('insiders:transactions:v2:320193:3,4,5:40', fixtureResult(), { ex: 3600 });
  });
  it.each(['failed', 'incomplete'])('caches %s coverage for only five minutes', async mode => {
    const result = fixtureResult();
    if (mode === 'failed') result.coverage.filingsFailed = [{ accession: '0001140361-26-038028', reason: 'not-ownership-xml' }];
    else result.coverage.complete = false;
    vi.mocked(getInsiderTransactions).mockResolvedValue(result);
    expect((await GET(request())).status).toBe(200);
    expect(cacheService.set).toHaveBeenCalledWith(expect.any(String), result, { ex: 300 });
  });
  it('canonicalizes CIK and forms in the versioned cache key, and separates limits', async () => {
    vi.mocked(cacheService.get).mockResolvedValue(fixtureResult());
    const response = await GET(request('cik=0000320193&forms=5,4,4&limit=7'));
    expect(response.status).toBe(200);
    expect(cacheService.get).toHaveBeenCalledWith('insiders:transactions:v2:320193:4,5:7');
    expect(getInsiderTransactions).not.toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
  });
  it('uses the full TTL when other-issuer disclosures are the only excluded filings', async () => {
    const result = fixtureResult();
    result.transactions = [];
    result.coverage.transactionRows = 0;
    result.coverage.filingsParsed = 0;
    result.coverage.filingsAboutOtherIssuers = [{ accession: '0001140361-26-038307', issuerCik: '920760', issuerName: 'LENNAR CORP /NEW/' }];
    result.coverage.filingsAboutOtherIssuersCount = 1;
    vi.mocked(getInsiderTransactions).mockResolvedValue(result);
    expect((await GET(request())).status).toBe(200);
    expect(cacheService.set).toHaveBeenCalledWith('insiders:transactions:v2:320193:3,4,5:40', result, { ex: 3600 });
  });
  it.each([
    [502, 'SEC submissions payload failed validation.'],
    [413, 'SEC response exceeded the size limit.'],
  ] as const)('preserves distinct submissions error %s', async (status, message) => {
    vi.mocked(getInsiderTransactions).mockRejectedValue(new SecUpstreamError(message, status));
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });
  it('continues after a stalled cache read and bounds a stalled write', async () => {
    vi.useFakeTimers();
    vi.mocked(cacheService.get).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(cacheService.set).mockImplementation(() => new Promise(() => undefined));
    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(4000);
    expect((await pending).status).toBe(200);
    expect(getInsiderTransactions).toHaveBeenCalledTimes(1);
  });
  it('cancels a stalled cache wait without starting SEC work', async () => {
    vi.mocked(cacheService.get).mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = GET(new Request('http://localhost/api/insiders/transactions?cik=320193', { signal: controller.signal }));
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(getInsiderTransactions).not.toHaveBeenCalled();
  });
  it('returns JSON errors when the submissions boundary fails', async () => {
    vi.mocked(getInsiderTransactions).mockRejectedValue(new DOMException('deadline', 'TimeoutError'));
    const response = await GET(request());
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'SEC insider submissions request timed out.' });
    expect(cacheService.set).not.toHaveBeenCalled();
  });
});
