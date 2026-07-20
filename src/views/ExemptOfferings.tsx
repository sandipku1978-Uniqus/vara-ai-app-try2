'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { executeFilingResearchSearch } from '../services/filingResearch';

interface FormDRow { entityName: string; fileDate: string; formType: string; cik: string; accessionNumber: string; primaryDocument: string; }

const cardStyle: React.CSSProperties = { width: '100%', background: 'var(--surface-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.2s' };

export default function ExemptOfferings() {
  const navigate = useRouter();
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters });
  const [results, setResults] = useState<FormDRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [recentItems, setRecentItems] = useState<FormDRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState('');

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError('');
    try {
      const matches = await executeFilingResearchSearch({
        query: '',
        filters: { ...defaultSearchFilters },
        defaultForms: 'D,D/A',
        limit: 8,
      });
      setRecentItems(matches.map(match => ({
        entityName: match.entityName,
        fileDate: match.fileDate,
        formType: match.formType,
        cik: match.cik,
        accessionNumber: match.accessionNumber,
        primaryDocument: match.primaryDocument,
      })));
    } catch (error) {
      console.error('Recent Form D load failed:', error);
      setRecentItems([]);
      setRecentError('Recent Form D filings could not be loaded from SEC EDGAR. No empty-result conclusion can be drawn.');
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  async function handleSearch() {
    setLoading(true); setSearched(true);
    setSearchError('');
    try {
      const matches = await executeFilingResearchSearch({
        query: filters.keyword,
        filters,
        defaultForms: 'D,D/A',
        limit: 50,
        // Users mostly type issuer names here — resolve lowercase too
        entityScope: 'aggressive',
      });
      setResults(matches.map(match => ({
        entityName: match.entityName,
        fileDate: match.fileDate,
        formType: match.formType,
        cik: match.cik,
        accessionNumber: match.accessionNumber,
        primaryDocument: match.primaryDocument,
      })));
    } catch (error) {
      console.error('Form D search failed:', error);
      setResults([]);
      setSearchError('The Form D search failed. No zero-result conclusion can be drawn; retry the same search.');
    }
    finally { setLoading(false); }
  }

  function viewFiling(row: FormDRow) {
    navigate.push(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`);
  }

  const columns: ColumnDef<FormDRow>[] = [
    { key: 'fileDate', header: 'Date', sortable: true },
    { key: 'formType', header: 'Form', sortable: true },
    { key: 'entityName', header: 'Issuer', sortable: true },
    { key: 'accessionNumber', header: 'Filing', render: (row) => {
      const accNum = row.accessionNumber.replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>View <ExternalLink size={12} /></a>
          <AskCopilotButton compact prompt={`Analyze the ${row.formType} filing from ${row.entityName} filed ${row.fileDate}`} />
        </div>
      );
    }},
  ];

  return (
    <div style={{ width: '100%', padding: 'clamp(20px, 4vw, 32px)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <DollarSign size={28} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>Exempt Offerings</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>Search Form D and D/A filings for Regulation D exempt offerings.</p>

      <form onSubmit={event => { event.preventDefault(); void handleSearch(); }} style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <input value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} placeholder="Search Form D filings..."
            aria-label="Search Form D filings"
            style={{ width: '100%', padding: '8px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <button type="submit" disabled={loading}
          style={{ padding: '8px 20px', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </form>

      <SearchFilterBar config={{
        showEntityName: true, showDateRange: true,
        showSIC: true, showExchange: true,
        showStateOfInc: true, showHeadquarters: true,
        showAccessionNumber: true,
      }} filters={filters} onChange={setFilters} onSearch={handleSearch} loading={loading} />

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}><Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} /><div>Searching Form D filings...</div></div>
      ) : searchError ? (
        <div role="alert" style={{ textAlign: 'center', padding: '32px', color: 'var(--status-error)' }}>
          <p>{searchError}</p>
          <button type="button" className="secondary-btn" onClick={() => void handleSearch()} style={{ marginTop: '12px' }}>Retry search</button>
        </div>
      ) : results.length > 0 ? (
        <>
          <AIResultsSummary
            query={filters.keyword}
            resultsSummary={results.slice(0, 10).map(r => `${r.entityName} - ${r.formType} (${r.fileDate})`).join('\n')}
            resultCount={results.length}
            moduleLabel="exempt offerings"
            cacheKey={`exempt offerings:${filters.keyword}:${results.length}`}
          />
          <ResultsToolbar data={results} columns={columns} label="exempt offerings" />
          <DataTable columns={columns} data={results} pageSize={25} />
        </>
      ) : searched ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>No Form D filings found.</div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={18} style={{ color: 'var(--status-warning)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Recent Exempt Offerings</h2>
          </div>
          {recentLoading ? (
            <div role="status" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}><Loader2 size={20} className="spinner" style={{ marginBottom: '8px' }} /><div>Loading recent filings...</div></div>
          ) : recentError ? (
            <div role="alert" style={{ textAlign: 'center', padding: '32px', color: 'var(--status-error)' }}>
              <p>{recentError}</p>
              <button type="button" className="secondary-btn" onClick={() => void loadRecent()} style={{ marginTop: '12px' }}>Retry recent filings</button>
            </div>
          ) : recentItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: '12px' }}>
              {recentItems.map((item, i) => (
                <button key={`${item.accessionNumber}-${i}`} type="button" className="specialist-result-card" style={cardStyle} onClick={() => viewFiling(item)}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.entityName}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.fileDate}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', background: 'rgba(179,31,126,0.1)', padding: '2px 8px', borderRadius: '4px' }}>{item.formType}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>No recent Form D or D/A filings were returned.</div>
          )}
        </div>
      )}
    </div>
  );
}
