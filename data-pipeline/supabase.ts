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

/** Upsert rows in chunks with retry — long backfills hit transient network
 *  blips, and upserts are idempotent so retrying a chunk is always safe. */
export async function chunkedUpsert(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 1000,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const MAX_ATTEMPTS = 4;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let lastMessage = '';
    let succeeded = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !succeeded; attempt++) {
      try {
        const { error } = await client.from(table).upsert(chunk, { onConflict });
        if (!error) {
          succeeded = true;
          break;
        }
        lastMessage = error.message;
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error);
      }
      if (attempt + 1 < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 1500 * 2 ** attempt));
      }
    }
    if (!succeeded) {
      throw new Error(`Upsert into ${table} failed at rows ${i}-${i + chunk.length} after ${MAX_ATTEMPTS} attempts: ${lastMessage}`);
    }
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
  }
}
