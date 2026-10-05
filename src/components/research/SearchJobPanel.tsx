'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import type { FilingResearchResult } from '../../services/filingResearch';
import {
  buildSearchJobHeadline,
  buildSearchJobProgressLine,
  isSearchJobActive,
  parseSearchJobSummary,
  SEARCH_JOB_LIMITS,
  type SearchJobHit,
  type SearchJobPlanInput,
  type SearchJobSummary,
} from '../../services/searchJobs';
import './SearchJobPanel.css';

const POLL_INTERVAL_MS = 5_000;
/** Pause before nudging again when another worker (cron, another tab) holds
 *  the job's lease. */
const BUSY_BACKOFF_MS = 10_000;

interface HitsPage {
  total: number;
  offset: number;
  limit: number;
  items: SearchJobHit[];
}

interface JobState {
  job: SearchJobSummary | null;
  hits: HitsPage | null;
  error: string;
  /** The deployment has no job store: stop polling, say so once. */
  unavailable: boolean;
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Poll one job and, while the pane is open and visible, drive it: post one
 * wave at a time to the worker so the answer grows without waiting for the
 * minute cron. Leaving the page stops only the driving — the job itself
 * keeps running server-side.
 */
export function useSearchJob(jobId: string | null, offset: number, limit: number) {
  const [state, setState] = useState<JobState>({ job: null, hits: null, error: '', unavailable: false });
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!jobId) return;
    try {
      const response = await fetch(`/api/search-jobs/${jobId}?offset=${offset}&limit=${limit}`, { signal, cache: 'no-store' });
      if (response.status === 503) {
        setState(current => ({ ...current, unavailable: true, error: 'Search continuation is not available on this deployment.' }));
        return;
      }
      if (!response.ok) {
        const error = await readError(response, 'The search job could not be loaded.');
        setState(current => ({ ...current, error }));
        return;
      }
      const payload = await response.json() as { job?: unknown; hits?: HitsPage };
      const job = parseSearchJobSummary(payload.job);
      if (!job) {
        setState(current => ({ ...current, error: 'The search job returned an unreadable status.' }));
        return;
      }
      setState({ job, hits: payload.hits ?? null, error: '', unavailable: false });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setState(current => ({ ...current, error: 'The search job could not be reached. Retrying.' }));
    }
  }, [jobId, offset, limit]);

  // Poll while the job runs.
  useEffect(() => {
    if (!jobId) {
      setState({ job: null, hits: null, error: '', unavailable: false });
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      if (isVisible()) await refresh(controller.signal);
      const current = stateRef.current;
      if (stopped || current.unavailable) return;
      if (current.job && !isSearchJobActive(current.job)) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, refresh]);

  // Drive one wave at a time while the job runs and the pane is visible.
  const jobStatus = state.job?.status;
  useEffect(() => {
    if (!jobId || jobStatus !== 'running') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const drive = async () => {
      if (stopped) return;
      if (!isVisible()) {
        timer = setTimeout(drive, POLL_INTERVAL_MS);
        return;
      }
      let advanced = false;
      try {
        const response = await fetch('/api/search-jobs/continue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
          signal: controller.signal,
        });
        if (response.ok) {
          const payload = await response.json() as { advanced?: boolean };
          advanced = payload.advanced === true;
        } else if (response.status === 503 || response.status === 404) {
          return;
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
      }
      if (stopped) return;
      await refresh(controller.signal);
      if (stopped || stateRef.current.job?.status !== 'running') return;
      timer = setTimeout(drive, advanced ? 250 : BUSY_BACKOFF_MS);
    };
    void drive();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, jobStatus, refresh]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    const response = await fetch(`/api/search-jobs/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    if (!response.ok) {
      const error = await readError(response, 'The search job could not be cancelled.');
      setState(current => ({ ...current, error }));
      return;
    }
    await refresh();
  }, [jobId, refresh]);

  return { ...state, refresh, cancel };
}

interface Scope {
  total: number;
  byYear: Array<{ year: number; filings: number }>;
  coverageStart: string;
}

function scopeForms(input: SearchJobPlanInput): string[] {
  const forms = input.filters.formTypes.length > 0 ? input.filters.formTypes : input.defaultForms.split(',');
  return forms.map(form => form.trim().toUpperCase()).filter(Boolean);
}

/**
 * "What was searched": the population this question was asked of — forms,
 * years, issuer, and how many filings that scope holds in the metadata
 * corpus. It is a population count, never a match count, and it says which
 * filters it does NOT reflect (text-checked ones), so the reader can tell
 * the denominator from the answer.
 */
export function SearchUniverseStatement({ input, pinnedDateTo }: { input: SearchJobPlanInput; pinnedDateTo: string }) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [failed, setFailed] = useState(false);
  const forms = scopeForms(input);
  const formsKey = forms.join(',');
  const dateFrom = input.filters.dateFrom;
  const cik = (input.filters.entityCik || '').trim();

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (formsKey) params.set('forms', formsKey);
    if (dateFrom) params.set('start', dateFrom);
    params.set('end', pinnedDateTo);
    if (cik) params.set('cik', cik);
    fetch(`/api/filing-scope?${params.toString()}`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(payload => {
        setScope(payload?.ok ? payload.scope as Scope : null);
        setFailed(!payload?.ok);
      })
      .catch(error => {
        if ((error as Error)?.name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, [formsKey, dateFrom, pinnedDateTo, cik]);

  const first = scope?.byYear[0]?.year;
  const last = scope?.byYear[scope.byYear.length - 1]?.year;
  const textFilters = [
    input.mode === 'boolean' && input.query.trim() ? 'the Boolean expression' : '',
    input.filters.sectionScope ? `Item ${input.filters.sectionScope} scope` : '',
    input.filters.ascReference ? `citations of ${input.filters.ascReference}` : '',
    input.filters.acceleratedStatus.length > 0 ? 'filer status' : '',
    input.filters.sectionKeywords ? 'section keywords' : '',
    input.filters.accountingFramework ? 'accounting framework' : '',
    input.filters.accountant ? `auditor ${input.filters.accountant}` : '',
  ].filter(Boolean);

  return (
    <details className="search-job-universe">
      <summary>What was searched</summary>
      <dl>
        <div>
          <dt>Forms</dt>
          <dd>{forms.length > 0 ? forms.join(', ') : 'All forms'}</dd>
        </div>
        <div>
          <dt>Filing dates</dt>
          <dd>{dateFrom || 'Earliest available'} to {pinnedDateTo} <span className="search-job-muted">(fixed when the job started)</span></dd>
        </div>
        {(input.filters.entityName || cik) && (
          <div>
            <dt>Issuer</dt>
            <dd>{input.filters.entityName || `CIK ${cik}`}</dd>
          </div>
        )}
        <div>
          <dt>Filings in scope</dt>
          <dd>
            {scope && scope.total > 0
              ? <>
                  <strong>{scope.total.toLocaleString()}</strong> filings
                  {first && last ? <> ({first === last ? first : `${first}–${last}`})</> : null}
                  {' '}in the metadata corpus, which starts {scope.coverageStart}.
                </>
              : failed
                ? 'The population count is unavailable right now.'
                : scope
                  ? 'No filings in the metadata corpus match this form and date scope.'
                  : 'Counting…'}
          </dd>
        </div>
      </dl>
      <p className="search-job-muted">
        This counts filings by form, date and issuer only — a population, not matches.
        {textFilters.length > 0 ? ` Each candidate is then read to check ${textFilters.join(', ')}.` : ''}
        {' '}Candidates come from SEC EDGAR full-text search, which covers filings from 2001.
      </p>
    </details>
  );
}

interface SearchJobPanelProps {
  jobId: string | null;
  /** The visible run's resolved search, when it ended with partial coverage
   *  that only a continuation job can complete. */
  offerSearch: SearchJobPlanInput | null;
  onAttach: (jobId: string) => void;
  onDetach: () => void;
  onOpenFiling: (result: FilingResearchResult) => void;
  onJobChange?: (job: SearchJobSummary | null) => void;
}

/**
 * The results pane's continuation status region: offers "Keep validating",
 * then shows the job's growing headline, its progress and stop reason, the
 * universe statement, and its verified filings one server page at a time.
 */
export default function SearchJobPanel({ jobId, offerSearch, onAttach, onDetach, onOpenFiling, onJobChange }: SearchJobPanelProps) {
  const [offset, setOffset] = useState(0);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const limit = SEARCH_JOB_LIMITS.hitsPageSize;
  const { job, hits, error, cancel } = useSearchJob(jobId, offset, limit);

  useEffect(() => { setOffset(0); }, [jobId]);
  useEffect(() => { onJobChange?.(job); }, [job, onJobChange]);

  const start = useCallback(async () => {
    if (!offerSearch) return;
    setStarting(true);
    setNotice('');
    try {
      const response = await fetch('/api/search-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: offerSearch }),
      });
      const payload = await response.json().catch(() => ({})) as { job?: { id?: unknown }; error?: unknown };
      const createdId = typeof payload.job?.id === 'string' ? payload.job.id : '';
      if ((response.status === 201 || response.status === 409) && createdId) {
        if (response.status === 409) {
          setNotice('You already have a search being validated, shown below. Cancel it to start this one.');
        }
        onAttach(createdId);
        return;
      }
      setNotice(typeof payload.error === 'string' ? payload.error : 'The search could not be continued.');
    } catch {
      setNotice('The search could not be continued. Check your connection and retry.');
    } finally {
      setStarting(false);
    }
  }, [offerSearch, onAttach]);

  if (!jobId) {
    if (!offerSearch) return null;
    return (
      <section className="search-job-panel" aria-label="Continue validating this search">
        <p className="search-job-offer">
          This run read a bounded window of candidates. To learn how many filings actually match,
          keep validating on the server — it continues if you leave this page.
        </p>
        <button type="button" className="secondary-btn" onClick={() => void start()} disabled={starting}>
          {starting ? <Loader2 size={14} className="spinner" aria-hidden="true" /> : null}
          Keep validating
        </button>
        {notice && <p role="status" className="search-job-notice">{notice}</p>}
      </section>
    );
  }

  const running = job ? isSearchJobActive(job) : true;
  const pageCount = hits ? Math.max(1, Math.ceil(hits.total / limit)) : 1;
  const page = Math.floor(offset / limit) + 1;

  return (
    <section className="search-job-panel" aria-label="Search continuation" aria-busy={running}>
      <div className="search-job-header">
        <div>
          <div className="eyebrow">{running ? 'Validating on the server' : 'Continued search'}</div>
          <h3 aria-live="polite">{job ? buildSearchJobHeadline(job) : 'Loading the search job…'}</h3>
          {job && (
            <p className="search-job-muted">
              {buildSearchJobProgressLine(job)}
              {job.statusReason ? ` ${job.statusReason}` : ''}
            </p>
          )}
          {job && (
            <p className="search-job-muted">
              Query: <code>{job.plan.input.query || '(filters only)'}</code>
            </p>
          )}
        </div>
        <div className="search-job-actions">
          {running && job && (
            <button type="button" className="secondary-btn" onClick={() => void cancel()}>Cancel</button>
          )}
          <button type="button" className="secondary-btn" onClick={onDetach} aria-label="Hide the search job panel">
            Hide
          </button>
        </div>
      </div>

      {running && (
        <div className="research-refining-banner" role="status">
          <Loader2 size={14} className="spinner" aria-hidden="true" />
          <span>
            Each wave reads up to 120 more filings. Verified filings appear below as they are found; the job keeps
            running if you leave this page and is listed on your Dashboard.
          </span>
        </div>
      )}
      {(notice || error) && <p role="status" className="search-job-notice">{notice || error}</p>}

      {job && <SearchUniverseStatement input={job.plan.input} pinnedDateTo={job.plan.pinnedDateTo} />}

      {hits && hits.items.length > 0 && (
        <>
          <ol className="search-job-hits" start={offset + 1} aria-label="Verified filings from the continued search">
            {hits.items.map(hit => (
              <li key={hit.accessionNumber} className="search-job-hit">
                <button type="button" className="research-hit-card" onClick={() => onOpenFiling(hit)}>
                  <div className="topline">
                    <span className="date">{hit.fileDate}</span>
                    <span className="el-badge el-badge-verified">Text validated</span>
                    <span className="form">{hit.formType}{hit.matchedDocumentType ? ` · ${hit.matchedDocumentType}` : ''}</span>
                  </div>
                  <div className="company">{hit.entityName}</div>
                  <div className="match-reason">{hit.matchReason}</div>
                  {hit.matchSectionPath && <div className="match-provenance">{hit.matchSectionPath}</div>}
                  {hit.matchSnippet && <div className="snippet">{hit.matchSnippet}</div>}
                </button>
                {hit.filingUrl && (
                  <a className="search-job-source" href={hit.matchedDocumentUrl || hit.filingUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} aria-hidden="true" /> SEC.gov
                  </a>
                )}
              </li>
            ))}
          </ol>
          {pageCount > 1 && (
            <nav aria-label="Continued search result pages" className="search-job-pages">
              <button type="button" className="secondary-btn" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={page === 1}>
                <ChevronLeft size={14} aria-hidden="true" /> Previous
              </button>
              <span aria-live="polite">
                {`${offset + 1}–${Math.min(offset + limit, hits.total)} of ${hits.total.toLocaleString()}`}
              </span>
              <button type="button" className="secondary-btn" onClick={() => setOffset(offset + limit)} disabled={page >= pageCount}>
                Next <ChevronRight size={14} aria-hidden="true" />
              </button>
            </nav>
          )}
        </>
      )}
      {hits && hits.items.length === 0 && job && !running && (
        <p className="search-job-muted">
          {job.coverage?.complete
            ? 'No filing in the candidate set satisfied the search. This is a verified zero.'
            : 'No verified filings were found before the job stopped. This is not an authoritative zero.'}
        </p>
      )}
    </section>
  );
}
