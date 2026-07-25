/**
 * The corpus the accuracy gate scores against.
 *
 * Every expectation here is checkable against SEC's own data at run time —
 * nothing is a snapshot of our output, because a gate that asserts today's
 * behaviour only proves we did not change, not that we are right.
 */

export interface IssuerCase {
  ticker: string;
  cik: string;
  /** Registrant name as SEC records it, for entity-resolution scoring. */
  title: string;
  /** Auditor of record per PCAOB Form AP / the audit report in the 10-K. */
  auditor: string;
}

/**
 * Large accelerated filers across distinct SIC groups, so a systematic
 * extraction failure in one industry's filing style cannot hide behind
 * successes in another.
 */
export const ISSUERS: IssuerCase[] = [
  { ticker: 'AAPL', cik: '320193', title: 'Apple Inc.', auditor: 'Ernst & Young' },
  { ticker: 'MSFT', cik: '789019', title: 'MICROSOFT CORP', auditor: 'Deloitte' },
  { ticker: 'JPM', cik: '19617', title: 'JPMORGAN CHASE & CO', auditor: 'PricewaterhouseCoopers' },
  { ticker: 'XOM', cik: '34088', title: 'EXXON MOBIL CORP', auditor: 'PricewaterhouseCoopers' },
  { ticker: 'JNJ', cik: '200406', title: 'JOHNSON & JOHNSON', auditor: 'PricewaterhouseCoopers' },
  { ticker: 'WMT', cik: '104169', title: 'Walmart Inc.', auditor: 'Ernst & Young' },
  { ticker: 'KO', cik: '21344', title: 'COCA COLA CO', auditor: 'Ernst & Young' },
  { ticker: 'NVDA', cik: '1045810', title: 'NVIDIA CORP', auditor: 'PricewaterhouseCoopers' },
];

/**
 * XBRL concepts every operating registrant tags. The expected value is not
 * written down — it is read from SEC's companyconcept API at run time and
 * compared with what the app surfaces.
 */
export const XBRL_CONCEPTS = [
  { key: 'revenue', taxonomy: 'us-gaap', tag: 'Revenues', alternates: ['RevenueFromContractWithCustomerExcludingAssessedTax'] },
  { key: 'netIncome', taxonomy: 'us-gaap', tag: 'NetIncomeLoss', alternates: [] },
  { key: 'assets', taxonomy: 'us-gaap', tag: 'Assets', alternates: [] },
  { key: 'equity', taxonomy: 'us-gaap', tag: 'StockholdersEquity', alternates: [] },
];

export interface BooleanCase {
  query: string;
  /**
   * What must hold for the result set. Expressed as a property rather than a
   * fixed count, because the live corpus grows between runs.
   */
  expect:
    | { kind: 'union-superset-of-branches' }
    | { kind: 'intersection-subset-of-each-branch' }
    | { kind: 'phrase-stricter-than-tokens' }
    | { kind: 'rejected-before-retrieval' };
  branches?: string[];
  note: string;
}

/**
 * Boolean semantics that must hold against the LIVE corpus. These are the
 * relationships that broke in production before — a disjunction returning the
 * intersection, a phrase matching loose tokens.
 */
export const BOOLEAN_CASES: BooleanCase[] = [
  {
    query: '"mezzanine equity" OR "temporary equity"',
    branches: ['"mezzanine equity"', '"temporary equity"'],
    expect: { kind: 'union-superset-of-branches' },
    note: 'A disjunction must return at least what each branch returns alone.',
  },
  {
    query: '"material weakness" AND "remediation plan"',
    branches: ['"material weakness"', '"remediation plan"'],
    expect: { kind: 'intersection-subset-of-each-branch' },
    note: 'A conjunction cannot exceed either branch.',
  },
  {
    query: '"revenue recognition"',
    branches: ['revenue recognition'],
    expect: { kind: 'phrase-stricter-than-tokens' },
    note: 'An exact phrase must be no broader than its loose token form.',
  },
  {
    query: 'goodwill AND',
    expect: { kind: 'rejected-before-retrieval' },
    note: 'A dangling operator must never reach EDGAR as a literal string.',
  },
  {
    query: 'NOT impairment',
    expect: { kind: 'rejected-before-retrieval' },
    note: 'A negation-only query has no positive term to retrieve on.',
  },
];

/**
 * Topics whose policy note is present in essentially every large filer's
 * 10-K. If the locator cannot find these, it cannot find anything.
 */
export const TOPIC_CASES = [
  { topicId: 'revenue-recognition', mustContain: ['performance obligation'] },
  { topicId: 'stock-compensation', mustContain: ['fair value'] },
  { topicId: 'income-taxes', mustContain: ['deferred tax'] },
  { topicId: 'leases', mustContain: ['lease'] },
];
