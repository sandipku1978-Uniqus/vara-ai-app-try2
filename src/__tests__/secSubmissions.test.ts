import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __clearSecSubmissionsCache,
  fetchCompanySubmissions,
  fetchSubmissionHistory,
  parseSecFilingSeries,
  parseSecSubmissionPayload,
} from '../services/secSubmissions';

const mockFetch = vi.fn();

beforeEach(() => {
  __clearSecSubmissionsCache();
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function filingSeries(accessions: string[] = []) {
  return {
    accessionNumber: accessions,
    filingDate: accessions.map(() => '2026-07-31'),
    reportDate: accessions.map(() => '2026-06-30'),
    acceptanceDateTime: accessions.map(() => '2026-07-31T10:01:02.000Z'),
    act: accessions.map(() => '34'),
    form: accessions.map(() => '10-Q'),
    fileNumber: accessions.map(() => '001-12345'),
    primaryDocument: accessions.map(() => 'example.htm'),
    primaryDocDescription: accessions.map(() => 'Quarterly report'),
  };
}

function submission(cik = '320193') {
  const paddedCik = cik.padStart(10, '0');
  return {
    cik: paddedCik,
    name: 'Example Corp.',
    tickers: ['EXM'],
    exchanges: ['Nasdaq'],
    ein: '123456789',
    description: '',
    sic: '3571',
    sicDescription: 'Electronic Computers',
    filings: {
      recent: filingSeries(),
      files: [{
        name: `CIK${paddedCik}-submissions-001.json`,
        filingCount: 1,
        filingFrom: '2020-01-01',
        filingTo: '2025-12-31',
      }],
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SEC submissions leaf client', () => {
  it('preserves the proxy URL, CIK padding, headers, and decoded payload', async () => {
    const payload = submission('320193');
    mockFetch.mockResolvedValue({ ok: true, json: async () => payload });

    await expect(fetchCompanySubmissions('320193')).resolves.toBe(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sec-proxy?upstream=data&path=submissions/CIK0000320193.json',
      {
        headers: {
          'User-Agent': expect.stringContaining('Uniqus Research Center'),
          'Accept-Encoding': 'gzip, deflate',
        },
      },
    );
  });

  it('fails closed without retrying a non-retryable upstream response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

    await expect(fetchCompanySubmissions('1')).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('preserves retries for throttling and transient server failures', async () => {
    vi.useFakeTimers();
    const payload = submission('1');
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => payload });

    const pending = fetchCompanySubmissions('1');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(payload);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('validates requested CIK and every parallel recent-filings array', () => {
    const payload = submission('320193');
    expect(parseSecSubmissionPayload(payload, '0000320193')).toBe(payload);
    expect(parseSecSubmissionPayload(payload, '789019')).toBeNull();
    expect(parseSecSubmissionPayload({ ...payload, name: '' }, '320193')).toBeNull();
    expect(parseSecFilingSeries({
      ...filingSeries(['0000320193-26-000001']),
      primaryDocument: [],
    })).toBeNull();
    expect(parseSecFilingSeries({
      ...filingSeries(['0000320193-26-000001']),
      filingDate: ['2026-02-30'],
    })).toBeNull();
  });

  it('retries a malformed HTTP 200 and accepts only requested-CIK evidence', async () => {
    vi.useFakeTimers();
    const valid = submission('320193');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => submission('789019') })
      .mockResolvedValueOnce({ ok: true, json: async () => valid });

    const pending = fetchCompanySubmissions('320193');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(valid);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed requested CIKs without issuing a request', async () => {
    await expect(fetchCompanySubmissions('../320193')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects unsafe history paths before issuing a request', async () => {
    await expect(fetchSubmissionHistory('../secrets.json')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('memoises a successfully decoded historical submissions segment', async () => {
    const payload = filingSeries(['0000320193-26-000001']);
    mockFetch.mockResolvedValue({ ok: true, json: async () => payload });
    const fileName = 'CIK0000320193-submissions-001.json';

    await expect(fetchSubmissionHistory(fileName)).resolves.toBe(payload);
    await expect(fetchSubmissionHistory(fileName)).resolves.toBe(payload);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/sec-proxy?upstream=data&path=submissions/${fileName}`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('does not cache a malformed historical HTTP 200 as a successful segment', async () => {
    vi.useFakeTimers();
    const fileName = 'CIK0000320193-submissions-001.json';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...filingSeries(['0000320193-26-000001']), form: [] }),
    });

    const malformed = fetchSubmissionHistory(fileName);
    await vi.runAllTimersAsync();
    await expect(malformed).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const valid = filingSeries(['0000320193-26-000001']);
    mockFetch.mockResolvedValue({ ok: true, json: async () => valid });
    await expect(fetchSubmissionHistory(fileName)).resolves.toBe(valid);
    await expect(fetchSubmissionHistory(fileName)).resolves.toBe(valid);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
