'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import { fetchSecNoActionLetters, type OfficialSecItem } from '../services/officialSources';

export default function NoActionLetters() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<OfficialSecItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (searchQuery: string) => {
    setLoading(true);
    setError('');
    try {
      setItems(await fetchSecNoActionLetters(searchQuery));
    } catch (cause) {
      console.error('Official SEC no-action source failed:', cause);
      setItems([]);
      setError('The official SEC no-action indexes could not be loaded. No EDGAR correspondence substitute is being shown.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const columns = useMemo<ColumnDef<OfficialSecItem>[]>(() => [
    { key: 'date', header: 'Date', sortable: true },
    { key: 'type', header: 'Response type', sortable: true },
    { key: 'division', header: 'Division', sortable: true },
    { key: 'title', header: 'Requestor / subject', sortable: true },
    { key: 'status', header: 'Status', sortable: true },
    {
      key: 'url',
      header: 'Official response',
      render: row => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open the SEC staff ${row.type} response "${row.title}" on SEC.gov`}
            style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            SEC.gov <ExternalLink size={12} aria-hidden="true" />
          </a>
          <AskCopilotButton compact prompt={`Analyze this SEC staff ${row.type} response: ${row.title}. Source: ${row.url}`} />
        </span>
      ),
    },
  ], []);

  return (
    <div style={{ width: '100%', padding: 'clamp(20px, 4vw, 32px)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <ShieldCheck size={28} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>No-Action Letters</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '0.9rem' }}>
        Official SEC staff no-action, interpretive, and exemptive responses across Corporation Finance, Investment Management, and Trading and Markets.
      </p>
      <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.78rem' }}>
        A no-action response is a staff position on enforcement action, not a Commission rule or court decision. Verify the linked official response.
      </p>

      <form onSubmit={event => { event.preventDefault(); void load(query); }} style={{ display: 'flex', gap: '12px', marginBottom: '24px', maxWidth: '620px', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search requestor, subject, or division…"
          aria-label="Search official SEC no-action responses"
          style={{ flex: '1 1 260px', minWidth: 0, padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }}
        />
        <button type="submit" disabled={loading} style={{ padding: '8px 20px', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </form>

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}><Loader2 size={24} className="spinner" /><div>Loading official SEC no-action indexes…</div></div>
      ) : error ? (
        <div role="alert" style={{ textAlign: 'center', padding: '48px', color: 'var(--status-error)' }}>
          <p>{error}</p>
          <button type="button" className="secondary-btn" onClick={() => void load(query)}>Retry official source</button>
        </div>
      ) : items.length > 0 ? (
        <>
          <AIResultsSummary
            query={query}
            resultsSummary={items.slice(0, 12).map(item => `${item.date} | ${item.division} | ${item.type} | ${item.title} | ${item.url}`).join('\n')}
            resultCount={items.length}
            moduleLabel="official SEC staff responses"
            cacheKey={`official-no-action:${query}:${items.length}`}
          />
          <ResultsToolbar data={items} columns={columns} label="SEC no-action and interpretive responses" />
          <DataTable columns={columns} data={items} pageSize={25} />
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>No official SEC staff responses matched. This index covers requestor names, subjects, and divisions — try a company or firm name (e.g. UBS), or a division like Corporation Finance. Topic phrases are not part of the official index.</div>
      )}
    </div>
  );
}
