import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  assertSecDocumentResponse,
  fetchSecJson,
  fetchSecResponse,
  looksLikeSecErrorResponse,
  looksLikeSecErrorText,
  SecUpstreamError,
} from '../lib/sec-upstream';

const pacerKv = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock('@vercel/kv', () => ({
  kv: { set: pacerKv.set },
}));

/**
 * Remediation handoff 2026-07-31, WP4 item 4 / acceptance T13.
 *
 * fetchSecResponse deliberately passes non-OK responses through (sec-proxy
 * forwards status codes), so every caller that EXTRACTS text must gate on
 * this guard first. Without it, an SEC rate-threshold page — served as prose
 * HTML — was extracted and upserted into the shared urc_filing_text cache as
 * the filing's permanent text: cache poisoning that turned every later
 * Boolean validation of that accession into a match against the error page.
 */

function response(status: number, contentType?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
  } as unknown as Response;
}

describe('assertSecDocumentResponse', () => {
  it.each([
    ['403 rate threshold', 403],
    ['404 not found', 404],
    ['429 too many requests', 429],
    ['500 server error', 500],
    ['503 unavailable', 503],
  ])('rejects a %s response even when its body is HTML prose', (_label, status) => {
    expect(() => assertSecDocumentResponse(response(status, 'text/html'))).toThrow(SecUpstreamError);
    try {
      assertSecDocumentResponse(response(status, 'text/html'));
    } catch (error) {
      expect((error as SecUpstreamError).status).toBe(status);
    }
  });

  it('maps an out-of-range status to 502 rather than passing it through', () => {
    try {
      assertSecDocumentResponse(response(304, 'text/html'));
    } catch (error) {
      expect((error as SecUpstreamError).status).toBe(502);
    }
  });

  it.each([
    ['application/pdf'],
    ['image/png'],
    ['application/octet-stream'],
    ['application/zip'],
  ])('rejects a 200 %s document with 415 — binary is never filing text', contentType => {
    try {
      assertSecDocumentResponse(response(200, contentType));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as SecUpstreamError).status).toBe(415);
    }
  });

  it.each([
    ['text/html'],
    ['text/html; charset=utf-8'],
    ['application/xhtml+xml'],
    ['text/plain'],
    ['text/xml'],
    ['application/xml'],
  ])('accepts a 200 %s document', contentType => {
    expect(() => assertSecDocumentResponse(response(200, contentType))).not.toThrow();
  });

  it('tolerates a missing content-type header on a 200 (pre-2001 archive quirks)', () => {
    expect(() => assertSecDocumentResponse(response(200))).not.toThrow();
  });
});

describe('looksLikeSecErrorText — cached-poison detection (audit R1)', () => {
  it('flags a short cached SEC error page', () => {
    const page = 'SEC.gov — Your Request Originated from an Undeclared Automated Tool. Please declare your traffic.';
    expect(looksLikeSecErrorText(page)).toContain('Undeclared Automated Tool');
  });

  it('never flags a full filing that quotes the phrase', () => {
    const filing = 'x'.repeat(6000) + ' the SEC notice "Request Rate Threshold Exceeded" appeared in our logs ';
    expect(looksLikeSecErrorText(filing)).toBeNull();
  });

  it('passes clean extracted text through', () => {
    expect(looksLikeSecErrorText('Annual report discussing goodwill impairment charges for fiscal 2026.')).toBeNull();
  });

  it('uses a separate bounded raw-response scan for padded fresh error pages', () => {
    const paddedErrorPage = `${'padding '.repeat(900)}Request Rate Threshold Exceeded`;
    expect(paddedErrorPage.length).toBeGreaterThan(5_000);
    expect(looksLikeSecErrorText(paddedErrorPage)).toBeNull();
    expect(looksLikeSecErrorResponse(new TextEncoder().encode(paddedErrorPage)))
      .toBe('Request Rate Threshold Exceeded');
  });
});

describe('fetchSecJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes SEC JSON through the central fetch path and returns validated syntax', async () => {
    const fetchMock = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>>(async () => new Response('{"name":"Example"}', {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecJson({
      upstream: 'data',
      path: 'submissions/CIK0000000001.json',
      userAgent: 'test-agent',
      maxBytes: 1024,
    })).resolves.toEqual({ name: 'Example' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://data.sec.gov/submissions/CIK0000000001.json',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      cache: 'no-store',
      redirect: 'manual',
    }));
  });

  it.each([
    ['malformed JSON', '{"name":', 'application/json'],
    ['wrong media type', '{"name":"Example"}', 'text/html'],
  ])('fails closed on HTTP 200 %s', async (_label, body, contentType) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': contentType },
    })));

    await expect(fetchSecJson({
      upstream: 'data',
      path: 'submissions/CIK0000000001.json',
      userAgent: 'test-agent',
      maxBytes: 1024,
    })).rejects.toBeInstanceOf(SecUpstreamError);
  });
});

describe('fetchSecResponse attempt authorization', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    pacerKv.set.mockReset();
  });

  it('paces rapid successful request starts at no more than eight per second', async () => {
    vi.stubEnv('URC_TEST_SEC_REQUEST_PACING', '1');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00.000Z'));
    const starts: number[] = [];
    const fetchMock = vi.fn(async () => {
      starts.push(Date.now());
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const requests = Array.from({ length: 3 }, (_, index) => fetchSecResponse(
      new URL(`https://www.sec.gov/Archives/edgar/data/1/doc-${index}.htm`),
      'proxy',
      new AbortController().signal,
      'test-agent',
    ));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(124);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(125);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await Promise.all(requests);

    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(125);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(125);
  });

  it('does not issue a request when the caller vetoes the next attempt', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecResponse(
      new URL('https://www.sec.gov/Archives/edgar/data/1/doc.htm'),
      'proxy',
      new AbortController().signal,
      'test-agent',
      () => false,
    )).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not authorize, pace, or fetch when the incoming signal was already aborted', async () => {
    const fetchMock = vi.fn();
    const authorize = vi.fn(() => true);
    const controller = new AbortController();
    controller.abort(new DOMException('superseded', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecResponse(
      new URL('https://www.sec.gov/Archives/edgar/data/1/doc.htm'),
      'proxy',
      controller.signal,
      'test-agent',
      authorize,
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(authorize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('authorizes and counts each redirect as its own real SEC attempt', async () => {
    vi.stubEnv('URC_TEST_SEC_REQUEST_PACING', '1');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:01:00.000Z'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: '/Archives/edgar/data/1/final.htm' },
      }))
      .mockResolvedValueOnce(new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const authorize = vi.fn(() => true);

    const pending = fetchSecResponse(
      new URL('https://www.sec.gov/Archives/edgar/data/1/doc.htm'),
      'proxy',
      new AbortController().signal,
      'test-agent',
      authorize,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(124);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('fails closed before fetch in production when distributed pacing is not configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecResponse(
      new URL('https://www.sec.gov/Archives/edgar/data/1/doc.htm'),
      'proxy',
      new AbortController().signal,
      'test-agent',
    )).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed before fetch in production when the distributed pacer is broken', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example');
    vi.stubEnv('KV_REST_API_TOKEN', 'secret');
    pacerKv.set.mockRejectedValueOnce(new Error('KV unavailable'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecResponse(
      new URL('https://www.sec.gov/Archives/edgar/data/1/doc.htm'),
      'proxy',
      new AbortController().signal,
      'test-agent',
    )).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the local pacer outside production when configured KV is broken', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example');
    vi.stubEnv('KV_REST_API_TOKEN', 'secret');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-08-04T12:00:00.000Z'));
    pacerKv.set.mockRejectedValueOnce(new Error('KV unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchSecResponse(
      new URL('https://www.sec.gov/Archives/edgar/data/1/doc.htm'),
      'proxy',
      new AbortController().signal,
      'test-agent',
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });
});
