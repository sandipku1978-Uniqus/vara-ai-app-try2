import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  fetchSecResponse,
  logSecUpstreamFailure,
  parseSecJsonResponse,
  SecUpstreamError,
} from '../lib/sec-upstream';

/**
 * Audit 2026-09: "SEC throttles, blocks and error pages produce zero
 * server-side signal." Every SEC-side failure now leaves one structured line
 * — host and path, never the query — so a drain can alert on throttling
 * before users report empty results.
 */

const TARGET = new URL('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193');

function logged(spy: MockInstance, call = 0): Record<string, unknown> {
  return JSON.parse(String(spy.mock.calls[call][0])) as Record<string, unknown>;
}

describe('SEC upstream failure logging', () => {
  let error: MockInstance;

  beforeEach(() => {
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs a throttled or blocked HTTP answer and still passes the response through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Request Rate Threshold Exceeded', { status: 429 })));

    const response = await fetchSecResponse(TARGET, 'proxy', new AbortController().signal, 'UA test');

    expect(response.status).toBe(429);
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged(error)).toMatchObject({
      kind: 'sec-upstream-failure',
      upstream: 'proxy',
      host: 'www.sec.gov',
      path: '/cgi-bin/browse-edgar',
      status: 429,
      reason: 'http-status',
      correlationId: null,
    });
    expect(typeof logged(error).elapsedMs).toBe('number');
    expect(JSON.stringify(logged(error))).not.toContain('0000320193');
  });

  it('stays silent for a successful answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200 })));

    await fetchSecResponse(TARGET, 'proxy', new AbortController().signal, 'UA test');

    expect(error).not.toHaveBeenCalled();
  });

  it('logs a rejected redirect target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example.test/steal' },
    })));

    await expect(fetchSecResponse(TARGET, 'proxy', new AbortController().signal, 'UA test'))
      .rejects.toBeInstanceOf(SecUpstreamError);

    expect(logged(error)).toMatchObject({ reason: 'redirect-rejected', status: 302, host: 'evil.example.test' });
  });

  it('does not treat the caller abandoning the request as an SEC failure', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_target: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener('abort', abort);
    })));

    const pending = fetchSecResponse(TARGET, 'proxy', controller.signal, 'UA test');
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an error page or non-JSON body when the source is known', () => {
    const errorPage = new TextEncoder().encode('<html>Your Request Originated from an Undeclared Automated Tool</html>');
    expect(() => parseSecJsonResponse(errorPage, 'text/html', { upstream: 'efts', target: TARGET }))
      .toThrow(SecUpstreamError);
    expect(logged(error, 0)).toMatchObject({ reason: 'error-page', upstream: 'efts', status: 200 });

    const html = new TextEncoder().encode('<html>not json</html>');
    expect(() => parseSecJsonResponse(html, 'text/html', { upstream: 'efts', target: TARGET }))
      .toThrow(SecUpstreamError);
    expect(logged(error, 1)).toMatchObject({ reason: 'non-json' });

    expect(() => parseSecJsonResponse(html, 'text/html')).toThrow(SecUpstreamError);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('never records a query string', () => {
    logSecUpstreamFailure({ upstream: 'efts', target: new URL('https://efts.sec.gov/LATEST/search-index?q=%22secret%20phrase%22'), reason: 'timeout' });

    const line = logged(error);
    expect(line).toMatchObject({ host: 'efts.sec.gov', path: '/LATEST/search-index', reason: 'timeout', status: null });
    expect(JSON.stringify(line)).not.toContain('secret');
  });
});
