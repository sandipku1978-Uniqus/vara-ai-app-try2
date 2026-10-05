'use client';

/**
 * The sections of one project's workspace. Each reads its own kind from the
 * account (GET /api/user/{kind}) when it scrolls into view, keeps the items
 * filed under this project, says where the data comes from and whether it
 * is account-synced, and offers the action that reopens each item where it
 * is worked on.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../context/AppState';
import { describeFilters, buildMemoEvidencePackage, fetchAppVersion } from '../../services/evidencePackage';
import { exportMemoDocx, readSessionDisplayName } from '../../services/memoExport';
import { itemsToDraft } from '../../services/userDataCodecs';
import { loadResearchSessions } from '../../services/researchSessions';
import {
  buildSearchJobHeadline,
  buildSearchJobProgressLine,
  type SearchJobSummary,
} from '../../services/searchJobs';
import type { UserDataStatus, UserProjectItem } from '../../services/userData';
import {
  CART_MEMO_TAG,
  alertSearchHref,
  annotationHref,
  describeFilingKey,
  formatTimestamp,
  jobProjectId,
  loadKind,
  memoItemCitation,
  memoItemTags,
  planCartSave,
  projectCitations,
  projectItems,
  restoreResearchTab,
  researchTabRerunHref,
  saveCartToProject,
  savedSearchHref,
  type Listed,
} from './projectData';
import { EmptyLine, LoadState, Loading, MoveControl, SectionShell, storageLabel } from './ProjectShared';
import { pageReload } from './pageReload';
import { useDocumentCartItems, useKindLoad, useSearchJobsLoad } from './useProjectData';
import styles from './Projects.module.css';

export interface WorkspaceContext {
  project: Listed<'projects'>;
  projectId: string;
  /** Live (unarchived) projects, for the move targets. */
  projects: UserProjectItem[];
  personalId: string | null;
  status: UserDataStatus;
  accountScope: boolean;
}

function unfiledNote(item: { projectId?: string | null }, ctx: WorkspaceContext) {
  return !item.projectId && ctx.projectId === ctx.personalId
    ? <span className={styles.badge} title="Stored before projects, or its project was removed">Unfiled</span>
    : null;
}

function accountStorage(ctx: WorkspaceContext) {
  return storageLabel('account', ctx.status, ctx.accountScope);
}

// ── Saved searches ───────────────────────────────────────────────────────────

function SavedSearchesBody({ ctx }: { ctx: WorkspaceContext }) {
  const { load } = useKindLoad('saved-searches');
  return (
    <LoadState load={load} noun="saved searches">
      {items => {
        const mine = projectItems(items, ctx.projectId, ctx.personalId);
        if (mine.length === 0) return <EmptyLine text="No saved searches are filed under this project." />;
        return (
          <ul className={styles.list}>
            {mine.map(item => {
              const { href, filtersDropped } = savedSearchHref(item);
              const filters = describeFilters(item.filters);
              const label = item.label || item.query || 'Saved search';
              return (
                <li key={item.clientKey} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{label} {unfiledNote(item, ctx)}</span>
                    <span className={styles.rowDetail}>
                      <code>{item.query || '(filters only)'}</code> · {item.mode === 'boolean' ? 'Boolean' : 'Filing Research'}
                      {filters.length > 0 && ` · ${filters.map(filter => `${filter.label}: ${filter.value}`).join('; ')}`}
                    </span>
                    {filtersDropped && <span className={styles.error}>Its stored filters are not in the current filter format; re-running uses the query alone.</span>}
                  </span>
                  <span className={styles.rowActions}>
                    <Link className={styles.link} href={href}>Re-run</Link>
                    <MoveControl kind="saved-searches" item={item} itemLabel={label} currentProjectId={ctx.projectId} projects={ctx.projects} />
                  </span>
                </li>
              );
            })}
          </ul>
        );
      }}
    </LoadState>
  );
}

export function SavedSearchesSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell id="project-saved-searches" title="Saved searches" source="GET /api/user/saved-searches" storage={accountStorage(ctx)}>
      {() => <SavedSearchesBody ctx={ctx} />}
    </SectionShell>
  );
}

// ── Alerts ───────────────────────────────────────────────────────────────────

function alertStatusLine(alert: Listed<'alerts'>): string {
  const parts = [alert.enabled ? `Enabled · ${alert.cadence}` : 'Paused'];
  if (!alert.lastCheckedAt) {
    parts.push('not checked yet');
  } else {
    parts.push(`last checked ${formatTimestamp(alert.lastCheckedAt)}`);
    parts.push(`${alert.lastHitCount.toLocaleString()} result${alert.lastHitCount === 1 ? '' : 's'}`);
    parts.push(`${alert.latestNewAccessions.length.toLocaleString()} new since the check before`);
    const coverage = alert.lastCheckCoverage as { complete?: unknown } | null;
    if (coverage && typeof coverage.complete === 'boolean') {
      parts.push(coverage.complete ? 'complete candidate coverage' : 'partial candidate coverage');
    } else {
      parts.push('coverage not recorded');
    }
  }
  return parts.join(' · ');
}

function AlertsBody({ ctx }: { ctx: WorkspaceContext }) {
  const { load } = useKindLoad('alerts');
  return (
    <LoadState load={load} noun="alerts">
      {items => {
        const mine = projectItems(items, ctx.projectId, ctx.personalId);
        if (mine.length === 0) return <EmptyLine text="No alerts are filed under this project." />;
        return (
          <ul className={styles.list}>
            {mine.map(alert => {
              const { href, filtersDropped } = alertSearchHref(alert);
              const label = alert.name || alert.query || 'Alert';
              return (
                <li key={alert.clientKey} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{label} {unfiledNote(alert, ctx)}</span>
                    <span className={styles.rowDetail}><code>{alert.query || '(filters only)'}</code></span>
                    <span className={styles.rowDetail}>{alertStatusLine(alert)}</span>
                    {filtersDropped && <span className={styles.error}>Its stored filters are not in the current filter format; the search link uses the query alone.</span>}
                  </span>
                  <span className={styles.rowActions}>
                    <Link className={styles.link} href={href}>Run search</Link>
                    <MoveControl kind="alerts" item={alert} itemLabel={label} currentProjectId={ctx.projectId} projects={ctx.projects} />
                  </span>
                </li>
              );
            })}
          </ul>
        );
      }}
    </LoadState>
  );
}

export function AlertsSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell
      id="project-alerts"
      title="Alerts"
      source="GET /api/user/alerts — status is what the alert's last check recorded"
      storage={accountStorage(ctx)}
      actions={<p className={styles.muted}>Alerts are checked and edited in the <Link className={styles.link} href="/dashboard">Alert Center on the Dashboard</Link>.</p>}
    >
      {() => <AlertsBody ctx={ctx} />}
    </SectionShell>
  );
}

// ── Peer sets ────────────────────────────────────────────────────────────────

function PeerSetsBody({ ctx }: { ctx: WorkspaceContext }) {
  const { load } = useKindLoad('peer-sets');
  const { setPendingCompareIntent } = useApp();
  const router = useRouter();
  return (
    <LoadState load={load} noun="peer sets">
      {items => {
        const mine = projectItems(items, ctx.projectId, ctx.personalId);
        if (mine.length === 0) return <EmptyLine text="No peer sets are filed under this project." />;
        return (
          <ul className={styles.list}>
            {mine.map(set => (
              <li key={set.clientKey} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{set.name} {unfiledNote(set, ctx)}</span>
                  <span className={styles.rowDetail}>{set.tickers.join(', ') || 'No tickers'} · saved {formatTimestamp(set.asOf || set.createdAt)}</span>
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    disabled={set.tickers.length === 0}
                    onClick={() => {
                      setPendingCompareIntent({
                        id: `project-peer-set-${set.clientKey}-${Date.now()}`,
                        tickers: [...set.tickers],
                        message: `Loaded the peer set “${set.name}” from the project “${ctx.project.name}”.`,
                      });
                      router.push('/compare');
                    }}
                  >
                    Open in Benchmarking
                  </button>
                  <MoveControl kind="peer-sets" item={set} itemLabel={set.name} currentProjectId={ctx.projectId} projects={ctx.projects} />
                </span>
              </li>
            ))}
          </ul>
        );
      }}
    </LoadState>
  );
}

export function PeerSetsSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell id="project-peer-sets" title="Peer sets" source="GET /api/user/peer-sets" storage={accountStorage(ctx)}>
      {() => <PeerSetsBody ctx={ctx} />}
    </SectionShell>
  );
}

// ── Memo ─────────────────────────────────────────────────────────────────────

function MemoBody({ ctx }: { ctx: WorkspaceContext }) {
  const { load } = useKindLoad('memo');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  return (
    <LoadState load={load} noun="memo items">
      {items => {
        const mine = projectItems(items, ctx.projectId, ctx.personalId);
        const citations = projectCitations(mine);
        const draft = itemsToDraft(mine);
        const draftIsStale = Boolean(draft && draft.citationIds.join('|') !== citations.map(citation => citation.id).join('|'));
        const exportWord = async () => {
          setExporting(true);
          setExportError('');
          try {
            const generatedAt = new Date();
            const evidencePackage = buildMemoEvidencePackage({
              title: ctx.project.name,
              question: ctx.project.question,
              citations,
              draft,
              generatedAt,
              appVersion: await fetchAppVersion(),
            });
            await exportMemoDocx({
              title: ctx.project.name,
              question: ctx.project.question,
              author: readSessionDisplayName(),
              generatedAt,
              citations,
              draft,
              draftIsStale,
              evidencePackage,
            });
          } catch (error) {
            console.error('Project memo export failed:', error);
            setExportError('The Word export could not be built. Nothing was changed; retry when ready.');
          } finally {
            setExporting(false);
          }
        };
        if (mine.length === 0) return <EmptyLine text="No memo items are filed under this project." />;
        return (
          <>
            <div className={styles.toolbar}>
              <button type="button" className="secondary-btn" onClick={() => void exportWord()} disabled={exporting || citations.length === 0}>
                {exporting ? 'Building Word file…' : 'Export Word'}
              </button>
              <span className={styles.muted}>
                {citations.length} citation{citations.length === 1 ? '' : 's'}{draft ? ' and the AI draft' : ''}; the document carries its own evidence-package appendix.
              </span>
              {exportError && <span className={styles.error} role="alert">{exportError}</span>}
            </div>
            <ul className={styles.list}>
              {mine.filter(item => item.itemKind === 'citation').map(item => {
                const citation = memoItemCitation(item);
                const label = citation ? `${citation.company || 'Filing'} ${citation.form} ${citation.fileDate}`.trim() : item.clientKey;
                return (
                  <li key={item.clientKey} className={styles.row}>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {label} {memoItemTags(item).includes(CART_MEMO_TAG) && <span className={styles.badge}>From cart</span>} {unfiledNote(item, ctx)}
                      </span>
                      {citation ? (
                        <>
                          <span className={styles.rowDetail}>
                            Accession {citation.accessionNumber}{citation.section ? ` · ${citation.section}` : ''} · <a className={styles.link} href={citation.sourceUrl} target="_blank" rel="noreferrer">SEC.gov</a>
                          </span>
                          {citation.excerpt.trim() && <blockquote className={styles.excerpt}>{citation.excerpt.slice(0, 400)}{citation.excerpt.length > 400 ? '…' : ''}</blockquote>}
                          {citation.note.trim() && <span className={styles.rowDetail}>Your note: {citation.note}</span>}
                        </>
                      ) : (
                        <span className={styles.error}>This memo item has no filing identity and is left out of exports.</span>
                      )}
                    </span>
                    <MoveControl kind="memo" item={item} itemLabel={label} currentProjectId={ctx.projectId} projects={ctx.projects} />
                  </li>
                );
              })}
            </ul>
            {draft && (
              <details>
                <summary className={styles.rowTitle}>
                  AI draft — generated {formatTimestamp(draft.generatedAt)} from {draft.citationIds.length} citation{draft.citationIds.length === 1 ? '' : 's'}
                  {draftIsStale ? ' (citations changed since)' : ''}
                </summary>
                <pre className={styles.draft}>{draft.text}</pre>
              </details>
            )}
          </>
        );
      }}
    </LoadState>
  );
}

export function MemoSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell
      id="project-memo"
      title="Memo"
      source="GET /api/user/memo — citations and the AI draft filed under this project"
      storage={accountStorage(ctx)}
    >
      {() => <MemoBody ctx={ctx} />}
    </SectionShell>
  );
}

// ── Annotations ──────────────────────────────────────────────────────────────

function AnnotationsBody({ ctx }: { ctx: WorkspaceContext }) {
  const { load } = useKindLoad('annotations');
  return (
    <LoadState load={load} noun="annotations">
      {items => {
        const mine = projectItems(items, ctx.projectId, ctx.personalId);
        if (mine.length === 0) return <EmptyLine text="No annotations are filed under this project." />;
        const byFiling = new Map<string, typeof mine>();
        for (const note of mine) byFiling.set(note.filingKey, [...(byFiling.get(note.filingKey) || []), note]);
        return (
          <ul className={styles.list}>
            {[...byFiling.entries()].map(([filingKey, notes]) => {
              const filing = describeFilingKey(filingKey);
              return (
                <li key={filingKey} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      CIK {filing.cik || '—'} · accession {filing.accession || '—'}{filing.document ? ` · ${filing.document}` : ''}
                    </span>
                    {notes.map(note => (
                      <span key={note.clientKey} className={styles.rowMain}>
                        {note.anchor?.quote && <blockquote className={styles.excerpt}>{String(note.anchor.quote).slice(0, 300)}</blockquote>}
                        <span className={styles.rowDetail}>
                          {note.anchor?.section ? `${note.anchor.section} · ` : ''}{note.note} {unfiledNote(note, ctx)}
                        </span>
                        <MoveControl kind="annotations" item={note} itemLabel={`note on ${filing.accession || filingKey}`} currentProjectId={ctx.projectId} projects={ctx.projects} />
                      </span>
                    ))}
                  </span>
                  <span className={styles.rowActions}>
                    <Link className={styles.link} href={annotationHref(filingKey)}>Open in viewer</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        );
      }}
    </LoadState>
  );
}

export function AnnotationsSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell id="project-annotations" title="Annotations" source="GET /api/user/annotations — grouped by filing" storage={accountStorage(ctx)}>
      {() => <AnnotationsBody ctx={ctx} />}
    </SectionShell>
  );
}

// ── Research tabs ────────────────────────────────────────────────────────────

function ResearchTabRow({ item, ctx }: { item: Listed<'research-tabs'>; ctx: WorkspaceContext }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const payload = item.payload as Record<string, unknown>;
  const results = Array.isArray(payload.results) ? payload.results.length : 0;
  const query = typeof payload.query === 'string' ? payload.query : '';
  const openHere = loadResearchSessions().some(session => session.id === item.clientKey);
  const rerun = researchTabRerunHref(item);
  const label = item.title || query || 'Research tab';
  return (
    <li className={styles.row}>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{label} {unfiledNote(item, ctx)} {openHere && <span className={styles.badge}>Open in this browser</span>}</span>
        <span className={styles.rowDetail}>
          <code>{query || '(filters only)'}</code> · {results.toLocaleString()} result row{results === 1 ? '' : 's'} saved · updated {formatTimestamp(typeof payload.updatedAt === 'string' ? payload.updatedAt : item.updatedAt)}
        </span>
        {message && <span className={styles.error} role="alert">{message}</span>}
      </span>
      <span className={styles.rowActions}>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={() => {
            const outcome = restoreResearchTab(item);
            if (outcome.ok) router.push(outcome.href);
            else setMessage(outcome.reason);
          }}
        >
          Restore into search
        </button>
        {message && rerun && <Link className={styles.link} href={rerun}>Re-run its query</Link>}
        <MoveControl kind="research-tabs" item={item} itemLabel={label} currentProjectId={ctx.projectId} projects={ctx.projects} />
      </span>
    </li>
  );
}

function ResearchTabsBody({ ctx }: { ctx: WorkspaceContext }) {
  const { load } = useKindLoad('research-tabs');
  return (
    <LoadState load={load} noun="research tabs">
      {items => {
        const mine = projectItems(items, ctx.projectId, ctx.personalId);
        if (mine.length === 0) return <EmptyLine text="No research tabs are filed under this project." />;
        return <ul className={styles.list}>{mine.map(item => <ResearchTabRow key={item.clientKey} item={item} ctx={ctx} />)}</ul>;
      }}
    </LoadState>
  );
}

export function ResearchTabsSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell
      id="project-research-tabs"
      title="Research tabs"
      source="GET /api/user/research-tabs — restored into this browser's search tabs"
      storage={accountStorage(ctx)}
    >
      {() => <ResearchTabsBody ctx={ctx} />}
    </SectionShell>
  );
}

// ── Continuation jobs ────────────────────────────────────────────────────────

const JOB_STATUS: Record<SearchJobSummary['status'], string> = {
  running: 'Running',
  finished: 'Finished',
  capped: 'Stopped at a limit',
  expired: 'Expired',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function JobsBody({ ctx }: { ctx: WorkspaceContext }) {
  const load = useSearchJobsLoad();
  if (load.status === 'loading') return <Loading label="Loading continuation jobs…" />;
  if (load.status === 'unavailable') {
    return <EmptyLine text={`Continuation jobs are not available on this deployment (HTTP ${load.httpStatus}).`} />;
  }
  if (load.status === 'failed') return <p className={styles.error} role="alert">Continuation jobs could not be loaded: {load.error}</p>;
  const scoped = load.jobs.some(job => jobProjectId(job) !== null);
  const jobs = scoped ? load.jobs.filter(job => jobProjectId(job) === ctx.projectId) : load.jobs;
  return (
    <>
      {!scoped && (
        <p className={styles.muted}>
          Job records do not name a project, so this lists all of your recent continuation jobs, not only this project’s.
        </p>
      )}
      {jobs.length === 0 ? (
        <EmptyLine text="No continuation jobs yet. When a search reads only part of its candidates, choose Keep validating in the results pane." />
      ) : (
        <ul className={styles.list}>
          {jobs.map(job => (
            <li key={job.id} className={styles.row}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{JOB_STATUS[job.status]} — {buildSearchJobHeadline(job)}</span>
                <span className={styles.rowDetail}><code>{job.plan.input.query || '(filters only)'}</code> · {buildSearchJobProgressLine(job)} · started {formatTimestamp(job.createdAt)}</span>
              </span>
              <Link className={styles.link} href={`/search?searchJob=${encodeURIComponent(job.id)}`}>Open results</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function JobsSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell
      id="project-jobs"
      title="Continuation jobs"
      source="GET /api/search-jobs — the jobs recorded for your account"
      storage={storageLabel('server-jobs', ctx.status, ctx.accountScope)}
    >
      {() => <JobsBody ctx={ctx} />}
    </SectionShell>
  );
}

// ── Document cart ────────────────────────────────────────────────────────────

function CartBody({ ctx }: { ctx: WorkspaceContext }) {
  const cart = useDocumentCartItems();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    const memo = await loadKind('memo');
    if (memo.status !== 'ready') {
      setSaving(false);
      setError('Your memo could not be read, so nothing was saved (a filing already in it would be overwritten otherwise).');
      return;
    }
    const plan = planCartSave(cart, ctx.projectId, new Set(memo.items.map(item => item.clientKey)));
    if (plan.items.length === 0) {
      setSaving(false);
      setMessage(`All ${cart.length} filing${cart.length === 1 ? ' is' : 's are'} already in your memo; nothing was added.`);
      return;
    }
    const outcome = await saveCartToProject(plan.items);
    if (!outcome.ok) {
      setSaving(false);
      setError(outcome.error);
      return;
    }
    setMessage(`Saved ${plan.items.length} filing${plan.items.length === 1 ? '' : 's'} to this project’s memo${plan.alreadySaved.length > 0 ? ` (${plan.alreadySaved.length} already in your memo were left as they were)` : ''}. Reloading…`);
    pageReload.reload();
  };

  if (cart.length === 0) {
    return <EmptyLine text="The document cart is empty. Select filings from search results, the Section Matrix or exhibits to collect them here." />;
  }
  return (
    <>
      <div className={styles.toolbar}>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void save()}
          disabled={saving || !ctx.accountScope || ctx.status.mode !== 'server'}
        >
          {saving ? 'Saving…' : 'Save cart to project'}
        </button>
        <span className={styles.muted}>Stores each selected filing as a memo citation tagged “cart”, filed under this project.</span>
      </div>
      {(!ctx.accountScope || ctx.status.mode !== 'server') && (
        <p className={styles.muted}>Saving the cart needs account storage, which is not connected right now.</p>
      )}
      {message && <p className={styles.muted} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <ul className={styles.list}>
        {cart.map(filing => (
          <li key={filing.id} className={styles.row}>
            <span className={styles.rowMain}>
              <span className={styles.rowTitle}>{filing.company} {filing.form} {filing.fileDate}</span>
              <span className={styles.rowDetail}>Accession {filing.accessionNumber}{filing.ticker ? ` · ${filing.ticker}` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CartSection({ ctx }: { ctx: WorkspaceContext }) {
  return (
    <SectionShell
      id="project-cart"
      title="Document cart"
      source="the document cart in this browser session (not part of the project until saved)"
      storage={storageLabel('session', ctx.status, ctx.accountScope)}
    >
      {() => <CartBody ctx={ctx} />}
    </SectionShell>
  );
}
