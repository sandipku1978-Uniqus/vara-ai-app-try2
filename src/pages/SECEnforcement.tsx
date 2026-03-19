import { useState, useEffect } from 'react';
import { Gavel, Loader2, ExternalLink, Search } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import { fetchLitigationReleases } from '../services/secApi';

interface LitRelease {
  date: string;
  title: string;
  url: string;
  releaseNumber: string;
}

export default function SECEnforcement() {
  const [releases, setReleases] = useState<LitRelease[]>([]);
  const [filtered, setFiltered] = useState<LitRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchLitigationReleases();
        setReleases(data);
        setFiltered(data);
      } catch (err) {
        console.error('Enforcement load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
        <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: '#60A5FA', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          View <ExternalLink size={12} />
        </a>
      )
    },
  ];

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <Gavel size={28} style={{ color: '#60A5FA' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>SEC Enforcement</h1>
      </div>
      <p style={{ color: '#94A3B8', marginBottom: '24px', fontSize: '0.9rem' }}>
        SEC litigation releases and enforcement actions.
      </p>

      <div style={{ marginBottom: '24px', maxWidth: '400px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '6px 12px' }}>
        <Search size={14} style={{ color: '#94A3B8' }} />
        <input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter releases..."
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: '0.85rem' }} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>
          <Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} />
          <div>Loading enforcement actions...</div>
        </div>
      ) : filtered.length > 0 ? (
        <DataTable columns={columns} data={filtered} pageSize={25} />
      ) : (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>No enforcement actions found.</div>
      )}
    </div>
  );
}
