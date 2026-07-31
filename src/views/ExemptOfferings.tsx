'use client';

import EntitySearchInput from '../components/filters/EntitySearchInput';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { executeFilingResearchSearch } from '../services/filingResearch';
import SearchIntegrityNotice, { useSearchIntegrity } from '../components/research/SearchIntegrityNotice';

interface FormDRow { entityName: string; fileDate: string; formType: string; cik: string; accessionNumber: string; primaryDocument: string; }

const cardStyle: React.CSSProperties = { width: '100%', background: 'var(--surface-panel)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '10px 12px', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' };

export default function ExemptOfferings() {
  const navigate = useRouter();
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters });
  const [results, setResults] = useState<FormDRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const integrity = useSearchIntegrity();
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
    integrity.reset();
    try {
      const matches = await executeFilingResearchSearch({
        query: filters.keyword,
        filters,
        defaultForms: 'D,D/A',
        limit: 50,
        // Users mostly type issuer names here — resolve lowercase too
        entityScope: 'aggressive',
        ...integrity.callbacks,
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
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '10px' }}>
        <DollarSign size={22} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>Exempt Offerings</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '14px', fontSize: '0.86rem', lineHeight: 1.45 }}>Search Form D and D/A filings for Regulation D exempt offerings.</p>

      <form onSubmit={event => { event.preventDefault(); void handleSearch(); }} style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <EntitySearchInput
            value={filters.keyword}
            onChange={text => setFilters({ ...filters, keyword: text })}
            placeholder="Search Form D filings..."
            ariaLabel="Search Form D filings"
          />
        </div>
        <button type="submit" disabled={loading}
          style={{ padding: '7px 14px', background: 'var(--accent-primary)', color: '#fff', border: '1px solid var(--accent-primary)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </form>

      <SearchFilterBar config={{
        showEntityName: true, showDateRange: true,
        showSIC: true,
        showStateOfInc: true, showHeadquarters: true,
        showAccessionNumber: true,
      }} filters={filters} onChange={setFilters} onSearch={handleSearch} loading={loading} />

      <p style={{ color: 'var(--text-muted)', margin: '2px 0 12px', fontSize: '0.76rem', lineHeight: 1.4 }}>
        Form D issuers are private companies raising exempt capital, so exchange listing does not apply and industry (SIC) is only present where the issuer has reported one to EDGAR. Filter on those fields narrows to issuers that carry the facet — it will not surface issuers whose filings omit it.
      </p>

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}><Loader2 size={22} className="spinner" style={{ marginBottom: '6px' }} /><div>Searching Form D filings...</div></div>
      ) : searchError ? (
        <div role="alert" style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--status-error)' }}>
          <p>{searchError}</p>
          <button type="button" className="secondary-btn" onClick={() => void handleSearch()} style={{ marginTop: '8px' }}>Retry search</button>
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
          <SearchIntegrityNotice integrity={integrity} resultCount={results.length} />
          <ResultsToolbar data={results} columns={columns} label="exempt offerings" />
          <DataTable columns={columns} data={results} pageSize={25} />
        </>
      ) : searched ? (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>
          <SearchIntegrityNotice integrity={integrity} resultCount={results.length} />
          No Form D filings found. Form D filings carry almost no full text, so search works best by issuer — type a company name and pick it from the suggestions (e.g. Blue Owl Capital), rather than a generic keyword.</div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <TrendingUp size={16} style={{ color: 'var(--status-warning)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Recent Exempt Offerings</h2>
          </div>
          {recentLoading ? (
            <div role="status" style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}><Loader2 size={18} className="spinner" style={{ marginBottom: '6px' }} /><div>Loading recent filings...</div></div>
          ) : recentError ? (
            <div role="alert" style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--status-error)' }}>
              <p>{recentError}</p>
              <button type="button" className="secondary-btn" onClick={() => void loadRecent()} style={{ marginTop: '8px' }}>Retry recent filings</button>
            </div>
          ) : recentItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: '8px' }}>
              {recentItems.map((item, i) => (
                <button key={`${item.accessionNumber}-${i}`} type="button" className="specialist-result-card" style={cardStyle} onClick={() => viewFiling(item)}>
                  <div style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.entityName}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.fileDate}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--accent-primary)', background: 'var(--interactive-hover-strong)', border: '1px solid var(--border-color)', padding: '1px 6px', borderRadius: '4px' }}>{item.formType}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}>No recent Form D or D/A filings were returned.</div>
          )}
        </div>
      )}
    </div>
  );
}
