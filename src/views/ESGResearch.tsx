'use client';


import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Globe, LayoutGrid, FileAudio, Search, Target, Activity, ChevronRight, BarChart3, Loader2, ExternalLink } from 'lucide-react';
import { lookupCIK, fetchCompanySubmissions, findLatestFiling, fetchFilingText, searchEdgarFilings } from '../services/secApi';
import { aiRateESGDisclosure, aiSummarize } from '../services/aiApi';
import { selectFilingText } from '../utils/filingTextSelection';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import './ESGResearch.css';

const frameworks = [
  { id: 'sasb', name: 'SASB Standards', desc: 'Industry-specific sustainability disclosures.', url: 'https://sasb.ifrs.org/standards/' },
  { id: 'gri', name: 'GRI Standards', desc: 'Global standards for sustainability impacts.', url: 'https://www.globalreporting.org/standards/' },
  { id: 'esrs', name: 'ESRS (CSRD)', desc: 'European Sustainability Reporting Standards.', url: 'https://www.efrag.org/lab6' },
  { id: 'tcfd', name: 'TCFD', desc: 'Climate-related financial disclosures.', url: 'https://www.fsb-tcfd.org/' },
];

const POLICY_SOURCES = [
  {
    name: 'SEC climate rulemaking',
    authority: 'U.S. Securities and Exchange Commission',
    url: 'https://www.sec.gov/rules-regulations/rulemaking-activity',
  },
  {
    name: 'Corporate Sustainability Reporting Directive',
    authority: 'European Commission',
    url: 'https://finance.ec.europa.eu/capital-markets-union-and-financial-markets/company-reporting-and-auditing/company-reporting/corporate-sustainability-reporting_en',
  },
  {
    name: 'California climate disclosure program',
    authority: 'California Air Resources Board',
    url: 'https://ww2.arb.ca.gov/our-work/programs/california-corporate-climate-data-accountability-act',
  },
] as const;

const DEFAULT_ESG_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'META'];
const ESG_TOPICS = [
  'GHG Emissions (Scope 1 & 2)',
  'Scope 3 Emissions',
  'Data Privacy & Security',
  'Diversity & Inclusion',
  'Energy Management',
  'Supply Chain Labor',
];

interface HeatmapRow {
  topic: string;
  [ticker: string]: string; // 'high' | 'medium' | 'low'
}

interface EarningsRelease {
  id: string;
  date: string;
  company: string;
  title: string;
  summary: string;
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  summaryStatus: 'idle' | 'loading' | 'ready' | 'error';
  summaryError: string;
  sourceLength?: number;
  selectedLength?: number;
  selectionComplete?: boolean;
}

// Module-level cache (used by the component)

export default function ESGResearch() {
  const [activeTab, setActiveTab] = useState<'frameworks' | 'heatmap' | 'transcripts'>('frameworks');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null);

  // User-managed ticker list for heatmap
  const [esgTickers, setEsgTickers] = useState<string[]>(DEFAULT_ESG_TICKERS);

  // Heatmap state
  const [heatmapData, setHeatmapData] = useState<HeatmapRow[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState('');
  const [heatmapTickerSnapshot, setHeatmapTickerSnapshot] = useState<string[]>([]);
  const [heatmapCoverage, setHeatmapCoverage] = useState({ analyzed: 0, total: 0 });
  const [heatmapRetryToken, setHeatmapRetryToken] = useState(0);
  const heatmapAttemptKeyRef = useRef('');
  const activeHeatmapRequestRef = useRef('');

  // Earnings releases state
  const [earningsReleases, setEarningsReleases] = useState<EarningsRelease[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState('');
  const [earningsRetryToken, setEarningsRetryToken] = useState(0);
  const earningsAttemptedRef = useRef(false);

  const addEsgTicker = useCallback((ticker: string) => {
    setEsgTickers(prev => prev.includes(ticker.toUpperCase()) ? prev : [...prev, ticker.toUpperCase()]);
  }, []);

  const removeEsgTicker = useCallback((ticker: string) => {
    setEsgTickers(prev => prev.filter(t => t !== ticker));
  }, []);

  // Regenerate heatmap when tickers change or tab is activated
  const canonicalTickers = useMemo(() => [...new Set(esgTickers.map(ticker => ticker.toUpperCase()))].sort(), [esgTickers]);
  const tickerKey = canonicalTickers.join(',');

  // Load heatmap data via AI analysis of 10-K filings
  useEffect(() => {
    if (activeTab !== 'heatmap' || canonicalTickers.length === 0) return;
    if (heatmapTickerSnapshot.join(',') === tickerKey && heatmapData.length > 0) return;
    if (heatmapAttemptKeyRef.current === tickerKey) return;

    heatmapAttemptKeyRef.current = tickerKey;
    activeHeatmapRequestRef.current = tickerKey;
    let cancelled = false;

    async function loadHeatmap() {
      setHeatmapLoading(true);
      setHeatmapError('');
      setHeatmapCoverage({ analyzed: 0, total: canonicalTickers.length });
      const currentTickers = [...canonicalTickers];
      try {
        // Initialize rows as 'unrated' — seeding 'low' rendered a real-looking
        // "low disclosure" rating for companies whose fetch/AI analysis failed
        const rows: HeatmapRow[] = ESG_TOPICS.map(topic => {
          const row: HeatmapRow = { topic };
          currentTickers.forEach(t => { row[t.toLowerCase()] = 'unrated'; });
          return row;
        });

        let analyzed = 0;
        for (const ticker of currentTickers) {
          if (cancelled) return;
          const cik = await lookupCIK(ticker);
          if (!cik) continue;
          const subs = await fetchCompanySubmissions(cik);
          if (!subs) continue;
          const filing = findLatestFiling(subs, '10-K');
          if (!filing) continue;

          const text = await fetchFilingText(cik, filing.accessionNumber, filing.primaryDocument);
          if (!text || text.length < 500) continue;

          const ratings = await aiRateESGDisclosure(text, ESG_TOPICS);
          if (ratings) {
            analyzed += 1;
            for (const row of rows) {
              const rating = ratings[row.topic];
              if (rating) {
                row[ticker.toLowerCase()] = rating;
              }
            }
          }
        }

        if (analyzed === 0) {
          throw new Error('No selected company could be analyzed from its latest 10-K.');
        }
        if (cancelled) return;
        setHeatmapData(rows);
        setHeatmapTickerSnapshot(currentTickers);
        setHeatmapCoverage({ analyzed, total: currentTickers.length });
      } catch (error) {
        console.error('ESG heatmap error:', error);
        if (!cancelled) {
          setHeatmapData([]);
          setHeatmapError(error instanceof Error ? error.message : 'Failed to load ESG heatmap data. Please try again.');
        }
      } finally {
        if (!cancelled && activeHeatmapRequestRef.current === tickerKey) {
          setHeatmapLoading(false);
          activeHeatmapRequestRef.current = '';
        }
      }
    }
    void loadHeatmap();
    return () => {
      cancelled = true;
      if (activeHeatmapRequestRef.current === tickerKey) {
        activeHeatmapRequestRef.current = '';
        heatmapAttemptKeyRef.current = '';
        setHeatmapLoading(false);
      }
    };
  }, [activeTab, canonicalTickers, heatmapData.length, heatmapRetryToken, heatmapTickerSnapshot, tickerKey]);

  // Load real 8-K earnings releases
  useEffect(() => {
    if (activeTab !== 'transcripts' || earningsAttemptedRef.current) return;
    earningsAttemptedRef.current = true;
    let cancelled = false;
    let completed = false;

    async function loadEarnings() {
      setEarningsLoading(true);
      setEarningsError('');
      try {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const dateFrom = threeMonthsAgo.toISOString().split('T')[0];
        const dateTo = new Date().toISOString().split('T')[0];

        const hits = await searchEdgarFilings('earnings OR quarterly results', '8-K', dateFrom, dateTo);
        const releases: EarningsRelease[] = [];
        const seen = new Set<string>();

        for (const hit of hits) {
          if (releases.length >= 6) break;
          const src = hit._source as any;
          const entityName = src?.display_names?.[0] || src?.entity_name || '';
          const nameKey = entityName.toUpperCase().trim();
          if (!nameKey || seen.has(nameKey)) continue;
          seen.add(nameKey);

          const cleanName = entityName.replace(/\s*\(CIK\s+\d+\)/, '').trim();
          const fileDate = src?.file_date || '';
          const cik = String(src?.ciks?.[0] || '').replace(/^0+/, '');
          const accessionNumber = String(src?.adsh || hit._id || '');
          if (!cik || !accessionNumber) continue;

          releases.push({
            id: `${cik}-${accessionNumber}`,
            date: fileDate,
            company: cleanName,
            title: `8-K Filing — ${cleanName}`,
            summary: '',
            cik,
            accessionNumber,
            primaryDocument: String(src?.primary_document || src?.file_name || ''),
            summaryStatus: 'idle',
            summaryError: '',
          });
        }

        if (!cancelled) setEarningsReleases(releases.sort((a, b) => (b.date || '').localeCompare(a.date || '')));
      } catch (error) {
        console.error('Earnings releases error:', error);
        if (!cancelled) setEarningsError('Unable to load recent 8-K filing metadata from SEC EDGAR.');
      } finally {
        completed = true;
        if (!cancelled) setEarningsLoading(false);
      }
    }
    void loadEarnings();
    return () => {
      cancelled = true;
      if (!completed) {
        earningsAttemptedRef.current = false;
        setEarningsLoading(false);
      }
    };
  }, [activeTab, earningsRetryToken]);

  const summarizeRelease = useCallback(async (releaseId: string) => {
    const release = earningsReleases.find(item => item.id === releaseId);
    if (!release || release.summaryStatus === 'loading') return;

    setEarningsReleases(prev => prev.map(item => item.id === releaseId ? {
      ...item,
      summaryStatus: 'loading',
      summary: '',
      summaryError: '',
    } : item));
    try {
      let primaryDocument = release.primaryDocument;
      if (!primaryDocument) {
        const submissions = await fetchCompanySubmissions(release.cik);
        const recent = submissions?.filings.recent;
        const index = recent?.accessionNumber.findIndex(accession => accession.replace(/-/g, '') === release.accessionNumber.replace(/-/g, '')) ?? -1;
        primaryDocument = index >= 0 ? recent?.primaryDocument[index] || '' : '';
      }
      if (!primaryDocument) throw new Error('The primary filing document could not be resolved.');

      const filingText = await fetchFilingText(release.cik, release.accessionNumber, primaryDocument);
      if (filingText.trim().length < 200) throw new Error('The filing text was unavailable.');
      const evidence = selectFilingText(filingText, [
        'item 2.02',
        'results of operations',
        'financial condition',
        'earnings',
        'revenue',
        'net income',
        'guidance',
        'outlook',
        'material definitive agreement',
        'regulation fd',
        'exhibit 99',
        'quarter ended',
        'year ended',
      ], 50_000);
      const coverageInstruction = evidence.complete
        ? `The complete ${evidence.sourceLength.toLocaleString()}-character filing is included.`
        : `${evidence.selectedLength.toLocaleString()} characters were selected from across a ${evidence.sourceLength.toLocaleString()}-character filing. Intervening text is omitted, so do not claim this summary is exhaustive.`;
      const summary = await aiSummarize(`Summarize this SEC 8-K in 2-3 sentences. Use only the filing evidence below; do not infer that it is an earnings release unless the text supports that. Mention the primary disclosed event and any material quantitative detail present. End with "Review the source filing for full context."

Source: ${release.company}, Form 8-K, filed ${release.date}, accession ${release.accessionNumber}
Coverage: ${coverageInstruction}

Filing evidence:
${evidence.text}`, { throwOnError: true });
      setEarningsReleases(prev => prev.map(item => item.id === releaseId ? {
        ...item,
        primaryDocument,
        summary,
        summaryStatus: 'ready',
        summaryError: '',
        sourceLength: evidence.sourceLength,
        selectedLength: evidence.selectedLength,
        selectionComplete: evidence.complete,
      } : item));
    } catch (error) {
      console.error('ESG release summary error:', error);
      setEarningsReleases(prev => prev.map(item => item.id === releaseId ? {
        ...item,
        summaryStatus: 'error',
        summary: '',
        summaryError: 'The source summary could not be generated. Retry when the AI service is available.',
      } : item));
    }
  }, [earningsReleases]);

  const filteredReleases = transcriptSearch.trim()
    ? earningsReleases.filter(ts => {
        const q = transcriptSearch.toLowerCase();
        return ts.company.toLowerCase().includes(q)
          || ts.title.toLowerCase().includes(q)
          || ts.summary.toLowerCase().includes(q);
      })
    : earningsReleases;

  const handleMetricClick = (topic: string) => {
    setSelectedMetric(selectedMetric === topic ? null : topic);
  };

  const mappingsData: Record<string, { sasb: string; gri: string; esrs: string }> = {
    'GHG Scope 1': { sasb: 'TC-SI-130a.1', gri: '305-1', esrs: 'E1-6' },
    'GHG Scope 2': { sasb: 'TC-SI-130a.1', gri: '305-2', esrs: 'E1-6' },
    'GHG Scope 3': { sasb: 'N/A', gri: '305-3', esrs: 'E1-6' },
    'Energy Consumption': { sasb: 'TC-SI-130a.1', gri: '302-1', esrs: 'E1-5' },
    'Water Usage': { sasb: 'TC-SI-140a.1', gri: '303-3', esrs: 'E3-4' },
    'Data Privacy': { sasb: 'TC-SI-220a.1', gri: '418-1', esrs: 'S4-3' },
    'Board Diversity': { sasb: 'TC-SI-330a.3', gri: '405-1', esrs: 'S1-9' },
  };

  return (
    <div className="esg-container">
      <div className="esg-header">
        <div className="esg-title">
          <h1>ESG Research Center</h1>
          <p>Navigate sustainability frameworks, analyze peer disclosure heatmaps, and search recent earnings releases.</p>
        </div>
      </div>

      <div className="esg-layout">
        <aside className="esg-sidebar glass-card">
          <nav className="esg-nav" aria-label="ESG Research sections">
            <button
              type="button"
              aria-pressed={activeTab === 'frameworks'}
              className={`nav-btn ${activeTab === 'frameworks' ? 'active' : ''}`}
              onClick={() => setActiveTab('frameworks')}
            >
              <Globe size={18} /> Framework Navigator
            </button>
            <button
              type="button"
              aria-pressed={activeTab === 'heatmap'}
              className={`nav-btn ${activeTab === 'heatmap' ? 'active' : ''}`}
              onClick={() => setActiveTab('heatmap')}
            >
              <LayoutGrid size={18} /> Disclosure Heatmap
            </button>
            <button
              type="button"
              aria-pressed={activeTab === 'transcripts'}
              className={`nav-btn ${activeTab === 'transcripts' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcripts')}
            >
              <FileAudio size={18} /> Earnings Releases
            </button>
          </nav>

          <div className="sidebar-widget" style={{ marginTop: '20px' }}>
            <h4>Official Policy Sources</h4>
            <p className="policy-source-note">Requirements change frequently. Verify current legal status and effective dates with the issuing authority.</p>
            {POLICY_SOURCES.map(source => (
              <a key={source.url} className="policy-item" href={source.url} target="_blank" rel="noreferrer">
                <span>
                  <strong>{source.name}</strong>
                  <small>{source.authority}</small>
                </span>
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            ))}
          </div>
        </aside>

        <section className="esg-main glass-card">
          {activeTab === 'frameworks' && (
            <div className="tab-pane fade-in">
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h2>Interoperability Matrices</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Cross-reference disclosures between multiple standards.</p>
                </div>
              </div>

              <div className="framework-grid">
                {frameworks.map(fw => (
                  <a key={fw.id} href={fw.url} target="_blank" rel="noreferrer" className="framework-card" style={{ textDecoration: 'none', cursor: 'pointer' }}>
                    <div className="fw-icon-wrapper"><Target size={24} className="text-blue-400"/></div>
                    <h3>{fw.name}</h3>
                    <p>{fw.desc}</p>
                    <span className="text-btn" style={{ marginTop: '10px' }}>Browse Topics <ChevronRight size={16}/></span>
                  </a>
                ))}
              </div>

              <div style={{ marginTop: '20px', padding: '16px', background: 'var(--surface-subtle)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <Activity className="text-green-400" size={24} />
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Cross-Framework Mapping</h3>
                </div>
                <p className="text-sm text-slate-400" style={{ marginBottom: '10px' }}>Click a metric to see how it maps across standards.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {Object.entries(mappingsData).map(([metric, codes]) => (
                    <button
                      type="button"
                      key={metric}
                      onClick={() => setSelectedMapping(selectedMapping === metric ? null : metric)}
                      aria-pressed={selectedMapping === metric}
                      style={{
                        width: '100%',
                        padding: '8px 12px', background: selectedMapping === metric ? 'color-mix(in srgb, var(--accent-primary) 8%, var(--surface-panel-strong))' : 'var(--surface-panel-strong)',
                        borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        border: `1px solid ${selectedMapping === metric ? 'color-mix(in srgb, var(--accent-primary) 30%, transparent)' : 'var(--border-color)'}`,
                        cursor: 'pointer', transition: 'background-color 0.15s, border-color 0.15s'
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{metric}</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span className="badge sasb">SASB: {codes.sasb}</span>
                        <span className="badge gri">GRI: {codes.gri}</span>
                        <span className="badge esrs">ESRS: {codes.esrs}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'heatmap' && (
            <div className="tab-pane fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <h2>AI-Rated ESG Disclosure Heatmap</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Claude AI rates disclosure depth from each company's latest 10-K filing.</p>
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>SEC EDGAR + AI</span>
              </div>

              {/* Ticker management */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ maxWidth: '320px', marginBottom: '8px' }}>
                  <CompanySearchInput onSelect={addEsgTicker} placeholder="Add company to heatmap..." />
                </div>
                {esgTickers.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {esgTickers.map(t => (
                      <span key={t} style={{
                        background: 'var(--interactive-hover-strong)', color: 'var(--accent-primary)', padding: '3px 9px',
                        borderRadius: '4px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px',
                        border: '1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-color))'
                      }}>
                        {t}
                        <button
                          type="button"
                          aria-label={`Remove ${t} from ESG heatmap`}
                          onClick={() => removeEsgTicker(t)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: 0, fontSize: '1rem' }}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {heatmapLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px', gap: '8px' }}>
                  <Loader2 size={32} className="spinner" />
                  <p style={{ color: 'var(--text-secondary)' }}>AI is analyzing 10-K filings for ESG disclosure quality...</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Fetching and analyzing {canonicalTickers.length} filing{canonicalTickers.length === 1 ? '' : 's'}; this may take 30–60 seconds.</p>
                </div>
              ) : heatmapError ? (
                <div role="alert" style={{ textAlign: 'center', padding: '28px', color: 'var(--status-warning)' }}>
                  {heatmapError}
                  <br />
                  <button type="button" className="primary-btn sm" style={{ marginTop: '8px' }} onClick={() => {
                    heatmapAttemptKeyRef.current = '';
                    activeHeatmapRequestRef.current = '';
                    setHeatmapRetryToken(token => token + 1);
                  }}>Retry</button>
                </div>
              ) : heatmapData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
                  Switch to the Heatmap tab to load AI-rated ESG disclosures.
                </div>
              ) : (
                <>
              <div className="heatmap-container" style={{ overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.875rem' }}>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>ESG Topic Category</th>
                      {esgTickers.map(t => (
                        <th scope="col" key={t} style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center', borderLeft: '1px solid var(--border-color)' }}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.map((row, idx) => (
                      <tr
                        key={idx}
                        style={{ borderBottom: '1px solid var(--border-color)', background: selectedMetric === row.topic ? 'color-mix(in srgb, var(--accent-primary) 5%, transparent)' : 'transparent' }}
                      >
                        <th scope="row" style={{ padding: 0, color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500 }}>
                          <button type="button" className="esg-topic-button" aria-expanded={selectedMetric === row.topic} onClick={() => handleMetricClick(row.topic)}>{row.topic}</button>
                        </th>
                        {esgTickers.map(t => (
                          <td key={t} aria-label={`${t}: ${row[t.toLowerCase()] || 'unrated'} disclosure for ${row.topic}`} style={{ padding: '6px', borderLeft: '1px solid var(--border-color)' }}>
                            <div aria-hidden="true" className={`heatmap-cell ${row[t.toLowerCase()] || 'unrated'}`}></div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedMetric && (() => {
                // Show the SELECTED topic's actual per-company ratings, drawn
                // from the row already in the heatmap — not a generic sentence
                // that reads identically for every topic.
                const selectedRow = heatmapData.find(r => r.topic === selectedMetric);
                return (
                  <div style={{ marginTop: '12px', padding: '14px', background: 'color-mix(in srgb, var(--accent-primary) 5%, var(--surface-panel))', border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-color))', borderRadius: '6px' }}>
                    <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>{selectedMetric} — disclosure depth by company</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                      {esgTickers.map(t => {
                        const rating = (selectedRow?.[t.toLowerCase()] as string) || 'unrated';
                        return (
                          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '999px', padding: '3px 10px' }}>
                            <span aria-hidden="true" className={`heatmap-cell ${rating}`} style={{ width: '10px', height: '10px' }}></span>
                            <strong>{t}</strong>
                            <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{rating}</span>
                          </span>
                        );
                      })}
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.5, margin: 0 }}>
                      AI-rated from each company's latest 10-K on SEC EDGAR. Review the source filing before relying on a rating.
                    </p>
                  </div>
                );
              })()}
              {heatmapData.length > 0 && (
                <p className="heatmap-coverage">Analyzed {heatmapCoverage.analyzed} of {heatmapCoverage.total} selected companies. Dashed cells were not rated.</p>
              )}
                </>
              )}

              {/* Legend */}
              <div className="heatmap-legend">
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Legend:</span>
                <span className="legend-swatch">
                  <div className="swatch high"></div> High Detail
                </span>
                <span className="legend-swatch">
                  <div className="swatch medium"></div> Moderate
                </span>
                <span className="legend-swatch">
                  <div className="swatch low"></div> Low / None
                </span>
                <span className="legend-swatch">
                  <div className="swatch unrated"></div> Not rated
                </span>
              </div>
            </div>
          )}

          {activeTab === 'transcripts' && (
            <div className="tab-pane fade-in">
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h2>Recent 8-K earnings candidates</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Recent SEC 8-K candidates. Generate a source-grounded summary only when you need one.</p>
                </div>
                <div className="search-bar-inline">
                  <Search size={16} className="search-bar-icon" />
                  <input
                    type="text"
                    placeholder="Filter by company name..."
                    aria-label="Filter recent 8-K candidates by company"
                    value={transcriptSearch}
                    onChange={e => setTranscriptSearch(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {earningsLoading ? (
                  <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', gap: '8px', color: 'var(--text-secondary)' }}>
                    <Loader2 size={16} className="spinner" /> Loading recent 8-K filings from EDGAR...
                  </div>
                ) : earningsError ? (
                  <div role="alert" style={{ padding: '28px', textAlign: 'center', color: 'var(--status-error)' }}>
                    {earningsError}
                    <br />
                    <button type="button" className="primary-btn sm" style={{ marginTop: '8px' }} onClick={() => {
                      earningsAttemptedRef.current = false;
                      setEarningsRetryToken(token => token + 1);
                    }}>Retry SEC request</button>
                  </div>
                ) : filteredReleases.length === 0 ? (
                  <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {transcriptSearch ? `No 8-K candidates match "${transcriptSearch}".` : 'No recent 8-K earnings candidates found.'}
                  </div>
                ) : filteredReleases.map(ts => (
                  <article key={ts.id} className="transcript-card" style={{
                    background: 'var(--surface-panel-strong)', border: '1px solid var(--border-color)', padding: '12px 14px', borderRadius: '6px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ background: 'var(--interactive-hover-strong)', color: 'var(--accent-primary)', fontWeight: 700, padding: '4px 8px', borderRadius: '4px', fontSize: '0.875rem' }}>8-K</div>
                        <h4 style={{ color: 'var(--text-primary)', fontWeight: 500, margin: 0 }}>{ts.company}</h4>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <BarChart3 size={14}/> {ts.date}
                      </div>
                    </div>

                    <div style={{ paddingLeft: '12px', borderLeft: '2px solid var(--border-color)' }}>
                      {ts.summaryStatus === 'loading' ? (
                        <p role="status" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '4px 0', display: 'flex', gap: '8px', alignItems: 'center' }}><Loader2 size={14} className="spinner" /> Reading the source filing…</p>
                      ) : ts.summaryStatus === 'error' ? (
                        <p role="alert" style={{ fontSize: '0.875rem', color: 'var(--status-error)', margin: '4px 0' }}>{ts.summaryError}</p>
                      ) : ts.summary ? (
                        <>
                          <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', margin: '4px 0' }}>{ts.summary}</p>
                          {typeof ts.sourceLength === 'number' && typeof ts.selectedLength === 'number' && (
                            <p className="release-coverage">
                              {ts.selectionComplete
                                ? `Coverage: complete ${ts.sourceLength.toLocaleString()}-character filing.`
                                : `Coverage: ${ts.selectedLength.toLocaleString()} characters selected across a ${ts.sourceLength.toLocaleString()}-character filing; intervening text was omitted.`}
                              {' '}Verify the summary against the source filing.
                            </p>
                          )}
                        </>
                      ) : (
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '4px 0' }}>No AI summary has been generated.</p>
                      )}
                      <div className="release-actions">
                        <button type="button" className="secondary-btn" disabled={ts.summaryStatus === 'loading'} onClick={() => void summarizeRelease(ts.id)}>
                          {ts.summaryStatus === 'error' ? 'Retry summary' : ts.summaryStatus === 'ready' ? 'Regenerate summary' : 'Generate source summary'}
                        </button>
                        {ts.primaryDocument && (
                          <Link href={`/filing/${ts.cik}_${ts.accessionNumber}_${ts.primaryDocument}`}>Open source filing</Link>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
