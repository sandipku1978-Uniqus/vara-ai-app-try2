/**
 * Refresh the planner statistics behind the dashboard's corpus counters.
 *
 * urc_data_stats() reports row counts from pg_class.reltuples, which is fast
 * but only moves when ANALYZE runs. Autovacuum will not analyze until roughly
 * 10% of a table changes; on 6.4M filings that is ~646,000 new rows, which a
 * daily ingest never reaches. The result: "Filings: 6,428,702" sat unchanged
 * from the initial load while the true count reached 6,463,716 — understated
 * by 35,014 and drifting further every day.
 *
 * Running this after ingestion keeps the estimate within one cycle of truth.
 * Migration 024 defines the RPC (service-role only, SECURITY DEFINER because
 * ANALYZE requires table ownership).
 */

import { createServiceClient } from './supabase';

async function main(): Promise<void> {
  const client = createServiceClient();
  const startedAt = Date.now();

  const { error } = await client.rpc('urc_refresh_data_stats');
  if (error) {
    // A stale counter is a visible, quantified inaccuracy on the dashboard —
    // fail the job rather than let it rot silently the way it already did.
    throw new Error(`urc_refresh_data_stats failed: ${error.message}`);
  }

  const { data, error: statsError } = await client.rpc('urc_data_stats');
  if (statsError) {
    throw new Error(`urc_data_stats read-back failed: ${statsError.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  console.log(
    `Refreshed corpus statistics in ${Math.round((Date.now() - startedAt) / 1000)}s — `
    + `filings ~${Number(row?.filings_estimate ?? 0).toLocaleString()} through ${row?.filings_through ?? '?'}, `
    + `letters ~${Number(row?.letters_estimate ?? 0).toLocaleString()} `
    + `(~${Number(row?.letters_with_text ?? 0).toLocaleString()} with text).`
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
