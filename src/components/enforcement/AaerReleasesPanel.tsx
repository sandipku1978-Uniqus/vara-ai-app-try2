'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import DataTable, { type ColumnDef } from '../tables/DataTable';
import ResultsToolbar from '../tables/ResultsToolbar';
import CiteButton from '../memo/CiteButton';
import type { AaerRelease } from '../../services/aaer';
import {
  AAER_ROUTE_LIMIT,
  aaerCoverageLine,
  aaerQueryString,
  relatedActionsText,
  type AaerQuery,
  type AaerResponse,
} from './aaerFormat';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: AaerResponse };

const EMPTY_QUERY: AaerQuery = { q: '', fromYear: '', toYear: '' };
const FALLBACK_OLDEST_YEAR = 1960;

const inputStyle: React.CSSProperties = {
  background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '4px',
  color: 'var(--text-primary)', fontSize: '0.82rem', padding: '5px 8px',
};
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.74rem', color: 'var(--text-secondary)' };

/**
 * Accounting and Auditing Enforcement Releases from GET /api/aaer. The route
 * filters the full crawled index server-side and returns at most 500 rows, so
 * the year range and text filter are sent to it rather than applied locally.
 */
export default function AaerReleasesPanel() {
  const [draft, setDraft] = useState<AaerQuery>(EMPTY_QUERY);
  const [query, setQuery] = useState<AaerQuery>(EMPTY_QUERY);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(`/api/aaer?${aaerQueryString(query)}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json().catch(() => null) as (AaerResponse & { error?: string }) | null;
        if (!response.ok || !payload || !Array.isArray(payload.releases) || !payload.coverage) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        setState({ status: 'ready', response: payload });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: `The SEC AAER index could not be read${error instanceof Error && error.message ? ` (${error.message})` : ''}.`,
        });
      });
    return () => controller.abort();
  }, [query, reloadKey]);

  const response = state.status === 'ready' ? state.response : null;
  const oldestYear = Number(response?.coverage.oldestDate?.slice(0, 4)) || FALLBACK_OLDEST_YEAR;
  const newestYear = Math.max(new Date().getFullYear(), Number(response?.coverage.newestDate?.slice(0, 4)) || 0);
  const years = useMemo(() => {
    const list: string[] = [];
    for (let year = newestYear; year >= oldestYear; year -= 1) list.push(String(year));
    return list;
  }, [newestYear, oldestYear]);
  const rangeInvalid = Boolean(draft.fromYear && draft.toYear && draft.fromYear > draft.toYear);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (rangeInvalid) return;
    setQuery({ ...draft, q: draft.q.trim() });
  };
  const clear = () => {
    setDraft(EMPTY_QUERY);
    setQuery(EMPTY_QUERY);
  };

  const columns: ColumnDef<AaerRelease>[] = [
    {
      key: 'releaseNo', header: 'Release no.', sortable: true, render: row => (
        <span>
          {row.releaseNo}
          {row.otherReleaseNumbers.length > 0 && (
            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>also {row.otherReleaseNumbers.join(', ')}</span>
          )}
        </span>
      ),
    },
    { key: 'date', header: 'Date', sortable: true },
    { key: 'respondents', header: 'Respondents', render: row => row.respondents.join('; ') },
    {
      key: 'title', header: 'Title', sortable: true, render: row => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${row.title} (${row.releaseNo}) on SEC.gov`}
          style={{ color: 'var(--accent-primary)' }}
        >
          {row.title} <ExternalLink size={12} aria-hidden="true" style={{ verticalAlign: 'middle' }} />
        </a>
      ),
    },
    {
      key: 'relatedActions', header: 'Related actions', render: row => row.relatedActions.length === 0
        ? <span style={{ color: 'var(--text-muted)' }}>none listed</span>
        : (
          <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {row.relatedActions.map(action => (
              <a key={`${action.url}|${action.label}`} href={action.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>
                {action.label}
              </a>
            ))}
          </span>
        ),
    },
    {
      key: 'url', header: 'Memo', render: row => (
        <CiteButton
          compact
          citation={{
            // A release is not an EDGAR filing: the memo tray cites it by
            // release number ("AAER-4604, SEC, <date>") and never tries to
            // resolve an EDGAR primary document for it.
            kind: 'release',
            cik: 'SEC',
            accessionNumber: row.releaseNo,
            company: row.title,
            form: 'AAER',
            fileDate: row.date,
            excerpt: `${row.releaseNo} (${row.date}): ${row.title}${row.relatedActions.length ? `. Related: ${row.relatedActions.map(action => action.label).join('; ')}` : ''}`,
            sourceUrl: row.url,
          }}
        />
      ),
    },
  ];

  const exportRows = useMemo(() => (response?.releases ?? []).map(row => ({
    releaseNo: row.releaseNo,
    date: row.date,
    respondents: row.respondents.join('; '),
    title: row.title,
    url: row.url,
    otherReleaseNumbers: row.otherReleaseNumbers.join('; '),
    relatedActions: relatedActionsText(row),
  })), [response]);
  const exportColumns = [
    { key: 'releaseNo', header: 'Release no.' },
    { key: 'date', header: 'Date' },
    { key: 'respondents', header: 'Respondents' },
    { key: 'title', header: 'Title' },
    { key: 'url', header: 'SEC URL' },
    { key: 'otherReleaseNumbers', header: 'Other release numbers' },
    { key: 'relatedActions', header: 'Related actions' },
  ];

  const filtered = Boolean(query.q || query.fromYear || query.toYear);

  return (
    <section aria-label="Accounting and Auditing Enforcement Releases">
      <form onSubmit={submit} role="search" aria-label="Filter AAERs" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px', marginBottom: '10px' }}>
        <label style={{ ...labelStyle, flex: '1 1 260px', maxWidth: '420px' }}>
          Respondent or title contains
          <span style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Search size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
            <input
              type="search"
              value={draft.q}
              maxLength={200}
              onChange={event => setDraft(current => ({ ...current, q: event.target.value }))}
              placeholder="e.g. Deloitte, revenue, AAER-4400"
              style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.82rem' }}
            />
          </span>
        </label>
        <label style={labelStyle}>
          From year
          <select value={draft.fromYear} onChange={event => setDraft(current => ({ ...current, fromYear: event.target.value }))} style={inputStyle}>
            <option value="">Any</option>
            {years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          To year
          <select value={draft.toYear} onChange={event => setDraft(current => ({ ...current, toYear: event.target.value }))} style={inputStyle}>
            <option value="">Any</option>
            {years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <button type="submit" className="secondary-btn" disabled={rangeInvalid}>Apply filters</button>
        {filtered && <button type="button" className="secondary-btn" onClick={clear}>Clear</button>}
        {rangeInvalid && <p role="alert" style={{ flexBasis: '100%', margin: 0, color: 'var(--status-error)', fontSize: '0.76rem' }}>The from year must not be after the to year.</p>}
      </form>

      {state.status === 'loading' ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
          <Loader2 size={20} className="spinner" style={{ marginBottom: '6px' }} aria-hidden="true" />
          <div>Reading the SEC AAER index (a full read can take up to two minutes)…</div>
        </div>
      ) : state.status === 'error' ? (
        <div role="alert" style={{ textAlign: 'center', padding: '20px', color: 'var(--status-error)', background: 'var(--status-error-bg)', border: '1px solid color-mix(in srgb, var(--status-error) 35%, var(--border-color))', borderRadius: '4px' }}>
          <p>{state.message}</p>
          <button type="button" className="secondary-btn" onClick={() => setReloadKey(key => key + 1)}>Retry SEC AAER index</button>
        </div>
      ) : (
        <>
          <p data-testid="aaer-coverage" style={{ color: state.response.coverage.complete ? 'var(--text-secondary)' : 'var(--status-warning)', fontSize: '0.78rem', margin: '0 0 6px' }}>
            <strong>Source:</strong> sec.gov AAER index, {aaerCoverageLine(state.response.coverage)}
          </p>
          <p aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 10px' }}>
            {state.response.total === 0
              ? 'No releases match these filters.'
              : state.response.returned < state.response.total
                ? `Showing the newest ${state.response.returned.toLocaleString('en-US')} of ${state.response.total.toLocaleString('en-US')} matching releases (the service returns at most ${AAER_ROUTE_LIMIT}); narrow the years or text to see older ones.`
                : `${state.response.total.toLocaleString('en-US')} matching release${state.response.total === 1 ? '' : 's'}.`}
          </p>
          {state.response.releases.length > 0 && (
            <>
              <ResultsToolbar data={exportRows} columns={exportColumns} label="AAER releases" />
              <DataTable columns={columns} data={state.response.releases} pageSize={25} rowKey={row => row.releaseNo} />
            </>
          )}
        </>
      )}
    </section>
  );
}
