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
 * The downloaded section is in the filing's own words — case, punctuation
 * and line breaks as filed — through extractResolvedSectionOriginal, which
 * maps the slicer's exact boundaries back onto the original text. When that
 * mapping cannot be made exactly (it never approximates), the filing falls
 * back to the normalized slice (lowercase, punctuation removed) and its page
 * and CSV row say so, so normalized text is never passed off as the filing's
 * typography.
 */
import { HeadingLevel, Paragraph, TextRun, type Document } from 'docx';
import type { CartFiling } from './documentCart';
import { extractResolvedSection, extractResolvedSectionOriginal, resolveSectionScope, SECTION_CONCEPT_LIST } from '../utils/sectionTaxonomy';
import { describeFilingTextFailure, type FilingTextReadOutcome } from '../utils/sectionMatrix';
import { buildCsvRows } from '../utils/csv';
import { buildDocument, externalLink, labelledLine, pageBreak, safeFileStem, type DocxBlock } from './docxShared';

export type SectionSliceStatus = 'extracted' | 'not-mapped' | 'not-found' | 'failed';

/** original: as filed. normalized: lowercase, punctuation removed (fallback). */
export type SectionTextForm = 'original' | 'normalized';

export interface CartSectionSlice {
  filing: CartFiling;
  conceptKey: string;
  /** The label the slicer resolved for this filing's form, or the concept label. */
  sectionLabel: string;
  status: SectionSliceStatus;
  text: string;
  /** extracted only: which form `text` is in. */
  textForm?: SectionTextForm;
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
  const original = extractResolvedSectionOriginal(outcome.text, resolved);
  if (original) return { ...base, sectionLabel: resolved.label, status: 'extracted', text: original, textForm: 'original' };
  const normalized = extractResolvedSection(outcome.text, resolved).trim();
  return normalized
    ? { ...base, sectionLabel: resolved.label, status: 'extracted', text: normalized, textForm: 'normalized' }
    : { ...base, sectionLabel: resolved.label, status: 'not-found', text: '', reason: 'the section boundary was not found in the filing text' };
}

const TEXT_FORM_LABEL: Record<SectionTextForm, string> = {
  original: 'As filed',
  normalized: 'Normalized (lowercase, punctuation removed)',
};

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
    ['Page', 'Company', 'Ticker', 'Form', 'Filed', 'CIK', 'Accession', 'Section', 'Status', 'Reason', 'Text form', 'Characters', 'Document read', 'SEC URL'],
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
      slice.status === 'extracted' ? TEXT_FORM_LABEL[slice.textForm ?? 'normalized'] : '',
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
 * Break a run of text on word boundaries into readable blocks (the
 * normalized slice is one run). Breaks are presentation only — no text is
 * dropped.
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

/**
 * Paragraphs of a slice: as-filed text keeps the filing's own line breaks
 * (one paragraph per non-blank line, an over-long line chunked on word
 * boundaries); normalized text has none, so it is chunked as one run.
 */
export function sliceTextBlocks(text: string, textForm: SectionTextForm, limit = PARAGRAPH_CHARS): string[] {
  if (textForm === 'normalized') return chunkSliceText(text, limit);
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => (line.length > limit ? chunkSliceText(line, limit) : [line]));
}

function sliceParagraphs(slice: CartSectionSlice): Paragraph[] {
  return sliceTextBlocks(slice.text, slice.textForm ?? 'normalized')
    .map(part => new Paragraph({ children: [new TextRun({ text: part })], spacing: { after: 120 } }));
}

export function buildSectionDocument(slices: readonly CartSectionSlice[], conceptKey: string, generatedAt: Date): Document {
  const label = conceptLabel(conceptKey);
  const extracted = slices.filter(slice => slice.status === 'extracted').length;
  const normalized = slices.filter(slice => slice.status === 'extracted' && slice.textForm !== 'original').length;
  const children: DocxBlock[] = [
    new Paragraph({ text: `${label} — ${slices.length} selected filing${slices.length === 1 ? '' : 's'}`, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    labelledLine('Generated', generatedAt.toISOString()),
    labelledLine('Extracted', `${extracted} of ${slices.length}; every other filing names why below and in the CSV index`),
    labelledLine('Method', 'Filing text read through the app’s shared filing-text route and sliced by the section taxonomy for each filing’s own form.'),
    labelledLine('Text form', normalized === 0
      ? 'As filed — the filing’s own case, punctuation and line breaks, within the same section boundaries section-scoped search and the YoY change matrix measure. Tables and images are not reproduced; open each SEC link for the filing’s layout.'
      : `As filed, except ${normalized} filing${normalized === 1 ? '' : 's'} marked “Normalized” below, whose as-filed text could not be mapped exactly to the section boundaries: those are normalized section text (lowercase, punctuation removed). Open each SEC link for the filing’s own typography.`),
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
      if (slice.textForm !== 'original') {
        children.push(labelledLine('Text form', 'Normalized (lowercase, punctuation removed) — the as-filed text could not be mapped exactly to this section’s boundaries. Open the SEC link for the filing’s own typography.'));
      }
      children.push(...sliceParagraphs(slice));
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
