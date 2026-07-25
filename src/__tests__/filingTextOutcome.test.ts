import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchFilingTextOutcome } from '../services/secApi';

/**
 * Plan §6.4: a transport or content failure must never become "successful empty
 * text", must never be cached as filing content, and terminal statuses must not
 * be retried.
 */
/**
 * The client now calls /api/filing-text, which returns ALREADY-EXTRACTED text
 * as JSON (served from the shared cache when warm) rather than raw filing HTML.
 */
function respond(status: number, text = 'hello') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => null },
    json: async () => ({ ok: true, text }),
    text: async () => text,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchFilingTextOutcome', () => {
  it('returns typed text on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200)));
    const out = await fetchFilingTextOutcome('1', '0000000001-26-000001', 'ok.htm');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toContain('hello');
  });

  it('reports 415 as unsupported and does not retry it', async () => {
    const f = vi.fn(async () => respond(415, ''));
    vi.stubGlobal('fetch', f);
    const out = await fetchFilingTextOutcome('2', '0000000002-26-000002', 'scan.pdf');
    expect(out).toMatchObject({ ok: false, kind: 'unsupported', retryable: false });
    expect(f).toHaveBeenCalledTimes(1); // terminal — no retry
  });

  it('reports 404 as not-found and does not retry it', async () => {
    const f = vi.fn(async () => respond(404, ''));
    vi.stubGlobal('fetch', f);
    const out = await fetchFilingTextOutcome('3', '0000000003-26-000003', 'gone.htm');
    expect(out).toMatchObject({ ok: false, kind: 'not-found', retryable: false });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('reports 429 as rate-limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(429, '')));
    const out = await fetchFilingTextOutcome('4', '0000000004-26-000004', 'busy.htm');
    expect(out).toMatchObject({ ok: false, kind: 'rate-limit', retryable: true });
  });

  it('never caches a failure as filing content', async () => {
    const f = vi.fn(async () => respond(500, ''));
    vi.stubGlobal('fetch', f);
    const args = ['5', '0000000005-26-000005', 'flaky.htm'] as const;
    await fetchFilingTextOutcome(...args);
    const callsAfterFirst = f.mock.calls.length;

    // A later attempt must actually re-request rather than replay a cached miss.
    f.mockImplementation(async () => respond(200));
    const second = await fetchFilingTextOutcome(...args);
    expect(f.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(second.ok).toBe(true);
  });

  it('reports an aborted run as cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(200)));
    const controller = new AbortController();
    controller.abort();
    const out = await fetchFilingTextOutcome('6', '0000000006-26-000006', 'x.htm', { signal: controller.signal });
    expect(out).toMatchObject({ ok: false, kind: 'cancelled' });
  });
});
