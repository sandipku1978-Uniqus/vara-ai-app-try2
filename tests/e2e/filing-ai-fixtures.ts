import type { Page, Route } from '@playwright/test';

/**
 * A sealed RunResult served at the network boundary.
 *
 * Executing a real check needs several paced EDGAR round trips against a live
 * registrant; carrying that dependency in a UI suite would make the browser
 * evidence hostage to SEC availability. The engine that produces this shape is
 * covered by the unit suite against synthetic filings, so what remains for the
 * browser to prove is what the browser owns: that the report renders the gate,
 * the coverage statement and each finding's evidence, and that a disposition
 * reaches the API with what governance requires.
 */

export const FIXTURE_RUN_ID = 'run_11111111-2222-3333-4444-555555555555';
export const FIXTURE_REGISTRANT = 'Meridian Industries, Inc.';
export const FIXTURE_DOCUMENT_URL =
  'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/mrdn-20251231.htm';

const SCOPE_LANGUAGE =
  'This report evidences the operation of a management review control. It is not an audit, '
  + 'review or attestation, expresses no opinion on the financial statements, and does not '
  + 'conclude that the filing is free from error.';

const AUTHORITY = {
  regsk_version: 'Reg S-K as in force at 2025-12-31',
  regsx_version: 'Reg S-X as in force at 2025-12-31',
  asc_asof: '2025-12-31',
  taxonomy_year: 2025,
  dqc_ruleset_version: 'DQC ruleset for 2025',
  efm_version: 'EDGAR Filer Manual in force at 2025-12-31',
  resolved_from: 'filing.period_of_report=2025-12-31',
};

export function fixtureRun() {
  return {
    run_id: FIXTURE_RUN_ID,
    completed_at: '2026-02-21T09:00:00.000Z',
    gate: 'NOT_READY',
    readiness_score: 52.4,
    coverage: {
      tier_effective: 1,
      rules_executed: 96,
      rules_total: 148,
      coverage_factor: 0.6486,
      rules_suppressed: [
        {
          rule_id: 'R-XBRL-STR-004',
          reason: 'Calculation linkbase arithmetic needs the linkbase files.',
          gate: 'G6',
        },
        {
          rule_id: 'R-CONS-026',
          reason: 'No client source data (I5) was supplied.',
          gate: 'G5',
        },
      ],
      out_of_scope: [
        'Revenue cut-off, consolidation scope, share-based compensation valuation and deferred tax — these require the trial balance.',
        '2 rule(s) not executed — see the suppression list.',
      ],
      scope_language: SCOPE_LANGUAGE,
      inputs_received: ['I1', 'I4', 'I2', 'I3'],
    },
    gate_results: [
      { gate: 'G1', passed: true, action: 'proceed', detail: 'Filing package received: 13 document(s).' },
      { gate: 'G2', passed: true, action: 'proceed', detail: '1,204 inline XBRL fact(s) · 12 Item section(s).' },
      { gate: 'G3', passed: true, action: 'proceed', detail: `${FIXTURE_REGISTRANT} · CIK 0001234567.` },
      { gate: 'G4', passed: true, action: 'proceed', detail: 'Authority pinned to the period ended 2025-12-31.' },
      { gate: 'G5', passed: false, action: 'suppress_dependent_rules', detail: 'No client source data supplied.' },
      { gate: 'G6', passed: true, action: 'proceed', detail: 'Inputs received: I1, I4, I2, I3. Effective tier 1.' },
    ],
    findings: [
      {
        finding_id: 'FND-R-MECH-EXH-005',
        run_id: FIXTURE_RUN_ID,
        rule_id: 'R-MECH-EXH-005',
        rule_version: '1.0.0',
        layer: 'mechanical',
        determinism: 'deterministic',
        severity: 'critical',
        blocking: true,
        title: 'Exhibit 19 — Insider trading policy',
        description: 'No document typed EX-19 appears in the submitted document set.',
        evidence: {
          extracted: 'No document typed EX-19 appears in the submitted document set.',
          expected: 'A document typed EX-19 in the submission.',
          location: {
            artifact: 'mrdn-20251231.htm',
            char_start: 128_400,
            char_end: 128_512,
            url: FIXTURE_DOCUMENT_URL,
          },
        },
        authority: ['Reg S-K Item 601(b)(19)'],
        remediation: 'Attach Exhibit 19 and add the corresponding row to the exhibit index before submission.',
        confidence: 1,
        root_cause_group: 'exhibit:19',
        status: 'open',
      },
      {
        finding_id: 'FND-R-CONS-005',
        run_id: FIXTURE_RUN_ID,
        rule_id: 'R-CONS-005',
        rule_version: '1.0.0',
        layer: 'consistency',
        determinism: 'deterministic',
        severity: 'high',
        blocking: false,
        title: 'Balance sheet balances',
        description:
          'Total assets do not equal total liabilities plus equity. This root cause affects 2 rule(s); the symptoms are listed below.',
        evidence: {
          extracted:
            'us-gaap:Assets is reported as 4,100,000; recomputation gives 5,200,000. Difference −1,100,000.',
          expected: 'us-gaap:Assets within 0.05% of the recomputed value.',
          location: {
            artifact: 'mrdn-20251231.htm',
            char_start: 402_100,
            char_end: 402_180,
            url: FIXTURE_DOCUMENT_URL,
          },
        },
        authority: ['Reg S-X Rule 5-02'],
        remediation: 'Reconcile total assets to its components before submission.',
        confidence: 1,
        root_cause_group: 'fact:Assets',
        symptoms: [
          {
            rule_id: 'R-CONS-006',
            title: 'Balance sheet subtotals foot',
            evidence: {
              extracted: 'us-gaap:LiabilitiesAndStockholdersEquity does not agree to total assets.',
              expected: 'Subtotals foot to the reported total.',
            },
          },
        ],
        status: 'open',
      },
      {
        finding_id: 'FND-R-MECH-EXH-006',
        run_id: FIXTURE_RUN_ID,
        rule_id: 'R-MECH-EXH-006',
        rule_version: '1.0.0',
        layer: 'mechanical',
        determinism: 'deterministic',
        severity: 'medium',
        blocking: false,
        title: 'Confirm whether Exhibit 21 is required',
        description:
          'Does the registrant have subsidiaries? Exhibit 21.1 is required unless it has none.',
        evidence: {
          extracted: 'No document typed EX-21 appears in the submitted document set.',
          expected: 'Exhibit 21 where the Item 601 condition is met.',
        },
        authority: ['Reg S-K Item 601(b)(21)'],
        remediation: 'Confirm the condition and, where the exhibit is required, add it to the submission.',
        confidence: 1,
        root_cause_group: 'exhibit:21',
        status: 'open',
      },
    ],
    filer_risk: {
      band: 'elevated',
      prior_amendments_8q: 2,
      rationale: '2 amendment(s) to periodic reports in the prior eight quarters.',
    },
    rule_errors: [],
    subject: {
      cik: '0001234567',
      registrant: FIXTURE_REGISTRANT,
      form_type: '10-K',
      period_of_report: '2025-12-31',
      accession: '0001234567-26-000011',
      filing_date: '2026-02-20',
      primary_document_url: FIXTURE_DOCUMENT_URL,
    },
    authority: AUTHORITY,
    catalog_version: '0.1.0',
    engine_version: '0.1.0',
    duration_ms: 41_200,
    evidence_pack: {
      result_digest: 'a'.repeat(64),
      artifact_digests: [{ name: 'mrdn-20251231.htm', sha256: 'b'.repeat(64), bytes: 4_200_000 }],
      catalog_version: '0.1.0',
      rule_versions: [{ rule_id: 'R-MECH-EXH-005', rule_version: '1.0.0' }],
      authority: AUTHORITY,
      sealed_at: '2026-02-21T09:00:00.000Z',
    },
  };
}

export function fixtureRunSummary() {
  const run = fixtureRun();
  return {
    run_id: run.run_id,
    cik: run.subject.cik,
    registrant: run.subject.registrant,
    form_type: run.subject.form_type,
    period_of_report: run.subject.period_of_report,
    accession: run.subject.accession,
    gate: run.gate,
    readiness_score: run.readiness_score,
    coverage_factor: run.coverage.coverage_factor,
    created_at: '2026-02-21T09:00:00.000Z',
    started_by: 'local-e2e',
    open_findings: 3,
    blocking_findings: 1,
  };
}

export interface FilingAiFixtureOptions {
  /** Seed the console's recent-checks table with the fixture run. */
  withHistory?: boolean;
}

export interface FilingAiFixtureState {
  /** Bodies posted to the disposition endpoint, in order. */
  dispositions: Array<Record<string, unknown>>;
  /** Bodies posted to the run endpoint, in order. */
  runRequests: Array<Record<string, unknown>>;
}

/** Serve the whole Filing AI API surface from fixtures. */
export async function installFilingAiFixtures(
  page: Page,
  options: FilingAiFixtureOptions = {},
): Promise<FilingAiFixtureState> {
  const state: FilingAiFixtureState = { dispositions: [], runRequests: [] };
  const run = fixtureRun();

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/filing-ai/runs/*/findings/*', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>;
    state.dispositions.push(body);
    const rationale = String(body.rationale || '');
    // Mirror the server's G3 refusal so the browser evidence exercises both paths.
    if (rationale.trim().split(/\s+/).filter(Boolean).length < 5) {
      return json(route, { ok: false, error: 'A disposition rationale must explain the basis for the decision.' }, 422);
    }
    const finding = run.findings.find(entry => entry.finding_id === String(body.finding_id || '')) || run.findings[1];
    return json(route, {
      ok: true,
      finding: {
        ...finding,
        status: body.status,
        disposition: {
          actor: body.actor,
          timestamp: '2026-02-21T10:00:00.000Z',
          rationale: body.rationale,
        },
      },
    });
  });

  await page.route('**/api/filing-ai/runs/run_*', async (route: Route) => {
    return json(route, { ok: true, run, worklist: [], storage: 'memory' });
  });

  await page.route('**/api/filing-ai/runs', async (route: Route) => {
    if (route.request().method() === 'POST') {
      state.runRequests.push(JSON.parse(route.request().postData() || '{}') as Record<string, unknown>);
      return json(route, { ok: true, run, persisted: true, storage: 'memory' });
    }
    return json(route, {
      ok: true,
      runs: options.withHistory ? [fixtureRunSummary()] : [],
      storage: 'memory',
    });
  });

  return state;
}
