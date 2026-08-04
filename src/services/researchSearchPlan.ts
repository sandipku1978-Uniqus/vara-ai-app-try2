/**
 * Pure query interpretation for the Research Workbench.
 *
 * This is everything that happens between "user pressed Search" and "we know
 * what to ask EDGAR for": form-scope defaulting, mode detection, plain-language
 * interpretation, Boolean validation, and inline-field promotion. It was inline
 * in SearchPage's 437-line handleSearch, where the only way to test it was to
 * render the whole page — so the rules with the subtlest ordering requirements
 * had the least direct coverage.
 *
 * Deliberately free of React state: the caller applies the returned plan. That
 * keeps the ordering rule below verifiable in isolation.
 */

import type { SearchFilters } from '../domain/searchFilters';
import type { ResearchSearchMode } from './filingResearch';
import { cloneSearchFilters, hasResearchSearchCriteria } from './researchSessions';
import { interpretSearchPrompt } from './searchAssist';
import {
  describeBooleanQueryIssue,
  compileBooleanQuery,
  extractAuditorFilterToken,
  looksLikeBooleanQuery,
} from '../utils/booleanSearch';
import { canonicalizeAuditorInput } from './auditors';

/** Form scope a much older build applied by default. */
const LEGACY_DEFAULT_FORM_SCOPE = ['10-K', '10-Q'];

export function queryMentionsFormScope(value: string): boolean {
  return /\b(?:10[\s-]?k|10[\s-]?q|8[\s-]?k(?:\/a)?|6[\s-]?k|20[\s-]?f|def[\s-]?14a|s[\s-]?1)\b/i.test(value);
}

export function hasOnlyLegacyDefaultFormScope(filters: SearchFilters): boolean {
  const normalizedForms = [...filters.formTypes].map(form => form.trim().toUpperCase()).sort();
  const isLegacyDefault =
    normalizedForms.length === LEGACY_DEFAULT_FORM_SCOPE.length &&
    normalizedForms.every((form, index) => form === LEGACY_DEFAULT_FORM_SCOPE[index]);

  if (!isLegacyDefault) return false;

  return !(
    filters.keyword.trim() ||
    filters.entityName.trim() ||
    filters.sectionKeywords.trim() ||
    filters.sicCode.trim() ||
    filters.accountant.trim() ||
    filters.dateFrom.trim() ||
    filters.dateTo.trim()
  );
}

export type ResearchSearchPlan =
  /** Nothing searchable was supplied — the caller should do nothing at all. */
  | { status: 'empty' }
  /** The query is invalid; show `message` and issue zero requests. */
  | { status: 'rejected'; message: string }
  | {
      status: 'ready';
      /** Raw trimmed input, still used for session titles and signatures. */
      trimmed: string;
      /** Boolean when the user chose it, or when Boolean syntax was detected. */
      mode: ResearchSearchMode;
      /** Text actually sent for retrieval (auditor token already lifted out). */
      query: string;
      filters: SearchFilters;
      appliedHints: string[];
      /** Set when an inline `auditor:` token became a structured filter, so the
       *  caller can mirror it into the visible query box and filter chips. */
      promotedAuditor?: { canonical: string; residualQuery: string };
    };

/**
 * Interpret a submitted search. Returns a plan; applies nothing.
 */
export function planResearchSearch(
  searchQuery: string,
  overrideFilters: SearchFilters,
  overrideMode: ResearchSearchMode
): ResearchSearchPlan {
  const trimmed = searchQuery.trim();
  let nextFilters = cloneSearchFilters(overrideFilters);
  const autoScopeHints: string[] = [];

  // A stale two-form default from an older build silently narrowed searches the
  // user never scoped; widen it unless they named a form themselves.
  if (hasOnlyLegacyDefaultFormScope(nextFilters) && !queryMentionsFormScope(trimmed)) {
    nextFilters = { ...nextFilters, formTypes: [] };
    autoScopeHints.push('Form scope: all core filings');
  }

  const effectiveMode: ResearchSearchMode =
    overrideMode === 'semantic' && looksLikeBooleanQuery(trimmed) ? 'boolean' : overrideMode;

  const interpreted =
    effectiveMode === 'semantic' && trimmed
      ? interpretSearchPrompt(trimmed, nextFilters)
      : {
          query: trimmed,
          filters: nextFilters,
          appliedHints: effectiveMode !== overrideMode ? ['Detected Boolean / proximity syntax'] : ([] as string[]),
        };

  let appliedHints = autoScopeHints.length > 0
    ? [...autoScopeHints, ...interpreted.appliedHints]
    : interpreted.appliedHints;

  if (!hasResearchSearchCriteria(trimmed, interpreted.filters)) {
    return { status: 'empty' };
  }

  if (effectiveMode !== 'boolean') {
    return {
      status: 'ready',
      trimmed,
      mode: effectiveMode,
      query: interpreted.query,
      filters: interpreted.filters,
      appliedHints,
    };
  }

  // ORDERING RULE (readiness finding F-05): validate the COMPLETE expression
  // before extracting any structured field. Extraction strips the auditor token
  // and its connective, so validating the residual instead would let
  // "lease OR auditor:KPMG" be silently rewritten to lease-AND-KPMG — exactly
  // the meaning change the AND-only rule exists to reject.
  const originalIssue = describeBooleanQueryIssue(interpreted.query);
  if (originalIssue) return { status: 'rejected', message: originalIssue };

  let query = interpreted.query;
  let filters = interpreted.filters;
  let promotedAuditor: { canonical: string; residualQuery: string } | undefined;

  const { auditor, residual } = extractAuditorFilterToken(query);
  if (auditor) {
    const canonical = canonicalizeAuditorInput(auditor) || auditor;
    query = residual;
    filters = { ...filters, accountant: filters.accountant.trim() || canonical };
    if (!appliedHints.some(hint => hint.startsWith('Audit firm:'))) {
      appliedHints = [...appliedHints, `Audit firm: ${canonical}`];
    }
    promotedAuditor = { canonical, residualQuery: residual };
  }

  // Re-validate the residual: promotion can leave an expression that no longer
  // stands on its own (a bare `auditor:KPMG` reduces to empty text). Two
  // issue classes are tolerated ONLY when a firm was promoted, because the
  // firm-scoped retrieval lane covers them (audit R1 slice 2): a residual
  // with no positive anchor (auditor:PwC AND NOT goodwill) and a residual
  // whose OR carries an unanchored branch (auditor:PwC AND (impairment OR
  // NOT goodwill)) both fetch candidates by firm and validate by expression.
  if (query.trim()) {
    const residualCompiled = compileBooleanQuery(query);
    if (!residualCompiled.ok) {
      const coveredByFirmLane = promotedAuditor
        && (residualCompiled.code === 'unanchored-branch' || residualCompiled.code === 'negative-only');
      if (!coveredByFirmLane) return { status: 'rejected', message: residualCompiled.message };
    }
  }

  return { status: 'ready', trimmed, mode: effectiveMode, query, filters, appliedHints, promotedAuditor };
}
