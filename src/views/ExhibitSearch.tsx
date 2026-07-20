'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileSearch, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { executeFilingResearchSearch, matchesDocumentTypePrefixes } from '../services/filingResearch';

interface ExhibitRow { entityName: string; fileDate: string; formType: string; documentType: string; cik: string; accessionNumber: string; primaryDocument: string; description: string; }

const EXHIBIT_TYPES = [
  { value: 'EX-2.1', label: 'Merger Agreement (EX-2.1)' },
  { value: 'EX-10', label: 'Material Contract (EX-10.x)' },
  { value: 'EX-21', label: 'Subsidiaries (EX-21)' },
  { value: 'EX-23', label: 'Consents (EX-23)' },
  { value: 'EX-99', label: 'Press Release (EX-99.x)' },
  { value: 'EX-4', label: 'Instruments (EX-4.x)' },
];

const cardStyle: React.CSSProperties = { width: '100%', background: 'var(--surface-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.2s' };

export default function ExhibitSearch() {
  const navigate = useRouter();
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters });
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [results, setResults] = useState<ExhibitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentItems, setRecentItems] = useState<ExhibitRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [recentError, setRecentError] = useState('');
  const [recentReloadKey, setRecentReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadRecent() {
      setRecentLoading(true);
      setRecentError('');
      try {
        const matches = await executeFilingResearchSearch({
          query: '',
          filters: { ...defaultSearchFilters },
          defaultForms: '10-K,10-K/A,8-K,S-1',
          limit: 160,
          includeExhibits: true,
        });
        if (cancelled) return;
        setRecentItems(matches
          .filter(match => matchesDocumentTypePrefixes(match.documentType, ['EX-2.1', 'EX-10']))
          .slice(0, 8)
          .map(match => ({
          entityName: match.entityName,
          fileDate: match.fileDate,
          formType: match.formType,
          documentType: match.documentType,
          cik: match.cik,
          accessionNumber: match.accessionNumber,
          primaryDocument: match.primaryDocument,
          description: match.description,
        })));
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setRecentItems([]);
          setRecentError('Recent SEC exhibit documents could not be loaded.');
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }
    void loadRecent();
    return () => { cancelled = true; };
  }, [recentReloadKey]);

  function toggleType(t: string) { setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]); }

  async function handleSearch() {
    setLoading(true); setSearched(true); setSearchError('');
    try {
      const matches = await executeFilingResearchSearch({
        query: filters.keyword,
        filters,
        defaultForms: '10-K,10-K/A,8-K,S-1,S-1/A,DEF 14A',
        limit: 250,
        includeExhibits: true,
        // The exhibits box is predominantly a company filter ("Organon",
        // "sun pharma") — resolve lowercase names/tickers to issuer scope
        entityScope: 'aggressive',
      });
      setResults(matches
        .filter(match => matchesDocumentTypePrefixes(match.documentType, selectedTypes))
        .slice(0, 50)
        .map(match => ({
        entityName: match.entityName,
        fileDate: match.fileDate,
        formType: match.formType,
        documentType: match.documentType,
        cik: match.cik,
        accessionNumber: match.accessionNumber,
        primaryDocument: match.primaryDocument,
        description: match.description,
      })));
    } catch (err) { console.error(err); setResults([]); setSearchError('The SEC exhibit search failed. Retry the same criteria or narrow the date range.'); }
    finally { setLoading(false); }
  }

  function viewFiling(row: ExhibitRow) {
    navigate.push(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`);
  }

  const columns: ColumnDef<ExhibitRow>[] = [
    { key: 'fileDate', header: 'Date', sortable: true },
    { key: 'documentType', header: 'Exhibit Type', sortable: true },
    { key: 'formType', header: 'Parent Form', sortable: true },
    { key: 'entityName', header: 'Company', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'accessionNumber', header: 'Filing', render: (row) => {
      const accNum = row.accessionNumber.replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>View <ExternalLink size={12} /></a>
          <AskCopilotButton compact prompt={`Analyze exhibit ${row.documentType} attached to ${row.formType} from ${row.entityName}, filed ${row.fileDate}`} />
        </div>
      );
    }},
  ];

  return (
    <div style={{ width: '100%', padding: 'clamp(20px, 4vw, 32px)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <FileSearch size={28} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>Exhibits & Agreements</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>Search SEC filing exhibits — merger agreements, material contracts, subsidiaries lists, and more.</p>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {EXHIBIT_TYPES.map(et => (
          <button key={et.value} type="button" aria-pressed={selectedTypes.includes(et.value)} onClick={() => toggleType(et.value)}
            style={{
              padding: '4px 12px', borderRadius: '16px', border: '1px solid',
              borderColor: selectedTypes.includes(et.value) ? 'var(--accent-primary)' : 'var(--border-color)',
              background: selectedTypes.includes(et.value) ? 'rgba(179,31,126,0.15)' : 'transparent',
              color: selectedTypes.includes(et.value) ? 'var(--accent-primary)' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '0.8rem'
            }}>
            {et.label}
          </button>
        ))}
      </div>

      <form onSubmit={event => { event.preventDefault(); void handleSearch(); }} style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', maxWidth: '500px', minWidth: 0 }}>
          <input value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} placeholder="Search exhibits..."
            aria-label="Search exhibits"
            style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <button type="submit" disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </form>

      <SearchFilterBar config={{
        showEntityName: true, showDateRange: true,
        showSIC: true, showExchange: true, showAcceleratedStatus: true,
        showStateOfInc: true, showAccountant: true,
        showAccessionNumber: true, showFileNumber: true,
      }} filters={filters} onChange={setFilters} onSearch={handleSearch} loading={loading} />

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}><Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} /><div>Searching exhibits...</div></div>
      ) : results.length > 0 ? (
        <>
          <AIResultsSummary
            query={filters.keyword}
            resultsSummary={results.slice(0, 10).map(r => `${r.entityName} - ${r.documentType} attached to ${r.formType} (${r.fileDate})`).join('\n')}
            resultCount={results.length}
            moduleLabel="exhibit filings"
            cacheKey={`exhibit filings:${filters.keyword}:${results.length}`}
          />
          <ResultsToolbar data={results} columns={columns} label="exhibit filings" />
          <DataTable columns={columns} data={results} pageSize={25} />
        </>
      ) : searched ? (
        <div role={searchError ? 'alert' : undefined} style={{ textAlign: 'center', padding: '48px', color: searchError ? 'var(--status-error)' : 'var(--text-muted)' }}>
          <p>{searchError || 'No exhibit documents matched these criteria.'}</p>
          {searchError && <button type="button" className="secondary-btn" onClick={() => void handleSearch()}>Retry exhibit search</button>}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={18} style={{ color: 'var(--status-warning)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Recent Merger Agreements & Material Contracts</h2>
          </div>
          {recentLoading ? (
            <div role="status" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}><Loader2 size={20} className="spinner" style={{ marginBottom: '8px' }} /><div>Loading recent exhibits...</div></div>
          ) : recentError ? (
            <div role="alert" style={{ textAlign: 'center', padding: '32px', color: 'var(--status-error)' }}>
              <p>{recentError}</p>
              <button type="button" className="secondary-btn" onClick={() => setRecentReloadKey(key => key + 1)}>Retry recent SEC exhibits</button>
            </div>
          ) : recentItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: '12px' }}>
              {recentItems.map((item, i) => (
                <button key={`${item.accessionNumber}-${i}`} type="button" className="specialist-result-card" style={cardStyle} onClick={() => viewFiling(item)}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.entityName}</div>
                  {item.description && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.fileDate}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', background: 'rgba(179,31,126,0.1)', padding: '2px 8px', borderRadius: '4px' }}>{item.documentType} · {item.formType}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>Search for SEC filing exhibits above.</div>
          )}
        </div>
      )}
    </div>
  );
}
