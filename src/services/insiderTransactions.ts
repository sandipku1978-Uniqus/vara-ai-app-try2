/** Server-only SEC Forms 3/4/5 research over filings.recent, not full history. */
import { isValidIsoDate, parseCik } from '../lib/api-query';
import { buildSecTargetUrl, fetchSecJson, fetchSecResponse, readResponseWithLimit, SecUpstreamError } from '../lib/sec-upstream';
import { parseOwnershipXml, OwnershipXmlError, type InsiderOwner, type InsiderRelationship, type OwnershipTransaction, type ParsedOwnershipXml } from './ownershipXml';

export { parseOwnershipXml } from './ownershipXml';
export type InsiderForm = '3' | '4' | '5';
/** Only the submissions fields this service reads. Large filers can have far
 * more than 10,000 recent rows and need not provide the other series columns. */
export interface InsiderSubmission {
  cik: string;
  name: string;
  tickers: string[];
  filings: {
    recent: { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] };
    files?: unknown[];
  };
}
export interface InsiderFiling { accession: string; filedAt: string; formType: string; primaryDocument: string }
export interface InsiderTransaction extends OwnershipTransaction {
  accession: string; filedAt: string; formType: string;
  /** The filing's primary document as SEC lists it (e.g. `xslF345X06/form4.xml`, the rendered form). */
  primaryDocument: string;
}
export interface InsiderOwnerAggregate {
  owner: InsiderOwner;
  relationship: InsiderRelationship;
  filingsCount: number;
  transactionsCount: number;
  rowsWithoutShares: number;
  netSharesOpenMarket: number;
  /** A minus D, including grants, withholding and exercises; non-derivative only. */
  netSharesAllCodes: number;
  purchasesShares: number;
  salesShares: number;
  lastTransactionDate: string | null;
  lastTransactionCode: string | null;
  /** One disclosed row's balance, not a sum across securities/ownership accounts. */
  latestSharesOwnedAfter: number | null;
}
export interface InsiderCoverage {
  source: 'SEC submissions filings.recent and raw ownership XML';
  scope: 'requested-recent-filings';
  cik: string;
  filingsListed: number;
  filingsRequested: number;
  /** Fetched, valid ownership XML for the requested issuer. Other issuers are
   * counted separately: parsed + other-issuer count + failed + not-attempted
   * equals filingsRequested. */
  filingsParsed: number;
  filingsAboutOtherIssuers: Array<{ accession: string; issuerCik: string; issuerName: string }>;
  filingsAboutOtherIssuersCount: number;
  filingsFailed: Array<{ accession: string; reason: string }>;
  filingsNotAttempted: number;
  filingsOutsideLimit: number;
  transactionRows: number;
  rowsWithoutShares: number;
  holdingsRowsSkipped: number;
  olderHistoryNotRead: true;
  unreadHistoryFiles: number;
  /** filings.recent includes all forms, with variable depth for large filers. */
  recentHistoryNote: string;
  oldestFiledAt: string | null;
  newestFiledAt: string | null;
  /** Completeness applies only to the requested slice of recent filings. */
  complete: boolean;
  fetchedAt: string;
  aggregationNote: string;
}
export interface InsiderTransactionsResult {
  cik: string;
  issuer: { name: string; tradingSymbol: string | null };
  transactions: InsiderTransaction[];
  owners: InsiderOwnerAggregate[];
  coverage: InsiderCoverage;
}
export interface InsiderTransactionsOptions {
  cik: string | number;
  maxFilings?: number;
  formTypes?: readonly InsiderForm[];
  signal?: AbortSignal;
  userAgent?: string;
  deadlineMs?: number;
}
const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function boundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength
    && (allowEmpty || value.trim().length > 0)
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}
function stringColumn(value: unknown, length: number, maxLength: number, allowEmpty = false): value is string[] {
  if (!Array.isArray(value) || value.length !== length) return false;
  // Iteration visits sparse entries as undefined, so holes cannot pass validation.
  for (const entry of value) if (!boundedString(entry, maxLength, allowEmpty)) return false;
  return true;
}

/** Local listing validator: validate all rows of the four columns we consume,
 * without the shared client's 10,000-row cap or unrelated column requirements. */
export function parseInsiderSubmissionPayload(value: unknown, requestedCik: string): InsiderSubmission | null {
  const source = record(value);
  const expected = parseCik(requestedCik);
  const rawCik = source?.cik;
  const observed = typeof rawCik === 'string' || (typeof rawCik === 'number' && Number.isSafeInteger(rawCik))
    ? parseCik(String(rawCik)) : null;
  if (!source || expected === null || observed !== expected || !boundedString(source.name, 1000)) return null;
  const tickers = source.tickers;
  if (!Array.isArray(tickers) || tickers.length > 100 || !stringColumn(tickers, tickers.length, 64)) return null;
  const filings = record(source.filings);
  const recent = record(filings?.recent);
  const accessionNumber = recent?.accessionNumber;
  if (!filings || !recent || !Array.isArray(accessionNumber) || accessionNumber.length > 100_000) return null;
  const length = accessionNumber.length;
  const { filingDate, form, primaryDocument } = recent;
  if (!stringColumn(accessionNumber, length, 20)
    || !stringColumn(filingDate, length, 10)
    || !stringColumn(form, length, 40)
    || !stringColumn(primaryDocument, length, 1000, true)
    || accessionNumber.some(accession => !/^\d{10}-\d{2}-\d{6}$/.test(accession))
    || filingDate.some(date => !isValidIsoDate(date))) return null;
  const files = filings.files;
  if (files !== undefined && !Array.isArray(files)) return null;
  return { cik: String(expected), name: source.name, tickers,
    filings: { recent: { accessionNumber, filingDate, form, primaryDocument }, ...(files === undefined ? {} : { files }) } };
}

/** Bound even a non-cooperative promise, and remove abort listeners on completion.
 * SEC helpers also receive the same signal, cancelling the actual HTTP/body I/O. */
export function awaitWithSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

/** The small getInsiderFilings loop is copied from secApi.ts to avoid its browser
 * dependencies. Amendments are included when their base form is requested. */
export function listRecentInsiderFilings(submission: InsiderSubmission, forms: readonly InsiderForm[] = ['3', '4', '5']): InsiderFiling[] {
  const recent = submission.filings.recent;
  const results: InsiderFiling[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (/^[345](?:\/A)?$/.test(recent.form[i]) && forms.includes(recent.form[i].split('/')[0] as InsiderForm)) {
      results.push({ accession: recent.accessionNumber[i], filedAt: recent.filingDate[i], formType: recent.form[i], primaryDocument: recent.primaryDocument[i] });
    }
  }
  return results.sort((a, b) => b.filedAt.localeCompare(a.filedAt) || b.accession.localeCompare(a.accession));
}

export function rawOwnershipPath(cik: string, filing: InsiderFiling): string {
  const parsedCik = parseCik(cik);
  const file = filing.primaryDocument.replace(/^xslF345X0\d\//i, '');
  if (parsedCik === null || !/^\d{10}-\d{2}-\d{6}$/.test(filing.accession) || !/^[A-Za-z0-9_.-]+\.xml$/i.test(file)) {
    throw new OwnershipXmlError('invalid-ownership-document-path');
  }
  return `/Archives/edgar/data/${parsedCik}/${filing.accession.replace(/-/g, '')}/${file}`;
}
function ownerKey(owner: InsiderOwner): string { return owner.cik ? `cik:${owner.cik}` : `name:${owner.name}`; }
interface ParsedFiling { filing: InsiderFiling; document: ParsedOwnershipXml }

export function aggregateInsiderOwners(rows: readonly InsiderTransaction[], filings: readonly ParsedFiling[] = []): InsiderOwnerAggregate[] {
  const owners = new Map<string, InsiderOwnerAggregate>();
  const accessionSets = new Map<string, Set<string>>();
  const ensure = (owner: InsiderOwner, relationship: InsiderRelationship) => {
    const key = ownerKey(owner);
    let aggregate = owners.get(key);
    if (!aggregate) {
      aggregate = { owner, relationship, filingsCount: 0, transactionsCount: 0, rowsWithoutShares: 0,
        netSharesOpenMarket: 0, netSharesAllCodes: 0, purchasesShares: 0, salesShares: 0,
        lastTransactionDate: null, lastTransactionCode: null, latestSharesOwnedAfter: null };
      owners.set(key, aggregate);
      accessionSets.set(key, new Set());
    }
    return aggregate;
  };
  // Documents are newest filed first: retain that filing's disclosed relationship,
  // and count Form 3/5 filings even when they contain only holdings or no securities.
  for (const { filing, document } of [...filings].sort((a, b) => b.filing.filedAt.localeCompare(a.filing.filedAt) || b.filing.accession.localeCompare(a.filing.accession))) {
    for (const { owner, relationship } of document.reportingOwners) {
      ensure(owner, relationship);
      accessionSets.get(ownerKey(owner))!.add(filing.accession);
    }
  }
  const ordered = rows.map((row, index) => ({ row, index })).sort((a, b) =>
    (b.row.transactionDate ?? '').localeCompare(a.row.transactionDate ?? '')
    || b.row.filedAt.localeCompare(a.row.filedAt) || b.row.accession.localeCompare(a.row.accession) || b.index - a.index);
  const latestSeen = new Set<string>();
  for (const { row } of ordered) {
    const aggregate = ensure(row.reportingOwner, row.relationship);
    const key = ownerKey(row.reportingOwner);
    accessionSets.get(key)!.add(row.accession);
    aggregate.transactionsCount++;
    if (!latestSeen.has(key)) {
      aggregate.lastTransactionDate = row.transactionDate;
      aggregate.lastTransactionCode = row.code;
      latestSeen.add(key);
    }
    if (!row.derivative && aggregate.latestSharesOwnedAfter === null && row.sharesOwnedAfter !== null) aggregate.latestSharesOwnedAfter = row.sharesOwnedAfter;
    if (row.shares === null) { aggregate.rowsWithoutShares++; continue; }
    if (row.derivative) continue;
    if (row.code === 'P') aggregate.purchasesShares += row.shares;
    if (row.code === 'S') aggregate.salesShares += row.shares;
    if (row.code === 'P' || row.code === 'S') {
      aggregate.netSharesOpenMarket += row.acquiredDisposed === 'A' ? row.shares : row.acquiredDisposed === 'D' ? -row.shares : 0;
    }
    aggregate.netSharesAllCodes += row.acquiredDisposed === 'A' ? row.shares : row.acquiredDisposed === 'D' ? -row.shares : 0;
  }
  for (const [key, owner] of owners) owner.filingsCount = accessionSets.get(key)!.size;
  return [...owners.values()];
}

export async function getInsiderTransactions(options: InsiderTransactionsOptions): Promise<InsiderTransactionsResult> {
  const numericCik = parseCik(String(options.cik));
  const maxFilings = options.maxFilings ?? 40;
  const forms = options.formTypes ?? ['3', '4', '5'];
  const deadlineMs = options.deadlineMs ?? 40_000;
  if (numericCik === null || !Number.isInteger(maxFilings) || maxFilings < 1 || maxFilings > 100
    || !forms.length || forms.some(form => !['3', '4', '5'].includes(form)) || !Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 40_000) {
    throw new RangeError('Invalid insider transactions options.');
  }
  const cik = String(numericCik);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Insider service deadline exceeded.', 'TimeoutError')), deadlineMs);
  const signal = controller.signal;
  const userAgent = options.userAgent || USER_AGENT;
  try {
    const payload = await awaitWithSignal(() => fetchSecJson({ upstream: 'data', path: `/submissions/CIK${cik.padStart(10, '0')}.json`, userAgent, maxBytes: 25 * 1024 * 1024, signal }), signal);
    const submission = parseInsiderSubmissionPayload(payload, cik);
    // Size-cap rejection retains the upstream helper's distinct 413 error.
    if (!submission) throw new SecUpstreamError('SEC submissions payload failed validation.', 502);
    const listed = listRecentInsiderFilings(submission, forms);
    const selected = listed.slice(0, maxFilings);
    const parsed: Array<ParsedFiling | undefined> = new Array(selected.length);
    const failures: Array<{ accession: string; reason: string } | undefined> = new Array(selected.length);
    const otherIssuers: Array<InsiderCoverage['filingsAboutOtherIssuers'][number] | undefined> = new Array(selected.length);
    let cursor = 0;
    let attempted = 0;
    async function worker() {
      while (!signal.aborted && cursor < selected.length) {
        const index = cursor++;
        const filing = selected[index];
        attempted++;
        try {
          const target = buildSecTargetUrl('proxy', rawOwnershipPath(cik, filing), new URLSearchParams());
          const response = await awaitWithSignal(() => fetchSecResponse(target, 'proxy', signal, userAgent), signal);
          if (!response.ok) throw new OwnershipXmlError(`http-status:${response.status}`);
          const bytes = await awaitWithSignal(() => readResponseWithLimit(response, 1024 * 1024, signal), signal);
          const document = parseOwnershipXml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          // A reporter CIK's submissions may contain filings about OTHER issuers.
          // Those cannot be presented as transactions in the requested company.
          if (document.issuer.cik !== cik) {
            // parseOwnershipXml requires both issuer fields; preserve their
            // disclosures without including this filing in issuer aggregates.
            otherIssuers[index] = { accession: filing.accession, issuerCik: document.issuer.cik!, issuerName: document.issuer.name! };
            continue;
          }
          if (document.formType.split('/')[0] !== filing.formType.split('/')[0]) throw new OwnershipXmlError('ownership-form-mismatch');
          parsed[index] = { filing, document };
        } catch (error) {
          failures[index] = { accession: filing.accession, reason: signal.aborted
            ? options.signal?.aborted ? 'request-cancelled' : 'service-deadline-exceeded'
            : error instanceof OwnershipXmlError ? error.reason
            : error instanceof SecUpstreamError ? `sec-upstream:${error.status}`
            : error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError') ? 'upstream-timeout'
            : 'fetch-or-parse-failed' };
        }
      }
    }
    await Promise.all([worker(), worker()]); // At most two XML fetch/body operations in flight.
    options.signal?.throwIfAborted();
    const successful = parsed.filter((entry): entry is ParsedFiling => Boolean(entry));
    const transactions = successful.flatMap(({ filing, document }) => document.transactions.map(row => ({
      ...row, accession: filing.accession, filedAt: filing.filedAt, formType: filing.formType, primaryDocument: filing.primaryDocument,
    })));
    const filingsFailed = failures.filter((entry): entry is { accession: string; reason: string } => Boolean(entry));
    const filingsAboutOtherIssuers = otherIssuers.filter((entry): entry is InsiderCoverage['filingsAboutOtherIssuers'][number] => Boolean(entry));
    return { cik, issuer: { name: submission.name, tradingSymbol: submission.tickers[0] ?? null }, transactions,
      owners: aggregateInsiderOwners(transactions, successful), coverage: {
        source: 'SEC submissions filings.recent and raw ownership XML', scope: 'requested-recent-filings', cik,
        filingsListed: listed.length, filingsRequested: selected.length, filingsParsed: successful.length,
        filingsAboutOtherIssuers, filingsAboutOtherIssuersCount: filingsAboutOtherIssuers.length,
        filingsFailed, filingsNotAttempted: selected.length - attempted, filingsOutsideLimit: listed.length - selected.length,
        transactionRows: transactions.length, rowsWithoutShares: transactions.filter(row => row.shares === null).length,
        holdingsRowsSkipped: successful.reduce((sum, entry) => sum + entry.document.holdingsRowsSkipped, 0),
        olderHistoryNotRead: true, unreadHistoryFiles: submission.filings.files?.length ?? 0,
        recentHistoryNote: 'Only filings.recent is read, covering all forms and often approximately 1000 rows but potentially many more for large filers. filings.files history segments are not read. Listed ownership filings may report on other issuers; those are counted separately.',
        oldestFiledAt: selected.at(-1)?.filedAt ?? null, newestFiledAt: selected[0]?.filedAt ?? null,
        complete: filingsFailed.length === 0 && successful.length + filingsAboutOtherIssuers.length === selected.length, fetchedAt: new Date().toISOString(),
        aggregationNote: 'Transactions and owner aggregates include only filings for the requested issuer; valid filings about other issuers are excluded and counted separately, not as failures. Non-derivative shares only: open-market net uses codes P/S; all-code net includes grants, withholding and exercises. Amendments are counted as filed, without restatement deduplication. Joint rows repeat for each owner and must not be summed across owners. Latest balance is one row, not total holdings.',
      } };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
