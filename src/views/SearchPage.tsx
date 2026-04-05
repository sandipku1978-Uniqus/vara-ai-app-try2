'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import {
  BellRing,
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
import { aiSummarize } from '../services/aiApi';
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
  fetchCompanySubmissions,
  lookupCIK,
} from '../services/secApi';
import {
  buildSearchSignature,
  buildResearchSessionTitle,
  cloneSearchFilters,
  createResearchSessionId,
  loadResearchSessions,
  saveResearchSessions,
  type ResearchSearchSession,
} from '../services/researchSessions';
import { buildHighlightTerms, interpretSearchPrompt } from '../services/searchAssist';
import { looksLikeBooleanQuery } from '../utils/booleanSearch';
import { canUseInstantElasticsearchSearch } from '../services/filingResearch';
import { BRAND } from '../config/brand';
import './SearchPage.css';

const DEFAULT_FORM_SCOPE = '10-K,10-Q,8-K,8-K/A,DEF 14A,20-F,6-K,S-1';
const LEGACY_DEFAULT_FORM_SCOPE = ['10-K', '10-Q'];
const RESEARCH_RESULT_LIMIT = 500;
const INITIAL_RESEARCH_RESULT_LIMIT = 80;
const INITIAL_BOOLEAN_RESULT_LIMIT = 40;
const RESEARCH_SEARCH_USES_ELASTICSEARCH = true;
const SAMPLE_SEARCHES = [
  'ASC 842 adoption w/10 lease',
  'ASR w/5 derivative',
  'Temporary equity in last 3 years in 10-Q / 10-K audited by Deloitte',
  '"material weakness" AND cybersecurity',
  'I am trying to search for companies that had bifurcated derivatives in accelerated share repurchase agreements in last 5 years',
];

const NAME_TO_TICKER: Record<string, string> = {
  APPLE: 'AAPL', AAPL: 'AAPL',
  MICROSOFT: 'MSFT', MSFT: 'MSFT',
  GOOGLE: 'GOOGL', ALPHABET: 'GOOGL', GOOGL: 'GOOGL',
  TESLA: 'TSLA', TSLA: 'TSLA',
  AMAZON: 'AMZN', AMZN: 'AMZN',
  NVIDIA: 'NVDA', NVDA: 'NVDA',
  META: 'META', FACEBOOK: 'META',
  JPMORGAN: 'JPM', JPM: 'JPM', 'JP MORGAN': 'JPM',
};

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

function buildRouteParams(sessionId: string | null, query: string): URLSearchParams {
  const params = new URLSearchParams();
  if (sessionId) params.set('tab', sessionId);
  if (query.trim()) params.set('q', query.trim());
  return params;
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

  return 'Auditor unavailable';
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
    (filters.fiscalYearEnd ? 1 : 0)
  );
}

export default function SearchPage() {
  const location = usePathname();
  const navigate = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams?.get('q') || '';
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
    savedAlerts,
    pendingSearchIntent,
    setPendingSearchIntent,
    setActiveSearchContext,
    setChatOpen,
  } = useApp();

  const [sessions, setSessions] = useState<ResearchSearchSession[]>(() => loadResearchSessions());
  const [query, setQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<ResearchSearchMode>('semantic');
  const [filters, setFilters] = useState<SearchFilters>({
    ...defaultSearchFilters,
  });
  const [results, setResults] = useState<FilingResearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [trendReport, setTrendReport] = useState('');
  const [trendLoading, setTrendLoading] = useState(false);
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

  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const bootstrappedInitialSearch = useRef(false);
  const handledAlertIdsRef = useRef<Set<string>>(new Set());
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

  const setRouteForSession = useCallback((sessionId: string | null, nextQuery: string, replace = false) => {
    setSearchParams(buildRouteParams(sessionId, nextQuery), { replace });
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
      setRouteForSession(session.id, session.query, Boolean(options.replaceUrl));
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

    if (
      !trimmed &&
      !interpreted.filters.entityName.trim() &&
      !interpreted.filters.sectionKeywords.trim() &&
      !interpreted.filters.accessionNumber.trim() &&
      !interpreted.filters.fileNumber.trim()
    ) {
      return;
    }

    setLoading(true);
    setSearched(true);
    setErrorMsg('');
    setAlertMessage('');
    setTrendReport('');
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
      let effectiveQuery = interpreted.query || trimmed;
      let effectiveFilters = interpreted.filters;

      if (!effectiveFilters.entityName.trim() && effectiveQuery) {
        const hint = await resolveEntityHint(effectiveQuery);
        if (hint.entityName) {
          effectiveFilters = { ...effectiveFilters, entityName: hint.entityName };
          effectiveQuery = hint.query;
        }
      }

      const resolvedSearch = {
        query: effectiveQuery || trimmed,
        mode: effectiveMode,
        filters: effectiveFilters,
      };
      const canUseInstantElasticResponse = canUseInstantElasticsearchSearch(
        resolvedSearch.query,
        resolvedSearch.filters,
        resolvedSearch.mode,
        RESEARCH_SEARCH_USES_ELASTICSEARCH
      );
      const fullHydrateSignals = shouldHydrateSearchSignals(effectiveMode, effectiveFilters);
      const initialLimit = canUseInstantElasticResponse
        ? RESEARCH_RESULT_LIMIT
        : effectiveMode === 'boolean'
          ? INITIAL_BOOLEAN_RESULT_LIMIT
          : INITIAL_RESEARCH_RESULT_LIMIT;
      const shouldRunVisibleAuditorRefinement =
        !canUseInstantElasticResponse &&
        effectiveMode === 'semantic' &&
        Boolean(effectiveFilters.accountant.trim());
      const shouldRunDeepRefinement =
        !canUseInstantElasticResponse &&
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
        useElasticsearch: RESEARCH_SEARCH_USES_ELASTICSEARCH,
        hydrateTextSignals: false,
        deferTextValidation: shouldRunBackgroundRefinement,
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
              useElasticsearch: RESEARCH_SEARCH_USES_ELASTICSEARCH,
              hydrateTextSignals: true,
              deferTextValidation: false,
              preferFastCandidateCollection: true,
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
            useElasticsearch: RESEARCH_SEARCH_USES_ELASTICSEARCH,
            hydrateTextSignals: fullHydrateSignals,
            deferTextValidation: false,
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
    setIsInsightsExpanded(false);
    setAlertMessage('');
    syncActiveSearchContext(activeSession);
  }, [activeSession, syncActiveSearchContext]);

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id || null;
  }, [activeSession?.id]);

  useEffect(() => {
    if (activeSession || bootstrappedInitialSearch.current || !initialQuery) {
      return;
    }

    bootstrappedInitialSearch.current = true;
    setQuery(initialQuery);
    void handleSearchRef.current?.(initialQuery, {
      ...defaultSearchFilters,
    }, 'semantic', { replaceUrl: true });
  }, [activeSession, initialQuery]);

  useEffect(() => {
    const alertId = (location.state as { alertId?: string } | null)?.alertId;
    if (!alertId || handledAlertIdsRef.current.has(alertId)) return;
    const alert = savedAlerts.find(item => item.id === alertId);
    if (!alert) return;

    handledAlertIdsRef.current.add(alertId);
    setQuery(alert.query);
    setSearchMode(alert.mode);
    setFilters(cloneSearchFilters(alert.filters));
    void handleSearch(alert.query, alert.filters, alert.mode);
  }, [handleSearch, location.state, savedAlerts]);

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
      setRouteForSession(nextActive?.id || null, nextActive?.query || '');
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

  const buildFilingRouteState = useCallback((row: FilingResearchResult) => ({
    companyName: row.entityName,
    filingDate: row.fileDate,
    formType: row.formType,
    fileNumber: row.fileNumber,
    auditor: row.auditor,
    highlightQuery: activeResolvedSearch.query,
    highlightMode: activeResolvedSearch.mode,
    highlightSectionKeywords: activeResolvedSearch.filters.sectionKeywords,
    originatingSearchSessionId: activeSession?.id || null,
  }), [activeResolvedSearch, activeSession?.id]);

  const openFiling = useCallback((row: FilingResearchResult) => {
    navigate.push(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`);
  }, [navigate]);

  async function handleTrendReport() {
    if (displayResults.length === 0) return;

    setTrendLoading(true);
    setIsInsightsExpanded(false);
    try {
      const statsSummary = await buildSearchTrendSummary(displayResults.slice(0, 20), query, filters);
      const aiResponse = await aiSummarize(
        `You are an SEC accounting research analyst. Create a concise market trend report from this filing search dataset.\n\n${statsSummary}\n\nTop results:\n${displayResults
          .slice(0, 12)
          .map(result => `- ${result.fileDate} | ${result.entityName} | ${result.formType} | ${result.matchSnippet || result.description || 'No description'} | Auditor: ${result.auditor || 'Unknown'} | SIC: ${result.sicDescription || result.sic || 'Unknown'}`)
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
      setTrendReport(await buildSearchTrendSummary(displayResults.slice(0, 20), query, filters));
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
      lastSeenAccessions: displayResults.map(result => result.accessionNumber),
      latestNewAccessions: [],
      latestResultCount: displayResults.length,
    });
    setAlertMessage('Alert saved locally. It will show up in the dashboard alert center and can be checked for new filings.');
  }

  const selectedDocumentUrl = selectedResult
    ? buildSecDocumentUrl(selectedResult.cik, selectedResult.accessionNumber, selectedResult.primaryDocument)
    : '';
  const selectedProxyUrl = selectedResult
    ? buildSecProxyUrl(`Archives/edgar/data/${selectedResult.cik}/${selectedResult.accessionNumber.replace(/-/g, '')}/${selectedResult.primaryDocument}`)
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

          <div className="research-mode-switch">
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
            <div className="research-tab-strip" style={{ flex: 1, paddingBottom: 0, margin: 0, overflowY: 'hidden' }}>
              {sessions.length === 0 ? (
                <div className="research-empty-tab">Searches open here.</div>
              ) : (
                sessions.map(session => (
                  <button
                    key={session.id}
                    className={`research-tab ${activeSession?.id === session.id ? 'active' : ''}`}
                    onClick={() => setRouteForSession(session.id, session.query)}
                  >
                    <span>{session.title}</span>
                    <span className="count">{session.results.length}</span>
                    <span
                      className="close"
                      onClick={event => {
                        event.stopPropagation();
                        closeSession(session.id);
                      }}
                    >
                      <X size={12} />
                    </span>
                  </button>
                ))
              )}
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
            <div className="research-query-panel glass-card">
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
                  onChange={event => setQuery(event.target.value)}
                />
                <button type="submit" className="primary-btn" disabled={loading}>
                  {loading ? <Loader2 size={16} className="spinner" /> : 'Search'}
                </button>
              </form>

              {searchInterpretation.length > 0 && (
                <div className="research-chip-row">
                  {searchInterpretation.map(item => (
                    <span key={item} className="research-chip">{item}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="research-toolbar glass-card">
              <div className="research-tab-strip">
                {sessions.length === 0 ? (
                  <div className="research-empty-tab">Searches open here as tabs so you can move between result sets without losing context.</div>
                ) : (
                  sessions.map(session => (
                    <button
                      key={session.id}
                      className={`research-tab ${activeSession?.id === session.id ? 'active' : ''}`}
                      onClick={() => setRouteForSession(session.id, session.query)}
                    >
                      <span>{session.title}</span>
                      <span className="count">{session.results.length}</span>
                      <span
                        className="close"
                        onClick={event => {
                          event.stopPropagation();
                          closeSession(session.id);
                        }}
                      >
                        <X size={12} />
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="research-toolbar-actions">
                <button className="secondary-btn" onClick={handleCreateAlert} disabled={!query.trim() && !filters.entityName.trim()}>
                  <BellRing size={16} /> Save Alert
                </button>
              </div>
            </div>

            {displayResults.length > 0 && (
              <div className="research-context-stack">
                <div className="research-context-bar glass-card">
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
                    <div className="md-content research-insight-copy">
                      {trendReport.split('\n').map((line, index) => <p key={index}>{line}</p>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="research-workspace">
          <div className="research-hit-list glass-card">
            <div className="pane-header">
              <div>
                <div className="eyebrow">Search hits</div>
                <h2>{displayResults.length > 0 ? `${displayResults.length >= RESEARCH_RESULT_LIMIT ? `${RESEARCH_RESULT_LIMIT}+` : displayResults.length} filings` : 'No results yet'}</h2>
              </div>
              <div className="pane-hint">Select a filing to preview it here, then open the full workspace only when you need the full toolset.</div>
            </div>

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
                <div className="research-hit-scroll">
                  {displayResults.map(result => (
                    <button
                      key={result.id}
                      className={`research-hit-card ${selectedResult?.id === result.id ? 'active' : ''}`}
                      onClick={() => updateSelectedResult(result.id)}
                    >
                      <div className="topline">
                        <span className="date">{result.fileDate}</span>
                        <span className="form">{formatResultFormLabel(result)}</span>
                      </div>
                      <div className="company">{result.entityName}</div>
                      <div className="meta">
                        <span>{buildAuditorDisplayLabel(result.auditor, activeResolvedSearch.filters, isRefiningResults)}</span>
                        <span>{result.sicDescription || result.sic || 'Industry unavailable'}</span>
                      </div>
                      <div className="match-reason">{result.matchReason || 'Matched filing metadata'}</div>
                      <div className="snippet">
                        {renderHighlightedText(result.matchSnippet || result.description || 'Matched on filing metadata.', previewHighlightTerms)}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : searched ? (
              <div className="research-empty-state">
                <div>{errorMsg || 'No filings matched your search.'}</div>
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
                    <a href={selectedDocumentUrl} target="_blank" rel="noreferrer" className="secondary-btn">
                      <ExternalLink size={14} /> SEC.gov
                    </a>
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
                  ) : (
                    <iframe
                      ref={previewFrameRef}
                      src={selectedProxyUrl}
                      title={`${selectedResult.entityName} filing preview`}
                      className="research-preview-frame"
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
