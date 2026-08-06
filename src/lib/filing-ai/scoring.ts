/**
 * P6 — scoring, root-cause de-duplication, triage and the coverage statement.
 *
 * Two decisions here carry most of the product's weight.
 *
 * The **gate is independent of the score**. A single open blocking finding sets
 * NOT_READY however high the score is, because "92% ready" next to a missing
 * SOX certification is the kind of number that gets a filing submitted.
 *
 * **Coverage multiplies the score.** A run that could only execute 60% of the
 * applicable rules cannot arithmetically produce a high readiness figure. That
 * is the mechanism behind GR-2, not a caption under the number.
 */

import { SCOPE_LANGUAGE } from './guardrails';
import type {
  Coverage,
  Finding,
  FindingStatus,
  FilerRisk,
  FilingHistoryEntry,
  GateDecision,
  InputRef,
  Severity,
  SuppressedRule,
} from './types';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 8,
  medium: 3,
  low: 1,
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

/** A finding still counts against readiness only while it is open. */
function isOpen(status: FindingStatus): boolean {
  return status === 'open';
}

/**
 * Root-cause de-duplication (build spec §7.2).
 *
 * One wrong share count that breaks basic EPS, diluted EPS, a non-GAAP measure
 * and a footnote is one finding with four symptoms. Presenting it as four
 * findings is the difference between a tool that gets used twice and one that
 * does not — a preparer who fixes the input expects one item to close, not to
 * hunt four.
 *
 * The surviving representative is the most severe member of the group, and its
 * blocking flag is the OR across the group, so grouping can never soften a
 * blocking defect into an advisory one.
 */
export function deduplicateByRootCause(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  const ungrouped: Finding[] = [];

  for (const finding of findings) {
    if (!finding.root_cause_group) {
      ungrouped.push(finding);
      continue;
    }
    const existing = groups.get(finding.root_cause_group);
    if (existing) existing.push(finding);
    else groups.set(finding.root_cause_group, [finding]);
  }

  const merged: Finding[] = [];
  for (const [group, members] of groups) {
    if (members.length === 1) {
      merged.push(members[0]);
      continue;
    }
    const ordered = [...members].sort(
      (left, right) => SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity),
    );
    const primary = ordered[0];
    merged.push({
      ...primary,
      blocking: ordered.some(member => member.blocking),
      description: `${primary.description} This root cause affects ${ordered.length} rule(s); the symptoms are listed below.`,
      symptoms: ordered.slice(1).map(member => ({
        rule_id: member.rule_id,
        title: member.title,
        evidence: member.evidence,
      })),
      root_cause_group: group,
    });
  }

  return [...merged, ...ungrouped].sort((left, right) => {
    const bySeverity = SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity);
    if (bySeverity !== 0) return bySeverity;
    if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
    return left.rule_id.localeCompare(right.rule_id);
  });
}

export interface ReadinessOutcome {
  score: number;
  raw: number;
  gate: GateDecision;
  open_by_severity: Record<Severity, number>;
  blocking_open: number;
}

/** §7.1. Score and gate, computed separately on purpose. */
export function scoreReadiness(findings: Finding[], coverageFactor: number): ReadinessOutcome {
  const openBySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let blockingOpen = 0;
  let anyOpen = false;

  for (const finding of findings) {
    if (!isOpen(finding.status)) continue;
    anyOpen = true;
    openBySeverity[finding.severity] += 1;
    if (finding.blocking) blockingOpen += 1;
  }

  const penalty = SEVERITY_ORDER.reduce(
    (total, severity) => total + SEVERITY_WEIGHT[severity] * openBySeverity[severity],
    0,
  );
  const raw = 100 - penalty;
  const score = Math.max(0, raw) * coverageFactor;

  const gate: GateDecision = blockingOpen > 0
    ? 'NOT_READY'
    : anyOpen
      ? 'READY_WITH_EXCEPTIONS'
      : 'READY';

  return {
    score: Math.round(score * 10) / 10,
    raw,
    gate,
    open_by_severity: openBySeverity,
    blocking_open: blockingOpen,
  };
}

/**
 * Defect classes this run could not see.
 *
 * Assembled from what was actually suppressed rather than written by hand, so
 * it cannot drift away from the run it describes. The tier-level entries are
 * fixed because they are true of the tier itself, not of any one filing.
 */
const TIER_BLIND_SPOTS: Record<number, string[]> = {
  0: [
    'Revenue cut-off, consolidation scope, share-based compensation valuation and deferred tax — these require the trial balance; a filing can be perfectly self-consistent and still wrong.',
    'Contract terms driving revenue recognition or debt-versus-deferred-income classification, the cap table, and the related-party register — these require client source documents.',
    'Auditor eligibility and PCAOB registration status, and significance tests under Rules 3-09 and 4-08(g) that need investee financial statements — these require external data.',
    'Whether a disclosure says enough, or says the right thing. The engine tests that required content is present, not the sufficiency of its substance.',
  ],
  1: [
    'Revenue cut-off, consolidation scope, share-based compensation valuation and deferred tax — these require the trial balance.',
    'Contract terms, the cap table and the related-party register — these require client source documents.',
    'Auditor eligibility and PCAOB registration status — these require external data.',
    'Whether a disclosure says enough, or says the right thing.',
  ],
  2: [
    'Whether a disclosure says enough, or says the right thing.',
    'Matters requiring auditor judgment or external confirmation.',
  ],
};

export interface CoverageInput {
  tierEffective: number;
  rulesExecuted: number;
  rulesApplicable: number;
  suppressed: SuppressedRule[];
  inputsReceived: InputRef[];
  /** Regions the normalizer could not read; each becomes a named blind spot. */
  unparsedRegions: string[];
  /** True when the run executed a pre-approval catalog. */
  pilotCatalog: boolean;
}

export function buildCoverage(input: CoverageInput): Coverage {
  const outOfScope = [...(TIER_BLIND_SPOTS[input.tierEffective] ?? TIER_BLIND_SPOTS[0])];

  // Rules the run could not execute, grouped so the statement names the gap
  // rather than listing 40 rule ids.
  const byReason = new Map<string, string[]>();
  for (const entry of input.suppressed) {
    const list = byReason.get(entry.reason);
    if (list) list.push(entry.rule_id);
    else byReason.set(entry.reason, [entry.rule_id]);
  }
  for (const [reason, ruleIds] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    outOfScope.push(`${ruleIds.length} rule(s) not executed — ${reason}`);
  }

  for (const region of input.unparsedRegions) {
    outOfScope.push(`Parsing limitation — ${region}`);
  }

  if (input.pilotCatalog) {
    outOfScope.push(
      'This run executed a pre-approval rule catalog. Findings are candidate exceptions pending rule board sign-off, not governed exceptions.',
    );
  }

  const coverageFactor = input.rulesApplicable === 0 ? 0 : input.rulesExecuted / input.rulesApplicable;

  return {
    tier_effective: input.tierEffective,
    rules_executed: input.rulesExecuted,
    rules_total: input.rulesApplicable,
    coverage_factor: Math.round(coverageFactor * 10_000) / 10_000,
    rules_suppressed: input.suppressed,
    out_of_scope: outOfScope,
    scope_language: SCOPE_LANGUAGE,
    inputs_received: input.inputsReceived,
  };
}

/**
 * Filer risk band.
 *
 * Derived from the registrant's own amendment history over the last eight
 * quarters: a filer that has tripped one structural rule is materially more
 * likely to trip another. This orders the worklist; it never changes a finding.
 */
export function assessFilerRisk(history: FilingHistoryEntry[], asOf: string): FilerRisk {
  const cutoff = new Date(asOf);
  if (Number.isNaN(cutoff.getTime())) {
    return { band: 'low', prior_amendments_8q: 0, rationale: 'Filing history was not available for this run.' };
  }
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  const window = cutoff.toISOString().slice(0, 10);

  const periodicAmendments = history.filter(
    entry =>
      entry.is_amendment
      && entry.filing_date >= window
      && entry.filing_date <= asOf
      && /^(10-K|10-Q)\/A$/i.test(entry.form),
  );

  const count = periodicAmendments.length;
  const band: FilerRisk['band'] = count === 0 ? 'low' : count === 1 ? 'moderate' : count <= 3 ? 'elevated' : 'high';
  const rationale = count === 0
    ? 'No amendment to a periodic report in the prior eight quarters.'
    : `${count} amendment(s) to periodic reports in the prior eight quarters (${periodicAmendments
        .slice(0, 4)
        .map(entry => `${entry.form} filed ${entry.filing_date}`)
        .join('; ')}). Filers who trip one structural rule are materially more likely to trip another.`;

  return { band, prior_amendments_8q: count, rationale };
}

export interface WorklistEntry {
  finding_id: string;
  rule_id: string;
  severity: Severity;
  blocking: boolean;
  title: string;
  remediation: string;
  owner_role: 'preparer' | 'reviewer' | 'engagement_partner';
}

/**
 * O6 remediation worklist.
 *
 * Ownership follows severity because the disposition rules do: a critical
 * finding needs a second named approver (G3), so it is routed to the person who
 * can obtain one rather than to whoever opened the report.
 */
export function buildWorklist(findings: Finding[]): WorklistEntry[] {
  return findings
    .filter(finding => isOpen(finding.status))
    .map(finding => ({
      finding_id: finding.finding_id,
      rule_id: finding.rule_id,
      severity: finding.severity,
      blocking: finding.blocking,
      title: finding.title,
      remediation: finding.remediation,
      owner_role:
        finding.severity === 'critical'
          ? ('engagement_partner' as const)
          : finding.severity === 'high'
            ? ('reviewer' as const)
            : ('preparer' as const),
    }));
}
