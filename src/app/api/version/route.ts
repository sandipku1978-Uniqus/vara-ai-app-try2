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
 *
 * Rate-limited per instance rather than through KV: a release verifier (and
 * anyone diagnosing an incident) must be able to read provenance while the
 * distributed store is the thing that is down (audit 2026-09).
 */

import { NextResponse } from 'next/server';
import { configuredSupabaseOriginFingerprint } from '../../../lib/database-origin';
import { isDisabledEnvFlag } from '../../../lib/env-flags';
import { checkLocalRateLimit, localRateLimitResponse } from '../../../lib/local-rate-limit';
import { configuredReleaseGateNotAfterIso } from '../../../lib/release-gate-window';
import { withRouteObservability } from '../../../lib/route-observability';
import {
  readSchemaProvenanceWithinBudget,
  resetSchemaProvenanceStateForTests,
} from '../../../lib/schema-provenance';

export const maxDuration = 10;

export function effectiveFilingSearchBackend(): 'enriched' | 'legacy-sec-efts' {
  return !isDisabledEnvFlag(process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH)
    ? 'enriched'
    : 'legacy-sec-efts';
}

/** Test-only reset; the per-instance cache lives in lib/schema-provenance. */
export const resetVersionProvenanceStateForTests = resetSchemaProvenanceStateForTests;

async function handleGet(request: Request) {
  const rate = checkLocalRateLimit(request, { operation: 'version', ipLimit: 60 });
  if (!rate.allowed) return localRateLimitResponse(rate);

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

export const GET = withRouteObservability('version', handleGet);
