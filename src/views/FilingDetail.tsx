'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';

import { ArrowLeft, Bookmark, MessageSquare, ExternalLink, Columns, Highlighter, Settings2, Download, List, AlertCircle, FileText, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppState';
import { BRAND } from '../config/brand';
import { buildSecDocumentUrl, buildSecProxyUrl, fetchCompanySubmissions, fetchFilingText, type SecSubmission } from '../services/secApi';
import { createPrintWindow, renderCleanPrintView } from '../services/filingExport';
import { buildDisclosureDiff, downloadTextFile, extractTablesFromHtml, tablesToCsv, type DisclosureDiffSummary } from '../services/filingDetailTools';
import { aiSummarizeRedline } from '../services/aiApi';
import { TextDiffViewer } from '../components/research/TextDiffViewer';
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
  originatingSearchSessionId?: string | null;
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
const REDLINE_SUMMARY_CACHE = new Map<string, { comparedFiling: ComparableFiling; summary: DisclosureDiffSummary; aiSummary: string | null }>();

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
  const location = usePathname();
  const navigate = useRouter();
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
  
  // NOTE: Next.js doesn't support complex state in URL routing natively via usePathname
  // We extract ID from the pathname simply.
  const routeState = null as FilingRouteState | null;
  const highlightTerms = useMemo(
    () => buildHighlightTerms(routeState?.highlightQuery || '', routeState?.highlightMode || 'semantic', routeState?.highlightSectionKeywords || ''),
    [routeState?.highlightMode, routeState?.highlightQuery, routeState?.highlightSectionKeywords]
  );

  const id = location.replace(/^\/filing\//, '');

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
  const [redlineAiSummary, setRedlineAiSummary] = useState<string | null>(null);
  const [redlineAiLoading, setRedlineAiLoading] = useState(false);
  const [redlineCandidate, setRedlineCandidate] = useState<ComparableFiling | null>(null);

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
    setRedlineAiSummary(null);
    setRedlineCandidate(null);
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
        <button onClick={() => navigate.push('/search')} className="mt-4 primary-btn">Back to Search</button>
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
    if (!filingMeta.formType || !filingMeta.filingDate) {
      return;
    }

    let cancelled = false;

    async function prefetchRedlineCandidate() {
      try {
        const submissions = await fetchCompanySubmissions(cik);
        if (!submissions || cancelled) {
          return;
        }

        const candidate = pickPreviousComparableFiling(
          submissions,
          accession,
          filingMeta.formType || '',
          filingMeta.filingDate || ''
        );

        if (cancelled) {
          return;
        }

        setRedlineCandidate(candidate);
        if (candidate) {
          void fetchFilingText(cik, candidate.accessionNumber, candidate.primaryDocument);
        }
      } catch (error) {
        console.error('Redline prefetch failed:', error);
      }
    }

    void prefetchRedlineCandidate();

    return () => {
      cancelled = true;
    };
  }, [accession, cik, filingMeta.filingDate, filingMeta.formType]);

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

  /**
   * Dynamic TOC parser — works for any SEC form type (10-K, 20-F, S-1, DEF 14A, etc.)
   *
   * Strategy 1: Detect the document's own Table of Contents by finding clusters of
   *   <a href="#..."> links. SEC filings place many internal links together on a TOC
   *   page. We find the densest cluster and extract all its links as TOC entries.
   *
   * Strategy 2: Pattern-match individual links for "Item N", "Part N", or known titles.
   *
   * Strategy 3 (fallback): Scan headings/bold elements for section-like text.
   */

  // Regex to detect section-like text: "Item 1", "Item 1A", "Part I", etc.
  const SECTION_HEADER_RE = /^(item\s+\d+[a-z]?\b|part\s+[iv]+\b)/i;
  // Detect item references inside anchor href values
  const ANCHOR_ITEM_RE = /^#?item_(\d+)_?([a-z])?(?:_|$)/i;
  // Skip non-section links (page numbers, "Table of Contents", "Back to top", etc.)
  const SKIP_RE = /^(table of contents|back to top|page|toc|\d+|f-\d+|[\divx]+)$/i;

  /** Clean up link text into a concise TOC label (max ~60 chars) */
  function cleanTocLabel(text: string, itemPrefix?: string): string {
    let label = text.replace(/\s+/g, ' ').trim();
    label = label.replace(/^(item|part)\s/i, m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase());
    if (itemPrefix && !SECTION_HEADER_RE.test(label)) {
      label = `Item ${itemPrefix.toUpperCase()}. ${label}`;
    }
    if (label.length > 60) label = label.slice(0, 57) + '...';
    return label;
  }

  const parseToc = useCallback((doc: Document) => {
    const entries: TocEntry[] = [];
    const seen = new Set<string>();

    // Gather all internal anchor links with valid text
    const allLinks = Array.from(doc.querySelectorAll('a[href^="#"]'));
    const validLinks: { el: HTMLAnchorElement; anchor: string; text: string; rect: DOMRect }[] = [];
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      const anchor = href.replace(/^#/, '');
      if (!anchor || anchor === 'toc') continue;
      const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3 || text.length > 120) continue;
      if (SKIP_RE.test(text)) continue;
      const rect = link.getBoundingClientRect();
      validLinks.push({ el: link, anchor, text, rect });
    }

    // Strategy 1: Find a TOC cluster — a group of 5+ anchor links near each other
    // (within 800px vertical range). SEC TOC pages group links tightly.
    if (validLinks.length >= 5) {
      let bestCluster: typeof validLinks = [];
      for (let i = 0; i < validLinks.length; i++) {
        const cluster: typeof validLinks = [];
        const startY = validLinks[i].rect.top;
        for (let j = i; j < validLinks.length; j++) {
          if (validLinks[j].rect.top - startY > 2000) break;
          cluster.push(validLinks[j]);
        }
        if (cluster.length > bestCluster.length) bestCluster = cluster;
      }

      if (bestCluster.length >= 5) {
        // Deduplicate by anchor and extract unique entries
        const seenAnchors = new Set<string>();
        for (const link of bestCluster) {
          if (seenAnchors.has(link.anchor)) continue;
          seenAnchors.add(link.anchor);

          // Detect item prefix from anchor href
          let itemPrefix: string | undefined;
          const anchorMatch = ANCHOR_ITEM_RE.exec(link.anchor);
          if (anchorMatch) {
            itemPrefix = anchorMatch[1] + (anchorMatch[2] || '');
          }

          const label = cleanTocLabel(link.text, itemPrefix);
          if (seen.has(label)) continue;
          seen.add(label);
          entries.push({ label, elementId: null, anchorName: link.anchor });
        }
      }
    }

    // Strategy 2: Pattern-match individual links (for filings without a TOC cluster)
    if (entries.length === 0) {
      for (const link of validLinks) {
        let isSection = false;
        let itemPrefix: string | undefined;
        const anchorMatch = ANCHOR_ITEM_RE.exec(link.anchor);
        if (anchorMatch) {
          isSection = true;
          itemPrefix = anchorMatch[1] + (anchorMatch[2] || '');
        }
        if (!isSection) {
          isSection = SECTION_HEADER_RE.test(link.text);
        }
        if (!isSection) continue;

        const label = cleanTocLabel(link.text, itemPrefix);
        if (seen.has(label)) continue;
        seen.add(label);
        entries.push({ label, elementId: null, anchorName: link.anchor });
      }
    }

    // Strategy 3: Scan headings and bold elements (fallback for filings without TOC links)
    if (entries.length === 0) {
      const candidates = Array.from(doc.querySelectorAll('h1, h2, h3, h4, b, strong'));
      for (const el of candidates) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 3 || text.length > 120) continue;
        if (!SECTION_HEADER_RE.test(text)) continue;

        const label = cleanTocLabel(text);
        if (seen.has(label)) continue;
        seen.add(label);
        if (!el.id) el.id = `toc-sec-${entries.length}`;
        entries.push({ label, elementId: el.id, anchorName: null });
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
        // Inject scroll styles so the SEC document has horizontal + vertical scrollbars
        const styleEl = frame.contentDocument.createElement('style');
        styleEl.textContent = `
          html { overflow: auto !important; }
          body { overflow: auto !important; overflow-x: auto !important; margin: 0; padding: 16px; }
        `;
        frame.contentDocument.head.appendChild(styleEl);
        setTocLoading(true);
        const entries = parseToc(frame.contentDocument);
        setTocEntries(entries);
        setCurrentFilingSections(entries);
        setTocLoading(false);
        setIframeLoadedToken(prev => prev + 1);
      }
    } catch {
      // Cross-origin - can't inspect. TOC unavailable.
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
      const frameWindow = frame.contentWindow;
      const targetRect = target.getBoundingClientRect();
      const currentOffset = frameWindow?.scrollY ?? frame.contentDocument.documentElement.scrollTop ?? 0;
      const targetTop = Math.max(targetRect.top + currentOffset - 24, 0);

      frameWindow?.scrollTo({
        top: targetTop,
        behavior: 'smooth',
      });
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
      const frameWindow = iframeRef.current?.contentWindow;
      const markRect = marks[0].getBoundingClientRect();
      const currentOffset = frameWindow?.scrollY ?? doc.documentElement.scrollTop ?? 0;
      const viewportHeight = frameWindow?.innerHeight || iframeRef.current?.clientHeight || 0;
      const targetTop = Math.max(currentOffset + markRect.top - Math.max((viewportHeight - markRect.height) / 2, 48), 0);

      frameWindow?.scrollTo({
        top: targetTop,
        behavior: 'smooth',
      });
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
      setActiveTab('tools');

      try {
        let previousFiling = redlineCandidate;
        if (!previousFiling) {
          const submissions = await fetchCompanySubmissions(cik);
          if (cancelled) return;
          if (!submissions) {
            setRedlineError('Unable to load company submissions for redline comparison.');
            return;
          }

          previousFiling = pickPreviousComparableFiling(
            submissions,
            accession,
            filingMeta.formType || '',
            filingMeta.filingDate || ''
          );
        }

        if (!previousFiling) {
          if (!cancelled) {
            setComparedFiling(null);
            setRedlineSummary(null);
            setRedlineError('No comparable prior filing was found to build a year-over-year redline.');
          }
          return;
        }

        const cacheKey = `${accession}:${previousFiling.accessionNumber}:${previousFiling.primaryDocument}`;
        const cachedSummary = REDLINE_SUMMARY_CACHE.get(cacheKey);
        if (cachedSummary) {
          setComparedFiling(cachedSummary.comparedFiling);
          setRedlineSummary(cachedSummary.summary);
          setRedlineAiSummary(cachedSummary.aiSummary);
          setActiveTab('tools');
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
        const summary = buildDisclosureDiff(currentText, previousText);
        setRedlineSummary(summary);
        setActiveTab('tools');
        
        // Execute AI summarization
        const addedStr = summary.addedBlocks.join('\n');
        const removedStr = summary.removedBlocks.join('\n');
        const changedStr = summary.changedBlocks.map(c => `[-${c.previous}-]\n[+${c.current}+]`).join('\n\n');
        
        const aiPromptContext = `ADDED:\n${addedStr}\n\nREMOVED:\n${removedStr}\n\nCHANGED:\n${changedStr}`;
        setRedlineAiLoading(true);
        setRedlineAiSummary(null);
        void aiSummarizeRedline(aiPromptContext).then(aiText => {
            if (!cancelled) {
              setRedlineAiSummary(aiText);
              REDLINE_SUMMARY_CACHE.set(cacheKey, {
                comparedFiling: previousFiling,
                summary,
                aiSummary: aiText
              });
            }
        }).catch(err => {
            console.error('Failed AI redline summary:', err);
            if (!cancelled) setRedlineAiLoading(false);
        }).finally(() => {
            if (!cancelled) setRedlineAiLoading(false);
        });

        REDLINE_SUMMARY_CACHE.set(cacheKey, {
          comparedFiling: previousFiling,
          summary,
          aiSummary: null
        });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- guard clause prevents re-execution; loading/error/summary are read but not triggers
  }, [accession, cik, fetchCurrentFilingText, filingMeta.filingDate, filingMeta.formType, redlineCandidate, redlineMode]);

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
          <button
            className="back-btn"
            onClick={() => {
              if (routeState?.originatingSearchSessionId) {
                navigate.push(`/search?tab=${encodeURIComponent(routeState.originatingSearchSessionId)}`);
                return;
              }
              navigate.back();
            }}
          >
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
            <MessageSquare size={16} /> Ask {BRAND.copilotName}
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
          {annotationMode && selectedQuote && (
            <div className="annotation-composer-overlay">
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
              scrolling="yes"
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
                    <span className="meta-value">{filingMeta.fileNumber || '-'}</span>
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
                        
                        {(redlineAiLoading || redlineAiSummary) && (
                          <div className="related-card mt-3" style={{ background: 'var(--accent-purple-light)', border: '1px solid rgba(178, 30, 125, 0.2)' }}>
                             <h4 className="tool-subheading" style={{ color: 'var(--accent-purple)'}}>Executive Summary (Claude 4.6)</h4>
                             {redlineAiLoading ? (
                               <div className="tool-loading"><Loader2 size={16} className="toc-spinner" /> Summarizing {redlineSummary.addedCount + redlineSummary.removedCount + (redlineSummary.changedBlocks?.length || 0)} changes...</div>
                             ) : (
                               <div className="font-sans text-sm whitespace-pre-wrap">{redlineAiSummary}</div>
                             )}
                          </div>
                        )}

                        {redlineSummary.changedBlocks && redlineSummary.changedBlocks.length > 0 && (
                          <div>
                            <h4 className="tool-subheading">Modified disclosure blocks</h4>
                            {redlineSummary.changedBlocks.map((block, index) => (
                              <div key={`changed-${index}`} className="related-card">
                                <TextDiffViewer oldText={block.previous} newText={block.current} />
                              </div>
                            ))}
                          </div>
                        )}

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
                      <div className="annotation-inline-hint">
                        A note draft is open over the filing preview so you can capture it without leaving the document.
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

