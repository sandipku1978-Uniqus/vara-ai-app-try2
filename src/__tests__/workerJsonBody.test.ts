import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase-web', () => ({ getUserWriterSupabase: () => null }));

import { readJsonBody } from '../app/api/search-jobs/_server/http';

function streamingRequest(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Request {
  return new Request('http://localhost/api/search-jobs/continue', {
    method: 'POST',
    body: stream,
    signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function errorOf(result: unknown): Promise<{ status: number; body: unknown }> {
  expect(result).toBeInstanceOf(Response);
  const response = result as Response;
  return { status: response.status, body: await response.json() };
}

describe('worker route JSON bodies (search-jobs continue, alerts evaluate)', () => {
  it('parses a bounded JSON body and treats an empty body as an empty object', async () => {
    expect(await readJsonBody(new Request('http://localhost', { method: 'POST', body: '{"jobId":"x"}' }), 1_000))
      .toEqual({ jobId: 'x' });
    expect(await readJsonBody(new Request('http://localhost', { method: 'POST' }), 1_000)).toEqual({});
  });

  it('answers 413 to a body over the cap with no Content-Length, without buffering the rest of it', async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(256).fill(0x20);
    // An endless body: a reader that buffers everything before checking never returns.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    const request = streamingRequest(stream);
    expect(request.headers.get('content-length')).toBeNull();
    const { status, body } = await errorOf(await readJsonBody(request, 1_000, 2_000));
    expect(status).toBe(413);
    expect(body).toEqual({ ok: false, error: 'Request body is too large.' });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it('counts bytes, not characters', async () => {
    // 400 characters, 1,200 UTF-8 bytes.
    const result = await readJsonBody(new Request('http://localhost', { method: 'POST', body: JSON.stringify('€'.repeat(400)) }), 1_000);
    expect((await errorOf(result)).status).toBe(413);
  });

  it('rejects a declared oversized body before reading it', async () => {
    const result = await readJsonBody(new Request('http://localhost', {
      method: 'POST', headers: { 'Content-Length': '4096' }, body: '{}',
    }), 1_000);
    expect((await errorOf(result)).status).toBe(413);
  });

  it('answers 400 with the JSON envelope for a malformed body', async () => {
    const { status, body } = await errorOf(await readJsonBody(new Request('http://localhost', { method: 'POST', body: '{nope' }), 1_000));
    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'Request body must be valid JSON.' });
  });

  it('times out a client that never finishes sending its body', async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const { status } = await errorOf(await readJsonBody(streamingRequest(stream), 1_000, 15));
    expect(status).toBe(408);
  });
});
