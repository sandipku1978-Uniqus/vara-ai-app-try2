/**
 * PATCH /api/filing-ai/runs/:runId/findings/:findingId — dispose of a finding.
 *
 * The governance check (G3) runs before the write. A disposition without a
 * named actor and a rationale, a suppression without an expiry, or a critical
 * acceptance without a second approver is refused here — it never reaches the
 * append-only log, because an audit trail of rejected attempts is worse than
 * no audit trail at all.
 */

import { NextResponse } from 'next/server';

import { requireApiAccess } from '../../../../../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../../../../lib/rate-limit';
import { loadEngagement, loadRun, recordDisposition } from '../../../../../../../lib/filing-ai/store';
import type { EngagementRole, FindingStatus, Severity } from '../../../../../../../lib/filing-ai/types';

const DISPOSITION_STATUSES = new Set<FindingStatus>(['remediated', 'accepted', 'suppressed']);
const ROLES = new Set<EngagementRole>(['preparer', 'reviewer', 'engagement_partner', 'rule_board', 'observer']);

interface DispositionBody {
  status?: unknown;
  actor?: unknown;
  actor_role?: unknown;
  rationale?: unknown;
  four_eyes_by?: unknown;
  four_eyes_role?: unknown;
  expires_at?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string; findingId: string }> },
) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-ai-disposition' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const { runId, findingId } = await params;
  if (!/^run_[A-Za-z0-9-]{8,64}$/.test(runId)) {
    return NextResponse.json({ ok: false, error: 'Invalid run id.' }, { status: 400 });
  }
  if (!/^FND-[A-Za-z0-9-]{3,64}$/.test(findingId)) {
    return NextResponse.json({ ok: false, error: 'Invalid finding id.' }, { status: 400 });
  }

  let body: DispositionBody;
  try {
    body = (await request.json()) as DispositionBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
  }

  const status = String(body.status ?? '') as FindingStatus;
  if (!DISPOSITION_STATUSES.has(status)) {
    return NextResponse.json(
      { ok: false, error: 'Status must be remediated, accepted or suppressed.' },
      { status: 400 },
    );
  }
  const actorRole = String(body.actor_role ?? '') as EngagementRole;
  if (!ROLES.has(actorRole)) {
    return NextResponse.json({ ok: false, error: 'A valid engagement role is required.' }, { status: 400 });
  }
  const fourEyesRole = body.four_eyes_role ? (String(body.four_eyes_role) as EngagementRole) : undefined;
  if (fourEyesRole && !ROLES.has(fourEyesRole)) {
    return NextResponse.json({ ok: false, error: 'A valid second-approver role is required.' }, { status: 400 });
  }

  const expiresAt = body.expires_at ? String(body.expires_at) : undefined;
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    return NextResponse.json({ ok: false, error: 'Expiry must be a valid date.' }, { status: 400 });
  }

  try {
    // The four-eyes threshold is an engagement setting, so it is read from the
    // engagement the run belongs to rather than assumed.
    let threshold: Severity = 'critical';
    const run = await loadRun(runId, access.identity.cacheScope);
    if (!run) return NextResponse.json({ ok: false, error: 'Run not found.' }, { status: 404 });
    if (run.subject.engagement_id) {
      const engagement = await loadEngagement(run.subject.engagement_id, access.identity.cacheScope);
      if (engagement) threshold = engagement.four_eyes_threshold;
    }

    const outcome = await recordDisposition(
      runId,
      findingId,
      {
        status: status as 'remediated' | 'accepted' | 'suppressed',
        actor: String(body.actor ?? ''),
        actor_role: actorRole,
        rationale: String(body.rationale ?? ''),
        four_eyes_by: body.four_eyes_by ? String(body.four_eyes_by) : undefined,
        four_eyes_role: fourEyesRole,
        expires_at: expiresAt,
      },
      access.identity.cacheScope,
      threshold,
    );

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.reason }, { status: 422 });
    }
    return NextResponse.json(
      { ok: true, finding: outcome.finding },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[filing-ai] Failed to record disposition:', error);
    return NextResponse.json({ ok: false, error: 'The disposition could not be recorded.' }, { status: 500 });
  }
}
