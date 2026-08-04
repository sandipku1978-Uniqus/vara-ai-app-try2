import type { SearchFilters } from '../domain/searchFilters';
import {
  fetchCompanySubmissions,
  fetchFilingTextOutcome,
  type FilingTextOutcome,
  prescreenBooleanCandidates,
  resolveCompanyInput,
  searchEdgarFilings,
  type EdgarSearchHit,
  type EnrichedSearchParams,
  type SearchCandidateCoverage,
  type BranchCoverageEntry,
  type SecSubmission,
} from './secApi';
import {
  canonicalizeAuditorInput,
  detectAuditorInText,
  matchesAuditorSelection,
} from './auditors';
import { loadSicDirectoryIndex } from './referenceData';
import { deriveSectionPath } from '../utils/sectionPath';
import { isValidIsoDate } from '../lib/api-query';
import { extractResolvedSection, resolveSectionScope } from '../utils/sectionTaxonomy';
import {
  parseAccountingReference,
  referenceBooleanExpression,
  textCitesReference,
} from '../utils/accountingReference';
import { parseSearchHit } from '../hooks/useEdgarSearch';
import {
  buildCandidateQueryFromBoolean,
  booleanQueryMatches,
  extractBooleanMatchSnippet,
} from '../utils/booleanSearch';
import {
  compileSearchPlan,
  shouldUseEnrichedSearch,
  type ResearchSearchMode,
} from './filingResearchPlan';
import { finalizeRunCoverage } from './filingResearchCoverage';
import {
  buildWaveExecutionPolicy,
  collectLaneCandidates,
  validateLaneCandidates,
  type WaveExecutionClients,
  type WaveRunState,
  type WaveStageContext,
} from './filingResearchExecution';

// Keep the established public surface stable while the implementation lives
// in cohesive pure modules.
export {
  canUseInstantEnrichedSearch,
  compileSearchPlan,
  type CompileSearchPlanOptions,
  type ResearchSearchMode,
  type SearchExecutionPlan,
} from './filingResearchPlan';
export {
  finalizeRunCoverage,
  type BooleanStopReason,
  type RunCoverageInputs,
} from './filingResearchCoverage';

export interface FilingResearchResult {
  id: string;
  entityName: string;
  fileDate: string;
  formType: string;
  documentType: string;
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  filingPrimaryDocument: string;
  description: string;
  matchSnippet: string;
  /**
   * Section breadcrumb for the match ("Item 9A · Controls and Procedures"),
   * derived from validated filing text; absent for metadata and delegated
   * matches, where no fetched text can vouch for a location.
   */
  matchSectionPath?: string;
  matchReason: string;
  score: number;
  relevanceScore: number;
  filingUrl: string;
  companyName: string;
  tickers: string[];
  sic: string;
  sicDescription: string;
  exchange: string;
  stateOfIncorporation: string;
  fiscalYearEnd: string;
  headquarters: string;
  fileNumber: string;
  auditor: string;
  // Date-effective PCAOB Form AP evidence (2017→): the latest unambiguous
  // ordinary-issuer report on or before this SEC filing date. This is not the
  // issuer's current auditor and does not claim an exact engagement start.
  // `auditor` (detected in filing text) remains the fallback when Form AP is
  // unavailable, ambiguous, or scoped to a fund/benefit plan.
  registeredAuditor?: string;
  registeredAuditorReportDate?: string;
  registeredAuditorBasis?: string;
  registeredAuditorResolutionStatus?: string;
  acceleratedStatus: string;
  /** Set when the Boolean expression matched inside an exhibit rather than the
   *  parent document. The row represents the parent filing; these identify the
   *  exhibit that actually carried the match. */
  matchedDocumentName?: string;
  matchedDocumentType?: string;
  matchedDocumentUrl?: string;
  /** How many distinct documents in this accession matched (>1 when several
   *  exhibits hit and were rolled up into this single row). */
  matchedDocumentCount?: number;
}

interface FilingSignal {
  text: string;
  auditor: string;
  acceleratedStatus: string;
  /** Why the text was unavailable, when it was. Absent on success. */
  failure?: Extract<FilingTextOutcome, { ok: false }>['kind'];
  /** Upstream HTTP attempts this signal's FIRST load spent (primary +
   *  parent-document fetches, retries included). Cache hits spend zero —
   *  accounting happens via getFilingSignal's onUpstreamAttempts, which
   *  fires only on creation (audit R1). */
  upstreamAttempts?: number;
}

interface CompanyResearchMetadata {
  companyName: string;
  tickers: string[];
  sic: string;
  sicDescription: string;
  exchange: string;
  stateOfIncorporation: string;
  fiscalYearEnd: string;
  headquarters: string;
  fileNumbersByAccession: Record<string, string>;
  primaryDocumentsByAccession: Record<string, string>;
}

interface ExecuteSearchOptions {
  query: string;
  filters: SearchFilters;
  mode?: ResearchSearchMode;
  defaultForms?: string;
  limit?: number;
  useEnrichedSearch?: boolean;
  hydrateTextSignals?: boolean;
  deferTextValidation?: boolean;
  preferFastCandidateCollection?: boolean;
  /** Include exhibit sub-documents (EX-99.x etc.) as separate results.
   *  Off by default — only the Exhibit Search surface wants them. */
  includeExhibits?: boolean;
  /** How eagerly free text is scoped to an issuer via the SEC directory.
   *  'conservative' (default): whole-text company, or a leading ticker the
   *  user typed in caps — topic-heavy surfaces like the Research Workbench.
   *  'aggressive': also lowercase leading company names/tickers — surfaces
   *  whose search box is predominantly a company filter (Exhibits, M&A).
   *  'off': never (Boolean mode is always off). */
  entityScope?: EntityScopeMode;
  onProgress?: (results: FilingResearchResult[]) => void;
  onDegraded?: (reason: string) => void;
  onCoverage?: (coverage: SearchCandidateCoverage) => void;
  /** Cancels the run cooperatively (latest-request-wins). When aborted, the
   *  executor stops issuing new EDGAR pages and filing-text fetches. */
  signal?: AbortSignal;
}

export type EntityScopeMode = 'conservative' | 'aggressive' | 'off';

/**
 * Resolve free text to an issuer scope using the full SEC ticker directory
 * (10K+ listed companies). Shared by every search surface — per-page
 * hardcoded ticker maps are what made "OGN" / "Organon" silently
 * unsearchable. Returns entityName plus the residual topic text (empty when
 * the whole text was the company — keeping the name as a text query made
 * relevance ranking surface the oldest strong match first).
 */
export async function resolveEntityScope(
  rawText: string,
  scope: Exclude<EntityScopeMode, 'off'> = 'conservative'
): Promise<{ entityName: string; cik: string; query: string }> {
  const trimmed = rawText.trim();
  if (!trimmed) return { entityName: '', cik: '', query: trimmed };

  // Whole text reads as one company ("organon", "OGN", "Organon & Co")
  const whole = await resolveCompanyInput(trimmed, { verifyFilingHistory: true });
  if (whole) return { entityName: whole.title, cik: whole.cik, query: '' };

  const words = trimmed.split(/\s+/);
  if (words.length < 2) return { entityName: '', cik: '', query: trimmed };

  // A quoted phrase is atomic — never harvest an issuer out of the middle of
  // one. Splitting on whitespace alone turned `"material weakness"` into the
  // tokens `"material` / `weakness"`, resolved the first to Material Resource
  // Acquisition Corp. (MTRL), and searched the fragment `weakness"` inside that
  // single shell company: one result for a phrase that matches half a million
  // filings. Entity extraction may only consume tokens BEFORE the first quote,
  // so `Apple "material weakness"` still scopes to Apple.
  const firstQuote = trimmed.indexOf('"');
  const quotedFrom = firstQuote === -1
    ? words.length
    : trimmed.slice(0, firstQuote).trim().split(/\s+/).filter(Boolean).length;
  if (quotedFrom === 0) return { entityName: '', cik: '', query: trimmed };

  // Standard citation, not a company: a short all-caps token followed by a
  // number is an accounting/reporting standard (ASC 842, ASU 2023-09,
  // IFRS 16, SFAS 141). "ASC" is also a real ticker (Ardmore Shipping), so
  // without this guard "ASC 842 adoption" hijacks into a company search.
  if (/^[A-Z]{2,5}$/.test(words[0]) && /^\d/.test(words[1])) {
    return { entityName: '', cik: '', query: trimmed };
  }

  // Longest leading multi-word company name ("sun pharma advanced 8-K"),
  // bounded so it can never reach into a quoted phrase.
  for (let take = Math.min(4, words.length - 1, quotedFrom); take >= 2; take--) {
    const lead = await resolveCompanyInput(words.slice(0, take).join(' '), { verifyFilingHistory: true });
    if (lead) {
      return { entityName: lead.title, cik: lead.cik, query: words.slice(take).join(' ') };
    }
  }

  // Single leading token. Ticker-style matches only count when typed in
  // caps under 'conservative' — otherwise ordinary words ("all", "cash",
  // "target") mis-resolve to tickers inside topic queries.
  const lead = await resolveCompanyInput(words[0], { verifyFilingHistory: true });
  if (lead) {
    const isTickerMatch = lead.ticker === words[0].toUpperCase();
    const typedAsTicker = words[0] === words[0].toUpperCase();
    if (scope === 'aggressive' || !isTickerMatch || typedAsTicker) {
      return { entityName: lead.title, cik: lead.cik, query: words.slice(1).join(' ') };
    }
  }

  return { entityName: '', cik: '', query: trimmed };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const companyMetadataCache = new Map<string, Promise<CompanyResearchMetadata | null>>();
const companySubmissionsCache = new Map<string, Promise<SecSubmission | null>>();
const filingSignalCache = new Map<string, Promise<FilingSignal>>();

const FILER_PATTERNS = [
  { key: 'LAF', label: 'Large Accelerated Filer', re: /large accelerated filer/i },
  { key: 'AF', label: 'Accelerated Filer', re: /accelerated filer/i },
  { key: 'NAF', label: 'Non-Accelerated Filer', re: /non-accelerated filer/i },
  { key: 'SRC', label: 'Smaller Reporting Company', re: /smaller reporting company/i },
  { key: 'EGC', label: 'Emerging Growth Company', re: /emerging growth company/i },
  { key: 'WKSI', label: 'Well-Known Seasoned Issuer', re: /well-known seasoned issuer/i },
  { key: 'FPI', label: 'Foreign Private Issuer', re: /foreign private issuer/i },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function includesNormalized(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchTerms(query: string, mode: ResearchSearchMode, sectionKeywords: string): string[] {
  const quoted = Array.from(query.matchAll(/"([^"]+)"/g))
    .map(match => match[1].replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const baseQuery = mode === 'boolean' ? buildCandidateQueryFromBoolean(query) : query;
  const rawTerms = `${baseQuery} ${sectionKeywords}`
    .split(/[,\n;|]+/)
    .flatMap(part => part.split(/\s+/))
    .map(part => part.trim())
    .filter(Boolean);

  const phraseTerms = rawTerms
    .join(' ')
    .split(/\s{2,}/)
    .map(part => part.trim())
    .filter(Boolean);

  const unique = Array.from(
    new Set(
      [...quoted, ...phraseTerms, ...rawTerms]
        .map(term => term.replace(/^"+|"+$/g, '').trim())
        .filter(Boolean)
    )
  );

  return unique
    .sort((a, b) => {
      const wordDelta = b.split(/\s+/).length - a.split(/\s+/).length;
      if (wordDelta !== 0) return wordDelta;
      return b.length - a.length;
    })
    .slice(0, 14);
}

function buildKeywordSnippet(text: string, terms: string[]): string {
  if (!text.trim()) return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';

  const sortedTerms = [...terms]
    .map(term => term.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort((a, b) => {
      const wordDelta = b.split(/\s+/).length - a.split(/\s+/).length;
      if (wordDelta !== 0) return wordDelta;
      return b.length - a.length;
    });

  for (const term of sortedTerms) {
    const regex = new RegExp(`\\b${escapeRegex(term).replace(/\s+/g, '\\s+')}\\b`, 'i');
    const match = regex.exec(compact);
    if (!match) continue;

    const start = Math.max(0, match.index - 180);
    const end = Math.min(compact.length, match.index + match[0].length + 220);
    const excerpt = compact.slice(start, end).trim();
    return `${start > 0 ? '... ' : ''}${excerpt}${end < compact.length ? ' ...' : ''}`;
  }

  return '';
}

function countMatchedTerms(text: string, terms: string[]): number {
  const normalizedText = normalizeLooseText(text);
  if (!normalizedText) return 0;
  return terms.filter(term => {
    const normalizedTerm = normalizeLooseText(term);
    return normalizedTerm ? normalizedText.includes(normalizedTerm) : false;
  }).length;
}

function computeRelevanceScore(
  result: FilingResearchResult,
  rawQuery: string,
  filters: SearchFilters,
  mode: ResearchSearchMode,
  filingText: string,
  terms: string[],
  proximityDistance: number | null
): number {
  let score = result.score || 0;
  const matchedTermCount = countMatchedTerms(filingText, terms);

  if (terms.length > 0) {
    score += matchedTermCount * 18;
    score += (matchedTermCount / terms.length) * 75;
  }

  if (mode === 'boolean' && rawQuery.trim()) {
    score += 25;
    if (proximityDistance != null) {
      score += Math.max(30 - proximityDistance * 2, 8);
    }
  }

  if (filters.sectionKeywords.trim() && matchesSectionKeywords(filingText, filters.sectionKeywords)) {
    score += 16;
  }

  if (filters.accountant.trim() && result.auditor) {
    score += 10;
  }

  return score;
}

function annotateResultMatchContext(
  result: FilingResearchResult,
  rawQuery: string,
  filters: SearchFilters,
  mode: ResearchSearchMode,
  filingText: string,
  upstreamTextMatch = false
): FilingResearchResult {
  const terms = buildSearchTerms(rawQuery, mode, filters.sectionKeywords);
  let proximityDistance: number | null = null;
  let matchSnippet = '';

  if (mode === 'boolean' && rawQuery.trim()) {
    const booleanSnippet = extractBooleanMatchSnippet(rawQuery, filingText);
    if (booleanSnippet) {
      matchSnippet = booleanSnippet.excerpt;
      proximityDistance = booleanSnippet.distance;
    }
  }

  if (!matchSnippet) {
    matchSnippet = buildKeywordSnippet(filingText, terms);
  }

  // Citation filter: when the query itself produced no snippet (or there is
  // no query at all), the citation IS the evidence — show where the filing
  // cites the standard, and label the row as text-validated rather than
  // letting it fall through to the metadata label it did not earn.
  let citationReason = '';
  if ((filters.ascReference || '').trim() && filingText) {
    const reference = parseAccountingReference(filters.ascReference || '');
    if (reference) {
      citationReason = `Cites ${reference.label} (text validated)`;
      if (!matchSnippet) {
        const citationSnippet = extractBooleanMatchSnippet(referenceBooleanExpression(reference), filingText);
        if (citationSnippet) matchSnippet = citationSnippet.excerpt;
      }
    }
  }

  result.matchSnippet = matchSnippet;
  // Where in the filing the match lives (Item 9A · Controls and Procedures),
  // derived from the text already fetched for validation. Delegated matches
  // carry no text, so they carry no breadcrumb — never a guess.
  result.matchSectionPath = matchSnippet && filingText ? deriveSectionPath(filingText, matchSnippet) : '';
  result.matchReason =
    proximityDistance != null
      ? proximityDistance === 0
        ? 'Matched adjacent proximity terms'
        : `Matched within ${proximityDistance} words`
      : citationReason && !rawQuery.trim()
        ? citationReason
        : matchSnippet
        ? 'Matched filing text'
        : upstreamTextMatch
          // Genuinely a text match — performed by SEC's full-text index over
          // the whole filing rather than by us over a fetched copy. Labelled
          // distinctly so the reader knows which engine vouched for it.
          ? 'Matched by SEC full-text index'
          : 'Matched filing metadata';
  result.relevanceScore = computeRelevanceScore(result, rawQuery, filters, mode, filingText, terms, proximityDistance);

  return result;
}

function buildFilingUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const cleanAccession = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${cleanAccession}/${primaryDocument}`;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeFormValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function isExhibitDocumentType(documentType: string): boolean {
  const normalized = normalizeFormValue(documentType).replace(/^EX\s+/, 'EX-');
  return normalized.startsWith('EX-');
}

export function matchesDocumentTypePrefixes(documentType: string, selectedTypes: string[]): boolean {
  if (selectedTypes.length === 0) return isExhibitDocumentType(documentType);
  const normalizedDocument = normalizeFormValue(documentType).replace(/^EX\s+/, 'EX-');
  return selectedTypes.some(selected => {
    const normalizedSelected = normalizeFormValue(selected).replace(/^EX\s+/, 'EX-');
    return normalizedDocument === normalizedSelected || normalizedDocument.startsWith(`${normalizedSelected}.`);
  });
}

export function partitionParentAndExhibitForms(
  selectedForms: string[],
  defaultParentForms: string[]
): { parentForms: string[]; exhibitTypes: string[] } {
  const parentForms = selectedForms.filter(form => !isExhibitDocumentType(form));
  return {
    parentForms: parentForms.length > 0 ? parentForms : defaultParentForms,
    exhibitTypes: selectedForms.filter(isExhibitDocumentType),
  };
}

function normalizeBaseForm(value: string): string {
  return normalizeFormValue(value).replace(/\/A$/, '');
}

async function getCompanySubmissionsCached(cik: string): Promise<SecSubmission | null> {
  if (!cik) return null;
  if (!companySubmissionsCache.has(cik)) {
    const loadPromise = fetchCompanySubmissions(cik);
    companySubmissionsCache.set(cik, loadPromise);
    void loadPromise.then(result => {
      if (!result && companySubmissionsCache.get(cik) === loadPromise) {
        companySubmissionsCache.delete(cik);
      }
    });
  }
  return companySubmissionsCache.get(cik)!;
}

async function getCompanyMetadata(cik: string): Promise<CompanyResearchMetadata | null> {
  if (!cik) return null;
  if (!companyMetadataCache.has(cik)) {
    const loadPromise = (async () => {
        const submissions = await getCompanySubmissionsCached(cik);
        if (!submissions) {
          return null;
        }

        const recent = submissions.filings.recent;
        const fileNumbersByAccession: Record<string, string> = {};
        const primaryDocumentsByAccession: Record<string, string> = {};
        recent.accessionNumber.forEach((accession, index) => {
          fileNumbersByAccession[accession] = recent.fileNumber[index] || '';
          primaryDocumentsByAccession[accession] = recent.primaryDocument[index] || '';
        });

        const businessAddress = (submissions as any).addresses?.business;
        const headquarters = [
          businessAddress?.city,
          businessAddress?.stateOrCountryDescription || businessAddress?.stateOrCountry,
        ]
          .filter(Boolean)
          .join(', ');

        return {
          companyName: submissions.name || '',
          tickers: submissions.tickers || [],
          sic: (submissions as any).sic || '',
          sicDescription: submissions.sicDescription || '',
          exchange: (submissions as any).exchanges?.[0] || '',
          stateOfIncorporation:
            (submissions as any).stateOfIncorporationDescription ||
            (submissions as any).stateOfIncorporation ||
            '',
          fiscalYearEnd: (submissions as any).fiscalYearEnd || '',
          headquarters,
          fileNumbersByAccession,
          primaryDocumentsByAccession,
        };
      })();
    companyMetadataCache.set(cik, loadPromise);
    void loadPromise.then(result => {
      if (!result && companyMetadataCache.get(cik) === loadPromise) {
        companyMetadataCache.delete(cik);
      }
    });
  }

  return companyMetadataCache.get(cik)!;
}

function detectAuditor(text: string): string {
  return detectAuditorInText(text);
}

function detectAcceleratedStatus(text: string): string {
  const sample = text.slice(0, 12000);
  const statuses = FILER_PATTERNS
    .filter(pattern => pattern.re.test(sample))
    .map(pattern => pattern.label);
  return Array.from(new Set(statuses)).join(', ');
}

async function getFilingSignal(
  cik: string,
  accessionNumber: string,
  primaryDocument: string,
  filingPrimaryDocument: string,
  abortSignal?: AbortSignal,
  onUpstreamAttempts?: (attempts: number) => void
): Promise<FilingSignal> {
  const cacheKey = `${cik}:${accessionNumber}:${primaryDocument}:${filingPrimaryDocument}`;
  const created = !filingSignalCache.has(cacheKey);
  if (created) {
    filingSignalCache.set(
      cacheKey,
      (async () => {
        try {
          // The abort signal cancels the underlying fetch; a cancelled outcome
          // is never cached (failure path deletes the cache entry below), so a
          // later run retries cleanly.
          const outcome = await fetchFilingTextOutcome(cik, accessionNumber, primaryDocument, { signal: abortSignal });
          const text = outcome.ok ? outcome.text : '';
          const failure = outcome.ok ? undefined : outcome.kind;
          let upstreamAttempts = outcome.attempts ?? 1;
          let parentText = '';
          let auditor = canonicalizeAuditorInput(detectAuditor(text));
          let acceleratedStatus = detectAcceleratedStatus(text);

          if (filingPrimaryDocument && filingPrimaryDocument !== primaryDocument) {
            // Outcome variant so the parent-document fallback's HTTP attempts
            // are measured too — it was an uncounted request class (audit R1).
            const parentOutcome = await fetchFilingTextOutcome(cik, accessionNumber, filingPrimaryDocument, { signal: abortSignal });
            parentText = parentOutcome.ok ? parentOutcome.text : '';
            upstreamAttempts += parentOutcome.attempts ?? 1;

            if (!auditor) {
              auditor = canonicalizeAuditorInput(detectAuditor(parentText));
            }

            if (!acceleratedStatus) {
              acceleratedStatus = detectAcceleratedStatus(parentText);
            }
          }

          const resolvedText = text || parentText;
          // Only report a failure when we genuinely ended up with no text; a
          // parent-document fallback that succeeded is not a failure.
          if (!resolvedText && failure) filingSignalCache.delete(cacheKey);
          return {
            text: resolvedText,
            auditor,
            acceleratedStatus,
            failure: resolvedText ? undefined : failure,
            upstreamAttempts,
          };
        } catch {
          // Filing text fetch failed (rate limit, network error, etc.)
          // Remove from cache so a future attempt can retry.
          filingSignalCache.delete(cacheKey);
          return { text: '', auditor: '', acceleratedStatus: '', failure: 'upstream', upstreamAttempts: 1 };
        }
      })()
    );
  }

  const resolved = await filingSignalCache.get(cacheKey)!;
  // Spend accounting fires only for the call that CREATED the entry: cache
  // hits cost SEC nothing and must not inflate the measured-work ledger.
  if (created) onUpstreamAttempts?.(resolved.upstreamAttempts ?? 1);
  return resolved;
}

function getSignalCacheKey(
  result: Pick<FilingResearchResult, 'cik' | 'accessionNumber' | 'primaryDocument' | 'filingPrimaryDocument'>
): string {
  return `${result.cik}:${result.accessionNumber}:${result.primaryDocument}:${result.filingPrimaryDocument}`;
}

function matchesEntityFilter(result: FilingResearchResult, entityName: string): boolean {
  const rawNeedle = entityName.trim();
  if (!rawNeedle) return true;

  const cikNeedle = rawNeedle.replace(/\D/g, '').replace(/^0+/, '');
  if (cikNeedle && result.cik === cikNeedle) {
    return true;
  }

  const tickerNeedle = rawNeedle.toUpperCase();
  if (result.tickers.some(ticker => ticker.toUpperCase() === tickerNeedle)) {
    return true;
  }

  const normalizedNeedle = normalizeLooseText(rawNeedle);
  if (!normalizedNeedle) return true;

  return [result.entityName, result.companyName, ...result.tickers]
    .filter(Boolean)
    .some(candidate => normalizeLooseText(candidate).includes(normalizedNeedle));
}

function matchesDateRange(result: FilingResearchResult, dateFrom: string, dateTo: string): boolean {
  if (!dateFrom && !dateTo) {
    return true;
  }

  if (!result.fileDate) {
    return false;
  }

  if (dateFrom && result.fileDate < dateFrom) {
    return false;
  }

  if (dateTo && result.fileDate > dateTo) {
    return false;
  }

  return true;
}

function matchesFormScope(result: FilingResearchResult, formScope: string[], excludeExhibits: boolean): boolean {
  if (formScope.length === 0) {
    return true;
  }

  const normalizedResultForm = normalizeFormValue(result.formType);
  const normalizedResultBaseForm = normalizeBaseForm(result.formType);
  const docType = normalizeFormValue(result.documentType || '');

  // When the user explicitly searches for a parent form type (e.g. 10-K, 10-Q, S-1),
  // exclude exhibit sub-documents (EX-4.1, EX-31.2, etc.) — only show the main filing.
  // This does NOT apply when using defaultForms (e.g. Exhibit Search page).
  if (excludeExhibits) {
    const isExhibit = docType.startsWith('EX-') || docType.startsWith('EX ');
    if (isExhibit) {
      return false;
    }
  }

  return formScope.some(form => {
    const normalizedForm = normalizeFormValue(form);
    const normalizedBaseForm = normalizeBaseForm(form);
    return (
      normalizedResultForm === normalizedForm ||
      normalizedResultBaseForm === normalizedBaseForm ||
      normalizedResultForm.startsWith(`${normalizedForm}/`) ||
      normalizedResultForm.startsWith(`${normalizedBaseForm}/`)
    );
  });
}

function parseSectionKeywordOptions(sectionKeywords: string): string[] {
  return sectionKeywords
    .split(/[,\n;|]+/)
    .map(keyword => normalizeLooseText(keyword))
    .filter(Boolean);
}

function matchesSectionKeywords(filingText: string, sectionKeywords: string): boolean {
  const options = parseSectionKeywordOptions(sectionKeywords);
  if (options.length === 0) {
    return true;
  }

  const normalizedText = normalizeLooseText(filingText);
  if (!normalizedText) {
    return false;
  }

  return options.some(option => normalizedText.includes(option));
}

function matchesAccountingFramework(filingText: string, framework: string): boolean {
  const selected = framework.trim().toLowerCase();
  if (!selected) return true;
  if (!filingText.trim()) return false;

  if (selected === 'us gaap') {
    return /\b(?:u\.?s\.\s+gaap|us-gaap|accounting principles generally accepted in the united states)\b/i.test(filingText);
  }
  if (selected === 'ifrs') {
    return /\b(?:ifrs|international financial reporting standards)\b/i.test(filingText);
  }
  if (selected === 'ind as') {
    return /\b(?:ind(?:ian)?\s+as|indian accounting standards?)\b/i.test(filingText);
  }
  return normalizeLooseText(filingText).includes(normalizeLooseText(framework));
}

function sortResearchResults(results: FilingResearchResult[], preferRelevance: boolean): FilingResearchResult[] {
  return results.sort((a, b) => {
    const byRelevance = (b.relevanceScore ?? b.score) - (a.relevanceScore ?? a.score);
    const byDate = b.fileDate.localeCompare(a.fileDate);
    const primary = preferRelevance
      ? (byRelevance !== 0 ? byRelevance : byDate)
      : (byDate !== 0 ? byDate : byRelevance);
    if (primary !== 0) return primary;
    // Stable, content-derived tie-break. Without it equal-ranked rows keep
    // whatever order retrieval happened to produce, so the same query could
    // return the same filings in a different order between runs.
    return (
      a.accessionNumber.localeCompare(b.accessionNumber) ||
      a.primaryDocument.localeCompare(b.primaryDocument)
    );
  });
}

function matchesFilerKeys(selected: string[], result: FilingResearchResult): boolean {
  if (selected.length === 0) return true;
  const signal = normalize(result.acceleratedStatus);
  const sicDescription = normalize(result.sicDescription);
  const description = normalize(result.description);
  const formType = normalize(result.formType);

  // Values inside one inclusive filter family combine with OR (different
  // families still combine with AND). This used to require EVERY selected
  // status, so picking two mutually exclusive ones — "Large accelerated filer"
  // and "Accelerated filer" — could only ever return zero.
  return selected.some(key => {
    switch (key) {
      case 'LAF':
        return signal.includes('large accelerated filer');
      case 'AF':
        return signal.includes('accelerated filer') && !signal.includes('large accelerated filer');
      case 'NAF':
        return signal.includes('non-accelerated filer');
      case 'SRC':
        return signal.includes('smaller reporting company');
      case 'EGC':
        return signal.includes('emerging growth company');
      case 'WKSI':
        return signal.includes('well-known seasoned issuer');
      case 'FPI':
        return signal.includes('foreign private issuer') || formType === '20-f';
      case 'SPAC':
        return description.includes('blank check') || description.includes('special purpose acquisition') || result.entityName.toLowerCase().includes('acquisition');
      case 'REIT':
        return sicDescription.includes('reit') || result.entityName.toLowerCase().includes('reit');
      case 'BDC':
        return sicDescription.includes('business development') || description.includes('business development company');
      default:
        // Under OR semantics an unrecognised key must not vacuously match every
        // filing the way it harmlessly could under the previous AND semantics.
        return false;
    }
  });
}

function matchesBaseFilters(result: FilingResearchResult, filters: SearchFilters, formScope: string[], excludeExhibits: boolean): boolean {
  if (!matchesEntityFilter(result, filters.entityName)) {
    return false;
  }

  if (!matchesDateRange(result, filters.dateFrom.trim(), filters.dateTo.trim())) {
    return false;
  }

  if (!matchesFormScope(result, formScope, excludeExhibits)) {
    return false;
  }

  if (filters.accessionNumber.trim() && !includesNormalized(result.accessionNumber, filters.accessionNumber)) {
    return false;
  }

  if (filters.fileNumber.trim() && !includesNormalized(result.fileNumber, filters.fileNumber)) {
    return false;
  }

  if (filters.sicCode.trim()) {
    const sicNeedle = filters.sicCode.trim();
    const sicDigits = sicNeedle.match(/\d{3,4}/)?.[0] || '';
    const sicText = sicNeedle.replace(/^\d{3,4}\s*[-:]?\s*/, '').trim();
    const matchesSic =
      (sicDigits ? includesNormalized(result.sic, sicDigits) : false) ||
      includesNormalized(result.sic, sicNeedle) ||
      includesNormalized(result.sicDescription, sicNeedle) ||
      (sicText ? includesNormalized(result.sicDescription, sicText) : false);
    if (!matchesSic) return false;
  }

  if (filters.stateOfInc.trim() && !includesNormalized(result.stateOfIncorporation, filters.stateOfInc)) {
    return false;
  }

  if (filters.headquarters.trim() && !includesNormalized(result.headquarters, filters.headquarters)) {
    return false;
  }

  if (filters.exchange.length > 0 && !filters.exchange.some(exchange => includesNormalized(result.exchange, exchange))) {
    return false;
  }

  if (filters.fiscalYearEnd.trim() && result.fiscalYearEnd !== filters.fiscalYearEnd.trim()) {
    return false;
  }

  return true;
}

function matchesSignalFilters(
  result: FilingResearchResult,
  filters: SearchFilters,
  filingText: string,
  // Section-scoped slice when an Item scope is set; text-level predicates that
  // the scope should narrow read this one. Whole-document predicates
  // (framework, citation) stay on filingText — a filing cites ASC 842 in the
  // notes even when the query is scoped to Item 1A.
  scopedText: string = filingText
): boolean {
  if (filters.sectionKeywords.trim() && !matchesSectionKeywords(scopedText, filters.sectionKeywords)) {
    return false;
  }

  // An Item scope with no other text predicate is still a real filter:
  // "has an Item 1C section at all". An empty slice fails it.
  if ((filters.sectionScope || '').trim() && !scopedText) {
    return false;
  }

  // ASC/ASU citation filter: the filing must cite the standard in ANY of its
  // accepted spellings (ASC 842 / ASC Topic 842 / Topic 842; ASU 2023-07 /
  // ASU No. 2023-07 / Accounting Standards Update ...). Unparseable input
  // matches nothing rather than silently matching everything.
  if ((filters.ascReference || '').trim()) {
    const reference = parseAccountingReference(filters.ascReference || '');
    if (!reference || !textCitesReference(reference, filingText)) {
      return false;
    }
  }

  if (filters.accountant.trim()) {
    // Resolved filing-date Form AP evidence wins; the auditor detected in the
    // filing text is a fallback for missing, ambiguous, fund, or benefit-plan
    // events. This prevents today's issuer firm from rewriting old filings.
    const effectiveAuditor = result.registeredAuditor?.trim() || result.auditor;
    if (!matchesAuditorSelection(effectiveAuditor, filters.accountant)) {
      return false;
    }
  }

  if (!matchesFilerKeys(filters.acceleratedStatus, result)) {
    return false;
  }

  if (!matchesAccountingFramework(filingText, filters.accountingFramework)) {
    return false;
  }

  return true;
}

/**
 * Collapses per-document Boolean matches into one row per filing.
 *
 * EFTS returns every matching document of an accession as its own hit, so an
 * 8-K whose text appears in three exhibits would otherwise read as three
 * duplicate rows. A parent-document match wins the row; when only exhibits
 * matched, the exhibit that matched becomes the row's evidence and is labelled
 * as such. Input order is preserved so the caller's ranking still decides
 * position.
 */
function rollUpExhibitMatches(results: FilingResearchResult[]): FilingResearchResult[] {
  const byFiling = new Map<string, FilingResearchResult>();
  const matchedDocs = new Map<string, Set<string>>();

  for (const result of results) {
    const key = `${result.cik}:${result.accessionNumber}`;
    const docs = matchedDocs.get(key) || new Set<string>();
    docs.add(result.primaryDocument || result.documentType);
    matchedDocs.set(key, docs);

    const existing = byFiling.get(key);
    if (!existing) {
      byFiling.set(key, result);
      continue;
    }

    // A parent-document match is a better representative than an exhibit one.
    if (isExhibitDocumentType(existing.documentType) && !isExhibitDocumentType(result.documentType)) {
      byFiling.set(key, result);
    }
  }

  return Array.from(byFiling.entries()).map(([key, result]) => {
    const count = matchedDocs.get(key)?.size ?? 1;
    if (!isExhibitDocumentType(result.documentType)) {
      return count > 1 ? { ...result, matchedDocumentCount: count } : result;
    }

    // Exhibit-only match: present it as the parent filing, with the exhibit
    // named as the evidence that actually carried the match.
    return {
      ...result,
      matchedDocumentName: result.primaryDocument,
      matchedDocumentType: result.documentType,
      matchedDocumentUrl: buildFilingUrl(result.cik, result.accessionNumber, result.primaryDocument),
      matchedDocumentCount: count,
    };
  });
}

function applyMetadataMatchFallback(results: FilingResearchResult[]): FilingResearchResult[] {
  return results.map(result => ({
    ...result,
    matchReason: result.matchReason || 'Matched filing metadata',
    matchSnippet: result.matchSnippet || result.description || 'Matched on filing metadata.',
  }));
}

function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function joinStrings(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(item => item.trim()).filter(Boolean))).join(', ');
  }
  return value?.trim() || '';
}

function cleanSnippet(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickHighlightSnippet(hit: EdgarSearchHit): { snippet: string; reason: string } {
  const highlight = hit.highlight || {};

  const contentSnippet = cleanSnippet(highlight.content?.find(Boolean) || '');
  if (contentSnippet) {
    return {
      snippet: contentSnippet,
      reason: 'Matched filing text',
    };
  }

  const metadataSnippet = cleanSnippet(
    highlight.file_description?.find(Boolean) ||
      highlight.entity_name?.find(Boolean) ||
      highlight.display_names?.find(Boolean) ||
      ''
  );

  if (metadataSnippet) {
    return {
      snippet: metadataSnippet,
      reason: 'Matched filing metadata',
    };
  }

  return {
    snippet: '',
    reason: '',
  };
}

export function mapSearchHit(hit: EdgarSearchHit): FilingResearchResult {
  const base = parseSearchHit(hit);
  const source = hit._source;
  const highlightMatch = pickHighlightSnippet(hit);
  return {
    id: hit._id,
    entityName: base.entityName,
    fileDate: base.fileDate,
    formType: base.formType,
    documentType: (base as { documentType?: string }).documentType || base.formType,
    cik: base.cik,
    accessionNumber: base.accessionNumber,
    primaryDocument: base.primaryDocument,
    filingPrimaryDocument: base.primaryDocument,
    description: base.description,
    matchSnippet: highlightMatch.snippet,
    matchReason: highlightMatch.reason,
    score: hit._score,
    relevanceScore: hit._score,
    filingUrl: buildFilingUrl(base.cik, base.accessionNumber, base.primaryDocument),
    companyName: source?.entity_name || base.entityName,
    tickers: source?.tickers || [],
    // EFTS uses `sics[]`; the enriched route historically emitted singular
    // `sic`. Preserve every code so a secondary valid SIC is not discarded.
    sic: joinStrings(source?.sics || source?.sic),
    sicDescription: source?.sic_description || '',
    exchange: source?.exchange || '',
    stateOfIncorporation: source?.state_of_incorporation || firstString(source?.inc_states),
    fiscalYearEnd: source?.fiscal_year_end || '',
    headquarters: firstString(source?.biz_locations),
    fileNumber: firstString(source?.file_num),
    auditor: canonicalizeAuditorInput(source?.auditor || ''),
    // Enriched search emits a scalar only for a filing-date resolved Form AP
    // event. Legacy/mocked responses without a status remain compatible.
    registeredAuditor: source?.auditor && (
      !source.auditor_resolution_status || source.auditor_resolution_status === 'resolved'
    )
      ? canonicalizeAuditorInput(source.auditor)
      : undefined,
    registeredAuditorReportDate: source?.auditor_report_date || undefined,
    registeredAuditorBasis: source?.auditor_basis || undefined,
    registeredAuditorResolutionStatus: source?.auditor_resolution_status || undefined,
    acceleratedStatus: joinStrings(source?.accelerated_status),
  };
}

/**
 * Batch enrichment from the facet store. Company profile data comes from the
 * issuer-level GET contract; filing auditors come from the date-aware POST
 * contract. Never copy the GET contract's current auditor onto a filing.
 * Failure is a no-op so search can fall back to filing-text evidence.
 */
export async function enrichResultsFromFacetStore(
  results: FilingResearchResult[]
): Promise<FilingResearchResult[]> {
  const ciks = Array.from(new Set(
    results.map(result => Number(result.cik)).filter(value => Number.isFinite(value) && value > 0)
  ));
  if (ciks.length === 0) return results;

  await hydrateRegisteredAuditors(results);

  try {
    const response = await fetch(`/api/enrich?ciks=${ciks.slice(0, 200).join(',')}`);
    if (!response.ok) return results;
    const payload = await response.json() as { companies?: Record<string, {
      sic?: string | null; sic_description?: string | null;
      tickers?: string[]; exchanges?: string[]; state_of_incorporation?: string | null;
    }> };
    const companies = payload.companies ?? {};
    for (const result of results) {
      const info = companies[String(Number(result.cik))];
      if (!info) continue;
      if (info.sic && !result.sic) result.sic = info.sic;
      if (info.sic_description) result.sicDescription = info.sic_description;
      if (info.tickers?.length && (!result.tickers || result.tickers.length === 0)) result.tickers = info.tickers;
      if (info.exchanges?.length && !result.exchange) result.exchange = info.exchanges.join(', ');
      if (info.state_of_incorporation && !result.stateOfIncorporation) result.stateOfIncorporation = info.state_of_incorporation;
    }
  } catch {
    // facet store unreachable — display falls back to whatever EFTS provided
  }
  return results;
}

// Populate only filing-date Form AP evidence, keyed by result rather than CIK
// so the same issuer's old and new filings can resolve to different firms.
// A non-resolved event leaves registeredAuditor undefined and the filter falls
// back to filing-text detection.
async function hydrateRegisteredAuditors(results: FilingResearchResult[]): Promise<void> {
  const filings = results
    .filter(result =>
      result.registeredAuditor === undefined
      && result.registeredAuditorResolutionStatus === undefined
    )
    .map(result => ({ result, cik: Number(result.cik) }))
    .filter(({ result, cik }) =>
      Number.isFinite(cik) && cik > 0 && isValidIsoDate(result.fileDate)
    )
    .slice(0, 200);
  if (filings.length === 0) return;

  try {
    const response = await fetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filings: filings.map(({ result, cik }) => ({
          key: result.id,
          cik: String(cik),
          fileDate: result.fileDate,
        })),
      }),
    });
    if (!response.ok) return;
    const payload = await response.json() as { filings?: Record<string, {
      auditor?: string | null;
      auditReportDate?: string | null;
      basis?: string | null;
      resolutionStatus?: string;
    }> };
    const evidenceByKey = payload.filings ?? {};
    for (const { result } of filings) {
      const evidence = evidenceByKey[result.id];
      if (!evidence) continue;
      result.registeredAuditorResolutionStatus = evidence.resolutionStatus;
      result.registeredAuditorReportDate = evidence.auditReportDate || undefined;
      result.registeredAuditorBasis = evidence.basis || undefined;
      if (evidence.resolutionStatus === 'resolved' && evidence.auditor) {
        const canonical = canonicalizeAuditorInput(evidence.auditor);
        if (canonical) {
          result.registeredAuditor = canonical;
          result.auditor = canonical;
        }
      }
    }
  } catch {
    // facet store unreachable — auditor filter falls back to text detection
  }
}

async function hydrateCompanyMetadata(result: FilingResearchResult): Promise<FilingResearchResult> {
  const metadata = await getCompanyMetadata(result.cik);
  if (metadata) {
    result.companyName = metadata.companyName || result.companyName || result.entityName;
    result.tickers = metadata.tickers;
    result.sic = metadata.sic || result.sic;
    result.sicDescription = metadata.sicDescription || result.sicDescription;
    result.exchange = metadata.exchange || result.exchange;
    result.stateOfIncorporation = metadata.stateOfIncorporation || result.stateOfIncorporation;
    result.fiscalYearEnd = metadata.fiscalYearEnd || result.fiscalYearEnd;
    result.headquarters = metadata.headquarters || result.headquarters;
    result.fileNumber = metadata.fileNumbersByAccession[result.accessionNumber] || result.fileNumber;
    result.filingPrimaryDocument = metadata.primaryDocumentsByAccession[result.accessionNumber] || result.filingPrimaryDocument;
  }

  return result;
}

async function hydrateCompanyMetadataBatch(
  results: FilingResearchResult[],
  concurrency = 4
): Promise<FilingResearchResult[]> {
  const hydrated = [...results];

  for (let index = 0; index < hydrated.length; index += concurrency) {
    const chunk = hydrated.slice(index, Math.min(index + concurrency, hydrated.length));
    await Promise.all(chunk.map(result => hydrateCompanyMetadata(result)));

    if (index + concurrency < hydrated.length) {
      await delay(120);
    }
  }

  return hydrated;
}

async function hydrateLightweightMetadata(results: FilingResearchResult[]): Promise<FilingResearchResult[]> {
  const needsSicLookup = results.some(result => result.sic && !result.sicDescription);
  if (!needsSicLookup) {
    return results;
  }

  const sicIndex = await loadSicDirectoryIndex();
  return results.map(result => {
    if (!result.sicDescription && result.sic) {
      result.sicDescription = sicIndex[result.sic]?.title || result.sicDescription;
    }
    return result;
  });
}

async function hydrateResultSignals(result: FilingResearchResult, abortSignal?: AbortSignal, onUpstreamAttempts?: (attempts: number) => void): Promise<FilingSignal> {
  const filingSignal = await getFilingSignal(
    result.cik,
    result.accessionNumber,
    result.primaryDocument,
    result.filingPrimaryDocument,
    abortSignal,
    onUpstreamAttempts
  );
  // Filing text is fallback evidence. A resolved date-effective Form AP value
  // drives both filtering and display; otherwise a later validation pass could
  // make a KPMG-filtered result render blank or as a conflicting text guess.
  result.auditor = result.registeredAuditor || filingSignal.auditor;
  result.acceleratedStatus = filingSignal.acceleratedStatus;
  return filingSignal;
}

function buildEnrichedSearchParams(
  filters: SearchFilters,
  useEnrichedSearch: boolean,
  onDegraded?: (reason: string) => void,
  onCoverage?: (coverage: SearchCandidateCoverage) => void
): EnrichedSearchParams {
  const requiresClientValidation = Boolean(
    filters.sectionKeywords.trim() ||
    filters.acceleratedStatus.length > 0 ||
    filters.accountingFramework.trim() ||
    filters.fileNumber.trim() ||
    filters.stateOfInc.trim() ||
    filters.headquarters.trim() ||
    filters.exchange.length > 0 ||
    filters.fiscalYearEnd.trim()
  );
  const hasAuthoritativeFacet = Boolean(filters.accountant.trim() || filters.sicCode.trim());
  return {
    // Auditor and SIC are authoritative facets on /api/es-search. Keep that
    // lane available even when another predicate still needs client-side
    // validation; disabling the whole route for `accountant` made an auditor
    // search depend on the firm's name happening to appear in EFTS text.
    useEnrichedSearch:
      shouldUseEnrichedSearch(useEnrichedSearch) &&
      (!requiresClientValidation || hasAuthoritativeFacet),
    auditor: filters.accountant.trim() || undefined,
    sicCode: filters.sicCode.trim() || undefined,
    onDegraded,
    onCoverage,
  };
}

export async function executeFilingResearchSearch({
  query: rawQuery,
  filters: rawFilters,
  mode = 'semantic',
  defaultForms = '',
  limit = 50,
  useEnrichedSearch = false,
  hydrateTextSignals = false,
  deferTextValidation = false,
  preferFastCandidateCollection = false,
  includeExhibits = false,
  entityScope = 'conservative',
  onProgress,
  onDegraded,
  onCoverage,
  signal,
}: ExecuteSearchOptions): Promise<FilingResearchResult[]> {
  let query = rawQuery;
  let filters = rawFilters;
  // Resolved issuer CIK — EFTS filters reliably by CIK where entity-name
  // strings with punctuation ("Organon & Co.") silently mismatch. An explicit
  // CIK from the issuer picker is authoritative and needs no re-resolution;
  // this also makes issuer scope work in Boolean mode, where free text is
  // deliberately treated as filing text rather than a company name.
  let entityCik = (rawFilters.entityCik || '').trim();

  // Entity scoping ("apple 10-K", "OGN climate", "Organon exhibit"): company
  // text must become an issuer scope, not a relevance term — full-text
  // ranking the word "apple" surfaced a 2009 filing first, and unresolved
  // companies silently miss. Runs for every caller unless the query is a
  // Boolean expression or the caller already scoped an issuer.
  if (
    mode !== 'boolean' &&
    entityScope !== 'off' &&
    !entityCik &&
    !filters.entityName.trim() &&
    !filters.sectionKeywords.trim() &&
    (query || filters.keyword).trim()
  ) {
    const scoped = await resolveEntityScope((query || filters.keyword).trim(), entityScope);
    if (scoped.entityName) {
      query = scoped.query;
      filters = { ...filters, keyword: '', entityName: scoped.entityName };
      entityCik = scoped.cik;
    }
  }

  // ── Plan compilation (WP7 stage: compileSearchPlan) ──
  // Everything derivable from the request alone — residual query, lifted
  // auditor, retrieval lanes, budgets and mode flags — is computed in one pure
  // step. A null plan means the Boolean expression was invalid: zero network
  // calls, empty result (the views surface the message via the same compiler).
  const plan = compileSearchPlan({
    query,
    filters,
    mode,
    defaultForms,
    limit,
    includeExhibits,
    deferTextValidation,
    preferFastCandidateCollection,
    hydrateTextSignals,
    useEnrichedSearch,
  });
  if (!plan) return [];
  ({ query, filters } = plan);
  const {
    formTypes,
    formScope,
    excludeExhibits,
    preferRelevance,
    needsCompanyMetadata,
    displayLimit,
    fastCandidateCollection,
    needsTextFiltering,
    shouldHydrateSignals,
    parsedBooleanQuery,
    delegatedToEfts,
    hydratePerDocumentSignals,
    requiredBooleanBranches,
    filteredServerQueries,
    perQueryResultLimit,
  } = plan;

  const upstreamCoverageState: { value: SearchCandidateCoverage | null } = { value: null };
  const captureUpstreamCoverage = (coverage: SearchCandidateCoverage) => {
    upstreamCoverageState.value = upstreamCoverageState.value
      ? {
          examined: Math.max(upstreamCoverageState.value.examined, coverage.examined),
          upstreamTotal: Math.max(upstreamCoverageState.value.upstreamTotal, coverage.upstreamTotal),
          complete: upstreamCoverageState.value.complete && coverage.complete,
          upstreamTotalIsFloor:
            Boolean(upstreamCoverageState.value.upstreamTotalIsFloor) || Boolean(coverage.upstreamTotalIsFloor),
        }
      : coverage;

    // For text-filtered searches, collection coverage is not yet validation
    // coverage. Publish it only after the collected filings have actually been
    // checked, otherwise a deadline can look like an authoritative full scan.
    if (!shouldHydrateSignals) onCoverage?.(upstreamCoverageState.value);
  };

  const hitMap = new Map<string, { hit: EdgarSearchHit; queryPriority: number; score: number }>();
  let lastSearchError: Error | null = null;

  // For non-text-filtered searches, collect all candidates up front (original behaviour).
  // For text-filtered searches, we collect per-query-variant and validate in waves.
  if (!shouldHydrateSignals) {
    // ── Simple collection (fast pass or no text filtering needed) ──
    const collectionTarget =
      fastCandidateCollection
        ? Math.min(Math.max(displayLimit + 20, 80), 180)
        : Math.min(Math.max(displayLimit + 40, 200), 500);

    for (const [queryIndex, candidateQuery] of filteredServerQueries.entries()) {
      if (signal?.aborted) break;
      try {
        const batch = await searchEdgarFilings(
          candidateQuery,
          formTypes,
          filters.dateFrom || undefined,
          filters.dateTo || undefined,
          filters.entityName || undefined,
          fastCandidateCollection ? Math.min(perQueryResultLimit, 140) : perQueryResultLimit,
          {
            ...buildEnrichedSearchParams(filters, useEnrichedSearch && !includeExhibits, onDegraded, captureUpstreamCoverage),
            entityCik: entityCik || undefined,
            signal,
          }
        );

        const queryPriority = filteredServerQueries.length - queryIndex;
        for (const hit of batch) {
          const previous = hitMap.get(hit._id);
          if (!previous || queryPriority > previous.queryPriority || (queryPriority === previous.queryPriority && hit._score > previous.score)) {
            hitMap.set(hit._id, { hit, queryPriority, score: hit._score });
          }
        }

        if (hitMap.size >= collectionTarget) break;
        if (mode === 'boolean') await delay(fastCandidateCollection ? 60 : 180);
      } catch (error) {
        lastSearchError = error instanceof Error ? error : new Error('EDGAR search failed');
        if (mode !== 'boolean') throw lastSearchError;
      }
    }

    if (hitMap.size === 0 && lastSearchError) throw lastSearchError;

    const hits = Array.from(hitMap.values())
      .sort((a, b) => b.queryPriority !== a.queryPriority ? b.queryPriority - a.queryPriority : b.score - a.score)
      .map(entry => entry.hit)
      .slice(0, collectionTarget);
    let results = uniqueById(hits.map(mapSearchHit));

    if (needsCompanyMetadata) results = await hydrateCompanyMetadataBatch(results);
    results = results.filter(result => matchesBaseFilters(result, filters, formScope, excludeExhibits));
    results = sortResearchResults(results, preferRelevance);

    const fastResults = applyMetadataMatchFallback(results.slice(0, displayLimit));
    await enrichResultsFromFacetStore(fastResults);
    if (needsCompanyMetadata) return fastResults;
    return hydrateLightweightMetadata(fastResults);
  }

  // ── Wave-based collect + validate (text-filtered deep refinement) ──
  const signalMap = new Map<string, FilingSignal>();
  const filteredResults: FilingResearchResult[] = [];
  const waveStartTime = Date.now();
  const policy = buildWaveExecutionPolicy(delegatedToEfts, requiredBooleanBranches);
  const branchLedgers: BranchCoverageEntry[] = [];
  // Shared wave counters, boxed so the collect/validate stages can advance
  // them. unvalidatedFetchFailures counts candidates that matched upstream
  // but whose text could not be fetched for local re-validation — surfaced so
  // the exclusion is never silent. branchDocBudgetTruncated is set when a
  // required branch hit its fair-share document cap: the run is partial even
  // though later branches still got their turn.
  const run: WaveRunState = {
    pageRequests: 0,
    docAttempts: 0,
    docHttpAttempts: 0,
    prescreenRequests: 0,
    prescreenCacheHits: 0,
    validationExamined: 0,
    unvalidatedFetchFailures: 0,
    completedQueryVariants: 0,
    lastProgressCount: 0,
    budgetExhausted: false,
    validationTimedOut: false,
    branchDocBudgetTruncated: false,
    branchPageBudgetTruncated: false,
  };
  // Failure reasons behind those exclusions, so the notice can name the actual
  // cause (rate limit vs unreadable document) instead of guessing.
  const fetchFailureKinds = new Map<string, number>();

  const wavePerQueryLimit = fastCandidateCollection ? Math.min(perQueryResultLimit, 140) : perQueryResultLimit;
  const waveQueryVariants = fastCandidateCollection
    ? filteredServerQueries.slice(0, Math.max(requiredBooleanBranches, 2))
    : filteredServerQueries;

  const waveContext: WaveStageContext<FilingResearchResult, FilingSignal> = {
    state: { run, hitMap, signalMap, filteredResults, fetchFailureKinds },
    search: {
      query,
      filters,
      mode,
      formTypes,
      formScope,
      excludeExhibits,
      needsCompanyMetadata,
      needsTextFiltering,
      booleanExpression: parsedBooleanQuery.expression,
      delegatedToEfts,
      hydratePerDocumentSignals,
      useEnrichedSearch,
      includeExhibits,
      entityCik,
      preferRelevance,
      displayLimit,
      wavePerQueryLimit,
      totalServerQueries: filteredServerQueries.length,
    },
    policy,
    lifecycle: {
      waveStartTime,
      signal,
      onDegraded,
      progressCallback: onProgress,
      captureUpstreamCoverage,
    },
  };

  const waveClients: WaveExecutionClients<FilingResearchResult, FilingSignal> = {
    searchCandidates: ({
      candidateQuery,
      formTypes: candidateFormTypes,
      dateFrom,
      dateTo,
      entityName,
      resultLimit,
      filters: candidateFilters,
      useEnrichedSearch: candidateUseEnrichedSearch,
      includeExhibits: candidateIncludeExhibits,
      entityCik: candidateEntityCik,
      signal: candidateSignal,
      onDegraded: candidateOnDegraded,
      onCoverage: candidateOnCoverage,
      upstreamRequestBudget,
      onUpstreamPage,
    }) => searchEdgarFilings(
      candidateQuery,
      candidateFormTypes,
      dateFrom,
      dateTo,
      entityName,
      resultLimit,
      {
        ...buildEnrichedSearchParams(
          candidateFilters,
          candidateUseEnrichedSearch && !candidateIncludeExhibits,
          candidateOnDegraded,
          candidateOnCoverage
        ),
        entityCik: candidateEntityCik,
        upstreamRequestBudget,
        onUpstreamPage,
        signal: candidateSignal,
      }
    ),
    mapSearchHit,
    uniqueById,
    hydrateCompanyMetadataBatch,
    matchesBaseFilters,
    delay,
    prescreenBooleanCandidates,
    hydrateRegisteredAuditors,
    getSignalCacheKey,
    hydrateResultSignals,
    resolveScopedText: (filingText, sectionScope, resultFormType) => {
      const resolved = resolveSectionScope(sectionScope, resultFormType);
      return resolved ? extractResolvedSection(filingText, resolved) : '';
    },
    matchesBooleanQuery: booleanQueryMatches,
    matchesSignalFilters,
    annotateResultMatchContext,
    sortResearchResults,
  };

  for (const [queryIndex, candidateQuery] of waveQueryVariants.entries()) {
    // The display limit may NOT end retrieval until every required OR branch has
    // been attempted — otherwise a broad first branch that fills the visible
    // rows would hide a rare second disjunct (the mezzanine-OR-temporary bug).
    if (filteredResults.length >= displayLimit && queryIndex >= requiredBooleanBranches) break;
    if (Date.now() - waveStartTime > policy.maxWaveTimeMs) {
      run.validationTimedOut = true;
      break;
    }
    if (
      run.pageRequests >= policy.maxPageRequests ||
      run.docAttempts >= policy.maxDocAttempts ||
      run.docHttpAttempts >= policy.maxDocHttpAttempts
    ) {
      run.budgetExhausted = true;
      break;
    }
    if (signal?.aborted) break; // superseded by a newer run — stop issuing pages

    // Fair-share caps for THIS lane: leave each later required branch its
    // reserved documents, pages, and validation time.
    const laterRequiredBranches = Math.max(0, requiredBooleanBranches - queryIndex - 1);
    const ledger: BranchCoverageEntry = {
      branch: candidateQuery,
      required: queryIndex < requiredBooleanBranches,
      pages: 0,
      candidatesSurfaced: 0,
      candidatesNew: 0,
      examined: 0,
      matched: 0,
      exhausted: false,
    };
    branchLedgers.push(ledger);

    const collected = await collectLaneCandidates(
      waveContext,
      { candidateQuery, queryIndex, laterRequiredBranches, ledger },
      waveClients
    );
    if (collected.status === 'error') {
      lastSearchError = collected.error;
      if (mode !== 'boolean') throw lastSearchError;
      continue;
    }
    if (collected.status === 'empty') continue;

    await validateLaneCandidates(
      waveContext,
      {
        ledger,
        branchDocCap: policy.maxDocAttempts - laterRequiredBranches * policy.docReservePerBranch,
        branchTimeCapMs: policy.maxWaveTimeMs - laterRequiredBranches * policy.timeReservePerBranchMs,
        isRequiredBooleanBranch: mode === 'boolean' && queryIndex < requiredBooleanBranches,
        branchResultStart: filteredResults.length,
      },
      collected.waveCandidates,
      waveClients
    );

    if (Date.now() - waveStartTime >= policy.maxWaveTimeMs && run.validationExamined < hitMap.size) {
      run.validationTimedOut = true;
      break;
    }
    if (run.budgetExhausted) break;

    run.completedQueryVariants += 1;

    if (mode === 'boolean' && queryIndex + 1 < filteredServerQueries.length) await delay(120);
  }

  // A lane truncated at its fair-share cap means the run is partial for the
  // same reason a global cap does — the budget, not the corpus, ended it.
  if (run.branchDocBudgetTruncated || run.branchPageBudgetTruncated) run.budgetExhausted = true;

  if (filteredResults.length === 0 && lastSearchError) throw lastSearchError;

  const finalResults = rankAndLimitResults(filteredResults, {
    rollUpExhibits: mode === 'boolean' && !includeExhibits,
    preferRelevance,
    displayLimit,
  });
  await enrichResultsFromFacetStore(finalResults);

  const finalized = finalizeRunCoverage({
    upstreamCoverage: upstreamCoverageState.value,
    collectedCandidates: hitMap.size,
    validationExamined: run.validationExamined,
    validationTimedOut: run.validationTimedOut,
    budgetExhausted: run.budgetExhausted,
    aborted: Boolean(signal?.aborted),
    unvalidatedFetchFailures: run.unvalidatedFetchFailures,
    fetchFailureKinds,
    completedQueryVariants: run.completedQueryVariants,
    totalQueryVariants: waveQueryVariants.length,
    branchLedgers,
    maxPageRequests: policy.maxPageRequests,
    maxDocAttempts: policy.maxDocAttempts,
    work: {
      pageRequests: run.pageRequests,
      docFetches: run.docAttempts,
      docHttpAttempts: run.docHttpAttempts,
      prescreenRequests: run.prescreenRequests,
      prescreenCacheHits: run.prescreenCacheHits,
      maxDocHttpAttempts: policy.maxDocHttpAttempts,
      maxPrescreenRequests: policy.maxPrescreenRequests,
    },
  });
  onCoverage?.(finalized.coverage);
  if (finalized.degradedMessage) onDegraded?.(finalized.degradedMessage);

  if (needsCompanyMetadata) {
    return finalResults;
  }

  return hydrateLightweightMetadata(finalResults);
}

/**
 * Result finishing (WP7 stage: rankAndLimitResults). Pure — dedup shape,
 * order, and cap only; enrichment and metadata hydration stay I/O stages in
 * the executor.
 *
 * Roll-up collapses per-document matches to one row per filing BEFORE
 * ranking, so an accession whose match lives in several exhibits occupies a
 * single row — Boolean mode admits exhibit sub-documents as candidates
 * precisely because this step later removes the duplicate-row problem
 * without losing exhibit-only evidence.
 */
export function rankAndLimitResults(
  results: FilingResearchResult[],
  options: { rollUpExhibits: boolean; preferRelevance: boolean; displayLimit: number }
): FilingResearchResult[] {
  const rolledUp = options.rollUpExhibits ? rollUpExhibitMatches(results) : results;
  return sortResearchResults(rolledUp, options.preferRelevance).slice(0, Math.max(options.displayLimit, 0));
}



/**
 * Union of two independently verified result windows for the same query.
 *
 * A Boolean run validates every row it returns — locally against fetched text,
 * or via EDGAR's own index for a delegated phrase. When the deep-refinement
 * pass stops early (deadline, request budget) having verified FEWER rows than
 * the initial pass already put on screen, replacing the baseline discards
 * verified hits the user is looking at; observed live as 9 visible filings
 * becoming 0 when a refinement timed out. Both windows are verified subsets of
 * the same corpus for the same query, so their union is verified too.
 *
 * Refined rows lead (fresher annotations win duplicates); baseline-only rows
 * follow. One row per filing, keyed by accession — the two passes can surface
 * the same filing through different matched documents.
 *
 * Boolean mode only: a semantic initial pass may be shown before text
 * validation, and its refinement exists precisely to REMOVE rows — merging the
 * baseline back would defeat it.
 */
export function mergeVerifiedResultWindows(
  refined: FilingResearchResult[],
  baseline: FilingResearchResult[],
  limit: number
): FilingResearchResult[] {
  const keyOf = (row: FilingResearchResult) => row.accessionNumber || row.id;
  const seen = new Set(refined.map(keyOf));
  const merged = [...refined];
  for (const row of baseline) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged.slice(0, Math.max(limit, 0));
}

export async function buildSearchTrendSummary(
  results: FilingResearchResult[],
  query: string,
  filters: SearchFilters
): Promise<string> {
  const companies = new Set(results.map(result => result.entityName)).size;
  const formCounts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.formType] = (acc[result.formType] || 0) + 1;
    return acc;
  }, {});
  const auditorCounts = results.reduce<Record<string, number>>((acc, result) => {
    const label = result.auditor || 'Unknown';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const topForms = Object.entries(formCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([form, count]) => `${form}: ${count}`)
    .join(', ');
  const topAuditors = Object.entries(auditorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([auditor, count]) => `${auditor}: ${count}`)
    .join(', ');

  const filterSummary = [
    filters.sicCode ? `SIC filter ${filters.sicCode}` : '',
    filters.accountant ? `auditor ${filters.accountant}` : '',
    filters.dateFrom || filters.dateTo ? `date range ${filters.dateFrom || 'any'} to ${filters.dateTo || 'today'}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  return [
    `Query: ${query || '(blank query)'}`,
    `Matched filings: ${results.length} across ${companies} issuers.`,
    topForms ? `Form mix: ${topForms}.` : '',
    topAuditors ? `Auditor mix: ${topAuditors}.` : '',
    filterSummary ? `Applied filters: ${filterSummary}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
