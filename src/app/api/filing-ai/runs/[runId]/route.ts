/**
 * GET /api/filing-ai/runs/:runId — the sealed run, with the disposition log
 * folded over it.
 */

import { NextResponse } from 'next/server';

import { requireApiAccess } from '../../../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../../lib/rate-limit';
import { loadRun, storageMode } from '../../../../../lib/filing-ai/store';
import { buildWorklist } from '../../../../../lib/filing-ai/scoring';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-ai-run-read' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const { runId } = await params;
  if (!/^run_[A-Za-z0-9-]{8,64}$/.test(runId)) {
    return NextResponse.json({ ok: false, error: 'Invalid run id.' }, { status: 400 });
  }

  try {
    const run = await loadRun(runId, access.identity.cacheScope);
    if (!run) {
      return NextResponse.json({ ok: false, error: 'Run not found.' }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, run, worklist: buildWorklist(run.findings), storage: storageMode() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[filing-ai] Failed to read run:', error);
    return NextResponse.json({ ok: false, error: 'The run could not be read.' }, { status: 500 });
  }
}
