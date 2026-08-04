import type { SearchFilters } from '../domain/searchFilters';
import {
  fetchCompanySubmissions,
  fetchFilingTextOutcome,
  type FilingTextOutcome,
  isEnrichedSearchEnabled,
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
  buildAuditorSearchTerms,
  canonicalizeAuditorInput,
  detectAuditorInText,
  matchesAuditorSelection,
} from './auditors';
import { loadSicDirectoryIndex } from './referenceData';
import { deriveSectionPath } from '../utils/sectionPath';
import { extractResolvedSection, resolveSectionScope } from '../utils/sectionTaxonomy';
import {
  buildReferenceSearchTerms,
  parseAccountingReference,
  referenceBooleanExpression,
  textCitesReference,
} from '../utils/accountingReference';
import { parseSearchHit } from '../hooks/useEdgarSearch';
import {
  buildBooleanCandidateQueries,
  buildCandidateQueryFromBoolean,
  booleanQueryMatches,
  extractBooleanMatchSnippet,
  compileBooleanQuery,
  eftsDelegablePhrase,
  parseBooleanQuery,
  planBooleanBranches,
  type BooleanSearchNode,
} from '../utils/booleanSearch';

export type ResearchSearchMode = 'semantic' | 'boolean';

/**
 * Why a Boolean run stopped. Only 'exhausted' is compatible with complete
 * coverage — every other value means the result set is a bounded partial.
 */
export type BooleanStopReason =
  | 'exhausted'
  | 'candidate-cap'
  | 'request-budget'
  | 'deadline'
  | 'rate-limit'
  | 'fetch-failure'
  | 'unknown-upstream'
  | 'cancelled';

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
  // Authoritative auditor of record from the PCAOB Form AP facet store (2017→).
  // When present it drives both the auditor filter and the displayed firm;
  // `auditor` (detected in the filing text) is the fallback where Form AP has no
  // coverage. Kept distinct so the filter and the label can never disagree.
  registeredAuditor?: string;
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

function normalizeFormTypes(filters: SearchFilters, defaultForms = ''): string {
  if (filters.formTypes.length > 0) {
    return filters.formTypes.join(',');
  }
  return defaultForms;
}

function parseFormScope(formScope: string): string[] {
  return formScope
    .split(',')
    .map(form => form.trim())
    .filter(Boolean);
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

function buildServerQuery(rawQuery: string, filters: SearchFilters, mode: ResearchSearchMode): string {
  const primaryQuery = rawQuery.trim();
  const combined =
    primaryQuery ||
    filters.accessionNumber.trim() ||
    filters.fileNumber.trim() ||
    filters.sectionKeywords.trim();
  if (!combined) {
    return '';
  }

  if (mode === 'boolean') {
    return buildCandidateQueryFromBoolean(combined);
  }

  return combined;
}

// Branch-aware Boolean candidate queries. Independent OR branches come FIRST and
// are counted as `requiredBranches`: the executor must attempt each one before
// the display limit can end retrieval, so a rare second OR disjunct is never
// skipped just because a broad first branch already filled the visible rows.
// Auditor-combined and recall-fallback candidates follow as best-effort fill;
// the auditor is enforced either way by the text-signal post-filter.
function buildBooleanServerQueries(
  query: string,
  filters: SearchFilters,
  delegated = false
): { queries: string[]; requiredBranches: number } {
  const { branches } = planBooleanBranches(query);
  // Delegated phrase: EDGAR's verdict IS the result, so only the exact phrase
  // may be issued. The broadening lanes below exist to hand local validation a
  // wide pool to filter — with no validation step they would put filings that
  // merely contain the words somewhere into the results as phrase matches.
  if (delegated) {
    const phrase = query.replace(/\s+/g, ' ').trim();
    return { queries: [phrase], requiredBranches: 1 };
  }
  const auditorTerms = buildAuditorSearchTerms(filters.accountant);
  const ascReference = parseAccountingReference(filters.ascReference || '');
  const referenceTerms = ascReference ? buildReferenceSearchTerms(ascReference) : [];

  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed && !out.some(item => normalizeLooseText(item) === normalizeLooseText(trimmed))) {
      out.push(trimmed);
    }
  };

  if (branches.length === 0) {
    // No positive text branches (auditor-only or citation-only search) —
    // fetch by firm name / citation spellings; validation enforces the rest.
    for (const term of auditorTerms.slice(0, 4)) push(term);
    for (const term of referenceTerms) push(term);
    return { queries: out, requiredBranches: out.length };
  }

  // Every OR branch is a required retrieval lane.
  for (const branch of branches) push(branch);
  const requiredBranches = out.length;

  // Precision boost: pair each branch with the auditor name when one is set.
  if (auditorTerms.length > 0) {
    for (const branch of branches) push(`${branch} ${auditorTerms[0]}`);
  }
  // Citation filter: candidates that pair the branch with the citation are
  // far more likely to survive validation than the branch alone.
  if (referenceTerms.length > 0) {
    for (const branch of branches) push(`${branch} ${referenceTerms[0]}`);
  }
  // Recall fallback: legacy flat candidates catch documented equivalents.
  for (const candidate of buildBooleanCandidateQueries(query)) push(candidate);

  return { queries: out, requiredBranches };
}

function buildSemanticCandidateQueries(serverQuery: string, filters: SearchFilters): string[] {
  const baseQuery = serverQuery.trim();
  const queries: string[] = [];
  const auditorTerms = buildAuditorSearchTerms(filters.accountant);
  const sectionKeywords = filters.sectionKeywords.trim();
  const ascReference = parseAccountingReference(filters.ascReference || '');
  const referenceTerms = ascReference ? buildReferenceSearchTerms(ascReference) : [];

  function pushQuery(value: string) {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    if (!queries.some(item => normalizeLooseText(item) === normalizeLooseText(trimmed))) {
      queries.push(trimmed);
    }
  }

  if (baseQuery && auditorTerms.length > 0 && sectionKeywords) {
    for (const auditorTerm of auditorTerms.slice(0, 3)) {
      pushQuery(`${baseQuery} ${auditorTerm} ${sectionKeywords}`);
    }
  }

  if (baseQuery && auditorTerms.length > 0) {
    for (const auditorTerm of auditorTerms.slice(0, 4)) {
      pushQuery(`${baseQuery} ${auditorTerm}`);
    }
  }

  if (baseQuery && sectionKeywords) {
    pushQuery(`${baseQuery} ${sectionKeywords}`);
  }

  // Citation-anchored lanes: paired with the query when there is one, or as
  // standalone lanes for a citation-only search ("every filing citing ASC
  // 842") — validation then enforces the citation on each candidate.
  if (referenceTerms.length > 0) {
    if (baseQuery) pushQuery(`${baseQuery} ${referenceTerms[0]}`);
    else for (const term of referenceTerms) pushQuery(term);
  }

  pushQuery(baseQuery);

  return queries.slice(0, 8);
}

async function getCompanySubmissionsCached(cik: string): Promise<SecSubmission | null> {
  if (!cik) return null;
  if (!companySubmissionsCache.has(cik)) {
    companySubmissionsCache.set(cik, fetchCompanySubmissions(cik));
  }
  return companySubmissionsCache.get(cik)!;
}

async function getCompanyMetadata(cik: string): Promise<CompanyResearchMetadata | null> {
  if (!cik) return null;
  if (!companyMetadataCache.has(cik)) {
    companyMetadataCache.set(
      cik,
      (async () => {
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
      })()
    );
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

function requiresCompanyMetadata(filters: SearchFilters): boolean {
  const needsCompanyFields = Boolean(
    filters.sicCode.trim() ||
    filters.fileNumber.trim() ||
    filters.stateOfInc.trim() ||
    filters.headquarters.trim() ||
    filters.exchange.length > 0 ||
    filters.fiscalYearEnd.trim()
  );

  return needsCompanyFields;
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
    // Authoritative PCAOB Form AP auditor wins; the auditor detected in the
    // filing text is only a fallback where Form AP has no coverage. This is why
    // a KPMG filter no longer surfaces a filing whose auditor of record is a
    // different firm (the ENZON 8-K / EisnerAmper case).
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
    acceleratedStatus: joinStrings(source?.accelerated_status),
  };
}

/**
 * One-call batch enrichment from the Supabase facet store: current auditor
 * (PCAOB Form AP), SIC, tickers. Replaces per-filing text-scraping for these
 * display fields — exact data, no extra EDGAR round-trips. Failure is a no-op
 * so search never depends on the facet store being reachable.
 */
export async function enrichResultsFromFacetStore(
  results: FilingResearchResult[]
): Promise<FilingResearchResult[]> {
  const ciks = Array.from(new Set(
    results.map(result => Number(result.cik)).filter(value => Number.isFinite(value) && value > 0)
  ));
  if (ciks.length === 0) return results;

  try {
    const response = await fetch(`/api/enrich?ciks=${ciks.slice(0, 200).join(',')}`);
    if (!response.ok) return results;
    const payload = await response.json() as { companies?: Record<string, {
      auditor?: string; sic?: string | null; sic_description?: string | null;
      tickers?: string[]; exchanges?: string[]; state_of_incorporation?: string | null;
    }> };
    const companies = payload.companies ?? {};
    for (const result of results) {
      const info = companies[String(Number(result.cik))];
      if (!info) continue;
      if (info.auditor) {
        result.registeredAuditor = info.auditor;
        result.auditor = info.auditor;
      }
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

// Populate ONLY the authoritative Form AP auditor (not the display fields), so
// the wave's auditor filter can decide on the auditor of record before the
// final display enrichment runs. Batched by CIK; a facet-store miss leaves
// registeredAuditor undefined and the filter falls back to text detection.
async function hydrateRegisteredAuditors(results: FilingResearchResult[]): Promise<void> {
  const ciks = Array.from(new Set(
    results
      .filter(result => result.registeredAuditor === undefined)
      .map(result => Number(result.cik))
      .filter(value => Number.isFinite(value) && value > 0)
  ));
  if (ciks.length === 0) return;

  try {
    const response = await fetch(`/api/enrich?ciks=${ciks.slice(0, 200).join(',')}`);
    if (!response.ok) return;
    const payload = await response.json() as { companies?: Record<string, { auditor?: string }> };
    const companies = payload.companies ?? {};
    for (const result of results) {
      const info = companies[String(Number(result.cik))];
      if (info?.auditor) result.registeredAuditor = info.auditor;
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
  result.auditor = filingSignal.auditor;
  result.acceleratedStatus = filingSignal.acceleratedStatus;
  return filingSignal;
}

function shouldUseEnrichedSearch(useEnrichedSearch: boolean): boolean {
  return useEnrichedSearch && isEnrichedSearchEnabled();
}

function buildEnrichedSearchParams(
  filters: SearchFilters,
  useEnrichedSearch: boolean,
  onDegraded?: (reason: string) => void,
  onCoverage?: (coverage: SearchCandidateCoverage) => void
): EnrichedSearchParams {
  const requiresClientValidation = Boolean(
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
  return {
    // The enriched endpoint is a candidate accelerator, not an authority for
    // filing-text predicates. Route those searches through EFTS and validate
    // locally instead of silently trusting unsupported query parameters.
    useEnrichedSearch: shouldUseEnrichedSearch(useEnrichedSearch) && !requiresClientValidation,
    onDegraded,
    onCoverage,
  };
}

export function canUseInstantEnrichedSearch(
  _query: string,
  filters: SearchFilters,
  mode: ResearchSearchMode,
  useEnrichedSearch = false
): boolean {
  if (!shouldUseEnrichedSearch(useEnrichedSearch)) {
    return false;
  }

  if (mode !== 'semantic') {
    return false;
  }

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
      // A bare quoted phrase is matched exactly by EDGAR full-text search, so
      // re-opening each candidate to confirm what the index already proved
      // only spends the wall-clock budget that caps recall. Any structured
      // filter still needs the document, so it keeps local validation.
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
    // An auditor-only Boolean search ("auditor:KPMG") has no text expression but
    // still needs signal hydration to confirm the firm on each candidate.
    return (
      filters.accountant.trim().length > 0 ||
      filters.acceleratedStatus.length > 0 ||
      (filters.ascReference || '').trim().length > 0 ||
      (filters.sectionScope || '').trim().length > 0
    );
  }

  if (filters.sectionKeywords.trim()) {
    return true;
  }

  if (filters.accountingFramework.trim()) {
    return true;
  }

  if ((filters.ascReference || '').trim()) {
    return true;
  }

  if ((filters.sectionScope || '').trim()) {
    return true;
  }

  if (canUseInstantEnrichedSearch(rawQuery, filters, mode, useEnrichedSearch)) {
    return false;
  }

  if (filters.accountant.trim() || filters.acceleratedStatus.length > 0) {
    return true;
  }

  return false;
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
  // Filing-text concurrency. Four keeps burst pressure on /api/sec-proxy low
  // enough to leave headroom for filing previews while still validating quickly.
  const batchSize = 4;
  const progressCallback = onProgress;
  const progressInterval = 15;
  const waveStartTime = Date.now();
  const maxWaveTimeMs = 45_000; // Stop after 45 seconds to avoid endless validation
  // Per-run request budgets that stay well under the /api/sec-proxy limit (180
  // requests / user / 5 min) so a single Boolean run can never self-inflict a
  // 429 or starve filing previews. When a budget is hit the run stops and is
  // reported partial rather than pretending the corpus was exhausted.
  // A delegated phrase opens no documents, so the only cost is EFTS paging —
  // a different host from the document proxy, and far cheaper per request.
  // Holding such a run to the document-era budget capped recall for no reason.
  const MAX_PAGE_REQUESTS = delegatedToEfts ? 240 : 60;
  const MAX_DOC_ATTEMPTS = 120;
  // True end-to-end ceilings (audit R1): the two counters above bound
  // LOGICAL work (pages fire per HTTP attempt already; documents by
  // candidate). These bound the measured HTTP attempts themselves, so
  // retries and parent-document fallbacks can never push real request
  // counts past what the run declares.
  const MAX_DOC_HTTP_ATTEMPTS = 180;
  const MAX_PRESCREEN_REQUESTS = 24;
  // Fair-share reservations (WP4). Budgets used to be first-come-first-served:
  // a broad first OR branch could spend all 120 document attempts (or the wall
  // clock) before a later required branch validated ANYTHING, so a rare
  // exclusive disjunct was collected, counted — and then silently absent from
  // results. Each still-unprocessed required branch now keeps a floor of
  // documents, pages, and time reserved out of every earlier branch's spend.
  const DOC_RESERVE_PER_BRANCH = Math.min(24, Math.floor(MAX_DOC_ATTEMPTS / Math.max(requiredBooleanBranches, 1)));
  const PAGE_RESERVE_PER_BRANCH = 2;
  const TIME_RESERVE_PER_BRANCH_MS = 6_000;
  const branchLedgers: BranchCoverageEntry[] = [];
  // Server pre-screen sizing. The chunk matches the route's own per-request cap;
  // the wave cap bounds how long verdict-gathering can delay the fetches it is
  // meant to make cheaper, and the reserve keeps 15s of every wave for them.
  const PRESCREEN_CHUNK = 40;
  const PRESCREEN_MAX_PER_WAVE = 120;
  const PRESCREEN_MIN_WAVE_RESERVE = 15_000;
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
    validationExamined: 0,
    unvalidatedFetchFailures: 0,
    completedQueryVariants: 0,
    lastProgressCount: 0,
    budgetExhausted: false,
    validationTimedOut: false,
    branchDocBudgetTruncated: false,
  };
  // Failure reasons behind those exclusions, so the notice can name the actual
  // cause (rate limit vs unreadable document) instead of guessing.
  const fetchFailureKinds = new Map<string, number>();

  const wavePerQueryLimit = fastCandidateCollection ? Math.min(perQueryResultLimit, 140) : perQueryResultLimit;
  const waveQueryVariants = fastCandidateCollection
    ? filteredServerQueries.slice(0, Math.max(requiredBooleanBranches, 2))
    : filteredServerQueries;

  const waveContext: WaveStageContext = {
    run,
    hitMap,
    signalMap,
    filteredResults,
    fetchFailureKinds,
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
    batchSize,
    progressInterval,
    waveStartTime,
    maxWaveTimeMs,
    MAX_PAGE_REQUESTS,
    MAX_DOC_ATTEMPTS,
    PAGE_RESERVE_PER_BRANCH,
    PRESCREEN_CHUNK,
    MAX_PRESCREEN_REQUESTS,
    PRESCREEN_MAX_PER_WAVE,
    PRESCREEN_MIN_WAVE_RESERVE,
    signal,
    onDegraded,
    progressCallback,
    captureUpstreamCoverage,
  };

  for (const [queryIndex, candidateQuery] of waveQueryVariants.entries()) {
    // The display limit may NOT end retrieval until every required OR branch has
    // been attempted — otherwise a broad first branch that fills the visible
    // rows would hide a rare second disjunct (the mezzanine-OR-temporary bug).
    if (filteredResults.length >= displayLimit && queryIndex >= requiredBooleanBranches) break;
    if (Date.now() - waveStartTime > maxWaveTimeMs) {
      run.validationTimedOut = true;
      break;
    }
    if (run.pageRequests >= MAX_PAGE_REQUESTS || run.docAttempts >= MAX_DOC_ATTEMPTS || run.docHttpAttempts >= MAX_DOC_HTTP_ATTEMPTS) {
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

    const collected = await collectLaneCandidates(waveContext, {
      candidateQuery,
      queryIndex,
      laterRequiredBranches,
      ledger,
    });
    if (collected.status === 'error') {
      lastSearchError = collected.error;
      if (mode !== 'boolean') throw lastSearchError;
      continue;
    }
    if (collected.status === 'empty') continue;

    await validateLaneCandidates(waveContext, {
      ledger,
      branchDocCap: MAX_DOC_ATTEMPTS - laterRequiredBranches * DOC_RESERVE_PER_BRANCH,
      branchTimeCapMs: maxWaveTimeMs - laterRequiredBranches * TIME_RESERVE_PER_BRANCH_MS,
      isRequiredBooleanBranch: mode === 'boolean' && queryIndex < requiredBooleanBranches,
      branchResultStart: filteredResults.length,
    }, collected.waveCandidates);

    if (Date.now() - waveStartTime >= maxWaveTimeMs && run.validationExamined < hitMap.size) {
      run.validationTimedOut = true;
      break;
    }
    if (run.budgetExhausted) break;

    run.completedQueryVariants += 1;

    if (mode === 'boolean' && queryIndex + 1 < filteredServerQueries.length) await delay(120);
  }

  // A lane truncated at its fair-share cap means the run is partial for the
  // same reason a global cap does — the budget, not the corpus, ended it.
  if (run.branchDocBudgetTruncated) run.budgetExhausted = true;

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
    maxPageRequests: MAX_PAGE_REQUESTS,
    maxDocAttempts: MAX_DOC_ATTEMPTS,
    work: {
      pageRequests: run.pageRequests,
      docFetches: run.docAttempts,
      docHttpAttempts: run.docHttpAttempts,
      prescreenRequests: run.prescreenRequests,
      maxDocHttpAttempts: MAX_DOC_HTTP_ATTEMPTS,
      maxPrescreenRequests: MAX_PRESCREEN_REQUESTS,
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
 * Shared mutable counters of one wave run. Boxed so the collect/validate
 * stages can advance them; everything else in the context is read-only or a
 * reference type.
 */
interface WaveRunState {
  pageRequests: number;
  docAttempts: number;
  /** Document HTTP attempts, retries and parent-doc fallbacks included. */
  docHttpAttempts: number;
  /** Server pre-screen chunk requests issued. */
  prescreenRequests: number;
  validationExamined: number;
  unvalidatedFetchFailures: number;
  completedQueryVariants: number;
  lastProgressCount: number;
  budgetExhausted: boolean;
  validationTimedOut: boolean;
  branchDocBudgetTruncated: boolean;
}

/** Everything the wave stages need, injected once per run (WP7). */
interface WaveStageContext {
  run: WaveRunState;
  hitMap: Map<string, { hit: EdgarSearchHit; queryPriority: number; score: number }>;
  signalMap: Map<string, FilingSignal>;
  filteredResults: FilingResearchResult[];
  fetchFailureKinds: Map<string, number>;
  query: string;
  filters: SearchFilters;
  mode: ResearchSearchMode;
  formTypes: string;
  formScope: ReturnType<typeof parseFormScope>;
  excludeExhibits: boolean;
  needsCompanyMetadata: boolean;
  needsTextFiltering: boolean;
  booleanExpression: BooleanSearchNode | null;
  delegatedToEfts: boolean;
  hydratePerDocumentSignals: boolean;
  useEnrichedSearch: boolean;
  includeExhibits: boolean;
  entityCik: string;
  preferRelevance: boolean;
  displayLimit: number;
  wavePerQueryLimit: number;
  totalServerQueries: number;
  batchSize: number;
  progressInterval: number;
  waveStartTime: number;
  maxWaveTimeMs: number;
  MAX_PAGE_REQUESTS: number;
  MAX_DOC_ATTEMPTS: number;
  PAGE_RESERVE_PER_BRANCH: number;
  PRESCREEN_CHUNK: number;
  MAX_PRESCREEN_REQUESTS: number;
  PRESCREEN_MAX_PER_WAVE: number;
  PRESCREEN_MIN_WAVE_RESERVE: number;
  signal?: AbortSignal;
  onDegraded?: (message: string) => void;
  progressCallback?: (results: FilingResearchResult[]) => void;
  captureUpstreamCoverage: (coverage: SearchCandidateCoverage) => void;
}

interface WaveLane {
  candidateQuery: string;
  queryIndex: number;
  laterRequiredBranches: number;
  ledger: BranchCoverageEntry;
}

/**
 * Candidate collection for one retrieval lane (WP7 stage: collectCandidates).
 * Pages EDGAR within the lane's fair-share reserve, dedups against the run's
 * hit map while recording branch attribution FIRST, hydrates metadata, and
 * applies the deterministic base filters. Returns 'error' for the
 * orchestrator to record (non-boolean callers rethrow there), 'empty' when
 * the lane surfaced nothing new, else the wave candidates for validation.
 */
async function collectLaneCandidates(
  context: WaveStageContext,
  lane: WaveLane
): Promise<
  | { status: 'error'; error: Error }
  | { status: 'empty' }
  | { status: 'ok'; waveCandidates: FilingResearchResult[] }
> {
  const {
    run, hitMap, filters, mode, formTypes, formScope, excludeExhibits, needsCompanyMetadata,
    useEnrichedSearch, includeExhibits, entityCik, wavePerQueryLimit, totalServerQueries,
    MAX_PAGE_REQUESTS, PAGE_RESERVE_PER_BRANCH, signal, onDegraded, captureUpstreamCoverage,
  } = context;
  const { candidateQuery, queryIndex, laterRequiredBranches, ledger } = lane;

  let queryBatchHits: EdgarSearchHit[];
  try {
    // The page budget counts ACTUAL upstream HTTP pages via onUpstreamPage —
    // one searchEdgarFilings call may issue many EFTS pages (page size is
    // ~10 hits), so counting calls understated real request volume by up to
    // 50x (readiness finding F-07). The result cap is also clamped to the
    // remaining page budget so a single call cannot blow through it.
    // A lane may not page later required branches out of their reserve —
    // but a required lane always keeps at least its own reserve.
    let remainingPages = Math.max(0, MAX_PAGE_REQUESTS - run.pageRequests - laterRequiredBranches * PAGE_RESERVE_PER_BRANCH);
    if (ledger.required) {
      remainingPages = Math.max(remainingPages, Math.min(PAGE_RESERVE_PER_BRANCH, MAX_PAGE_REQUESTS - run.pageRequests));
    }
    queryBatchHits = await searchEdgarFilings(
      candidateQuery,
      formTypes,
      filters.dateFrom || undefined,
      filters.dateTo || undefined,
      filters.entityName || undefined,
      Math.min(wavePerQueryLimit, remainingPages * 10),
      {
        ...buildEnrichedSearchParams(filters, useEnrichedSearch && !includeExhibits, onDegraded, (coverage: SearchCandidateCoverage) => {
          ledger.collectionComplete = coverage.complete;
          captureUpstreamCoverage(coverage);
        }),
        entityCik: entityCik || undefined,
        onUpstreamPage: () => { run.pageRequests += 1; ledger.pages += 1; },
        signal,
      }
    );
  } catch (error) {
    ledger.incompleteReason = 'error';
    return { status: 'error', error: error instanceof Error ? error : new Error('EDGAR search failed') };
  }

  // Deduplicate against previously seen hits — but record what this lane
  // surfaced FIRST, so branch attribution survives the dedup (a hit shared
  // with an earlier lane still counts as surfaced by this one).
  ledger.candidatesSurfaced = queryBatchHits.length;
  const newHits: EdgarSearchHit[] = [];
  for (const hit of queryBatchHits) {
    if (!hitMap.has(hit._id)) {
      hitMap.set(hit._id, { hit, queryPriority: totalServerQueries - queryIndex, score: hit._score });
      newHits.push(hit);
    }
  }
  ledger.candidatesNew = newHits.length;

  if (newHits.length === 0) {
    run.completedQueryVariants += 1;
    ledger.exhausted = ledger.collectionComplete !== false;
    if (mode === 'boolean') await delay(120);
    return { status: 'empty' };
  }

  // Map, hydrate metadata, and filter this wave of candidates
  let waveCandidates = uniqueById(newHits.map(mapSearchHit));
  if (needsCompanyMetadata) waveCandidates = await hydrateCompanyMetadataBatch(waveCandidates);
  waveCandidates = waveCandidates.filter(result => matchesBaseFilters(result, filters, formScope, excludeExhibits));
  // Candidates rejected by deterministic metadata filters have still been
  // examined for this validation pass.
  run.validationExamined += Math.max(0, newHits.length - waveCandidates.length);
  ledger.examined += Math.max(0, newHits.length - waveCandidates.length);

  return { status: 'ok', waveCandidates };
}

/**
 * Validation for one lane's collected candidates (WP7 stage:
 * validateDocuments). Server pre-screen, per-chunk text hydration, section
 * scoping, Boolean and signal filtering, result annotation, progress
 * publication, and the lane's ledger finalization — bounded by the lane's
 * fair-share document and time caps.
 */
async function validateLaneCandidates(
  context: WaveStageContext,
  lane: {
    ledger: BranchCoverageEntry;
    branchDocCap: number;
    branchTimeCapMs: number;
    isRequiredBooleanBranch: boolean;
    branchResultStart: number;
  },
  waveCandidatesInput: FilingResearchResult[]
): Promise<void> {
  const {
    run, signalMap, filteredResults, fetchFailureKinds, query, filters, mode, needsTextFiltering,
    booleanExpression, delegatedToEfts, hydratePerDocumentSignals, preferRelevance, displayLimit,
    batchSize, progressInterval, waveStartTime, maxWaveTimeMs, MAX_DOC_ATTEMPTS,
    PRESCREEN_CHUNK, PRESCREEN_MAX_PER_WAVE, PRESCREEN_MIN_WAVE_RESERVE, MAX_PRESCREEN_REQUESTS, signal, progressCallback,
  } = context;
  const { ledger, branchDocCap, branchTimeCapMs, isRequiredBooleanBranch, branchResultStart } = lane;
  let waveCandidates = waveCandidatesInput;

  // ── Server-side pre-screen ──
  // Ask the API which candidates satisfy the expression before the browser
  // spends a document download on each one. The server runs the SAME matcher
  // over the SAME cached text, so a validated non-match is exactly the verdict
  // the loop below would have reached — it just costs no bytes to reach it.
  //
  // This is why it raises recall rather than merely saving bandwidth: rejects
  // never touch run.docAttempts, so the 120-document budget stops being spent on
  // filings that were only ever going to be discarded.
  //
  // Two invariants keep it a strict optimisation: an unvalidated verdict is
  // NOT a non-match and falls through to the local path unchanged, and any
  // failure — offline, 4xx, slow — skips the pre-screen entirely.
  // The server pre-screen evaluates the expression over the WHOLE document.
  // Under an Item scope that verdict is not transferable: a NOT operand can
  // fail on the full text yet hold inside the section, so a full-text
  // non-match must not reject a section-scoped candidate.
  if (mode === 'boolean' && needsTextFiltering && booleanExpression && waveCandidates.length > 0 && !(filters.sectionScope || '').trim()) {
    const prescreenKey = (cik: string, accession: string, document: string) =>
      `${cik}:${accession.replace(/-/g, '')}:${document}`;
    const rejectedByServer = new Set<string>();

    for (
      let cursor = 0;
      cursor < Math.min(waveCandidates.length, PRESCREEN_MAX_PER_WAVE) && !signal?.aborted;
      cursor += PRESCREEN_CHUNK
    ) {
      // Never spend the wave budget the pre-screen exists to protect: stop
      // once the remaining time is worth more as fetches than as verdicts.
      const remainingWaveMs = maxWaveTimeMs - (Date.now() - waveStartTime);
      if (remainingWaveMs < PRESCREEN_MIN_WAVE_RESERVE) break;

      // Pre-screen requests are measured work like any other upstream call
      // (audit R1); the cap soft-stops the optimizer, never the run.
      if (run.prescreenRequests >= MAX_PRESCREEN_REQUESTS) break;
      run.prescreenRequests += 1;
      const verdicts = await prescreenBooleanCandidates(
        query,
        waveCandidates.slice(cursor, cursor + PRESCREEN_CHUNK).map(result => ({
          cik: result.cik,
          accession: result.accessionNumber.replace(/-/g, ''),
          document: result.primaryDocument,
        })),
        { signal, timeoutMs: Math.min(20_000, remainingWaveMs - PRESCREEN_MIN_WAVE_RESERVE + 5_000) }
      );
      // No verdicts means the pre-screen is unavailable; behave as if it never existed.
      if (!verdicts) break;

      for (const verdict of verdicts) {
        if (verdict.validated && !verdict.matched) {
          rejectedByServer.add(prescreenKey(verdict.cik, verdict.accession, verdict.document));
        }
      }
    }

    if (rejectedByServer.size > 0) {
      const beforePrescreen = waveCandidates.length;
      waveCandidates = waveCandidates.filter(
        result => !rejectedByServer.has(prescreenKey(result.cik, result.accessionNumber, result.primaryDocument))
      );
      // Server-rejected candidates were genuinely examined — coverage counts
      // them, the document budget does not.
      run.validationExamined += beforePrescreen - waveCandidates.length;
      ledger.examined += beforePrescreen - waveCandidates.length;
    }
  }

  // Validate each candidate in this wave (fetch text, check auditor/boolean/section).
  // A required OR branch keeps its validation allowance even after earlier
  // branches filled the visible rows — otherwise a saturated broad branch
  // records the rare branch as "requested" while none of its exclusive
  // candidates can ever enter the result set (readiness finding F-06). The
  // doc-attempt and wall-clock budgets still bound the extra work.
  for (
    let index = 0;
    index < waveCandidates.length &&
    (filteredResults.length < displayLimit || isRequiredBooleanBranch) &&
    Date.now() - waveStartTime < branchTimeCapMs;
    index += batchSize
  ) {
    // Stop at this lane's fair-share cap, not only the global cap: the
    // difference is reserved for later required branches. Hitting the
    // fair-share cap ends THIS lane but lets the loop continue.
    if (run.docAttempts >= branchDocCap) {
      if (branchDocCap >= MAX_DOC_ATTEMPTS) run.budgetExhausted = true;
      else run.branchDocBudgetTruncated = true;
      ledger.incompleteReason = 'doc-budget';
      break;
    }
    if (signal?.aborted) break;
    const chunk = waveCandidates.slice(index, Math.min(index + batchSize, waveCandidates.length));

    // Only open documents when something actually reads them. A delegated
    // phrase is already proved by EDGAR's index over the whole filing, so
    // fetching each one confirms nothing and spends the budget that caps
    // recall — this loop used to hydrate whenever the CALLER asked for
    // signals, which every Boolean run does (that was the 110-filing recall
    // ceiling).
    if (hydratePerDocumentSignals) {
      await Promise.all(
        chunk.map(async result => {
          const signalData = await hydrateResultSignals(result, signal, attempts => {
            run.docHttpAttempts += attempts;
          });
          signalMap.set(getSignalCacheKey(result), signalData);
        })
      );
      run.docAttempts += chunk.length;
    }
    // Resolve the authoritative auditor of record before the auditor filter
    // runs, so the firm the filter matches on is the one that gets displayed.
    if (filters.accountant.trim()) await hydrateRegisteredAuditors(chunk);
    run.validationExamined += chunk.length;
    ledger.examined += chunk.length;

    for (const result of chunk) {
      const filingText = signalMap.get(getSignalCacheKey(result))?.text || '';
      // "Item 1A contains X" / "risk factors contains X": the expression
      // and section keywords are evaluated INSIDE the named section's
      // slice. Concept names resolve through the cross-form taxonomy using
      // THIS candidate's form — Risk Factors is Item 1A on a 10-K but
      // Part II Item 1A on a 10-Q. A filing without the section (or a form
      // the concept is not mapped for) yields an empty slice and never
      // matches — scoping must never silently widen back to the whole
      // document or slice at a guessed location.
      const sectionScope = (filters.sectionScope || '').trim();
      let scopedText = filingText;
      if (sectionScope && filingText) {
        const resolved = resolveSectionScope(sectionScope, result.formType);
        scopedText = resolved ? extractResolvedSection(filingText, resolved) : '';
      }

      if (needsTextFiltering && mode === 'boolean' && booleanExpression) {
        if (!filingText) {
          // Distinguish "couldn't fetch the text" from "fetched, didn't match"
          // so the former can be reported rather than silently dropped.
          run.unvalidatedFetchFailures += 1;
          const kind = signalMap.get(getSignalCacheKey(result))?.failure;
          if (kind) fetchFailureKinds.set(kind, (fetchFailureKinds.get(kind) ?? 0) + 1);
          continue;
        }
        if (!scopedText || !booleanQueryMatches(query, scopedText)) continue;
      }

      if (needsTextFiltering && !matchesSignalFilters(result, filters, filingText, scopedText)) continue;

      // With a delegated phrase there is no fetched text to snippet from —
      // the match was proved upstream, and the label must say so. A scoped
      // match snippets from the section slice, so the excerpt (and its
      // breadcrumb) come from where the match actually was allowed to live.
      filteredResults.push(
        annotateResultMatchContext(result, query, filters, mode, scopedText, delegatedToEfts)
      );
    }

    if (progressCallback && filteredResults.length >= run.lastProgressCount + progressInterval) {
      run.lastProgressCount = filteredResults.length;
      progressCallback(sortResearchResults([...filteredResults], preferRelevance).slice(0, displayLimit));
    }

    // Pacing exists to protect /api/sec-proxy from fetch bursts. A wave that
    // opened no documents has nothing to pace — sleeping 150ms per 4
    // candidates would add ~19s of idle time to a 500-candidate delegated run.
    if (hydratePerDocumentSignals && index + batchSize < waveCandidates.length && filteredResults.length < displayLimit) {
      await delay(150);
    }
  }

  // Finalize this lane's ledger before moving on.
  ledger.matched = filteredResults.length - branchResultStart;
  if (!ledger.incompleteReason) {
    if (signal?.aborted) {
      ledger.incompleteReason = 'cancelled';
    } else if (ledger.examined < ledger.candidatesNew) {
      ledger.incompleteReason = Date.now() - waveStartTime >= branchTimeCapMs ? 'deadline' : 'display-limit';
    }
  }
  ledger.exhausted = !ledger.incompleteReason && ledger.examined >= ledger.candidatesNew && ledger.collectionComplete !== false;
}

/** Everything the executor needs that is derivable from the request alone. */
export interface SearchExecutionPlan {
  /** Residual query after an auditor: token is lifted into the filters. */
  query: string;
  /** Filters with any lifted auditor canonicalized in. */
  filters: SearchFilters;
  serverQuery: string;
  formTypes: string;
  formScope: ReturnType<typeof parseFormScope>;
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

/**
 * Plan compiler (WP7 stage: compileSearchPlan). Pure — no network, no state.
 * Returns null when a Boolean expression is invalid: the run must issue zero
 * retrieval requests, and the views surface the message via the same compiler.
 *
 * The judgment calls in here are load-bearing and documented inline: exhibit
 * admission is Boolean-only (roll-up removes the duplicate-row problem
 * without losing exhibit-only evidence); delegation flags must never be
 * proxied off needsTextFiltering (any flag used as a proxy for "reads
 * documents" inverts under delegation — that was the 110-filing recall
 * ceiling); and paging depth keys off what can actually be shown.
 */
export function compileSearchPlan(options: {
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
}): SearchExecutionPlan | null {
  let { query, filters } = options;
  const { mode, defaultForms, limit, includeExhibits, deferTextValidation, preferFastCandidateCollection, hydrateTextSignals, useEnrichedSearch } = options;

  // Intelligize-style inline audit-firm field: "material weakness" AND
  // auditor:Deloitte (or a bare auditor:KPMG). Lift the firm out of the Boolean
  // query into the structured auditor filter — the existing signal post-filter
  // then enforces it — and search only the residual expression as text.
  if (mode === 'boolean') {
    // One compile path shared with the views, saved-alert checks and the
    // Accounting Hub. Compiling here is what stops an invalid expression from
    // reaching EDGAR as a literal string (how "revenue AND" silently ran a wrong
    // search from non-view callers) — the views surface the message, this
    // hard-stops with zero network calls. It also catches the cases a bare parse
    // misses: grouped proximity, negation-only, and over-complex OR fan-out.
    const compiled = compileBooleanQuery(query || filters.keyword);
    if (!compiled.ok) return null;

    if (compiled.auditor) {
      const canonical = canonicalizeAuditorInput(compiled.auditor) || compiled.auditor;
      filters = { ...filters, accountant: filters.accountant.trim() || canonical };
      query = compiled.residual;
    }
  }

  const serverQuery = buildServerQuery(query || filters.keyword, filters, mode);
  const formTypes = normalizeFormTypes(filters, defaultForms);
  const formScope = parseFormScope(formTypes);
  // Exhibit sub-documents are excluded unless the caller opts in (Exhibit
  // Search does): EFTS returns each matching document of a filing as its own
  // hit, so one 8-K/A could surface five EX-99.x rows that read as duplicates
  // and crowd out distinct filings in the main research results.
  //
  // Boolean mode is the exception: a disclosure that lives only in EX-99.1 was
  // being discarded before it could be validated, hiding a real match entirely.
  // There we admit exhibits as candidates and instead roll successful matches up
  // to one row per accession (see rollUpExhibitMatches), which removes the
  // duplicate-row problem without losing the exhibit-only evidence.
  const excludeExhibits = !includeExhibits && mode !== 'boolean';
  const preferRelevance = Boolean((query || filters.keyword).trim() || filters.sectionKeywords.trim());
  const semanticAuditorSearch = mode === 'semantic' && Boolean(filters.accountant.trim());
  const needsCompanyMetadata = requiresCompanyMetadata(filters);
  const requestedLimit = Math.max(limit, 1);
  const fastPass = deferTextValidation && mode !== 'boolean';
  const fastCandidateCollection = deferTextValidation || preferFastCandidateCollection;
  const displayLimit = Math.min(requestedLimit, 500);
  const needsTextFiltering = requiresTextFiltering(filters, query, mode, useEnrichedSearch);
  const shouldHydrateSignals = !fastPass && (hydrateTextSignals || needsTextFiltering);

  const parsedBooleanQuery = mode === 'boolean' ? parseBooleanQuery(query) : { expression: null };
  // True when EDGAR's index already proved the phrase and we deliberately skip
  // re-opening documents (see requiresTextFiltering).
  const delegatedToEfts =
    mode === 'boolean' && !needsTextFiltering && Boolean(eftsDelegablePhrase(parsedBooleanQuery.expression));
  // Whether the wave loop opens each candidate document. A delegated phrase is
  // already proved by EDGAR's index and nothing downstream reads the text, but
  // callers still pass hydrateTextSignals=true for every Boolean run — left
  // ungated, those no-op fetches spend the 120-document budget and cap recall
  // at ~120 candidates regardless of collection depth (measured: 498 collected,
  // 120 examined, 110 shown). Same trap as keying depth off needsTextFiltering:
  // any flag used as a proxy for "reads documents" inverts under delegation.
  const hydratePerDocumentSignals = shouldHydrateSignals && !delegatedToEfts;

  const booleanPlan = mode === 'boolean'
    ? buildBooleanServerQueries(query || filters.keyword, filters, delegatedToEfts)
    : { queries: [] as string[], requiredBranches: 0 };
  // Keep every required OR branch plus a few recall extras (bounded by the
  // 16-branch complexity cap).
  const booleanServerQueries = booleanPlan.queries.slice(0, Math.max(booleanPlan.requiredBranches, 6));
  const requiredBooleanBranches = Math.min(booleanPlan.requiredBranches, booleanServerQueries.length);
  const semanticServerQueries = mode === 'semantic' ? buildSemanticCandidateQueries(serverQuery, filters) : [];

  const serverQueries =
    mode === 'boolean'
      ? (booleanServerQueries.length > 0 ? booleanServerQueries : [serverQuery])
      : (semanticServerQueries.length > 0 ? semanticServerQueries : [serverQuery]);

  const candidateServerQueries = (
    fastCandidateCollection
      ? serverQueries.slice(0, mode === 'boolean' ? Math.max(requiredBooleanBranches, 3) : semanticAuditorSearch ? 2 : 3)
      : serverQueries
  ).filter(Boolean);
  // Empty-query browse is intentional for form/date/SIC and other filter-only
  // requests. Both EFTS and the enriched metadata route support that contract.
  const filteredServerQueries = candidateServerQueries.length > 0 ? candidateServerQueries : [''];

  // An issuer-scoped browse intentionally has NO text query ("OGN 10-K" →
  // entity + cleared text). filter(Boolean) used to drop that empty query,
  // so the fetch loop below never ran — instant zero results with no
  // request. Keep one empty candidate: the enriched lane treats q='' as a
  // facet browse and the legacy lane substitutes the quoted issuer name.
  if (filteredServerQueries.length === 0 && filters.entityName.trim()) {
    filteredServerQueries.push('');
  }

  // How deep to page per query variant.
  //
  // This used to key off needsTextFiltering as a proxy for "collect widely",
  // which inverted the moment a phrase could be delegated: with no local
  // validation the flag flips false and the depth silently dropped 500 -> 300,
  // even though a delegated run needs MORE depth, not less — every upstream
  // hit is a finished result rather than a candidate to be filtered.
  const perQueryResultLimit =
    fastCandidateCollection
      ? Math.min(Math.max(displayLimit, 80), 140)
      : delegatedToEfts || needsTextFiltering
        ? Math.max(displayLimit, 500)
        : Math.min(Math.max(displayLimit, 140), 300);
  // Depth is bounded by what can be shown: display caps at 500, and for a
  // delegated run every upstream hit is a finished row. (An earlier "2,000
  // candidates produced the same rows as 500" measurement was an artifact of
  // the document budget capping validation at 120 — see hydratePerDocumentSignals.)

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

/** Inputs the coverage finalizer needs from a finished validation run. */
export interface RunCoverageInputs {
  upstreamCoverage: SearchCandidateCoverage | null;
  /** Deduplicated candidates collected across every lane (hitMap size). */
  collectedCandidates: number;
  validationExamined: number;
  validationTimedOut: boolean;
  budgetExhausted: boolean;
  aborted: boolean;
  unvalidatedFetchFailures: number;
  fetchFailureKinds: ReadonlyMap<string, number>;
  completedQueryVariants: number;
  totalQueryVariants: number;
  branchLedgers: readonly BranchCoverageEntry[];
  maxPageRequests: number;
  maxDocAttempts: number;
  /** Measured upstream work, retries and pre-screens included (audit R1). */
  work: {
    pageRequests: number;
    docFetches: number;
    docHttpAttempts: number;
    prescreenRequests: number;
    maxDocHttpAttempts: number;
    maxPrescreenRequests: number;
  };
}

/**
 * Coverage finalizer — the single place a run's honesty claims are computed
 * (WP7 stage: buildCoverageLedger). Pure: same inputs, same verdict, no I/O.
 *
 * Unknown upstream coverage is PARTIAL, never assumed complete — both
 * retrieval lanes report coverage on success, so absence means something went
 * wrong or was skipped (readiness finding F-07). Fetch failures and
 * cancellation also forfeit completeness: an unvalidated candidate is not a
 * validated nonmatch. And aggregate counters cannot prove PER-BRANCH
 * exhaustion — a run can examine "everything it collected" while a required
 * branch was never fully collected — so completeness additionally requires
 * every required lane's own ledger to say exhausted.
 *
 * `exhausted` is the only stop reason that can accompany complete coverage;
 * every other value means partial, and the partial reasons that a user can
 * act on carry a degraded message.
 */
export function finalizeRunCoverage(inputs: RunCoverageInputs): {
  coverage: SearchCandidateCoverage;
  stopReason: BooleanStopReason;
  degradedMessage: string | null;
} {
  const {
    upstreamCoverage,
    collectedCandidates,
    validationExamined,
    validationTimedOut,
    budgetExhausted,
    aborted,
    unvalidatedFetchFailures,
    fetchFailureKinds,
    completedQueryVariants,
    totalQueryVariants,
    branchLedgers,
    maxPageRequests,
    maxDocAttempts,
  } = inputs;

  const upstreamTotal = Math.max(
    upstreamCoverage?.upstreamTotal ?? 0,
    upstreamCoverage?.examined ?? 0,
    collectedCandidates
  );
  const collectionComplete = upstreamCoverage?.complete ?? false;
  const validationComplete = (
    !validationTimedOut &&
    !budgetExhausted &&
    !aborted &&
    unvalidatedFetchFailures === 0 &&
    completedQueryVariants === totalQueryVariants &&
    collectionComplete &&
    validationExamined >= collectedCandidates &&
    branchLedgers.filter(entry => entry.required).every(entry => entry.exhausted)
  );

  const stopReason: BooleanStopReason =
    aborted ? 'cancelled'
    : validationTimedOut ? 'deadline'
    : budgetExhausted ? 'request-budget'
    : fetchFailureKinds.has('rate-limit') ? 'rate-limit'
    : unvalidatedFetchFailures > 0 ? 'fetch-failure'
    : !collectionComplete ? 'unknown-upstream'
    : validationComplete ? 'exhausted'
    : 'candidate-cap';

  const { work } = inputs;
  const totalUpstreamRequests = work.pageRequests + work.docHttpAttempts + work.prescreenRequests;

  let degradedMessage: string | null = null;
  if (stopReason === 'deadline') {
    degradedMessage = 'Filing-text validation reached its time limit; only a partial candidate window was verified.';
  } else if (stopReason === 'request-budget') {
    // The measured numbers ARE the display (audit R1): retries, parent-doc
    // fallbacks and server pre-screens included, beside the declared caps.
    degradedMessage = `This search reached its per-run request budget: ${work.pageRequests}/${maxPageRequests} page requests, ${work.docHttpAttempts}/${work.maxDocHttpAttempts} document requests (retries included; ${work.docFetches}/${maxDocAttempts} documents), ${work.prescreenRequests}/${work.maxPrescreenRequests} pre-screen requests — ${totalUpstreamRequests} upstream requests in all. Results are a verified partial window, not the full corpus. Narrow the query, dates, or forms to validate more.`;
  } else if (stopReason === 'rate-limit') {
    degradedMessage = `SEC EDGAR rate-limited ${fetchFailureKinds.get('rate-limit')} document ${fetchFailureKinds.get('rate-limit') === 1 ? 'request' : 'requests'}; those filings could not be re-validated and are excluded. Retry shortly for a fuller window.`;
  } else if (stopReason === 'fetch-failure') {
    const unreadable = (fetchFailureKinds.get('unsupported') ?? 0) + (fetchFailureKinds.get('not-found') ?? 0);
    degradedMessage =
      `${unvalidatedFetchFailures} matching candidate ${unvalidatedFetchFailures === 1 ? 'filing was' : 'filings were'} excluded because the document text could not be retrieved for Boolean re-validation` +
      (unreadable > 0 ? ' (non-HTML primary document such as a scanned PDF or image).' : ' (upstream fetch failure).');
  }

  return {
    coverage: {
      examined: Math.min(validationExamined, upstreamTotal),
      upstreamTotal,
      complete: validationComplete,
      upstreamTotalIsFloor: Boolean(upstreamCoverage?.upstreamTotalIsFloor),
      branches: branchLedgers.length > 0 ? [...branchLedgers] : undefined,
      work: {
        pageRequests: work.pageRequests,
        docFetches: work.docFetches,
        docHttpAttempts: work.docHttpAttempts,
        prescreenRequests: work.prescreenRequests,
        totalUpstreamRequests,
        ceiling: {
          pages: maxPageRequests,
          docHttpAttempts: work.maxDocHttpAttempts,
          prescreenRequests: work.maxPrescreenRequests,
        },
      },
    },
    stopReason,
    degradedMessage,
  };
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
