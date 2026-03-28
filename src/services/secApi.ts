// Utility for fetching real SEC EDGAR data
// SEC EDGAR requires a descriptive User-Agent string

const USER_AGENT = import.meta.env.VITE_EDGAR_USER_AGENT || 'Vara AI Research App contact@vara.ai';
const USE_DIRECT_VERCEL_API = !import.meta.env.DEV;
const edgarSearchCache = new Map<string, Promise<EdgarSearchHit[]>>();

function isEnabledEnvFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

export function isElasticsearchEnabled(): boolean {
  return isEnabledEnvFlag(import.meta.env.VITE_USE_ELASTICSEARCH);
}

// Cache for CIKs to avoid redundant lookups if doing bulk mappings 
// (In a real app, you'd likely hit an internal DB, but here we'll map top tickers)
export const CIK_MAP: Record<string, string> = {
  'AAPL': '0000320193',
  'MSFT': '0000789019',
  'GOOGL': '0001652044',
  'TSLA': '0001318605',
  'JPM': '0000019617',
  'AMZN': '0001018724',
  'META': '0001326801',
  'NVDA': '0001045810'
};

const getHeaders = () => ({
  'User-Agent': USER_AGENT,
  'Accept-Encoding': 'gzip, deflate'
});

function buildProxyUrl(
  type: 'proxy' | 'data' | 'efts',
  path: string,
  params?: Record<string, string | number | undefined> | URLSearchParams
): string {
  const cleanPath = path.replace(/^\/+/, '');
  const searchParams = params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams();

  if (!(params instanceof URLSearchParams) && params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null) {
        searchParams.set(key, String(value));
      }
    }
  }

  if (!USE_DIRECT_VERCEL_API) {
    if (type === 'efts') {
      searchParams.set('path', cleanPath);
      return `/api/sec-efts?${searchParams.toString()}`;
    }

    const base =
      type === 'data'
        ? `/sec-data/${cleanPath}`
        : `/sec-proxy/${cleanPath}`;
    const query = searchParams.toString();
    return query ? `${base}?${query}` : base;
  }

  const functionName = 'sec-proxy';
  if (type === 'data' || type === 'efts') {
    searchParams.set('upstream', type);
  }
  searchParams.set('path', cleanPath);
  return `/api/${functionName}?${searchParams.toString()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function buildSecProxyUrl(path: string, params?: Record<string, string | number | undefined> | URLSearchParams): string {
  return buildProxyUrl('proxy', path, params);
}

export function buildSecDataUrl(path: string, params?: Record<string, string | number | undefined> | URLSearchParams): string {
  return buildProxyUrl('data', path, params);
}

export function buildSecEftsUrl(path: string, params?: Record<string, string | number | undefined> | URLSearchParams): string {
  return buildProxyUrl('efts', path, params);
}

function extractDocumentTextFromHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return '';

  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, noscript, template').forEach(node => node.remove());
  clone.querySelectorAll('ix\\:header, ix\\:hidden, xbrli\\:context, xbrli\\:unit').forEach(node => node.remove());

  const text = clone.innerText || clone.textContent || '';
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Cache of all tickers loaded from SEC
let _tickerCache: Record<string, string> | null = null;
let _tickerCachePromise: Promise<Record<string, string>> | null = null;
const filingTextCache = new Map<string, Promise<string>>();

/**
 * Load the full SEC ticker-to-CIK mapping (company_tickers.json).
 * Cached after first load.
 */
export async function loadTickerMap(): Promise<Record<string, string>> {
  if (_tickerCache) return _tickerCache;
  if (_tickerCachePromise) return _tickerCachePromise;

  _tickerCachePromise = (async () => {
    try {
      const response = await fetch(buildSecProxyUrl('files/company_tickers.json'), {
        headers: getHeaders()
      });
      if (!response.ok) throw new Error('Failed to load ticker map');
      const data = await response.json();
      // Format: { "0": { "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." }, ... }
      const map: Record<string, string> = {};
      for (const entry of Object.values(data) as any[]) {
        map[entry.ticker.toUpperCase()] = String(entry.cik_str);
      }
      _tickerCache = map;
      return map;
    } catch (error) {
      console.error('Failed to load SEC ticker map:', error);
      return {};
    }
  })();
  return _tickerCachePromise;
}

/**
 * Look up a CIK by ticker symbol.
 * Checks the hardcoded CIK_MAP first, then falls back to SEC's full ticker list.
 */
export async function lookupCIK(ticker: string): Promise<string | null> {
  const upper = ticker.toUpperCase().trim();
  if (CIK_MAP[upper]) return CIK_MAP[upper];

  const fullMap = await loadTickerMap();
  const cik = fullMap[upper];
  if (cik) {
    // Cache in CIK_MAP for instant future lookups
    CIK_MAP[upper] = cik.padStart(10, '0');
    return CIK_MAP[upper];
  }
  return null;
}

export interface SecSubmission {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  ein: string;
  description: string;
  sic: string;
  sicDescription: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      acceptanceDateTime: string[];
      act: string[];
      form: string[];
      fileNumber: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    }
  }
}

/**
 * Fetch company submissions by formatted CIK. 
 * Note: SEC payload requires 10-digit zero-padded CIK strings.
 */
export async function fetchCompanySubmissions(cik: string): Promise<SecSubmission | null> {
  const paddedCik = cik.padStart(10, '0');
  try {
    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(buildSecDataUrl(`submissions/CIK${paddedCik}.json`), {
        headers: getHeaders()
      });
      lastResponse = response;

      if (response.ok) {
        return await response.json();
      }

      if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt < 2) {
        await delay(500 * (attempt + 1));
        continue;
      }

      throw new Error(`SEC API Error: ${response.status} ${response.statusText}`);
    }

    throw new Error(`SEC API Error: ${lastResponse?.status || 0} ${lastResponse?.statusText || 'Unknown error'}`);
  } catch (error) {
    console.error('Failed to fetch SEC Submissions:', error);
    return null;
  }
}

/**
 * Helper to build a direct link to the SEC EDGAR rendering of a specific filing
 */
export function buildSecDocumentUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  // Accession numbers are stored with dashes in the API for some fields, 
  // but the URL scheme requires them without dashes
  const cleanAccession = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${cleanAccession}/${primaryDocument}`;
}

// ===========================
// XBRL Company Facts API
// ===========================

export interface XbrlFact {
  val: number;
  accn: string;
  fy: number;
  fp: string; // Q1, Q2, Q3, FY
  form: string;
  filed: string;
  end: string;
  start?: string;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: {
    'us-gaap'?: Record<string, { label: string; description: string; units: Record<string, XbrlFact[]> }>;
    'dei'?: Record<string, { label: string; description: string; units: Record<string, XbrlFact[]> }>;
  };
}

/**
 * Fetch XBRL company facts from SEC EDGAR.
 * Returns all reported financial facts (us-gaap taxonomy) for a company.
 */
export async function fetchCompanyFacts(cik: string): Promise<CompanyFacts | null> {
  const paddedCik = cik.padStart(10, '0');
  try {
    const response = await fetch(buildSecDataUrl(`api/xbrl/companyfacts/CIK${paddedCik}.json`), {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error(`XBRL API Error: ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch XBRL company facts:', error);
    return null;
  }
}

/** Key financial concepts to extract (us-gaap taxonomy names) */
const FINANCIAL_CONCEPTS = {
  // Income Statement
  'Revenues': ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  'CostOfRevenue': ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  'GrossProfit': ['GrossProfit', 'GrossProfitLoss'],
  'OperatingIncome': ['OperatingIncomeLoss'],
  'NetIncome': ['NetIncomeLoss'],
  'EarningsPerShare': ['EarningsPerShareBasic'],
  'EarningsPerShareDiluted': ['EarningsPerShareDiluted'],
  'ResearchAndDevelopment': ['ResearchAndDevelopmentExpense'],
  'SellingGeneralAdmin': ['SellingGeneralAndAdministrativeExpense'],

  // Balance Sheet
  'TotalAssets': ['Assets'],
  'TotalLiabilities': ['Liabilities'],
  'StockholdersEquity': ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  'CashAndEquivalents': ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsAndShortTermInvestments'],
  'TotalDebt': ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent', 'LongTermDebtCurrent', 'ShortTermBorrowings', 'ShortTermDebt', 'CurrentPortionOfLongTermDebt'],
  'Goodwill': ['Goodwill', 'GoodwillNet'],
  'IntangibleAssets': [
    'IntangibleAssetsNetExcludingGoodwill',
    'FiniteLivedIntangibleAssetsNet',
    'IndefiniteLivedIntangibleAssetsExcludingGoodwill',
    'OtherIntangibleAssetsNet',
    'AmortizableIntangibleAssetsNet',
  ],
  'AccountsReceivable': ['AccountsReceivableNetCurrent', 'AccountsReceivableNet', 'ReceivablesNetCurrent', 'AccountsNotesAndLoansReceivableNetCurrent'],
  'Inventory': ['InventoryNet', 'Inventories', 'InventoriesNetOfReserves', 'InventoryAndServicePartsNet', 'InventoryFinishedGoods', 'InventoryGross', 'InventoryNetOfAllowancesCustomerAdvancesAndProgressBillings'],
  'CurrentAssets': ['AssetsCurrent'],
  'CurrentLiabilities': ['LiabilitiesCurrent'],

  // Cash Flow
  'OperatingCashFlow': ['NetCashProvidedByOperatingActivities'],
  'CapitalExpenditures': ['PaymentsToAcquirePropertyPlantAndEquipment'],
  'DividendsPaid': ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'],
  'ShareRepurchases': ['PaymentsForRepurchaseOfCommonStock'],

  // Key Disclosures
  'OperatingLeaseROU': ['OperatingLeaseRightOfUseAsset'],
  'OperatingLeaseLiability': ['OperatingLeaseLiability'],
  'StockCompensation': ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  'DeferredRevenue': ['ContractWithCustomerLiability', 'DeferredRevenue', 'DeferredRevenueCurrentAndNoncurrent'],
  'IncomeTaxExpense': ['IncomeTaxExpenseBenefit'],
};

export interface FinancialMetric {
  label: string;
  value: number | null;
  year: number;
  period: string;
  unit: string;
}

function normalizeAnnualForm(form: string): string {
  return form.trim().toUpperCase().replace(/\s+/g, '').replace(/\/A$/, '');
}

function isLikelyAnnualFact(fact: XbrlFact): boolean {
  const form = normalizeAnnualForm(fact.form || '');
  const isAnnualForm = ['10-K', '10-KT', '20-F', '40-F'].includes(form);
  if (!isAnnualForm) return false;

  const fp = (fact.fp || '').toUpperCase();
  if (!fp || fp === 'FY' || fp === 'CY') {
    return true;
  }

  if (fact.start && fact.end) {
    const start = Date.parse(fact.start);
    const end = Date.parse(fact.end);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      const days = Math.abs(end - start) / (1000 * 60 * 60 * 24);
      return days >= 300;
    }
  }

  return false;
}

function getPreferredUnits(concept: { units: Record<string, XbrlFact[]> }): { unitKey: string; facts: XbrlFact[] } | null {
  const preferred = ['USD', 'USD/shares', 'shares'];
  for (const unitKey of preferred) {
    const facts = concept.units[unitKey];
    if (facts && facts.length > 0) {
      return { unitKey, facts };
    }
  }

  const fallback = Object.entries(concept.units).find(([, facts]) => Array.isArray(facts) && facts.length > 0);
  return fallback ? { unitKey: fallback[0], facts: fallback[1] } : null;
}

/**
 * Returns a sorted list (newest first) of fiscal years that have annual 10-K data.
 */
export function getAvailableYears(facts: CompanyFacts): number[] {
  const usGaap = facts.facts['us-gaap'];
  if (!usGaap) return [];
  const years = new Set<number>();
  // Sample a few common concepts to discover available years
  const probes = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'Assets', 'NetIncomeLoss'];
  for (const conceptName of probes) {
    const concept = usGaap[conceptName];
    if (!concept) continue;
    const usdFacts = concept.units['USD'];
    if (!usdFacts) continue;
    usdFacts
      .filter(isLikelyAnnualFact)
      .forEach(f => years.add(f.fy));
  }
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Extract the most recent annual (10-K / FY) value for each key financial concept.
 * Pass a specific `year` to extract data for that fiscal year instead of the latest.
 */
export function extractFinancials(facts: CompanyFacts, year?: number): Record<string, FinancialMetric> {
  const result: Record<string, FinancialMetric> = {};
  const usGaap = facts.facts['us-gaap'];
  if (!usGaap) return result;

  for (const [metricKey, conceptAliases] of Object.entries(FINANCIAL_CONCEPTS)) {
    for (const conceptName of conceptAliases) {
      const concept = usGaap[conceptName];
      if (!concept) continue;

      // Get USD values (or shares for EPS)
      const units = concept.units['USD'] || concept.units['USD/shares'] || concept.units['shares'];
      if (!units || units.length === 0) continue;

      // Filter to annual 10-K filings
      const annualFacts = units
        .filter(f => f.form === '10-K' && (f.fp === 'FY' || !f.fp))
        .sort((a, b) => b.fy - a.fy);

      // Pick the specific year if requested, otherwise take the most recent
      const match = year != null
        ? annualFacts.find(f => f.fy === year)
        : annualFacts[0];

      if (match) {
        const unitType = concept.units['USD'] ? 'USD' : (concept.units['USD/shares'] ? 'USD/shares' : 'shares');
        result[metricKey] = {
          label: concept.label,
          value: match.val,
          year: match.fy,
          period: match.fp || 'FY',
          unit: unitType,
        };
        break; // Found a value — stop trying aliases
      }
    }
  }

  return result;
}

function lookupAnnualMetric(
  facts: CompanyFacts,
  aliases: string[],
  year?: number
): FinancialMetric | null {
  const usGaap = facts.facts['us-gaap'];
  if (!usGaap) return null;

  for (const alias of aliases) {
    const concept = usGaap[alias];
    if (!concept) continue;

    const preferredUnits = getPreferredUnits(concept);
    if (!preferredUnits) continue;

    const annualFacts = preferredUnits.facts
      .filter(isLikelyAnnualFact)
      .sort((a, b) => b.fy - a.fy);

    const match = year != null
      ? annualFacts.find(item => item.fy === year)
      : annualFacts[0];

    if (!match) continue;

    return {
      label: concept.label,
      value: match.val,
      year: match.fy,
      period: match.fp || 'FY',
      unit: preferredUnits.unitKey,
    };
  }

  return null;
}

export function extractComparableFinancials(facts: CompanyFacts, year?: number): Record<string, FinancialMetric> {
  const result = extractFinancials(facts, year);

  const fillIfMissing = (metricKey: string, aliases: string[]) => {
    if (result[metricKey]) return;
    const metric = lookupAnnualMetric(facts, aliases, year);
    if (metric) {
      result[metricKey] = metric;
    }
  };

  for (const [metricKey, aliases] of Object.entries(FINANCIAL_CONCEPTS)) {
    fillIfMissing(metricKey, aliases);
  }

  fillIfMissing('TotalDebt', ['LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent']);
  fillIfMissing('AccountsReceivable', ['ReceivablesNetCurrent', 'AccountsNotesAndLoansReceivableNetCurrent']);
  fillIfMissing('Inventory', ['InventoriesNetOfReserves', 'InventoryFinishedGoods', 'InventoryNetOfAllowancesCustomerAdvancesAndProgressBillings']);
  fillIfMissing('IntangibleAssets', [
    'FiniteLivedIntangibleAssetsNet',
    'IndefiniteLivedIntangibleAssetsExcludingGoodwill',
    'IndefiniteLivedIntangibleAssetsNetExcludingGoodwill',
    'OtherIntangibleAssetsNet',
    'AmortizableIntangibleAssetsNet',
  ]);

  if (!result.GrossProfit && result.Revenues?.value != null && result.CostOfRevenue?.value != null) {
    result.GrossProfit = {
      label: 'Gross Profit (derived)',
      value: result.Revenues.value - result.CostOfRevenue.value,
      year: result.Revenues.year,
      period: result.Revenues.period,
      unit: result.Revenues.unit,
    };
  }

  if (!result.IntangibleAssets && result.Goodwill?.value != null) {
    const grossIntangibles = lookupAnnualMetric(facts, ['IntangibleAssetsNetIncludingGoodwill'], year);
    if (grossIntangibles?.value != null) {
      result.IntangibleAssets = {
        label: 'Intangible Assets (derived ex. goodwill)',
        value: grossIntangibles.value - result.Goodwill.value,
        year: grossIntangibles.year,
        period: grossIntangibles.period,
        unit: grossIntangibles.unit,
      };
    }
  }

  return result;
}

// ===========================
// EDGAR Full-Text Search API
// ===========================

export interface EdgarSearchHit {
  _id: string;
  _score: number;
  _source: {
    ciks?: string[];
    file_num?: string | string[];
    display_names?: string[];
    file_date?: string;
    form?: string;
    adsh?: string;
    file_type?: string;
    file_description?: string;
    biz_locations?: string[] | string;
    inc_states?: string[] | string;
    sics?: string[] | string;
    root_forms?: string[];
    entity_name?: string;
    primary_document?: string;
    tickers?: string[];
    sic_description?: string;
    exchange?: string;
    state_of_incorporation?: string;
    fiscal_year_end?: string;
    auditor?: string;
    accelerated_status?: string[] | string;
  };
  highlight?: Record<string, string[]>;
}

export interface EdgarSearchResult {
  hits: {
    hits: EdgarSearchHit[];
    total: { value: number };
  };
}

export interface ElasticSearchExtendedParams {
  auditor?: string;
  acceleratedStatus?: string;
  sicCode?: string;
  mode?: 'semantic' | 'boolean';
}

/**
 * Search filings via Elasticsearch when available, otherwise fall back to EDGAR EFTS.
 */
async function searchViaElasticsearch(
  query: string,
  forms: string,
  startDate: string,
  endDate: string,
  entityName: string,
  maxResults: number,
  extended: ElasticSearchExtendedParams = {}
): Promise<EdgarSearchHit[]> {
  const params = new URLSearchParams({
    q: query,
    forms,
    startdt: startDate,
    enddt: endDate,
    from: '0',
    size: String(Math.min(maxResults, 500)),
  });
  if (entityName) params.set('entityName', entityName);
  if (extended.auditor) params.set('auditor', extended.auditor);
  if (extended.acceleratedStatus) params.set('acceleratedStatus', extended.acceleratedStatus);
  if (extended.sicCode) params.set('sicCode', extended.sicCode);
  if (extended.mode) params.set('mode', extended.mode);

  const results: EdgarSearchHit[] = [];
  const seenIds = new Set<string>();
  let totalHits = Number.POSITIVE_INFINITY;
  const pageSize = Math.min(maxResults, 500);

  for (let offset = 0; offset < maxResults && results.length < maxResults && offset < totalHits; offset += pageSize) {
    params.set('from', String(offset));
    params.set('size', String(Math.min(pageSize, maxResults - results.length)));

    const response = await fetch(`/api/es-search?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`ES Search Error: ${response.status}`);
    }

    const data: EdgarSearchResult = await response.json();
    const pageHits = data.hits?.hits || [];
    totalHits = data.hits?.total?.value || pageHits.length;

    for (const hit of pageHits) {
      if (seenIds.has(hit._id)) continue;
      seenIds.add(hit._id);
      results.push(hit);
      if (results.length >= maxResults) break;
    }

    if (pageHits.length < pageSize) break;
    if (offset + pageSize < maxResults) await delay(50);
  }

  return results;
}

/**
 * Search EDGAR full-text search for specific form types.
 * Routes through Elasticsearch when VITE_USE_ELASTICSEARCH is set.
 */
export async function searchEdgarFilings(
  query: string,
  forms: string = 'S-1',
  startDate?: string,
  endDate?: string,
  entityName?: string,
  maxResults = 100,
  extended: ElasticSearchExtendedParams = {}
): Promise<EdgarSearchHit[]> {
  if (isElasticsearchEnabled()) {
    return searchViaElasticsearch(
      query,
      forms,
      startDate || '2020-01-01',
      endDate || new Date().toISOString().split('T')[0],
      entityName || '',
      maxResults,
      extended
    );
  }
  const baseParams = new URLSearchParams({
    q: query,
    forms: forms,
    dateRange: 'custom',
    startdt: startDate || '2020-01-01',
    enddt: endDate || new Date().toISOString().split('T')[0],
  });
  if (entityName) baseParams.set('entityName', entityName);

  const pageSize = Math.min(Math.max(maxResults, 1), 100);
  const cacheKey = `${baseParams.toString()}|max=${maxResults}`;
  if (!edgarSearchCache.has(cacheKey)) {
    edgarSearchCache.set(cacheKey, (async () => {
      try {
        const results: EdgarSearchHit[] = [];
        const seenIds = new Set<string>();
        let totalHits = Number.POSITIVE_INFINITY;

        for (let offset = 0; offset < maxResults && results.length < maxResults && offset < totalHits; offset += pageSize) {
          const params = new URLSearchParams(baseParams);
          params.set('from', String(offset));
          params.set('size', String(Math.min(pageSize, maxResults - results.length)));

          let lastResponse: Response | null = null;
          let pageHits: EdgarSearchHit[] = [];
          let totalForPage = Number.POSITIVE_INFINITY;

          for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await fetch(buildSecEftsUrl('LATEST/search-index', params), {
              headers: getHeaders()
            });
            lastResponse = response;
            if (response.ok) {
              const data: EdgarSearchResult = await response.json();
              pageHits = data.hits?.hits || [];
              totalForPage = data.hits?.total?.value || pageHits.length;
              break;
            }

            if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt === 0) {
              await delay(700);
              continue;
            }

            throw new Error(`EDGAR Search Error: ${response.status} ${response.statusText}`);
          }

          if (!lastResponse?.ok) {
            throw new Error(`EDGAR Search Error: ${lastResponse?.status || 0} ${lastResponse?.statusText || 'Unknown error'}`);
          }

          totalHits = Math.min(totalHits, totalForPage);
          let addedThisPage = 0;
          for (const hit of pageHits) {
            if (seenIds.has(hit._id)) continue;
            seenIds.add(hit._id);
            results.push(hit);
            addedThisPage += 1;
            if (results.length >= maxResults) {
              break;
            }
          }

          if (pageHits.length < pageSize || addedThisPage === 0) {
            break;
          }

          if (offset + pageSize < maxResults) {
            await delay(180);
          }
        }

        return results;
      } catch (error) {
        edgarSearchCache.delete(cacheKey);
        console.error('EDGAR search failed:', error);
        throw error instanceof Error ? error : new Error('EDGAR search failed');
      }
    })());
  }

  return edgarSearchCache.get(cacheKey)!;
}

/**
 * Fetch the filing index page for an accession number to get all documents in the filing.
 */
export interface FilingDocument {
  name: string;
  description: string;
  type: string;
  size: string;
  url: string;
}

export async function fetchFilingIndex(accessionNumber: string): Promise<FilingDocument[]> {
  try {
    // The EDGAR filing index JSON endpoint
    const response = await fetch(buildSecProxyUrl('cgi-bin/browse-edgar', {
      action: 'getcompany',
      accession: accessionNumber,
      type: '',
      dateb: '',
      owner: 'include',
      count: 40,
      search_text: '',
    }), {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error(`Filing index Error: ${response.statusText}`);
    // Fallback: return empty, the component will use the accession directly
    return [];
  } catch (error) {
    console.error('Failed to fetch filing index:', error);
    return [];
  }
}

/**
 * Fetch the text content of an SEC filing document via proxy (for AI analysis).
 * Returns raw text extracted from the HTML filing.
 */
export async function fetchFilingText(cik: string, accessionNumber: string, primaryDocument: string): Promise<string> {
  const cleanAccession = accessionNumber.replace(/-/g, '');
  const cacheKey = `${cik}:${cleanAccession}:${primaryDocument}`;

  if (!filingTextCache.has(cacheKey)) {
    filingTextCache.set(cacheKey, (async () => {
      try {
        let lastResponse: Response | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(buildSecProxyUrl(`Archives/edgar/data/${cik}/${cleanAccession}/${primaryDocument}`), {
            headers: getHeaders()
          });
          lastResponse = response;
          if (response.ok) {
            const html = await response.text();
            return extractDocumentTextFromHtml(html);
          }

          if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt === 0) {
            await delay(500);
            continue;
          }

          throw new Error(`Filing fetch Error: ${response.status} ${response.statusText}`);
        }

        throw new Error(`Filing fetch Error: ${lastResponse?.status || 0} ${lastResponse?.statusText || 'Unknown error'}`);
      } catch (error) {
        console.error('Failed to fetch filing text:', error);
        filingTextCache.delete(cacheKey);
        return '';
      }
    })());
  }

  return filingTextCache.get(cacheKey)!;
}

/**
 * Find the most recent filing of a given form type from a company's submissions.
 */
export function findLatestFiling(
  submissions: SecSubmission,
  formType: string
): { accessionNumber: string; filingDate: string; primaryDocument: string } | null {
  const { form, accessionNumber, filingDate, primaryDocument } = submissions.filings.recent;
  for (let i = 0; i < form.length; i++) {
    if (form[i] === formType) {
      return {
        accessionNumber: accessionNumber[i],
        filingDate: filingDate[i],
        primaryDocument: primaryDocument[i],
      };
    }
  }
  return null;
}

/**
 * Count filings per calendar month for a given year from a company's submissions.
 */
export function countFilingsByMonth(
  submissions: SecSubmission,
  year: number
): Record<string, number> {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const counts: Record<string, number> = {};
  months.forEach(m => { counts[m] = 0; });

  const { filingDate } = submissions.filings.recent;
  for (const date of filingDate) {
    if (!date) continue;
    const [y, m] = date.split('-');
    if (parseInt(y, 10) === year) {
      const monthIdx = parseInt(m, 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        counts[months[monthIdx]]++;
      }
    }
  }
  return counts;
}

/**
 * Format a number as a compact financial display value.
 */
export function formatFinancialValue(value: number | null | undefined, unit: string): string {
  if (value == null) return '—';
  if (unit === 'USD/shares') return `$${value.toFixed(2)}`;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Extract normalized metadata from a company submission.
 */
export interface CompanyMetadata {
  cik: string;
  name: string;
  tickers: string[];
  exchange: string;
  sic: string;
  sicDescription: string;
  stateOfIncorporation: string;
  fiscalYearEnd: string;
}

export function extractCompanyMetadata(sub: SecSubmission): CompanyMetadata {
  return {
    cik: sub.cik,
    name: sub.name,
    tickers: sub.tickers || [],
    exchange: (sub as any).exchanges?.[0] || '',
    sic: (sub as any).sic || '',
    sicDescription: sub.sicDescription || '',
    stateOfIncorporation: (sub as any).stateOfIncorporation || '',
    fiscalYearEnd: (sub as any).fiscalYearEnd || '',
  };
}

/**
 * Fetch submissions for multiple CIKs in parallel with basic concurrency limiting.
 */
export async function fetchCompanySubmissionsBatch(
  ciks: string[],
  concurrency: number = 5
): Promise<(SecSubmission | null)[]> {
  const results: (SecSubmission | null)[] = new Array(ciks.length).fill(null);
  for (let i = 0; i < ciks.length; i += concurrency) {
    const batch = ciks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(cik => fetchCompanySubmissions(cik))
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }
  return results;
}

/**
 * Get all insider filings (Forms 3, 4, 5) from a company's submissions.
 */
export function getInsiderFilings(
  submissions: SecSubmission,
  formTypes: string[] = ['3', '4', '5']
): { form: string; filingDate: string; accessionNumber: string; primaryDocument: string }[] {
  const results: { form: string; filingDate: string; accessionNumber: string; primaryDocument: string }[] = [];
  const recent = submissions.filings.recent;
  for (let i = 0; i < recent.form.length; i++) {
    if (formTypes.includes(recent.form[i])) {
      results.push({
        form: recent.form[i],
        filingDate: recent.filingDate[i],
        accessionNumber: recent.accessionNumber[i],
        primaryDocument: recent.primaryDocument[i],
      });
    }
  }
  return results;
}

/**
 * Search wrappers for specific form types.
 */
export async function searchCommentLetters(query: string, dateFrom?: string, dateTo?: string, entityName?: string) {
  return searchEdgarFilings(query, 'CORRESP,UPLOAD', dateFrom, dateTo, entityName);
}

export async function searchFormD(query: string, dateFrom?: string, dateTo?: string, entityName?: string) {
  return searchEdgarFilings(query, 'D,D/A', dateFrom, dateTo, entityName);
}

export async function searchExhibits(query: string, exhibitTypes: string, dateFrom?: string, dateTo?: string, entityName?: string) {
  return searchEdgarFilings(query, exhibitTypes, dateFrom, dateTo, entityName);
}

export async function searchFormADV(query: string, dateFrom?: string, dateTo?: string, entityName?: string) {
  return searchEdgarFilings(query, 'ADV,ADV/A,ADV-W', dateFrom, dateTo, entityName);
}

/**
 * Fetch and parse SEC litigation releases index page.
 */
export async function fetchLitigationReleases(): Promise<{ date: string; title: string; url: string; releaseNumber: string }[]> {
  try {
    const response = await fetch(buildSecProxyUrl('litigation/litreleases.htm'), { headers: getHeaders() });
    if (!response.ok) return [];
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items: { date: string; title: string; url: string; releaseNumber: string }[] = [];
    const links = doc.querySelectorAll('a[href*="litreleases/"]');
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') || '';
      const text = (link.textContent || '').trim();
      if (!text || text.length < 5) continue;
      // Try to extract release number from href
      const numMatch = href.match(/lr(\d+)/);
      const releaseNumber = numMatch ? `LR-${numMatch[1]}` : '';
      // Try to find date from parent/sibling
      const parent = link.parentElement;
      const dateMatch = parent?.textContent?.match(/(\w+ \d{1,2}, \d{4})/);
      items.push({
        title: text,
        url: href.startsWith('http') ? href : `https://www.sec.gov${href}`,
        releaseNumber,
        date: dateMatch ? dateMatch[1] : '',
      });
      if (items.length >= 50) break;
    }
    return items;
  } catch (error) {
    console.error('Failed to fetch litigation releases:', error);
    return [];
  }
}

/**
 * Compute standard financial ratios from extracted metrics.
 */
export function computeFinancialRatios(metrics: Record<string, { value: number; unit: string }>): Record<string, number | null> {
  const get = (key: string) => metrics[key]?.value ?? null;
  const divide = (numerator: number | null, denominator: number | null, multiply = 1) =>
    numerator != null && denominator != null && denominator !== 0 ? (numerator / denominator) * multiply : null;
  const rev = get('Revenues');
  const gp = get('GrossProfit') ?? (
    get('Revenues') != null && get('CostOfRevenue') != null
      ? (get('Revenues') as number) - (get('CostOfRevenue') as number)
      : null
  );
  const oi = get('OperatingIncome');
  const ni = get('NetIncome');
  const ta = get('TotalAssets');
  const eq = get('StockholdersEquity');
  const debt = get('TotalDebt');
  const currentAssets = get('CurrentAssets');
  const currentLiabilities = get('CurrentLiabilities');

  return {
    grossMargin: divide(gp, rev, 100),
    operatingMargin: divide(oi, rev, 100),
    netMargin: divide(ni, rev, 100),
    returnOnEquity: divide(ni, eq, 100),
    returnOnAssets: divide(ni, ta, 100),
    debtToEquity: divide(debt, eq),
    assetTurnover: divide(rev, ta),
    currentRatio: divide(currentAssets, currentLiabilities),
  };
}
