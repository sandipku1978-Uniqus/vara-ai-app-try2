/**
 * Search domain contracts — framework-neutral (remediation handoff WP7).
 *
 * SearchFilters is the shape shared by the executor, saved sessions, alert
 * routes, and the agent planner. It used to live inside the SearchFilterBar
 * React component, so every service importing the type transitively imported
 * a 'use client' component tree — the root of the import cycle between search
 * filters, company lookup, and agent evidence, and the reason deterministic
 * Node tests dragged React into scope. UI components import from here (or via
 * SearchFilterBar's re-export, kept for compatibility); this module imports
 * nothing.
 */

export interface SearchFilters {
  keyword: string;
  dateFrom: string;
  dateTo: string;
  entityName: string;
  /** Structured issuer scope. Set when a company is picked from the lookup, so
   *  retrieval filters by CIK instead of re-resolving the display name (or, in
   *  Boolean mode, treating a typed ticker as filing text). Optional so older
   *  persisted sessions and a rollback build stay valid. */
  entityCik?: string;
  formTypes: string[];
  sectionKeywords: string;
  sicCode: string;
  stateOfInc: string;
  headquarters: string;
  exchange: string[];
  acceleratedStatus: string[];
  accountant: string;
  accessionNumber: string;
  fileNumber: string;
  fiscalYearEnd: string;
  accountingFramework: string;
  /**
   * ASC topic or ASU number the filing must cite (e.g. "ASC 842",
   * "ASU 2023-07"). Text-validated across every citation spelling filings
   * use — ASC Topic 842, Topic 842, ASU No. 2023-07. Optional so older
   * persisted sessions and a rollback build stay valid.
   */
  ascReference?: string;
  /**
   * Item section the query must match INSIDE (e.g. "1A", "7", "9A") —
   * "Item 1A contains X". Validation slices the filing at Item-heading
   * boundaries and evaluates the expression within the slice; a filing
   * without the section never matches. Optional for older sessions.
   */
  sectionScope?: string;
}

export const defaultSearchFilters: SearchFilters = {
  keyword: '',
  dateFrom: '',
  dateTo: '',
  entityName: '',
  entityCik: '',
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
  ascReference: '',
  sectionScope: '',
};
