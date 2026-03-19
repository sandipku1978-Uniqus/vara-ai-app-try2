import type { SearchFilters } from '../components/filters/SearchFilterBar';
import {
  fetchCompanySubmissions,
  fetchFilingText,
  searchEdgarFilings,
  type EdgarSearchHit,
} from './secApi';
import { parseSearchHit } from '../hooks/useEdgarSearch';
import { buildCandidateQueryFromBoolean, booleanQueryMatches, parseBooleanQuery } from '../utils/booleanSearch';

export type ResearchSearchMode = 'semantic' | 'boolean';

export interface FilingResearchResult {
  id: string;
  entityName: string;
  fileDate: string;
  formType: string;
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  description: string;
  score: number;
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
}

interface ExecuteSearchOptions {
  query: string;
  filters: SearchFilters;
  mode?: ResearchSearchMode;
  defaultForms?: string;
  limit?: number;
  hydrateTextSignals?: boolean;
}

const companyMetadataCache = new Map<string, Promise<CompanyResearchMetadata | null>>();
const filingSignalCache = new Map<string, Promise<FilingSignal>>();

const AUDITOR_PATTERNS = [
  { label: 'Deloitte', re: /deloitte(?:\s*&\s*touche)?(?:\s+llp)?/i },
  { label: 'PwC', re: /pricewaterhousecoopers|pwc/i },
  { label: 'EY', re: /ernst\s*&\s*young|ey\s+llp/i },
  { label: 'KPMG', re: /kpmg/i },
  { label: 'BDO', re: /\bbdo\b/i },
  { label: 'Grant Thornton', re: /grant\s+thornton/i },
  { label: 'RSM', re: /\brsm\b/i },
];

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

async function getCompanyMetadata(cik: string): Promise<CompanyResearchMetadata | null> {
  if (!cik) return null;
  if (!companyMetadataCache.has(cik)) {
    companyMetadataCache.set(
      cik,
      (async () => {
        const submissions = await fetchCompanySubmissions(cik);
        if (!submissions) {
          return null;
        }

        const recent = submissions.filings.recent;
        const fileNumbersByAccession: Record<string, string> = {};
        recent.accessionNumber.forEach((accession, index) => {
          fileNumbersByAccession[accession] = recent.fileNumber[index] || '';
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
        };
      })()
    );
  }

  return companyMetadataCache.get(cik)!;
}

function detectAuditor(text: string): string {
  const sample = text.slice(0, 20000);
  const matches = AUDITOR_PATTERNS.filter(pattern => pattern.re.test(sample));
  return matches.length > 0 ? matches[0].label : '';
}

function detectAcceleratedStatus(text: string): string {
  const sample = text.slice(0, 12000);
  const statuses = FILER_PATTERNS
    .filter(pattern => pattern.re.test(sample))
    .map(pattern => pattern.label);
  return Array.from(new Set(statuses)).join(', ');
}

async function getFilingSignal(cik: string, accessionNumber: string, primaryDocument: string): Promise<FilingSignal> {
  const cacheKey = `${cik}:${accessionNumber}:${primaryDocument}`;
  if (!filingSignalCache.has(cacheKey)) {
    filingSignalCache.set(
      cacheKey,
      (async () => {
        const text = await fetchFilingText(cik, accessionNumber, primaryDocument);
        return {
          text,
          auditor: detectAuditor(text),
          acceleratedStatus: detectAcceleratedStatus(text),
        };
      })()
    );
  }

  return filingSignalCache.get(cacheKey)!;
}

function getSignalCacheKey(result: Pick<FilingResearchResult, 'cik' | 'accessionNumber' | 'primaryDocument'>): string {
  return `${result.cik}:${result.accessionNumber}:${result.primaryDocument}`;
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

function sortResearchResults(results: FilingResearchResult[]): FilingResearchResult[] {
  return results.sort((a, b) => {
    const byDate = b.fileDate.localeCompare(a.fileDate);
    if (byDate !== 0) return byDate;
    return b.score - a.score;
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
    const matchesSic =
      includesNormalized(result.sic, sicNeedle) ||
      includesNormalized(result.sicDescription, sicNeedle);
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

function matchesSignalFilters(result: FilingResearchResult, filters: SearchFilters, filingText: string): boolean {
  if (filters.sectionKeywords.trim() && !matchesSectionKeywords(filingText, filters.sectionKeywords)) {
    return false;
  }

  if (filters.accountant.trim() && !includesNormalized(result.auditor, filters.accountant)) {
    return false;
  }

  if (!matchesFilerKeys(filters.acceleratedStatus, result)) {
    return false;
  }

  return true;
}

function mapSearchHit(hit: EdgarSearchHit): FilingResearchResult {
  const base = parseSearchHit(hit);
  const source = hit._source;
  return {
    id: hit._id,
    entityName: base.entityName,
    fileDate: base.fileDate,
    formType: base.formType,
    cik: base.cik,
    accessionNumber: base.accessionNumber,
    primaryDocument: base.primaryDocument,
    description: base.description,
    score: hit._score,
    filingUrl: buildFilingUrl(base.cik, base.accessionNumber, base.primaryDocument),
    companyName: source?.entity_name || base.entityName,
    tickers: [],
    sic: source?.sics?.[0] || '',
    sicDescription: '',
    exchange: '',
    stateOfIncorporation: source?.inc_states?.[0] || '',
    fiscalYearEnd: '',
    headquarters: source?.biz_locations?.[0] || '',
    fileNumber: source?.file_num?.[0] || '',
    auditor: '',
    acceleratedStatus: '',
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
  }

  return result;
}

async function hydrateResultSignals(result: FilingResearchResult): Promise<FilingSignal> {
  const signal = await getFilingSignal(result.cik, result.accessionNumber, result.primaryDocument);
  result.auditor = signal.auditor;
  result.acceleratedStatus = signal.acceleratedStatus;
  return signal;
}

function requiresTextFiltering(filters: SearchFilters, rawQuery: string, mode: ResearchSearchMode): boolean {
  if (filters.accountant.trim() || filters.acceleratedStatus.length > 0 || filters.sectionKeywords.trim()) {
    return true;
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
  hydrateTextSignals = false,
}: ExecuteSearchOptions): Promise<FilingResearchResult[]> {
  const serverQuery = buildServerQuery(query || filters.keyword, filters, mode);
  const formTypes = normalizeFormTypes(filters, defaultForms);
  const formScope = parseFormScope(formTypes);
  const hits = await searchEdgarFilings(
    serverQuery,
    formTypes,
    filters.dateFrom || undefined,
    filters.dateTo || undefined,
    filters.entityName || undefined
  );

  const needsTextFiltering = requiresTextFiltering(filters, query, mode);
  const shouldHydrateSignals = hydrateTextSignals || needsTextFiltering;
  const candidateLimit = Math.max(limit * 3, 90);
  let results = uniqueById(hits.map(mapSearchHit)).slice(0, candidateLimit);

  results = await Promise.all(results.map(result => hydrateCompanyMetadata(result)));
  results = results.filter(result => matchesBaseFilters(result, filters, formScope));
  results = sortResearchResults(results);

  if (!shouldHydrateSignals) {
    return results.slice(0, limit);
  }

  const signalMap = new Map<string, FilingSignal>();
  await Promise.all(
    results.map(async result => {
      const signal = await hydrateResultSignals(result);
      signalMap.set(getSignalCacheKey(result), signal);
    })
  );

  if (needsTextFiltering && mode === 'boolean') {
    const parsed = parseBooleanQuery(query);
    if (parsed.expression) {
      results = results.filter(result => {
        const signal = signalMap.get(getSignalCacheKey(result));
        return Boolean(signal?.text && booleanQueryMatches(query, signal.text));
      });
    }
  }

  if (needsTextFiltering) {
    results = results.filter(result => matchesSignalFilters(result, filters, signalMap.get(getSignalCacheKey(result))?.text || ''));
  }

  return sortResearchResults(results).slice(0, limit);
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
