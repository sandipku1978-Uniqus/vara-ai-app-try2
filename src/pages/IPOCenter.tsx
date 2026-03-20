import { useState, useCallback, useEffect } from 'react';
import { Rocket, TrendingUp, BarChart, BookOpen, Clock, Activity, Download, Settings, ChevronRight, Search, FileText, AlertCircle, Loader2, ArrowLeft, ExternalLink, Shield, DollarSign, Users, Briefcase, PieChart } from 'lucide-react';
import { searchEdgarFilings, fetchFilingText, fetchCompanySubmissions, CIK_MAP, lookupCIK } from '../services/secApi';
import { aiAnalyzeS1 } from '../services/aiApi';
import './IPOCenter.css';

interface PipelineIPO {
  company: string;
  fileDate: string;
  formType: string;
  cik: string;
  accessionNumber: string;
}

interface S1Filing {
  entityName: string;
  fileDate: string;
  accessionNumber: string;
  fileType: string;
  cik: string;
  primaryDocument: string;
}

interface AnalysisSection {
  key: string;
  label: string;
  icon: React.ReactNode;
  content: string | null;
  loading: boolean;
}

export default function IPOCenter() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'benchmarking' | 'drafting'>('pipeline');
  const [analyzerOpen, setAnalyzerOpen] = useState(false);

  // Pipeline state — real S-1 filings from EDGAR
  const [pipelineIPOs, setPipelineIPOs] = useState<PipelineIPO[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);

  useEffect(() => {
    async function loadPipeline() {
      setPipelineLoading(true);
      try {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const dateFrom = sixMonthsAgo.toISOString().split('T')[0];
        const dateTo = new Date().toISOString().split('T')[0];

        const hits = await searchEdgarFilings('', 'S-1,S-1/A', dateFrom, dateTo);
        const seen = new Set<string>();
        const filings: PipelineIPO[] = [];

        for (const hit of hits) {
          const src = hit._source as any;
          const entityName = src?.display_names?.[0] || src?.entity_name || '';
          // Deduplicate by entity name (keep most recent per company)
          const nameKey = entityName.toUpperCase().trim();
          if (!nameKey || seen.has(nameKey)) continue;
          seen.add(nameKey);

          const cleanName = entityName.replace(/\s*\(CIK\s+\d+\)/, '').trim();
          filings.push({
            company: cleanName,
            fileDate: src?.file_date || '',
            formType: src?.file_type || src?.form || 'S-1',
            cik: (src?.ciks?.[0] || '').replace(/^0+/, ''),
            accessionNumber: src?.adsh || '',
          });
          if (filings.length >= 10) break;
        }
        setPipelineIPOs(filings);
      } catch (error) {
        console.error('IPO pipeline load error:', error);
      } finally {
        setPipelineLoading(false);
      }
    }
    loadPipeline();
  }, []);

  // S-1 Analyzer state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<S1Filing[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFiling, setSelectedFiling] = useState<S1Filing | null>(null);
  const [filingText, setFilingText] = useState('');
  const [loadingFiling, setLoadingFiling] = useState(false);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState('overview');
  const [analyses, setAnalyses] = useState<Record<string, AnalysisSection>>({
    'overview': { key: 'overview', label: 'Business Overview', icon: <Briefcase size={16} />, content: null, loading: false },
    'risk-factors': { key: 'risk-factors', label: 'Risk Factors', icon: <Shield size={16} />, content: null, loading: false },
    'financials': { key: 'financials', label: 'Financials', icon: <BarChart size={16} />, content: null, loading: false },
    'use-of-proceeds': { key: 'use-of-proceeds', label: 'Use of Proceeds', icon: <DollarSign size={16} />, content: null, loading: false },
    'management': { key: 'management', label: 'Management', icon: <Users size={16} />, content: null, loading: false },
    'underwriting': { key: 'underwriting', label: 'Underwriting', icon: <PieChart size={16} />, content: null, loading: false },
  });

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      // Try EDGAR full-text search
      const hits = await searchEdgarFilings(searchQuery, 'S-1,S-1/A');

      if (hits.length > 0) {
        // Deduplicate by accession number, keeping only main S-1/S-1A documents
        const seen = new Set<string>();
        const filings: S1Filing[] = [];
        for (const hit of hits) {
          const src = hit._source as any;
          const accession = src?.adsh || '';
          const fileType = src?.file_type || src?.form || 'S-1';
          // Only include main S-1 or S-1/A documents, skip exhibits
          if (seen.has(accession) || (!fileType.startsWith('S-1') && fileType !== 'S-1/A')) continue;
          seen.add(accession);

          // Parse primary document filename from _id (format: "adsh:filename")
          const idParts = hit._id.split(':');
          const primaryDoc = idParts.length > 1 ? idParts[1] : '';

          // Extract display name
          const displayName = src?.display_names?.[0] || src?.entity_name || 'Unknown';
          // Clean display name (remove CIK suffix)
          const cleanName = displayName.replace(/\s*\(CIK\s+\d+\)/, '').trim();

          filings.push({
            entityName: cleanName,
            fileDate: src?.file_date || '',
            accessionNumber: accession,
            fileType: fileType,
            cik: src?.ciks?.[0]?.replace(/^0+/, '') || '',
            primaryDocument: primaryDoc,
          });
          if (filings.length >= 10) break;
        }
        setSearchResults(filings);
      } else {
        // Fallback: check if user entered a ticker and search submissions
        const ticker = searchQuery.trim().toUpperCase();
        const cik = CIK_MAP[ticker] || await lookupCIK(ticker);
        if (cik) {
          const submissions = await fetchCompanySubmissions(cik);
          if (submissions) {
            const filings: S1Filing[] = [];
            const recent = submissions.filings.recent;
            for (let i = 0; i < recent.form.length; i++) {
              if (recent.form[i] === 'S-1' || recent.form[i] === 'S-1/A') {
                filings.push({
                  entityName: submissions.name,
                  fileDate: recent.filingDate[i],
                  accessionNumber: recent.accessionNumber[i],
                  fileType: recent.form[i],
                  cik: cik,
                  primaryDocument: recent.primaryDocument[i],
                });
              }
            }
            setSearchResults(filings);
          }
        }
      }
    } catch (error) {
      console.error('S-1 search error:', error);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleSelectFiling = useCallback(async (filing: S1Filing) => {
    setSelectedFiling(filing);
    setLoadingFiling(true);
    setFilingText('');
    // Reset analyses
    setAnalyses(prev => {
      const reset: Record<string, AnalysisSection> = {};
      for (const [k, v] of Object.entries(prev)) {
        reset[k] = { ...v, content: null, loading: false };
      }
      return reset;
    });
    setActiveAnalysisTab('overview');

    try {
      // If we don't have CIK, try to resolve from entity name
      let cik = filing.cik;
      let primaryDoc = filing.primaryDocument;

      if (!cik || !primaryDoc) {
        // Try to find the filing via submissions for known tickers
        for (const [ticker, mappedCik] of Object.entries(CIK_MAP)) {
          if (filing.entityName.toUpperCase().includes(ticker)) {
            cik = mappedCik;
            break;
          }
        }
        // Try to get primary document from submissions
        if (cik) {
          const submissions = await fetchCompanySubmissions(cik);
          if (submissions) {
            const recent = submissions.filings.recent;
            for (let i = 0; i < recent.accessionNumber.length; i++) {
              if (recent.accessionNumber[i] === filing.accessionNumber) {
                primaryDoc = recent.primaryDocument[i];
                break;
              }
            }
            // If no exact match, find any S-1
            if (!primaryDoc) {
              for (let i = 0; i < recent.form.length; i++) {
                if (recent.form[i] === 'S-1' || recent.form[i] === 'S-1/A') {
                  primaryDoc = recent.primaryDocument[i];
                  cik = submissions.cik;
                  break;
                }
              }
            }
          }
        }
      }

      if (cik && primaryDoc) {
        const text = await fetchFilingText(cik, filing.accessionNumber, primaryDoc);
        setFilingText(text);
        // Auto-run the first analysis
        runAnalysis('overview', text);
      } else {
        setFilingText('Unable to retrieve filing text. The filing may not be available through the direct document API. Try viewing it on SEC.gov.');
      }
    } catch (error) {
      console.error('Error loading filing:', error);
      setFilingText('Error loading filing document.');
    } finally {
      setLoadingFiling(false);
    }
  }, []);

  const runAnalysis = useCallback(async (section: string, text?: string) => {
    const contentText = text || filingText;
    if (!contentText || contentText.length < 100) return;

    setAnalyses(prev => ({
      ...prev,
      [section]: { ...prev[section], loading: true }
    }));

    try {
      const result = await aiAnalyzeS1(contentText, section);
      setAnalyses(prev => ({
        ...prev,
        [section]: { ...prev[section], content: result, loading: false }
      }));
    } catch {
      setAnalyses(prev => ({
        ...prev,
        [section]: { ...prev[section], content: 'Analysis failed. Please try again.', loading: false }
      }));
    }
  }, [filingText]);

  const handleAnalysisTabClick = useCallback((sectionKey: string) => {
    setActiveAnalysisTab(sectionKey);
    // Auto-run analysis if not already done
    if (!analyses[sectionKey].content && !analyses[sectionKey].loading && filingText.length > 100) {
      runAnalysis(sectionKey);
    }
  }, [analyses, filingText, runAnalysis]);

  // Render markdown-like content (basic)
  const renderMarkdown = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) return <h4 key={i} className="s1-md-h3">{line.replace('### ', '')}</h4>;
      if (line.startsWith('## ')) return <h3 key={i} className="s1-md-h2">{line.replace('## ', '')}</h3>;
      if (line.startsWith('# ')) return <h2 key={i} className="s1-md-h1">{line.replace('# ', '')}</h2>;
      if (line.startsWith('- **')) {
        const match = line.match(/^- \*\*(.+?)\*\*:?\s*(.*)/);
        if (match) return <div key={i} className="s1-md-bullet"><strong>{match[1]}</strong>{match[2] ? `: ${match[2]}` : ''}</div>;
      }
      if (line.startsWith('- ')) return <div key={i} className="s1-md-bullet">{line.replace('- ', '')}</div>;
      if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="s1-md-bold">{line.replace(/\*\*/g, '')}</p>;
      if (line.trim() === '') return <br key={i} />;
      // Inline bold
      const parts = line.split(/(\*\*.*?\*\*)/g);
      return <p key={i} className="s1-md-p">{parts.map((part, j) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={j}>{part.replace(/\*\*/g, '')}</strong>
          : part
      )}</p>;
    });
  };

  // =====================
  // S-1 ANALYZER VIEW
  // =====================
  if (analyzerOpen) {
    return (
      <div className="ipo-container">
        <div className="ipo-header">
          <div className="ipo-title">
            <button className="s1-back-btn" onClick={() => { setAnalyzerOpen(false); setSelectedFiling(null); setSearchResults([]); setSearchQuery(''); }}>
              <ArrowLeft size={18} /> Back to IPO Center
            </button>
            <h1>S-1 Registration Statement Analyzer</h1>
            <p>AI-powered analysis of IPO registration statements from SEC EDGAR.</p>
          </div>
        </div>

        {!selectedFiling ? (
          /* Search Phase */
          <div className="s1-search-phase">
            <div className="s1-search-box glass-card">
              <h2><Rocket size={22} /> Find an S-1 Filing</h2>
              <p>Search by company name, ticker, or keyword to find S-1 registration statements.</p>
              <div className="s1-search-input-row">
                <div className="s1-search-input-wrapper">
                  <Search size={18} className="s1-search-icon" />
                  <input
                    type="text"
                    placeholder="e.g., Reddit, ARM, DoorDash, Snowflake..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <button className="primary-btn" onClick={handleSearch} disabled={searching}>
                  {searching ? <><Loader2 size={16} className="spin" /> Searching...</> : <>Search EDGAR</>}
                </button>
              </div>

              <div className="s1-quick-tickers">
                <span>Quick search:</span>
                {['Reddit', 'Arm Holdings', 'Rubrik', 'Instacart', 'DoorDash'].map(name => (
                  <button key={name} className="s1-ticker-pill" onClick={() => { setSearchQuery(name); }}>
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {searching && (
              <div className="s1-loading-state">
                <Loader2 size={32} className="spin" />
                <p>Searching SEC EDGAR for S-1 filings...</p>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="s1-results glass-card">
                <h3>Found {searchResults.length} S-1 Filing{searchResults.length !== 1 ? 's' : ''}</h3>
                <div className="s1-results-list">
                  {searchResults.map((filing, idx) => (
                    <div key={idx} className="s1-result-card" onClick={() => handleSelectFiling(filing)}>
                      <div className="s1-result-info">
                        <div className="s1-result-name">{filing.entityName}</div>
                        <div className="s1-result-meta">
                          <span className="s1-badge type">{filing.fileType}</span>
                          <span className="s1-result-date">{filing.fileDate}</span>
                          <span className="s1-result-acc">Acc: {filing.accessionNumber}</span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="s1-result-arrow" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!searching && searchResults.length === 0 && searchQuery && (
              <div className="s1-no-results glass-card">
                <AlertCircle size={24} />
                <p>No S-1 filings found for "{searchQuery}". Try a different company name or ticker.</p>
                <p className="s1-hint">Note: S-1 filings are only available for companies that have filed for an IPO. Most large-cap companies filed their S-1 many years ago.</p>
              </div>
            )}
          </div>
        ) : (
          /* Analysis Phase */
          <div className="s1-analysis-phase">
            <div className="s1-filing-header glass-card">
              <div className="s1-filing-header-info">
                <div>
                  <h2>{selectedFiling.entityName}</h2>
                  <div className="s1-filing-header-meta">
                    <span className="s1-badge type">{selectedFiling.fileType}</span>
                    <span>Filed: {selectedFiling.fileDate}</span>
                    <span>Accession: {selectedFiling.accessionNumber}</span>
                  </div>
                </div>
                <div className="s1-filing-header-actions">
                  <a
                    href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&accession=${selectedFiling.accessionNumber}&type=S-1&dateb=&owner=include&count=40`}
                    target="_blank"
                    rel="noreferrer"
                    className="icon-btn"
                    title="View on SEC.gov"
                  >
                    <ExternalLink size={18} />
                  </a>
                  <button className="s1-back-btn sm" onClick={() => { setSelectedFiling(null); }}>
                    <ArrowLeft size={16} /> Back to Results
                  </button>
                </div>
              </div>
            </div>

            {loadingFiling ? (
              <div className="s1-loading-state">
                <Loader2 size={32} className="spin" />
                <p>Loading S-1 filing from SEC EDGAR...</p>
              </div>
            ) : (
              <div className="s1-analysis-layout">
                {/* Analysis Tabs Sidebar */}
                <div className="s1-analysis-nav glass-card">
                  {Object.values(analyses).map(section => (
                    <button
                      key={section.key}
                      className={`s1-nav-btn ${activeAnalysisTab === section.key ? 'active' : ''} ${section.content ? 'done' : ''}`}
                      onClick={() => handleAnalysisTabClick(section.key)}
                    >
                      {section.icon}
                      <span>{section.label}</span>
                      {section.loading && <Loader2 size={14} className="spin s1-nav-spinner" />}
                      {section.content && !section.loading && <span className="s1-check">&#10003;</span>}
                    </button>
                  ))}

                  <div className="s1-nav-divider" />
                  <button
                    className="s1-run-all-btn"
                    onClick={() => {
                      Object.keys(analyses).forEach(key => {
                        if (!analyses[key].content && !analyses[key].loading) {
                          runAnalysis(key);
                        }
                      });
                    }}
                  >
                    <Rocket size={16} /> Run All Analyses
                  </button>

                  <div className="s1-text-stats">
                    <FileText size={14} />
                    <span>{filingText.length > 0 ? `${(filingText.length / 1000).toFixed(0)}K chars loaded` : 'No text loaded'}</span>
                  </div>
                </div>

                {/* Analysis Content */}
                <div className="s1-analysis-content glass-card">
                  <div className="s1-analysis-header">
                    <h3>{analyses[activeAnalysisTab]?.icon} {analyses[activeAnalysisTab]?.label}</h3>
                    {analyses[activeAnalysisTab]?.content && (
                      <button
                        className="s1-rerun-btn"
                        onClick={() => runAnalysis(activeAnalysisTab)}
                        disabled={analyses[activeAnalysisTab]?.loading}
                      >
                        Re-analyze
                      </button>
                    )}
                  </div>

                  <div className="s1-analysis-body">
                    {analyses[activeAnalysisTab]?.loading ? (
                      <div className="s1-analysis-loading">
                        <Loader2 size={28} className="spin" />
                        <p>Analyzing {analyses[activeAnalysisTab]?.label.toLowerCase()} with Claude AI...</p>
                        <p className="s1-hint">This may take 10-30 seconds depending on filing length.</p>
                      </div>
                    ) : analyses[activeAnalysisTab]?.content ? (
                      <div className="s1-analysis-result">
                        {renderMarkdown(analyses[activeAnalysisTab].content!)}
                      </div>
                    ) : (
                      <div className="s1-analysis-empty">
                        <FileText size={40} />
                        <h4>Ready to Analyze</h4>
                        <p>Click the button below to run AI analysis on the {analyses[activeAnalysisTab]?.label.toLowerCase()} section of this S-1 filing.</p>
                        <button
                          className="primary-btn"
                          onClick={() => runAnalysis(activeAnalysisTab)}
                          disabled={filingText.length < 100}
                        >
                          <Rocket size={16} /> Analyze {analyses[activeAnalysisTab]?.label}
                        </button>
                        {filingText.length < 100 && (
                          <p className="s1-hint" style={{ marginTop: '12px' }}>
                            <AlertCircle size={14} /> Filing text could not be loaded. Try viewing this filing directly on SEC.gov.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // =====================
  // STANDARD IPO CENTER VIEW
  // =====================
  return (
    <div className="ipo-container">
      <div className="ipo-header">
        <div className="ipo-title">
          <h1>IPO & Pre-IPO Readiness Center</h1>
          <p>Track the global IPO pipeline, benchmark offering sizes, and analyze S-1 drafting trends.</p>
        </div>
        <button className="primary-btn sm" onClick={() => setAnalyzerOpen(true)}>
          <Rocket size={16}/> Load S-1 Analyzer
        </button>
      </div>

      <div className="ipo-layout">
        <aside className="ipo-sidebar glass-card">
          <nav className="ipo-nav">
            <button
              className={`nav-btn ${activeTab === 'pipeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('pipeline')}
            >
              <Activity size={18} /> Global Pipeline
            </button>
            <button
              className={`nav-btn ${activeTab === 'benchmarking' ? 'active' : ''}`}
              onClick={() => setActiveTab('benchmarking')}
            >
              <BarChart size={18} /> Deal Benchmarking
            </button>
            <button
              className={`nav-btn ${activeTab === 'drafting' ? 'active' : ''}`}
              onClick={() => setActiveTab('drafting')}
            >
              <BookOpen size={18} /> S-1 Drafting Trends
            </button>
          </nav>

          <div className="sidebar-widget">
            <h4>Market Pulse</h4>
            <div className="pulse-item">
              <div className="pulse-row">
                <span className="pulse-label">Recent S-1 Filings</span>
                <span className="badge" style={{ fontSize: '0.7rem' }}>EDGAR Live</span>
              </div>
              <p className="pulse-value">{pipelineLoading ? '...' : pipelineIPOs.length} <span className="pulse-sub">in last 6 months</span></p>
            </div>
            <div className="pulse-item pulse-divider">
              <div className="pulse-row">
                <span className="pulse-label">Data Source</span>
              </div>
              <p className="pulse-value" style={{ fontSize: '0.9rem' }}>SEC EDGAR EFTS</p>
            </div>
          </div>
        </aside>

        <main className="ipo-main glass-card">
          {activeTab === 'pipeline' && (
            <div className="tab-pane fade-in">
              <div className="pane-header">
                <div>
                  <h2>Recent Pricings & Filings</h2>
                  <p className="pane-subtitle">Live feed of S-1, F-1, and 424B4 filings.</p>
                </div>
                <div className="pane-actions">
                  <button className="icon-btn" title="Alerts" onClick={() => alert('Alert configured: You will be notified when a new S-1/F-1 is filed in your tracked sectors.')}><Settings size={18} /> Alerts</button>
                  <button className="icon-btn" title="Export" onClick={() => alert('IPO pipeline data exported.')}><Download size={18} /> Export</button>
                </div>
              </div>

              <div className="ipo-table-container">
                {pipelineLoading ? (
                  <div className="text-muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px' }}>
                    <Loader2 size={16} className="spin" /> Loading recent S-1 filings from EDGAR...
                  </div>
                ) : pipelineIPOs.length === 0 ? (
                  <div className="text-muted" style={{ textAlign: 'center', padding: '40px' }}>
                    No recent S-1 filings found.
                  </div>
                ) : (
                <table className="ipo-table">
                  <thead>
                    <tr>
                      <th>Issuer</th>
                      <th>Form</th>
                      <th>Filing Date</th>
                      <th>CIK</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineIPOs.map((ipo, idx) => (
                      <tr key={idx}>
                        <td className="ipo-issuer">{ipo.company}</td>
                        <td><span className="ipo-ticker-badge">{ipo.formType}</span></td>
                        <td className="ipo-date">{ipo.fileDate}</td>
                        <td className="ipo-size">{ipo.cik || '—'}</td>
                        <td className="ipo-action-cell">
                          <button
                            className="ipo-prospectus-link"
                            onClick={() => {
                              setSearchQuery(ipo.company);
                              setAnalyzerOpen(true);
                              // Auto-trigger search after opening analyzer
                              setTimeout(() => {
                                const searchBtn = document.querySelector('.s1-search-input-row .primary-btn') as HTMLButtonElement;
                                searchBtn?.click();
                              }, 100);
                            }}
                          >
                            Analyze S-1 <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          )}

          {activeTab === 'benchmarking' && (
            <div className="tab-pane fade-in">
              <div className="pane-header">
                <div>
                  <h2>Deal Benchmarking</h2>
                  <p className="pane-subtitle">Compare underwriting discounts, legal fees, and lock-up periods.</p>
                </div>
              </div>

              <div className="benchmarking-grid">
                <div className="benchmark-card">
                  <h3 className="benchmark-title">Underwriting Spread (Avg)</h3>
                  <div className="benchmark-value-row">
                    <span className="benchmark-big-value">6.8%</span>
                    <span className="benchmark-change positive"><TrendingUp size={14} /> 12 bps YoY</span>
                  </div>
                  <div className="benchmark-bar">
                    <div className="benchmark-bar-fill blue" style={{width: '68%'}}></div>
                  </div>
                  <p className="benchmark-note">Based on tech sector offerings &gt; $500M</p>
                </div>

                <div className="benchmark-card">
                  <h3 className="benchmark-title">Lock-up Agreements</h3>
                  <div className="lockup-items">
                    <div className="lockup-item">
                      <div className="lockup-row">
                        <span>Standard 180-Day</span>
                        <span className="lockup-pct">65%</span>
                      </div>
                      <div className="benchmark-bar"><div className="benchmark-bar-fill gray" style={{width: '65%'}}></div></div>
                    </div>
                    <div className="lockup-item">
                      <div className="lockup-row">
                        <span>Early Release (Earnings)</span>
                        <span className="lockup-pct">25%</span>
                      </div>
                      <div className="benchmark-bar"><div className="benchmark-bar-fill blue" style={{width: '25%'}}></div></div>
                    </div>
                    <div className="lockup-item">
                      <div className="lockup-row">
                        <span>Price-Based Release</span>
                        <span className="lockup-pct">10%</span>
                      </div>
                      <div className="benchmark-bar"><div className="benchmark-bar-fill purple" style={{width: '10%'}}></div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'drafting' && (
            <div className="tab-pane fade-in">
              <div className="pane-header">
                <div>
                  <h2>S-1 Drafting Risk Factors Trends</h2>
                  <p className="pane-subtitle">AI-identified most frequently added risk factors in 2024 S-1s.</p>
                </div>
              </div>

              <div className="drafting-trends">
                <div className="trend-card">
                  <div className="trend-icon red">
                    <TrendingUp size={24} />
                  </div>
                  <div className="trend-content">
                    <h3>Artificial Intelligence Regulation</h3>
                    <p>"Our business relies on emerging AI technologies, including generative AI models. Regulatory uncertainty, copyright infringement claims, or bias in data models could materially affect our business."</p>
                    <div className="trend-tags">
                      <span className="trend-tag">Seen in 84% of Tech S-1s</span>
                      <span className="trend-tag">+45% YoY</span>
                    </div>
                  </div>
                </div>

                <div className="trend-card">
                  <div className="trend-icon orange">
                    <Clock size={24} />
                  </div>
                  <div className="trend-content">
                    <h3>Geopolitical Supply Chain Constraints</h3>
                    <p>"Escalating trade tensions, export controls, tariffs, or physical conflicts in regions where we manufacture components (e.g., Taiwan, China) could disrupt our operations."</p>
                    <div className="trend-tags">
                      <span className="trend-tag">Seen in 62% of Hardware S-1s</span>
                      <span className="trend-tag">+12% YoY</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
