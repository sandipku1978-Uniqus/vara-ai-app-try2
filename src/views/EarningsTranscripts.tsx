'use client';

import EntitySearchInput from '../components/filters/EntitySearchInput';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import {
  executeFilingResearchSearch,
  matchesDocumentTypePrefixes,
  partitionParentAndExhibitForms,
} from '../services/filingResearch';
import { EARNINGS_SCOPE_DESCRIPTION, EARNINGS_SCOPE_LABEL, EARNINGS_SCOPE_LIMITATION } from '../config/earnings';

interface EarningsRow { entityName: string; fileDate: string; formType: string; documentType: string; cik: string; accessionNumber: string; primaryDocument: string; description: string; }

const cardStyle: React.CSSProperties = { width: '100%', background: 'var(--surface-panel)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '10px 12px', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' };

export default function EarningsTranscripts() {
  const navigate = useRouter();
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters });
  const [results, setResults] = useState<EarningsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentItems, setRecentItems] = useState<EarningsRow[]>([]);
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
        // "Recent" means recent: an unbounded window relevance-ranks 2005-era
        // releases above last week's. Search a rolling window and sort by date.
        const windowStart = new Date();
        windowStart.setDate(windowStart.getDate() - 45);
        const matches = await executeFilingResearchSearch({
          query: 'earnings results',
          filters: { ...defaultSearchFilters, dateFrom: windowStart.toISOString().slice(0, 10) },
          defaultForms: '8-K,8-K/A,6-K',
          limit: 180,
          includeExhibits: true,
        });
        if (cancelled) return;
        setRecentItems(matches
          .filter(match => matchesDocumentTypePrefixes(match.documentType, ['EX-99.1']))
          .sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || ''))
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
          setRecentError('Recent official earnings-release exhibits could not be loaded.');
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }
    void loadRecent();
    return () => { cancelled = true; };
  }, [recentReloadKey]);

  async function handleSearch() {
    setLoading(true); setSearched(true); setSearchError('');
    try {
      const { parentForms, exhibitTypes } = partitionParentAndExhibitForms(
        filters.formTypes,
        ['8-K', '8-K/A', '6-K']
      );
      const requestedExhibits = exhibitTypes.length > 0 ? exhibitTypes : ['EX-99.1'];
      const executionFilters = { ...filters, formTypes: parentForms };
      const matches = await executeFilingResearchSearch({
        query: filters.keyword || 'earnings results',
        filters: executionFilters,
        defaultForms: parentForms.join(','),
        limit: 250,
        includeExhibits: true,
        // Users mostly type company names here — resolve lowercase too
        entityScope: 'aggressive',
      });
      setResults(matches
        .filter(match => matchesDocumentTypePrefixes(match.documentType, requestedExhibits))
        .sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || ''))
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
    } catch (err) { console.error(err); setResults([]); setSearchError('The SEC earnings-release exhibit search failed. Retry the same criteria or narrow the date range.'); }
    finally { setLoading(false); }
  }

  function viewFiling(row: EarningsRow) {
    navigate.push(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`);
  }

  const columns: ColumnDef<EarningsRow>[] = [
    { key: 'fileDate', header: 'Date', sortable: true },
    { key: 'documentType', header: 'Document Type', sortable: true },
    { key: 'formType', header: 'Parent Form', sortable: true },
    { key: 'entityName', header: 'Company', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'accessionNumber', header: 'Filing', render: (row) => {
      const accNum = row.accessionNumber.replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`;
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>View <ExternalLink size={12} /></a>
          <AskCopilotButton compact prompt={`Analyze earnings-release exhibit ${row.documentType} attached to ${row.formType} from ${row.entityName}, filed ${row.fileDate}`} />
        </div>
      );
    }},
  ];

  return (
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '10px' }}>
        <Mic size={22} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>{EARNINGS_SCOPE_LABEL}</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '14px', fontSize: '0.86rem', lineHeight: 1.45 }}>{EARNINGS_SCOPE_DESCRIPTION} {EARNINGS_SCOPE_LIMITATION}</p>

      <form onSubmit={event => { event.preventDefault(); void handleSearch(); }} style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <EntitySearchInput
            value={filters.keyword}
            onChange={text => setFilters({ ...filters, keyword: text })}
            placeholder="Search earnings releases..."
            ariaLabel="Search earnings-release exhibits"
          />
        </div>
        <button type="submit" disabled={loading}
          style={{ padding: '7px 14px', background: 'var(--accent-primary)', color: '#fff', border: '1px solid var(--accent-primary)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </form>

      <SearchFilterBar config={{
        showEntityName: true, showDateRange: true,
        showFormTypes: true, formTypeOptions: ['8-K', '8-K/A', '6-K', 'EX-99.1'],
        showSIC: true, showExchange: true, showAcceleratedStatus: true,
        showAccountant: true, showFiscalYearEnd: true,
        showAccessionNumber: true,
      }} filters={filters} onChange={setFilters} onSearch={handleSearch} loading={loading} />

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}><Loader2 size={22} className="spinner" style={{ marginBottom: '6px' }} /><div>Searching earnings releases...</div></div>
      ) : results.length > 0 ? (
        <>
          <AIResultsSummary
            query={filters.keyword}
            resultsSummary={results.slice(0, 10).map(r => `${r.entityName} - ${r.documentType} attached to ${r.formType} (${r.fileDate})`).join('\n')}
            resultCount={results.length}
            moduleLabel="earnings releases"
            cacheKey={`earnings releases:${filters.keyword}:${results.length}`}
          />
          <ResultsToolbar data={results} columns={columns} label="earnings releases" />
          <DataTable columns={columns} data={results} pageSize={25} />
        </>
      ) : searched ? (
        <div role={searchError ? 'alert' : undefined} style={{ textAlign: 'center', padding: '28px 16px', color: searchError ? 'var(--status-error)' : 'var(--text-muted)' }}>
          <p>{searchError || 'No EX-99.1 earnings-release documents matched these criteria.'}</p>
          {searchError && <button type="button" className="secondary-btn" onClick={() => void handleSearch()}>Retry earnings-release search</button>}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <TrendingUp size={16} style={{ color: 'var(--status-warning)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Recent Earnings Releases</h2>
          </div>
          {recentLoading ? (
            <div role="status" style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}><Loader2 size={18} className="spinner" style={{ marginBottom: '6px' }} /><div>Loading recent releases...</div></div>
          ) : recentError ? (
            <div role="alert" style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--status-error)' }}>
              <p>{recentError}</p>
              <button type="button" className="secondary-btn" onClick={() => setRecentReloadKey(key => key + 1)}>Retry recent official source</button>
            </div>
          ) : recentItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: '8px' }}>
              {recentItems.map((item, i) => (
                <button key={`${item.accessionNumber}-${i}`} type="button" className="specialist-result-card" style={cardStyle} onClick={() => viewFiling(item)}>
                  <div style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.entityName}</div>
                  {item.description && <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.fileDate}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--accent-primary)', background: 'var(--interactive-hover-strong)', border: '1px solid var(--border-color)', padding: '1px 6px', borderRadius: '4px' }}>{item.documentType} · {item.formType}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}>Search for official EX-99.1 earnings-release documents above.</div>
          )}
        </div>
      )}
    </div>
  );
}
