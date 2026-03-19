import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CheckSquare, Sparkles, Search, ChevronRight, FileText, Loader2, BellRing, Building2 } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import SearchFilterBar, { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';
import { aiAscLookup, aiSummarize } from '../services/geminiApi';
import { buildSearchTrendSummary, executeFilingResearchSearch, type FilingResearchResult, type ResearchSearchMode } from '../services/filingResearch';
import ResponsibleAIBanner from '../components/ResponsibleAIBanner';
import { renderMarkdown } from '../utils/markdownRenderer';
import { useApp } from '../context/AppState';
import './AccountingHub.css';

const fasbTopics = [
  { id: '100', name: 'General Principles' },
  { id: '200', name: 'Presentation' },
  { id: '300', name: 'Assets' },
  { id: '400', name: 'Liabilities' },
  { id: '500', name: 'Equity' },
  { id: '600', name: 'Revenue' },
  { id: '700', name: 'Expenses' },
  { id: '800', name: 'Broad Transactions' },
  { id: '900', name: 'Industry' },
];

const ADOPTION_SEARCHES = [
  'DISE',
  '"segment expense" AND adoption',
  '"ASU 2023-09"',
  'ASC 842 adoption w/10 lease',
];

const RESEARCH_DEFAULT_FORMS = '10-K,10-Q,20-F,8-K';

function buildAlertName(query: string, filters: SearchFilters): string {
  if (query.trim()) return query.trim();
  if (filters.entityName.trim()) return `${filters.entityName.trim()} accounting research`;
  if (filters.sicCode.trim()) return `ASC cohort SIC ${filters.sicCode.trim()}`;
  return 'Accounting research alert';
}

export default function AccountingHub() {
  const navigate = useNavigate();
  const { addSavedAlert } = useApp();

  const [activeTab, setActiveTab] = useState<'standards' | 'checklist' | 'research' | 'ai'>('research');

  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [researchQuery, setResearchQuery] = useState('');
  const [researchMode, setResearchMode] = useState<ResearchSearchMode>('semantic');
  const [researchFilters, setResearchFilters] = useState<SearchFilters>({
    ...defaultSearchFilters,
    formTypes: ['10-K', '10-Q', '20-F', '8-K'],
  });
  const [researchResults, setResearchResults] = useState<FilingResearchResult[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchMemo, setResearchMemo] = useState('');
  const [researchMemoLoading, setResearchMemoLoading] = useState(false);
  const [researchError, setResearchError] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const [checklistItems, setChecklistItems] = useState([
    { id: 1, text: 'Confirm early adopters disclose transition method and date of adoption', done: false },
    { id: 2, text: 'Compare peer accounting policy wording for the same arrangement', done: true },
    { id: 3, text: 'Review SEC comments on judgment-heavy disclosure positions', done: false },
  ]);

  const researchMetrics = useMemo(() => {
    const issuers = new Set(researchResults.map(result => result.entityName)).size;
    const auditors = researchResults.reduce<Record<string, number>>((acc, result) => {
      const key = result.auditor || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const topAuditor = Object.entries(auditors).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
    return { issuers, topAuditor };
  }, [researchResults]);

  const researchColumns: ColumnDef<FilingResearchResult>[] = [
    { key: 'fileDate', header: 'Date', sortable: true, width: '110px' },
    { key: 'formType', header: 'Form', sortable: true, width: '90px' },
    { key: 'entityName', header: 'Company', sortable: true, width: '180px' },
    { key: 'auditor', header: 'Auditor', sortable: true, width: '120px' },
    { key: 'sicDescription', header: 'Industry', sortable: true, width: '170px' },
    {
      key: 'description',
      header: 'Why It Matched',
      render: row => row.description || row.primaryDocument || 'Matched on filing metadata',
    },
    {
      key: 'accessionNumber',
      header: 'Open',
      width: '120px',
      render: row => (
        <button
          className="secondary-btn"
          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
          onClick={event => {
            event.stopPropagation();
            navigate(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`, {
              state: {
                companyName: row.entityName,
                filingDate: row.fileDate,
                formType: row.formType,
                fileNumber: row.fileNumber,
                auditor: row.auditor,
              },
            });
          }}
        >
          View
        </button>
      ),
    },
  ];

  const handleAiSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!aiQuery.trim()) return;
    setIsAiLoading(true);
    try {
      setAiResponse(await aiAscLookup(aiQuery));
    } finally {
      setIsAiLoading(false);
    }
  };

  const runResearch = async (nextQuery = researchQuery) => {
    if (!nextQuery.trim() && !researchFilters.entityName.trim()) return;

    setResearchLoading(true);
    setResearchError('');
    setResearchMemo('');
    setAlertMessage('');

    try {
      const matches = await executeFilingResearchSearch({
        query: nextQuery,
        filters: researchFilters,
        mode: researchMode,
        defaultForms: RESEARCH_DEFAULT_FORMS,
        limit: 40,
        hydrateTextSignals: true,
      });

      setResearchResults(matches);
      if (matches.length === 0) {
        setResearchError('No matching filings found. Try widening the date range, removing the auditor filter, or switching to a broader semantic query.');
      }
    } catch (error) {
      console.error('Accounting research failed:', error);
      setResearchResults([]);
      setResearchError('Accounting research failed. Check the SEC proxy path or retry with a narrower search.');
    } finally {
      setResearchLoading(false);
    }
  };

  const handleGenerateMemo = async () => {
    if (researchResults.length === 0) return;

    setResearchMemoLoading(true);
    try {
      const statsSummary = await buildSearchTrendSummary(researchResults.slice(0, 20), researchQuery, researchFilters);
      const aiResponse = await aiSummarize(
        `You are a senior accounting research analyst preparing a memo on early adoption and disclosure practice.

Search summary:
${statsSummary}

Results:
${researchResults
  .slice(0, 12)
  .map(result => `- ${result.fileDate} | ${result.entityName} | ${result.formType} | Auditor: ${result.auditor || 'Unknown'} | ${result.description || 'No description'}`)
  .join('\n')}

Write a concise memo with:
1. Which companies appear to be early or clearer adopters.
2. Common disclosure approaches or accounting policy wording trends.
3. What a reviewer should dig into next, including SEC comments or auditor filters if relevant.`
      );

      if (!aiResponse || aiResponse.toLowerCase().includes('api key missing') || aiResponse.toLowerCase().includes('summary unavailable')) {
        setResearchMemo(statsSummary);
      } else {
        setResearchMemo(aiResponse);
      }
    } catch (error) {
      console.error('Accounting memo error:', error);
      setResearchMemo(await buildSearchTrendSummary(researchResults.slice(0, 20), researchQuery, researchFilters));
    } finally {
      setResearchMemoLoading(false);
    }
  };

  const handleSaveAlert = () => {
    if (!researchQuery.trim() && !researchFilters.entityName.trim()) return;

    addSavedAlert({
      name: buildAlertName(researchQuery, researchFilters),
      query: researchQuery,
      mode: researchMode,
      filters: researchFilters,
      defaultForms: RESEARCH_DEFAULT_FORMS,
      lastSeenAccessions: researchResults.map(result => result.accessionNumber),
      latestNewAccessions: [],
      latestResultCount: researchResults.length,
    });
    setAlertMessage('Alert saved locally. It will appear in the dashboard alert center for future filing checks.');
  };

  const toggleChecklist = (id: number) => {
    setChecklistItems(prev => prev.map(item => (item.id === id ? { ...item, done: !item.done } : item)));
  };

  return (
    <div className="accounting-hub-container">
      <div className="hub-header">
        <h1>Accounting Research Hub</h1>
        <p>Research actual filing practice, find early adopters, filter by auditor, and turn disclosure search results into something your team can use.</p>
      </div>

      <div className="hub-layout">
        <aside className="hub-sidebar glass-card">
          <nav className="hub-nav">
            <button className={`nav-btn ${activeTab === 'research' ? 'active' : ''}`} onClick={() => setActiveTab('research')}>
              <Building2 size={18} /> Filing Research
            </button>
            <button className={`nav-btn ${activeTab === 'standards' ? 'active' : ''}`} onClick={() => setActiveTab('standards')}>
              <BookOpen size={18} /> Standards Directory
            </button>
            <button className={`nav-btn ${activeTab === 'checklist' ? 'active' : ''}`} onClick={() => setActiveTab('checklist')}>
              <CheckSquare size={18} /> Review Checklist
            </button>
            <button className={`nav-btn ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveTab('ai')}>
              <Sparkles size={18} /> Ask AI for ASCs
            </button>
          </nav>

          <div className="sidebar-widget mt-8">
            <h4>Research Workflows</h4>
            <div className="update-item mt-4">
              <p className="text-sm mt-1">Use Boolean or proximity search to find early filers, then narrow by auditor, SIC, form type, and date range.</p>
            </div>
            <div className="update-item mt-4">
              <p className="text-sm mt-1">Generate a short memo from the search results so the team does not need to infer trends manually from a result list.</p>
            </div>
          </div>
        </aside>

        <main className="hub-main glass-card">
          {activeTab === 'research' && (
            <div className="tab-pane fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h2>Early Adoption & Policy Research</h2>
                  <p style={{ color: '#94A3B8', margin: '6px 0 0', maxWidth: '900px' }}>
                    Search for how companies are actually addressing a standard in their filings, benchmark disclosure language across peers, and save alerts for future filings.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className={`secondary-btn ${researchMode === 'semantic' ? 'active' : ''}`}
                    onClick={() => setResearchMode('semantic')}
                    style={{ borderColor: researchMode === 'semantic' ? '#3B82F6' : undefined }}
                  >
                    Semantic
                  </button>
                  <button
                    className={`secondary-btn ${researchMode === 'boolean' ? 'active' : ''}`}
                    onClick={() => setResearchMode('boolean')}
                    style={{ borderColor: researchMode === 'boolean' ? '#3B82F6' : undefined }}
                  >
                    Boolean / w/#
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '280px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '12px 14px' }}>
                  <Search size={16} style={{ color: '#94A3B8' }} />
                  <input
                    value={researchQuery}
                    onChange={event => setResearchQuery(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void runResearch();
                      }
                    }}
                    placeholder='Try "ASU 2023-09", DISE, or ASC 842 adoption w/10 lease'
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: '0.92rem' }}
                  />
                </div>
                <button className="primary-btn" onClick={() => void runResearch()} disabled={researchLoading}>
                  {researchLoading ? <Loader2 size={16} className="spinner" /> : <Search size={16} />} Search
                </button>
                <button className="secondary-btn" onClick={handleSaveAlert} disabled={!researchQuery.trim() && !researchFilters.entityName.trim()}>
                  <BellRing size={16} /> Save Alert
                </button>
                <button className="secondary-btn" onClick={() => void handleGenerateMemo()} disabled={researchResults.length === 0 || researchMemoLoading}>
                  {researchMemoLoading ? <Loader2 size={16} className="spinner" /> : <Sparkles size={16} />} Generate Memo
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {ADOPTION_SEARCHES.map(sample => (
                  <button
                    key={sample}
                    className="secondary-btn"
                    style={{ fontSize: '0.78rem', padding: '6px 10px' }}
                    onClick={() => {
                      setResearchQuery(sample);
                      void runResearch(sample);
                    }}
                  >
                    {sample}
                  </button>
                ))}
              </div>

              <SearchFilterBar
                config={{
                  showEntityName: true,
                  showDateRange: true,
                  showFormTypes: true,
                  showSectionKeywords: true,
                  showSIC: true,
                  showExchange: true,
                  showAcceleratedStatus: true,
                  showAccountant: true,
                  showFiscalYearEnd: true,
                  formTypeOptions: ['10-K', '10-Q', '20-F', '8-K', 'S-1'],
                }}
                filters={researchFilters}
                onChange={setResearchFilters}
                onSearch={() => void runResearch()}
                loading={researchLoading}
              />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div className="glass-card" style={{ padding: '14px' }}>
                  <div style={{ color: '#64748B', fontSize: '0.78rem', textTransform: 'uppercase' }}>Matched Filings</div>
                  <div style={{ color: 'white', fontSize: '1.6rem', fontWeight: 700 }}>{researchResults.length}</div>
                </div>
                <div className="glass-card" style={{ padding: '14px' }}>
                  <div style={{ color: '#64748B', fontSize: '0.78rem', textTransform: 'uppercase' }}>Issuers</div>
                  <div style={{ color: 'white', fontSize: '1.6rem', fontWeight: 700 }}>{researchMetrics.issuers}</div>
                </div>
                <div className="glass-card" style={{ padding: '14px' }}>
                  <div style={{ color: '#64748B', fontSize: '0.78rem', textTransform: 'uppercase' }}>Top Auditor</div>
                  <div style={{ color: 'white', fontSize: '1.1rem', fontWeight: 600 }}>{researchMetrics.topAuditor}</div>
                </div>
              </div>

              {alertMessage && (
                <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.2)', background: 'rgba(59,130,246,0.08)', color: '#BFDBFE' }}>
                  {alertMessage}
                </div>
              )}

              {researchError && (
                <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(127,29,29,0.22)', color: '#FECACA' }}>
                  {researchError}
                </div>
              )}

              {(researchMemo || researchMemoLoading) && (
                <div style={{ borderLeft: '4px solid #3B82F6', background: 'rgba(15,23,42,0.6)', borderRadius: '12px', padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <Sparkles size={18} className="text-blue-400" />
                    <h3 style={{ margin: 0, color: 'white', fontSize: '1rem' }}>Accounting Research Memo</h3>
                  </div>
                  {researchMemoLoading ? (
                    <div style={{ color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Loader2 size={16} className="spinner" /> Generating memo from the current filing set...
                    </div>
                  ) : (
                    <div className="md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(researchMemo) }} />
                  )}
                  <div style={{ marginTop: '14px' }}>
                    <ResponsibleAIBanner />
                  </div>
                </div>
              )}

              <div>
                <DataTable
                  columns={researchColumns}
                  data={researchResults}
                  pageSize={12}
                  emptyMessage="Run an accounting research search to surface filings."
                  onRowClick={row => {
                    navigate(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`, {
                      state: {
                        companyName: row.entityName,
                        filingDate: row.fileDate,
                        formType: row.formType,
                        fileNumber: row.fileNumber,
                        auditor: row.auditor,
                      },
                    });
                  }}
                  rowKey={row => row.id}
                />
              </div>
            </div>
          )}

          {activeTab === 'standards' && (
            <div className="tab-pane fade-in">
              <div className="pane-header">
                <h2>FASB Accounting Standards Codification</h2>
                <div className="search-bar">
                  <Search size={16} className="search-icon" />
                  <input type="text" placeholder="Search topics, subtopics, or keywords..." />
                </div>
              </div>

              <div className="topics-grid">
                {fasbTopics.map(topic => (
                  <a
                    key={topic.id}
                    href={`https://asc.fasb.org/${topic.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="topic-card dropdown-trigger"
                    style={{ textDecoration: 'none', cursor: 'pointer' }}
                    title={`Open ASC ${topic.id} - ${topic.name} on FASB.org`}
                  >
                    <div className="topic-header">
                      <span className="topic-id">ASC {topic.id}</span>
                      <ChevronRight size={16} className="text-muted" />
                    </div>
                    <h3 className="topic-name">{topic.name}</h3>
                  </a>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'checklist' && (
            <div className="tab-pane fade-in">
              <div className="pane-header flex justify-between items-center">
                <h2>Technical Accounting Review Checklist</h2>
                <button
                  className="primary-btn sm"
                  onClick={() => setChecklistItems(prev => [...prev, { id: Date.now(), text: 'New review item - click to tailor to your issue', done: false }])}
                >
                  + New Item
                </button>
              </div>

              <div className="checklist-container mt-6">
                <div className="checklist-header">
                  <h3>Quarter-End Research Review</h3>
                  <span className="progress-text">{checklistItems.filter(item => item.done).length} / {checklistItems.length} Completed</span>
                </div>

                <ul className="checklist-items">
                  {checklistItems.map(item => (
                    <li key={item.id} className={`checklist-item ${item.done ? 'completed' : ''}`}>
                      <label className="checkbox-wrap">
                        <input type="checkbox" checked={item.done} onChange={() => toggleChecklist(item.id)} />
                        <span className="checkbox-custom"></span>
                      </label>
                      <span className="item-text">{item.text}</span>
                      <button className="icon-btn ml-auto"><FileText size={16} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="tab-pane fade-in ai-pane">
              <div className="ai-intro text-center py-8">
                <Sparkles size={48} className="text-blue-500 mx-auto mb-4" />
                <h2>Ask AI for Accounting Guidance</h2>
                <p className="text-slate-400 max-w-lg mx-auto">Describe the transaction, accounting issue, or disclosure question and get a fast ASC-oriented starting point.</p>
              </div>

              <div className="ai-chat-area">
                {aiResponse && (
                  <div className="ai-response-box">
                    <div className="ai-avatar">AI</div>
                    <div className="ai-text md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiResponse) }} />
                  </div>
                )}

                {isAiLoading && (
                  <div className="ai-response-box loading text-slate-400">
                    <Loader2 size={18} className="spinner inline mr-2" /> Connecting to technical accounting guidance...
                  </div>
                )}
              </div>

              <form className="ai-input-form" onSubmit={handleAiSubmit}>
                <input
                  type="text"
                  className="ai-input"
                  placeholder="e.g., How do I account for a modification of a stock option under ASC 718?"
                  value={aiQuery}
                  onChange={event => setAiQuery(event.target.value)}
                  disabled={isAiLoading}
                />
                <button type="submit" className="primary-btn" disabled={isAiLoading || !aiQuery.trim()}>
                  Ask Expert
                </button>
              </form>

              <ResponsibleAIBanner />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
