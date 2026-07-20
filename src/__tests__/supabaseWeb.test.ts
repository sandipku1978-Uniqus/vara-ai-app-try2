import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('rejects service-role fallback and a non-urc_web JWT in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    const { getWebSupabase } = await import('../lib/supabase-web');

    expect(getWebSupabase()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();

    vi.resetModules();
    vi.stubEnv('URC_SUPABASE_WEB_KEY', unsignedRoleToken('service_role'));
    const reloaded = await import('../lib/supabase-web');
    expect(reloaded.getWebSupabase()).toBeNull();
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
      { auth: { persistSession: false } }
    );
  });

  it('allows the documented service-key fallback outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const { getWebSupabase } = await import('../lib/supabase-web');

    expect(getWebSupabase()).toEqual({ kind: 'restricted-client' });
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'local-service-key',
      { auth: { persistSession: false } }
    );
  });
});
