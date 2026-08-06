/**
 * Rule → predicate bindings.
 *
 * The catalog says *what* a rule tests and on whose authority. This file says
 * *how* it is evaluated: which predicate runs and with what parameters. Keeping
 * the two apart is what lets the rule board amend a rule's scope, severity or
 * effective date without a deploy, and lets engineering change an
 * implementation without re-opening a governed rule.
 *
 * A rule bound to `unbound` is not a rule that passes. It is a rule this build
 * cannot evaluate, and it is subtracted from coverage and named in the coverage
 * statement — the honest version of a gap.
 */

import type { Severity } from './types';

/** Whether a conditionally-required item is actually required for this filing. */
export type Requirement =
  /** Required on every filing in scope. */
  | { kind: 'always' }
  /** Required where a class of securities is registered under Section 12(b). */
  | { kind: 'if_listed' }
  /** ICFR auditor attestation: accelerated and large accelerated filers only. */
  | { kind: 'if_accelerated' }
  /** Not resolvable from the inputs at this tier — see `question`. */
  | { kind: 'conditional'; question: string };

export interface Tolerance {
  /** Fraction of the larger operand. Absorbs presentation rounding (§5.4). */
  relative: number;
  /** Floor in reported units, so small balances are not held to a hairline. */
  absolute: number;
}

export interface FormulaTerm {
  /** Candidate concepts, first match wins — taxonomies differ across filers. */
  concepts: string[];
  sign: 1 | -1;
  /** A missing optional term contributes zero rather than voiding the rule. */
  optional?: boolean;
}

/** Named reference values a cover tag can be tested against. */
export type ReferenceKey =
  | 'submission.form_type'
  | 'submission.period_of_report'
  | 'submission.filer_cik'
  | 'submission.file_number'
  | 'entity.legal_name'
  | 'entity.filer_status'
  | 'entity.state_of_incorporation'
  | 'entity.ein'
  | 'entity.is_shell'
  | 'entity.fiscal_year_end'
  | 'entity.exchanges'
  | 'entity.tickers'
  | 'submission.is_amendment';

export type XbrlStructuralCheck =
  | 'instance_attached'
  | 'context_resolves'
  | 'unit_and_decimals'
  | 'negative_plausibility'
  | 'period_type'
  | 'fiscal_focus'
  | 'amendment_flag'
  | 'cover_fully_tagged';

export type SignatureCheck =
  | 'present'
  | 'registrant_name'
  | 'conformed_format'
  | 'peo_signed'
  | 'pfo_signed'
  | 'pao_signed'
  | 'board_majority'
  | 'dates_present';

export type CertificationCrossCheck =
  | 'officer_names'
  | 'officer_titles'
  | 'period_and_form'
  | 'dated'
  | 'ex32_reference';

export type PredicateSpec =
  | { predicate: 'exhibit_present'; exhibit: string; requirement: Requirement }
  | { predicate: 'exhibit_index_resolves' }
  | { predicate: 'exhibit_classification' }
  | {
      predicate: 'certification_text_conforms';
      /** Which prescribed paragraph of Item 601(b)(31) this rule covers. */
      paragraph: string;
      /** Phrases that must survive a token-level diff of the certification. */
      phrases: string[];
      /** How many must appear before the paragraph is treated as conforming. */
      min_match: number;
    }
  | { predicate: 'certification_cross_reference'; check: CertificationCrossCheck }
  | { predicate: 'signature_block'; check: SignatureCheck; requirement?: Requirement }
  | {
      predicate: 'cover_field';
      label: string;
      dei_tags: string[];
      /** Fallback cover-page patterns when the value is not inline-tagged. */
      patterns?: string[];
      requirement: Requirement;
    }
  | { predicate: 'dei_tag_present'; tag: string; requirement: Requirement }
  | { predicate: 'dei_tag_consistent'; tag: string; reference: ReferenceKey }
  | { predicate: 'header_matches'; label: string; reference: ReferenceKey; dei_tags: string[] }
  | { predicate: 'xbrl_structural'; check: XbrlStructuralCheck }
  | {
      predicate: 'recompute';
      label: string;
      op: 'sum' | 'divide';
      target: string[];
      terms: FormulaTerm[];
      tolerance: Tolerance;
    }
  | {
      predicate: 'section_present';
      label: string;
      items: string[];
      min_tokens: number;
      requirement: Requirement;
    }
  | {
      predicate: 'section_conclusion';
      label: string;
      items: string[];
      /** Any one pattern satisfies the rule; absence of all of them is the flag. */
      patterns: string[];
      requirement: Requirement;
      /**
       * `section` confines the search to the named items — required where a
       * generic phrase would match elsewhere in the filing ("incorporated by
       * reference" appears in every exhibit index). `document` searches the
       * whole filing, which is correct for content that legitimately sits
       * outside its item, such as an audit report reached from Item 8 by a
       * page reference. Defaults to `document`, the lower false-positive side.
       */
      scope?: 'section' | 'document';
    }
  | { predicate: 'prior_period_diff'; label: string; concepts: string[]; tolerance: Tolerance }
  | { predicate: 'unbound'; reason: string };

export type RuleBinding = PredicateSpec & {
  /** Severity floor when a conditional requirement could not be resolved. */
  unresolved_severity?: Severity;
};

const MONEY_TOLERANCE: Tolerance = { relative: 0.001, absolute: 1_000 };
const TIGHT_MONEY_TOLERANCE: Tolerance = { relative: 0.0005, absolute: 1_000 };
const PER_SHARE_TOLERANCE: Tolerance = { relative: 0.02, absolute: 0.011 };
/**
 * Cover-page share counts are stated as of a date after the period end, so a
 * legitimate issuance or buyback in that window moves them away from the
 * balance-sheet count. The band is wide enough to absorb ordinary equity
 * activity and still catch an order-of-magnitude tagging error.
 */
const SHARE_COUNT_TOLERANCE: Tolerance = { relative: 0.03, absolute: 10_000 };

// Prescribed Item 601(b)(31) wording, paragraph by paragraph. Matching is on
// normalised tokens, not exact strings — filers legitimately vary punctuation
// and line breaks, and flagging that would be noise, not a defect.
const CERT_P1 = ['i have reviewed this'];
const CERT_P2 = [
  'does not contain any untrue statement of a material fact',
  'omit to state a material fact necessary to make the statements made',
  'not misleading with respect to the period covered by this report',
];
const CERT_P3 = [
  'financial statements, and other financial information included in this report, fairly present in all material respects',
  'fairly present in all material respects the financial condition, results of operations and cash flows',
];
const CERT_P4 = [
  'responsible for establishing and maintaining disclosure controls and procedures',
  'internal control over financial reporting',
];
const CERT_P4_SUB = [
  'designed such disclosure controls and procedures, or caused such disclosure controls and procedures to be designed under our supervision',
  'designed such internal control over financial reporting, or caused such internal control over financial reporting to be designed under our supervision',
  'evaluated the effectiveness of the registrant’s disclosure controls and procedures',
  'disclosed in this report any change in the registrant’s internal control over financial reporting',
];
const CERT_P5 = [
  'all significant deficiencies and material weaknesses in the design or operation of internal control over financial reporting',
  'any fraud, whether or not material, that involves management or other employees who have a significant role',
];

const unbound = (reason: string): RuleBinding => ({ predicate: 'unbound', reason });

/**
 * Exhibit matrix. Conditionality is encoded explicitly: a naive
 * "always required" exhibit rule fires on legitimate filings and destroys trust
 * faster than any false negative (build spec §13.3).
 */
const EXHIBIT_BINDINGS: Record<string, RuleBinding> = {
  'R-MECH-EXH-001': {
    predicate: 'exhibit_present',
    exhibit: '3.1',
    requirement: { kind: 'conditional', question: 'Were the articles of incorporation amended during the period? If not, incorporation by reference is permitted.' },
    unresolved_severity: 'low',
  },
  'R-MECH-EXH-002': {
    predicate: 'exhibit_present',
    exhibit: '3.2',
    requirement: { kind: 'conditional', question: 'Were the bylaws amended during the period? If not, incorporation by reference is permitted.' },
    unresolved_severity: 'low',
  },
  'R-MECH-EXH-003': { predicate: 'exhibit_present', exhibit: '4.1', requirement: { kind: 'if_listed' } },
  'R-MECH-EXH-004': {
    predicate: 'exhibit_present',
    exhibit: '10',
    requirement: { kind: 'conditional', question: 'Does every material contract described in the filing appear in the exhibit index?' },
    unresolved_severity: 'low',
  },
  'R-MECH-EXH-005': { predicate: 'exhibit_present', exhibit: '19', requirement: { kind: 'always' } },
  'R-MECH-EXH-006': {
    predicate: 'exhibit_present',
    exhibit: '21',
    requirement: { kind: 'conditional', question: 'Does the registrant have subsidiaries? Exhibit 21.1 is required unless it has none.' },
    unresolved_severity: 'medium',
  },
  'R-MECH-EXH-007': {
    predicate: 'exhibit_present',
    exhibit: '22',
    requirement: { kind: 'conditional', question: 'Do any registered securities carry a subsidiary guarantor obligation? Exhibit 22 is required only where they do.' },
    unresolved_severity: 'low',
  },
  'R-MECH-EXH-008': {
    predicate: 'exhibit_present',
    exhibit: '23',
    requirement: { kind: 'conditional', question: 'Are the financial statements incorporated into an effective Securities Act registration statement? A consent is required where they are.' },
    unresolved_severity: 'high',
  },
  'R-MECH-EXH-009': {
    predicate: 'exhibit_present',
    exhibit: '24',
    requirement: { kind: 'conditional', question: 'Was any signature executed by an attorney-in-fact? A power of attorney is required where one was.' },
    unresolved_severity: 'low',
  },
  'R-MECH-EXH-010': { predicate: 'exhibit_present', exhibit: '31.1', requirement: { kind: 'always' } },
  'R-MECH-EXH-011': { predicate: 'exhibit_present', exhibit: '31.2', requirement: { kind: 'always' } },
  'R-MECH-EXH-012': { predicate: 'exhibit_present', exhibit: '32', requirement: { kind: 'always' } },
  'R-MECH-EXH-013': {
    predicate: 'exhibit_present',
    exhibit: '95',
    requirement: { kind: 'conditional', question: 'Does the registrant operate mines subject to the Mine Safety and Health Act?' },
    unresolved_severity: 'low',
  },
  'R-MECH-EXH-014': { predicate: 'exhibit_present', exhibit: '97', requirement: { kind: 'if_listed' } },
  'R-MECH-EXH-015': { predicate: 'exhibit_present', exhibit: '101', requirement: { kind: 'always' } },
  'R-MECH-EXH-016': { predicate: 'exhibit_present', exhibit: '104', requirement: { kind: 'always' } },
  'R-MECH-EXH-100': { predicate: 'exhibit_index_resolves' },
  'R-MECH-EXH-101': unbound('Incorporation-by-reference targets are resolved against prior filings; scheduled for build wave P1.'),
  'R-MECH-EXH-102': { predicate: 'exhibit_classification' },
};

const CERTIFICATION_BINDINGS: Record<string, RuleBinding> = {
  'R-MECH-CRT-001': { predicate: 'certification_text_conforms', paragraph: '1', phrases: CERT_P1, min_match: 1 },
  'R-MECH-CRT-002': { predicate: 'certification_text_conforms', paragraph: '2', phrases: CERT_P2, min_match: 2 },
  'R-MECH-CRT-003': { predicate: 'certification_text_conforms', paragraph: '3', phrases: CERT_P3, min_match: 1 },
  'R-MECH-CRT-004': { predicate: 'certification_text_conforms', paragraph: '4', phrases: CERT_P4, min_match: 2 },
  'R-MECH-CRT-005': { predicate: 'certification_text_conforms', paragraph: '4(a)-(d)', phrases: CERT_P4_SUB, min_match: 3 },
  'R-MECH-CRT-006': { predicate: 'certification_text_conforms', paragraph: '5', phrases: CERT_P5, min_match: 2 },
  'R-MECH-CRT-010': { predicate: 'certification_cross_reference', check: 'officer_names' },
  'R-MECH-CRT-011': { predicate: 'certification_cross_reference', check: 'officer_titles' },
  'R-MECH-CRT-012': { predicate: 'certification_cross_reference', check: 'period_and_form' },
  'R-MECH-CRT-013': { predicate: 'certification_cross_reference', check: 'dated' },
  'R-MECH-CRT-014': { predicate: 'certification_cross_reference', check: 'ex32_reference' },
};

const SIGNATURE_BINDINGS: Record<string, RuleBinding> = {
  'R-MECH-SIG-001': { predicate: 'signature_block', check: 'present' },
  'R-MECH-SIG-002': { predicate: 'signature_block', check: 'registrant_name' },
  'R-MECH-SIG-003': { predicate: 'signature_block', check: 'conformed_format' },
  'R-MECH-SIG-004': { predicate: 'signature_block', check: 'peo_signed' },
  'R-MECH-SIG-005': { predicate: 'signature_block', check: 'pfo_signed' },
  'R-MECH-SIG-006': { predicate: 'signature_block', check: 'pao_signed' },
  'R-MECH-SIG-007': {
    predicate: 'signature_block',
    check: 'board_majority',
    requirement: { kind: 'conditional', question: 'How many directors sat on the board at the filing date? A majority must sign the annual report.' },
    unresolved_severity: 'medium',
  },
  'R-MECH-SIG-008': { predicate: 'signature_block', check: 'dates_present' },
  'R-MECH-SIG-009': unbound('10-Q authorised-officer signature test ships with 10-Q form support.'),
};

const COVER_BINDINGS: Record<string, RuleBinding> = {
  'R-MECH-COV-001': { predicate: 'header_matches', label: 'Form type', reference: 'submission.form_type', dei_tags: ['DocumentType'] },
  'R-MECH-COV-002': { predicate: 'header_matches', label: 'Period of report', reference: 'submission.period_of_report', dei_tags: ['DocumentPeriodEndDate'] },
  'R-MECH-COV-003': { predicate: 'cover_field', label: 'Commission file number', dei_tags: ['EntityFileNumber'], patterns: ['commission file number'], requirement: { kind: 'always' } },
  'R-MECH-COV-004': { predicate: 'cover_field', label: 'State of incorporation', dei_tags: ['EntityIncorporationStateCountryCode'], patterns: ['state or other jurisdiction of incorporation'], requirement: { kind: 'always' } },
  'R-MECH-COV-005': { predicate: 'cover_field', label: 'IRS employer identification number', dei_tags: ['EntityTaxIdentificationNumber'], patterns: ['i.r.s. employer identification'], requirement: { kind: 'always' } },
  'R-MECH-COV-006': { predicate: 'cover_field', label: 'Securities registered under Section 12(b) table', dei_tags: ['Security12bTitle', 'TradingSymbol', 'SecurityExchangeName'], requirement: { kind: 'if_listed' } },
  'R-MECH-COV-007': { predicate: 'cover_field', label: 'Well-known seasoned issuer checkbox', dei_tags: ['EntityWellKnownSeasonedIssuer'], patterns: ['well-known seasoned issuer'], requirement: { kind: 'always' } },
  'R-MECH-COV-008': { predicate: 'cover_field', label: 'Shell company checkbox', dei_tags: ['EntityShellCompany'], patterns: ['shell company'], requirement: { kind: 'always' } },
  'R-MECH-COV-009': { predicate: 'dei_tag_consistent', tag: 'EntityFilerCategory', reference: 'entity.filer_status' },
  'R-MECH-COV-010': { predicate: 'cover_field', label: 'Emerging growth company checkbox', dei_tags: ['EntityEmergingGrowthCompany'], patterns: ['emerging growth company'], requirement: { kind: 'always' } },
  'R-MECH-COV-011': { predicate: 'cover_field', label: 'Error-correction checkbox', dei_tags: ['DocumentFinStmtErrorCorrectionFlag'], patterns: ['error corrections'], requirement: { kind: 'always' } },
  'R-MECH-COV-012': { predicate: 'cover_field', label: 'Incentive-based compensation recovery analysis checkbox', dei_tags: ['DocumentFinStmtRestatementRecoveryAnalysisFlag'], patterns: ['recovery analysis'], requirement: { kind: 'always' } },
  'R-MECH-COV-013': { predicate: 'cover_field', label: 'Aggregate market value held by non-affiliates', dei_tags: ['EntityPublicFloat'], patterns: ['aggregate market value'], requirement: { kind: 'always' } },
  'R-MECH-COV-014': { predicate: 'cover_field', label: 'Shares outstanding', dei_tags: ['EntityCommonStockSharesOutstanding'], patterns: ['shares of common stock outstanding'], requirement: { kind: 'always' } },
  'R-MECH-COV-015': { predicate: 'cover_field', label: 'Interactive data file checkbox', dei_tags: ['EntityInteractiveDataCurrent'], patterns: ['interactive data file'], requirement: { kind: 'always' } },
};

const HEADER_BINDINGS: Record<string, RuleBinding> = {
  'R-MECH-HDR-001': { predicate: 'header_matches', label: 'Submission form type', reference: 'submission.form_type', dei_tags: ['DocumentType'] },
  'R-MECH-HDR-002': { predicate: 'header_matches', label: 'Submission period', reference: 'submission.period_of_report', dei_tags: ['DocumentPeriodEndDate'] },
  'R-MECH-HDR-003': { predicate: 'header_matches', label: 'Filer CIK', reference: 'submission.filer_cik', dei_tags: ['EntityCentralIndexKey'] },
  'R-MECH-HDR-004': { predicate: 'header_matches', label: 'Commission file number', reference: 'submission.file_number', dei_tags: ['EntityFileNumber'] },
  'R-MECH-HDR-005': { predicate: 'header_matches', label: 'Fiscal year end', reference: 'entity.fiscal_year_end', dei_tags: ['CurrentFiscalYearEndDate'] },
};

const DEI_TAG_RULES: Array<[string, string, ReferenceKey | null]> = [
  ['R-XBRL-DEI-001', 'DocumentType', 'submission.form_type'],
  ['R-XBRL-DEI-002', 'DocumentPeriodEndDate', 'submission.period_of_report'],
  ['R-XBRL-DEI-003', 'DocumentFiscalYearFocus', null],
  ['R-XBRL-DEI-004', 'DocumentFiscalPeriodFocus', null],
  ['R-XBRL-DEI-005', 'EntityRegistrantName', 'entity.legal_name'],
  ['R-XBRL-DEI-006', 'EntityCentralIndexKey', 'submission.filer_cik'],
  ['R-XBRL-DEI-007', 'EntityFilerCategory', 'entity.filer_status'],
  ['R-XBRL-DEI-008', 'EntityCurrentReportingStatus', null],
  ['R-XBRL-DEI-009', 'EntityInteractiveDataCurrent', null],
  ['R-XBRL-DEI-010', 'EntityShellCompany', 'entity.is_shell'],
  ['R-XBRL-DEI-011', 'EntitySmallBusiness', null],
  ['R-XBRL-DEI-012', 'EntityEmergingGrowthCompany', null],
  ['R-XBRL-DEI-013', 'EntityCommonStockSharesOutstanding', null],
  ['R-XBRL-DEI-014', 'AmendmentFlag', 'submission.is_amendment'],
  ['R-XBRL-DEI-015', 'EntityIncorporationStateCountryCode', 'entity.state_of_incorporation'],
  ['R-XBRL-DEI-016', 'Security12bTitle', null],
  ['R-XBRL-DEI-017', 'TradingSymbol', 'entity.tickers'],
  ['R-XBRL-DEI-018', 'SecurityExchangeName', 'entity.exchanges'],
  ['R-XBRL-DEI-019', 'EntityFileNumber', 'submission.file_number'],
  ['R-XBRL-DEI-020', 'EntityTaxIdentificationNumber', 'entity.ein'],
];

const DEI_BINDINGS: Record<string, RuleBinding> = Object.fromEntries(
  DEI_TAG_RULES.map(([ruleId, tag, reference]) => [
    ruleId,
    reference
      ? ({ predicate: 'dei_tag_consistent', tag, reference } as RuleBinding)
      : ({ predicate: 'dei_tag_present', tag, requirement: { kind: 'always' } } as RuleBinding),
  ]),
);

const XBRL_STRUCTURAL_BINDINGS: Record<string, RuleBinding> = {
  'R-XBRL-STR-001': { predicate: 'xbrl_structural', check: 'instance_attached' },
  'R-XBRL-STR-002': { predicate: 'xbrl_structural', check: 'context_resolves' },
  'R-XBRL-STR-003': { predicate: 'xbrl_structural', check: 'unit_and_decimals' },
  'R-XBRL-STR-004': unbound('Calculation linkbase arithmetic needs the linkbase files; the P0 normalizer reads the inline instance only.'),
  'R-XBRL-STR-005': { predicate: 'xbrl_structural', check: 'negative_plausibility' },
  'R-XBRL-STR-006': unbound('Element selection appropriateness needs the full US-GAAP taxonomy for the filing year; scheduled with the DQC ruleset integration.'),
  'R-XBRL-STR-007': unbound('Extension element justification needs the extension taxonomy and its definition relationships.'),
  'R-XBRL-STR-008': unbound('Axis and member misuse needs the dimensional taxonomy for the filing year.'),
  'R-XBRL-STR-009': { predicate: 'xbrl_structural', check: 'period_type' },
  'R-XBRL-STR-010': { predicate: 'xbrl_structural', check: 'fiscal_focus' },
  'R-XBRL-STR-011': { predicate: 'xbrl_structural', check: 'amendment_flag' },
  'R-XBRL-STR-012': unbound('Decimals consistency is scoped per statement, which needs the presentation linkbase.'),
  'R-XBRL-STR-013': unbound('Face-statement tagging completeness needs the presentation linkbase to know what the face statements contain.'),
  'R-XBRL-STR-014': unbound('Footnote detail tagging completeness needs the presentation linkbase.'),
  'R-XBRL-STR-015': { predicate: 'xbrl_structural', check: 'cover_fully_tagged' },
};

const CONSISTENCY_BINDINGS: Record<string, RuleBinding> = {
  'R-CONS-001': {
    predicate: 'recompute',
    label: 'Basic earnings per share',
    op: 'divide',
    target: ['EarningsPerShareBasic', 'IncomeLossFromContinuingOperationsPerBasicShare'],
    terms: [
      { concepts: ['NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLoss', 'ProfitLoss'], sign: 1 },
      { concepts: ['WeightedAverageNumberOfSharesOutstandingBasic'], sign: 1 },
    ],
    tolerance: PER_SHARE_TOLERANCE,
  },
  'R-CONS-002': {
    predicate: 'recompute',
    label: 'Diluted earnings per share',
    op: 'divide',
    target: ['EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare'],
    terms: [
      { concepts: ['NetIncomeLossAvailableToCommonStockholdersDiluted', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLoss', 'ProfitLoss'], sign: 1 },
      { concepts: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingDiluted', 'WeightedAverageNumberOfDilutedSharesOutstandingDiluted'], sign: 1 },
    ],
    tolerance: PER_SHARE_TOLERANCE,
  },
  'R-CONS-003': unbound('Narrative-to-statement number matching needs the narrative extractor, which is tuned in build wave P1 to hold the false-positive budget.'),
  'R-CONS-004': {
    predicate: 'recompute',
    label: 'Gross profit',
    op: 'sum',
    target: ['GrossProfit'],
    terms: [
      { concepts: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet'], sign: 1 },
      { concepts: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfGoodsSold'], sign: -1 },
    ],
    tolerance: MONEY_TOLERANCE,
  },
  'R-CONS-005': {
    predicate: 'recompute',
    label: 'Balance sheet',
    op: 'sum',
    target: ['Assets'],
    terms: [
      { concepts: ['Liabilities'], sign: 1 },
      { concepts: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'StockholdersEquity'], sign: 1 },
      { concepts: ['MinorityInterest'], sign: 1, optional: true },
      { concepts: ['TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests', 'TemporaryEquityCarryingAmountAttributableToParent'], sign: 1, optional: true },
    ],
    tolerance: TIGHT_MONEY_TOLERANCE,
  },
  'R-CONS-006': {
    predicate: 'recompute',
    label: 'Current liabilities and equity',
    op: 'sum',
    target: ['LiabilitiesAndStockholdersEquity'],
    terms: [
      { concepts: ['Liabilities'], sign: 1 },
      { concepts: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'StockholdersEquity'], sign: 1 },
      { concepts: ['MinorityInterest'], sign: 1, optional: true },
      { concepts: ['TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests', 'TemporaryEquityCarryingAmountAttributableToParent'], sign: 1, optional: true },
    ],
    tolerance: TIGHT_MONEY_TOLERANCE,
  },
  'R-CONS-007': {
    predicate: 'recompute',
    label: 'Cash flow statement',
    op: 'sum',
    target: [
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
      'CashAndCashEquivalentsPeriodIncreaseDecrease',
    ],
    terms: [
      { concepts: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'], sign: 1 },
      { concepts: ['NetCashProvidedByUsedInInvestingActivities', 'NetCashProvidedByUsedInInvestingActivitiesContinuingOperations'], sign: 1 },
      { concepts: ['NetCashProvidedByUsedInFinancingActivities', 'NetCashProvidedByUsedInFinancingActivitiesContinuingOperations'], sign: 1 },
      { concepts: ['EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations', 'EffectOfExchangeRateOnCashAndCashEquivalents'], sign: 1, optional: true },
    ],
    tolerance: MONEY_TOLERANCE,
  },
  'R-CONS-008': {
    predicate: 'recompute',
    label: 'Ending cash to balance sheet',
    op: 'sum',
    target: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
    terms: [
      { concepts: ['CashAndCashEquivalentsAtCarryingValue'], sign: 1 },
      { concepts: ['RestrictedCashAndCashEquivalentsAtCarryingValue', 'RestrictedCashCurrent'], sign: 1, optional: true },
      { concepts: ['RestrictedCashAndCashEquivalentsNoncurrent', 'RestrictedCashNoncurrent'], sign: 1, optional: true },
    ],
    tolerance: MONEY_TOLERANCE,
  },
  'R-CONS-009': {
    predicate: 'recompute',
    label: 'Comprehensive income',
    op: 'sum',
    target: ['ComprehensiveIncomeNetOfTax', 'ComprehensiveIncomeNetOfTaxIncludingPortionAttributableToNoncontrollingInterest'],
    terms: [
      { concepts: ['ProfitLoss', 'NetIncomeLoss'], sign: 1 },
      { concepts: ['OtherComprehensiveIncomeLossNetOfTax', 'OtherComprehensiveIncomeLossNetOfTaxPortionAttributableToParent'], sign: 1 },
    ],
    tolerance: MONEY_TOLERANCE,
  },
  'R-CONS-010': unbound('Segment revenue tie-out needs dimensional fact extraction; scheduled with the segment axis reader.'),
  'R-CONS-011': unbound('Segment profit tie-out needs dimensional fact extraction.'),
  'R-CONS-012': unbound('Disaggregation tie-out needs dimensional fact extraction.'),
  'R-CONS-013': unbound('Equity roll-forward needs the statement-of-equity grid, which the P0 normalizer does not reconstruct.'),
  'R-CONS-014': unbound('PP&E roll-forward needs footnote table extraction.'),
  'R-CONS-015': unbound('Goodwill roll-forward by reporting unit needs dimensional footnote extraction.'),
  'R-CONS-016': unbound('Credit-loss roll-forward needs footnote table extraction.'),
  'R-CONS-017': unbound('Debt maturity schedule needs footnote table extraction.'),
  'R-CONS-018': {
    predicate: 'recompute',
    label: 'Operating lease liability',
    op: 'sum',
    target: ['OperatingLeaseLiability'],
    terms: [
      { concepts: ['LesseeOperatingLeaseLiabilityPaymentsDue'], sign: 1 },
      { concepts: ['LesseeOperatingLeaseLiabilityUndiscountedExcessAmount'], sign: -1 },
    ],
    tolerance: MONEY_TOLERANCE,
  },
  'R-CONS-019': unbound('Tax rate reconciliation needs footnote table extraction.'),
  'R-CONS-020': {
    predicate: 'recompute',
    label: 'Net deferred tax assets',
    op: 'sum',
    target: ['DeferredTaxAssetsNet'],
    terms: [
      { concepts: ['DeferredTaxAssetsGross'], sign: 1 },
      { concepts: ['DeferredTaxAssetsValuationAllowance'], sign: -1 },
    ],
    tolerance: MONEY_TOLERANCE,
  },
  'R-CONS-021': unbound('Non-GAAP measures are not inline-tagged; this needs the narrative extractor and reconciliation table reader.'),
  'R-CONS-022': unbound('Non-GAAP reconciliation needs the reconciliation table reader.'),
  'R-CONS-023': unbound('Footnote-to-face tie-out needs footnote table extraction.'),
  'R-CONS-024': unbound('Narrative-to-table matching needs the narrative extractor and its context filter.'),
  'R-CONS-025': {
    predicate: 'recompute',
    label: 'Shares outstanding',
    op: 'sum',
    target: ['dei:EntityCommonStockSharesOutstanding'],
    terms: [{ concepts: ['CommonStockSharesOutstanding', 'CommonStockSharesIssued'], sign: 1 }],
    tolerance: SHARE_COUNT_TOLERANCE,
  },
  'R-CONS-026': unbound('Tie-out of filing captions to the trial balance requires client source data (I5).'),
  'R-CONS-027': unbound('Consolidation elimination testing requires client source data (I5).'),
  'R-CONS-028': unbound('EPS denominator agreement to the cap table requires client source data (I5).'),
};

const DISCLOSURE_BINDINGS: Record<string, RuleBinding> = {
  'R-DISC-001': {
    predicate: 'section_conclusion',
    label: 'Item 9A disclosure controls conclusion',
    items: ['9A'],
    patterns: ['disclosure controls and procedures were effective', 'disclosure controls and procedures are effective', 'disclosure controls and procedures were not effective', 'disclosure controls and procedures are not effective'],
    requirement: { kind: 'always' },
    scope: 'section',
  },
  'R-DISC-002': {
    predicate: 'section_conclusion',
    label: "Item 9A management's report on ICFR",
    items: ['9A'],
    patterns: ["management's report on internal control over financial reporting", 'management is responsible for establishing and maintaining adequate internal control over financial reporting'],
    requirement: { kind: 'always' },
    scope: 'section',
  },
  'R-DISC-003': {
    predicate: 'section_conclusion',
    label: 'ICFR auditor attestation',
    items: ['9A', '8'],
    // The third pattern is the conclusion sentence of an ICFR attestation report.
    // It is phrased to avoid the standard report's opening clause, which carries
    // vocabulary the engine's own output may not contain (GR-1).
    patterns: ['attestation report of the registered public accounting firm', 'report of independent registered public accounting firm on internal control over financial reporting', 'maintained, in all material respects, effective internal control over financial reporting'],
    requirement: { kind: 'if_accelerated' },
  },
  'R-DISC-004': unbound('Item 4 controls conclusion ships with 10-Q form support.'),
  'R-DISC-005': {
    predicate: 'section_conclusion',
    label: 'Changes in internal control over financial reporting',
    items: ['9A'],
    patterns: ['changes in internal control over financial reporting', 'change in the .{0,40}internal control over financial reporting'],
    requirement: { kind: 'always' },
    scope: 'section',
  },
  'R-DISC-006': { predicate: 'section_present', label: 'Item 1A risk factors', items: ['1A'], min_tokens: 200, requirement: { kind: 'always' } },
  'R-DISC-007': unbound('Material changes to risk factors ships with 10-Q form support.'),
  'R-DISC-008': { predicate: 'section_present', label: 'Item 3 legal proceedings', items: ['3'], min_tokens: 12, requirement: { kind: 'always' } },
  'R-DISC-009': { predicate: 'section_present', label: 'Item 5 market for registrant equity', items: ['5'], min_tokens: 40, requirement: { kind: 'always' } },
  'R-DISC-010': { predicate: 'section_present', label: 'Item 7A market risk', items: ['7A'], min_tokens: 25, requirement: { kind: 'always' } },
  'R-DISC-011': { predicate: 'section_present', label: 'Item 1C cybersecurity', items: ['1C', '106'], min_tokens: 120, requirement: { kind: 'always' } },
  'R-DISC-012': unbound('Item 1.05 consistency compares the 10-K against 8-K filings; scheduled with multi-form support.'),
  'R-DISC-013': {
    predicate: 'section_conclusion',
    label: 'Item 408(b) insider trading policies statement',
    items: ['9B', '10', '5'],
    patterns: ['insider trading polic'],
    requirement: { kind: 'always' },
  },
  'R-DISC-014': {
    predicate: 'section_conclusion',
    label: 'Rule 10b5-1 trading arrangement disclosure',
    items: ['9B', '5'],
    patterns: ['rule 10b5-1', '10b5-1 trading arrangement', 'non-rule 10b5-1 trading arrangement'],
    requirement: { kind: 'always' },
  },
  'R-DISC-015': { predicate: 'section_present', label: 'Item 9B other information', items: ['9B'], min_tokens: 3, requirement: { kind: 'always' } },
  'R-DISC-016': {
    predicate: 'section_conclusion',
    label: 'Part III content or forward incorporation statement',
    items: ['10', '11', '12', '13', '14'],
    // Forward incorporation from the proxy is expected behaviour, not a defect
    // (build spec §13.4). Either the item has content or it names the proxy.
    patterns: ['incorporated by reference', 'definitive proxy statement', 'proxy statement'],
    requirement: { kind: 'always' },
    scope: 'section',
  },
  'R-DISC-017': {
    predicate: 'section_conclusion',
    label: 'Critical audit matters',
    items: ['8'],
    patterns: ['critical audit matter'],
    requirement: { kind: 'always' },
  },
  'R-DISC-018': {
    predicate: 'section_conclusion',
    label: 'Auditor identification and tenure',
    items: ['8'],
    patterns: ['we have served as the .{0,60}auditor since', 'auditor since \\d{4}', 'pcaob id'],
    requirement: { kind: 'always' },
  },
  'R-DISC-019': {
    predicate: 'section_conclusion',
    label: 'Going concern evaluation',
    items: ['8', '7'],
    patterns: ['going concern', 'substantial doubt'],
    requirement: { kind: 'conditional', question: 'Are there conditions or events raising substantial doubt about the ability to continue as a going concern? The evaluation is required only where indicators are present.' },
    unresolved_severity: 'medium',
  },
  'R-DISC-020': {
    predicate: 'section_conclusion',
    label: 'Subsequent events evaluation date',
    items: ['8'],
    patterns: ['subsequent event'],
    requirement: { kind: 'always' },
  },
  'R-DISC-021': {
    predicate: 'section_conclusion',
    label: 'Revenue disaggregation',
    items: ['8'],
    patterns: ['disaggregation of revenue', 'disaggregated revenue', 'revenue disaggregat'],
    requirement: { kind: 'always' },
  },
  'R-DISC-022': {
    predicate: 'section_conclusion',
    label: 'Segment measure of profit and CODM',
    items: ['8'],
    patterns: ['chief operating decision maker', 'codm'],
    requirement: { kind: 'always' },
  },
  'R-DISC-023': {
    predicate: 'section_conclusion',
    label: 'Significant segment expenses',
    items: ['8'],
    patterns: ['significant segment expense', 'other segment items'],
    requirement: { kind: 'always' },
  },
  'R-DISC-024': {
    predicate: 'section_conclusion',
    label: 'Rate reconciliation disaggregation',
    items: ['8'],
    patterns: ['effective (income )?tax rate reconciliation', 'reconciliation of .{0,40}statutory .{0,30}rate'],
    requirement: { kind: 'always' },
  },
  'R-DISC-025': {
    predicate: 'section_conclusion',
    label: 'Income taxes paid by jurisdiction',
    items: ['8'],
    patterns: ['income taxes paid, net', 'income taxes paid'],
    requirement: { kind: 'always' },
  },
  'R-DISC-026': {
    predicate: 'section_conclusion',
    label: 'Fair value hierarchy',
    items: ['8'],
    patterns: ['level 3', 'fair value hierarchy', 'level 1'],
    requirement: { kind: 'always' },
  },
  'R-DISC-027': {
    predicate: 'section_conclusion',
    label: 'Lease cost and weighted-average terms',
    items: ['8'],
    patterns: ['weighted[- ]average remaining lease term', 'operating lease cost'],
    requirement: { kind: 'always' },
  },
  'R-DISC-028': {
    predicate: 'section_conclusion',
    label: 'Concentrations of credit risk',
    items: ['8'],
    patterns: ['concentration of credit risk', 'concentrations of credit risk'],
    requirement: { kind: 'always' },
  },
  'R-DISC-029': {
    predicate: 'section_conclusion',
    label: 'Related party transactions',
    items: ['8', '13'],
    patterns: ['related part'],
    requirement: { kind: 'always' },
  },
  'R-DISC-030': unbound('Interim unaudited labelling ships with 10-Q form support.'),
};

const CONTINUITY_BINDINGS: Record<string, RuleBinding> = {
  // Comparatives are read from the current filing's XBRL and matched against
  // the same concept and period as originally reported in the prior filing.
  // A silent change to a comparative is the signature of an unlabelled
  // restatement, which is exactly the defect this layer exists to surface.
  'R-CONT-001': {
    predicate: 'prior_period_diff',
    label: 'Comparative figures versus amounts as originally reported',
    concepts: [
      'Assets',
      'Liabilities',
      'StockholdersEquity',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'NetIncomeLoss',
      'ProfitLoss',
      'NetCashProvidedByUsedInOperatingActivities',
    ],
    tolerance: TIGHT_MONEY_TOLERANCE,
  },
  'R-CONT-002': unbound('Restatement-note detection depends on the R-CONT-001 diff result and the footnote reader; sequenced after it in build wave P1.'),
  'R-CONT-003': unbound('Element-usage drift needs the prior filing\'s full instance, not its company facts; scheduled in build wave P1.'),
  'R-CONT-004': unbound('Disclosure-presence diffing needs prior-period section extraction; scheduled in build wave P1.'),
  'R-CONT-005': unbound('Policy-language diffing needs prior-period section extraction.'),
  'R-CONT-006': unbound('Segment composition diffing needs dimensional fact extraction across periods.'),
  'R-CONT-007': unbound('Comment-letter recurrence reads the UPLOAD/CORRESP corpus; wired to the research centre letter index in build wave P1.'),
  'R-CONT-008': unbound('Auditor-change corroboration reads Item 4.01 Form 8-K filings; scheduled with multi-form support.'),
  'R-CONT-009': unbound('Filer-status transition testing needs the prior filing\'s cover tags; scheduled in build wave P1.'),
};

/**
 * The complete binding table. Every rule id in the catalog resolves here; the
 * fallback below turns any rule the table forgot into an explicit unbound
 * suppression rather than a silent pass.
 */
export const RULE_BINDINGS: Record<string, RuleBinding> = {
  ...EXHIBIT_BINDINGS,
  ...CERTIFICATION_BINDINGS,
  ...SIGNATURE_BINDINGS,
  ...COVER_BINDINGS,
  ...HEADER_BINDINGS,
  ...DEI_BINDINGS,
  ...XBRL_STRUCTURAL_BINDINGS,
  ...CONSISTENCY_BINDINGS,
  ...DISCLOSURE_BINDINGS,
  ...CONTINUITY_BINDINGS,
};

export function getBinding(ruleId: string, layer: string, buildWave: string): RuleBinding {
  const binding = RULE_BINDINGS[ruleId];
  if (binding) return binding;
  if (layer === 'judgment') {
    return unbound('Judgment rules run in build wave P2 behind the retrieval index and a human disposition gate.');
  }
  if (buildWave === 'P2') {
    return unbound('Build wave P2 rule; requires client source data (I5).');
  }
  return unbound('No predicate binding is deployed for this rule.');
}
