import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseSecSubmissionPayload } from '../services/secSubmissions';

/**
 * Regression cover for the two defects found auditing /compare on 2026-08-04.
 *
 * "Add industry peers" silently added nobody. Two compounding causes:
 *
 *  1. parseSecSubmissionPayload rejected a payload whose OPTIONAL `ein` was
 *     null. SEC really sends that — KKR & Co. (CIK 1404912) does — so a
 *     well-formed payload was treated as corrupt.
 *  2. fetchCompanySubmissionsBatch used Promise.all, so that single rejection
 *     took its whole batch of five down with it, even though the function's
 *     return type — (SecSubmission | null)[] — already promises to report
 *     per-company failure as null.
 *
 * Together, one company anywhere in the candidate pool disabled the feature.
 */

/** Minimal payload that the parser accepts, mirroring SEC's real shape. */
function submission(overrides: Record<string, unknown> = {}) {
  return {
    cik: '0001404912',
    name: 'KKR & Co. Inc.',
    ein: null,
    description: '',
    sic: '6282',
    sicDescription: 'Investment Advice',
    tickers: ['KKR'],
    exchanges: ['NYSE'],
    // parseSecFilingSeries requires every one of its nine parallel arrays to
    // be present and the same length — a partial series is rejected outright.
    filings: {
      recent: {
        accessionNumber: ['0001404912-26-000001'],
        filingDate: ['2026-02-10'],
        reportDate: ['2025-12-31'],
        acceptanceDateTime: ['2026-02-10T16:30:00.000Z'],
        act: ['34'],
        form: ['10-K'],
        fileNumber: ['001-34820'],
        primaryDocument: ['kkr-20251231.htm'],
        primaryDocDescription: ['10-K'],
      },
    },
    ...overrides,
  };
}

describe('parseSecSubmissionPayload — optional fields SEC may null', () => {
  it('accepts ein: null (the real KKR shape that broke peer discovery)', () => {
    expect(parseSecSubmissionPayload(submission(), '1404912')).not.toBeNull();
  });

  it('accepts optional fields that are absent entirely', () => {
    const payload = submission();
    delete (payload as Record<string, unknown>).ein;
    delete (payload as Record<string, unknown>).description;
    expect(parseSecSubmissionPayload(payload, '1404912')).not.toBeNull();
  });

  it('still accepts a populated ein', () => {
    expect(parseSecSubmissionPayload(submission({ ein: '26-0426107' }), '1404912')).not.toBeNull();
  });

  // The loosening must not become "accept anything".
  it('still rejects a required field that is null', () => {
    expect(parseSecSubmissionPayload(submission({ name: null }), '1404912')).toBeNull();
  });

  it('still rejects a required field that is blank', () => {
    expect(parseSecSubmissionPayload(submission({ name: '   ' }), '1404912')).toBeNull();
  });

  it('still rejects an optional field of the wrong type', () => {
    expect(parseSecSubmissionPayload(submission({ ein: 12345 }), '1404912')).toBeNull();
  });

  it('still rejects an over-long optional field', () => {
    expect(parseSecSubmissionPayload(submission({ ein: 'x'.repeat(21) }), '1404912')).toBeNull();
  });

  it('still rejects a payload for a different company', () => {
    expect(parseSecSubmissionPayload(submission(), '320193')).toBeNull();
  });
});

describe('fetchCompanySubmissionsBatch — one bad company must not sink the batch', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null for the failing company and real results for the rest', async () => {
    // CIK 2 always returns a payload the parser rejects; the others are fine.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const cik = (url.match(/CIK(\d{10})\.json/)?.[1] ?? '').replace(/^0+/, '');
      const body = cik === '2'
        ? { ...submission({ cik: '0000000002', name: null }), }
        : submission({ cik: cik.padStart(10, '0'), name: `Company ${cik}` });
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }));

    const { fetchCompanySubmissionsBatch } = await import('../services/secApi');
    const results = await fetchCompanySubmissionsBatch(['1', '2', '3', '4', '5'], 5);

    expect(results).toHaveLength(5);
    // The one bad company is null — reported, not thrown.
    expect(results[1]).toBeNull();
    // Its siblings survive. Under Promise.all every one of these was lost.
    expect(results[0]).not.toBeNull();
    expect(results[2]).not.toBeNull();
    expect(results[3]).not.toBeNull();
    expect(results[4]).not.toBeNull();
  });
});
