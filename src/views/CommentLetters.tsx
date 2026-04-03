'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Mail, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { executeFilingResearchSearch } from '../services/filingResearch';
import { useApp } from '../context/AppState';

interface LetterRow {
  entityName: string;
  fileDate: string;
  formType: string;
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '12px',
  padding: '16px',
  cursor: 'pointer',
  transition: 'border-color 0.2s',
};

const COMMENT_LETTERS_USE_ELASTICSEARCH = true;

export default function CommentLetters() {
  const navigate = useRouter();
  const { pendingSearchIntent, setPendingSearchIntent, setActiveSearchContext } = useApp();
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters, keyword: '' });
  const [results, setResults] = useState<LetterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentItems, setRecentItems] = useState<LetterRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    async function loadRecent() {
      try {
        const matches = await executeFilingResearchSearch({
          query: 'revenue recognition',
          filters: { ...defaultSearchFilters },
          defaultForms: 'CORRESP,UPLOAD',
          limit: 8,
          useElasticsearch: COMMENT_LETTERS_USE_ELASTICSEARCH,
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
    if (!filters.keyword.trim() && !filters.entityName.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const matches = await executeFilingResearchSearch({
        query: filters.keyword || 'comment',
        filters,
        defaultForms: 'CORRESP,UPLOAD',
        limit: 50,
        useElasticsearch: COMMENT_LETTERS_USE_ELASTICSEARCH,
      });
      setActiveSearchContext({
        surface: 'comment-letters',
        query: filters.keyword || 'comment',
        mode: 'semantic',
        filters,
        results: matches,
        updatedAt: new Date().toISOString(),
      });
      setResults(matches.map(match => ({
        entityName: match.entityName,
        fileDate: match.fileDate,
        formType: match.formType,
        cik: match.cik,
        accessionNumber: match.accessionNumber,
        primaryDocument: match.primaryDocument,
      })));
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!pendingSearchIntent || pendingSearchIntent.surface !== 'comment-letters') return;

    setFilters(prev => ({
      ...prev,
      ...pendingSearchIntent.filters,
      keyword: pendingSearchIntent.query,
    }));

    if (pendingSearchIntent.prefetchedResults) {
      setResults(pendingSearchIntent.prefetchedResults.map(match => ({
        entityName: match.entityName,
        fileDate: match.fileDate,
        formType: match.formType,
        cik: match.cik,
        accessionNumber: match.accessionNumber,
        primaryDocument: match.primaryDocument,
      })));
      setSearched(true);
      setLoading(false);
      setActiveSearchContext({
        surface: 'comment-letters',
        query: pendingSearchIntent.query,
        mode: pendingSearchIntent.mode,
        filters: pendingSearchIntent.filters,
        results: pendingSearchIntent.prefetchedResults,
        updatedAt: new Date().toISOString(),
      });
      setPendingSearchIntent(null);
      return;
    }

    setPendingSearchIntent(null);
  }, [pendingSearchIntent, setActiveSearchContext, setPendingSearchIntent]);

  function viewFiling(row: LetterRow, highlightQuery: string) {
    navigate(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`, {
      state: {
        companyName: row.entityName,
        filingDate: row.fileDate,
        formType: row.formType,
        highlightQuery,
        highlightMode: 'semantic',
        highlightSectionKeywords: filters.sectionKeywords,
      },
    });
  }

  const columns: ColumnDef<LetterRow>[] = [
    { key: 'fileDate', header: 'Date', sortable: true },
    { key: 'formType', header: 'Form', sortable: true },
    { key: 'entityName', header: 'Company', sortable: true },
    {
      key: 'accessionNumber', header: 'Filing', render: (row) => {
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={event => {
                event.stopPropagation();
                viewFiling(row, filters.keyword.trim() || 'comment');
              }}
              style={{ color: '#D66CAE', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              View <ExternalLink size={12} />
            </button>
            <AskCopilotButton compact prompt={`Analyze the ${row.formType} filing from ${row.entityName} filed ${row.fileDate}`} />
          </div>
        );
      }
    },
  ];

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <Mail size={28} style={{ color: '#D66CAE' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>Comment Letters</h1>
      </div>
      <p style={{ color: '#94A3B8', marginBottom: '24px', fontSize: '0.9rem' }}>
        Search SEC staff comment letters (CORRESP, UPLOAD) from EDGAR full-text search.
      </p>

      {/* Search bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <input value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} placeholder="e.g. revenue recognition"
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'white', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <button onClick={handleSearch} disabled={loading}
          style={{ padding: '8px 20px', background: '#B31F7E', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </div>

      {/* Filter bar */}
      <SearchFilterBar
        config={{
          showEntityName: true, showDateRange: true,
          showSectionKeywords: true,
          showSIC: true, showExchange: true, showAcceleratedStatus: true,
          showAccountant: true, showStateOfInc: true,
          showAccessionNumber: true, showFileNumber: true,
          showFiscalYearEnd: true,
        }}
        filters={filters}
        onChange={setFilters}
        onSearch={handleSearch}
        loading={loading}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>
          <Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} />
          <div>Searching comment letters...</div>
        </div>
      ) : results.length > 0 ? (
        <>
          <AIResultsSummary
            query={filters.keyword}
            resultsSummary={results.slice(0, 10).map(r => `${r.entityName} - ${r.formType} (${r.fileDate})`).join('\n')}
            resultCount={results.length}
            moduleLabel="comment letters"
            cacheKey={`comment letters:${filters.keyword}:${results.length}`}
          />
          <ResultsToolbar data={results} columns={columns} label="comment letters" />
          <DataTable
            columns={columns}
            data={results}
            pageSize={25}
            onRowClick={row => viewFiling(row, filters.keyword.trim() || 'comment')}
          />
        </>
      ) : searched ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>No comment letters found.</div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={18} style={{ color: '#F59E0B' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'white' }}>Recent Comment Letters — Revenue Recognition</h2>
          </div>
          {recentLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#64748B' }}>
              <Loader2 size={20} className="spinner" style={{ marginBottom: '8px' }} /><div>Loading recent filings...</div>
            </div>
          ) : recentItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {recentItems.map((item, i) => (
                <div key={i} style={cardStyle} onClick={() => viewFiling(item, 'revenue recognition')}
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
            <div style={{ textAlign: 'center', padding: '32px', color: '#64748B' }}>Enter a search query to find SEC comment letters.</div>
          )}
        </div>
      )}
    </div>
  );
}

