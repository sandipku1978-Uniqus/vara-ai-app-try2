/**
 * Alert digest → Word document, so a user can forward the last day's or
 * week's alert hits by hand until the product sends email itself.
 *
 * Built on the shared docx helpers (docxShared) like the memo and answer
 * exports: title and provenance lines, one section per alert with a table of
 * its hits (company, form, filing date, section, passage, SEC link), and a
 * method note saying where every passage came from. A hit whose text was not
 * read says so in the passage cell instead of quoting an unread highlight.
 *
 * The builder is pure and returns a docx Document (tests pack it and read
 * document.xml); exportAlertDigestDocx is the client-only download wrapper.
 */
import { HeadingLevel, Paragraph, TextRun, type Document } from 'docx';
import { buildDocument, downloadBlob, labelledLine, packDocx, safeFileStem, simpleTable, type DocxBlock } from './docxShared';
import { groupHitsByAlert, secUrlForHit, type AlertHit } from './alertHits';

export type DigestWindow = '24h' | '7d';

export const DIGEST_WINDOW_LABELS: Record<DigestWindow, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
};

export const DIGEST_WINDOW_MS: Record<DigestWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export interface AlertDigestInput {
  window: DigestWindow;
  generatedAt: Date;
  /** Display name from the signed-in session; null when none is available. */
  author: string | null;
  hits: AlertHit[];
  /** Hits the server reported for the window (may exceed hits.length). */
  total: number;
}

export interface DigestSummary {
  hits: number;
  alerts: number;
  newFilings: number;
  amendments: number;
  unseen: number;
}

export function summarizeDigest(hits: readonly AlertHit[]): DigestSummary {
  return {
    hits: hits.length,
    alerts: new Set(hits.map(hit => hit.alertClientKey)).size,
    newFilings: hits.filter(hit => !hit.isAmendment).length,
    amendments: hits.filter(hit => hit.isAmendment).length,
    unseen: hits.filter(hit => !hit.seenAt).length,
  };
}

function passageCell(hit: AlertHit): string {
  if (hit.passageBasis !== 'validated-text') {
    return '— (EDGAR full-text search matched this filing; its text was not read, so no passage is quoted)';
  }
  return hit.passage.trim() || '— (the filing text matched, but no passage could be quoted)';
}

function formCell(hit: AlertHit): string {
  if (!hit.isAmendment) return hit.form || '—';
  return `${hit.form || 'Amendment'} (amends ${hit.amendsAccession || 'a filing already surfaced'})`;
}

export function buildAlertDigestDocument(input: AlertDigestInput): Document {
  const windowLabel = DIGEST_WINDOW_LABELS[input.window];
  const title = `Alert digest — ${windowLabel}`;
  const summary = summarizeDigest(input.hits);
  const children: DocxBlock[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    labelledLine('Generated', input.generatedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'),
    labelledLine('Window', `Hits recorded in the ${windowLabel} (since ${new Date(input.generatedAt.getTime() - DIGEST_WINDOW_MS[input.window]).toISOString().slice(0, 16).replace('T', ' ')} UTC)`),
    labelledLine('Author', input.author || 'Not recorded (no signed-in display name)'),
    labelledLine('Source', 'Uniqus Research Center — SEC EDGAR, saved alerts checked on the server'),
    labelledLine(
      'Summary',
      `${summary.hits.toLocaleString()} hit${summary.hits === 1 ? '' : 's'} across ${summary.alerts.toLocaleString()} alert${summary.alerts === 1 ? '' : 's'}`
        + ` — ${summary.newFilings.toLocaleString()} new filing${summary.newFilings === 1 ? '' : 's'}`
        + (summary.amendments > 0 ? `, ${summary.amendments.toLocaleString()} amendment${summary.amendments === 1 ? '' : 's'} of filings already surfaced` : ''),
    ),
  ];
  if (input.total > input.hits.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `This document lists the first ${input.hits.length.toLocaleString()} of ${input.total.toLocaleString()} hits in the window. Open the digest in the Research Center for the rest.`, bold: true })],
      spacing: { after: 120 },
    }));
  }

  const groups = groupHitsByAlert(input.hits);
  if (groups.length === 0) {
    children.push(new Paragraph({ text: `No alert hits were recorded in the ${windowLabel}.`, spacing: { before: 200 } }));
  }
  for (const group of groups) {
    children.push(new Paragraph({ text: group.alertName, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }));
    children.push(simpleTable(
      ['Company', 'Form', 'Filed', 'Section', 'Passage', 'SEC URL'],
      group.hits.map(hit => {
        const url = secUrlForHit(hit);
        return [
          hit.company || `CIK ${hit.cik}`,
          formCell(hit),
          hit.filedAt || '—',
          hit.sectionPath || '—',
          // Plain text, never re-parsed as Markdown: a passage is a quotation.
          { text: passageCell(hit) },
          { text: url, url },
        ];
      }),
    ));
  }

  children.push(new Paragraph({ text: 'Method', heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }));
  children.push(new Paragraph({
    text: 'Each saved alert is re-run on the server over filings filed since its previous check. A hit is a filing the alert had not reported before. '
      + 'Passages are quoted from the filing text the validator fetched and matched; where EDGAR full-text search answered on its own, no text was read and no passage is quoted. '
      + 'An amendment of a filing the alert already reported for the same period is listed as an amendment rather than as a new filing.',
    spacing: { after: 120 },
  }));
  return buildDocument(children, title);
}

export function alertDigestFileStem(window: DigestWindow, date: Date): string {
  return `URC_alert_digest_${safeFileStem(window, 'window')}_${date.toISOString().slice(0, 10)}`;
}

/** Client-only: build and download the digest .docx. */
export async function exportAlertDigestDocx(input: AlertDigestInput): Promise<void> {
  const blob = await packDocx(buildAlertDigestDocument(input));
  downloadBlob(blob, `${alertDigestFileStem(input.window, input.generatedAt)}.docx`);
}
