import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BellRing, Building2, FileText, Filter, Hash, Loader2, Search, Sparkles } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import SearchFilterBar, { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';
import { aiSummarize } from '../services/geminiApi';
import {
  buildSearchTrendSummary,
  executeFilingResearchSearch,
  type FilingResearchResult,
  type ResearchSearchMode,
} from '../services/filingResearch';
import { fetchCompanySubmissions, lookupCIK } from '../services/secApi';
import { useApp } from '../context/AppState';
import './SearchPage.css';

const DEFAULT_FORM_SCOPE = '10-K,10-Q,8-K,DEF 14A,20-F,S-1';
const SAMPLE_SEARCHES = [
  'ASC 842 adoption w/10 lease',
  'ASR w/5 derivative',
  '"material weakness" AND cybersecurity',
  'revenue recognition AND "performance obligation"',
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
  const { addSavedAlert, savedAlerts } = useApp();

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

  async function handleSearch(searchQuery = query) {
    const trimmed = searchQuery.trim();
    if (!trimmed && !filters.entityName.trim()) return;

    setLoading(true);
    setSearched(true);
    setErrorMsg('');
    setAlertMessage('');
    setTrendReport('');

    try {
      let effectiveQuery = trimmed;
      let effectiveFilters = { ...filters };

      if (!effectiveFilters.entityName.trim() && trimmed) {
        const hint = await resolveEntityHint(trimmed);
        if (hint.entityName) {
          effectiveFilters = { ...effectiveFilters, entityName: hint.entityName };
          effectiveQuery = hint.query;
        }
      }

      const matches = await executeFilingResearchSearch({
        query: effectiveQuery || trimmed,
        filters: effectiveFilters,
        mode: searchMode,
        defaultForms: DEFAULT_FORM_SCOPE,
        limit: 50,
        hydrateTextSignals: true,
      });

      setResults(matches);
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
  }

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
              state: {
                companyName: row.entityName,
                filingDate: row.fileDate,
                formType: row.formType,
                fileNumber: row.fileNumber,
                auditor: row.auditor,
              },
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
          <div style={{ padding: '12px 14px', borderRadius: '10px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#BFDBFE', fontSize: '0.84rem' }}>
            Supported operators: <code>AND</code>, <code>OR</code>, <code>NOT</code>, quotes for exact phrases, and proximity using <code>w/#</code>, <code>near/#</code>, or <code>within/#</code>.
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
            state: {
              companyName: row.entityName,
              filingDate: row.fileDate,
              formType: row.formType,
              fileNumber: row.fileNumber,
              auditor: row.auditor,
            },
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
