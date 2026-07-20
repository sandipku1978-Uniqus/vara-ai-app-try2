import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { ResearchSearchMode } from './filingResearch';
import { buildResearchRouteParams, cloneSearchFilters } from './researchSessions';

export interface SavedAlertSearchContract {
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
  defaultForms: string;
}

/** Reconstruct the exact executable alert search, including legacy default forms. */
export function buildSavedAlertRouteParams(alert: SavedAlertSearchContract): URLSearchParams {
  const filters = cloneSearchFilters(alert.filters);
  if (filters.formTypes.length === 0 && alert.defaultForms.trim()) {
    filters.formTypes = alert.defaultForms
      .split(',')
      .map(form => form.trim())
      .filter(Boolean);
  }
  return buildResearchRouteParams(alert.query, alert.mode, filters);
}
