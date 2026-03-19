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

function buildServerQuery(rawQuery: string, filters: SearchFilters, mode: ResearchSearchMode): string {
  const parts = [rawQuery.trim()];

  if (filters.sectionKeywords.trim()) {
    parts.push(filters.sectionKeywords.trim());
  }

  if (filters.accessionNumber.trim()) {
    parts.push(filters.accessionNumber.trim());
  }

  if (filters.fileNumber.trim()) {
    parts.push(filters.fileNumber.trim());
  }

  const combined = parts.filter(Boolean).join(' ').trim();
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

function matchesMetadataFilters(result: FilingResearchResult, filters: SearchFilters): boolean {
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

async function hydrateResult(
  result: FilingResearchResult,
  needsTextSignals: boolean
): Promise<FilingResearchResult> {
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

  if (needsTextSignals) {
    const signal = await getFilingSignal(result.cik, result.accessionNumber, result.primaryDocument);
    result.auditor = signal.auditor;
    result.acceleratedStatus = signal.acceleratedStatus;
  }

  return result;
}

function requiresTextSignals(filters: SearchFilters, rawQuery: string, mode: ResearchSearchMode, hydrateTextSignals = false): boolean {
  if (hydrateTextSignals) {
    return true;
  }
  if (filters.accountant.trim() || filters.acceleratedStatus.length > 0) {
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
  const hits = await searchEdgarFilings(
    serverQuery,
    formTypes,
    filters.dateFrom || undefined,
    filters.dateTo || undefined,
    filters.entityName || undefined
  );

  const needsSignals = requiresTextSignals(filters, query, mode, hydrateTextSignals);
  let results = uniqueById(hits.map(mapSearchHit)).slice(0, Math.max(limit * 2, 60));

  results = await Promise.all(results.map(result => hydrateResult(result, needsSignals)));

  if (mode === 'boolean') {
    const parsed = parseBooleanQuery(query);
    if (parsed.expression) {
      const filtered: FilingResearchResult[] = [];
      for (const result of results) {
        const signal =
          needsSignals
            ? await getFilingSignal(result.cik, result.accessionNumber, result.primaryDocument)
            : { text: '', auditor: result.auditor, acceleratedStatus: result.acceleratedStatus };
        if (signal.text && booleanQueryMatches(query, signal.text)) {
          filtered.push(result);
        }
      }
      results = filtered;
    }
  }

  results = results.filter(result => matchesMetadataFilters(result, filters));

  return results
    .sort((a, b) => {
      const byDate = b.fileDate.localeCompare(a.fileDate);
      if (byDate !== 0) return byDate;
      return b.score - a.score;
    })
    .slice(0, limit);
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
