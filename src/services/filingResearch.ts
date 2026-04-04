import type { SearchFilters } from '../components/filters/SearchFilterBar';
import {
  fetchCompanySubmissions,
  fetchFilingText,
  isElasticsearchEnabled,
  searchEdgarFilings,
  type EdgarSearchHit,
  type ElasticSearchExtendedParams,
  type SecSubmission,
} from './secApi';
import {
  buildAuditorSearchTerms,
  canonicalizeAuditorInput,
  detectAuditorInText,
  matchesAuditorSelection,
} from './auditors';
import { loadSicDirectoryIndex } from './referenceData';
import { parseSearchHit } from '../hooks/useEdgarSearch';
import {
  buildBooleanCandidateQueries,
  buildCandidateQueryFromBoolean,
  booleanQueryMatches,
  extractBooleanMatchSnippet,
  parseBooleanQuery,
} from '../utils/booleanSearch';

export type ResearchSearchMode = 'semantic' | 'boolean';

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
  acceleratedStatus: string;
}

interface FilingSignal {
  text: string;
  auditor: string;
  acceleratedStatus: string;
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
  useElasticsearch?: boolean;
  hydrateTextSignals?: boolean;
  deferTextValidation?: boolean;
  preferFastCandidateCollection?: boolean;
  onProgress?: (results: FilingResearchResult[]) => void;
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
  filingText: string
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

  result.matchSnippet = matchSnippet;
  result.matchReason =
    proximityDistance != null
      ? proximityDistance === 0
        ? 'Matched adjacent proximity terms'
        : `Matched within ${proximityDistance} words`
      : matchSnippet
        ? 'Matched filing text'
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

function buildSemanticCandidateQueries(serverQuery: string, filters: SearchFilters): string[] {
  const baseQuery = serverQuery.trim();
  const queries: string[] = [];
  const auditorTerms = buildAuditorSearchTerms(filters.accountant);
  const sectionKeywords = filters.sectionKeywords.trim();

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
  filingPrimaryDocument: string
): Promise<FilingSignal> {
  const cacheKey = `${cik}:${accessionNumber}:${primaryDocument}:${filingPrimaryDocument}`;
  if (!filingSignalCache.has(cacheKey)) {
    filingSignalCache.set(
      cacheKey,
      (async () => {
        try {
          const text = await fetchFilingText(cik, accessionNumber, primaryDocument);
          let parentText = '';
          let auditor = canonicalizeAuditorInput(detectAuditor(text));
          let acceleratedStatus = detectAcceleratedStatus(text);

          if (filingPrimaryDocument && filingPrimaryDocument !== primaryDocument) {
            try {
              parentText = await fetchFilingText(cik, accessionNumber, filingPrimaryDocument);
            } catch {
              // Parent document fetch failed — continue with what we have.
            }

            if (!auditor) {
              auditor = canonicalizeAuditorInput(detectAuditor(parentText));
            }

            if (!acceleratedStatus) {
              acceleratedStatus = detectAcceleratedStatus(parentText);
            }
          }

          return {
            text: text || parentText,
            auditor,
            acceleratedStatus,
          };
        } catch {
          // Filing text fetch failed (rate limit, network error, etc.)
          // Remove from cache so a future attempt can retry.
          filingSignalCache.delete(cacheKey);
          return { text: '', auditor: '', acceleratedStatus: '' };
        }
      })()
    );
  }

  return filingSignalCache.get(cacheKey)!;
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

function matchesFormScope(result: FilingResearchResult, formScope: string[]): boolean {
  if (formScope.length === 0) {
    return true;
  }

  const normalizedResultForm = normalizeFormValue(result.formType);
  const normalizedResultBaseForm = normalizeBaseForm(result.formType);

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

function sortResearchResults(results: FilingResearchResult[], _preferRelevance: boolean): FilingResearchResult[] {
  return results.sort((a, b) => {
    const byDate = b.fileDate.localeCompare(a.fileDate);
    if (byDate !== 0) return byDate;
    return (b.relevanceScore ?? b.score) - (a.relevanceScore ?? a.score);
  });
}

function matchesFilerKeys(selected: string[], result: FilingResearchResult): boolean {
  if (selected.length === 0) return true;
  const signal = normalize(result.acceleratedStatus);
  const sicDescription = normalize(result.sicDescription);
  const description = normalize(result.description);
  const formType = normalize(result.formType);

  return selected.every(key => {
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
        return true;
    }
  });
}

function matchesBaseFilters(result: FilingResearchResult, filters: SearchFilters, formScope: string[]): boolean {
  if (!matchesEntityFilter(result, filters.entityName)) {
    return false;
  }

  if (!matchesDateRange(result, filters.dateFrom.trim(), filters.dateTo.trim())) {
    return false;
  }

  if (!matchesFormScope(result, formScope)) {
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
    filters.entityName.trim() ||
    filters.fileNumber.trim() ||
    filters.sicCode.trim() ||
    filters.stateOfInc.trim() ||
    filters.headquarters.trim() ||
    filters.exchange.length > 0 ||
    filters.fiscalYearEnd.trim()
  );

  if (!needsCompanyFields) {
    return false;
  }

  return !isElasticsearchEnabled();
}

function matchesSignalFilters(result: FilingResearchResult, filters: SearchFilters, filingText: string): boolean {
  if (filters.sectionKeywords.trim() && !matchesSectionKeywords(filingText, filters.sectionKeywords)) {
    return false;
  }

  if (filters.accountant.trim()) {
    if (!matchesAuditorSelection(result.auditor, filters.accountant)) {
      return false;
    }
  }

  if (!matchesFilerKeys(filters.acceleratedStatus, result)) {
    return false;
  }

  return true;
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
    sic: firstString(source?.sics),
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

async function hydrateResultSignals(result: FilingResearchResult): Promise<FilingSignal> {
  const signal = await getFilingSignal(
    result.cik,
    result.accessionNumber,
    result.primaryDocument,
    result.filingPrimaryDocument
  );
  result.auditor = signal.auditor;
  result.acceleratedStatus = signal.acceleratedStatus;
  return signal;
}

function shouldUseElasticsearch(useElasticsearch: boolean): boolean {
  return useElasticsearch && isElasticsearchEnabled();
}

function buildExtendedSearchParams(
  filters: SearchFilters,
  mode: ResearchSearchMode,
  useElasticsearch: boolean
): ElasticSearchExtendedParams {
  return {
    auditor: canonicalizeAuditorInput(filters.accountant.trim()) || undefined,
    acceleratedStatus: filters.acceleratedStatus.length > 0 ? filters.acceleratedStatus.join(',') : undefined,
    sicCode: filters.sicCode.trim() ? filters.sicCode.trim().match(/\d{3,4}/)?.[0] : undefined,
    mode,
    useElasticsearch: shouldUseElasticsearch(useElasticsearch),
  };
}

export function canUseInstantElasticsearchSearch(
  _query: string,
  filters: SearchFilters,
  mode: ResearchSearchMode,
  useElasticsearch = false
): boolean {
  if (!shouldUseElasticsearch(useElasticsearch)) {
    return false;
  }

  if (filters.sectionKeywords.trim()) {
    return false;
  }

  return mode === 'semantic' || mode === 'boolean';
}

function requiresTextFiltering(
  filters: SearchFilters,
  rawQuery: string,
  mode: ResearchSearchMode,
  useElasticsearch: boolean
): boolean {
  if (filters.sectionKeywords.trim()) {
    return true;
  }

  if (canUseInstantElasticsearchSearch(rawQuery, filters, mode, useElasticsearch)) {
    return false;
  }

  if (filters.accountant.trim() || filters.acceleratedStatus.length > 0) {
    return !shouldUseElasticsearch(useElasticsearch);
  }

  if (mode === 'boolean') {
    const parsed = parseBooleanQuery(rawQuery);
    return Boolean(parsed.expression);
  }
  return false;
}

export async function executeFilingResearchSearch({
  query,
  filters,
  mode = 'semantic',
  defaultForms = '',
  limit = 50,
  useElasticsearch = false,
  hydrateTextSignals = false,
  deferTextValidation = false,
  preferFastCandidateCollection = false,
  onProgress,
}: ExecuteSearchOptions): Promise<FilingResearchResult[]> {
  const serverQuery = buildServerQuery(query || filters.keyword, filters, mode);
  const formTypes = normalizeFormTypes(filters, defaultForms);
  const formScope = parseFormScope(formTypes);
  const preferRelevance = Boolean((query || filters.keyword).trim() || filters.sectionKeywords.trim());
  const semanticAuditorSearch = mode === 'semantic' && Boolean(filters.accountant.trim());
  const needsCompanyMetadata = requiresCompanyMetadata(filters);
  const requestedLimit = Math.max(limit, 1);
  const fastPass = deferTextValidation;
  const fastCandidateCollection = deferTextValidation || preferFastCandidateCollection;
  const displayLimit = Math.min(requestedLimit, 500);
  const needsTextFiltering = requiresTextFiltering(filters, query, mode, useElasticsearch);
  const shouldHydrateSignals = !fastPass && (hydrateTextSignals || needsTextFiltering);

  const booleanServerQueries = mode === 'boolean' ? buildBooleanCandidateQueries(query || filters.keyword).slice(0, 5) : [];
  const semanticServerQueries = mode === 'semantic' ? buildSemanticCandidateQueries(serverQuery, filters) : [];

  const serverQueries =
    mode === 'boolean'
      ? (booleanServerQueries.length > 0 ? booleanServerQueries : [serverQuery])
      : (semanticServerQueries.length > 0 ? semanticServerQueries : [serverQuery]);

  const filteredServerQueries = (
    fastCandidateCollection
      ? serverQueries.slice(0, mode === 'boolean' ? 3 : semanticAuditorSearch ? 2 : 3)
      : serverQueries
  ).filter(Boolean);

  // ── Collect-then-validate pipeline ──
  // For text-filtered searches (auditor, boolean, section keywords) we use a
  // wave-based strategy: collect a batch of candidates from EDGAR, validate them,
  // and if we haven't filled displayLimit yet, collect more from the next query
  // variant. This avoids fetching thousands of candidates up-front while still
  // being uncapped — the loop only stops when displayLimit is reached or all
  // query variants are exhausted.

  const perQueryResultLimit =
    fastCandidateCollection
      ? Math.min(Math.max(displayLimit, 80), 140)
      : needsTextFiltering
        ? 500
        : Math.min(Math.max(displayLimit, 140), 300);

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
      try {
        const batch = await searchEdgarFilings(
          candidateQuery,
          formTypes,
          filters.dateFrom || undefined,
          filters.dateTo || undefined,
          filters.entityName || undefined,
          fastCandidateCollection ? Math.min(perQueryResultLimit, 140) : perQueryResultLimit,
          buildExtendedSearchParams(filters, mode, useElasticsearch)
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
    results = results.filter(result => matchesBaseFilters(result, filters, formScope));
    results = sortResearchResults(results, preferRelevance);

    const fastResults = applyMetadataMatchFallback(results.slice(0, displayLimit));
    if (needsCompanyMetadata) return fastResults;
    return hydrateLightweightMetadata(fastResults);
  }

  // ── Wave-based collect + validate (text-filtered deep refinement) ──
  const signalMap = new Map<string, FilingSignal>();
  const filteredResults: FilingResearchResult[] = [];
  const batchSize = 6;
  const parsedBooleanQuery = mode === 'boolean' ? parseBooleanQuery(query) : { expression: null };
  const progressCallback = onProgress;
  let lastProgressCount = 0;
  const progressInterval = 15;
  const waveStartTime = Date.now();
  const maxWaveTimeMs = 45_000; // Stop after 45 seconds to avoid endless validation

  const wavePerQueryLimit = fastCandidateCollection ? Math.min(perQueryResultLimit, 140) : perQueryResultLimit;
  const waveQueryVariants = fastCandidateCollection ? filteredServerQueries.slice(0, 2) : filteredServerQueries;

  for (const [queryIndex, candidateQuery] of waveQueryVariants.entries()) {
    if (filteredResults.length >= displayLimit) break;
    if (Date.now() - waveStartTime > maxWaveTimeMs) break;

    let queryBatchHits: EdgarSearchHit[];
    try {
      queryBatchHits = await searchEdgarFilings(
        candidateQuery,
        formTypes,
        filters.dateFrom || undefined,
        filters.dateTo || undefined,
        filters.entityName || undefined,
        wavePerQueryLimit,
        buildExtendedSearchParams(filters, mode, useElasticsearch)
      );
    } catch (error) {
      lastSearchError = error instanceof Error ? error : new Error('EDGAR search failed');
      if (mode !== 'boolean') throw lastSearchError;
      continue;
    }

    // Deduplicate against previously seen hits
    const newHits: EdgarSearchHit[] = [];
    for (const hit of queryBatchHits) {
      if (!hitMap.has(hit._id)) {
        hitMap.set(hit._id, { hit, queryPriority: filteredServerQueries.length - queryIndex, score: hit._score });
        newHits.push(hit);
      }
    }

    if (newHits.length === 0) {
      if (mode === 'boolean') await delay(120);
      continue;
    }

    // Map, hydrate metadata, and filter this wave of candidates
    let waveCandidates = uniqueById(newHits.map(mapSearchHit));
    if (needsCompanyMetadata) waveCandidates = await hydrateCompanyMetadataBatch(waveCandidates);
    waveCandidates = waveCandidates.filter(result => matchesBaseFilters(result, filters, formScope));

    // Validate each candidate in this wave (fetch text, check auditor/boolean/section)
    for (let index = 0; index < waveCandidates.length && filteredResults.length < displayLimit && Date.now() - waveStartTime < maxWaveTimeMs; index += batchSize) {
      const chunk = waveCandidates.slice(index, Math.min(index + batchSize, waveCandidates.length));

      await Promise.all(
        chunk.map(async result => {
          const signal = await hydrateResultSignals(result);
          signalMap.set(getSignalCacheKey(result), signal);
        })
      );

      for (const result of chunk) {
        const filingText = signalMap.get(getSignalCacheKey(result))?.text || '';

        if (needsTextFiltering && mode === 'boolean' && parsedBooleanQuery.expression) {
          if (!filingText || !booleanQueryMatches(query, filingText)) continue;
        }

        if (needsTextFiltering && !matchesSignalFilters(result, filters, filingText)) continue;

        filteredResults.push(annotateResultMatchContext(result, query, filters, mode, filingText));
      }

      if (progressCallback && filteredResults.length >= lastProgressCount + progressInterval) {
        lastProgressCount = filteredResults.length;
        progressCallback(sortResearchResults([...filteredResults], preferRelevance).slice(0, displayLimit));
      }

      if (index + batchSize < waveCandidates.length && filteredResults.length < displayLimit) {
        await delay(150);
      }
    }

    if (mode === 'boolean' && queryIndex + 1 < filteredServerQueries.length) await delay(120);
  }

  if (filteredResults.length === 0 && lastSearchError) throw lastSearchError;

  const finalResults = sortResearchResults(filteredResults, preferRelevance).slice(0, displayLimit);

  if (needsCompanyMetadata) {
    return finalResults;
  }

  return hydrateLightweightMetadata(finalResults);
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
