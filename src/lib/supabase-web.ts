import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isProductionDeployment } from './clerk-config';
import { configuredSupabaseOrigin } from './database-origin';
import { fetchWithDeadline } from './fetch-with-deadline';

/**
 * HTTP deadlines for the two database identities, set just above their
 * Postgres statement budgets (urc_web 20 s per migration 014; the
 * cache-writer's single upsert is small) so a stalled connection surfaces
 * as an AbortError the route can classify instead of a platform kill.
 */
export const WEB_DB_HTTP_DEADLINE_MS = 25_000;
export const CACHE_WRITER_HTTP_DEADLINE_MS = 30_000;

let webClient: SupabaseClient | null = null;

function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

/**
 * Web request handlers must use the migration-defined `urc_web` Postgres role.
 * Service authority is never a production read identity. It remains available
 * separately to trusted jobs and getCacheWriterSupabase()'s three audited
 * server-only cache-writer routes. Local development may fall back so the existing
 * Supabase stack remains runnable, but production reads fail closed until
 * URC_SUPABASE_WEB_KEY is provisioned.
 */
export function getWebSupabase(): SupabaseClient | null {
  if (webClient) return webClient;

  const url = configuredSupabaseOrigin();
  const webKey = process.env.URC_SUPABASE_WEB_KEY?.trim() || '';
  if (!url) return null;

  // This Supabase project signs tokens with non-exportable asymmetric keys, so
  // a custom urc_web JWT cannot be minted. The supported least-privilege web
  // identity is the publishable/anon key (new `sb_publishable_...` format or a
  // legacy anon JWT); migration 014 grants that role exactly the read surface.
  // Anything carrying service authority is rejected outright.
  const isPublishable = webKey.startsWith('sb_publishable_');
  const role = isPublishable ? 'anon' : jwtRole(webKey);
  if (webKey && (role === 'service_role' || webKey.startsWith('sb_secret_'))) {
    console.error('[supabase-web] URC_SUPABASE_WEB_KEY carries service authority — refusing to use it for web routes.');
    return null;
  }
  if (webKey && isProductionDeployment() && !isPublishable && role !== 'anon' && role !== 'urc_web') {
    console.error('[supabase-web] URC_SUPABASE_WEB_KEY must be the publishable/anon key (or a urc_web JWT).');
    return null;
  }

  // Production fails CLOSED without the restricted key (remediation WP2):
  // web-facing reads must never escalate to service authority through a
  // configuration gap. Routes return their typed 503s and the client lanes
  // degrade to live EDGAR. Local development may still fall back so the
  // Supabase stack stays runnable from .env.local alone — explicitly, loudly,
  // and never on Vercel.
  let key = webKey;
  if (!webKey) {
    if (isProductionDeployment()) {
      console.error('[supabase-web] URC_SUPABASE_WEB_KEY not set — refusing service-key fallback; facet routes will 503. Apply db/migrations/014_web_read_contract.sql and set the publishable key (docs/pending-keys-checklist.md item 0).');
      return null;
    }
    const serviceKey = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return null;
    console.warn('[supabase-web] local development fallback: using the service key because URC_SUPABASE_WEB_KEY is not set. Production fails closed instead.');
    key = serviceKey;
  }

  webClient = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: fetchWithDeadline(WEB_DB_HTTP_DEADLINE_MS) },
  });
  return webClient;
}

/**
 * Cache-writer client — the ONLY other use of service authority in this file,
 * kept here deliberately.
 *
 * The web role reads through the least-privilege anon/publishable key and
 * cannot write. Populating the shared filing-text cache does need write
 * authority, and the migrationSecurity guardrail requires that service-role
 * credentials be readable from exactly one audited module — so this lives
 * beside getWebSupabase rather than in a file of its own.
 *
 * Writes must stay privileged: cached filing text drives Boolean matching, so
 * an anon-writable cache would let anyone poison what every user matches on.
 */
let cacheWriterClient: SupabaseClient | null = null;

export function getCacheWriterSupabase(): SupabaseClient | null {
  if (cacheWriterClient) return cacheWriterClient;

  const url = configuredSupabaseOrigin();
  const serviceKey = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  // A missing key is not an error: the cache is an accelerator, so callers fall
  // back to fetching from SEC rather than failing the request.
  if (!url || !serviceKey) return null;

  cacheWriterClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { fetch: fetchWithDeadline(CACHE_WRITER_HTTP_DEADLINE_MS) },
  });
  return cacheWriterClient;
}
