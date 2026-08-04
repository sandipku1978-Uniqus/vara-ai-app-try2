/**
 * Parser for SEC ownership documents — the XML behind Forms 3, 4 and 5
 * (schema: ownershipDocument, versions X0202…X0609). These filings have no
 * HTML rendition in the archive; SEC renders them through XSLT on demand.
 * Parsing the XML directly lets the filing viewer show a first-class table
 * instead of dead-ending on "cannot be previewed inline" (user report,
 * 2026-08-03: the Form 4 SEC link landed on raw doc4.xml).
 *
 * Deliberately tolerant: every field is optional-with-default, because the
 * schema has grown across versions and older filings omit blocks. A document
 * that parses but carries no <ownershipDocument> root returns null — callers
 * fall back to the existing external-viewer path.
 */

export interface OwnershipTransaction {
  securityTitle: string;
  transactionDate: string;
  /** SEC transaction code (P, S, M, A, F, G, …) — labeled via describeTransactionCode. */
  code: string;
  shares: string;
  pricePerShare: string;
  /** 'A' acquired | 'D' disposed | ''. */
  acquiredDisposed: string;
  sharesOwnedAfter: string;
  /** 'D' direct | 'I' indirect | ''. */
  ownershipForm: string;
  natureOfOwnership: string;
  /** Derivative rows only. */
  exercisePrice?: string;
  exerciseDate?: string;
  expirationDate?: string;
  underlyingTitle?: string;
  underlyingShares?: string;
  /** Footnote ids referenced anywhere in the row, in document order. */
  footnoteIds: string[];
}

export interface OwnershipReportingOwner {
  cik: string;
  name: string;
  location: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  isOther: boolean;
  officerTitle: string;
}

export interface OwnershipDocument {
  documentType: string;
  schemaVersion: string;
  periodOfReport: string;
  issuerName: string;
  issuerCik: string;
  issuerTradingSymbol: string;
  reportingOwners: OwnershipReportingOwner[];
  nonDerivative: OwnershipTransaction[];
  derivative: OwnershipTransaction[];
  footnotes: Array<{ id: string; text: string }>;
  remarks: string;
}

const TRANSACTION_CODE_LABELS: Record<string, string> = {
  P: 'Open-market purchase',
  S: 'Open-market sale',
  A: 'Grant or award',
  D: 'Disposition to issuer',
  F: 'Tax withholding',
  I: 'Discretionary transaction',
  M: 'Option exercise',
  C: 'Conversion',
  E: 'Expiration of short position',
  H: 'Expiration of long position',
  O: 'Out-of-the-money exercise',
  X: 'In-the-money exercise',
  G: 'Gift',
  L: 'Small acquisition',
  W: 'Will or laws of descent',
  Z: 'Voting trust',
  J: 'Other (see footnotes)',
  K: 'Equity swap',
  U: 'Tender of shares',
};

export function describeTransactionCode(code: string): string {
  return TRANSACTION_CODE_LABELS[code.toUpperCase()] || '';
}

function text(parent: Element | Document, selector: string): string {
  const node = parent.querySelector(selector);
  return (node?.textContent || '').trim();
}

/** Most ownership values live one level down in a <value> child. */
function value(parent: Element, selector: string): string {
  const node = parent.querySelector(selector);
  if (!node) return '';
  const inner = node.querySelector('value');
  return ((inner ?? node).textContent || '').trim();
}

function footnoteIdsOf(row: Element): string[] {
  const ids: string[] = [];
  row.querySelectorAll('footnoteId').forEach(node => {
    const id = node.getAttribute('id');
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

function parseTransactionRow(row: Element, derivative: boolean): OwnershipTransaction {
  const entry: OwnershipTransaction = {
    securityTitle: value(row, 'securityTitle'),
    transactionDate: value(row, 'transactionDate'),
    code: text(row, 'transactionCoding > transactionCode'),
    shares: value(row, 'transactionAmounts > transactionShares'),
    pricePerShare: value(row, 'transactionAmounts > transactionPricePerShare'),
    acquiredDisposed: value(row, 'transactionAmounts > transactionAcquiredDisposedCode'),
    sharesOwnedAfter: value(row, 'postTransactionAmounts > sharesOwnedFollowingTransaction'),
    ownershipForm: value(row, 'ownershipNature > directOrIndirectOwnership'),
    natureOfOwnership: value(row, 'ownershipNature > natureOfOwnership'),
    footnoteIds: footnoteIdsOf(row),
  };
  if (derivative) {
    entry.exercisePrice = value(row, 'conversionOrExercisePrice');
    entry.exerciseDate = value(row, 'exerciseDate');
    entry.expirationDate = value(row, 'expirationDate');
    entry.underlyingTitle = value(row, 'underlyingSecurity > underlyingSecurityTitle');
    entry.underlyingShares = value(row, 'underlyingSecurity > underlyingSecurityShares');
  }
  return entry;
}

/**
 * Parse ownership-document XML. Returns null when the text is not an
 * ownership document (wrong root, parse error) — never throws.
 */
export function parseOwnershipDocument(xml: string): OwnershipDocument | null {
  if (!xml || !/<ownershipDocument/i.test(xml)) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  if (doc.querySelector('parsererror')) return null;
  const root = doc.querySelector('ownershipDocument');
  if (!root) return null;

  const reportingOwners: OwnershipReportingOwner[] = [];
  root.querySelectorAll('reportingOwner').forEach(owner => {
    const city = text(owner, 'reportingOwnerAddress > rptOwnerCity');
    const state = text(owner, 'reportingOwnerAddress > rptOwnerState');
    reportingOwners.push({
      cik: text(owner, 'reportingOwnerId > rptOwnerCik'),
      name: text(owner, 'reportingOwnerId > rptOwnerName'),
      location: [city, state].filter(Boolean).join(', '),
      isDirector: text(owner, 'reportingOwnerRelationship > isDirector') === '1',
      isOfficer: text(owner, 'reportingOwnerRelationship > isOfficer') === '1',
      isTenPercentOwner: text(owner, 'reportingOwnerRelationship > isTenPercentOwner') === '1',
      isOther: text(owner, 'reportingOwnerRelationship > isOther') === '1',
      officerTitle: text(owner, 'reportingOwnerRelationship > officerTitle'),
    });
  });

  const nonDerivative: OwnershipTransaction[] = [];
  root.querySelectorAll('nonDerivativeTable > nonDerivativeTransaction, nonDerivativeTable > nonDerivativeHolding')
    .forEach(row => nonDerivative.push(parseTransactionRow(row, false)));
  const derivative: OwnershipTransaction[] = [];
  root.querySelectorAll('derivativeTable > derivativeTransaction, derivativeTable > derivativeHolding')
    .forEach(row => derivative.push(parseTransactionRow(row, true)));

  const footnotes: Array<{ id: string; text: string }> = [];
  root.querySelectorAll('footnotes > footnote').forEach(node => {
    footnotes.push({ id: node.getAttribute('id') || '', text: (node.textContent || '').trim() });
  });

  return {
    documentType: text(root, 'documentType'),
    schemaVersion: text(root, 'schemaVersion'),
    periodOfReport: text(root, 'periodOfReport'),
    issuerName: text(root, 'issuer > issuerName'),
    issuerCik: text(root, 'issuer > issuerCik'),
    issuerTradingSymbol: text(root, 'issuer > issuerTradingSymbol'),
    reportingOwners,
    nonDerivative,
    derivative,
    footnotes,
    remarks: text(root, 'remarks'),
  };
}

/**
 * SEC's own XSLT-rendered view of an ownership document — the human-readable
 * page the raw-XML link should have been (user report 2026-08-03). The XSL
 * name tracks the schema generation; best-effort mapping with the modern
 * stylesheet as default. The inline parser above is the primary experience —
 * this link is the official-source escape hatch.
 */
export function buildOwnershipRenderedPath(cik: string, accessionNoDashes: string, document: string, schemaVersion: string): string {
  const version = schemaVersion.toUpperCase();
  const xsl =
    /^X0(2|30)/.test(version) ? 'xslF345X02'
    : /^X04/.test(version) ? 'xslF345X03'
    : /^X05/.test(version) ? 'xslF345X04'
    : 'xslF345X05';
  return `Archives/edgar/data/${cik}/${accessionNoDashes}/${xsl}/${document}`;
}
