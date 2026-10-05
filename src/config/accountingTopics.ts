import type { SearchFilters } from '../domain/searchFilters';
import { DISCLOSURE_TOPICS, type DisclosureTopic } from '../services/disclosureTopics';
import { RESEARCH_LIBRARY, type ResearchLibraryEntry } from './researchLibrary';

export interface AscTopic {
  id: string;
  name: string;
}

export const FASB_CODIFICATION_URL = 'https://asc.fasb.org/';

export const CURATED_ASC_TOPICS: AscTopic[] = [
  { id: '100', name: 'General Principles' },
  { id: '200', name: 'Presentation' },
  { id: '280', name: 'Segment Reporting' },
  { id: '300', name: 'Assets' },
  { id: '326', name: 'Financial Instruments — Credit Losses' },
  { id: '350', name: 'Intangibles — Goodwill and Other' },
  { id: '400', name: 'Liabilities' },
  { id: '450', name: 'Contingencies' },
  { id: '500', name: 'Equity' },
  { id: '600', name: 'Revenue' },
  { id: '606', name: 'Revenue from Contracts with Customers' },
  { id: '700', name: 'Expenses' },
  { id: '718', name: 'Compensation — Stock Compensation' },
  { id: '740', name: 'Income Taxes' },
  { id: '800', name: 'Broad Transactions' },
  { id: '805', name: 'Business Combinations' },
  { id: '815', name: 'Derivatives and Hedging' },
  { id: '820', name: 'Fair Value Measurement' },
  { id: '842', name: 'Leases' },
  { id: '900', name: 'Industry' },
];

export function ascTopicUrl(topicId: string): string {
  return `${FASB_CODIFICATION_URL}${encodeURIComponent(topicId)}/`;
}

export function filterCuratedAscTopics(query: string): AscTopic[] {
  const normalized = query.trim().toLowerCase().replace(/^asc\s*/i, '');
  if (!normalized) return CURATED_ASC_TOPICS;
  return CURATED_ASC_TOPICS.filter(topic => (
    topic.id.includes(normalized) || topic.name.toLowerCase().includes(normalized)
  ));
}

// ── Accounting issue pages (/accounting/[topic]) ─────────────────────────────
//
// One page per disclosure topic in services/disclosureTopics.ts (the list
// Benchmarking compares on). This module holds only what is curated for the
// page — the precedent search, the comment-letter phrase, and the
// authoritative references a reviewer needs beside the Codification link.
// Everything else on the page is read live and labelled with its source.

export interface IssuePrecedentSearch {
  title: string;
  hint: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters?: Partial<SearchFilters>;
  /** Where the search definition comes from, shown on the panel. */
  origin: 'research-library' | 'issue-page';
}

export interface AuthoritativeReference {
  /** "SAB 116", "AS 3101", "Regulation S-K Item 308". */
  id: string;
  title: string;
  /** Issuer of the reference, shown as its source. */
  publisher: 'SEC staff' | 'SEC' | 'PCAOB';
  /** Date as printed by the publisher, when it prints one. */
  issued?: string;
  /** Why it bears on the issue, paraphrased from the publisher's own summary. */
  relevance: string;
  url: string;
}

export interface AccountingIssueConfig {
  id: string;
  /** Codification topics to link (three-digit), in display order. */
  codificationTopics: string[];
  precedent: IssuePrecedentSearch;
  /** Full-text phrase for the owned comment-letter corpus (websearch syntax). */
  letterQuery: string;
  references: AuthoritativeReference[];
}

export interface AccountingIssue extends AccountingIssueConfig {
  label: string;
  /** "ASC 606", "ASC 205-40"; absent for issues that are not a Codification topic. */
  asc?: string;
  topic: DisclosureTopic;
}

function libraryPrecedent(title: string): IssuePrecedentSearch {
  const entry: ResearchLibraryEntry | undefined = RESEARCH_LIBRARY
    .flatMap(category => category.entries)
    .find(candidate => candidate.title === title);
  if (!entry) throw new Error(`Research library entry "${title}" is missing.`);
  return { title: entry.title, hint: entry.hint, query: entry.query, mode: entry.mode, filters: entry.filters, origin: 'research-library' };
}

function issuePrecedent(title: string, hint: string, query: string, filters?: Partial<SearchFilters>): IssuePrecedentSearch {
  return { title, hint, query, mode: 'boolean', filters, origin: 'issue-page' };
}

const SEC_SAB = 'https://www.sec.gov/rules-regulations/staff-guidance/staff-accounting-bulletins';

const ISSUE_CONFIG: Record<string, AccountingIssueConfig> = {
  'revenue-recognition': {
    id: 'revenue-recognition',
    codificationTopics: ['606'],
    precedent: issuePrecedent('Variable consideration in revenue policies', 'Revenue policies that discuss both performance obligations and variable consideration', '"performance obligation" AND "variable consideration"'),
    letterQuery: 'revenue recognition "performance obligation"',
    references: [
      { id: 'SAB 116', title: 'Staff Accounting Bulletin No. 116', publisher: 'SEC staff', issued: 'Aug. 18, 2017', relevance: 'Brings the SAB Series into conformity with ASC 606, Revenue from Contracts with Customers.', url: 'https://www.sec.gov/interps/account/sab116.pdf' },
    ],
  },
  'stock-compensation': {
    id: 'stock-compensation',
    codificationTopics: ['718'],
    precedent: issuePrecedent('Grant-date fair value disclosures', 'Stock-compensation notes that describe how grant-date fair value is measured', '"stock-based compensation" AND "grant date fair value"'),
    letterQuery: '"share-based compensation" "grant date fair value"',
    references: [
      { id: 'SAB 107', title: 'Staff Accounting Bulletin No. 107 (SAB Topic 14, Share-Based Payment)', publisher: 'SEC staff', issued: 'Mar. 29, 2005', relevance: 'Staff views on share-based payment and SEC rules, including the valuation of share-based payment arrangements for public companies.', url: `${SEC_SAB}/staff-accounting-bulletin-no-107` },
      { id: 'SAB 120', title: 'Staff Accounting Bulletin No. 120', publisher: 'SEC staff', issued: 'Nov. 24, 2021', relevance: 'Estimating the fair value of share-based payments under Topic 718 when the company holds material non-public information.', url: 'https://www.sec.gov/oca/staff-accounting-bulletin-120' },
    ],
  },
  leases: {
    id: 'leases',
    codificationTopics: ['842'],
    precedent: issuePrecedent('Incremental borrowing rate judgments', 'Lease notes that explain how the incremental borrowing rate was determined', '"incremental borrowing rate" AND "right-of-use"'),
    letterQuery: 'lease "incremental borrowing rate"',
    references: [],
  },
  'goodwill-impairment': {
    id: 'goodwill-impairment',
    codificationTopics: ['350'],
    precedent: libraryPrecedent('Goodwill impairments, quantified'),
    letterQuery: 'goodwill impairment "reporting unit"',
    references: [],
  },
  'income-taxes': {
    id: 'income-taxes',
    codificationTopics: ['740'],
    precedent: libraryPrecedent('Effective tax rates, quantified'),
    letterQuery: '"valuation allowance" "deferred tax assets"',
    references: [
      { id: 'SAB 118', title: 'Staff Accounting Bulletin No. 118', publisher: 'SEC staff', issued: 'Dec. 22, 2017', relevance: 'Applying ASC 740 in the reporting period that includes the enactment of the Tax Cuts and Jobs Act.', url: `${SEC_SAB}/staff-accounting-bulletin-no-118` },
    ],
  },
  'business-combinations': {
    id: 'business-combinations',
    codificationTopics: ['805'],
    precedent: issuePrecedent('Contingent consideration in acquisitions', 'Acquisition notes discussing purchase price allocation and contingent consideration', '"purchase price allocation" AND "contingent consideration"'),
    letterQuery: '"business combination" "purchase price allocation"',
    references: [
      { id: 'SAB 115', title: 'Staff Accounting Bulletin No. 115', publisher: 'SEC staff', issued: 'Nov. 18, 2014', relevance: 'Rescinds SAB guidance to conform with ASU 2014-17, Business Combinations (Topic 805): Pushdown Accounting.', url: `${SEC_SAB}/staff-accounting-bulletin-no-115` },
    ],
  },
  'segment-reporting': {
    id: 'segment-reporting',
    codificationTopics: ['280'],
    precedent: libraryPrecedent('Segment reporting under ASU 2023-07'),
    letterQuery: 'segment reporting CODM "operating segments"',
    references: [],
  },
  'credit-losses': {
    id: 'credit-losses',
    codificationTopics: ['326'],
    precedent: issuePrecedent('CECL allowance methodology', 'Allowance disclosures describing current expected credit loss measurement', '"current expected credit loss" AND allowance'),
    letterQuery: '"allowance for credit losses"',
    references: [
      { id: 'SAB 119', title: 'Staff Accounting Bulletin No. 119', publisher: 'SEC staff', issued: 'Nov. 19, 2019', relevance: 'Aligns the SAB Series with ASC 326, Financial Instruments — Credit Losses.', url: 'https://www.sec.gov/oca/staff-accounting-bulletin-119' },
    ],
  },
  'fair-value': {
    id: 'fair-value',
    codificationTopics: ['820'],
    precedent: issuePrecedent('Level 3 unobservable inputs', 'Fair value notes describing Level 3 measurements and their unobservable inputs', '"Level 3" AND "unobservable inputs"'),
    letterQuery: '"Level 3" "unobservable inputs"',
    references: [],
  },
  'going-concern': {
    id: 'going-concern',
    codificationTopics: ['205'],
    precedent: issuePrecedent('Substantial doubt disclosures', 'Filings that state substantial doubt about the ability to continue as a going concern', '"substantial doubt" W/10 "going concern"'),
    letterQuery: '"substantial doubt" "going concern"',
    references: [],
  },
  'material-weakness': {
    id: 'material-weakness',
    codificationTopics: [],
    precedent: libraryPrecedent('Material weakness remediation, Item 9A'),
    letterQuery: '"material weakness" remediation',
    references: [
      { id: 'Regulation S-K Item 308', title: '17 CFR 229.308 — Internal control over financial reporting', publisher: 'SEC', relevance: 'Management’s annual ICFR report, including disclosure of material weaknesses.', url: 'https://www.ecfr.gov/current/title-17/chapter-II/part-229/subpart-229.300/section-229.308' },
      { id: 'AS 2201', title: 'An Audit of Internal Control Over Financial Reporting That Is Integrated with An Audit of Financial Statements', publisher: 'PCAOB', relevance: 'The auditor’s standard for evaluating and reporting on ICFR, including material weaknesses.', url: 'https://pcaobus.org/oversight/standards/auditing-standards/details/AS2201' },
      { id: 'SAB 99', title: 'Staff Accounting Bulletin No. 99 (Materiality)', publisher: 'SEC staff', issued: 'Aug. 13, 1999', relevance: 'Exclusive reliance on quantitative benchmarks to assess materiality is inappropriate.', url: 'https://www.sec.gov/interps/account/sab99.htm' },
      { id: 'SAB 108', title: 'Staff Accounting Bulletin No. 108', publisher: 'SEC staff', issued: 'Sep. 13, 2006', relevance: 'The process of quantifying financial statement misstatements.', url: `${SEC_SAB}/staff-accounting-bulletin-no-108` },
    ],
  },
  'critical-audit-matters': {
    id: 'critical-audit-matters',
    codificationTopics: [],
    precedent: issuePrecedent('Critical audit matters', 'Auditor reports that communicate a critical audit matter', '"critical audit matter"'),
    letterQuery: '"critical audit matter"',
    references: [
      { id: 'AS 3101', title: 'The Auditor’s Report on an Audit of Financial Statements When the Auditor Expresses an Unqualified Opinion', publisher: 'PCAOB', relevance: 'Requires and defines the communication of critical audit matters in the auditor’s report.', url: 'https://pcaobus.org/oversight/standards/auditing-standards/details/AS3101' },
    ],
  },
  'significant-accounting-policies': {
    id: 'significant-accounting-policies',
    codificationTopics: ['235'],
    precedent: issuePrecedent('Summary of significant accounting policies', 'Notes that summarize the registrant’s significant accounting policies', '"significant accounting policies"'),
    letterQuery: '"significant accounting policies"',
    references: [],
  },
  'use-of-estimates': {
    id: 'use-of-estimates',
    codificationTopics: ['275'],
    precedent: issuePrecedent('Critical accounting estimates', 'Filings that discuss critical accounting estimates', '"critical accounting estimates"'),
    letterQuery: '"critical accounting estimates"',
    references: [
      { id: 'Regulation S-K Item 303', title: '17 CFR 229.303 — Management’s discussion and analysis', publisher: 'SEC', relevance: 'MD&A disclosure of critical accounting estimates.', url: 'https://www.ecfr.gov/current/title-17/chapter-II/part-229/subpart-229.300/section-229.303' },
    ],
  },
};

/** Issue pages, in the disclosure-topic order Benchmarking uses. */
export const ACCOUNTING_ISSUES: AccountingIssue[] = DISCLOSURE_TOPICS
  .filter(topic => ISSUE_CONFIG[topic.id])
  .map(topic => ({ ...ISSUE_CONFIG[topic.id], label: topic.label, asc: topic.asc, topic }));

export function findAccountingIssue(id: string): AccountingIssue | undefined {
  return ACCOUNTING_ISSUES.find(issue => issue.id === id);
}

export function accountingIssueHref(id: string): string {
  return `/accounting/${encodeURIComponent(id)}`;
}

/** Benchmarking with this issue preselected as the comparison topic. */
export function benchmarkingIssueHref(id: string): string {
  return `/compare?${new URLSearchParams({ topic: id }).toString()}`;
}

/**
 * The ASC reference an issue's ASU lookup uses: the disclosure topic's own
 * ("ASC 606", "ASC 205-40"), else the first Codification topic the page links
 * (use of estimates → ASC 275); null for issues outside the Codification.
 */
export function issueAscReference(issue: Pick<AccountingIssue, 'asc' | 'codificationTopics'>): string | null {
  if (issue.asc && /\d{3}/.test(issue.asc)) return issue.asc;
  return issue.codificationTopics[0] ? `ASC ${issue.codificationTopics[0]}` : null;
}

function issueForAscTopic(topic: string): AccountingIssue | undefined {
  return ACCOUNTING_ISSUES.find(issue => issue.asc === `ASC ${topic}`)
    ?? ACCOUNTING_ISSUES.find(issue => issue.codificationTopics.includes(topic));
}

/**
 * Issue page for an ASU, from the Codification topics and subtopics its title
 * names. Subtopic issues (going concern, ASC 205-40) match only on the
 * subtopic, mirroring asusForAscReference, so the two directions agree.
 */
export function accountingIssueForAsu(asu: { ascTopics: readonly string[]; ascSubtopics: readonly string[] }): AccountingIssue | undefined {
  for (const issue of ACCOUNTING_ISSUES) {
    const reference = issueAscReference(issue)?.match(/(\d{3})(?:-(\d{2,3}))?/);
    if (!reference) continue;
    const matches = reference[2]
      ? asu.ascSubtopics.includes(`${reference[1]}-${reference[2]}`)
      : asu.ascTopics.includes(reference[1]);
    if (matches) return issue;
  }
  return undefined;
}

// ── Checklist links ─────────────────────────────────────────────────────────

export interface ChecklistItemLinks {
  issue?: { id: string; label: string; href: string };
  asu?: { number: string; href: string };
}

/**
 * The issue page and ASU a checklist item stems from, read from the item's own
 * wording: an "ASU 2023-07" citation links that Update (and, through the
 * Codification topics the ASU index records for it, its issue page); an
 * "ASC 842" citation, or an issue's own multi-word heading ("material
 * weakness"), links the issue page. Nothing is stored on the item, so this
 * works with whichever store holds the checklist.
 */
export function checklistItemLinks(
  text: string,
  asuLookup?: (asuNumber: string) => { ascTopics: readonly string[]; ascSubtopics: readonly string[] } | undefined,
): ChecklistItemLinks {
  const links: ChecklistItemLinks = {};
  const asuMatch = text.match(/\b(?:ASU|Accounting\s+Standards\s+Update)(?:\s+No\.)?\s*((?:19|20)\d{2})\s*[-–]\s*(\d{1,2})\b/i);
  if (asuMatch) {
    const number = `${asuMatch[1]}-${asuMatch[2].padStart(2, '0')}`;
    const params = new URLSearchParams({ tab: 'asu', asu: number });
    links.asu = { number, href: `/accounting?${params.toString()}#asu-${number}` };
  }

  let issue: AccountingIssue | undefined;
  const ascMatch = text.match(/\bASC\s*(?:Topic\s*)?(\d{3})\b/i);
  if (ascMatch) issue = issueForAscTopic(ascMatch[1]);
  if (!issue && links.asu && asuLookup) {
    const asu = asuLookup(links.asu.number);
    if (asu) issue = accountingIssueForAsu(asu);
  }
  if (!issue) {
    const lower = text.toLowerCase();
    issue = ACCOUNTING_ISSUES.find(candidate => (
      [candidate.label.replace(/\s+policy$/i, ''), ...candidate.topic.headings]
        .map(phrase => phrase.toLowerCase())
        .filter(phrase => phrase.includes(' '))
        .some(phrase => lower.includes(phrase))
    ));
  }
  if (issue) links.issue = { id: issue.id, label: issue.label, href: accountingIssueHref(issue.id) };
  return links;
}
