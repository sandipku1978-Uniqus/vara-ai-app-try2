import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combineSignals, fetchWithDeadline } from '../lib/fetch-with-deadline';

describe('fetchWithDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a request that has not answered by the deadline', async () => {
    const seen: RequestInit[] = [];
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      seen.push(init || {});
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));

    const pending = fetchWithDeadline(25_000, hanging)('https://db.example.test/rest/v1/rpc/x', { method: 'POST' });
    const outcome = pending.then(() => 'resolved', (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(seen[0].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const error = await outcome;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('TimeoutError');
    expect(seen[0].method).toBe('POST');
  });

  it('passes a prompt answer through and clears its timer', async () => {
    const quick = vi.fn(async () => new Response('ok'));

    const response = await fetchWithDeadline(1_000, quick)('https://db.example.test/');

    expect(await response.text()).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the caller's own signal abort first with its own reason", async () => {
    const caller = new AbortController();
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));

    const outcome = fetchWithDeadline(25_000, hanging)('https://db.example.test/', { signal: caller.signal })
      .then(() => 'resolved', (error: unknown) => error);
    caller.abort(new Error('client went away'));

    expect(await outcome).toEqual(new Error('client went away'));
  });

  it('rejects a non-positive deadline', () => {
    expect(() => fetchWithDeadline(0)).toThrow(RangeError);
    expect(() => fetchWithDeadline(Number.NaN)).toThrow(RangeError);
  });
});

describe('combineSignals', () => {
  it('returns the only signal unchanged', () => {
    const only = new AbortController().signal;
    expect(combineSignals(undefined, only, null)).toBe(only);
  });

  it('reflects an already-aborted input immediately', () => {
    const done = new AbortController();
    done.abort('earlier');
    const combined = combineSignals(done.signal, new AbortController().signal);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('earlier');
  });

  it('aborts when any input aborts later', () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineSignals(first.signal, second.signal);
    expect(combined.aborted).toBe(false);
    second.abort('second');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('second');
  });
});
