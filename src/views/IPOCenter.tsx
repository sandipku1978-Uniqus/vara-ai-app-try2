'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Rocket, TrendingUp, BarChart, BookOpen, Clock, Activity, Download, Settings, ChevronRight, Search, FileText, AlertCircle, Loader2, ArrowLeft, ExternalLink, Shield, DollarSign, Users, Briefcase, PieChart } from 'lucide-react';
import { searchEdgarFilings, fetchEdgarSearchTotal, fetchFilingText, fetchCompanySubmissions, CIK_MAP, lookupCIKFlexible, buildSecFilingIndexUrl } from '../services/secApi';
import { aiAnalyzeS1 } from '../services/aiApi';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { buildCsv } from '../components/tables/ResultsToolbar';
import { useApp } from '../context/AppState';
import './IPOCenter.css';

export const IPO_FORM_SCOPE = 'S-1,S-1/A,F-1,F-1/A,424B4';

interface PipelineIPO {
  company: string;
  fileDate: string;
  formType: string;
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
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
  error: string | null;
}

export function summarizeIpoFeed(filings: PipelineIPO[]) {
  const formCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  for (const filing of filings) {
    formCounts.set(filing.formType, (formCounts.get(filing.formType) || 0) + 1);
    const month = filing.fileDate.slice(0, 7);
    if (month) monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
  }
  return {
    issuerCount: new Set(filings.map(filing => filing.company.toLowerCase())).size,
    amendmentCount: filings.filter(filing => filing.formType.endsWith('/A')).length,
    formCounts: Array.from(formCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    monthCounts: Array.from(monthCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  };
}

export function canAnalyzeIpoFilingEvidence(
  filingText: string,
  filingLoadError = '',
  loadingFiling = false
): boolean {
  return !loadingFiling && !filingLoadError && filingText.trim().length >= 100;
}

export async function runIpoAnalysisQueue(
  sectionKeys: string[],
  analyze: (sectionKey: string) => Promise<void>,
  runningGuard: { current: boolean },
  onUnexpectedError?: (sectionKey: string, error: unknown) => void
): Promise<boolean> {
  if (runningGuard.current) return false;

  runningGuard.current = true;
  try {
    for (const sectionKey of sectionKeys) {
      try {
        await analyze(sectionKey);
      } catch (error) {
        onUnexpectedError?.(sectionKey, error);
      }
    }
    return true;
  } finally {
    runningGuard.current = false;
  }
}

export default function IPOCenter() {
  const { addSavedAlert } = useApp();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'benchmarking' | 'drafting'>('pipeline');
  const [analyzerOpen, setAnalyzerOpen] = useState(false);

  // Pipeline state — real S-1 filings from EDGAR
  const [pipelineIPOs, setPipelineIPOs] = useState<PipelineIPO[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineTotal, setPipelineTotal] = useState<{ value: number; relation: 'eq' | 'gte' }>({ value: 0, relation: 'eq' });
  const [pipelineError, setPipelineError] = useState('');
  const [pipelineWindow, setPipelineWindow] = useState({ from: '', through: '' });
  const [pipelineMessage, setPipelineMessage] = useState('');

  const loadPipeline = useCallback(async () => {
    setPipelineLoading(true);
    setPipelineError('');
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const dateFrom = sixMonthsAgo.toISOString().split('T')[0];
      const dateTo = new Date().toISOString().split('T')[0];
      setPipelineWindow({ from: dateFrom, through: dateTo });

      const [hits, total] = await Promise.all([
        searchEdgarFilings('', IPO_FORM_SCOPE, dateFrom, dateTo, '', 100),
        fetchEdgarSearchTotal('', IPO_FORM_SCOPE, dateFrom, dateTo),
      ]);
      const seen = new Set<string>();
      const filings: PipelineIPO[] = [];

      for (const hit of hits) {
        const src = hit._source;
        const accession = src?.adsh || '';
        if (!accession || seen.has(accession)) continue;
        seen.add(accession);
        const entityName = src?.display_names?.[0] || src?.entity_name || '';
        const idParts = hit._id.split(':');
        filings.push({
          company: entityName.replace(/\s*\(CIK\s+\d+\)/, '').trim() || 'Unknown issuer',
          fileDate: src?.file_date || '',
          formType: src?.form || src?.root_forms?.[0] || src?.file_type || '',
          cik: (src?.ciks?.[0] || '').replace(/^0+/, ''),
          accessionNumber: accession,
          primaryDocument: src?.primary_document || (idParts.length > 2 ? idParts.slice(2).join(':') : idParts[1] || ''),
        });
      }
      setPipelineIPOs(filings.sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || '')));
      setPipelineTotal(total);
    } catch (error) {
      console.error('IPO pipeline load error:', error);
      setPipelineIPOs([]);
      setPipelineTotal({ value: 0, relation: 'eq' });
      setPipelineError('The live SEC IPO filing feed could not be loaded.');
    } finally {
      setPipelineLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPipeline();
  }, [loadPipeline]);

  const pipelineSummary = useMemo(() => summarizeIpoFeed(pipelineIPOs), [pipelineIPOs]);

  // S-1 Analyzer state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<S1Filing[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedFiling, setSelectedFiling] = useState<S1Filing | null>(null);
  const [filingText, setFilingText] = useState('');
  const [loadingFiling, setLoadingFiling] = useState(false);
  const [filingLoadError, setFilingLoadError] = useState('');
  const [activeAnalysisTab, setActiveAnalysisTab] = useState('overview');
  const [analyses, setAnalyses] = useState<Record<string, AnalysisSection>>({
    'overview': { key: 'overview', label: 'Business Overview', icon: <Briefcase size={16} />, content: null, loading: false, error: null },
    'risk-factors': { key: 'risk-factors', label: 'Risk Factors', icon: <Shield size={16} />, content: null, loading: false, error: null },
    'financials': { key: 'financials', label: 'Financials', icon: <BarChart size={16} />, content: null, loading: false, error: null },
    'use-of-proceeds': { key: 'use-of-proceeds', label: 'Use of Proceeds', icon: <DollarSign size={16} />, content: null, loading: false, error: null },
    'management': { key: 'management', label: 'Management', icon: <Users size={16} />, content: null, loading: false, error: null },
    'underwriting': { key: 'underwriting', label: 'Underwriting', icon: <PieChart size={16} />, content: null, loading: false, error: null },
  });
  const [runningAllAnalyses, setRunningAllAnalyses] = useState(false);
  const runningAllAnalysesRef = useRef(false);

  const handleSearch = useCallback(async (overrideQuery?: string) => {
    // Accept an explicit query so quick-search pills can run immediately
    // without waiting for the setState round-trip (stale-closure guard).
    const activeQuery = (typeof overrideQuery === 'string' ? overrideQuery : searchQuery).trim();
    if (!activeQuery) return;
    setSearching(true);
    setSearchAttempted(true);
    setSearchError('');
    setSearchResults([]);
    try {
      // Try EDGAR full-text search
      const hits = await searchEdgarFilings(activeQuery, 'S-1,S-1/A,F-1,F-1/A');

      if (hits.length > 0) {
        // Deduplicate by accession number, keeping only main S-1/S-1A documents
        const seen = new Set<string>();
        const filings: S1Filing[] = [];
        for (const hit of hits) {
          const src = hit._source as any;
          const accession = src?.adsh || '';
          const fileType = src?.file_type || src?.form || 'S-1';
          // Only include main domestic/foreign registration statements.
          if (seen.has(accession) || !/^(?:S-1|F-1)(?:\/A)?$/i.test(fileType)) continue;
          seen.add(accession);

          // Parse primary document filename from _id (format: "adsh:filename")
          const idParts = hit._id.split(':');
          const primaryDoc = src?.primary_document || (idParts.length > 2 ? idParts.slice(2).join(':') : idParts[1] || '');

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
        const ticker = activeQuery.toUpperCase();
        const cik = CIK_MAP[ticker] || await lookupCIKFlexible(activeQuery);
        if (cik) {
          const submissions = await fetchCompanySubmissions(cik);
          if (submissions) {
            const filings: S1Filing[] = [];
            const recent = submissions.filings.recent;
            for (let i = 0; i < recent.form.length; i++) {
              if (/^(?:S-1|F-1)(?:\/A)?$/i.test(recent.form[i])) {
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
      setSearchError('The SEC registration-statement search failed. No zero-result conclusion can be drawn; retry the same search.');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const analyzeSection = useCallback(async (section: string, contentText: string) => {
    if (!contentText || contentText.length < 100) return;

    setAnalyses(prev => ({
      ...prev,
      [section]: { ...prev[section], content: null, loading: true, error: null }
    }));

    try {
      const result = await aiAnalyzeS1(contentText, section);
      setAnalyses(prev => ({
        ...prev,
        [section]: { ...prev[section], content: result, loading: false, error: null }
      }));
    } catch {
      setAnalyses(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          content: null,
          loading: false,
          error: 'AI analysis could not be completed. The filing evidence is unchanged; retry when the AI service is available.',
        }
      }));
    }
  }, []);

  const handleSelectFiling = useCallback(async (filing: S1Filing) => {
    setSelectedFiling(filing);
    setLoadingFiling(true);
    setFilingText('');
    setFilingLoadError('');
    // Reset analyses
    setAnalyses(prev => {
      const reset: Record<string, AnalysisSection> = {};
      for (const [k, v] of Object.entries(prev)) {
        reset[k] = { ...v, content: null, loading: false, error: null };
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
                if (/^(?:S-1|F-1)(?:\/A)?$/i.test(recent.form[i])) {
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
        if (text.trim().length < 100) {
          setFilingText('');
          setFilingLoadError('The SEC filing text could not be loaded, so AI analysis is disabled until source evidence is available.');
        } else {
          setFilingText(text);
          await analyzeSection('overview', text);
        }
      } else {
        setFilingText('');
        setFilingLoadError('The filing document could not be resolved from SEC metadata, so AI analysis is disabled.');
      }
    } catch (error) {
      console.error('Error loading filing:', error);
      setFilingText('');
      setFilingLoadError('The SEC filing text request failed, so AI analysis is disabled until the source can be loaded.');
    } finally {
      setLoadingFiling(false);
    }
  }, [analyzeSection]);

  const filingEvidenceReady = canAnalyzeIpoFilingEvidence(filingText, filingLoadError, loadingFiling);
  // Reliable filing-index link (was a cgi-bin browse-edgar search that didn't
  // resolve to the actual filing).
  const selectedFilingSourceUrl = selectedFiling && selectedFiling.cik && selectedFiling.accessionNumber
    ? buildSecFilingIndexUrl(selectedFiling.cik, selectedFiling.accessionNumber)
    : '';

  const runAnalysis = useCallback(async (section: string) => {
    if (!canAnalyzeIpoFilingEvidence(filingText, filingLoadError, loadingFiling)) return;
    await analyzeSection(section, filingText);
  }, [analyzeSection, filingLoadError, filingText, loadingFiling]);

  const handleRunAllAnalyses = useCallback(async () => {
    if (runningAllAnalysesRef.current || !canAnalyzeIpoFilingEvidence(filingText, filingLoadError, loadingFiling)) return;

    const pendingSections = Object.keys(analyses).filter(
      sectionKey => !analyses[sectionKey].content && !analyses[sectionKey].loading
    );
    if (pendingSections.length === 0) return;

    setRunningAllAnalyses(true);
    try {
      await runIpoAnalysisQueue(
        pendingSections,
        runAnalysis,
        runningAllAnalysesRef,
        sectionKey => {
          setAnalyses(prev => ({
            ...prev,
            [sectionKey]: {
              ...prev[sectionKey],
              content: null,
              loading: false,
              error: 'AI analysis could not be completed. The filing evidence is unchanged; retry when the AI service is available.',
            },
          }));
        }
      );
    } finally {
      setRunningAllAnalyses(false);
    }
  }, [analyses, filingLoadError, filingText, loadingFiling, runAnalysis]);

  const handleAnalysisTabClick = useCallback((sectionKey: string) => {
    setActiveAnalysisTab(sectionKey);
    // Auto-run analysis if not already done
    if (!runningAllAnalyses && !analyses[sectionKey].content && !analyses[sectionKey].loading && filingEvidenceReady) {
      runAnalysis(sectionKey);
    }
  }, [analyses, filingEvidenceReady, runAnalysis, runningAllAnalyses]);

  const handlePipelineAnalyze = useCallback((ipo: PipelineIPO) => {
    setAnalyzerOpen(true);
    void handleSelectFiling({
      entityName: ipo.company,
      fileDate: ipo.fileDate,
      accessionNumber: ipo.accessionNumber,
      fileType: ipo.formType,
      cik: ipo.cik,
      primaryDocument: ipo.primaryDocument,
    });
  }, [handleSelectFiling]);

  const handlePipelineExport = useCallback(() => {
    const csv = buildCsv(pipelineIPOs, [
      { key: 'company', header: 'Issuer' },
      { key: 'formType', header: 'Form' },
      { key: 'fileDate', header: 'Filing Date' },
      { key: 'cik', header: 'CIK' },
      { key: 'accessionNumber', header: 'Accession Number' },
    ]);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `URC_IPO_pipeline_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setPipelineMessage(`Exported ${pipelineIPOs.length} loaded SEC filings.`);
  }, [pipelineIPOs]);

  const handlePipelineAlert = useCallback(() => {
    addSavedAlert({
      name: 'IPO registration filings',
      query: '',
      mode: 'semantic',
      filters: { ...defaultSearchFilters, formTypes: IPO_FORM_SCOPE.split(',') },
      defaultForms: IPO_FORM_SCOPE,
    });
    setPipelineMessage('Saved a local IPO filing monitor. It checks for new filings when the Dashboard is opened or “Check Now” is used.');
  }, [addSavedAlert]);

  const handleWorkspaceTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: 'pipeline' | 'benchmarking' | 'drafting'
  ) => {
    const tabs = ['pipeline', 'benchmarking', 'drafting'] as const;
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`ipo-tab-${nextTab}`)?.focus());
  };

  const handleAnalysisTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentKey: string) => {
    const tabs = Object.keys(analyses);
    const currentIndex = tabs.indexOf(currentKey);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    handleAnalysisTabClick(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`ipo-analysis-tab-${nextTab}`)?.focus());
  };

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
            <button type="button" className="s1-back-btn" onClick={() => { setAnalyzerOpen(false); setSelectedFiling(null); setSearchResults([]); setSearchQuery(''); setSearchAttempted(false); setSearchError(''); }}>
              <ArrowLeft size={18} /> Back to IPO Center
            </button>
            <h1>S-1 Registration Statement Analyzer</h1>
            <p>Evidence-linked analysis of domestic and foreign IPO registration statements from SEC EDGAR.</p>
          </div>
        </div>

        {!selectedFiling ? (
          /* Search Phase */
          <div className="s1-search-phase">
            <div className="s1-search-box glass-card">
              <h2><Rocket size={22} /> Find an IPO Registration Filing</h2>
              <p>Search by company name, ticker, or keyword to find S-1 and F-1 registration statements.</p>
              <div className="s1-search-input-row">
                <div className="s1-search-input-wrapper">
                  <Search size={18} className="s1-search-icon" />
                  <input
                    type="text"
                    aria-label="Company, ticker, or keyword"
                    placeholder="e.g., Reddit, ARM, DoorDash, Snowflake..."
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setSearchAttempted(false); setSearchError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <button type="button" className="primary-btn" onClick={() => void handleSearch()} disabled={searching}>
                  {searching ? <><Loader2 size={16} className="spin" /> Searching...</> : <>Search EDGAR</>}
                </button>
              </div>

              <div className="s1-quick-tickers">
                <span>Quick search:</span>
                {['Reddit', 'Arm Holdings', 'Rubrik', 'Instacart', 'DoorDash'].map(name => (
                  <button type="button" key={name} className="s1-ticker-pill" onClick={() => { setSearchQuery(name); setSearchError(''); void handleSearch(name); }}>
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {searching && (
              <div className="s1-loading-state" role="status" aria-live="polite">
                <Loader2 size={32} className="spin" />
                <p>Searching SEC EDGAR for S-1 and F-1 filings...</p>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="s1-results glass-card">
                <h3>Found {searchResults.length} registration filing{searchResults.length !== 1 ? 's' : ''}</h3>
                <div className="s1-results-list">
                  {searchResults.map((filing, idx) => (
                    <button type="button" key={`${filing.accessionNumber}-${idx}`} className="s1-result-card" onClick={() => handleSelectFiling(filing)}>
                      <div className="s1-result-info">
                        <div className="s1-result-name">{filing.entityName}</div>
                        <div className="s1-result-meta">
                          <span className="s1-badge type">{filing.fileType}</span>
                          <span className="s1-result-date">{filing.fileDate}</span>
                          <span className="s1-result-acc">Acc: {filing.accessionNumber}</span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="s1-result-arrow" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!searching && searchError && (
              <div className="s1-no-results glass-card" role="alert">
                <AlertCircle size={24} />
                <p>{searchError}</p>
                <button type="button" className="secondary-btn" onClick={() => void handleSearch()}>Retry SEC search</button>
              </div>
            )}

            {!searching && !searchError && searchAttempted && searchResults.length === 0 && searchQuery && (
              <div className="s1-no-results glass-card">
                <AlertCircle size={24} />
                <p>No S-1 or F-1 filings found for "{searchQuery}". Try a different company name or ticker.</p>
                <p className="s1-hint">Registration filings are available only for issuers that filed through SEC EDGAR.</p>
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
                    href={selectedFilingSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="icon-btn"
                    title="View on SEC.gov"
                    aria-label={`View ${selectedFiling.entityName} filing on SEC.gov`}
                  >
                    <ExternalLink size={18} />
                  </a>
                  <button type="button" className="s1-back-btn sm" onClick={() => { setSelectedFiling(null); }}>
                    <ArrowLeft size={16} /> Back to Results
                  </button>
                </div>
              </div>
            </div>

            {!loadingFiling && filingLoadError && (
              <div className="s1-source-error glass-card" role="alert">
                <AlertCircle size={20} aria-hidden="true" />
                <div>
                  <h3>Source filing text unavailable</h3>
                  <p>{filingLoadError}</p>
                </div>
                <div className="s1-source-error-actions">
                  <button type="button" className="secondary-btn" onClick={() => void handleSelectFiling(selectedFiling)}>Retry filing text</button>
                  <a href={selectedFilingSourceUrl} target="_blank" rel="noopener noreferrer" className="secondary-btn">Open SEC source</a>
                </div>
              </div>
            )}

            {loadingFiling ? (
              <div className="s1-loading-state" role="status" aria-live="polite">
                <Loader2 size={32} className="spin" />
                <p>Loading S-1 filing from SEC EDGAR...</p>
              </div>
            ) : (
              <div className="s1-analysis-layout">
                {/* Analysis Tabs Sidebar */}
                <div className="s1-analysis-nav glass-card" role="tablist" aria-label="Registration statement analysis sections" aria-orientation="vertical">
                  {Object.values(analyses).map(section => (
                    <button
                      type="button"
                      key={section.key}
                      id={`ipo-analysis-tab-${section.key}`}
                      role="tab"
                      aria-selected={activeAnalysisTab === section.key}
                      aria-controls="ipo-analysis-panel"
                      tabIndex={activeAnalysisTab === section.key ? 0 : -1}
                      className={`s1-nav-btn ${activeAnalysisTab === section.key ? 'active' : ''} ${section.content ? 'done' : ''}`}
                      onClick={() => handleAnalysisTabClick(section.key)}
                      onKeyDown={event => handleAnalysisTabKeyDown(event, section.key)}
                    >
                      {section.icon}
                      <span>{section.label}</span>
                      {section.loading && <Loader2 size={14} className="spin s1-nav-spinner" />}
                      {section.content && !section.loading && <span className="s1-check">&#10003;</span>}
                    </button>
                  ))}

                  <div className="s1-nav-divider" />
                  <button
                    type="button"
                    className="s1-run-all-btn"
                    disabled={!filingEvidenceReady || runningAllAnalyses}
                    aria-busy={runningAllAnalyses}
                    onClick={() => void handleRunAllAnalyses()}
                  >
                    {runningAllAnalyses
                      ? <><Loader2 size={16} className="spin" /> Running Analyses...</>
                      : <><Rocket size={16} /> Run All Analyses</>}
                  </button>

                  <div className="s1-text-stats">
                    <FileText size={14} />
                    <span>{filingText.length > 0 ? `${(filingText.length / 1000).toFixed(0)}K chars loaded` : 'No text loaded'}</span>
                  </div>
                </div>

                {/* Analysis Content */}
                <div
                  id="ipo-analysis-panel"
                  className="s1-analysis-content glass-card"
                  role="tabpanel"
                  aria-labelledby={`ipo-analysis-tab-${activeAnalysisTab}`}
                >
                  <div className="s1-analysis-header">
                    <h3>{analyses[activeAnalysisTab]?.icon} {analyses[activeAnalysisTab]?.label}</h3>
                    {analyses[activeAnalysisTab]?.content && (
                      <button
                        type="button"
                        className="s1-rerun-btn"
                        onClick={() => runAnalysis(activeAnalysisTab)}
                        disabled={runningAllAnalyses || analyses[activeAnalysisTab]?.loading || !filingEvidenceReady}
                      >
                        Re-analyze
                      </button>
                    )}
                  </div>

                  <div className="s1-analysis-body">
                    {analyses[activeAnalysisTab]?.loading ? (
                      <div className="s1-analysis-loading">
                        <Loader2 size={28} className="spin" />
                        <p>Analyzing {analyses[activeAnalysisTab]?.label.toLowerCase()} with AI...</p>
                        <p className="s1-hint">This may take 10-30 seconds depending on filing length.</p>
                      </div>
                    ) : analyses[activeAnalysisTab]?.error ? (
                      <div className="s1-analysis-error" role="alert">
                        <AlertCircle size={32} aria-hidden="true" />
                        <h4>Analysis unavailable</h4>
                        <p>{analyses[activeAnalysisTab].error}</p>
                        <button type="button" className="secondary-btn" onClick={() => void runAnalysis(activeAnalysisTab)} disabled={runningAllAnalyses || !filingEvidenceReady}>
                          Retry {analyses[activeAnalysisTab]?.label}
                        </button>
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
                          type="button"
                          className="primary-btn"
                          onClick={() => runAnalysis(activeAnalysisTab)}
                          disabled={runningAllAnalyses || !filingEvidenceReady}
                        >
                          <Rocket size={16} /> Analyze {analyses[activeAnalysisTab]?.label}
                        </button>
                        {!filingEvidenceReady && (
                          <p className="s1-hint" style={{ marginTop: '8px' }}>
                            <AlertCircle size={14} /> {filingLoadError || 'Filing text must finish loading before analysis can run.'}
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
          <p>Track SEC-filed domestic and foreign IPO registrations, inspect activity, and analyze source filings.</p>
        </div>
        <button type="button" className="primary-btn sm" onClick={() => setAnalyzerOpen(true)}>
          <Rocket size={16}/> Open Registration Analyzer
        </button>
      </div>

      <div className="ipo-layout">
        <aside className="ipo-sidebar glass-card">
          <nav className="ipo-nav" role="tablist" aria-label="IPO Center sections" aria-orientation="vertical">
            <button
              type="button"
              id="ipo-tab-pipeline"
              role="tab"
              aria-selected={activeTab === 'pipeline'}
              aria-controls="ipo-panel-pipeline"
              tabIndex={activeTab === 'pipeline' ? 0 : -1}
              className={`nav-btn ${activeTab === 'pipeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('pipeline')}
              onKeyDown={event => handleWorkspaceTabKeyDown(event, 'pipeline')}
            >
              <Activity size={18} /> Global Pipeline
            </button>
            <button
              type="button"
              id="ipo-tab-benchmarking"
              role="tab"
              aria-selected={activeTab === 'benchmarking'}
              aria-controls="ipo-panel-benchmarking"
              tabIndex={activeTab === 'benchmarking' ? 0 : -1}
              className={`nav-btn ${activeTab === 'benchmarking' ? 'active' : ''}`}
              onClick={() => setActiveTab('benchmarking')}
              onKeyDown={event => handleWorkspaceTabKeyDown(event, 'benchmarking')}
            >
              <BarChart size={18} /> Live Feed Metrics
            </button>
            <button
              type="button"
              id="ipo-tab-drafting"
              role="tab"
              aria-selected={activeTab === 'drafting'}
              aria-controls="ipo-panel-drafting"
              tabIndex={activeTab === 'drafting' ? 0 : -1}
              className={`nav-btn ${activeTab === 'drafting' ? 'active' : ''}`}
              onClick={() => setActiveTab('drafting')}
              onKeyDown={event => handleWorkspaceTabKeyDown(event, 'drafting')}
            >
              <BookOpen size={18} /> Filing Activity
            </button>
          </nav>

          <div className="sidebar-widget">
            <h4>Market Pulse</h4>
            <div className="pulse-item">
              <div className="pulse-row">
                <span className="pulse-label">Recent S-1 Filings</span>
                <span className="badge" style={{ fontSize: '0.7rem' }}>EDGAR Live</span>
              </div>
              <p className="pulse-value">
                {pipelineLoading
                  ? '...'
                  : pipelineError
                    ? 'Unavailable'
                    : `${pipelineTotal.relation === 'gte' ? '≥' : ''}${pipelineTotal.value.toLocaleString()}`}{' '}
                <span className="pulse-sub">filings in the six-month SEC query</span>
              </p>
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
            <div id="ipo-panel-pipeline" className="tab-pane fade-in" role="tabpanel" aria-labelledby="ipo-tab-pipeline">
              <div className="pane-header">
                <div>
                  <h2>Recent IPO Registration Filings</h2>
                  <p className="pane-subtitle">Live feed of S-1, F-1, and 424B4 filings.</p>
                </div>
                <div className="pane-actions">
                  <button type="button" className="icon-btn" title="Save this search in the current browser" onClick={handlePipelineAlert}><Settings size={18} /> Save Local Search</button>
                  <button type="button" className="icon-btn" title="Export loaded SEC rows" onClick={handlePipelineExport} disabled={pipelineIPOs.length === 0}><Download size={18} /> Export CSV</button>
                </div>
              </div>

              <div role="status" aria-live="polite" className="pane-subtitle" style={{ marginBottom: '8px' }}>
                SEC EFTS query: {IPO_FORM_SCOPE} · {pipelineWindow.from || '—'} through {pipelineWindow.through || '—'} · {pipelineError
                  ? 'live counts are unavailable; no zero result is being asserted.'
                  : `showing ${pipelineIPOs.length.toLocaleString()} loaded filings of ${pipelineTotal.relation === 'gte' ? 'at least ' : ''}${pipelineTotal.value.toLocaleString()} total.`}
                {pipelineMessage ? ` ${pipelineMessage}` : ''}
              </div>

              <div className="ipo-table-container">
                {pipelineLoading ? (
                  <div className="text-muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', gap: '8px' }}>
                    <Loader2 size={16} className="spin" /> Loading recent S-1 filings from EDGAR...
                  </div>
                ) : pipelineError ? (
                  <div role="alert" className="text-muted" style={{ textAlign: 'center', padding: '28px' }}>
                    <p>{pipelineError}</p>
                    <button type="button" className="secondary-btn" onClick={() => void loadPipeline()}>Retry SEC feed</button>
                  </div>
                ) : pipelineIPOs.length === 0 ? (
                  <div className="text-muted" style={{ textAlign: 'center', padding: '28px' }}>
                    No IPO registration or 424B4 filings matched the six-month SEC query.
                  </div>
                ) : (
                <table className="ipo-table">
                  <caption>Loaded SEC IPO registration and final prospectus filings</caption>
                  <thead>
                    <tr>
                      <th scope="col">Issuer</th>
                      <th scope="col">Form</th>
                      <th scope="col">Filing Date</th>
                      <th scope="col">CIK</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineIPOs.map((ipo, idx) => (
                      <tr key={`${ipo.accessionNumber}-${idx}`}>
                        <td className="ipo-issuer">{ipo.company}</td>
                        <td><span className="ipo-ticker-badge">{ipo.formType}</span></td>
                        <td className="ipo-date">{ipo.fileDate}</td>
                        <td className="ipo-size">{ipo.cik || '—'}</td>
                        <td className="ipo-action-cell">
                          <button
                            type="button"
                            className="ipo-prospectus-link"
                            onClick={() => handlePipelineAnalyze(ipo)}
                          >
                            Analyze filing <ChevronRight size={14} />
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
            <div id="ipo-panel-benchmarking" className="tab-pane fade-in" role="tabpanel" aria-labelledby="ipo-tab-benchmarking">
              {pipelineError ? (
                <div role="alert" className="text-muted" style={{ textAlign: 'center', padding: '28px' }}>
                  <p>{pipelineError} Live-feed metrics are unavailable, not zero.</p>
                  <button type="button" className="secondary-btn" onClick={() => void loadPipeline()}>Retry SEC feed</button>
                </div>
              ) : (
              <>
              <div className="pane-header">
                <div>
                  <h2>Live Feed Metrics</h2>
                  <p className="pane-subtitle">Computed from the {pipelineIPOs.length} SEC filings currently loaded from the six-month query; not offering-pricing benchmarks.</p>
                </div>
              </div>

              <div className="benchmarking-grid">
                <div className="benchmark-card">
                  <h3 className="benchmark-title">Loaded Issuers</h3>
                  <div className="benchmark-value-row">
                    <span className="benchmark-big-value">{pipelineSummary.issuerCount.toLocaleString()}</span>
                    <span className="benchmark-change positive"><TrendingUp size={14} /> {pipelineIPOs.length.toLocaleString()} filings</span>
                  </div>
                  <p className="benchmark-note">Distinct issuer names in the loaded SEC result window. The authoritative query total is {pipelineTotal.relation === 'gte' ? 'at least ' : ''}{pipelineTotal.value.toLocaleString()} filings.</p>
                </div>

                <div className="benchmark-card">
                  <h3 className="benchmark-title">Form Distribution</h3>
                  <div className="lockup-items">
                    {pipelineSummary.formCounts.map(([form, count], index) => (
                      <div className="lockup-item" key={form}>
                        <div className="lockup-row">
                          <span>{form}</span>
                          <span className="lockup-pct">{count} · {pipelineIPOs.length > 0 ? ((count / pipelineIPOs.length) * 100).toFixed(1) : '0.0'}%</span>
                        </div>
                        <div className="benchmark-bar"><div className={`benchmark-bar-fill ${index % 2 === 0 ? 'blue' : 'purple'}`} style={{ width: `${pipelineIPOs.length > 0 ? (count / pipelineIPOs.length) * 100 : 0}%` }} /></div>
                      </div>
                    ))}
                    {pipelineSummary.formCounts.length === 0 && <p className="benchmark-note">No live rows are loaded.</p>}
                  </div>
                </div>
              </div>
              </>
              )}
            </div>
          )}

          {activeTab === 'drafting' && (
            <div id="ipo-panel-drafting" className="tab-pane fade-in" role="tabpanel" aria-labelledby="ipo-tab-drafting">
              {pipelineError ? (
                <div role="alert" className="text-muted" style={{ textAlign: 'center', padding: '28px' }}>
                  <p>{pipelineError} Filing activity is unavailable, not zero.</p>
                  <button type="button" className="secondary-btn" onClick={() => void loadPipeline()}>Retry SEC feed</button>
                </div>
              ) : (
              <>
              <div className="pane-header">
                <div>
                  <h2>IPO Filing Activity</h2>
                  <p className="pane-subtitle">Monthly counts derived from the currently loaded SEC filing sample, as of {pipelineWindow.through || '—'}.</p>
                </div>
              </div>

              <div className="drafting-trends">
                {pipelineSummary.monthCounts.map(([month, count]) => (
                  <div className="trend-card" key={month}>
                    <div className="trend-icon orange"><Clock size={24} /></div>
                    <div className="trend-content">
                      <h3>{month}</h3>
                      <p>{count.toLocaleString()} loaded S-1, F-1, amendment, or 424B4 filing{count === 1 ? '' : 's'}.</p>
                      <div className="trend-tags">
                        <span className="trend-tag">Loaded SEC sample</span>
                        <span className="trend-tag">{pipelineTotal.value.toLocaleString()} total query matches</span>
                      </div>
                    </div>
                  </div>
                ))}
                {pipelineSummary.monthCounts.length === 0 && (
                  <div className="text-muted" style={{ textAlign: 'center', padding: '28px' }}>No filing-activity rows are available.</div>
                )}
              </div>
              </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
