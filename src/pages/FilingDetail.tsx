import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Bookmark, MessageSquare, ExternalLink, Columns, Highlighter, Settings2, Download, List, AlertCircle, FileText, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppState';
import { buildSecDocumentUrl, buildSecProxyUrl, fetchCompanySubmissions } from '../services/secApi';
import { openCleanPrintView } from '../services/filingExport';
import './FilingDetail.css';

interface TocEntry {
  label: string;
  elementId: string | null;
  anchorName: string | null;
}

interface FilingRouteState {
  companyName?: string;
  filingDate?: string;
  formType?: string;
  fileNumber?: string;
  auditor?: string;
}

export default function FilingDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setChatOpen, setCurrentFilingContext } = useApp();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const routeState = (location.state as FilingRouteState | null) || null;

  const id = location.pathname.replace(/^\/filing\//, '');

  const [showSidebar, setShowSidebar] = useState(true);
  const [redlineMode, setRedlineMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'toc'|'metadata'|'related'>('toc');
  const [iframeError, setIframeError] = useState(false);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [filingMeta, setFilingMeta] = useState<FilingRouteState>({
    companyName: routeState?.companyName || '',
    filingDate: routeState?.filingDate || '',
    formType: routeState?.formType || '',
    fileNumber: routeState?.fileNumber || '',
    auditor: routeState?.auditor || '',
  });
  const [exportingPdf, setExportingPdf] = useState(false);

  // Set filing context for AI chat panel
  useEffect(() => {
    if (id && id.includes('_')) {
      const p = id.split('_');
      setCurrentFilingContext({
        cik: p[0],
        accessionNumber: p[1],
        primaryDocument: p.slice(2).join('_'),
        companyName: filingMeta.companyName || '',
        formType: filingMeta.formType || '',
        filingDate: filingMeta.filingDate || '',
      });
    }
    return () => { setCurrentFilingContext(null); };
  }, [filingMeta.companyName, filingMeta.filingDate, filingMeta.formType, id, setCurrentFilingContext]);

  if (!id || !id.includes('_')) {
    return (
      <div className="p-8 text-center text-white" style={{ marginTop: '100px' }}>
        <h2>Invalid Filing ID Format.</h2>
        <p>Expected: CIK_Accession_Document</p>
        <button onClick={() => navigate('/search')} className="mt-4 primary-btn">Back to Search</button>
      </div>
    );
  }

  const parts = id.split('_');
  const cik = parts[0];
  const accession = parts[1];
  const primaryDoc = parts.slice(2).join('_');

  const secUrl = buildSecDocumentUrl(cik, accession, primaryDoc);
  const formattedAccession = accession.replace(/-/g, '');

  useEffect(() => {
    let cancelled = false;

    async function hydrateMetadata() {
      if (routeState?.companyName && routeState?.filingDate && routeState?.formType) {
        return;
      }

      const submissions = await fetchCompanySubmissions(cik);
      if (!submissions || cancelled) return;

      const recent = submissions.filings.recent;
      const matchIndex = recent.accessionNumber.findIndex(item => item === accession);
      if (matchIndex === -1) return;

      setFilingMeta(prev => ({
        companyName: prev.companyName || submissions.name || '',
        filingDate: prev.filingDate || recent.filingDate[matchIndex] || '',
        formType: prev.formType || recent.form[matchIndex] || '',
        fileNumber: prev.fileNumber || recent.fileNumber[matchIndex] || '',
        auditor: prev.auditor || '',
      }));
    }

    void hydrateMetadata();
    return () => {
      cancelled = true;
    };
  }, [accession, cik, routeState]);

  // Patterns that identify section headers in SEC filings
  const SECTION_PATTERNS = [
    // 10-K / 10-Q Items
    { re: /^item\s+1[^a-z0-9]/i, label: 'Item 1. Business' },
    { re: /^item\s+1a/i, label: 'Item 1A. Risk Factors' },
    { re: /^item\s+1b/i, label: 'Item 1B. Unresolved Staff Comments' },
    { re: /^item\s+1c/i, label: 'Item 1C. Cybersecurity' },
    { re: /^item\s+2[^0-9]/i, label: 'Item 2. Properties' },
    { re: /^item\s+3[^0-9]/i, label: 'Item 3. Legal Proceedings' },
    { re: /^item\s+4[^0-9]/i, label: 'Item 4. Mine Safety' },
    { re: /^item\s+5[^0-9]/i, label: 'Item 5. Market for Registrant' },
    { re: /^item\s+6[^0-9]/i, label: 'Item 6. Reserved' },
    { re: /^item\s+7[^a-z0-9]/i, label: 'Item 7. MD&A' },
    { re: /^item\s+7a/i, label: 'Item 7A. Quantitative Disclosures' },
    { re: /^item\s+8[^0-9]/i, label: 'Item 8. Financial Statements' },
    { re: /^item\s+9[^a-z0-9]/i, label: 'Item 9. Changes in Accountants' },
    { re: /^item\s+9a/i, label: 'Item 9A. Controls & Procedures' },
    { re: /^item\s+9b/i, label: 'Item 9B. Other Information' },
    { re: /^item\s+10[^0-9]/i, label: 'Item 10. Directors & Governance' },
    { re: /^item\s+11[^0-9]/i, label: 'Item 11. Executive Compensation' },
    { re: /^item\s+12[^0-9]/i, label: 'Item 12. Security Ownership' },
    { re: /^item\s+13[^0-9]/i, label: 'Item 13. Related Transactions' },
    { re: /^item\s+14[^0-9]/i, label: 'Item 14. Principal Accountant Fees' },
    { re: /^item\s+15[^0-9]/i, label: 'Item 15. Exhibits' },
    { re: /signatures?/i, label: 'Signatures' },
    // S-1 sections
    { re: /^prospectus summary/i, label: 'Prospectus Summary' },
    { re: /^risk factors/i, label: 'Risk Factors' },
    { re: /^use of proceeds/i, label: 'Use of Proceeds' },
    { re: /^dividend policy/i, label: 'Dividend Policy' },
    { re: /^capitalization/i, label: 'Capitalization' },
    { re: /^dilution/i, label: 'Dilution' },
    { re: /^business$/i, label: 'Business' },
    { re: /^management/i, label: 'Management' },
    { re: /^underwriting/i, label: 'Underwriting' },
    { re: /^financial statements/i, label: 'Financial Statements' },
  ];

  const parseToc = useCallback((doc: Document) => {
    const entries: TocEntry[] = [];
    const seen = new Set<string>();

    // Strategy 1: Find internal TOC hyperlinks (<a href="#..."> whose text matches section patterns).
    // SEC filings have a Table of Contents where each row is a link pointing to the actual section anchor.
    // Recording the href target ensures we scroll to the real section, not a TOC row.
    const tocLinks = Array.from(doc.querySelectorAll('a[href^="#"]'));
    for (const link of tocLinks) {
      const href = link.getAttribute('href') || '';
      const anchorTarget = href.replace(/^#/, '');
      if (!anchorTarget) continue;
      const text = (link.textContent || '').trim();
      if (text.length < 3 || text.length > 120) continue;

      for (const pattern of SECTION_PATTERNS) {
        if (pattern.re.test(text) && !seen.has(pattern.label)) {
          seen.add(pattern.label);
          entries.push({ label: pattern.label, elementId: null, anchorName: anchorTarget });
          break;
        }
      }
    }

    // Strategy 2: Scan headings and bold elements for section titles (fallback for filings without TOC links)
    if (entries.length === 0) {
      const candidates = Array.from(doc.querySelectorAll('h1, h2, h3, h4, b, strong, p, div'));
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        if (text.length < 3 || text.length > 120) continue;

        for (const pattern of SECTION_PATTERNS) {
          if (pattern.re.test(text) && !seen.has(pattern.label)) {
            seen.add(pattern.label);
            if (!el.id) el.id = `toc-sec-${entries.length}`;
            entries.push({ label: pattern.label, elementId: el.id, anchorName: null });
            break;
          }
        }
      }
    }

    return entries;
  }, []);

  const handleIframeLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const frame = e.target as HTMLIFrameElement;
    try {
      if (frame.contentDocument?.body?.innerHTML === '') {
        setIframeError(true);
        return;
      }
      // Parse TOC from the loaded document
      if (frame.contentDocument) {
        setTocLoading(true);
        const entries = parseToc(frame.contentDocument);
        setTocEntries(entries);
        setTocLoading(false);
      }
    } catch {
      // Cross-origin — can't inspect. TOC unavailable.
      setTocEntries([]);
      setTocLoading(false);
    }
  }, [parseToc]);

  const scrollToSection = useCallback((entry: TocEntry) => {
    const frame = iframeRef.current;
    if (!frame?.contentDocument) return;

    setActiveSection(entry.label);

    let target: Element | null = null;

    if (entry.anchorName) {
      target = frame.contentDocument.querySelector(`a[name="${entry.anchorName}"], a[id="${entry.anchorName}"], [id="${entry.anchorName}"]`);
    }
    if (!target && entry.elementId) {
      target = frame.contentDocument.getElementById(entry.elementId);
    }

    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleCleanPdfExport = useCallback(async () => {
    setExportingPdf(true);
    try {
      const response = await fetch(buildSecProxyUrl(`Archives/edgar/data/${cik}/${formattedAccession}/${primaryDoc}`));
      if (!response.ok) {
        throw new Error(`Unable to fetch filing HTML (${response.status})`);
      }
      const html = await response.text();
      openCleanPrintView(
        `${filingMeta.companyName || 'SEC Filing'} ${filingMeta.formType || primaryDoc}`,
        html,
        secUrl
      );
    } catch (error) {
      console.error('Clean PDF export failed:', error);
      alert('Unable to create the clean print view for this filing.');
    } finally {
      setExportingPdf(false);
    }
  }, [cik, filingMeta.companyName, filingMeta.formType, formattedAccession, primaryDoc, secUrl]);

  return (
    <div className="filing-detail-container">
      {/* Top action bar */}
      <div className="filing-header-bar glass-card">
        <div className="header-left">
          <button className="back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} /> Back
          </button>
          <div className="header-metadata">
            <span className="metadata-badge live">SEC EDGAR LIVE</span>
            <span className="metadata-badge type">CIK: {cik}</span>
            <span className="text-muted text-sm">Acc: {formattedAccession}</span>
          </div>
        </div>

        <div className="header-center-tools">
          <div className="tool-toggle-group">
            <button
              className={`tool-btn ${redlineMode ? 'active' : ''}`}
              onClick={() => setRedlineMode(!redlineMode)}
              title="Compare to Previous Year (Redline)"
            >
              <Columns size={16} /> YoY Redline
            </button>
            <button className="tool-btn" title="Highlight Text" onClick={() => alert('Annotation mode: Select text in the document to highlight and add notes.')}>
              <Highlighter size={16} /> Annotate
            </button>
            <button className="tool-btn" title="Extract Financial Tables to CSV" onClick={() => alert('Table Extraction: In production, this parses XBRL-tagged financial tables from the filing and exports them as a downloadable CSV file.')}>
              <Download size={16} /> Extract Tables
            </button>
            <button className="tool-btn" title="Open a clean print view for PDF export" onClick={() => void handleCleanPdfExport()} disabled={exportingPdf}>
              {exportingPdf ? <Loader2 size={16} className="spinner" /> : <Download size={16} />} Print / Save PDF
            </button>
          </div>
        </div>

        <div className="header-actions">
          <button className="icon-btn" title="Save to Watchlist"><Bookmark size={18} /></button>
          <a href={secUrl} target="_blank" rel="noreferrer" className="icon-btn" title="Open in SEC.gov"><ExternalLink size={18} /></a>
          <button
            className={`icon-btn ${showSidebar ? 'active-icon' : ''}`}
            onClick={() => setShowSidebar(!showSidebar)}
            title="Toggle Right Panel"
          >
            <Settings2 size={18} />
          </button>
          <button className="primary-btn sm ml-2" onClick={() => setChatOpen(true)}>
            <MessageSquare size={16} /> Ask Gemini
          </button>
        </div>
      </div>

      <div className="filing-layout">

        {/* Main Document Viewer */}
        <div className={`document-viewer glass-card ${redlineMode ? 'redline-active' : ''}`}>
          {redlineMode && (
            <div className="redline-banner">
              <AlertCircle size={16} className="text-orange" />
              <span>Year-over-Year Redline Mode Active. Deletions in <span className="text-red-400">red</span>, additions in <span className="text-green-400">green</span>.</span>
            </div>
          )}
          <div className="doc-header-nav">
            <h3 className="doc-title">{primaryDoc}</h3>
            <a href={secUrl} target="_blank" rel="noreferrer" className="icon-btn text-muted" title="Open on SEC.gov"><ExternalLink size={16}/></a>
          </div>
          {primaryDoc.endsWith('.xml') || iframeError ? (
            <div className="iframe-fallback">
              <FileText size={48} style={{ color: 'var(--accent-blue)', marginBottom: '16px' }} />
              <h3>This document cannot be previewed inline</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', maxWidth: '400px' }}>
                {primaryDoc.endsWith('.xml')
                  ? 'XML-based filings (Forms 3, 4, 5) use XSLT stylesheets that require the SEC viewer to render properly.'
                  : 'The document failed to load in the embedded viewer.'}
              </p>
              <a href={secUrl} target="_blank" rel="noreferrer" className="primary-btn" style={{ textDecoration: 'none' }}>
                <ExternalLink size={16} /> View on SEC.gov
              </a>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={buildSecProxyUrl(`Archives/edgar/data/${cik}/${formattedAccession}/${primaryDoc}`)}
              title="SEC Document View"
              className="sec-iframe"
              onError={() => setIframeError(true)}
              onLoad={handleIframeLoad}
            />
          )}
        </div>

        {/* Right Sidebar */}
        {showSidebar && (
          <aside className="filing-sidebar glass-card">
            <div className="sidebar-tabs">
              <button className={activeTab === 'toc' ? 'active' : ''} onClick={() => setActiveTab('toc')}>
                <List size={16} /> TOC
              </button>
              <button className={activeTab === 'metadata' ? 'active' : ''} onClick={() => setActiveTab('metadata')}>
                Details
              </button>
              <button className={activeTab === 'related' ? 'active' : ''} onClick={() => setActiveTab('related')}>
                Related
              </button>
            </div>

            <div className="sidebar-content scrollable">
              {activeTab === 'toc' && (
                <div className="toc-panel">
                  <h4>Document Sections</h4>
                  {tocLoading ? (
                    <div className="toc-loading">
                      <Loader2 size={16} className="toc-spinner" />
                      <span>Parsing sections...</span>
                    </div>
                  ) : tocEntries.length > 0 ? (
                    <ul className="toc-list">
                      {tocEntries.map((entry, i) => (
                        <li key={i}>
                          <button
                            className={activeSection === entry.label ? 'toc-active' : ''}
                            onClick={() => scrollToSection(entry)}
                            title={`Jump to ${entry.label}`}
                          >
                            {entry.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="toc-empty">
                      <p>Sections will appear once the document loads.</p>
                      <p className="toc-hint">For documents that cannot be previewed inline, use the SEC.gov viewer.</p>
                    </div>
                  )}
                  <div className="xbrl-hint">
                    <p>Sections are parsed automatically from the filing HTML.</p>
                  </div>
                </div>
              )}

              {activeTab === 'metadata' && (
                <div className="metadata-panel">
                  <div className="meta-row">
                    <span className="meta-label">Company</span>
                    <span className="meta-value">{filingMeta.companyName || 'Loading...'}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Filing Date</span>
                    <span className="meta-value">{filingMeta.filingDate || 'Loading...'}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Form Type</span>
                    <span className="meta-value">{filingMeta.formType || 'Loading...'}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Accession</span>
                    <span className="meta-value" style={{wordBreak: 'break-all'}}>{formattedAccession}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">File Number</span>
                    <span className="meta-value">{filingMeta.fileNumber || 'â€”'}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Auditor</span>
                    <span className="meta-value">{filingMeta.auditor || 'Not captured yet'}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">CIK</span>
                    <span className="meta-value">{cik}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Document</span>
                    <span className="meta-value" style={{wordBreak: 'break-all', fontSize: '0.8rem'}}>{primaryDoc}</span>
                  </div>
                </div>
              )}

              {activeTab === 'related' && (
                <div className="related-panel">
                  <h4>Associated Documents</h4>
                  <div className="related-card">
                    <span className="type">EX-99.1</span>
                    <span className="desc">Press Release</span>
                  </div>
                  <div className="related-card">
                    <span className="type">EX-10.1</span>
                    <span className="desc">Material Agreement</span>
                  </div>

                  <h4 className="mt-6">SEC Comment Letters</h4>
                  <div className="related-card comment-letter">
                    <span className="type text-orange">UPLOAD</span>
                    <span className="desc">SEC Correspondence (None found for this specific accession)</span>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
