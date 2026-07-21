'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Scale, Search } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import {
  fetchSecRulemaking,
  fetchSecStaffGuidance,
  type OfficialSecItem,
} from '../services/officialSources';

type RegulationTab = 'rules' | 'guidance';

export default function SecRegulation() {
  const [tab, setTab] = useState<RegulationTab>('rules');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<OfficialSecItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (activeTab: RegulationTab, searchQuery: string) => {
    setLoading(true);
    setError('');
    try {
      const nextItems = activeTab === 'rules'
        ? await fetchSecRulemaking(searchQuery)
        : await fetchSecStaffGuidance(searchQuery);
      setItems(nextItems);
    } catch (cause) {
      console.error('Official SEC regulation source failed:', cause);
      setItems([]);
      setError('The official SEC regulation source could not be loaded. No substitute filing data is being shown.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab, '');
  }, [load, tab]);

  const columns = useMemo<ColumnDef<OfficialSecItem>[]>(() => [
    { key: 'date', header: 'Published', sortable: true },
    { key: 'status', header: 'Status', sortable: true },
    { key: 'fileNumber', header: 'File number', sortable: true, render: row => row.fileNumber || '—' },
    { key: 'effectiveDate', header: 'Effective date', sortable: true, render: row => row.effectiveDate || '—' },
    { key: 'title', header: 'Official title', sortable: true },
    { key: 'division', header: 'Division', sortable: true, render: row => row.division || '—' },
    {
      key: 'url',
      header: 'Source',
      render: row => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            SEC.gov <ExternalLink size={12} />
          </a>
          <AskCopilotButton compact prompt={`Analyze this official SEC ${row.type}: ${row.title}. Source: ${row.url}`} />
        </span>
      ),
    },
  ], []);

  const tabStyle = (active: boolean) => ({
    padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem',
    border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
    background: active ? 'var(--interactive-hover-strong)' : 'var(--surface-panel)',
    color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
  });

  return (
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
        <Scale size={24} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>Securities Regulation</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '3px', fontSize: '0.86rem' }}>
        Official SEC rulemaking activity and staff guidance. Staff guidance reflects staff views and is not a Commission rule.
      </p>
      <p style={{ color: 'var(--text-muted)', marginBottom: '12px', fontSize: '0.75rem' }}>
        Source: SEC Rulemaking Activity and SEC Staff Guidance indexes. Open the SEC.gov link to verify the controlling document.
      </p>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }} role="group" aria-label="Regulatory source">
        <button type="button" aria-pressed={tab === 'rules'} style={tabStyle(tab === 'rules')} onClick={() => { setTab('rules'); setQuery(''); }}>Rules &amp; releases</button>
        <button type="button" aria-pressed={tab === 'guidance'} style={tabStyle(tab === 'guidance')} onClick={() => { setTab('guidance'); setQuery(''); }}>Staff guidance</button>
      </div>

      <form onSubmit={event => { event.preventDefault(); void load(tab, query); }} style={{ display: 'flex', gap: '8px', marginBottom: '12px', maxWidth: '720px', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={tab === 'rules' ? 'Search rulemaking activity…' : 'Filter staff guidance…'}
          aria-label="Search official SEC regulation sources"
          style={{ flex: '1 1 260px', minWidth: 0, padding: '7px 10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
        />
        <button type="submit" disabled={loading} style={{ padding: '7px 14px', background: 'var(--accent-primary)', color: '#fff', border: '1px solid var(--accent-primary)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </form>

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}><Loader2 size={20} className="spinner" /><div>Loading the official SEC index…</div></div>
      ) : error ? (
        <div role="alert" style={{ textAlign: 'center', padding: '20px', color: 'var(--status-error)', background: 'var(--status-error-bg)', border: '1px solid color-mix(in srgb, var(--status-error) 35%, var(--border-color))', borderRadius: '4px' }}>
          <p>{error}</p>
          <button type="button" className="secondary-btn" onClick={() => void load(tab, query)}>Retry official source</button>
        </div>
      ) : items.length > 0 ? (
        <>
          <AIResultsSummary
            query={query}
            resultsSummary={items.slice(0, 12).map(item => `${item.date} | ${item.status} | ${item.fileNumber} | ${item.title} | ${item.url}`).join('\n')}
            resultCount={items.length}
            moduleLabel={tab === 'rules' ? 'official SEC rulemaking items' : 'official SEC staff guidance items'}
            cacheKey={`official-sec-${tab}:${query}:${items.length}`}
          />
          <ResultsToolbar data={items} columns={columns} label={tab === 'rules' ? 'SEC rulemaking items' : 'SEC staff guidance'} />
          <DataTable columns={columns} data={items} pageSize={25} />
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No official SEC items matched this search.</div>
      )}
    </div>
  );
}
