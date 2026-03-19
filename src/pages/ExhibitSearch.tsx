import { useState, useEffect } from 'react';
import { FileSearch, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { executeFilingResearchSearch } from '../services/filingResearch';

interface ExhibitRow { entityName: string; fileDate: string; formType: string; cik: string; accessionNumber: string; primaryDocument: string; description: string; }

const EXHIBIT_TYPES = [
  { value: 'EX-2.1', label: 'Merger Agreement (EX-2.1)' },
  { value: 'EX-10', label: 'Material Contract (EX-10.x)' },
  { value: 'EX-21', label: 'Subsidiaries (EX-21)' },
  { value: 'EX-23', label: 'Consents (EX-23)' },
  { value: 'EX-99', label: 'Press Release (EX-99.x)' },
  { value: 'EX-4', label: 'Instruments (EX-4.x)' },
];

const cardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.2s' };

export default function ExhibitSearch() {
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters });
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [results, setResults] = useState<ExhibitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentItems, setRecentItems] = useState<ExhibitRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    async function loadRecent() {
      try {
        const matches = await executeFilingResearchSearch({
          query: 'exhibit agreement',
          filters: { ...defaultSearchFilters },
          defaultForms: '10-K,10-K/A,8-K,S-1',
          limit: 8,
        });
        setRecentItems(matches.map(match => ({
          entityName: match.entityName,
          fileDate: match.fileDate,
          formType: match.formType,
          cik: match.cik,
          accessionNumber: match.accessionNumber,
          primaryDocument: match.primaryDocument,
          description: match.description,
        })));
      } catch (err) { console.error(err); }
      finally { setRecentLoading(false); }
    }
    loadRecent();
  }, []);

  function toggleType(t: string) { setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]); }

  async function handleSearch() {
    setLoading(true); setSearched(true);
    try {
      const exhibitKeywords = selectedTypes.length > 0 ? selectedTypes.join(' ') : 'exhibit';
      const searchQ = filters.keyword ? `${filters.keyword} ${exhibitKeywords}` : exhibitKeywords;
      const matches = await executeFilingResearchSearch({
        query: searchQ,
        filters,
        defaultForms: '10-K,10-K/A,8-K,S-1,S-1/A,DEF 14A',
        limit: 50,
      });
      setResults(matches.map(match => ({
        entityName: match.entityName,
        fileDate: match.fileDate,
        formType: match.formType,
        cik: match.cik,
        accessionNumber: match.accessionNumber,
        primaryDocument: match.primaryDocument,
        description: match.description,
      })));
    } catch (err) { console.error(err); setResults([]); }
    finally { setLoading(false); }
  }

  function viewFiling(row: ExhibitRow) {
    const accNum = row.accessionNumber.replace(/-/g, '');
    window.open(`https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`, '_blank');
  }

  const columns: ColumnDef<ExhibitRow>[] = [
    { key: 'fileDate', header: 'Date', sortable: true },
    { key: 'formType', header: 'Exhibit Type', sortable: true },
    { key: 'entityName', header: 'Company', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'accessionNumber', header: 'Filing', render: (row) => {
      const accNum = row.accessionNumber.replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`;
      return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#60A5FA', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>View <ExternalLink size={12} /></a>;
    }},
  ];

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <FileSearch size={28} style={{ color: '#60A5FA' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>Exhibits & Agreements</h1>
      </div>
      <p style={{ color: '#94A3B8', marginBottom: '24px', fontSize: '0.9rem' }}>Search SEC filing exhibits — merger agreements, material contracts, subsidiaries lists, and more.</p>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {EXHIBIT_TYPES.map(et => (
          <button key={et.value} onClick={() => toggleType(et.value)}
            style={{
              padding: '4px 12px', borderRadius: '16px', border: '1px solid',
              borderColor: selectedTypes.includes(et.value) ? '#3B82F6' : 'rgba(255,255,255,0.1)',
              background: selectedTypes.includes(et.value) ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: selectedTypes.includes(et.value) ? '#60A5FA' : '#94A3B8',
              cursor: 'pointer', fontSize: '0.8rem'
            }}>
            {et.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, maxWidth: '500px' }}>
          <input value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} placeholder="Search exhibits..."
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <button onClick={handleSearch} disabled={loading}
          style={{ padding: '8px 20px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </div>

      <SearchFilterBar config={{
        showEntityName: true, showDateRange: true,
        showSIC: true, showExchange: true, showAcceleratedStatus: true,
        showStateOfInc: true, showAccountant: true,
        showAccessionNumber: true, showFileNumber: true,
      }} filters={filters} onChange={setFilters} onSearch={handleSearch} loading={loading} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}><Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} /><div>Searching exhibits...</div></div>
      ) : results.length > 0 ? (
        <DataTable columns={columns} data={results} pageSize={25} />
      ) : searched ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>No exhibits found.</div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={18} style={{ color: '#F59E0B' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'white' }}>Recent Merger Agreements & Material Contracts</h2>
          </div>
          {recentLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#64748B' }}><Loader2 size={20} className="spinner" style={{ marginBottom: '8px' }} /><div>Loading recent exhibits...</div></div>
          ) : recentItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {recentItems.map((item, i) => (
                <div key={i} style={cardStyle} onClick={() => viewFiling(item)}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(96,165,250,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.entityName}</div>
                  {item.description && <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{item.fileDate}</span>
                    <span style={{ fontSize: '0.7rem', color: '#60A5FA', background: 'rgba(59,130,246,0.1)', padding: '2px 8px', borderRadius: '4px' }}>{item.formType}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: '#64748B' }}>Search for SEC filing exhibits above.</div>
          )}
        </div>
      )}
    </div>
  );
}
