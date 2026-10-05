'use client';

/**
 * ASU index tab of the Accounting hub: every Update FASB lists as issued plus
 * the proposals open for comment, from /api/asu. Each row links to FASB's PDF,
 * runs "filings citing this ASU" in the Research Workbench, and opens the
 * issue page its Codification topic maps to. Rows carry stable anchors
 * (#asu-2023-07) so a filing hit or a checklist item can link straight back.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import {
  asuCitationSearchHref,
  asuRowId,
  fetchAsuIndex,
  findAsu,
  formatAsuIssued,
  type AsuEntry,
  type AsuIndex,
} from '../../services/asuIndex';
import { accountingIssueForAsu, accountingIssueHref } from '../../config/accountingTopics';
import '../../views/AccountingIssuePage.css';

type StatusFilter = 'all' | 'issued' | 'proposed';

export function filterAsuEntries(entries: readonly AsuEntry[], query: string, status: StatusFilter): AsuEntry[] {
  const needle = query.trim().toLowerCase().replace(/^asu\s*(no\.\s*)?/, '').replace(/^asc\s*/, '');
  return entries.filter(entry => {
    if (status !== 'all' && entry.status !== status) return false;
    if (!needle) return true;
    return entry.number.toLowerCase().includes(needle)
      || entry.title.toLowerCase().includes(needle)
      || entry.ascTopics.some(topic => topic.startsWith(needle))
      || entry.ascSubtopics.some(subtopic => subtopic.startsWith(needle));
  });
}

function describeSource(index: AsuIndex): string {
  const { coverage } = index;
  const reads = [...new Set(coverage.pages.filter(page => page.readAt).map(page => page.readAt!.slice(0, 10)))];
  const origin = coverage.source === 'live'
    ? 'read live from fasb.org'
    : coverage.source === 'partial'
      ? 'partly read live from fasb.org, partly from the saved fasb.org copy'
      : 'served from the saved fasb.org copy because fasb.org refused the server';
  return `${coverage.issuedCount} issued Updates (${coverage.issuedYears ? `${coverage.issuedYears.earliest}–${coverage.issuedYears.latest}` : 'no years'}) and ${coverage.proposedCount} proposals open for comment, ${origin}${reads.length ? ` (read ${reads.join(', ')})` : ''}${coverage.fromCache ? '; cached' : ''}. ${coverage.withEffectiveDates} carry FASB’s effective-date wording.`;
}

export default function AsuIndexPanel({ focusNumber }: { focusNumber?: string | null }) {
  const [index, setIndex] = useState<AsuIndex | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    fetchAsuIndex()
      .then(result => {
        if (cancelled) return;
        setIndex(result);
        setState('done');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const target = useMemo(() => (index && focusNumber ? findAsu(index.entries, focusNumber) : undefined), [index, focusNumber]);
  const visible = useMemo(() => {
    if (!index) return [];
    const filtered = filterAsuEntries(index.entries, query, status);
    // A linked-to row is never hidden by a filter the visitor did not set.
    return target && !filtered.includes(target) ? [target, ...filtered] : filtered;
  }, [index, query, status, target]);

  useEffect(() => {
    if (!target) return;
    const element = document.getElementById(asuRowId(target.number));
    element?.scrollIntoView?.({ block: 'center' });
    element?.focus?.({ preventScroll: true });
  }, [target]);

  return (
    <div className="tab-pane fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="pane-header">
        <h2>Accounting Standards Updates</h2>
        <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0' }}>
          Every Update FASB lists as issued, and the proposed Updates open for comment, read from fasb.org. Open the PDF, run the filings that cite an Update, or go to its issue page.
        </p>
      </div>

      {state === 'done' && index && (
        <div role="status" className="issue-panel-coverage">
          <span className="issue-panel-label">Source</span> FASB “Accounting Standards Updates Issued”, “Effective Dates”, and “Documents Open for Comment” listings.{' '}
          <span className="issue-panel-label">Coverage</span> {describeSource(index)}
          {index.coverage.notes.length > 0 && (
            <ul className="issue-notes">
              {index.coverage.notes.map(note => <li key={note}>{note}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="asu-index-toolbar">
        <div className="search-bar" style={{ flex: '1 1 260px' }}>
          <Search size={16} className="search-icon" aria-hidden="true" />
          <label className="sr-only" htmlFor="asu-index-search">Filter ASUs by number, title, or ASC topic</label>
          <input
            id="asu-index-search"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="2023-07, segment, 842…"
          />
        </div>
        <label className="sr-only" htmlFor="asu-index-status">Status</label>
        <select id="asu-index-status" className="ai-input" style={{ flex: '0 0 auto' }} value={status} onChange={event => setStatus(event.target.value as StatusFilter)}>
          <option value="all">Issued and proposed</option>
          <option value="issued">Issued</option>
          <option value="proposed">Proposed (open for comment)</option>
        </select>
      </div>

      {state === 'loading' && <p className="issue-muted"><Loader2 size={14} className="spinner" aria-hidden="true" /> Reading the ASU index…</p>}
      {state === 'error' && (
        <div role="alert" className="issue-error">
          The ASU index could not be loaded.{' '}
          <button type="button" className="secondary-btn sm" onClick={() => setReloadKey(key => key + 1)}>Retry</button>
        </div>
      )}
      {focusNumber && state === 'done' && !target && (
        <p role="status" className="issue-muted">ASU {focusNumber} is not in the index read from FASB.</p>
      )}

      {state === 'done' && (
        <>
          <p className="issue-meta" aria-live="polite">Showing {visible.length} of {index?.entries.length ?? 0} Updates</p>
          <ol className="issue-list">
            {visible.map(entry => {
              const issue = accountingIssueForAsu(entry);
              const isTarget = target?.number === entry.number;
              return (
                <li
                  key={entry.number}
                  id={asuRowId(entry.number)}
                  tabIndex={isTarget ? -1 : undefined}
                  className={`issue-list-item asu-index-row${isTarget ? ' asu-index-row--target' : ''}`}
                >
                  <div className="issue-list-title">
                    <strong>{entry.status === 'proposed' ? `Proposed ${entry.number}` : `ASU ${entry.number}`}</strong>
                    <span className="issue-meta">
                      {entry.status === 'proposed'
                        ? `Open for comment · deadline ${entry.commentDeadline ?? 'not listed'}`
                        : `Issued ${formatAsuIssued(entry)}`}
                      {entry.topic ? ` · ${entry.topic}` : ''}
                    </span>
                  </div>
                  <p className="issue-snippet">{entry.title}</p>
                  {entry.effectiveDates && (
                    <details className="issue-details">
                      <summary>Effective dates (FASB)</summary>
                      <p className="issue-effective">{entry.effectiveDates}</p>
                    </details>
                  )}
                  <span className="issue-actions-inline">
                    {entry.documents.length > 1
                      ? entry.documents.map(document => (
                        <a key={document.url} href={document.url} target="_blank" rel="noopener noreferrer">{document.label} PDF <ExternalLink size={12} aria-hidden="true" /></a>
                      ))
                      : entry.pdfUrl && <a href={entry.pdfUrl} target="_blank" rel="noopener noreferrer">PDF on fasb.org <ExternalLink size={12} aria-hidden="true" /></a>}
                    {entry.status === 'issued' && (
                      <Link href={asuCitationSearchHref(entry.number)}>Filings citing ASU {entry.number} (10-K, last 2 years)</Link>
                    )}
                    {issue && <Link href={accountingIssueHref(issue.id)}>Issue page: {issue.label}</Link>}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
