'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, BarChart3, BellRing, BookOpen, Briefcase, Building2,
  ClipboardList, Download, ExternalLink, FileSearch, FileText, Filter,
  Gavel, Globe, HelpCircle, LayoutDashboard, LineChart, Mail,
  Mic, Scale, Search, Shield, TrendingUp, UserCheck, Users
} from 'lucide-react';
import { BRAND } from '../config/brand';
import './SupportCenter.css';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface GuideSection {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  notes: string[];
  /** Routes users can navigate to from this section */
  links?: { label: string; href: string }[];
}

interface FaqItem {
  question: string;
  answer: string;
}

/* ------------------------------------------------------------------ */
/*  Platform quick-links shown in the sidebar                          */
/* ------------------------------------------------------------------ */
const PLATFORM_LINKS = [
  { group: 'Reporting & Benchmarking', items: [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Research Workbench', href: '/search', icon: Search },
    { label: 'Disclosure Benchmarking', href: '/compare', icon: BarChart3 },
    { label: 'ESG Research', href: '/esg', icon: Globe },
    { label: 'Board Profiles', href: '/boards', icon: Users },
    { label: 'Insider Trading', href: '/insiders', icon: UserCheck },
  ]},
  { group: 'Business Intelligence', items: [
    { label: 'Accounting Standards', href: '/accounting', icon: BookOpen },
    { label: 'Accounting Analytics', href: '/accounting-analytics', icon: LineChart },
    { label: '8-K Event Filings', href: '/earnings', icon: Mic },
  ]},
  { group: 'Regulation & Compliance', items: [
    { label: 'Securities Regulation', href: '/regulation', icon: Scale },
    { label: 'Comment Letters', href: '/comment-letters', icon: Mail },
    { label: 'No-Action Letters', href: '/no-action-letters', icon: FileText },
    { label: 'SEC Enforcement', href: '/enforcement', icon: Gavel },
  ]},
  { group: 'Transactions', items: [
    { label: 'IPO Center', href: '/ipo', icon: TrendingUp },
    { label: 'M&A Research', href: '/mna', icon: Briefcase },
    { label: 'Exhibits & Agreements', href: '/exhibits', icon: ClipboardList },
    { label: 'Exempt Offerings', href: '/exempt-offerings', icon: Shield },
    { label: 'ADV Registrations', href: '/adv-registrations', icon: Building2 },
  ]},
];

/* ------------------------------------------------------------------ */
/*  Guide content                                                      */
/* ------------------------------------------------------------------ */
const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'start-here',
    title: 'Start Here',
    summary: 'The Research Workbench is the central hub for SEC disclosure research. Start here when you have a topic, entity, or filing type in mind and want to explore what issuers are disclosing.',
    steps: [
      'Open the Research Workbench from the sidebar or press the search bar on the Dashboard.',
      'Enter a keyword, company name, or disclosure topic in the main search field. Natural-language queries like "Apple revenue recognition" are interpreted automatically.',
      'Use the 17 advanced filters (form type, date range, SIC code, auditor, exchange, filer status, section keywords, and more) to narrow results before searching.',
      'Toggle between Semantic mode (broad idea discovery) and Boolean mode (AND, OR, NOT, "phrase", w/5 proximity) depending on your precision needs.',
      'Click any result row to open the filing in the Filing Detail viewer.',
    ],
    notes: [
      'Filters are enforced before results are shown, so they act as real gates rather than loose search hints.',
      'If a search returns too many results, add form type and date range filters before further narrowing.',
      'Natural language search automatically detects form types, date windows, auditor names, and entity references from your query.',
    ],
    links: [
      { label: 'Open Research Workbench', href: '/search' },
      { label: 'Go to Dashboard', href: '/dashboard' },
    ],
  },
  {
    id: 'research-workbench',
    title: 'Research Workbench Deep Dive',
    summary: 'Master the full workflow: semantic vs. Boolean search, research sessions with tabs, trend reports, and saved alerts.',
    steps: [
      'Use Semantic mode for broad idea discovery — it interprets intent behind your query and finds conceptually related filings.',
      'Switch to Boolean mode when you need exact-match results. Use AND, OR, NOT, "quoted phrases", and proximity operators like w/5 or near/10.',
      'Each search opens in a new tab within your research session, so you can compare multiple queries side by side.',
      'Generate a trend report after a search to get an AI-powered summary of what the result set shows.',
      'Save an alert if you plan to rerun the same search regularly — it will appear on your Dashboard for quick re-execution.',
    ],
    notes: [
      'Saved alerts and annotations are browser-local. They help with repeat research but are not shared across devices.',
      'If a Boolean search returns nothing, check for typos in quoted phrases and try widening the date window first.',
      'Research sessions persist during your browser session. Closing the browser clears them.',
    ],
    links: [
      { label: 'Open Research Workbench', href: '/search' },
    ],
  },
  {
    id: 'filing-tools',
    title: 'Filing Detail Tools',
    summary: 'When you open a filing, the detail viewer gives you section navigation, annotations, year-over-year redline comparison, table extraction, and export capabilities.',
    steps: [
      'Use the Table of Contents (TOC) sidebar to jump to major sections detected from the filing HTML.',
      'Turn on YoY Redline to compare the filing against the closest prior comparable filing and review added/removed disclosure blocks.',
      'Enable Annotate mode, select text in the filing, and save notes in the Tools tab.',
      'Use Extract Tables to download structured HTML tables as CSV for use in spreadsheets.',
      'Use Print / Save PDF to open a print-friendly view, then save as PDF from your browser print dialog.',
    ],
    notes: [
      'Annotations are stored locally in the current browser.',
      'Some XML-based SEC documents do not preview inline and must be opened on SEC.gov.',
      'Redline compares disclosure blocks (not character-by-character) against the closest prior filing of the same form type.',
      'PDF export uses the browser print dialog — this is the most reliable client-side approach.',
    ],
    links: [
      { label: 'Search for filings', href: '/search' },
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    summary: 'The Dashboard provides a quick-glance view of your research activity: recent filings, watchlist companies, saved alerts, and summary charts.',
    steps: [
      'Review recent filing activity and trending topics in the overview cards.',
      'Use the watchlist to track specific companies and see their latest filings at a glance.',
      'Access saved search alerts to re-execute frequent queries with one click.',
      'Click any filing or company card to jump directly to the detailed view.',
    ],
    notes: [
      'Dashboard data refreshes when you navigate to the page. Watchlist items and alerts are browser-local.',
      'The quick-search bar on the Dashboard takes you directly to the Research Workbench with your query pre-filled.',
    ],
    links: [
      { label: 'Open Dashboard', href: '/dashboard' },
    ],
  },
  {
    id: 'benchmarking',
    title: 'Disclosure Benchmarking Matrix',
    summary: 'Compare XBRL financial data across a peer cohort, build side-by-side disclosure comparisons, and generate redline diffs between companies.',
    steps: [
      'Add tickers to build a manual peer set, or use SIC code discovery to pull a focused industry cohort automatically.',
      'View live XBRL financial data (revenue, assets, net income, etc.) side by side for all companies in your set.',
      'Use the redline comparison feature to highlight differences in disclosure language between peers.',
      'Export the benchmarking matrix data for use in reports and workpapers.',
    ],
    notes: [
      'XBRL data comes directly from the SEC XBRL API — it reflects the most recent filings available.',
      'Peer discovery via SIC codes is useful, but always review the final company list before treating it as a definitive comp set.',
    ],
    links: [
      { label: 'Open Benchmarking', href: '/compare' },
    ],
  },
  {
    id: 'board-profiles',
    title: 'Board Profiles & Executive Compensation',
    summary: 'Research board composition, director backgrounds, committee memberships, and executive compensation across companies using AI-powered extraction from DEF 14A proxy statements.',
    steps: [
      'Search for a company by ticker or name to load its board and compensation data.',
      'Add multiple companies (e.g., AAPL and GOOGL) to compare board structures side by side.',
      'Switch between the Directors tab (board members, committees, tenure) and Compensation tab (executive pay, equity awards).',
      'Use the governance metrics sidebar to see board independence, diversity, and meeting attendance scores.',
    ],
    notes: [
      'Board data is AI-extracted from DEF 14A filings using Claude. Extraction requires a valid Anthropic API key.',
      'Comparison works best with 2-4 companies. Larger sets may require scrolling.',
    ],
    links: [
      { label: 'Open Board Profiles', href: '/boards' },
      { label: 'Track Insider Trading', href: '/insiders' },
    ],
  },
  {
    id: 'accounting-research',
    title: 'Accounting Standards & Analytics',
    summary: 'The Accounting Research Hub lets you search for adoption topics, policy language, and peer treatment across filings. Accounting Analytics provides quantitative analysis of accounting trends.',
    steps: [
      'In the Accounting Research Hub, search for specific accounting standards (e.g., ASC 606, ASC 842) to find how companies describe their adoption.',
      'Filter by industry or SIC code to see how peers in your sector handle the same topic.',
      'Use Accounting Analytics for quantitative trend analysis across filing populations.',
      'Open individual filings from results to review the actual disclosure language in context.',
    ],
    notes: [
      'Results are pulled from SEC EDGAR full-text search, so they reflect actual filing content rather than third-party summaries.',
      'Generated memos summarize the current result set — use them as a starting point, not the final workpaper.',
    ],
    links: [
      { label: 'Open Accounting Hub', href: '/accounting' },
      { label: 'Open Accounting Analytics', href: '/accounting-analytics' },
    ],
  },
  {
    id: 'regulation-compliance',
    title: 'Regulation, Comment Letters & Enforcement',
    summary: 'Research SEC securities regulation, track comment letter correspondence between the SEC and registrants, review no-action letters, and monitor enforcement actions.',
    steps: [
      'Use Securities Regulation to browse and search current SEC rules and regulations.',
      'Search Comment Letters to see what the SEC staff has asked specific companies or industries about.',
      'Browse No-Action Letters for SEC staff guidance on specific regulatory questions.',
      'Monitor SEC Enforcement actions to track settled cases, penalties, and compliance trends.',
    ],
    notes: [
      'Comment letter searches work best with company name or specific disclosure topic keywords.',
      'Enforcement data includes administrative proceedings, civil actions, and trading suspensions.',
    ],
    links: [
      { label: 'Securities Regulation', href: '/regulation' },
      { label: 'Comment Letters', href: '/comment-letters' },
      { label: 'No-Action Letters', href: '/no-action-letters' },
      { label: 'SEC Enforcement', href: '/enforcement' },
    ],
  },
  {
    id: 'esg-research',
    title: 'ESG Research Center',
    summary: 'Research environmental, social, and governance disclosures across SEC filings. Track ESG reporting trends, compare disclosure practices, and identify material ESG topics by industry.',
    steps: [
      'Search for ESG-related keywords like "climate risk", "DEI", or "sustainability" to find relevant disclosures.',
      'Filter by industry (SIC code) to see how peers in your sector approach ESG reporting.',
      'Compare ESG disclosure depth across companies in your peer set.',
      'Open filings to review the actual ESG language in its full context.',
    ],
    notes: [
      'ESG disclosure is evolving rapidly — date filters are especially useful for tracking how language has changed over time.',
    ],
    links: [
      { label: 'Open ESG Research', href: '/esg' },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions: IPO, M&A, Exhibits & More',
    summary: 'Research IPO readiness filings, M&A transaction documents, material agreements, exempt offerings (Reg D/S/A/CF), and investment adviser registrations.',
    steps: [
      'Use the IPO Center to research S-1/F-1 registration statements, SPAC filings, and direct listing disclosures.',
      'Open M&A Research to search for merger proxies, tender offers, and transaction-related 8-K filings.',
      'Browse Exhibits & Agreements to find specific exhibit types — material contracts (EX-10.x), merger agreements (EX-2.1), subsidiary lists (EX-21), and more.',
      'Search Exempt Offerings for Reg D, Reg S, Reg A, and Regulation Crowdfunding filings.',
      'Use ADV Registrations to research investment adviser registrations and amendments.',
    ],
    notes: [
      'Exhibit search supports specific exhibit type codes for precision (e.g., EX-10.1, EX-2.1, EX-21).',
      'M&A searches pair well with the 8-K Event Filings page for tracking material event disclosures.',
    ],
    links: [
      { label: 'IPO Center', href: '/ipo' },
      { label: 'M&A Research', href: '/mna' },
      { label: 'Exhibits & Agreements', href: '/exhibits' },
      { label: 'Exempt Offerings', href: '/exempt-offerings' },
      { label: 'ADV Registrations', href: '/adv-registrations' },
    ],
  },
  {
    id: 'events-insiders',
    title: '8-K Events & Insider Trading',
    summary: 'Track material corporate events through 8-K filings and monitor insider transactions (Forms 3, 4, 5) for officers, directors, and 10%+ beneficial owners.',
    steps: [
      'Use 8-K Event Filings to search for specific event types like earnings releases, executive changes, or material agreements.',
      'Filter by company or date range to track event sequences for a specific issuer.',
      'Open Insider Trading to search Forms 3, 4, and 5 for officer and director transactions.',
      'Review transaction patterns: purchases vs. sales, option exercises, and ownership changes over time.',
    ],
    notes: [
      'Insider transaction data is sourced from SEC EDGAR. Large batches of Form 4 filings around earnings dates are common.',
    ],
    links: [
      { label: '8-K Event Filings', href: '/earnings' },
      { label: 'Insider Trading', href: '/insiders' },
    ],
  },
  {
    id: 'company-detail',
    title: 'Company Detail Pages',
    summary: 'Every company has a dedicated detail page showing CIK, SIC code, recent filings, and quick links to all company-specific research tools.',
    steps: [
      'Navigate to any company page by searching for a ticker (e.g., /company/AAPL) or clicking a company name in search results.',
      'Review the company header: CIK number, SIC code, state of incorporation, and filer status.',
      'Browse the complete filings table with form type, date, and description.',
      'Click any filing to open it in the Filing Detail viewer.',
    ],
    notes: [
      'Company data comes from the SEC EDGAR company submissions API.',
      'The filings table shows all form types. Use the form type column to filter to what you need.',
    ],
    links: [
      { label: 'Try: Apple (AAPL)', href: '/company/AAPL' },
      { label: 'Try: Microsoft (MSFT)', href: '/company/MSFT' },
    ],
  },
  {
    id: 'api-portal',
    title: 'API Data Integration Portal',
    summary: 'The API Portal provides documentation and tools for integrating SEC data into your own workflows and systems.',
    steps: [
      'Browse available API endpoints for SEC EDGAR data access.',
      'Review request/response examples for each endpoint.',
      'Use the portal to understand rate limits and data freshness.',
    ],
    notes: [
      'The API Portal is a reference tool — actual API access depends on your deployment configuration.',
    ],
    links: [
      { label: 'Open API Portal', href: '/api-portal' },
    ],
  },
];

const FAQS: FaqItem[] = [
  {
    question: 'How do I search for a specific company\'s filings?',
    answer: 'Use the Research Workbench (/search) and enter the company name or ticker in the entity/company field. You can also navigate directly to /company/TICKER (e.g., /company/AAPL) for a dedicated company page with all filings.',
  },
  {
    question: 'What is the difference between Semantic and Boolean search?',
    answer: 'Semantic mode interprets the intent behind your query and finds conceptually related filings — best for broad research. Boolean mode supports exact-match operators: AND, OR, NOT, "quoted phrases", and proximity operators like w/5 or near/10 — best for targeted, precise queries.',
  },
  {
    question: 'How do the 17 search filters work?',
    answer: 'Filters include keyword, date range (from/to), entity name, form types, section keywords, SIC code, state of incorporation, headquarters, exchange, accelerated filer status, accountant/auditor, accession number, file number, fiscal year end, and accounting framework. All filters are enforced before results are returned.',
  },
  {
    question: 'Why does Print / Save PDF open a print view instead of downloading a PDF directly?',
    answer: 'The filing detail page opens a clean print-friendly version of the filing and uses the browser print workflow. This is the most reliable client-side path without a dedicated server-side PDF renderer.',
  },
  {
    question: 'Why are some filings not visible in the embedded viewer?',
    answer: 'Some SEC documents, especially XML-based filings, depend on SEC rendering behavior or XSLT transforms that do not work inside the inline viewer. In those cases the page falls back to SEC.gov.',
  },
  {
    question: 'What does the redline compare against?',
    answer: 'Redline compares the current filing against the closest prior comparable filing of the same form type from the company submissions feed. It summarizes disclosure blocks rather than doing a character-by-character legal blackline.',
  },
  {
    question: 'Where do saved alerts and annotations live?',
    answer: 'Both are stored locally in the browser. They are useful for your own workflow on the same machine, but they are not shared across devices and do not send background notifications.',
  },
  {
    question: 'How does the AI extraction work for Board Profiles?',
    answer: 'Board and compensation data is extracted from DEF 14A proxy statements using Claude AI. The system parses director names, committee memberships, tenure, and executive compensation tables. This requires a valid Anthropic API key in the deployment.',
  },
  {
    question: 'What is the fastest way to narrow a noisy result set?',
    answer: 'Keep the main query focused on the issue itself, then narrow with form type, date window, issuer, auditor, SIC, and section filters. Filters are usually more effective than stuffing every constraint into the search string.',
  },
  {
    question: 'Can I compare financial data across companies?',
    answer: 'Yes — use the Disclosure Benchmarking Matrix (/compare). Add tickers to build a peer set, then view live XBRL financial data (revenue, assets, net income, etc.) side by side. You can also use SIC code discovery to automatically pull an industry cohort.',
  },
  {
    question: 'How do I track insider transactions?',
    answer: 'Go to Insider Trading (/insiders) and search by company or insider name. The page shows Forms 3, 4, and 5 filings including transaction types, share amounts, and ownership changes for officers, directors, and 10%+ beneficial owners.',
  },
  {
    question: 'What form types are available for search?',
    answer: 'All SEC EDGAR form types are searchable: 10-K, 10-Q, 8-K, DEF 14A, S-1, F-1, SC 13D/G, Forms 3/4/5, 20-F, 6-K, N-1A, ADV, and hundreds more. Use the form type filter in the Research Workbench for the full list.',
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function matchesQuery(query: string, value: string): boolean {
  return value.toLowerCase().includes(query);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function SupportCenter() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return GUIDE_SECTIONS;
    return GUIDE_SECTIONS.filter(section =>
      matchesQuery(normalizedQuery, section.title) ||
      matchesQuery(normalizedQuery, section.summary) ||
      section.steps.some(step => matchesQuery(normalizedQuery, step)) ||
      section.notes.some(note => matchesQuery(normalizedQuery, note))
    );
  }, [normalizedQuery]);

  const visibleFaqs = useMemo(() => {
    if (!normalizedQuery) return FAQS;
    return FAQS.filter(faq => matchesQuery(normalizedQuery, faq.question) || matchesQuery(normalizedQuery, faq.answer));
  }, [normalizedQuery]);

  const noResults = visibleSections.length === 0 && visibleFaqs.length === 0;

  return (
    <div className="support-container">
      <section className="support-hero">
        <span className="support-kicker">Usage Guide</span>
        <h1>Learn the {BRAND.shortName} workflow quickly</h1>
        <p>
          This page is the practical guide to every tool on the platform: where to start, how to narrow filings, what each workspace does, and what limitations you should keep in mind.
        </p>

        <div className="support-search-wrapper">
          <Search className="support-search-icon" size={20} />
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search the guide, workflows, and FAQ..."
          />
        </div>

        <div className="support-summary-grid">
          <div className="support-summary-card glass-card" onClick={() => router.push('/search')} style={{ cursor: 'pointer' }}>
            <Filter size={20} />
            <h3>Use filters first</h3>
            <p>17 advanced filters — issuer, form, date, SIC, auditor, exchange, filer status, section keywords — narrow results before you search.</p>
          </div>
          <div className="support-summary-card glass-card" onClick={() => router.push('/search')} style={{ cursor: 'pointer' }}>
            <FileSearch size={20} />
            <h3>Open the filing</h3>
            <p>Move into Filing Detail for section jumps, annotations, YoY redline, table extraction, and PDF export.</p>
          </div>
          <div className="support-summary-card glass-card" onClick={() => router.push('/compare')} style={{ cursor: 'pointer' }}>
            <BarChart3 size={20} />
            <h3>Benchmark peers</h3>
            <p>Compare XBRL financials across companies, build peer cohorts by SIC code, and generate redline disclosure diffs.</p>
          </div>
        </div>
      </section>

      <div className="guide-layout">
        <aside className="guide-sidebar glass-card">
          {/* Guide section nav */}
          <div className="guide-sidebar-section">
            <h3><BookOpen size={16} /> Guide Sections</h3>
            <div className="guide-nav">
              {visibleSections.map(section => (
                <a key={section.id} href={`#${section.id}`}>
                  {section.title}
                </a>
              ))}
            </div>
          </div>

          {/* Platform quick-links */}
          {PLATFORM_LINKS.map(group => (
            <div key={group.group} className="guide-sidebar-section">
              <h3>{group.group}</h3>
              <div className="guide-nav">
                {group.items.map(item => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={e => { e.preventDefault(); router.push(item.href); }}
                    className="platform-link"
                  >
                    <item.icon size={14} />
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ))}

          {/* Quick notes */}
          <div className="guide-sidebar-section">
            <h3><Download size={16} /> Important To Know</h3>
            <ul className="guide-side-notes">
              <li>PDF export uses the browser print dialog after opening a clean filing view.</li>
              <li>Redline is disclosure-block comparison, not a legal blackline.</li>
              <li>Annotations and saved alerts are local to the current browser.</li>
              <li>AI board extraction requires a valid Anthropic API key.</li>
              <li>XBRL financial data is live from the SEC API.</li>
            </ul>
          </div>
        </aside>

        <main className="guide-main">
          {noResults ? (
            <div className="guide-section glass-card">
              <h2>No guide matches</h2>
              <p>Try a broader term like &ldquo;alerts&rdquo;, &ldquo;Boolean&rdquo;, &ldquo;PDF&rdquo;, &ldquo;annotations&rdquo;, &ldquo;ESG&rdquo;, &ldquo;IPO&rdquo;, or &ldquo;filters&rdquo;.</p>
            </div>
          ) : (
            <>
              {visibleSections.map(section => (
                <article key={section.id} id={section.id} className="guide-section glass-card">
                  <h2>{section.title}</h2>
                  <p className="guide-summary">{section.summary}</p>

                  <div className="guide-columns">
                    <div>
                      <h4>Recommended Workflow</h4>
                      <ol className="guide-list ordered">
                        {section.steps.map(step => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>

                    <div>
                      <h4>Practical Notes</h4>
                      <ul className="guide-list">
                        {section.notes.map(note => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {section.links && section.links.length > 0 && (
                    <div className="guide-links">
                      {section.links.map(link => (
                        <button
                          key={link.href}
                          className="guide-link-btn"
                          onClick={() => router.push(link.href)}
                        >
                          {link.label}
                          <ArrowRight size={14} />
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}

              {visibleFaqs.length > 0 && (
                <section className="guide-section glass-card">
                  <h2><HelpCircle size={20} /> FAQ</h2>
                  <div className="faq-list">
                    {visibleFaqs.map(faq => (
                      <details key={faq.question} className="faq-item">
                        <summary>{faq.question}</summary>
                        <p>{faq.answer}</p>
                      </details>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
