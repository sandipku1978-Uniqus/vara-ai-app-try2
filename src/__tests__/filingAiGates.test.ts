/**
 * Input gates G1–G6, one synthetic fixture per failure mode.
 *
 * A gate has exactly two failure behaviours: hard-stop the run, or take
 * specific rules out of service and disclose it. These tests assert which one
 * each gate takes, because the failure mode is the contract — a gate that
 * suppressed silently would be indistinguishable from a filing that passed.
 */

import { describe, expect, it } from 'vitest';

import { evaluateGates, type GateInput } from '../lib/filing-ai/gates';
import { normalize } from '../lib/filing-ai/normalize';
import { loadCatalog } from '../lib/filing-ai/catalog';
import {
  FIXTURE_ACCESSION,
  FIXTURE_CIK,
  FIXTURE_PERIOD,
  primaryDocumentHtml,
  submissionDocuments,
  type FixtureOptions,
} from './fixtures/filing-ai-10k';
import type { EntityReference, SubmissionHeader } from '../lib/filing-ai/types';

const entity: EntityReference = {
  cik: FIXTURE_CIK,
  legal_name: 'Meridian Industries, Inc.',
  fiscal_year_end: '1231',
  filer_status: 'large_accelerated',
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
};

function baseInput(
  options: FixtureOptions = {},
  overrides: Partial<GateInput> = {},
  submissionOverrides: Partial<SubmissionHeader> = {},
): GateInput {
  const html = primaryDocumentHtml(options);
  const documents = submissionDocuments(options);
  const submission: SubmissionHeader = {
    form_type: '10-K',
    period_of_report: FIXTURE_PERIOD,
    filer_cik: FIXTURE_CIK,
    file_number: '001-38856',
    accession: FIXTURE_ACCESSION,
    filing_date: '2026-02-20',
    is_xbrl: true,
    is_inline_xbrl: true,
    document_names: documents.map(document => document.name),
    documents,
    ...submissionOverrides,
  };
  const { cfm, instance, printedExhibitIndex } = normalize({
    runId: 'run_fixture',
    primary: {
      name: 'mrdn-20251231.htm',
      url: 'https://www.sec.gov/x.htm',
      html,
      bytes: html.length,
      sha256: 'fixture',
    },
    filingIndex: { accession: submission.accession, accessionCompact: '000123456726000011', documents },
    submission,
    entity,
  });

  return {
    requestedCik: FIXTURE_CIK,
    requestedForm: '10-K',
    submission,
    entity,
    cfm,
    instance,
    printedExhibitIndexLocated: printedExhibitIndex.located,
    historyAvailable: false,
    sourceDataSupplied: false,
    declaredTier: 0,
    ...overrides,
  };
}

function gate(result: ReturnType<typeof evaluateGates>, id: string) {
  const entry = result.results.find(candidate => candidate.gate === id);
  if (!entry) throw new Error(`Gate ${id} was not evaluated.`);
  return entry;
}

describe('G1 — completeness', () => {
  it('proceeds on a complete filing package', () => {
    const result = evaluateGates(baseInput());
    expect(gate(result, 'G1').passed).toBe(true);
    expect(result.hardStop).toBeNull();
  });

  it('hard-stops when the submission manifest is empty', () => {
    const input = baseInput();
    input.submission = { ...input.submission, documents: [] };
    const result = evaluateGates(input);
    expect(gate(result, 'G1').action).toBe('hard_stop');
    expect(result.hardStop).toMatch(/incomplete/i);
  });
});

describe('G2 — parse', () => {
  it('suppresses the XBRL and consistency layers when no facts were parsed', () => {
    const result = evaluateGates(baseInput({ stripInlineXbrl: true }));
    expect(gate(result, 'G2').action).toBe('suppress_dependent_rules');
    expect(result.hardStop).toBeNull();

    const xbrlRules = loadCatalog().rules.filter(rule => rule.layer === 'xbrl');
    for (const rule of xbrlRules) {
      expect(result.suppressions.get(rule.rule_id)?.gate, rule.rule_id).toBe('G2');
    }
  });

  it('suppresses the exhibit-index comparison when the printed index could not be read', () => {
    const result = evaluateGates(baseInput({}, { printedExhibitIndexLocated: false }));
    expect(result.suppressions.get('R-MECH-EXH-100')?.gate).toBe('G2');
    expect(result.suppressions.get('R-MECH-EXH-100')?.reason).toMatch(/could not be parsed/i);
  });

  it('leaves only the presence test standing when no signature blocks were parsed', () => {
    const input = baseInput({ dropSignatures: true });
    const result = evaluateGates(input);
    // The presence rule must still run — it is the one that reports the defect.
    expect(result.suppressions.has('R-MECH-SIG-001')).toBe(false);
    expect(result.suppressions.get('R-MECH-SIG-004')?.gate).toBe('G2');
  });
});

describe('G3 — identity', () => {
  it('hard-stops when the retrieved submission belongs to another registrant', () => {
    const result = evaluateGates(baseInput({}, { requestedCik: '0000320193' }));
    expect(gate(result, 'G3').action).toBe('hard_stop');
    expect(result.hardStop).toMatch(/CIK/);
  });

  it('hard-stops when the retrieved form is not the one requested', () => {
    const result = evaluateGates(baseInput({}, { requestedForm: '10-Q' }));
    expect(gate(result, 'G3').action).toBe('hard_stop');
  });

  it('treats an amendment as the same base form', () => {
    const result = evaluateGates(baseInput({}, {}, { form_type: '10-K/A' }));
    expect(gate(result, 'G3').passed).toBe(true);
  });
});

describe('G4 — authority', () => {
  it('hard-stops when the period of report cannot be resolved', () => {
    // Authority is pinned to the filing period; without one, the engine cannot
    // know which rules were in force.
    const result = evaluateGates(baseInput({}, {}, { period_of_report: 'FY2025' }));
    expect(gate(result, 'G4').action).toBe('hard_stop');
  });
});

describe('G5 — source reconciliation', () => {
  it('suppresses every rule that needs client source data', () => {
    const result = evaluateGates(baseInput());
    expect(gate(result, 'G5').action).toBe('suppress_dependent_rules');
    for (const rule of loadCatalog().rules.filter(candidate => candidate.inputs_required.includes('I5'))) {
      expect(result.suppressions.get(rule.rule_id)?.gate, rule.rule_id).toBe('G5');
    }
  });

  it('proceeds when source data was supplied', () => {
    const result = evaluateGates(baseInput({}, { sourceDataSupplied: true }));
    expect(gate(result, 'G5').action).toBe('proceed');
  });
});

describe('G6 — sufficiency to coverage', () => {
  it('derives the effective tier from what arrived, not from what was declared', () => {
    // The caller claims Tier 2 without supplying source data.
    const result = evaluateGates(baseInput({}, { declaredTier: 2 }));
    expect(result.tierEffective).toBe(0);
    expect(gate(result, 'G6').detail).toMatch(/declared tier 2.*support tier 0/i);
  });

  it('raises the tier when filing history is available', () => {
    expect(evaluateGates(baseInput({}, { historyAvailable: true })).tierEffective).toBe(1);
  });

  it('raises the tier to 2 when source data is supplied', () => {
    const result = evaluateGates(baseInput({}, { historyAvailable: true, sourceDataSupplied: true }));
    expect(result.tierEffective).toBe(2);
    expect(result.inputsAvailable).toEqual(expect.arrayContaining(['I1', 'I2', 'I3', 'I4', 'I5']));
  });
});
