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
  type FilingResearchResult,
  type ResearchSearchMode,
} from '../services/filingResearch';
import {
  buildSecDocumentUrl,
  buildSecProxyUrl,
  isPlaceholderPrimaryDocument,
  resolvePrimaryDocumentPath,
  aliasTickerFor,
  getCompanyDirectory,
  type CompanyDirectoryEntry,
  type SearchCandidateCoverage,

} from '../services/secApi';
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
import { buildHighlightTerms, interpretSearchPrompt } from '../services/searchAssist';
import { buildResearchEmptyResultMessage } from '../services/searchCoverage';
import { generateSearchTrendReport, SEARCH_TREND_AI_FALLBACK } from '../services/searchTrendReport';
import { looksLikeBooleanQuery } from '../utils/booleanSearch';
import { canUseInstantEnrichedSearch } from '../services/filingResearch';
import { BRAND } from '../config/brand';
import './SearchPage.css';
import '../styles/evidence-ledger.css';
import { addCitation, citationId, removeCitation } from '../services/memoTray';
import { useMemoTray } from '../hooks/useMemoTray';

// Amendments included for every core form: EFTS matches form types exactly, so
// omitting 10-K/A etc. hides restatements — often the most material filings.
const DEFAULT_FORM_SCOPE = '10-K,10-K/A,10-Q,10-Q/A,8-K,8-K/A,DEF 14A,20-F,20-F/A,6-K,S-1,S-1/A';
const LEGACY_DEFAULT_FORM_SCOPE = ['10-K', '10-Q'];
const RESEARCH_RESULT_LIMIT = 500;
const INITIAL_RESEARCH_RESULT_LIMIT = 80;
const INITIAL_BOOLEAN_RESULT_LIMIT = 40;
const RESEARCH_RESULTS_PAGE_SIZE = 50;
const RESEARCH_SEARCH_USES_ENRICHED_RESULTS = true;
const SAMPLE_SEARCHES = [
  'ASC 842 adoption w/10 lease',
  'ASR w/5 derivative',
  'Temporary equity in last 3 years in 10-Q / 10-K audited by Deloitte',
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

function queryMentionsFormScope(value: string): boolean {
  return /\b(?:10[\s-]?k|10[\s-]?q|8[\s-]?k(?:\/a)?|6[\s-]?k|20[\s-]?f|def[\s-]?14a|s[\s-]?1)\b/i.test(value);
}

function hasOnlyLegacyDefaultFormScope(filters: SearchFilters): boolean {
  const normalizedForms = [...filters.formTypes].map(form => form.trim().toUpperCase()).sort();
  const isLegacyDefault =
    normalizedForms.length === LEGACY_DEFAULT_FORM_SCOPE.length &&
    normalizedForms.every((form, index) => form === LEGACY_DEFAULT_FORM_SCOPE[index]);

  if (!isLegacyDefault) {
    return false;
  }

  return !(
    filters.keyword.trim() ||
    filters.dateFrom.trim() ||
    filters.dateTo.trim() ||
    filters.entityName.trim() ||
    filters.sectionKeywords.trim() ||
    filters.sicCode.trim() ||
    filters.stateOfInc.trim() ||
    filters.headquarters.trim() ||
    filters.accountant.trim() ||
    filters.accessionNumber.trim() ||
    filters.fileNumber.trim() ||
    filters.fiscalYearEnd.trim() ||
    filters.accountingFramework.trim() ||
    filters.exchange.length > 0 ||
    filters.acceleratedStatus.length > 0
  );
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
  options: { isRefining?: boolean; errorMsg?: string; selectedResultId?: string | null } = {}
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

  const captureCandidateCoverage = useCallback((coverage: SearchCandidateCoverage) => {
    setCandidateCoverage(current => current
      ? {
          examined: Math.max(current.examined, coverage.examined),
          upstreamTotal: Math.max(current.upstreamTotal, coverage.upstreamTotal),
          complete: current.complete && coverage.complete,
        }
      : coverage);
  }, []);

  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const handledExternalRouteRef = useRef('');

  const activeSessionIdRef = useRef<string | null>(null);
  const pendingRefinementKeysRef = useRef<Map<string, string>>(new Map());
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
    const trimmed = query.trim();
    if (!trimmed || trimmed.split(/\s+/).length > 4 || companyDirectory.length === 0) {
      setQuerySuggestions([]);
      return;
    }
    const upper = trimmed.toUpperCase();
    const lower = trimmed.toLowerCase();
    const seen = new Set<string>();
    const matches: CompanyDirectoryEntry[] = [];
    const push = (entry: CompanyDirectoryEntry | undefined) => {
      if (entry && !seen.has(entry.ticker)) {
        seen.add(entry.ticker);
        matches.push(entry);
      }
    };
    push(companyDirectory.find(entry => entry.ticker === upper));
    const alias = aliasTickerFor(upper);
    if (alias) push(companyDirectory.find(entry => entry.ticker === alias));
    for (const entry of companyDirectory) {
      if (matches.length >= 8) break;
      if (entry.ticker.startsWith(upper)) push(entry);
    }
    if (lower.length >= 3) {
      for (const entry of companyDirectory) {
        if (matches.length >= 8) break;
        if (entry.title.toLowerCase().includes(lower)) push(entry);
      }
    }
    setQuerySuggestions(matches.slice(0, 8));
  }, [query, companyDirectory]);

  const selectedResult = useMemo(() => {
    if (displayResults.length === 0) return null;
    if (!activeSession?.selectedResultId) return displayResults[0];
    return displayResults.find(item => item.id === activeSession.selectedResultId) || displayResults[0];
  }, [activeSession?.selectedResultId, displayResults]);

  const metrics = useMemo(() => {
    const companies = new Set(displayResults.map(result => result.entityName)).size;
    const auditors = displayResults.reduce<Record<string, number>>((acc, result) => {
      const key = result.auditor || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const topAuditor = Object.entries(auditors).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
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
    const trimmed = searchQuery.trim();
    let nextFilters = cloneSearchFilters(overrideFilters);
    const autoScopeHints: string[] = [];

    if (hasOnlyLegacyDefaultFormScope(nextFilters) && !queryMentionsFormScope(trimmed)) {
      nextFilters = {
        ...nextFilters,
        formTypes: [],
      };
      autoScopeHints.push('Form scope: all core filings');
    }

    const effectiveMode: ResearchSearchMode =
      overrideMode === 'semantic' && looksLikeBooleanQuery(trimmed)
        ? 'boolean'
        : overrideMode;
    const interpreted =
      effectiveMode === 'semantic' && trimmed
        ? interpretSearchPrompt(trimmed, nextFilters)
        : {
            query: trimmed,
            filters: nextFilters,
            appliedHints:
              effectiveMode !== overrideMode
                ? ['Detected Boolean / proximity syntax']
                : [] as string[],
          };

    if (autoScopeHints.length > 0) {
      interpreted.appliedHints = [...autoScopeHints, ...interpreted.appliedHints];
    }

    if (!hasResearchSearchCriteria(trimmed, interpreted.filters)) {
      return;
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
        onDegraded: setDegradedNotice,
        onCoverage: captureCandidateCoverage,
      });

      setResults(initialMatches);
      setLastResolvedSearch(resolvedSearch);

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
          errorMsg:
            initialMatches.length === 0 && !shouldRunBackgroundRefinement
              ? 'No filings matched that search. Try widening the date range, removing an auditor filter, or broadening the Boolean expression.'
              : '',
        }
      );

      upsertSession(initialSession, { replaceUrl: options.replaceUrl });
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
              onDegraded: setDegradedNotice,
              onCoverage: captureCandidateCoverage,
            });

            if (pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) {
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
            onDegraded: setDegradedNotice,
            onCoverage: captureCandidateCoverage,
            onProgress: (progressResults) => {
              const now = Date.now();
              if (now - lastProgressUpdate < 800) return;
              lastProgressUpdate = now;

              if (pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) return;

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
                  selectedResultId: currentSession?.selectedResultId || baselineSession.selectedResultId,
                }
              );

              upsertSession(progressSession, { syncRoute: false });
              if (activeSessionIdRef.current === targetSessionId) {
                syncActiveSearchContext(progressSession);
              }
            },
          });

          if (pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) {
            return;
          }

          const currentSession = sessionsRef.current.find(session => session.id === targetSessionId);

          const refinedSession = buildResearchSession(
            targetSessionId,
            trimmed,
            effectiveMode,
            nextFilters,
            refinedMatches,
            interpreted.appliedHints,
            resolvedSearch,
            createdAt,
            {
              selectedResultId: currentSession?.selectedResultId || baselineSession.selectedResultId,
              errorMsg:
                refinedMatches.length === 0
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

          if (pendingRefinementKeysRef.current.get(targetSessionId) !== refinementKey) {
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
      setResults([]);
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
      return;
    }

    activeSessionIdRef.current = activeSession.id;
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
                      : 'Example: "car parking" w/10 installation'
                  }
                  value={query}
                  onChange={event => {
                    setQuery(event.target.value);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 150)}
                  aria-autocomplete="list"
                  aria-expanded={suggestionsOpen && querySuggestions.length > 0}
                />
                <button type="submit" className="primary-btn" disabled={loading}>
                  {loading ? <Loader2 size={16} className="spinner" /> : 'Search'}
                </button>
                {suggestionsOpen && querySuggestions.length > 0 && (
                  <div role="listbox" aria-label="Company suggestions" style={{
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
                      <span className="research-context-chip">
                        <span className="label">Top auditor</span>
                        <strong>{metrics.topAuditor}</strong>
                      </span>
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
                <h2>{displayResults.length > 0 ? `${displayResults.length >= RESEARCH_RESULT_LIMIT ? `${RESEARCH_RESULT_LIMIT}+` : displayResults.length} filings` : 'No results yet'}</h2>
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
                  ? `Candidate coverage: examined ${candidateCoverage.examined.toLocaleString()} of ${candidateCoverage.upstreamTotal.toLocaleString()} upstream candidates (${candidateCoverage.complete ? 'complete' : 'partial candidate window'}). `
                  : ''}
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
                {isRefiningResults && (
                  <div className="research-refining-banner">
                    <Loader2 size={14} className="spinner" />
                <span>Showing initial hits while {BRAND.shortName} validates filing text and loads more results in the background.</span>
                  </div>
                )}
                {displayResults.some(result => !result.auditor?.trim()) && !auditorNoticeDismissed && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 12px', margin: '0 0 8px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.75rem', color: '#FBBF24' }}>
                    <span>Auditor identification covers fiscal 2017+ (PCAOB Form AP); older or non-issuer filings may not show one.</span>
                    <button type="button" onClick={() => setAuditorNoticeDismissed(true)}
                      style={{ background: 'none', border: 'none', color: '#FBBF24', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1 }}>×</button>
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
                          const badgeLabel = textValidated ? 'Text validated' : result.matchReason ? 'Metadata' : 'Preliminary';
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
                  <div className="selected-match-label">{selectedResult.matchReason || 'Matched filing text'}</div>
                  <div>{renderHighlightedText(selectedResult.matchSnippet || selectedResult.description || 'Matched on filing metadata.', previewHighlightTerms)}</div>
                </div>

                <div className="research-preview-frame-wrap">
                  {previewError || selectedResult.primaryDocument.endsWith('.xml') ? (
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
