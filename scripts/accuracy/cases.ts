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
  /** Broad industry, so a run can report which sectors were actually covered. */
  sector: string;
}

/**
 * Large accelerated filers across distinct SIC groups.
 *
 * Sector spread is the point. Both defects reported from the product so far —
 * revenue retrieval returning the income-statement line item, Item 1A coming
 * back as one unreadable block — were disclosure-extraction bugs, and a corpus
 * of large-cap tech would not have caught either. Filing style varies far more
 * by industry than by size: insurers and banks lead with reserve and credit
 * disclosures, REITs push revenue policy deep into property notes, utilities
 * carry regulatory-asset sections nothing else has.
 *
 * No auditor column: it is read from the filing's own dei:AuditorName tag at
 * run time, so there is no fixture to go stale (see auditorFromIxbrl).
 */
export const ISSUERS: IssuerCase[] = [
  // Technology
  { ticker: 'AAPL', cik: '320193', title: 'Apple Inc.', sector: 'technology' },
  { ticker: 'MSFT', cik: '789019', title: 'MICROSOFT CORP', sector: 'technology' },
  { ticker: 'NVDA', cik: '1045810', title: 'NVIDIA CORP', sector: 'technology' },
  // Financials — banks and exchanges
  { ticker: 'JPM', cik: '19617', title: 'JPMORGAN CHASE & CO', sector: 'banking' },
  { ticker: 'ICE', cik: '1571949', title: 'Intercontinental Exchange, Inc.', sector: 'exchange' },
  // Insurance — reserve and loss disclosures nothing else has
  { ticker: 'PGR', cik: '80661', title: 'PROGRESSIVE CORP/OH/', sector: 'insurance' },
  { ticker: 'ALL', cik: '899051', title: 'ALLSTATE CORP', sector: 'insurance' },
  { ticker: 'MET', cik: '1099219', title: 'METLIFE INC', sector: 'insurance' },
  // REITs — revenue policy sits deep in property notes
  { ticker: 'PLD', cik: '1045609', title: 'Prologis, Inc.', sector: 'reit' },
  { ticker: 'AMT', cik: '1053507', title: 'AMERICAN TOWER CORP /MA/', sector: 'reit' },
  { ticker: 'SPG', cik: '1063761', title: 'SIMON PROPERTY GROUP INC.', sector: 'reit' },
  // Pharma and biotech — collaboration and milestone revenue
  { ticker: 'JNJ', cik: '200406', title: 'JOHNSON & JOHNSON', sector: 'pharma' },
  { ticker: 'AMGN', cik: '318154', title: 'AMGEN INC', sector: 'biotech' },
  { ticker: 'GILD', cik: '882095', title: 'GILEAD SCIENCES, INC.', sector: 'biotech' },
  { ticker: 'VRTX', cik: '875320', title: 'VERTEX PHARMACEUTICALS INC / MA', sector: 'biotech' },
  // Utilities — regulatory assets and rate-making disclosures
  { ticker: 'NEE', cik: '753308', title: 'NEXTERA ENERGY INC', sector: 'utility' },
  { ticker: 'DUK', cik: '1326160', title: 'Duke Energy CORP', sector: 'utility' },
  { ticker: 'SO', cik: '92122', title: 'SOUTHERN CO', sector: 'utility' },
  // Energy
  { ticker: 'XOM', cik: '34088', title: 'EXXON MOBIL CORP', sector: 'energy' },
  // Retail and consumer
  { ticker: 'WMT', cik: '104169', title: 'Walmart Inc.', sector: 'retail' },
  { ticker: 'COST', cik: '909832', title: 'COSTCO WHOLESALE CORP /NEW', sector: 'retail' },
  { ticker: 'TGT', cik: '27419', title: 'TARGET CORP', sector: 'retail' },
  { ticker: 'HD', cik: '354950', title: 'HOME DEPOT, INC.', sector: 'retail' },
  { ticker: 'KO', cik: '21344', title: 'COCA COLA CO', sector: 'staples' },
  { ticker: 'PG', cik: '80424', title: 'PROCTER & GAMBLE Co', sector: 'staples' },
  // Industrials, transport, materials, telecom
  { ticker: 'CAT', cik: '18230', title: 'CATERPILLAR INC', sector: 'industrial' },
  { ticker: 'DE', cik: '315189', title: 'DEERE & CO', sector: 'industrial' },
  { ticker: 'HON', cik: '773840', title: 'HONEYWELL INTERNATIONAL INC', sector: 'industrial' },
  { ticker: 'F', cik: '37996', title: 'FORD MOTOR CO', sector: 'automotive' },
  { ticker: 'DAL', cik: '27904', title: 'DELTA AIR LINES, INC.', sector: 'airline' },
  { ticker: 'SHW', cik: '89800', title: 'SHERWIN WILLIAMS CO', sector: 'materials' },
  { ticker: 'VZ', cik: '732712', title: 'VERIZON COMMUNICATIONS INC', sector: 'telecom' },
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
  // Demanding ASC 606 jargon marked correct retrievals wrong: a plainly-worded
  // retail note ("revenue is recognized at the point of sale") is the revenue
  // policy whether or not it says "performance obligation". What the check has
  // to prove is that the passage states a RECOGNITION policy — so the bare
  // phrase "revenue recognition" is deliberately not accepted here, since a
  // passage sitting under a "Revenue Recognition" heading would satisfy it
  // without containing any policy at all.
  {
    topicId: 'revenue-recognition',
    mustContain: [
      'performance obligation', 'transaction price', 'variable consideration',
      'revenue is recognized', 'recognizes revenue', 'recognize revenue',
      'control of the promised', 'point of sale',
    ],
  },
  { topicId: 'stock-compensation', mustContain: ['fair value', 'grant date', 'vest'] },
  { topicId: 'income-taxes', mustContain: ['deferred tax', 'valuation allowance', 'unrecognized tax'] },
  // 'lease' alone is trivially satisfied by any passage the locator returns
  // for the lease topic, so it proves nothing. ASC 842 vocabulary does.
  { topicId: 'leases', mustContain: ['operating lease', 'right-of-use', 'lease liability'] },
];
