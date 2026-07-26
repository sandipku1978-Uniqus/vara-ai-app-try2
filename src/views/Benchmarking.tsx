'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ArrowRightLeft, Loader2, Sparkles, LayoutGrid, Type, DollarSign, TrendingUp, TrendingDown, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar, Legend } from 'recharts';
import { fetchCompanySubmissions, fetchCompanySubmissionsBatch, fetchCompanyFacts, extractComparableFinancials, getAvailableYears, formatFinancialValue, CIK_MAP, SecSubmission, FinancialMetric, CompanyFacts, lookupCIK, extractCompanyMetadata, loadTickerMap, buildSecProxyUrl, extractDocumentTextFromHtml, fetchAnnualDisclosureText } from '../services/secApi';
import { aiSummarize } from '../services/aiApi';
import { generateMemoDocx, generateMemoPdf } from '../services/docExport';
import { buildCsvRows } from '../utils/csv';
import ResponsibleAIBanner from '../components/ResponsibleAIBanner';
import { renderMarkdown } from '../utils/markdownRenderer';
import { DisclosureMatrix } from '../components/research/DisclosureMatrix';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import SicSearchInput from '../components/filters/SicSearchInput';
import { loadSicDirectoryIndex } from '../services/referenceData';
import SectionMatrix, { type MatrixCell } from '../components/tables/SectionMatrix';
import { useApp } from '../context/AppState';
import TopicPassage from '../components/research/TopicPassage';
import YoYChangeMatrix from '../components/research/YoYChangeMatrix';
import { splitIntoParagraphs } from '../lib/filingText';
import {
  DISCLOSURE_TOPICS,
  distinctiveTerms,
  resolveComparisonTarget,
} from '../services/disclosureTopics';
import {
  filingBlockPath,
  filingSummaryPath,
  locateTopicInBlocks,
  parseFilingSummary,
  stripSgmlEnvelope,
} from '../services/filingStructure';
import {
  locateTopicPassage,
  type TopicPassage as TopicPassageData,
} from '../services/disclosureTopics';
import '../components/research/TopicPassage.css';
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

/** Section used when the comparison target is a topic rather than an Item. */
const DEFAULT_COMPARE_SECTION = 'Item 1A. Risk Factors';

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
      { key: 'TotalDebt', label: 'Total Debt' },
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
      background: 'var(--chart-tooltip-bg)',
      border: '1px solid var(--chart-tooltip-border)',
      borderRadius: '4px',
      color: 'var(--text-primary)',
      boxShadow: isDarkMode ? '0 4px 12px rgba(0, 0, 0, 0.24)' : '0 4px 12px rgba(0, 0, 0, 0.12)',
    }),
    [isDarkMode]
  );
  const axisStyle = useMemo(
    () => ({ fill: 'var(--chart-text)', fontSize: 11 }),
    []
  );
  const axisTickColor = 'var(--chart-text)';
  const axisLineColor = 'var(--chart-axis)';
  const gridStroke = 'var(--chart-grid)';
  const groupedBorderColor = 'var(--border-color)';
  const tableHeaderBackground = 'var(--table-header-bg)';
  const tableHeaderText = 'var(--text-primary)';
  const tableMutedText = 'var(--text-muted)';
  const [selectedTickers, setSelectedTickers] = useState<string[]>(['AAPL', 'MSFT']);
  // Multi-year per ticker: { AAPL: [2024, 2023], MSFT: [2024] }
  const [selectedYearsPerTicker, setSelectedYearsPerTicker] = useState<Record<string, number[]>>({});
  // One control drives both comparison units: "topic:<id>" locates a policy
  // wherever it sits (a note, an Item, anywhere), "section:<label>" keeps the
  // original Item-scoped extraction.
  //
  // This is the SINGLE source of truth. selectedSection below is derived from
  // it, never stored separately: while they were two states the dropdown only
  // wrote comparisonTarget, so choosing "Item 2. Properties" left extraction,
  // the matrix heading and the AI prompt all pinned to the initial Item 1A.
  const [comparisonTarget, setComparisonTarget] = useState('topic:revenue-recognition');
  const {
    topic: activeTopic,
    section: selectedSection,
    label: comparisonLabel,
  } = resolveComparisonTarget(comparisonTarget, DEFAULT_COMPARE_SECTION);

  const [viewMode, setViewMode] = useState<'financials' | 'text-diff' | 'audit-matrix' | 'yoy-changes'>('financials');
  const [commonSize, setCommonSize] = useState(false);
  const [matrixFormType, setMatrixFormType] = useState<string>('10-K');
  const [matrixData, setMatrixData] = useState<Record<string, Record<string, MatrixCell>>>({});
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [peerLoading, setPeerLoading] = useState(false);
  const [peerSicCode, setPeerSicCode] = useState('');
  const [peerDiscoveryMessage, setPeerDiscoveryMessage] = useState('');
  const [cohortReport, setCohortReport] = useState('');
  const [cohortReportLoading, setCohortReportLoading] = useState(false);
  const [cohortReportError, setCohortReportError] = useState('');

  const [companiesData, setCompaniesData] = useState<Record<string, SecSubmission>>({});
  const [companiesRawFacts, setCompaniesRawFacts] = useState<Record<string, CompanyFacts>>({});
  // keyed by "TICKER|YEAR" e.g. "AAPL|2024"
  const [companiesFacts, setCompaniesFacts] = useState<Record<string, Record<string, FinancialMetric>>>({});
  const [availableYears, setAvailableYears] = useState<Record<string, number[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFacts, setLoadingFacts] = useState(false);
  const [companyTexts, setCompanyTexts] = useState<Record<string, string>>({});
  // Topic passages taken straight from the registrant's tagged XBRL blocks.
  const [topicBlockPassages, setTopicBlockPassages] = useState<Record<string, TopicPassageData>>({});

  // Locating a passage is pure text work over already-fetched documents, so it
  // is derived rather than re-fetched when the topic changes.
  const topicPassages = useMemo(() => {
    const result: Record<string, TopicPassageData> = {};
    if (!activeTopic) return result;
    for (const ticker of selectedTickers) {
      // Tagged block first; the prose locator is the fallback for filings
      // that carry no iXBRL structure (pre-2019, some foreign issuers).
      result[ticker] = topicBlockPassages[ticker]
        ?? locateTopicPassage(companyTexts[ticker] || '', activeTopic);
    }
    return result;
  }, [activeTopic, selectedTickers, companyTexts, topicBlockPassages]);

  const topicDistinctive = useMemo(() => distinctiveTerms(topicPassages), [topicPassages]);
  const [loadingTexts, setLoadingTexts] = useState(false);

  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState('');
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

    setSelectedTickers(pendingCompareIntent.tickers.slice(0, 20));
    if (pendingCompareIntent.sicCode) {
      setPeerSicCode(pendingCompareIntent.sicCode);
    }
    if (pendingCompareIntent.viewMode) {
      setViewMode(pendingCompareIntent.viewMode);
    }
    if (pendingCompareIntent.selectedSection) {
      // Route the intent through the same control the dropdown writes to, so a
      // deep link and a manual pick cannot land the view in different states.
      setComparisonTarget(`section:${pendingCompareIntent.selectedSection}`);
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
      // Describe the TARGET SIC, not the seed company — when the user typed a
      // different industry, meta.sicDescription is the seed's industry, not
      // the one they asked for.
      const sicIndex = await loadSicDirectoryIndex();
      const targetSicLabel = sicIndex[targetSic]?.title
        || (targetSic === meta.sic ? meta.sicDescription : '');
      if (peers.length > 0) {
        setSelectedTickers(prev => [...new Set([...prev, ...peers])].slice(0, 20));
        setPeerDiscoveryMessage(`Added ${peers.length} peers for SIC ${targetSic}${targetSicLabel ? ` (${targetSicLabel})` : ''}.`);
      } else {
        setPeerDiscoveryMessage(`No peers found yet for SIC ${targetSic}${targetSicLabel ? ` (${targetSicLabel})` : ''}. Try a broader seed company or add peers manually.`);
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
      const csv = buildCsvRows([headers, ...rows]);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `benchmarking_${selectedTickers.join('_')}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else if (viewMode === 'audit-matrix') {
      const sections = SECTION_LISTS[matrixFormType] || ALL_SECTIONS;
      const headers = ['Section', ...selectedTickers];
      const rows = sections.map(s => [s, ...selectedTickers.map(t => matrixData[s]?.[t]?.present ? 'Yes' : 'No')]);
      const csv = buildCsvRows([headers, ...rows]);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `section_matrix_${matrixFormType}_${selectedTickers.join('_')}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  /**
   * Section-aware extraction: locate the selected Item via TOC anchors or
   * heading scan and read until the next Item heading. The previous
   * approach — indexOf on the whole document + a 20K substring — routinely
   * grabbed a TOC cross-reference or sliced mid-table, so the AI compared
   * artifacts of bad extraction rather than real disclosure differences.
   */
  const extractNamedSectionText = useCallback((html: string, sectionLabel: string): string | null => {
    const itemMatch = sectionLabel.match(/^item\s+(\d+[a-z]?)/i);
    const itemToken = itemMatch ? itemMatch[1].toLowerCase() : null;
    if (!itemToken) return null;
    const sectionRe = new RegExp(`^item\\s*${itemToken}\\b[.:\\s]`, 'i');
    const anyItemRe = /^item\s*\d+[a-z]?\b[.:\s]/i;

    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // Prefer TOC anchor targets — most EDGAR filings link their contents
      let target: Element | null = null;
      for (const link of Array.from(doc.querySelectorAll('a[href^="#"]'))) {
        const text = (link.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 140 || !sectionRe.test(text)) continue;
        const anchor = (link.getAttribute('href') || '').replace(/^#/, '');
        if (!anchor) continue;
        target = doc.querySelector(`a[name="${anchor}"], [id="${anchor}"]`);
        if (target) break;
      }
      // Fallback: heading scan past the TOC region
      if (!target) {
        const candidates = Array.from(doc.querySelectorAll('h1, h2, h3, h4, b, strong, p, div, td'));
        for (const el of candidates) {
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length > 140 || !sectionRe.test(text)) continue;
          // Skip TOC rows: their nearest link ancestor points at an anchor
          if (el.closest('a[href^="#"]')) continue;
          target = el;
          // Prefer the LAST match — the section body follows the final
          // occurrence (earlier ones are TOC/cross-references)
        }
      }
      if (!target) return null;

      const parts: string[] = [];
      let node: Element | null = target;
      let guard = 0;
      while (node && parts.join(' ').length < 60_000 && guard < 4000) {
        guard++;
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const isNextItemHeading =
          parts.length > 0 && text.length > 0 && text.length < 140 &&
          anyItemRe.test(text) && !sectionRe.test(text);
        if (isNextItemHeading) break;
        if (text) parts.push(text);
        if (node.nextElementSibling) {
          node = node.nextElementSibling;
        } else {
          // climb out of wrappers until a sibling exists
          let parent: Element | null = node.parentElement;
          while (parent && !parent.nextElementSibling) parent = parent.parentElement;
          node = parent?.nextElementSibling ?? null;
        }
      }
      const combined = parts.join('\n').trim();
      return combined.length > 400 ? combined.slice(0, 60_000) : null;
    } catch {
      return null;
    }
  }, []);

  // Text diff
  useEffect(() => {
    if (viewMode !== 'text-diff') return;
    async function loadTexts() {
      if (selectedTickers.length === 0) return;
      setLoadingTexts(true);
      const texts: Record<string, string> = {};
      // Passages resolved from the registrant's tagged blocks, keyed by ticker.
      const blocks: Record<string, TopicPassageData> = {};
      for (const ticker of selectedTickers) {
        const data = companiesData[ticker];
        if (!data) continue;
        // Match the filing to the SELECTED fiscal year for this ticker — always
        // taking the newest 10-K silently diffs a different year's text than
        // the financial columns being compared. 10-K/A is accepted so an
        // amendment (the authoritative text) wins when it exists.
        const annualIndices: number[] = [];
        data.filings.recent.form.forEach((f, i) => {
          if (f === '10-K' || f === '10-K/A') annualIndices.push(i);
        });
        if (annualIndices.length === 0) { texts[ticker] = 'No 10-K filing found.'; continue; }
        const tickerYears = selectedYearsPerTicker[ticker] || [];
        const selectedYear = tickerYears.length > 0 ? Math.max(...tickerYears) : null;
        const reportDates = data.filings.recent.reportDate;
        const matchingIdx = selectedYear != null && Array.isArray(reportDates)
          ? annualIndices.find(i => (reportDates[i] || '').startsWith(String(selectedYear)))
          : undefined;
        const recentIdx = matchingIdx ?? annualIndices[0];
        const accession = data.filings.recent.accessionNumber[recentIdx];
        const primaryDoc = data.filings.recent.primaryDocument[recentIdx];
        const cleanAccession = accession.replace(/-/g, '');
        try {
          // Topic mode searches the whole document, because a policy note is
          // not bounded by any Item — and it follows the statements exhibit
          // when the 10-K body incorporates the financials by reference
          // (Progressive files no notes at all in its 10-K). Section mode keeps
          // the original anchor-bounded extraction, since Items only ever live
          // in the 10-K body itself.
          if (activeTopic) {
            // The registrant's own iXBRL note index, when the filing has one.
            // Reading the block they tagged for this topic beats searching the
            // document for it: boundaries are exact and industry drafting
            // conventions stop mattering.
            const block = await locateTopicInBlocks({
              reports: parseFilingSummary(
                await fetch(buildSecProxyUrl(
                  filingSummaryPath(String(data.cik), cleanAccession)
                )).then(r => (r.ok ? r.text() : '')).catch(() => '')
              ),
              topic: activeTopic,
              loadBlock: async file => {
                const resp = await fetch(buildSecProxyUrl(
                  filingBlockPath(String(data.cik), cleanAccession, file)
                ));
                if (!resp.ok) return '';
                return extractDocumentTextFromHtml(stripSgmlEnvelope(await resp.text()));
              },
              locate: locateTopicPassage,
            }).catch(() => null);

            if (block) blocks[ticker] = block.passage;
            // Full text is still fetched: it backs the untagged fallback and
            // the distinctive-vocabulary comparison across peers.
            texts[ticker] = await fetchAnnualDisclosureText(String(data.cik), cleanAccession, primaryDoc);
            continue;
          }

          const resp = await fetch(buildSecProxyUrl(`Archives/edgar/data/${data.cik}/${cleanAccession}/${primaryDoc}`));
          const html = await resp.text();

          // Structured extraction first: anchors/headings bound the section
          // precisely. Fall back to positional search only when the document
          // has no parseable structure.
          const structured = extractNamedSectionText(html, selectedSection);
          if (structured) {
            texts[ticker] = structured;
          } else {
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
              // TOC hits cluster near the start; the real section is later
              const validIndices = indices.filter(i => i > 8000);
              const sectionIdx = validIndices.length > 0 ? validIndices[0] : indices[indices.length - 1];
              texts[ticker] = bodyText.substring(sectionIdx, sectionIdx + 20000).trim();
            } else {
              texts[ticker] = `Section "${selectedSection}" not found in extracted text.`;
            }
          }
        } catch {
          texts[ticker] = 'Failed to fetch filing content.';
        }
      }
      setCompanyTexts(texts);
      setTopicBlockPassages(blocks);
      setLoadingTexts(false);
    }
    if (Object.keys(companiesData).length > 0) loadTexts();
  }, [selectedSection, activeTopic, selectedTickers, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeTicker = (ticker: string) => {
    setSelectedTickers(prev => prev.filter(t => t !== ticker));
    setSelectedYearsPerTicker(prev => { const n = { ...prev }; delete n[ticker]; return n; });
  };

  const handleAiCompare = async () => {
    if (columns.length < 2) return;
    setAiAnalyzing(true);
    setAiAnalysis('');
    setAiAnalysisError('');
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
        prompt = `Act as an SEC compliance expert. Compare the following "${comparisonLabel}" disclosure excerpts:\n\n${columns.map(col => `${colTicker(col)}: (text here)`).join('\n\n')}\n\nProvide 3 concise paragraphs.`;
      }
      const response = await aiSummarize(prompt, { throwOnError: true });
      if (!response.trim()) throw new Error('The AI service returned an empty comparison.');
      setAiAnalysis(response);
    } catch (error) {
      console.error('Financial comparison error:', error);
      setAiAnalysisError('The financial comparison could not be generated. The underlying SEC metrics remain available below.');
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
    const ocfMetric = companiesFacts[col]?.OperatingCashFlow;
    const ocf = ocfMetric?.value;
    const capex = companiesFacts[col]?.CapitalExpenditures?.value;
    if (ocf != null && capex != null) {
      const val = ocf - capex;
      // Use the filer's actual reporting currency, not a hardcoded '$'
      return { display: formatFinancialValue(val, ocfMetric?.currency || 'USD'), value: val };
    }
    return { display: '—', value: null };
  };

  const getCashFlowQuality = (col: string) => getRatio(col, 'OperatingCashFlow', 'NetIncome', 1, 'x', 2);
  const getSBCPct = (col: string) => getRatio(col, 'StockCompensation', 'Revenues');
  const getCapExPct = (col: string) => getRatio(col, 'CapitalExpenditures', 'Revenues');

  const getColPeriodEnd = (col: string): string | null => {
    const facts = companiesFacts[col];
    if (!facts) return null;
    return facts.Revenues?.periodEnd || facts.TotalAssets?.periodEnd || facts.NetIncome?.periodEnd || null;
  };

  // Common-size: income-statement & cash-flow lines as % of revenue,
  // balance-sheet lines as % of total assets — the normalization accountants
  // apply instinctively when peers differ in scale.
  const formatCommonSize = (
    col: string,
    sectionTitle: string,
    metricKey: string,
    metric: FinancialMetric | undefined
  ): string => {
    if (!metric || metric.value == null) return '—';
    if (metric.unit.includes('/shares')) return formatFinancialValue(metric.value, metric.unit, metric.currency);
    const baseMetric = sectionTitle === 'Balance Sheet'
      ? companiesFacts[col]?.TotalAssets
      : companiesFacts[col]?.Revenues;
    if (metricKey === 'Revenues' || metricKey === 'TotalAssets') {
      return '100.0%';
    }
    if (baseMetric?.value == null || baseMetric.value === 0) return '—';
    return `${((metric.value / baseMetric.value) * 100).toFixed(1)}%`;
  };

  const exportMatrixToXlsx = async () => {
    const XLSX = await import('xlsx');
    const header = ['Metric', ...columns.map(col => {
      const end = getColPeriodEnd(col);
      return `${colTicker(col)} FY${colYear(col)}${end ? ` (ended ${end})` : ''}`;
    })];
    const rows: (string | number | null)[][] = [header];
    for (const section of FINANCIAL_SECTIONS) {
      rows.push([section.title, ...columns.map(() => '')]);
      for (const metric of section.metrics) {
        rows.push([
          metric.label,
          ...columns.map(col => companiesFacts[col]?.[metric.key]?.value ?? null),
        ]);
      }
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 28 }, ...columns.map(() => ({ wch: 18 }))];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Benchmarking');
    XLSX.writeFile(workbook, `URC_benchmarking_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const getEffectiveTaxRate = (col: string): RatioResult => {
    const tax = companiesFacts[col]?.IncomeTaxExpense?.value;
    const ni = companiesFacts[col]?.NetIncome?.value;
    // Pretax proxy (NI + tax) is only meaningful when positive — for a pretax
    // loss with a tax benefit the ratio produces nonsense percentages.
    if (tax != null && ni != null && (ni + tax) > 0) {
      const val = (tax / (ni + tax)) * 100;
      return { display: `${val.toFixed(1)}%`, value: val };
    }
    return { display: '—', value: null };
  };

  const getRatioColor = (value: number | null, thresholds: { green: number; amber: number }, higherIsBetter = true): string => {
    if (value == null) return 'var(--text-muted)';
    if (higherIsBetter) {
      if (value >= thresholds.green) return 'var(--status-success)';
      if (value >= thresholds.amber) return 'var(--status-warning)';
      return 'var(--status-error)';
    } else {
      if (value <= thresholds.green) return 'var(--status-success)';
      if (value <= thresholds.amber) return 'var(--status-warning)';
      return 'var(--status-error)';
    }
  };

  const getRatioBg = (value: number | null, thresholds: { green: number; amber: number }, higherIsBetter = true): string => {
    if (value == null) return 'transparent';
    if (higherIsBetter) {
      if (value >= thresholds.green) return 'color-mix(in srgb, var(--status-success) 9%, transparent)';
      if (value >= thresholds.amber) return 'color-mix(in srgb, var(--status-warning) 8%, transparent)';
      return 'color-mix(in srgb, var(--status-error) 9%, transparent)';
    } else {
      if (value <= thresholds.green) return 'color-mix(in srgb, var(--status-success) 9%, transparent)';
      if (value <= thresholds.amber) return 'color-mix(in srgb, var(--status-warning) 8%, transparent)';
      return 'color-mix(in srgb, var(--status-error) 9%, transparent)';
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
    setCohortReport('');
    setCohortReportError('');
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

      const aiResponse = await aiSummarize(prompt, { throwOnError: true });
      if (!aiResponse.trim()) throw new Error('The AI service returned an empty cohort memo.');
      setCohortReport(aiResponse);
    } catch (error) {
      console.error('Cohort memo error:', error);
      setCohortReportError('The cohort memo could not be generated. The selected peers and underlying SEC metrics remain available.');
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
          <div className="view-toggles glass-card" style={{ padding: '4px', display: 'flex', gap: '4px', marginRight: '16px', borderRadius: '4px' }}>
            <button className={`toggle-view-btn ${viewMode === 'financials' ? 'active' : ''}`} onClick={() => setViewMode('financials')}>
              <DollarSign size={16} /> Financials
            </button>
            <button className={`toggle-view-btn ${viewMode === 'text-diff' ? 'active' : ''}`} onClick={() => setViewMode('text-diff')}>
              <Type size={16} /> Text Redline
            </button>
            <button className={`toggle-view-btn ${viewMode === 'audit-matrix' ? 'active' : ''}`} onClick={() => setViewMode('audit-matrix')}>
              <LayoutGrid size={16} /> Audit Matrix
            </button>
            <button className={`toggle-view-btn ${viewMode === 'yoy-changes' ? 'active' : ''}`} onClick={() => setViewMode('yoy-changes')}>
              <Type size={16} /> YoY Changes
            </button>
          </div>
          {/* Export produces a CSV only for the two data views; Text Redline
              exports through the disclosure-matrix's own DOCX/PDF actions, so
              the CSV button would be a silent no-op there. */}
          {viewMode !== 'text-diff' && viewMode !== 'yoy-changes' && (
            <button className="icon-btn" title="Export as CSV" onClick={handleCsvExport}><Download size={18} /> Export</button>
          )}
        </div>
      </div>

      <div className="glass-card" style={{ padding: '18px 20px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1rem' }}>Peer Cohort Builder</h3>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.84rem', maxWidth: '760px' }}>
              {/* The second half explained the feature's rationale to ourselves,
                  not the task to the reader. */}
              Build a peer set by SIC code, then generate a short memo on how the cohort stacks up.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <SicSearchInput
              value={peerSicCode}
              onChange={setPeerSicCode}
              ariaLabel="Peer group industry (SIC code or name)"
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
          <div style={{ color: 'var(--text-primary)', fontSize: '0.82rem', background: 'var(--surface-accent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 22%, var(--border-color))', borderRadius: '4px', padding: '10px 12px' }}>
            {peerDiscoveryMessage}
          </div>
        )}

        {cohortReportError && (
          <div role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', color: 'var(--status-error)', background: 'var(--status-error-bg)', border: '1px solid color-mix(in srgb, var(--status-error) 30%, transparent)', borderRadius: '4px', padding: '10px 12px' }}>
            <span>{cohortReportError}</span>
            <button type="button" className="secondary-btn" onClick={() => void handleGenerateCohortReport()}>Retry memo</button>
          </div>
        )}

        {cohortReport && (
          <div style={{ borderLeft: '4px solid var(--accent-primary)', background: 'var(--surface-panel)', borderRadius: '4px', padding: '16px 18px' }}>
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
          <div className="control-group compare-target">
            <label>Compare:</label>
            <select
              value={comparisonTarget}
              onChange={e => setComparisonTarget(e.target.value)}
              className="select-input"
              aria-label="Disclosure topic or filing section to compare"
            >
              {/* Topics first: an accountant asks "how do peers treat revenue
                  recognition?" far more often than "show me all of Item 1A" —
                  and a policy note has no Item of its own to select. */}
              <optgroup label="Accounting policy & topic">
                {DISCLOSURE_TOPICS.map(topic => (
                  <option key={topic.id} value={`topic:${topic.id}`}>
                    {topic.label}{topic.asc ? ` (${topic.asc})` : ''}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Filing section">
                {ALL_SECTIONS.map(s => <option key={s} value={`section:${s}`}>{s}</option>)}
              </optgroup>
            </select>
          </div>
        )}

        {/* Sizing lives in the stylesheet — an inline flex here outranked it and
            kept the cohort builder squeezed onto the Compare row. */}
        <div className="control-group comparison-selector">
          {/* Was a full sentence set in uppercase with letter-spacing, which
              wrapped to two lines and read as a banner rather than a label. */}
          <label>Companies &amp; fiscal years</label>
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
                        color: 'var(--accent-primary)',
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
                  title="Add companies sharing the first company's SIC industry"
                  style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {peerLoading ? <Loader2 size={14} className="spinner" /> : <Users size={14} />}
                  Add industry peers
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
          // Reflect whatever is actually being compared — showing the stale
          // Item label while a policy topic is selected misstates the analysis.
          section={comparisonLabel}
          filingContexts={selectedTickers.map(t => ({
             ticker: t,
             companyName: companiesData[t]?.name || t,
             text: companyTexts[t] ? companyTexts[t].substring(0, 20000) : ''
          })).filter(f => f.text.length > 0)}
          onExportDocx={generateMemoDocx}
          onExportPdf={generateMemoPdf}
        />
      ) : aiAnalysis || aiAnalyzing || aiAnalysisError ? (
        <div className="ai-comparison-panel glass-card" style={{ padding: '24px', marginBottom: '8px', borderLeft: '4px solid var(--accent-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Sparkles className="text-blue-400" size={20} />
            <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>URC Financial Compare</h3>
          </div>
          {aiAnalyzing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)' }}>
              <Loader2 className="spinner" size={18} /> Generating comparative analysis...
            </div>
          ) : aiAnalysisError ? (
            <div role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', color: 'var(--status-error)' }}>
              <span>{aiAnalysisError}</span>
              <button type="button" className="secondary-btn" onClick={() => void handleAiCompare()}>Retry summary</button>
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
                          <span className="kpi-card-value" style={{ color: fcf.value != null && fcf.value > 0 ? 'var(--status-success)' : 'var(--status-error)' }}>{fcf.display}</span>
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
                    .map(col => {
                      const currency = companiesFacts[col]?.[chart.key]?.currency || 'USD';
                      return {
                        // Non-USD filers are labeled with their reporting currency —
                        // these bars share an axis without FX conversion, and an
                        // unlabeled DKK bar next to USD peers reads as dollars.
                        name: currency !== 'USD' ? `${colLabel(col)} (${currency})` : colLabel(col),
                        value: (companiesFacts[col]?.[chart.key]?.value || 0) / 1e9,
                        fill: getColColor(col),
                        currency,
                      };
                    });
                  if (chartData.length === 0) return null;
                  const mixedCurrency = chartData.some(entry => entry.currency !== 'USD');
                  const axisPrefix = mixedCurrency ? '' : '$';
                  return (
                    <div key={chart.key} className="glass-card" style={{ padding: '20px' }}>
                      <h4 className="chart-title">{chart.title} <span className="chart-subtitle">{mixedCurrency ? '(Billions, reporting currency — no FX conversion)' : '($ Billions)'}</span></h4>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={chartData} barSize={Math.max(16, Math.min(36, 200 / chartData.length))}>
                          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                          <XAxis dataKey="name" tick={{ fill: axisTickColor, fontSize: 10 }} axisLine={{ stroke: axisLineColor }} />
                          <YAxis tick={axisStyle} axisLine={{ stroke: axisLineColor }} tickFormatter={(v: number) => `${axisPrefix}${v.toFixed(0)}B`} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: unknown) => [`${axisPrefix}${Number(value ?? 0).toFixed(1)}B`, chart.title]} />
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
                    // null (not 0) for untagged metrics — Recharts skips null
                    // bars; a fake 0% margin is indistinguishable from a real one
                    return {
                      name: colLabel(col),
                      'Gross Margin': gp != null ? +((gp / rev) * 100).toFixed(1) : null,
                      'Operating Margin': oi != null ? +((oi / rev) * 100).toFixed(1) : null,
                      'Net Margin': ni != null ? +((ni / rev) * 100).toFixed(1) : null,
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
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: unknown) => [`${Number(value ?? 0).toFixed(1)}%`]} />
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
                      const cashVal = companiesFacts[col]?.CashAndEquivalents?.value;
                      const gwVal = companiesFacts[col]?.Goodwill?.value;
                      const intVal = companiesFacts[col]?.IntangibleAssets?.value;
                      const arVal = companiesFacts[col]?.AccountsReceivable?.value;
                      const invVal = companiesFacts[col]?.Inventory?.value;
                      const cash = cashVal ?? 0;
                      const gw = (gwVal ?? 0) + (intVal ?? 0);
                      const arInv = (arVal ?? 0) + (invVal ?? 0);
                      const remainder = Math.max(0, ta - cash - gw - arInv);
                      // Missing components render as gaps (null), not fake zeros —
                      // a company that didn't tag cash must not show "zero cash".
                      // The remainder absorbs untagged lines, hence "incl. untagged".
                      return {
                        name: colLabel(col),
                        Cash: cashVal != null ? +(cash / 1e9).toFixed(1) : null,
                        'Goodwill & Intangibles': gwVal != null || intVal != null ? +(gw / 1e9).toFixed(1) : null,
                        'AR + Inventory': arVal != null || invVal != null ? +(arInv / 1e9).toFixed(1) : null,
                        'Other Assets': +(remainder / 1e9).toFixed(1),
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
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: unknown) => [`$${Number(value ?? 0).toFixed(1)}B`]} />
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
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: unknown) => [`$${Number(value ?? 0).toFixed(1)}B`]} />
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

                // Missing dims stay null: coercing to 0 pinned the company to
                // the axis minimum AND squashed the normalized scale for peers.
                const rawValues: Record<string, Record<string, number | null>> = {};
                for (const col of columns) {
                  rawValues[col] = {};
                  for (const dim of dimensions) rawValues[col][dim.key] = dim.fn(col).value;
                }

                const radarData = dimensions.map(dim => {
                  const vals = columns
                    .map(col => rawValues[col][dim.key])
                    .filter((v): v is number => v != null);
                  const min = vals.length > 0 ? Math.min(...vals) : 0;
                  const max = vals.length > 0 ? Math.max(...vals) : 0;
                  const range = max - min || 1;
                  const entry: Record<string, string | number | null> = { dimension: dim.key };
                  for (const col of columns) {
                    const raw = rawValues[col][dim.key];
                    entry[col] = raw != null ? +((((raw - min) / range) * 80 + 10)).toFixed(0) : null;
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '8px' }}>
                <button type="button" onClick={() => setCommonSize(prev => !prev)}
                  style={{
                    padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer',
                    border: '1px solid ' + (commonSize ? 'color-mix(in srgb, var(--accent-primary) 45%, var(--input-border))' : 'var(--input-border)'),
                    background: commonSize ? 'var(--surface-accent)' : 'var(--input-bg)',
                    color: commonSize ? 'var(--accent-primary)' : 'var(--text-muted)',
                  }}>
                  % Common-size
                </button>
                <button type="button" onClick={exportMatrixToXlsx}
                  style={{
                    padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer',
                    border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-secondary)',
                  }}>
                  Export XLSX
                </button>
              </div>
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
                            {/* Actual period end — 'FY2024' can hide ~11 months of
                                economic offset between Jan-FYE and Dec-FYE filers */}
                            {getColPeriodEnd(col) && (
                              <div style={{ fontSize: '0.65rem', fontWeight: 400, color: tableMutedText }}>
                                ended {getColPeriodEnd(col)}
                              </div>
                            )}
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
                            padding: '12px 20px', background: 'var(--surface-accent)',
                            fontWeight: 700, fontSize: '0.8rem', color: 'var(--accent-primary)',
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                            borderTop: '1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-color))', borderBottom: '1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-color))'
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
                                  color: m?.value != null ? (m.value < 0 ? 'var(--status-error)' : 'var(--text-primary)') : 'var(--text-muted)',
                                  ...colBorderStyle(col, idx),
                                }}>
                                  {commonSize
                                    ? formatCommonSize(col, section.title, metric.key, m)
                                    : m ? formatFinancialValue(m.value, m.unit, m.currency) : '—'}
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
                        padding: '12px 20px', background: 'color-mix(in srgb, var(--status-success) 8%, transparent)',
                        fontWeight: 700, fontSize: '0.8rem', color: 'var(--status-success)',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                        borderTop: '1px solid color-mix(in srgb, var(--status-success) 20%, var(--border-color))', borderBottom: '1px solid color-mix(in srgb, var(--status-success) 20%, var(--border-color))'
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
                                  ? '3px solid var(--status-success)'
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
                  ) : activeTopic && text ? (
                    <TopicPassage
                      passage={topicPassages[ticker]}
                      distinctive={topicDistinctive[ticker]}
                    />
                  ) : text ? (
                    // Section text is a source document too: same reading voice
                    // and paragraph structure as topic passages. Rendering it as
                    // one <p> produced an unbroken wall nothing could be read out of.
                    <div className="section-prose">
                      {splitIntoParagraphs(text).map((para, i) => <p key={i}>{para}</p>)}
                    </div>
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
      {viewMode === 'yoy-changes' && (
        <YoYChangeMatrix tickers={selectedTickers} companiesData={companiesData} />
      )}

      {viewMode === 'audit-matrix' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="glass-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>Form Type:</span>
            {Object.keys(SECTION_LISTS).map(ft => (
              <button key={ft} onClick={() => setMatrixFormType(ft)} style={{
                padding: '6px 16px', borderRadius: '4px', border: '1px solid ' + (matrixFormType === ft ? 'var(--accent-primary)' : 'var(--border-color)'), cursor: 'pointer', fontSize: '0.8rem',
                background: matrixFormType === ft ? 'var(--accent-primary)' : 'var(--surface-subtle)',
                color: matrixFormType === ft ? 'var(--surface-panel)' : 'var(--text-secondary)', transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
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
            borderRadius: '4px',
            padding: '4px',
            minWidth: '96px',
            boxShadow: isDarkMode ? '0 4px 12px rgba(0,0,0,0.24)' : '0 4px 12px rgba(0,0,0,0.12)',
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
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--interactive-hover)')}
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
