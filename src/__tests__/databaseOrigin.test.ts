import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configuredSupabaseOrigin,
  normalizeSupabaseOrigin,
  supabaseOriginFingerprint,
} from '../lib/database-origin';

describe('database origin release binding', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('normalizes the exact configured runtime origin deterministically', () => {
    vi.stubEnv('URC_SUPABASE_URL', '  https://Example.Supabase.co/  ');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://other.supabase.co');

    expect(configuredSupabaseOrigin()).toBe('https://example.supabase.co');
    expect(supabaseOriginFingerprint(configuredSupabaseOrigin())).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(supabaseOriginFingerprint('https://example.supabase.co/')).toBe(
      supabaseOriginFingerprint('https://EXAMPLE.supabase.co'),
    );
    expect(supabaseOriginFingerprint('https://other.supabase.co')).not.toBe(
      supabaseOriginFingerprint('https://example.supabase.co'),
    );
  });

  it('rejects ambiguous or unsafe endpoint forms while permitting local Supabase', () => {
    expect(normalizeSupabaseOrigin('http://supabase.example.test')).toBeNull();
    expect(normalizeSupabaseOrigin('https://user:pass@example.supabase.co')).toBeNull();
    expect(normalizeSupabaseOrigin('https://example.supabase.co/rest')).toBeNull();
    expect(normalizeSupabaseOrigin('https://example.supabase.co?project=other')).toBeNull();
    expect(normalizeSupabaseOrigin('http://127.0.0.1:54321/')).toBe('http://127.0.0.1:54321');
  });
});
