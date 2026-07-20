import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { FilingResearchResult, ResearchSearchMode } from './filingResearch';
import { scopedStorageKey } from './storageNamespace';

export interface ResolvedResearchSearch {
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
}

export interface ResearchSearchSession {
  id: string;
  title: string;
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
  results: FilingResearchResult[];
  isRefining: boolean;
  searched: boolean;
  errorMsg: string;
  interpretation: string[];
  resolvedSearch: ResolvedResearchSearch;
  selectedResultId: string | null;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'vara.research.sessions.v1';
const MAX_SESSIONS = 8;

const ROUTE_FILTER_KEYS: Array<[keyof SearchFilters, string]> = [
  ['keyword', 'keyword'],
  ['dateFrom', 'from'],
  ['dateTo', 'to'],
  ['entityName', 'entity'],
  ['sectionKeywords', 'section'],
  ['sicCode', 'sic'],
  ['stateOfInc', 'inc'],
  ['headquarters', 'hq'],
  ['accountant', 'auditor'],
  ['accessionNumber', 'accession'],
  ['fileNumber', 'file'],
  ['fiscalYearEnd', 'fye'],
  ['accountingFramework', 'framework'],
];

const ROUTE_ARRAY_FILTER_KEYS: Array<[keyof SearchFilters, string]> = [
  ['formTypes', 'forms'],
  ['exchange', 'exchange'],
  ['acceleratedStatus', 'filer'],
];

export function cloneSearchFilters(filters: SearchFilters): SearchFilters {
  return {
    ...filters,
    formTypes: [...filters.formTypes],
    exchange: [...filters.exchange],
    acceleratedStatus: [...filters.acceleratedStatus],
  };
}

/** Return true when a request has any executable text or metadata predicate. */
export function hasResearchSearchCriteria(query: string, filters: SearchFilters): boolean {
  if (query.trim()) return true;
  return ROUTE_FILTER_KEYS.some(([key]) => String(filters[key] || '').trim()) ||
    ROUTE_ARRAY_FILTER_KEYS.some(([key]) => (filters[key] as string[]).length > 0);
}

/**
 * Serialize the complete search contract so saved alerts and copied URLs reopen
 * the same request instead of degrading to a query-only search.
 */
export function buildResearchRouteParams(
  query: string,
  mode: ResearchSearchMode,
  filters: SearchFilters,
  sessionId?: string | null
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('v', '1');
  if (sessionId) params.set('tab', sessionId);
  if (query.trim()) params.set('q', query.trim());
  if (mode === 'boolean') params.set('mode', mode);

  for (const [key, routeKey] of ROUTE_FILTER_KEYS) {
    const value = String(filters[key] || '').trim();
    if (value) params.set(routeKey, value);
  }
  for (const [key, routeKey] of ROUTE_ARRAY_FILTER_KEYS) {
    const values = filters[key] as string[];
    if (values.length > 0) params.set(routeKey, values.join(','));
  }
  return params;
}

export function parseResearchRouteParams(params: URLSearchParams): {
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
} | null {
  const query = params.get('q') || '';
  const mode: ResearchSearchMode = params.get('mode') === 'boolean' ? 'boolean' : 'semantic';
  const filters = cloneSearchFilters(defaultSearchFiltersForRoutes);

  for (const [key, routeKey] of ROUTE_FILTER_KEYS) {
    (filters[key] as string) = params.get(routeKey) || '';
  }
  for (const [key, routeKey] of ROUTE_ARRAY_FILTER_KEYS) {
    (filters[key] as string[]) = (params.get(routeKey) || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  }

  return hasResearchSearchCriteria(query, filters) ? { query, mode, filters } : null;
}

/** A route without a tab is a fresh external intent and outranks restored tabs. */
export function shouldHandleExternalResearchRoute(
  activeTabId: string | null | undefined,
  routeSearch: ResolvedResearchSearch | null,
  routeParamString: string,
  lastHandledRoute: string
): boolean {
  return !activeTabId && Boolean(routeSearch) && routeParamString !== lastHandledRoute;
}

// Kept local to avoid importing a client component merely for its default object.
const defaultSearchFiltersForRoutes: SearchFilters = {
  keyword: '',
  dateFrom: '',
  dateTo: '',
  entityName: '',
  formTypes: [],
  sectionKeywords: '',
  sicCode: '',
  stateOfInc: '',
  headquarters: '',
  exchange: [],
  acceleratedStatus: [],
  accountant: '',
  accessionNumber: '',
  fileNumber: '',
  fiscalYearEnd: '',
  accountingFramework: '',
};

export function createResearchSessionId(): string {
  return `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildResearchSessionTitle(query: string, filters: SearchFilters): string {
  const trimmed = query.trim();
  if (trimmed) {
    return trimmed.length > 44 ? `${trimmed.slice(0, 41).trim()}...` : trimmed;
  }
  if (filters.entityName.trim()) return filters.entityName.trim();
  if (filters.sicCode.trim()) return `SIC ${filters.sicCode.trim()}`;
  return 'New search';
}

export function buildSearchSignature(query: string, mode: ResearchSearchMode, filters: SearchFilters): string {
  return JSON.stringify({
    query: query.trim(),
    mode,
    filters: {
      ...cloneSearchFilters(filters),
      entityName: filters.entityName.trim(),
      sectionKeywords: filters.sectionKeywords.trim(),
      sicCode: filters.sicCode.trim(),
      accountant: filters.accountant.trim(),
      accessionNumber: filters.accessionNumber.trim(),
      fileNumber: filters.fileNumber.trim(),
      fiscalYearEnd: filters.fiscalYearEnd.trim(),
      stateOfInc: filters.stateOfInc.trim(),
      headquarters: filters.headquarters.trim(),
      dateFrom: filters.dateFrom.trim(),
      dateTo: filters.dateTo.trim(),
      keyword: filters.keyword.trim(),
    },
  });
}

function sanitizeSession(session: ResearchSearchSession): ResearchSearchSession {
  return {
    ...session,
    filters: cloneSearchFilters(session.filters),
    interpretation: [...session.interpretation],
    results: session.results.map(result => ({
      ...result,
      documentType: result.documentType || result.formType || '',
    })),
    isRefining: Boolean((session as Partial<ResearchSearchSession>).isRefining),
    resolvedSearch: {
      query: session.resolvedSearch.query,
      mode: session.resolvedSearch.mode,
      filters: cloneSearchFilters(session.resolvedSearch.filters),
    },
  };
}

export function loadResearchSessions(): ResearchSearchSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const storageKey = scopedStorageKey(STORAGE_KEY);
    if (!storageKey) return [];
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ResearchSearchSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSession).slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function saveResearchSessions(sessions: ResearchSearchSession[]): void {
  if (typeof window === 'undefined') return;
  try {
    const storageKey = scopedStorageKey(STORAGE_KEY);
    if (!storageKey) return;
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify(sessions.slice(0, MAX_SESSIONS).map(sanitizeSession))
    );
  } catch {
    // Ignore storage quota or serialization errors.
  }
}
