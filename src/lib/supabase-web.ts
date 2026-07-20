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
  const localServiceKey = !isProductionDeployment()
    ? process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    : undefined;
  const key = webKey || localServiceKey;
  if (!url || !key) return null;

  if (isProductionDeployment() && jwtRole(key) !== 'urc_web') {
    console.error('URC_SUPABASE_WEB_KEY must be a JWT for the restricted urc_web role.');
    return null;
  }

  webClient = createClient(url, key, { auth: { persistSession: false } });
  return webClient;
}
