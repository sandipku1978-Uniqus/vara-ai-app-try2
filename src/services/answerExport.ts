/**
 * Copilot answer → Word.
 *
 * The answer as shown, then its citations (with live SEC links where the
 * citation carries one), the evidence packet's summary, findings and notes,
 * and the evidence-package appendix. The citation table is numbered for
 * reference; unlike the memo draft, the answer prompt does not key [n]
 * markers to those rows, so none are linked.
 */
import { HeadingLevel, Paragraph, TextRun, type Document } from 'docx';
import type { AgentCitation, AgentEvidencePacket, AgentRun } from '../types/agent';
import type { EvidencePackage } from './evidencePackage';
import {
  buildDocument,
  downloadBlob,
  evidenceAppendixBlocks,
  labelledLine,
  markdownToDocxBlocks,
  packDocx,
  safeFileStem,
  simpleTable,
  type DocxBlock,
  type DocxCell,
} from './docxShared';
import { formatExportDate } from './memoExport';

export interface AnswerExportInput {
  run: AgentRun;
  evidence: AgentEvidencePacket | null;
  author: string | null;
  generatedAt: Date;
  evidencePackage: EvidencePackage;
}

const SEC_HOST = /^https:\/\/(www\.)?sec\.gov\//i;

function citationLink(citation: AgentCitation): DocxCell {
  const url = citation.externalUrl && SEC_HOST.test(citation.externalUrl) ? citation.externalUrl : '';
  return url ? { text: url, url } : '— (in-app reference)';
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } });
}

export function buildAnswerDocument(input: AnswerExportInput): Document {
  const { run, evidence } = input;
  const citations = evidence?.citations || [];
  const title = evidence?.title?.trim() ? `Copilot answer — ${evidence.title.trim()}` : 'Copilot answer';
  const children: DocxBlock[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    labelledLine('Question', run.prompt),
    labelledLine('Date', formatExportDate(input.generatedAt)),
    labelledLine('Author', input.author || 'Not recorded (no signed-in display name)'),
    labelledLine('Run', `${run.status}, started ${run.startedAt}${run.completedAt ? `, completed ${run.completedAt}` : ''}`),
    sectionHeading('Answer'),
    ...(run.answer.trim()
      // The copilot answer prompt does not number its sources, so bracketed
      // numbers in the prose are left exactly as written rather than linked to
      // citation rows they were never keyed to.
      ? markdownToDocxBlocks(run.answer)
      : [new Paragraph({ text: 'This run has no answer.' })]),
  ];

  children.push(sectionHeading('Citations'));
  children.push(citations.length > 0
    ? simpleTable(
        ['n', 'Kind', 'Title', 'Detail', 'Section', 'Excerpt', 'SEC URL'],
        citations.map((citation, index) => [
          String(index + 1),
          citation.kind,
          { text: citation.title },
          { text: citation.subtitle || citation.meta || '—' },
          { text: citation.sectionLabel || '—' },
          { text: citation.excerpt?.trim() || '—' },
          citationLink(citation),
        ]),
      )
    : new Paragraph({ text: 'The run produced no citations.' }));

  children.push(sectionHeading('Evidence packet'));
  children.push(labelledLine('Title', evidence?.title || 'Not recorded'));
  children.push(labelledLine('Summary', evidence?.summary || 'No evidence packet was recorded for this run.'));
  if (evidence?.findings.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Findings', bold: true })], spacing: { before: 120, after: 60 } }));
    for (const finding of evidence.findings) children.push(new Paragraph({ children: [new TextRun({ text: finding })], bullet: { level: 0 } }));
  }
  if (evidence?.notes.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Run notes', bold: true })], spacing: { before: 120, after: 60 } }));
    for (const note of evidence.notes) children.push(new Paragraph({ children: [new TextRun({ text: note })], bullet: { level: 0 } }));
  }
  if (run.plan) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Planned actions', bold: true })], spacing: { before: 120, after: 60 } }));
    for (const action of run.plan.actions) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${action.title} (${action.type})` })], bullet: { level: 0 } }));
    }
  }

  children.push(...evidenceAppendixBlocks(input.evidencePackage));
  return buildDocument(children, title);
}

export function answerFileStem(run: AgentRun, date: Date): string {
  return `URC_copilot_${safeFileStem(run.prompt.slice(0, 48), 'answer')}_${formatExportDate(date)}`;
}

/** Client-only: build and download the answer .docx. */
export async function exportAnswerDocx(input: AnswerExportInput): Promise<void> {
  const blob = await packDocx(buildAnswerDocument(input));
  downloadBlob(blob, `${answerFileStem(input.run, input.generatedAt)}.docx`);
}
