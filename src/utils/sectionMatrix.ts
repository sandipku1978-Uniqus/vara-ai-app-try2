/**
 * Section Matrix — verified section presence, one filing per company.
 *
 * The matrix used to mark every section present whenever the company had any
 * filing of the form. No document was read, yet the grid read as section
 * presence and exported to CSV as workpaper evidence (2026-09 audit, High).
 *
 * A mark now traces to a specific document. The company's latest filing of
 * the form is read through the shared filing-text route and sliced with the
 * SAME Item/heading slicer the YoY Changes view and the section-scope filter
 * use (sectionTaxonomy → sectionPath). Nothing here is a second extractor.
 *
 * Every cell carries an explicit state. `present` is only ever derived from
 * text that was actually read; a fetch failure is `failed` with its reason,
 * never `absent`; a company without a filing of the form is `no-filing`; and
 * a filing nobody has read yet is `not-checked`.
 */

import { normalizeItemNumber } from './sectionPath';
import { extractResolvedSection, formFamily, type ResolvedSectionScope } from './sectionTaxonomy';

export const SECTION_MATRIX_FORMS = ['10-K', '10-Q', '20-F', 'S-1'] as const;
export type SectionMatrixForm = typeof SECTION_MATRIX_FORMS[number];

/**
 * The rows of each form's matrix. Every row resolves to a slicer scope (the
 * unit test pins this): "Signatures" has no Item number and no prospectus
 * heading in the slicer's vocabulary, and bare "Business"/"Management" on an
 * S-1 appear in prose constantly, so those rows are not offered rather than
 * approximated.
 */
export const SECTION_MATRIX_ROWS: Readonly<Record<SectionMatrixForm, readonly string[]>> = {
  '10-K': [
    'Item 1. Business',
    'Item 1A. Risk Factors',
    'Item 1B. Unresolved Staff Comments',
    'Item 1C. Cybersecurity',
    'Item 2. Properties',
    'Item 3. Legal Proceedings',
    'Item 4. Mine Safety Disclosures',
    'Item 5. Market for Registrant\'s Common Equity',
    'Item 6. [Reserved]',
    'Item 7. Management\'s Discussion & Analysis',
    'Item 7A. Quantitative & Qualitative Disclosures About Market Risk',
    'Item 8. Financial Statements',
    'Item 9. Changes in and Disagreements With Accountants',
    'Item 9A. Controls and Procedures',
    'Item 9B. Other Information',
    'Item 9C. Disclosure Regarding Foreign Jurisdictions',
    'Item 10. Directors, Executive Officers and Corporate Governance',
    'Item 11. Executive Compensation',
    'Item 12. Security Ownership',
    'Item 13. Certain Relationships and Related Transactions',
    'Item 14. Principal Accountant Fees and Services',
    'Item 15. Exhibits and Financial Statement Schedules',
  ],
  '10-Q': [
    'Part I, Item 1. Financial Statements',
    'Part I, Item 2. MD&A',
    'Part I, Item 3. Quantitative & Qualitative Disclosures',
    'Part I, Item 4. Controls and Procedures',
    'Part II, Item 1. Legal Proceedings',
    'Part II, Item 1A. Risk Factors',
    'Part II, Item 2. Unregistered Sales',
    'Part II, Item 5. Other Information',
    'Part II, Item 6. Exhibits',
  ],
  '20-F': [
    'Item 1. Identity of Directors, Senior Management',
    'Item 2. Offer Statistics and Expected Timetable',
    'Item 3. Key Information',
    'Item 4. Information on the Company',
    'Item 5. Operating and Financial Review',
    'Item 6. Directors, Senior Management and Employees',
    'Item 7. Major Shareholders and Related Party Transactions',
    'Item 8. Financial Information',
    'Item 9. The Offer and Listing',
    'Item 10. Additional Information',
    'Item 11. Quantitative and Qualitative Disclosures',
    'Item 12. Description of Securities',
    'Item 15. Controls and Procedures',
    'Item 16. [Reserved]',
    'Item 17. Financial Statements',
    'Item 18. Financial Statements',
    'Item 19. Exhibits',
  ],
  'S-1': [
    'Part I — Prospectus Summary',
    'Part I — Risk Factors',
    'Part I — Use of Proceeds',
    'Part I — Dividend Policy',
    'Part I — Capitalization',
    'Part I — Dilution',
    'Part I — MD&A',
    'Part I — Executive Compensation',
    'Part I — Principal Stockholders',
    'Part I — Description of Capital Stock',
    'Part I — Shares Eligible for Future Sale',
    'Part I — Underwriting',
    'Part II — Legal Matters',
    'Part II — Experts',
    'Part II — Financial Statements',
  ],
};

/**
 * Registration statements name sections by heading. Each row maps to the
 * heading aliases the slicer's prospectus vocabulary already recognises —
 * the same vocabulary that bounds section-scoped Boolean search on an S-1.
 */
const S1_ROW_HEADINGS: Readonly<Record<string, readonly string[]>> = {
  'Part I — Prospectus Summary': ['prospectus summary'],
  'Part I — Risk Factors': ['risk factors'],
  'Part I — Use of Proceeds': ['use of proceeds'],
  'Part I — Dividend Policy': ['dividend policy'],
  'Part I — Capitalization': ['capitalization'],
  'Part I — Dilution': ['dilution'],
  'Part I — MD&A': [
    "management's discussion and analysis of financial condition and results of operations",
    "management's discussion and analysis",
  ],
  'Part I — Executive Compensation': ['executive compensation'],
  'Part I — Principal Stockholders': ['principal stockholders', 'principal and selling stockholders'],
  'Part I — Description of Capital Stock': ['description of capital stock'],
  'Part I — Shares Eligible for Future Sale': ['shares eligible for future sale'],
  'Part I — Underwriting': ['underwriting', 'plan of distribution'],
  'Part II — Legal Matters': ['legal matters'],
  'Part II — Experts': ['experts'],
  'Part II — Financial Statements': ['index to financial statements'],
};

const ITEM_ROW_RE = /^Item (\d{1,2}[A-C]?)\./;
const PART_ITEM_ROW_RE = /^Part (I|II), Item (\d{1,2}[A-C]?)\./;

/** The slicer scope for one matrix row, or null when no slicer covers it. */
export function sectionMatrixScope(form: SectionMatrixForm, label: string): ResolvedSectionScope | null {
  if (form === 'S-1') {
    const headings = S1_ROW_HEADINGS[label];
    return headings ? { kind: 'heading', headings: [...headings], label } : null;
  }
  if (form === '10-Q') {
    const match = label.match(PART_ITEM_ROW_RE);
    const item = match ? normalizeItemNumber(match[2]) : '';
    if (!item) return null;
    return { kind: 'item', item, options: { part: match![1] === 'I' ? 1 : 2 }, label };
  }
  const match = label.match(ITEM_ROW_RE);
  const item = match ? normalizeItemNumber(match[1]) : '';
  return item ? { kind: 'item', item, options: {}, label } : null;
}

/** The shape of a company's EDGAR filing index that the matrix needs. */
export interface SectionMatrixFilingIndex {
  cik: string | number;
  filings: {
    recent: {
      form: string[];
      accessionNumber: string[];
      primaryDocument: string[];
      filingDate?: string[];
      reportDate?: string[];
    };
  };
}

/** The document whose text decided a company's column. */
export interface SectionMatrixSource {
  cik: string;
  form: string;
  /** As filed, dashed: 0000320193-26-000002. */
  accession: string;
  primaryDocument: string;
  filingDate: string;
  reportDate: string;
}

function matchesMatrixForm(form: string, target: SectionMatrixForm): boolean {
  const root = (form || '').toUpperCase().replace(/\/A$/, '').trim();
  // The registration family also covers F-1 and 424B prospectuses; the "S-1"
  // matrix reads an S-1, not a prospectus that happens to share its headings.
  if (target === 'S-1') return root === 'S-1';
  return formFamily(form) === target;
}

/**
 * The latest filing of the form to read for a company. Amendments are read
 * only when nothing else exists: a 10-K/A is usually a partial document
 * (Part III alone is common), and reading it would report Items 1–9 absent
 * when the original filing carries them.
 */
export function pickSectionMatrixFiling(
  submission: SectionMatrixFilingIndex,
  form: SectionMatrixForm,
): SectionMatrixSource | null {
  const recent = submission.filings.recent;
  let amendment: SectionMatrixSource | null = null;
  for (let index = 0; index < recent.form.length; index += 1) {
    const filedForm = recent.form[index] || '';
    if (!matchesMatrixForm(filedForm, form)) continue;
    const source: SectionMatrixSource = {
      cik: String(submission.cik),
      form: filedForm,
      accession: recent.accessionNumber[index] || '',
      primaryDocument: recent.primaryDocument[index] || '',
      filingDate: recent.filingDate?.[index] || '',
      reportDate: recent.reportDate?.[index] || '',
    };
    if (!source.accession || !source.primaryDocument) continue;
    if (/\/A$/i.test(filedForm.trim())) {
      amendment = amendment ?? source;
      continue;
    }
    return source;
  }
  return amendment;
}

export type SectionMatrixState = 'present' | 'absent' | 'not-checked' | 'no-filing' | 'failed';

export interface SectionPresence {
  state: 'present' | 'absent';
  /** The first words of the slice the extractor returned, in its normalized form. */
  excerpt?: string;
}

const EXCERPT_CHARS = 140;

/**
 * Section presence for one filing's text: a row is present when the shared
 * slicer returns a slice for it, absent when it returns nothing. The excerpt
 * is what was matched, so a mark can be read back to the words behind it.
 */
export function deriveSectionPresence(
  form: SectionMatrixForm,
  rows: readonly string[],
  filingText: string,
): Record<string, SectionPresence> {
  const result: Record<string, SectionPresence> = {};
  for (const label of rows) {
    const scope = sectionMatrixScope(form, label);
    if (!scope) continue;
    const slice = extractResolvedSection(filingText, scope);
    result[label] = slice
      ? { state: 'present', excerpt: slice.slice(0, EXCERPT_CHARS) }
      : { state: 'absent' };
  }
  return result;
}

/** What fetchFilingTextOutcome reports, in the shape this module needs. */
export type FilingTextReadOutcome =
  | { ok: true; text: string }
  | {
      ok: false;
      kind: 'not-found' | 'unsupported' | 'rate-limit' | 'timeout' | 'upstream' | 'cancelled';
      status?: number;
      retryable: boolean;
    };

/** A short, user-facing reason for a failed read; retryable kinds say so. */
export function describeFilingTextFailure(failure: Extract<FilingTextReadOutcome, { ok: false }>): string {
  switch (failure.kind) {
    case 'rate-limit': return 'rate limited — retry';
    case 'timeout': return 'timed out — retry';
    case 'not-found': return 'document not found on EDGAR';
    case 'unsupported': return 'document format not supported';
    case 'cancelled': return 'read cancelled';
    default: {
      const status = failure.status ? ` (HTTP ${failure.status})` : '';
      return failure.retryable ? `SEC fetch failed${status} — retry` : `SEC fetch failed${status}`;
    }
  }
}

/** One company's verification record for one form. */
export type CompanyVerification =
  | { status: 'no-filing' }
  | { status: 'not-checked'; source: SectionMatrixSource }
  | { status: 'checking'; source: SectionMatrixSource }
  | { status: 'verified'; source: SectionMatrixSource; sections: Record<string, SectionPresence> }
  | { status: 'failed'; source?: SectionMatrixSource; reason: string; retryable: boolean };

/** The record a company starts with before anyone reads its filing. */
export function initialVerification(
  submission: SectionMatrixFilingIndex | undefined,
  form: SectionMatrixForm,
): CompanyVerification {
  if (!submission) return { status: 'failed', reason: 'company filing index not loaded', retryable: false };
  const source = pickSectionMatrixFiling(submission, form);
  return source ? { status: 'not-checked', source } : { status: 'no-filing' };
}

/**
 * Turn a filing-text read into the company's record. This is the only path
 * to `verified`, and it requires text: a failure keeps its reason, and an
 * empty body is a failure too — never a column of "absent".
 */
export function verificationFromOutcome(
  form: SectionMatrixForm,
  rows: readonly string[],
  source: SectionMatrixSource,
  outcome: FilingTextReadOutcome,
): CompanyVerification {
  if (!outcome.ok) {
    return { status: 'failed', source, reason: describeFilingTextFailure(outcome), retryable: outcome.retryable };
  }
  if (!outcome.text.trim()) {
    return { status: 'failed', source, reason: 'filing text was empty — retry', retryable: true };
  }
  return { status: 'verified', source, sections: deriveSectionPresence(form, rows, outcome.text) };
}

export interface SectionMatrixCell {
  state: SectionMatrixState;
  /** The document behind the verdict; absent for no-filing and unloaded companies. */
  source?: SectionMatrixSource;
  /** present: the matched words, normalized. */
  excerpt?: string;
  /** failed: why. */
  reason?: string;
  /** not-checked: the filing is being read right now. */
  checking?: boolean;
}

/** The grid — data[section][ticker] — from each company's record. */
export function buildSectionMatrixCells(
  rows: readonly string[],
  tickers: readonly string[],
  verificationFor: (ticker: string) => CompanyVerification | undefined,
): Record<string, Record<string, SectionMatrixCell>> {
  const records = new Map(tickers.map(ticker => [ticker, verificationFor(ticker)] as const));
  const grid: Record<string, Record<string, SectionMatrixCell>> = {};
  for (const label of rows) {
    grid[label] = {};
    for (const ticker of tickers) {
      const record = records.get(ticker);
      if (!record) { grid[label][ticker] = { state: 'not-checked' }; continue; }
      switch (record.status) {
        case 'no-filing':
          grid[label][ticker] = { state: 'no-filing' };
          break;
        case 'not-checked':
          grid[label][ticker] = { state: 'not-checked', source: record.source };
          break;
        case 'checking':
          grid[label][ticker] = { state: 'not-checked', source: record.source, checking: true };
          break;
        case 'failed':
          grid[label][ticker] = { state: 'failed', source: record.source, reason: record.reason };
          break;
        case 'verified': {
          const presence = record.sections[label];
          grid[label][ticker] = presence
            ? { state: presence.state, source: record.source, excerpt: presence.excerpt }
            : { state: 'not-checked', source: record.source };
          break;
        }
      }
    }
  }
  return grid;
}

export interface VerificationSummary {
  /** Companies with a filing of the form to read. */
  withFiling: number;
  read: number;
  failed: number;
  /** Failed reads that a retry could still clear. */
  retryable: number;
  checking: number;
  unread: number;
  noFiling: number;
  /** Companies whose filing index never loaded (no source to read). */
  unavailable: number;
}

export function summarizeVerification(records: readonly CompanyVerification[]): VerificationSummary {
  const summary: VerificationSummary = {
    withFiling: 0, read: 0, failed: 0, retryable: 0, checking: 0, unread: 0, noFiling: 0, unavailable: 0,
  };
  for (const record of records) {
    switch (record.status) {
      case 'no-filing': summary.noFiling += 1; break;
      case 'not-checked': summary.withFiling += 1; summary.unread += 1; break;
      case 'checking': summary.withFiling += 1; summary.checking += 1; break;
      case 'verified': summary.withFiling += 1; summary.read += 1; break;
      case 'failed':
        if (record.source) {
          summary.withFiling += 1;
          summary.failed += 1;
          if (record.retryable) summary.retryable += 1;
        } else {
          summary.unavailable += 1;
        }
        break;
    }
  }
  return summary;
}

/** CSV wording for a cell's state. */
export function describeCellState(cell: SectionMatrixCell | undefined): string {
  if (!cell) return 'not checked';
  switch (cell.state) {
    case 'present': return 'present';
    case 'absent': return 'absent';
    case 'no-filing': return 'no filing';
    case 'failed': return `failed: ${cell.reason || 'unknown error'}`;
    default: return 'not checked';
  }
}

/** CSV wording for the document behind a cell: "10-K 0000320193-26-000002 aapl-20250927.htm". */
export function describeCellSource(cell: SectionMatrixCell | undefined): string {
  const source = cell?.source;
  return source ? `${source.form} ${source.accession} ${source.primaryDocument}` : '';
}

/**
 * The export: one state column and one source column per company, so a row
 * in the workpaper says both what was concluded and which document it was
 * concluded from.
 */
export function buildSectionMatrixCsvRows(
  rows: readonly string[],
  tickers: readonly string[],
  cells: Record<string, Record<string, SectionMatrixCell>>,
): string[][] {
  const headers = ['Section', ...tickers.flatMap(ticker => [ticker, `${ticker} source`])];
  const body = rows.map(label => [
    label,
    ...tickers.flatMap(ticker => {
      const cell = cells[label]?.[ticker];
      return [describeCellState(cell), describeCellSource(cell)];
    }),
  ]);
  return [headers, ...body];
}

export interface CellLabels {
  /** Accessible name of the mark. */
  label: string;
  /** Hover text with the evidence behind the mark. */
  title: string;
}

/** Distinct, evidence-naming labels for each state. */
export function sectionMatrixCellLabels(
  section: string,
  ticker: string,
  form: SectionMatrixForm,
  cell: SectionMatrixCell | undefined,
): CellLabels {
  const source = cell?.source;
  const filedForm = source?.form || form;
  const document = source ? `${filedForm} ${source.accession}` : filedForm;
  const fileName = source ? ` (${source.primaryDocument})` : '';
  if (!cell || cell.state === 'not-checked') {
    if (cell?.checking) {
      return { label: `${section}: checking ${ticker}'s ${document}`, title: `Reading ${document}${fileName}…` };
    }
    if (source) {
      return {
        label: `${section}: not checked for ${ticker} — ${document} not read yet`,
        title: `${document}${fileName} has not been read yet — use Verify sections`,
      };
    }
    return { label: `${section}: not checked for ${ticker}`, title: 'Company filing index not loaded yet' };
  }
  switch (cell.state) {
    case 'present':
      return {
        label: `${section}: found in ${ticker}'s ${document}`,
        title: `Found in ${document}${fileName}. Matched (normalized text): “${cell.excerpt || ''}…”`,
      };
    case 'absent':
      return {
        label: `${section}: not found in ${ticker}'s ${document}`,
        title: `Heading not found in the text of ${document}${fileName} — open the filing before treating this as an omission`,
      };
    case 'no-filing':
      return {
        label: `${section}: no ${form} filing on record for ${ticker}`,
        title: `No ${form} on EDGAR for ${ticker}`,
      };
    default:
      return {
        label: `${section}: could not be checked for ${ticker} — ${cell.reason || 'unknown error'}`,
        title: `${document}${fileName} could not be read: ${cell.reason || 'unknown error'}`,
      };
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order.
 * Workers are expected to resolve (the matrix worker converts its own errors
 * into a failed record); a rejection propagates like Promise.all.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}
