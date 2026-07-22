// Utility for fetching real SEC EDGAR data
// SEC EDGAR requires a descriptive User-Agent string

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
interface CachedEdgarSearch {
  hits: EdgarSearchHit[];
  coverage: SearchCandidateCoverage;
}

const edgarSearchCache = new Map<string, Promise<CachedEdgarSearch>>();
const submissionHistoryCache = new Map<string, Promise<SecFilingSeries | null>>();

function isDisabledEnvFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return !value;
  if (typeof value !== 'string') return false;

  switch (value.trim().toLowerCase()) {
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return true;
    default:
      return false;
  }
}

/** Enables the enriched /api/es-search lane (EDGAR EFTS + Supabase facets —
 *  the Elastic cluster it originally fronted was retired).
 *
 *  Default ON: this used to be opt-in, and production was deployed without
 *  the flag — the client silently ran the legacy EFTS-only lane, where
 *  entity-resolved browses (empty text query) return nothing. The server
 *  route 503s gracefully when Supabase env is absent and the client falls
 *  back, so defaulting on is safe. Set either env var to "false" to opt out.
 *  The legacy NEXT_PUBLIC_USE_ELASTICSEARCH name still works. */
export function isEnrichedSearchEnabled(): boolean {
  return !(
    isDisabledEnvFlag(process.env.NEXT_PUBLIC_USE_ENRICHED_SEARCH) ||
    isDisabledEnvFlag(process.env.NEXT_PUBLIC_USE_ELASTICSEARCH)
  );
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

  if (type === 'efts') {
    searchParams.set('path', cleanPath);
    return `/api/sec-efts?${toReadableQuery(searchParams)}`;
  }

  const functionName = 'sec-proxy';
  if (type === 'data') {
    searchParams.set('upstream', 'data');
  } else {
    searchParams.set('upstream', 'proxy');
  }
  searchParams.set('path', cleanPath);
  return `/api/${functionName}?${toReadableQuery(searchParams)}`;
}

// '/' is a legal unencoded character in a query string; keeping it readable
// makes proxied EDGAR paths debuggable in logs and network panels.
function toReadableQuery(params: URLSearchParams): string {
  return params.toString().replace(/%2F/gi, '/');
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

export function extractDocumentTextFromHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return '';

  const clone = body.cloneNode(true) as HTMLElement;
  
  // Remove invisible and structural nodes
  clone.querySelectorAll('script, style, noscript, template').forEach(node => node.remove());
  clone.querySelectorAll('ix\\:header, ix\\:hidden, xbrli\\:context, xbrli\\:unit').forEach(node => node.remove());

  // Unwrap inline XBRL elements so innerText treats the text continuously
  clone.querySelectorAll('ix\\:nonnumeric, ix\\:nonfraction, ix\\:continuation').forEach(node => {
    const parent = node.parentNode;
    if (parent) {
      while (node.firstChild) {
        parent.insertBefore(node.firstChild, node);
      }
      parent.removeChild(node);
    }
  });

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
export interface CompanyDirectoryEntry {
  cik: string;
  ticker: string;
  title: string;
}

let _companyDirectory: CompanyDirectoryEntry[] | null = null;

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
      // File order is roughly market-cap descending — kept for entity resolution.
      const map: Record<string, string> = {};
      const directory: CompanyDirectoryEntry[] = [];
      for (const entry of Object.values(data) as any[]) {
        map[entry.ticker.toUpperCase()] = String(entry.cik_str);
        directory.push({
          cik: String(entry.cik_str),
          ticker: String(entry.ticker).toUpperCase(),
          title: String(entry.title || ''),
        });
      }
      _tickerCache = map;
      _companyDirectory = directory;
      return map;
    } catch (error) {
      console.error('Failed to load SEC ticker map:', error);
      return {};
    }
  })();
  return _tickerCachePromise;
}

/**
 * Resolve free text to a listed company when the ENTIRE text is a ticker or
 * a company-name prefix ("apple" → Apple Inc., "COIN" → Coinbase Global).
 * Returns null when the text doesn't read as a company — topic queries like
 * "apple revenue recognition" stay full-text searches.
 */
/**
 * Pure matching core, separated from the directory fetch so the full SEC
 * ticker corpus can be proven resolvable in unit tests (every ticker and
 * every company title in company_tickers.json must match).
 */
function normalizeCompanyText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

interface DirectoryIndex {
  byTicker: Map<string, CompanyDirectoryEntry>;
  byExactTitle: Map<string, CompanyDirectoryEntry>;
  normalizedTitles: { title: string; entry: CompanyDirectoryEntry }[];
}

// Normalizing 10K+ titles per lookup made both searches and the
// full-directory coverage test crawl — index once per directory instance.
const directoryIndexCache = new WeakMap<CompanyDirectoryEntry[], DirectoryIndex>();

function getDirectoryIndex(directory: CompanyDirectoryEntry[]): DirectoryIndex {
  const cached = directoryIndexCache.get(directory);
  if (cached) return cached;
  const byTicker = new Map<string, CompanyDirectoryEntry>();
  const byExactTitle = new Map<string, CompanyDirectoryEntry>();
  const normalizedTitles: DirectoryIndex['normalizedTitles'] = [];
  // File order is ~market-cap descending; first writer wins so "apple"
  // resolves to Apple Inc., not Apple Hospitality REIT.
  for (const entry of directory) {
    if (!byTicker.has(entry.ticker)) byTicker.set(entry.ticker, entry);
    const norm = normalizeCompanyText(entry.title);
    if (norm && !byExactTitle.has(norm)) byExactTitle.set(norm, entry);
    normalizedTitles.push({ title: norm, entry });
  }
  const index = { byTicker, byExactTitle, normalizedTitles };
  directoryIndexCache.set(directory, index);
  return index;
}

export function matchCompanyEntry(
  directory: CompanyDirectoryEntry[],
  text: string
): CompanyDirectoryEntry | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const index = getDirectoryIndex(directory);
  const wordCount = trimmed.split(/\s+/).length;
  const normalized = normalizeCompanyText(trimmed);

  // Exact ticker — short inputs only, so sentences never read as tickers
  if (wordCount <= 6) {
    const tickerHit = index.byTicker.get(trimmed.toUpperCase());
    if (tickerHit) return tickerHit;
  }

  if (normalized.length < 4) return null;
  // Exact title beats prefix ("Orange" must not resolve to Orange County
  // Bancorp); exact equality is allowed at any length (official names run
  // long). The prefix shortcut is capped so topics don't read as companies.
  const exact = index.byExactTitle.get(normalized);
  if (exact) return exact;
  if (wordCount <= 6) {
    const prefix = normalized + ' ';
    for (const { title, entry } of index.normalizedTitles) {
      if (title.startsWith(prefix)) return entry;
    }
  }
  return null;
}

export async function resolveCompanyEntity(
  text: string
): Promise<CompanyDirectoryEntry | null> {
  await loadTickerMap();
  if (!_companyDirectory) return null;
  return matchCompanyEntry(_companyDirectory, text);
}

/** Full SEC company directory (cached after first load). */
export async function getCompanyDirectory(): Promise<CompanyDirectoryEntry[]> {
  await loadTickerMap();
  return _companyDirectory || [];
}

/**
 * EDGAR full-text search matches on root_forms and silently corrupts the
 * entire forms filter when any entry carries an amendment suffix — e.g.
 * "8-K,10-K/A" returns ZERO hits where "8-K" alone returns many. Send
 * deduped root forms only; amendments share their root in EFTS, and callers
 * keep exact-form intent via client-side filtering.
 */
export function normalizeEftsForms(forms: string): string {
  return Array.from(new Set(
    forms.split(',').map(form => form.trim().replace(/\/A$/i, '')).filter(Boolean)
  )).join(',');
}

/**
 * Company suggestions for a free-text query: exact ticker, brand alias,
 * ticker prefix, then title substring — the shared ranking every search bar
 * uses. Returns nothing for text that doesn't read as a company.
 */
export function computeCompanySuggestions(
  directory: CompanyDirectoryEntry[],
  text: string,
  limit = 8
): CompanyDirectoryEntry[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.split(/\s+/).length > 4 || directory.length === 0) return [];
  const upper = trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  const seen = new Set<string>();
  const matches: CompanyDirectoryEntry[] = [];
  const push = (entry: CompanyDirectoryEntry | undefined) => {
    if (entry && !seen.has(entry.ticker)) {
      seen.add(entry.ticker);
      matches.push(entry);
    }
  };
  push(directory.find(entry => entry.ticker === upper));
  const alias = aliasTickerFor(upper);
  if (alias) push(directory.find(entry => entry.ticker === alias));
  for (const entry of directory) {
    if (matches.length >= limit) break;
    if (entry.ticker.startsWith(upper)) push(entry);
  }
  if (lower.length >= 3) {
    for (const entry of directory) {
      if (matches.length >= limit) break;
      if (entry.title.toLowerCase().includes(lower)) push(entry);
    }
  }
  return matches.slice(0, limit);
}

/**
 * Brand names that don't match the SEC registrant name ("Google" filed as
 * Alphabet Inc.). Alias targets are re-validated against the live directory
 * at resolve time, so a delisting can never leave a dangling redirect.
 */
const COMPANY_BRAND_ALIASES: Record<string, string> = {
  GOOGLE: 'GOOGL',
  YOUTUBE: 'GOOGL',
  FACEBOOK: 'META',
  INSTAGRAM: 'META',
  WHATSAPP: 'META',
};

export function aliasTickerFor(text: string): string | null {
  const key = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return COMPANY_BRAND_ALIASES[key] || null;
}

/**
 * Resolve anything a user types into a company field — ticker, company name,
 * or household brand — to a directory entry. Every add-company surface goes
 * through this so name tolerance is the default, not per-page behavior.
 */
export async function resolveCompanyInput(
  text: string
): Promise<CompanyDirectoryEntry | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  await loadTickerMap();
  if (!_companyDirectory) return null;
  const direct = matchCompanyEntry(_companyDirectory, trimmed);
  if (direct) return direct;
  const alias = aliasTickerFor(trimmed);
  return alias ? matchCompanyEntry(_companyDirectory, alias) : null;
}

/**
 * Reliable link to a filing's index page — lists every document in the filing.
 * Prefer this over cgi-bin/browse-edgar?accession=… which lands on a search
 * page rather than the filing itself.
 */
export function buildSecFilingIndexUrl(cik: string | number, accessionNumber: string): string {
  const cleanAccession = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${cleanAccession}/${accessionNumber}-index.htm`;
}

/**
 * True when a result's "primary document" is really the master.idx submission
 * path a facet-store row carries — an Archives URL built from it always 404s.
 */
export function isPlaceholderPrimaryDocument(doc: string, accessionNumber: string): boolean {
  return doc.startsWith('edgar/') || doc === `${accessionNumber}.txt`;
}

const primaryDocumentCache = new Map<string, Promise<string>>();

/**
 * Resolve the real primary document for a filing: submissions API first,
 * then the Archives directory listing (largest HTML) for filings that have
 * fallen out of the submissions recent window.
 */
export function resolvePrimaryDocumentPath(cik: string, accessionNumber: string): Promise<string> {
  const key = `${cik}:${accessionNumber}`;
  const cached = primaryDocumentCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const submissions = await fetchCompanySubmissions(cik);
      if (submissions) {
        const recent = submissions.filings.recent;
        const index = recent.accessionNumber.indexOf(accessionNumber);
        if (index !== -1 && recent.primaryDocument[index]) return recent.primaryDocument[index];
      }
      const response = await fetch(
        buildSecProxyUrl(`Archives/edgar/data/${cik}/${accessionNumber.replace(/-/g, '')}/index.json`),
        { headers: getHeaders() }
      );
      if (response.ok) {
        const listing = await response.json() as { directory?: { item?: Array<{ name?: string; size?: string }> } };
        const items = (listing.directory?.item || []).filter(item => !/index/i.test(item.name || ''));
        const bySize = (docs: typeof items) => docs.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
        const htmlDocs = bySize(items.filter(item => /\.html?$/i.test(item.name || '')));
        if (htmlDocs[0]?.name) return htmlDocs[0].name;
        // Comment letters and older submissions are often PDF-only.
        const pdfDocs = bySize(items.filter(item => /\.pdf$/i.test(item.name || '')));
        return pdfDocs[0]?.name || '';
      }
    } catch (error) {
      console.error('Primary document resolution failed:', error);
    }
    return '';
  })();
  primaryDocumentCache.set(key, promise);
  return promise;
}

/**
 * Ticker-or-name-tolerant CIK lookup for user-typed input. Exact tickers stay
 * exact; anything else resolves through the company directory and brand aliases.
 */
export async function lookupCIKFlexible(input: string): Promise<string | null> {
  const resolved = await resolveCompanyInput(input);
  if (resolved) return resolved.cik.padStart(10, '0');
  return lookupCIK(input);
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

export interface SecFilingSeries {
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
    recent: SecFilingSeries;
    files?: Array<{
      name: string;
      filingCount?: number;
      filingFrom?: string;
      filingTo?: string;
    }>;
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

/** Fetch one official SEC historical-submissions segment referenced by filings.files. */
export async function fetchSubmissionHistory(fileName: string): Promise<SecFilingSeries | null> {
  const safeName = fileName.trim().replace(/^\/+/, '');
  if (!safeName || safeName.includes('..')) return null;

  if (!submissionHistoryCache.has(safeName)) {
    submissionHistoryCache.set(safeName, (async () => {
      try {
        const response = await fetch(buildSecDataUrl(`submissions/${safeName}`), { headers: getHeaders() });
        if (!response.ok) throw new Error(`SEC submission history error: ${response.status}`);
        const payload = await response.json() as Partial<SecFilingSeries>;
        return Array.isArray(payload.accessionNumber) ? payload as SecFilingSeries : null;
      } catch (error) {
        submissionHistoryCache.delete(safeName);
        console.error('Failed to fetch SEC submission history:', error);
        return null;
      }
    })());
  }
  return submissionHistoryCache.get(safeName)!;
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
  sic?: number;
  sicDescription?: string;
  facts: {
    'us-gaap'?: Record<string, { label: string; description: string; units: Record<string, XbrlFact[]> }>;
    'ifrs-full'?: Record<string, { label: string; description: string; units: Record<string, XbrlFact[]> }>;
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
  // InterestIncomeExpenseNet deliberately excluded: it is NET interest income,
  // not total bank revenue — using it grossly overstates margins for banks.
  'Revenues': ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense', 'InterestAndDividendIncomeOperating'],
  'CostOfRevenue': ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfRealEstateRevenue'],
  'GrossProfit': ['GrossProfit', 'GrossProfitLoss'],
  // Pre-tax-income concepts deliberately excluded as fallbacks: pre-tax income
  // (after interest/other items) relabeled "operating income" silently inflates
  // operating margin for filers that don't tag OperatingIncomeLoss. Blank is honest.
  'OperatingIncome': ['OperatingIncomeLoss'],
  'NetIncome': ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLossAvailableToCommonStockholdersDiluted', 'ProfitLoss'],
  'EarningsPerShare': ['EarningsPerShareBasic'],
  'EarningsPerShareDiluted': ['EarningsPerShareDiluted'],
  'ResearchAndDevelopment': ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost', 'TechnologyAndContentExpense'],
  'SellingGeneralAdmin': ['SellingGeneralAndAdministrativeExpense'],

  // Balance Sheet
  'TotalAssets': ['Assets'],
  'TotalLiabilities': ['Liabilities', 'LiabilitiesNoncurrentAndFinanceLeaseObligationsNoncurrent'],
  'StockholdersEquity': ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  'CashAndEquivalents': ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsAndShortTermInvestments', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  // Only concepts that already represent TOTAL debt. Long-term-only and
  // short-term-only components must never pass as "total debt" — they are
  // summed in extractComparableFinancials instead (first-match here used to
  // return bare LongTermDebt and silently understate leverage).
  'TotalDebt': ['DebtLongtermAndShorttermCombinedAmount'],
  'Goodwill': ['Goodwill', 'GoodwillNet'],
  'IntangibleAssets': [
    'IntangibleAssetsNetExcludingGoodwill',
    'FiniteLivedIntangibleAssetsNet',
    'IndefiniteLivedIntangibleAssetsExcludingGoodwill',
    'OtherIntangibleAssetsNet',
    'AmortizableIntangibleAssetsNet',
  ],
  'AccountsReceivable': ['AccountsReceivableNetCurrent', 'AccountsReceivableNet', 'ReceivablesNetCurrent', 'AccountsNotesAndLoansReceivableNetCurrent', 'AccruedInvestmentIncomeReceivable', 'PremiumsReceivableAtCarryingValue'],
  'Inventory': ['InventoryNet', 'Inventories', 'InventoriesNetOfReserves', 'InventoryAndServicePartsNet', 'InventoryFinishedGoods', 'InventoryGross', 'InventoryNetOfAllowancesCustomerAdvancesAndProgressBillings', 'RealEstateInventory'],
  'CurrentAssets': ['AssetsCurrent'],
  'CurrentLiabilities': ['LiabilitiesCurrent'],

  // Cash Flow
  'OperatingCashFlow': ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  'CapitalExpenditures': ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquireOilAndGasPropertyAndEquipment', 'PaymentsForCapitalImprovements', 'PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PaymentsToAcquireMachineryAndEquipment'],
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
  /** ISO 4217 currency code (e.g. 'USD', 'EUR', 'GBP'). Defaults to 'USD'. */
  currency?: string;
  /** Actual fiscal period end (YYYY-MM-DD) — surfaces FYE misalignment when
   *  benchmarking companies with different fiscal calendars. */
  periodEnd?: string;
}

/** Currency symbols for display */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
  CAD: 'CA$', AUD: 'A$', CHF: 'CHF ', SEK: 'kr', NOK: 'kr',
  DKK: 'kr', INR: '₹', KRW: '₩', BRL: 'R$', ZAR: 'R',
  SGD: 'S$', HKD: 'HK$', TWD: 'NT$', MXN: 'MX$', ILS: '₪',
};

/**
 * Detect the primary reporting currency from company facts.
 * Returns 'USD' if the company reports in USD, otherwise the
 * dominant non-USD monetary unit (e.g. 'DKK', 'EUR', 'GBP').
 */
export function getPrimaryCurrency(facts: CompanyFacts): string {
  // If us-gaap namespace exists with USD data, it's a USD filer
  const usGaap = facts.facts['us-gaap'];
  if (usGaap) {
    const rev = usGaap['Revenues'] || usGaap['RevenueFromContractWithCustomerExcludingAssessedTax'];
    if (rev?.units['USD']?.length) return 'USD';
  }

  // For IFRS filers, find the most common monetary unit
  const ifrs = facts.facts['ifrs-full'];
  if (ifrs) {
    const unitCounts: Record<string, number> = {};
    // Sample a few key concepts
    const probes = ['Revenue', 'Assets', 'ProfitLoss', 'CostOfSales', 'Equity'];
    for (const name of probes) {
      const concept = ifrs[name] as { units: Record<string, XbrlFact[]> } | undefined;
      if (!concept) continue;
      for (const [unit, unitFacts] of Object.entries(concept.units)) {
        // Skip non-monetary units
        if (['shares', 'pure', 'employee', 'Employee', 'Y', 'Years',
             'numberOfEmployees', 'segment', 'security', 'state',
             'branch', 'hedge_fund', 'Options'].includes(unit)) continue;
        if (unit.includes('/shares')) continue;
        unitCounts[unit] = (unitCounts[unit] || 0) + (unitFacts as XbrlFact[]).length;
      }
    }
    const sorted = Object.entries(unitCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) return sorted[0][0];
  }

  return 'USD';
}

function normalizeAnnualForm(form: string): string {
  return form.trim().toUpperCase().replace(/\s+/g, '').replace(/\/A$/, '');
}

function isLikelyAnnualFact(fact: XbrlFact): boolean {
  const form = normalizeAnnualForm(fact.form || '');
  const isAnnualForm = ['10-K', '10-KT', '20-F', '40-F'].includes(form);
  if (!isAnnualForm) return false;

  // For facts with date ranges, verify it spans a full year (~300+ days)
  if (fact.start && fact.end) {
    const start = Date.parse(fact.start);
    const end = Date.parse(fact.end);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      const days = Math.abs(end - start) / (1000 * 60 * 60 * 24);
      return days >= 300;
    }
  }

  // Balance sheet items (instant facts) have no start date — accept if FY/CY
  const fp = (fact.fp || '').toUpperCase();
  if (!fp || fp === 'FY' || fp === 'CY') {
    return true;
  }

  return false;
}

/**
 * Determine the fiscal year a fact belongs to based on its end date.
 * This is more reliable than the `fy` field, which represents the filing year
 * and can differ from the actual fiscal year for companies with non-calendar FYs.
 */
function getFiscalYearFromFact(fact: XbrlFact): number {
  // Use end date if available (most reliable). Read the year straight from the
  // ISO string — new Date('yyyy-mm-dd').getFullYear() mixes UTC parsing with
  // local-time reading, shifting Jan-1/Dec-31 period ends by a year for
  // UTC-negative users.
  if (fact.end) {
    const year = Number(fact.end.slice(0, 4));
    if (Number.isFinite(year) && year > 1900) return year;
  }
  // Fall back to fy field
  return fact.fy;
}

/**
 * Deduplicate annual facts by fiscal year (end-date based).
 * When the same period appears in multiple filings (comparative years,
 * amendments, restatements), keep the most recently FILED version — a
 * restated 10-K/A value must beat the original 10-K's.
 */
function deduplicateAnnualFacts(facts: XbrlFact[]): XbrlFact[] {
  const byFiscalYear = new Map<number, XbrlFact>();
  for (const fact of facts) {
    const fiscalYear = getFiscalYearFromFact(fact);
    const existing = byFiscalYear.get(fiscalYear);
    if (!existing || isMoreAuthoritativeFact(fact, existing)) {
      byFiscalYear.set(fiscalYear, fact);
    }
  }
  return Array.from(byFiscalYear.values()).sort(
    (a, b) => getFiscalYearFromFact(b) - getFiscalYearFromFact(a)
  );
}

/** Latest filed date wins; on the same filed date an amendment (/A) beats the
 *  original. The `fy` field alone cannot distinguish a 10-K from its 10-K/A. */
function isMoreAuthoritativeFact(candidate: XbrlFact, incumbent: XbrlFact): boolean {
  const candidateFiled = candidate.filed || '';
  const incumbentFiled = incumbent.filed || '';
  if (candidateFiled !== incumbentFiled) {
    if (candidateFiled && incumbentFiled) return candidateFiled > incumbentFiled;
    // Only one side has a filed date — fall back to fy comparison below
  }
  const candidateIsAmendment = /\/A$/i.test((candidate.form || '').trim());
  const incumbentIsAmendment = /\/A$/i.test((incumbent.form || '').trim());
  if (candidateIsAmendment !== incumbentIsAmendment) return candidateIsAmendment;
  return candidate.fy > incumbent.fy;
}

function getPreferredUnits(concept: { units: Record<string, XbrlFact[]> }, currency?: string): { unitKey: string; facts: XbrlFact[] } | null {
  // Build preference list: requested currency first, then USD, then per-share, then any monetary
  const preferred: string[] = [];
  if (currency && currency !== 'USD') {
    preferred.push(currency, `${currency}/shares`);
  }
  preferred.push('USD', 'USD/shares', 'shares');

  for (const unitKey of preferred) {
    const facts = concept.units[unitKey];
    if (facts && facts.length > 0) {
      return { unitKey, facts };
    }
  }

  // Fallback: any unit with data (but skip non-monetary like 'pure', 'employee', etc.)
  const fallback = Object.entries(concept.units).find(([key, facts]) =>
    Array.isArray(facts) && facts.length > 0 &&
    !['pure', 'employee', 'Employee', 'Y', 'Years', 'numberOfEmployees',
      'segment', 'security', 'state', 'branch', 'hedge_fund', 'Options'].includes(key)
  );
  return fallback ? { unitKey: fallback[0], facts: fallback[1] } : null;
}

/**
 * Returns a sorted list (newest first) of fiscal years that have annual 10-K data.
 */
export function getAvailableYears(facts: CompanyFacts): number[] {
  const years = new Set<number>();
  // Probe across us-gaap and ifrs-full namespaces
  const gaapProbes = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'Assets', 'NetIncomeLoss'];
  const ifrsProbes = ['Revenue', 'Assets', 'ProfitLoss'];
  const namespaces: [Record<string, unknown> | undefined, string[]][] = [
    [facts.facts['us-gaap'], gaapProbes],
    [facts.facts['ifrs-full'], ifrsProbes],
  ];
  const currency = getPrimaryCurrency(facts);
  for (const [ns, probes] of namespaces) {
    if (!ns) continue;
    for (const conceptName of probes) {
      const concept = ns[conceptName] as { units: Record<string, XbrlFact[]> } | undefined;
      if (!concept) continue;
      const preferred = getPreferredUnits(concept, currency);
      if (!preferred) continue;
      // Use end-date-based fiscal year for reliable year discovery
      preferred.facts
        .filter(isLikelyAnnualFact)
        .forEach(f => years.add(getFiscalYearFromFact(f)));
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Extract the most recent annual (10-K / FY) value for each key financial concept.
 * Pass a specific `year` to extract data for that fiscal year instead of the latest.
 */
// IFRS concept mapping — maps our metric keys to ifrs-full concept names
const IFRS_CONCEPTS: Record<string, string[]> = {
  'Revenues': ['Revenue', 'RevenueFromContractsWithCustomers', 'RevenueFromSaleOfGoods', 'RevenueFromRenderingOfServices'],
  'CostOfRevenue': ['CostOfSales', 'CostOfMerchandiseSold'],
  'GrossProfit': ['GrossProfit'],
  // ProfitLossBeforeTax excluded: pre-tax income is not operating income
  'OperatingIncome': ['ProfitLossFromOperatingActivities'],
  'NetIncome': ['ProfitLoss', 'ProfitLossAttributableToOwnersOfParent', 'ProfitLossAttributableToOrdinaryEquityHoldersOfParentEntity'],
  'EarningsPerShare': ['BasicEarningsLossPerShare', 'BasicEarningsLossPerShareFromContinuingOperations'],
  'EarningsPerShareDiluted': ['DilutedEarningsLossPerShare', 'DilutedEarningsLossPerShareFromContinuingOperations'],
  'ResearchAndDevelopment': ['ResearchAndDevelopmentExpense'],
  'SellingGeneralAdmin': ['SellingGeneralAndAdministrativeExpense', 'AdministrativeExpense', 'DistributionCosts', 'SellingExpense'],
  'TotalAssets': ['Assets'],
  'TotalLiabilities': ['Liabilities', 'NoncurrentLiabilities'],
  'StockholdersEquity': ['Equity', 'EquityAttributableToOwnersOfParent'],
  'CashAndEquivalents': ['CashAndCashEquivalents', 'Cash'],
  // Borrowings is the IFRS total; noncurrent-only components are summed in
  // extractComparableFinancials, not passed off as totals
  'TotalDebt': ['Borrowings'],
  'Goodwill': ['Goodwill'],
  'IntangibleAssets': ['IntangibleAssetsOtherThanGoodwill', 'OtherIntangibleAssets'],
  'AccountsReceivable': ['TradeAndOtherCurrentReceivables', 'TradeReceivables', 'CurrentTradeReceivables'],
  'Inventory': ['Inventories', 'CurrentInventories'],
  'CurrentAssets': ['CurrentAssets'],
  'CurrentLiabilities': ['CurrentLiabilities'],
  'OperatingCashFlow': ['CashFlowsFromUsedInOperatingActivities', 'CashFlowsFromUsedInOperations'],
  'CapitalExpenditures': ['PurchaseOfPropertyPlantAndEquipment', 'AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment'],
  'DividendsPaid': ['DividendsPaid', 'DividendsPaidClassifiedAsFinancingActivities', 'DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities'],
  'ShareRepurchases': ['PaymentsToAcquireOrRedeemEntitysShares'],
  'StockCompensation': ['SharebasedPaymentExpense'],
  'IncomeTaxExpense': ['IncomeTaxExpenseContinuingOperations', 'CurrentTaxExpenseIncome'],
};

export function extractFinancials(facts: CompanyFacts, year?: number): Record<string, FinancialMetric> {
  const result: Record<string, FinancialMetric> = {};
  // Try us-gaap first, then ifrs-full
  const usGaap = facts.facts['us-gaap'];
  const ifrs = facts.facts['ifrs-full'];
  if (!usGaap && !ifrs) return result;

  const currency = getPrimaryCurrency(facts);

  for (const [metricKey, conceptAliases] of Object.entries(FINANCIAL_CONCEPTS)) {
    // Build combined alias list: us-gaap aliases + IFRS aliases
    const allAliases: { ns: Record<string, unknown>; name: string }[] = [];
    if (usGaap) {
      for (const name of conceptAliases) allAliases.push({ ns: usGaap, name });
    }
    if (ifrs && IFRS_CONCEPTS[metricKey]) {
      for (const name of IFRS_CONCEPTS[metricKey]) allAliases.push({ ns: ifrs as Record<string, unknown>, name });
    }

    for (const { ns, name: conceptName } of allAliases) {
      const concept = ns[conceptName] as { label: string; units: Record<string, XbrlFact[]> } | undefined;
      if (!concept) continue;

      // Find available facts using currency-aware unit selection
      const preferred = getPreferredUnits(concept, currency);
      if (!preferred) continue;

      // Filter to annual filings and deduplicate by fiscal year (end-date based)
      const annualFacts = deduplicateAnnualFacts(preferred.facts.filter(isLikelyAnnualFact));

      // Match by end-date fiscal year for reliability
      const match = year != null
        ? annualFacts.find(f => getFiscalYearFromFact(f) === year)
        : annualFacts[0];

      if (match) {
        // Determine the actual currency from the unit key
        const unitKey = preferred.unitKey;
        const isPerShare = unitKey.includes('/shares');
        const detectedCurrency = isPerShare ? unitKey.replace('/shares', '') : unitKey;

        result[metricKey] = {
          label: concept.label,
          value: match.val,
          year: getFiscalYearFromFact(match),
          period: match.fp || 'FY',
          unit: unitKey,
          currency: detectedCurrency === 'shares' ? 'USD' : detectedCurrency,
          periodEnd: match.end || undefined,
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
  // Search across us-gaap and ifrs-full namespaces
  const namespaces = [facts.facts['us-gaap'], facts.facts['ifrs-full']].filter(Boolean);
  if (namespaces.length === 0) return null;

  const currency = getPrimaryCurrency(facts);

  for (const ns of namespaces) {
    for (const alias of aliases) {
      const concept = ns![alias] as { label: string; units: Record<string, XbrlFact[]> } | undefined;
      if (!concept) continue;

      const preferredUnits = getPreferredUnits(concept, currency);
      if (!preferredUnits) continue;

      const annualFacts = deduplicateAnnualFacts(
        preferredUnits.facts.filter(isLikelyAnnualFact)
      );

      const match = year != null
        ? annualFacts.find(item => getFiscalYearFromFact(item) === year)
        : annualFacts[0];

      if (!match) continue;

      const unitKey = preferredUnits.unitKey;
      const isPerShare = unitKey.includes('/shares');
      const detectedCurrency = isPerShare ? unitKey.replace('/shares', '') : unitKey;

      return {
        label: concept.label,
        value: match.val,
        year: getFiscalYearFromFact(match),
        period: match.fp || 'FY',
        unit: preferredUnits.unitKey,
        currency: detectedCurrency === 'shares' ? 'USD' : detectedCurrency,
        periodEnd: match.end || undefined,
      };
    }
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

  // Derive Total Debt by summing components for the SAME fiscal year.
  // LongTermDebt (us-gaap) includes current maturities; LongTermDebtNoncurrent
  // does not — pick one base to avoid double counting, then add short-term
  // borrowings. Never present a single component as the total.
  if (!result.TotalDebt) {
    const noncurrent = lookupAnnualMetric(facts, [
      'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent', 'NoncurrentBorrowings',
    ], year);
    const totalLongTerm = lookupAnnualMetric(facts, [
      'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations',
    ], year);
    const base = noncurrent ?? totalLongTerm;
    if (base?.value != null) {
      const baseYear = base.year;
      const currentPortion = noncurrent
        ? lookupAnnualMetric(facts, [
            'LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'CurrentBorrowings',
          ], baseYear)
        : null;
      const shortTerm = lookupAnnualMetric(facts, [
        'ShortTermBorrowings', 'ShortTermDebt', 'CommercialPaper',
      ], baseYear);
      const components = ['long-term'];
      if (currentPortion?.value != null) components.push('current portion');
      if (shortTerm?.value != null) components.push('short-term');
      result.TotalDebt = {
        label: `Total Debt (derived: ${components.join(' + ')})`,
        value: base.value + (currentPortion?.value ?? 0) + (shortTerm?.value ?? 0),
        year: baseYear,
        period: base.period,
        unit: base.unit,
        currency: base.currency,
      };
    }
  }
  fillIfMissing('AccountsReceivable', ['ReceivablesNetCurrent', 'AccountsNotesAndLoansReceivableNetCurrent']);
  fillIfMissing('Inventory', ['InventoriesNetOfReserves', 'InventoryFinishedGoods', 'InventoryNetOfAllowancesCustomerAdvancesAndProgressBillings']);
  fillIfMissing('IntangibleAssets', [
    'FiniteLivedIntangibleAssetsNet',
    'IndefiniteLivedIntangibleAssetsExcludingGoodwill',
    'IndefiniteLivedIntangibleAssetsNetExcludingGoodwill',
    'OtherIntangibleAssetsNet',
    'AmortizableIntangibleAssetsNet',
  ]);

  if (!result.GrossProfit && result.Revenues?.value != null && result.CostOfRevenue?.value != null
      && result.Revenues.year === result.CostOfRevenue.year) {
    result.GrossProfit = {
      label: 'Gross Profit (derived)',
      value: result.Revenues.value - result.CostOfRevenue.value,
      year: result.Revenues.year,
      period: result.Revenues.period,
      unit: result.Revenues.unit,
      currency: result.Revenues.currency,
    };
  }

  // Derive SG&A from G&A + Selling/Marketing when combined concept is unavailable
  if (!result.SellingGeneralAdmin) {
    const ga = lookupAnnualMetric(facts, ['GeneralAndAdministrativeExpense'], year);
    const sm = lookupAnnualMetric(facts, [
      'SellingAndMarketingExpense', 'SellingExpense', 'MarketingExpense',
      'MarketingAndAdvertisingExpense',
    ], year);
    if (ga?.value != null && sm?.value != null && ga.year === sm.year) {
      result.SellingGeneralAdmin = {
        label: 'SG&A (derived: G&A + Selling)',
        value: ga.value + sm.value,
        year: ga.year,
        period: ga.period,
        unit: ga.unit,
        currency: ga.currency,
      };
    } else if (ga?.value != null) {
      result.SellingGeneralAdmin = ga;
    } else if (sm?.value != null) {
      result.SellingGeneralAdmin = sm;
    }
    // Fallback: NoninterestExpense for banks/financials
    if (!result.SellingGeneralAdmin) {
      const nie = lookupAnnualMetric(facts, ['NoninterestExpense'], year);
      if (nie?.value != null) {
        result.SellingGeneralAdmin = { ...nie, label: 'Noninterest Expense (bank proxy for SG&A)' };
      }
    }
  }

  // Derive Total Liabilities from Assets - Equity when not directly available.
  // Assets includes noncontrolling interests, so the equity side must too —
  // subtracting parent-only equity overstates liabilities by the NCI amount.
  if (!result.TotalLiabilities && result.TotalAssets?.value != null) {
    const equityInclNci = lookupAnnualMetric(facts, [
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'Equity',
    ], result.TotalAssets.year) ?? result.StockholdersEquity;
    if (equityInclNci?.value != null && equityInclNci.year === result.TotalAssets.year) {
      result.TotalLiabilities = {
        label: 'Total Liabilities (derived: Assets - Equity)',
        value: result.TotalAssets.value - equityInclNci.value,
        year: result.TotalAssets.year,
        period: result.TotalAssets.period,
        unit: result.TotalAssets.unit,
        currency: result.TotalAssets.currency,
      };
    }
  }

  if (!result.IntangibleAssets && result.Goodwill?.value != null) {
    const grossIntangibles = lookupAnnualMetric(facts, ['IntangibleAssetsNetIncludingGoodwill'], year);
    if (grossIntangibles?.value != null && grossIntangibles.year === result.Goodwill.year) {
      result.IntangibleAssets = {
        label: 'Intangible Assets (derived ex. goodwill)',
        value: grossIntangibles.value - result.Goodwill.value,
        year: grossIntangibles.year,
        period: grossIntangibles.period,
        unit: grossIntangibles.unit,
        currency: grossIntangibles.currency,
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
    sic?: string[] | string;
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
    total: { value: number; relation?: 'eq' | 'gte' };
  };
  meta?: {
    candidateCoverage?: { examined: number; upstreamTotal: number; complete: boolean };
  };
}

export interface SearchCandidateCoverage {
  examined: number;
  upstreamTotal: number;
  complete: boolean;
}

export interface EnrichedSearchParams {
  auditor?: string;
  acceleratedStatus?: string;
  sicCode?: string;
  useEnrichedSearch?: boolean;
  onDegraded?: (reason: string) => void;
  onCoverage?: (coverage: SearchCandidateCoverage) => void;
  /** Resolved issuer CIK. EFTS text searches filter reliably by `ciks`;
   *  entityName strings with punctuation ("Organon & Co.") mismatch. */
  entityCik?: string;

}

/** EDGAR full-text search coverage starts 2001; don't silently narrow undated queries. */
const EDGAR_FTS_FLOOR = '2001-01-01';
/** EDGAR EFTS serves a fixed ~10 hits per page regardless of any requested size. */
const EFTS_PAGE_SIZE = 10;
/** EFTS refuses from+size beyond the 10,000-result window. */
const EFTS_MAX_WINDOW = 10_000;

/**
 * Search filings via the enriched candidate endpoint when available, otherwise fall back to EDGAR EFTS.
 */
async function searchViaEnrichedSearch(
  query: string,
  forms: string,
  startDate: string,
  endDate: string,
  entityName: string,
  maxResults: number,
  extended: EnrichedSearchParams = {}
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
  if (extended.entityCik) params.set('cik', extended.entityCik);
  if (extended.auditor) params.set('auditor', extended.auditor);
  if (extended.sicCode) params.set('sicCode', extended.sicCode);

  const results: EdgarSearchHit[] = [];
  const seenIds = new Set<string>();
  let totalHits = Number.POSITIVE_INFINITY;
  let totalRelation: 'eq' | 'gte' = 'eq';
  let aggregateCoverage: SearchCandidateCoverage | null = null;
  // /api/es-search intentionally exposes a 100-row page contract.
  const pageSize = Math.min(maxResults, 100);

  for (let offset = 0; offset < maxResults && results.length < maxResults && (totalRelation === 'gte' || offset < totalHits);) {
    const requestedPageSize = Math.min(pageSize, maxResults - results.length);
    params.set('from', String(offset));
    params.set('size', String(requestedPageSize));

    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`/api/es-search?${params.toString()}`);
      if (response.ok) break;
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await delay(250 * (2 ** attempt));
        continue;
      }
      throw new Error(`Enriched search error: ${response.status}`);
    }

    if (!response?.ok) throw new Error('Enriched search error: no successful response');
    const data: EdgarSearchResult = await response.json();
    const pageHits = data.hits?.hits || [];
    totalHits = data.hits?.total?.value || pageHits.length;
    totalRelation = data.hits?.total?.relation || 'eq';
    if (data.meta?.candidateCoverage) {
      const coverage = data.meta.candidateCoverage;
      aggregateCoverage = aggregateCoverage
        ? {
            examined: Math.max(aggregateCoverage.examined, coverage.examined),
            upstreamTotal: Math.max(aggregateCoverage.upstreamTotal, coverage.upstreamTotal),
            complete: aggregateCoverage.complete && coverage.complete,
          }
        : coverage;
      extended.onCoverage?.(aggregateCoverage);
    }

    for (const hit of pageHits) {
      if (seenIds.has(hit._id)) continue;
      seenIds.add(hit._id);
      results.push(hit);
      if (results.length >= maxResults) break;
    }

    if (pageHits.length === 0) break;
    offset += pageHits.length;
    if (pageHits.length < requestedPageSize) break;
    if (offset < maxResults) await delay(50);
  }

  return results;
}

/**
 * Search EDGAR full-text search for specific form types.
 * Routes through enriched search only when the caller opts in and NEXT_PUBLIC_USE_ENRICHED_SEARCH is enabled.
 */
export async function searchEdgarFilings(
  query: string,
  forms: string = 'S-1',
  startDate?: string,
  endDate?: string,
  entityName?: string,
  maxResults = 100,
  extended: EnrichedSearchParams = {}
): Promise<EdgarSearchHit[]> {
  const shouldUseEnrichedSearch = extended.useEnrichedSearch === true && isEnrichedSearchEnabled();

  if (shouldUseEnrichedSearch) {
    // Enrichment is an optimization, never a hard dependency: on failure or an empty
    // index, fall through to live EDGAR EFTS so the user still gets results.
    try {
      const enrichedResults = await searchViaEnrichedSearch(
        query,
        forms,
        startDate || EDGAR_FTS_FLOOR,
        endDate || new Date().toISOString().split('T')[0],
        entityName || '',
        maxResults,
        extended
      );
      if (enrichedResults.length > 0) return enrichedResults;
      console.warn('[search] Enriched search returned 0 hits; falling back to EDGAR EFTS');
      extended.onDegraded?.('Enriched candidate search returned no hits; live SEC EDGAR fallback is in use.');
    } catch (error) {
      console.error('[search] Enriched search failed; falling back to EDGAR EFTS:', error);
      extended.onDegraded?.('Enriched candidate search is unavailable; live SEC EDGAR fallback is in use.');
    }
  }
  // EFTS rejects an empty q: an entity-resolved browse ("OGN 10-K" → issuer
  // + cleared text) reached here as q='' and silently returned zero results.
  // Quote the issuer name as the text query so the legacy lane still works.
  const effectiveQuery = query.trim() || (entityName ? `"${entityName.trim()}"` : query);
  const baseParams = new URLSearchParams({
    q: effectiveQuery,
    forms: normalizeEftsForms(forms),
    dateRange: 'custom',
    startdt: startDate || EDGAR_FTS_FLOOR,
    enddt: endDate || new Date().toISOString().split('T')[0],
  });
  if (entityName) baseParams.set('entityName', entityName);
  if (extended.entityCik) {
    // CIK beats a display-name match on the EFTS side — names with
    // punctuation ("Organon & Co.") silently miss the entity filter.
    baseParams.set('ciks', extended.entityCik.padStart(10, '0'));
    baseParams.delete('entityName');
  }

  const cacheKey = `${baseParams.toString()}|max=${maxResults}`;
  if (!edgarSearchCache.has(cacheKey)) {
    edgarSearchCache.set(cacheKey, (async () => {
      try {
        const results: EdgarSearchHit[] = [];
        const seenIds = new Set<string>();
        let totalHits = Number.POSITIVE_INFINITY;
        let totalRelation: 'eq' | 'gte' = 'eq';
        let exhaustedUpstream = false;

        // EFTS ignores large size requests and always returns ~10 hits/page, so
        // page with from += actual-hits-received; anything else truncates recall
        // to a single page (results 10..N were previously never fetched).
        let offset = 0;
        while (results.length < maxResults && offset < totalHits && offset < EFTS_MAX_WINDOW) {
          const params = new URLSearchParams(baseParams);
          params.set('from', String(offset));
          params.set('size', String(EFTS_PAGE_SIZE));

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
              totalRelation = data.hits?.total?.relation || 'eq';
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
          for (const hit of pageHits) {
            if (seenIds.has(hit._id)) continue;
            seenIds.add(hit._id);
            results.push(hit);
            if (results.length >= maxResults) {
              break;
            }
          }

          if (pageHits.length === 0) {
            exhaustedUpstream = true;
            break;
          }
          offset += pageHits.length;

          if (results.length < maxResults && offset < totalHits) {
            await delay(180);
          }
        }

        // Sort results newest-first by file date
        results.sort((a, b) => {
          const dateA = a._source?.file_date || '';
          const dateB = b._source?.file_date || '';
          return dateB.localeCompare(dateA);
        });
        const finiteTotal = Number.isFinite(totalHits) ? totalHits : results.length;
        const upstreamTotal = Math.max(finiteTotal, results.length);
        const complete = exhaustedUpstream || (
          totalRelation === 'eq' && results.length >= upstreamTotal && upstreamTotal <= EFTS_MAX_WINDOW
        );
        return {
          hits: results,
          coverage: {
            examined: results.length,
            upstreamTotal,
            complete,
          },
        };
      } catch (error) {
        edgarSearchCache.delete(cacheKey);
        console.error('EDGAR search failed:', error);
        throw error instanceof Error ? error : new Error('EDGAR search failed');
      }
    })());
  }

  const cached = await edgarSearchCache.get(cacheKey)!;
  extended.onCoverage?.(cached.coverage);
  return cached.hits;
}

/** Read the authoritative total for an EDGAR EFTS query without pretending
 * the bounded hit array is the population size. */
export async function fetchEdgarSearchTotal(
  query: string,
  forms: string,
  startDate?: string,
  endDate?: string,
  entityName?: string
): Promise<{ value: number; relation: 'eq' | 'gte' }> {
  const params = new URLSearchParams({
    q: query,
    forms,
    dateRange: 'custom',
    startdt: startDate || EDGAR_FTS_FLOOR,
    enddt: endDate || new Date().toISOString().split('T')[0],
    from: '0',
    size: '10',
  });
  if (entityName) params.set('entityName', entityName);
  const response = await fetch(buildSecEftsUrl('LATEST/search-index', params), { headers: getHeaders() });
  if (!response.ok) throw new Error(`EDGAR total search error: ${response.status}`);
  const data = await response.json() as EdgarSearchResult;
  return {
    value: Number(data.hits?.total?.value || 0),
    relation: data.hits?.total?.relation || 'eq',
  };
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
    const cleanAccession = accessionNumber.replace(/\D/g, '');
    const cik = cleanAccession.slice(0, 10).replace(/^0+/, '') || '0';
    if (cleanAccession.length < 18) return [];

    const archivePath = `Archives/edgar/data/${cik}/${cleanAccession}`;
    const response = await fetch(buildSecProxyUrl(`${archivePath}/index.json`), {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error(`Filing index Error: ${response.statusText}`);
    const payload = await response.json() as {
      directory?: { item?: Array<{ name?: string; type?: string; size?: number | string }> };
    };
    return (payload.directory?.item || [])
      .filter(item => Boolean(item.name) && item.type !== 'dir')
      .map(item => ({
        name: item.name || '',
        description: item.name || '',
        type: item.type || '',
        size: item.size == null ? '' : String(item.size),
        url: buildSecDocumentUrl(cik, accessionNumber, item.name || ''),
      }));
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
          const response = await fetch(buildSecProxyUrl(`Archives/edgar/data/${cik}/${cleanAccession}/${primaryDocument}`, { trunc: '1' }), {
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
export function formatFinancialValue(value: number | null | undefined, unit: string, currency?: string): string {
  if (value == null) return '—';
  const sym = CURRENCY_SYMBOLS[currency || 'USD'] || (currency ? `${currency} ` : '$');
  if (unit.includes('/shares')) return `${sym}${value.toFixed(2)}`;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${sym}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${sym}${abs.toFixed(0)}`;
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

/**
 * Fetch and parse SEC litigation releases index page.
 */
export interface LitigationRelease {
  date: string;
  title: string;
  url: string;
  releaseNumber: string;
}

export function parseLitigationReleases(html: string): LitigationRelease[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set<string>();
  const items: LitigationRelease[] = [];

  for (const row of Array.from(doc.querySelectorAll('.pr-list-page-row, tbody tr'))) {
    const link = row.querySelector<HTMLAnchorElement>(
      'a[href*="/enforcement-litigation/litigation-releases/lr-"]'
    );
    if (!link) continue;
    const href = link.getAttribute('href') || '';
    const title = (link.textContent || '').replace(/\s+/g, ' ').trim();
    const releaseFromRow = row.querySelector('.view-table_subfield_release_number .view-table_subfield_value')?.textContent || '';
    const numberMatch = `${releaseFromRow} ${href}`.match(/LR[-\s]?(\d+)/i);
    const releaseNumber = numberMatch ? `LR-${numberMatch[1]}` : '';
    const url = href.startsWith('https://www.sec.gov') ? href : `https://www.sec.gov${href.startsWith('/') ? href : `/${href}`}`;
    if (!title || !releaseNumber || seen.has(url)) continue;
    seen.add(url);
    items.push({
      title,
      url,
      releaseNumber,
      date: (row.querySelector('time')?.textContent || '').replace(/\s+/g, ' ').trim(),
    });
  }

  return items;
}

export async function fetchLitigationReleases(): Promise<LitigationRelease[]> {
  const response = await fetch(buildSecProxyUrl('enforcement-litigation/litigation-releases'), { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`SEC litigation releases returned ${response.status}`);
  }
  const releases = parseLitigationReleases(await response.text());
  if (releases.length === 0) {
    throw new Error('SEC litigation releases returned no parseable entries; the official page contract may have changed.');
  }
  return releases;
}

/**
 * Compute standard financial ratios from extracted metrics.
 */
export function computeFinancialRatios(
  metrics: Record<string, { value: number; unit: string }>,
  priorMetrics: Record<string, { value: number; unit: string }> = {}
): Record<string, number | null> {
  const get = (key: string) => metrics[key]?.value ?? null;
  const averageBalance = (key: string) => {
    const current = metrics[key];
    const prior = priorMetrics[key];
    if (!current) return null;
    if (!prior || prior.unit !== current.unit) return current.value;
    return (current.value + prior.value) / 2;
  };
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
  const eq = get('StockholdersEquity');
  const averageAssets = averageBalance('TotalAssets');
  const averageEquity = averageBalance('StockholdersEquity');
  const debt = get('TotalDebt');
  const currentAssets = get('CurrentAssets');
  const currentLiabilities = get('CurrentLiabilities');

  return {
    grossMargin: divide(gp, rev, 100),
    operatingMargin: divide(oi, rev, 100),
    netMargin: divide(ni, rev, 100),
    returnOnEquity: divide(ni, averageEquity, 100),
    returnOnAssets: divide(ni, averageAssets, 100),
    debtToEquity: divide(debt, eq),
    assetTurnover: divide(rev, averageAssets),
    currentRatio: divide(currentAssets, currentLiabilities),
  };
}
