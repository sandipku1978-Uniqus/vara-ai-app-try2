/**
 * Cross-form section taxonomy (Intelligize-benchmark C1) — v2.
 *
 * The asset underneath Intelligize's benchmarking matrices is a mapping from
 * section CONCEPTS to where each form family puts them: "Risk Factors" is
 * Item 1A on a 10-K, Part II Item 1A on a 10-Q, Item 3 (Key Information,
 * §D) on a 20-F. This module is that mapping, and every surface that names a
 * section reads it: the section-scope search filter, the YoY change matrix,
 * the Section Matrix, the footnote comparison, and the disclosure topics the
 * Text Redline locates.
 *
 * Three groups of concepts:
 * - Items: the item-numbered sections (and named subsections inside them —
 *   Human Capital in Item 1, Non-GAAP measures in MD&A and the EX-99.1 press
 *   release, Cybersecurity at Item 1C / Item 16K).
 * - Notes: the notes to the financial statements by topic (revenue, leases,
 *   income taxes, …), the significant accounting policies, and the critical
 *   audit matters in the auditor's report.
 * - Proxy: the DEF 14A sections (CD&A, Summary Compensation Table, Pay versus
 *   Performance, …) and their 10-K / 20-F / S-1 counterparts where one exists.
 *
 * Three ways a concept is sliced, all from text that was actually read:
 * - 'item': the Item slicer (sectionPath) — "Item 1A" to the next Item;
 * - 'heading': the prospectus-heading slicer for registration statements;
 * - 'block': the line-based heading-block slicer (sectionBlocks) for notes,
 *   proxy sections and named subsections.
 *
 * A concept that cannot be located is a typed not-found that says whether the
 * filing does not disclose it (text read, heading absent), the slicer could
 * not extract it (no text, or the filing mentions it but no heading bounds
 * it), or the form simply has no such section. An unmapped form yields no
 * slice rather than a wrong one.
 */

import { normalizeForMatch } from './booleanSearch';
import type { SectionSliceOptions } from './sectionPath';
import { headingSectionRange, itemSectionRange, normalizeItemNumber } from './sectionPath';
import { extendOverClosingPunctuation, normalizedTokenOffsets, originalSpan } from './normalizedOffsets';
import { locateHeadingBlock, normalizeHeading, type BlockSpec } from './sectionBlocks';

export type FormFamily = '10-K' | '10-Q' | '20-F' | 'S-1' | 'DEF 14A' | '8-K';
export type SectionGroup = 'items' | 'notes' | 'proxy';

export const SECTION_GROUPS: ReadonlyArray<{ key: SectionGroup; label: string }> = [
  { key: 'items', label: 'Items' },
  { key: 'notes', label: 'Notes' },
  { key: 'proxy', label: 'Proxy' },
];

/** Which heading vocabulary bounds a block-sliced concept. */
type BlockVocabulary = 'notes' | 'proxy' | 'subsection' | 'audit-report' | 'prospectus';

interface FormMapping {
  /** Item-numbered forms: which Item, and which part when numbers repeat. */
  item?: string;
  part?: 1 | 2;
  /** Registration statements: prospectus heading aliases (normalized-text slicer). */
  headings?: string[];
  /** Heading-block slicing with the concept's own headings. */
  block?: BlockVocabulary;
}

/** A curated disclosure topic carried by a concept (the Text Redline's list). */
export interface ConceptTopic {
  id: string;
  label: string;
  /** ASC topic this maps to, shown as provenance. */
  asc?: string;
  /** Vocabulary that signals the topic in running prose. */
  terms: string[];
  /** Position in the topic list the Text Redline offers. */
  order: number;
}

export interface SectionConcept {
  key: string;
  label: string;
  group: SectionGroup;
  /** Names a researcher types into the section-scope filter. */
  aliases: string[];
  /**
   * Heading text that titles this disclosure, most specific first. One list
   * serves the block slicer, the disclosure-topic locator and the XBRL block
   * ranker, so a heading learned once is learned everywhere.
   */
  headings: string[];
  topic?: ConceptTopic;
  forms: Partial<Record<FormFamily, FormMapping>>;
}

/** Form families: the root form decides the mapping; amendments follow it. */
export function formFamily(formType: string): FormFamily | null {
  const root = (formType || '').toUpperCase().replace(/\/A$/, '').replace(/\s+/g, ' ').trim();
  if (root === '10-K' || root === '10-KT' || root === '10-K405') return '10-K';
  if (root === '10-Q' || root === '10-QT') return '10-Q';
  if (root === '20-F') return '20-F';
  // Registration statements and their prospectuses name sections by heading.
  if (root === 'S-1' || root === 'F-1' || /^424B\d$/.test(root)) return 'S-1';
  // Definitive and preliminary proxy statements, and their revisions.
  if (root === 'DEF 14A' || root === 'DEFR14A' || root === 'PRE 14A' || root === 'PRER14A') return 'DEF 14A';
  // A current report and its press-release exhibit (search hits for an
  // EX-99.1 carry the 8-K's form type).
  if (root === '8-K' || /^EX-99(\.\d+)?$/.test(root)) return '8-K';
  return null;
}

/**
 * The prospectus heading vocabulary that bounds registration-statement
 * sections. Deliberately multi-word or distinctive: bare "summary",
 * "business" or "management" appear constantly in prose and would truncate
 * slices at random. A missing boundary makes a slice coarser (it overshoots
 * into the next section); a false boundary loses content — so the list leans
 * conservative.
 */
const REGISTRATION_BOUNDARY_HEADINGS = [
  'prospectus summary',
  'risk factors',
  'cautionary note regarding forward looking statements',
  'market and industry data',
  'use of proceeds',
  'dividend policy',
  'capitalization',
  'dilution',
  'selected financial data',
  'selected consolidated financial data',
  "management's discussion and analysis of financial condition and results of operations",
  'executive compensation',
  'certain relationships and related party transactions',
  'principal stockholders',
  'principal and selling stockholders',
  'description of capital stock',
  'shares eligible for future sale',
  'material us federal income tax considerations',
  'underwriting',
  'plan of distribution',
  'legal proceedings',
  'legal matters',
  'experts',
  'where you can find more information',
  'index to financial statements',
];

/**
 * Whole-line prospectus headings for the block slicer. A heading LINE is
 * unambiguous where a phrase in normalized text is not, so the block slicer
 * can also use the bare titles the normalized slicer must avoid. A trailing
 * "$" means the line must equal the title exactly ("Management" ends the
 * Business section; "Management Team" inside it does not).
 */
const PROSPECTUS_BLOCK_HEADINGS = [
  ...REGISTRATION_BOUNDARY_HEADINGS,
  'business$',
  'management$',
  'executive and director compensation',
  'special note regarding forward looking statements',
  'the offering',
  'summary consolidated financial data',
  'letter from our founder',
  'underwriters',
  'where you can find additional information',
  'index to consolidated financial statements',
];

/** Common note and policy subheadings that are not themselves concepts. */
const NOTES_EXTRA_BOUNDARIES = [
  'cash and cash equivalents', 'cash equivalents', 'marketable securities', 'investments', 'inventories', 'inventory',
  'trade receivables', 'accounts receivable', 'property plant and equipment', 'property and equipment',
  'derivative instruments', 'derivative financial instruments', 'derivatives', 'earnings per share', 'net income per share',
  'net income loss per share', 'foreign currency', 'foreign currency translation', 'advertising costs', 'advertising',
  'research and development', 'recently adopted accounting pronouncements', 'recently issued accounting pronouncements',
  'recent accounting pronouncements', 'principles of consolidation', 'basis of presentation', 'concentrations of credit risk',
  'concentration of credit risk', 'comprehensive income', 'accumulated other comprehensive income', 'warranty', 'product warranties',
  'contingencies', 'commitments and contingencies', 'debt', 'borrowings', 'deferred revenue', 'unearned revenue', 'subsequent events',
  'reclassifications', 'fiscal year', 'capitalized software', 'restructuring', 'stockholders equity', 'shareholders equity',
  'other income expense net', 'related party transactions', 'employee benefit plans', 'retirement plans',
];

/** MD&A, Business and press-release subheadings that end a named subsection. */
const SUBSECTION_EXTRA_BOUNDARIES = [
  'overview', 'executive overview', 'business overview', 'results of operations', 'segment results of operations',
  'summary results of operations', 'components of results of operations', 'quarterly results of operations',
  'liquidity and capital resources', 'critical accounting estimates', 'critical accounting policies and estimates',
  'critical accounting policies', 'recent accounting pronouncements', 'contractual obligations',
  'off balance sheet arrangements', 'cash flows', 'other planned uses of capital', 'outlook', 'key metrics',
  'key business metrics', 'available information', 'competition', 'seasonality', 'intellectual property',
  'government regulation', 'regulation', 'research and development', 'properties', 'facilities',
  'information about our executive officers', 'executive officers of the registrant', 'environmental matters',
  'corporate information', 'legal proceedings', 'forward looking statements', 'cautionary statement',
  'conference call', 'webcast', 'investor contact', 'media contact', 'contacts', 'about the company',
  'risk management and strategy', 'governance',
];

/** Sections of a proxy statement that are not concepts but bound them. */
const PROXY_EXTRA_BOUNDARIES = [
  // Bare section titles are exact-only ("$"): "Executive Compensation
  // Policies and Practices" is a CD&A subsection, not the end of CD&A.
  'executive compensation$', 'executive compensation tables', 'compensation tables', 'compensation committee report',
  'people and compensation committee report', 'report of the compensation committee', 'grants of plan based awards',
  'outstanding equity awards', 'option exercises and stock vested', 'stock vested', 'pension benefits',
  'nonqualified deferred compensation', 'potential payments upon termination or change in control',
  'potential payments upon termination or change of control', 'ceo pay ratio', 'pay ratio$',
  'equity compensation plan information', 'audit committee report', 'report of the audit committee',
  'audit and finance committee report', 'security ownership of certain beneficial owners and management',
  'stock ownership information', 'beneficial ownership$', 'election of directors', 'director nominees',
  'corporate governance$', 'shareholder proposals', 'stockholder proposals', 'other matters$', 'general information$',
  'questions and answers', 'information about the meeting', 'information about the annual meeting',
  'ratification of the appointment', 'ratification of the selection', 'ratification of appointment',
  'delinquent section 16a reports', 'householding',
];

const AUDIT_REPORT_BOUNDARIES = [
  'report of independent registered public accounting firm',
  'opinion on the financial statements',
  'opinion on the consolidated financial statements',
  'opinion on internal control over financial reporting',
  'basis for opinion',
  'definition and limitations of internal control over financial reporting',
];

/** The auditor's signature and tenure statement close the CAM section. */
const AUDIT_REPORT_END_PATTERNS = [/^\/s\//, /^we have served as /i];

/** The last note ends where the auditor's report or the signatures begin. */
const NOTES_END_PATTERNS = [/^report of independent registered public accounting firm/i, /^signatures$/i];

const CONCEPTS: SectionConcept[] = [
  // ───────────── Items ─────────────
  {
    key: 'risk-factors',
    label: 'Risk Factors',
    group: 'items',
    aliases: ['risk factors', 'risks'],
    headings: ['risk factors'],
    forms: {
      '10-K': { item: '1a' },
      '10-Q': { item: '1a', part: 2 },
      // 20-F Item 3 is Key Information; its §D is Risk Factors. Item-level
      // slicing is the honest v1 granularity for FPIs.
      '20-F': { item: '3' },
      'S-1': { headings: ['risk factors'] },
    },
  },
  {
    key: 'mdna',
    label: 'MD&A',
    group: 'items',
    aliases: ['mdna', 'md&a', 'md a', 'management discussion', "management's discussion"],
    headings: ["management's discussion and analysis of financial condition and results of operations", "management's discussion and analysis"],
    forms: {
      '10-K': { item: '7' },
      '10-Q': { item: '2', part: 1 },
      '20-F': { item: '5' },
      'S-1': { headings: ["management's discussion and analysis of financial condition and results of operations", "management's discussion and analysis"] },
    },
  },
  {
    key: 'business',
    label: 'Business',
    group: 'items',
    aliases: ['business', 'description of business'],
    headings: ['business', 'our business'],
    forms: {
      '10-K': { item: '1' },
      '20-F': { item: '4' },
      // A 10-Q has no Business item. On a prospectus "BUSINESS" is a whole
      // heading line, which the block slicer can tell from prose.
      'S-1': { block: 'prospectus' },
    },
  },
  {
    key: 'legal-proceedings',
    label: 'Legal Proceedings',
    group: 'items',
    aliases: ['legal proceedings', 'legal'],
    headings: ['legal proceedings'],
    forms: {
      '10-K': { item: '3' },
      '10-Q': { item: '1', part: 2 },
      '20-F': { item: '8' },
      'S-1': { headings: ['legal proceedings'] },
    },
  },
  {
    key: 'controls',
    label: 'Controls and Procedures',
    group: 'items',
    aliases: ['controls', 'controls and procedures', 'icfr', 'internal control', 'material weakness'],
    headings: ['controls and procedures', 'internal control over financial reporting', 'material weakness'],
    topic: {
      id: 'material-weakness',
      label: 'Material weakness / ICFR',
      terms: [
        'material weakness', 'internal control over financial reporting', 'disclosure controls', 'remediation plan',
        'not effective', 'significant deficiency',
      ],
      order: 10,
    },
    forms: {
      '10-K': { item: '9a' },
      '10-Q': { item: '4', part: 1 },
      '20-F': { item: '15' },
      // A registration statement has no Controls item; where it discusses
      // ICFR (usually a material weakness) it does so under its own heading.
      'S-1': { block: 'subsection' },
    },
  },
  {
    key: 'cybersecurity',
    label: 'Cybersecurity',
    group: 'items',
    aliases: ['cybersecurity', 'cyber', 'cyber security'],
    headings: ['cybersecurity'],
    forms: {
      '10-K': { item: '1c' },
      // Item 16K: the block slicer reads the item designator off the line.
      '20-F': { block: 'subsection' },
    },
  },
  {
    key: 'human-capital',
    label: 'Human Capital',
    group: 'items',
    aliases: ['human capital', 'employees', 'workforce'],
    headings: ['human capital', 'human capital resources', 'human capital management', 'employees and human capital', 'our people', 'employees'],
    forms: {
      '10-K': { block: 'subsection' },
      '20-F': { block: 'subsection' },
      'S-1': { block: 'subsection' },
    },
  },
  {
    key: 'non-gaap',
    label: 'Non-GAAP Measures',
    group: 'items',
    aliases: ['non-gaap', 'non gaap', 'non-gaap measures', 'non-gaap financial measures', 'non-ifrs'],
    headings: [
      'non-gaap financial measures', 'non-gaap measures', 'reconciliation of non-gaap financial measures',
      'use of non-gaap financial measures', 'about non-gaap financial measures', 'non-gaap financial information',
      'key metrics and non-gaap financial measures', 'reconciliation of gaap to non-gaap',
      'non-ifrs financial measures', 'non-ifrs measures',
    ],
    forms: {
      '10-K': { block: 'subsection' },
      '10-Q': { block: 'subsection' },
      '20-F': { block: 'subsection' },
      'S-1': { block: 'subsection' },
      '8-K': { block: 'subsection' },
    },
  },

  // ───────────── Notes ─────────────
  {
    key: 'significant-accounting-policies',
    label: 'Significant Accounting Policies',
    group: 'notes',
    aliases: ['significant accounting policies', 'accounting policies', 'summary of significant accounting policies'],
    headings: [
      'summary of significant accounting policies', 'significant accounting policies',
      'basis of presentation and summary of significant accounting policies',
      'basis of presentation and significant accounting policies',
      'organization and summary of significant accounting policies',
      'description of business and summary of significant accounting policies',
      'nature of business and summary of significant accounting policies',
      'summary of material accounting policies', 'material accounting policies', 'accounting policies',
    ],
    topic: {
      id: 'significant-accounting-policies',
      label: 'Significant accounting policies',
      terms: [
        'principles of consolidation', 'basis of presentation', 'use of estimates', 'significant accounting policies',
        'material accounting policies', 'recently adopted', 'recently issued', 'fiscal year',
      ],
      order: 13,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'revenue-recognition',
    label: 'Revenue',
    group: 'notes',
    aliases: ['revenue', 'revenue recognition', 'revenues', 'asc 606'],
    // Most specific first. A bare 'revenue' is kept LAST because some issuers
    // (Apple) title the policy note exactly that — the confirmation step in
    // the topic locator is what rejects the identically-titled income-statement
    // line item. Revenue recognition is not only ASC 606: an insurer earns
    // premiums under ASC 944 and a REIT recognises rents as lessor under ASC
    // 842, and those notes are titled accordingly. Only headings that
    // unambiguously title a revenue policy: a generic "lease income" belongs to
    // the lease topic and collided here (Target's "Sublease income (c)").
    headings: [
      'revenue recognition', 'revenue from contracts with customers', 'revenue recognition policy',
      'insurance premiums and receivables', 'insurance premiums', 'premiums earned',
      'revenue', 'revenues',
    ],
    topic: {
      id: 'revenue-recognition',
      label: 'Revenue recognition policy',
      asc: 'ASC 606',
      terms: [
        'performance obligation', 'transaction price', 'contract with customer', 'variable consideration',
        'standalone selling price', 'over time', 'point in time', 'contract asset', 'contract liability',
        'deferred revenue', 'asc 606', 'topic 606',
        // How filings outside software and industrials actually word the
        // policy. The list above is ASC 606 jargon, and a plainly-written
        // retail note ("revenue is recognized at the point of sale, net of
        // returns") matched none of it — so Walmart, Costco and Target failed
        // confirmation on a correctly-located heading and fell through to a
        // density match somewhere in the MD&A.
        'revenue is recognized', 'recognizes revenue', 'recognize revenue',
        'control of the promised', 'point of sale', 'sales returns', 'net of returns',
        'when control', 'revenue recognition',
        // ASC 944 (insurers) and ASC 842 lessors state the same policy in
        // their own terms.
        'premiums are earned', 'premiums written are earned', 'earned into income',
        'unearned premium', 'pro rata basis over the period',
        'as a lessor', 'lease income', 'straight-line basis', 'minimum rent',
      ],
      order: 0,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'stock-compensation',
    label: 'Stock-Based Compensation',
    group: 'notes',
    aliases: ['stock compensation', 'stock-based compensation', 'share-based compensation', 'asc 718'],
    headings: [
      'stock-based compensation', 'share-based compensation', 'share-based payment', 'stock based compensation',
      'equity-based compensation', 'employee stock and savings plans', 'employee stock plans', 'equity incentive plans',
    ],
    topic: {
      id: 'stock-compensation',
      label: 'Stock-based compensation policy',
      asc: 'ASC 718',
      terms: [
        'restricted stock unit', 'stock option', 'grant date fair value', 'vesting period', 'forfeiture',
        'black-scholes', 'performance share', 'employee stock purchase', 'asc 718', 'topic 718',
      ],
      order: 1,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'leases',
    label: 'Leases',
    group: 'notes',
    aliases: ['leases', 'lease accounting', 'asc 842'],
    headings: ['leases', 'lease accounting', 'right-of-use', 'operating leases'],
    topic: {
      id: 'leases',
      label: 'Lease accounting policy',
      asc: 'ASC 842',
      terms: [
        'right-of-use asset', 'lease liability', 'operating lease', 'finance lease', 'incremental borrowing rate',
        'lease term', 'short-term lease', 'asc 842', 'topic 842',
      ],
      order: 2,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'goodwill-impairment',
    label: 'Goodwill & Intangibles',
    group: 'notes',
    aliases: ['goodwill', 'goodwill and intangible assets', 'intangible assets', 'asc 350'],
    headings: ['goodwill', 'goodwill and intangible assets', 'impairment of goodwill', 'intangible assets'],
    topic: {
      id: 'goodwill-impairment',
      label: 'Goodwill & intangibles impairment',
      asc: 'ASC 350',
      terms: [
        'reporting unit', 'impairment test', 'carrying amount', 'quantitative assessment', 'qualitative assessment',
        'indefinite-lived', 'triggering event', 'asc 350', 'topic 350',
      ],
      order: 3,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'income-taxes',
    label: 'Income Taxes',
    group: 'notes',
    aliases: ['income taxes', 'income tax', 'taxes', 'asc 740'],
    headings: ['income taxes', 'income tax', 'provision for income taxes', 'taxes on income'],
    topic: {
      id: 'income-taxes',
      label: 'Income taxes policy',
      asc: 'ASC 740',
      terms: [
        'deferred tax asset', 'deferred tax liability', 'valuation allowance', 'unrecognized tax benefit',
        'effective tax rate', 'uncertain tax position', 'asc 740', 'topic 740',
      ],
      order: 4,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'business-combinations',
    label: 'Business Combinations',
    group: 'notes',
    aliases: ['business combinations', 'acquisitions', 'asc 805'],
    headings: ['business combinations', 'acquisitions', 'business combination', 'mergers and acquisitions'],
    topic: {
      id: 'business-combinations',
      label: 'Business combinations',
      asc: 'ASC 805',
      terms: [
        'purchase price allocation', 'acquisition date fair value', 'contingent consideration', 'measurement period',
        'identifiable intangible', 'asc 805', 'topic 805',
      ],
      order: 5,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'segment-reporting',
    label: 'Segments',
    group: 'notes',
    aliases: ['segments', 'segment reporting', 'segment information', 'asc 280'],
    headings: [
      'segment information', 'segment reporting', 'reportable segments', 'segments',
      'segment and geographic information', 'segment data', 'business segment information',
    ],
    topic: {
      id: 'segment-reporting',
      label: 'Segment reporting',
      asc: 'ASC 280',
      terms: [
        'chief operating decision maker', 'reportable segment', 'operating segment', 'segment profit',
        'significant segment expense', 'asc 280', 'topic 280',
      ],
      order: 6,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'credit-losses',
    label: 'Credit Losses',
    group: 'notes',
    aliases: ['credit losses', 'allowance for credit losses', 'cecl', 'asc 326'],
    headings: ['credit losses', 'allowance for credit losses', 'allowance for doubtful accounts'],
    topic: {
      id: 'credit-losses',
      label: 'Credit losses / allowance',
      asc: 'ASC 326',
      terms: [
        'expected credit loss', 'current expected credit loss', 'cecl', 'allowance for doubtful', 'charge-off',
        'asc 326', 'topic 326',
      ],
      order: 7,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'fair-value',
    label: 'Fair Value',
    group: 'notes',
    aliases: ['fair value', 'fair value measurements', 'asc 820'],
    headings: ['fair value measurements', 'fair value', 'fair value measurement', 'financial instruments'],
    topic: {
      id: 'fair-value',
      label: 'Fair value measurement',
      asc: 'ASC 820',
      terms: ['level 1', 'level 2', 'level 3', 'observable input', 'unobservable input', 'asc 820', 'topic 820'],
      order: 8,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'going-concern',
    label: 'Going Concern',
    group: 'notes',
    aliases: ['going concern', 'asc 205-40'],
    headings: ['going concern', 'liquidity and going concern'],
    topic: {
      id: 'going-concern',
      label: 'Going concern',
      asc: 'ASC 205-40',
      terms: ['substantial doubt', 'ability to continue as a going concern', 'management’s plans', 'liquidity'],
      order: 9,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'use-of-estimates',
    label: 'Use of Estimates',
    group: 'notes',
    aliases: ['use of estimates', 'estimates', 'critical accounting estimates'],
    headings: [
      'use of estimates', 'critical accounting estimates', 'critical accounting policies',
      'significant accounting judgments estimates and assumptions', 'significant estimates and judgments', 'accounting estimates',
    ],
    topic: {
      id: 'use-of-estimates',
      label: 'Use of estimates',
      terms: ['significant estimate', 'actual results could differ', 'judgment', 'assumption'],
      order: 12,
    },
    forms: { '10-K': { block: 'notes' }, '10-Q': { block: 'notes' }, '20-F': { block: 'notes' }, 'S-1': { block: 'notes' } },
  },
  {
    key: 'critical-audit-matters',
    label: 'Critical Audit Matters',
    group: 'notes',
    aliases: ['critical audit matters', 'critical audit matter', 'cams', 'cam'],
    headings: ['critical audit matters', 'critical audit matter'],
    topic: {
      id: 'critical-audit-matters',
      label: 'Critical audit matters',
      terms: ['critical audit matter', 'especially challenging', 'subjective', 'complex judgment'],
      order: 11,
    },
    // The auditor's report: annual reports and registration statements only.
    forms: { '10-K': { block: 'audit-report' }, '20-F': { block: 'audit-report' }, 'S-1': { block: 'audit-report' } },
  },

  // ───────────── Proxy ─────────────
  {
    key: 'cdna',
    label: 'Compensation Discussion & Analysis',
    group: 'proxy',
    aliases: ['cd&a', 'cd a', 'cdna', 'compensation discussion and analysis', 'compensation discussion'],
    headings: ['compensation discussion and analysis', 'compensation discussion analysis'],
    forms: { 'DEF 14A': { block: 'proxy' }, 'S-1': { block: 'proxy' } },
  },
  {
    key: 'summary-compensation-table',
    label: 'Summary Compensation Table',
    group: 'proxy',
    aliases: ['summary compensation table', 'sct'],
    headings: ['summary compensation table'],
    forms: { 'DEF 14A': { block: 'proxy' }, 'S-1': { block: 'proxy' } },
  },
  {
    key: 'pay-versus-performance',
    label: 'Pay versus Performance',
    group: 'proxy',
    aliases: ['pay versus performance', 'pay vs performance', 'pvp'],
    headings: ['pay versus performance', 'pay vs performance', 'pay versus performance table'],
    forms: { 'DEF 14A': { block: 'proxy' } },
  },
  {
    key: 'director-compensation',
    label: 'Director Compensation',
    group: 'proxy',
    aliases: ['director compensation', 'non-employee director compensation'],
    headings: ['director compensation', 'non-employee director compensation', 'compensation of directors', 'directors compensation'],
    forms: { 'DEF 14A': { block: 'proxy' }, 'S-1': { block: 'proxy' } },
  },
  {
    key: 'audit-fees',
    label: 'Audit Fees',
    group: 'proxy',
    aliases: ['audit fees', 'principal accountant fees', 'principal accountant fees and services', 'auditor fees'],
    headings: [
      'principal accountant fees and services', 'audit and non-audit fees', 'audit fees',
      'fees paid to auditors', 'fees paid to', 'fees billed by',
      'fees of independent registered public accounting firm', 'independent registered public accounting firm fees',
      'independent auditor fees',
    ],
    forms: {
      'DEF 14A': { block: 'proxy' },
      '10-K': { item: '14' },
      // Item 16C: read off the line's own designator.
      '20-F': { block: 'subsection' },
    },
  },
  {
    key: 'related-party-transactions',
    label: 'Related-Party Transactions',
    group: 'proxy',
    aliases: ['related party transactions', 'related-party transactions', 'related person transactions', 'certain relationships'],
    headings: [
      'certain relationships and related transactions', 'certain relationships and related party transactions',
      'certain relationships and related person transactions', 'related person transactions',
      'related party transactions', 'transactions with related persons', 'related party policy and transactions',
      'review of related person transactions', 'related person transaction policy',
    ],
    forms: {
      'DEF 14A': { block: 'proxy' },
      '10-K': { item: '13' },
      // 20-F Item 7: Major Shareholders and Related Party Transactions.
      '20-F': { item: '7' },
      'S-1': { headings: ['certain relationships and related party transactions'] },
    },
  },
  {
    key: 'board-committees',
    label: 'Board and Committees',
    group: 'proxy',
    aliases: ['board committees', 'board and committees', 'committees', 'board of directors'],
    headings: [
      'board committees', 'committees of the board', 'board and committee structure', 'board structure',
      'committees of the board of directors', 'board committees and meetings', 'board meetings and committees',
      'board and committee matters', 'standing committees', 'committees of our board',
    ],
    forms: { 'DEF 14A': { block: 'proxy' }, '10-K': { item: '10' } },
  },
  {
    key: 'say-on-pay',
    label: 'Say-on-Pay Proposal',
    group: 'proxy',
    aliases: ['say on pay', 'say-on-pay', 'advisory vote on executive compensation'],
    // Deliberately no bare "say on pay": CD&A carries a "Say on Pay Advisory
    // Vote Results" subsection, and taking it for the proposal would both
    // misplace this concept and cut CD&A short.
    headings: [
      'advisory vote to approve executive compensation', 'advisory vote to approve named executive officer compensation',
      'advisory vote on executive compensation', 'advisory approval of executive compensation',
      'advisory vote to approve the compensation of our named executive officers', 'advisory vote to approve',
      'say on pay vote', 'say on pay proposal',
    ],
    forms: { 'DEF 14A': { block: 'proxy' } },
  },
];

const VOCABULARY_HEADINGS: Record<BlockVocabulary, string[]> = {
  notes: [...CONCEPTS.filter(c => c.group === 'notes' && c.key !== 'critical-audit-matters').flatMap(c => c.headings), ...NOTES_EXTRA_BOUNDARIES],
  proxy: [...CONCEPTS.filter(c => c.group === 'proxy').flatMap(c => c.headings), ...PROXY_EXTRA_BOUNDARIES],
  subsection: [
    ...CONCEPTS.filter(c => Object.values(c.forms).some(m => m?.block === 'subsection')).flatMap(c => c.headings),
    ...SUBSECTION_EXTRA_BOUNDARIES,
  ],
  'audit-report': AUDIT_REPORT_BOUNDARIES,
  prospectus: PROSPECTUS_BLOCK_HEADINGS,
};

const BLOCK_LIMITS: Record<BlockVocabulary, number> = {
  notes: 60_000,
  proxy: 150_000,
  subsection: 25_000,
  'audit-report': 30_000,
  prospectus: 120_000,
};

function blockSpecFor(concept: SectionConcept, vocabulary: BlockVocabulary, family: FormFamily): BlockSpec {
  const boundaries = [...VOCABULARY_HEADINGS[vocabulary]];
  // On a registration statement the prospectus's own headings also end a
  // section: "EXECUTIVE COMPENSATION" content is followed by "CERTAIN
  // RELATIONSHIPS…", not by another proxy heading.
  if (family === 'S-1' && vocabulary !== 'prospectus') boundaries.push(...PROSPECTUS_BLOCK_HEADINGS);
  return {
    headings: concept.headings,
    boundaries,
    region: vocabulary === 'notes' ? 'notes' : undefined,
    endPatterns: vocabulary === 'audit-report' ? AUDIT_REPORT_END_PATTERNS
      : vocabulary === 'notes' ? NOTES_END_PATTERNS
      : undefined,
    maxChars: BLOCK_LIMITS[vocabulary],
    confirmTerms: vocabulary === 'notes' ? concept.topic?.terms : undefined,
  };
}

export interface SectionConceptDescriptor {
  key: string;
  label: string;
  group: SectionGroup;
}

/** The concepts, for consumers that iterate them. */
export const SECTION_CONCEPT_LIST: SectionConceptDescriptor[] =
  CONCEPTS.map(concept => ({ key: concept.key, label: concept.label, group: concept.group }));

/** Every concept, read-only — the disclosure-topic list is built from it. */
export const SECTION_CONCEPTS: readonly SectionConcept[] = CONCEPTS;

export function findSectionConcept(key: string): SectionConcept | undefined {
  return CONCEPTS.find(concept => concept.key === key);
}

/** Concepts with a slice on this form, in group order (Items, Notes, Proxy). */
export function conceptsForForm(formType: string): SectionConceptDescriptor[] {
  const family = formFamily(formType);
  if (!family) return [];
  return SECTION_GROUPS.flatMap(group =>
    CONCEPTS
      .filter(concept => concept.group === group.key && concept.forms[family])
      .map(concept => ({ key: concept.key, label: concept.label, group: concept.group })),
  );
}

/** How a concept is sliced on a form: 'item' | 'heading' | 'block', or null when unmapped. */
export function conceptSliceKind(key: string, formType: string): 'item' | 'heading' | 'block' | null {
  const concept = findSectionConcept(key);
  const family = formFamily(formType);
  const mapping = concept && family ? concept.forms[family] : undefined;
  if (!mapping) return null;
  return mapping.item ? 'item' : mapping.headings ? 'heading' : 'block';
}

function scopeKey(value: string): string {
  return normalizeHeading(value.replace(/&/g, ' '));
}

function conceptFor(input: string): SectionConcept | null {
  const needle = scopeKey(input);
  if (!needle) return null;
  return CONCEPTS.find(concept =>
    scopeKey(concept.key) === needle
    || scopeKey(concept.label) === needle
    || concept.aliases.some(alias => scopeKey(alias) === needle),
  ) || null;
}

export type ResolvedSectionScope =
  | {
      kind: 'item';
      item: string;
      options: SectionSliceOptions;
      /** What the UI should call it: "Risk Factors" or "Item 1A". */
      label: string;
    }
  | {
      kind: 'heading';
      headings: string[];
      label: string;
    }
  | {
      kind: 'block';
      spec: BlockSpec;
      label: string;
    };

function resolveConcept(concept: SectionConcept, family: FormFamily | null): ResolvedSectionScope | null {
  const mapping = family ? concept.forms[family] : undefined;
  if (!mapping || !family) return null;
  if (mapping.headings) return { kind: 'heading', headings: mapping.headings, label: concept.label };
  if (mapping.block) return { kind: 'block', spec: blockSpecFor(concept, mapping.block, family), label: concept.label };
  if (!mapping.item) return null;
  return {
    kind: 'item',
    item: mapping.item,
    options: mapping.part ? { part: mapping.part } : {},
    label: concept.label,
  };
}

/** A concept's scope on a form — the entry point for surfaces that iterate concepts. */
export function resolveConceptScope(key: string, formType: string): ResolvedSectionScope | null {
  const concept = findSectionConcept(key);
  return concept ? resolveConcept(concept, formFamily(formType)) : null;
}

/**
 * Slice a filing's text at a resolved scope, whichever kind it is ('' when
 * not found). Engine-normalized (lowercase, punctuation stripped) — the form
 * matching and the YoY diff measure on.
 */
export function extractResolvedSection(filingText: string, resolved: ResolvedSectionScope): string {
  const outcome = locateResolvedSection(filingText, resolved);
  return outcome.status === 'found' ? outcome.text : '';
}

/**
 * The same slice as extractResolvedSection, in the filing's own words — case,
 * punctuation and line breaks as filed — for anything a person reads or
 * exports (Word, memo citations). Exactly the same section boundaries: the
 * normalized slice's token range is mapped back onto the original text, and
 * the end is carried over the punctuation and closing quotes that directly
 * follow the last word (the final full stop), which normalization drops.
 * '' when the section is not found, or when the mapping cannot be made
 * exactly (never an approximate span).
 */
export function extractResolvedSectionOriginal(filingText: string, resolved: ResolvedSectionScope): string {
  const outcome = locateResolvedSection(filingText, resolved, { original: true });
  return outcome.status === 'found' ? (outcome.rawText ?? '').trim() : '';
}

/**
 * Resolve the user's section-scope input for one candidate filing.
 *
 * - An explicit item number ("1A", "9a", "2.02") applies to any form as-is —
 *   the researcher said exactly where to look.
 * - A concept name ("risk factors", "leases", "CD&A") resolves through the
 *   taxonomy using the candidate's OWN form; a form the concept is not mapped
 *   for returns null, and the candidate cannot match — never sliced at a
 *   guessed location.
 * - Anything else is unrecognizable: null.
 */
export function resolveSectionScope(input: string, formType: string): ResolvedSectionScope | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  const explicit = normalizeItemNumber(raw);
  if (explicit) {
    return { kind: 'item', item: explicit, options: {}, label: `Item ${explicit.toUpperCase()}` };
  }

  const concept = conceptFor(raw);
  if (!concept) return null;
  return resolveConcept(concept, formFamily(formType));
}

/** For UI copy: is this input a known concept (vs an item number / junk)? */
export function describeSectionScope(input: string): string {
  const raw = (input || '').trim();
  if (!raw) return '';
  const explicit = normalizeItemNumber(raw);
  if (explicit) return `Item ${explicit.toUpperCase()}`;
  return conceptFor(raw)?.label || raw;
}

/**
 * The forms a scope input can match on, or null when any form can (an
 * explicit item number, or input that is not a concept). Search uses it to
 * avoid fetching candidates that structurally cannot carry the section.
 */
export function sectionScopeFamilies(input: string): FormFamily[] | null {
  const raw = (input || '').trim();
  if (!raw || normalizeItemNumber(raw)) return null;
  const concept = conceptFor(raw);
  return concept ? (Object.keys(concept.forms) as FormFamily[]) : null;
}

/** Options for a section-scope picker, grouped Items / Notes / Proxy. */
export function sectionScopeOptions(): Array<{ value: string; group: SectionGroup; groupLabel: string; forms: FormFamily[] }> {
  return SECTION_GROUPS.flatMap(group =>
    CONCEPTS.filter(concept => concept.group === group.key).map(concept => ({
      value: concept.label,
      group: concept.group,
      groupLabel: group.label,
      forms: Object.keys(concept.forms) as FormFamily[],
    })),
  );
}

// ───────────── Located-or-not, with the reason ─────────────

/**
 * Why a section has no slice. The reason a reader sees is one of three:
 * - not-disclosed: the filing text was read and carries no such section;
 * - could-not-extract: the text was unavailable, or the filing mentions the
 *   section but the slicer could not bound it — open the filing;
 * - not-applicable: this form has no such section at all.
 */
export type SectionNotFoundReason = 'not-disclosed' | 'could-not-extract' | 'not-applicable';

export type SectionNotFoundCause =
  | 'heading-absent'
  | 'mentioned-without-heading'
  | 'no-notes-region'
  | 'no-text'
  | 'part-missing'
  | 'unmapped-form'
  | 'unknown-scope'
  | 'slicer-error';

export type SectionLocateOutcome =
  | {
      status: 'found';
      /** Engine-normalized slice — the form search, diffing and presence use. */
      text: string;
      /**
       * The slice as the filing wrote it. Always present for block scopes;
       * for Item / prospectus-heading scopes only when asked for
       * ({ original: true }) and the offsets map exactly.
       */
      rawText?: string;
      /** The heading line the slice starts at (block-sliced concepts only). */
      heading?: string;
      /** The slice hit its length cap before a boundary. */
      truncated: boolean;
      label: string;
    }
  | {
      status: 'not-found';
      reason: SectionNotFoundReason;
      cause: SectionNotFoundCause;
      /** One sentence for the reader. */
      detail: string;
      label: string;
    };

function notFound(
  cause: SectionNotFoundCause,
  label: string,
  detailOverride?: string,
): Extract<SectionLocateOutcome, { status: 'not-found' }> {
  const reason: SectionNotFoundReason =
    cause === 'heading-absent' ? 'not-disclosed'
    : cause === 'unmapped-form' || cause === 'unknown-scope' ? 'not-applicable'
    : 'could-not-extract';
  const detail = detailOverride ?? {
    'heading-absent': `No ${label} heading in the filing text that was read.`,
    'mentioned-without-heading': `The filing mentions ${label}, but no heading for it could be located — open the filing to check.`,
    'no-notes-region': 'This document carries no notes to the financial statements (they may be filed as an exhibit).',
    'no-text': 'The filing text was not available.',
    'part-missing': 'The filing part that holds this section could not be located.',
    'unmapped-form': `${label} is not a section of this form.`,
    'unknown-scope': `${label} is not a known section.`,
    'slicer-error': 'The section could not be extracted from this text.',
  }[cause];
  return { status: 'not-found', reason, cause, detail, label };
}

const PART_TWO_RE = /(?:^| )part ii(?= |$)/;
const PART_ONE_RE = /(?:^| )part i(?= |$)/;

/**
 * Locate a resolved scope in a filing's text and say what happened. The ONLY
 * path to `found` is a non-empty slice of text that was read; everything else
 * carries its reason.
 */
export interface LocateOptions {
  /**
   * Also return the slice in the filing's own words (rawText) for Item and
   * prospectus-heading scopes, whose slicers work on normalized text. Costs
   * one extra tokenization pass, so it is opt-in; block scopes always carry it.
   */
  original?: boolean;
}

export function locateResolvedSection(
  filingText: string | null | undefined,
  resolved: ResolvedSectionScope,
  options: LocateOptions = {},
): SectionLocateOutcome {
  const text = filingText || '';
  if (!text.trim()) return notFound('no-text', resolved.label);
  try {
    if (resolved.kind === 'block') {
      const result = locateHeadingBlock(text, resolved.spec);
      if (!result.ok) return notFound(result.cause, resolved.label);
      const rawText = text.slice(result.match.start, result.match.end).trim();
      const normalized = normalizeForMatch(rawText);
      if (!normalized) return notFound('slicer-error', resolved.label);
      return {
        status: 'found',
        text: normalized,
        rawText,
        heading: result.match.heading,
        truncated: result.match.truncated,
        label: resolved.label,
      };
    }

    const offsets = options.original ? normalizedTokenOffsets(text) : null;
    const normalizedText = offsets?.normalized;
    const range = resolved.kind === 'item'
      ? itemSectionRange(text, resolved.item, resolved.options, normalizedText)
      : headingSectionRange(text, resolved.headings, REGISTRATION_BOUNDARY_HEADINGS, normalizedText);
    if (range) {
      const slice = range.normalizedText.slice(range.start, range.end);
      const span = offsets ? originalSpan(offsets, range.start, range.end) : null;
      return {
        status: 'found',
        text: slice,
        rawText: span ? text.slice(span.start, extendOverClosingPunctuation(text, span.end)) : undefined,
        truncated: false,
        label: resolved.label,
      };
    }

    if (resolved.kind === 'item' && resolved.options.part) {
      // The Item slicer refuses a part-scoped request when the part heading
      // is missing; that is the slicer not finding its bearings, not proof
      // the section is absent.
      const normalized = normalizeForMatch(text);
      const partRe = resolved.options.part === 2 ? PART_TWO_RE : PART_ONE_RE;
      if (!partRe.test(normalized)) return notFound('part-missing', resolved.label);
    }
    return notFound('heading-absent', resolved.label);
  } catch {
    return notFound('slicer-error', resolved.label);
  }
}

/** Locate a concept (or an explicit item number) on a filing of the given form. */
export function locateSection(
  filingText: string | null | undefined,
  scope: string,
  formType: string,
  options: LocateOptions = {},
): SectionLocateOutcome {
  const raw = (scope || '').trim();
  const concept = findSectionConcept(raw) ?? conceptFor(raw);
  const label = concept?.label || describeSectionScope(raw) || raw;
  const resolved = concept ? resolveConcept(concept, formFamily(formType)) : resolveSectionScope(raw, formType);
  if (!resolved) {
    return concept
      ? notFound('unmapped-form', label, `${label} is not a section of a ${formFamily(formType) || formType || 'filing of this form'}.`)
      : notFound('unknown-scope', label);
  }
  return locateResolvedSection(filingText, resolved, options);
}

/** Short words for a reason, as a status chip says them. */
export const SECTION_REASON_LABELS: Record<SectionNotFoundReason | 'found', string> = {
  found: 'Disclosed',
  'not-disclosed': 'Not disclosed',
  'could-not-extract': 'Could not extract',
  'not-applicable': 'Not applicable',
};
