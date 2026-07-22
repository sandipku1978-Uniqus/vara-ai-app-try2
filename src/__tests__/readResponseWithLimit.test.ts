import { describe, it, expect } from 'vitest';
import { readResponseWithLimit, SecUpstreamError } from '../lib/sec-upstream';

// Build a Response whose body streams `chunkCount` chunks of `chunkSize` bytes,
// optionally advertising a content-length header.
function streamingResponse(chunkCount: number, chunkSize: number, withContentLength: boolean): Response {
  let emitted = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) {
        controller.close();
        return;
      }
      emitted += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(65)); // 'A'
    },
  });
  const headers = new Headers();
  if (withContentLength) headers.set('content-length', String(chunkCount * chunkSize));
  return new Response(stream, { headers });
}

describe('readResponseWithLimit', () => {
  it('returns the full body when under the limit', async () => {
    const bytes = await readResponseWithLimit(streamingResponse(4, 100, true), 1000);
    expect(bytes.byteLength).toBe(400);
  });

  it('throws 413 for an oversized body when not truncating (content-length)', async () => {
    await expect(readResponseWithLimit(streamingResponse(20, 100, true), 500))
      .rejects.toMatchObject({ status: 413 });
  });

  it('throws 413 for an oversized streamed body with no content-length', async () => {
    await expect(readResponseWithLimit(streamingResponse(20, 100, false), 500))
      .rejects.toBeInstanceOf(SecUpstreamError);
  });

  it('truncates to exactly maxBytes instead of throwing when truncate=true', async () => {
    // 20 x 100 = 2000 bytes advertised, cap 550 → truncated to 550.
    const bytes = await readResponseWithLimit(streamingResponse(20, 100, true), 550, undefined, 12_000, true);
    expect(bytes.byteLength).toBe(550);
    expect(bytes[0]).toBe(65);
  });

  it('truncates a no-content-length stream to maxBytes when truncate=true', async () => {
    const bytes = await readResponseWithLimit(streamingResponse(20, 100, false), 250, undefined, 12_000, true);
    expect(bytes.byteLength).toBe(250);
  });
});
