'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ArrowRightLeft, Loader2, Sparkles, LayoutGrid, Type, DollarSign, TrendingUp, TrendingDown, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend } from 'recharts';
import { fetchCompanySubmissions, fetchCompanySubmissionsBatch, fetchCompanyFacts, extractComparableFinancials, getAvailableYears, formatFinancialValue, CIK_MAP, SecSubmission, FinancialMetric, CompanyFacts, lookupCIK, extractCompanyMetadata, loadTickerMap, buildSecProxyUrl, extractDocumentTextFromHtml } from '../services/secApi';
import { aiSummarize } from '../services/aiApi';
import { generateMemoDocx } from '../services/docExport';
import ResponsibleAIBanner from '../components/ResponsibleAIBanner';
import { renderMarkdown } from '../utils/markdownRenderer';
import { DisclosureMatrix } from '../components/research/DisclosureMatrix';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import SectionMatrix, { type MatrixCell } from '../components/tables/SectionMatrix';
import { useApp } from '../context/AppState';
import './Benchmarking.css';

const CHART_COLORS = ['#B31F7E', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'];

// ---- Column key helpers ----
function makeColKey(ticker: string, year: number): string { return `${ticker}|${year}`; }
function colTicker(colKey: string): string { return colKey.split('|')[0]; }
function colYear(colKey: string): number { return Number(colKey.split('|')[1]); }
function colLabel(colKey: string): string { return `${colTicker(colKey)} '${String(colYear(colKey)).slice(2)}`; }

const ALL_SECTIONS = [
  'Item 1. Business',
  'Item 1A. Risk Factors',
  'Item 1B. Unresolved Staff Comments',
  'Item 1C. Cybersecurity',
  'Item 2. Properties',
  'Item 3. Legal Proceedings',
  'Item 4. Mine Safety Disclosures',
  'Item 5. Market for Registrant\'s Common Equity',
  'Item 6. [Reserved]',
  'Item 7. Management\'s Discussion & Analysis',
  'Item 7A. Quantitative & Qualitative Disclosures About Market Risk',
  'Item 8. Financial Statements',
  'Item 9. Changes in and Disagreements With Accountants',
  'Item 9A. Controls and Procedures',
  'Item 9B. Other Information',
  'Item 9C. Disclosure Regarding Foreign Jurisdictions',
  'Item 10. Directors, Executive Officers and Corporate Governance',
  'Item 11. Executive Compensation',
  'Item 12. Security Ownership',
  'Item 13. Certain Relationships and Related Transactions',
  'Item 14. Principal Accountant Fees and Services',
  'Item 15. Exhibits and Financial Statement Schedules',
  'Signatures',
];

const SECTION_LISTS: Record<string, string[]> = {
  '10-K': ALL_SECTIONS,
  '10-Q': [
    'Part I, Item 1. Financial Statements',
    'Part I, Item 2. MD&A',
    'Part I, Item 3. Quantitative & Qualitative Disclosures',
    'Part I, Item 4. Controls and Procedures',
    'Part II, Item 1. Legal Proceedings',
    'Part II, Item 1A. Risk Factors',
    'Part II, Item 2. Unregistered Sales',
    'Part II, Item 5. Other Information',
    'Part II, Item 6. Exhibits',
    'Signatures',
  ],
  '20-F': [
    'Item 1. Identity of Directors, Senior Management',
    'Item 2. Offer Statistics and Expected Timetable',
    'Item 3. Key Information',
    'Item 4. Information on the Company',
    'Item 5. Operating and Financial Review',
    'Item 6. Directors, Senior Management and Employees',
    'Item 7. Major Shareholders and Related Party Transactions',
    'Item 8. Financial Information',
    'Item 9. The Offer and Listing',
    'Item 10. Additional Information',
    'Item 11. Quantitative and Qualitative Disclosures',
    'Item 12. Description of Securities',
    'Item 15. Controls and Procedures',
    'Item 16. [Reserved]',
    'Item 17. Financial Statements',
    'Item 18. Financial Statements',
    'Item 19. Exhibits',
  ],
  'S-1': [
    'Part I — Prospectus Summary',
    'Part I — Risk Factors',
    'Part I — Use of Proceeds',
    'Part I — Dividend Policy',
    'Part I — Capitalization',
    'Part I — Dilution',
    'Part I — MD&A',
    'Part I — Business',
    'Part I — Management',
    'Part I — Executive Compensation',
    'Part I — Principal Stockholders',
    'Part I — Description of Capital Stock',
    'Part I — Shares Eligible for Future Sale',
    'Part I — Underwriting',
    'Part II — Legal Matters',
    'Part II — Experts',
    'Part II — Financial Statements',
    'Signatures',
  ],
};

const FINANCIAL_SECTIONS: { title: string; metrics: { key: string; label: string }[] }[] = [
  {
    title: 'Income Statement',
    metrics: [
      { key: 'Revenues', label: 'Total Revenue' },
      { key: 'CostOfRevenue', label: 'Cost of Revenue' },
      { key: 'GrossProfit', label: 'Gross Profit' },
      { key: 'ResearchAndDevelopment', label: 'R&D Expense' },
      { key: 'SellingGeneralAdmin', label: 'SG&A Expense' },
      { key: 'OperatingIncome', label: 'Operating Income' },
      { key: 'NetIncome', label: 'Net Income' },
      { key: 'EarningsPerShare', label: 'EPS (Basic)' },
      { key: 'EarningsPerShareDiluted', label: 'EPS (Diluted)' },
    ]
  },
  {
    title: 'Balance Sheet',
    metrics: [
      { key: 'CashAndEquivalents', label: 'Cash & Equivalents' },
      { key: 'AccountsReceivable', label: 'Accounts Receivable' },
      { key: 'Inventory', label: 'Inventory' },
      { key: 'Goodwill', label: 'Goodwill' },
      { key: 'IntangibleAssets', label: 'Intangible Assets (ex. GW)' },
      { key: 'TotalAssets', label: 'Total Assets' },
      { key: 'TotalDebt', label: 'Long-Term Debt' },
      { key: 'TotalLiabilities', label: 'Total Liabilities' },
      { key: 'StockholdersEquity', label: "Stockholders' Equity" },
    ]
  },
  {
    title: 'Cash Flow Statement',
    metrics: [
      { key: 'OperatingCashFlow', label: 'Operating Cash Flow' },
      { key: 'CapitalExpenditures', label: 'Capital Expenditures' },
      { key: 'DividendsPaid', label: 'Dividends Paid' },
      { key: 'ShareRepurchases', label: 'Share Repurchases' },
    ]
  },
  {
    title: 'Key Disclosures & Specific Items',
    metrics: [
      { key: 'OperatingLeaseROU', label: 'Operating Lease ROU Assets (ASC 842)' },
      { key: 'OperatingLeaseLiability', label: 'Operating Lease Liabilities' },
      { key: 'StockCompensation', label: 'Stock-Based Compensation' },
      { key: 'DeferredRevenue', label: 'Deferred Revenue (ASC 606)' },
      { key: 'IncomeTaxExpense', label: 'Income Tax Expense (ASC 740)' },
    ]
  },
];

type RatioResult = { display: string; value: number | null };

export default function Benchmarking() {
  const { pendingCompareIntent, setPendingCompareIntent, setActiveCompareContext, themeMode } = useApp();
  const isDarkMode = themeMode === 'dark';
  const tooltipStyle = useMemo(
    () => ({
      background: isDarkMode ? '#20182B' : '#FFFFFF',
      border: `1px solid ${isDarkMode ? 'rgba(238, 223, 236, 0.16)' : 'rgba(72, 42, 122, 0.14)'}`,
      borderRadius: '12px',
      color: isDarkMode ? '#F8F5F8' : '#413F42',
      boxShadow: isDarkMode ? '0 18px 36px rgba(0, 0, 0, 0.34)' : '0 18px 34px rgba(72, 42, 122, 0.12)',
    }),
    [isDarkMode]
  );
  const axisStyle = useMemo(
    () => ({ fill: isDarkMode ? '#B9AFC0' : '#8F8390', fontSize: 11 }),
    [isDarkMode]
  );
  const axisTickColor = isDarkMode ? '#E8DDE7' : '#6C6270';
  const axisLineColor = isDarkMode ? 'rgba(238, 223, 236, 0.18)' : 'rgba(72, 42, 122, 0.18)';
  const gridStroke = isDarkMode ? 'rgba(238, 223, 236, 0.12)' : 'rgba(72, 42, 122, 0.14)';
  const groupedBorderColor = isDarkMode ? 'rgba(238, 223, 236, 0.14)' : 'rgba(72, 42, 122, 0.14)';
  const tableHeaderBackground = isDarkMode ? '#1A1424' : '#F6EEF4';
  const tableHeaderText = isDarkMode ? '#F8F5F8' : '#413F42';
  const tableMutedText = isDarkMode ? '#B9AFC0' : '#6C6270';
  const [selectedTickers, setSelectedTickers] = useState<string[]>(['AAPL', 'MSFT']);
  // Multi-year per ticker: { AAPL: [2024, 2023], MSFT: [2024] }
  const [selectedYearsPerTicker, setSelectedYearsPerTicker] = useState<Record<string, number[]>>({});
  const [selectedSection, setSelectedSection] = useState('Item 1A. Risk Factors');
  const [viewMode, setViewMode] = useState<'financials' | 'text-diff' | 'audit-matrix'>('financials');
  const [matrixFormType, setMatrixFormType] = useState<string>('10-K');
  const [matrixData, setMatrixData] = useState<Record<string, Record<string, MatrixCell>>>({});
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [peerLoading, setPeerLoading] = useState(false);
  const [peerSicCode, setPeerSicCode] = useState('');
  const [peerDiscoveryMessage, setPeerDiscoveryMessage] = useState('');
  const [cohortReport, setCohortReport] = useState('');
  const [cohortReportLoading, setCohortReportLoading] = useState(false);

  const [companiesData, setCompaniesData] = useState<Record<string, SecSubmission>>({});
  const [companiesRawFacts, setCompaniesRawFacts] = useState<Record<string, CompanyFacts>>({});
  // keyed by "TICKER|YEAR" e.g. "AAPL|2024"
  const [companiesFacts, setCompaniesFacts] = useState<Record<string, Record<string, FinancialMetric>>>({});
  const [availableYears, setAvailableYears] = useState<Record<string, number[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFacts, setLoadingFacts] = useState(false);
  const [companyTexts, setCompanyTexts] = useState<Record<string, string>>({});
  const [loadingTexts, setLoadingTexts] = useState(false);

  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [openYearDropdown, setOpenYearDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Close year dropdown on outside click
  useEffect(() => {
    if (!openYearDropdown) return;
    const close = () => setOpenYearDropdown(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openYearDropdown]);

  useEffect(() => {
    const seedTicker = selectedTickers[0];
    if (!seedTicker || peerSicCode.trim()) return;
    const submission = companiesData[seedTicker];
    if (!submission) return;
    const meta = extractCompanyMetadata(submission);
    if (meta.sic) {
      setPeerSicCode(meta.sic);
    }
  }, [selectedTickers, companiesData, peerSicCode]);

  useEffect(() => {
    if (!pendingCompareIntent) return;

    setSelectedTickers(pendingCompareIntent.tickers.slice(0, 10));
    if (pendingCompareIntent.sicCode) {
      setPeerSicCode(pendingCompareIntent.sicCode);
    }
    if (pendingCompareIntent.viewMode) {
      setViewMode(pendingCompareIntent.viewMode);
    }
    if (pendingCompareIntent.selectedSection) {
      setSelectedSection(pendingCompareIntent.selectedSection);
    }
    if (pendingCompareIntent.message) {
      setPeerDiscoveryMessage(pendingCompareIntent.message);
    }
    setPendingCompareIntent(null);
  }, [pendingCompareIntent, setPendingCompareIntent]);

  useEffect(() => {
    setActiveCompareContext({
      tickers: selectedTickers,
      sicCode: peerSicCode,
      viewMode,
      selectedSection,
      updatedAt: new Date().toISOString(),
    });
  }, [peerSicCode, selectedSection, selectedTickers, setActiveCompareContext, viewMode]);

  // Derived: all active columns in order
  const columns = useMemo(() =>
    selectedTickers.flatMap(t =>
      (selectedYearsPerTicker[t] || []).map(y => makeColKey(t, y))
    ),
    [selectedTickers, selectedYearsPerTicker]
  );

  // Color per column — same company gets same base color
  const getColColor = useCallback((colKey: string): string => {
    const ticker = colTicker(colKey);
    const idx = selectedTickers.indexOf(ticker);
    return CHART_COLORS[idx % CHART_COLORS.length];
  }, [selectedTickers]);

  // Fetch company submissions when tickers change
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      const newMap: Record<string, SecSubmission> = { ...companiesData };
      for (const ticker of selectedTickers) {
        if (!newMap[ticker]) {
          const cik = CIK_MAP[ticker] || await lookupCIK(ticker);
          if (cik) {
            const data = await fetchCompanySubmissions(cik);
            if (data) newMap[ticker] = data;
          }
        }
      }
      setCompaniesData(newMap);
      setIsLoading(false);
    }
    loadData();
  }, [selectedTickers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch XBRL facts when tickers change — auto-selects most recent year
  useEffect(() => {
    async function loadFacts() {
      setLoadingFacts(true);
      const newRaw = { ...companiesRawFacts };
      const newYears = { ...availableYears };
      const newFacts = { ...companiesFacts };
      const newSelYears = { ...selectedYearsPerTicker };

      for (const ticker of selectedTickers) {
        if (!newRaw[ticker]) {
          const cik = CIK_MAP[ticker] || await lookupCIK(ticker);
          if (cik) {
            const facts = await fetchCompanyFacts(cik);
            if (facts) {
              newRaw[ticker] = facts;
              const years = getAvailableYears(facts);
              newYears[ticker] = years;
              // Auto-select most recent year if none selected yet
              if (!newSelYears[ticker] && years.length > 0) {
                newSelYears[ticker] = [years[0]];
                newFacts[makeColKey(ticker, years[0])] = extractComparableFinancials(facts, years[0]);
              }
            }
          }
        }
      }

      setCompaniesRawFacts(newRaw);
      setAvailableYears(newYears);
      setCompaniesFacts(newFacts);
      setSelectedYearsPerTicker(newSelYears);
      setLoadingFacts(false);
    }
    loadFacts();
  }, [selectedTickers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle a year for a ticker — adds or removes that year column
  const toggleYear = useCallback((ticker: string, year: number) => {
    setSelectedYearsPerTicker(prev => {
      const current = prev[ticker] || [];
      const isSelected = current.includes(year);
      if (isSelected && current.length === 1) return prev; // keep at least one
      const next = isSelected
        ? current.filter(y => y !== year)
        : [...current, year].sort((a, b) => b - a); // newest first
      return { ...prev, [ticker]: next };
    });

    // Eagerly extract facts for newly added year if not cached
    setCompaniesFacts(prev => {
      const key = makeColKey(ticker, year);
      if (prev[key]) return prev;
      const raw = companiesRawFacts[ticker];
      if (!raw) return prev;
      return { ...prev, [key]: extractComparableFinancials(raw, year) };
    });
  }, [companiesRawFacts]);

  // Build audit matrix
  useEffect(() => {
    if (viewMode !== 'audit-matrix' || selectedTickers.length === 0) return;
    const sections = SECTION_LISTS[matrixFormType] || ALL_SECTIONS;
    setMatrixLoading(true);

    async function buildMatrix() {
      const data: Record<string, Record<string, MatrixCell>> = {};
      for (const section of sections) {
        data[section] = {};
        for (const ticker of selectedTickers) {
          const sub = companiesData[ticker];
          if (!sub) { data[section][ticker] = { present: false }; continue; }
          const formType = matrixFormType === 'S-1' ? 'S-1' : matrixFormType;
          const idx = sub.filings.recent.form.findIndex(f => f === formType || f.startsWith(formType));
          if (idx === -1) { data[section][ticker] = { present: false }; continue; }
          data[section][ticker] = { present: true, snippet: `Found in ${sub.filings.recent.primaryDocument[idx]}` };
        }
      }
      setMatrixData(data);
      setMatrixLoading(false);
    }

    if (Object.keys(companiesData).length > 0) buildMatrix();
  }, [viewMode, matrixFormType, selectedTickers, companiesData]);

  // Quick Peer Group
  const handleQuickPeerGroup = async () => {
    if (selectedTickers.length === 0) return;
    const sub = companiesData[selectedTickers[0]];
    if (!sub) return;
    const meta = extractCompanyMetadata(sub);
    const targetSic = peerSicCode.trim() || meta.sic;
    if (!targetSic) return;

    setPeerLoading(true);
    setPeerDiscoveryMessage('');
    try {
      const tickerMap = await loadTickerMap();
      const candidates = Object.entries(tickerMap)
        .map(([ticker, cik]) => ({ ticker, cik }))
        .filter(candidate => !selectedTickers.includes(candidate.ticker))
        .slice(0, 400);
      const peers: string[] = [];
      for (let index = 0; index < candidates.length && peers.length < 5; index += 20) {
        const batch = candidates.slice(index, index + 20);
        const submissions = await fetchCompanySubmissionsBatch(batch.map(candidate => candidate.cik.padStart(10, '0')), 5);
        for (let batchIndex = 0; batchIndex < submissions.length; batchIndex++) {
          const peerSub = submissions[batchIndex];
          const ticker = batch[batchIndex]?.ticker;
          if (!peerSub || !ticker) continue;
          if (extractCompanyMetadata(peerSub).sic === targetSic) {
            peers.push(ticker);
          }
          if (peers.length >= 5) break;
        }
      }
      if (peers.length > 0) {
        setSelectedTickers(prev => [...new Set([...prev, ...peers])].slice(0, 10));
        setPeerDiscoveryMessage(`Added ${peers.length} peers for SIC ${targetSic}${meta.sicDescription ? ` (${meta.sicDescription})` : ''}.`);
      } else {
        setPeerDiscoveryMessage(`No peers found yet for SIC ${targetSic}. Try a broader seed company or add peers manually.`);
      }
    } catch (err) {
      console.error('Peer group error:', err);
      setPeerDiscoveryMessage('Peer discovery failed. The SEC submissions feed may be temporarily unavailable.');
    }
    setPeerLoading(false);
  };

  // CSV Export
  const handleCsvExport = () => {
    if (viewMode === 'financials') {
      const headers = ['Metric', ...columns.map(col => `${colTicker(col)} FY${colYear(col)}`)];
      const rows: string[][] = [];
      for (const section of FINANCIAL_SECTIONS) {
        rows.push([`--- ${section.title} ---`, ...columns.map(() => '')]);
        for (const metric of section.metrics) {
          rows.push([
            metric.label,
            ...columns.map(col => {
              const m = companiesFacts[col]?.[metric.key];
              return m ? formatFinancialValue(m.value, m.unit, m.currency) : '—';
            })
          ]);
        }
      }
      rows.push(['--- Computed Ratios ---', ...columns.map(() => '')]);
      for (const ratio of RATIO_DEFINITIONS) {
        rows.push([ratio.label, ...columns.map(col => ratio.fn(col).display)]);
      }
      const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `benchmarking_${selectedTickers.join('_')}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (viewMode === 'audit-matrix') {
      const sections = SECTION_LISTS[matrixFormType] || ALL_SECTIONS;
      const headers = ['Section', ...selectedTickers];
      const rows = sections.map(s => [s, ...selectedTickers.map(t => matrixData[s]?.[t]?.present ? 'Yes' : 'No')]);
      const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `section_matrix_${matrixFormType}_${selectedTickers.join('_')}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Text diff
  useEffect(() => {
    if (viewMode !== 'text-diff') return;
    async function loadTexts() {
      if (selectedTickers.length === 0) return;
      setLoadingTexts(true);
      const texts: Record<string, string> = {};
      for (const ticker of selectedTickers) {
        const data = companiesData[ticker];
        if (!data) continue;
        const recentIdx = data.filings.recent.form.findIndex(f => f === '10-K');
        if (recentIdx === -1) { texts[ticker] = 'No 10-K filing found.'; continue; }
        const accession = data.filings.recent.accessionNumber[recentIdx];
        const primaryDoc = data.filings.recent.primaryDocument[recentIdx];
        const cleanAccession = accession.replace(/-/g, '');
        try {
          const resp = await fetch(buildSecProxyUrl(`Archives/edgar/data/${data.cik}/${cleanAccession}/${primaryDoc}`));
          const html = await resp.text();
          const bodyText = extractDocumentTextFromHtml(html);
          const lowerText = bodyText.toLowerCase();
          const target = selectedSection.toLowerCase();
          
          let currentIdx = lowerText.indexOf(target);
          const indices: number[] = [];
          while (currentIdx !== -1) {
            indices.push(currentIdx);
            currentIdx = lowerText.indexOf(target, currentIdx + Math.max(10, target.length));
          }
          
          if (indices.length > 0) {
            // Usually the TOC is near the beginning (e.g. index < 10000).
            // A preamble note might also be early. The actual section is usually later.
            const validIndices = indices.filter(i => i > 8000);
            
            // If there's a match past 8000 chars, pick the first one of those. otherwise pick the last one found.
            const sectionIdx = validIndices.length > 0 ? validIndices[0] : indices[indices.length - 1];
            texts[ticker] = bodyText.substring(sectionIdx, sectionIdx + 20000).trim();
          } else {
            texts[ticker] = `Section "${selectedSection}" not found in extracted text.`;
          }
        } catch {
          texts[ticker] = 'Failed to fetch filing content.';
        }
      }
      setCompanyTexts(texts);
      setLoadingTexts(false);
    }
    if (Object.keys(companiesData).length > 0) loadTexts();
  }, [selectedSection, selectedTickers, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeTicker = (ticker: string) => {
    setSelectedTickers(prev => prev.filter(t => t !== ticker));
    setSelectedYearsPerTicker(prev => { const n = { ...prev }; delete n[ticker]; return n; });
  };

  const handleAiCompare = async () => {
    if (columns.length < 2) return;
    setAiAnalyzing(true);
    try {
      let prompt = '';
      if (viewMode === 'financials') {
        const parts = columns.map(col => {
          const metrics = companiesFacts[col];
          if (!metrics) return `${colTicker(col)} FY${colYear(col)}: (no data)`;
          const lines = Object.entries(metrics).map(([, v]) => `${v.label}: ${formatFinancialValue(v.value, v.unit, v.currency)}`).join(', ');
          return `${colTicker(col)} FY${colYear(col)}: ${lines}`;
        }).join('\n\n');
        prompt = `Act as a senior accounting research analyst. Compare the following financial data across companies and fiscal years. Highlight key trends, year-over-year changes, and cross-company differences in margins, leverage, and cash flow quality:\n\n${parts}\n\nProvide a concise 3-paragraph analysis.`;
      } else {
        // Text compare fallback just in case
        prompt = `Act as an SEC compliance expert. Compare the following "${selectedSection}" disclosure excerpts:\n\n${columns.map(col => `${colTicker(col)}: (text here)`).join('\n\n')}\n\nProvide 3 concise paragraphs.`;
      }
      setAiAnalysis(await aiSummarize(prompt));
    } catch {
      setAiAnalysis('Failed to generate AI comparison.');
    }
    setAiAnalyzing(false);
  };

  // ===== RATIO FUNCTIONS — take colKey ("AAPL|2024") =====
  const getRatio = (colKey: string, numKey: string, denKey: string, multiply = 100, suffix = '%', decimals = 1): RatioResult => {
    const num = companiesFacts[colKey]?.[numKey]?.value;
    const den = companiesFacts[colKey]?.[denKey]?.value;
    if (num != null && den && den !== 0) {
      const val = (num / den) * multiply;
      return { display: `${val.toFixed(decimals)}${suffix}`, value: val };
    }
    return { display: '—', value: null };
  };

  const getGrossMargin = (col: string) => getRatio(col, 'GrossProfit', 'Revenues');
  const getOperatingMargin = (col: string) => getRatio(col, 'OperatingIncome', 'Revenues');
  const getNetMargin = (col: string) => getRatio(col, 'NetIncome', 'Revenues');

  const getDebtToEquity = (col: string): RatioResult => {
    const d = companiesFacts[col]?.TotalDebt?.value;
    const e = companiesFacts[col]?.StockholdersEquity?.value;
    if (d != null && e && e !== 0) return { display: `${(d / e).toFixed(2)}x`, value: d / e };
    return { display: '—', value: null };
  };

  const getROA = (col: string) => getRatio(col, 'NetIncome', 'TotalAssets');
  const getROE = (col: string) => getRatio(col, 'NetIncome', 'StockholdersEquity');
  const getAssetTurnover = (col: string) => getRatio(col, 'Revenues', 'TotalAssets', 1, 'x', 2);

  const getFCF = (col: string): RatioResult => {
    const ocf = companiesFacts[col]?.OperatingCashFlow?.value;
    const capex = companiesFacts[col]?.CapitalExpenditures?.value;
    if (ocf != null && capex != null) {
      const val = ocf - capex;
      return { display: formatFinancialValue(val, 'USD'), value: val };
    }
    return { display: '—', value: null };
  };

  const getCashFlowQuality = (col: string) => getRatio(col, 'OperatingCashFlow', 'NetIncome', 1, 'x', 2);
  const getSBCPct = (col: string) => getRatio(col, 'StockCompensation', 'Revenues');
  const getCapExPct = (col: string) => getRatio(col, 'CapitalExpenditures', 'Revenues');

  const getEffectiveTaxRate = (col: string): RatioResult => {
    const tax = companiesFacts[col]?.IncomeTaxExpense?.value;
    const ni = companiesFacts[col]?.NetIncome?.value;
    if (tax != null && ni != null && (ni + tax) !== 0) {
      const val = (tax / (ni + tax)) * 100;
      return { display: `${val.toFixed(1)}%`, value: val };
    }
    return { display: '—', value: null };
  };

  const getRatioColor = (value: number | null, thresholds: { green: number; amber: number }, higherIsBetter = true): string => {
    if (value == null) return '#475569';
    if (higherIsBetter) {
      if (value >= thresholds.green) return '#34D399';
      if (value >= thresholds.amber) return '#FBBF24';
      return '#F87171';
    } else {
      if (value <= thresholds.green) return '#34D399';
      if (value <= thresholds.amber) return '#FBBF24';
      return '#F87171';
    }
  };

  const getRatioBg = (value: number | null, thresholds: { green: number; amber: number }, higherIsBetter = true): string => {
    if (value == null) return 'transparent';
    if (higherIsBetter) {
      if (value >= thresholds.green) return 'rgba(16,185,129,0.08)';
      if (value >= thresholds.amber) return 'rgba(245,158,11,0.06)';
      return 'rgba(239,68,68,0.08)';
    } else {
      if (value <= thresholds.green) return 'rgba(16,185,129,0.08)';
      if (value <= thresholds.amber) return 'rgba(245,158,11,0.06)';
      return 'rgba(239,68,68,0.08)';
    }
  };

  const getBestCol = (fn: (col: string) => RatioResult, higherIsBetter = true): string | null => {
    let best: string | null = null;
    let bestVal: number | null = null;
    for (const col of columns) {
      const r = fn(col);
      if (r.value != null && (bestVal == null || (higherIsBetter ? r.value > bestVal : r.value < bestVal))) {
        bestVal = r.value; best = col;
      }
    }
    return best;
  };

  const RATIO_DEFINITIONS: { label: string; fn: (col: string) => RatioResult; thresholds: { green: number; amber: number }; higherIsBetter: boolean }[] = [
    { label: 'Gross Margin', fn: getGrossMargin, thresholds: { green: 40, amber: 20 }, higherIsBetter: true },
    { label: 'Operating Margin', fn: getOperatingMargin, thresholds: { green: 20, amber: 10 }, higherIsBetter: true },
    { label: 'Net Margin', fn: getNetMargin, thresholds: { green: 15, amber: 5 }, higherIsBetter: true },
    { label: 'Return on Assets (ROA)', fn: getROA, thresholds: { green: 10, amber: 3 }, higherIsBetter: true },
    { label: 'Return on Equity (ROE)', fn: getROE, thresholds: { green: 15, amber: 8 }, higherIsBetter: true },
    { label: 'Asset Turnover', fn: getAssetTurnover, thresholds: { green: 0.8, amber: 0.4 }, higherIsBetter: true },
    { label: 'Debt-to-Equity', fn: getDebtToEquity, thresholds: { green: 0.5, amber: 1.5 }, higherIsBetter: false },
    { label: 'Free Cash Flow', fn: getFCF, thresholds: { green: 0, amber: -1e9 }, higherIsBetter: true },
    { label: 'Cash Flow / Net Income', fn: getCashFlowQuality, thresholds: { green: 1.0, amber: 0.7 }, higherIsBetter: true },
    { label: 'SBC % of Revenue', fn: getSBCPct, thresholds: { green: 5, amber: 15 }, higherIsBetter: false },
    { label: 'CapEx % of Revenue', fn: getCapExPct, thresholds: { green: 5, amber: 15 }, higherIsBetter: false },
    { label: 'Effective Tax Rate', fn: getEffectiveTaxRate, thresholds: { green: 25, amber: 35 }, higherIsBetter: false },
  ];

  const handleGenerateCohortReport = async () => {
    if (selectedTickers.length === 0) return;

    setCohortReportLoading(true);
    try {
      const seedMeta = selectedTickers[0] ? companiesData[selectedTickers[0]] : null;
      const meta = seedMeta ? extractCompanyMetadata(seedMeta) : null;

      const companyLines = selectedTickers.map(ticker => {
        const latestYear = selectedYearsPerTicker[ticker]?.[0];
        const col = latestYear ? makeColKey(ticker, latestYear) : null;
        const facts = col ? companiesFacts[col] : null;
        const submission = companiesData[ticker];
        const companyMeta = submission ? extractCompanyMetadata(submission) : null;

        return [
          `${ticker}${latestYear ? ` FY${latestYear}` : ''}`,
          companyMeta?.name || ticker,
          facts?.Revenues ? `Revenue ${formatFinancialValue(facts.Revenues.value, facts.Revenues.unit, facts.Revenues.currency)}` : 'Revenue unavailable',
          `Net Margin ${col ? getNetMargin(col).display : '-'}`,
          `ROE ${col ? getROE(col).display : '-'}`,
          `Debt/Equity ${col ? getDebtToEquity(col).display : '-'}`,
          `Cash Flow Quality ${col ? getCashFlowQuality(col).display : '-'}`,
        ].join(' | ');
      });

      const numericAverage = (items: Array<number | null>) => {
        const values = items.filter((value): value is number => value != null);
        if (values.length === 0) return null;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      };

      const latestCols = selectedTickers
        .map(ticker => {
          const latestYear = selectedYearsPerTicker[ticker]?.[0];
          return latestYear ? makeColKey(ticker, latestYear) : null;
        })
        .filter((value): value is string => Boolean(value));

      const avgNetMargin = numericAverage(latestCols.map(col => getNetMargin(col).value));
      const avgRoe = numericAverage(latestCols.map(col => getROE(col).value));
      const avgDebt = numericAverage(latestCols.map(col => getDebtToEquity(col).value));
      const avgCashFlowQuality = numericAverage(latestCols.map(col => getCashFlowQuality(col).value));

      const fallbackReport = [
        `Cohort size: ${selectedTickers.length} issuers.`,
        meta?.sic || peerSicCode ? `Industry scope: SIC ${peerSicCode || meta?.sic}${meta?.sicDescription ? ` (${meta.sicDescription})` : ''}.` : '',
        avgNetMargin != null ? `Average net margin across the latest selected fiscal years is ${avgNetMargin.toFixed(1)}%.` : '',
        avgRoe != null ? `Average ROE is ${avgRoe.toFixed(1)}%.` : '',
        avgDebt != null ? `Average debt-to-equity is ${avgDebt.toFixed(2)}x.` : '',
        avgCashFlowQuality != null ? `Average cash flow quality is ${avgCashFlowQuality.toFixed(2)}x.` : '',
        `Constituents: ${companyLines.join(' || ')}`,
      ]
        .filter(Boolean)
        .join(' ');

      const prompt = `You are preparing a concise peer benchmarking memo for an accounting and legal research team.

Industry context:
- SIC target: ${peerSicCode || meta?.sic || 'unknown'}
- SIC description: ${meta?.sicDescription || 'unknown'}

Selected cohort:
${companyLines.map(line => `- ${line}`).join('\n')}

Computed averages:
- Average net margin: ${avgNetMargin != null ? `${avgNetMargin.toFixed(1)}%` : 'n/a'}
- Average ROE: ${avgRoe != null ? `${avgRoe.toFixed(1)}%` : 'n/a'}
- Average debt-to-equity: ${avgDebt != null ? `${avgDebt.toFixed(2)}x` : 'n/a'}
- Average cash flow quality: ${avgCashFlowQuality != null ? `${avgCashFlowQuality.toFixed(2)}x` : 'n/a'}

Write a short memo with:
1. What stands out in the cohort.
2. Which peers look strongest or weakest and why.
3. What disclosure or diligence follow-up the team should investigate next.

Keep it crisp and practical.`;

      const aiResponse = await aiSummarize(prompt);
      if (!aiResponse || aiResponse.toLowerCase().includes('unavailable') || aiResponse.toLowerCase().includes('api key missing')) {
        setCohortReport(fallbackReport);
      } else {
        setCohortReport(aiResponse);
      }
    } catch (error) {
      console.error('Cohort memo error:', error);
      setCohortReport('Cohort memo unavailable. The benchmarking data loaded, but the summary could not be generated right now.');
    } finally {
      setCohortReportLoading(false);
    }
  };

  // ---- Shared cell border style (groups same-company columns visually) ----
  const colBorderStyle = (colKey: string, idx: number): React.CSSProperties => {
    const isFirstOfTicker = idx === 0 || colTicker(columns[idx - 1]) !== colTicker(colKey);
    return { borderLeft: isFirstOfTicker ? `2px solid ${getColColor(colKey)}` : `1px solid ${groupedBorderColor}` };
  };

  return (
    <div className="benchmarking-container">
      <div className="benchmark-header">
        <div className="benchmark-title">
          <h1>Disclosure Benchmarking Matrix</h1>
          <p>Compare financial statements across companies and fiscal years using live SEC XBRL data. Add multiple years per company for trend analysis.</p>
        </div>

        <div className="benchmark-actions" style={{ display: 'flex', alignItems: 'center' }}>
          <div className="view-toggles glass-card" style={{ padding: '4px', display: 'flex', gap: '4px', marginRight: '16px', borderRadius: '8px' }}>
            <button className={`toggle-view-btn ${viewMode === 'financials' ? 'active' : ''}`} onClick={() => setViewMode('financials')}>
              <DollarSign size={16} /> Financials
            </button>
            <button className={`toggle-view-btn ${viewMode === 'text-diff' ? 'active' : ''}`} onClick={() => setViewMode('text-diff')}>
              <Type size={16} /> Text Redline
            </button>
            <button className={`toggle-view-btn ${viewMode === 'audit-matrix' ? 'active' : ''}`} onClick={() => setViewMode('audit-matrix')}>
              <LayoutGrid size={16} /> Audit Matrix
            </button>
          </div>
          <button className="icon-btn" title="Export as CSV" onClick={handleCsvExport}><Download size={18} /> Export</button>
        </div>
      </div>

      <div className="glass-card" style={{ padding: '18px 20px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1rem' }}>Peer Cohort Builder</h3>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.84rem', maxWidth: '760px' }}>
              Build a focused peer set by SIC code, then generate a short memo on how the cohort stacks up. This is meant to replace the manual industry-code gathering step with something much closer to a usable peer workbench.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={peerSicCode}
              onChange={e => setPeerSicCode(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
              placeholder="SIC code"
              style={{
                padding: '8px 10px',
                minWidth: '120px',
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
              }}
            />
            <button
              className="add-ticker-btn"
              onClick={handleQuickPeerGroup}
              disabled={peerLoading || selectedTickers.length === 0}
              style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {peerLoading ? <Loader2 size={14} className="spinner" /> : <Users size={14} />}
              Find SIC Peers
            </button>
            <button
              className="primary-btn sm"
              onClick={handleGenerateCohortReport}
              disabled={cohortReportLoading || selectedTickers.length < 2}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {cohortReportLoading ? <Loader2 size={14} className="spinner" /> : <Sparkles size={14} />}
              Generate Cohort Memo
            </button>
          </div>
        </div>

        {peerDiscoveryMessage && (
          <div style={{ color: 'var(--text-primary)', fontSize: '0.82rem', background: 'rgba(179,31,126,0.08)', border: '1px solid rgba(179,31,126,0.16)', borderRadius: '8px', padding: '10px 12px' }}>
            {peerDiscoveryMessage}
          </div>
        )}

        {cohortReport && (
          <div style={{ borderLeft: '4px solid #B31F7E', background: 'var(--surface-panel)', borderRadius: '10px', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Sparkles size={16} className="text-blue-400" />
              <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>Cohort Memo</h4>
            </div>
            <div className="md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(cohortReport) }} />
          </div>
        )}
      </div>

      {/* ===== COHORT SELECTOR ===== */}
      <div className="benchmark-controls glass-card">
        {viewMode === 'text-diff' && (
          <div className="control-group">
            <label>Compare Section:</label>
            <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)} className="select-input">
              {ALL_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div className="control-group comparison-selector" style={{ flex: 1 }}>
          <label>Compare Cohort — add years per company to compare across fiscal years:</label>
          <div className="active-selectors" style={{ flexWrap: 'wrap', gap: '8px' }}>
            {selectedTickers.map(ticker => {
              const years = availableYears[ticker] || [];
              const selYears = selectedYearsPerTicker[ticker] || [];
              const color = getColColor(makeColKey(ticker, selYears[0] || 0));
              const unselectedYears = years.filter(y => !selYears.includes(y));
              const isDropdownOpen = openYearDropdown === ticker;
              return (
                <div key={ticker} className="selected-company-badge" style={{ position: 'relative' }}>
                  {/* Ticker label */}
                  <span style={{
                    padding: '6px 10px',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    color: 'var(--text-primary)',
                    borderRight: `2px solid ${color}`,
                    background: `${color}22`,
                    whiteSpace: 'nowrap',
                  }}>
                    {ticker}
                  </span>

                  {/* Selected year chips */}
                  {selYears.map(y => (
                    <span key={y} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '4px 8px',
                      borderRight: `1px solid ${groupedBorderColor}`,
                      color: 'var(--text-primary)',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}>
                      FY{y}
                      <button
                        onClick={e => { e.stopPropagation(); toggleYear(ticker, y); }}
                        title={`Remove FY${y}`}
                        style={{ padding: '0 2px', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  {/* + Add Year button */}
                  {years.length === 0 && loadingFacts ? (
                    <span style={{ padding: '6px 8px' }}><Loader2 size={12} className="spinner" style={{ color: 'var(--text-muted)' }} /></span>
                  ) : unselectedYears.length > 0 && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                        setOpenYearDropdown(isDropdownOpen ? null : ticker);
                      }}
                      style={{
                        padding: '5px 10px',
                        fontSize: '0.78rem',
                        color: '#D66CAE',
                        borderRight: `1px solid ${groupedBorderColor}`,
                        fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '3px',
                      }}
                    >
                      + FY
                    </button>
                  )}

                  {/* Remove company */}
                  <button
                    onClick={() => removeTicker(ticker)}
                    title="Remove company"
                    style={{ padding: '6px 8px', color: 'var(--text-muted)' }}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            {selectedTickers.length < 10 && (
              <div className="ticker-input-wrap" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <CompanySearchInput
                  onSelect={(ticker) => {
                    if (!selectedTickers.includes(ticker) && selectedTickers.length < 10) {
                      setSelectedTickers(prev => [...prev, ticker]);
                    }
                  }}
                  placeholder="Type ticker & press Enter"
                  className="benchmark-company-search"
                />
                <button
                  className="add-ticker-btn"
                  onClick={handleQuickPeerGroup}
                  disabled={peerLoading || selectedTickers.length === 0}
                  title="Auto-add companies with same SIC code"
                  style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {peerLoading ? <Loader2 size={14} className="spinner" /> : <Users size={14} />}
                  Peer Group
                </button>
              </div>
            )}
          </div>
          {columns.length > 0 && (
            <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {columns.length} column{columns.length !== 1 ? 's' : ''}: {columns.map(col => `${colTicker(col)} FY${colYear(col)}`).join(' · ')}
            </div>
          )}
        </div>

        {viewMode === 'text-diff' && (
          <div className="legend-group" style={{ marginLeft: 'auto' }}>
            <label>Highlight Legend:</label>
            <div className="diff-legend">
              <span className="legend-pill unique">Unique Language</span>
              <span className="legend-pill similar">Similar Meaning</span>
              <span className="legend-pill boilerplate">Standard Boilerplate</span>
            </div>
          </div>
        )}
      </div>

      {/* AI Compare */}
      {viewMode === 'text-diff' ? (
        <DisclosureMatrix 
          className="mb-4"
          tickers={selectedTickers}
          section={selectedSection}
          filingContexts={selectedTickers.map(t => ({
             ticker: t,
             companyName: companiesData[t]?.name || t,
             text: companyTexts[t] ? companyTexts[t].substring(0, 20000) : ''
          })).filter(f => f.text.length > 0)}
          onExportDocx={generateMemoDocx}
        />
      ) : aiAnalysis || aiAnalyzing ? (
        <div className="ai-comparison-panel glass-card" style={{ padding: '24px', marginBottom: '8px', borderLeft: '4px solid #B31F7E' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Sparkles className="text-blue-400" size={20} />
            <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>URC Financial Compare</h3>
          </div>
          {aiAnalyzing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)' }}>
              <Loader2 className="spinner" size={18} /> Generating comparative analysis...
            </div>
          ) : (
            <div className="ai-result-text md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiAnalysis) }} />
          )}
          <div style={{ marginTop: '16px' }}><ResponsibleAIBanner /></div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button className="primary-btn sm" onClick={handleAiCompare} disabled={columns.length < 2}>
            <Sparkles size={16} /> Generate Financial Summary
          </button>
        </div>
      )}
      
      {viewMode === 'financials' && (
        <div className="financials-view" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {loadingFacts || isLoading ? (
            <div className="glass-card" style={{ padding: '64px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 size={32} className="spinner" style={{ display: 'inline-block', marginBottom: '16px' }} />
              <p>Fetching XBRL financial data from SEC EDGAR...</p>
            </div>
          ) : columns.length > 0 ? (
            <>
              {/* KPI CARDS — one per column */}
              <div className="kpi-cards-row">
                {columns.map((col) => {
                  const facts = companiesFacts[col];
                  if (!facts) return null;
                  const rev = facts.Revenues;
                  const nm = getNetMargin(col);
                  const roe = getROE(col);
                  const fcf = getFCF(col);
                  const color = getColColor(col);
                  return (
                    <div key={col} className="kpi-card glass-card" style={{ borderTop: `3px solid ${color}` }}>
                      <div className="kpi-card-header">
                        <span className="kpi-card-ticker" style={{ color }}>{colTicker(col)}</span>
                        <span className="kpi-card-fy">FY{colYear(col)}</span>
                      </div>
                      <div className="kpi-card-metrics">
                        <div className="kpi-metric">
                          <span className="kpi-card-label">Revenue</span>
                          <span className="kpi-card-value">{rev ? formatFinancialValue(rev.value, rev.unit, rev.currency) : '—'}</span>
                        </div>
                        <div className="kpi-metric">
                          <span className="kpi-card-label">Net Margin</span>
                          <span className="kpi-card-value" style={{ color: getRatioColor(nm.value, { green: 15, amber: 5 }) }}>
                            {nm.display}
                            {nm.value != null && (nm.value >= 0 ? <TrendingUp size={12} style={{ marginLeft: 4 }} /> : <TrendingDown size={12} style={{ marginLeft: 4 }} />)}
                          </span>
                        </div>
                        <div className="kpi-metric">
                          <span className="kpi-card-label">ROE</span>
                          <span className="kpi-card-value" style={{ color: getRatioColor(roe.value, { green: 15, amber: 8 }) }}>{roe.display}</span>
                        </div>
                        <div className="kpi-metric">
                          <span className="kpi-card-label">Free Cash Flow</span>
                          <span className="kpi-card-value" style={{ color: fcf.value != null && fcf.value > 0 ? '#34D399' : '#F87171' }}>{fcf.display}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* MAIN BAR CHARTS */}
              <div className="charts-grid-3col">
                {[
                  { key: 'Revenues', title: 'Revenue' },
                  { key: 'NetIncome', title: 'Net Income' },
                  { key: 'OperatingCashFlow', title: 'Operating Cash Flow' },
                ].map(chart => {
                  const chartData = columns
                    .filter(col => companiesFacts[col]?.[chart.key]?.value != null)
                    .map(col => ({
                      name: colLabel(col),
                      value: (companiesFacts[col]?.[chart.key]?.value || 0) / 1e9,
                      fill: getColColor(col),
                    }));
                  if (chartData.length === 0) return null;
                  return (
                    <div key={chart.key} className="glass-card" style={{ padding: '20px' }}>
                      <h4 className="chart-title">{chart.title} <span className="chart-subtitle">($ Billions)</span></h4>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={chartData} barSize={Math.max(16, Math.min(36, 200 / chartData.length))}>
                          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                          <XAxis dataKey="name" tick={{ fill: axisTickColor, fontSize: 10 }} axisLine={{ stroke: axisLineColor }} />
                          <YAxis tick={axisStyle} axisLine={{ stroke: axisLineColor }} tickFormatter={(v: number) => `$${v.toFixed(0)}B`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`$${value.toFixed(1)}B`, chart.title]} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>

              {/* PROFITABILITY MARGINS */}
              {(() => {
                const marginData = columns
                  .filter(col => companiesFacts[col]?.Revenues?.value)
                  .map(col => {
                    const rev = companiesFacts[col]?.Revenues?.value || 1;
                    const gp = companiesFacts[col]?.GrossProfit?.value;
                    const oi = companiesFacts[col]?.OperatingIncome?.value;
                    const ni = companiesFacts[col]?.NetIncome?.value;
                    return {
                      name: colLabel(col),
                      'Gross Margin': gp != null ? +((gp / rev) * 100).toFixed(1) : 0,
                      'Operating Margin': oi != null ? +((oi / rev) * 100).toFixed(1) : 0,
                      'Net Margin': ni != null ? +((ni / rev) * 100).toFixed(1) : 0,
                    };
                  });
                if (marginData.length === 0) return null;
                return (
                  <div className="glass-card" style={{ padding: '20px' }}>
                    <h4 className="chart-title">Profitability Margins <span className="chart-subtitle">(%)</span></h4>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={marginData} barGap={4}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis dataKey="name" tick={{ fill: axisTickColor, fontSize: 10 }} axisLine={{ stroke: axisLineColor }} />
                        <YAxis tick={axisStyle} axisLine={{ stroke: axisLineColor }} tickFormatter={(v: number) => `${v}%`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value.toFixed(1)}%`]} />
                        <Legend wrapperStyle={{ fontSize: '0.75rem', color: tableMutedText }} />
                        <Bar dataKey="Gross Margin" fill="#B31F7E" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Operating Margin" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Net Margin" fill="#10B981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {/* BALANCE SHEET + CASH FLOW */}
              <div className="charts-grid-2col">
                {(() => {
                  const bsData = columns
                    .filter(col => companiesFacts[col]?.TotalAssets?.value != null)
                    .map(col => {
                      const ta = companiesFacts[col]?.TotalAssets?.value || 0;
                      const cash = companiesFacts[col]?.CashAndEquivalents?.value || 0;
                      const gw = (companiesFacts[col]?.Goodwill?.value || 0) + (companiesFacts[col]?.IntangibleAssets?.value || 0);
                      const arInv = (companiesFacts[col]?.AccountsReceivable?.value || 0) + (companiesFacts[col]?.Inventory?.value || 0);
                      const other = Math.max(0, ta - cash - gw - arInv);
                      return {
                        name: colLabel(col),
                        Cash: +(cash / 1e9).toFixed(1),
                        'Goodwill & Intangibles': +(gw / 1e9).toFixed(1),
                        'AR + Inventory': +(arInv / 1e9).toFixed(1),
                        'Other Assets': +(other / 1e9).toFixed(1),
                      };
                    });
                  if (bsData.length === 0) return null;
                  return (
                    <div className="glass-card" style={{ padding: '20px' }}>
                      <h4 className="chart-title">Balance Sheet Composition <span className="chart-subtitle">($ Billions)</span></h4>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={bsData}>
                          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                          <XAxis dataKey="name" tick={{ fill: axisTickColor, fontSize: 10 }} axisLine={{ stroke: axisLineColor }} />
                          <YAxis tick={axisStyle} axisLine={{ stroke: axisLineColor }} tickFormatter={(v: number) => `$${v}B`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`$${value.toFixed(1)}B`]} />
                          <Legend wrapperStyle={{ fontSize: '0.7rem', color: tableMutedText }} />
                          <Bar dataKey="Cash" stackId="a" fill="#B31F7E" />
                          <Bar dataKey="AR + Inventory" stackId="a" fill="#F59E0B" />
                          <Bar dataKey="Goodwill & Intangibles" stackId="a" fill="#8B5CF6" />
                          <Bar dataKey="Other Assets" stackId="a" fill="#475569" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}

                {(() => {
                  const cfData = columns
                    .filter(col => companiesFacts[col]?.OperatingCashFlow?.value != null)
                    .map(col => ({
                      name: colLabel(col),
                      'Operating CF': +((companiesFacts[col]?.OperatingCashFlow?.value || 0) / 1e9).toFixed(1),
                      'CapEx': -Math.abs((companiesFacts[col]?.CapitalExpenditures?.value || 0) / 1e9),
                      'Dividends': -Math.abs((companiesFacts[col]?.DividendsPaid?.value || 0) / 1e9),
                      'Buybacks': -Math.abs((companiesFacts[col]?.ShareRepurchases?.value || 0) / 1e9),
                    }));
                  if (cfData.length === 0) return null;
                  return (
                    <div className="glass-card" style={{ padding: '20px' }}>
                      <h4 className="chart-title">Cash Flow Allocation <span className="chart-subtitle">($ Billions)</span></h4>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={cfData} barGap={2}>
                          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                          <XAxis dataKey="name" tick={{ fill: axisTickColor, fontSize: 10 }} axisLine={{ stroke: axisLineColor }} />
                          <YAxis tick={axisStyle} axisLine={{ stroke: axisLineColor }} tickFormatter={(v: number) => `$${v}B`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`$${value.toFixed(1)}B`]} />
                          <Legend wrapperStyle={{ fontSize: '0.7rem', color: tableMutedText }} />
                          <Bar dataKey="Operating CF" fill="#10B981" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="CapEx" fill="#EF4444" radius={[0, 0, 4, 4]} />
                          <Bar dataKey="Dividends" fill="#F59E0B" radius={[0, 0, 4, 4]} />
                          <Bar dataKey="Buybacks" fill="#8B5CF6" radius={[0, 0, 4, 4]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
              </div>

              {/* RADAR — only show if reasonable number of columns */}
              {columns.length >= 2 && columns.length <= 8 && (() => {
                const dimensions = [
                  { key: 'Gross Margin', fn: getGrossMargin },
                  { key: 'Operating Margin', fn: getOperatingMargin },
                  { key: 'Net Margin', fn: getNetMargin },
                  { key: 'ROA', fn: getROA },
                  { key: 'ROE', fn: getROE },
                  { key: 'Cash Quality', fn: getCashFlowQuality },
                ];

                const rawValues: Record<string, Record<string, number>> = {};
                for (const col of columns) {
                  rawValues[col] = {};
                  for (const dim of dimensions) rawValues[col][dim.key] = dim.fn(col).value ?? 0;
                }

                const radarData = dimensions.map(dim => {
                  const vals = columns.map(col => rawValues[col][dim.key]);
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  const range = max - min || 1;
                  const entry: Record<string, string | number> = { dimension: dim.key };
                  for (const col of columns) {
                    entry[col] = +((((rawValues[col][dim.key] - min) / range) * 80 + 10)).toFixed(0);
                  }
                  return entry;
                });

                return (
                  <div className="glass-card" style={{ padding: '20px' }}>
                    <h4 className="chart-title">Financial Profile Comparison <span className="chart-subtitle">(Normalized across all columns)</span></h4>
                    <ResponsiveContainer width="100%" height={320}>
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                        <PolarGrid stroke={axisLineColor} />
                        <PolarAngleAxis dataKey="dimension" tick={{ fill: axisTickColor, fontSize: 11 }} />
                        {columns.map((col, i) => (
                          <Radar
                            key={col}
                            name={`${colTicker(col)} FY${colYear(col)}`}
                            dataKey={col}
                            stroke={CHART_COLORS[i % CHART_COLORS.length]}
                            fill={CHART_COLORS[i % CHART_COLORS.length]}
                            fillOpacity={0.12}
                            strokeWidth={2}
                          />
                        ))}
                        <Legend wrapperStyle={{ fontSize: '0.75rem', color: tableMutedText }} />
                        <Tooltip contentStyle={tooltipStyle} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {/* MAIN DATA TABLE */}
              <div className="glass-card" style={{ overflow: 'auto' }}>
                <table className="financial-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${300 + columns.length * 150}px` }}>
                  <thead>
                    <tr style={{ background: tableHeaderBackground, borderBottom: `2px solid ${axisLineColor}`, position: 'sticky', top: 0, zIndex: 10 }}>
                      <th style={{ padding: '16px 20px', fontWeight: 600, color: tableHeaderText, textAlign: 'left', width: '280px', fontSize: '0.85rem' }}>
                        Metric
                      </th>
                      {columns.map((col, idx) => {
                        const color = getColColor(col);
                        const isFirstOfTicker = idx === 0 || colTicker(columns[idx - 1]) !== colTicker(col);
                        return (
                          <th key={col} style={{
                            padding: '12px 14px',
                            fontWeight: 700,
                            color: tableHeaderText,
                            textAlign: 'right',
                            borderLeft: isFirstOfTicker ? `2px solid ${color}` : `1px solid ${groupedBorderColor}`,
                            fontSize: '0.85rem',
                            minWidth: '130px',
                          }}>
                            <span style={{ color }}>{colTicker(col)}</span>
                            <div style={{ fontSize: '0.72rem', fontWeight: 500, color: tableMutedText, marginTop: '2px' }}>FY{colYear(col)}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {FINANCIAL_SECTIONS.map(section => (
                      <React.Fragment key={section.title}>
                        <tr>
                          <td colSpan={columns.length + 1} style={{
                            padding: '12px 20px', background: 'rgba(179,31,126,0.06)',
                            fontWeight: 700, fontSize: '0.8rem', color: '#D66CAE',
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                            borderTop: '1px solid rgba(179,31,126,0.15)', borderBottom: '1px solid rgba(179,31,126,0.15)'
                          }}>
                            {section.title}
                          </td>
                        </tr>
                        {section.metrics.map(metric => (
                          <tr key={metric.key} className="table-data-row">
                            <td style={{ padding: '10px 20px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                              {metric.label}
                            </td>
                            {columns.map((col, idx) => {
                              const m = companiesFacts[col]?.[metric.key];
                              return (
                                <td key={col} style={{
                                  padding: '10px 14px', textAlign: 'right',
                                  fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
                                  color: m?.value != null ? (m.value < 0 ? '#F87171' : 'var(--text-primary)') : 'var(--text-muted)',
                                  ...colBorderStyle(col, idx),
                                }}>
                                  {m ? formatFinancialValue(m.value, m.unit, m.currency) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}

                    {/* COMPUTED RATIOS */}
                    <tr>
                      <td colSpan={columns.length + 1} style={{
                        padding: '12px 20px', background: 'rgba(16,185,129,0.06)',
                        fontWeight: 700, fontSize: '0.8rem', color: '#34D399',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                        borderTop: '1px solid rgba(16,185,129,0.15)', borderBottom: '1px solid rgba(16,185,129,0.15)'
                      }}>
                        Computed Ratios & Analytical Metrics
                      </td>
                    </tr>
                    {RATIO_DEFINITIONS.map(ratio => {
                      const bestCol = getBestCol(ratio.fn, ratio.higherIsBetter);
                      return (
                        <tr key={ratio.label} className="table-data-row">
                          <td style={{ padding: '10px 20px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, fontStyle: 'italic' }}>
                            {ratio.label}
                          </td>
                          {columns.map((col, idx) => {
                            const r = ratio.fn(col);
                            const isBest = col === bestCol && columns.length > 1;
                            return (
                              <td key={col} style={{
                                padding: '10px 14px', textAlign: 'right',
                                fontFamily: 'var(--font-mono)', fontSize: '0.85rem',
                                color: getRatioColor(r.value, ratio.thresholds, ratio.higherIsBetter),
                                background: getRatioBg(r.value, ratio.thresholds, ratio.higherIsBetter),
                                borderLeft: isBest
                                  ? '3px solid #10B981'
                                  : (idx === 0 || colTicker(columns[idx - 1]) !== colTicker(col))
                                    ? `2px solid ${getColColor(col)}`
                                    : `1px solid ${groupedBorderColor}`,
                              }}>
                                {r.display}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="glass-card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Add companies above to compare financials.
            </div>
          )}
        </div>
      )}

      {/* ===== TEXT DIFF VIEW ===== */}
      {viewMode === 'text-diff' && (
        <div className="comparison-grid" style={{ overflowX: 'auto', paddingBottom: '16px' }}>
          {selectedTickers.map(ticker => {
            const data = companiesData[ticker];
            const text = companyTexts[ticker];
            return (
              <div key={ticker} className="comparison-column glass-card" style={{ minWidth: '350px' }}>
                <div className="column-header">
                  <div className="col-ticker">{ticker}</div>
                  {data ? (
                    <>
                      <div className="col-name">{data.name}</div>
                      <div className="col-doc">CIK: {data.cik}</div>
                    </>
                  ) : isLoading ? (
                    <div className="col-doc"><Loader2 size={14} className="spinner" style={{ display: 'inline-block' }} /> Loading...</div>
                  ) : (
                    <div className="col-name" style={{ color: 'var(--text-muted)' }}>Ticker not found in EDGAR</div>
                  )}
                </div>
                <div className="column-body document-text">
                  {loadingTexts ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                      <Loader2 size={16} className="spinner" /> Fetching live filing text...
                    </div>
                  ) : text ? (
                    <p style={{ fontSize: '0.85rem', lineHeight: 1.7, color: 'var(--text-primary)' }}>{text}</p>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No data available.</p>
                  )}
                </div>
              </div>
            );
          })}
          {selectedTickers.length === 0 && (
            <div className="empty-comparison glass-card" style={{ minWidth: '100%' }}>
              <ArrowRightLeft size={48} className="text-muted" />
              <h3>Select peers to compare</h3>
              <p>Type any ticker symbol above and press Enter.</p>
            </div>
          )}
        </div>
      )}

      {/* ===== AUDIT MATRIX VIEW ===== */}
      {viewMode === 'audit-matrix' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="glass-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>Form Type:</span>
            {Object.keys(SECTION_LISTS).map(ft => (
              <button key={ft} onClick={() => setMatrixFormType(ft)} style={{
                padding: '6px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.8rem',
                background: matrixFormType === ft ? '#B31F7E' : 'var(--surface-subtle)',
                color: matrixFormType === ft ? '#FFFFFF' : 'var(--text-secondary)', transition: 'all 0.15s',
              }}>
                {ft}
              </button>
            ))}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 'auto' }}>
              {(SECTION_LISTS[matrixFormType] || ALL_SECTIONS).length} sections &middot; {selectedTickers.length} companies
            </span>
          </div>

          <SectionMatrix
            sections={SECTION_LISTS[matrixFormType] || ALL_SECTIONS}
            companies={selectedTickers.map(t => ({ ticker: t, name: companiesData[t]?.name || t }))}
            data={matrixData}
            loading={matrixLoading || isLoading}
          />

          <div className="glass-card" style={{ overflow: 'auto' }}>
            <h4 style={{ padding: '16px 20px', margin: 0, color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600, borderBottom: `1px solid ${groupedBorderColor}` }}>
              Accounting & Governance Metrics
            </h4>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
                <tr style={{ background: tableHeaderBackground, borderBottom: `1px solid ${axisLineColor}`, fontSize: '0.85rem' }}>
                  <th style={{ padding: '14px 20px', fontWeight: 600, color: tableHeaderText, width: '250px' }}>Metric</th>
                  {columns.map((col, idx) => {
                    const color = getColColor(col);
                    const isFirst = idx === 0 || colTicker(columns[idx - 1]) !== colTicker(col);
                    return (
                      <th key={col} style={{ padding: '14px 16px', fontWeight: 600, color: tableHeaderText, borderLeft: isFirst ? `2px solid ${color}` : `1px solid ${groupedBorderColor}` }}>
                        <span style={{ color }}>{colTicker(col)}</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>FY{colYear(col)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody style={{ fontSize: '0.85rem' }}>
                {[
                  { metric: 'Revenue Recognition (ASC 606)', getValue: (col: string) => companiesFacts[col]?.Revenues ? formatFinancialValue(companiesFacts[col].Revenues.value, companiesFacts[col].Revenues.unit, companiesFacts[col].Revenues.currency) : '—' },
                  { metric: 'Operating Lease ROU (ASC 842)', getValue: (col: string) => companiesFacts[col]?.OperatingLeaseROU ? formatFinancialValue(companiesFacts[col].OperatingLeaseROU.value, companiesFacts[col].OperatingLeaseROU.unit, companiesFacts[col].OperatingLeaseROU.currency) : 'Not Reported' },
                  { metric: 'Stock-Based Compensation', getValue: (col: string) => companiesFacts[col]?.StockCompensation ? formatFinancialValue(companiesFacts[col].StockCompensation.value, companiesFacts[col].StockCompensation.unit, companiesFacts[col].StockCompensation.currency) : '—' },
                  { metric: 'Deferred Revenue', getValue: (col: string) => companiesFacts[col]?.DeferredRevenue ? formatFinancialValue(companiesFacts[col].DeferredRevenue.value, companiesFacts[col].DeferredRevenue.unit, companiesFacts[col].DeferredRevenue.currency) : '—' },
                  { metric: 'Income Tax (ASC 740)', getValue: (col: string) => companiesFacts[col]?.IncomeTaxExpense ? formatFinancialValue(companiesFacts[col].IncomeTaxExpense.value, companiesFacts[col].IncomeTaxExpense.unit, companiesFacts[col].IncomeTaxExpense.currency) : '—' },
                  { metric: 'Goodwill (ASC 350)', getValue: (col: string) => companiesFacts[col]?.Goodwill ? formatFinancialValue(companiesFacts[col].Goodwill.value, companiesFacts[col].Goodwill.unit, companiesFacts[col].Goodwill.currency) : 'N/A' },
                  { metric: 'Gross Margin', getValue: (col: string) => getGrossMargin(col).display },
                  { metric: 'Net Margin', getValue: (col: string) => getNetMargin(col).display },
                  { metric: 'Debt/Equity Ratio', getValue: (col: string) => getDebtToEquity(col).display },
                ].map(row => (
                  <tr key={row.metric} style={{ borderBottom: `1px solid ${groupedBorderColor}` }}>
                    <td style={{ padding: '12px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>{row.metric}</td>
                    {columns.map((col, idx) => {
                      const isFirst = idx === 0 || colTicker(columns[idx - 1]) !== colTicker(col);
                      return (
                        <td key={col} style={{ padding: '12px 16px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', borderLeft: isFirst ? `2px solid ${getColColor(col)}` : `1px solid ${groupedBorderColor}` }}>
                          {row.getValue(col)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Year dropdown portal — renders at body level to avoid overflow clipping */}
      {openYearDropdown && createPortal(
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 9999,
            background: 'var(--surface-panel-strong)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '4px',
            minWidth: '96px',
            boxShadow: isDarkMode ? '0 16px 30px rgba(0,0,0,0.35)' : '0 16px 26px rgba(72,42,122,0.14)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
          onClick={e => e.stopPropagation()}
        >
          {(availableYears[openYearDropdown] || [])
            .filter(y => !(selectedYearsPerTicker[openYearDropdown] || []).includes(y))
            .map(y => (
              <button
                key={y}
                onClick={() => { toggleYear(openYearDropdown, y); setOpenYearDropdown(null); }}
                style={{
                  padding: '6px 14px', borderRadius: '6px', border: 'none',
                  background: 'transparent', color: 'var(--text-primary)',
                  fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
                  textAlign: 'left', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(179,31,126,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                FY{y}
              </button>
            ))}
        </div>,
        document.body
      )}
    </div>
  );
}

