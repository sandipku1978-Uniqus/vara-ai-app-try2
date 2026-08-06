/**
 * Input gates G1–G6.
 *
 * The input is a contract, not an upload. Which inputs arrived and survived
 * these gates *deterministically fixes* which rules may execute, and therefore
 * what the output is allowed to claim. A gate has exactly two ways to fail:
 * hard-stop the run, or take specific rules out of service and disclose that in
 * the coverage statement. There is no third option where a rule quietly runs on
 * data it cannot trust.
 */

import { loadCatalog } from './catalog';
import type {
  CanonicalFilingModel,
  EntityReference,
  GateResult,
  InputRef,
  Layer,
  SubmissionHeader,
} from './types';
import type { IxbrlDocument } from './ixbrl';

export interface GateSuppression {
  rule_id: string;
  reason: string;
  gate: string;
}

export interface GateEvaluation {
  results: GateResult[];
  suppressions: Map<string, { reason: string; gate: string }>;
  /** Set when a gate hard-stops; the run terminates and reports why. */
  hardStop: string | null;
  inputsAvailable: InputRef[];
  tierEffective: number;
}

function suppressLayer(
  suppressions: Map<string, { reason: string; gate: string }>,
  layer: Layer,
  reason: string,
  gate: string,
): void {
  for (const rule of loadCatalog().rules) {
    if (rule.layer !== layer) continue;
    if (suppressions.has(rule.rule_id)) continue;
    suppressions.set(rule.rule_id, { reason, gate });
  }
}

function suppressRules(
  suppressions: Map<string, { reason: string; gate: string }>,
  ruleIds: string[],
  reason: string,
  gate: string,
): void {
  for (const ruleId of ruleIds) {
    if (suppressions.has(ruleId)) continue;
    suppressions.set(ruleId, { reason, gate });
  }
}

export interface GateInput {
  requestedCik: string;
  requestedForm: string;
  submission: SubmissionHeader;
  entity: EntityReference;
  cfm: CanonicalFilingModel;
  instance: IxbrlDocument;
  printedExhibitIndexLocated: boolean;
  /** Whether prior-period facts were obtained for the continuity layer. */
  historyAvailable: boolean;
  /** Client source data (I5). Absent for Tier 0 and Tier 1 runs. */
  sourceDataSupplied: boolean;
  declaredTier: number;
}

const FOUR_DIGIT_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rules that read the printed exhibit index rather than the EDGAR manifest. */
const PRINTED_INDEX_RULES = ['R-MECH-EXH-100', 'R-MECH-EXH-102'];

/** Rules that read the signature page. */
const SIGNATURE_RULES = [
  'R-MECH-SIG-001', 'R-MECH-SIG-002', 'R-MECH-SIG-003', 'R-MECH-SIG-004',
  'R-MECH-SIG-005', 'R-MECH-SIG-006', 'R-MECH-SIG-007', 'R-MECH-SIG-008',
  'R-MECH-CRT-010',
];

export function evaluateGates(input: GateInput): GateEvaluation {
  const results: GateResult[] = [];
  const suppressions = new Map<string, { reason: string; gate: string }>();
  let hardStop: string | null = null;

  // ---------------------------------------------------------------- G1
  // Completeness. Is the filing package whole enough to test at all?
  const missing: string[] = [];
  if (!input.cfm.primary_document.name) missing.push('primary document');
  if (input.submission.documents.length === 0) missing.push('submission manifest');
  if (!input.submission.period_of_report) missing.push('period of report');
  const g1Passed = missing.length === 0;
  if (!g1Passed) hardStop = `Filing package is incomplete: ${missing.join(', ')} not available.`;
  results.push({
    gate: 'G1',
    passed: g1Passed,
    action: g1Passed ? 'proceed' : 'hard_stop',
    detail: g1Passed
      ? `Filing package received: ${input.submission.documents.length} document(s), primary document ${input.cfm.primary_document.name}.`
      : `Missing: ${missing.join(', ')}.`,
  });

  // ---------------------------------------------------------------- G2
  // Parse. Regions the normalizer could not read suppress the rules that
  // depend on them rather than letting those rules report a clean result.
  const textParsed = input.cfm.primary_document.text_length > 0;
  const inlineXbrlParsed = input.instance.hasInlineXbrl && input.instance.facts.length > 0;
  if (!textParsed && !hardStop) {
    hardStop = 'The primary document produced no readable text; no layer can be evaluated.';
  }
  if (!inlineXbrlParsed) {
    suppressLayer(
      suppressions,
      'xbrl',
      'No inline XBRL facts were parsed from the primary document.',
      'G2',
    );
    suppressLayer(
      suppressions,
      'consistency',
      'Consistency recomputation reads inline XBRL facts, none of which were parsed.',
      'G2',
    );
  }
  if (!input.printedExhibitIndexLocated) {
    suppressRules(
      suppressions,
      PRINTED_INDEX_RULES,
      'The exhibit index printed in the primary document could not be parsed, so it cannot be compared with the submitted document set.',
      'G2',
    );
  }
  if (input.cfm.signatures.length === 0) {
    suppressRules(
      suppressions,
      SIGNATURE_RULES.filter(ruleId => ruleId !== 'R-MECH-SIG-001'),
      'No signature blocks were parsed; only the presence test can be evaluated.',
      'G2',
    );
  }
  if (input.cfm.sections.length === 0) {
    suppressLayer(
      suppressions,
      'disclosure',
      'No Item sections were located in the primary document.',
      'G2',
    );
  }
  const g2Passed = textParsed && inlineXbrlParsed && input.cfm.sections.length > 0;
  results.push({
    gate: 'G2',
    passed: g2Passed,
    action: !textParsed ? 'hard_stop' : g2Passed ? 'proceed' : 'suppress_dependent_rules',
    detail: [
      `Reading text ${textParsed ? `extracted (${input.cfm.primary_document.text_length.toLocaleString()} characters)` : 'not extracted'}`,
      `${input.instance.facts.length.toLocaleString()} inline XBRL fact(s)`,
      `${input.cfm.sections.length} Item section(s)`,
      `${input.cfm.signatures.length} signature block(s)`,
    ].join(' · '),
  });

  // ---------------------------------------------------------------- G3
  // Identity. Is this the filing the caller asked about, for the entity they
  // named? Testing the wrong filing produces confident, entirely wrong output.
  const requestedCik = input.requestedCik.replace(/\D/g, '').padStart(10, '0');
  const submissionCik = input.submission.filer_cik.replace(/\D/g, '').padStart(10, '0');
  const cikMatches = requestedCik === submissionCik;
  const formBase = input.submission.form_type.replace(/\/A$/, '').toUpperCase();
  const requestedFormBase = input.requestedForm.replace(/\/A$/, '').toUpperCase();
  const formMatches = !input.requestedForm || formBase === requestedFormBase;
  const g3Passed = cikMatches && formMatches;
  if (!g3Passed && !hardStop) {
    hardStop = cikMatches
      ? `Requested form ${input.requestedForm} does not match the retrieved submission ${input.submission.form_type}.`
      : `Requested CIK ${requestedCik} does not match the retrieved submission CIK ${submissionCik}.`;
  }
  results.push({
    gate: 'G3',
    passed: g3Passed,
    action: g3Passed ? 'proceed' : 'hard_stop',
    detail: g3Passed
      ? `${input.entity.legal_name} · CIK ${submissionCik} · ${input.submission.form_type} for the period ended ${input.submission.period_of_report}.`
      : `Identity mismatch between the request and the retrieved submission.`,
  });

  // ---------------------------------------------------------------- G4
  // Authority. Rule selection is by filing period, never run date (G8). An
  // unusable period means the engine cannot know which rules were in force.
  const periodWellFormed = FOUR_DIGIT_DATE.test(input.submission.period_of_report);
  if (!periodWellFormed && !hardStop) {
    hardStop = `Period of report "${input.submission.period_of_report}" is not a resolvable date, so authority versions cannot be pinned to it.`;
  }
  results.push({
    gate: 'G4',
    passed: periodWellFormed,
    action: periodWellFormed ? 'proceed' : 'hard_stop',
    detail: periodWellFormed
      ? `Authority pinned to the period ended ${input.submission.period_of_report}, not to the run date.`
      : 'Period of report could not be resolved.',
  });

  // ---------------------------------------------------------------- G5
  // Source reconciliation. Without client source data there is nothing to
  // reconcile the filing back to, and every tie-out rule that would do so is
  // taken out of service.
  const g5Passed = input.sourceDataSupplied;
  if (!g5Passed) {
    suppressRules(
      suppressions,
      loadCatalog()
        .rules.filter(rule => rule.inputs_required.includes('I5'))
        .map(rule => rule.rule_id),
      'No client source data (I5) was supplied, so the filing cannot be reconciled to the books.',
      'G5',
    );
  }
  results.push({
    gate: 'G5',
    passed: g5Passed,
    action: g5Passed ? 'proceed' : 'suppress_dependent_rules',
    detail: g5Passed
      ? 'Client source data received and reconciled.'
      : 'No client source data supplied; tie-out to the trial balance and cap table is out of scope for this run.',
  });

  // ---------------------------------------------------------------- G6
  // Sufficiency → coverage. The effective tier is derived from what actually
  // arrived and passed, never from the caller's declared tier (§5.3).
  const inputsAvailable: InputRef[] = ['I1', 'I4'];
  if (input.historyAvailable) inputsAvailable.push('I2');
  if (input.entity.legal_name) inputsAvailable.push('I3');
  if (input.sourceDataSupplied) inputsAvailable.push('I5');

  let tierEffective = 0;
  if (input.historyAvailable) tierEffective = 1;
  if (input.sourceDataSupplied) tierEffective = 2;
  const tierDowngraded = tierEffective < input.declaredTier;

  results.push({
    gate: 'G6',
    passed: true,
    action: 'proceed',
    detail: tierDowngraded
      ? `Caller declared tier ${input.declaredTier}; inputs supplied support tier ${tierEffective}. This run executes at tier ${tierEffective}.`
      : `Inputs received: ${inputsAvailable.join(', ')}. Effective tier ${tierEffective}.`,
  });

  return { results, suppressions, hardStop, inputsAvailable, tierEffective };
}
