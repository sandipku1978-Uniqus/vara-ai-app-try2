/**
 * Footnote-level comparison: one note topic, a peer set, each company's note
 * side by side with its tables, aligned by fiscal period.
 *
 * Alignment uses the filing's PERIOD OF REPORT, never the filing date: a
 * 10-K filed in February 2026 reports fiscal 2025, and a September fiscal
 * year-end filer's FY2025 sits next to a December filer's FY2025. A filing
 * with no period of report on EDGAR is left out rather than placed by its
 * filing date.
 *
 * Each company's note is found the most exact way available:
 * 1. the registrant's own tagged XBRL note block (FilingSummary.xml → R*.htm),
 *    when a block's name is the note's title — exact boundaries, exact tables;
 * 2. otherwise the taxonomy's note slicer over the primary document's text,
 *    with the document's HTML tables that fall inside the located note.
 * The result carries one of four statuses: disclosed, not disclosed (text
 * read, no such note), could not extract (text unavailable, or the note is
 * mentioned but could not be bounded), or no filing for the period.
 */

import { extractTablesFromHtml, type ExtractedTable } from './filingDetailTools';

import { extractTextFromNode, stripSgmlEnvelope } from '../lib/filingText';
import {
  filingBlockPath,
  filingSummaryPath,
  parseFilingSummary,
  stripXbrlReportChrome,
  type FilingReport,
} from './filingStructure';
import { normalizeHeading } from '../utils/sectionBlocks';
import { findSectionConcept, formFamily, locateSection } from '../utils/sectionTaxonomy';

/** HTML → text with the shared extractor (the same one every reader of filings uses). */
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body ? extractTextFromNode(doc.body as unknown as Parameters<typeof extractTextFromNode>[0]) : '';
}

/** The peer-set cap shared with the rest of Benchmarking. */
export const FOOTNOTE_COMPANY_CAP = 20;

export interface FootnoteFilingIndex {
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

export interface AnnualFiling {
  form: string;
  accession: string;
  primaryDocument: string;
  filingDate: string;
  /** Period of report, YYYY-MM-DD. */
  reportDate: string;
}

/** Fiscal year of a period of report. */
export function fiscalYearOf(filing: Pick<AnnualFiling, 'reportDate'>): number {
  return Number(filing.reportDate.slice(0, 4));
}

/**
 * A company's annual reports (10-K, 20-F), one per period of report, newest
 * first. An original wins its period over an amendment: a 10-K/A is usually
 * a partial document (Part III alone is common) without the notes.
 */
export function annualFilings(index: FootnoteFilingIndex): AnnualFiling[] {
  const recent = index.filings.recent;
  const byPeriod = new Map<string, { filing: AnnualFiling; amended: boolean }>();
  recent.form.forEach((form, position) => {
    const family = formFamily(form || '');
    if (family !== '10-K' && family !== '20-F') return;
    const reportDate = recent.reportDate?.[position] || '';
    const accession = recent.accessionNumber[position] || '';
    const primaryDocument = recent.primaryDocument[position] || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !accession || !primaryDocument) return;
    const amended = /\/A$/i.test(form.trim());
    const existing = byPeriod.get(reportDate);
    if (existing && (!existing.amended || amended)) return;
    byPeriod.set(reportDate, {
      filing: { form, accession, primaryDocument, filingDate: recent.filingDate?.[position] || '', reportDate },
      amended,
    });
  });
  return Array.from(byPeriod.values())
    .map(entry => entry.filing)
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate));
}

/** Fiscal years any company in the set has an annual report for, newest first. */
export function availableFiscalYears(indexes: readonly FootnoteFilingIndex[]): number[] {
  const years = new Set<number>();
  for (const index of indexes) for (const filing of annualFilings(index)) years.add(fiscalYearOf(filing));
  return [...years].sort((a, b) => b - a);
}

/** The annual report for a fiscal year ('latest' = the company's newest). */
export function pickFilingForPeriod(index: FootnoteFilingIndex, fiscalYear: number | 'latest'): AnnualFiling | null {
  const filings = annualFilings(index);
  if (fiscalYear === 'latest') return filings[0] ?? null;
  return filings.find(filing => fiscalYearOf(filing) === fiscalYear) ?? null;
}

export type FootnoteStatus = 'disclosed' | 'not-disclosed' | 'could-not-extract' | 'no-filing';

export interface FootnoteResult {
  status: FootnoteStatus;
  /** The note as the filing wrote it (disclosed only). */
  text?: string;
  tables: ExtractedTable[];
  /** The heading or tagged block name the note was found under. */
  heading?: string;
  /** How it was found: the registrant's tagged block, or the text slicer. */
  via?: 'xbrl-block' | 'text';
  /** The document behind the result. */
  source?: AnnualFiling;
  /** The exact archive file the text came from (R*.htm or the primary document). */
  sourceFile?: string;
  /** One sentence for the reader: why this status. */
  detail: string;
  truncated?: boolean;
}

export const FOOTNOTE_STATUS_LABELS: Record<FootnoteStatus, string> = {
  disclosed: 'Disclosed',
  'not-disclosed': 'Not disclosed',
  'could-not-extract': 'Could not extract',
  'no-filing': 'No filing for period',
};

/** A table row this wide is a rendering wrapper (an R-file's outer table), not a note table. */
const WRAPPER_CELL_CHARS = 1500;
export const FOOTNOTE_MAX_TABLES = 12;

/** The note's own tables from its HTML, without the R-file's wrapper table. */
export function noteTables(html: string): ExtractedTable[] {
  return extractTablesFromHtml(html)
    .filter(table => !table.rows.some(row => row.some(cell => cell.length > WRAPPER_CELL_CHARS)))
    .slice(0, FOOTNOTE_MAX_TABLES);
}

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The document's tables that sit inside a located note: a table belongs to the
 * note when its full text appears within the note's text (both from the same
 * extractor). Short tables ("2025 2024") are too generic to place and are
 * skipped rather than attributed to the wrong note.
 */
export function tablesWithinText(html: string, noteText: string): ExtractedTable[] {
  const haystack = squash(noteText);
  if (!haystack) return [];
  return extractTablesFromHtml(html)
    .filter(table => {
      const body = squash(table.rows.map(row => row.join(' ')).join(' '));
      return body.length >= 40 && haystack.includes(body);
    })
    .slice(0, FOOTNOTE_MAX_TABLES);
}

/**
 * Does a tagged block's name title this note? Its name with the "(Notes)" /
 * "(Policies)" suffix removed must BE one of the concept's headings, or start
 * with one ("Leases and Right-of-Use Assets"); "Unearned Revenue" does not
 * title the revenue note.
 */
export function blockTitlesConcept(shortName: string, headings: readonly string[]): boolean {
  if (/\((?:detail|details|tables|polic)/i.test(shortName) || /parenthetical/i.test(shortName)) return false;
  const name = normalizeHeading(shortName.replace(/\([^)]*\)\s*$/, ''));
  return headings.some(heading => {
    const alias = normalizeHeading(heading.replace(/\$$/, ''));
    return alias.length > 2 && (name === alias || name.startsWith(`${alias} `));
  });
}

/** Fetches an EDGAR archive path; resolves to the body, or rejects on failure. */
export type ArchiveLoader = (path: string) => Promise<string>;

const MIN_NOTE_CHARS = 200;

/**
 * One company's note for a concept. Network failures on the tagged-block route
 * are not verdicts — the text route still runs; a failure to read the primary
 * document is "could not extract", never "not disclosed".
 */
export async function locateFootnote(options: {
  conceptKey: string;
  cik: string;
  filing: AnnualFiling | null;
  load: ArchiveLoader;
}): Promise<FootnoteResult> {
  const { conceptKey, cik, filing, load } = options;
  const concept = findSectionConcept(conceptKey);
  if (!concept) return { status: 'could-not-extract', tables: [], detail: 'Unknown note topic.' };
  if (!filing) return { status: 'no-filing', tables: [], detail: 'No annual report on EDGAR for this fiscal period.' };

  // 1. The registrant's own tagged note.
  let reports: FilingReport[] = [];
  try {
    reports = parseFilingSummary(await load(filingSummaryPath(cik, filing.accession)));
  } catch {
    reports = [];
  }
  const titled = reports.filter(report => blockTitlesConcept(report.shortName, concept.headings));
  for (const report of titled.slice(0, 2)) {
    try {
      const html = stripSgmlEnvelope(await load(filingBlockPath(cik, filing.accession, report.file)));
      const text = stripXbrlReportChrome(htmlToText(html));
      if (text.length < MIN_NOTE_CHARS) continue;
      return {
        status: 'disclosed',
        text,
        tables: noteTables(html),
        heading: report.shortName,
        via: 'xbrl-block',
        source: filing,
        sourceFile: report.file,
        detail: `Tagged by the registrant as “${report.shortName}”.`,
      };
    } catch {
      // A block that will not load is not a verdict on the note.
    }
  }

  // 2. The taxonomy's note slicer over the primary document.
  let html: string;
  try {
    html = stripSgmlEnvelope(await load(`Archives/edgar/data/${Number(cik)}/${filing.accession.replace(/-/g, '')}/${filing.primaryDocument}`));
  } catch {
    return { status: 'could-not-extract', tables: [], source: filing, detail: 'The filing could not be read from EDGAR — retry.' };
  }
  const text = htmlToText(html);
  const outcome = locateSection(text, conceptKey, filing.form);
  if (outcome.status === 'found') {
    const noteText = outcome.rawText ?? outcome.text;
    return {
      status: 'disclosed',
      text: noteText,
      tables: tablesWithinText(html, noteText),
      heading: outcome.heading,
      via: 'text',
      source: filing,
      sourceFile: filing.primaryDocument,
      truncated: outcome.truncated,
      detail: outcome.heading ? `Found under the heading “${outcome.heading}”.` : 'Located in the filing text.',
    };
  }
  return {
    status: outcome.reason === 'not-disclosed' ? 'not-disclosed' : 'could-not-extract',
    tables: [],
    source: filing,
    sourceFile: filing.primaryDocument,
    detail: titled.length > 0
      ? `${outcome.detail} (A tagged block named for this note could not be read.)`
      : outcome.detail,
  };
}
