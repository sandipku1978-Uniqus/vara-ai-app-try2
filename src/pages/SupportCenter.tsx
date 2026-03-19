import { useMemo, useState } from 'react';
import { BellRing, BookOpen, Download, FileSearch, Filter, HelpCircle, Search } from 'lucide-react';
import './SupportCenter.css';

interface GuideSection {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  notes: string[];
}

interface FaqItem {
  question: string;
  answer: string;
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'start-here',
    title: 'Start Here',
    summary: 'Use the Research Workbench when you need to find filings, compare how issuers describe an issue, and narrow results with filters.',
    steps: [
      'Start in Research when you have a disclosure topic, accounting issue, auditor filter, or industry cohort in mind.',
      'Use the company/entity field if you already know the issuer. Leave it blank if you want cross-company research.',
      'Use the advanced filters to narrow by form, date window, SIC, auditor, filer status, file number, and section keywords.',
    ],
    notes: [
      'The filters are now enforced before results are shown, so they act like real gates rather than loose search hints.',
      'Boolean and proximity search such as w/5 or near/10 works best in Boolean mode.',
    ],
  },
  {
    id: 'research-workbench',
    title: 'Research Workbench',
    summary: 'This is the main workflow for disclosure research, comment-letter work, and finding peer examples.',
    steps: [
      'Use semantic mode for broad idea discovery and Boolean mode when you need pointed outcomes.',
      'Generate a trend report after a search when you want a quick summary of what the result set is showing.',
      'Save an alert if you expect to rerun the same search often and want it available in the dashboard later.',
    ],
    notes: [
      'Saved alerts are browser-local today. They help with repeat research, but they are not email or webhook alerts yet.',
      'If a search is too narrow, widen the date window first before removing issuer or auditor filters.',
    ],
  },
  {
    id: 'filing-tools',
    title: 'Filing Detail Tools',
    summary: 'Open a filing when you want to inspect the actual document, jump to sections, annotate it, compare it to a prior filing, or export data.',
    steps: [
      'Use TOC to jump to major sections detected from the filing HTML.',
      'Turn on YoY Redline to compare the filing against the closest prior comparable filing and review the added and removed disclosure blocks in the Tools tab.',
      'Turn on Annotate, select text in the filing, then save your note in the Tools tab.',
      'Use Extract Tables to download structured HTML tables as CSV.',
      'Use Print / Save PDF to open a print-friendly view, then save as PDF from your browser print dialog.',
    ],
    notes: [
      'Annotations are stored locally for the current browser.',
      'Some XML-style SEC documents will not preview inline and must be opened on SEC.gov.',
    ],
  },
  {
    id: 'benchmarking',
    title: 'Benchmarking And Accounting Research',
    summary: 'Use Benchmarking and the Accounting Research Hub when you need peer groups, trend memos, or accounting-policy examples.',
    steps: [
      'In Benchmarking, build a manual peer set or use SIC discovery to pull a focused cohort.',
      'In Accounting Research Hub, search for adoption topics, policy language, and peer treatment across filings.',
      'Use the result tables as your source set, then open filings for document-level review.',
    ],
    notes: [
      'Peer discovery is useful, but you should still review the final company list before treating it as a definitive comp set.',
      'Generated memos summarize the current result set and are best used as a starting point, not the final workpaper.',
    ],
  },
];

const FAQS: FaqItem[] = [
  {
    question: 'Why does Print / Save PDF open a print view instead of downloading a PDF directly?',
    answer: 'The filing detail page now opens a clean print-friendly version of the filing and then uses the browser print workflow. This is the most reliable client-side path without a dedicated server-side PDF renderer.',
  },
  {
    question: 'Why are some filings not visible in the embedded viewer?',
    answer: 'Some SEC documents, especially XML-based filings, depend on SEC rendering behavior or XSLT transforms that do not work well inside the inline viewer. In those cases the page falls back to SEC.gov.',
  },
  {
    question: 'What does the redline compare against?',
    answer: 'Redline compares the current filing against the closest prior comparable filing of the same form type that is available from the company submissions feed. It summarizes disclosure blocks rather than doing a character-by-character legal blackline.',
  },
  {
    question: 'Where do saved alerts and annotations live?',
    answer: 'Right now both are stored locally in the browser. They are useful for your own workflow on the same machine, but they are not shared across devices and they do not send background notifications.',
  },
  {
    question: 'How should I use Boolean search?',
    answer: 'Use Boolean mode when you already know the type of document pattern you want. Quoted phrases, AND, OR, NOT, and proximity operators like w/5 or near/10 are best for targeted research and comment-letter work.',
  },
  {
    question: 'What is the fastest way to narrow a noisy result set?',
    answer: 'Keep the main query focused on the issue itself, then narrow with form type, date window, issuer, auditor, SIC, and section filters. Filters are usually better than stuffing every constraint into the search string.',
  },
];

function matchesQuery(query: string, value: string): boolean {
  return value.toLowerCase().includes(query);
}

export default function SupportCenter() {
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
        <h1>Learn the Vara AI workflow quickly</h1>
        <p>
          This page is the practical guide to using the UI well: where to start, how to narrow filings, what the tools actually do, and what limitations you should keep in mind.
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
          <div className="support-summary-card glass-card">
            <Filter size={20} />
            <h3>Use filters first</h3>
            <p>Issuer, form, date, SIC, auditor, filer status, and section filters are the fastest way to narrow noisy results.</p>
          </div>
          <div className="support-summary-card glass-card">
            <FileSearch size={20} />
            <h3>Open the filing</h3>
            <p>Once you find a result set you like, move into Filing Detail for section jumps, annotations, redline, and exports.</p>
          </div>
          <div className="support-summary-card glass-card">
            <BellRing size={20} />
            <h3>Know the limits</h3>
            <p>Alerts and annotations are local to this browser right now, so treat them as workflow helpers rather than shared infrastructure.</p>
          </div>
        </div>
      </section>

      <div className="guide-layout">
        <aside className="guide-sidebar glass-card">
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

          <div className="guide-sidebar-section">
            <h3><Download size={16} /> Important To Know</h3>
            <ul className="guide-side-notes">
              <li>PDF export uses the browser print dialog after opening a clean filing view.</li>
              <li>Redline is disclosure-block comparison, not a legal blackline.</li>
              <li>Annotations and saved alerts are local to the current browser.</li>
            </ul>
          </div>
        </aside>

        <main className="guide-main">
          {noResults ? (
            <div className="guide-section glass-card">
              <h2>No guide matches</h2>
              <p>Try a broader term like "alerts", "Boolean", "PDF", "annotations", or "filters".</p>
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
