/**
 * Governance — G1 to G8, the layer that makes the output usable as control
 * evidence rather than an opinion.
 *
 * The rules here are not workflow decoration. A finding that closes without a
 * named actor and a rationale is not evidence that a control operated; it is a
 * row in a database. Everything in this file exists to make the difference
 * between those two things enforceable.
 */

import type {
  Disposition,
  Engagement,
  EngagementMember,
  EngagementRole,
  Finding,
  FindingStatus,
  OnboardingStep,
  Severity,
} from './types';

export const ENGAGEMENT_ROLES: Array<{
  role: EngagementRole;
  label: string;
  summary: string;
  /** What this role may do that the role below it may not. */
  capabilities: string[];
}> = [
  {
    role: 'preparer',
    label: 'Preparer',
    summary: 'Runs pre-flight checks and remediates findings in the draft.',
    capabilities: [
      'Start a run against a draft filing',
      'Mark a finding remediated once the draft is corrected',
      'Add remediation notes',
    ],
  },
  {
    role: 'reviewer',
    label: 'Reviewer',
    summary: 'Disposes of findings the preparer cannot close by correcting the draft.',
    capabilities: [
      'Everything a preparer may do',
      'Accept a low, medium or high finding with a written rationale',
      'Suppress a finding for a stated period, with an expiry date',
    ],
  },
  {
    role: 'engagement_partner',
    label: 'Engagement partner',
    summary: 'Owns the engagement and provides the second signature on critical acceptances.',
    capabilities: [
      'Everything a reviewer may do',
      'Provide the second approval on a critical finding (four eyes)',
      'Add and remove engagement members',
      'Close the engagement',
    ],
  },
  {
    role: 'rule_board',
    label: 'Rule board member',
    summary: 'Approves rule promotions in the catalog. Independent of any one engagement.',
    capabilities: [
      'Promote a rule through Back-tested, Reviewed, Approved and Live',
      'Retire a rule',
      'Read every engagement’s findings for calibration',
    ],
  },
  {
    role: 'observer',
    label: 'Observer',
    summary: 'Read-only access, for client-side stakeholders and internal audit.',
    capabilities: ['Read runs, findings and evidence packs', 'Export the exception report'],
  },
];

const ROLE_RANK: Record<EngagementRole, number> = {
  observer: 0,
  preparer: 1,
  reviewer: 2,
  engagement_partner: 3,
  // The rule board sits outside the engagement hierarchy: it governs the
  // catalog, not a filing, and deliberately holds no disposition authority.
  rule_board: 0,
};

/** The onboarding gate. An engagement cannot run until every blocking step is done. */
export function defaultOnboardingSteps(): OnboardingStep[] {
  return [
    {
      id: 'entity',
      label: 'Confirm the registrant',
      description:
        'CIK, legal name, fiscal year end and filer status, reconciled to EDGAR. Everything the engine tests the cover page against comes from here (G3).',
      complete: false,
      blocking: true,
    },
    {
      id: 'scope',
      label: 'Agree forms and tier',
      description:
        'Which forms are in scope and which input tier the client will supply. The tier fixes what the output can claim, so it is agreed before the first run, not after (G6).',
      complete: false,
      blocking: true,
    },
    {
      id: 'authority',
      label: 'Pin the authority corpus',
      description:
        'Reg S-K, Reg S-X, ASC as-of date, taxonomy year and DQC ruleset are pinned to the filing period, never to the run date (G8).',
      complete: false,
      blocking: true,
    },
    {
      id: 'team',
      label: 'Name the team and roles',
      description:
        'At minimum one preparer, one reviewer and one engagement partner. Critical acceptances need two named people, so an engagement with one member cannot dispose of a critical finding (G3).',
      complete: false,
      blocking: true,
    },
    {
      id: 'access',
      label: 'Confirm access and residency',
      description:
        'Tenant isolation, single sign-on through the client’s identity provider, encryption at rest and in transit, data residency and retention period (G7).',
      complete: false,
      blocking: true,
    },
    {
      id: 'activation',
      label: 'Activate the engagement',
      description:
        'The engagement partner signs off that the preceding steps are done. Runs before this point are marked as pilot and cannot be relied on as control evidence.',
      complete: false,
      blocking: true,
    },
  ];
}

export interface OnboardingState {
  ready: boolean;
  completed: number;
  total: number;
  blocking_outstanding: OnboardingStep[];
}

export function onboardingState(engagement: Engagement): OnboardingState {
  const blockingOutstanding = engagement.onboarding.filter(step => step.blocking && !step.complete);
  return {
    ready: blockingOutstanding.length === 0,
    completed: engagement.onboarding.filter(step => step.complete).length,
    total: engagement.onboarding.length,
    blocking_outstanding: blockingOutstanding,
  };
}

export interface TeamCheck {
  satisfied: boolean;
  problems: string[];
}

/**
 * A team that cannot dispose of what the engine will find is not a team.
 * Checked at onboarding rather than discovered when the first critical finding
 * lands the night before a filing deadline.
 */
export function checkTeamComposition(members: EngagementMember[]): TeamCheck {
  const problems: string[] = [];
  const byRole = new Map<EngagementRole, EngagementMember[]>();
  for (const member of members) {
    const existing = byRole.get(member.role);
    if (existing) existing.push(member);
    else byRole.set(member.role, [member]);
  }

  if (!byRole.has('preparer')) problems.push('No preparer is named; nobody can start a run or remediate a finding.');
  if (!byRole.has('reviewer')) problems.push('No reviewer is named; findings could only be closed by correcting the draft.');
  if (!byRole.has('engagement_partner')) {
    problems.push('No engagement partner is named; critical findings could never obtain a second approval.');
  }

  const disposers = members.filter(member => ROLE_RANK[member.role] >= ROLE_RANK.reviewer);
  if (disposers.length < 2) {
    problems.push(
      'Fewer than two members can dispose of a finding; the four-eyes requirement on critical acceptances (G3) could not be met.',
    );
  }

  const unacknowledged = members.filter(member => !member.acknowledged_at);
  if (unacknowledged.length > 0) {
    problems.push(
      `${unacknowledged.length} member(s) have not acknowledged the access and confidentiality terms: ${unacknowledged
        .map(member => member.name)
        .join(', ')}.`,
    );
  }

  return { satisfied: problems.length === 0, problems };
}

export interface DispositionRequest {
  status: Exclude<FindingStatus, 'open'>;
  actor: string;
  actor_role: EngagementRole;
  rationale: string;
  four_eyes_by?: string;
  four_eyes_role?: EngagementRole;
  expires_at?: string;
}

export interface DispositionCheck {
  allowed: boolean;
  reason: string;
}

const MINIMUM_RATIONALE_WORDS = 5;

/**
 * G3. Disposition requires an actor and a rationale; critical acceptances
 * require a second named approver; suppressions require an expiry.
 *
 * A judgment finding may never auto-clear (GR-4) — the caller must supply a
 * human, which is enforced here as much as in the type system.
 */
export function checkDisposition(
  finding: Finding,
  request: DispositionRequest,
  fourEyesThreshold: Severity = 'critical',
): DispositionCheck {
  if (!request.actor.trim()) {
    return { allowed: false, reason: 'A disposition must name the person making it.' };
  }
  if (request.rationale.trim().split(/\s+/).filter(Boolean).length < MINIMUM_RATIONALE_WORDS) {
    return {
      allowed: false,
      reason: `A disposition rationale must explain the basis for the decision (at least ${MINIMUM_RATIONALE_WORDS} words).`,
    };
  }

  const rank = ROLE_RANK[request.actor_role];
  if (request.status === 'remediated' && rank < ROLE_RANK.preparer) {
    return { allowed: false, reason: 'Only a preparer or above may mark a finding remediated.' };
  }
  if ((request.status === 'accepted' || request.status === 'suppressed') && rank < ROLE_RANK.reviewer) {
    return { allowed: false, reason: 'Only a reviewer or above may accept or suppress a finding.' };
  }

  if (request.status === 'suppressed' && !request.expires_at) {
    return {
      allowed: false,
      reason: 'A suppression must carry an expiry date so it is revisited rather than becoming permanent.',
    };
  }

  const severityRank = ['low', 'medium', 'high', 'critical'];
  const needsFourEyes =
    request.status === 'accepted'
    && severityRank.indexOf(finding.severity) >= severityRank.indexOf(fourEyesThreshold);
  if (needsFourEyes) {
    if (!request.four_eyes_by?.trim()) {
      return {
        allowed: false,
        reason: `Accepting a ${finding.severity} finding requires a second named approver.`,
      };
    }
    if (request.four_eyes_by.trim().toLowerCase() === request.actor.trim().toLowerCase()) {
      return { allowed: false, reason: 'The second approver must be a different person.' };
    }
    if (request.four_eyes_role && ROLE_RANK[request.four_eyes_role] < ROLE_RANK.engagement_partner) {
      return { allowed: false, reason: 'The second approval on a critical finding must come from the engagement partner.' };
    }
  }

  if (finding.determinism === 'judgment' && request.status === 'remediated') {
    return {
      allowed: false,
      reason: 'A judgment prompt is closed by disposition with a rationale, not by remediation.',
    };
  }

  return { allowed: true, reason: 'Disposition satisfies the governance requirements.' };
}

export function applyDisposition(finding: Finding, request: DispositionRequest, at: string): Finding {
  const disposition: Disposition = {
    actor: request.actor.trim(),
    timestamp: at,
    rationale: request.rationale.trim(),
    four_eyes_by: request.four_eyes_by?.trim() || undefined,
    expires_at: request.expires_at || undefined,
  };
  return { ...finding, status: request.status, disposition };
}

/**
 * G4 metrics. Per-rule fire counts and false-positive dispositions are what
 * tell the rule board which rules to tighten — a rule accepted every time it
 * fires is a rule that should be retired, not a rule that is working.
 */
export interface RuleMetric {
  rule_id: string;
  fired: number;
  accepted: number;
  suppressed: number;
  remediated: number;
  open: number;
  /** Share of dispositions that closed without a correction to the filing. */
  acceptance_rate: number;
}

export function ruleMetrics(findings: Finding[]): RuleMetric[] {
  const byRule = new Map<string, RuleMetric>();
  for (const finding of findings) {
    const existing = byRule.get(finding.rule_id) ?? {
      rule_id: finding.rule_id,
      fired: 0,
      accepted: 0,
      suppressed: 0,
      remediated: 0,
      open: 0,
      acceptance_rate: 0,
    };
    existing.fired += 1;
    if (finding.status === 'accepted') existing.accepted += 1;
    if (finding.status === 'suppressed') existing.suppressed += 1;
    if (finding.status === 'remediated') existing.remediated += 1;
    if (finding.status === 'open') existing.open += 1;
    byRule.set(finding.rule_id, existing);
  }
  for (const metric of byRule.values()) {
    const disposed = metric.accepted + metric.suppressed + metric.remediated;
    metric.acceptance_rate = disposed === 0 ? 0 : (metric.accepted + metric.suppressed) / disposed;
  }
  return [...byRule.values()].sort((left, right) => right.fired - left.fired);
}
