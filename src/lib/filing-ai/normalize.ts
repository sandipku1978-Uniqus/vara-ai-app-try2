/**
 * P1 — normalize raw artefacts into the CanonicalFilingModel.
 *
 * This is where most of the engineering actually lives (build spec §12: "the
 * normalizer is where most of the engineering effort goes; rules are cheap once
 * the CFM is right"). Two principles drive every choice here:
 *
 * 1. **Prefer the structured source.** Numeric facts come from inline XBRL, not
 *    from HTML tables, because filing agents produce wildly inconsistent markup
 *    (§13.1). Tables are read for presentation checks only.
 * 2. **Never guess.** Anything the parser cannot resolve is recorded in
 *    `unparsed_regions`, which suppresses the dependent rules and appears in
 *    the coverage statement. A silent parse failure would turn into a silent
 *    clean report — the single most dangerous outcome this product can produce.
 */

import { extractDocumentTextFromHtmlServer } from '../filingTextServer';
import { parseInlineXbrl, stripTags, type IxbrlContext, type IxbrlDocument } from './ixbrl';
import type { FetchedDocument, FilingIndex } from './artifacts';
import type {
  CanonicalFilingModel,
  CfmExhibit,
  CfmFact,
  CfmSection,
  CfmSignature,
  EntityReference,
  SubmissionDocument,
  SubmissionHeader,
} from './types';

/**
 * Items a 10-K can contain. Item 1C (cybersecurity) arrived with the July 2023
 * rules; older filings legitimately lack it, which the rule's effective date
 * handles rather than this list.
 */
const TEN_K_ITEMS = [
  '1', '1A', '1B', '1C', '2', '3', '4',
  '5', '6', '7', '7A', '8', '9', '9A', '9B', '9C',
  '10', '11', '12', '13', '14', '15', '16',
];

const ITEM_HEADING_PATTERN = /(^|\n)[^\S\n]{0,40}item[\s ]+(\d{1,2}[a-cA-C]?)[.:\s)]/gi;

export interface SectionExtraction {
  sections: CfmSection[];
  unparsed: string[];
}

/**
 * Segment the reading text into Item sections.
 *
 * A 10-K names each item at least twice — once in the table of contents and
 * once where the content actually is. Choosing the occurrence with the longest
 * run to the next heading picks the body and discards the index, which is why
 * a naive "first match" segmenter reports every section as empty.
 */
export function extractSections(text: string, itemUniverse = TEN_K_ITEMS): SectionExtraction {
  const known = new Set(itemUniverse.map(item => item.toUpperCase()));
  const matches: Array<{ item: string; start: number; headingEnd: number }> = [];

  ITEM_HEADING_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ITEM_HEADING_PATTERN.exec(text))) {
    const item = match[2].toUpperCase();
    if (!known.has(item)) continue;
    const start = match.index + match[1].length;
    matches.push({ item, start, headingEnd: match.index + match[0].length });
  }

  if (matches.length === 0) {
    return { sections: [], unparsed: ['Item headings could not be located in the primary document.'] };
  }

  const best = new Map<string, { start: number; headingEnd: number; end: number }>();
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const end = index + 1 < matches.length ? matches[index + 1].start : text.length;
    const existing = best.get(current.item);
    if (!existing || end - current.start > existing.end - existing.start) {
      best.set(current.item, { start: current.start, headingEnd: current.headingEnd, end });
    }
  }

  const sections: CfmSection[] = [];
  for (const [item, span] of best) {
    const heading = text.slice(span.start, Math.min(span.end, span.start + 140)).split('\n')[0].trim();
    sections.push({
      item_ref: item,
      heading,
      text: text.slice(span.start, span.end),
      char_start: span.start,
      char_end: span.end,
    });
  }
  sections.sort((left, right) => left.char_start - right.char_start);

  const unparsed: string[] = [];
  if (sections.length < 6) {
    unparsed.push(
      `Only ${sections.length} Item sections were located in the primary document; disclosure-layer coverage is reduced accordingly.`,
    );
  }
  return { sections, unparsed };
}

/** Normalise an EDGAR document type (`EX-31.1`, `EX-101.INS`) to an exhibit number. */
export function exhibitNumberFromType(type: string): string | null {
  const cleaned = type.trim().toUpperCase();
  const match = /^EX-(\d{1,3}(?:\.\d{1,3})?)/.exec(cleaned);
  if (!match) return null;
  return match[1];
}

const FURNISHED_EXHIBIT_PREFIXES = ['32'];

function isFurnished(exhibitNumber: string): boolean {
  return FURNISHED_EXHIBIT_PREFIXES.some(prefix => exhibitNumber === prefix || exhibitNumber.startsWith(`${prefix}.`));
}

/**
 * The exhibit set actually submitted, read from the EDGAR filing index.
 *
 * This is the authoritative side of rule R-MECH-EXH-100: the index printed
 * inside the document is the filer's claim about what was attached, and the
 * gap between claim and submission is the defect worth reporting.
 */
export function exhibitsFromFilingIndex(documents: SubmissionDocument[]): CfmExhibit[] {
  const exhibits: CfmExhibit[] = [];
  for (const document of documents) {
    const number = exhibitNumberFromType(document.type);
    if (!number) continue;
    exhibits.push({
      number,
      type: document.type,
      description: document.description,
      attached: true,
      filed_or_furnished: isFurnished(number) ? 'furnished' : 'filed',
      resolved: true,
      provenance: { artifact: document.name, basis: 'html', char_start: 0, char_end: document.size, url: document.url },
    });
  }
  return exhibits;
}

export interface PrintedExhibitRow {
  number: string;
  description: string;
  incorporated_by_reference: boolean;
  char_offset: number;
}

const EXHIBIT_INDEX_ANCHOR = /(exhibit\s+index|item\s+15[.:\s][^\n]{0,80}exhibit)/gi;
const EXHIBIT_ROW_PATTERN = /(^|\n)\s*(\d{1,3}(?:\.\d{1,3})?)[\s ]{1,8}([^\n]{6,220})/g;

/**
 * Parse the exhibit index printed in the primary document.
 *
 * Best effort by design. When the anchor cannot be located the caller records
 * an unparsed region and R-MECH-EXH-100 is suppressed — an exhibit-index rule
 * that silently sees zero rows would report a perfectly clean index for every
 * filing whose markup it failed to read.
 */
export function extractPrintedExhibitIndex(text: string): { rows: PrintedExhibitRow[]; located: boolean } {
  EXHIBIT_INDEX_ANCHOR.lastIndex = 0;
  let anchorIndex = -1;
  let anchor: RegExpExecArray | null;
  while ((anchor = EXHIBIT_INDEX_ANCHOR.exec(text))) {
    // The last anchor is the real index; earlier ones are table-of-contents rows.
    anchorIndex = anchor.index;
  }
  if (anchorIndex < 0) return { rows: [], located: false };

  const region = text.slice(anchorIndex, Math.min(text.length, anchorIndex + 60_000));
  const rows: PrintedExhibitRow[] = [];
  const seen = new Set<string>();
  EXHIBIT_ROW_PATTERN.lastIndex = 0;
  let row: RegExpExecArray | null;
  while ((row = EXHIBIT_ROW_PATTERN.exec(region))) {
    const number = row[2];
    const description = row[3].trim();
    // A bare year or page number is not an exhibit row.
    if (/^(19|20)\d{2}$/.test(number)) continue;
    if (seen.has(number)) continue;
    seen.add(number);
    rows.push({
      number,
      description,
      incorporated_by_reference: /incorporated\s+by\s+reference|filed\s+(?:as|herewith\s+as)\s+exhibit|previously\s+filed/i.test(description),
      char_offset: anchorIndex + row.index,
    });
  }
  return { rows, located: rows.length > 0 };
}

const SIGNATURE_HEADING = /(^|\n)[^\S\n]{0,40}signatures?[^\S\n]*(\n|$)/gi;
const CONFORMED_SIGNATURE = /\/s\/[\s ]*([^\n,]{2,80})/g;

export const ROLE_PATTERNS = {
  peo: /\b(chief executive officer|principal executive officer|president and chief executive|chief executive)\b/i,
  pfo: /\b(chief financial officer|principal financial officer|executive vice president.{0,30}finance)\b/i,
  pao: /\b(chief accounting officer|principal accounting officer|corporate controller|\bcontroller\b)\b/i,
  director: /\b(director|chairman of the board|chairperson)\b/i,
} as const;

const SIGNATURE_DATE = /\b((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/i;

/**
 * Read the signature blocks.
 *
 * Anchored to the last "SIGNATURES" heading, because filings quote the word
 * earlier (in the exhibit index, in the certifications). Each `/s/` marker
 * opens a window in which the name, title and date are looked for; a signature
 * without a `/s/` marker is still captured as non-conformed, since "signature
 * present but not conformed" is itself rule R-MECH-SIG-003.
 */
export function extractSignatures(text: string): { signatures: CfmSignature[]; regionFound: boolean } {
  SIGNATURE_HEADING.lastIndex = 0;
  let regionStart = -1;
  let heading: RegExpExecArray | null;
  while ((heading = SIGNATURE_HEADING.exec(text))) {
    regionStart = heading.index;
  }
  if (regionStart < 0) return { signatures: [], regionFound: false };

  const region = text.slice(regionStart);
  const signatures: CfmSignature[] = [];
  CONFORMED_SIGNATURE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONFORMED_SIGNATURE.exec(region))) {
    const name = match[1].trim().replace(/\s{2,}/g, ' ');
    const window = region.slice(match.index, match.index + 260);
    let title = '';
    for (const line of window.split('\n').slice(1)) {
      const candidate = line.trim();
      if (!candidate || candidate.toLowerCase() === name.toLowerCase()) continue;
      if (/^\/s\//.test(candidate)) break;
      title = candidate.slice(0, 160);
      break;
    }
    // Titles frequently share a line with the name in table layouts.
    if (!title) {
      const sameLine = window.split('\n')[0].slice(match[0].length).trim();
      if (sameLine) title = sameLine.slice(0, 160);
    }
    signatures.push({
      name,
      title,
      conformed: true,
      date: SIGNATURE_DATE.exec(window)?.[1],
      block_ref: 'signature-page',
      char_offset: regionStart + match.index,
    });
  }

  return { signatures, regionFound: true };
}

/** Facts whose context carries no dimension members — the consolidated figures. */
export function isConsolidated(context: IxbrlContext | undefined): boolean {
  return Boolean(context) && (context as IxbrlContext).dimensions.length === 0;
}

function toCfmFacts(
  instance: IxbrlDocument,
  document: FetchedDocument,
): { facts: CfmFact[]; deiTags: Record<string, string> } {
  const facts: CfmFact[] = [];
  const deiTags: Record<string, string> = {};

  for (const fact of instance.facts) {
    const context = instance.contexts.get(fact.context_ref);
    if (fact.prefix.toLowerCase() === 'dei') {
      // First non-empty value wins; cover tags are not repeated with different
      // meanings, and the first occurrence is the cover page itself.
      const existing = deiTags[fact.name];
      const literal = fact.numeric && fact.value !== undefined ? String(fact.value) : fact.literal;
      if (!existing && literal) deiTags[fact.name] = literal;
    }
    facts.push({
      concept: `${fact.prefix}:${fact.name}`,
      value: fact.numeric && fact.value !== undefined ? fact.value : fact.literal,
      unit: fact.unit_ref,
      sign: fact.sign,
      period_start: context?.start_date,
      period_end: context?.end_date ?? context?.instant,
      context_ref: fact.context_ref,
      decimals: fact.decimals,
      scale: fact.scale,
      source: 'ixbrl',
      provenance: {
        artifact: document.name,
        basis: 'html',
        char_start: fact.char_start,
        char_end: fact.char_end,
        url: document.url,
      },
    });
  }

  return { facts, deiTags };
}

export interface NormalizeInput {
  runId: string;
  primary: FetchedDocument;
  filingIndex: FilingIndex;
  submission: SubmissionHeader;
  entity: EntityReference;
}

export interface NormalizeOutput {
  cfm: CanonicalFilingModel;
  instance: IxbrlDocument;
  printedExhibitIndex: { rows: PrintedExhibitRow[]; located: boolean };
  primaryText: string;
}

/** P1. Raw artefacts in, CanonicalFilingModel out. */
export function normalize(input: NormalizeInput): NormalizeOutput {
  const unparsed: string[] = [];
  const instance = parseInlineXbrl(input.primary.html);
  // Keyed on facts, not on the namespace declaration. A document that declares
  // the inline XBRL namespace and carries no readable facts is exactly as
  // unusable to the XBRL and consistency layers as one that declares nothing,
  // and treating the declaration as sufficient would let those layers report a
  // clean result on a document they never read.
  if (instance.facts.length === 0) {
    unparsed.push(
      instance.hasInlineXbrl
        ? 'The primary document declares the inline XBRL namespace but no facts could be read from it; XBRL-layer rules cannot be evaluated.'
        : 'The primary document declares no inline XBRL namespace; XBRL-layer rules cannot be evaluated.',
    );
  }

  const primaryText = extractDocumentTextFromHtmlServer(input.primary.html)
    || stripTags(input.primary.html);
  if (!primaryText.trim()) {
    unparsed.push('No reading text could be extracted from the primary document.');
  }

  const { sections, unparsed: sectionIssues } = extractSections(primaryText);
  unparsed.push(...sectionIssues);

  const printedExhibitIndex = extractPrintedExhibitIndex(primaryText);
  if (!printedExhibitIndex.located) {
    unparsed.push('The exhibit index printed in the primary document could not be located or parsed.');
  }

  const { signatures, regionFound } = extractSignatures(primaryText);
  if (!regionFound) {
    unparsed.push('No signature page heading was located in the primary document.');
  }

  const { facts, deiTags } = toCfmFacts(instance, input.primary);
  const exhibits = exhibitsFromFilingIndex(input.filingIndex.documents);

  // Rows claimed in the printed index that no submitted document satisfies.
  const attachedNumbers = new Set(exhibits.map(exhibit => exhibit.number));
  for (const row of printedExhibitIndex.rows) {
    if (attachedNumbers.has(row.number)) continue;
    exhibits.push({
      number: row.number,
      type: `Printed index row ${row.number}`,
      description: row.description,
      attached: false,
      filed_or_furnished: isFurnished(row.number) ? 'furnished' : 'filed',
      ibr_target: row.incorporated_by_reference ? 'incorporated by reference' : undefined,
      resolved: row.incorporated_by_reference,
      provenance: {
        artifact: input.primary.name,
        basis: 'text',
        char_start: row.char_offset,
        char_end: row.char_offset + row.description.length,
        url: input.primary.url,
      },
    });
  }

  const cfm: CanonicalFilingModel = {
    run_id: input.runId,
    sections,
    facts,
    // Table-grid reconstruction is a build-wave item; the rules that need it are
    // bound to `unbound` and named in the coverage statement.
    tables: [],
    narrative_numbers: [],
    exhibits,
    dei_tags: deiTags,
    signatures,
    unparsed_regions: unparsed,
    primary_document: {
      name: input.primary.name,
      url: input.primary.url,
      length: input.primary.html.length,
      text_length: primaryText.length,
      sha256: input.primary.sha256,
    },
    submission: input.submission,
  };

  return { cfm, instance, printedExhibitIndex, primaryText };
}
