'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { similarCommentQuery, type CommentIssue } from '../../services/commentIssues';
import { secLetterIndexUrl } from '../../services/letterExport';

export const SIMILAR_COMMENTS_LIMIT = 10;

interface SimilarMatch {
  accession: string;
  cik: number;
  company_name: string;
  date_filed: string;
  thread_id: string;
  headline: string;
}

/** ts_headline emits only <b>; escape everything else before re-enabling it. */
function highlighted(headline: string): { __html: string } {
  const escaped = headline.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    __html: escaped
      .replace(/&lt;b&gt;/g, '<mark style="background:var(--interactive-hover-strong);color:var(--accent-primary);padding:0 2px;border-radius:2px;">')
      .replace(/&lt;\/b&gt;/g, '</mark>'),
  };
}

/**
 * "Similar comments", first version: a bounded full-text search over Staff
 * letters for the comment's key phrases (a standards citation and its most
 * distinctive words). Labelled as a text search — it is not a semantic match.
 */
export default function SimilarLetterComments({ issue, company }: { issue: CommentIssue; company: string }) {
  const query = useMemo(
    () => similarCommentQuery(issue.staffComment, issue.filingSectionRef, company),
    [company, issue.filingSectionRef, issue.staffComment]
  );
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'done'; matches: SimilarMatch[]; total: number; totalIsFloor: boolean }
    | { phase: 'error' }
  >({ phase: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    setState({ phase: 'loading' });
    const params = new URLSearchParams({ q: query.query, form: 'UPLOAD', size: String(SIMILAR_COMMENTS_LIMIT + 1) });
    fetch(`/api/letters?${params.toString()}`)
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(payload => {
        if (cancelled) return;
        const matches = ((payload.matches ?? []) as SimilarMatch[])
          .filter(match => match.accession !== issue.staffAccession)
          .slice(0, SIMILAR_COMMENTS_LIMIT);
        setState({ phase: 'done', matches, total: Number(payload.total ?? 0), totalIsFloor: Boolean(payload.totalIsFloor) });
      })
      .catch(() => { if (!cancelled) setState({ phase: 'error' }); });
    return () => { cancelled = true; };
  }, [issue.staffAccession, query, reload]);

  if (!query) {
    return (
      <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
        This comment has no standards citation or distinctive wording to search for, so no similar-comment search was run.
      </p>
    );
  }

  return (
    <div style={{ marginTop: '6px', paddingLeft: '8px', borderLeft: '2px solid var(--border-color)' }}>
      <p style={{ margin: '0 0 6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        Text search over Staff letters for {query.terms.join(' + ')} — a keyword match, not a semantic one.
        {state.phase === 'done' && ` ${state.total > 0 ? `${state.totalIsFloor ? 'More than ' : ''}${state.total.toLocaleString()} matching Staff letter${state.total === 1 ? '' : 's'} (this letter included); the ${state.matches.length} most relevant others are shown.` : 'No other Staff letters matched.'}`}
      </p>
      {state.phase === 'loading' && (
        <div role="status" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Loader2 size={12} className="spinner" aria-hidden="true" /> Searching Staff letters…
        </div>
      )}
      {state.phase === 'error' && (
        <div role="status" style={{ fontSize: '0.74rem', color: 'var(--status-error)' }}>
          The similar-comment search failed; this is not a finding of no similar comments.{' '}
          <button type="button" className="secondary-btn" onClick={() => setReload(key => key + 1)}>Retry</button>
        </div>
      )}
      {state.phase === 'done' && state.matches.length > 0 && (
        <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {state.matches.map(match => (
            <li key={`${match.accession}:${match.cik}`} style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{match.company_name}</strong>
                <span>{match.date_filed}</span>
                <a href={`/comment-letters?thread=${encodeURIComponent(match.thread_id)}&cik=${match.cik}`} style={{ color: 'var(--accent-primary)' }}>
                  Open episode
                </a>
                <a href={secLetterIndexUrl(match.cik, match.accession)} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  EDGAR <ExternalLink size={10} aria-hidden="true" />
                </a>
              </div>
              <div style={{ lineHeight: 1.4 }} dangerouslySetInnerHTML={highlighted(match.headline || '')} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
