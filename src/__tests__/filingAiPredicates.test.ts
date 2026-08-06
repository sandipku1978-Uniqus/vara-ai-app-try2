/**
 * The predicate library.
 *
 * Each test asserts the same three things about a rule: that a well-formed
 * filing passes, that the specific defect fails, and — where the requirement is
 * conditional — that an unresolvable condition produces a question rather than
 * a defect. The last of these is the one that decides whether the product gets
 * used twice: an engine that reports "Exhibit 21.1 missing" on every filer that
 * happens to have no subsidiaries is an engine nobody opens again.
 */

import { describe, expect, it } from 'vitest';

import { getBinding, RULE_BINDINGS } from '../lib/filing-ai/bindings';
import { evaluatePredicate, type PredicateContext } from '../lib/filing-ai/predicates';
import { loadCatalog } from '../lib/filing-ai/catalog';
import {
  certificationHtml,
  financialOfficerCertificationHtml,
  FIXTURE_CIK,
  primaryDocumentHtml,
  section1350Html,
  submissionDocuments,
  type FixtureOptions,
} from './fixtures/filing-ai-10k';
import { normalize } from '../lib/filing-ai/normalize';
import { extractDocumentTextFromHtmlServer } from '../lib/filingTextServer';
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

function buildContext(options: FixtureOptions = {}): PredicateContext {
  const html = primaryDocumentHtml(options);
  const documents = submissionDocuments(options);
  const submission: SubmissionHeader = {
    form_type: '10-K',
    period_of_report: '2025-12-31',
    filer_cik: FIXTURE_CIK,
    file_number: '001-38856',
    accession: '0001234567-26-000011',
    filing_date: '2026-02-20',
    is_xbrl: true,
    is_inline_xbrl: true,
    document_names: documents.map(document => document.name),
    documents,
  };
  const { cfm, instance, primaryText } = normalize({
    runId: 'run_fixture',
    primary: {
      name: 'mrdn-20251231.htm',
      url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/mrdn-20251231.htm',
      html,
      bytes: html.length,
      sha256: 'fixture',
    },
    filingIndex: { accession: submission.accession, accessionCompact: '000123456726000011', documents },
    submission,
    entity,
  });

  return {
    cfm,
    instance,
    entity,
    primaryText,
    certifications: [
      {
        exhibit: '31.1',
        name: 'ex-311.htm',
        url: 'https://example.invalid/ex-311.htm',
        text: extractDocumentTextFromHtmlServer(certificationHtml(options)),
      },
      {
        exhibit: '31.2',
        name: 'ex-312.htm',
        url: 'https://example.invalid/ex-312.htm',
        text: extractDocumentTextFromHtmlServer(financialOfficerCertificationHtml()),
      },
      {
        exhibit: '32.1',
        name: 'ex-321.htm',
        url: 'https://example.invalid/ex-321.htm',
        text: extractDocumentTextFromHtmlServer(section1350Html()),
      },
    ],
    priorFacts: [],
    priorAccession: null,
  };
}

const clean = buildContext();

function run(ruleId: string, context: PredicateContext = clean) {
  return evaluatePredicate(RULE_BINDINGS[ruleId], context);
}

describe('exhibit predicates', () => {
  it('passes when a mandatory exhibit is submitted', () => {
    expect(run('R-MECH-EXH-010').status).toBe('pass'); // EX-31.1
    expect(run('R-MECH-EXH-012').status).toBe('pass'); // EX-32
  });

  it('fails when a mandatory exhibit is absent', () => {
    const outcome = run('R-MECH-EXH-005', buildContext({ dropExhibit19: true }));
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/EX-19/);
  });

  it('asks rather than accuses when the requirement condition is unresolvable', () => {
    // Exhibit 21.1 is required unless the registrant has no subsidiaries, which
    // the filing package cannot answer.
    const outcome = run('R-MECH-EXH-006', buildContext());
    expect(['pass', 'unresolved']).toContain(outcome.status);

    const withoutSubsidiaries = buildContext();
    withoutSubsidiaries.cfm.exhibits = withoutSubsidiaries.cfm.exhibits.filter(
      exhibit => !exhibit.number.startsWith('21'),
    );
    const asked = evaluatePredicate(RULE_BINDINGS['R-MECH-EXH-006'], withoutSubsidiaries);
    expect(asked.status).toBe('unresolved');
    expect(asked.blocking).toBe(false);
    expect(asked.severity).toBe('medium');
    expect(asked.description).toMatch(/subsidiaries/i);
  });

  it('accepts incorporation by reference where Item 601 permits it', () => {
    // Exhibit 3.1 is carried by reference in the fixture's printed index.
    expect(run('R-MECH-EXH-001').status).toBe('pass');
  });

  it('does not require an exhibit that is conditional on being listed', () => {
    const unlisted = buildContext();
    unlisted.entity.exchanges = [];
    unlisted.cfm.dei_tags = { ...unlisted.cfm.dei_tags, SecurityExchangeName: '', Security12bTitle: '' };
    unlisted.cfm.exhibits = unlisted.cfm.exhibits.filter(exhibit => !exhibit.number.startsWith('97'));
    expect(evaluatePredicate(RULE_BINDINGS['R-MECH-EXH-014'], unlisted).status).toBe('not_applicable');
  });

  it('reports index rows that resolve to nothing', () => {
    expect(run('R-MECH-EXH-100').status).toBe('pass');

    const broken = buildContext();
    broken.cfm.exhibits.push({
      number: '10.9',
      type: 'Printed index row 10.9',
      description: 'Employment agreement',
      attached: false,
      filed_or_furnished: 'filed',
      resolved: false,
    });
    const outcome = evaluatePredicate(RULE_BINDINGS['R-MECH-EXH-100'], broken);
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/10\.9/);
  });
});

describe('certification predicates', () => {
  it('passes prescribed Item 601(b)(31) wording', () => {
    for (const ruleId of ['R-MECH-CRT-001', 'R-MECH-CRT-002', 'R-MECH-CRT-003', 'R-MECH-CRT-004', 'R-MECH-CRT-005', 'R-MECH-CRT-006']) {
      expect(run(ruleId).status, ruleId).toBe('pass');
    }
  });

  it('flags a rewritten paragraph 2', () => {
    const outcome = run('R-MECH-CRT-002', buildContext({ defectiveCertification: true }));
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/paragraph 2/i);
  });

  it('leaves the wording rules unevaluated when no certification was retrieved', () => {
    // The missing-exhibit rule owns that defect; reporting it twice would put
    // one root cause in the worklist under two headings.
    const withoutCertifications = { ...clean, certifications: [] };
    expect(evaluatePredicate(RULE_BINDINGS['R-MECH-CRT-002'], withoutCertifications).status).toBe('not_applicable');
  });

  it('matches certifying officers to the signature page', () => {
    expect(run('R-MECH-CRT-010').status).toBe('pass');

    const mismatched = buildContext();
    mismatched.certifications = mismatched.certifications.map(certification =>
      certification.exhibit === '31.1'
        ? { ...certification, text: certification.text.replace(/Dana Whitfield/g, 'Rowan Ellis') }
        : certification,
    );
    expect(evaluatePredicate(RULE_BINDINGS['R-MECH-CRT-010'], mismatched).status).toBe('fail');
  });

  it('checks the report and period named inside the certification', () => {
    expect(run('R-MECH-CRT-012').status).toBe('pass');
    expect(run('R-MECH-CRT-014').status).toBe('pass');
  });

  it('rejects a certification dated before the period end', () => {
    const backdated = buildContext();
    backdated.certifications = backdated.certifications.map(certification => ({
      ...certification,
      text: certification.text.replace(/February 20, 2026/g, 'November 3, 2025'),
    }));
    const outcome = evaluatePredicate(RULE_BINDINGS['R-MECH-CRT-013'], backdated);
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/before the period end/i);
  });
});

describe('signature predicates', () => {
  it('finds the principal officers on the signature page', () => {
    expect(run('R-MECH-SIG-001').status).toBe('pass');
    expect(run('R-MECH-SIG-004').status).toBe('pass');
    expect(run('R-MECH-SIG-005').status).toBe('pass');
    expect(run('R-MECH-SIG-006').status).toBe('pass');
    expect(run('R-MECH-SIG-008').status).toBe('pass');
  });

  it('flags a missing signature page', () => {
    expect(run('R-MECH-SIG-001', buildContext({ dropSignatures: true })).status).toBe('fail');
  });

  it('flags a missing principal financial officer signature', () => {
    const context = buildContext();
    context.cfm.signatures = context.cfm.signatures.filter(
      signature => !/financial/i.test(signature.title),
    );
    expect(evaluatePredicate(RULE_BINDINGS['R-MECH-SIG-005'], context).status).toBe('fail');
  });

  it('asks about board majority rather than asserting it', () => {
    // Board size is not in the filing package, so "a majority signed" cannot be
    // determined — only that directors signed at all.
    const outcome = run('R-MECH-SIG-007');
    expect(outcome.status).toBe('unresolved');
    expect(outcome.blocking).toBe(false);
  });

  it('flags an annual report no director signed', () => {
    const context = buildContext();
    context.cfm.signatures = context.cfm.signatures.filter(signature => !/director/i.test(signature.title));
    expect(evaluatePredicate(RULE_BINDINGS['R-MECH-SIG-007'], context).status).toBe('fail');
  });
});

describe('cover page and header predicates', () => {
  it('agrees the cover tags with the submission and entity reference data', () => {
    for (const ruleId of ['R-MECH-COV-001', 'R-MECH-COV-002', 'R-MECH-HDR-003', 'R-MECH-HDR-004', 'R-MECH-HDR-005']) {
      expect(run(ruleId).status, ruleId).toBe('pass');
    }
  });

  it('flags a cover period that disagrees with the submission', () => {
    const outcome = run('R-MECH-COV-002', buildContext({ coverPeriodMismatch: true }));
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/2025-09-30/);
  });

  it('normalises file numbers before comparing them', () => {
    const context = buildContext();
    context.cfm.dei_tags = { ...context.cfm.dei_tags, EntityFileNumber: '1-38856' };
    expect(evaluatePredicate(RULE_BINDINGS['R-MECH-HDR-004'], context).status).toBe('pass');
  });

  it('tolerates legal-name suffix differences but not a different company', () => {
    const context = buildContext();
    context.cfm.dei_tags = { ...context.cfm.dei_tags, EntityRegistrantName: 'Meridian Industries Inc' };
    expect(evaluatePredicate(RULE_BINDINGS['R-XBRL-DEI-005'], context).status).toBe('pass');

    context.cfm.dei_tags = { ...context.cfm.dei_tags, EntityRegistrantName: 'Northwind Logistics, Inc.' };
    expect(evaluatePredicate(RULE_BINDINGS['R-XBRL-DEI-005'], context).status).toBe('fail');
  });

  it('degrades to a presence test when no independent reference exists, and says so', () => {
    // Shell-company status is not published in the entity reference data, so a
    // consistency claim would be unfounded.
    const outcome = run('R-XBRL-DEI-010');
    expect(outcome.status).toBe('pass');
    expect(outcome.evidence.extracted).toMatch(/only presence and well-formedness were tested/i);
  });

  it('flags an absent cover tag', () => {
    const context = buildContext();
    context.cfm.dei_tags = { ...context.cfm.dei_tags, EntityFilerCategory: '' };
    expect(evaluatePredicate(RULE_BINDINGS['R-MECH-COV-009'], context).status).toBe('fail');
  });
});

describe('structured data predicates', () => {
  it('passes a well-formed instance', () => {
    for (const ruleId of ['R-XBRL-STR-001', 'R-XBRL-STR-002', 'R-XBRL-STR-005', 'R-XBRL-STR-009', 'R-XBRL-STR-010', 'R-XBRL-STR-011', 'R-XBRL-STR-015']) {
      expect(run(ruleId).status, ruleId).toBe('pass');
    }
  });

  it('flags a fact whose context does not resolve', () => {
    const context = buildContext();
    context.cfm.facts[0] = { ...context.cfm.facts[0], context_ref: 'c-does-not-exist' };
    expect(evaluatePredicate(RULE_BINDINGS['R-XBRL-STR-002'], context).status).toBe('fail');
  });

  it('flags a natural-positive concept tagged negative', () => {
    const context = buildContext();
    const assets = context.cfm.facts.findIndex(
      fact => fact.concept === 'us-gaap:Assets' && fact.context_ref === 'c-instant',
    );
    context.cfm.facts[assets] = { ...context.cfm.facts[assets], value: -5_200_000 };
    const outcome = evaluatePredicate(RULE_BINDINGS['R-XBRL-STR-005'], context);
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/Assets/);
  });

  it('flags an amendment flag that disagrees with the form type', () => {
    const context = buildContext();
    context.cfm.dei_tags = { ...context.cfm.dei_tags, AmendmentFlag: 'true' };
    expect(evaluatePredicate(RULE_BINDINGS['R-XBRL-STR-011'], context).status).toBe('fail');
  });

  it('flags a missing required cover tag', () => {
    const context = buildContext();
    context.cfm.dei_tags = { ...context.cfm.dei_tags, DocumentFiscalPeriodFocus: '' };
    const outcome = evaluatePredicate(RULE_BINDINGS['R-XBRL-STR-015'], context);
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/DocumentFiscalPeriodFocus/);
  });
});

describe('recomputation predicates', () => {
  it('recomputes the balance sheet from consolidated facts', () => {
    expect(run('R-CONS-005').status).toBe('pass');
    expect(run('R-CONS-006').status).toBe('pass');
    expect(run('R-CONS-004').status).toBe('pass');
  });

  it('flags a balance sheet that does not balance', () => {
    const outcome = run('R-CONS-005', buildContext({ breakBalanceSheet: true }));
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/4,100,000/);
    // Every rule reading the same reported figure groups under one root cause.
    expect(outcome.root_cause_key).toBe('fact:Assets');
  });

  it('ignores dimensional facts when recomputing', () => {
    // The fixture tags segment assets of 1,800,000 alongside consolidated
    // assets of 5,200,000. Mixing them would break the balance sheet.
    expect(run('R-CONS-005').status).toBe('pass');
  });

  it('absorbs presentation rounding rather than reporting it', () => {
    const context = buildContext();
    const index = context.cfm.facts.findIndex(
      fact => fact.concept === 'us-gaap:Assets' && fact.context_ref === 'c-instant',
    );
    context.cfm.facts[index] = { ...context.cfm.facts[index], value: 5_200_400 };
    expect(evaluatePredicate(RULE_BINDINGS['R-CONS-005'], context).status).toBe('pass');
  });

  it('recomputes earnings per share', () => {
    expect(run('R-CONS-001').status).toBe('pass');
  });

  it('does not evaluate a relationship whose components were never tagged', () => {
    // Absent facts must not read as a pass; the rule is subtracted from coverage.
    expect(run('R-CONS-007').status).toBe('not_applicable');
    expect(run('R-CONS-020').status).toBe('not_applicable');
  });
});

describe('disclosure predicates', () => {
  it('finds the required items in a complete filing', () => {
    for (const ruleId of [
      'R-DISC-001', 'R-DISC-002', 'R-DISC-003', 'R-DISC-005', 'R-DISC-006', 'R-DISC-008',
      'R-DISC-009', 'R-DISC-010', 'R-DISC-011', 'R-DISC-013', 'R-DISC-014', 'R-DISC-015',
      'R-DISC-016', 'R-DISC-017', 'R-DISC-018', 'R-DISC-020', 'R-DISC-021', 'R-DISC-022',
      'R-DISC-023', 'R-DISC-024', 'R-DISC-025', 'R-DISC-026', 'R-DISC-027', 'R-DISC-028', 'R-DISC-029',
    ]) {
      expect(run(ruleId).status, ruleId).toBe('pass');
    }
  });

  it('flags an Item 9A with no explicit controls conclusion', () => {
    const outcome = run('R-DISC-001', buildContext({ dropControlsConclusion: true }));
    expect(outcome.status).toBe('fail');
  });

  it('treats Part III forward incorporation as expected behaviour, not a defect', () => {
    // Flagging this would fire on a large share of legitimate 10-Ks.
    expect(run('R-DISC-016').status).toBe('pass');
  });

  it('does not require the ICFR attestation from a non-accelerated filer', () => {
    const context = buildContext();
    context.cfm.dei_tags = { ...context.cfm.dei_tags, EntityFilerCategory: 'Non-accelerated Filer' };
    context.entity.filer_status = 'non_accelerated';
    expect(evaluatePredicate(RULE_BINDINGS['R-DISC-003'], context).status).toBe('not_applicable');
  });

  it('confines a section-scoped rule to its item', () => {
    // "incorporated by reference" appears in the exhibit index of nearly every
    // filing; a document-wide search would pass Part III unconditionally.
    const context = buildContext();
    context.cfm.sections = context.cfm.sections.filter(
      section => !['10', '11', '12', '13', '14'].includes(section.item_ref),
    );
    expect(evaluatePredicate(RULE_BINDINGS['R-DISC-016'], context).status).toBe('not_applicable');
  });

  it('flags an empty required item', () => {
    const context = buildContext();
    context.cfm.sections = context.cfm.sections.map(section =>
      section.item_ref === '1A' ? { ...section, text: 'Item 1A. Risk Factors. None.' } : section,
    );
    const outcome = evaluatePredicate(RULE_BINDINGS['R-DISC-006'], context);
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/below the 200-word threshold/);
  });
});

describe('continuity predicate', () => {
  it('does not evaluate without a prior filing to compare against', () => {
    expect(run('R-CONT-001').status).toBe('not_applicable');
  });

  it('flags a comparative that changed from the amount originally reported', () => {
    const context = buildContext();
    context.priorAccession = '0001234567-25-000009';
    context.priorFacts = [
      {
        concept: 'Assets',
        value: 4_800_000,
        unit: 'USD',
        end: '2024-12-31',
        form: '10-K',
        accession: '0001234567-25-000009',
        filed: '2025-02-19',
      },
    ];
    context.cfm.facts.push({
      concept: 'us-gaap:Assets',
      value: 4_500_000,
      period_end: '2024-12-31',
      context_ref: 'c-instant-prior',
      source: 'ixbrl',
      provenance: { artifact: 'mrdn-20251231.htm', basis: 'html', char_start: 0, char_end: 10 },
    });
    context.instance.contexts.set('c-instant-prior', {
      id: 'c-instant-prior',
      instant: '2024-12-31',
      dimensions: [],
    });

    const outcome = evaluatePredicate(RULE_BINDINGS['R-CONT-001'], context);
    expect(outcome.status).toBe('fail');
    expect(outcome.evidence.extracted).toMatch(/originally reported as 4,800,000/);
  });
});

describe('binding coverage', () => {
  it('resolves a binding for every rule in the catalog', () => {
    for (const rule of loadCatalog().rules) {
      expect(getBinding(rule.rule_id, rule.layer, rule.build_wave), rule.rule_id).toBeDefined();
    }
  });

  it('gives every unbound rule a stated reason', () => {
    for (const rule of loadCatalog().rules) {
      const binding = getBinding(rule.rule_id, rule.layer, rule.build_wave);
      if (binding.predicate !== 'unbound') continue;
      expect(binding.reason.length, rule.rule_id).toBeGreaterThan(20);
    }
  });

  it('deploys a predicate for a majority of the P0 catalog', () => {
    const p0 = loadCatalog().rules.filter(rule => rule.build_wave === 'P0');
    const bound = p0.filter(rule => getBinding(rule.rule_id, rule.layer, rule.build_wave).predicate !== 'unbound');
    expect(bound.length / p0.length).toBeGreaterThan(0.7);
  });
});
