'use client';

import { useState, useRef, useCallback, useEffect, useMemo, type KeyboardEvent } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import { ArrowLeft, Bookmark, MessageSquare, ExternalLink, Columns, Highlighter, Settings2, Download, List, AlertCircle, FileText, Loader2, X } from 'lucide-react';
import { useApp } from '../context/AppState';
import { BRAND } from '../config/brand';
import { buildSecDocumentUrl, buildSecProxyUrl, fetchCompanySubmissions, fetchFilingText, fetchSubmissionHistory, resolvePrimaryDocumentPath, type SecFilingSeries, type SecSubmission } from '../services/secApi';
import { createPrintWindow, renderCleanPrintView } from '../services/filingExport';
import { buildDisclosureDiff, downloadTextFile, extractTablesFromHtml, tablesToCsv, type DisclosureDiffSummary } from '../services/filingDetailTools';
import { aiSummarizeRedline } from '../services/aiApi';
import { TextDiffViewer } from '../components/research/TextDiffViewer';
import { buildHighlightTerms } from '../services/searchAssist';
import { clearDocumentHighlights, highlightDocumentSearchTerms } from '../services/filingHighlights';
import type { ResearchSearchMode } from '../services/filingResearch';
import { scopedStorageKey } from '../services/storageNamespace';
import { sanitizeSearchReturnTo } from '../lib/internalNavigation';
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
  returnTo?: string;
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

export function formatFilingMetadataValue(value: string, hydrationComplete: boolean): string {
  return value || (hydrationComplete ? 'Unavailable' : 'Loading...');
}
// Filing HTML varies widely, so keep these generic enough for 10-K, 20-F, S-1,
// proxy, and other item/part-based forms.
const SECTION_HEADER_RE = /^(item\s+\d+[a-z]?\b|part\s+[iv]+\b)/i;
const ANCHOR_ITEM_RE = /^#?item_(\d+)_?([a-z])?(?:_|$)/i;
const SKIP_TOC_ENTRY_RE = /^(table of contents|back to top|page|toc|\d+|f-\d+|[\divx]+)$/i;

/** Walk up from a link to its containing TD, then read the adjacent description cell. */
function getSiblingTdText(link: HTMLElement): string {
  let el: HTMLElement | null = link;
  while (el && el.tagName !== 'TD') el = el.parentElement;
  if (!el) return '';
  const nextTd = el.nextElementSibling as HTMLElement | null;
  if (!nextTd || nextTd.tagName !== 'TD') return '';
  const text = (nextTd.textContent || '').replace(/\s+/g, ' ').trim();
  return /^\d+$/.test(text) ? '' : text;
}

/** Clean up link text into a concise TOC label. */
function cleanTocLabel(text: string, itemPrefix?: string, siblingDesc?: string): string {
  let label = text.replace(/\s+/g, ' ').trim();
  label = label.replace(/^(item|part)\s/i, match => match.charAt(0).toUpperCase() + match.slice(1).toLowerCase());
  if (siblingDesc && /^(Item\s+\d+[A-Za-z]?\.?|Part\s+[IV]+\.?)$/i.test(label)) {
    label = `${label} ${siblingDesc}`;
  }
  if (itemPrefix && !SECTION_HEADER_RE.test(label)) {
    label = `Item ${itemPrefix.toUpperCase()}. ${label}`;
  }
  return label.length > 60 ? `${label.slice(0, 57)}...` : label;
}

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
    const storageKey = scopedStorageKey(ANNOTATIONS_STORAGE_KEY);
    if (!storageKey) return [];
    const raw = window.localStorage.getItem(storageKey);
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
    const storageKey = scopedStorageKey(ANNOTATIONS_STORAGE_KEY);
    if (!storageKey) return;
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, FilingAnnotation[]>) : {};
    parsed[filingId] = annotations;
    window.localStorage.setItem(storageKey, JSON.stringify(parsed));
  } catch {
    // Ignore storage failures and keep notes in-memory.
  }
}

function pickPreviousComparableFiling(
  recent: SecFilingSeries,
  currentAccession: string,
  currentFormType: string,
  currentFilingDate: string
): ComparableFiling | null {
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

function findFilingInSeries(series: SecFilingSeries, accession: string) {
  const index = series.accessionNumber.findIndex(item => item === accession);
  if (index === -1) return null;
  return {
    filingDate: series.filingDate[index] || '',
    formType: series.form[index] || '',
    fileNumber: series.fileNumber[index] || '',
    primaryDocument: series.primaryDocument[index] || '',
  };
}

async function loadRelevantHistoricalSeries(submissions: SecSubmission, filingDate = ''): Promise<SecFilingSeries[]> {
  const files = submissions.filings.files || [];
  const candidates = (filingDate
    ? files.filter(file => !file.filingFrom || !file.filingTo || (file.filingFrom <= filingDate && filingDate <= file.filingTo) || file.filingTo < filingDate)
    : files)
    .sort((a, b) => (b.filingTo || '').localeCompare(a.filingTo || ''))
    .slice(0, 3);
  const series: SecFilingSeries[] = [];
  for (const file of candidates) {
    const history = await fetchSubmissionHistory(file.name);
    if (history) series.push(history);
  }
  return series;
}

export default function FilingDetail() {
  const location = usePathname();
  const navigate = useRouter();
  const filingSearchParams = useSearchParams();
  const filingRouteParamString = filingSearchParams?.toString() || '';
  const {
    addToWatchlist,
    setChatOpen,
    setCurrentFilingContext,
    setCurrentFilingSections,
    pendingFilingSectionLabel,
    setPendingFilingSectionLabel,
  } = useApp();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const currentHtmlRef = useRef<string | null>(null);
  const currentTextRef = useRef<string | null>(null);
  
  const routeState = useMemo<FilingRouteState>(() => {
    const params = new URLSearchParams(filingRouteParamString);
    const returnTo = params.get('returnTo');
    return {
      companyName: params.get('company') || '',
      filingDate: params.get('date') || '',
      formType: params.get('form') || '',
      fileNumber: params.get('file') || '',
      auditor: params.get('auditor') || '',
      highlightQuery: params.get('highlight') || '',
      highlightMode: params.get('highlightMode') === 'boolean' ? 'boolean' : 'semantic',
      highlightSectionKeywords: params.get('highlightSection') || '',
      originatingSearchSessionId: params.get('session'),
      returnTo: sanitizeSearchReturnTo(returnTo),
    };
  }, [filingRouteParamString]);
  const highlightTerms = useMemo(
    () => buildHighlightTerms(routeState?.highlightQuery || '', routeState?.highlightMode || 'semantic', routeState?.highlightSectionKeywords || ''),
    [routeState?.highlightMode, routeState?.highlightQuery, routeState?.highlightSectionKeywords]
  );

  const rawId = location.replace(/^\/filing\//, '');
  const id = (() => {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  })();
  const parts = id.split('_');
  const cik = parts[0] || '';
  const accession = parts[1] || '';
  const routePrimaryDoc = parts.slice(2).join('_');
  // Facet-store rows only know the master.idx submission path, not the real
  // primary document — treat that as a placeholder and resolve it below,
  // otherwise every Archives URL built from it is a guaranteed 404.
  const primaryDocIsPlaceholder =
    routePrimaryDoc.startsWith('edgar/') || routePrimaryDoc === `${accession}.txt`;
  const [resolvedPrimaryDoc, setResolvedPrimaryDoc] = useState('');
  const primaryDoc = primaryDocIsPlaceholder && resolvedPrimaryDoc ? resolvedPrimaryDoc : routePrimaryDoc;
  const isValidFilingId = Boolean(cik && accession && primaryDoc);
  const secUrl = buildSecDocumentUrl(cik, accession, primaryDoc);
  const formattedAccession = accession.replace(/-/g, '');

  useEffect(() => {
    if (!cik || !accession || !primaryDocIsPlaceholder) return;
    setResolvedPrimaryDoc('');
    let cancelled = false;
    void resolvePrimaryDocumentPath(cik, accession).then(doc => {
      if (!cancelled && doc) setResolvedPrimaryDoc(doc);
    });
    return () => { cancelled = true; };
  }, [accession, cik, primaryDocIsPlaceholder]);

  const [showSidebar, setShowSidebar] = useState(true);
  const [isMobileSidebar, setIsMobileSidebar] = useState(false);
  const [redlineMode, setRedlineMode] = useState(false);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'toc'|'metadata'|'tools'>('toc');
  const [iframeError, setIframeError] = useState(false);

  // A placeholder document can 404 the iframe before resolution completes;
  // clear the error whenever the document URL changes.
  useEffect(() => { setIframeError(false); }, [secUrl]);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [tocInspectionComplete, setTocInspectionComplete] = useState(false);
  const [tocInspectionError, setTocInspectionError] = useState('');
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
  const [redlineAiError, setRedlineAiError] = useState('');
  const [redlineCandidate, setRedlineCandidate] = useState<ComparableFiling | null>(null);
  const [metadataHydrationComplete, setMetadataHydrationComplete] = useState(
    Boolean(routeState.companyName && routeState.filingDate && routeState.formType)
  );
  const [metadataError, setMetadataError] = useState('');
  const [metadataRetryToken, setMetadataRetryToken] = useState(0);

  const closeSidebar = useCallback(() => {
    setShowSidebar(false);
    if (isMobileSidebar) {
      window.requestAnimationFrame(() => sidebarToggleRef.current?.focus());
    }
  }, [isMobileSidebar]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const syncViewport = () => {
      setIsMobileSidebar(mediaQuery.matches);
      if (mediaQuery.matches) setShowSidebar(false);
    };

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    if (!isMobileSidebar || !showSidebar || !sidebarRef.current) return;

    const sidebar = sidebarRef.current;
    const previousOverflow = document.body.style.overflow;
    const focusable = () => Array.from(
      sidebar.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled])')
    );
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => focusable()[0]?.focus());

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSidebar();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    sidebar.addEventListener('keydown', handleKeyDown);
    return () => {
      sidebar.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeSidebar, isMobileSidebar, showSidebar]);

  const handleSidebarTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: 'toc' | 'metadata' | 'tools'
  ) => {
    const tabs = ['toc', 'metadata', 'tools'] as const;
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`filing-sidebar-tab-${nextTab}`)?.focus());
  };

  useEffect(() => {
    currentHtmlRef.current = null;
    currentTextRef.current = null;
    setAnnotations(isValidFilingId ? loadAnnotations(id) : []);
    setCompanyTickers([]);
    setFilingMeta({
      companyName: routeState.companyName || '',
      filingDate: routeState.filingDate || '',
      formType: routeState.formType || '',
      fileNumber: routeState.fileNumber || '',
      auditor: routeState.auditor || '',
    });
    setSelectedQuote('');
    setAnnotationDraft('');
    setToolMessage('');
    setIframeError(false);
    setTocEntries([]);
    setTocLoading(false);
    setTocInspectionComplete(false);
    setTocInspectionError('');
    setRedlineError('');
    setComparedFiling(null);
    setRedlineSummary(null);
    setRedlineAiSummary(null);
    setRedlineAiError('');
    setRedlineCandidate(null);
    setMetadataError('');
    setMetadataHydrationComplete(Boolean(routeState.companyName && routeState.filingDate && routeState.formType));
  }, [id, isValidFilingId, routeState]);

  useEffect(() => {
    if (isValidFilingId) saveAnnotations(id, annotations);
  }, [annotations, id, isValidFilingId]);

  // Set filing context for AI chat panel
  useEffect(() => {
    if (isValidFilingId) {
      setCurrentFilingContext({
        cik,
        accessionNumber: accession,
        primaryDocument: primaryDoc,
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
  }, [accession, cik, filingMeta.auditor, filingMeta.companyName, filingMeta.filingDate, filingMeta.formType, isValidFilingId, primaryDoc, setCurrentFilingContext, setCurrentFilingSections]);

  useEffect(() => {
    if (!isValidFilingId || !filingMeta.formType || !filingMeta.filingDate) {
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
          submissions.filings.recent,
          accession,
          filingMeta.formType || '',
          filingMeta.filingDate || ''
        );

        if (cancelled) {
          return;
        }

        let resolvedCandidate = candidate;
        if (!resolvedCandidate) {
          const histories = await loadRelevantHistoricalSeries(submissions, filingMeta.filingDate || '');
          for (const history of histories) {
            const historicalCandidate = pickPreviousComparableFiling(
              history,
              accession,
              filingMeta.formType || '',
              filingMeta.filingDate || ''
            );
            if (historicalCandidate && (!resolvedCandidate || historicalCandidate.filingDate > resolvedCandidate.filingDate)) {
              resolvedCandidate = historicalCandidate;
            }
          }
        }

        setRedlineCandidate(resolvedCandidate);
        if (resolvedCandidate) {
          void fetchFilingText(cik, resolvedCandidate.accessionNumber, resolvedCandidate.primaryDocument);
        }
      } catch (error) {
        console.error('Redline prefetch failed:', error);
      }
    }

    void prefetchRedlineCandidate();

    return () => {
      cancelled = true;
    };
  }, [accession, cik, filingMeta.filingDate, filingMeta.formType, isValidFilingId]);

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
    if (!isValidFilingId) {
      setMetadataError('');
      setMetadataHydrationComplete(true);
      return;
    }

    let cancelled = false;
    setMetadataError('');

    async function hydrateMetadata() {
      try {
        const submissions = await fetchCompanySubmissions(cik);
        if (cancelled) return;
        if (!submissions) {
          if (!routeState.companyName || !routeState.filingDate || !routeState.formType) {
            setMetadataError('Filing metadata is unavailable from the SEC company-submissions feed.');
          }
          return;
        }

        setCompanyTickers(submissions.tickers || []);

        if (routeState?.companyName && routeState?.filingDate && routeState?.formType) {
          return;
        }

        let match = findFilingInSeries(submissions.filings.recent, accession);
        if (!match) {
          for (const file of submissions.filings.files || []) {
            const history = await fetchSubmissionHistory(file.name);
            if (cancelled) return;
            if (!history) continue;
            match = findFilingInSeries(history, accession);
            if (match) break;
          }
        }
        if (!match) {
          setMetadataError('This filing could not be matched in the issuer’s recent or historical SEC submissions.');
          return;
        }

        setFilingMeta(prev => ({
          companyName: prev.companyName || submissions.name || '',
          filingDate: prev.filingDate || match?.filingDate || '',
          formType: prev.formType || match?.formType || '',
          fileNumber: prev.fileNumber || match?.fileNumber || '',
          auditor: prev.auditor || '',
        }));
      } catch (error) {
        console.error('Filing metadata hydration failed:', error);
        if (!cancelled && (!routeState.companyName || !routeState.filingDate || !routeState.formType)) {
          setMetadataError('Filing metadata could not be loaded from SEC submissions.');
        }
      } finally {
        if (!cancelled) setMetadataHydrationComplete(true);
      }
    }

    void hydrateMetadata();
    return () => {
      cancelled = true;
    };
  }, [accession, cik, isValidFilingId, metadataRetryToken, routeState]);

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

  const parseToc = useCallback((doc: Document) => {
    const entries: TocEntry[] = [];
    const seen = new Set<string>();

    // Gather all internal anchor links with valid text
    const allLinks = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    const validLinks: { el: HTMLAnchorElement; anchor: string; text: string; rect: DOMRect }[] = [];
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      const anchor = href.replace(/^#/, '');
      if (!anchor || anchor === 'toc') continue;
      const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3 || text.length > 120) continue;
      if (SKIP_TOC_ENTRY_RE.test(text)) continue;
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

          const siblingDesc = getSiblingTdText(link.el);
          const label = cleanTocLabel(link.text, itemPrefix, siblingDesc);
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

        const siblingDesc = getSiblingTdText(link.el);
        const label = cleanTocLabel(link.text, itemPrefix, siblingDesc);
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

  const inspectIframeSections = useCallback((frame: HTMLIFrameElement) => {
    setTocLoading(true);
    setTocInspectionError('');
    try {
      const frameDocument = frame.contentDocument;
      if (!frameDocument?.body || frameDocument.body.innerHTML === '') {
        setIframeError(true);
        setTocEntries([]);
        setCurrentFilingSections([]);
        setTocInspectionComplete(true);
        setTocInspectionError('Section navigation is unavailable because the embedded document did not load. The source filing remains available on SEC.gov.');
        return;
      }

      // Inject scroll styles so the SEC document has horizontal + vertical scrollbars.
      const styleEl = frameDocument.createElement('style');
      styleEl.textContent = `
        html { overflow: auto !important; }
        body { overflow: auto !important; overflow-x: auto !important; margin: 0; padding: 16px; }
      `;
      frameDocument.head?.appendChild(styleEl);
      const entries = parseToc(frameDocument);
      setIframeError(false);
      setTocEntries(entries);
      setCurrentFilingSections(entries);
      setTocInspectionComplete(true);
      setIframeLoadedToken(prev => prev + 1);
    } catch (error) {
      console.error('Filing section inspection failed:', error);
      setTocEntries([]);
      setCurrentFilingSections([]);
      setTocInspectionComplete(true);
      setTocInspectionError('Section navigation is unavailable because the embedded filing could not be inspected. The filing remains available in the document viewer and on SEC.gov.');
    } finally {
      setTocLoading(false);
    }
  }, [parseToc, setCurrentFilingSections]);

  const handleIframeLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
    inspectIframeSections(event.currentTarget);
  }, [inspectIframeSections]);

  const handleIframeError = useCallback(() => {
    setIframeError(true);
    setTocEntries([]);
    setCurrentFilingSections([]);
    setTocLoading(false);
    setTocInspectionComplete(true);
    setTocInspectionError('Section navigation is unavailable because the embedded document failed to load. The source filing remains available on SEC.gov.');
  }, [setCurrentFilingSections]);

  const retryTocInspection = useCallback(() => {
    if (iframeRef.current) inspectIframeSections(iframeRef.current);
  }, [inspectIframeSections]);

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

  const runRedlineAiSummary = useCallback(async (
    summary: DisclosureDiffSummary,
    previousFiling: ComparableFiling,
    cacheKey: string,
    isCancelled: () => boolean = () => false
  ) => {
    const addedStr = summary.addedBlocks.join('\n');
    const removedStr = summary.removedBlocks.join('\n');
    const changedStr = summary.changedBlocks.map(change => `[-${change.previous}-]\n[+${change.current}+]`).join('\n\n');
    const aiPromptContext = `ADDED:\n${addedStr}\n\nREMOVED:\n${removedStr}\n\nCHANGED:\n${changedStr}`;

    setRedlineAiLoading(true);
    setRedlineAiSummary(null);
    setRedlineAiError('');
    try {
      const aiText = await aiSummarizeRedline(aiPromptContext, { throwOnError: true });
      if (isCancelled()) return;
      setRedlineAiSummary(aiText);
      REDLINE_SUMMARY_CACHE.set(cacheKey, {
        comparedFiling: previousFiling,
        summary,
        aiSummary: aiText,
      });
    } catch (error) {
      console.error('Failed AI redline summary:', error);
      if (!isCancelled()) {
        setRedlineAiError('The AI redline summary could not be generated. The deterministic change blocks remain available below.');
      }
    } finally {
      if (!isCancelled()) setRedlineAiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!redlineMode || redlineSummary || redlineLoading || redlineError) {
      return;
    }

    if (!filingMeta.formType || !filingMeta.filingDate) {
      if (metadataHydrationComplete) {
        setRedlineError('Filing form and date metadata could not be resolved, so a comparable historical filing cannot be selected.');
        setActiveTab('tools');
      }
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
            submissions.filings.recent,
            accession,
            filingMeta.formType || '',
            filingMeta.filingDate || ''
          );
          if (!previousFiling) {
            const histories = await loadRelevantHistoricalSeries(submissions, filingMeta.filingDate || '');
            for (const history of histories) {
              const candidate = pickPreviousComparableFiling(
                history,
                accession,
                filingMeta.formType || '',
                filingMeta.filingDate || ''
              );
              if (candidate && (!previousFiling || candidate.filingDate > previousFiling.filingDate)) {
                previousFiling = candidate;
              }
            }
          }
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
          setRedlineAiError('');
          setActiveTab('tools');
          if (!cachedSummary.aiSummary) {
            void runRedlineAiSummary(cachedSummary.summary, cachedSummary.comparedFiling, cacheKey, () => cancelled);
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
        const summary = buildDisclosureDiff(currentText, previousText);
        setRedlineSummary(summary);
        setActiveTab('tools');

        REDLINE_SUMMARY_CACHE.set(cacheKey, {
          comparedFiling: previousFiling,
          summary,
          aiSummary: null
        });
        void runRedlineAiSummary(summary, previousFiling, cacheKey, () => cancelled);
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
  }, [accession, cik, fetchCurrentFilingText, filingMeta.filingDate, filingMeta.formType, metadataHydrationComplete, redlineCandidate, redlineMode, runRedlineAiSummary]);

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

  if (!isValidFilingId) {
    return (
      <main className="filing-invalid-state" role="alert">
        <AlertCircle size={32} aria-hidden="true" />
        <h1>Invalid filing link</h1>
        <p>The filing address is incomplete. Expected a CIK, accession number, and document name.</p>
        <button type="button" onClick={() => navigate.push('/search')} className="primary-btn">
          Back to Search
        </button>
      </main>
    );
  }

  return (
    <div className="filing-detail-container">
      {/* Top action bar */}
      <div className="filing-header-bar glass-card">
        <div className="header-left">
          <button
            type="button"
            className="back-btn"
            onClick={() => {
              if (routeState.returnTo) {
                navigate.push(routeState.returnTo);
                return;
              }
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
              type="button"
              className={`tool-btn ${redlineMode ? 'active' : ''}`}
              onClick={() => {
                const next = !redlineMode;
                setRedlineMode(next);
                if (next) {
                  setRedlineError('');
                  setRedlineAiError('');
                  setComparedFiling(null);
                  setRedlineSummary(null);
                  setRedlineAiSummary(null);
                }
                setActiveTab('tools');
              }}
              title="Compare to Previous Year (Redline)"
              aria-pressed={redlineMode}
            >
              <Columns size={16} /> YoY Redline
            </button>
            <button
              type="button"
              className={`tool-btn ${annotationMode ? 'active' : ''}`}
              title="Capture selected text and save notes"
              aria-pressed={annotationMode}
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
            <button type="button" className="tool-btn" title="Extract Financial Tables to CSV" onClick={() => void handleTableExtract()} disabled={extractingTables}>
              {extractingTables ? <Loader2 size={16} className="spinner" /> : <Download size={16} />} Extract Tables
            </button>
            <button type="button" className="tool-btn" title="Open a clean print view for PDF export" onClick={() => void handleCleanPdfExport()} disabled={exportingPdf}>
              {exportingPdf ? <Loader2 size={16} className="spinner" /> : <Download size={16} />} Print / Save PDF
            </button>
          </div>
        </div>

        <div className="header-actions">
          <button type="button" className="icon-btn" title="Save to Watchlist" aria-label="Save filing to watchlist" onClick={handleAddToWatchlist}><Bookmark size={18} aria-hidden="true" /></button>
          <a href={secUrl} target="_blank" rel="noreferrer" className="icon-btn" title="Open in SEC.gov" aria-label="Open filing on SEC.gov"><ExternalLink size={18} aria-hidden="true" /></a>
          <button
            ref={sidebarToggleRef}
            type="button"
            className={`icon-btn ${showSidebar ? 'active-icon' : ''}`}
            onClick={() => setShowSidebar(!showSidebar)}
            title="Toggle Right Panel"
            aria-label={showSidebar ? 'Close filing tools panel' : 'Open filing tools panel'}
            aria-expanded={showSidebar}
            aria-controls="filing-tools-panel"
          >
            <Settings2 size={18} aria-hidden="true" />
          </button>
          <button type="button" className="primary-btn sm ml-2" onClick={() => setChatOpen(true)}>
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
            <a href={secUrl} target="_blank" rel="noreferrer" className="icon-btn text-muted" title="Open on SEC.gov" aria-label="Open document on SEC.gov"><ExternalLink size={16} aria-hidden="true" /></a>
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
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              scrolling="yes"
              onError={handleIframeError}
              onLoad={handleIframeLoad}
            />
          )}
        </div>

        {/* Right Sidebar */}
        {isMobileSidebar && showSidebar && (
          <button type="button" className="filing-sidebar-overlay" aria-label="Close filing tools panel" onClick={closeSidebar} />
        )}
        {showSidebar && (
          <aside ref={sidebarRef} id="filing-tools-panel" className="filing-sidebar glass-card" aria-label="Filing tools panel">
            <button type="button" className="filing-sidebar-close" aria-label="Close filing tools panel" onClick={closeSidebar}>
              <X size={18} aria-hidden="true" />
            </button>
            <div className="sidebar-tabs" role="tablist" aria-label="Filing tools">
              <button
                type="button"
                id="filing-sidebar-tab-toc"
                role="tab"
                aria-selected={activeTab === 'toc'}
                aria-controls="filing-sidebar-panel-toc"
                tabIndex={activeTab === 'toc' ? 0 : -1}
                className={activeTab === 'toc' ? 'active' : ''}
                onClick={() => setActiveTab('toc')}
                onKeyDown={event => handleSidebarTabKeyDown(event, 'toc')}
              >
                <List size={16} /> TOC
              </button>
              <button
                type="button"
                id="filing-sidebar-tab-metadata"
                role="tab"
                aria-selected={activeTab === 'metadata'}
                aria-controls="filing-sidebar-panel-metadata"
                tabIndex={activeTab === 'metadata' ? 0 : -1}
                className={activeTab === 'metadata' ? 'active' : ''}
                onClick={() => setActiveTab('metadata')}
                onKeyDown={event => handleSidebarTabKeyDown(event, 'metadata')}
              >
                Details
              </button>
              <button
                type="button"
                id="filing-sidebar-tab-tools"
                role="tab"
                aria-selected={activeTab === 'tools'}
                aria-controls="filing-sidebar-panel-tools"
                tabIndex={activeTab === 'tools' ? 0 : -1}
                className={activeTab === 'tools' ? 'active' : ''}
                onClick={() => setActiveTab('tools')}
                onKeyDown={event => handleSidebarTabKeyDown(event, 'tools')}
              >
                Tools
              </button>
            </div>

            <div
              className="sidebar-content scrollable"
              role="tabpanel"
              id={`filing-sidebar-panel-${activeTab}`}
              aria-labelledby={`filing-sidebar-tab-${activeTab}`}
              tabIndex={0}
            >
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
                  ) : primaryDoc.endsWith('.xml') ? (
                    <div className="toc-empty" role="status">
                      <p>Section navigation is unavailable for this XML filing.</p>
                      <p className="toc-hint">The source filing remains available through the SEC.gov viewer.</p>
                    </div>
                  ) : tocInspectionError ? (
                    <div className="toc-empty" role="alert">
                      <p>{tocInspectionError}</p>
                      {!iframeError && (
                        <button type="button" className="secondary-btn" onClick={retryTocInspection}>Retry section detection</button>
                      )}
                    </div>
                  ) : tocInspectionComplete ? (
                    <div className="toc-empty" role="status">
                      <p>No navigable sections were detected in this filing.</p>
                      <p className="toc-hint">The filing remains available in the document viewer and on SEC.gov.</p>
                    </div>
                  ) : (
                    <div className="toc-empty">
                      <p>Waiting for the document to load before detecting sections.</p>
                    </div>
                  )}
                  <div className="xbrl-hint">
                    <p>Sections are parsed automatically from the filing HTML.</p>
                  </div>
                </div>
              )}

              {activeTab === 'metadata' && (
                <div className="metadata-panel">
                  {metadataError && (
                    <div role="alert" className="related-card" style={{ color: 'var(--status-error)', background: 'var(--status-error-bg)', marginBottom: '12px' }}>
                      <p>{metadataError}</p>
                      <button type="button" className="secondary-btn" onClick={() => {
                        setMetadataHydrationComplete(false);
                        setMetadataError('');
                        setMetadataRetryToken(token => token + 1);
                      }}>Retry SEC metadata</button>
                    </div>
                  )}
                  <div className="meta-row">
                    <span className="meta-label">Company</span>
                    <span className="meta-value">{formatFilingMetadataValue(filingMeta.companyName || '', metadataHydrationComplete)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Filing Date</span>
                    <span className="meta-value">{formatFilingMetadataValue(filingMeta.filingDate || '', metadataHydrationComplete)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Form Type</span>
                    <span className="meta-value">{formatFilingMetadataValue(filingMeta.formType || '', metadataHydrationComplete)}</span>
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
                    ) : !metadataHydrationComplete ? (
                      <div className="tool-loading"><Loader2 size={16} className="toc-spinner" /> Resolving filing history metadata...</div>
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
                        
                        {(redlineAiLoading || redlineAiSummary || redlineAiError) && (
                          <div className="related-card mt-3" style={{ background: 'var(--surface-accent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 24%, transparent)' }}>
                             <h4 className="tool-subheading" style={{ color: 'var(--accent-primary)'}}>Evidence-linked AI summary</h4>
                             {redlineAiLoading ? (
                               <div className="tool-loading"><Loader2 size={16} className="toc-spinner" /> Summarizing {redlineSummary.addedCount + redlineSummary.removedCount + (redlineSummary.changedBlocks?.length || 0)} changes...</div>
                             ) : redlineAiError ? (
                               <div role="alert">
                                 <p className="tool-panel-copy">{redlineAiError}</p>
                                 <button type="button" className="secondary-btn" onClick={() => {
                                   const cacheKey = `${accession}:${comparedFiling.accessionNumber}:${comparedFiling.primaryDocument}`;
                                   void runRedlineAiSummary(redlineSummary, comparedFiling, cacheKey);
                                 }}>Retry AI summary</button>
                               </div>
                             ) : (
                               <>
                                 <div className="font-sans text-sm whitespace-pre-wrap">{redlineAiSummary}</div>
                                 <p className="tool-panel-copy" style={{ marginTop: '8px' }}>
                                   Verify every quoted change against the added, removed, and modified disclosure blocks below before relying on this summary.
                                 </p>
                               </>
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
