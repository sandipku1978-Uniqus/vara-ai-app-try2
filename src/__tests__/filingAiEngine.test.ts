/**
 * End-to-end run pipeline, with EDGAR replaced by fixtures.
 *
 * This is the test that would catch a stage wired to the wrong output: it runs
 * ingest → gate → normalize → select → execute → score → seal in one piece and
 * asserts the properties the acceptance criteria name — reproducibility, schema
 * shape, coverage, and the guardrail seal at the exit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  certificationHtml,
  financialOfficerCertificationHtml,
  FIXTURE_ACCESSION,
  FIXTURE_CIK,
  FIXTURE_PERIOD,
  primaryDocumentHtml,
  section1350Html,
  submissionDocuments,
  type FixtureOptions,
} from './fixtures/filing-ai-10k';
import { SCOPE_LANGUAGE } from '../lib/filing-ai/guardrails';

/** Mutated per test before `executeRun` is called. */
let fixtureOptions: FixtureOptions = {};

vi.mock('../lib/filing-ai/artifacts', async importOriginal => {
  const original = await importOriginal<typeof import('../lib/filing-ai/artifacts')>();
  return {
    ...original,
    fetchSubmissions: vi.fn(async () => ({
      entity: {
        cik: FIXTURE_CIK,
        legal_name: 'Meridian Industries, Inc.',
        fiscal_year_end: '1231',
        filer_status: 'large_accelerated' as const,
        is_src: false,
        is_shell: null,
        state_of_incorporation: 'DE',
        ein: '841234567',
        sic: '3559',
        sic_description: 'Special industry machinery',
        tickers: ['MRDN'],
        exchanges: ['NYSE'],
        file_number: '001-38856',
        entity_type: 'operating',
      },
      history: [
        {
          accession: FIXTURE_ACCESSION,
          form: '10-K',
          filing_date: '2026-02-20',
          period_of_report: FIXTURE_PERIOD,
          primary_document: 'mrdn-20251231.htm',
          is_amendment: false,
        },
        {
          accession: '0001234567-25-000009',
          form: '10-K',
          filing_date: '2025-02-19',
          period_of_report: '2024-12-31',
          primary_document: 'mrdn-20241231.htm',
          is_amendment: false,
        },
        {
          accession: '0001234567-25-000031',
          form: '10-Q/A',
          filing_date: '2025-08-11',
          period_of_report: '2025-06-30',
          primary_document: 'mrdn-20250630.htm',
          is_amendment: true,
        },
      ],
    })),
    fetchFilingIndex: vi.fn(async () => ({
      accession: FIXTURE_ACCESSION,
      accessionCompact: '000123456726000011',
      documents: submissionDocuments(fixtureOptions),
    })),
    fetchFilingDocument: vi.fn(async (_cik: string, _accession: string, name: string) => {
      const html = primaryDocumentHtml(fixtureOptions);
      return {
        name,
        url: `https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/${name}`,
        html,
        bytes: html.length,
        sha256: 'fixture-primary',
      };
    }),
    fetchExhibitDocument: vi.fn(async (_cik: string, _accession: string, name: string) => {
      const html = name.includes('312')
        ? financialOfficerCertificationHtml()
        : name.includes('321')
          ? section1350Html()
          : certificationHtml(fixtureOptions);
      return {
        name,
        url: `https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/${name}`,
        html,
        bytes: html.length,
        sha256: `fixture-${name}`,
      };
    }),
    fetchCompanyFacts: vi.fn(async () => [
      {
        concept: 'Assets',
        value: 4_800_000,
        unit: 'USD',
        end: '2024-12-31',
        form: '10-K',
        accession: '0001234567-25-000009',
        filed: '2025-02-19',
      },
    ]),
  };
});

const { executeRun, RunRejected } = await import('../lib/filing-ai/engine');

function run(options: FixtureOptions = {}, overrides: Record<string, unknown> = {}) {
  fixtureOptions = options;
  return executeRun({
    runId: 'run_fixture-0000-0000-0000',
    cik: FIXTURE_CIK,
    formType: '10-K',
    declaredTier: 1,
    stage: 'pilot',
    waves: ['P0', 'P1'],
    signal: new AbortController().signal,
    ...overrides,
  } as Parameters<typeof executeRun>[0]);
}

describe('run pipeline', () => {
  beforeEach(() => {
    fixtureOptions = {};
  });

  it('produces a complete, sealed result on a well-formed filing', async () => {
    const result = await run();

    expect(result.subject.registrant).toBe('Meridian Industries, Inc.');
    expect(result.subject.period_of_report).toBe(FIXTURE_PERIOD);
    expect(result.coverage.rules_executed).toBeGreaterThan(50);
    expect(result.coverage.coverage_factor).toBeGreaterThan(0);
    expect(result.coverage.coverage_factor).toBeLessThanOrEqual(1);
    expect(result.coverage.scope_language).toBe(SCOPE_LANGUAGE);
    expect(result.coverage.out_of_scope.length).toBeGreaterThan(0);
    expect(result.gate_results.map(gate => gate.gate)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
    expect(result.evidence_pack.result_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rule_errors).toEqual([]);
  });

  it('is reproducible — the same request twice yields an identical finding set', async () => {
    const first = await run();
    const second = await run();
    // Acceptance criterion 1: byte-identical findings, timestamps excluded.
    expect(second.evidence_pack.result_digest).toBe(first.evidence_pack.result_digest);
    expect(JSON.stringify(second.findings)).toBe(JSON.stringify(first.findings));
  });

  it('pins authority to the filing period, not to the run date', async () => {
    const result = await run();
    expect(result.authority.resolved_from).toBe(`filing.period_of_report=${FIXTURE_PERIOD}`);
    expect(result.authority.taxonomy_year).toBe(2025);
  });

  it('raises the effective tier to 1 once prior-period facts are available', async () => {
    const result = await run();
    expect(result.coverage.tier_effective).toBe(1);
    expect(result.coverage.inputs_received).toEqual(expect.arrayContaining(['I1', 'I2', 'I3', 'I4']));
  });

  it('bands the filer as moderate on one periodic amendment in eight quarters', async () => {
    const result = await run();
    expect(result.filer_risk?.prior_amendments_8q).toBe(1);
    expect(result.filer_risk?.band).toBe('moderate');
  });

  it('reports a missing mandatory exhibit and sets the gate to NOT_READY', async () => {
    const result = await run({ dropExhibit19: true });
    const finding = result.findings.find(entry => entry.rule_id === 'R-MECH-EXH-005');
    expect(finding).toBeDefined();
    expect(finding?.blocking).toBe(true);
    expect(finding?.confidence).toBe(1);
    expect(result.gate).toBe('NOT_READY');
  });

  it('reports a balance sheet that does not balance', async () => {
    const result = await run({ breakBalanceSheet: true });
    expect(result.findings.some(entry => entry.rule_id === 'R-CONS-005')).toBe(true);
  });

  it('reports a defective certification paragraph', async () => {
    const result = await run({ defectiveCertification: true });
    expect(result.findings.some(entry => entry.rule_id === 'R-MECH-CRT-002')).toBe(true);
  });

  it('drops coverage and discloses why when the document carries no inline XBRL', async () => {
    const clean = await run();
    const stripped = await run({ stripInlineXbrl: true });

    expect(stripped.coverage.coverage_factor).toBeLessThan(clean.coverage.coverage_factor);
    expect(stripped.coverage.out_of_scope.join(' ')).toMatch(/inline XBRL/i);
    // The score cannot rise as coverage falls, whatever the finding count.
    expect(stripped.readiness_score).toBeLessThanOrEqual(100 * stripped.coverage.coverage_factor);
  });

  it('hard-stops rather than testing a filing that is not the one requested', async () => {
    await expect(run({}, { cik: '0000320193' })).rejects.toBeInstanceOf(RunRejected);
  });

  it('rejects a request for a form the registrant has not filed', async () => {
    await expect(run({}, { formType: '10-Q' })).rejects.toBeInstanceOf(RunRejected);
  });

  it('names every rule it did not execute, with the gate that stopped it', async () => {
    const result = await run();
    expect(result.coverage.rules_suppressed.length).toBeGreaterThan(0);
    for (const entry of result.coverage.rules_suppressed) {
      expect(entry.rule_id).toMatch(/^R-/);
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.gate).toMatch(/^G\d$/);
    }
  });

  it('carries a resolvable provenance pointer on every finding it can locate', async () => {
    const result = await run({ breakBalanceSheet: true });
    const located = result.findings.filter(finding => finding.evidence.location?.artifact);
    expect(located.length).toBeGreaterThan(0);
    for (const finding of located) {
      expect(finding.evidence.location?.url).toContain('sec.gov');
    }
  });
});
