/**
 * Display rules for the insider transactions table. Pure and client-safe: the
 * service module itself is server-only (it parses XML with linkedom), so the
 * view imports its types and these formatters, never its functions.
 *
 * A value the filing did not disclose renders as "not reported", never as 0:
 * a missing share count and a zero share count are different facts.
 */
import type {
  InsiderCoverage,
  InsiderOwnerAggregate,
  InsiderTransaction,
} from '../../services/insiderTransactions';

export const NOT_REPORTED = 'not reported';

/** SEC Forms 3/4/5 General Instructions, item 8 (transaction codes). */
const TRANSACTION_CODE_LABELS: Record<string, string> = {
  P: 'Open-market or private purchase',
  S: 'Open-market or private sale',
  V: 'Transaction voluntarily reported earlier than required',
  A: 'Grant, award or other acquisition from the issuer',
  D: 'Disposition to the issuer',
  F: 'Exercise price or tax paid by delivering or withholding securities',
  I: 'Discretionary transaction',
  M: 'Exercise or conversion of derivative security (exempt)',
  C: 'Conversion of derivative security',
  E: 'Expiration of short derivative position',
  H: 'Expiration or cancellation of long derivative position with value received',
  O: 'Exercise of out-of-the-money derivative security',
  X: 'Exercise of in-the-money or at-the-money derivative security',
  G: 'Bona fide gift',
  L: 'Small acquisition under Rule 16a-6',
  W: 'Acquisition or disposition by will or the laws of descent and distribution',
  Z: 'Deposit into or withdrawal from a voting trust',
  J: 'Other acquisition or disposition (see filing footnotes)',
  K: 'Equity swap or similar instrument',
  U: 'Disposition in a change-of-control tender of shares',
};

export function transactionCodeLabel(code: string | null): string {
  if (!code) return NOT_REPORTED;
  const label = TRANSACTION_CODE_LABELS[code.toUpperCase()];
  return label ? `${code} · ${label}` : `${code} · code not in the SEC code list`;
}

const SHARES = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const PRICE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function formatShares(value: number | null): string {
  return value === null ? NOT_REPORTED : SHARES.format(value);
}

export function formatPrice(value: number | null): string {
  return value === null ? NOT_REPORTED : PRICE.format(value);
}

export function formatSignedShares(value: number): string {
  return value > 0 ? `+${SHARES.format(value)}` : SHARES.format(value);
}

export function acquiredDisposedLabel(value: InsiderTransaction['acquiredDisposed']): string {
  return value === 'A' ? 'Acquired' : value === 'D' ? 'Disposed' : NOT_REPORTED;
}

export function ownershipLabel(row: Pick<InsiderTransaction, 'direct' | 'natureOfOwnership'>): string {
  if (row.direct === true) return 'Direct';
  if (row.direct === false) return row.natureOfOwnership ? `Indirect (${row.natureOfOwnership})` : 'Indirect';
  return NOT_REPORTED;
}

export function relationshipLabel(relationship: InsiderTransaction['relationship']): string {
  const parts: string[] = [];
  if (relationship.isDirector) parts.push('Director');
  if (relationship.isOfficer) parts.push(relationship.officerTitle ? `Officer (${relationship.officerTitle})` : 'Officer');
  if (relationship.isTenPercentOwner) parts.push('10% owner');
  if (relationship.isOther) parts.push('Other');
  return parts.length ? parts.join(', ') : NOT_REPORTED;
}

export function ownerName(owner: InsiderTransaction['reportingOwner']): string {
  return owner.name || (owner.cik ? `CIK ${owner.cik}` : NOT_REPORTED);
}

/** The service returns the accession but not the primary document, so the
 * link is the filing's EDGAR index page, which lists every document in it. */
export function filingIndexUrl(issuerCik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(issuerCik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function plural(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** One-line statement of what was read and what was not. */
export function insiderCoverageLine(coverage: InsiderCoverage): string {
  const read = [
    `${plural(coverage.filingsListed, 'Form 3/4/5 filing')} listed`,
    `${count(coverage.filingsRequested)} newest requested`,
    `${count(coverage.filingsParsed)} parsed`,
    `${count(coverage.filingsFailed.length)} failed`,
    `${count(coverage.filingsAboutOtherIssuersCount)} about other issuers`,
  ];
  if (coverage.filingsNotAttempted > 0) read.push(`${count(coverage.filingsNotAttempted)} not attempted`);
  const unread = [
    coverage.filingsOutsideLimit > 0 ? `${plural(coverage.filingsOutsideLimit, 'older listed filing')} not requested` : '',
    coverage.unreadHistoryFiles > 0
      ? `${plural(coverage.unreadHistoryFiles, 'history segment')} not read`
      : 'history segments not read',
  ].filter(Boolean);
  return `${read.join(', ')}; ${unread.join('; ')}.`;
}

export interface InsiderTransactionRow {
  id: string;
  date: string;
  owner: string;
  relationship: string;
  security: string;
  code: string;
  acquiredDisposed: string;
  shares: number | null;
  sharesText: string;
  price: number | null;
  priceText: string;
  ownedAfter: number | null;
  ownedAfterText: string;
  ownership: string;
  form: string;
  filedAt: string;
  accession: string;
  filingUrl: string;
}

export function toTransactionRows(cik: string, transactions: readonly InsiderTransaction[]): InsiderTransactionRow[] {
  return transactions.map((row, index) => ({
    id: `${row.accession}:${index}`,
    date: row.transactionDate ?? NOT_REPORTED,
    owner: `${ownerName(row.reportingOwner)}${row.jointFiling ? ' (joint filing)' : ''}`,
    relationship: relationshipLabel(row.relationship),
    security: `${row.security ?? NOT_REPORTED}${row.derivative ? ' (derivative)' : ''}`,
    code: transactionCodeLabel(row.code),
    acquiredDisposed: acquiredDisposedLabel(row.acquiredDisposed),
    shares: row.shares,
    sharesText: formatShares(row.shares),
    price: row.pricePerShare,
    priceText: formatPrice(row.pricePerShare),
    ownedAfter: row.sharesOwnedAfter,
    ownedAfterText: formatShares(row.sharesOwnedAfter),
    ownership: ownershipLabel(row),
    form: row.formType,
    filedAt: row.filedAt,
    accession: row.accession,
    filingUrl: filingIndexUrl(cik, row.accession),
  }));
}

export interface InsiderOwnerRow {
  id: string;
  owner: string;
  relationship: string;
  netOpenMarket: number | null;
  netOpenMarketText: string;
  netAllCodes: number | null;
  netAllCodesText: string;
  lastTransaction: string;
  filingsCount: number;
  transactionsCount: number;
  rowsWithoutShares: number;
}

/** Owners seen only in holdings-only filings have no transactions to net. */
export function toOwnerRows(owners: readonly InsiderOwnerAggregate[]): InsiderOwnerRow[] {
  return owners.map((aggregate, index) => {
    const traded = aggregate.transactionsCount > 0;
    const caveat = aggregate.rowsWithoutShares > 0
      ? ` (excludes ${plural(aggregate.rowsWithoutShares, 'row')} without shares)` : '';
    return {
      id: aggregate.owner.cik ? `cik:${aggregate.owner.cik}` : `name:${aggregate.owner.name ?? index}`,
      owner: ownerName(aggregate.owner),
      relationship: relationshipLabel(aggregate.relationship),
      netOpenMarket: traded ? aggregate.netSharesOpenMarket : null,
      netOpenMarketText: traded ? `${formatSignedShares(aggregate.netSharesOpenMarket)}${caveat}` : 'no transactions',
      netAllCodes: traded ? aggregate.netSharesAllCodes : null,
      netAllCodesText: traded ? `${formatSignedShares(aggregate.netSharesAllCodes)}${caveat}` : 'no transactions',
      lastTransaction: traded
        ? `${aggregate.lastTransactionDate ?? 'date not reported'} · ${aggregate.lastTransactionCode ?? 'code not reported'}`
        : 'no transactions',
      filingsCount: aggregate.filingsCount,
      transactionsCount: aggregate.transactionsCount,
      rowsWithoutShares: aggregate.rowsWithoutShares,
    };
  });
}
