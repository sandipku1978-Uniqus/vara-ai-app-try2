#!/usr/bin/env node
/**
 * XBRL Coverage Test — Fortune 500
 *
 * Tests XBRL financial concept availability across Fortune 500 companies
 * using the SEC EDGAR Company Facts API. Produces a gap analysis report
 * identifying missing concepts and recommending additional aliases.
 *
 * Usage:
 *   node scripts/xbrl-coverage-test.mjs [--limit N] [--output report.json]
 *
 * Rate limit: SEC EDGAR allows ~10 req/s. We throttle to 8 req/s.
 */

const USER_AGENT = 'Uniqus Research Center contact@uniqus.com';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const COMPANY_FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts';

// ─── Fortune 500 Tickers (2024/2025) ────────────────────────────────────────
const FORTUNE_500 = [
  // Top 50
  'WMT','AMZN','AAPL','UNH','BRK-B','CVS','MSFT','MCK','ABC','CI',
  'GOOGL','CNC','COR','CVX','COST','F','GM','XOM','JPM','CAH',
  'HD','ELEV','MRK','V','T','VZ','CMCSA','JNJ','META','GE',
  // 51-100
  'PG','PEP','DELL','WBA','FDX','UPS','HUM','LOW','LMT','GS',
  'PFE','BA','RTX','MS','TGT','ABBV','SYY','ABT','COP','CAT',
  'KO','BMY','KR','MO','ACI','INTC','DE','ADM','MET','PRU',
  // 101-150
  'NVDA','GD','AIG','NKE','NFLX','PNC','TFC','USB','D','SLB',
  'AVTR','ALL','BK','SO','DUK','HCA','ADP','WM','EOG','CL',
  'OXY','PSX','VLO','MPC','MDLZ','TRV','EMR','NOC','ITW','AEP',
  // 151-200
  'GIS','MMM','SPG','CMI','HPQ','ETN','CSX','NSC','KDP','WEC',
  'ECL','EBAY','WELL','AFL','ED','PGR','MCO','ORCL','ADBE','ACN',
  'CRM','NOW','SCHW','DHR','ISRG','APD','SHW','SPGI','ICE','MMC',
  // 201-250
  'FIS','FISV','PAYX','CLX','HSY','MKC','SJM','HRL','KHC','GPC',
  'DG','DLTR','ROST','TJX','BKNG','MAR','HLT','RCL','CCL','NCLH',
  'DAL','UAL','LUV','AAL','ALK','JBLU','HA','SAVE','ULTA','ORLY',
  // 251-300
  'AZO','BBY','TSCO','WSM','RH','FIVE','BJ','OLLI','BURL','DKS',
  'LULU','GAP','ANF','URBN','AEO','FL','TPR','RL','PVH','HBI',
  'VFC','WWW','SKX','CROX','DECK','NWL','WHR','LEG','FBHS','MHK',
  // 301-350
  'LEN','DHI','PHM','TOL','NVR','KBH','MDC','TMHC','MTH','MAS',
  'SWK','FAST','GWW','WSO','POOL','SNA','TTC','IR','XYL','RBC',
  'AME','TRMB','KEYS','TER','LRCX','KLAC','AMAT','MPWR','ON','MCHP',
  // 351-400
  'TXN','AVGO','QCOM','ADI','NXPI','SWKS','QRVO','MTCH','ZG','Z',
  'ABNB','LYFT','UBER','DASH','PINS','SNAP','TWLO','OKTA','ZS','CRWD',
  'NET','DDOG','MDB','SNOW','PLTR','TEAM','WDAY','VEEV','ANSS','CDNS',
  // 401-450
  'SNPS','PANW','FTNT','ZM','DOCU','BILL','HUBS','PAYC','PCTY','WEX',
  'GDDY','GEN','CTSH','INFY','WIT','IBM','HPE','JNPR','CSCO','ANET',
  'MSI','ZBRA','GRMN','TDY','CGNX','NOVT','ST','GLW','TEL','APH',
  // 451-500
  'BDX','SYK','ZBH','HOLX','DXCM','PODD','ALGN','IDXX','WAT','A',
  'TMO','IQV','CRL','MTD','PKI','BIO','TECH','ILMN','RGEN','AZTA',
  'EW','BSX','MDT','ABT','BAX','BDX','GEHC','STE','TFX','COO',
];

// Deduplicate
const TICKERS = [...new Set(FORTUNE_500)];

// ─── Financial concepts we test (mirrors FINANCIAL_CONCEPTS in secApi.ts) ───
const CONCEPTS_TO_TEST = {
  // Income Statement (core)
  'Revenues': ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense', 'InterestAndDividendIncomeOperating', 'InterestIncomeExpenseNet'],
  'CostOfRevenue': ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfRealEstateRevenue'],
  'GrossProfit': ['GrossProfit', 'GrossProfitLoss'],
  'OperatingIncome': ['OperatingIncomeLoss', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  'NetIncome': ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLossAvailableToCommonStockholdersDiluted', 'ProfitLoss'],
  'EarningsPerShareDiluted': ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
  'ResearchAndDevelopment': ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost', 'TechnologyAndContentExpense'],
  'SellingGeneralAdmin': ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],

  // Balance Sheet (core)
  'TotalAssets': ['Assets'],
  'TotalLiabilities': ['Liabilities', 'LiabilitiesNoncurrentAndFinanceLeaseObligationsNoncurrent'],
  'StockholdersEquity': ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  'CashAndEquivalents': ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsAndShortTermInvestments', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  'Goodwill': ['Goodwill', 'GoodwillNet'],
  'IntangibleAssets': ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet', 'IndefiniteLivedIntangibleAssetsExcludingGoodwill', 'OtherIntangibleAssetsNet', 'AmortizableIntangibleAssetsNet'],
  'AccountsReceivable': ['AccountsReceivableNetCurrent', 'AccountsReceivableNet', 'ReceivablesNetCurrent', 'AccountsNotesAndLoansReceivableNetCurrent', 'AccruedInvestmentIncomeReceivable', 'PremiumsReceivableAtCarryingValue'],
  'Inventory': ['InventoryNet', 'Inventories', 'InventoriesNetOfReserves', 'InventoryAndServicePartsNet', 'InventoryFinishedGoods', 'InventoryGross', 'RealEstateInventory'],

  // Cash Flow (core)
  'OperatingCashFlow': ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  'CapitalExpenditures': ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquireOilAndGasPropertyAndEquipment', 'PaymentsForCapitalImprovements', 'PaymentsToAcquireOtherPropertyPlantAndEquipment', 'PaymentsToAcquireMachineryAndEquipment'],
};

// SIC codes → industry category mapping
const SIC_CATEGORIES = {
  'Banking': [6020, 6021, 6022, 6029, 6035, 6036, 6141, 6153, 6159],
  'Insurance': [6311, 6321, 6331, 6399, 6411],
  'Financial Services': [6111, 6120, 6140, 6150, 6159, 6162, 6163, 6199, 6200, 6211, 6282],
  'Oil & Gas': [1311, 1381, 1382, 2911, 5171],
  'Utilities': [4911, 4922, 4923, 4924, 4931, 4932, 4941],
  'Pharma & Biotech': [2830, 2833, 2834, 2835, 2836, 3841, 3851],
  'Technology': [3570, 3571, 3572, 3576, 3577, 3674, 3679, 7371, 7372, 7374],
  'Retail': [5200, 5211, 5300, 5311, 5331, 5411, 5412, 5511, 5700, 5731, 5912, 5940, 5944, 5945, 5961],
  'Healthcare': [8000, 8011, 8060, 8062, 8071, 8082, 8090, 8099],
  'Telecom': [4812, 4813, 4899],
};

function getSicCategory(sicCode) {
  for (const [category, codes] of Object.entries(SIC_CATEGORIES)) {
    if (codes.includes(sicCode)) return category;
  }
  return 'Other';
}

// ─── Rate-limited fetch ─────────────────────────────────────────────────────

let lastFetch = 0;
const MIN_INTERVAL = 125; // 8 req/s

async function rateLimitedFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL - (now - lastFetch));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetch = Date.now();

  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
  });
  return resp;
}

// ─── Main test logic ────────────────────────────────────────────────────────

async function loadTickerCikMap() {
  console.log('Loading SEC ticker→CIK map...');
  const resp = await rateLimitedFetch(SEC_TICKERS_URL);
  if (!resp.ok) throw new Error(`Failed to load tickers: ${resp.status}`);
  const data = await resp.json();

  const map = {};
  const sicMap = {};
  const nameMap = {};
  for (const entry of Object.values(data)) {
    const ticker = entry.ticker.toUpperCase();
    map[ticker] = String(entry.cik_str).padStart(10, '0');
    nameMap[ticker] = entry.title;
  }
  return { cikMap: map, nameMap };
}

function isLikelyAnnualFact(fact) {
  const form = (fact.form || '').trim().toUpperCase().replace(/\s+/g, '').replace(/\/A$/, '');
  const isAnnualForm = ['10-K', '10-KT', '20-F', '40-F'].includes(form);
  if (!isAnnualForm) return false;
  const fp = (fact.fp || '').toUpperCase();
  if (!fp || fp === 'FY' || fp === 'CY') return true;
  if (fact.start && fact.end) {
    const days = Math.abs(Date.parse(fact.end) - Date.parse(fact.start)) / 86400000;
    return days >= 300;
  }
  return false;
}

function checkConceptAvailability(facts) {
  const usGaap = facts?.facts?.['us-gaap'];
  const ifrs = facts?.facts?.['ifrs-full'];
  if (!usGaap && !ifrs) return { available: {}, missing: Object.keys(CONCEPTS_TO_TEST), allConcepts: [], isIFRS: !!ifrs };

  // Merge concept names from both namespaces for alternative detection
  const mergedNs = { ...(usGaap || {}), ...(ifrs || {}) };

  // IFRS concept aliases (mirrors IFRS_CONCEPTS in secApi.ts)
  const IFRS_ALIASES = {
    'Revenues': ['Revenue', 'RevenueFromContractsWithCustomers'],
    'CostOfRevenue': ['CostOfSales'],
    'GrossProfit': ['GrossProfit'],
    'OperatingIncome': ['ProfitLossFromOperatingActivities', 'ProfitLossBeforeTax'],
    'NetIncome': ['ProfitLoss', 'ProfitLossAttributableToOwnersOfParent'],
    'EarningsPerShareDiluted': ['DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare'],
    'ResearchAndDevelopment': ['ResearchAndDevelopmentExpense'],
    'SellingGeneralAdmin': ['SellingGeneralAndAdministrativeExpense', 'AdministrativeExpense'],
    'TotalAssets': ['Assets'],
    'TotalLiabilities': ['Liabilities'],
    'StockholdersEquity': ['Equity', 'EquityAttributableToOwnersOfParent'],
    'CashAndEquivalents': ['CashAndCashEquivalents'],
    'Goodwill': ['Goodwill'],
    'IntangibleAssets': ['IntangibleAssetsOtherThanGoodwill'],
    'AccountsReceivable': ['TradeAndOtherCurrentReceivables', 'TradeReceivables'],
    'Inventory': ['Inventories', 'CurrentInventories'],
    'OperatingCashFlow': ['CashFlowsFromUsedInOperatingActivities'],
    'CapitalExpenditures': ['PurchaseOfPropertyPlantAndEquipment'],
  };

  const available = {};
  const missing = [];

  // Build lookup list: us-gaap aliases, then IFRS aliases
  for (const [metricKey, aliases] of Object.entries(CONCEPTS_TO_TEST)) {
    let found = false;
    const allAliases = [];
    if (usGaap) for (const a of aliases) allAliases.push({ ns: usGaap, name: a });
    if (ifrs && IFRS_ALIASES[metricKey]) for (const a of IFRS_ALIASES[metricKey]) allAliases.push({ ns: ifrs, name: a });

    for (const { ns, name: alias } of allAliases) {
      const concept = ns[alias];
      if (!concept) continue;

      const units = concept.units?.['USD'] || concept.units?.['USD/shares'] || concept.units?.['shares'];
      if (!units) continue;

      const annualFacts = units.filter(isLikelyAnnualFact);
      if (annualFacts.length > 0) {
        const latest = annualFacts.sort((a, b) => b.fy - a.fy)[0];
        available[metricKey] = {
          concept: alias,
          value: latest.val,
          year: latest.fy,
          form: latest.form,
        };
        found = true;
        break;
      }
    }
    if (!found) missing.push(metricKey);
  }

  // SG&A derivation: G&A + Selling/Marketing
  if (missing.includes('SellingGeneralAdmin')) {
    const ns = usGaap || ifrs || {};
    const ga = ns['GeneralAndAdministrativeExpense'] || (ifrs && ifrs['AdministrativeExpense']);
    const sm = ns['SellingAndMarketingExpense'] || ns['SellingExpense'] || ns['MarketingExpense'] || ns['MarketingAndAdvertisingExpense'];
    if (ga && sm) {
      const gaFacts = (ga.units?.['USD'] || []).filter(isLikelyAnnualFact);
      const smFacts = (sm.units?.['USD'] || []).filter(isLikelyAnnualFact);
      if (gaFacts.length > 0 && smFacts.length > 0) {
        available['SellingGeneralAdmin'] = { concept: 'DERIVED(G&A+Selling)', value: 'derived', year: gaFacts[0]?.fy };
        missing.splice(missing.indexOf('SellingGeneralAdmin'), 1);
      }
    }
    // Fallback: NoninterestExpense for banks
    if (missing.includes('SellingGeneralAdmin') && usGaap) {
      const nie = usGaap['NoninterestExpense'];
      if (nie) {
        const nieFacts = (nie.units?.['USD'] || []).filter(isLikelyAnnualFact);
        if (nieFacts.length > 0) {
          available['SellingGeneralAdmin'] = { concept: 'NoninterestExpense(bank)', value: nieFacts[0]?.val, year: nieFacts[0]?.fy };
          missing.splice(missing.indexOf('SellingGeneralAdmin'), 1);
        }
      }
    }
  }

  // Total Liabilities derivation
  if (missing.includes('TotalLiabilities') && available['TotalAssets'] && available['StockholdersEquity']) {
    available['TotalLiabilities'] = { concept: 'DERIVED(Assets-Equity)', value: 'derived' };
    missing.splice(missing.indexOf('TotalLiabilities'), 1);
  }

  // Gross Profit derivation
  if (missing.includes('GrossProfit') && available['Revenues'] && available['CostOfRevenue']) {
    available['GrossProfit'] = { concept: 'DERIVED(Rev-COGS)', value: 'derived' };
    missing.splice(missing.indexOf('GrossProfit'), 1);
  }

  return { available, missing, allConcepts: Object.keys(mergedNs), isIFRS: !usGaap && !!ifrs };
}

function findAlternativeConcepts(allConcepts, metricKey) {
  // Search for concepts that might be alternatives for missing metrics
  const searchPatterns = {
    'Revenues': ['revenue', 'sales', 'income(?!tax)(?!loss)'],
    'CostOfRevenue': ['cost.*(?:revenue|goods|sales|service)', 'cogs'],
    'GrossProfit': ['gross.*profit'],
    'OperatingIncome': ['operating.*(?:income|profit|loss)', 'income.*(?:continu|operat)'],
    'NetIncome': ['net.*(?:income|loss|earnings)'],
    'EarningsPerShareDiluted': ['earnings.*per.*share', 'eps'],
    'ResearchAndDevelopment': ['research', 'development', 'r&d', 'technology.*(?:content|infra)'],
    'SellingGeneralAdmin': ['selling', 'general.*admin', 'sg.*a', 'marketing'],
    'TotalAssets': ['assets(?!current)'],
    'TotalLiabilities': ['liabilit(?!ies.*current)'],
    'StockholdersEquity': ['stockholder.*equity', 'shareholder.*equity', 'equity'],
    'CashAndEquivalents': ['cash.*(?:equivalent|carry)'],
    'Goodwill': ['goodwill'],
    'IntangibleAssets': ['intangible'],
    'AccountsReceivable': ['receivable', 'accounts.*receivable'],
    'Inventory': ['inventor'],
    'OperatingCashFlow': ['cash.*(?:operat|provided)'],
    'CapitalExpenditures': ['(?:payment|purchase|acquisition).*(?:property|plant|equipment|productive|capital)', 'capex', 'capital.*expend'],
  };

  const patterns = searchPatterns[metricKey] || [];
  const candidates = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    for (const concept of allConcepts) {
      if (regex.test(concept) && !CONCEPTS_TO_TEST[metricKey]?.includes(concept)) {
        candidates.push(concept);
      }
    }
  }

  return [...new Set(candidates)].slice(0, 10);
}

async function testCompany(ticker, cik, nameMap) {
  const url = `${COMPANY_FACTS_URL}/CIK${cik}.json`;
  try {
    const resp = await rateLimitedFetch(url);
    if (!resp.ok) {
      return { ticker, name: nameMap[ticker], status: 'error', httpCode: resp.status, missing: Object.keys(CONCEPTS_TO_TEST) };
    }
    const facts = await resp.json();
    const { available, missing, allConcepts } = checkConceptAvailability(facts);

    // For missing concepts, try to find alternative concept names
    const alternatives = {};
    for (const m of missing) {
      const alts = findAlternativeConcepts(allConcepts, m);
      if (alts.length > 0) alternatives[m] = alts;
    }

    // Get SIC code
    const sic = facts.sic || null;
    const sicDesc = facts.sicDescription || null;

    return {
      ticker,
      name: nameMap[ticker] || facts.entityName,
      sic,
      sicDesc,
      sicCategory: sic ? getSicCategory(sic) : 'Unknown',
      status: 'ok',
      totalConcepts: Object.keys(CONCEPTS_TO_TEST).length,
      found: Object.keys(available).length,
      missing,
      available,
      alternatives,
      coverage: Math.round((Object.keys(available).length / Object.keys(CONCEPTS_TO_TEST).length) * 100),
    };
  } catch (err) {
    return { ticker, name: nameMap[ticker], status: 'error', error: err.message, missing: Object.keys(CONCEPTS_TO_TEST) };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : TICKERS.length;
  const outputIdx = args.indexOf('--output');
  const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : null;

  const { cikMap, nameMap } = await loadTickerCikMap();

  // Filter to tickers that have CIKs
  const testable = TICKERS.filter(t => cikMap[t]).slice(0, limit);
  const notFound = TICKERS.filter(t => !cikMap[t]);

  console.log(`\nTesting ${testable.length} companies (${notFound.length} tickers not found in SEC)...`);
  if (notFound.length > 0) {
    console.log(`  Tickers not in SEC: ${notFound.slice(0, 20).join(', ')}${notFound.length > 20 ? '...' : ''}`);
  }
  console.log('');

  const results = [];
  let processed = 0;

  for (const ticker of testable) {
    const result = await testCompany(ticker, cikMap[ticker], nameMap);
    results.push(result);
    processed++;

    // Progress
    if (processed % 25 === 0 || processed === testable.length) {
      const okCount = results.filter(r => r.status === 'ok').length;
      const avgCoverage = results.filter(r => r.status === 'ok').reduce((s, r) => s + r.coverage, 0) / Math.max(okCount, 1);
      console.log(`  [${processed}/${testable.length}] Avg coverage: ${avgCoverage.toFixed(1)}%`);
    }
  }

  // ─── Analysis ───────────────────────────────────────────────────────────

  const ok = results.filter(r => r.status === 'ok');
  const errors = results.filter(r => r.status === 'error');

  console.log('\n' + '═'.repeat(80));
  console.log('  XBRL COVERAGE REPORT — Fortune 500');
  console.log('═'.repeat(80));

  // Overall stats
  const avgCoverage = ok.reduce((s, r) => s + r.coverage, 0) / Math.max(ok.length, 1);
  console.log(`\n  Companies tested:   ${results.length}`);
  console.log(`  Successful:         ${ok.length}`);
  console.log(`  Errors (no data):   ${errors.length}`);
  console.log(`  Average coverage:   ${avgCoverage.toFixed(1)}%`);
  console.log(`  Full coverage:      ${ok.filter(r => r.coverage === 100).length} companies`);

  // Coverage distribution
  const brackets = [100, 90, 80, 70, 60, 0];
  console.log('\n  Coverage Distribution:');
  for (let i = 0; i < brackets.length - 1; i++) {
    const low = brackets[i + 1];
    const high = brackets[i];
    const count = ok.filter(r => r.coverage >= low && r.coverage < (i === 0 ? 101 : high)).length;
    const bar = '█'.repeat(Math.round(count / Math.max(ok.length, 1) * 40));
    console.log(`    ${low === 0 ? '<60' : `${low}-${high}`}%: ${String(count).padStart(3)} ${bar}`);
  }

  // Missing concepts frequency
  console.log('\n  Most Frequently Missing Concepts:');
  const missingFreq = {};
  for (const r of ok) {
    for (const m of r.missing) {
      missingFreq[m] = (missingFreq[m] || 0) + 1;
    }
  }
  const sorted = Object.entries(missingFreq).sort((a, b) => b[1] - a[1]);
  for (const [concept, count] of sorted) {
    const pct = ((count / ok.length) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / ok.length * 30));
    console.log(`    ${concept.padEnd(28)} ${String(count).padStart(3)} (${pct.padStart(5)}%) ${bar}`);
  }

  // Missing by industry
  console.log('\n  Missing Concepts by Industry:');
  const byIndustry = {};
  for (const r of ok) {
    const cat = r.sicCategory || 'Other';
    if (!byIndustry[cat]) byIndustry[cat] = { count: 0, missing: {} };
    byIndustry[cat].count++;
    for (const m of r.missing) {
      byIndustry[cat].missing[m] = (byIndustry[cat].missing[m] || 0) + 1;
    }
  }
  for (const [industry, data] of Object.entries(byIndustry).sort((a, b) => b[1].count - a[1].count)) {
    if (data.count < 3) continue;
    const topMissing = Object.entries(data.missing).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topMissing.length === 0) continue;
    console.log(`\n    ${industry} (${data.count} companies):`);
    for (const [concept, count] of topMissing) {
      console.log(`      ${concept.padEnd(28)} ${count}/${data.count} (${((count/data.count)*100).toFixed(0)}%)`);
    }
  }

  // Alternative concept suggestions
  console.log('\n  Recommended Additional XBRL Aliases:');
  const altFreq = {};
  for (const r of ok) {
    for (const [metric, alts] of Object.entries(r.alternatives || {})) {
      for (const alt of alts) {
        const key = `${metric}::${alt}`;
        if (!altFreq[key]) altFreq[key] = { metric, concept: alt, count: 0, companies: [] };
        altFreq[key].count++;
        if (altFreq[key].companies.length < 5) altFreq[key].companies.push(r.ticker);
      }
    }
  }
  const topAlts = Object.values(altFreq)
    .filter(a => a.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  if (topAlts.length > 0) {
    let lastMetric = '';
    for (const alt of topAlts) {
      if (alt.metric !== lastMetric) {
        console.log(`\n    For ${alt.metric}:`);
        lastMetric = alt.metric;
      }
      console.log(`      + ${alt.concept.padEnd(55)} (${alt.count} companies: ${alt.companies.join(', ')})`);
    }
  }

  // Worst coverage companies (potential issues)
  console.log('\n  Lowest Coverage Companies (potential issues):');
  const worst = ok.filter(r => r.coverage < 75).sort((a, b) => a.coverage - b.coverage).slice(0, 20);
  for (const r of worst) {
    console.log(`    ${r.ticker.padEnd(8)} ${r.name?.substring(0, 35).padEnd(37)} ${r.coverage}%  SIC:${r.sic} (${r.sicCategory})  Missing: ${r.missing.join(', ')}`);
  }

  // Error companies
  if (errors.length > 0) {
    console.log(`\n  Companies with errors (${errors.length}):`);
    for (const r of errors) {
      console.log(`    ${r.ticker.padEnd(8)} ${(r.name || '?').padEnd(37)} HTTP ${r.httpCode || '?'}`);
    }
  }

  console.log('\n' + '═'.repeat(80));

  // Save full results JSON
  if (outputFile) {
    const { writeFileSync } = await import('fs');
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        tested: results.length,
        successful: ok.length,
        errors: errors.length,
        avgCoverage: Math.round(avgCoverage * 10) / 10,
        fullCoverage: ok.filter(r => r.coverage === 100).length,
      },
      missingFrequency: Object.fromEntries(sorted),
      recommendedAliases: topAlts.map(a => ({ metric: a.metric, concept: a.concept, count: a.count, examples: a.companies })),
      byIndustry: Object.fromEntries(
        Object.entries(byIndustry).map(([k, v]) => [k, { count: v.count, missing: v.missing }])
      ),
      companies: results,
    };
    writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log(`\n  Full report saved to: ${outputFile}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
