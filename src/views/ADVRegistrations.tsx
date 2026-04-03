'use client';

import { useState, useEffect } from 'react';
import { ClipboardList, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { executeFilingResearchSearch } from '../services/filingResearch';

interface ADVRow { entityName: string; fileDate: string; formType: string; cik: string; accessionNumber: string; primaryDocument: string; }

const cardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.2s' };

export default function ADVRegistrations() {
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters });
  const [results, setResults] = useState<ADVRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentItems, setRecentItems] = useState<ADVRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    async function loadRecent() {
      try {
        const matches = await executeFilingResearchSearch({
          query: 'capital management',
          filters: { ...defaultSearchFilters },
          defaultForms: 'ADV,ADV/A,ADV-W',
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
      } catch (err) { console.error(err); }
      finally { setRecentLoading(false); }
    }
    loadRecent();
  }, []);

  async function handleSearch() {
    setLoading(true); setSearched(true);
    try {
      const matches = await executeFilingResearchSearch({
        query: filters.keyword || 'adviser',
        filters,
        defaultForms: 'ADV,ADV/A,ADV-W',
        limit: 50,
      });
      setResults(matches.map(match => ({
        entityName: match.entityName,
        fileDate: match.fileDate,
        formType: match.formType,
        cik: match.cik,
        accessionNumber: match.accessionNumber,
        primaryDocument: match.primaryDocument,
      })));
    } catch (err) { console.error(err); setResults([]); }
    finally { setLoading(false); }
  }

  function viewFiling(row: ADVRow) {
    const accNum = row.accessionNumber.replace(/-/g, '');
    window.open(`https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`, '_blank');
  }

  const columns: ColumnDef<ADVRow>[] = [
    { key: 'fileDate', header: 'Date', sortable: true },
    { key: 'formType', header: 'Form', sortable: true },
    { key: 'entityName', header: 'Firm Name', sortable: true },
    { key: 'accessionNumber', header: 'Filing', render: (row) => {
      const accNum = row.accessionNumber.replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#D66CAE', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>View <ExternalLink size={12} /></a>
          <AskCopilotButton compact prompt={`Analyze the ${row.formType} filing from ${row.entityName} filed ${row.fileDate}`} />
        </div>
      );
    }},
  ];

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <ClipboardList size={28} style={{ color: '#D66CAE' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>ADV Registrations</h1>
      </div>
      <p style={{ color: '#94A3B8', marginBottom: '24px', fontSize: '0.9rem' }}>Search Form ADV, ADV/A, and ADV-W investment adviser registration filings.</p>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, maxWidth: '500px' }}>
          <input value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} placeholder="Search investment advisers..."
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <button onClick={handleSearch} disabled={loading}
          style={{ padding: '8px 20px', background: '#B31F7E', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </div>

      <SearchFilterBar config={{
        showEntityName: true, showDateRange: true,
        showStateOfInc: true, showHeadquarters: true,
        showAccessionNumber: true, showFileNumber: true,
      }} filters={filters} onChange={setFilters} onSearch={handleSearch} loading={loading} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}><Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} /><div>Searching ADV filings...</div></div>
      ) : results.length > 0 ? (
        <>
          <AIResultsSummary
            query={filters.keyword}
            resultsSummary={results.slice(0, 10).map(r => `${r.entityName} - ${r.formType} (${r.fileDate})`).join('\n')}
            resultCount={results.length}
            moduleLabel="ADV registrations"
            cacheKey={`ADV registrations:${filters.keyword}:${results.length}`}
          />
          <ResultsToolbar data={results} columns={columns} label="ADV registrations" />
          <DataTable columns={columns} data={results} pageSize={25} />
        </>
      ) : searched ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>No ADV filings found.</div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={18} style={{ color: '#F59E0B' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'white' }}>Recent Investment Adviser Registrations</h2>
          </div>
          {recentLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#64748B' }}><Loader2 size={20} className="spinner" style={{ marginBottom: '8px' }} /><div>Loading recent filings...</div></div>
          ) : recentItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {recentItems.map((item, i) => (
                <div key={i} style={cardStyle} onClick={() => viewFiling(item)}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(214,108,174,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.entityName}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{item.fileDate}</span>
                    <span style={{ fontSize: '0.7rem', color: '#D66CAE', background: 'rgba(179,31,126,0.1)', padding: '2px 8px', borderRadius: '4px' }}>{item.formType}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: '#64748B' }}>Search for investment adviser registrations above.</div>
          )}
        </div>
      )}
    </div>
  );
}

