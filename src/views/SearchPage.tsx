'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import {
  BellRing,
  BookMarked,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Download,
  FileText,
  Filter,
  Hash,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import SearchFilterBar, { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';
import { useApp } from '../context/AppState';
import { clearDocumentHighlights, highlightDocumentSearchTerms } from '../services/filingHighlights';
import {
  buildSearchTrendSummary,
  executeFilingResearchSearch,
  mergeVerifiedResultWindows,
  type FilingResearchResult,
  type ResearchSearchMode,
} from '../services/filingResearch';
import {
  buildSecDocumentUrl,
  buildSecProxyUrl,
  isPlaceholderPrimaryDocument,
  resolvePrimaryDocumentPath,
  computeCompanySuggestions,
  fetchCompanySubmissions,
  getCompanyDirectory,
  type CompanyDirectoryEntry,
  type SearchCandidateCoverage,

} from '../services/secApi';
import { buildIssuerFreshnessNotice, type IssuerFreshnessNotice } from '../services/issuerFreshness';
import {
  buildSearchSignature,
  buildResearchRouteParams,
  buildResearchSessionTitle,
  cloneSearchFilters,
  createResearchSessionId,
  hasResearchSearchCriteria,
  loadResearchSessions,
  parseResearchRouteParams,
  shouldHandleExternalResearchRoute,
  saveResearchSessions,
  type ResearchSearchSession,
} from '../services/researchSessions';
import { buildHighlightTerms } from '../services/searchAssist';
import { buildResearchEmptyResultMessage, buildResultsHeadline, formatUpstreamTotal, mergeCandidateCoverage } from '../services/searchCoverage';
import { exportResultsWorkbook } from '../services/resultExport';
import { RESEARCH_LIBRARY } from '../config/researchLibrary';
import { countExactMatches } from '../services/exactCount';
import { compileBooleanQuery } from '../utils/booleanSearch';
import SearchScopeBanner from '../components/research/SearchScopeBanner';
import ActiveQueryChips from '../components/research/ActiveQueryChips';
import BooleanSyntaxHelp, { BooleanSyntaxHelpTrigger } from '../components/research/BooleanSyntaxHelp';
import { generateSearchTrendReport, SEARCH_TREND_AI_FALLBACK } from '../services/searchTrendReport';
import { planResearchSearch } from '../services/researchSearchPlan';
import { canUseInstantEnrichedSearch } from '../services/filingResearch';
import { BRAND } from '../config/brand';
import './SearchPage.css';
import '../styles/evidence-ledger.css';
import { addCitation, citationId, removeCitation } from '../services/memoTray';
import { useMemoTray } from '../hooks/useMemoTray';

// Amendments included for every core form: EFTS matches form types exactly, so
// omitting 10-K/A etc. hides restatements — often the most material filings.
const DEFAULT_FORM_SCOPE = '10-K,10-K/A,10-Q,10-Q/A,8-K,8-K/A,DEF 14A,20-F,20-F/A,6-K,S-1,S-1/A';
const RESEARCH_RESULT_LIMIT = 500;
const INITIAL_RESEARCH_RESULT_LIMIT = 80;
const INITIAL_BOOLEAN_RESULT_LIMIT = 40;
const RESEARCH_RESULTS_PAGE_SIZE = 50;
const RESEARCH_SEARCH_USES_ENRICHED_RESULTS = true;
const SAMPLE_SEARCHES = [
  'ASC 842 adoption w/10 lease',
  'ASR w/5 derivative',
  'Temporary equity in last 3 years in 10-Q / 10-K audited by Deloitte',
  '"material weakness" AND auditor:KPMG',
  '"material weakness" AND cybersecurity',
  'I am trying to search for companies that had bifurcated derivatives in accelerated share repurchase agreements in last 5 years',
];


function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(text: string, terms: string[]) {
  if (!text.trim()) {
    return text;
  }

  const uniqueTerms = Array.from(
    new Set(
      terms
        .map(term => term.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  )
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);

  if (uniqueTerms.length === 0) {
    return text;
  }

  const pattern = new RegExp(`(${uniqueTerms.map(term => escapeRegex(term)).join('|')})`, 'ig');
  return text.split(pattern).map((part, index) => {
    const isHit = uniqueTerms.some(term => term.toLowerCase() === part.toLowerCase());
    return isHit ? <mark key={`${part}-${index}`}>{part}</mark> : <span key={`${part}-${index}`}>{part}</span>;
  });
}

function formatResultFormLabel(result: FilingResearchResult): string {
  const filingForm = (result.formType || '').trim();
  const documentType = (result.documentType || '').trim();
  if (!documentType || documentType.toUpperCase() === filingForm.toUpperCase()) {
    return filingForm;
  }
  return `${filingForm} · ${documentType}`;
}

function buildAlertName(query: string, filters: SearchFilters): string {
  if (query.trim()) return query.trim();
  if (filters.entityName.trim()) return `${filters.entityName.trim()} research`;
  if (filters.sicCode.trim()) return `SIC ${filters.sicCode.trim()} trend`;
  return 'Custom research alert';
}

function shouldHydrateSearchSignals(mode: ResearchSearchMode, filters: SearchFilters): boolean {
  if (mode === 'boolean') {
    return true;
  }

  return Boolean(filters.accountant.trim() || filters.sectionKeywords.trim());
}

function buildResearchSession(
  id: string,
  query: string,
  mode: ResearchSearchMode,
  filters: SearchFilters,
  results: FilingResearchResult[],
  interpretation: string[],
  resolvedSearch: { query: string; mode: ResearchSearchMode; filters: SearchFilters },
  createdAt: string,
  options: {
    isRefining?: boolean;
    errorMsg?: string;
    selectedResultId?: string | null;
    coverage?: SearchCandidateCoverage | null;
  } = {}
): ResearchSearchSession {
  const selectedResultId =
    options.selectedResultId && results.some(result => result.id === options.selectedResultId)
      ? options.selectedResultId
      : results[0]?.id || null;

  return {
    id,
    title: buildResearchSessionTitle(query, filters),
    query,
    mode,
    filters,
    results,
    isRefining: Boolean(options.isRefining),
    searched: true,
    errorMsg: options.errorMsg || '',
    interpretation,
    resolvedSearch,
    selectedResultId,
    createdAt,
    updatedAt: new Date().toISOString(),
    coverage: options.coverage ?? null,
  };
}

function buildAuditorDisplayLabel(
  auditor: string,
  filters: SearchFilters,
  isRefining: boolean
): string {
  if (auditor.trim()) {
    return auditor;
  }

  if (isRefining && filters.accountant.trim()) {
    return 'Validating auditor...';
  }

  // Unknown auditor renders nothing — a repeated "unavailable" line on every
  // card reads as product breakage; the one-time coverage notice explains it.
  return '';
}

function countAppliedFilters(filters: SearchFilters): number {
  return (
    (filters.entityName ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    filters.formTypes.length +
    (filters.sectionKeywords ? 1 : 0) +
    (filters.sicCode ? 1 : 0) +
    (filters.stateOfInc ? 1 : 0) +
    (filters.headquarters ? 1 : 0) +
    filters.exchange.length +
    filters.acceleratedStatus.length +
    (filters.accountant ? 1 : 0) +
    (filters.accessionNumber ? 1 : 0) +
    (filters.fileNumber ? 1 : 0) +
    (filters.fiscalYearEnd ? 1 : 0) +
    (filters.accountingFramework ? 1 : 0)
  );
}

function researchTabId(sessionId: string): string {
  return `research-tab-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function ResearchSessionTabs({
  sessions,
  activeSessionId,
  emptyMessage,
  onSelect,
  onClose,
}: {
  sessions: ResearchSearchSession[];
  activeSessionId?: string;
  emptyMessage: string;
  onSelect: (session: ResearchSearchSession) => void;
  onClose: (sessionId: string) => void;
}) {
  const tabListRef = useRef<HTMLDivElement>(null);

  const moveFocus = (currentIndex: number, direction: 'previous' | 'next' | 'first' | 'last') => {
    if (sessions.length === 0) return;
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? sessions.length - 1
        : direction === 'previous'
          ? (currentIndex - 1 + sessions.length) % sessions.length
          : (currentIndex + 1) % sessions.length;

    onSelect(sessions[nextIndex]);
    window.requestAnimationFrame(() => {
      tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
    });
  };

  if (sessions.length === 0) {
    return <div className="research-empty-tab">{emptyMessage}</div>;
  }

  return (
    <div ref={tabListRef} className="research-tab-strip" role="tablist" aria-label="Open research searches">
      {sessions.map((session, index) => {
        const isActive = activeSessionId === session.id;
        const tabId = researchTabId(session.id);
        return (
          <div key={session.id} className={`research-tab ${isActive ? 'active' : ''}`} role="presentation">
            <button
              type="button"
              id={tabId}
              className="research-tab-select"
              role="tab"
              aria-selected={isActive}
              aria-controls={`research-panel-${session.id}`}
              tabIndex={isActive || (!activeSessionId && index === 0) ? 0 : -1}
              onClick={() => onSelect(session)}
              onKeyDown={event => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  moveFocus(index, 'previous');
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  moveFocus(index, 'next');
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  moveFocus(index, 'first');
                } else if (event.key === 'End') {
                  event.preventDefault();
                  moveFocus(index, 'last');
                }
              }}
            >
              <span className="research-tab-title">{session.title}</span>
              <span className="count" aria-label={`${session.results.length} results`}>{session.results.length}</span>
            </button>
            <button
              type="button"
              className="close"
              aria-label={`Close ${session.title} search`}
              onClick={() => onClose(session.id)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function SearchPage() {
  const location = usePathname();
  const navigate = useRouter();
  const searchParams = useSearchParams();
  const routeParamString = searchParams?.toString() || '';
  const initialRouteSearch = useMemo(
    () => parseResearchRouteParams(new URLSearchParams(routeParamString)),
    [routeParamString]
  );
  const initialQuery = initialRouteSearch?.query || '';
  const activeTabId = searchParams?.get('tab');

  const setSearchParams = useCallback((params: Record<string, string> | URLSearchParams, options?: { replace?: boolean }) => {
    let nextParams: URLSearchParams;
    if (params instanceof URLSearchParams) {
      nextParams = params;
    } else {
      nextParams = new URLSearchParams(searchParams?.toString() || '');
      Object.entries(params).forEach(([key, value]) => {
        if (value) nextParams.set(key, value);
        else nextParams.delete(key);
      });
    }
    const qs = nextParams.toString();
    const url = qs ? `${location}?${qs}` : location;
    if (options?.replace) {
      navigate.replace(url);
    } else {
      navigate.push(url);
    }
  }, [searchParams, location, navigate]);

  const {
    addSavedAlert,

    pendingSearchIntent,
    setPendingSearchIntent,
    setActiveSearchContext,
    setChatOpen,
  } = useApp();

  const [sessions, setSessions] = useState<ResearchSearchSession[]>(() => loadResearchSessions());
  const [query, setQuery] = useState(initialQuery);
  // Facet-store rows carry a placeholder primary document; the preview pane
  // resolves the real one per result id so the iframe never 404s.
  const [resolvedPreviewDocs, setResolvedPreviewDocs] = useState<Record<string, string>>({});
  // Company suggestions for the query bar — same directory + brand aliases
  // as every other company input.
  const memoCitations = useMemoTray();
  const [companyDirectory, setCompanyDirectory] = useState<CompanyDirectoryEntry[]>([]);
  const [querySuggestions, setQuerySuggestions] = useState<CompanyDirectoryEntry[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [syntaxHelpOpen, setSyntaxHelpOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<ResearchSearchMode>(initialRouteSearch?.mode || 'semantic');
  const [filters, setFilters] = useState<SearchFilters>(() =>
    cloneSearchFilters(initialRouteSearch?.filters || defaultSearchFilters)
  );
  const [results, setResults] = useState<FilingResearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [trendReport, setTrendReport] = useState('');
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendAiError, setTrendAiError] = useState('');
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
    },
  });
  const [previewError, setPreviewError] = useState(false);
  const [previewLoadedToken, setPreviewLoadedToken] = useState(0);
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [isQueryPanelCollapsed, setIsQueryPanelCollapsed] = useState(false);
  const [isInsightsExpanded, setIsInsightsExpanded] = useState(false);
  const [degradedNotice, setDegradedNotice] = useState('');
  const [candidateCoverage, setCandidateCoverage] = useState<SearchCandidateCoverage | null>(null);
  // Which session's coverage snapshot the state currently reflects — guards
  // the activation effect from clobbering a live run's fresher accumulator.
  const coverageRestoredForSessionRef = useRef<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const captureCandidateCoverage = useCallback((coverage: SearchCandidateCoverage) => {
    setCandidateCoverage(current => mergeCandidateCoverage(current, coverage));
  }, []);

  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const handledExternalRouteRef = useRef('');

  const activeSessionIdRef = useRef<string | null>(null);
  const pendingRefinementKeysRef = useRef<Map<string, string>>(new Map());
  // Latest-request-wins: every submission gets a monotonic run id per research
  // session and its own AbortController. A superseded or closed run's async
  // completions are ignored and its in-flight fetches are cancelled, so a slow
  // earlier search can never overwrite a newer run's results, route, or error.
  const runCounterRef = useRef(0);
  const activeRunBySessionRef = useRef<Map<string, number>>(new Map());
  const abortBySessionRef = useRef<Map<string, AbortController>>(new Map());
  const sessionsRef = useRef<ResearchSearchSession[]>(sessions);
  const handleSearchRef = useRef<((searchQuery?: string, overrideFilters?: SearchFilters, overrideMode?: ResearchSearchMode, options?: { preferredSessionId?: string; replaceUrl?: boolean }) => Promise<void>) | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    saveResearchSessions(sessions);
  }, [sessions]);

  const activeSession = useMemo(() => {
    if (sessions.length === 0) return null;
    if (!activeTabId) return sessions[0];
    return sessions.find(session => session.id === activeTabId) || sessions[0];
  }, [activeTabId, sessions]);

  const displayResults = activeSession?.results || results;
  const [resultSort, setResultSort] = useState<'relevance' | 'newest'>('relevance');
  const [resultPage, setResultPage] = useState(1);
  const [auditorNoticeDismissed, setAuditorNoticeDismissed] = useState(false);
  const sortedDisplayResults = useMemo(() => {
    if (resultSort === 'newest') {
      return [...displayResults].sort((a, b) => b.fileDate.localeCompare(a.fileDate));
    }
    return displayResults;
  }, [displayResults, resultSort]);
  const resultPageCount = Math.max(1, Math.ceil(sortedDisplayResults.length / RESEARCH_RESULTS_PAGE_SIZE));
  const pagedDisplayResults = useMemo(() => {
    const start = (resultPage - 1) * RESEARCH_RESULTS_PAGE_SIZE;
    return sortedDisplayResults.slice(start, start + RESEARCH_RESULTS_PAGE_SIZE);
  }, [resultPage, sortedDisplayResults]);

  useEffect(() => {
    setResultPage(1);
  }, [activeSession?.id, resultSort]);

  useEffect(() => {
    setResultPage(current => Math.min(current, resultPageCount));
  }, [resultPageCount]);
  const activeResolvedSearch = activeSession?.resolvedSearch || lastResolvedSearch;
  const isRefiningResults = Boolean(activeSession?.isRefining);
  const previewHighlightTerms = useMemo(
    () => buildHighlightTerms(
      activeResolvedSearch.query,
      activeResolvedSearch.mode,
      activeResolvedSearch.filters.sectionKeywords
    ),
    [activeResolvedSearch]
  );

  useEffect(() => {
    let cancelled = false;
    void getCompanyDirectory().then(directory => {
      if (!cancelled) setCompanyDirectory(directory);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setQuerySuggestions(computeCompanySuggestions(companyDirectory, query));
  }, [query, companyDirectory]);

  const selectedResult = useMemo(() => {
    if (displayResults.length === 0) return null;
    if (!activeSession?.selectedResultId) return displayResults[0];
    return displayResults.find(item => item.id === activeSession.selectedResultId) || displayResults[0];
  }, [activeSession?.selectedResultId, displayResults]);

  const metrics = useMemo(() => {
    const companies = new Set(displayResults.map(result => result.entityName)).size;
    // Only known firms count — "Top auditor: Unknown" is noise, and pre-2017
    // filings legitimately have no Form AP record. The chip hides instead.
    const auditors = displayResults.reduce<Record<string, number>>((acc, result) => {
      if (result.auditor) acc[result.auditor] = (acc[result.auditor] || 0) + 1;
      return acc;
    }, {});
    const topAuditor = Object.entries(auditors).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const forms = displayResults.reduce<Record<string, number>>((acc, result) => {
      acc[result.formType] = (acc[result.formType] || 0) + 1;
      return acc;
    }, {});
    const topForm = Object.entries(forms).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    return { companies, topAuditor, topForm };
  }, [displayResults]);

  const activeFilterCount = useMemo(() => countAppliedFilters(filters), [filters]);
  const searchModeLabel = searchMode === 'semantic' ? 'Filing research' : 'Boolean / proximity';
  const searchModeShortLabel = searchMode === 'semantic' ? 'FR' : 'BQ';
  const resultCountLabel = displayResults.length >= RESEARCH_RESULT_LIMIT ? `${RESEARCH_RESULT_LIMIT}+` : displayResults.length.toString();
  const isResearchFocusMode = isRailCollapsed && displayResults.length > 0;
  const lastUpdatedLabel = useMemo(() => {
    if (!activeSession?.updatedAt) {
      return '';
    }

    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(activeSession.updatedAt));
    } catch {
      return '';
    }
  }, [activeSession?.updatedAt]);

  const handleExportResults = useCallback(() => {
    // Export what is on screen, in the current sort — the workbook's Coverage
    // sheet records the query as executed and the corpus total so a partial
    // window can never masquerade as the full answer once detached.
    const search = lastResolvedSearch;
    const activeFilters = search?.filters;
    const filterSummary: string[] = [];
    if (activeFilters) {
      if (activeFilters.entityName.trim()) filterSummary.push(`Issuer: ${activeFilters.entityName}`);
      if (activeFilters.formTypes.length > 0) filterSummary.push(`Forms: ${activeFilters.formTypes.join(', ')}`);
      if (activeFilters.dateFrom || activeFilters.dateTo) filterSummary.push(`Dates: ${activeFilters.dateFrom || 'earliest'} – ${activeFilters.dateTo || 'latest'}`);
      if (activeFilters.accountant.trim()) filterSummary.push(`Auditor: ${activeFilters.accountant}`);
      if (activeFilters.sicCode.trim()) filterSummary.push(`SIC: ${activeFilters.sicCode}`);
      if (activeFilters.sectionKeywords.trim()) filterSummary.push(`Section keywords: ${activeFilters.sectionKeywords}`);
      if ((activeFilters.ascReference || '').trim()) filterSummary.push(`Cites: ${activeFilters.ascReference}`);
      if ((activeFilters.sectionScope || '').trim()) filterSummary.push(`In Item: ${activeFilters.sectionScope}`);
      if (activeFilters.accountingFramework.trim()) filterSummary.push(`Framework: ${activeFilters.accountingFramework}`);
    }
    void exportResultsWorkbook(displayResults, {
      query: search?.query || query,
      mode: search?.mode || searchMode,
      coverage: candidateCoverage,
      filterSummary,
    });
  }, [lastResolvedSearch, displayResults, query, searchMode, candidateCoverage]);

  const collapseResearchControls = useCallback(() => {
    setIsRailCollapsed(true);
    setIsQueryPanelCollapsed(true);
    setIsInsightsExpanded(false);
  }, []);

  const setRouteForSession = useCallback((session: ResearchSearchSession | null, replace = false) => {
    const params = session
      ? buildResearchRouteParams(session.query, session.mode, session.filters, session.id)
      : new URLSearchParams();
    setSearchParams(params, { replace });
  }, [setSearchParams]);

  const upsertSession = useCallback((
    session: ResearchSearchSession,
    options: { replaceUrl?: boolean; syncRoute?: boolean } = {}
  ) => {
    setSessions(prev => {
      const existingIndex = prev.findIndex(item => item.id === session.id);
      if (existingIndex === -1) {
        return [session, ...prev].slice(0, 8);
      }

      const next = [...prev];
      next[existingIndex] = session;
      return next;
    });
    if (options.syncRoute !== false) {
      setRouteForSession(session, Boolean(options.replaceUrl));
    }
  }, [setRouteForSession]);

  const [exactCountProgress, setExactCountProgress] = useState<string | null>(null);
  const [issuerFreshness, setIssuerFreshness] = useState<IssuerFreshnessNotice | null>(null);

  // Issuer-scoped searches: when the issuer has filed since the newest result
  // on screen (any form — usually ownership paperwork outside the research
  // scope), say so instead of letting a correct result read as staleness.
  //
  // The issuer is derived from the RESULTS, not the page filters: a typed
  // "GOOGL" is resolved to an issuer inside the search service, so the page's
  // own filter state never learns the CIK — but every returned row carries
  // it. One CIK across all shown results = an issuer-scoped view, however
  // the scoping happened.
  const scopedIssuer = useMemo(() => {
    if (displayResults.length === 0) return null;
    const ciks = new Set(displayResults.map(result => result.cik).filter(Boolean));
    if (ciks.size !== 1) return null;
    const newestShownDate = displayResults.reduce((max, result) => (result.fileDate > max ? result.fileDate : max), '');
    return { cik: [...ciks][0], name: displayResults[0].entityName, newestShownDate };
  }, [displayResults]);
  useEffect(() => {
    if (!scopedIssuer || !scopedIssuer.newestShownDate) {
      setIssuerFreshness(null);
      return;
    }
    let cancelled = false;
    void fetchCompanySubmissions(scopedIssuer.cik)
      .then(submission => {
        if (cancelled) return;
        const label = scopedIssuer.name || submission?.name || 'This issuer';
        setIssuerFreshness(buildIssuerFreshnessNotice(submission, scopedIssuer.newestShownDate, label));
      })
      .catch(() => { if (!cancelled) setIssuerFreshness(null); });
    return () => { cancelled = true; };
  }, [scopedIssuer]);

  // Exact counting sums date-sliced EFTS totals, which is only coherent when
  // the search ran as a SINGLE retrieval lane — multi-lane coverage totals
  // are maxima across lanes, and summing slices per lane would double-count.
  const canCountExactly = useMemo(() => {
    if (!candidateCoverage?.upstreamTotalIsFloor) return false;
    const search = lastResolvedSearch;
    if (!search || search.mode !== 'boolean') return false;
    const compiled = compileBooleanQuery(search.query);
    return compiled.ok && compiled.branches.length === 1 && !compiled.auditor;
  }, [candidateCoverage, lastResolvedSearch]);

  const handleCountExactly = useCallback(async () => {
    const search = lastResolvedSearch;
    if (!search) return;
    setExactCountProgress('2001');
    // A retry that succeeds must not leave the previous attempt's failure
    // notice on screen beside an exact number.
    setDegradedNotice(current => (current.startsWith('Exact counting failed') ? '' : current));
    try {
      const activeFilters = search.filters;
      const result = await countExactMatches({
        query: search.query,
        forms: activeFilters.formTypes.length > 0 ? activeFilters.formTypes.join(',') : DEFAULT_FORM_SCOPE,
        dateFrom: activeFilters.dateFrom || undefined,
        dateTo: activeFilters.dateTo || undefined,
        entityName: activeFilters.entityName || undefined,
        entityCik: activeFilters.entityCik || undefined,
      }, { onProgress: label => setExactCountProgress(label) });

      const upgrade = (coverage: SearchCandidateCoverage): SearchCandidateCoverage => ({
        ...coverage,
        upstreamTotal: Math.max(result.total, coverage.examined),
        upstreamTotalIsFloor: result.floor,
      });
      setCandidateCoverage(current => (current ? upgrade(current) : current));
      // Keep the upgraded number across tab switches and reloads.
      const session = sessionsRef.current.find(s => s.id === activeSessionIdRef.current);
      if (session?.coverage) {
        upsertSession({ ...session, coverage: upgrade(session.coverage) }, { syncRoute: false });
      }
    } catch (error) {
      console.error('Exact count failed:', error);
      setDegradedNotice('Exact counting failed part-way; the corpus total remains a floor.');
    } finally {
      setExactCountProgress(null);
    }
  }, [lastResolvedSearch, upsertSession]);


  const syncActiveSearchContext = useCallback((session: ResearchSearchSession | null) => {
    if (!session) {
      setActiveSearchContext(null);
      return;
    }

    setActiveSearchContext({
      surface: 'research',
      query: session.resolvedSearch.query,
      mode: session.resolvedSearch.mode,
      filters: session.resolvedSearch.filters,
      results: session.results,
      updatedAt: session.updatedAt,
    });
  }, [setActiveSearchContext]);

  const handleSearch = useCallback(async (
    searchQuery = query,
    overrideFilters = filters,
    overrideMode = searchMode,
    options: { preferredSessionId?: string; replaceUrl?: boolean } = {}
  ) => {
    // Query interpretation (form-scope defaulting, mode detection, Boolean
    // validation, inline-field promotion) is pure and lives in
    // services/researchSearchPlan so it can be tested without rendering a page.
    const plan = planResearchSearch(searchQuery, overrideFilters, overrideMode);

    if (plan.status === 'empty') return;
    if (plan.status === 'rejected') {
      // Invalid syntax must issue zero retrieval requests.
      setSearched(true);
      setErrorMsg(plan.message);
      return;
    }

    const { trimmed, mode: effectiveMode } = plan;
    const nextFilters = plan.filters;
    const interpreted = { query: plan.query, filters: plan.filters, appliedHints: plan.appliedHints };

    // Mirror a promoted auditor:<firm> token into the visible query box and
    // filter chips, so the UI shows the constraint it is actually applying.
    if (plan.promotedAuditor) {
      setQuery(plan.promotedAuditor.residualQuery);
      setFilters(plan.filters);
    }

    setLoading(true);
    setSearched(true);
    setErrorMsg('');
    setDegradedNotice('');
    setCandidateCoverage(null);
    setAlertMessage('');
    setTrendReport('');
    setTrendAiError('');
    setIsInsightsExpanded(false);
    setSearchInterpretation(interpreted.appliedHints);

    const draftSignature = buildSearchSignature(trimmed, effectiveMode, nextFilters);
    const activeSignature = activeSession
      ? buildSearchSignature(activeSession.query, activeSession.mode, activeSession.filters)
      : '';
    const targetSessionId =
      options.preferredSessionId ||
      (activeSession && (!activeSession.searched || activeSignature === draftSignature)
        ? activeSession.id
        : createResearchSessionId());

    // Supersede any in-flight run for this session: abort its fetches and mark
    // it stale so its late callbacks below become no-ops.
    const runId = (runCounterRef.current += 1);
    abortBySessionRef.current.get(targetSessionId)?.abort();
    const runAbort = new AbortController();
    abortBySessionRef.current.set(targetSessionId, runAbort);
    activeRunBySessionRef.current.set(targetSessionId, runId);
    const isCurrentRun = () => activeRunBySessionRef.current.get(targetSessionId) === runId;
    // Globally visible state (notices, coverage, results panel) may only be
    // written by the current run of the session the user is actually LOOKING
    // at — a background tab's still-current run must not overwrite the visible
    // search's status (readiness finding F-08). Until the new session's first
    // upsert lands, the submitting tab is still the visible one, so the run it
    // just launched counts as visible from the moment of submission.
    const visibleAtSubmit = activeSessionIdRef.current;
    let sessionUpserted = false;
    const isVisibleRun = () =>
      isCurrentRun() &&
      (sessionUpserted
        ? activeSessionIdRef.current === targetSessionId
        : activeSessionIdRef.current === visibleAtSubmit || activeSessionIdRef.current === targetSessionId);
    const guardedDegraded = (reason: string) => { if (isVisibleRun()) setDegradedNotice(reason); };
    // The run's own coverage, kept independently of the globally visible
    // accumulator so it can be stored on the session it belongs to — a
    // restored or re-activated tab then keeps its corpus answer.
    let runCoverage: SearchCandidateCoverage | null = null;
    const guardedCoverage: typeof captureCandidateCoverage = coverage => {
      runCoverage = mergeCandidateCoverage(runCoverage, coverage);
      if (isVisibleRun()) captureCandidateCoverage(coverage);
    };

    try {
      const effectiveQuery = interpreted.query || trimmed;
      const effectiveFilters = interpreted.filters;

      // Issuer scoping happens inside executeFilingResearchSearch — the
      // single shared resolver (with CIK threading) for every surface. A
      // page-level pre-resolve here set entityName without the CIK and
      // bypassed it.
      const resolvedSearch = {
        // An entity-resolved search intentionally clears the text query —
        // falling back to the raw prompt here would re-add the company name
        // as a relevance term and surface the oldest strong match first.
        query: effectiveFilters.entityName.trim() ? effectiveQuery : (effectiveQuery || trimmed),
        mode: effectiveMode,
        filters: effectiveFilters,
      };
      const canUseInstantEnrichedResponse = canUseInstantEnrichedSearch(
        resolvedSearch.query,
        resolvedSearch.filters,
        resolvedSearch.mode,
        RESEARCH_SEARCH_USES_ENRICHED_RESULTS
      );
      const fullHydrateSignals = shouldHydrateSearchSignals(effectiveMode, effectiveFilters);
      const initialLimit = canUseInstantEnrichedResponse
        ? RESEARCH_RESULT_LIMIT
        : effectiveMode === 'boolean'
          ? INITIAL_BOOLEAN_RESULT_LIMIT
          : INITIAL_RESEARCH_RESULT_LIMIT;
      const shouldRunVisibleAuditorRefinement =
        !canUseInstantEnrichedResponse &&
        effectiveMode === 'semantic' &&
        Boolean(effectiveFilters.accountant.trim());
      const shouldRunDeepRefinement =
        !canUseInstantEnrichedResponse &&
        (
          RESEARCH_RESULT_LIMIT > initialLimit ||
          (effectiveMode === 'semantic' && fullHydrateSignals && !shouldRunVisibleAuditorRefinement)
        );
      const shouldRunBackgroundRefinement =
        shouldRunVisibleAuditorRefinement ||
        shouldRunDeepRefinement;
      const createdAt =
        activeSession?.id === targetSessionId ? activeSession.createdAt : new Date().toISOString();

      const initialMatches = await executeFilingResearchSearch({
        query: resolvedSearch.query,
        filters: resolvedSearch.filters,
        mode: resolvedSearch.mode,
        defaultForms: DEFAULT_FORM_SCOPE,
        limit: initialLimit,
        useEnrichedSearch: RESEARCH_SEARCH_USES_ENRICHED_RESULTS,
        hydrateTextSignals: false,
        // Boolean/proximity results are never displayed before the expression
        // has been checked against the actual filing text.
        deferTextValidation: shouldRunBackgroundRefinement && resolvedSearch.mode !== 'boolean',
        onDegraded: guardedDegraded,
        onCoverage: guardedCoverage,
        signal: runAbort.signal,
      });

      // A newer search (or a session close) superseded this run while it was
      // in flight — drop its results rather than overwrite the current view.
      if (!isCurrentRun()) return;

      // Store the session regardless (its tab shows it later), but only touch
      // the globally visible results panel when this run's tab is the one on
      // screen (readiness finding F-08).
      if (isVisibleRun()) {
        setResults(initialMatches);
        setLastResolvedSearch(resolvedSearch);
      }

      const initialSession = buildResearchSession(
        targetSessionId,
        trimmed,
        effectiveMode,
        nextFilters,
        initialMatches,
        interpreted.appliedHints,
        resolvedSearch,
        createdAt,
        {
          isRefining: shouldRunBackgroundRefinement,
          coverage: runCoverage,
          errorMsg:
            initialMatches.length === 0 && !shouldRunBackgroundRefinement
              ? 'No filings matched that search. Try widening the date range, removing an auditor filter, or broadening the Boolean expression.'
              : '',
        }
      );

      upsertSession(initialSession, { replaceUrl: options.replaceUrl });
      sessionUpserted = true;
      syncActiveSearchContext(initialSession);

      if (initialMatches.length > 0) {
        collapseResearchControls();
      }

      if (initialSession.errorMsg) {
        setErrorMsg(initialSession.errorMsg);
      }

      if (!shouldRunBackgroundRefinement) {
        return;
      }

      const refinementKey = buildSearchSignature(resolvedSearch.query, resolvedSearch.mode, resolvedSearch.filters);
      pendingRefinementKeysRef.current.set(targetSessionId, refinementKey);
      setLoading(false);

      void (async () => {
        let baselineSession = initialSession;

        try {
          if (shouldRunVisibleAuditorRefinement) {
            const visibleAuditorMatches = await executeFilingResearchSearch({
              query: resolvedSearch.query,
              filters: resolvedSearch.filters,
              mode: resolvedSearch.mode,
              defaultForms: DEFAULT_FORM_SCOPE,
              limit: initialLimit,
              useEnrichedSearch: RESEARCH_SEARCH_USES_ENRICHED_RESULTS,
              hydrateTextSignals: true,
              deferTextValidation: false,
              preferFastCandidateCollection: true,
              onDegraded: guardedDegraded,
              onCoverage: guardedCoverage,
              signal: runAbort.signal,
            });

            if (!isCurrentRun() || pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) {
              return;
            }

            const currentSession = sessionsRef.current.find(session => session.id === targetSessionId);
            const visibleAuditorSession = buildResearchSession(
              targetSessionId,
              trimmed,
              effectiveMode,
              nextFilters,
              visibleAuditorMatches,
              interpreted.appliedHints,
              resolvedSearch,
              createdAt,
              {
                isRefining: shouldRunDeepRefinement,
                coverage: runCoverage,
                selectedResultId: currentSession?.selectedResultId || baselineSession.selectedResultId,
                errorMsg:
                  visibleAuditorMatches.length === 0 && !shouldRunDeepRefinement
                    ? 'No filings matched that search. Try widening the date range, removing an auditor filter, or broadening the Boolean expression.'
                    : '',
              }
            );

            baselineSession = visibleAuditorSession;
            upsertSession(visibleAuditorSession, { syncRoute: false });
            if (activeSessionIdRef.current === targetSessionId) {
              syncActiveSearchContext(visibleAuditorSession);
            }

            if (!shouldRunDeepRefinement) {
              pendingRefinementKeysRef.current.delete(targetSessionId);
              return;
            }
          }

          let lastProgressUpdate = 0;
          const refinedMatches = await executeFilingResearchSearch({
            query: resolvedSearch.query,
            filters: resolvedSearch.filters,
            mode: resolvedSearch.mode,
            defaultForms: DEFAULT_FORM_SCOPE,
            limit: RESEARCH_RESULT_LIMIT,
            useEnrichedSearch: RESEARCH_SEARCH_USES_ENRICHED_RESULTS,
            hydrateTextSignals: fullHydrateSignals,
            deferTextValidation: false,
            onDegraded: guardedDegraded,
            onCoverage: guardedCoverage,
            signal: runAbort.signal,
            onProgress: (progressResults) => {
              const now = Date.now();
              if (now - lastProgressUpdate < 800) return;
              lastProgressUpdate = now;

              if (!isCurrentRun() || pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) return;

              const currentSession = sessionsRef.current.find(s => s.id === targetSessionId);
              const progressSession = buildResearchSession(
                targetSessionId,
                trimmed,
                effectiveMode,
                nextFilters,
                progressResults,
                interpreted.appliedHints,
                resolvedSearch,
                createdAt,
                {
                  isRefining: true,
                  coverage: runCoverage,
                  selectedResultId: currentSession?.selectedResultId || baselineSession.selectedResultId,
                }
              );

              upsertSession(progressSession, { syncRoute: false });
              if (activeSessionIdRef.current === targetSessionId) {
                syncActiveSearchContext(progressSession);
              }
            },
          });

          if (!isCurrentRun() || pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) {
            return;
          }

          const currentSession = sessionsRef.current.find(session => session.id === targetSessionId);

          // A refinement that stopped early with less than the initial pass
          // already verified must not clobber it — in Boolean mode both
          // windows are verified, so keep their union.
          const settledMatches = effectiveMode === 'boolean'
            ? mergeVerifiedResultWindows(refinedMatches, baselineSession.results, RESEARCH_RESULT_LIMIT)
            : refinedMatches;

          const refinedSession = buildResearchSession(
            targetSessionId,
            trimmed,
            effectiveMode,
            nextFilters,
            settledMatches,
            interpreted.appliedHints,
            resolvedSearch,
            createdAt,
            {
              coverage: runCoverage,
              selectedResultId: currentSession?.selectedResultId || baselineSession.selectedResultId,
              errorMsg:
                settledMatches.length === 0
                  ? 'No filings matched that search. Try widening the date range, removing an auditor filter, or broadening the Boolean expression.'
                  : '',
            }
          );

          upsertSession(refinedSession, { syncRoute: false });
          if (activeSessionIdRef.current === targetSessionId) {
            syncActiveSearchContext(refinedSession);
          }
          pendingRefinementKeysRef.current.delete(targetSessionId);
        } catch (refinementError) {
          console.error('Background research refinement failed:', refinementError);

          if (!isCurrentRun() || pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) {
            return;
          }

          const currentSession = sessionsRef.current.find(session => session.id === targetSessionId);

          const fallbackSession = buildResearchSession(
            targetSessionId,
            trimmed,
            effectiveMode,
            nextFilters,
            baselineSession.results,
            interpreted.appliedHints,
            resolvedSearch,
            createdAt,
            {
              isRefining: false,
              coverage: runCoverage,
              selectedResultId: currentSession?.selectedResultId || baselineSession.selectedResultId,
              errorMsg:
                baselineSession.results.length === 0
                  ? 'Research search failed. Check the SEC proxy path or try a narrower query.'
                  : '',
            }
          );

          upsertSession(fallbackSession, { syncRoute: false });
          if (activeSessionIdRef.current === targetSessionId) {
            syncActiveSearchContext(fallbackSession);
          }
          pendingRefinementKeysRef.current.delete(targetSessionId);
        }
      })();

      return;
    } catch (error) {
      console.error('Research search failed:', error);
      // A superseded/aborted run's failure must not clobber the current view.
      if (!isCurrentRun()) return;
      if (isVisibleRun()) setResults([]);
      pendingRefinementKeysRef.current.delete(targetSessionId);
      const failedSession = buildResearchSession(
        targetSessionId,
        trimmed,
        effectiveMode,
        nextFilters,
        [],
        interpreted.appliedHints,
        {
          query: trimmed,
          mode: effectiveMode,
          filters: nextFilters,
        },
        activeSession?.id === targetSessionId ? activeSession.createdAt : new Date().toISOString(),
        {
          coverage: runCoverage,
          errorMsg: 'Research search failed. Check the SEC proxy path or try a narrower query.',
        }
      );

      setErrorMsg(failedSession.errorMsg);
      upsertSession(failedSession, { replaceUrl: options.replaceUrl });
      syncActiveSearchContext(failedSession);
    } finally {
      setLoading(false);
    }
  }, [
    activeSession,
    filters,
    query,
    searchMode,
    captureCandidateCoverage,
    collapseResearchControls,
    syncActiveSearchContext,
    upsertSession,
  ]);

  useEffect(() => {
    handleSearchRef.current = handleSearch;
  }, [handleSearch]);

  useEffect(() => {
    if (!activeSession) {
      coverageRestoredForSessionRef.current = null;
      return;
    }

    activeSessionIdRef.current = activeSession.id;
    // Restore the session's coverage snapshot only when SWITCHING sessions.
    // This effect also fires on every upsert of the same session during a
    // live run, where the page accumulator is fresher than the snapshot.
    if (coverageRestoredForSessionRef.current !== activeSession.id) {
      coverageRestoredForSessionRef.current = activeSession.id;
      setCandidateCoverage(activeSession.coverage ?? null);
    }
    setQuery(activeSession.query);
    setSearchMode(activeSession.mode);
    setFilters(cloneSearchFilters(activeSession.filters));
    setResults(activeSession.results);
    setSearched(activeSession.searched);
    setErrorMsg(activeSession.errorMsg);
    setSearchInterpretation([...activeSession.interpretation]);
    setLastResolvedSearch({
      query: activeSession.resolvedSearch.query,
      mode: activeSession.resolvedSearch.mode,
      filters: cloneSearchFilters(activeSession.resolvedSearch.filters),
    });
    setTrendReport('');
    setTrendAiError('');
    setIsInsightsExpanded(false);
    setAlertMessage('');
    syncActiveSearchContext(activeSession);
  }, [activeSession, syncActiveSearchContext]);

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id || null;
  }, [activeSession?.id]);

  useEffect(() => {
    // A URL without a tab is an external search intent (dashboard alert,
    // Accounting Hub, copied URL). It takes precedence over restored sessions.
    if (!initialRouteSearch || !shouldHandleExternalResearchRoute(
      activeTabId,
      initialRouteSearch,
      routeParamString,
      handledExternalRouteRef.current
    )) {
      return;
    }

    handledExternalRouteRef.current = routeParamString;
    const sessionId = createResearchSessionId();
    setQuery(initialRouteSearch.query);
    setSearchMode(initialRouteSearch.mode);
    setFilters(cloneSearchFilters(initialRouteSearch.filters));
    void handleSearchRef.current?.(
      initialRouteSearch.query,
      initialRouteSearch.filters,
      initialRouteSearch.mode,
      { preferredSessionId: sessionId, replaceUrl: true }
    );
  }, [activeTabId, initialRouteSearch, routeParamString]);


  useEffect(() => {
    if (!pendingSearchIntent || pendingSearchIntent.surface !== 'research') return;

    const sessionId = createResearchSessionId();
    if (pendingSearchIntent.prefetchedResults) {
      const session: ResearchSearchSession = {
        id: sessionId,
        title: buildResearchSessionTitle(pendingSearchIntent.query, pendingSearchIntent.filters),
        query: pendingSearchIntent.query,
        mode: pendingSearchIntent.mode,
        filters: cloneSearchFilters(pendingSearchIntent.filters),
        results: pendingSearchIntent.prefetchedResults,
        isRefining: false,
        searched: true,
        errorMsg:
          pendingSearchIntent.prefetchedResults.length === 0
            ? 'No filings matched that search. Try widening the date range, removing an auditor filter, or broadening the Boolean expression.'
            : '',
        interpretation: [],
        resolvedSearch: {
          query: pendingSearchIntent.query,
          mode: pendingSearchIntent.mode,
          filters: cloneSearchFilters(pendingSearchIntent.filters),
        },
        selectedResultId: pendingSearchIntent.prefetchedResults[0]?.id || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      upsertSession(session);
      syncActiveSearchContext(session);
      if (pendingSearchIntent.prefetchedResults.length > 0) {
        collapseResearchControls();
      }
    } else {
      void handleSearch(
        pendingSearchIntent.query,
        pendingSearchIntent.filters,
        pendingSearchIntent.mode,
        { preferredSessionId: sessionId }
      );
    }

    setPendingSearchIntent(null);
  }, [collapseResearchControls, handleSearch, pendingSearchIntent, setPendingSearchIntent, syncActiveSearchContext, upsertSession]);

  useEffect(() => {
    setPreviewError(false);
    setPreviewLoadedToken(0);
  }, [selectedResult?.id]);

  const handlePreviewLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
    const frame = event.target as HTMLIFrameElement;
    try {
      if (frame.contentDocument?.body?.innerHTML === '') {
        setPreviewError(true);
        return;
      }
      setPreviewLoadedToken(prev => prev + 1);
    } catch {
      setPreviewError(true);
    }
  }, []);

  useEffect(() => {
    const doc = previewFrameRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    clearDocumentHighlights(doc);
    if (previewHighlightTerms.length === 0) return;

    const marks = highlightDocumentSearchTerms(doc, previewHighlightTerms);
    if (marks.length > 0) {
      marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [previewHighlightTerms, previewLoadedToken, selectedResult?.id]);

  const updateSelectedResult = useCallback((resultId: string) => {
    if (!activeSession) return;
    const updatedSession: ResearchSearchSession = {
      ...activeSession,
      selectedResultId: resultId,
      updatedAt: new Date().toISOString(),
    };
    upsertSession(updatedSession, { replaceUrl: true });
  }, [activeSession, upsertSession]);

  const closeSession = useCallback((sessionId: string) => {
    pendingRefinementKeysRef.current.delete(sessionId);
    // Cancel any in-flight run for the closed session so it can't resurrect it.
    abortBySessionRef.current.get(sessionId)?.abort();
    abortBySessionRef.current.delete(sessionId);
    activeRunBySessionRef.current.delete(sessionId);
    setSessions(prev => {
      const next = prev.filter(item => item.id !== sessionId);
      const nextActive =
        (activeTabId === sessionId ? next[0] : next.find(item => item.id === activeTabId)) ||
        next[0] ||
        null;
      setRouteForSession(nextActive);
      if (!nextActive) {
        setResults([]);
        setSearched(false);
        setErrorMsg('');
        setSearchInterpretation([]);
        setIsRailCollapsed(false);
        setIsQueryPanelCollapsed(false);
        setIsInsightsExpanded(false);
        setLastResolvedSearch({
          query: '',
          mode: 'semantic',
          filters: {
            ...defaultSearchFilters,
            formTypes: ['10-K', '10-Q'],
          },
        });
        setActiveSearchContext(null);
      }
      return next;
    });
  }, [activeTabId, setActiveSearchContext, setRouteForSession]);


  const openFiling = useCallback((row: FilingResearchResult) => {
    const params = new URLSearchParams();
    params.set('company', row.companyName || row.entityName);
    params.set('date', row.fileDate);
    params.set('form', row.formType);
    if (row.fileNumber) params.set('file', row.fileNumber);
    if (row.auditor) params.set('auditor', row.auditor);
    if (activeResolvedSearch.query) params.set('highlight', activeResolvedSearch.query);
    params.set('highlightMode', activeResolvedSearch.mode);
    if (activeResolvedSearch.filters.sectionKeywords) {
      params.set('highlightSection', activeResolvedSearch.filters.sectionKeywords);
    }
    if (activeSession?.id) params.set('session', activeSession.id);
    const returnParams = activeSession
      ? buildResearchRouteParams(activeSession.query, activeSession.mode, activeSession.filters, activeSession.id)
      : new URLSearchParams();
    params.set('returnTo', `/search${returnParams.size ? `?${returnParams.toString()}` : ''}`);
    navigate.push(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}?${params.toString()}`);
  }, [activeResolvedSearch, activeSession, navigate]);

  async function handleTrendReport() {
    if (displayResults.length === 0) return;

    setTrendLoading(true);
    setTrendAiError('');
    setIsInsightsExpanded(false);
    try {
      const statsSummary = await buildSearchTrendSummary(displayResults.slice(0, 20), query, filters);
      const prompt = `You are an SEC accounting research analyst. Create a concise market trend report from this filing search dataset.\n\n${statsSummary}\n\nTop results:\n${displayResults
          .slice(0, 12)
          .map(result => `- ${result.fileDate} | ${result.entityName} | ${result.formType} | ${result.matchSnippet || result.description || 'No description'} | Auditor: ${result.auditor || 'Unknown'} | SIC: ${result.sicDescription || result.sic || 'Unknown'}`)
          .join('\n')}\n\nProvide a short report with: overall trend, what peers appear to be doing, and what to investigate next.`;
      const generated = await generateSearchTrendReport(prompt, statsSummary);
      setTrendReport(generated.report);
      setTrendAiError(generated.aiError);
    } catch (error) {
      console.error('Trend report error:', error);
      setTrendReport(await buildSearchTrendSummary(displayResults.slice(0, 20), query, filters));
      setTrendAiError(SEARCH_TREND_AI_FALLBACK);
    } finally {
      setTrendLoading(false);
    }
  }

  function handleCreateAlert() {
    if (!hasResearchSearchCriteria(query, filters)) return;

    addSavedAlert({
      name: buildAlertName(query, filters),
      query,
      mode: searchMode,
      filters,
      defaultForms: DEFAULT_FORM_SCOPE,
      lastSeenAccessions: displayResults.map(result => result.accessionNumber),
      latestNewAccessions: [],
      latestResultCount: displayResults.length,
    });
    setAlertMessage('Saved locally in this browser. Rerun it manually from the Dashboard; it does not send scheduled background notifications.');
  }

  useEffect(() => {
    if (!selectedResult) return;
    if (!isPlaceholderPrimaryDocument(selectedResult.primaryDocument, selectedResult.accessionNumber)) return;
    if (resolvedPreviewDocs[selectedResult.id] !== undefined) return;
    let cancelled = false;
    void resolvePrimaryDocumentPath(selectedResult.cik, selectedResult.accessionNumber).then(doc => {
      if (!cancelled) setResolvedPreviewDocs(prev => ({ ...prev, [selectedResult.id]: doc }));
    });
    return () => { cancelled = true; };
  }, [selectedResult, resolvedPreviewDocs]);

  const selectedIsCited = selectedResult
    ? memoCitations.some(item => item.id === citationId(selectedResult.cik, selectedResult.accessionNumber))
    : false;

  const selectedPrimaryDocument = selectedResult
    ? (isPlaceholderPrimaryDocument(selectedResult.primaryDocument, selectedResult.accessionNumber)
        ? resolvedPreviewDocs[selectedResult.id] || ''
        : selectedResult.primaryDocument)
    : '';
  const selectedDocumentUrl = selectedResult && selectedPrimaryDocument
    ? buildSecDocumentUrl(selectedResult.cik, selectedResult.accessionNumber, selectedPrimaryDocument)
    : '';
  const selectedProxyUrl = selectedResult && selectedPrimaryDocument
    ? buildSecProxyUrl(`Archives/edgar/data/${selectedResult.cik}/${selectedResult.accessionNumber.replace(/-/g, '')}/${selectedPrimaryDocument}`)
    : '';

  return (
    <div
      className={`research-shell ${isRailCollapsed ? 'research-shell--rail-collapsed' : ''} ${isResearchFocusMode ? 'research-shell--focus' : ''}`}
    >
      {isRailCollapsed ? (
        <aside className="research-rail-collapsed glass-card">
          <button
            type="button"
            className="research-collapse-btn research-collapse-btn--icon"
            onClick={() => setIsRailCollapsed(false)}
            aria-label="Expand search filters"
            title="Show filters"
          >
            <ChevronRight size={16} />
          </button>
          <div className="research-rail-collapsed-stack">
            <div className="research-rail-collapsed-badge" title={`${activeFilterCount} active filters`}>
              <Filter size={15} />
              <span>{activeFilterCount}</span>
            </div>
            <div className="research-rail-collapsed-badge" title={searchModeLabel}>
              {searchMode === 'semantic' ? <Sparkles size={15} /> : <Hash size={15} />}
              <span>{searchModeShortLabel}</span>
            </div>
          </div>
        </aside>
      ) : (
        <aside className="research-rail glass-card">
          <div className="research-rail-header">
            <div className="research-rail-copy">
              <h1>Research Workbench</h1>
              <p>
                Run natural-language or Boolean research, keep each search in its own tab, and review matched filings in a split workspace instead of losing context.
              </p>
            </div>
            <button
              type="button"
              className="research-collapse-btn"
              onClick={() => setIsRailCollapsed(true)}
              aria-label="Collapse search filters"
            >
              <ChevronLeft size={16} />
              <span>Hide</span>
            </button>
          </div>

          <div className="research-rail-banner">
            <div>
              <div className="eyebrow">Natural-language search</div>
              <div className="copy">{BRAND.shortName} now rewrites prompts into forms, date windows, auditors, and tighter phrase queries before hitting EDGAR.</div>
            </div>
            <button className="secondary-btn" onClick={() => setChatOpen(true)}>
              <MessageSquare size={16} /> Ask {BRAND.copilotName}
            </button>
          </div>

          <div className="research-mode-switch" role="group" aria-label="Search mode">
            <button
              type="button"
              className={`toggle-btn ${searchMode === 'semantic' ? 'active' : ''}`}
              onClick={() => setSearchMode('semantic')}
              aria-pressed={searchMode === 'semantic'}
            >
              <Sparkles size={16} /> Filing Research
            </button>
            <button
              type="button"
              className={`toggle-btn ${searchMode === 'boolean' ? 'active' : ''}`}
              onClick={() => setSearchMode('boolean')}
              aria-pressed={searchMode === 'boolean'}
            >
              <Hash size={16} /> Boolean / Proximity
            </button>
          </div>

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
              showAccountingFramework: true,
            }}
            filters={filters}
            onChange={setFilters}
            onSearch={() => void handleSearch(query)}
            loading={loading}
          />

          <div className="research-sample-block">
            {SAMPLE_SEARCHES.map(sample => (
              <button
                key={sample}
                type="button"
                className="sample-pill"
                onClick={() => {
                  setQuery(sample);
                  void handleSearch(sample);
                }}
              >
                {sample}
              </button>
            ))}
          </div>

          {/* Curated research library: categorized saved searches, each a
              runnable request that also demonstrates an engine capability
              (numeric operands, section scoping, standards citations). */}
          <div className="research-sample-block" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
            <button
              type="button"
              className="sample-pill"
              aria-expanded={libraryOpen}
              onClick={() => setLibraryOpen(open => !open)}
              style={{ fontWeight: 600 }}
            >
              {libraryOpen ? '▾' : '▸'} Research Library
            </button>
            {libraryOpen && RESEARCH_LIBRARY.map(category => (
              <div key={category.name} style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                <div style={{ fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 2px' }}>
                  {category.name}
                </div>
                {category.entries.map(entry => (
                  <button
                    key={entry.title}
                    type="button"
                    className="sample-pill"
                    title={`${entry.hint}\n${entry.query}`}
                    onClick={() => {
                      const nextFilters = { ...defaultSearchFilters, ...entry.filters };
                      setSearchMode(entry.mode);
                      setFilters(nextFilters);
                      setQuery(entry.query);
                      void handleSearch(entry.query, nextFilters, entry.mode);
                    }}
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {searchMode === 'boolean' && (
            <div className="research-guide-card">
              <div className="guide-header">
                <div className="guide-title">Boolean / Proximity Guide</div>
                <button type="button" onClick={() => navigate.push('/support')}>Open full help</button>
              </div>
              <div className="guide-grid">
                {[
                  { operator: 'AND', meaning: 'Both terms must appear', example: 'temporary AND equity' },
                  { operator: 'OR', meaning: 'Either term can appear', example: 'ASR OR repurchase' },
                  { operator: 'NOT', meaning: 'Exclude a term', example: 'equity NOT mezzanine' },
                  { operator: '"phrase"', meaning: 'Match exact wording', example: '"accelerated share repurchase"' },
                  { operator: 'w/#', meaning: 'Terms must appear within the stated word distance', example: '"car parking" w/10 installation' },
                ].map(item => (
                  <div key={item.operator} className="guide-card">
                    <div className="operator">{item.operator}</div>
                    <div className="meaning">{item.meaning}</div>
                    <code>{item.example}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {alertMessage && <div className="research-alert-msg">{alertMessage}</div>}
        </aside>
      )}

      <section className="research-main">
        {isQueryPanelCollapsed ? (
          <div className="research-query-collapsed glass-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', gap: '16px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ResearchSessionTabs
                sessions={sessions}
                activeSessionId={activeSession?.id}
                emptyMessage="Searches open here."
                onSelect={setRouteForSession}
                onClose={closeSession}
              />
            </div>
            <div className="research-query-collapsed-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span className="research-context-chip research-context-chip--accent">
                <strong>{resultCountLabel}</strong> filings
              </span>
              {metrics.companies > 0 && (
                <span className="research-context-chip">
                  <strong>{metrics.companies}</strong> issuers
                </span>
              )}
              {isRailCollapsed && (
                <button type="button" className="secondary-btn" onClick={() => setIsRailCollapsed(false)}>
                  <Filter size={14} /> Filters
                </button>
              )}
              <button type="button" className="secondary-btn" onClick={() => setIsQueryPanelCollapsed(false)}>
                <ChevronDown size={14} /> Expand
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="research-query-panel glass-card el-scope">
              <div className="research-query-panel-header">
                <div className="eyebrow">Search query</div>
                <button
                  type="button"
                  className="research-collapse-btn"
                  onClick={() => setIsQueryPanelCollapsed(true)}
                  aria-label="Collapse search bar"
                >
                  <ChevronUp size={16} />
                  <span>Hide</span>
                </button>
              </div>
              <form
                className="research-query-form"
                onSubmit={event => {
                  event.preventDefault();
                  void handleSearch(query);
                }}
              >
                <Search className="search-icon" size={20} />
                <input
                  type="text"
                  placeholder={
                    searchMode === 'semantic'
                      ? 'Describe the issue you want to research...'
                      // The full operator set lives in the syntax popover; a
                      // placeholder vanishes the moment you type.
                      : 'e.g. "material weakness" AND auditor:KPMG'
                  }
                  value={query}
                  onChange={event => {
                    setQuery(event.target.value);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 150)}
                  role="combobox"
                  // A placeholder is not an accessible name; label the field
                  // explicitly so screen readers (and tests) can identify it.
                  aria-label={searchMode === 'semantic' ? 'Search filings' : 'Boolean search query'}
                  aria-controls={suggestionsOpen && querySuggestions.length > 0 ? 'workbench-company-listbox' : undefined}
                  aria-autocomplete="list"
                  aria-expanded={suggestionsOpen && querySuggestions.length > 0}
                />
                {searchMode === 'boolean' && (
                  <BooleanSyntaxHelpTrigger
                    expanded={syntaxHelpOpen}
                    onClick={() => setSyntaxHelpOpen(open => !open)}
                  />
                )}
                <button type="submit" className="primary-btn" disabled={loading}>
                  {loading ? <Loader2 size={16} className="spinner" /> : 'Search'}
                </button>
                {searchMode === 'boolean' && (
                  <BooleanSyntaxHelp open={syntaxHelpOpen} onClose={() => setSyntaxHelpOpen(false)} />
                )}
                {suggestionsOpen && querySuggestions.length > 0 && (
                  <div role="listbox" id="workbench-company-listbox" aria-label="Company suggestions" style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
                    marginTop: '4px', borderRadius: '8px', overflow: 'hidden',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                    boxShadow: 'var(--glow-shadow)',
                  }}>
                    {querySuggestions.map(entry => (
                      <button
                        key={entry.ticker}
                        type="button"
                        role="option"
                        aria-selected="false"
                        onMouseDown={event => {
                          event.preventDefault();
                          setQuery(`${entry.ticker} `);
                          setSuggestionsOpen(false);
                        }}
                        style={{
                          display: 'flex', gap: '10px', alignItems: 'baseline', width: '100%',
                          padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                          background: 'transparent', color: 'var(--text-primary)', fontSize: '0.82rem',
                        }}
                        onMouseEnter={event => { event.currentTarget.style.background = 'var(--interactive-hover)'; }}
                        onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}
                      >
                        <strong style={{ color: 'var(--accent-primary)', minWidth: '52px' }}>{entry.ticker}</strong>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </form>

              {searchInterpretation.length > 0 && (
                <div className="research-chip-row">
                  {searchInterpretation.map(item => (
                    <span key={item} className="research-chip">{item}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="research-toolbar glass-card el-scope">
              <ResearchSessionTabs
                sessions={sessions}
                activeSessionId={activeSession?.id}
                emptyMessage="Searches open here as tabs so you can move between result sets without losing context."
                onSelect={setRouteForSession}
                onClose={closeSession}
              />

              <div className="research-toolbar-actions">
                <button className="secondary-btn" onClick={handleCreateAlert} disabled={!hasResearchSearchCriteria(query, filters)}>
                  <BellRing size={16} /> Save Alert
                </button>
              </div>
            </div>

            {displayResults.length > 0 && (
              <div className="research-context-stack">
                <div className="research-context-bar glass-card el-scope">
                  <div className="research-context-copy">
                    <div className="eyebrow">Search context</div>
                    <div className="research-context-chip-row">
                      <span className="research-context-chip research-context-chip--accent">
                        <strong>{resultCountLabel}</strong>
                        <span>filing{displayResults.length === 1 ? '' : 's'}</span>
                      </span>
                      <span className="research-context-chip">
                        <span className="label">Issuers</span>
                        <strong>{metrics.companies}</strong>
                      </span>
                      <span className="research-context-chip">
                        <span className="label">Top form</span>
                        <strong>{metrics.topForm}</strong>
                      </span>
                      {metrics.topAuditor && (
                        <span className="research-context-chip">
                          <span className="label">Top auditor</span>
                          <strong>{metrics.topAuditor}</strong>
                        </span>
                      )}
                      {lastUpdatedLabel && (
                        <span className="research-context-chip">
                          <span className="label">Updated</span>
                          <strong>{lastUpdatedLabel}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="research-context-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={handleTrendReport}
                      disabled={displayResults.length === 0 || trendLoading}
                    >
                      {trendLoading ? <Loader2 size={16} className="spinner" /> : <Sparkles size={16} />}
                      {trendReport ? 'Refresh Insight' : 'Generate Insight'}
                    </button>
                    {trendReport && (
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => setIsInsightsExpanded(current => !current)}
                      >
                        {isInsightsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {isInsightsExpanded ? 'Hide Insight' : 'Show Insight'}
                      </button>
                    )}
                  </div>
                </div>

                {trendReport && isInsightsExpanded && (
                  <div className="glass-card research-insight-panel">
                    <div className="trend-title"><Sparkles size={18} /> Trend report</div>
                    {trendAiError && <p role="status" className="research-refining-banner">{trendAiError}</p>}
                    <div className="md-content research-insight-copy">
                      {trendReport.split('\n').map((line, index) => <p key={index}>{line}</p>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div
          className="research-workspace el-scope"
          role={activeSession ? 'tabpanel' : undefined}
          id={activeSession ? `research-panel-${activeSession.id}` : undefined}
          aria-labelledby={activeSession ? researchTabId(activeSession.id) : undefined}
        >
          <div className="research-hit-list glass-card">
            <div className="pane-header">
              <div>
                <div className="eyebrow">Search hits</div>
                {/* Lead with the corpus answer ("how many filers disclosed X?"),
                    then how many of those are validated below — a bounded shown
                    count must never read as the size of the corpus. */}
                <h2>{displayResults.length > 0 ? buildResultsHeadline(displayResults.length, candidateCoverage, RESEARCH_RESULT_LIMIT) : 'No results yet'}</h2>
              </div>
              {displayResults.length > 1 && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  {([['relevance', 'Relevance'], ['newest', 'Newest']] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setResultSort(value)} aria-pressed={resultSort === value}
                      style={{
                        padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
                        border: '1px solid ' + (resultSort === value ? 'rgba(214,108,174,0.6)' : 'var(--input-border)'),
                        background: resultSort === value ? 'rgba(179,31,126,0.25)' : 'var(--surface-panel)',
                        color: resultSort === value ? 'var(--accent-soft)' : 'var(--text-secondary)',

                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {displayResults.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportResults}
                  title="Download this result set as a workbook: results, extracted issuer list, and coverage"
                  style={{
                    padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
                    border: '1px solid var(--input-border)', background: 'var(--surface-panel)',
                    color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px',
                  }}
                >
                  <Download size={12} aria-hidden="true" /> Export .xlsx
                </button>
              )}
              <div className="pane-hint">Select a filing to preview it here, then open the full workspace only when you need the full toolset.</div>
            </div>

            {!loading && degradedNotice && (
              <div role="status" className="research-refining-banner" style={{ justifyContent: 'space-between' }}>
                <span>{degradedNotice} Filing-text validation and Boolean semantics remain enforced.</span>
                <button type="button" onClick={() => setDegradedNotice('')} aria-label="Dismiss EDGAR fallback status" style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>×</button>
              </div>
            )}
            {!loading && (candidateCoverage || pagedDisplayResults.length > 0) && (
              <div role="status" style={{ padding: '7px 12px', color: 'var(--text-muted)', fontSize: '0.7rem', borderBottom: '1px solid var(--input-border)' }}>
                {candidateCoverage
                  ? `Candidate coverage: examined ${candidateCoverage.examined.toLocaleString()} of ${formatUpstreamTotal(candidateCoverage)} upstream candidates (${candidateCoverage.complete ? 'complete' : 'partial candidate window'}). `
                  : ''}
                {canCountExactly && (
                  // EDGAR stops counting one query at 10,000; counts of date
                  // slices are exact and sum. ~26 cheap requests on demand.
                  <button
                    type="button"
                    onClick={handleCountExactly}
                    disabled={exactCountProgress !== null}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-soft)', fontSize: '0.7rem', textDecoration: 'underline' }}
                  >
                    {exactCountProgress !== null ? `Counting ${exactCountProgress}…` : 'Count exactly'}
                  </button>
                )}
                {' '}
                {pagedDisplayResults.length > 0
                  ? `SIC metadata is available for ${pagedDisplayResults.filter(result => Boolean(result.sic.trim())).length}/${pagedDisplayResults.length} results on this page; official EDGAR submissions supply missing candidate metadata where available.`
                  : ''}
              </div>
            )}

            {loading ? (
              <div className="research-empty-state">
                <Loader2 size={28} className="spinner" />
                <div>Searching EDGAR, validating text matches, and ranking the strongest hits...</div>
              </div>
            ) : displayResults.length > 0 ? (
              <>
                {/* What actually ran, before what it returned — a rewrite the
                    engine made silently is otherwise undetectable. */}
                <ActiveQueryChips
                  mode={activeResolvedSearch.mode === 'boolean' ? 'boolean' : 'semantic'}
                  query={activeResolvedSearch.query}
                  entityName={activeResolvedSearch.filters.entityName || undefined}
                  auditor={activeResolvedSearch.filters.accountant || undefined}
                  forms={activeResolvedSearch.filters.formTypes}
                  dateFrom={activeResolvedSearch.filters.dateFrom || undefined}
                  dateTo={activeResolvedSearch.filters.dateTo || undefined}
                />
                {/* The denominator. Without it a bounded result set and an
                    exhaustive one look identical to the reader. */}
                <SearchScopeBanner
                  forms={activeResolvedSearch.filters.formTypes}
                  dateFrom={activeResolvedSearch.filters.dateFrom || undefined}
                  dateTo={activeResolvedSearch.filters.dateTo || undefined}
                  shown={displayResults.length}
                />
                {isRefiningResults && (
                  <div className="research-refining-banner">
                    <Loader2 size={14} className="spinner" />
                <span>Showing initial hits while {BRAND.shortName} validates filing text and loads more results in the background.</span>
                  </div>
                )}
                {displayResults.some(result => !result.auditor?.trim()) && !auditorNoticeDismissed && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 12px', margin: '0 0 8px', borderRadius: '8px', background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--status-warning) 30%, transparent)', fontSize: '0.75rem', color: 'var(--status-warning)' }}>
                    <span>Auditor identification covers fiscal 2017+ (PCAOB Form AP); older or non-issuer filings may not show one.</span>
                    <button type="button" onClick={() => setAuditorNoticeDismissed(true)} aria-label="Dismiss auditor coverage notice"
                      style={{ background: 'none', border: 'none', color: 'var(--status-warning)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1 }}>×</button>
                  </div>
                )}
                {issuerFreshness && (
                  // A correct-but-older newest result reads as staleness unless
                  // the product says why: the issuer HAS filed since, outside
                  // this search's scope (usually ownership forms).
                  <div role="status" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 12px', margin: '0 0 8px', borderRadius: '8px', background: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span>{issuerFreshness.message}</span>
                    {issuerFreshness.insider && (
                      <button type="button" onClick={() => navigate.push('/insiders')}
                        style={{ whiteSpace: 'nowrap', background: 'none', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '3px 10px', color: 'var(--accent-soft)', cursor: 'pointer', fontSize: '0.72rem' }}>
                        Insider Trading
                      </button>
                    )}
                  </div>
                )}
                <div className="research-hit-scroll">
                  {pagedDisplayResults.map(result => (
                    <button
                      key={result.id}
                      className={`research-hit-card ${selectedResult?.id === result.id ? 'active' : ''}`}
                      onClick={() => updateSelectedResult(result.id)}
                    >
                      <div className="topline">
                        <span className="date">{result.fileDate}</span>
                        {/* Truth-bound provenance: text-validated hits carry a
                            non-metadata matchReason; 'Matched filing metadata'
                            means the filing text was not checked. */}
                        {(() => {
                          const textValidated = Boolean(result.matchReason && !/metadata/i.test(result.matchReason));
                          const badgeClass = textValidated ? 'el-badge-verified' : result.matchReason ? 'el-badge-neutral' : 'el-badge-review';
                          // Which engine vouched for the match matters: SEC's
                          // index read the whole filing, we read a fetched copy.
                          const upstreamMatch = /full-text index/i.test(result.matchReason || '');
                          const badgeLabel = upstreamMatch
                            ? 'SEC index'
                            : textValidated ? 'Text validated' : result.matchReason ? 'Metadata' : 'Preliminary';
                          return <span className={`el-badge ${badgeClass}`}>{badgeLabel}</span>;
                        })()}
                        <span className="form">{formatResultFormLabel(result)}</span>
                      </div>
                      <div className="company">{result.entityName}</div>
                      <div className="meta">
                        {buildAuditorDisplayLabel(result.auditor, activeResolvedSearch.filters, isRefiningResults) && (
                          <span>{buildAuditorDisplayLabel(result.auditor, activeResolvedSearch.filters, isRefiningResults)}</span>
                        )}
                        <span>{result.sicDescription || result.sic || 'Industry unavailable'}</span>
                      </div>
                      <div className="match-reason">{result.matchReason || 'Preliminary match — open the filing to confirm context'}</div>
                      {result.matchSectionPath && (
                        // Intelligize-style section breadcrumb: where in the
                        // filing the validated match lives, read from the same
                        // text the Boolean engine matched against.
                        <div className="match-provenance" title="Section derived from the validated filing text">
                          {result.matchSectionPath}
                        </div>
                      )}
                      {result.matchedDocumentType && (
                        // The row is the parent filing; name the exhibit that
                        // actually carried the match so the evidence is traceable.
                        <div className="match-provenance">
                          Matched in {result.matchedDocumentType}
                          {result.matchedDocumentCount && result.matchedDocumentCount > 1
                            ? ` (+${result.matchedDocumentCount - 1} more exhibit${result.matchedDocumentCount - 1 === 1 ? '' : 's'})`
                            : ''}
                        </div>
                      )}
                      <div className="snippet">
                        {renderHighlightedText(result.matchSnippet || result.description || 'Matched on filing metadata.', previewHighlightTerms)}
                      </div>
                    </button>
                  ))}
                </div>
                {resultPageCount > 1 && (
                  <nav
                    aria-label="Search result pages"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px 4px' }}
                  >
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setResultPage(page => Math.max(1, page - 1))}
                      disabled={resultPage === 1}
                    >
                      <ChevronLeft size={14} /> Previous
                    </button>
                    <span aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {`${(resultPage - 1) * RESEARCH_RESULTS_PAGE_SIZE + 1}–${Math.min(resultPage * RESEARCH_RESULTS_PAGE_SIZE, sortedDisplayResults.length)} of ${sortedDisplayResults.length}`}
                    </span>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => setResultPage(page => Math.min(resultPageCount, page + 1))}
                      disabled={resultPage === resultPageCount}
                    >
                      Next <ChevronRight size={14} />
                    </button>
                  </nav>
                )}
              </>
            ) : searched ? (
              <div className="research-empty-state">
                <div>{buildResearchEmptyResultMessage(errorMsg, degradedNotice, candidateCoverage)}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Try a company name or ticker on its own, remove form-type or date filters, or switch the sort to Newest.
                </div>
              </div>
            ) : (
              <div className="research-empty-state">
                <div>Run a search to open a dedicated tab and preview the best hits side-by-side.</div>
              </div>
            )}
          </div>

          <div className="research-preview glass-card">
            {selectedResult ? (
              <>
                <div className="pane-header preview-header">
                  <div>
                    <div className="eyebrow">{formatResultFormLabel(selectedResult)} preview</div>
                    <h2>{selectedResult.entityName}</h2>
                    <div className="preview-meta-row">
                      <span>{selectedResult.fileDate}</span>
                      <span>{buildAuditorDisplayLabel(selectedResult.auditor, activeResolvedSearch.filters, isRefiningResults)}</span>
                      <span>{selectedResult.fileNumber || 'File number unavailable'}</span>
                    </div>
                  </div>
                  <div className="preview-actions">
                    <button className="secondary-btn" onClick={() => openFiling(selectedResult)}>
                      Open Filing
                    </button>
                    {selectedResult.cik && (
                      <a href={`/company/${Number(selectedResult.cik)}`} className="secondary-btn" title="Issuer dossier: filings, comment letters, auditor, financials">
                        Issuer dossier
                      </a>
                    )}
                    <a href={selectedDocumentUrl} target="_blank" rel="noreferrer" className="secondary-btn">
                      <ExternalLink size={14} /> SEC.gov
                    </a>
                    <button
                      type="button"
                      className="secondary-btn"
                      aria-pressed={selectedIsCited}
                      onClick={() => {
                        if (selectedIsCited) {
                          removeCitation(citationId(selectedResult.cik, selectedResult.accessionNumber));
                          return;
                        }
                        addCitation({
                          kind: 'filing',
                          cik: selectedResult.cik,
                          accessionNumber: selectedResult.accessionNumber,
                          company: selectedResult.entityName,
                          form: selectedResult.formType,
                          fileDate: selectedResult.fileDate,
                          excerpt: selectedResult.matchSnippet || selectedResult.description || '',
                          sourceUrl: selectedResult.filingUrl || selectedDocumentUrl,
                        });
                      }}
                    >
                      <BookMarked size={14} /> {selectedIsCited ? 'Cited ✓' : 'Cite'}
                    </button>
                  </div>
                </div>

                <div className="research-selected-snippet">
                  <div className="selected-match-label">
                    {selectedResult.matchReason || 'Matched filing text'}
                    {selectedResult.matchSectionPath ? ` — ${selectedResult.matchSectionPath}` : ''}
                  </div>
                  <div>{renderHighlightedText(selectedResult.matchSnippet || selectedResult.description || 'Matched on filing metadata.', previewHighlightTerms)}</div>
                </div>

                <div className="research-preview-frame-wrap">
                  {previewError || /\.(xml|pdf)$/i.test(selectedPrimaryDocument) ? (
                    <div className="research-preview-fallback">
                      <FileText size={42} />
                      <h3>Inline preview unavailable</h3>
                      <p>
                        This filing cannot be rendered inline with highlights in the embedded preview. Open the full filing workspace or SEC.gov instead.
                      </p>
                      <div className="preview-actions">
                        <button className="secondary-btn" onClick={() => openFiling(selectedResult)}>
                          Open Filing
                        </button>
                        <a href={selectedDocumentUrl} target="_blank" rel="noreferrer" className="secondary-btn">
                          <ExternalLink size={14} /> SEC.gov
                        </a>
                      </div>
                    </div>
                  ) : !selectedProxyUrl ? (
                    <div className="research-empty-state">
                      <Loader2 size={22} className="spinner" />
                      <div>Locating the official document for this filing on SEC EDGAR...</div>
                    </div>
                  ) : (
                    <iframe
                      ref={previewFrameRef}
                      src={selectedProxyUrl}
                      title={`${selectedResult.entityName} filing preview`}
                      className="research-preview-frame"
                      sandbox="allow-same-origin"
                      referrerPolicy="no-referrer"
                      onLoad={handlePreviewLoad}
                      onError={() => setPreviewError(true)}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="research-empty-state preview-empty">
                <div>Select a result to preview the filing and jump into the strongest matching context.</div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
