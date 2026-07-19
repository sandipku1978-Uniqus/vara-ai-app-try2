/**
 * Supabase client + chunked upsert for the data pipeline.
 *
 * Env (either pair works — URC_-prefixed wins so the layer can point at a
 * dedicated project while the app itself lives elsewhere):
 *   URC_SUPABASE_URL / URC_SUPABASE_SERVICE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseUrl(): string | undefined {
  return process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseServiceKey(): string | undefined {
  return process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function createServiceClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set URC_SUPABASE_URL + URC_SUPABASE_SERVICE_KEY ' +
      '(or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).'
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Upsert rows in chunks; throws on the first failed chunk with context. */
export async function chunkedUpsert(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 1000,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (error) {
      throw new Error(`Upsert into ${table} failed at rows ${i}-${i + chunk.length}: ${error.message}`);
    }
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
  }
}
