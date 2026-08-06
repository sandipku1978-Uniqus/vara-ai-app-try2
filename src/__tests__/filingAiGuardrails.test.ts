/**
 * GR-1 to GR-5, tested as code rather than trusted as documentation.
 *
 * These are the constraints that keep an exception report from reading as an
 * audit opinion. A regression here is not a cosmetic bug — it is Uniqus issuing
 * assurance it is not licensed to issue.
 */

import { describe, expect, it } from 'vitest';

import {
  assertCoveragePresent,
  assertDeterministicConfidence,
  assertJudgmentNeverAutoClears,
  auditPayloadVocabulary,
  findDenylistHits,
  GuardrailViolation,
  SCOPE_LANGUAGE,
  sealRunResult,
} from '../lib/filing-ai/guardrails';
import { RULE_BINDINGS } from '../lib/filing-ai/bindings';
import { loadCatalog } from '../lib/filing-ai/catalog';
import { buildCoverage } from '../lib/filing-ai/scoring';
import type { Coverage, Finding, RunResult } from '../lib/filing-ai/types';

function coverage(overrides: Partial<Coverage> = {}): Coverage {
  return {
    tier_effective: 0,
    rules_executed: 90,
    rules_total: 150,
    coverage_factor: 0.6,
    rules_suppressed: [],
    out_of_scope: ['Revenue cut-off requires the trial balance.'],
    scope_language: SCOPE_LANGUAGE,
    inputs_received: ['I1', 'I4'],
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: 'FND-R-MECH-EXH-010',
    run_id: 'run_test',
    rule_id: 'R-MECH-EXH-010',
    rule_version: '1.0.0',
    layer: 'mechanical',
    determinism: 'deterministic',
    severity: 'critical',
    blocking: true,
    title: 'Exhibit 31.1 is absent',
    description: 'No document typed EX-31.1 appears in the submitted document set.',
    evidence: { extracted: 'No EX-31.1 document.', expected: 'An EX-31.1 document.' },
    authority: ['Reg S-K Item 601(b)(31)'],
    remediation: 'Attach the exhibit before submission.',
    confidence: 1,
    status: 'open',
    ...overrides,
  };
}

function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    run_id: 'run_test',
    completed_at: '2026-02-21T00:00:00.000Z',
    gate: 'NOT_READY',
    readiness_score: 45,
    coverage: coverage(),
    gate_results: [],
    findings: [finding()],
    rule_errors: [],
    subject: {
      cik: '0001234567',
      registrant: 'Meridian Industries, Inc.',
      form_type: '10-K',
      period_of_report: '2025-12-31',
      accession: '0001234567-26-000011',
      filing_date: '2026-02-20',
      primary_document_url: 'https://www.sec.gov/Archives/edgar/data/1234567/x.htm',
    },
    authority: {
      regsk_version: 'Reg S-K as in force at 2025-12-31',
      regsx_version: 'Reg S-X as in force at 2025-12-31',
      asc_asof: '2025-12-31',
      taxonomy_year: 2025,
      dqc_ruleset_version: 'DQC ruleset for 2025',
      efm_version: 'EDGAR Filer Manual in force at 2025-12-31',
      resolved_from: 'filing.period_of_report=2025-12-31',
    },
    catalog_version: '0.1.0',
    engine_version: '0.1.0',
    duration_ms: 4200,
    evidence_pack: {
      result_digest: 'abc',
      artifact_digests: [],
      catalog_version: '0.1.0',
      rule_versions: [],
      authority: {
        regsk_version: 'Reg S-K as in force at 2025-12-31',
        regsx_version: 'Reg S-X as in force at 2025-12-31',
        asc_asof: '2025-12-31',
        taxonomy_year: 2025,
        dqc_ruleset_version: 'DQC ruleset for 2025',
        efm_version: 'EDGAR Filer Manual in force at 2025-12-31',
        resolved_from: 'filing.period_of_report=2025-12-31',
      },
      sealed_at: '2026-02-21T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('GR-1 — prohibited assurance vocabulary', () => {
  it.each([
    'The filing is accurate.',
    'We provide assurance over the exhibit index.',
    'This filing is compliant with Item 601.',
    'The exhibit set is complete.',
    'We verified the certification.',
    'In our opinion the disclosure is adequate.',
  ])('rejects %s', text => {
    expect(findDenylistHits(text).length).toBeGreaterThan(0);
  });

  it('does not fire on ordinary engine language', () => {
    expect(findDenylistHits('Exhibit 31.1 is absent from the submitted document set.')).toEqual([]);
    // "completeness" must survive even though "complete" is on the list.
    expect(findDenylistHits('Gate G1 tests the completeness of the filing package.')).toEqual([]);
  });

  it('permits the regulatory phrases the engine has to name', () => {
    expect(findDenylistHits('Rule 13a-14(a) certification is absent.')).toEqual([]);
    expect(findDenylistHits('The Section 1350 certification names the wrong period.')).toEqual([]);
    expect(findDenylistHits('Interim statements are labelled unaudited.')).toEqual([]);
  });

  it('finds violations anywhere in a serialised payload', () => {
    const problems = auditPayloadVocabulary(
      runResult({ findings: [finding({ remediation: 'Confirm the filing is accurate.' })] }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toContain('remediation');
  });

  it('ignores machine identifiers that are not prose', () => {
    // A concept or artefact name could contain a listed word without asserting
    // anything; flagging those would make the guardrail unusable.
    expect(auditPayloadVocabulary({ concept: 'us-gaap:AuditedValue', extracted: 'opinion' })).toEqual([]);
  });

  it('withholds a run result that contains prohibited vocabulary', () => {
    expect(() =>
      sealRunResult(runResult({ findings: [finding({ description: 'The filing is complete.' })] })),
    ).toThrow(GuardrailViolation);
  });
});

describe('GR-1 — the governed artefacts are themselves clean', () => {
  it('finds no prohibited vocabulary in any catalog rule name, logic or evidence note', () => {
    // Rule names surface verbatim as finding titles, so the catalog is subject
    // to the same constraint as the engine's own prose. Nine seed rules named
    // their test using assurance vocabulary and were amended; this stops the
    // next catalog change from reintroducing it.
    const problems = auditPayloadVocabulary(
      loadCatalog().rules.map(rule => ({
        title: rule.name,
        description: rule.detection_logic,
        remediation: rule.evidence_captured,
        family: rule.family,
      })),
    );
    expect(problems.map(problem => `${problem.path}: ${problem.hit.context}`)).toEqual([]);
  });

  it('finds no prohibited vocabulary in any predicate binding', () => {
    // Binding text reaches the user through unresolved-condition questions and
    // unbound-rule reasons in the coverage statement.
    const problems = auditPayloadVocabulary(RULE_BINDINGS);
    expect(problems.map(problem => `${problem.path}: ${problem.hit.context}`)).toEqual([]);
  });

  it('finds no prohibited vocabulary in the tier blind-spot statements', () => {
    const built = buildCoverage({
      tierEffective: 0,
      rulesExecuted: 1,
      rulesApplicable: 2,
      suppressed: [],
      inputsReceived: ['I1'],
      unparsedRegions: [],
      pilotCatalog: true,
    });
    expect(auditPayloadVocabulary(built)).toEqual([]);
  });
});

describe('GR-2 — the coverage statement is mandatory', () => {
  it('rejects a result with no out-of-scope disclosure', () => {
    expect(() => assertCoveragePresent(coverage({ out_of_scope: [] }))).toThrow(GuardrailViolation);
  });

  it('rejects caller-supplied scope language', () => {
    expect(() => assertCoveragePresent(coverage({ scope_language: 'All checks passed.' }))).toThrow(
      GuardrailViolation,
    );
  });

  it('rejects a coverage factor outside zero to one', () => {
    expect(() => assertCoveragePresent(coverage({ coverage_factor: 1.4 }))).toThrow(GuardrailViolation);
  });

  it('stamps the scope language at the serialiser, so a caller cannot alter it', () => {
    // The caller supplies benign-but-wrong language; sealing replaces it.
    const sealed = sealRunResult(
      runResult({ coverage: coverage({ scope_language: SCOPE_LANGUAGE }) }),
    );
    expect(sealed.coverage.scope_language).toBe(SCOPE_LANGUAGE);
  });
});

describe('GR-3 — deterministic findings carry confidence exactly 1.0', () => {
  it('accepts 1.0', () => {
    expect(() => assertDeterministicConfidence(finding())).not.toThrow();
  });

  it.each([0.99, 0.5, 1.01])('rejects %s', confidence => {
    expect(() => assertDeterministicConfidence(finding({ confidence }))).toThrow(GuardrailViolation);
  });
});

describe('GR-4 and GR-5 — judgment output', () => {
  it('rejects a judgment finding closed without a named disposition', () => {
    expect(() =>
      assertJudgmentNeverAutoClears(
        finding({ determinism: 'judgment', status: 'accepted', disposition: undefined }),
      ),
    ).toThrow(GuardrailViolation);
  });

  it('rejects an uncited judgment finding even when it is open', () => {
    expect(() =>
      assertJudgmentNeverAutoClears(finding({ determinism: 'judgment', confidence: 0.7 })),
    ).toThrow(/GR-5|cited/);
  });

  it('accepts a cited, open judgment prompt', () => {
    expect(() =>
      assertJudgmentNeverAutoClears(
        finding({
          determinism: 'judgment',
          confidence: 0.7,
          model_provenance: {
            model: 'test-model',
            prompt_version: '1',
            retrieval_index_version: '1',
            retrieved_passages: ['ASC 606-10-50-5'],
          },
        }),
      ),
    ).not.toThrow();
  });
});
