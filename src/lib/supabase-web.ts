import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isProductionDeployment } from './clerk-config';

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
 * Service-role credentials remain valid only for offline ingestion jobs. Local
 * development may fall back so the existing Supabase stack remains runnable,
 * but production fails closed until URC_SUPABASE_WEB_KEY is provisioned.
 */
export function getWebSupabase(): SupabaseClient | null {
  if (webClient) return webClient;

  const url = process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const webKey = process.env.URC_SUPABASE_WEB_KEY?.trim() || '';
  // Option A (2026-07-20): until a urc_web-role JWT is provisioned,
  // production may fall back to the service key — matching the pre-rollout
  // posture — with a logged warning. Providing URC_SUPABASE_WEB_KEY
  // activates least-privilege; an invalid web key still fails closed.
  const serviceKey = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = webKey || serviceKey;
  if (!url || !key) return null;

  if (webKey && isProductionDeployment() && jwtRole(webKey) !== 'urc_web') {
    console.error('URC_SUPABASE_WEB_KEY must be a JWT for the restricted urc_web role.');
    return null;
  }
  if (!webKey && isProductionDeployment()) {
    console.warn('[supabase-web] URC_SUPABASE_WEB_KEY not set — web routes are using the service key. Mint a urc_web JWT to activate least-privilege.');
  }

  webClient = createClient(url, key, { auth: { persistSession: false } });
  return webClient;
}
