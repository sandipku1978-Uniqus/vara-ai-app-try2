'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Loader2, X } from 'lucide-react';
import AlertHitCard from './AlertHitCard';
import {
  fetchAlertHits,
  groupHitsByAlert,
  markAlertHitsSeen,
  refreshAlertHitSummary,
  useAlertHitSummary,
  type AlertHit,
} from '../../services/alertHits';
import '../../styles/evidence-ledger.css';
import './Alerts.css';

/** How often an open tab re-reads the unread count (the evaluator runs every 15 minutes). */
const SUMMARY_REFRESH_MS = 5 * 60 * 1000;
const PANEL_PAGE_SIZE = 100;

/**
 * Header bell for alert notifications: the unread count from any page, and a
 * panel listing new hits grouped by the alert that found them. Hidden when
 * the deployment has no durable alert storage or the visitor is not a
 * signed-in account — there is nothing to notify about then.
 */
export default function AlertBell() {
  const summary = useAlertHitSummary();
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<AlertHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void refreshAlertHitSummary();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAlertHitSummary();
    }, SUMMARY_REFRESH_MS);
    const onFocus = () => { void refreshAlertHitSummary(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const loadHits = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await fetchAlertHits({ unseenOnly: true, limit: PANEL_PAGE_SIZE });
    if (result.ok) setHits(result.value.hits);
    else setError(result.error || 'Alert notifications could not be loaded.');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) void loadHits();
  }, [open, loadHits, summary.version]);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const markSeen = useCallback(async (target: Parameters<typeof markAlertHitsSeen>[0], optimisticIds: string[] | 'all') => {
    const previous = hits;
    setHits(current => (optimisticIds === 'all' ? [] : current.filter(hit => !optimisticIds.includes(hit.id))));
    const result = await markAlertHitsSeen(target);
    if (!result.ok) {
      setHits(previous);
      setError(result.error || 'The hits could not be marked as seen.');
    }
  }, [hits]);

  if (summary.status === 'unavailable') return null;

  const count = summary.unseen;
  const groups = groupHitsByAlert(hits);
  const label = `${open ? 'Close' : 'Open'} alert notifications (${count} new hit${count === 1 ? '' : 's'})`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="alert-bell-trigger"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-controls="urc-alert-panel"
        aria-label={label}
        title="Alert notifications"
      >
        <Bell size={16} aria-hidden="true" />
        {count > 0 && <span className="alert-bell-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <aside ref={panelRef} id="urc-alert-panel" className="alert-panel el-scope" aria-label="Alert notifications">
          <header className="alert-panel-header">
            <div>
              <div className="alert-panel-eyebrow">Checked on the server while you are away</div>
              <h2>New alert hits</h2>
            </div>
            <button type="button" className="alert-hit-btn" onClick={close} aria-label="Close alert notifications">
              <X size={14} aria-hidden="true" />
            </button>
          </header>

          <div className="alert-panel-body" aria-live="polite">
            {error && <div role="alert" className="alert-panel-state" style={{ color: 'var(--status-error)' }}>{error}</div>}
            {loading && hits.length === 0 ? (
              <div className="alert-panel-state"><Loader2 size={14} className="spinner" aria-hidden="true" /> Loading new hits…</div>
            ) : groups.length === 0 && !error ? (
              <div className="alert-panel-state">
                No new hits. Saved alerts are checked on the server — daily alerts about once a day, weekly alerts once a week.
                {summary.unseenAmendments > 0 && ` ${summary.unseenAmendments} amendment${summary.unseenAmendments === 1 ? '' : 's'} of filings already surfaced are listed in the digest.`}
              </div>
            ) : (
              groups.map(group => (
                <section key={group.alertClientKey} className="alert-group" aria-label={`${group.alertName}: ${group.hits.length} new`}>
                  <div className="alert-group-head">
                    <h3>{group.alertName} <span className="alert-hit-muted">· {group.hits.length} new</span></h3>
                    <button
                      type="button"
                      className="alert-hit-btn"
                      onClick={() => void markSeen({ alertKey: group.alertClientKey }, group.hits.map(hit => hit.id))}
                    >
                      <CheckCheck size={13} aria-hidden="true" /> Mark alert seen
                    </button>
                  </div>
                  <ul className="alert-group-list">
                    {group.hits.map(hit => (
                      <li key={hit.id}>
                        <AlertHitCard
                          hit={hit}
                          onNavigate={() => setOpen(false)}
                          onMarkSeen={item => void markSeen({ hitIds: [item.id] }, [item.id])}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>

          <footer className="alert-panel-footer">
            <Link href="/alerts" className="alert-hit-btn" onClick={() => setOpen(false)}>Open the daily digest</Link>
            {hits.length > 0 && (
              <button type="button" className="alert-hit-btn" onClick={() => void markSeen({ all: true }, 'all')}>
                <CheckCheck size={13} aria-hidden="true" /> Mark everything seen
              </button>
            )}
          </footer>
        </aside>
      )}
    </>
  );
}
