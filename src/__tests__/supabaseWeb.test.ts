import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const createClient = vi.hoisted(() => vi.fn(() => ({ kind: 'restricted-client' })));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

function unsignedRoleToken(role: string): string {
  return `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
}

describe('restricted Supabase web client', () => {
  beforeEach(() => {
    vi.resetModules();
    createClient.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('URC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('URC_SUPABASE_WEB_KEY', '');
    vi.stubEnv('URC_SUPABASE_SERVICE_KEY', 'local-service-key');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('production FAILS CLOSED without the web key — the service client is never initialized (WP2)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getWebSupabase } = await import('../lib/supabase-web');

    // No web key: null (routes return their typed 503s), never the service key.
    expect(getWebSupabase()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('refusing service-key fallback'));

    // A provided-but-wrong web key also fails closed.
    vi.resetModules();
    vi.stubEnv('URC_SUPABASE_WEB_KEY', unsignedRoleToken('service_role'));
    const reloaded = await import('../lib/supabase-web');
    expect(reloaded.getWebSupabase()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('a Vercel preview build (NODE_ENV=production) fails closed the same way', async () => {
    // Preview is where the restricted key gets proven before production —
    // a silent service fallback there would make the probes meaningless.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const { getWebSupabase } = await import('../lib/supabase-web');
    expect(getWebSupabase()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('constructs a production client only for a urc_web role token', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    const key = unsignedRoleToken('urc_web');
    vi.stubEnv('URC_SUPABASE_WEB_KEY', key);
    const { getWebSupabase } = await import('../lib/supabase-web');

    expect(getWebSupabase()).toEqual({ kind: 'restricted-client' });
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      key,
      { auth: { persistSession: false }, global: { fetch: expect.any(Function) } }
    );
  });

  it('keeps the production cache writer separate from the restricted read client', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    const webKey = unsignedRoleToken('anon');
    vi.stubEnv('URC_SUPABASE_WEB_KEY', webKey);
    vi.stubEnv('URC_SUPABASE_SERVICE_KEY', 'server-only-cache-writer-key');
    const { getCacheWriterSupabase, getWebSupabase } = await import('../lib/supabase-web');

    expect(getWebSupabase()).toEqual({ kind: 'restricted-client' });
    expect(getCacheWriterSupabase()).toEqual({ kind: 'restricted-client' });
    expect(createClient).toHaveBeenNthCalledWith(
      1,
      'https://example.supabase.co',
      webKey,
      { auth: { persistSession: false }, global: { fetch: expect.any(Function) } },
    );
    expect(createClient).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co',
      'server-only-cache-writer-key',
      { auth: { persistSession: false }, global: { fetch: expect.any(Function) } },
    );
  });

  it('documents the narrow runtime writer without reintroducing a read fallback', () => {
    const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
    const example = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');

    expect(readme).not.toContain('Do not add `URC_SUPABASE_SERVICE_KEY` to Vercel');
    expect(readme).toContain('three audited cache-writer routes');
    expect(example).toContain('never use it as');
    expect(example).toContain('production web-read fallback');
  });

  it('accepts the publishable key and a legacy anon JWT in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('URC_SUPABASE_WEB_KEY', 'sb_publishable_abc123');
    let mod = await import('../lib/supabase-web');
    expect(mod.getWebSupabase()).toEqual({ kind: 'restricted-client' });

    vi.resetModules();
    vi.stubEnv('URC_SUPABASE_WEB_KEY', unsignedRoleToken('anon'));
    mod = await import('../lib/supabase-web');
    expect(mod.getWebSupabase()).toEqual({ kind: 'restricted-client' });
  });

  it('rejects sb_secret keys in any environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('URC_SUPABASE_WEB_KEY', 'sb_secret_abc123');
    const { getWebSupabase } = await import('../lib/supabase-web');
    expect(getWebSupabase()).toBeNull();
  });

  it('allows the documented service-key fallback for local development only, loudly', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getWebSupabase } = await import('../lib/supabase-web');

    expect(getWebSupabase()).toEqual({ kind: 'restricted-client' });
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'local-service-key',
      { auth: { persistSession: false }, global: { fetch: expect.any(Function) } }
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('local development fallback'));
  });
});
