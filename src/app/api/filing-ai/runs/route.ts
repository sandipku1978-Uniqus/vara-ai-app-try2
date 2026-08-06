/**
 * POST /api/filing-ai/runs — execute a pre-flight integrity check.
 * GET  /api/filing-ai/runs — list this scope's recent runs.
 *
 * The request is a contract, not an upload (build spec §3). Everything the
 * caller sends is validated here; the tier they *declare* is recorded, but the
 * tier the run *executes at* is derived from the inputs that actually arrived
 * and passed their gates. A caller claiming Tier 2 without source data is a
 * Tier 1 run that says so in its own coverage statement.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireApiAccess } from '../../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { executeRun, RunRejected } from '../../../../lib/filing-ai/engine';
import { GuardrailViolation } from '../../../../lib/filing-ai/guardrails';
import { listRuns, loadEngagement, saveRun, storageMode } from '../../../../lib/filing-ai/store';
import { SecUpstreamError } from '../../../../lib/sec-upstream';
import type { BuildWave } from '../../../../lib/filing-ai/types';

/** A run makes several paced SEC round trips and parses a multi-megabyte document. */
export const maxDuration = 300;

const SUPPORTED_FORMS = new Set(['10-K']);
const DEPLOYED_WAVES: BuildWave[] = ['P0', 'P1'];

interface RunRequestBody {
  cik?: unknown;
  form_type?: unknown;
  accession?: unknown;
  tier?: unknown;
  engagement_id?: unknown;
  source_data_supplied?: unknown;
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-ai-runs-list' });
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const runs = await listRuns(access.identity.cacheScope);
    return NextResponse.json(
      { ok: true, runs, storage: storageMode() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[filing-ai] Failed to list runs:', error);
    return NextResponse.json({ ok: false, error: 'Runs could not be listed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  // A run is expensive in SEC round trips; it is rate-limited more tightly
  // than a read so one impatient user cannot spend the shared fair-access budget.
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-ai-run-execute' });
  if (!rate.allowed) return rateLimitResponse(rate);

  let body: RunRequestBody;
  try {
    body = (await request.json()) as RunRequestBody;
  } catch {
    return badRequest('Request body must be JSON.');
  }

  const cik = String(body.cik ?? '').replace(/\D/g, '');
  if (!cik || cik.length > 10) return badRequest('A valid CIK is required.');

  const formType = String(body.form_type ?? '10-K').trim().toUpperCase();
  if (!SUPPORTED_FORMS.has(formType)) {
    return badRequest(`Form ${formType} is not yet supported. This build covers ${[...SUPPORTED_FORMS].join(', ')}.`);
  }

  const accessionRaw = body.accession === undefined || body.accession === null ? '' : String(body.accession).trim();
  if (accessionRaw && !/^\d{10}-?\d{2}-?\d{6}$/.test(accessionRaw)) {
    return badRequest('Accession number must be in the form 0000320193-24-000123.');
  }

  const declaredTier = Number(body.tier ?? 0);
  if (!Number.isInteger(declaredTier) || declaredTier < 0 || declaredTier > 3) {
    return badRequest('Tier must be an integer between 0 and 3.');
  }

  const engagementId = body.engagement_id ? String(body.engagement_id).trim() : undefined;
  let stage: 'pilot' | 'production' = 'pilot';
  if (engagementId) {
    const engagement = await loadEngagement(engagementId, access.identity.cacheScope);
    if (!engagement) return badRequest('Engagement not found for this account.');
    if (engagement.status !== 'active') {
      return badRequest(
        'The engagement is not active. Complete the onboarding gate before running a check against it.',
      );
    }
    if (engagement.cik.replace(/\D/g, '') !== cik.padStart(10, '0').replace(/^0+/, '').padStart(10, '0')) {
      return badRequest('The requested CIK does not match the engagement’s registrant.');
    }
    // Even on an active engagement the catalog stage is what the rule board has
    // approved. The seed catalog is pre-approval, so runs stay marked pilot
    // until rules reach Live — the coverage statement says so either way.
    stage = 'pilot';
  }

  const runId = `run_${randomUUID()}`;
  try {
    const result = await executeRun({
      runId,
      cik,
      formType,
      accession: accessionRaw || undefined,
      declaredTier,
      stage,
      waves: DEPLOYED_WAVES,
      engagementId,
      sourceDataSupplied: Boolean(body.source_data_supplied),
      signal: request.signal,
    });

    try {
      await saveRun(result, { scope: access.identity.cacheScope, startedBy: access.identity.userId });
    } catch (error) {
      // The run itself succeeded. Returning it while reporting that it was not
      // durably stored is better than discarding several minutes of SEC work.
      console.error('[filing-ai] Failed to persist run:', error);
      return NextResponse.json(
        { ok: true, run: result, persisted: false, storage: storageMode() },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { ok: true, run: result, persisted: true, storage: storageMode() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof RunRejected) {
      return NextResponse.json(
        { ok: false, error: error.message, stage: error.stage, detail: error.detail },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof GuardrailViolation) {
      // A guardrail breach is a defect in the engine, not in the filing. The
      // result is withheld rather than released with a caveat.
      console.error(`[filing-ai] Guardrail ${error.guardrail} blocked a run:`, error.detail);
      return NextResponse.json(
        { ok: false, error: `The result was withheld by guardrail ${error.guardrail}.` },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof SecUpstreamError) {
      return NextResponse.json(
        { ok: false, error: `EDGAR could not be read: ${error.message}` },
        { status: error.status >= 400 && error.status <= 599 ? error.status : 502 },
      );
    }
    console.error('[filing-ai] Run failed:', error);
    return NextResponse.json({ ok: false, error: 'The run could not be completed.' }, { status: 500 });
  }
}
