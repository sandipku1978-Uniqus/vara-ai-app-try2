/**
 * Cart bulk section download: one taxonomy concept ("Risk Factors", "MD&A",
 * …) sliced out of every selected filing, as one Word document with a page
 * per filing plus a CSV index.
 *
 * Text comes only from the shared /api/filing-text route (fetchFilingTextOutcome,
 * which the server paces against SEC's fair-access limit) and is sliced only by
 * the shared section slicer (sectionTaxonomy). Filings are read one at a time,
 * so a 50-filing cart is 50 sequential reads, never a burst.
 *
 * Every filing ends in an explicit state. `extracted` requires text the slicer
 * returned; a form the concept is not mapped for is `not-mapped`; a slicer
 * miss on text that was read is `not-found`; a read failure is `failed` with
 * its reason. None of these is ever rendered as an empty section.
 *
 * The slicer works on engine-normalized text (lowercase, punctuation
 * removed), so the downloaded section is labelled as that form, never passed
 * off as the filing's typography.
 */
import { HeadingLevel, Paragraph, TextRun, type Document } from 'docx';
import type { CartFiling } from './documentCart';
import { extractResolvedSection, resolveSectionScope, SECTION_CONCEPT_LIST } from '../utils/sectionTaxonomy';
import { describeFilingTextFailure, type FilingTextReadOutcome } from '../utils/sectionMatrix';
import { buildCsvRows } from '../utils/csv';
import { buildDocument, externalLink, labelledLine, pageBreak, safeFileStem, type DocxBlock } from './docxShared';

export type SectionSliceStatus = 'extracted' | 'not-mapped' | 'not-found' | 'failed';

export interface CartSectionSlice {
  filing: CartFiling;
  conceptKey: string;
  /** The label the slicer resolved for this filing's form, or the concept label. */
  sectionLabel: string;
  status: SectionSliceStatus;
  text: string;
  /** Primary document the text was read from, when one was read. */
  document: string;
  /** failed / not-mapped: why, in user-facing words. */
  reason?: string;
}

export function conceptLabel(conceptKey: string): string {
  return SECTION_CONCEPT_LIST.find(concept => concept.key === conceptKey)?.label || conceptKey;
}

/** Slice one filing's text at a concept, for that filing's own form. */
export function sliceFilingSection(
  filing: CartFiling,
  conceptKey: string,
  outcome: FilingTextReadOutcome,
  document: string,
): CartSectionSlice {
  const base = { filing, conceptKey, document };
  const resolved = resolveSectionScope(conceptKey, filing.form);
  if (!resolved) {
    return { ...base, sectionLabel: conceptLabel(conceptKey), status: 'not-mapped', text: '', reason: `${conceptLabel(conceptKey)} is not mapped for Form ${filing.form}` };
  }
  if (!outcome.ok) {
    return { ...base, sectionLabel: resolved.label, status: 'failed', text: '', reason: describeFilingTextFailure(outcome) };
  }
  if (!outcome.text.trim()) {
    return { ...base, sectionLabel: resolved.label, status: 'failed', text: '', reason: 'filing text was empty — retry' };
  }
  const text = extractResolvedSection(outcome.text, resolved).trim();
  return text
    ? { ...base, sectionLabel: resolved.label, status: 'extracted', text }
    : { ...base, sectionLabel: resolved.label, status: 'not-found', text: '', reason: 'the section boundary was not found in the filing text' };
}

export interface CollectDeps {
  resolvePrimaryDocument: (cik: string, accessionNumber: string) => Promise<string>;
  fetchText: (cik: string, accessionNumber: string, primaryDocument: string, options: { signal?: AbortSignal }) => Promise<FilingTextReadOutcome>;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Read and slice every cart filing, sequentially. */
export async function collectSectionSlices(
  filings: readonly CartFiling[],
  conceptKey: string,
  deps: CollectDeps,
): Promise<CartSectionSlice[]> {
  const slices: CartSectionSlice[] = [];
  for (const [index, filing] of filings.entries()) {
    if (deps.signal?.aborted) break;
    // Skip the read entirely when the slicer has no mapping for this form.
    if (!resolveSectionScope(conceptKey, filing.form)) {
      slices.push(sliceFilingSection(filing, conceptKey, { ok: true, text: '' }, ''));
      deps.onProgress?.(index + 1, filings.length);
      continue;
    }
    let document = filing.primaryDocument || '';
    let outcome: FilingTextReadOutcome;
    try {
      if (!document) document = await deps.resolvePrimaryDocument(filing.cik, filing.accessionNumber);
      outcome = document
        ? await deps.fetchText(filing.cik, filing.accessionNumber, document, { signal: deps.signal })
        : { ok: false, kind: 'not-found', retryable: false };
    } catch {
      outcome = { ok: false, kind: 'upstream', retryable: true };
    }
    slices.push(sliceFilingSection(filing, conceptKey, outcome, document));
    deps.onProgress?.(index + 1, filings.length);
  }
  return slices;
}

const STATUS_LABEL: Record<SectionSliceStatus, string> = {
  extracted: 'Extracted',
  'not-mapped': 'Not mapped for this form',
  'not-found': 'Not found in filing text',
  failed: 'Could not read filing',
};

export function sectionIndexRows(slices: readonly CartSectionSlice[]): Array<Array<string | number>> {
  return [
    ['Page', 'Company', 'Ticker', 'Form', 'Filed', 'CIK', 'Accession', 'Section', 'Status', 'Reason', 'Characters', 'Document read', 'SEC URL'],
    ...slices.map((slice, index) => [
      index + 1,
      slice.filing.company,
      slice.filing.ticker || '',
      slice.filing.form,
      slice.filing.fileDate,
      slice.filing.cik,
      slice.filing.accessionNumber,
      slice.sectionLabel,
      STATUS_LABEL[slice.status],
      slice.reason || '',
      slice.text.length,
      slice.document,
      slice.filing.sourceUrl,
    ]),
  ];
}

export function buildSectionIndexCsv(slices: readonly CartSectionSlice[]): string {
  return `${buildCsvRows(sectionIndexRows(slices))}\r\n`;
}

const PARAGRAPH_CHARS = 1200;

/**
 * The slicer returns one run of normalized text; break it on word boundaries
 * into readable blocks. Breaks are presentation only — no text is dropped.
 */
export function chunkSliceText(text: string, limit = PARAGRAPH_CHARS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > limit) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function sliceParagraphs(text: string): Paragraph[] {
  return chunkSliceText(text).map(part => new Paragraph({ children: [new TextRun({ text: part })], spacing: { after: 120 } }));
}

export function buildSectionDocument(slices: readonly CartSectionSlice[], conceptKey: string, generatedAt: Date): Document {
  const label = conceptLabel(conceptKey);
  const extracted = slices.filter(slice => slice.status === 'extracted').length;
  const children: DocxBlock[] = [
    new Paragraph({ text: `${label} — ${slices.length} selected filing${slices.length === 1 ? '' : 's'}`, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    labelledLine('Generated', generatedAt.toISOString()),
    labelledLine('Extracted', `${extracted} of ${slices.length}; every other filing names why below and in the CSV index`),
    labelledLine('Method', 'Filing text read through the app’s shared filing-text route and sliced by the section taxonomy for each filing’s own form.'),
    labelledLine('Text form', 'Normalized section text (lowercase, punctuation removed) — the same form section-scoped search and the YoY change matrix measure. Open each SEC link for the filing’s own typography.'),
  ];

  slices.forEach((slice, index) => {
    children.push(pageBreak());
    children.push(new Paragraph({
      text: `${index + 1}. ${slice.filing.company}${slice.filing.ticker ? ` (${slice.filing.ticker})` : ''} — Form ${slice.filing.form}, filed ${slice.filing.fileDate}`,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }));
    children.push(labelledLine('Section', slice.sectionLabel));
    children.push(labelledLine('Accession', slice.filing.accessionNumber));
    children.push(labelledLine('Source', [externalLink(slice.filing.sourceUrl, slice.filing.sourceUrl)]));
    if (slice.status === 'extracted') {
      children.push(...sliceParagraphs(slice.text));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: `${STATUS_LABEL[slice.status]} — ${slice.reason || 'no further detail'}.`, italics: true })],
        spacing: { before: 120 },
      }));
    }
  });

  return buildDocument(children, `${label} — section download`);
}

export function sectionFileStem(conceptKey: string, date: Date): string {
  return `URC_${safeFileStem(conceptLabel(conceptKey), 'section')}_${date.toISOString().slice(0, 10)}`;
}
