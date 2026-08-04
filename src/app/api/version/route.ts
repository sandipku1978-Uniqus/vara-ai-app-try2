/**
 * GET /api/version — release provenance for the exact-SHA runbook.
 *
 * The release rule (remediation handoff WP0/T01) is: test one immutable
 * deployment, promote that same deployment, and prove production serves the
 * same revision. That proof needs the running deployment to say what it is.
 * This endpoint is deliberately public so an unauthenticated release runner
 * can verify an immutable candidate. Its response is an explicit allow-list
 * of Vercel build identifiers and database provenance — never credentials or
 * arbitrary environment values.
 */

import { NextResponse } from 'next/server';
import { configuredSupabaseOriginFingerprint } from '../../../lib/database-origin';
import { isDisabledEnvFlag } from '../../../lib/env-flags';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { configuredReleaseGateNotAfterIso } from '../../../lib/release-gate-window';
import { getWebSupabase } from '../../../lib/supabase-web';

const PROVENANCE_CACHE_TTL_MS = 30_000;
const PROVENANCE_FAILURE_CACHE_TTL_MS = 5_000;
const PROVENANCE_READ_BUDGET_MS = 1_500;
const PUBLIC_VERSION_IDENTITY = { userId: 'anonymous-version-reader', orgId: null };
const PROVENANCE_TIMEOUT = Symbol('schema-provenance-timeout');

export function effectiveFilingSearchBackend(): 'enriched' | 'legacy-sec-efts' {
  return !isDisabledEnvFlag(process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH)
    ? 'enriched'
    : 'legacy-sec-efts';
}

interface SchemaProvenance {
  schemaVersion: string | null;
  schemaMigrationCount: number | null;
  schemaChainChecksum: string | null;
  schemaChecksumAlgorithm: string | null;
}

const UNKNOWN_SCHEMA_PROVENANCE: SchemaProvenance = {
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
  // canonical migration payload. Reported best-effort — null means "could not
  // be determined", and the release gate treats any expected null/mismatch as
  // failure; this diagnostic route itself never blocks on the database read.
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

async function readSchemaProvenanceWithinBudget(): Promise<SchemaProvenance> {
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

/** Test-only reset for module-level server-instance cache/in-flight state. */
export function resetVersionProvenanceStateForTests(): void {
  cachedSchemaProvenance = null;
  schemaProvenanceInFlight = null;
}

export async function GET(request: Request) {
  const rate = await checkResourceRateLimit(request, PUBLIC_VERSION_IDENTITY, {
    operation: 'version',
    userLimit: 5_000,
    ipLimit: 60,
  });
  if (!rate.allowed) return rateLimitResponse(rate);

  const provenance = await readSchemaProvenanceWithinBudget();

  return NextResponse.json(
    {
      ok: true,
      sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      ref: process.env.VERCEL_GIT_COMMIT_REF || null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      environment: process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production-local' : 'development'),
      filingSearchBackend: effectiveFilingSearchBackend(),
      releaseGateNotAfter: configuredReleaseGateNotAfterIso(),
      schemaDatabaseFingerprint: configuredSupabaseOriginFingerprint(),
      ...provenance,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
