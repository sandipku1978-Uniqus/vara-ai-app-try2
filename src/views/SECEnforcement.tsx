'use client';

import { useCallback, useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { Gavel, Loader2, ExternalLink, Search } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AaerReleasesPanel from '../components/enforcement/AaerReleasesPanel';
import { fetchLitigationReleases } from '../services/secApi';
import {
  ENFORCEMENT_SCOPE_DESCRIPTION,
  ENFORCEMENT_SCOPE_LABEL,
  ENFORCEMENT_SCOPE_LIMITATION,
} from '../config/enforcement';

interface LitRelease {
  date: string;
  title: string;
  url: string;
  releaseNumber: string;
}

type EnforcementTab = 'litigation' | 'aaer';

const ENFORCEMENT_TABS: Array<{ id: EnforcementTab; label: string }> = [
  { id: 'litigation', label: ENFORCEMENT_SCOPE_LABEL },
  { id: 'aaer', label: 'Accounting and Auditing Enforcement Releases' },
];

export default function SECEnforcement() {
  const [tab, setTab] = useState<EnforcementTab>('litigation');
  // The AAER crawl is expensive; mount it on first visit, then keep it mounted
  // so switching tabs does not re-read the SEC index.
  const [aaerVisited, setAaerVisited] = useState(false);
  const tabRefs = useRef<Record<EnforcementTab, HTMLButtonElement | null>>({ litigation: null, aaer: null });

  const select = (next: EnforcementTab) => {
    setTab(next);
    if (next === 'aaer') setAaerVisited(true);
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = ENFORCEMENT_TABS.findIndex(item => item.id === tab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ENFORCEMENT_TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + ENFORCEMENT_TABS.length) % ENFORCEMENT_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ENFORCEMENT_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = ENFORCEMENT_TABS[nextIndex].id;
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
        <Gavel size={24} style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>SEC Enforcement: Litigation Releases and AAERs</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '0.86rem' }}>
        Two official SEC indexes: litigation releases for civil actions, and Accounting and Auditing Enforcement Releases (AAERs) for actions involving accountants, auditors and financial reporting.
      </p>

      <div role="tablist" aria-label="Enforcement release indexes" style={{ display: 'flex', gap: '8px', marginBottom: '14px', overflowX: 'auto' }}>
        {ENFORCEMENT_TABS.map(item => (
          <button
            key={item.id}
            ref={element => { tabRefs.current[item.id] = element; }}
            type="button"
            role="tab"
            id={`enforcement-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`enforcement-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => select(item.id)}
            onKeyDown={onTabKeyDown}
            style={{
              padding: '7px 14px', borderRadius: '6px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              border: '1px solid ' + (tab === item.id ? 'var(--accent-primary)' : 'var(--border-color)'),
              background: tab === item.id ? 'var(--interactive-hover-strong)' : 'var(--surface-panel-strong)',
              color: tab === item.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="enforcement-panel-litigation" aria-labelledby="enforcement-tab-litigation" hidden={tab !== 'litigation'}>
        <LitigationReleases />
      </div>
      <div role="tabpanel" id="enforcement-panel-aaer" aria-labelledby="enforcement-tab-aaer" hidden={tab !== 'aaer'}>
        {aaerVisited && <AaerReleasesPanel />}
      </div>
    </div>
  );
}

function LitigationReleases() {
  const [releases, setReleases] = useState<LitRelease[]>([]);
  const [filtered, setFiltered] = useState<LitRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchLitigationReleases();
      setReleases(data);
      setFiltered(data);
    } catch (err) {
      console.error('Enforcement load error:', err);
      setReleases([]);
      setFiltered([]);
      setError('The official SEC litigation releases index could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!filterText.trim()) {
      setFiltered(releases);
    } else {
      const lower = filterText.toLowerCase();
      setFiltered(releases.filter(r => r.title.toLowerCase().includes(lower) || r.releaseNumber.toLowerCase().includes(lower)));
    }
  }, [filterText, releases]);

  const columns: ColumnDef<LitRelease>[] = [
    { key: 'date', header: 'Date', sortable: true },
    { key: 'releaseNumber', header: 'Release #', sortable: true },
    { key: 'title', header: 'Title', sortable: true },
    {
      key: 'url', header: 'Link', render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View SEC litigation release ${row.releaseNumber} (${row.title}) on SEC.gov`}
            style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            View <ExternalLink size={12} aria-hidden="true" />
          </a>
          <AskCopilotButton compact prompt={`Analyze this SEC litigation release concerning a civil action: ${row.title} (Release ${row.releaseNumber}, dated ${row.date})`} />
        </span>
      )
    },
  ];

  return (
    <>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '0.86rem' }}>
        {ENFORCEMENT_SCOPE_DESCRIPTION} {ENFORCEMENT_SCOPE_LIMITATION}
      </p>

      <div style={{ marginBottom: '12px', maxWidth: '480px', display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '5px 10px' }}>
        <Search size={14} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
        <label className="sr-only" htmlFor="litigation-release-filter">Filter litigation releases</label>
        <input id="litigation-release-filter" type="search" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter by party name or release number (e.g. LLC, LR-26590)..."
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.82rem' }} />
      </div>

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
          <Loader2 size={20} className="spinner" style={{ marginBottom: '6px' }} />
          <div>Loading litigation releases...</div>
        </div>
      ) : error ? (
        <div role="alert" style={{ textAlign: 'center', padding: '20px', color: 'var(--status-error)', background: 'var(--status-error-bg)', border: '1px solid color-mix(in srgb, var(--status-error) 35%, var(--border-color))', borderRadius: '4px' }}>
          <p>{error}</p>
          <button type="button" className="secondary-btn" onClick={() => void load()}>Retry official source</button>
        </div>
      ) : filtered.length > 0 ? (
        <>
          <ResultsToolbar data={filtered} columns={columns} label="litigation releases" />
          <DataTable columns={columns} data={filtered} pageSize={25} />
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No litigation releases found.</div>
      )}
    </>
  );
}
