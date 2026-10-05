'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BellRing, Loader2, Play, Search as SearchIcon, X } from 'lucide-react';
import { useApp, type SavedAlert } from '../../context/AppState';
import { buildSavedAlertRouteParams, type SavedAlertCoverage } from '../../services/alertRoutes';
import {
  formatRelativeTime,
  refreshAlertHitSummary,
  runAlertNow,
  useAlertHitSummary,
} from '../../services/alertHits';
import { isAccountStorageScope } from '../../services/storageNamespace';
import {
  fetchUserData,
  getUserDataStatus,
  isAccountUserDataScope,
  subscribeUserDataStatus,
  type UserAlertItem,
  type UserDataStatus,
} from '../../services/userData';
import './Alerts.css';

const INCOMPLETE_REASON_LABELS: Record<NonNullable<NonNullable<SavedAlertCoverage['branches']>[number]['incompleteReason']>, string> = {
  'doc-budget': 'document budget reached',
  'page-budget': 'page budget reached',
  deadline: 'time limit reached',
  error: 'source error',
  cancelled: 'check cancelled',
  'display-limit': 'result display limit reached',
};

/** The evidence ledger of the latest check: coverage, unfinished branches, measured work. */
export function AlertCoverageState({ coverage }: { coverage: SavedAlertCoverage }) {
  const requiredBranches = coverage.branches?.filter(branch => branch.required) ?? [];
  const unfinishedBranches = requiredBranches.filter(branch => !branch.exhausted);
  const completedBranchCount = requiredBranches.length - unfinishedBranches.length;
  const upstreamTotal = `${coverage.upstreamTotal.toLocaleString()}${coverage.upstreamTotalIsFloor ? '+' : ''}`;
  const server = coverage as SavedAlertCoverage & { reason?: unknown; windowFrom?: unknown; windowTo?: unknown };

  return (
    <div
      className={`alert-coverage ${coverage.complete ? 'alert-coverage-complete' : 'alert-coverage-partial'}`}
      data-coverage-state={coverage.complete ? 'complete' : 'partial'}
    >
      <p className="alert-coverage-summary">
        <strong>{coverage.complete ? 'Complete coverage' : 'Partial coverage'}</strong>
        <span>Examined {coverage.examined.toLocaleString()} of {upstreamTotal} upstream candidates</span>
        {typeof server.windowFrom === 'string' && typeof server.windowTo === 'string' && (
          <span>filed {server.windowFrom} → {server.windowTo}</span>
        )}
        {requiredBranches.length > 0 && (
          <span>{completedBranchCount}/{requiredBranches.length} required branches complete</span>
        )}
      </p>
      {!coverage.complete && typeof server.reason === 'string' && server.reason && (
        <p className="alert-coverage-work">{server.reason}</p>
      )}
      {unfinishedBranches.length > 0 && (
        <ul className="alert-coverage-branches" aria-label="Unfinished Boolean branches">
          {unfinishedBranches.map((branch, index) => (
            <li key={`${branch.branch}-${index}`}>
              <code>{branch.branch}</code>
              <span>
                {branch.incompleteReason
                  ? (INCOMPLETE_REASON_LABELS[branch.incompleteReason] ?? branch.incompleteReason)
                  : 'did not finish'}
                {' · '}{branch.examined.toLocaleString()} examined
                {' · '}{branch.pages.toLocaleString()} page{branch.pages === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {coverage.work && (
        <p className="alert-coverage-work">
          Measured work: {coverage.work.totalUpstreamRequests.toLocaleString()} upstream requests
          {' · '}pages {coverage.work.pageRequests.toLocaleString()}/{coverage.work.ceiling.pages.toLocaleString()}
          {' · '}document attempts {coverage.work.docHttpAttempts.toLocaleString()}/{coverage.work.ceiling.docHttpAttempts.toLocaleString()}
          {' · '}documents hydrated {coverage.work.docFetches.toLocaleString()}
          {' · '}pre-screen {coverage.work.prescreenRequests.toLocaleString()}/{coverage.work.ceiling.prescreenRequests.toLocaleString()}
        </p>
      )}
    </div>
  );
}

interface CheckState {
  lastCheckedAt: string | null;
  coverage: SavedAlertCoverage | null;
  matched: number;
  cadence: 'daily' | 'weekly';
}

function isCoverage(value: unknown): value is SavedAlertCoverage {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as SavedAlertCoverage).complete === 'boolean'
    && typeof (value as SavedAlertCoverage).examined === 'number'
    && typeof (value as SavedAlertCoverage).upstreamTotal === 'number';
}

function checkStateFromServer(item: UserAlertItem): CheckState {
  return {
    lastCheckedAt: item.lastCheckedAt,
    coverage: isCoverage(item.lastCheckCoverage) ? item.lastCheckCoverage : null,
    matched: item.lastHitCount,
    cadence: item.cadence,
  };
}

function checkStateFromLocal(alert: SavedAlert): CheckState {
  return {
    lastCheckedAt: alert.lastCheckedAt || null,
    coverage: isCoverage(alert.lastCheckCoverage) ? alert.lastCheckCoverage : null,
    matched: alert.latestResultCount,
    cadence: alert.cadence === 'weekly' ? 'weekly' : 'daily',
  };
}

/**
 * The account store is known to be out of reach: the identity settled on a
 * browser-only scope, or the store answered "unavailable". A scope that has
 * not settled yet (null) is not a verdict.
 */
export function isAccountStoreUnavailable(status: Pick<UserDataStatus, 'mode' | 'scope'>): boolean {
  return status.mode === 'unavailable' || (status.mode === 'local' && status.scope !== null);
}

/** The server refused the check because nothing here can run it (no store, or no account). */
function isUnavailableAnswer(status: number): boolean {
  return status === 503 || status === 401 || status === 403;
}

export const RUN_NOW_UNAVAILABLE_MESSAGE =
  'Not checked: background checks are not available in this environment. The counts shown are from before and were not changed.';

/**
 * The Dashboard's Alert Center. Alerts are checked on the server by the
 * scheduled evaluator; this card only reports each alert's latest check —
 * when, how many new hits are waiting, and whether coverage was complete —
 * and offers "Run now", which asks the server to check it immediately. The
 * Dashboard never runs alert searches itself.
 */
export default function AlertCenterCard() {
  const { savedAlerts, removeSavedAlert } = useApp();
  const navigate = useRouter();
  const summary = useAlertHitSummary();
  const userDataStatus = useSyncExternalStore(subscribeUserDataStatus, getUserDataStatus, getUserDataStatus);
  const [serverState, setServerState] = useState<Record<string, CheckState>>({});
  const [running, setRunning] = useState<string[]>([]);
  const [messages, setMessages] = useState<Record<string, { tone: 'info' | 'error'; text: string }>>({});

  const loadServerState = useCallback(async () => {
    if (!isAccountUserDataScope()) return;
    const result = await fetchUserData('alerts');
    if (!result.ok) return;
    const next: Record<string, CheckState> = {};
    for (const item of result.value) next[item.clientKey] = checkStateFromServer(item);
    setServerState(next);
  }, []);

  // Only an account whose store is reachable has server checks to report; a
  // browser-only identity (or a store that already answered "unavailable")
  // would only collect a refusal, so nothing is requested until that changes.
  const canQueryServer = isAccountStorageScope(userDataStatus.scope) && userDataStatus.mode !== 'unavailable';
  useEffect(() => {
    if (!canQueryServer) return;
    void loadServerState();
    void refreshAlertHitSummary();
  }, [canQueryServer, loadServerState]);

  const runNow = async (alert: SavedAlert) => {
    setRunning(prev => [...prev, alert.id]);
    setMessages(prev => {
      const next = { ...prev };
      delete next[alert.id];
      return next;
    });
    // Where nothing can check the alert, say so instead of claiming a check;
    // the alert's prior evidence is left exactly as it was.
    const knownUnavailable = summary.status === 'unavailable' || isAccountStoreUnavailable(getUserDataStatus());
    const result = knownUnavailable ? null : await runAlertNow(alert.id);
    if (!result || (!result.ok && isUnavailableAnswer(result.status))) {
      setMessages(prev => ({ ...prev, [alert.id]: { tone: 'error', text: RUN_NOW_UNAVAILABLE_MESSAGE } }));
    } else if (result.ok) {
      const check = result.value;
      const text = check.outcome === 'checked'
        ? `Checked: ${check.newFilings ?? 0} new filing${check.newFilings === 1 ? '' : 's'}${check.complete ? '' : ' (partial coverage)'}.`
        : check.outcome === 'unevaluable' || check.outcome === 'failed'
          ? `Not checked: ${check.reason || 'the check could not run.'}`
          : 'The check did not finish; it will be retried on the next scheduled pass.';
      setMessages(prev => ({ ...prev, [alert.id]: { tone: check.outcome === 'checked' ? 'info' : 'error', text } }));
      await loadServerState();
    } else {
      setMessages(prev => ({ ...prev, [alert.id]: { tone: 'error', text: result.error } }));
    }
    setRunning(prev => prev.filter(id => id !== alert.id));
  };

  const backgroundUnavailable = summary.status === 'unavailable' || isAccountStoreUnavailable(userDataStatus);

  return (
    <section className="glass-card rss-card">
      <div className="card-header">
        <h3>Alert Center</h3>
        <span className="badge">{backgroundUnavailable ? 'This browser only' : 'Checked on the server'}</span>
      </div>
      {backgroundUnavailable && savedAlerts.length > 0 && (
        <p className="alert-check-local" role="note">
          Background checks are not available in this environment (they need a signed-in account and saved-research storage on
          the deployment). These alerts are kept in this browser and nothing checks them in the background; open one to run its
          search by hand.
        </p>
      )}
      <div className="rss-grid">
        {savedAlerts.length === 0 ? (
          <div className="rss-news-card" style={{ gridColumn: '1 / -1' }}>
            <div className="rss-timestamp">No alerts saved</div>
            <h4 className="rss-headline">Save an alert from the Research Workbench</h4>
            <p className="rss-summary">
              Signed-in alerts are checked on the server — daily or weekly — over filings filed since the last check, and new hits
              appear under the bell in the header with the passage that matched.
            </p>
            <button className="secondary-btn" onClick={() => navigate.push('/search')}>
              <BellRing size={14} /> Open Research
            </button>
          </div>
        ) : (
          savedAlerts.map(alert => {
            const state = serverState[alert.id] ?? checkStateFromLocal(alert);
            const unseen = summary.byAlert[alert.id] ?? 0;
            const isRunning = running.includes(alert.id);
            const message = messages[alert.id];
            // Save-time evidence: the result list the alert was saved from (a
            // search that was never run saves no accessions and shows nothing).
            const savedWith = Array.isArray(alert.lastSeenAccessions) && alert.lastSeenAccessions.length > 0 ? Number(alert.latestResultCount) || 0 : 0;
            const savedOn = alert.createdAt ? alert.createdAt.slice(0, 10) : '';
            return (
              <div key={alert.id} className="rss-news-card">
                <div className="rss-timestamp">
                  {state.lastCheckedAt
                    ? <>Last checked <time dateTime={state.lastCheckedAt} title={new Date(state.lastCheckedAt).toLocaleString()}>{formatRelativeTime(state.lastCheckedAt)}</time></>
                    : 'Not checked yet'}
                  {' · '}{state.cadence === 'weekly' ? 'weekly' : 'daily'}
                </div>
                <h4 className="rss-headline">{alert.name}</h4>
                <div className="alert-check-line">
                  {/* An unread count is only a claim where something checks the alert. */}
                  {!backgroundUnavailable && <span><strong>{unseen.toLocaleString()}</strong> new since you last looked</span>}
                  {state.lastCheckedAt && <span>{state.matched.toLocaleString()} matched in the last check window</span>}
                  {!state.lastCheckedAt && savedWith > 0 && (
                    <span>{savedWith.toLocaleString()} filing{savedWith === 1 ? '' : 's'} in the results when saved{savedOn ? ` (${savedOn})` : ''}</span>
                  )}
                  {state.coverage
                    ? <span>coverage {state.coverage.complete ? 'complete' : 'partial'}</span>
                    : state.lastCheckedAt ? <span>coverage not recorded</span> : null}
                </div>
                {message && (
                  <p className="rss-summary" role={message.tone === 'error' ? 'alert' : 'status'} style={message.tone === 'error' ? { color: 'var(--status-error)' } : undefined}>
                    {message.text}
                  </p>
                )}
                {state.coverage && <AlertCoverageState coverage={state.coverage} />}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <button
                    className="secondary-btn"
                    onClick={() => {
                      const params = buildSavedAlertRouteParams(alert);
                      navigate.push(`/search?${params.toString()}`);
                    }}
                  >
                    <SearchIcon size={14} /> Open
                  </button>
                  <button
                    className="secondary-btn"
                    onClick={() => void runNow(alert)}
                    disabled={isRunning}
                    title={backgroundUnavailable ? 'Background checks are not available in this environment' : 'Check this alert on the server now'}
                  >
                    {isRunning ? <Loader2 size={14} className="spinner" /> : <Play size={14} />} Run now
                  </button>
                  {unseen > 0 && (
                    <Link className="secondary-btn" href="/alerts">View hits</Link>
                  )}
                  <button className="secondary-btn" onClick={() => removeSavedAlert(alert.id)}>
                    <X size={14} /> Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
