/**
 * Memo tray → Word workpaper.
 *
 * Title, research question, date and author; the AI draft (when one exists)
 * with its [n] markers kept as superscript references that jump to evidence
 * row n; the Evidence table (one row per citation, SEC link live); a Sources
 * list; and the evidence-package appendix recording how it was produced.
 *
 * The builder is pure and returns a docx Document so tests can pack it and
 * read document.xml; exportMemoDocx is the client-only download wrapper.
 */
import { HeadingLevel, Paragraph, TextRun, type Document } from 'docx';
import { releaseReference, sentence, type MemoCitation, type MemoDraftRecord } from './memoTray';
import type { EvidencePackage } from './evidencePackage';
import { evidencePackageBlob } from './evidencePackage';
import {
  buildDocument,
  downloadBlob,
  evidenceAnchor,
  evidenceAppendixBlocks,
  externalLink,
  labelledLine,
  markdownToDocxBlocks,
  packDocx,
  safeFileStem,
  simpleTable,
  type DocxBlock,
} from './docxShared';

export const DEFAULT_MEMO_TITLE = 'Research memo — cited evidence';

export interface MemoExportInput {
  title: string;
  question: string;
  /** Display name from the signed-in session; null when none is available. */
  author: string | null;
  generatedAt: Date;
  citations: MemoCitation[];
  draft: MemoDraftRecord | null;
  /** The evidence set changed after the draft was generated. */
  draftIsStale: boolean;
  evidencePackage: EvidencePackage;
}

/** The draft's own "# …" title line, if it has one. */
export function draftTitle(draft: string | null | undefined): string | null {
  const match = (draft || '').match(/^\s*#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/** The single sentence under the draft's "## Purpose" heading, if present. */
export function draftPurpose(draft: string | null | undefined): string | null {
  const match = (draft || '').match(/^##\s+Purpose\s*\n+([^\n#].*)$/im);
  return match ? match[1].trim() : null;
}

/** Draft body without its leading title line (the document title carries it). */
function draftBody(draft: string): string {
  return draft.replace(/^\s*#\s+.+\n?/, '');
}

/**
 * The display name Clerk holds for the signed-in session, read from the
 * loaded Clerk client. Null when signed out or Clerk is not configured — the
 * document then says the author was not recorded rather than inventing one.
 */
export function readSessionDisplayName(): string | null {
  if (typeof window === 'undefined') return null;
  const user = (window as unknown as {
    Clerk?: { user?: { fullName?: string | null; username?: string | null; primaryEmailAddress?: { emailAddress?: string } | null } | null };
  }).Clerk?.user;
  if (!user) return null;
  return user.fullName?.trim() || user.username?.trim() || user.primaryEmailAddress?.emailAddress?.trim() || null;
}

export function formatExportDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function evidenceTable(citations: MemoCitation[]): DocxBlock {
  return simpleTable(
    ['n', 'Company', 'Form', 'Filed', 'Accession', 'Section', 'Excerpt', 'Your note', 'SEC URL'],
    citations.map((citation, index) => [
      { text: `[${index + 1}]`, bookmark: evidenceAnchor(index + 1) },
      citation.company,
      citation.kind === 'release' ? 'AAER (SEC release)' : citation.form,
      citation.fileDate,
      citation.kind === 'release' ? `${citation.accessionNumber} (release no.)` : citation.accessionNumber,
      citation.section || '—',
      // Plain text, never re-parsed as Markdown: an excerpt is a quotation.
      { text: citation.excerpt.trim() || '— (metadata-only citation)' },
      { text: citation.note.trim() || '—' },
      { text: citation.sourceUrl, url: citation.sourceUrl },
    ]),
  );
}

function sourcesBlocks(citations: MemoCitation[]): DocxBlock[] {
  return citations.map((citation, index) => new Paragraph({
    children: [
      new TextRun({
        text: citation.kind === 'release'
          // An enforcement release is cited by its own number, not as a filing.
          ? `[${index + 1}] ${releaseReference(citation)} — ${sentence(citation.company)} `
          : `[${index + 1}] ${citation.company} — Form ${citation.form}, filed ${citation.fileDate}${citation.section ? `, ${citation.section}` : ''} (accession ${citation.accessionNumber}). `,
      }),
      externalLink(citation.sourceUrl, citation.sourceUrl),
      ...(citation.comparedTo
        ? [
            new TextRun({ text: ` Compared with Form ${citation.comparedTo.form} filed ${citation.comparedTo.fileDate} (accession ${citation.comparedTo.accessionNumber}): ` }),
            externalLink(citation.comparedTo.sourceUrl, citation.comparedTo.sourceUrl),
          ]
        : []),
    ],
    spacing: { after: 100 },
  }));
}

export function buildMemoDocument(input: MemoExportInput): Document {
  const title = input.title.trim() || DEFAULT_MEMO_TITLE;
  const children: DocxBlock[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    labelledLine('Question', input.question.trim() || 'Not recorded'),
    labelledLine('Date', formatExportDate(input.generatedAt)),
    labelledLine('Author', input.author || 'Not recorded (no signed-in display name)'),
    labelledLine('Source', 'Uniqus Research Center — SEC EDGAR'),
  ];

  if (input.draft?.text.trim()) {
    children.push(new Paragraph({ text: 'AI draft', heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }));
    children.push(new Paragraph({
      children: [new TextRun({
        text: `Generated ${input.draft.generatedAt} from ${input.draft.citationIds.length} citation${input.draft.citationIds.length === 1 ? '' : 's'}. Bracketed references point to rows of the Evidence table.`,
        italics: true,
      })],
      spacing: { after: 120 },
    }));
    if (input.draftIsStale) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Citations changed after this draft was generated. References still link to the citation they were drafted from; a reference whose citation was removed is left unlinked. Regenerate the draft to align it with the current evidence.', bold: true })],
        spacing: { after: 120 },
      }));
    }
    const draftIds = input.draft.citationIds;
    children.push(...markdownToDocxBlocks(draftBody(input.draft.text), {
      // Marker n names the n-th citation the draft was generated from; find
      // that citation's row now, which is the same row unless the set changed.
      resolveCitation: n => {
        const row = input.citations.findIndex(citation => citation.id === draftIds[n - 1]);
        return row >= 0 ? row + 1 : null;
      },
    }));
  }

  children.push(new Paragraph({ text: 'Evidence', heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }));
  children.push(input.citations.length > 0
    ? evidenceTable(input.citations)
    : new Paragraph({ text: 'No citations in the memo tray.' }));

  if (input.citations.length > 0) {
    children.push(new Paragraph({ text: 'Sources', heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }));
    children.push(...sourcesBlocks(input.citations));
  }

  children.push(...evidenceAppendixBlocks(input.evidencePackage));
  return buildDocument(children, title);
}

export function memoFileStem(title: string, date: Date): string {
  return `URC_memo_${safeFileStem(title, 'memo')}_${formatExportDate(date)}`;
}

/** Client-only: build and download the memo .docx. */
export async function exportMemoDocx(input: MemoExportInput): Promise<void> {
  const blob = await packDocx(buildMemoDocument(input));
  downloadBlob(blob, `${memoFileStem(input.title || DEFAULT_MEMO_TITLE, input.generatedAt)}.docx`);
}

/** Client-only: download the evidence package as .json. */
export function exportEvidencePackageJson(pkg: EvidencePackage, stem: string): void {
  downloadBlob(evidencePackageBlob(pkg), `${stem}_evidence.json`);
}
