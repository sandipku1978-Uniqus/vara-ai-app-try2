import { createHash } from 'node:crypto';

/**
 * Canonical database API origin shared by the runtime client and release
 * evidence. Keeping this resolution in one place prevents the attestation
 * from describing a different project than the application actually uses.
 */
export function normalizeSupabaseOrigin(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== '/' && url.pathname !== '')
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredSupabaseOrigin(): string | null {
  return normalizeSupabaseOrigin(
    process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

/**
 * The SHA-256 value is safe to publish and lets protected release code bind
 * the candidate's web reads to the independently probed service database.
 * The origin itself and all credentials remain private.
 */
export function supabaseOriginFingerprint(raw: string | null | undefined): string | null {
  const origin = normalizeSupabaseOrigin(raw);
  return origin
    ? `sha256:${createHash('sha256').update(origin).digest('hex')}`
    : null;
}

export function configuredSupabaseOriginFingerprint(): string | null {
  return supabaseOriginFingerprint(configuredSupabaseOrigin());
}
