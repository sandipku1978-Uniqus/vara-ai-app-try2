import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { newCorrelationId } from '../lib/db-observability';
import {
  currentCorrelationId,
  currentRoute,
  outcomeForStatus,
  withRouteObservability,
} from '../lib/route-observability';

/**
 * The wrapper is the platform's one uniform signal per request (audit
 * 2026-09: three of eighteen routes logged anything structured). These tests
 * pin the contract a log drain alert is written against: one line per
 * request, the fields it carries, what it must never carry, and the envelope
 * an unhandled exception turns into.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function request(init?: RequestInit, url = 'https://example.test/api/thing?q=secret%20terms'): Request {
  return new Request(url, init);
}

function line(spy: MockInstance, call = 0): Record<string, unknown> {
  return JSON.parse(String(spy.mock.calls[call][0])) as Record<string, unknown>;
}

describe('withRouteObservability', () => {
  let info: MockInstance;
  let error: MockInstance;

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tags the response with a correlation ID and logs one route line that omits the query', async () => {
    const GET = withRouteObservability('thing', async () => Response.json({ ok: true }));

    const response = await GET(request(), undefined);

    const id = response.headers.get('x-correlation-id');
    expect(id).toMatch(UUID);
    expect(await response.json()).toEqual({ ok: true });
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    const logged = line(info);
    expect(logged).toMatchObject({
      kind: 'route',
      route: 'thing',
      method: 'GET',
      status: 200,
      outcome: 'success',
      correlationId: id,
    });
    expect(typeof logged.elapsedMs).toBe('number');
    expect(JSON.stringify(logged)).not.toContain('secret');
    expect(JSON.stringify(logged)).not.toContain('example.test');
  });

  it('shares its correlation ID with newCorrelationId() inside the handler', async () => {
    let seen: string | null = null;
    let minted = '';
    let route: string | null = null;
    const POST = withRouteObservability('letters/summary', async () => {
      seen = currentCorrelationId();
      route = currentRoute();
      minted = newCorrelationId();
      return new Response(null, { status: 204 });
    });

    const response = await POST(request({ method: 'POST' }), undefined);

    expect(seen).toBe(response.headers.get('x-correlation-id'));
    expect(minted).toBe(seen);
    expect(route).toBe('letters/summary');
    expect(line(info)).toMatchObject({ method: 'POST', status: 204, route: 'letters/summary' });
  });

  it('mints a fresh ID outside any route scope', () => {
    expect(currentCorrelationId()).toBeNull();
    expect(currentRoute()).toBeNull();
    expect(newCorrelationId()).toMatch(UUID);
    expect(newCorrelationId()).not.toBe(newCorrelationId());
  });

  it('turns an unhandled exception into a 500 envelope and logs a route-failure line', async () => {
    const GET = withRouteObservability('thing', async () => {
      throw new TypeError(`boom ${'x'.repeat(1_000)}`);
    });

    const response = await GET(request(), undefined);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({ ok: false, errorClass: 'unexpected' });
    expect(body.error).toMatch(/correlation ID/);
    expect(body.correlationId).toBe(response.headers.get('x-correlation-id'));
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const logged = line(error);
    expect(logged).toMatchObject({
      kind: 'route-failure',
      route: 'thing',
      status: 500,
      outcome: 'failure',
      errorName: 'TypeError',
      correlationId: body.correlationId,
    });
    expect(String(logged.errorMessage).length).toBeLessThanOrEqual(300);
    expect(String(logged.stack).length).toBeLessThanOrEqual(1_500);
  });

  it('reports a request the client abandoned as cancelled, not as a failure', async () => {
    const controller = new AbortController();
    const GET = withRouteObservability('thing', async () => {
      controller.abort();
      throw new Error('The operation was aborted');
    });

    const response = await GET(request({ signal: controller.signal }), undefined);

    expect(response.status).toBe(499);
    expect(await response.json()).toMatchObject({ ok: false, errorClass: 'cancelled' });
    // A client going away is not a platform failure: info level, so the
    // error-rate alert never counts it.
    expect(error).not.toHaveBeenCalled();
    expect(line(info)).toMatchObject({ kind: 'route-failure', outcome: 'cancelled', status: 499 });
  });

  it('logs 5xx responses at error level and everything else at info level', async () => {
    const GET = withRouteObservability('thing', async (incoming: Request) => (
      new Response(null, { status: Number(new URL(incoming.url).searchParams.get('s')) })
    ));

    await GET(request(undefined, 'https://example.test/api/thing?s=502'), undefined);
    await GET(request(undefined, 'https://example.test/api/thing?s=429'), undefined);
    await GET(request(undefined, 'https://example.test/api/thing?s=401'), undefined);

    expect(line(error)).toMatchObject({ kind: 'route', status: 502, outcome: 'error' });
    expect(line(info, 0)).toMatchObject({ status: 429, outcome: 'rate-limited' });
    expect(line(info, 1)).toMatchObject({ status: 401, outcome: 'denied' });
  });

  it('still returns the ID when the handler produced immutable headers', async () => {
    const GET = withRouteObservability('thing', async () => (
      Response.redirect('https://example.test/elsewhere', 307)
    ));

    const response = await GET(request(), undefined);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.test/elsewhere');
    expect(response.headers.get('x-correlation-id')).toMatch(UUID);
  });

  it('records a well-formed Vercel request ID and ignores a malformed one', async () => {
    const GET = withRouteObservability('thing', async () => new Response(null, { status: 204 }));

    await GET(request({ headers: { 'x-vercel-id': 'iad1::abcde-1712345678901-0123456789ab' } }), undefined);
    await GET(request({ headers: { 'x-vercel-id': 'not a request id' } }), undefined);

    expect(line(info, 0).vercelId).toBe('iad1::abcde-1712345678901-0123456789ab');
    expect(line(info, 1)).not.toHaveProperty('vercelId');
  });

  it('classifies outcomes by status', () => {
    expect(outcomeForStatus(200)).toBe('success');
    expect(outcomeForStatus(304)).toBe('success');
    expect(outcomeForStatus(401)).toBe('denied');
    expect(outcomeForStatus(403)).toBe('denied');
    expect(outcomeForStatus(404)).toBe('client-error');
    expect(outcomeForStatus(429)).toBe('rate-limited');
    expect(outcomeForStatus(502)).toBe('error');
  });
});
