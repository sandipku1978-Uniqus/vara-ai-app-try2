// Utility for fetching real SEC EDGAR data
// SEC EDGAR requires a descriptive User-Agent string

const USER_AGENT = import.meta.env.VITE_EDGAR_USER_AGENT || 'Vara AI Research App contact@vara.ai';

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

// Cache of all tickers loaded from SEC
let _tickerCache: Record<string, string> | null = null;
let _tickerCachePromise: Promise<Record<string, string>> | null = null;

/**
 * Load the full SEC ticker-to-CIK mapping (company_tickers.json).
 * Cached after first load.
 */
export async function loadTickerMap(): Promise<Record<string, string>> {
  if (_tickerCache) return _tickerCache;
  if (_tickerCachePromise) return _tickerCachePromise;

  _tickerCachePromise = (async () => {
    try {
      const response = await fetch('/files/company_tickers.json', {
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
    const response = await fetch(`/sec-data/submissions/CIK${paddedCik}.json`, {
      headers: getHeaders()
    });
    
    if (!response.ok) {
        throw new Error(`SEC API Error: ${response.statusText}`);
    }
    
    return await response.json();
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
    const response = await fetch(`/sec-data/api/xbrl/companyfacts/CIK${paddedCik}.json`, {
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
  'GrossProfit': ['GrossProfit'],
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
  'TotalDebt': ['LongTermDebt', 'LongTermDebtNoncurrent'],
  'Goodwill': ['Goodwill'],
  'IntangibleAssets': ['IntangibleAssetsNetExcludingGoodwill'],
  'AccountsReceivable': ['AccountsReceivableNetCurrent'],
  'Inventory': ['InventoryNet'],

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
      .filter(f => f.form === '10-K' && (f.fp === 'FY' || !f.fp))
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

// ===========================
// EDGAR Full-Text Search API
// ===========================

export interface EdgarSearchHit {
  _id: string;
  _score: number;
  _source: {
    ciks?: string[];
    file_num?: string[];
    display_names?: string[];
    file_date?: string;
    form?: string;
    adsh?: string;
    file_type?: string;
    file_description?: string;
    biz_locations?: string[];
    inc_states?: string[];
    sics?: string[];
    root_forms?: string[];
    entity_name?: string;
  };
}

export interface EdgarSearchResult {
  hits: {
    hits: EdgarSearchHit[];
    total: { value: number };
  };
}

/**
 * Search EDGAR full-text search for specific form types.
 */
export async function searchEdgarFilings(
  query: string,
  forms: string = 'S-1',
  startDate?: string,
  endDate?: string,
  entityName?: string
): Promise<EdgarSearchHit[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      forms: forms,
      dateRange: 'custom',
      startdt: startDate || '2020-01-01',
      enddt: endDate || new Date().toISOString().split('T')[0],
    });
    if (entityName) params.set('entityName', entityName);
    const response = await fetch(`/sec-efts/LATEST/search-index?${params}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error(`EDGAR Search Error: ${response.statusText}`);
    const data: EdgarSearchResult = await response.json();
    return data.hits?.hits || [];
  } catch (error) {
    console.error('EDGAR search failed:', error);
    throw error instanceof Error ? error : new Error('EDGAR search failed');
  }
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
    const response = await fetch(`/sec-proxy/cgi-bin/browse-edgar?action=getcompany&accession=${accessionNumber}&type=&dateb=&owner=include&count=40&search_text=&action=getcompany`, {
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
  try {
    const cleanAccession = accessionNumber.replace(/-/g, '');
    const response = await fetch(`/sec-proxy/Archives/edgar/data/${cik}/${cleanAccession}/${primaryDocument}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error(`Filing fetch Error: ${response.statusText}`);
    const html = await response.text();
    // Extract text from HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body?.textContent?.trim() || '';
  } catch (error) {
    console.error('Failed to fetch filing text:', error);
    return '';
  }
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
    const response = await fetch('/sec-proxy/litigation/litreleases.htm', { headers: getHeaders() });
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
  const gp = get('GrossProfit');
  const oi = get('OperatingIncome');
  const ni = get('NetIncome');
  const ta = get('TotalAssets');
  const eq = get('StockholdersEquity');
  const debt = get('TotalDebt');

  return {
    grossMargin: divide(gp, rev, 100),
    operatingMargin: divide(oi, rev, 100),
    netMargin: divide(ni, rev, 100),
    returnOnEquity: divide(ni, eq, 100),
    returnOnAssets: divide(ni, ta, 100),
    debtToEquity: divide(debt, eq),
    assetTurnover: divide(rev, ta),
    currentRatio: null, // Would need current assets/liabilities
  };
}
