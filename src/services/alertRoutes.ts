import type { SearchFilters } from '../domain/searchFilters';
import type { ResearchSearchMode } from './filingResearch';
import { buildResearchRouteParams, cloneSearchFilters } from './researchSessions';
import type { SearchCandidateCoverage } from './secApi';

/**
 * Evidence retained with the latest saved-alert check.
 *
 * Keep this tied to the search executor's coverage contract instead of
 * maintaining a smaller alert-only shape. Branch verdicts, stop reasons and
 * measured work are part of the answer's provenance; flattening them makes a
 * partial check impossible to audit after the page reloads.
 */
export type SavedAlertCoverage = SearchCandidateCoverage;

/**
 * Take an immutable, JSON-safe copy before coverage crosses the persistence
 * boundary. The executor may reuse its working ledgers while finalizing a run;
 * a saved alert must retain the exact state observed at check completion.
 */
export function snapshotSavedAlertCoverage(coverage: SearchCandidateCoverage): SavedAlertCoverage {
  return {
    ...coverage,
    ...(coverage.branches
      ? { branches: coverage.branches.map(branch => ({ ...branch })) }
      : {}),
    ...(coverage.work
      ? {
          work: {
            ...coverage.work,
            ceiling: { ...coverage.work.ceiling },
          },
        }
      : {}),
  };
}

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
