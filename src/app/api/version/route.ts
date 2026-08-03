/**
 * GET /api/version — release provenance for the exact-SHA runbook.
 *
 * The release rule (remediation handoff WP0/T01) is: test one immutable
 * deployment, promote that same deployment, and prove production serves the
 * same revision. That proof needs the running deployment to say what it is.
 * Only Vercel-injected build metadata is exposed — never credentials or
 * environment values.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { getWebSupabase } from '../../../lib/supabase-web';

export async function GET() {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  // Database provenance (readiness audit R0/R3): the app SHA and the schema
  // version are one release candidate. Reported best-effort — null means
  // "could not be determined", and the release gate treats null as failure
  // when it expects a version; this route never blocks on it.
  let schemaVersion: string | null = null;
  try {
    const db = getWebSupabase();
    if (db) {
      const { data } = await db.rpc('urc_schema_version');
      schemaVersion = typeof data === 'string' ? data : null;
    }
  } catch {
    schemaVersion = null;
  }

  return NextResponse.json(
    {
      ok: true,
      sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      ref: process.env.VERCEL_GIT_COMMIT_REF || null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      environment: process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production-local' : 'development'),
      schemaVersion,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
