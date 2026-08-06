/**
 * Governance — the catalog board workflow (G1, G8) and disposition rules (G3).
 *
 * These constraints are what let a run be retained as control evidence rather
 * than filed as an opinion. A finding that closes without a named person and a
 * written basis is not evidence that a control operated.
 */

import { describe, expect, it } from 'vitest';

import { canPromote, loadCatalog, selectRules } from '../lib/filing-ai/catalog';
import {
  applyDisposition,
  checkDisposition,
  checkTeamComposition,
  defaultOnboardingSteps,
  onboardingState,
  ruleMetrics,
} from '../lib/filing-ai/governance';
import type {
  Engagement,
  EngagementMember,
  EngagementRole,
  Finding,
  Rule,
  Severity,
} from '../lib/filing-ai/types';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: 'FND-R-TEST-001',
    run_id: 'run_test',
    rule_id: 'R-TEST-001',
    rule_version: '1.0.0',
    layer: 'mechanical',
    determinism: 'deterministic',
    severity: 'medium',
    blocking: false,
    title: 'Test finding',
    description: 'A finding used to exercise the disposition rules.',
    evidence: { extracted: 'observed', expected: 'expected' },
    authority: ['Reg S-K Item 601'],
    remediation: 'Fix it.',
    confidence: 1,
    status: 'open',
    ...overrides,
  };
}

function member(role: EngagementRole, name: string, acknowledged = true): EngagementMember {
  return {
    member_id: `mem_${name}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    role,
    added_at: '2026-01-05T00:00:00.000Z',
    added_by: 'tester',
    acknowledged_at: acknowledged ? '2026-01-05T00:00:00.000Z' : undefined,
  };
}

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  ...(loadCatalog().rules[0] as Rule),
  ...overrides,
});

describe('G1 — rule board promotion ladder', () => {
  it('advances one stage at a time', () => {
    expect(canPromote(rule({ status: 'Draft' }), 'Live').allowed).toBe(false);
    expect(canPromote(rule({ status: 'Draft' }), 'Back-tested').allowed).toBe(false); // needs a back-test record
  });

  it('requires a back-test record against a named corpus', () => {
    const withBacktest = rule({
      status: 'Draft',
      backtest: { corpus_version: '2025-Q4', recall: 0.9, precision: 0.95 },
    });
    expect(canPromote(withBacktest, 'Back-tested').allowed).toBe(true);
  });

  it('requires a named reviewer before review sign-off', () => {
    expect(canPromote(rule({ status: 'Back-tested', reviewer: null }), 'Reviewed').allowed).toBe(false);
    expect(canPromote(rule({ status: 'Back-tested', reviewer: 'A. Reviewer' }), 'Reviewed').allowed).toBe(true);
  });

  it('refuses Live without both a reviewer and recorded recall and precision', () => {
    expect(canPromote(rule({ status: 'Approved', reviewer: 'A. Reviewer', backtest: null }), 'Live').allowed).toBe(false);
    expect(
      canPromote(
        rule({
          status: 'Approved',
          reviewer: 'A. Reviewer',
          backtest: { corpus_version: '2025-Q4', recall: 0.88, precision: 0.93 },
        }),
        'Live',
      ).allowed,
    ).toBe(true);
  });

  it('allows retirement from anywhere, because rules are never deleted', () => {
    expect(canPromote(rule({ status: 'Draft' }), 'Retired').allowed).toBe(true);
  });
});

describe('G8 — selection is by filing period, never run date', () => {
  const selection = (periodOfReport: string) =>
    selectRules({
      formType: '10-K',
      periodOfReport,
      inputsAvailable: ['I1', 'I2', 'I3', 'I4'],
      tierEffective: 1,
      stage: 'pilot',
      suppressedByGates: new Map(),
      waves: ['P0', 'P1'],
    });

  it('excludes a rule whose requirement was not yet in force', () => {
    // Exhibit 19 (insider trading policy) applies from FY2024.
    const early = selection('2022-12-31');
    expect(early.applicable.some(entry => entry.rule_id === 'R-MECH-EXH-005')).toBe(false);

    const later = selection('2025-12-31');
    expect(later.applicable.some(entry => entry.rule_id === 'R-MECH-EXH-005')).toBe(true);
  });

  it('excludes the ASU 2023-09 tax disclosure rules from an early period', () => {
    expect(selection('2023-12-31').applicable.some(entry => entry.rule_id === 'R-DISC-024')).toBe(false);
    expect(selection('2025-12-31').applicable.some(entry => entry.rule_id === 'R-DISC-024')).toBe(true);
  });

  it('gives every rule with a date-limited requirement an effective date', () => {
    const dated = loadCatalog().rules.filter(entry => entry.effective_from);
    expect(dated.length).toBeGreaterThanOrEqual(8);
  });
});

describe('rule selection and coverage', () => {
  it('suppresses rules whose inputs were not supplied', () => {
    const outcome = selectRules({
      formType: '10-K',
      periodOfReport: '2025-12-31',
      inputsAvailable: ['I1'],
      tierEffective: 0,
      stage: 'pilot',
      suppressedByGates: new Map(),
      waves: ['P0'],
    });
    expect(outcome.suppressed.some(entry => entry.reason.includes('Missing required input'))).toBe(true);
    expect(outcome.coverageFactor).toBeLessThan(1);
  });

  it('honours a gate suppression ahead of every other selection test', () => {
    const outcome = selectRules({
      formType: '10-K',
      periodOfReport: '2025-12-31',
      inputsAvailable: ['I1', 'I2', 'I3', 'I4'],
      tierEffective: 1,
      stage: 'pilot',
      suppressedByGates: new Map([['R-MECH-EXH-010', { reason: 'Gate said so.', gate: 'G2' }]]),
      waves: ['P0', 'P1'],
    });
    expect(outcome.executable.some(entry => entry.rule_id === 'R-MECH-EXH-010')).toBe(false);
    expect(outcome.suppressed.find(entry => entry.rule.rule_id === 'R-MECH-EXH-010')?.gate).toBe('G2');
  });

  it('executes nothing in production while the catalog is pre-approval', () => {
    // Every seed rule is Draft. A production run must therefore execute none of
    // them rather than quietly treating Draft as good enough.
    const outcome = selectRules({
      formType: '10-K',
      periodOfReport: '2025-12-31',
      inputsAvailable: ['I1', 'I2', 'I3', 'I4'],
      tierEffective: 1,
      stage: 'production',
      suppressedByGates: new Map(),
      waves: ['P0', 'P1'],
    });
    expect(outcome.executable).toHaveLength(0);
    expect(outcome.coverageFactor).toBe(0);
    expect(outcome.suppressed.every(entry => entry.gate === 'G1' || entry.reason.length > 0)).toBe(true);
  });

  it('never counts an unbound rule as executable', () => {
    const outcome = selectRules({
      formType: '10-K',
      periodOfReport: '2025-12-31',
      inputsAvailable: ['I1', 'I2', 'I3', 'I4', 'I5'],
      tierEffective: 2,
      stage: 'pilot',
      suppressedByGates: new Map(),
      waves: ['P0', 'P1', 'P2'],
    });
    expect(outcome.executable.some(entry => entry.rule_id === 'R-XBRL-STR-004')).toBe(false);
    expect(outcome.coverageFactor).toBeGreaterThan(0);
    expect(outcome.coverageFactor).toBeLessThan(1);
  });
});

describe('G3 — disposition', () => {
  it('requires a named actor and a substantive rationale', () => {
    expect(
      checkDisposition(finding(), {
        status: 'remediated',
        actor: '',
        actor_role: 'preparer',
        rationale: 'Fixed.',
      }).allowed,
    ).toBe(false);

    expect(
      checkDisposition(finding(), {
        status: 'remediated',
        actor: 'Dana Whitfield',
        actor_role: 'preparer',
        rationale: 'Fixed.',
      }).allowed,
    ).toBe(false);

    expect(
      checkDisposition(finding(), {
        status: 'remediated',
        actor: 'Dana Whitfield',
        actor_role: 'preparer',
        rationale: 'Exhibit 19 was attached to the revised submission package.',
      }).allowed,
    ).toBe(true);
  });

  it('does not let a preparer accept a finding', () => {
    const check = checkDisposition(finding(), {
      status: 'accepted',
      actor: 'Dana Whitfield',
      actor_role: 'preparer',
      rationale: 'We consider the exhibit unnecessary in the circumstances.',
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/reviewer or above/i);
  });

  it('requires an expiry on a suppression', () => {
    const request = {
      status: 'suppressed' as const,
      actor: 'Priya Raman',
      actor_role: 'reviewer' as EngagementRole,
      rationale: 'Known false positive pending a rule amendment by the board.',
    };
    expect(checkDisposition(finding(), request).allowed).toBe(false);
    expect(checkDisposition(finding(), { ...request, expires_at: '2026-12-31' }).allowed).toBe(true);
  });

  it('requires a second, different named approver on a critical acceptance', () => {
    const base = {
      status: 'accepted' as const,
      actor: 'Priya Raman',
      actor_role: 'reviewer' as EngagementRole,
      rationale: 'The requirement does not apply on the facts described in the memo.',
    };
    const critical = finding({ severity: 'critical' });

    expect(checkDisposition(critical, base).allowed).toBe(false);
    expect(checkDisposition(critical, { ...base, four_eyes_by: 'Priya Raman' }).allowed).toBe(false);
    expect(
      checkDisposition(critical, {
        ...base,
        four_eyes_by: 'Dana Whitfield',
        four_eyes_role: 'reviewer',
      }).allowed,
    ).toBe(false);
    expect(
      checkDisposition(critical, {
        ...base,
        four_eyes_by: 'Dana Whitfield',
        four_eyes_role: 'engagement_partner',
      }).allowed,
    ).toBe(true);
  });

  it('honours a lower engagement four-eyes threshold', () => {
    const request = {
      status: 'accepted' as const,
      actor: 'Priya Raman',
      actor_role: 'reviewer' as EngagementRole,
      rationale: 'Accepted on the basis set out in the technical memo.',
    };
    expect(checkDisposition(finding({ severity: 'high' }), request, 'high' as Severity).allowed).toBe(false);
    expect(checkDisposition(finding({ severity: 'high' }), request, 'critical').allowed).toBe(true);
  });

  it('does not let a judgment prompt be closed by remediation', () => {
    const check = checkDisposition(finding({ determinism: 'judgment' }), {
      status: 'remediated',
      actor: 'Dana Whitfield',
      actor_role: 'preparer',
      rationale: 'Updated the disclosure wording in the draft.',
    });
    expect(check.allowed).toBe(false);
  });

  it('records the actor, timestamp and rationale on the finding', () => {
    const disposed = applyDisposition(
      finding(),
      {
        status: 'accepted',
        actor: 'Priya Raman',
        actor_role: 'reviewer',
        rationale: 'Accepted on the basis set out in the technical memo.',
      },
      '2026-02-21T09:00:00.000Z',
    );
    expect(disposed.status).toBe('accepted');
    expect(disposed.disposition?.actor).toBe('Priya Raman');
    expect(disposed.disposition?.timestamp).toBe('2026-02-21T09:00:00.000Z');
  });
});

describe('engagement onboarding', () => {
  const engagement = (members: EngagementMember[]): Engagement => ({
    engagement_id: 'eng_test',
    client_name: 'Meridian Industries, Inc.',
    cik: '0001234567',
    forms_in_scope: ['10-K'],
    tier_authorised: 1,
    status: 'onboarding',
    created_at: '2026-01-05T00:00:00.000Z',
    created_by: 'tester',
    members,
    onboarding: defaultOnboardingSteps(),
    four_eyes_threshold: 'critical',
    data_residency: 'us',
    retention_years: 7,
  });

  it('blocks activation until every blocking step is signed off', () => {
    const state = onboardingState(engagement([]));
    expect(state.ready).toBe(false);
    expect(state.blocking_outstanding).toHaveLength(state.total);
  });

  it('rejects a team that could not obtain a second approval', () => {
    const check = checkTeamComposition([member('preparer', 'Dana')]);
    expect(check.satisfied).toBe(false);
    expect(check.problems.join(' ')).toMatch(/four-eyes/i);
  });

  it('accepts a team that can prepare, review and provide a second approval', () => {
    const check = checkTeamComposition([
      member('preparer', 'Dana'),
      member('reviewer', 'Priya'),
      member('engagement_partner', 'Marcus'),
    ]);
    expect(check.satisfied).toBe(true);
  });

  it('flags members who have not acknowledged the access terms', () => {
    const check = checkTeamComposition([
      member('preparer', 'Dana'),
      member('reviewer', 'Priya'),
      member('engagement_partner', 'Marcus', false),
    ]);
    expect(check.satisfied).toBe(false);
    expect(check.problems.join(' ')).toMatch(/acknowledged/i);
  });
});

describe('G4 — rule metrics', () => {
  it('reports the share of dispositions that closed without a correction', () => {
    const metrics = ruleMetrics([
      finding({ rule_id: 'R-A', status: 'accepted' }),
      finding({ rule_id: 'R-A', finding_id: 'FND-2', status: 'accepted' }),
      finding({ rule_id: 'R-A', finding_id: 'FND-3', status: 'remediated' }),
      finding({ rule_id: 'R-B', status: 'open' }),
    ]);
    const noisy = metrics.find(metric => metric.rule_id === 'R-A');
    // A rule accepted every time it fires is a rule the board should tighten.
    expect(noisy?.fired).toBe(3);
    expect(noisy?.acceptance_rate).toBeCloseTo(2 / 3);
    expect(metrics.find(metric => metric.rule_id === 'R-B')?.acceptance_rate).toBe(0);
  });
});
