/**
 * The predicate library — P2/P3/P4 execution.
 *
 * Roughly fifteen reusable predicates cover the whole catalog. If a rule needs
 * a bespoke function, the abstraction is wrong (build spec §5.2). Every
 * predicate is a pure function of the CanonicalFilingModel and its parameters,
 * which is what makes a run reproducible and replayable.
 *
 * Four outcomes, and the distinction between the last two is the product:
 *   pass            — the rule was evaluated and the filing satisfies it
 *   fail            — the rule was evaluated and the filing does not
 *   unresolved      — the requirement's condition cannot be answered from the
 *                     inputs at this tier, so the output is a question for a
 *                     preparer, not a defect
 *   not_applicable  — the rule does not apply, or the facts it needs were not
 *                     tagged; it is subtracted from coverage, never passed
 */

import type {
  PredicateSpec,
  ReferenceKey,
  Requirement,
  RuleBinding,
  Tolerance,
} from './bindings';
import { ROLE_PATTERNS } from './normalize';
import type { IxbrlDocument } from './ixbrl';
import type { CompanyFact } from './artifacts';
import type {
  CanonicalFilingModel,
  CfmFact,
  EntityReference,
  FindingEvidence,
  Provenance,
  Severity,
} from './types';

export interface CertificationArtifact {
  /** Exhibit number as filed, e.g. `31.1`. */
  exhibit: string;
  name: string;
  url: string;
  text: string;
}

export interface PredicateContext {
  cfm: CanonicalFilingModel;
  instance: IxbrlDocument;
  entity: EntityReference;
  primaryText: string;
  certifications: CertificationArtifact[];
  /** Prior-period values as originally reported, for the continuity layer. */
  priorFacts: CompanyFact[];
  /** Accession of the immediately preceding annual report, when one was found. */
  priorAccession: string | null;
}

export type PredicateStatus = 'pass' | 'fail' | 'unresolved' | 'not_applicable';

export interface PredicateOutcome {
  status: PredicateStatus;
  evidence: FindingEvidence;
  /** Overrides the catalog severity — only ever downwards, for unresolved conditions. */
  severity?: Severity;
  blocking?: boolean;
  title?: string;
  description?: string;
  remediation?: string;
  /**
   * Shared input fact behind the finding. One wrong share count that breaks
   * four rules is one finding with four symptoms (build spec §7.2).
   */
  root_cause_key?: string;
  location?: FindingEvidence['location'];
}

const NA = (reason: string): PredicateOutcome => ({
  status: 'not_applicable',
  evidence: { extracted: reason, expected: 'Rule not evaluated for this filing.' },
});

const PASS = (extracted: string, expected: string, location?: Provenance): PredicateOutcome => ({
  status: 'pass',
  evidence: { extracted, expected, location: location ? toLocation(location) : undefined },
});

function toLocation(provenance: Provenance): NonNullable<FindingEvidence['location']> {
  return {
    artifact: provenance.artifact,
    char_start: provenance.char_start,
    char_end: provenance.char_end,
    url: provenance.url,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function normaliseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(value: string): string[] {
  return normaliseText(value).split(/[^a-z0-9']+/).filter(Boolean);
}

function normaliseEntityName(value: string): string {
  return normaliseText(value)
    .replace(/[.,]/g, '')
    .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|llc|lp|plc|holdings|holding|group|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function withinTolerance(actual: number, expected: number, tolerance: Tolerance): boolean {
  const delta = Math.abs(actual - expected);
  const band = Math.max(tolerance.absolute, Math.abs(expected) * tolerance.relative);
  return delta <= band;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) < 1000 && !Number.isInteger(value)) return value.toFixed(4).replace(/0+$/, '');
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function isListed(context: PredicateContext): boolean {
  return (
    context.entity.exchanges.length > 0
    || Boolean(context.cfm.dei_tags.SecurityExchangeName)
    || Boolean(context.cfm.dei_tags.Security12bTitle)
  );
}

function isAccelerated(context: PredicateContext): boolean {
  const declared = (context.cfm.dei_tags.EntityFilerCategory || '').toLowerCase();
  if (declared) return /accelerated/.test(declared) && !/non-accelerated|non accelerated/.test(declared);
  return context.entity.filer_status === 'large_accelerated' || context.entity.filer_status === 'accelerated';
}

type RequirementOutcome = 'required' | 'not_required' | 'unresolved';

function resolveRequirement(requirement: Requirement, context: PredicateContext): RequirementOutcome {
  switch (requirement.kind) {
    case 'always':
      return 'required';
    case 'if_listed':
      return isListed(context) ? 'required' : 'not_required';
    case 'if_accelerated':
      return isAccelerated(context) ? 'required' : 'not_required';
    case 'conditional':
      return 'unresolved';
  }
}

/** Reporting period end, from the submission header. */
function periodEnd(context: PredicateContext): string {
  return context.cfm.submission.period_of_report;
}

function daysBetween(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return (to - from) / 86_400_000;
}

function conceptLocalName(concept: string): string {
  const colon = concept.indexOf(':');
  return colon >= 0 ? concept.slice(colon + 1) : concept;
}

/**
 * The consolidated, current-period value for a concept.
 *
 * Dimensional facts are excluded: a segment's revenue is not the registrant's
 * revenue, and mixing them is the fastest route to a tie-out engine that flags
 * every filing it sees. Both instant and full-year duration facts ending at the
 * period end qualify, so one selector serves balance-sheet and flow concepts.
 */
export function selectFact(context: PredicateContext, concepts: string[]): CfmFact | undefined {
  const wanted = new Set(concepts.map(conceptLocalName));
  const end = periodEnd(context);
  const candidates = context.cfm.facts.filter(fact => {
    if (typeof fact.value !== 'number') return false;
    if (!wanted.has(conceptLocalName(fact.concept))) return false;
    if (fact.period_end !== end) return false;
    const ixbrlContext = fact.context_ref ? context.instance.contexts.get(fact.context_ref) : undefined;
    if (!ixbrlContext || ixbrlContext.dimensions.length > 0) return false;
    if (fact.period_start) {
      const span = daysBetween(fact.period_start, end);
      // Annual figures only; a quarterly duration inside a 10-K is a comparative.
      if (!Number.isFinite(span) || span < 300 || span > 400) return false;
    }
    return true;
  });
  if (candidates.length === 0) return undefined;
  // Preference order matches the concept list the rule author supplied.
  for (const concept of concepts) {
    const local = conceptLocalName(concept);
    const match = candidates.find(fact => conceptLocalName(fact.concept) === local);
    if (match) return match;
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Exhibit predicates
// ---------------------------------------------------------------------------

/** Exhibits where incorporation by reference cannot satisfy the requirement. */
const IBR_NOT_PERMITTED = new Set(['19', '23', '31.1', '31.2', '32', '97', '101', '104']);

function exhibitMatches(candidate: string, wanted: string): boolean {
  if (candidate === wanted) return true;
  // `10` matches `10.1`, `10.24`; `32` matches `32.1`; `31.1` matches only itself.
  return candidate.startsWith(`${wanted}.`);
}

function evaluateExhibitPresent(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'exhibit_present' }>,
  binding: RuleBinding,
): PredicateOutcome {
  const requirement = resolveRequirement(spec.requirement, context);
  const matching = context.cfm.exhibits.filter(exhibit => exhibitMatches(exhibit.number, spec.exhibit));
  const attached = matching.filter(exhibit => exhibit.attached);
  const incorporated = matching.filter(exhibit => !exhibit.attached && exhibit.resolved);
  const ibrPermitted = !IBR_NOT_PERMITTED.has(spec.exhibit);

  const satisfied = attached.length > 0 || (ibrPermitted && incorporated.length > 0);
  const describeFound = attached.length > 0
    ? `Exhibit ${attached.map(exhibit => exhibit.number).join(', ')} submitted with the filing.`
    : incorporated.length > 0
      ? `Exhibit ${incorporated.map(exhibit => exhibit.number).join(', ')} shown in the printed index as incorporated by reference.`
      : `No document typed EX-${spec.exhibit} appears in the submitted document set.`;

  if (satisfied) {
    return PASS(describeFound, `Exhibit ${spec.exhibit} present.`, attached[0]?.provenance);
  }
  if (requirement === 'not_required') {
    return NA(`Exhibit ${spec.exhibit} is not required for this registrant on this form.`);
  }
  if (requirement === 'unresolved') {
    const question = spec.requirement.kind === 'conditional' ? spec.requirement.question : '';
    return {
      status: 'unresolved',
      severity: binding.unresolved_severity ?? 'low',
      blocking: false,
      title: `Confirm whether Exhibit ${spec.exhibit} is required`,
      description: question,
      remediation: `Confirm the condition and, where the exhibit is required, add it to the exhibit index and the submission.`,
      evidence: {
        extracted: describeFound,
        expected: `Exhibit ${spec.exhibit} where the Item 601 condition is met.`,
      },
      root_cause_key: `exhibit:${spec.exhibit}`,
    };
  }
  return {
    status: 'fail',
    evidence: {
      extracted: describeFound,
      expected: `A document typed EX-${spec.exhibit} in the submission${ibrPermitted ? ', or a valid incorporation by reference' : ''}.`,
    },
    remediation: `Attach Exhibit ${spec.exhibit} and add the corresponding row to the exhibit index before submission.`,
    root_cause_key: `exhibit:${spec.exhibit}`,
  };
}

function evaluateExhibitIndexResolves(context: PredicateContext): PredicateOutcome {
  const unresolved = context.cfm.exhibits.filter(exhibit => !exhibit.attached && !exhibit.resolved);
  if (unresolved.length === 0) {
    const attached = context.cfm.exhibits.filter(exhibit => exhibit.attached).length;
    return PASS(
      `${attached} exhibit document(s) submitted; every printed index row maps to a submitted document or an incorporation by reference.`,
      'Every exhibit index row resolves.',
    );
  }
  return {
    status: 'fail',
    evidence: {
      extracted: `Printed index row(s) ${unresolved.map(exhibit => exhibit.number).join(', ')} do not map to a submitted document and carry no incorporation-by-reference language.`,
      expected: 'Every exhibit index row maps to an attached document or a resolvable prior filing.',
    },
    remediation: 'Attach the missing documents, or add the incorporation-by-reference citation naming the prior filing and its exhibit number.',
    location: unresolved[0].provenance ? toLocation(unresolved[0].provenance) : undefined,
    root_cause_key: 'exhibit-index',
  };
}

function evaluateExhibitClassification(context: PredicateContext): PredicateOutcome {
  const problems: string[] = [];
  const has = (number: string) => context.cfm.exhibits.some(e => e.attached && e.number === number);

  if (!has('31.1') || !has('31.2')) {
    problems.push(
      'EX-31 certifications are not both present as separate documents (31.1 for the principal executive officer, 31.2 for the principal financial officer).',
    );
  }
  const ex32 = context.cfm.exhibits.filter(e => e.attached && exhibitMatches(e.number, '32'));
  if (ex32.length === 0) {
    problems.push('No EX-32 Section 1350 statement was submitted.');
  }
  // The furnished/filed distinction is carried in the printed index wording.
  const printedRows = context.cfm.exhibits.filter(e => !e.attached && e.description);
  const ex32Row = printedRows.find(row => exhibitMatches(row.number, '32'));
  if (ex32Row && !/furnish/i.test(ex32Row.description || '')) {
    problems.push('The EX-32 index row does not describe the statement as furnished.');
  }

  if (problems.length === 0) {
    return PASS(
      'EX-31.1 and EX-31.2 are separate filed documents; an EX-32 Section 1350 statement is present.',
      'EX-31 filed separately per officer; EX-32 furnished.',
    );
  }
  return {
    status: 'fail',
    evidence: {
      extracted: problems.join(' '),
      expected: 'EX-31 filed as a separate document for each officer; EX-32 furnished, not filed.',
    },
    remediation: 'Split or re-label the exhibits so each officer has a separate EX-31 and the Section 1350 statement is furnished as EX-32.',
    root_cause_key: 'certification-exhibits',
  };
}

// ---------------------------------------------------------------------------
// Certification predicates
// ---------------------------------------------------------------------------

function certificationsFor(context: PredicateContext, prefix: string): CertificationArtifact[] {
  return context.certifications.filter(artifact => artifact.exhibit.startsWith(prefix));
}

function evaluateCertificationText(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'certification_text_conforms' }>,
): PredicateOutcome {
  const certifications = certificationsFor(context, '31');
  if (certifications.length === 0) {
    // The missing-exhibit rule owns this defect; reporting it twice would put
    // the same root cause in the worklist under two headings.
    return NA('No EX-31 certification document was retrieved; the exhibit-presence rule reports this.');
  }

  const deficient: string[] = [];
  for (const certification of certifications) {
    const text = normaliseText(certification.text);
    const missing = spec.phrases.filter(phrase => !text.includes(normaliseText(phrase)));
    const matched = spec.phrases.length - missing.length;
    if (matched < spec.min_match) {
      deficient.push(
        `EX-${certification.exhibit}: paragraph ${spec.paragraph} matched ${matched} of ${spec.phrases.length} prescribed passages (needs ${spec.min_match}). Missing: “${missing[0]}”.`,
      );
    }
  }

  if (deficient.length === 0) {
    return PASS(
      `Paragraph ${spec.paragraph} matches the prescribed wording in ${certifications.map(c => `EX-${c.exhibit}`).join(' and ')}.`,
      `Item 601(b)(31) paragraph ${spec.paragraph} wording.`,
    );
  }
  return {
    status: 'fail',
    evidence: {
      extracted: deficient.join(' '),
      expected: `The prescribed Item 601(b)(31) wording for paragraph ${spec.paragraph}.`,
    },
    remediation: 'Restore the prescribed certification wording verbatim. Item 601(b)(31) does not permit modification.',
    root_cause_key: 'certification-wording',
  };
}

const CERT_NAME_PATTERNS = [
  /\bi,\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s*,/,
  /\/s\/\s*([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,3})/,
];

function certificationSignerName(text: string): string | null {
  for (const pattern of CERT_NAME_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

const LONG_DATE = /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/gi;

/**
 * The date the officer signed, not the first date in the document.
 *
 * Paragraph 1 of every certification names the period being reported on
 * ("for the fiscal year ended December 31, 2025"), so taking the first date
 * match reads the period end back as the signature date and the rule can never
 * fail. An explicit "Date:" label wins; otherwise the last date in the
 * document is taken, since the signature block sits at the end.
 */
function certificationDate(text: string): string | null {
  const labelled = /\bdate[d]?\s*[:\s]\s*((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/i.exec(
    text,
  );
  if (labelled?.[1]) return labelled[1].trim();
  const all = text.match(LONG_DATE);
  return all && all.length > 0 ? all[all.length - 1].trim() : null;
}

function evaluateCertificationCrossReference(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'certification_cross_reference' }>,
): PredicateOutcome {
  const ex31 = certificationsFor(context, '31');
  const ex32 = certificationsFor(context, '32');

  if (spec.check === 'ex32_reference') {
    if (ex32.length === 0) return NA('No EX-32 Section 1350 statement was retrieved.');
    const period = periodEnd(context);
    const year = period.slice(0, 4);
    const form = context.cfm.submission.form_type.replace(/\/A$/, '');
    const problems = ex32
      .filter(artifact => {
        const text = normaliseText(artifact.text);
        return !text.includes(normaliseText(form)) || !text.includes(year);
      })
      .map(artifact => `EX-${artifact.exhibit} does not name both Form ${form} and the period ending ${period}.`);
    return problems.length === 0
      ? PASS(`EX-32 names Form ${form} and the period ended ${period}.`, 'Section 1350 statement identifies the report and period.')
      : {
          status: 'fail',
          evidence: { extracted: problems.join(' '), expected: `A reference to Form ${form} and the period ended ${period}.` },
          remediation: 'Update the Section 1350 statement to name the report and its period end.',
          root_cause_key: 'ex32-reference',
        };
  }

  if (ex31.length === 0) return NA('No EX-31 certification document was retrieved.');

  if (spec.check === 'officer_names') {
    const signatureNames = context.cfm.signatures.map(signature => normaliseText(signature.name));
    if (signatureNames.length === 0) return NA('No signature blocks were parsed to compare against.');
    const mismatched: string[] = [];
    for (const certification of ex31) {
      const signer = certificationSignerName(certification.text);
      if (!signer) {
        mismatched.push(`EX-${certification.exhibit}: the certifying officer's name could not be read.`);
        continue;
      }
      const normalised = normaliseText(signer);
      const onSignaturePage = signatureNames.some(
        name => name === normalised || name.includes(normalised) || normalised.includes(name),
      );
      if (!onSignaturePage) {
        mismatched.push(`EX-${certification.exhibit} is signed by “${signer}”, who does not appear on the signature page.`);
      }
    }
    return mismatched.length === 0
      ? PASS('Each EX-31 certifying officer also appears on the signature page.', 'Certifying officers match the signature page.')
      : {
          status: 'fail',
          evidence: { extracted: mismatched.join(' '), expected: 'Each certifying officer appears on the signature page.' },
          remediation: 'Reconcile the certifying officers with the signature page and the officer register.',
          root_cause_key: 'officer-identity',
        };
  }

  if (spec.check === 'officer_titles') {
    const text = normaliseText(ex31.map(artifact => artifact.text).join('\n'));
    const hasPeo = ROLE_PATTERNS.peo.test(text);
    const hasPfo = ROLE_PATTERNS.pfo.test(text);
    if (hasPeo && hasPfo) {
      return PASS(
        'The EX-31 set identifies both a principal executive officer and a principal financial officer.',
        'Both principal officer roles identified.',
      );
    }
    return {
      status: 'fail',
      evidence: {
        extracted: `EX-31 set identifies ${hasPeo ? 'a principal executive officer' : 'no principal executive officer'} and ${hasPfo ? 'a principal financial officer' : 'no principal financial officer'}.`,
        expected: 'Separate certifications identifying the principal executive officer and the principal financial officer.',
      },
      remediation: 'State each certifying officer’s principal-officer role in the certification.',
      root_cause_key: 'officer-identity',
    };
  }

  if (spec.check === 'period_and_form') {
    const period = periodEnd(context);
    const form = context.cfm.submission.form_type.replace(/\/A$/, '');
    const problems = ex31
      .filter(artifact => {
        const text = normaliseText(artifact.text);
        return !text.includes(normaliseText(form)) || !text.includes(period.slice(0, 4));
      })
      .map(artifact => `EX-${artifact.exhibit} does not name Form ${form} and the period ending ${period}.`);
    return problems.length === 0
      ? PASS(`Each EX-31 names Form ${form} for the period ended ${period}.`, 'Report and period named in each certification.')
      : {
          status: 'fail',
          evidence: { extracted: problems.join(' '), expected: `Form ${form} and the period ended ${period}.` },
          remediation: 'Update the certification to name the report and its period.',
          root_cause_key: 'certification-period',
        };
  }

  // spec.check === 'dated'
  const period = periodEnd(context);
  const filingDate = context.cfm.submission.filing_date;
  const problems: string[] = [];
  for (const certification of ex31) {
    const dateLiteral = certificationDate(certification.text);
    if (!dateLiteral) {
      problems.push(`EX-${certification.exhibit} carries no readable date.`);
      continue;
    }
    const parsed = new Date(`${dateLiteral.replace(',', '')} UTC`);
    if (Number.isNaN(parsed.getTime())) {
      problems.push(`EX-${certification.exhibit} date “${dateLiteral}” could not be read.`);
      continue;
    }
    const iso = parsed.toISOString().slice(0, 10);
    if (iso < period) problems.push(`EX-${certification.exhibit} is dated ${iso}, before the period end ${period}.`);
    if (filingDate && iso > filingDate) {
      problems.push(`EX-${certification.exhibit} is dated ${iso}, after the filing date ${filingDate}.`);
    }
  }
  return problems.length === 0
    ? PASS('Each EX-31 carries a date between the period end and the filing date.', 'Certification dated on or after the period end.')
    : {
        status: 'fail',
        evidence: { extracted: problems.join(' '), expected: `A date on or after ${period} and on or before ${filingDate || 'the filing date'}.` },
        remediation: 'Date each certification on or after the period end and no later than the filing date.',
        root_cause_key: 'certification-date',
      };
}

// ---------------------------------------------------------------------------
// Signature predicates
// ---------------------------------------------------------------------------

function evaluateSignatureBlock(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'signature_block' }>,
  binding: RuleBinding,
): PredicateOutcome {
  const signatures = context.cfm.signatures;
  const roleMatch = (pattern: RegExp) => signatures.filter(signature => pattern.test(signature.title));

  switch (spec.check) {
    case 'present':
      return signatures.length > 0
        ? PASS(`${signatures.length} signature block(s) located on the signature page.`, 'A signature page is present.')
        : {
            status: 'fail',
            evidence: { extracted: 'No signature blocks were located in the primary document.', expected: 'A signature page bearing the required signatures.' },
            remediation: 'Add the signature page required by the General Instructions to Form 10-K.',
            root_cause_key: 'signature-page',
          };

    case 'registrant_name': {
      const first = signatures[0];
      if (!first) return NA('No signature blocks were parsed.');
      const window = context.primaryText.slice(
        Math.max(0, first.char_offset - 3_000),
        first.char_offset + 200,
      );
      const registrant = normaliseEntityName(context.entity.legal_name);
      const found = registrant.length > 0 && normaliseEntityName(window).includes(registrant);
      return found
        ? PASS(`The signature page names ${context.entity.legal_name}.`, 'Registrant named on the signature page.')
        : {
            status: 'fail',
            evidence: {
              extracted: `The registrant name “${context.entity.legal_name}” was not found in the text preceding the first signature block.`,
              expected: 'The registrant name exactly as it appears on the cover page.',
            },
            remediation: 'Name the registrant on the signature page exactly as on the cover page.',
            root_cause_key: 'signature-page',
          };
    }

    case 'conformed_format': {
      // Every parsed signature carries a /s/ marker by construction, so the
      // question is whether signatory-looking blocks exist that carry none.
      const roleMentions = (context.primaryText.match(/\b(chief executive officer|chief financial officer|chief accounting officer|\bdirector\b)\b/gi) || []).length;
      if (signatures.length === 0 && roleMentions > 0) {
        return {
          status: 'fail',
          evidence: {
            extracted: 'Officer and director titles appear in the filing but no conformed “/s/” signature was found.',
            expected: 'Every signature block uses the conformed “/s/ Name” format.',
          },
          remediation: 'Render each signature in conformed format, as required for electronic submission.',
          root_cause_key: 'signature-page',
        };
      }
      return signatures.length > 0
        ? PASS(`${signatures.length} conformed “/s/” signature(s).`, 'Conformed signature format.')
        : NA('No signature blocks were parsed.');
    }

    case 'peo_signed':
    case 'pfo_signed':
    case 'pao_signed': {
      const role = spec.check === 'peo_signed' ? 'peo' : spec.check === 'pfo_signed' ? 'pfo' : 'pao';
      const label = role === 'peo'
        ? 'principal executive officer'
        : role === 'pfo'
          ? 'principal financial officer'
          : 'principal accounting officer or controller';
      const matches = roleMatch(ROLE_PATTERNS[role]);
      if (matches.length > 0) {
        return PASS(
          `${matches[0].name} signed as ${matches[0].title || label}.`,
          `A ${label} signature.`,
        );
      }
      if (signatures.length === 0) return NA('No signature blocks were parsed.');
      return {
        status: 'fail',
        evidence: {
          extracted: `No signature block on the signature page carries a ${label} title. Titles read: ${signatures.slice(0, 6).map(s => s.title || '(no title parsed)').join('; ')}.`,
          expected: `A signature identified as ${label}.`,
        },
        remediation: `Add the ${label} signature, or state the role in the existing signature block.`,
        root_cause_key: `signature-${role}`,
      };
    }

    case 'board_majority': {
      const directors = roleMatch(ROLE_PATTERNS.director);
      if (signatures.length === 0) return NA('No signature blocks were parsed.');
      if (directors.length === 0) {
        return {
          status: 'fail',
          evidence: {
            extracted: 'No signature block on the signature page carries a director title.',
            expected: 'A majority of the board of directors signs the annual report.',
          },
          remediation: 'Obtain and include the director signatures required by the General Instructions to Form 10-K.',
          root_cause_key: 'signature-board',
        };
      }
      return {
        status: 'unresolved',
        severity: binding.unresolved_severity ?? 'medium',
        blocking: false,
        title: 'Confirm a majority of the board signed',
        description: spec.requirement?.kind === 'conditional' ? spec.requirement.question : '',
        remediation: 'Confirm the number of directors in office at the filing date and that a majority appear on the signature page.',
        evidence: {
          extracted: `${directors.length} signature block(s) carry a director title: ${directors.map(d => d.name).join(', ')}. Board size is not available from the filing package.`,
          expected: 'Signatures from more than half of the directors in office.',
        },
        root_cause_key: 'signature-board',
      };
    }

    case 'dates_present': {
      if (signatures.length === 0) return NA('No signature blocks were parsed.');
      const dated = signatures.filter(signature => signature.date);
      if (dated.length > 0) {
        return PASS(
          `${dated.length} of ${signatures.length} signature block(s) carry a date.`,
          'Signature blocks are dated.',
        );
      }
      return {
        status: 'fail',
        evidence: {
          extracted: `None of the ${signatures.length} signature block(s) carries a readable date.`,
          expected: 'Each signature block carries the date of signature.',
        },
        remediation: 'Date each signature block on the signature page.',
        root_cause_key: 'signature-page',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Cover page, header and dei tag predicates
// ---------------------------------------------------------------------------

function referenceValue(key: ReferenceKey, context: PredicateContext): string | string[] | null {
  const submission = context.cfm.submission;
  switch (key) {
    case 'submission.form_type':
      return submission.form_type;
    case 'submission.period_of_report':
      return submission.period_of_report;
    case 'submission.filer_cik':
      return submission.filer_cik;
    case 'submission.file_number':
      return submission.file_number || context.entity.file_number;
    case 'submission.is_amendment':
      return submission.form_type.endsWith('/A') ? 'true' : 'false';
    case 'entity.legal_name':
      return context.entity.legal_name;
    case 'entity.filer_status':
      return context.entity.filer_status === 'unknown' ? null : context.entity.filer_status;
    case 'entity.state_of_incorporation':
      return context.entity.state_of_incorporation;
    case 'entity.ein':
      return context.entity.ein;
    case 'entity.is_shell':
      return context.entity.is_shell === null ? null : String(context.entity.is_shell);
    case 'entity.fiscal_year_end':
      return context.entity.fiscal_year_end;
    case 'entity.exchanges':
      return context.entity.exchanges;
    case 'entity.tickers':
      return context.entity.tickers;
  }
}

function normaliseFilerCategory(value: string): string {
  const text = value.toLowerCase();
  if (/non-accelerated|non accelerated/.test(text)) return 'non_accelerated';
  if (/large accelerated/.test(text)) return 'large_accelerated';
  if (/accelerated/.test(text)) return 'accelerated';
  return text.replace(/\s+/g, '_');
}

function normaliseFileNumber(value: string): string {
  const match = /(\d+)\s*-\s*(\d+)/.exec(value);
  if (!match) return value.replace(/\s+/g, '').toLowerCase();
  return `${Number(match[1])}-${Number(match[2])}`;
}

function normaliseFiscalYearEnd(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.slice(-4);
}

function valuesAgree(key: ReferenceKey, tagValue: string, reference: string | string[]): boolean {
  if (Array.isArray(reference)) {
    return reference.some(entry => normaliseText(entry) === normaliseText(tagValue));
  }
  switch (key) {
    case 'entity.legal_name': {
      const left = normaliseEntityName(tagValue);
      const right = normaliseEntityName(reference);
      return left === right || left.includes(right) || right.includes(left);
    }
    case 'entity.filer_status':
      return normaliseFilerCategory(tagValue) === normaliseFilerCategory(reference);
    case 'submission.filer_cik':
      return tagValue.replace(/\D/g, '').padStart(10, '0') === reference.replace(/\D/g, '').padStart(10, '0');
    case 'submission.file_number':
      return normaliseFileNumber(tagValue) === normaliseFileNumber(reference);
    case 'entity.fiscal_year_end':
      return normaliseFiscalYearEnd(tagValue) === normaliseFiscalYearEnd(reference);
    case 'entity.ein':
      return tagValue.replace(/\D/g, '') === reference.replace(/\D/g, '');
    case 'submission.form_type':
      return normaliseText(tagValue).replace(/\/a$/, '') === normaliseText(reference).replace(/\/a$/, '');
    default:
      return normaliseText(tagValue) === normaliseText(reference);
  }
}

function evaluateTagAgainstReference(
  context: PredicateContext,
  tag: string,
  key: ReferenceKey,
  label: string,
): PredicateOutcome {
  const tagValue = context.cfm.dei_tags[tag];
  if (!tagValue) {
    return {
      status: 'fail',
      evidence: {
        extracted: `The cover tag dei:${tag} is absent from the inline XBRL.`,
        expected: `dei:${tag} present and equal to ${label}.`,
      },
      remediation: `Tag ${label} on the cover page with dei:${tag}.`,
      root_cause_key: `dei:${tag}`,
    };
  }

  const reference = referenceValue(key, context);
  if (reference === null || (Array.isArray(reference) && reference.length === 0)) {
    // No independent reference exists at this tier. Degrading to a presence
    // test and saying so is honest; silently passing a consistency test that
    // never ran is not.
    return PASS(
      `dei:${tag} = “${tagValue}”. No independent ${label} reference is available at this tier, so only presence and well-formedness were tested.`,
      `dei:${tag} present.`,
    );
  }

  const referenceText = Array.isArray(reference) ? reference.join(', ') : reference;
  if (valuesAgree(key, tagValue, reference)) {
    return PASS(`dei:${tag} = “${tagValue}” agrees with ${label} “${referenceText}”.`, `dei:${tag} equals ${label}.`);
  }
  return {
    status: 'fail',
    evidence: {
      extracted: `dei:${tag} = “${tagValue}”; ${label} = “${referenceText}”.`,
      expected: `dei:${tag} equal to ${label}.`,
    },
    remediation: `Reconcile the cover tag with ${label} before submission.`,
    root_cause_key: `dei:${tag}`,
  };
}

const REFERENCE_LABELS: Record<ReferenceKey, string> = {
  'submission.form_type': 'the submission form type',
  'submission.period_of_report': 'the submission period of report',
  'submission.filer_cik': 'the filer CIK',
  'submission.file_number': 'the commission file number',
  'submission.is_amendment': 'the submission amendment status',
  'entity.legal_name': 'the registrant name on record',
  'entity.filer_status': 'the filer category on record',
  'entity.state_of_incorporation': 'the state of incorporation on record',
  'entity.ein': 'the employer identification number on record',
  'entity.is_shell': 'the shell company status on record',
  'entity.fiscal_year_end': 'the fiscal year end on record',
  'entity.exchanges': 'the registered exchanges on record',
  'entity.tickers': 'the trading symbols on record',
};

function evaluateCoverField(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'cover_field' }>,
): PredicateOutcome {
  const requirement = resolveRequirement(spec.requirement, context);
  if (requirement === 'not_required') {
    return NA(`${spec.label} is not required for this registrant on this form.`);
  }

  for (const tag of spec.dei_tags) {
    const value = context.cfm.dei_tags[tag];
    if (value) {
      return PASS(`${spec.label} tagged as dei:${tag} = “${value}”.`, `${spec.label} stated on the cover page.`);
    }
  }

  // Fall back to the printed cover page. The cover is the opening stretch of
  // the document, so the scan is bounded rather than whole-document.
  const coverText = normaliseText(context.primaryText.slice(0, 30_000));
  const matchedPattern = (spec.patterns || []).find(pattern => coverText.includes(normaliseText(pattern)));
  if (matchedPattern) {
    return PASS(
      `${spec.label} appears on the printed cover page (“${matchedPattern}”) but is not inline-tagged.`,
      `${spec.label} stated on the cover page.`,
    );
  }

  return {
    status: 'fail',
    evidence: {
      extracted: `${spec.label} was found neither as an inline tag (${spec.dei_tags.map(tag => `dei:${tag}`).join(', ')}) nor on the printed cover page.`,
      expected: `${spec.label} stated on the cover page and inline-tagged.`,
    },
    remediation: `State ${spec.label.toLowerCase()} on the cover page and tag it with ${spec.dei_tags.map(tag => `dei:${tag}`).join(' / ')}.`,
    root_cause_key: `cover:${spec.dei_tags[0] || spec.label}`,
  };
}

// ---------------------------------------------------------------------------
// XBRL structural predicates
// ---------------------------------------------------------------------------

/** Concepts whose natural balance is positive; a negative value is a sign error. */
const POSITIVE_BALANCE_CONCEPTS = new Set([
  'Assets', 'AssetsCurrent', 'AssetsNoncurrent', 'Liabilities', 'LiabilitiesCurrent',
  'CashAndCashEquivalentsAtCarryingValue', 'InventoryNet', 'PropertyPlantAndEquipmentNet',
  'Goodwill', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues',
  'CommonStockSharesOutstanding', 'CommonStockSharesIssued',
  'WeightedAverageNumberOfSharesOutstandingBasic', 'LiabilitiesAndStockholdersEquity',
]);

const INSTANT_CONCEPTS = new Set([
  'Assets', 'AssetsCurrent', 'Liabilities', 'LiabilitiesCurrent', 'StockholdersEquity',
  'LiabilitiesAndStockholdersEquity', 'CashAndCashEquivalentsAtCarryingValue', 'Goodwill',
  'InventoryNet', 'PropertyPlantAndEquipmentNet', 'CommonStockSharesOutstanding',
]);

const DURATION_CONCEPTS = new Set([
  'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'NetIncomeLoss',
  'ProfitLoss', 'OperatingIncomeLoss', 'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInInvestingActivities', 'NetCashProvidedByUsedInFinancingActivities',
]);

const REQUIRED_COVER_TAGS = [
  'DocumentType', 'DocumentPeriodEndDate', 'EntityRegistrantName', 'EntityCentralIndexKey',
  'AmendmentFlag', 'DocumentFiscalYearFocus', 'DocumentFiscalPeriodFocus', 'EntityFilerCategory',
  'EntityIncorporationStateCountryCode', 'EntityFileNumber',
];

function evaluateXbrlStructural(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'xbrl_structural' }>,
): PredicateOutcome {
  const facts = context.cfm.facts;
  const numericFacts = facts.filter(fact => typeof fact.value === 'number');

  switch (spec.check) {
    case 'instance_attached': {
      const instanceExhibit = context.cfm.exhibits.some(e => e.attached && e.number.startsWith('101'));
      const inline = context.instance.hasInlineXbrl && facts.length > 0;
      return instanceExhibit || inline
        ? PASS(
            `${facts.length.toLocaleString()} inline XBRL fact(s) parsed from the primary document${instanceExhibit ? '; EX-101 documents present in the submission' : ''}.`,
            'An inline XBRL instance is present.',
          )
        : {
            status: 'fail',
            evidence: { extracted: 'No inline XBRL instance or EX-101 document was found.', expected: 'An inline XBRL instance with linkbases.' },
            remediation: 'Generate and attach the inline XBRL instance before submission.',
            root_cause_key: 'xbrl-instance',
          };
    }

    case 'context_resolves': {
      const orphans = facts.filter(fact => fact.context_ref && !context.instance.contexts.get(fact.context_ref));
      const missing = facts.filter(fact => !fact.context_ref);
      const total = orphans.length + missing.length;
      return total === 0
        ? PASS(`All ${facts.length.toLocaleString()} fact(s) resolve to a declared context.`, 'Every fact resolves to a context.')
        : {
            status: 'fail',
            evidence: {
              extracted: `${total} fact(s) do not resolve to a declared context (${orphans.length} unresolvable contextRef, ${missing.length} with none). First: ${(orphans[0] || missing[0])?.concept}.`,
              expected: 'Every reported fact resolves to a context with a valid entity and period.',
            },
            remediation: 'Regenerate the instance so every fact references a declared context.',
            root_cause_key: 'xbrl-context',
          };
    }

    case 'unit_and_decimals': {
      const deficient = numericFacts.filter(fact => !fact.unit || fact.decimals === undefined);
      return deficient.length === 0
        ? PASS(`All ${numericFacts.length.toLocaleString()} numeric fact(s) carry a unit and a decimals attribute.`, 'Unit and decimals present on every numeric fact.')
        : {
            status: 'fail',
            evidence: {
              extracted: `${deficient.length} of ${numericFacts.length} numeric fact(s) are missing a unit or decimals attribute. First: ${deficient[0].concept}.`,
              expected: 'Every numeric fact carries a unitRef and a decimals attribute.',
            },
            remediation: 'Add the missing unitRef and decimals attributes in the tagging tool.',
            location: deficient[0].provenance ? toLocation(deficient[0].provenance) : undefined,
            root_cause_key: 'xbrl-units',
          };
    }

    case 'negative_plausibility': {
      const suspect = numericFacts.filter(fact => {
        const local = conceptLocalName(fact.concept);
        if (!POSITIVE_BALANCE_CONCEPTS.has(local)) return false;
        const ixbrlContext = fact.context_ref ? context.instance.contexts.get(fact.context_ref) : undefined;
        if (!ixbrlContext || ixbrlContext.dimensions.length > 0) return false;
        return (fact.value as number) < 0;
      });
      return suspect.length === 0
        ? PASS('No consolidated fact with a natural positive balance is tagged negative.', 'Natural-balance signs are plausible.')
        : {
            status: 'fail',
            evidence: {
              extracted: `${suspect.length} consolidated fact(s) with a natural positive balance carry a negative value: ${suspect.slice(0, 4).map(fact => `${fact.concept} = ${formatNumber(fact.value as number)}`).join('; ')}.`,
              expected: 'Elements with a natural positive balance are not tagged negative.',
            },
            remediation: 'Review the sign and negated-label treatment on the flagged elements.',
            location: suspect[0].provenance ? toLocation(suspect[0].provenance) : undefined,
            root_cause_key: 'xbrl-sign',
          };
    }

    case 'period_type': {
      const problems: string[] = [];
      for (const fact of numericFacts) {
        const local = conceptLocalName(fact.concept);
        const ixbrlContext = fact.context_ref ? context.instance.contexts.get(fact.context_ref) : undefined;
        if (!ixbrlContext) continue;
        const isInstantContext = Boolean(ixbrlContext.instant);
        if (INSTANT_CONCEPTS.has(local) && !isInstantContext) {
          problems.push(`${fact.concept} is tagged over a duration but is an instant concept.`);
        }
        if (DURATION_CONCEPTS.has(local) && isInstantContext) {
          problems.push(`${fact.concept} is tagged at an instant but is a duration concept.`);
        }
        if (problems.length >= 5) break;
      }
      return problems.length === 0
        ? PASS('Instant and duration concepts are tagged against matching context period types.', 'Period type matches the concept.')
        : {
            status: 'fail',
            evidence: { extracted: problems.join(' '), expected: 'Instant concepts at an instant; duration concepts over a duration.' },
            remediation: 'Re-map the flagged facts to a context whose period type matches the concept.',
            root_cause_key: 'xbrl-period-type',
          };
    }

    case 'fiscal_focus': {
      const yearFocus = context.cfm.dei_tags.DocumentFiscalYearFocus;
      const periodFocus = context.cfm.dei_tags.DocumentFiscalPeriodFocus;
      const period = periodEnd(context);
      const periodYear = period.slice(0, 4);
      const problems: string[] = [];
      if (!yearFocus) problems.push('dei:DocumentFiscalYearFocus is absent.');
      // A fiscal year ending in January legitimately carries the prior year's
      // focus, so a one-year gap is tolerated and a wider one is not.
      else if (Math.abs(Number(yearFocus) - Number(periodYear)) > 1) {
        problems.push(`dei:DocumentFiscalYearFocus = ${yearFocus}, which is more than one year from the period ended ${period}.`);
      }
      if (!periodFocus) problems.push('dei:DocumentFiscalPeriodFocus is absent.');
      else if (!context.cfm.submission.form_type.startsWith('10-Q') && periodFocus.toUpperCase() !== 'FY') {
        problems.push(`dei:DocumentFiscalPeriodFocus = ${periodFocus} on an annual report.`);
      }
      return problems.length === 0
        ? PASS(`Fiscal focus FY${yearFocus} / ${periodFocus} agrees with the period ended ${period}.`, 'Fiscal focus agrees with the period of report.')
        : {
            status: 'fail',
            evidence: { extracted: problems.join(' '), expected: `Fiscal year and period focus consistent with the period ended ${period}.` },
            remediation: 'Correct the fiscal focus cover tags.',
            root_cause_key: 'dei:DocumentFiscalYearFocus',
          };
    }

    case 'amendment_flag': {
      const flag = (context.cfm.dei_tags.AmendmentFlag || '').toLowerCase();
      const isAmendment = context.cfm.submission.form_type.endsWith('/A');
      if (!flag) {
        return {
          status: 'fail',
          evidence: { extracted: 'dei:AmendmentFlag is absent.', expected: `dei:AmendmentFlag = ${isAmendment}.` },
          remediation: 'Tag dei:AmendmentFlag on the cover page.',
          root_cause_key: 'dei:AmendmentFlag',
        };
      }
      const flagTrue = flag === 'true' || flag === '1' || flag === 'yes';
      return flagTrue === isAmendment
        ? PASS(`dei:AmendmentFlag = ${flag} matches the submission form type ${context.cfm.submission.form_type}.`, 'Amendment flag matches the form type.')
        : {
            status: 'fail',
            evidence: {
              extracted: `dei:AmendmentFlag = ${flag} on a submission typed ${context.cfm.submission.form_type}.`,
              expected: `dei:AmendmentFlag = ${isAmendment}.`,
            },
            remediation: 'Set the amendment flag to match the submission form type.',
            root_cause_key: 'dei:AmendmentFlag',
          };
    }

    case 'cover_fully_tagged': {
      const missing = REQUIRED_COVER_TAGS.filter(tag => !context.cfm.dei_tags[tag]);
      return missing.length === 0
        ? PASS(`All ${REQUIRED_COVER_TAGS.length} required cover-page tags are present.`, 'Cover page fully tagged.')
        : {
            status: 'fail',
            evidence: {
              extracted: `${missing.length} required cover-page tag(s) absent: ${missing.map(tag => `dei:${tag}`).join(', ')}.`,
              expected: 'Every required cover-page item carries an inline tag.',
            },
            remediation: 'Tag the missing cover-page items and regenerate EX-104.',
            root_cause_key: 'cover-tagging',
          };
    }
  }
}

// ---------------------------------------------------------------------------
// Recomputation
// ---------------------------------------------------------------------------

function evaluateRecompute(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'recompute' }>,
): PredicateOutcome {
  // A `dei:`-prefixed target is a cover-page value, stated as of a date after
  // the period end, so it is read from the cover tags rather than selected by
  // reporting period.
  let targetValue: number | undefined;
  let targetLabel = spec.target[0];
  let targetProvenance: Provenance | undefined;

  const deiTarget = spec.target.find(concept => concept.startsWith('dei:'));
  if (deiTarget) {
    const raw = context.cfm.dei_tags[conceptLocalName(deiTarget)];
    const parsed = raw ? Number(raw.replace(/[,\s]/g, '')) : Number.NaN;
    if (Number.isFinite(parsed)) {
      targetValue = parsed;
      targetLabel = deiTarget;
    }
  } else {
    const targetFact = selectFact(context, spec.target);
    if (targetFact) {
      targetValue = targetFact.value as number;
      targetLabel = targetFact.concept;
      targetProvenance = targetFact.provenance;
    }
  }

  if (targetValue === undefined) {
    return NA(
      `${spec.label}: no consolidated value for ${spec.target.join(' / ')} was tagged for the period ended ${periodEnd(context)}.`,
    );
  }

  const resolved: Array<{ concept: string; value: number; sign: 1 | -1 }> = [];
  for (const term of spec.terms) {
    const fact = selectFact(context, term.concepts);
    if (!fact) {
      if (term.optional) continue;
      return NA(
        `${spec.label}: no consolidated value for ${term.concepts[0]} was tagged for the period ended ${periodEnd(context)}, so the relationship cannot be recomputed.`,
      );
    }
    resolved.push({ concept: fact.concept, value: fact.value as number, sign: term.sign });
  }

  let computed: number;
  let workings: string;
  if (spec.op === 'divide') {
    if (resolved.length < 2) return NA(`${spec.label}: numerator or denominator not tagged.`);
    const [numerator, denominator] = resolved;
    if (denominator.value === 0) return NA(`${spec.label}: denominator ${denominator.concept} is zero.`);
    computed = numerator.value / denominator.value;
    workings = `${numerator.concept} ${formatNumber(numerator.value)} ÷ ${denominator.concept} ${formatNumber(denominator.value)} = ${formatNumber(computed)}`;
  } else {
    computed = resolved.reduce((total, term) => total + term.sign * term.value, 0);
    workings = resolved
      .map((term, index) => `${index === 0 ? '' : term.sign === 1 ? '+ ' : '− '}${term.concept} ${formatNumber(Math.abs(term.value))}`)
      .join(' ') + ` = ${formatNumber(computed)}`;
  }

  const difference = targetValue - computed;
  if (withinTolerance(computed, targetValue, spec.tolerance)) {
    return PASS(
      `${spec.label}: ${targetLabel} ${formatNumber(targetValue)} recomputes as ${workings}.`,
      `${targetLabel} equals the recomputed value within tolerance.`,
      targetProvenance,
    );
  }

  return {
    status: 'fail',
    evidence: {
      extracted: `${targetLabel} is reported as ${formatNumber(targetValue)}; recomputation gives ${formatNumber(computed)} (${workings}). Difference ${formatNumber(difference)}.`,
      expected: `${targetLabel} within ${(spec.tolerance.relative * 100).toFixed(2)}% (floor ${formatNumber(spec.tolerance.absolute)}) of the recomputed value.`,
      location: targetProvenance ? toLocation(targetProvenance) : undefined,
    },
    remediation: `Reconcile ${targetLabel} to its components. Where the reported figure is right, the tagging of one component is not.`,
    // Every rule that consumes the same reported figure groups here, so one
    // wrong input surfaces once with its symptoms attached (§7.2).
    root_cause_key: `fact:${conceptLocalName(targetLabel)}`,
  };
}

// ---------------------------------------------------------------------------
// Disclosure predicates
// ---------------------------------------------------------------------------

function findSections(context: PredicateContext, items: string[]) {
  const wanted = new Set(items.map(item => item.toUpperCase()));
  return context.cfm.sections.filter(section => wanted.has(section.item_ref.toUpperCase()));
}

function evaluateSectionPresent(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'section_present' }>,
  binding: RuleBinding,
): PredicateOutcome {
  const requirement = resolveRequirement(spec.requirement, context);
  if (requirement === 'not_required') return NA(`${spec.label} is not required for this registrant.`);

  const sections = findSections(context, spec.items);
  if (sections.length === 0) {
    if (requirement === 'unresolved') {
      return {
        status: 'unresolved',
        severity: binding.unresolved_severity ?? 'low',
        blocking: false,
        title: `Confirm whether ${spec.label} is required`,
        description: spec.requirement.kind === 'conditional' ? spec.requirement.question : '',
        evidence: { extracted: `No Item ${spec.items.join(' or ')} heading was located.`, expected: `${spec.label} where required.` },
        root_cause_key: `section:${spec.items[0]}`,
      };
    }
    return {
      status: 'fail',
      evidence: {
        extracted: `No Item ${spec.items.join(' or ')} heading was located in the primary document.`,
        expected: `${spec.label} present in the filing.`,
      },
      remediation: `Add ${spec.label} to the filing, or state the permitted omission explicitly.`,
      root_cause_key: `section:${spec.items[0]}`,
    };
  }

  const best = sections.reduce((longest, section) =>
    section.text.length > longest.text.length ? section : longest,
  );
  const tokens = tokenise(best.text).length;
  if (tokens >= spec.min_tokens) {
    return PASS(
      `Item ${best.item_ref} present with ${tokens.toLocaleString()} words.`,
      `${spec.label} present with substantive content.`,
      { artifact: context.cfm.primary_document.name, basis: 'text', char_start: best.char_start, char_end: best.char_end, url: context.cfm.primary_document.url },
    );
  }
  return {
    status: 'fail',
    evidence: {
      extracted: `Item ${best.item_ref} contains ${tokens} word(s), below the ${spec.min_tokens}-word threshold for substantive content. Text reads: “${best.text.slice(0, 200).trim()}”.`,
      expected: `${spec.label} with substantive content, or an explicit statement of the permitted omission.`,
      location: { artifact: context.cfm.primary_document.name, char_start: best.char_start, char_end: best.char_end, url: context.cfm.primary_document.url },
    },
    remediation: `Complete ${spec.label}, or state the basis on which it is omitted.`,
    root_cause_key: `section:${best.item_ref}`,
  };
}

function evaluateSectionConclusion(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'section_conclusion' }>,
  binding: RuleBinding,
): PredicateOutcome {
  const requirement = resolveRequirement(spec.requirement, context);
  if (requirement === 'not_required') return NA(`${spec.label} is not required for this registrant.`);

  const sections = findSections(context, spec.items);
  const scope = spec.scope ?? 'document';
  if (scope === 'section' && sections.length === 0) {
    return NA(`No Item ${spec.items.join(' / ')} heading was located, so ${spec.label} could not be tested in place.`);
  }

  const haystacks: Array<{ label: string; text: string; start: number }> =
    scope === 'section'
      ? sections.map(section => ({ label: `Item ${section.item_ref}`, text: section.text, start: section.char_start }))
      : [
          ...sections.map(section => ({ label: `Item ${section.item_ref}`, text: section.text, start: section.char_start })),
          { label: 'the filing', text: context.primaryText, start: 0 },
        ];

  for (const haystack of haystacks) {
    const normalised = normaliseText(haystack.text);
    for (const pattern of spec.patterns) {
      const expression = new RegExp(normaliseText(pattern), 'i');
      const match = expression.exec(normalised);
      if (!match) continue;
      return PASS(
        `${spec.label} located in ${haystack.label} (“${match[0].slice(0, 120)}”).`,
        `${spec.label} present.`,
        {
          artifact: context.cfm.primary_document.name,
          basis: 'text',
          char_start: haystack.start,
          char_end: haystack.start + Math.min(haystack.text.length, 4_000),
          url: context.cfm.primary_document.url,
        },
      );
    }
  }

  const searched = scope === 'section' ? `Item ${spec.items.join(' / ')}` : 'the whole filing';
  if (requirement === 'unresolved') {
    return {
      status: 'unresolved',
      severity: binding.unresolved_severity ?? 'medium',
      blocking: false,
      title: `Confirm whether ${spec.label} is required`,
      description: spec.requirement.kind === 'conditional' ? spec.requirement.question : '',
      remediation: `Confirm the condition; where it is met, add ${spec.label}.`,
      evidence: {
        extracted: `${spec.label} was not located in ${searched}.`,
        expected: `${spec.label} where the condition is met.`,
      },
      root_cause_key: `disclosure:${spec.label}`,
    };
  }

  return {
    status: 'fail',
    evidence: {
      // The raw patterns are matching expressions, not prose. Echoing them puts
      // regex fragments in a preparer's worklist and, where a pattern quotes a
      // standard audit-report phrase, puts that phrase in the engine's own
      // output — which is precisely what GR-1 exists to prevent.
      extracted: `${spec.label} was not located in ${searched}. ${spec.patterns.length} recognised form(s) of the required wording were tested for.`,
      expected: `${spec.label} present in the filing.`,
    },
    remediation: `Add ${spec.label}, using the language the requirement prescribes.`,
    root_cause_key: `disclosure:${spec.label}`,
  };
}

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

function evaluatePriorPeriodDiff(
  context: PredicateContext,
  spec: Extract<PredicateSpec, { predicate: 'prior_period_diff' }>,
): PredicateOutcome {
  if (!context.priorAccession || context.priorFacts.length === 0) {
    return NA('No prior annual report or prior-period facts were available for comparison.');
  }

  const wanted = new Set(spec.concepts.map(conceptLocalName));
  // "As originally reported" means the value the prior filing itself carried,
  // identified by that filing's accession — not the value as later revised.
  const original = new Map<string, { value: number; end: string }>();
  for (const fact of context.priorFacts) {
    if (fact.accession !== context.priorAccession) continue;
    if (!wanted.has(fact.concept)) continue;
    const key = `${fact.concept}|${fact.end}`;
    if (!original.has(key)) original.set(key, { value: fact.value, end: fact.end });
  }
  if (original.size === 0) {
    return NA(`The prior annual report (${context.priorAccession}) reported none of the compared concepts.`);
  }

  const differences: string[] = [];
  let compared = 0;
  for (const fact of context.cfm.facts) {
    if (typeof fact.value !== 'number') continue;
    const local = conceptLocalName(fact.concept);
    if (!wanted.has(local)) continue;
    const ixbrlContext = fact.context_ref ? context.instance.contexts.get(fact.context_ref) : undefined;
    if (!ixbrlContext || ixbrlContext.dimensions.length > 0) continue;
    const end = fact.period_end;
    if (!end || end >= periodEnd(context)) continue;
    const prior = original.get(`${local}|${end}`);
    if (!prior) continue;
    compared += 1;
    if (!withinTolerance(fact.value, prior.value, spec.tolerance)) {
      differences.push(
        `${local} for the period ended ${end}: reported now as ${formatNumber(fact.value)}, originally reported as ${formatNumber(prior.value)} (difference ${formatNumber(fact.value - prior.value)}).`,
      );
    }
  }

  if (compared === 0) {
    return NA('No comparative figures could be matched to amounts as originally reported.');
  }
  if (differences.length === 0) {
    return PASS(
      `${compared} comparative figure(s) agree with the amounts originally reported in ${context.priorAccession}.`,
      'Comparatives agree with amounts as originally reported.',
    );
  }
  return {
    status: 'fail',
    evidence: {
      extracted: differences.slice(0, 5).join(' '),
      expected: `Comparative figures equal to the amounts reported in ${context.priorAccession}, or a restatement or reclassification note explaining the change.`,
    },
    remediation: 'Where the change is intended, add the restatement or reclassification disclosure. Where it is not, restate the comparative to the amount originally reported.',
    root_cause_key: 'continuity:comparatives',
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function evaluatePredicate(binding: RuleBinding, context: PredicateContext): PredicateOutcome {
  switch (binding.predicate) {
    case 'exhibit_present':
      return evaluateExhibitPresent(context, binding, binding);
    case 'exhibit_index_resolves':
      return evaluateExhibitIndexResolves(context);
    case 'exhibit_classification':
      return evaluateExhibitClassification(context);
    case 'certification_text_conforms':
      return evaluateCertificationText(context, binding);
    case 'certification_cross_reference':
      return evaluateCertificationCrossReference(context, binding);
    case 'signature_block':
      return evaluateSignatureBlock(context, binding, binding);
    case 'cover_field':
      return evaluateCoverField(context, binding);
    case 'dei_tag_present':
      return context.cfm.dei_tags[binding.tag]
        ? PASS(`dei:${binding.tag} = “${context.cfm.dei_tags[binding.tag]}”.`, `dei:${binding.tag} present.`)
        : {
            status: 'fail',
            evidence: {
              extracted: `The cover tag dei:${binding.tag} is absent from the inline XBRL.`,
              expected: `dei:${binding.tag} present and well-formed.`,
            },
            remediation: `Tag the cover-page item with dei:${binding.tag}.`,
            root_cause_key: `dei:${binding.tag}`,
          };
    case 'dei_tag_consistent':
      return evaluateTagAgainstReference(context, binding.tag, binding.reference, REFERENCE_LABELS[binding.reference]);
    case 'header_matches':
      return evaluateTagAgainstReference(context, binding.dei_tags[0], binding.reference, REFERENCE_LABELS[binding.reference]);
    case 'xbrl_structural':
      return evaluateXbrlStructural(context, binding);
    case 'recompute':
      return evaluateRecompute(context, binding);
    case 'section_present':
      return evaluateSectionPresent(context, binding, binding);
    case 'section_conclusion':
      return evaluateSectionConclusion(context, binding, binding);
    case 'prior_period_diff':
      return evaluatePriorPeriodDiff(context, binding);
    case 'unbound':
      return NA(binding.reason);
  }
}
