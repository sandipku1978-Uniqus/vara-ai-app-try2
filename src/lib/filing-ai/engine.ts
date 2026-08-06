/**
 * The run pipeline: ingest → gate → normalize → select → execute → score →
 * seal. Each stage is a discrete, independently testable step (build spec §3.1)
 * and each has one failure behaviour, stated up front: reject, hard-stop, or
 * suppress-and-disclose. There is no path where a stage fails quietly.
 *
 * Server-only.
 */

import { createHash } from 'node:crypto';

import {
  fetchCompanyFacts,
  fetchExhibitDocument,
  fetchFilingDocument,
  fetchFilingIndex,
  fetchSubmissions,
  padCik,
  resolveAuthority,
  type CompanyFact,
} from './artifacts';
import { extractDocumentTextFromHtmlServer } from '../filingTextServer';
import { getBinding } from './bindings';
import { loadCatalog, normaliseSeverity, selectRules, type CatalogStage } from './catalog';
import { evaluateGates } from './gates';
import { sealRunResult, SCOPE_LANGUAGE } from './guardrails';
import { exhibitNumberFromType, normalize } from './normalize';
import { evaluatePredicate, type CertificationArtifact, type PredicateContext } from './predicates';
import {
  assessFilerRisk,
  buildCoverage,
  deduplicateByRootCause,
  scoreReadiness,
} from './scoring';
import type {
  BuildWave,
  EvidencePack,
  Finding,
  FilingHistoryEntry,
  RuleError,
  RunResult,
  SubmissionDocument,
  SubmissionHeader,
} from './types';

export const ENGINE_VERSION = '0.1.0';

export class RunRejected extends Error {
  constructor(
    message: string,
    public readonly stage: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'RunRejected';
  }
}

export interface RunOptions {
  runId: string;
  cik: string;
  formType: string;
  /** Omit to test the most recent filing of this form. */
  accession?: string;
  declaredTier: number;
  stage: CatalogStage;
  waves: BuildWave[];
  engagementId?: string;
  sourceDataSupplied?: boolean;
  signal: AbortSignal;
}

const CERTIFICATION_EXHIBIT_PREFIXES = ['31', '32'];
const MAX_CERTIFICATION_DOCUMENTS = 4;

function isCertificationDocument(document: SubmissionDocument): boolean {
  const number = exhibitNumberFromType(document.type);
  if (!number) return false;
  return CERTIFICATION_EXHIBIT_PREFIXES.some(prefix => number === prefix || number.startsWith(`${prefix}.`));
}

/** Concepts the continuity layer compares against amounts as originally reported. */
const CONTINUITY_CONCEPTS = new Set([
  'Assets',
  'Liabilities',
  'StockholdersEquity',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'NetIncomeLoss',
  'ProfitLoss',
  'NetCashProvidedByUsedInOperatingActivities',
]);

function selectFilingFromHistory(
  history: FilingHistoryEntry[],
  formType: string,
  accession?: string,
): FilingHistoryEntry {
  if (accession) {
    const normalised = accession.trim();
    const match = history.find(
      entry => entry.accession === normalised || entry.accession.replace(/-/g, '') === normalised.replace(/-/g, ''),
    );
    if (!match) {
      throw new RunRejected(
        `Accession ${accession} was not found in the registrant's recent filing history.`,
        'ingest',
      );
    }
    return match;
  }

  const wanted = formType.trim().toUpperCase();
  const candidates = history
    .filter(entry => entry.form.toUpperCase() === wanted)
    .sort((left, right) => right.filing_date.localeCompare(left.filing_date));
  if (candidates.length === 0) {
    throw new RunRejected(
      `No ${formType} filing was found in the registrant's recent filing history.`,
      'ingest',
    );
  }
  return candidates[0];
}

/** The annual report immediately preceding the one under test. */
function findPriorAnnualReport(
  history: FilingHistoryEntry[],
  current: FilingHistoryEntry,
): FilingHistoryEntry | null {
  const base = current.form.replace(/\/A$/, '').toUpperCase();
  return (
    history
      .filter(
        entry =>
          entry.form.replace(/\/A$/, '').toUpperCase() === base
          && entry.accession !== current.accession
          && entry.period_of_report
          && entry.period_of_report < current.period_of_report,
      )
      .sort((left, right) => right.period_of_report.localeCompare(left.period_of_report))[0] ?? null
  );
}

function stableDigest(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return entry;
  });
  return createHash('sha256').update(canonical ?? '').digest('hex');
}

export async function executeRun(options: RunOptions): Promise<RunResult> {
  const startedAt = Date.now();
  const catalog = loadCatalog();

  // ------------------------------------------------------------- ingest
  const { entity, history } = await fetchSubmissions(options.cik, options.signal);
  const target = selectFilingFromHistory(history, options.formType, options.accession);
  const filingIndex = await fetchFilingIndex(options.cik, target.accession, options.signal);

  const primaryName = target.primary_document
    || filingIndex.documents.find(document => /^10-[KQ]/i.test(document.type))?.name
    || '';
  if (!primaryName) {
    throw new RunRejected('The submission contains no identifiable primary document.', 'ingest');
  }
  const primary = await fetchFilingDocument(
    options.cik,
    filingIndex.accessionCompact,
    primaryName,
    options.signal,
  );

  const submission: SubmissionHeader = {
    form_type: target.form,
    period_of_report: target.period_of_report,
    // The CIK EDGAR returned, not the one the caller asked for. Taking the
    // request's own value here would make G3's identity check compare the
    // request against itself; EDGAR resolves a successor or reorganised entity
    // to a different CIK, and testing that filing under the requested
    // registrant's name is exactly the failure G3 exists to catch.
    filer_cik: entity.cik || padCik(options.cik),
    file_number: entity.file_number || '',
    accession: target.accession,
    filing_date: target.filing_date,
    is_xbrl: true,
    is_inline_xbrl: true,
    document_names: filingIndex.documents.map(document => document.name),
    documents: filingIndex.documents,
  };

  // ---------------------------------------------------------- normalize
  const { cfm, instance, printedExhibitIndex, primaryText } = normalize({
    runId: options.runId,
    primary,
    filingIndex,
    submission,
    entity,
  });

  // Certifications are separate artefacts; the conformity rules diff their text
  // against the prescribed Item 601(b)(31) wording.
  const certifications: CertificationArtifact[] = [];
  const certificationDocuments = filingIndex.documents
    .filter(isCertificationDocument)
    .slice(0, MAX_CERTIFICATION_DOCUMENTS);
  for (const document of certificationDocuments) {
    try {
      const fetched = await fetchExhibitDocument(
        options.cik,
        filingIndex.accessionCompact,
        document.name,
        options.signal,
      );
      certifications.push({
        exhibit: exhibitNumberFromType(document.type) || document.type,
        name: fetched.name,
        url: fetched.url,
        text: extractDocumentTextFromHtmlServer(fetched.html) || fetched.html,
      });
    } catch (error) {
      cfm.unparsed_regions.push(
        `Certification exhibit ${document.type} (${document.name}) could not be retrieved: ${
          error instanceof Error ? error.message : 'unknown error'
        }.`,
      );
    }
  }

  // ------------------------------------------------------------ history
  const priorAnnual = findPriorAnnualReport(history, target);
  let priorFacts: CompanyFact[] = [];
  let historyAvailable = false;
  if (options.waves.includes('P1') && priorAnnual) {
    try {
      priorFacts = await fetchCompanyFacts(options.cik, CONTINUITY_CONCEPTS, options.signal);
      historyAvailable = priorFacts.length > 0;
    } catch (error) {
      cfm.unparsed_regions.push(
        `Prior-period company facts could not be retrieved, so continuity rules were not executed: ${
          error instanceof Error ? error.message : 'unknown error'
        }.`,
      );
    }
  }

  // --------------------------------------------------------------- gate
  const gates = evaluateGates({
    requestedCik: options.cik,
    requestedForm: options.formType,
    submission,
    entity,
    cfm,
    instance,
    printedExhibitIndexLocated: printedExhibitIndex.located,
    historyAvailable,
    sourceDataSupplied: Boolean(options.sourceDataSupplied),
    declaredTier: options.declaredTier,
  });

  const authority = resolveAuthority(submission.period_of_report);

  if (gates.hardStop) {
    throw new RunRejected(gates.hardStop, 'gate', gates.results);
  }

  // ------------------------------------------------------- select rules
  const selection = selectRules({
    formType: submission.form_type,
    periodOfReport: submission.period_of_report,
    inputsAvailable: gates.inputsAvailable,
    tierEffective: gates.tierEffective,
    stage: options.stage,
    suppressedByGates: gates.suppressions,
    waves: options.waves,
  });

  // ------------------------------------------------------------ execute
  const context: PredicateContext = {
    cfm,
    instance,
    entity,
    primaryText,
    certifications,
    priorFacts,
    priorAccession: priorAnnual?.accession ?? null,
  };

  const findings: Finding[] = [];
  const ruleErrors: RuleError[] = [];
  const suppressed = [...selection.suppressed];
  let executedCount = 0;

  for (const rule of selection.executable) {
    const binding = getBinding(rule.rule_id, rule.layer, rule.build_wave);
    try {
      const outcome = evaluatePredicate(binding, context);
      if (outcome.status === 'not_applicable') {
        // A rule that could not be evaluated is subtracted from coverage. It is
        // never recorded as a pass — that is the difference between "we looked
        // and it was fine" and "we could not look".
        suppressed.push({
          rule,
          reason: outcome.evidence.extracted,
          gate: 'G6',
        });
        continue;
      }
      executedCount += 1;
      if (outcome.status === 'pass') continue;

      const severity = outcome.severity ?? normaliseSeverity(rule.severity);
      findings.push({
        finding_id: `FND-${rule.rule_id}`,
        run_id: options.runId,
        rule_id: rule.rule_id,
        rule_version: rule.rule_version,
        layer: rule.layer,
        determinism: rule.determinism,
        severity,
        // An unresolved condition is a question for a preparer, never a
        // blocking defect — the engine did not establish that anything is wrong.
        blocking: outcome.status === 'unresolved' ? false : (outcome.blocking ?? rule.blocking),
        title: outcome.title ?? rule.name,
        description: outcome.description || rule.detection_logic,
        evidence: outcome.evidence,
        authority: rule.authority,
        remediation: outcome.remediation || 'Review the flagged item against the cited authority before submission.',
        // GR-3: deterministic findings are exactly 1.0.
        confidence: 1,
        root_cause_group: outcome.root_cause_key,
        status: 'open',
      });
    } catch (error) {
      // Build spec §3.1: an individual rule error is recorded, never silently
      // skipped. A swallowed exception is indistinguishable from a clean pass.
      ruleErrors.push({
        rule_id: rule.rule_id,
        message: error instanceof Error ? error.message : 'Rule raised a non-Error value.',
      });
      suppressed.push({
        rule,
        reason: 'The rule raised an error during execution and produced no result.',
        gate: 'G2',
      });
    }
  }

  // -------------------------------------------------------------- score
  const deduplicated = deduplicateByRootCause(findings);
  const coverage = buildCoverage({
    tierEffective: gates.tierEffective,
    rulesExecuted: executedCount,
    rulesApplicable: selection.applicable.length,
    suppressed: suppressed.map(entry => ({
      rule_id: entry.rule.rule_id,
      reason: entry.reason,
      gate: entry.gate,
    })),
    inputsReceived: gates.inputsAvailable,
    unparsedRegions: cfm.unparsed_regions,
    pilotCatalog: options.stage === 'pilot',
  });
  const readiness = scoreReadiness(deduplicated, coverage.coverage_factor);

  // ------------------------------------------------------------- seal
  const evidencePack: EvidencePack = {
    result_digest: stableDigest(
      deduplicated.map(finding => ({
        rule_id: finding.rule_id,
        rule_version: finding.rule_version,
        severity: finding.severity,
        blocking: finding.blocking,
        evidence: finding.evidence,
      })),
    ),
    artifact_digests: [
      { name: primary.name, sha256: primary.sha256, bytes: primary.bytes },
      ...certifications.map(certification => ({
        name: certification.name,
        sha256: createHash('sha256').update(certification.text).digest('hex'),
        bytes: certification.text.length,
      })),
    ],
    catalog_version: catalog.catalog_version,
    rule_versions: selection.executable.map(rule => ({
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
    })),
    authority,
    sealed_at: new Date().toISOString(),
  };

  const result: RunResult = {
    run_id: options.runId,
    completed_at: new Date().toISOString(),
    gate: readiness.gate,
    readiness_score: readiness.score,
    coverage,
    gate_results: gates.results,
    findings: deduplicated,
    filer_risk: assessFilerRisk(history, target.filing_date),
    rule_errors: ruleErrors,
    subject: {
      cik: padCik(options.cik),
      registrant: entity.legal_name,
      form_type: submission.form_type,
      period_of_report: submission.period_of_report,
      accession: submission.accession,
      filing_date: submission.filing_date,
      primary_document_url: primary.url,
      engagement_id: options.engagementId,
    },
    authority,
    catalog_version: catalog.catalog_version,
    engine_version: ENGINE_VERSION,
    duration_ms: Date.now() - startedAt,
    evidence_pack: evidencePack,
  };

  // Single exit point for every guardrail (GR-1 to GR-5).
  return sealRunResult(result);
}

export { SCOPE_LANGUAGE };
