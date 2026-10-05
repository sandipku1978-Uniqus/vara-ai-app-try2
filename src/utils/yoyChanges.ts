/**
 * Year-over-year change matrix — the pure stages behind YoYChangeMatrix.
 *
 * Rows are the section taxonomy's concepts for the chosen form, grouped Items
 * / Notes / Proxy, so a concept added to the taxonomy becomes a row here with
 * no other change. Periods are the filer's own periods of report, never the
 * filing date (a 10-K filed in February belongs to the prior fiscal year).
 *
 * A cell is one of three things, and never a guess:
 * - a measured change between two slices that were both read;
 * - "not disclosed" in either period (nothing to compare is not "unchanged");
 * - "could not extract" when either period's slice could not be located —
 *   measuring against a slicer miss would report a fake "new section".
 */

import { computeSectionChange, type SectionChange } from './sectionDiff';
import { conceptsForForm, formFamily, locateSection, type SectionLocateOutcome } from './sectionTaxonomy';

export const YOY_FORMS = ['10-K', '20-F', 'DEF 14A'] as const;
export type YoYForm = typeof YOY_FORMS[number];

/** The slice of a company's EDGAR filing index this module reads. */
export interface YoYFilingIndex {
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

export interface ComparedPeriod {
  form: string;
  accession: string;
  primaryDocument: string;
  filingDate: string;
  /** Period of report; for a proxy, EDGAR's report date is the meeting date. */
  reportDate: string;
}

function isAmendment(form: string): boolean {
  return /\/A$/i.test(form.trim()) || /^DEFR14A$/i.test(form.trim());
}

function matchesYoYForm(filedForm: string, form: YoYForm): boolean {
  const root = filedForm.toUpperCase().replace(/\/A$/, '').replace(/\s+/g, ' ').trim();
  // A proxy compares definitive to definitive (a revision stands in for its
  // own period); a preliminary proxy is a draft of the same statement.
  if (form === 'DEF 14A') return root === 'DEF 14A' || root === 'DEFR14A';
  return formFamily(filedForm) === form;
}

/**
 * The filer's most recent periods of the form, newest first, one filing per
 * period of report. An amendment is the authoritative text for its period;
 * among equals the earlier-listed (newer) filing wins.
 */
export function pickComparablePeriods(submission: YoYFilingIndex, form: YoYForm, limit = 2): ComparedPeriod[] {
  const recent = submission.filings.recent;
  const byPeriod = new Map<string, { period: ComparedPeriod; amended: boolean }>();
  recent.form.forEach((filedForm, index) => {
    if (!matchesYoYForm(filedForm || '', form)) return;
    const reportDate = recent.reportDate?.[index] || '';
    const filingDate = recent.filingDate?.[index] || '';
    const key = reportDate || filingDate;
    const accession = recent.accessionNumber[index] || '';
    const primaryDocument = recent.primaryDocument[index] || '';
    if (!key || !accession || !primaryDocument) return;
    const amended = isAmendment(filedForm);
    const existing = byPeriod.get(key);
    if (existing && (existing.amended || !amended)) return;
    byPeriod.set(key, { period: { form: filedForm, accession, primaryDocument, filingDate, reportDate: key }, amended });
  });
  return Array.from(byPeriod.values())
    .map(entry => entry.period)
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, limit);
}

/** "FY2025" for annual reports, "2026 proxy" for a proxy season. */
export function periodLabel(period: ComparedPeriod, form: YoYForm): string {
  const year = period.reportDate.slice(0, 4);
  return form === 'DEF 14A' ? `${year} proxy` : `FY${year}`;
}

/** Every concept of the form, located in one period's filing text. */
export function locateConcepts(filingText: string, form: YoYForm): Record<string, SectionLocateOutcome> {
  const located: Record<string, SectionLocateOutcome> = {};
  for (const concept of conceptsForForm(form)) {
    located[concept.key] = locateSection(filingText, concept.key, form);
  }
  return located;
}

export type YoYCell =
  | { kind: 'change'; change: SectionChange; priorSlice: string; currentSlice: string }
  | { kind: 'not-disclosed'; detail: string }
  | { kind: 'could-not-extract'; detail: string };

/** One cell from the two periods' outcomes for a concept. */
export function yoyCell(prior: SectionLocateOutcome | undefined, current: SectionLocateOutcome | undefined): YoYCell {
  if (!prior || !current) return { kind: 'could-not-extract', detail: 'The section was not located in one of the periods.' };
  const unread = [
    prior.status === 'not-found' && prior.reason === 'could-not-extract' ? `Prior period: ${prior.detail}` : '',
    current.status === 'not-found' && current.reason === 'could-not-extract' ? `Current period: ${current.detail}` : '',
  ].filter(Boolean);
  if (unread.length > 0) return { kind: 'could-not-extract', detail: unread.join(' ') };
  if (prior.status !== 'found' && current.status !== 'found') {
    return { kind: 'not-disclosed', detail: 'Not disclosed in either period.' };
  }
  const priorSlice = prior.status === 'found' ? prior.text : '';
  const currentSlice = current.status === 'found' ? current.text : '';
  return { kind: 'change', change: computeSectionChange(priorSlice, currentSlice), priorSlice, currentSlice };
}

/** Cells for every concept of the form, from two periods' located concepts. */
export function yoyCells(
  form: YoYForm,
  prior: Record<string, SectionLocateOutcome>,
  current: Record<string, SectionLocateOutcome>,
): Record<string, YoYCell> {
  const cells: Record<string, YoYCell> = {};
  for (const concept of conceptsForForm(form)) cells[concept.key] = yoyCell(prior[concept.key], current[concept.key]);
  return cells;
}
