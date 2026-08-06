/**
 * P6 — readiness, gate, root-cause de-duplication and the coverage statement.
 *
 * Two properties carry the product and are asserted here directly: the gate is
 * independent of the score, and coverage multiplies the score. Together they
 * make it arithmetically impossible for a partial run with a blocking defect to
 * present as a clean bill of health.
 */

import { describe, expect, it } from 'vitest';

import { SCOPE_LANGUAGE } from '../lib/filing-ai/guardrails';
import {
  assessFilerRisk,
  buildCoverage,
  buildWorklist,
  deduplicateByRootCause,
  scoreReadiness,
} from '../lib/filing-ai/scoring';
import type { Finding, FilingHistoryEntry, Severity } from '../lib/filing-ai/types';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: `FND-${overrides.rule_id ?? 'R-TEST-001'}`,
    run_id: 'run_test',
    rule_id: 'R-TEST-001',
    rule_version: '1.0.0',
    layer: 'mechanical',
    determinism: 'deterministic',
    severity: 'medium',
    blocking: false,
    title: 'Test finding',
    description: 'A finding used to exercise scoring.',
    evidence: { extracted: 'observed', expected: 'expected' },
    authority: ['Reg S-K Item 601'],
    remediation: 'Fix it.',
    confidence: 1,
    status: 'open',
    ...overrides,
  };
}

describe('readiness score', () => {
  it('applies the documented severity weights', () => {
    const outcome = scoreReadiness(
      [
        finding({ rule_id: 'a', severity: 'critical' }),
        finding({ rule_id: 'b', severity: 'high' }),
        finding({ rule_id: 'c', severity: 'medium' }),
        finding({ rule_id: 'd', severity: 'low' }),
      ],
      1,
    );
    // 100 − 25 − 8 − 3 − 1
    expect(outcome.raw).toBe(63);
    expect(outcome.score).toBe(63);
  });

  it('multiplies the raw score by coverage', () => {
    // This is the mechanism behind GR-2: a run that saw 60% of the applicable
    // catalog cannot report a 100.
    expect(scoreReadiness([], 0.6).score).toBe(60);
    expect(scoreReadiness([finding({ severity: 'high' })], 0.5).score).toBe(46);
  });

  it('floors at zero rather than going negative', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      finding({ rule_id: `r${index}`, severity: 'critical' as Severity }),
    );
    expect(scoreReadiness(many, 1).score).toBe(0);
  });

  it('counts only open findings', () => {
    expect(scoreReadiness([finding({ severity: 'critical', status: 'remediated' })], 1).score).toBe(100);
  });
});

describe('gate decision', () => {
  it('is NOT_READY on any open blocking finding, whatever the score', () => {
    // A single missing certification outranks a 97.
    const outcome = scoreReadiness([finding({ severity: 'low', blocking: true })], 1);
    expect(outcome.score).toBe(99);
    expect(outcome.gate).toBe('NOT_READY');
  });

  it('is READY_WITH_EXCEPTIONS when open findings are non-blocking', () => {
    expect(scoreReadiness([finding()], 1).gate).toBe('READY_WITH_EXCEPTIONS');
  });

  it('is READY only when nothing is open', () => {
    expect(scoreReadiness([], 1).gate).toBe('READY');
    expect(scoreReadiness([finding({ status: 'accepted' })], 1).gate).toBe('READY');
  });
});

describe('root-cause de-duplication', () => {
  it('merges rules that share one wrong input into a single finding with symptoms', () => {
    const merged = deduplicateByRootCause([
      finding({ rule_id: 'R-CONS-001', severity: 'high', root_cause_group: 'fact:shares' }),
      finding({ rule_id: 'R-CONS-002', severity: 'high', root_cause_group: 'fact:shares' }),
      finding({ rule_id: 'R-CONS-025', severity: 'medium', root_cause_group: 'fact:shares' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].symptoms).toHaveLength(2);
    expect(merged[0].description).toMatch(/affects 3 rule/);
  });

  it('keeps the most severe member as the representative', () => {
    const merged = deduplicateByRootCause([
      finding({ rule_id: 'low', severity: 'low', root_cause_group: 'g' }),
      finding({ rule_id: 'critical', severity: 'critical', root_cause_group: 'g' }),
    ]);
    expect(merged[0].rule_id).toBe('critical');
  });

  it('never softens a blocking defect by grouping it', () => {
    const merged = deduplicateByRootCause([
      finding({ rule_id: 'a', severity: 'high', blocking: false, root_cause_group: 'g' }),
      finding({ rule_id: 'b', severity: 'high', blocking: true, root_cause_group: 'g' }),
    ]);
    expect(merged[0].blocking).toBe(true);
  });

  it('leaves ungrouped findings alone and orders by severity', () => {
    const merged = deduplicateByRootCause([
      finding({ rule_id: 'medium', severity: 'medium' }),
      finding({ rule_id: 'critical', severity: 'critical' }),
      finding({ rule_id: 'high', severity: 'high' }),
    ]);
    expect(merged.map(entry => entry.rule_id)).toEqual(['critical', 'high', 'medium']);
  });
});

describe('coverage statement', () => {
  const coverage = buildCoverage({
    tierEffective: 0,
    rulesExecuted: 90,
    rulesApplicable: 150,
    suppressed: [
      { rule_id: 'R-A', reason: 'Needs client source data.', gate: 'G5' },
      { rule_id: 'R-B', reason: 'Needs client source data.', gate: 'G5' },
      { rule_id: 'R-C', reason: 'No predicate deployed.', gate: 'G6' },
    ],
    inputsReceived: ['I1', 'I4'],
    unparsedRegions: ['The exhibit index could not be parsed.'],
    pilotCatalog: true,
  });

  it('computes the coverage factor from executed over applicable', () => {
    expect(coverage.coverage_factor).toBe(0.6);
  });

  it('groups suppressions by reason rather than listing rule ids', () => {
    expect(coverage.out_of_scope).toContain('2 rule(s) not executed — Needs client source data.');
  });

  it('names every parsing limitation', () => {
    expect(coverage.out_of_scope.some(entry => entry.startsWith('Parsing limitation'))).toBe(true);
  });

  it('discloses that a pre-approval catalog was executed', () => {
    expect(coverage.out_of_scope.some(entry => /pre-approval rule catalog/i.test(entry))).toBe(true);
  });

  it('always states the tier blind spots and the fixed scope language', () => {
    expect(coverage.out_of_scope.length).toBeGreaterThan(4);
    expect(coverage.out_of_scope.some(entry => /trial balance/i.test(entry))).toBe(true);
    expect(coverage.scope_language).toBe(SCOPE_LANGUAGE);
  });

  it('reports zero coverage rather than dividing by zero', () => {
    const empty = buildCoverage({
      tierEffective: 0,
      rulesExecuted: 0,
      rulesApplicable: 0,
      suppressed: [],
      inputsReceived: ['I1'],
      unparsedRegions: [],
      pilotCatalog: false,
    });
    expect(empty.coverage_factor).toBe(0);
  });
});

describe('filer risk', () => {
  const history: FilingHistoryEntry[] = [
    { accession: '1', form: '10-K/A', filing_date: '2025-06-01', period_of_report: '2024-12-31', primary_document: 'a', is_amendment: true },
    { accession: '2', form: '10-Q/A', filing_date: '2025-09-01', period_of_report: '2025-06-30', primary_document: 'b', is_amendment: true },
    { accession: '3', form: '8-K/A', filing_date: '2025-10-01', period_of_report: '', primary_document: 'c', is_amendment: true },
    { accession: '4', form: '10-K/A', filing_date: '2021-01-01', period_of_report: '2020-12-31', primary_document: 'd', is_amendment: true },
  ];

  it('counts only periodic-report amendments inside the eight-quarter window', () => {
    // The 8-K/A is not a periodic report; the 2021 amendment is outside the window.
    const risk = assessFilerRisk(history, '2026-02-20');
    expect(risk.prior_amendments_8q).toBe(2);
    expect(risk.band).toBe('elevated');
  });

  it('bands a clean filer as low', () => {
    expect(assessFilerRisk([], '2026-02-20').band).toBe('low');
  });
});

describe('remediation worklist', () => {
  it('routes by severity to the role that can actually dispose of the finding', () => {
    const worklist = buildWorklist([
      finding({ rule_id: 'a', severity: 'critical' }),
      finding({ rule_id: 'b', severity: 'high' }),
      finding({ rule_id: 'c', severity: 'low' }),
      finding({ rule_id: 'd', severity: 'critical', status: 'accepted' }),
    ]);
    expect(worklist.map(entry => entry.owner_role)).toEqual([
      'engagement_partner',
      'reviewer',
      'preparer',
    ]);
  });
});
