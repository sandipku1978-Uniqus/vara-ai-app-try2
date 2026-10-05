'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, Download, Loader2, RefreshCw } from 'lucide-react';
import AlertHitCard from '../components/alerts/AlertHitCard';
import {
  fetchAlertHits,
  groupHitsByAlert,
  markAlertHitsSeen,
  type AlertHit,
} from '../services/alertHits';
import {
  DIGEST_WINDOW_LABELS,
  DIGEST_WINDOW_MS,
  exportAlertDigestDocx,
  summarizeDigest,
  type DigestWindow,
} from '../services/alertDigestExport';
import { readSessionDisplayName } from '../services/memoExport';
import '../styles/evidence-ledger.css';
import '../components/alerts/Alerts.css';

const PAGE_SIZE = 200;
/** The Word export reads at most this many hits (five pages). */
const EXPORT_LIMIT = 1000;
/** Stable default clock (a fresh arrow per render would reload in a loop). */
const systemNow = () => Date.now();

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; total: number }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

/**
 * The daily digest: every hit the scheduled evaluator recorded in the last
 * 24 hours or 7 days, across all alerts, with a Word export to forward by hand.
 */
export default function AlertsDigest({ now = systemNow }: { now?: () => number }) {
  const [windowKey, setWindowKey] = useState<DigestWindow>('24h');
  const [hits, setHits] = useState<AlertHit[]>([]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [sinceMs, setSinceMs] = useState(() => now() - DIGEST_WINDOW_MS['24h']);

  const load = useCallback(async (key: DigestWindow) => {
    const since = now() - DIGEST_WINDOW_MS[key];
    setSinceMs(since);
    setState({ status: 'loading' });
    setMessage('');
    const result = await fetchAlertHits({ since: new Date(since), limit: PAGE_SIZE });
    if (result.ok) {
      setHits(result.value.hits);
      setState({ status: 'ready', total: result.value.total });
    } else if (result.status === 503 || result.status === 403 || result.status === 401) {
      setHits([]);
      setState({ status: 'unavailable', message: result.error });
    } else {
      setState({ status: 'error', message: result.error || 'The digest could not be loaded.' });
    }
  }, [now]);

  useEffect(() => { void load(windowKey); }, [load, windowKey]);

  const total = state.status === 'ready' ? state.total : 0;
  const summary = useMemo(() => summarizeDigest(hits), [hits]);
  const groups = useMemo(() => groupHitsByAlert(hits), [hits]);

  const loadMore = async () => {
    setLoadingMore(true);
    const result = await fetchAlertHits({ since: new Date(sinceMs), offset: hits.length, limit: PAGE_SIZE });
    if (result.ok) setHits(current => [...current, ...result.value.hits.filter(hit => !current.some(existing => existing.id === hit.id))]);
    else setMessage(result.error);
    setLoadingMore(false);
  };

  const exportDigest = async () => {
    setExporting(true);
    setMessage('');
    try {
      let all = hits;
      while (all.length < Math.min(total, EXPORT_LIMIT)) {
        const result = await fetchAlertHits({ since: new Date(sinceMs), offset: all.length, limit: PAGE_SIZE });
        if (!result.ok || result.value.hits.length === 0) break;
        all = [...all, ...result.value.hits];
      }
      await exportAlertDigestDocx({
        window: windowKey,
        generatedAt: new Date(now()),
        author: readSessionDisplayName(),
        hits: all.slice(0, EXPORT_LIMIT),
        total,
      });
    } catch (error) {
      console.error('Alert digest export failed:', error);
      setMessage('The Word digest could not be assembled. Retry in a moment.');
    } finally {
      setExporting(false);
    }
  };

  const markSeen = async (ids: string[]) => {
    const result = await markAlertHitsSeen({ hitIds: ids });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const seenAt = new Date(now()).toISOString();
    setHits(current => current.map(hit => (ids.includes(hit.id) ? { ...hit, seenAt } : hit)));
  };

  return (
    <div className="alerts-digest el-scope">
      <header className="page-header">
        <h1>Alert digest</h1>
        <p>
          Hits your saved alerts found while you were away, checked on the server over newly filed documents.
          Export the digest to Word to forward it.
        </p>
      </header>

      <div className="alerts-digest-controls">
        <div className="alerts-digest-tabs" role="group" aria-label="Digest window">
          {(['24h', '7d'] as const).map(key => (
            <button key={key} type="button" aria-pressed={windowKey === key} onClick={() => setWindowKey(key)}>
              {key === '24h' ? 'Last 24 hours' : 'Last 7 days'}
            </button>
          ))}
        </div>
        <button type="button" className="secondary-btn" onClick={() => void load(windowKey)} disabled={state.status === 'loading'}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void exportDigest()}
          disabled={exporting || state.status !== 'ready'}
        >
          {exporting ? <Loader2 size={14} className="spinner" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Download Word digest
        </button>
        {summary.unseen > 0 && (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void markSeen(hits.filter(hit => !hit.seenAt).map(hit => hit.id).slice(0, 500))}
          >
            <CheckCheck size={14} aria-hidden="true" /> Mark listed hits seen
          </button>
        )}
      </div>

      {message && <div role="alert" className="alert-panel-state" style={{ color: 'var(--status-error)' }}>{message}</div>}

      {state.status === 'loading' && (
        <div className="alert-panel-state"><Loader2 size={14} className="spinner" aria-hidden="true" /> Loading the {DIGEST_WINDOW_LABELS[windowKey]}…</div>
      )}
      {state.status === 'unavailable' && (
        <div className="el-state">
          <strong>Alert notifications are not available for this session.</strong>
          <span>Background alert checks need a signed-in account and saved-research storage on this deployment. {state.message}</span>
        </div>
      )}
      {state.status === 'error' && (
        <div className="el-state" role="alert">
          <strong>The digest could not be loaded.</strong>
          <span>{state.message}</span>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="alerts-digest-summary" aria-label="Digest summary">
            <span className="alerts-digest-chip">{total.toLocaleString()} hit{total === 1 ? '' : 's'} in the {DIGEST_WINDOW_LABELS[windowKey]}</span>
            <span className="alerts-digest-chip">{summary.alerts.toLocaleString()} alert{summary.alerts === 1 ? '' : 's'}</span>
            <span className="alerts-digest-chip">{summary.newFilings.toLocaleString()} new filing{summary.newFilings === 1 ? '' : 's'}</span>
            {summary.amendments > 0 && <span className="alerts-digest-chip">{summary.amendments.toLocaleString()} amendment{summary.amendments === 1 ? '' : 's'}</span>}
            <span className="alerts-digest-chip">{summary.unseen.toLocaleString()} not yet seen</span>
            {hits.length < total && <span className="alerts-digest-chip">showing {hits.length.toLocaleString()} of {total.toLocaleString()}</span>}
          </div>

          {groups.length === 0 ? (
            <div className="el-state">
              <strong>No alert hits in the {DIGEST_WINDOW_LABELS[windowKey]}.</strong>
              <span>Alerts are checked on the server — daily alerts about once a day, weekly alerts once a week — and only filings new to an alert are recorded here.</span>
            </div>
          ) : (
            groups.map(group => (
              <section key={group.alertClientKey} className="alerts-digest-group" aria-label={`${group.alertName}: ${group.hits.length} hit${group.hits.length === 1 ? '' : 's'}`}>
                <h2>{group.alertName} <span className="alert-hit-muted">· {group.hits.length}</span></h2>
                <ul className="alert-group-list">
                  {group.hits.map(hit => (
                    <li key={hit.id}>
                      <AlertHitCard hit={hit} onMarkSeen={item => void markSeen([item.id])} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          {hits.length < total && (
            <button type="button" className="secondary-btn" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={14} className="spinner" aria-hidden="true" /> : null} Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
