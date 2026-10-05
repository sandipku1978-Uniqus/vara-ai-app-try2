import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  access: { identity: { userId: 'u1', orgId: null, cacheScope: 'u1:personal' } } as { identity?: unknown; response?: Response },
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => mocks.access,
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock('../lib/cache', () => ({
  cacheService: {
    get: async (key: string) => mocks.cache.get(key) ?? null,
    set: async (key: string, value: unknown) => { mocks.cache.set(key, value); },
  },
}));

import { GET } from '../app/api/asu/route';

const FIXTURES = join(process.cwd(), 'src', '__tests__', 'fixtures', 'fasb');
const blocked = readFileSync(join(FIXTURES, 'cloudflare-blocked.html'), 'utf8');
const payloads: Record<string, string> = {
  '394009': readFileSync(join(FIXTURES, 'issued-listing.json'), 'utf8'),
  '394105': readFileSync(join(FIXTURES, 'effective-dates-first-40.json'), 'utf8'),
  '393996': readFileSync(join(FIXTURES, 'documents-open-for-comment.json'), 'utf8'),
};

describe('GET /api/asu', () => {
  beforeEach(() => {
    mocks.cache.clear();
    mocks.access = { identity: { userId: 'u1', orgId: null, cacheScope: 'u1:personal' } };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('filters the live index to one Codification topic and returns its coverage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const id = String(input).match(/pagination\/22\/(\d+)\//)?.[1] ?? '';
      return new Response(payloads[id], { status: 200 });
    }));
    const response = await GET(new Request('https://urc.test/api/asu?topic=280'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.entries.map((entry: { number: string }) => entry.number)).toContain('2023-07');
    expect(body.entries.every((entry: { ascTopics: string[] }) => entry.ascTopics.includes('280'))).toBe(true);
    expect(body.coverage.source).toBe('live');
    expect(body.coverage.pagesRead).toBe(3);
  });

  it('falls back to the saved copy when FASB blocks the server, and labels it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(blocked, { status: 403 })));
    const response = await GET(new Request('https://urc.test/api/asu?number=2016-02'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].title).toBe('Leases (Topic 842)');
    expect(body.coverage.source).toBe('snapshot');
    expect(body.coverage.notes[0]).toMatch(/showing the copy read from fasb\.org on 2026-10-05/);
  });

  it('rejects a malformed topic', async () => {
    const response = await GET(new Request('https://urc.test/api/asu?topic=revenue'));
    expect(response.status).toBe(400);
  });

  it('requires API access', async () => {
    mocks.access = { response: new Response(null, { status: 401 }) };
    const response = await GET(new Request('https://urc.test/api/asu'));
    expect(response.status).toBe(401);
  });
});
