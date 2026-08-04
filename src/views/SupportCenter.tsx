'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, BarChart3, BookOpen, Briefcase, Building2,
  ClipboardList, Download, FileSearch, FileText, Filter,
  Gavel, Globe, HelpCircle, LayoutDashboard, LineChart, Mail,
  Mic, Scale, Search, Shield, TrendingUp, UserCheck, Users
} from 'lucide-react';
import { ENFORCEMENT_SCOPE_LIMITATION } from '../config/enforcement';
import { EARNINGS_SCOPE_LABEL, EARNINGS_SCOPE_LIMITATION } from '../config/earnings';
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
    { label: EARNINGS_SCOPE_LABEL, href: '/earnings', icon: Mic },
  ]},
  { group: 'Regulation & Compliance', items: [
    { label: 'Securities Regulation', href: '/regulation', icon: Scale },
    { label: 'Comment Letters', href: '/comment-letters', icon: Mail },
    { label: 'No-Action Letters', href: '/no-action-letters', icon: FileText },
    { label: 'SEC Litigation Releases', href: '/enforcement', icon: Gavel },
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
      'Enter a keyword, company name, or disclosure topic in the main search field. Filing Research mode can extract supported company, form, date, and auditor constraints from plain-language input.',
      'Use form type, date range, SIC code, auditor, exchange, filer status, section keywords, and other available fields to narrow results before searching.',
      'Toggle between Filing Research mode for assisted query preparation and Boolean mode for AND, OR, NOT, quoted phrases, w/# and p/# proximity, wildcards (crypto*, wom?n), numeric operands (#, $#, %#), and the auditor: field.',
      'Click any result row to open the filing in the Filing Detail viewer.',
    ],
    notes: [
      'Results are constrained by supported metadata filters and filing-text checks; missing source metadata can still affect coverage.',
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
    summary: 'Master the full workflow: assisted filing search, Boolean search, research sessions with tabs, result insights, and saved alerts.',
    steps: [
      'Use Filing Research mode to turn supported plain-language constraints into a deterministic SEC search. It is not conceptual or vector retrieval.',
      'Switch to Boolean mode when you need exact-match results. Use AND, OR, NOT, "quoted phrases", proximity operators like w/5, near/10 or ordered p/3, single-word wildcards (crypto*, wom?n), and numeric operands (#, $#, %#). Your mode choice is authoritative — typed prose will not silently switch modes.',
      'Precedence is NOT, then proximity, then AND (explicit or implied by a space), then OR. Use parentheses to override it: (impairment OR restructuring) AND lease.',
      'Bare terms match whole words, case-insensitively, with singular/plural equivalence — lease also matches leases, and weakness also matches weaknesses. There is no broader stemming, so audit does not match auditory. Quoted phrases match a contiguous run of whole words, so "net income" does not match "planet income". Punctuation is normalised both ways, so 10-K, non-GAAP, R&D and U.S. GAAP all match their spaced forms.',
      'Scope Boolean results to a specific audit firm inline with auditor:<firm> — e.g. "material weakness" AND auditor:KPMG, or auditor:"Ernst & Young" on its own (quote multi-word firms). The field applies to the whole search, so it is only allowed in AND context; auditor: inside an OR or NOT group is rejected. It combines with the Auditor filter in Advanced Filters. The firm shown uses the latest unambiguous PCAOB-reported ordinary-issuer audit firm on or before that filing date; unresolved Form AP cases fall back to evidence in the filing.',
      'Each search opens in a new tab within your research session, so you can compare multiple queries side by side.',
      'Generate a trend report after a search to get an AI-powered summary of what the result set shows.',
      'Save an alert if you plan to rerun the same search regularly — it will appear on your Dashboard for quick re-execution.',
    ],
    notes: [
      'Saved alerts and annotations are browser-local. They help with repeat research but are not shared across devices.',
      'Boolean results are verified matches within a bounded candidate window, not a claim about the whole EDGAR corpus. If a run hits its time or request budget, or a filing could not be retrieved for validation, the results are labelled partial — read a zero in that state as "no verified matches among the candidates checked", not "nothing exists".',
      'If a Boolean search returns nothing, check for typos in quoted phrases and try widening the date window first. Invalid syntax (a dangling AND/OR, unbalanced parentheses or quotes, or a NOT-only query) is reported inline and runs no search at all.',
      'Research sessions are saved in the current browser and can be restored there; they are not shared across devices.',
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
    summary: 'The Dashboard shows filing activity for your browser-local watchlist, local saved-search alerts, and watchlist-scoped charts.',
    steps: [
      'Review current-year filing volume and form mix for the companies in your watchlist.',
      'Use the watchlist to track specific companies and see their latest filings at a glance.',
      'Use local saved-search alerts to open or manually re-check frequent queries.',
      'Use filing-volume and watchlist cards to open a prefilled Research Workbench search; open a filing result there for the detailed viewer.',
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
    summary: 'Research AI-extracted director roles, independence, committee memberships, gender breakdown, and executive compensation from DEF 14A proxy statements.',
    steps: [
      'Enter a public-company ticker to load its board and compensation data.',
      'Add multiple companies (e.g., AAPL and GOOGL) to compare extracted governance metrics side by side.',
      'Switch among Director Profiles, Board Diversity, and Executive Comp to review the fields available in each view.',
      'Use Governance Overview for board size, independence, and CEO pay ratio; the comparison table also includes female representation and say-on-pay approval when extracted.',
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
    summary: 'The Accounting Research Hub combines a standards-topic directory, SEC filing research, result-set memos, and a browser-local checklist. Accounting Analytics compares financial ratios for selected companies.',
    steps: [
      'In the Accounting Research Hub, search for specific accounting standards (e.g., ASC 606, ASC 842) to find how companies describe their adoption.',
      'Filter by industry or SIC code to see how peers in your sector handle the same topic.',
      'Use Accounting Analytics to compare latest-year profitability, leverage, liquidity, and efficiency ratios for companies you select.',
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
    title: 'Regulation, Comment Letters & Litigation Releases',
    summary: 'Research SEC securities regulation, track comment letter correspondence between the SEC and registrants, review no-action letters, and monitor official SEC litigation releases.',
    steps: [
      'Use Securities Regulation to browse and search current SEC rules and regulations.',
      'Search Comment Letters to see what the SEC staff has asked specific companies or industries about.',
      'Browse No-Action Letters for SEC staff guidance on specific regulatory questions.',
      'Monitor SEC litigation releases for civil actions filed by the Commission.',
    ],
    notes: [
      'Comment letter searches work best with company name or specific disclosure topic keywords.',
      ENFORCEMENT_SCOPE_LIMITATION,
    ],
    links: [
      { label: 'Securities Regulation', href: '/regulation' },
      { label: 'Comment Letters', href: '/comment-letters' },
      { label: 'No-Action Letters', href: '/no-action-letters' },
      { label: 'SEC Litigation Releases', href: '/enforcement' },
    ],
  },
  {
    id: 'esg-research',
    title: 'ESG Research Center',
    summary: 'Browse official sustainability-framework links, compare AI-rated ESG disclosure depth for selected companies, and review recent 8-K candidates.',
    steps: [
      'Use Interoperability Matrices to open official framework sources and review the built-in cross-framework topic mapping.',
      'Add public-company tickers to the Disclosure Heatmap; AI rates the configured topics from each available latest 10-K.',
      'Compare rated topics across the selected tickers and use the coverage note to identify companies that could not be rated.',
      'Use Earnings Releases to filter recent 8-K candidates, generate an on-demand source summary, and open the source filing.',
    ],
    notes: [
      'AI heatmap ratings and generated summaries require source review; dashed cells mean a selected company was not rated.',
    ],
    links: [
      { label: 'Open ESG Research', href: '/esg' },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions: IPO, M&A, Exhibits & More',
    summary: 'Research IPO filings, M&A transaction documents, material agreements, and Form D exempt-offering notices.',
    steps: [
      'Use the IPO Center to browse S-1, S-1/A, F-1, F-1/A, and 424B4 filings and analyze selected registration statements.',
      'Open M&A Research to screen 8-K, SC 13D, and SC TO-T results and search 8-K or SC 13D filings for clause extraction.',
      'Browse Exhibits & Agreements to find specific exhibit types — material contracts (EX-10.x), merger agreements (EX-2.1), subsidiary lists (EX-21), and more.',
      'Search Exempt Offerings for Form D and D/A notices filed through EDGAR.',
    ],
    notes: [
      'Exhibit search supports specific exhibit type codes for precision (e.g., EX-10.1, EX-2.1, EX-21).',
      'Use Research Workbench with an 8-K form filter for broad material-event research; the earnings page is limited to EX-99.1 documents.',
    ],
    links: [
      { label: 'IPO Center', href: '/ipo' },
      { label: 'M&A Research', href: '/mna' },
      { label: 'Exhibits & Agreements', href: '/exhibits' },
      { label: 'Exempt Offerings', href: '/exempt-offerings' },
    ],
  },
  {
    id: 'events-insiders',
    title: 'Earnings Release Exhibits & Insider Trading',
    summary: 'Track material corporate events through 8-K filings and monitor insider transactions (Forms 3, 4, 5) for officers, directors, and 10%+ beneficial owners.',
    steps: [
      'Use Earnings Release Exhibits to search official EX-99.1 documents attached to 8-K, 8-K/A, or 6-K parent filings.',
      'Filter by company or date range to track event sequences for a specific issuer.',
      'Open Insider Trading and add companies to list their Forms 3, 4, and 5 ownership filings.',
      'Open the SEC source document to inspect transaction codes, share amounts, option exercises, and ownership changes; those fields are not parsed into the platform table.',
    ],
    notes: [
      'Insider filing metadata is sourced from SEC EDGAR. Large batches of Form 4 filings around earnings dates are common.',
      EARNINGS_SCOPE_LIMITATION,
    ],
    links: [
      { label: EARNINGS_SCOPE_LABEL, href: '/earnings' },
      { label: 'Insider Trading', href: '/insiders' },
    ],
  },
  {
    id: 'company-detail',
    title: 'Company Detail Pages',
    summary: 'Issuer dossiers show CIK, exchange, SIC, state of incorporation, current auditor when available, recent submissions, comment-letter episodes, and latest XBRL financials.',
    steps: [
      'Navigate directly to /company/TICKER (for example, /company/AAPL) or open an issuer dossier from a company link or the command palette.',
      'Review the issuer identity and source fields: CIK, exchange, SIC code, state of incorporation, and current auditor when available.',
      'Browse up to 15 recent SEC submissions with form type, date, and description.',
      'Use View to open a recent source document on SEC.gov; use Research Workbench results when you need the Filing Detail viewer and its tools.',
    ],
    notes: [
      'Company data comes from the SEC EDGAR company submissions API.',
      'The issuer dossier is a recent-submissions view, not a complete historical filing archive; use Research Workbench for broader history.',
    ],
    links: [
      { label: 'Try: Apple (AAPL)', href: '/company/AAPL' },
      { label: 'Try: Microsoft (MSFT)', href: '/company/MSFT' },
    ],
  },
];

const FAQS: FaqItem[] = [
  {
    question: 'How do I search for a specific company\'s filings?',
    answer: 'Use the Research Workbench (/search) and enter the company name or ticker in the entity/company field. You can also navigate directly to /company/TICKER (e.g., /company/AAPL) for a dossier with recent submissions, comment letters, and financials.',
  },
  {
    question: 'What is the difference between Filing Research and Boolean search?',
    answer: 'Filing Research mode extracts supported constraints from plain-language input and runs a deterministic SEC search; it is not conceptual retrieval. Boolean mode supports AND, OR, NOT, quoted phrases, proximity operators — w/5 or near/10 for either order, p/3 for first-term-precedes — numeric operands (# for any number, $# for a currency amount, %# for a percentage, e.g. "goodwill impairment" w/10 $#), single-word wildcards (crypto*, wom?n — these validate against filing text but cannot widen EDGAR retrieval, so pair them with a concrete term), and an audit-firm field — auditor:Deloitte (or auditor:"Ernst & Young") — to scope results to a specific accounting firm. Boolean matching is exact: whole-word terms with singular/plural equivalence, phrases bounded to whole words, and every OR branch retrieved independently so a rare second branch is never hidden by a common first one.',
  },
  {
    question: 'How do the search filters work?',
    answer: 'Available filters include keyword, date range, entity, form types, section keywords, SIC, state, headquarters, exchange, filer status, auditor, accession number, file number, fiscal year end, and accounting framework. Supported metadata predicates are sent with the search, while text-dependent predicates are checked against retrieved filing text. Source metadata gaps can affect coverage.',
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
    answer: 'Board and compensation data is extracted from DEF 14A proxy statements using Claude AI. The system parses director names, roles, independence, committee memberships, diversity fields, and executive compensation. This requires a valid Anthropic API key in the deployment.',
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
    answer: 'Go to Insider Trading (/insiders) and add one or more companies. The page lists Forms 3, 4, and 5 filing metadata and links to each SEC source document; inspect the source document for transaction codes, share amounts, and ownership changes.',
  },
  {
    question: 'What form types are available for search?',
    answer: 'The Research Workbench supports common issuer EDGAR forms including 10-K, 10-Q, 8-K, DEF 14A, S-1, F-1, SC 13D/G, Forms 3/4/5, 20-F, 6-K, and N-1A. Specialist corpora such as Form ADV are not part of issuer EDGAR search.',
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
            aria-label="Search the guide, workflows, and FAQ"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search the guide, workflows, and FAQ..."
          />
        </div>

        <div className="support-summary-grid">
          <button type="button" className="support-summary-card glass-card" onClick={() => router.push('/search')}>
            <Filter size={20} />
            <h3>Use filters first</h3>
            <p>Issuer, form, date, SIC, auditor, exchange, filer status, and section filters narrow the SEC search before results are ranked.</p>
          </button>
          <button type="button" className="support-summary-card glass-card" onClick={() => router.push('/search')}>
            <FileSearch size={20} />
            <h3>Open the filing</h3>
            <p>Move into Filing Detail for section jumps, annotations, YoY redline, table extraction, and PDF export.</p>
          </button>
          <button type="button" className="support-summary-card glass-card" onClick={() => router.push('/compare')}>
            <BarChart3 size={20} />
            <h3>Benchmark peers</h3>
            <p>Compare XBRL financials across companies, build peer cohorts by SIC code, and generate redline disclosure diffs.</p>
          </button>
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

        <section className="guide-main">
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
        </section>
      </div>
    </div>
  );
}
