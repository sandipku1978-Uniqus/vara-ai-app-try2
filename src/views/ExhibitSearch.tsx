'use client';

import EntitySearchInput from '../components/filters/EntitySearchInput';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FileSearch, Search, Loader2, ExternalLink, TrendingUp } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import SearchFilterBar, { type SearchFilters, defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { executeFilingResearchSearch, matchesDocumentTypePrefixes } from '../services/filingResearch';
import SearchIntegrityNotice, { useSearchIntegrity } from '../components/research/SearchIntegrityNotice';

interface ExhibitRow { entityName: string; fileDate: string; formType: string; documentType: string; cik: string; accessionNumber: string; primaryDocument: string; description: string; }

const EXHIBIT_TYPES = [
  { value: 'EX-2.1', label: 'Merger Agreement (EX-2.1)' },
  { value: 'EX-10', label: 'Material Contract (EX-10.x)' },
  { value: 'EX-21', label: 'Subsidiaries (EX-21)' },
  { value: 'EX-23', label: 'Consents (EX-23)' },
  { value: 'EX-99', label: 'Press Release (EX-99.x)' },
  { value: 'EX-4', label: 'Instruments (EX-4.x)' },
];

const cardStyle: React.CSSProperties = { width: '100%', background: 'var(--surface-panel)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '10px 12px', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' };

export default function ExhibitSearch() {
  const navigate = useRouter();
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters });
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  // Hold the full fetched set; the displayed rows derive from it, so toggling
  // an exhibit-type chip re-filters instantly without re-fetching.
  const [rawResults, setRawResults] = useState<ExhibitRow[]>([]);
  const results = useMemo(
    () => rawResults.filter(row => matchesDocumentTypePrefixes(row.documentType, selectedTypes)).slice(0, 50),
    [rawResults, selectedTypes]
  );
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentItems, setRecentItems] = useState<ExhibitRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [recentError, setRecentError] = useState('');
  const [recentReloadKey, setRecentReloadKey] = useState(0);
  const integrity = useSearchIntegrity();

  useEffect(() => {
    let cancelled = false;
    async function loadRecent() {
      setRecentLoading(true);
      setRecentError('');
      try {
        // "Recent" means recent: bound the window and sort by date, or the
        // relevance ranking surfaces years-old agreements first.
        const windowStart = new Date();
        windowStart.setDate(windowStart.getDate() - 60);
        const matches = await executeFilingResearchSearch({
          query: '',
          filters: { ...defaultSearchFilters, dateFrom: windowStart.toISOString().slice(0, 10) },
          defaultForms: '10-K,10-K/A,8-K,S-1,S-4,DEFM14A,425',
          limit: 160,
          includeExhibits: true,
        });
        if (cancelled) return;
        setRecentItems(matches
          .filter(match => matchesDocumentTypePrefixes(match.documentType, ['EX-2.1', 'EX-10']))
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

  // Deal documents (merger proxies, S-4s, 425s, tender offers) carry the
  // acquisition agreements users search for — they must be in scope.
  const EXHIBIT_SEARCH_FORMS = '10-K,10-K/A,8-K,8-K/A,S-1,S-1/A,DEF 14A,DEFM14A,S-4,S-4/A,425,SC TO-T,SC 13D';

  async function handleSearch() {
    setLoading(true); setSearched(true); setSearchError('');
    integrity.reset();
    try {
      const searchPass = (dateFrom?: string) => executeFilingResearchSearch({
        query: filters.keyword,
        filters: dateFrom && !filters.dateFrom ? { ...filters, dateFrom } : filters,
        defaultForms: EXHIBIT_SEARCH_FORMS,
        limit: 250,
        includeExhibits: true,
        // The exhibits box is predominantly a company filter ("Organon",
        // "sun pharma") — resolve lowercase names/tickers to issuer scope
        entityScope: 'aggressive',
        ...integrity.callbacks,
      });

      // Recency-first collection: EFTS ranks by relevance, so a full-history
      // pass lets strong old matches crowd out this year's deal documents.
      // Search the trailing 24 months first, then widen to full history and
      // merge, so both the latest agreements and the archive surface.
      const windowStart = new Date();
      windowStart.setMonth(windowStart.getMonth() - 24);
      const recentPass = await searchPass(windowStart.toISOString().slice(0, 10));
      const fullPass = filters.dateFrom ? [] : await searchPass(undefined);
      const seen = new Set<string>();
      const matches = [...recentPass, ...fullPass].filter(match => {
        const key = `${match.accessionNumber}:${match.documentType}:${match.description}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Store all exhibit rows (every type); the chip filter is applied to the
      // derived `results`, so chips re-filter without another EFTS round-trip.
      setRawResults(matches
        .filter(match => matchesDocumentTypePrefixes(match.documentType, []))
        .sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || ''))
        .slice(0, 200)
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
    } catch (err) { console.error(err); setRawResults([]); setSearchError('The SEC exhibit search failed. Retry the same criteria or narrow the date range.'); }
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
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '10px' }}>
        <FileSearch size={22} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>Exhibits & Agreements</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '0.86rem', lineHeight: 1.45 }}>Search SEC filing exhibits — merger agreements, material contracts, subsidiaries lists, and more.</p>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {EXHIBIT_TYPES.map(et => (
          <button key={et.value} type="button" aria-pressed={selectedTypes.includes(et.value)} onClick={() => toggleType(et.value)}
            style={{
              padding: '3px 9px', borderRadius: '4px', border: '1px solid',
              borderColor: selectedTypes.includes(et.value) ? 'var(--accent-primary)' : 'var(--border-color)',
              background: selectedTypes.includes(et.value) ? 'var(--interactive-hover-strong)' : 'var(--surface-panel)',
              color: selectedTypes.includes(et.value) ? 'var(--accent-primary)' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '0.76rem'
            }}>
            {et.label}
          </button>
        ))}
      </div>

      <form onSubmit={event => { event.preventDefault(); void handleSearch(); }} style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <EntitySearchInput
            value={filters.keyword}
            onChange={text => setFilters({ ...filters, keyword: text })}
            placeholder="Search exhibits..."
            ariaLabel="Search exhibits"
          />
        </div>
        <button type="submit" disabled={loading}
          style={{ padding: '7px 14px', background: 'var(--accent-primary)', color: '#fff', border: '1px solid var(--accent-primary)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </form>

      <SearchFilterBar config={{
        showEntityName: true, showDateRange: true,
        showSIC: true, showExchange: true, showAcceleratedStatus: true,
        showStateOfInc: true, showAccountant: true,
        showAccessionNumber: true, showFileNumber: true,
      }} filters={filters} onChange={setFilters} onSearch={handleSearch} loading={loading} />

      {!loading && searched && <SearchIntegrityNotice integrity={integrity} resultCount={results.length} />}
      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}><Loader2 size={22} className="spinner" style={{ marginBottom: '6px' }} /><div>Searching exhibits...</div></div>
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
        <div role={searchError ? 'alert' : undefined} style={{ textAlign: 'center', padding: '28px 16px', color: searchError ? 'var(--status-error)' : 'var(--text-muted)' }}>
          {/* The type chips filter the COLLECTED window client-side. When the
              search found documents but none carry the selected exhibit type,
              blaming "these criteria" misattributes a chip miss to SEC. */}
          <p>{searchError || (rawResults.length > 0 && selectedTypes.length > 0
            ? `None of the ${rawResults.length} collected documents carry the selected exhibit type${selectedTypes.length === 1 ? '' : 's'} (${selectedTypes.join(', ')}). The chips filter collected results — clear them or refine the search to collect more.`
            : 'No exhibit documents matched these criteria.')}</p>
          {searchError && <button type="button" className="secondary-btn" onClick={() => void handleSearch()}>Retry exhibit search</button>}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
            <TrendingUp size={16} style={{ color: 'var(--status-warning)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Recent Merger Agreements & Material Contracts</h2>
          </div>
          {recentLoading ? (
            <div role="status" style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}><Loader2 size={18} className="spinner" style={{ marginBottom: '6px' }} /><div>Loading recent exhibits...</div></div>
          ) : recentError ? (
            <div role="alert" style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--status-error)' }}>
              <p>{recentError}</p>
              <button type="button" className="secondary-btn" onClick={() => setRecentReloadKey(key => key + 1)}>Retry recent SEC exhibits</button>
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
            <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}>Search for SEC filing exhibits above.</div>
          )}
        </div>
      )}
    </div>
  );
}
