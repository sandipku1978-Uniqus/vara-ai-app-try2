/**
 * Shared Word (.docx) building blocks.
 *
 * Every Word export in the app — the Benchmarking comparison memo, the memo
 * tray workpaper, a copilot answer, the cart's bulk section download — is
 * built from these pieces so headings, citation references, evidence tables
 * and the evidence-package appendix read the same way in every document.
 *
 * Builders are pure (they return docx objects); only downloadBlob touches the
 * DOM. Tests pack the documents with Packer.toBuffer and read document.xml.
 */
import {
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  InternalHyperlink,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import type { EvidencePackage } from './evidencePackage';

export type DocxBlock = Paragraph | Table;

/** Bookmark name for evidence row n — Word bookmark names allow letters, digits and underscores. */
export function evidenceAnchor(n: number): string {
  return `evidence_${n}`;
}

export interface InlineOptions {
  /**
   * Number of evidence rows the document carries. When set, `[n]` markers that
   * resolve to a row become superscript references linked to that row; markers
   * that resolve to nothing stay visible as typed, so a broken citation is
   * never silently dropped or silently "fixed".
   */
  citationCount?: number;
  /**
   * Maps a marker number to the evidence row it refers to, when those differ
   * (a draft whose citation set changed afterwards). Returning null leaves the
   * marker unlinked. Without it, marker n links to row n.
   */
  resolveCitation?: (n: number) => number | null;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\[\d{1,3}(?:\s*,\s*\d{1,3})*\]|`[^`]+`|\*[^*\s][^*]*\*)/g;

function citationRuns(group: string, options: InlineOptions): ParagraphChild[] {
  const numbers = group.slice(1, -1).split(',').map(value => Number(value.trim()));
  const resolve = options.resolveCitation
    || ((n: number) => (Number.isInteger(n) && n >= 1 && n <= (options.citationCount || 0) ? n : null));
  const rows = numbers.map(resolve);
  if (rows.some(row => row === null)) return [new TextRun({ text: group })];
  const children: ParagraphChild[] = [];
  numbers.forEach((n, index) => {
    children.push(new InternalHyperlink({
      anchor: evidenceAnchor(rows[index]!),
      children: [new TextRun({ text: `[${n}]`, superScript: true, style: 'Hyperlink' })],
    }));
    if (index < numbers.length - 1) children.push(new TextRun({ text: ',', superScript: true }));
  });
  return children;
}

/** Inline markdown: **bold**, *italic*, `code`, and optional [n] citation references. */
export function inlineRuns(text: string, options: InlineOptions = {}): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const part of text.split(INLINE_PATTERN)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      children.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      children.push(new TextRun({ text: part.slice(1, -1), font: 'Consolas' }));
    } else if (/^\[\d/.test(part) && part.endsWith(']')) {
      children.push(...(options.citationCount || options.resolveCitation ? citationRuns(part, options) : [new TextRun({ text: part })]));
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      children.push(new TextRun({ text: part.slice(1, -1), italics: true }));
    } else {
      children.push(new TextRun({ text: part }));
    }
  }
  return children;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

/**
 * Line-oriented Markdown → docx blocks. Handles what the app's AI output and
 * memo drafts actually contain: #/##/### headings, "- "/"* "/"• " bullets,
 * numbered items, pipe tables, horizontal rules, and paragraphs. A heading
 * line followed immediately by body text (no blank line) is still a heading
 * plus a paragraph, not one long heading.
 */
export function markdownToDocxBlocks(markdown: string, options: InlineOptions = {}): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(new Paragraph({ children: inlineRuns(paragraph.join(' '), options), spacing: { after: 160 } }));
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(); continue; }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      blocks.push(new Paragraph({
        children: inlineRuns(heading[2].trim(), options),
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: level === 1 ? 240 : 300, after: 120 },
      }));
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } }, spacing: { after: 160 } }));
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push(new Paragraph({ children: inlineRuns(bullet[1], options), bullet: { level: 0 }, spacing: { after: 80 } }));
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      blocks.push(new Paragraph({ children: inlineRuns(trimmed, options), spacing: { after: 80 }, indent: { left: 360 } }));
      continue;
    }

    if (trimmed.startsWith('|') && /^\|?[\s:|-]+\|?$/.test(lines[index + 1]?.trim() || '') && (lines[index + 1] || '').includes('-')) {
      flushParagraph();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push(simpleTable(header, rows.map(row => header.map((_, column) => row[column] ?? '')), options));
      blocks.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

/** A cell is plain text, a hyperlink, or text carrying a bookmark other references can jump to. */
export type DocxCell = string | { text: string; url?: string; bookmark?: string };

function cellParagraph(cell: DocxCell, options: InlineOptions, bold = false): Paragraph {
  if (typeof cell === 'string') {
    return new Paragraph({ children: bold ? [new TextRun({ text: cell, bold: true })] : inlineRuns(cell, options) });
  }
  const run = new TextRun({ text: cell.text, style: cell.url ? 'Hyperlink' : undefined, bold });
  const linked: ParagraphChild = cell.url ? new ExternalHyperlink({ link: cell.url, children: [run] }) : run;
  return new Paragraph({ children: [cell.bookmark ? new Bookmark({ id: cell.bookmark, children: [linked] }) : linked] });
}

const HEADER_SHADING = { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F0F8' } as const;

/** A full-width bordered table with a shaded header row. */
export function simpleTable(headers: string[], rows: DocxCell[][], options: InlineOptions = {}): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map(header => new TableCell({ shading: HEADER_SHADING, children: [cellParagraph(header, options, true)] })),
      }),
      ...rows.map(row => new TableRow({
        children: row.map(cell => new TableCell({ children: [cellParagraph(cell, options)] })),
      })),
    ],
  });
}

/** "Label: value" line, label in bold. */
export function labelledLine(label: string, value: string | ParagraphChild[]): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), ...(typeof value === 'string' ? [new TextRun({ text: value })] : value)],
    spacing: { after: 80 },
  });
}

export function externalLink(text: string, url: string): ExternalHyperlink {
  return new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: 'Hyperlink' })] });
}

export function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

function describeCoverage(pkg: EvidencePackage): string {
  const coverage = pkg.coverage;
  if (coverage.status === 'not-recorded') return `Not recorded — ${coverage.note}`;
  const counts = [
    coverage.examined !== null ? `${coverage.examined.toLocaleString('en-US')} examined` : '',
    coverage.upstreamTotal !== null ? `${coverage.upstreamTotal.toLocaleString('en-US')}${coverage.upstreamTotalIsFloor ? '+' : ''} upstream candidates` : '',
    coverage.verifiedMatchTotal !== null && coverage.verifiedMatchTotal !== undefined ? `${coverage.verifiedMatchTotal.toLocaleString('en-US')} verified matches` : '',
  ].filter(Boolean).join(', ');
  return `${coverage.status === 'complete' ? 'Complete' : 'Partial'}${counts ? ` (${counts})` : ''} — ${coverage.note}`;
}

function describeAiStep(pkg: EvidencePackage): string {
  const step = pkg.aiStep;
  if (!step) return 'No AI step ran for this output.';
  const model = step.model || 'not reported';
  const effort = step.reasoningEffort || 'not reported';
  const source = step.metadataSource === 'response'
    ? 'as reported by the AI route response'
    : step.metadataSource === 'request'
      ? 'as sent in the request (the response did not report it)'
      : 'the AI route did not report the model or reasoning effort';
  return `${step.purpose}. Model: ${model}. Reasoning effort: ${effort} (${source}).`;
}

function describeAppVersion(pkg: EvidencePackage): string {
  const version = pkg.appVersion;
  if (version.status === 'unavailable') return `Unavailable — ${version.reason}`;
  return [
    version.sha ? `commit ${version.sha}` : 'commit not reported',
    version.ref ? `ref ${version.ref}` : '',
    version.deploymentId ? `deployment ${version.deploymentId}` : '',
    version.environment ? `environment ${version.environment}` : '',
  ].filter(Boolean).join(', ');
}

/**
 * The evidence-package appendix: a new page recording how the output was
 * produced, then the machine-readable JSON record itself, so the document
 * carries its own provenance even when the .json travels separately.
 */
export function evidenceAppendixBlocks(pkg: EvidencePackage): DocxBlock[] {
  const blocks: DocxBlock[] = [
    pageBreak(),
    new Paragraph({ text: 'Appendix — Evidence package', heading: HeadingLevel.HEADING_1, spacing: { after: 160 } }),
    new Paragraph({
      children: [new TextRun({ text: 'How this output was produced. Every value below was recorded by the app at generation time; values the app could not observe are marked as not recorded rather than inferred.', italics: true })],
      spacing: { after: 160 },
    }),
    labelledLine('Subject', `${pkg.subject.kind === 'memo' ? 'Research memo' : 'Copilot answer'} — ${pkg.subject.title}`),
    labelledLine('Generated', pkg.generatedAt),
    labelledLine('App version', describeAppVersion(pkg)),
    labelledLine('Query', pkg.query.text ? `${pkg.query.text}${pkg.query.mode ? ` (${pkg.query.mode})` : ''}` : `Not recorded — ${pkg.query.note || 'no query was associated with this output'}`),
    labelledLine('Operators', pkg.query.operators.length > 0 ? pkg.query.operators.join(', ') : 'None'),
    labelledLine('Filters', pkg.filters.length > 0 ? pkg.filters.map(filter => `${filter.label}: ${filter.value}`).join('; ') : 'None recorded'),
    labelledLine('Coverage', describeCoverage(pkg)),
    labelledLine('AI step', describeAiStep(pkg)),
  ];

  if (pkg.sources.length > 0) {
    blocks.push(new Paragraph({ text: 'Filings read or cited', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
    blocks.push(simpleTable(
      ['Company', 'Form', 'Filed', 'Accession', 'Role', 'SEC URL'],
      pkg.sources.map(source => [
        source.company || '—',
        source.form || '—',
        source.fileDate || '—',
        source.accessionNumber || '—',
        source.role,
        source.secUrl ? { text: source.secUrl, url: source.secUrl } : '—',
      ]),
    ));
  }

  if (pkg.sectionSlices.length > 0) {
    blocks.push(new Paragraph({ text: 'Section slices used', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
    blocks.push(simpleTable(
      ['Accession', 'Section', 'Characters', 'Origin'],
      pkg.sectionSlices.map(slice => [slice.accessionNumber || '—', slice.section, String(slice.characters), slice.origin]),
    ));
  }

  blocks.push(new Paragraph({ text: 'Machine-readable record', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
  for (const line of JSON.stringify(pkg, null, 2).split('\n')) {
    blocks.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 16 })], spacing: { after: 0 } }));
  }
  return blocks;
}

/** The house document shell: one section, brand header line, then the body. */
export function buildDocument(children: DocxBlock[], title: string): Document {
  return new Document({
    creator: 'Uniqus Research Center',
    title,
    sections: [{ properties: {}, children }],
  });
}

export function packDocx(document: Document): Promise<Blob> {
  return Packer.toBlob(document);
}

/** Filesystem-safe stem: letters, digits, dash and underscore only. */
export function safeFileStem(value: string, fallback: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || fallback;
}

/** Client-only: hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}
