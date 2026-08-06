/**
 * GET  /api/filing-ai/engagements — engagements visible to this scope.
 * POST /api/filing-ai/engagements — create one, or advance its onboarding.
 *
 * An engagement cannot be activated until every blocking onboarding step is
 * complete and the team can actually dispose of what the engine will find.
 * That check runs here rather than at the first critical finding, which is
 * always the night before a filing deadline.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireApiAccess } from '../../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import {
  checkTeamComposition,
  defaultOnboardingSteps,
  onboardingState,
} from '../../../../lib/filing-ai/governance';
import { listEngagements, loadEngagement, saveEngagement, storageMode } from '../../../../lib/filing-ai/store';
import type {
  Engagement,
  EngagementMember,
  EngagementRole,
  OnboardingStepId,
  Severity,
} from '../../../../lib/filing-ai/types';

const ROLES = new Set<EngagementRole>(['preparer', 'reviewer', 'engagement_partner', 'rule_board', 'observer']);
const STEP_IDS = new Set<OnboardingStepId>(['entity', 'scope', 'authority', 'team', 'access', 'activation']);
const SEVERITIES = new Set<Severity>(['critical', 'high', 'medium', 'low']);

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

function decorate(engagement: Engagement) {
  return {
    ...engagement,
    onboarding_state: onboardingState(engagement),
    team_check: checkTeamComposition(engagement.members),
  };
}

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-ai-engagements' });
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const engagements = await listEngagements(access.identity.cacheScope);
    return NextResponse.json(
      { ok: true, engagements: engagements.map(decorate), storage: storageMode() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[filing-ai] Failed to list engagements:', error);
    return NextResponse.json({ ok: false, error: 'Engagements could not be listed.' }, { status: 500 });
  }
}

interface EngagementBody {
  action?: unknown;
  engagement_id?: unknown;
  client_name?: unknown;
  cik?: unknown;
  forms_in_scope?: unknown;
  tier_authorised?: unknown;
  four_eyes_threshold?: unknown;
  data_residency?: unknown;
  retention_years?: unknown;
  member?: { name?: unknown; email?: unknown; role?: unknown; acknowledged?: unknown };
  member_id?: unknown;
  step_id?: unknown;
}

export async function POST(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-ai-engagement-write' });
  if (!rate.allowed) return rateLimitResponse(rate);

  let body: EngagementBody;
  try {
    body = (await request.json()) as EngagementBody;
  } catch {
    return badRequest('Request body must be JSON.');
  }

  const action = String(body.action ?? 'create');
  const now = new Date().toISOString();
  const scope = access.identity.cacheScope;

  try {
    if (action === 'create') {
      const clientName = String(body.client_name ?? '').trim();
      const cik = String(body.cik ?? '').replace(/\D/g, '');
      if (clientName.length < 2) return badRequest('A client name is required.');
      if (!cik) return badRequest('A valid CIK is required.');

      const forms = Array.isArray(body.forms_in_scope)
        ? body.forms_in_scope.map(form => String(form).toUpperCase()).filter(Boolean)
        : ['10-K'];
      const tier = Number(body.tier_authorised ?? 0);
      if (!Number.isInteger(tier) || tier < 0 || tier > 3) return badRequest('Tier must be between 0 and 3.');

      const threshold = String(body.four_eyes_threshold ?? 'critical') as Severity;
      if (!SEVERITIES.has(threshold)) return badRequest('Invalid four-eyes threshold.');

      const retention = Number(body.retention_years ?? 7);
      if (!Number.isInteger(retention) || retention < 1 || retention > 25) {
        return badRequest('Retention must be between 1 and 25 years.');
      }

      const engagement: Engagement = {
        engagement_id: `eng_${randomUUID()}`,
        client_name: clientName,
        cik: cik.padStart(10, '0'),
        forms_in_scope: forms,
        tier_authorised: tier,
        status: 'onboarding',
        created_at: now,
        created_by: access.identity.userId,
        members: [],
        onboarding: defaultOnboardingSteps(),
        four_eyes_threshold: threshold,
        data_residency: String(body.data_residency ?? 'us'),
        retention_years: retention,
      };
      await saveEngagement(engagement, scope);
      return NextResponse.json({ ok: true, engagement: decorate(engagement) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const engagementId = String(body.engagement_id ?? '').trim();
    if (!engagementId) return badRequest('An engagement id is required.');
    const engagement = await loadEngagement(engagementId, scope);
    if (!engagement) return NextResponse.json({ ok: false, error: 'Engagement not found.' }, { status: 404 });

    if (action === 'add_member') {
      const name = String(body.member?.name ?? '').trim();
      const email = String(body.member?.email ?? '').trim();
      const role = String(body.member?.role ?? '') as EngagementRole;
      if (name.length < 2) return badRequest('A member name is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return badRequest('A valid member email is required.');
      if (!ROLES.has(role)) return badRequest('A valid engagement role is required.');
      if (engagement.members.some(member => member.email.toLowerCase() === email.toLowerCase())) {
        return badRequest('That email is already on the engagement.');
      }

      const member: EngagementMember = {
        member_id: `mem_${randomUUID()}`,
        name,
        email,
        role,
        added_at: now,
        added_by: access.identity.userId,
        // Access and confidentiality terms are acknowledged at onboarding (G7).
        acknowledged_at: body.member?.acknowledged ? now : undefined,
      };
      const updated: Engagement = { ...engagement, members: [...engagement.members, member] };
      await saveEngagement(updated, scope);
      return NextResponse.json({ ok: true, engagement: decorate(updated) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'remove_member') {
      const memberId = String(body.member_id ?? '').trim();
      const updated: Engagement = {
        ...engagement,
        members: engagement.members.filter(member => member.member_id !== memberId),
      };
      await saveEngagement(updated, scope);
      return NextResponse.json({ ok: true, engagement: decorate(updated) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'complete_step') {
      const stepId = String(body.step_id ?? '') as OnboardingStepId;
      if (!STEP_IDS.has(stepId)) return badRequest('Unknown onboarding step.');

      // The team step cannot be signed off while the team could not dispose of
      // what the engine will find.
      if (stepId === 'team') {
        const team = checkTeamComposition(engagement.members);
        if (!team.satisfied) {
          return NextResponse.json(
            { ok: false, error: 'The team does not yet satisfy the disposition requirements.', problems: team.problems },
            { status: 422 },
          );
        }
      }

      const onboarding = engagement.onboarding.map(step =>
        step.id === stepId
          ? { ...step, complete: true, completed_by: access.identity.userId, completed_at: now }
          : step,
      );

      if (stepId === 'activation') {
        const outstanding = onboarding.filter(step => step.blocking && step.id !== 'activation' && !step.complete);
        if (outstanding.length > 0) {
          return NextResponse.json(
            {
              ok: false,
              error: 'Activation is blocked until the preceding onboarding steps are complete.',
              problems: outstanding.map(step => step.label),
            },
            { status: 422 },
          );
        }
      }

      const updated: Engagement = {
        ...engagement,
        onboarding,
        status: stepId === 'activation' ? 'active' : engagement.status,
      };
      await saveEngagement(updated, scope);
      return NextResponse.json({ ok: true, engagement: decorate(updated) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return badRequest('Unknown action.');
  } catch (error) {
    console.error('[filing-ai] Engagement write failed:', error);
    return NextResponse.json({ ok: false, error: 'The engagement could not be updated.' }, { status: 500 });
  }
}
