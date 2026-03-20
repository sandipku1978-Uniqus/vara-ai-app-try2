import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BellRing, Building2, FileText, Filter, Hash, Loader2, MessageSquare, Search, Sparkles } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import SearchFilterBar, { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';
import { aiSummarize } from '../services/aiApi';
import {
  buildSearchTrendSummary,
  executeFilingResearchSearch,
  type FilingResearchResult,
  type ResearchSearchMode,
} from '../services/filingResearch';
import { fetchCompanySubmissions, lookupCIK } from '../services/secApi';
import { useApp } from '../context/AppState';
import { interpretSearchPrompt } from '../services/searchAssist';
import './SearchPage.css';

const DEFAULT_FORM_SCOPE = '10-K,10-Q,8-K,DEF 14A,20-F,S-1';
const SAMPLE_SEARCHES = [
  'ASC 842 adoption w/10 lease',
  'ASR w/5 derivative',
  'Temporary equity in last 3 years in 10-Q / 10-K audited by Deloitte',
  '"material weakness" AND cybersecurity',
  'I am trying to search for companies that had bifurcated derivatives in accelerated share repurchase agreements in last 5 years',
];

const NAME_TO_TICKER: Record<string, string> = {
  'APPLE': 'AAPL', 'AAPL': 'AAPL',
  'MICROSOFT': 'MSFT', 'MSFT': 'MSFT',
  'GOOGLE': 'GOOGL', 'ALPHABET': 'GOOGL', 'GOOGL': 'GOOGL',
  'TESLA': 'TSLA', 'TSLA': 'TSLA',
  'AMAZON': 'AMZN', 'AMZN': 'AMZN',
  'NVIDIA': 'NVDA', 'NVDA': 'NVDA',
  'META': 'META', 'FACEBOOK': 'META',
  'JPMORGAN': 'JPM', 'JPM': 'JPM', 'JP MORGAN': 'JPM',
};

async function resolveEntityHint(rawQuery: string): Promise<{ entityName: string; query: string }> {
  const upper = rawQuery.toUpperCase().trim();
  const words = upper.split(/\s+/);

  let ticker: string | null = null;
  let remaining = rawQuery.trim();

  if (NAME_TO_TICKER[words[0]]) {
    ticker = NAME_TO_TICKER[words[0]];
    remaining = rawQuery.trim().split(/\s+/).slice(1).join(' ');
  } else {
    for (const [name, mappedTicker] of Object.entries(NAME_TO_TICKER)) {
      if (upper.includes(name)) {
        ticker = mappedTicker;
        remaining = rawQuery.replace(new RegExp(name, 'i'), '').trim();
        break;
      }
    }
  }

  if (!ticker) {
    return { entityName: '', query: rawQuery.trim() };
  }

  const cik = await lookupCIK(ticker);
  if (!cik) {
    return { entityName: ticker, query: remaining || rawQuery.trim() };
  }

  const company = await fetchCompanySubmissions(cik);
  return {
    entityName: company?.name || ticker,
    query: remaining || rawQuery.trim(),
  };
}

function buildAlertName(query: string, filters: SearchFilters): string {
  if (query.trim()) return query.trim();
  if (filters.entityName.trim()) return `${filters.entityName.trim()} research`;
  if (filters.sicCode.trim()) return `SIC ${filters.sicCode.trim()} trend`;
  return 'Custom research alert';
}

export default function SearchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const {
    addSavedAlert,
    savedAlerts,
    pendingSearchIntent,
    setPendingSearchIntent,
    setActiveSearchContext,
    setChatOpen,
  } = useApp();

  const [query, setQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<ResearchSearchMode>('semantic');
  const [filters, setFilters] = useState<SearchFilters>({
    ...defaultSearchFilters,
    formTypes: ['10-K', '10-Q'],
  });
  const [results, setResults] = useState<FilingResearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [trendReport, setTrendReport] = useState('');
  const [trendLoading, setTrendLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [searchInterpretation, setSearchInterpretation] = useState<string[]>([]);
  const [lastResolvedSearch, setLastResolvedSearch] = useState<{
    query: string;
    mode: ResearchSearchMode;
    filters: SearchFilters;
  }>({
    query: initialQuery,
    mode: 'semantic',
    filters: {
      ...defaultSearchFilters,
      formTypes: ['10-K', '10-Q'],
    },
  });

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      void handleSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  useEffect(() => {
    const alertId = (location.state as { alertId?: string } | null)?.alertId;
    if (!alertId) return;
    const alert = savedAlerts.find(item => item.id === alertId);
    if (!alert) return;

    setQuery(alert.query);
    setSearchMode(alert.mode);
    setFilters(alert.filters);
    void handleSearch(alert.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, savedAlerts]);

  const metrics = useMemo(() => {
    const companies = new Set(results.map(result => result.entityName)).size;
    const auditors = results.reduce<Record<string, number>>((acc, result) => {
      const key = result.auditor || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const topAuditor = Object.entries(auditors).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
    const forms = results.reduce<Record<string, number>>((acc, result) => {
      acc[result.formType] = (acc[result.formType] || 0) + 1;
      return acc;
    }, {});
    const topForm = Object.entries(forms).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    return { companies, topAuditor, topForm };
  }, [results]);

  const handleSearch = useCallback(async (searchQuery = query, overrideFilters = filters, overrideMode = searchMode) => {
    const trimmed = searchQuery.trim();
    const interpreted =
      overrideMode === 'semantic' && trimmed
        ? interpretSearchPrompt(trimmed, overrideFilters)
        : {
            query: trimmed,
            filters: {
              ...overrideFilters,
              formTypes: [...overrideFilters.formTypes],
              exchange: [...overrideFilters.exchange],
              acceleratedStatus: [...overrideFilters.acceleratedStatus],
            },
            appliedHints: [] as string[],
          };

    if (
      !trimmed &&
      !interpreted.filters.entityName.trim() &&
      !interpreted.filters.sectionKeywords.trim() &&
      !interpreted.filters.accessionNumber.trim() &&
      !interpreted.filters.fileNumber.trim()
    ) {
      return;
    }

    setSearchInterpretation(interpreted.appliedHints);
    setLoading(true);
    setSearched(true);
    setErrorMsg('');
    setAlertMessage('');
    setTrendReport('');

    try {
      let effectiveQuery = interpreted.query || trimmed;
      let effectiveFilters = interpreted.filters;

      if (!effectiveFilters.entityName.trim() && effectiveQuery) {
        const hint = await resolveEntityHint(effectiveQuery);
        if (hint.entityName) {
          effectiveFilters = { ...effectiveFilters, entityName: hint.entityName };
          effectiveQuery = hint.query;
        }
      }

      const matches = await executeFilingResearchSearch({
        query: effectiveQuery || trimmed,
        filters: effectiveFilters,
        mode: overrideMode,
        defaultForms: DEFAULT_FORM_SCOPE,
        limit: 50,
        hydrateTextSignals: true,
      });

      setResults(matches);
      setLastResolvedSearch({
        query: effectiveQuery || trimmed,
        mode: overrideMode,
        filters: effectiveFilters,
      });
      setActiveSearchContext({
        surface: 'research',
        query: effectiveQuery || trimmed,
        mode: overrideMode,
        filters: effectiveFilters,
        results: matches,
        updatedAt: new Date().toISOString(),
      });
      if (matches.length === 0) {
        setErrorMsg('No filings matched that search. Try widening the date range, removing an auditor filter, or broadening the Boolean expression.');
      }
    } catch (error) {
      console.error('Research search failed:', error);
      setResults([]);
      setErrorMsg('Research search failed. Check the SEC proxy path or try a narrower query.');
    } finally {
      setLoading(false);
    }
  }, [filters, query, searchMode, setActiveSearchContext]);

  useEffect(() => {
    if (!pendingSearchIntent || pendingSearchIntent.surface !== 'research') return;

    setQuery(pendingSearchIntent.query);
    setSearchMode(pendingSearchIntent.mode);
    setFilters(pendingSearchIntent.filters);

    if (pendingSearchIntent.prefetchedResults) {
      setResults(pendingSearchIntent.prefetchedResults);
      setSearched(true);
      setLoading(false);
      setLastResolvedSearch({
        query: pendingSearchIntent.query,
        mode: pendingSearchIntent.mode,
        filters: pendingSearchIntent.filters,
      });
      setErrorMsg(
        pendingSearchIntent.prefetchedResults.length === 0
          ? 'No filings matched that search. Try widening the date range, removing an auditor filter, or broadening the Boolean expression.'
          : ''
      );
      setActiveSearchContext({
        surface: 'research',
        query: pendingSearchIntent.query,
        mode: pendingSearchIntent.mode,
        filters: pendingSearchIntent.filters,
        results: pendingSearchIntent.prefetchedResults,
        updatedAt: new Date().toISOString(),
      });
      setPendingSearchIntent(null);
      return;
    }

    void handleSearch(pendingSearchIntent.query, pendingSearchIntent.filters, pendingSearchIntent.mode);
    setPendingSearchIntent(null);
  }, [handleSearch, pendingSearchIntent, setActiveSearchContext, setPendingSearchIntent]);

  const buildFilingRouteState = useCallback((row: FilingResearchResult) => ({
    companyName: row.entityName,
    filingDate: row.fileDate,
    formType: row.formType,
    fileNumber: row.fileNumber,
    auditor: row.auditor,
    highlightQuery: lastResolvedSearch.query,
    highlightMode: lastResolvedSearch.mode,
    highlightSectionKeywords: lastResolvedSearch.filters.sectionKeywords,
  }), [lastResolvedSearch]);

  async function handleTrendReport() {
    if (results.length === 0) return;

    setTrendLoading(true);
    try {
      const statsSummary = await buildSearchTrendSummary(results.slice(0, 20), query, filters);
      const aiResponse = await aiSummarize(
        `You are an SEC accounting research analyst. Create a concise market trend report from this filing search dataset.\n\n${statsSummary}\n\nTop results:\n${results
          .slice(0, 12)
          .map(result => `- ${result.fileDate} | ${result.entityName} | ${result.formType} | ${result.description || 'No description'} | Auditor: ${result.auditor || 'Unknown'} | SIC: ${result.sicDescription || result.sic || 'Unknown'}`)
          .join('\n')}\n\nProvide a short report with: overall trend, what peers appear to be doing, and what to investigate next.`
      );

      if (
        !aiResponse ||
        aiResponse.toLowerCase().includes('api key missing') ||
        aiResponse.toLowerCase().includes('summary unavailable')
      ) {
        setTrendReport(statsSummary);
      } else {
        setTrendReport(aiResponse);
      }
    } catch (error) {
      console.error('Trend report error:', error);
      setTrendReport(await buildSearchTrendSummary(results.slice(0, 20), query, filters));
    } finally {
      setTrendLoading(false);
    }
  }

  function handleCreateAlert() {
    if (!query.trim() && !filters.entityName.trim()) return;

    addSavedAlert({
      name: buildAlertName(query, filters),
      query,
      mode: searchMode,
      filters,
      defaultForms: DEFAULT_FORM_SCOPE,
      lastSeenAccessions: results.map(result => result.accessionNumber),
      latestNewAccessions: [],
      latestResultCount: results.length,
    });
    setAlertMessage('Alert saved locally. It will show up in the dashboard alert center and can be checked for new filings.');
  }

  const columns: ColumnDef<FilingResearchResult>[] = [
    { key: 'fileDate', header: 'Date', sortable: true, width: '110px' },
    { key: 'formType', header: 'Form', sortable: true, width: '90px' },
    { key: 'entityName', header: 'Company', sortable: true, width: '190px' },
    { key: 'auditor', header: 'Auditor', sortable: true, width: '120px' },
    { key: 'sicDescription', header: 'Industry', sortable: true, width: '180px' },
    { key: 'acceleratedStatus', header: 'Filer Status', sortable: true, width: '170px' },
    {
      key: 'description',
      header: 'Why It Matched',
      render: row => row.description || row.primaryDocument || 'Matched on filing metadata',
    },
    {
      key: 'accessionNumber',
      header: 'Open',
      width: '120px',
      render: row => (
        <button
          className="secondary-btn"
          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
          onClick={event => {
            event.stopPropagation();
            navigate(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`, {
              state: buildFilingRouteState(row),
            });
          }}
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div style={{ padding: '32px', maxWidth: '1320px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.7rem', fontWeight: 700, color: 'white', marginBottom: '6px' }}>Research Workbench</h1>
          <p style={{ color: '#94A3B8', maxWidth: '880px' }}>
            Search across filings, filter by auditor or industry, run pointed Boolean queries like <code>ASR w/5 derivative</code>, and save curated alerts for new filings.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="secondary-btn" onClick={handleCreateAlert} disabled={!query.trim() && !filters.entityName.trim()}>
            <BellRing size={16} /> Save Alert
          </button>
          <button className="primary-btn" onClick={handleTrendReport} disabled={results.length === 0 || trendLoading}>
            {trendLoading ? <Loader2 size={16} className="spinner" /> : <Sparkles size={16} />} Trend Report
          </button>
        </div>
      </div>

      <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '14px 16px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(14,165,233,0.06))',
            border: '1px solid rgba(96,165,250,0.2)',
          }}
        >
          <div>
            <div style={{ color: '#DBEAFE', fontSize: '0.86rem', fontWeight: 700, marginBottom: '4px' }}>Natural-language search is on</div>
            <div style={{ color: '#BFDBFE', fontSize: '0.82rem', maxWidth: '760px' }}>
              Type plain English and Vara will pull out forms, date windows, and auditors before searching EDGAR.
            </div>
          </div>
          <button className="secondary-btn" onClick={() => setChatOpen(true)}>
            <MessageSquare size={16} /> Ask Vara Copilot
          </button>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`toggle-btn ${searchMode === 'semantic' ? 'active' : ''}`}
              onClick={() => setSearchMode('semantic')}
            >
              <Sparkles size={16} /> Filing Research
            </button>
            <button
              className={`toggle-btn ${searchMode === 'boolean' ? 'active' : ''}`}
              onClick={() => setSearchMode('boolean')}
            >
              <Hash size={16} /> Boolean / Proximity
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94A3B8', fontSize: '0.8rem' }}>
            <Filter size={14} />
            Works best with 10-K / 10-Q / 8-K / DEF 14A
          </div>
        </div>

        <form
          className="search-bar-container glass-card"
          onSubmit={event => {
            event.preventDefault();
            navigate(`/search?q=${encodeURIComponent(query)}`);
            void handleSearch(query);
          }}
        >
          <Search className="search-icon" size={20} />
          <input
            type="text"
            placeholder={
              searchMode === 'semantic'
                ? 'Describe the issue you want to research (e.g. lease concessions, ASU adoption, cybersecurity comments)...'
                : 'Example: ASR w/5 derivative OR "accelerated share repurchase"'
            }
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <button type="submit" className="primary-btn shrink-0 ml-2" disabled={loading}>
            {loading ? <Loader2 size={16} className="spinner" /> : 'Search'}
          </button>
        </form>

        {searchInterpretation.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {searchInterpretation.map(item => (
              <span
                key={item}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: 'rgba(96,165,250,0.12)',
                  border: '1px solid rgba(96,165,250,0.24)',
                  color: '#BFDBFE',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        )}

        <SearchFilterBar
          config={{
            showEntityName: true,
            showDateRange: true,
            showFormTypes: true,
            formTypeOptions: ['10-K', '10-Q', '8-K', 'DEF 14A', '20-F', '6-K', 'S-1', '8-K/A'],
            showSectionKeywords: true,
            showSIC: true,
            showStateOfInc: true,
            showHeadquarters: true,
            showExchange: true,
            showAcceleratedStatus: true,
            showAccountant: true,
            showAccessionNumber: true,
            showFileNumber: true,
            showFiscalYearEnd: true,
          }}
          filters={filters}
          onChange={setFilters}
          onSearch={() => void handleSearch(query)}
          loading={loading}
        />

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {SAMPLE_SEARCHES.map(sample => (
            <button
              key={sample}
              className="sample-pill"
              onClick={() => {
                setQuery(sample);
                navigate(`/search?q=${encodeURIComponent(sample)}`);
                void handleSearch(sample);
              }}
            >
              {sample}
            </button>
          ))}
        </div>

        {searchMode === 'boolean' && (
          <div style={{ padding: '14px 16px', borderRadius: '12px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#BFDBFE', fontSize: '0.84rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
              <div style={{ fontWeight: 700 }}>Boolean / Proximity Guide</div>
              <button
                type="button"
                onClick={() => navigate('/support')}
                style={{ background: 'none', border: 'none', color: '#93C5FD', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
              >
                Open full help
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              {[
                { operator: 'AND', meaning: 'Both terms must appear', example: 'temporary AND equity' },
                { operator: 'OR', meaning: 'Either term can appear', example: 'ASR OR repurchase' },
                { operator: 'NOT', meaning: 'Exclude a term', example: 'equity NOT mezzanine' },
                { operator: '"phrase"', meaning: 'Match exact wording', example: '"accelerated share repurchase"' },
                { operator: 'w/#', meaning: 'Terms near each other', example: 'ASR w/5 derivative' },
              ].map(item => (
                <div key={item.operator} style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(15,23,42,0.45)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ color: 'white', fontWeight: 700, marginBottom: '4px' }}>{item.operator}</div>
                  <div style={{ color: '#BFDBFE', fontSize: '0.78rem', marginBottom: '4px' }}>{item.meaning}</div>
                  <code style={{ color: '#93C5FD', fontSize: '0.76rem' }}>{item.example}</code>
                </div>
              ))}
            </div>
          </div>
        )}

        {alertMessage && (
          <div style={{ color: '#4ADE80', fontSize: '0.85rem' }}>{alertMessage}</div>
        )}
      </div>

      {results.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          {[
            { label: 'Matched Filings', value: results.length.toString(), icon: <FileText size={18} /> },
            { label: 'Issuers', value: metrics.companies.toString(), icon: <Building2 size={18} /> },
            { label: 'Top Form', value: metrics.topForm, icon: <Hash size={18} /> },
            { label: 'Top Auditor', value: metrics.topAuditor, icon: <BellRing size={18} /> },
          ].map(card => (
            <div key={card.label} className="glass-card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#60A5FA', marginBottom: '8px' }}>{card.icon}{card.label}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'white' }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {trendReport && (
        <div className="glass-card" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Sparkles size={18} className="text-blue" />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'white' }}>Trend Report</h2>
          </div>
          <div className="md-content" style={{ color: '#CBD5E1' }}>
            {trendReport.split('\n').map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="glass-card" style={{ padding: '48px', textAlign: 'center', color: '#64748B' }}>
          <Loader2 size={28} className="spinner" style={{ marginBottom: '10px' }} />
          <div>Searching EDGAR and hydrating filer metadata...</div>
        </div>
      ) : results.length > 0 ? (
        <DataTable
          columns={columns}
          data={results}
          pageSize={20}
          onRowClick={row => navigate(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`, {
            state: buildFilingRouteState(row),
          })}
        />
      ) : searched ? (
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
          {errorMsg || 'No filings matched your search.'}
        </div>
      ) : (
        <div className="glass-card" style={{ padding: '40px', color: '#94A3B8' }}>
          <p style={{ marginBottom: '10px' }}>Use this page for the workflows like:</p>
          <ul style={{ paddingLeft: '20px', lineHeight: 1.8 }}>
            <li>Cross-company accounting policy research</li>
            <li>Peer benchmarking by SIC, auditor, or filer status</li>
            <li>Pointed Boolean / proximity searches like <code>ASR w/5 derivative</code></li>
            <li>Saved alerts for recurring issues, issuers, or filing cohorts</li>
          </ul>
        </div>
      )}
    </div>
  );
}
