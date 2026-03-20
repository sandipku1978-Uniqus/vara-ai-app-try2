import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Bookmark, MessageSquare, ExternalLink, Columns, Highlighter, Settings2, Download, List, AlertCircle, FileText, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppState';
import { buildSecDocumentUrl, buildSecProxyUrl, fetchCompanySubmissions, fetchFilingText, type SecSubmission } from '../services/secApi';
import { createPrintWindow, renderCleanPrintView } from '../services/filingExport';
import { buildDisclosureDiff, downloadTextFile, extractTablesFromHtml, tablesToCsv, type DisclosureDiffSummary } from '../services/filingDetailTools';
import { buildHighlightTerms } from '../services/searchAssist';
import { clearDocumentHighlights, highlightDocumentSearchTerms } from '../services/filingHighlights';
import type { ResearchSearchMode } from '../services/filingResearch';
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
  highlightQuery?: string;
  highlightMode?: ResearchSearchMode;
  highlightSectionKeywords?: string;
}

interface ComparableFiling {
  accessionNumber: string;
  filingDate: string;
  formType: string;
  primaryDocument: string;
}

interface FilingAnnotation {
  id: string;
  quote: string;
  note: string;
  section: string | null;
  createdAt: string;
}

const ANNOTATIONS_STORAGE_KEY = 'vara.filing.annotations.v1';

function normalizeComparableForm(formType: string): string {
  return formType.trim().toUpperCase().replace(/\s+/g, '').replace(/\/A$/, '');
}

function toDateValue(value: string): number {
  const result = Date.parse(value);
  return Number.isNaN(result) ? 0 : result;
}

function loadAnnotations(filingId: string): FilingAnnotation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ANNOTATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, FilingAnnotation[]>;
    return parsed[filingId] || [];
  } catch {
    return [];
  }
}

function saveAnnotations(filingId: string, annotations: FilingAnnotation[]): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(ANNOTATIONS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, FilingAnnotation[]>) : {};
    parsed[filingId] = annotations;
    window.localStorage.setItem(ANNOTATIONS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore storage failures and keep notes in-memory.
  }
}

function pickPreviousComparableFiling(
  submissions: SecSubmission,
  currentAccession: string,
  currentFormType: string,
  currentFilingDate: string
): ComparableFiling | null {
  const recent = submissions.filings.recent;
  const targetForm = normalizeComparableForm(currentFormType);
  const currentDateValue = toDateValue(currentFilingDate);

  let bestMatch: ComparableFiling | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  recent.accessionNumber.forEach((accessionNumber, index) => {
    if (accessionNumber === currentAccession) return;

    const filingDate = recent.filingDate[index] || '';
    const formType = recent.form[index] || '';
    const primaryDocument = recent.primaryDocument[index] || '';
    if (!filingDate || !primaryDocument) return;
    if (normalizeComparableForm(formType) !== targetForm) return;

    const candidateDateValue = toDateValue(filingDate);
    if (!candidateDateValue || !currentDateValue || candidateDateValue >= currentDateValue) {
      return;
    }

    const daysApart = Math.abs(currentDateValue - candidateDateValue) / (1000 * 60 * 60 * 24);
    const score = Math.abs(daysApart - 365);
    if (score < bestScore) {
      bestScore = score;
      bestMatch = {
        accessionNumber,
        filingDate,
        formType,
        primaryDocument,
      };
    }
  });

  return bestMatch;
}

export default function FilingDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    addToWatchlist,
    setChatOpen,
    setCurrentFilingContext,
    setCurrentFilingSections,
    pendingFilingSectionLabel,
    setPendingFilingSectionLabel,
  } = useApp();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentHtmlRef = useRef<string | null>(null);
  const currentTextRef = useRef<string | null>(null);
  const routeState = (location.state as FilingRouteState | null) || null;
  const highlightTerms = useMemo(
    () => buildHighlightTerms(routeState?.highlightQuery || '', routeState?.highlightMode || 'semantic', routeState?.highlightSectionKeywords || ''),
    [routeState?.highlightMode, routeState?.highlightQuery, routeState?.highlightSectionKeywords]
  );

  const id = location.pathname.replace(/^\/filing\//, '');

  const [showSidebar, setShowSidebar] = useState(true);
  const [redlineMode, setRedlineMode] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'toc'|'metadata'|'tools'>('toc');
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
  const [extractingTables, setExtractingTables] = useState(false);
  const [toolMessage, setToolMessage] = useState('');
  const [companyTickers, setCompanyTickers] = useState<string[]>([]);
  const [iframeLoadedToken, setIframeLoadedToken] = useState(0);
  const [annotations, setAnnotations] = useState<FilingAnnotation[]>(() => loadAnnotations(id));
  const [selectedQuote, setSelectedQuote] = useState('');
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [redlineLoading, setRedlineLoading] = useState(false);
  const [redlineError, setRedlineError] = useState('');
  const [comparedFiling, setComparedFiling] = useState<ComparableFiling | null>(null);
  const [redlineSummary, setRedlineSummary] = useState<DisclosureDiffSummary | null>(null);

  useEffect(() => {
    currentHtmlRef.current = null;
    currentTextRef.current = null;
    setAnnotations(loadAnnotations(id));
    setSelectedQuote('');
    setAnnotationDraft('');
    setToolMessage('');
    setRedlineError('');
    setComparedFiling(null);
    setRedlineSummary(null);
  }, [id]);

  useEffect(() => {
    saveAnnotations(id, annotations);
  }, [annotations, id]);

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
        auditor: filingMeta.auditor || '',
      });
    }
    return () => {
      setCurrentFilingContext(null);
      setCurrentFilingSections([]);
    };
  }, [filingMeta.auditor, filingMeta.companyName, filingMeta.filingDate, filingMeta.formType, id, setCurrentFilingContext, setCurrentFilingSections]);

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

  const fetchCurrentFilingHtml = useCallback(async (): Promise<string> => {
    if (currentHtmlRef.current) {
      return currentHtmlRef.current;
    }

    const response = await fetch(buildSecProxyUrl(`Archives/edgar/data/${cik}/${formattedAccession}/${primaryDoc}`));
    if (!response.ok) {
      throw new Error(`Unable to fetch filing HTML (${response.status})`);
    }

    const html = await response.text();
    currentHtmlRef.current = html;
    return html;
  }, [cik, formattedAccession, primaryDoc]);

  const fetchCurrentFilingText = useCallback(async (): Promise<string> => {
    if (currentTextRef.current) {
      return currentTextRef.current;
    }

    const text = await fetchFilingText(cik, accession, primaryDoc);
    currentTextRef.current = text;
    return text;
  }, [accession, cik, primaryDoc]);

  const handleAddToWatchlist = useCallback(() => {
    const ticker = companyTickers[0];
    if (!ticker) {
      setToolMessage('No ticker symbol is attached to this filing yet, so there is nothing to save to the watchlist.');
      return;
    }

    addToWatchlist(ticker);
    setToolMessage(`${ticker} was added to your watchlist.`);
  }, [addToWatchlist, companyTickers]);

  const handleSaveAnnotation = useCallback(() => {
    if (!selectedQuote.trim() || !annotationDraft.trim()) {
      setToolMessage('Select text in the filing and add a note before saving an annotation.');
      return;
    }

    setAnnotations(prev => [
      {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        quote: selectedQuote.trim(),
        note: annotationDraft.trim(),
        section: activeSection,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setAnnotationDraft('');
    setSelectedQuote('');
    setToolMessage('Annotation saved locally for this filing.');
  }, [activeSection, annotationDraft, selectedQuote]);

  const handleRemoveAnnotation = useCallback((annotationId: string) => {
    setAnnotations(prev => prev.filter(note => note.id !== annotationId));
  }, []);

  const handleTableExtract = useCallback(async () => {
    setExtractingTables(true);
    setToolMessage('');
    try {
      const html = await fetchCurrentFilingHtml();
      const tables = extractTablesFromHtml(html);
      if (tables.length === 0) {
        setToolMessage('No structured HTML tables were found in this filing.');
        return;
      }

      const csv = tablesToCsv(tables);
      const fileStub = (filingMeta.companyName || primaryDoc)
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
      downloadTextFile(`${fileStub || 'filing'}-tables.csv`, csv, 'text/csv;charset=utf-8');
      setToolMessage(`Downloaded ${tables.length} table${tables.length === 1 ? '' : 's'} as CSV.`);
      setActiveTab('tools');
    } catch (error) {
      console.error('Table extraction failed:', error);
      setToolMessage('Unable to extract filing tables right now.');
    } finally {
      setExtractingTables(false);
    }
  }, [fetchCurrentFilingHtml, filingMeta.companyName, primaryDoc]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateMetadata() {
      const submissions = await fetchCompanySubmissions(cik);
      if (!submissions || cancelled) return;

      setCompanyTickers(submissions.tickers || []);

      if (routeState?.companyName && routeState?.filingDate && routeState?.formType) {
        return;
      }

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
        setCurrentFilingSections(entries);
        setTocLoading(false);
        setIframeLoadedToken(prev => prev + 1);
      }
    } catch {
      // Cross-origin — can't inspect. TOC unavailable.
      setTocEntries([]);
      setCurrentFilingSections([]);
      setTocLoading(false);
    }
  }, [parseToc, setCurrentFilingSections]);

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

  useEffect(() => {
    if (!annotationMode) {
      return;
    }

    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    const captureSelection = () => {
      const selection = doc.getSelection?.();
      const text = selection?.toString().replace(/\s+/g, ' ').trim() || '';
      if (text.length < 16) {
        return;
      }

      setSelectedQuote(text.slice(0, 800));
      setActiveTab('tools');
    };

    doc.addEventListener('mouseup', captureSelection);
    doc.addEventListener('keyup', captureSelection);
    return () => {
      doc.removeEventListener('mouseup', captureSelection);
      doc.removeEventListener('keyup', captureSelection);
    };
  }, [annotationMode, iframeLoadedToken]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    clearDocumentHighlights(doc);
    if (highlightTerms.length === 0) return;

    const marks = highlightDocumentSearchTerms(doc, highlightTerms);
    if (marks.length > 0) {
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightTerms, iframeLoadedToken]);

  useEffect(() => {
    if (!pendingFilingSectionLabel || tocEntries.length === 0) return;

    const match = tocEntries.find(entry =>
      entry.label.toLowerCase() === pendingFilingSectionLabel.toLowerCase() ||
      entry.label.toLowerCase().includes(pendingFilingSectionLabel.toLowerCase()) ||
      pendingFilingSectionLabel.toLowerCase().includes(entry.label.toLowerCase())
    );

    if (!match) return;

    scrollToSection(match);
    setPendingFilingSectionLabel(null);
  }, [pendingFilingSectionLabel, scrollToSection, setPendingFilingSectionLabel, tocEntries]);

  useEffect(() => {
    if (!redlineMode || redlineSummary || redlineLoading || redlineError) {
      return;
    }

    if (!filingMeta.formType || !filingMeta.filingDate) {
      return;
    }

    let cancelled = false;

    async function loadRedlineSummary() {
      setRedlineLoading(true);
      setRedlineError('');
      setToolMessage('');

      try {
        const submissions = await fetchCompanySubmissions(cik);
        if (!submissions || cancelled) {
          return;
        }

        const previousFiling = pickPreviousComparableFiling(
          submissions,
          accession,
          filingMeta.formType || '',
          filingMeta.filingDate || ''
        );

        if (!previousFiling) {
          if (!cancelled) {
            setComparedFiling(null);
            setRedlineSummary(null);
            setRedlineError('No comparable prior filing was found to build a year-over-year redline.');
          }
          return;
        }

        const [currentText, previousText] = await Promise.all([
          fetchCurrentFilingText(),
          fetchFilingText(cik, previousFiling.accessionNumber, previousFiling.primaryDocument),
        ]);

        if (cancelled) {
          return;
        }

        if (!currentText || !previousText) {
          setComparedFiling(previousFiling);
          setRedlineSummary(null);
          setRedlineError('Unable to retrieve both filings needed for a redline comparison.');
          return;
        }

        setComparedFiling(previousFiling);
        setRedlineSummary(buildDisclosureDiff(currentText, previousText));
        setActiveTab('tools');
      } catch (error) {
        console.error('Redline load failed:', error);
        if (!cancelled) {
          setComparedFiling(null);
          setRedlineSummary(null);
          setRedlineError('Unable to generate the year-over-year redline right now.');
        }
      } finally {
        if (!cancelled) {
          setRedlineLoading(false);
        }
      }
    }

    void loadRedlineSummary();

    return () => {
      cancelled = true;
    };
  }, [accession, cik, fetchCurrentFilingText, filingMeta.filingDate, filingMeta.formType, redlineError, redlineLoading, redlineMode, redlineSummary]);

  const handleCleanPdfExport = useCallback(async () => {
    setExportingPdf(true);
    const title = `${filingMeta.companyName || 'SEC Filing'} ${filingMeta.formType || primaryDoc}`;
    const printWindow = createPrintWindow(title);
    if (!printWindow) {
      setExportingPdf(false);
      setToolMessage('Your browser blocked the print window. Please allow pop-ups for PDF export.');
      return;
    }

    try {
      const html = await fetchCurrentFilingHtml();
      renderCleanPrintView(printWindow, title, html, secUrl);
      setToolMessage('Opened a clean print view. Use your browser print dialog to save the filing as PDF.');
    } catch (error) {
      console.error('Clean PDF export failed:', error);
      printWindow.close();
      setToolMessage('Unable to create the clean print view for this filing.');
    } finally {
      setExportingPdf(false);
    }
  }, [fetchCurrentFilingHtml, filingMeta.companyName, filingMeta.formType, primaryDoc, secUrl]);

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
              onClick={() => {
                const next = !redlineMode;
                setRedlineMode(next);
                if (next) {
                  setRedlineError('');
                  setComparedFiling(null);
                  setRedlineSummary(null);
                }
                setActiveTab('tools');
              }}
              title="Compare to Previous Year (Redline)"
            >
              <Columns size={16} /> YoY Redline
            </button>
            <button
              className={`tool-btn ${annotationMode ? 'active' : ''}`}
              title="Capture selected text and save notes"
              onClick={() => {
                setAnnotationMode(prev => !prev);
                setActiveTab('tools');
                setToolMessage(
                  !annotationMode
                    ? 'Annotation mode is on. Select text inside the filing, then add your note in the Tools tab.'
                    : 'Annotation mode is off.'
                );
              }}
            >
              <Highlighter size={16} /> Annotate
            </button>
            <button className="tool-btn" title="Extract Financial Tables to CSV" onClick={() => void handleTableExtract()} disabled={extractingTables}>
              {extractingTables ? <Loader2 size={16} className="spinner" /> : <Download size={16} />} Extract Tables
            </button>
            <button className="tool-btn" title="Open a clean print view for PDF export" onClick={() => void handleCleanPdfExport()} disabled={exportingPdf}>
              {exportingPdf ? <Loader2 size={16} className="spinner" /> : <Download size={16} />} Print / Save PDF
            </button>
          </div>
        </div>

        <div className="header-actions">
          <button className="icon-btn" title="Save to Watchlist" onClick={handleAddToWatchlist}><Bookmark size={18} /></button>
          <a href={secUrl} target="_blank" rel="noreferrer" className="icon-btn" title="Open in SEC.gov"><ExternalLink size={18} /></a>
          <button
            className={`icon-btn ${showSidebar ? 'active-icon' : ''}`}
            onClick={() => setShowSidebar(!showSidebar)}
            title="Toggle Right Panel"
          >
            <Settings2 size={18} />
          </button>
          <button className="primary-btn sm ml-2" onClick={() => setChatOpen(true)}>
            <MessageSquare size={16} /> Ask Claude
          </button>
        </div>
      </div>

      <div className="filing-layout">

        {/* Main Document Viewer */}
        <div className={`document-viewer glass-card ${redlineMode ? 'redline-active' : ''}`}>
          {redlineMode && (
            <div className="redline-banner">
              <AlertCircle size={16} className="text-orange" />
              <span>
                Year-over-year redline mode compares this filing against the closest prior comparable filing and summarizes added versus removed disclosure blocks.
              </span>
            </div>
          )}
          {toolMessage && (
            <div className="tool-status-banner">
              {toolMessage}
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
              <button className={activeTab === 'tools' ? 'active' : ''} onClick={() => setActiveTab('tools')}>
                Tools
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

              {activeTab === 'tools' && (
                <div className="related-panel">
                  <h4>Workflow Tools</h4>

                  <div className="tool-panel-card">
                    <div className="tool-panel-header">
                      <span className="type">Redline</span>
                      <span className="desc">{redlineMode ? 'Active' : 'Off'}</span>
                    </div>
                    {!redlineMode ? (
                      <p className="tool-panel-copy">Turn on YoY Redline above to compare this filing against the closest prior comparable filing.</p>
                    ) : redlineLoading ? (
                      <div className="tool-loading"><Loader2 size={16} className="toc-spinner" /> Building comparison...</div>
                    ) : redlineError ? (
                      <p className="tool-panel-copy">{redlineError}</p>
                    ) : redlineSummary && comparedFiling ? (
                      <div className="tool-panel-stack">
                        <p className="tool-panel-copy">
                          Comparing against {comparedFiling.formType} filed on {comparedFiling.filingDate}.
                        </p>
                        <div className="tool-metric-grid">
                          <div className="tool-metric">
                            <span className="tool-metric-label">Added blocks</span>
                            <strong>{redlineSummary.addedCount}</strong>
                          </div>
                          <div className="tool-metric">
                            <span className="tool-metric-label">Removed blocks</span>
                            <strong>{redlineSummary.removedCount}</strong>
                          </div>
                          <div className="tool-metric">
                            <span className="tool-metric-label">Retained blocks</span>
                            <strong>{redlineSummary.retainedCount}</strong>
                          </div>
                        </div>

                        {redlineSummary.addedBlocks.length > 0 && (
                          <div>
                            <h4 className="tool-subheading">Current-only disclosure blocks</h4>
                            {redlineSummary.addedBlocks.map((block, index) => (
                              <div key={`added-${index}`} className="related-card tool-positive-card">
                                <span className="desc">{block}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {redlineSummary.removedBlocks.length > 0 && (
                          <div>
                            <h4 className="tool-subheading">Prior-only disclosure blocks</h4>
                            {redlineSummary.removedBlocks.map((block, index) => (
                              <div key={`removed-${index}`} className="related-card comment-letter">
                                <span className="desc">{block}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="tool-panel-copy">No comparison summary is available yet.</p>
                    )}
                  </div>

                  <div className="tool-panel-card">
                    <div className="tool-panel-header">
                      <span className="type">Annotations</span>
                      <span className="desc">{annotationMode ? 'Selection capture on' : 'Selection capture off'}</span>
                    </div>
                    <p className="tool-panel-copy">
                      Select text inside the filing viewer while annotation mode is on, then save your note below.
                    </p>
                    {selectedQuote && (
                      <div className="annotation-draft">
                        <span className="annotation-label">Selected text</span>
                        <blockquote>{selectedQuote}</blockquote>
                        <textarea
                          value={annotationDraft}
                          onChange={event => setAnnotationDraft(event.target.value)}
                          placeholder="Add your note, issue framing, or follow-up..."
                        />
                        <div className="annotation-actions">
                          <button className="secondary-btn" onClick={handleSaveAnnotation}>Save Note</button>
                          <button
                            className="secondary-btn"
                            onClick={() => {
                              setSelectedQuote('');
                              setAnnotationDraft('');
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="tool-panel-stack">
                      {annotations.length === 0 ? (
                        <p className="tool-panel-copy">No annotations saved for this filing yet.</p>
                      ) : (
                        annotations.map(note => (
                          <div key={note.id} className="related-card">
                            <span className="type">{note.section || 'General note'}</span>
                            <span className="desc annotation-quote">{note.quote}</span>
                            <span className="desc">{note.note}</span>
                            <div className="annotation-meta">
                              <span>{new Date(note.createdAt).toLocaleString()}</span>
                              <button className="annotation-link" onClick={() => handleRemoveAnnotation(note.id)}>Remove</button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="tool-panel-card">
                    <div className="tool-panel-header">
                      <span className="type">Exports</span>
                      <span className="desc">Current filing</span>
                    </div>
                    <p className="tool-panel-copy">
                      Use Extract Tables to download HTML tables as CSV, or Print / Save PDF to open a print-friendly filing view.
                    </p>
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
