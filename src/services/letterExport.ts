/**
 * Comment-letter exports: an episode (its letters and the issue-level split)
 * and a filtered search result list, as CSV and Word.
 *
 * Every export opens with what it is — the query or episode, the filters as
 * applied, how many rows of how many the server reported, the ordering, the
 * generation time — so a reviewer who opens the file later can tell a
 * complete list from the page of it that was on screen. Builders are pure
 * (a block model, then CSV text or a docx Document); only downloadBlob
 * touches the browser.
 */

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { buildCsvRows } from '../utils/csv';
import type { CommentIssue, EpisodeIssues, IssueStatus } from './commentIssues';

export interface ExportLetter {
  accession: string;
  cik: number | string;
  company_name: string;
  form: string;
  date_filed: string;
  has_text: boolean;
}

export interface EpisodeExportInput {
  threadId: string;
  company: string;
  cik: number | string;
  letters: ExportLetter[];
  /** null when the issue split could not be loaded — the export says so. */
  episode: EpisodeIssues | null;
  issuesNote?: string;
  generatedAt: string;
}

export interface SearchExportMatch {
  accession: string;
  cik: number | string;
  company_name: string;
  form: string;
  date_filed: string;
  thread_id: string;
  headline: string;
}

export interface SearchExportInput {
  query: string;
  ordering: 'relevance' | 'newest';
  /** Applied-filter lines, already phrased for a reader. */
  filters: string[];
  total: number;
  totalIsFloor: boolean;
  matches: SearchExportMatch[];
  generatedAt: string;
  /** Depth the server ranks within (1,000); stated when the total exceeds it. */
  poolDepth: number;
}

export function secLetterIndexUrl(cik: number | string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`;
}

export function letterTypeLabel(form: string): string {
  return form === 'UPLOAD' ? 'SEC Staff letter' : form === 'CORRESP' ? 'Company response' : form;
}

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  resolved: 'Resolved',
  responded: 'Responded',
  open: 'Open',
  unclear: 'Unclear',
};

function plainHeadline(headline: string): string {
  return headline.replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim();
}

function totalLabel(total: number, floor: boolean): string {
  return `${total.toLocaleString('en-US')}${floor ? '+' : ''}`;
}

// ── Shared block model ──────────────────────────────────────────────────────

export type ExportBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'meta'; label: string; text: string }
  | { kind: 'paragraph'; text: string; quote?: boolean };

function issueBlocks(issue: CommentIssue): ExportBlock[] {
  const blocks: ExportBlock[] = [
    { kind: 'subheading', text: `Comment ${issue.issueNumber}${issue.filingSectionRef ? ` — ${issue.filingSectionRef}` : ''}` },
    { kind: 'meta', label: 'Status', text: `${ISSUE_STATUS_LABEL[issue.status]}. ${issue.statusBasis}` },
    { kind: 'meta', label: 'Staff letter', text: `${issue.staffDate} · ${issue.staffAccession} · ${secLetterIndexUrl(issue.cik, issue.staffAccession)}` },
  ];
  if (issue.filingSectionInherited) {
    blocks.push({ kind: 'meta', label: 'Filing section', text: 'Inherited from the heading above the previous comment.' });
  }
  for (const paragraph of issue.staffComment.split('\n\n')) blocks.push({ kind: 'paragraph', text: paragraph });
  if (issue.response) {
    blocks.push({
      kind: 'meta',
      label: 'Company response',
      text: `${issue.response.date_filed} · ${issue.response.accession} · ${secLetterIndexUrl(issue.response.cik, issue.response.accession)}${issue.response.excerptTruncated ? ' · excerpt truncated; read the full letter' : ''}`,
    });
    for (const paragraph of issue.response.excerpt.split('\n\n')) blocks.push({ kind: 'paragraph', text: paragraph, quote: true });
  } else {
    blocks.push({ kind: 'meta', label: 'Company response', text: 'None paired (see status).' });
  }
  for (const follow of issue.followUp) {
    blocks.push({ kind: 'meta', label: 'Staff follow-up', text: `${follow.staffDate} comment ${follow.issueNumber}: ${follow.staffComment.slice(0, 600)}${follow.staffComment.length > 600 ? '…' : ''}` });
  }
  return blocks;
}

export function episodeBlocks(input: EpisodeExportInput): ExportBlock[] {
  const blocks: ExportBlock[] = [
    { kind: 'title', text: `SEC comment-letter review: ${input.company}` },
    { kind: 'meta', label: 'Episode', text: input.threadId },
    { kind: 'meta', label: 'CIK', text: String(input.cik) },
    { kind: 'meta', label: 'Exported', text: input.generatedAt },
    { kind: 'meta', label: 'Source', text: 'SEC EDGAR UPLOAD (Staff) and CORRESP (company) letters in the URC letter corpus; issue split by text rules, not AI — verify against the letters.' },
    { kind: 'heading', text: `Letters (${input.letters.length})` },
  ];
  for (const letter of input.letters) {
    blocks.push({
      kind: 'paragraph',
      text: `${letter.date_filed} · ${letterTypeLabel(letter.form)} · ${letter.accession}${letter.has_text ? '' : ' · text not extracted'} · ${secLetterIndexUrl(letter.cik, letter.accession)}`,
    });
  }
  if (!input.episode) {
    blocks.push({ kind: 'heading', text: 'Issues' });
    blocks.push({ kind: 'paragraph', text: input.issuesNote || 'The issue split was not available when this export was made; the letters above are complete.' });
    return blocks;
  }
  const coverage = input.episode.coverage;
  blocks.push({ kind: 'heading', text: `Issues (${coverage.issues})` });
  blocks.push({
    kind: 'meta',
    label: 'Coverage',
    text: `${coverage.staffLettersWithText} of ${coverage.staffLetters} Staff letters and ${coverage.responseLettersWithText} of ${coverage.responseLetters} responses have extracted text; ${coverage.issuesWithResponse} of ${coverage.issues} comments paired with a response.${input.episode.closedBy ? ` Review complete per the Staff letter of ${input.episode.closedBy.date_filed}.` : ' No completion letter is on file.'}`,
  });
  for (const staff of input.episode.letters) {
    const kind = staff.kind === 'comments'
      ? `${staff.issues.length} comment${staff.issues.length === 1 ? '' : 's'}`
      : staff.kind === 'review-complete' ? 'review complete'
        : staff.kind === 'no-review' ? 'Staff will not review'
          : staff.kind === 'text-missing' ? 'text not extracted' : 'no numbered comments found';
    blocks.push({ kind: 'heading', text: `Round ${staff.round} · Staff letter ${staff.staffDate} · ${kind}` });
    for (const issue of staff.issues) blocks.push(...issueBlocks(issue));
  }
  return blocks;
}

export function searchBlocks(input: SearchExportInput): ExportBlock[] {
  const shown = input.matches.length;
  const blocks: ExportBlock[] = [
    { kind: 'title', text: 'SEC comment-letter search' },
    { kind: 'meta', label: 'Query', text: input.query || '(no text — filters only)' },
    { kind: 'meta', label: 'Order', text: input.ordering === 'relevance' ? `Relevance, ranked within the ${input.poolDepth.toLocaleString('en-US')} most recent matches` : 'Newest first' },
    ...input.filters.map(text => ({ kind: 'meta' as const, label: 'Filter', text })),
    {
      kind: 'meta',
      label: 'Rows',
      text: `${shown.toLocaleString('en-US')} of ${totalLabel(input.total, input.totalIsFloor)} matching letters${shown < input.total ? ' — the rows loaded on screen when exported, not the full result set' : ''}.`,
    },
    { kind: 'meta', label: 'Exported', text: input.generatedAt },
    { kind: 'heading', text: 'Matches' },
  ];
  for (const match of input.matches) {
    blocks.push({ kind: 'subheading', text: `${match.company_name} · ${letterTypeLabel(match.form)} · ${match.date_filed}` });
    blocks.push({ kind: 'meta', label: 'Letter', text: `${match.accession} · CIK ${match.cik} · ${secLetterIndexUrl(match.cik, match.accession)}` });
    const excerpt = plainHeadline(match.headline);
    if (excerpt) blocks.push({ kind: 'paragraph', text: excerpt, quote: true });
  }
  return blocks;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const ISSUE_COLUMNS = [
  'Round', 'Comment', 'Staff letter filed', 'Staff letter accession', 'Filing section', 'Section inherited',
  'Status', 'Status basis', 'Staff comment', 'Response filed', 'Response accession', 'Response matched by',
  'Response excerpt', 'Response excerpt truncated', 'Follow-ups', 'Staff letter URL', 'Response URL',
];

export function episodeCsv(input: EpisodeExportInput): string {
  const rows: unknown[][] = [
    ['SEC comment-letter review', input.company],
    ['Episode', input.threadId],
    ['CIK', input.cik],
    ['Exported', input.generatedAt],
    ['Issue split', input.episode ? 'Text rules (not AI); verify against the letters' : (input.issuesNote || 'Not available at export time')],
    [],
    ['Letters'],
    ['Filed', 'Letter type', 'Accession', 'Text extracted', 'SEC URL'],
    ...input.letters.map(letter => [
      letter.date_filed, letterTypeLabel(letter.form), letter.accession, letter.has_text ? 'yes' : 'no',
      secLetterIndexUrl(letter.cik, letter.accession),
    ]),
  ];
  if (input.episode) {
    rows.push([], ['Issues'], ISSUE_COLUMNS);
    for (const staff of input.episode.letters) {
      for (const issue of staff.issues) {
        rows.push([
          issue.round,
          issue.issueNumber,
          issue.staffDate,
          issue.staffAccession,
          issue.filingSectionRef ?? '',
          issue.filingSectionInherited ? 'yes' : 'no',
          ISSUE_STATUS_LABEL[issue.status],
          issue.statusBasis,
          issue.staffComment,
          issue.response?.date_filed ?? '',
          issue.response?.accession ?? '',
          issue.response?.matchedBy ?? '',
          issue.response?.excerpt ?? '',
          issue.response?.excerptTruncated ? 'yes' : (issue.response ? 'no' : ''),
          issue.followUp.map(follow => `${follow.staffDate} #${follow.issueNumber}`).join('; '),
          secLetterIndexUrl(issue.cik, issue.staffAccession),
          issue.response ? secLetterIndexUrl(issue.response.cik, issue.response.accession) : '',
        ]);
      }
    }
  }
  return buildCsvRows(rows);
}

export function searchResultsCsv(input: SearchExportInput): string {
  const shown = input.matches.length;
  const rows: unknown[][] = [
    ['SEC comment-letter search'],
    ['Query', input.query || '(no text — filters only)'],
    ['Order', input.ordering === 'relevance' ? `Relevance within the ${input.poolDepth} most recent matches` : 'Newest first'],
    ...input.filters.map(text => ['Filter', text]),
    ['Rows', `${shown} of ${totalLabel(input.total, input.totalIsFloor)} matching letters${shown < input.total ? ' (rows loaded on screen; not the full result set)' : ''}`],
    ['Exported', input.generatedAt],
    [],
    ['Company', 'CIK', 'Letter type', 'Filed', 'Accession', 'Episode', 'Excerpt', 'SEC URL'],
    ...input.matches.map(match => [
      match.company_name, match.cik, letterTypeLabel(match.form), match.date_filed, match.accession,
      match.thread_id, plainHeadline(match.headline), secLetterIndexUrl(match.cik, match.accession),
    ]),
  ];
  return buildCsvRows(rows);
}

// ── Word ────────────────────────────────────────────────────────────────────

export function blocksToDocx(blocks: ExportBlock[]): Document {
  const children = blocks.map(block => {
    switch (block.kind) {
      case 'title':
        return new Paragraph({ text: block.text, heading: HeadingLevel.TITLE, spacing: { after: 200 } });
      case 'heading':
        return new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } });
      case 'subheading':
        return new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } });
      case 'meta':
        return new Paragraph({
          children: [new TextRun({ text: `${block.label}: `, bold: true }), new TextRun({ text: block.text })],
          spacing: { after: 60 },
        });
      case 'paragraph':
        return new Paragraph({
          children: [new TextRun({ text: block.text, italics: block.quote === true })],
          indent: block.quote ? { left: 360 } : undefined,
          spacing: { after: 120 },
        });
    }
  });
  return new Document({
    creator: 'Uniqus Research Center',
    title: blocks.find(block => block.kind === 'title')?.text ?? 'Comment letters',
    sections: [{ properties: {}, children }],
  });
}

export function buildEpisodeDocx(input: EpisodeExportInput): Document {
  return blocksToDocx(episodeBlocks(input));
}

export function buildSearchResultsDocx(input: SearchExportInput): Document {
  return blocksToDocx(searchBlocks(input));
}

export async function docxBlob(document: Document): Promise<Blob> {
  return Packer.toBlob(document);
}

export function exportFilename(stub: string, extension: 'csv' | 'docx', date = new Date()): string {
  const safe = stub.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'comment_letters';
  return `URC_${safe}_${date.toISOString().slice(0, 10)}.${extension}`;
}

export function csvBlob(csv: string): Blob {
  return new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
