import type { SearchFilters } from '../domain/searchFilters';
import {
  buildAuditorSearchTerms,
  canonicalizeAuditorInput,
} from './auditors';
import { isEnrichedSearchEnabled } from './secApi';
import {
  buildReferenceSearchTerms,
  parseAccountingReference,
} from '../utils/accountingReference';
import {
  buildBooleanCandidateQueries,
  buildCandidateQueryFromBoolean,
  compileBooleanQuery,
  eftsDelegablePhrase,
  parseBooleanQuery,
  planBooleanBranches,
  type BooleanSearchNode,
} from '../utils/booleanSearch';

export type ResearchSearchMode = 'semantic' | 'boolean';

export interface SearchExecutionPlan {
  /** Residual query after an auditor token is lifted into the filters. */
  query: string;
  /** Filters with any lifted auditor canonicalized in. */
  filters: SearchFilters;
  serverQuery: string;
  formTypes: string;
  formScope: string[];
  excludeExhibits: boolean;
  preferRelevance: boolean;
  semanticAuditorSearch: boolean;
  needsCompanyMetadata: boolean;
  displayLimit: number;
  fastPass: boolean;
  fastCandidateCollection: boolean;
  needsTextFiltering: boolean;
  shouldHydrateSignals: boolean;
  parsedBooleanQuery: { expression: BooleanSearchNode | null };
  delegatedToEfts: boolean;
  hydratePerDocumentSignals: boolean;
  requiredBooleanBranches: number;
  filteredServerQueries: string[];
  perQueryResultLimit: number;
}

export interface CompileSearchPlanOptions {
  query: string;
  filters: SearchFilters;
  mode: ResearchSearchMode;
  defaultForms: string;
  limit: number;
  includeExhibits: boolean;
  deferTextValidation: boolean;
  preferFastCandidateCollection: boolean;
  hydrateTextSignals: boolean;
  useEnrichedSearch: boolean;
}

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFormTypes(filters: SearchFilters, defaultForms = ''): string {
  return filters.formTypes.length > 0 ? filters.formTypes.join(',') : defaultForms;
}

function parseFormScope(formScope: string): string[] {
  return formScope
    .split(',')
    .map(form => form.trim())
    .filter(Boolean);
}

function buildServerQuery(
  rawQuery: string,
  filters: SearchFilters,
  mode: ResearchSearchMode
): string {
  const primaryQuery = rawQuery.trim();
  const combined =
    primaryQuery ||
    filters.accessionNumber.trim() ||
    filters.fileNumber.trim() ||
    filters.sectionKeywords.trim();
  if (!combined) return '';
  return mode === 'boolean' ? buildCandidateQueryFromBoolean(combined) : combined;
}

/** Build branch-aware Boolean retrieval lanes and mark the required prefix. */
function buildBooleanServerQueries(
  query: string,
  filters: SearchFilters,
  delegated = false,
  useAuthoritativeAuditorFacet = false
): { queries: string[]; requiredBranches: number } {
  const { branches, droppedUnanchored } = planBooleanBranches(query);
  if (delegated) {
    return { queries: [query.replace(/\s+/g, ' ').trim()], requiredBranches: 1 };
  }

  const auditorTerms = buildAuditorSearchTerms(filters.accountant);
  const ascReference = parseAccountingReference(filters.ascReference || '');
  const referenceTerms = ascReference ? buildReferenceSearchTerms(ascReference) : [];
  const queries: string[] = [];
  const push = (value: string) => {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed && !queries.some(item => normalizeLooseText(item) === normalizeLooseText(trimmed))) {
      queries.push(trimmed);
    }
  };

  if (branches.length === 0) {
    // The authoritative facet browse is required; text-name lanes are bounded
    // fallbacks for facet gaps rather than the source of auditor truth.
    if (useAuthoritativeAuditorFacet && auditorTerms.length > 0) queries.push('');
    const requiredBranches = queries.length;
    for (const term of auditorTerms.slice(0, 4)) push(term);
    for (const term of referenceTerms) push(term);
    return { queries, requiredBranches: requiredBranches || queries.length };
  }

  for (const branch of branches) push(branch);
  // An audit-firm lane anchors otherwise negative-only branches and therefore
  // belongs inside the required prefix protected by fair-share reservations.
  if (droppedUnanchored > 0 && auditorTerms.length > 0) {
    for (const term of auditorTerms.slice(0, 4)) push(term);
  }
  const requiredBranches = queries.length;

  if (auditorTerms.length > 0) {
    for (const branch of branches) push(`${branch} ${auditorTerms[0]}`);
  }
  if (referenceTerms.length > 0) {
    for (const branch of branches) push(`${branch} ${referenceTerms[0]}`);
  }
  for (const candidate of buildBooleanCandidateQueries(query)) push(candidate);

  return { queries, requiredBranches };
}

function buildSemanticCandidateQueries(serverQuery: string, filters: SearchFilters): string[] {
  const baseQuery = serverQuery.trim();
  const queries: string[] = [];
  const auditorTerms = buildAuditorSearchTerms(filters.accountant);
  const sectionKeywords = filters.sectionKeywords.trim();
  const ascReference = parseAccountingReference(filters.ascReference || '');
  const referenceTerms = ascReference ? buildReferenceSearchTerms(ascReference) : [];
  const push = (value: string) => {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed && !queries.some(item => normalizeLooseText(item) === normalizeLooseText(trimmed))) {
      queries.push(trimmed);
    }
  };

  if (baseQuery && auditorTerms.length > 0 && sectionKeywords) {
    for (const term of auditorTerms.slice(0, 3)) push(`${baseQuery} ${term} ${sectionKeywords}`);
  }
  if (baseQuery && auditorTerms.length > 0) {
    for (const term of auditorTerms.slice(0, 4)) push(`${baseQuery} ${term}`);
  }
  if (baseQuery && sectionKeywords) push(`${baseQuery} ${sectionKeywords}`);
  if (referenceTerms.length > 0) {
    if (baseQuery) push(`${baseQuery} ${referenceTerms[0]}`);
    else for (const term of referenceTerms) push(term);
  }
  push(baseQuery);

  return queries.slice(0, 8);
}

function requiresCompanyMetadata(filters: SearchFilters): boolean {
  return Boolean(
    filters.sicCode.trim() ||
    filters.fileNumber.trim() ||
    filters.stateOfInc.trim() ||
    filters.headquarters.trim() ||
    filters.exchange.length > 0 ||
    filters.fiscalYearEnd.trim()
  );
}

export function shouldUseEnrichedSearch(useEnrichedSearch: boolean): boolean {
  return useEnrichedSearch && isEnrichedSearchEnabled();
}

export function canUseInstantEnrichedSearch(
  _query: string,
  filters: SearchFilters,
  mode: ResearchSearchMode,
  useEnrichedSearch = false
): boolean {
  if (!shouldUseEnrichedSearch(useEnrichedSearch) || mode !== 'semantic') return false;

  return !(
    filters.sectionKeywords.trim() ||
    filters.accountant.trim() ||
    filters.acceleratedStatus.length > 0 ||
    filters.accountingFramework.trim() ||
    filters.sicCode.trim() ||
    filters.fileNumber.trim() ||
    filters.stateOfInc.trim() ||
    filters.headquarters.trim() ||
    filters.exchange.length > 0 ||
    filters.fiscalYearEnd.trim()
  );
}

function requiresTextFiltering(
  filters: SearchFilters,
  rawQuery: string,
  mode: ResearchSearchMode,
  useEnrichedSearch: boolean
): boolean {
  if (mode === 'boolean') {
    const parsed = parseBooleanQuery(rawQuery);
    if (parsed.expression) {
      const delegable =
        eftsDelegablePhrase(parsed.expression) &&
        !filters.accountant.trim() &&
        filters.acceleratedStatus.length === 0 &&
        !filters.sectionKeywords.trim() &&
        !filters.accountingFramework.trim() &&
        !(filters.ascReference || '').trim() &&
        !(filters.sectionScope || '').trim();
      return !delegable;
    }
    return (
      filters.accountant.trim().length > 0 ||
      filters.acceleratedStatus.length > 0 ||
      (filters.ascReference || '').trim().length > 0 ||
      (filters.sectionScope || '').trim().length > 0
    );
  }

  if (
    filters.sectionKeywords.trim() ||
    filters.accountingFramework.trim() ||
    (filters.ascReference || '').trim() ||
    (filters.sectionScope || '').trim()
  ) {
    return true;
  }
  if (canUseInstantEnrichedSearch(rawQuery, filters, mode, useEnrichedSearch)) return false;
  return Boolean(filters.accountant.trim() || filters.acceleratedStatus.length > 0);
}

/**
 * Pure request planner: lifts auditor operands, defines retrieval lanes, and
 * derives validation/delegation flags without issuing network requests.
 */
export function compileSearchPlan(
  options: CompileSearchPlanOptions
): SearchExecutionPlan | null {
  let { query, filters } = options;
  const {
    mode,
    defaultForms,
    limit,
    includeExhibits,
    deferTextValidation,
    preferFastCandidateCollection,
    hydrateTextSignals,
    useEnrichedSearch,
  } = options;

  if (mode === 'boolean') {
    let compiled = compileBooleanQuery(query || filters.keyword);
    if (!compiled.ok) {
      // A previously promoted firm is retrieval context for an otherwise
      // unanchored branch. Restore it only for the two recoverable shapes.
      const firm = filters.accountant.trim();
      const recoverable = compiled.code === 'unanchored-branch' || compiled.code === 'negative-only';
      if (!firm || !recoverable) return null;
      const withFirm = compileBooleanQuery(`auditor:"${firm}" AND (${query || filters.keyword})`);
      if (!withFirm.ok) return null;
      compiled = withFirm;
    }
    if (compiled.auditor) {
      const canonical = canonicalizeAuditorInput(compiled.auditor) || compiled.auditor;
      filters = { ...filters, accountant: filters.accountant.trim() || canonical };
      query = compiled.residual;
    }
  }

  const serverQuery = buildServerQuery(query || filters.keyword, filters, mode);
  const formTypes = normalizeFormTypes(filters, defaultForms);
  const formScope = parseFormScope(formTypes);
  const excludeExhibits = !includeExhibits && mode !== 'boolean';
  const preferRelevance = Boolean((query || filters.keyword).trim() || filters.sectionKeywords.trim());
  const semanticAuditorSearch = mode === 'semantic' && Boolean(filters.accountant.trim());
  const needsCompanyMetadata = requiresCompanyMetadata(filters);
  const fastPass = deferTextValidation && mode !== 'boolean';
  const fastCandidateCollection = deferTextValidation || preferFastCandidateCollection;
  const displayLimit = Math.min(Math.max(limit, 1), 500);
  const needsTextFiltering = requiresTextFiltering(filters, query, mode, useEnrichedSearch);
  const shouldHydrateSignals = !fastPass && (hydrateTextSignals || needsTextFiltering);
  const parsedBooleanQuery = mode === 'boolean' ? parseBooleanQuery(query) : { expression: null };
  const delegatedToEfts =
    mode === 'boolean' &&
    Boolean(eftsDelegablePhrase(parsedBooleanQuery.expression)) &&
    filters.acceleratedStatus.length === 0 &&
    !filters.sectionKeywords.trim() &&
    !filters.accountingFramework.trim() &&
    !(filters.ascReference || '').trim() &&
    !(filters.sectionScope || '').trim();
  const hasNonAuditorTextPredicate = Boolean(
    (mode === 'boolean' && parsedBooleanQuery.expression) ||
    filters.sectionKeywords.trim() ||
    filters.acceleratedStatus.length > 0 ||
    filters.accountingFramework.trim() ||
    (filters.ascReference || '').trim() ||
    (filters.sectionScope || '').trim()
  );
  const hydratePerDocumentSignals =
    shouldHydrateSignals &&
    !delegatedToEfts &&
    (hasNonAuditorTextPredicate || !filters.accountant.trim());

  const booleanPlan = mode === 'boolean'
    ? buildBooleanServerQueries(
        query || filters.keyword,
        filters,
        delegatedToEfts,
        shouldUseEnrichedSearch(useEnrichedSearch) && Boolean(filters.accountant.trim())
      )
    : { queries: [] as string[], requiredBranches: 0 };
  const booleanServerQueries = booleanPlan.queries.slice(0, Math.max(booleanPlan.requiredBranches, 6));
  const requiredBooleanBranches = Math.min(booleanPlan.requiredBranches, booleanServerQueries.length);
  const semanticServerQueries = mode === 'semantic'
    ? buildSemanticCandidateQueries(serverQuery, filters)
    : [];
  const serverQueries = mode === 'boolean'
    ? (booleanServerQueries.length > 0 ? booleanServerQueries : [serverQuery])
    : (semanticServerQueries.length > 0 ? semanticServerQueries : [serverQuery]);
  const candidateServerQueries = (
    fastCandidateCollection
      ? serverQueries.slice(
          0,
          mode === 'boolean' ? Math.max(requiredBooleanBranches, 3) : semanticAuditorSearch ? 2 : 3
        )
      : serverQueries
  ).filter((candidate): candidate is string => typeof candidate === 'string');
  // Empty query is a first-class facet or issuer browse, not an absent lane.
  const filteredServerQueries = candidateServerQueries.length > 0 ? candidateServerQueries : [''];

  const perQueryResultLimit = fastCandidateCollection
    ? Math.min(Math.max(displayLimit, 80), 140)
    : delegatedToEfts || needsTextFiltering
      ? Math.max(displayLimit, 500)
      : Math.min(Math.max(displayLimit, 140), 300);

  return {
    query,
    filters,
    serverQuery,
    formTypes,
    formScope,
    excludeExhibits,
    preferRelevance,
    semanticAuditorSearch,
    needsCompanyMetadata,
    displayLimit,
    fastPass,
    fastCandidateCollection,
    needsTextFiltering,
    shouldHydrateSignals,
    parsedBooleanQuery,
    delegatedToEfts,
    hydratePerDocumentSignals,
    requiredBooleanBranches,
    filteredServerQueries,
    perQueryResultLimit,
  };
}
