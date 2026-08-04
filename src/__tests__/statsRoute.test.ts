import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: true,
  rpc: vi.fn(),
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn().mockResolvedValue({
    identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' },
  }),
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
}));

vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => mocks.configured ? { rpc: mocks.rpc } : null,
}));

import { GET } from '../app/api/stats/route';

let completionSpy: MockInstance;

beforeEach(() => {
  mocks.configured = true;
  mocks.rpc.mockReset();
  completionSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  completionSpy.mockRestore();
});

describe('GET /api/stats observability contract', () => {
  it('emits one safe correlated completion record on success', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        filings_estimate: 1200,
        filings_through: '2026-08-01',
        auditors_estimate: 300,
        letters_estimate: 90,
        letters_with_text: 80,
        letters_retry_pending: 2,
      }],
      error: null,
    });

    const response = await GET(new Request('http://localhost/api/stats'));
    const body = await response.json();
    const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));

    expect(response.status).toBe(200);
    expect(body.filings.count).toBe(1200);
    expect(completionSpy).toHaveBeenCalledOnce();
    expect(completion).toMatchObject({
      kind: 'route-completion',
      route: 'stats',
      outcome: 'success',
      status: 200,
      rowCount: 1,
    });
    expect(response.headers.get('x-correlation-id')).toBe(completion.correlationId);
  });

  it('preserves typed DB classification and correlates the completion record', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await GET(new Request('http://localhost/api/stats'));
      const body = await response.json();
      const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));

      expect(response.status).toBe(500);
      expect(body).toMatchObject({
        ok: false,
        errorClass: 'permission',
        correlationId: expect.any(String),
      });
      expect(completion).toMatchObject({
        outcome: 'error',
        errorClass: 'permission',
        correlationId: body.correlationId,
      });
      expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns a stable generic envelope without logging thrown error content', async () => {
    const secret = 'secret-error-content-must-not-leak';
    mocks.rpc.mockRejectedValue(new Error(secret));

    const response = await GET(new Request('http://localhost/api/stats'));
    const body = await response.json();
    const rawCompletion = String(completionSpy.mock.calls[0][0]);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      errorClass: 'unexpected',
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(rawCompletion).not.toContain(secret);
    expect(JSON.parse(rawCompletion)).toMatchObject({
      kind: 'route-completion',
      route: 'stats',
      outcome: 'error',
      errorClass: 'unexpected',
      correlationId: body.correlationId,
    });
  });

  it('correlates a missing restricted-role configuration failure', async () => {
    mocks.configured = false;

    const response = await GET(new Request('http://localhost/api/stats'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      errorClass: 'configuration',
      correlationId: expect.any(String),
    });
    expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
    expect(JSON.parse(String(completionSpy.mock.calls[0][0]))).toMatchObject({
      outcome: 'error',
      errorClass: 'configuration',
      correlationId: body.correlationId,
    });
  });
});
