import { describe, expect, it } from 'vitest';

import { readJsonBody, validateChatRequest, validateCompareRequest } from '../lib/ai-input';

function streamingRequest(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Request {
  return new Request('http://localhost/api/claude', {
    method: 'POST',
    body: stream,
    signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('bounded AI request body reader', () => {
  it('tolerates but does not expose the legacy temperature field for Sonnet 5', async () => {
    const result = await validateChatRequest(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'hello', temperature: 0 }),
    }));

    expect(result.value).toMatchObject({ prompt: 'hello' });
    expect(result.value).not.toHaveProperty('temperature');
  });

  it('rejects an assistant-prefill conversation unsupported by Sonnet 5', async () => {
    const result = await validateChatRequest(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'assistant', content: 'prefill this answer' }] }),
    }));

    expect(result.response?.status).toBe(400);
  });

  it('binds each comparison evidence packet to a unique requested ticker', async () => {
    const duplicate = await validateCompareRequest(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        tickers: ['AAPL', 'AAPL'],
        section: 'risk factors',
        filingContexts: [
          { ticker: 'AAPL', companyName: 'Apple', text: 'A' },
          { ticker: 'AAPL', companyName: 'Apple', text: 'B' },
        ],
      }),
    }));
    const mismatched = await validateCompareRequest(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        tickers: ['AAPL', 'MSFT'],
        section: 'risk factors',
        filingContexts: [
          { ticker: 'MSFT', companyName: 'Microsoft', text: 'A' },
          { ticker: 'AAPL', companyName: 'Apple', text: 'B' },
        ],
      }),
    }));

    expect(duplicate.response?.status).toBe(400);
    expect(mismatched.response?.status).toBe(400);
  });

  it('parses a bounded JSON body', async () => {
    const result = await readJsonBody(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'hello' }),
    }), 1_024, 100);
    expect(result.value).toEqual({ prompt: 'hello' });
  });

  it('rejects a declared oversized body before reading it', async () => {
    const result = await readJsonBody(new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Length': '4096' },
      body: '{}',
    }), 100, 100);
    expect(result.response?.status).toBe(413);
  });

  it('times out a client that never finishes sending its body', async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const result = await readJsonBody(streamingRequest(stream), 1_024, 15);
    expect(result.response?.status).toBe(408);
  });

  it('propagates client cancellation while reading the body', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const pending = readJsonBody(streamingRequest(stream, controller.signal), 1_024, 1_000);
    controller.abort();
    const result = await pending;
    expect(result.response?.status).toBe(499);
  });
});
