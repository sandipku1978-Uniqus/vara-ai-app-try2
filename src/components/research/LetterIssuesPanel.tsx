'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, ListChecks, Loader2 } from 'lucide-react';
import CiteButton from '../memo/CiteButton';
import LetterExportButtons from './LetterExportButtons';
import SimilarLetterComments from './SimilarLetterComments';
import { boundExcerpt, passageKey } from '../../services/memoTray';
import type { CommentIssue, EpisodeIssues, IssueStatus } from '../../services/commentIssues';
import {
  buildEpisodeDocx,
  csvBlob,
  docxBlob,
  downloadBlob,
  episodeCsv,
  exportFilename,
  ISSUE_STATUS_LABEL,
  secLetterIndexUrl,
  type ExportLetter,
} from '../../services/letterExport';

const RESPONSE_PREVIEW_CHARS = 1_200;
const CITATION_EXCERPT_CHARS = 1_500;

interface IssuesPayload {
  episode: EpisodeIssues;
  generatedAt: string;
}

type LoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; data: IssuesPayload }
  | { phase: 'error'; message: string };

const STATUS_COLOR: Record<IssueStatus, string> = {
  resolved: 'var(--status-success)',
  responded: 'var(--accent-primary)',
  open: 'var(--status-warning)',
  unclear: 'var(--text-muted)',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '9px 11px',
};

function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span style={{
      fontSize: '0.68rem',
      padding: '1px 6px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      color: STATUS_COLOR[status],
      border: `1px solid color-mix(in srgb, ${STATUS_COLOR[status]} 45%, transparent)`,
    }}>
      {ISSUE_STATUS_LABEL[status]}
    </span>
  );
}

function IssueRow({ issue, company }: { issue: CommentIssue; company: string }) {
  const [open, setOpen] = useState(false);
  const [fullResponse, setFullResponse] = useState(false);
  const [similar, setSimilar] = useState(false);
  const detailId = useId();
  const response = issue.response;
  const responseText = response
    ? (fullResponse || response.excerpt.length <= RESPONSE_PREVIEW_CHARS ? response.excerpt : `${response.excerpt.slice(0, RESPONSE_PREVIEW_CHARS)}…`)
    : '';

  return (
    <li style={{ listStyle: 'none', borderTop: '1px solid var(--border-color)', padding: '6px 0' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={() => setOpen(value => !value)}
        style={{ display: 'flex', alignItems: 'center', gap: '7px', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)' }}
      >
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        <span style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Comment {issue.issueNumber}</span>
        <StatusBadge status={issue.status} />
        <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {issue.filingSectionRef ?? 'No section heading'}
        </span>
      </button>
      {open && (
        <div id={detailId} style={{ padding: '6px 0 2px 20px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {issue.filingSectionRef && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Filing section: {issue.filingSectionRef}{issue.filingSectionInherited ? ' (heading above the previous comment)' : ''}
            </div>
          )}
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--status-warning)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Staff comment · {issue.staffDate}
            </div>
            <div style={{ whiteSpace: 'pre-line', lineHeight: 1.42 }}>{issue.staffComment}</div>
          </div>
          {issue.followsUp.length > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Follows up comment {issue.followsUp.map(item => `${item.issueNumber} of the Staff letter of ${item.staffDate}`).join(', ')}.
            </div>
          )}
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--status-success)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {response ? `Company response · ${response.date_filed}` : 'Company response'}
            </div>
            {response ? (
              <>
                <div style={{ whiteSpace: 'pre-line', lineHeight: 1.42 }}>{responseText}</div>
                {response.excerpt.length > RESPONSE_PREVIEW_CHARS && (
                  <button type="button" className="secondary-btn" style={{ marginTop: '4px' }} onClick={() => setFullResponse(value => !value)}>
                    {fullResponse ? 'Show less' : `Show the whole response (${response.excerpt.length.toLocaleString()} characters)`}
                  </button>
                )}
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {response.matchedBy === 'comment-text'
                    ? 'Paired by the comment text the response repeats (the response does not number it).'
                    : 'Paired by the comment number the response repeats.'}
                  {response.excerptStart === 'at-match' ? ' The excerpt starts where the comment is repeated and may include its recitation.' : ''}
                  {response.excerptTruncated ? ' Excerpt truncated; read the full letter.' : ''}
                </div>
              </>
            ) : (
              <div style={{ fontStyle: 'italic' }}>No response paired with this comment.</div>
            )}
          </div>
          <div style={{ fontSize: '0.72rem' }}>
            <strong style={{ color: STATUS_COLOR[issue.status] }}>{ISSUE_STATUS_LABEL[issue.status]}:</strong> {issue.statusBasis}
          </div>
          {issue.followUp.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.74rem' }}>
              {issue.followUp.map(follow => (
                <li key={`${follow.staffAccession}#${follow.issueNumber}`}>
                  Staff follow-up, letter of {follow.staffDate}, comment {follow.issueNumber}: {follow.staffComment.slice(0, 280)}{follow.staffComment.length > 280 ? '…' : ''}
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <CiteButton
              compact
              disabledReason={response ? undefined : 'No paired response to cite; cite the letters below instead.'}
              citation={{
                kind: 'letter',
                cik: response?.cik ?? issue.cik,
                accessionNumber: response?.accession ?? issue.staffAccession,
                company,
                form: 'CORRESP',
                fileDate: response?.date_filed ?? issue.staffDate,
                section: `Response to SEC comment ${issue.issueNumber} (Staff letter ${issue.staffDate})`,
                passageKey: response ? passageKey(response.excerpt) : undefined,
                excerpt: response ? boundExcerpt(response.excerpt, CITATION_EXCERPT_CHARS) : '',
                sourceUrl: secLetterIndexUrl(response?.cik ?? issue.cik, response?.accession ?? issue.staffAccession),
              }}
            />
            <a href={secLetterIndexUrl(issue.cik, issue.staffAccession)} target="_blank" rel="noreferrer"
              style={{ color: 'var(--accent-primary)', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              Staff letter <ExternalLink size={10} aria-hidden="true" />
            </a>
            {response && (
              <a href={secLetterIndexUrl(response.cik, response.accession)} target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent-primary)', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                Response letter <ExternalLink size={10} aria-hidden="true" />
              </a>
            )}
            <button type="button" className="secondary-btn" aria-expanded={similar} onClick={() => setSimilar(value => !value)}>
              {similar ? 'Hide similar comments' : 'Similar comments'}
            </button>
          </div>
          {similar && <SimilarLetterComments issue={issue} company={company} />}
        </div>
      )}
    </li>
  );
}

function letterKindLabel(kind: EpisodeIssues['letters'][number]['kind'], count: number): string {
  if (kind === 'comments') return `${count} comment${count === 1 ? '' : 's'}`;
  if (kind === 'review-complete') return 'review complete';
  if (kind === 'no-review') return 'Staff will not review';
  if (kind === 'text-missing') return 'text not extracted';
  return 'no numbered comments found';
}

/**
 * The comment-by-comment view of a review episode, with cite-to-memo on each
 * response and episode export. Loaded on request: the split reads every
 * letter's full text.
 */
export default function LetterIssuesPanel({ threadId, company, letters }: {
  threadId: string;
  company: string;
  letters: ExportLetter[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ phase: 'idle' });
  const inflight = useRef<Promise<IssuesPayload> | null>(null);
  const bodyId = useId();

  const load = useCallback((): Promise<IssuesPayload> => {
    if (state.phase === 'ready') return Promise.resolve(state.data);
    if (inflight.current) return inflight.current;
    setState({ phase: 'loading' });
    const request = fetch(`/api/letters/issues?thread=${encodeURIComponent(threadId)}`)
      .then(async response => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.episode) throw new Error(payload?.error || `Issue split failed (${response.status}).`);
        const data: IssuesPayload = { episode: payload.episode as EpisodeIssues, generatedAt: String(payload.generatedAt || '') };
        setState({ phase: 'ready', data });
        return data;
      })
      .catch(error => {
        setState({ phase: 'error', message: error instanceof Error ? error.message : 'Issue split failed.' });
        throw error;
      })
      .finally(() => { inflight.current = null; });
    inflight.current = request;
    return request;
  }, [state, threadId]);

  const exportInput = async () => {
    let episode: EpisodeIssues | null = null;
    let issuesNote: string | undefined;
    try {
      episode = (await load()).episode;
    } catch (error) {
      issuesNote = `The issue split could not be loaded (${error instanceof Error ? error.message : 'unknown error'}); the letters below are complete.`;
    }
    return {
      threadId,
      company,
      cik: letters[0]?.cik ?? '',
      letters,
      episode,
      issuesNote,
      generatedAt: new Date().toISOString(),
    };
  };

  const episode = state.phase === 'ready' ? state.data.episode : null;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next && state.phase === 'idle') void load().catch(() => undefined);
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-soft)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          <ListChecks size={13} aria-hidden="true" /> Comments and responses
          {episode && <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text-muted)' }}>· {episode.coverage.issues} comment{episode.coverage.issues === 1 ? '' : 's'}</span>}
        </button>
        <LetterExportButtons
          subject="this review episode"
          onCsv={async () => {
            const input = await exportInput();
            downloadBlob(exportFilename(`${company}_letters_${input.letters[0]?.date_filed ?? ''}`, 'csv'), csvBlob(episodeCsv(input)));
          }}
          onDocx={async () => {
            const input = await exportInput();
            downloadBlob(exportFilename(`${company}_letters_${input.letters[0]?.date_filed ?? ''}`, 'docx'), await docxBlob(buildEpisodeDocx(input)));
          }}
        />
      </div>
      {open && (
        <div id={bodyId} style={{ marginTop: '6px' }}>
          {state.phase === 'loading' && (
            <div role="status" style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Loader2 size={13} className="spinner" aria-hidden="true" /> Splitting the Staff letters into comments…
            </div>
          )}
          {state.phase === 'error' && (
            <div role="status" style={{ fontSize: '0.76rem', color: 'var(--status-error)' }}>
              {state.message}{' '}
              <button type="button" className="secondary-btn" onClick={() => { setState({ phase: 'idle' }); void load().catch(() => undefined); }}>Retry</button>
            </div>
          )}
          {episode && (
            <>
              <p style={{ margin: '0 0 6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Split by the Staff letters&apos; own numbering and paired with responses that repeat the comment — text rules, not AI.
                {' '}{episode.coverage.issuesWithResponse} of {episode.coverage.issues} comments paired with a response
                {episode.coverage.staffLettersWithText < episode.coverage.staffLetters ? `; ${episode.coverage.staffLetters - episode.coverage.staffLettersWithText} Staff letter(s) have no extracted text` : ''}
                {episode.coverage.responseLettersWithText < episode.coverage.responseLetters ? `; ${episode.coverage.responseLetters - episode.coverage.responseLettersWithText} response(s) have no extracted text` : ''}.
                {episode.closedBy ? ` Review complete per the Staff letter of ${episode.closedBy.date_filed}.` : ' No completion letter is on file, so no comment is marked resolved.'}
              </p>
              {episode.letters.map(staff => (
                <section key={staff.staffAccession} aria-label={`Staff letter of ${staff.staffDate}`} style={{ marginTop: '6px' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Round {staff.round} · Staff letter {staff.staffDate} · {letterKindLabel(staff.kind, staff.issues.length)}
                  </div>
                  {staff.issues.length > 0 && (
                    <ul style={{ margin: '4px 0 0', padding: 0 }}>
                      {staff.issues.map(issue => <IssueRow key={issue.key} issue={issue} company={company} />)}
                    </ul>
                  )}
                </section>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
