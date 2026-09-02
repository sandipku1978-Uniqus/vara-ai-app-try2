/**
 * GET /api/health — the uptime monitor's endpoint (audit 2026-09, "nobody is
 * paged; KV is a fail-closed single point of failure").
 *
 * Public, cheap, and honest: it reports whether the pieces every product
 * request depends on are answering right now — the restricted database read
 * and the KV store behind the rate limiters and the SEC request pacer — plus
 * which build is serving. It never reads secrets, never touches the model,
 * and never blocks on a dependency: each probe has its own budget, and a
 * failing probe is reported, not thrown.
 *
 * 200 when the platform can serve product requests, 503 when it cannot: a
 * failing database read, a configured KV store that does not answer (the
 * limiters fail closed in production, so every authenticated route is 503
 * too), or no KV in production (the SEC pacer refuses to run unpaced there).
 * Uptime monitors alert on non-200; docs/operations/observability.md.
 *
 * Rate-limited per instance, not through KV, precisely so a KV outage cannot
 * make the health check itself unavailable. A passing response is cacheable
 * at the edge for 30 seconds so a monitor polling every 30 seconds costs one
 * database read per instance; a failing one is never cached.
 */

import { NextResponse } from 'next/server';
import { isProductionDeployment } from '../../../lib/clerk-config';
import { checkLocalRateLimit, localRateLimitResponse } from '../../../lib/local-rate-limit';
import { withRouteObservability } from '../../../lib/route-observability';
import { readSchemaProvenanceWithinBudget } from '../../../lib/schema-provenance';

export const maxDuration = 10;

const KV_PROBE_BUDGET_MS = 1_000;
const KV_PROBE_KEY = 'urc:health:probe';

interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

async function probeDatabase(): Promise<ProbeResult & { schemaVersion: string | null }> {
  const startedAt = Date.now();
  const provenance = await readSchemaProvenanceWithinBudget();
  const ok = provenance.schemaVersion !== null;
  return {
    ok,
    latencyMs: Date.now() - startedAt,
    schemaVersion: provenance.schemaVersion,
    ...(ok ? {} : { detail: 'schema provenance read failed or exceeded its budget' }),
  };
}

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function probeKv(): Promise<ProbeResult & { configured: boolean }> {
  if (!kvConfigured()) {
    // Without KV, request controls fall back to per-instance memory (fine)
    // but the SEC request pacer refuses to run unpaced in production, so the
    // filing routes are down there even though nothing has "failed".
    const production = isProductionDeployment();
    return {
      configured: false,
      ok: !production,
      latencyMs: 0,
      detail: production
        ? 'KV is not configured: SEC request pacing is unavailable in production'
        : 'not configured; per-instance request controls in use',
    };
  }

  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const { kv } = await import('@vercel/kv');
    const outcome = await Promise.race([
      kv.get(KV_PROBE_KEY).then(() => 'ok' as const),
      new Promise<'timeout'>(resolve => {
        timeout = setTimeout(() => resolve('timeout'), KV_PROBE_BUDGET_MS);
      }),
    ]);
    const latencyMs = Date.now() - startedAt;
    return outcome === 'ok'
      ? { configured: true, ok: true, latencyMs }
      : { configured: true, ok: false, latencyMs, detail: 'probe exceeded its budget' };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? `probe failed: ${error.name}` : 'probe failed',
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function handleGet(request: Request) {
  const rate = checkLocalRateLimit(request, { operation: 'health', ipLimit: 60 });
  if (!rate.allowed) return localRateLimitResponse(rate);

  const checkedAt = new Date().toISOString();
  const [database, kv] = await Promise.all([probeDatabase(), probeKv()]);
  const ok = database.ok && kv.ok;

  return NextResponse.json(
    {
      ok,
      status: ok ? 'ok' : 'degraded',
      checkedAt,
      sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      environment: process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production-local' : 'development'),
      checks: {
        database,
        kv,
        ai: { configured: Boolean(process.env.ANTHROPIC_API_KEY) },
      },
    },
    {
      status: ok ? 200 : 503,
      headers: {
        'Cache-Control': ok
          ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=60'
          : 'no-store',
      },
    },
  );
}

export const GET = withRouteObservability('health', handleGet);
