'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search as SearchIcon } from 'lucide-react';
import {
  buildSearchJobHeadline,
  buildSearchJobProgressLine,
  parseSearchJobSummary,
  type SearchJobSummary,
} from '../../services/searchJobs';
import './SearchJobPanel.css';

const STATUS_LABELS: Record<SearchJobSummary['status'], string> = {
  running: 'Running',
  finished: 'Finished',
  capped: 'Stopped at a limit',
  expired: 'Expired',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * Dashboard card: the user's continued searches, running and finished, each
 * linking back to its results. Jobs keep running server-side, so this is
 * where a user who navigated away finds the answer.
 */
export default function SearchJobsCard() {
  const [jobs, setJobs] = useState<SearchJobSummary[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/search-jobs?limit=6', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        // A deployment without the job store has no continued searches to
        // list; that is not an error worth a card.
        if (response.status === 503 || response.status === 401 || response.status === 403) {
          setState('unavailable');
          return;
        }
        if (!response.ok) {
          setState('error');
          return;
        }
        const payload = await response.json() as { jobs?: unknown[] };
        setJobs((payload.jobs ?? []).map(parseSearchJobSummary).filter((job): job is SearchJobSummary => job !== null));
        setState('ready');
      })
      .catch(error => {
        if ((error as Error)?.name !== 'AbortError') setState('error');
      });
    return () => controller.abort();
  }, []);

  if (state === 'unavailable') return null;

  return (
    <section className="glass-card search-jobs-card" aria-labelledby="search-jobs-card-title">
      <div className="card-header">
        <h3 id="search-jobs-card-title">Continued Searches</h3>
        <SearchIcon size={18} aria-hidden="true" />
      </div>
      {state === 'loading' && <div className="text-muted"><Loader2 size={16} className="spinner" aria-hidden="true" /> Loading…</div>}
      {state === 'error' && <div role="status" className="text-muted">Continued searches could not be loaded.</div>}
      {state === 'ready' && jobs && jobs.length === 0 && (
        <div className="empty-state">
          No continued searches yet. When a filtered search reads only part of its candidates, choose
          Keep validating in the results pane to finish it here.
        </div>
      )}
      {state === 'ready' && jobs && jobs.length > 0 && (
        <ul className="search-job-cards">
          {jobs.map(job => (
            <li key={job.id}>
              <a className="search-job-card" href={`/search?searchJob=${encodeURIComponent(job.id)}`}>
                <span className={`el-badge ${job.status === 'finished' && job.coverage?.complete ? 'el-badge-verified' : 'el-badge-neutral'}`}>
                  {STATUS_LABELS[job.status]}
                </span>
                <strong>{buildSearchJobHeadline(job)}</strong>
                <span className="search-job-muted">
                  <code>{job.plan.input.query || '(filters only)'}</code> · {buildSearchJobProgressLine(job)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
