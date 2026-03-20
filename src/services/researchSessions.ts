import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { FilingResearchResult, ResearchSearchMode } from './filingResearch';

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

export function cloneSearchFilters(filters: SearchFilters): SearchFilters {
  return {
    ...filters,
    formTypes: [...filters.formTypes],
    exchange: [...filters.exchange],
    acceleratedStatus: [...filters.acceleratedStatus],
  };
}

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
    results: session.results.map(result => ({ ...result })),
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
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
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
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sessions.slice(0, MAX_SESSIONS).map(sanitizeSession))
    );
  } catch {
    // Ignore storage quota or serialization errors.
  }
}
