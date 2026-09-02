/**
 * Best-effort, budgeted read of the live database's schema provenance
 * (version, migration count, chain checksum) through the restricted web
 * identity. Shared by /api/version (the exact-SHA release runbook) and
 * /api/health (the uptime monitor): both are public and neither may block on
 * the database, so the read is capped, cached per instance, and reports null
 * rather than throwing. Null fails the release verifier closed; the health
 * route reports it as a failing database check.
 */

import { getWebSupabase } from './supabase-web';

const PROVENANCE_CACHE_TTL_MS = 30_000;
const PROVENANCE_FAILURE_CACHE_TTL_MS = 5_000;
const PROVENANCE_READ_BUDGET_MS = 1_500;
const PROVENANCE_TIMEOUT = Symbol('schema-provenance-timeout');

export interface SchemaProvenance {
  schemaVersion: string | null;
  schemaMigrationCount: number | null;
  schemaChainChecksum: string | null;
  schemaChecksumAlgorithm: string | null;
}

export const UNKNOWN_SCHEMA_PROVENANCE: SchemaProvenance = {
  schemaVersion: null,
  schemaMigrationCount: null,
  schemaChainChecksum: null,
  schemaChecksumAlgorithm: null,
};

let cachedSchemaProvenance: { value: SchemaProvenance; expiresAt: number } | null = null;
let schemaProvenanceInFlight: Promise<SchemaProvenance> | null = null;

async function querySchemaProvenance(): Promise<SchemaProvenance> {
  // Database provenance (readiness audit R0/R3): a version number alone does
  // not prove that the numbered files were unchanged or replayed in the same
  // order. Migration 021 returns the version plus a SHA-256 identity of every
  // canonical migration payload.
  try {
    const db = getWebSupabase();
    if (db) {
      const { data, error } = await db.rpc('urc_schema_provenance');
      if (!error && data && typeof data === 'object' && !Array.isArray(data)) {
        const provenance = data as Record<string, unknown>;
        return {
          schemaVersion: typeof provenance.schemaVersion === 'string'
            ? provenance.schemaVersion
            : null,
          schemaMigrationCount: typeof provenance.schemaMigrationCount === 'number'
            ? provenance.schemaMigrationCount
            : null,
          schemaChainChecksum: typeof provenance.schemaChainChecksum === 'string'
            ? provenance.schemaChainChecksum
            : null,
          schemaChecksumAlgorithm: typeof provenance.schemaChecksumAlgorithm === 'string'
            ? provenance.schemaChecksumAlgorithm
            : null,
        };
      } else {
        // During the 020 → 021 rollout the old RPC still lets the endpoint say
        // which version is live. Checksum-aware release gates will correctly
        // reject the null chain identity until 021 has actually been applied.
        const legacy = await db.rpc('urc_schema_version');
        return {
          ...UNKNOWN_SCHEMA_PROVENANCE,
          schemaVersion: typeof legacy.data === 'string' ? legacy.data : null,
        };
      }
    }
  } catch {
    // A public diagnostic must not turn database failures into unhandled
    // errors. Null provenance fails the release verifier closed.
  }
  return UNKNOWN_SCHEMA_PROVENANCE;
}

function startSchemaProvenanceRead(): Promise<SchemaProvenance> {
  const read = querySchemaProvenance();
  schemaProvenanceInFlight = read;
  void read.then(value => {
    if (schemaProvenanceInFlight !== read) return;
    const ttl = value.schemaVersion ? PROVENANCE_CACHE_TTL_MS : PROVENANCE_FAILURE_CACHE_TTL_MS;
    cachedSchemaProvenance = { value, expiresAt: Date.now() + ttl };
  }).finally(() => {
    if (schemaProvenanceInFlight === read) schemaProvenanceInFlight = null;
  });
  return read;
}

export async function readSchemaProvenanceWithinBudget(): Promise<SchemaProvenance> {
  const now = Date.now();
  if (cachedSchemaProvenance && cachedSchemaProvenance.expiresAt > now) {
    return cachedSchemaProvenance.value;
  }

  const read = schemaProvenanceInFlight || startSchemaProvenanceRead();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      read,
      new Promise<typeof PROVENANCE_TIMEOUT>(resolve => {
        timeout = setTimeout(() => resolve(PROVENANCE_TIMEOUT), PROVENANCE_READ_BUDGET_MS);
      }),
    ]);
    if (result !== PROVENANCE_TIMEOUT) return result;

    // Supabase's client promise cannot be cancelled. Detach a timed-out read
    // so this instance can recover later, but negative-cache the result to
    // prevent anonymous traffic from spawning another orphan immediately.
    if (schemaProvenanceInFlight === read) schemaProvenanceInFlight = null;
    cachedSchemaProvenance = {
      value: UNKNOWN_SCHEMA_PROVENANCE,
      expiresAt: Date.now() + PROVENANCE_FAILURE_CACHE_TTL_MS,
    };
    return UNKNOWN_SCHEMA_PROVENANCE;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Test-only reset for module-level per-instance cache/in-flight state. */
export function resetSchemaProvenanceStateForTests(): void {
  cachedSchemaProvenance = null;
  schemaProvenanceInFlight = null;
}
