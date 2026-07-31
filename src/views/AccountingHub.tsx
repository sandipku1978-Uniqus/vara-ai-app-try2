'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { BookOpen, CheckSquare, Sparkles, Search, ChevronRight, Pencil, Trash2, Loader2, BellRing, Building2 } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import SearchFilterBar, { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';
import { aiAscLookup, aiSummarize } from '../services/aiApi';
import { buildSearchTrendSummary, executeFilingResearchSearch, type FilingResearchResult, type ResearchSearchMode } from '../services/filingResearch';
import SearchIntegrityNotice, { useSearchIntegrity } from '../components/research/SearchIntegrityNotice';
import ResponsibleAIBanner from '../components/ResponsibleAIBanner';
import { renderMarkdown } from '../utils/markdownRenderer';
import { useApp } from '../context/AppState';
import { hasResearchSearchCriteria } from '../services/researchSessions';
import { describeBooleanQueryIssue } from '../utils/booleanSearch';
import { scopedStorageKey } from '../services/storageNamespace';
import {
  FASB_CODIFICATION_URL,
  ascTopicUrl,
  filterCuratedAscTopics,
} from '../config/accountingTopics';
import './AccountingHub.css';

const ADOPTION_SEARCHES = [
  'DISE',
  '"segment expense" AND adoption',
  '"ASU 2023-09"',
  'ASC 842 adoption w/10 lease',
];

const RESEARCH_DEFAULT_FORMS = '10-K,10-Q,20-F,8-K';
const CHECKLIST_STORAGE_KEY = 'urc.accounting-review-checklist.v1';
interface ChecklistItem { id: number; text: string; done: boolean }

const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: 1, text: 'Confirm early adopters disclose transition method and date of adoption', done: false },
  { id: 2, text: 'Compare peer accounting policy wording for the same arrangement', done: true },
  { id: 3, text: 'Review SEC comments on judgment-heavy disclosure positions', done: false },
];

function loadChecklistItems(): ChecklistItem[] {
  if (typeof window === 'undefined') return DEFAULT_CHECKLIST_ITEMS;
  try {
    const storageKey = scopedStorageKey(CHECKLIST_STORAGE_KEY);
    if (!storageKey) return DEFAULT_CHECKLIST_ITEMS;
    const stored = window.localStorage.getItem(storageKey);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CHECKLIST_ITEMS;
    const valid = parsed.filter((item): item is ChecklistItem => (
      typeof item === 'object' && item !== null &&
      typeof (item as ChecklistItem).id === 'number' &&
      typeof (item as ChecklistItem).text === 'string' &&
      typeof (item as ChecklistItem).done === 'boolean'
    ));
    return valid.length > 0 ? valid : DEFAULT_CHECKLIST_ITEMS;
  } catch {
    return DEFAULT_CHECKLIST_ITEMS;
  }
}

function buildAlertName(query: string, filters: SearchFilters): string {
  if (query.trim()) return query.trim();
  if (filters.entityName.trim()) return `${filters.entityName.trim()} accounting research`;
  if (filters.sicCode.trim()) return `ASC cohort SIC ${filters.sicCode.trim()}`;
  return 'Accounting research alert';
}

export default function AccountingHub() {
  const navigate = useRouter();
  const { addSavedAlert, pendingSearchIntent, setPendingSearchIntent, setActiveSearchContext } = useApp();

  const [activeTab, setActiveTab] = useState<'standards' | 'checklist' | 'research' | 'ai'>('research');

  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const [researchQuery, setResearchQuery] = useState('');
  const [researchMode, setResearchMode] = useState<ResearchSearchMode>('semantic');
  const [researchFilters, setResearchFilters] = useState<SearchFilters>({
    ...defaultSearchFilters,
    formTypes: ['10-K', '10-Q', '20-F', '8-K'],
  });
  const [researchResults, setResearchResults] = useState<FilingResearchResult[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const integrity = useSearchIntegrity();
  const [researchMemo, setResearchMemo] = useState('');
  const [researchMemoLoading, setResearchMemoLoading] = useState(false);
  const [researchMemoError, setResearchMemoError] = useState('');
  const [researchError, setResearchError] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [standardsQuery, setStandardsQuery] = useState('');

  const [checklistItems, setChecklistItems] = useState(loadChecklistItems);
  const [addingChecklistItem, setAddingChecklistItem] = useState(false);
  const [newChecklistText, setNewChecklistText] = useState('');
  const [editingChecklistId, setEditingChecklistId] = useState<number | null>(null);
  const [editingChecklistText, setEditingChecklistText] = useState('');
  const [deletedChecklistItem, setDeletedChecklistItem] = useState<{ item: ChecklistItem; index: number } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const filteredFasbTopics = useMemo(
    () => filterCuratedAscTopics(standardsQuery),
    [standardsQuery]
  );

  useEffect(() => {
    const storageKey = scopedStorageKey(CHECKLIST_STORAGE_KEY);
    if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(checklistItems));
  }, [checklistItems]);

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
          type="button"
          className="secondary-btn"
          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
          onClick={() => {
            navigate.push(`/filing/${row.cik}_${row.accessionNumber}_${row.primaryDocument}`);
          }}
        >
          View
        </button>
      ),
    },
  ];

  const submitAscLookup = async () => {
    if (!aiQuery.trim()) return;
    setIsAiLoading(true);
    setAiResponse('');
    setAiError('');
    try {
      const response = await aiAscLookup(aiQuery);
      if (!response.trim()) throw new Error('The AI service returned an empty response.');
      setAiResponse(response);
    } catch (error) {
      console.error('ASC lookup error:', error);
      setAiError('Technical accounting guidance could not be generated. No answer was saved; retry when the AI service is available.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAiSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitAscLookup();
  };

  const runResearch = useCallback(async (
    nextQuery = researchQuery,
    overrideFilters = researchFilters,
    overrideMode = researchMode
  ) => {
    if (!hasResearchSearchCriteria(nextQuery, overrideFilters)) return;

    if (overrideMode === 'boolean') {
      const booleanIssue = describeBooleanQueryIssue(nextQuery);
      if (booleanIssue) {
        setResearchResults([]);
        setResearchError(booleanIssue);
        return;
      }
    }

    setResearchLoading(true);
    integrity.reset();
    setResearchError('');
    setResearchMemo('');
    setAlertMessage('');

    try {
      const matches = await executeFilingResearchSearch({
        query: nextQuery,
        filters: overrideFilters,
        mode: overrideMode,
        defaultForms: RESEARCH_DEFAULT_FORMS,
        limit: 40,
        hydrateTextSignals: true,
        ...integrity.callbacks,
      });

      setResearchResults(matches);
      setActiveSearchContext({
        surface: 'accounting',
        query: nextQuery,
        mode: overrideMode,
        filters: overrideFilters,
        results: matches,
        updatedAt: new Date().toISOString(),
      });
      if (matches.length === 0) {
        setResearchError('No matching filings found. Try widening the date range, removing the auditor filter, or using broader filing-research terms.');
      }
    } catch (error) {
      console.error('Accounting research failed:', error);
      setResearchResults([]);
      setResearchError('Accounting research failed. Check the SEC proxy path or retry with a narrower search.');
    } finally {
      setResearchLoading(false);
    }
  }, [integrity, researchFilters, researchMode, researchQuery, setActiveSearchContext]);

  useEffect(() => {
    if (!pendingSearchIntent || pendingSearchIntent.surface !== 'accounting') return;

    setResearchQuery(pendingSearchIntent.query);
    setResearchMode(pendingSearchIntent.mode);
    setResearchFilters(pendingSearchIntent.filters);

    if (pendingSearchIntent.prefetchedResults) {
      setResearchResults(pendingSearchIntent.prefetchedResults);
      setResearchLoading(false);
      setResearchError(
        pendingSearchIntent.prefetchedResults.length === 0
          ? 'No matching filings found. Try widening the date range, removing the auditor filter, or using broader filing-research terms.'
          : ''
      );
      setActiveSearchContext({
        surface: 'accounting',
        query: pendingSearchIntent.query,
        mode: pendingSearchIntent.mode,
        filters: pendingSearchIntent.filters,
        results: pendingSearchIntent.prefetchedResults,
        updatedAt: new Date().toISOString(),
      });
      setPendingSearchIntent(null);
      return;
    }

    void runResearch(pendingSearchIntent.query, pendingSearchIntent.filters, pendingSearchIntent.mode);
    setPendingSearchIntent(null);
  }, [pendingSearchIntent, runResearch, setActiveSearchContext, setPendingSearchIntent]);

  const handleGenerateMemo = async () => {
    if (researchResults.length === 0) return;

    setResearchMemoLoading(true);
    setResearchMemoError('');
    setResearchMemo('');
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
3. What a reviewer should dig into next, including SEC comments or auditor filters if relevant.`,
        { throwOnError: true }
      );

      if (!aiResponse.trim()) throw new Error('The AI service returned an empty memo.');
      setResearchMemo(aiResponse);
    } catch (error) {
      console.error('Accounting memo error:', error);
      setResearchMemoError('The accounting memo could not be generated. Your filing results are unchanged; retry when the AI service is available.');
    } finally {
      setResearchMemoLoading(false);
    }
  };

  const handleSaveAlert = () => {
    if (!hasResearchSearchCriteria(researchQuery, researchFilters)) return;

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
    setAlertMessage('Saved locally in this browser. Rerun it manually from the Dashboard; it does not send scheduled background notifications.');
  };

  const toggleChecklist = (id: number) => {
    setChecklistItems(prev => prev.map(item => (item.id === id ? { ...item, done: !item.done } : item)));
  };

  const addChecklistItem = (event: FormEvent) => {
    event.preventDefault();
    const text = newChecklistText.trim();
    if (!text) return;
    setChecklistItems(prev => [...prev, { id: Date.now(), text, done: false }]);
    setNewChecklistText('');
    setAddingChecklistItem(false);
  };

  const saveChecklistEdit = (id: number) => {
    const text = editingChecklistText.trim();
    if (!text) return;
    setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, text } : item));
    setEditingChecklistId(null);
    setEditingChecklistText('');
  };

  const removeChecklistItem = (id: number) => {
    const index = checklistItems.findIndex(item => item.id === id);
    if (index === -1) return;
    const item = checklistItems[index];
    setChecklistItems(prev => prev.filter(candidate => candidate.id !== id));
    setDeletedChecklistItem({ item, index });
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setDeletedChecklistItem(null), 8000);
  };

  const undoRemoveChecklistItem = () => {
    if (!deletedChecklistItem) return;
    const { item, index } = deletedChecklistItem;
    setChecklistItems(prev => {
      const next = prev.slice();
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });
    setDeletedChecklistItem(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  };

  useEffect(() => () => { if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current); }, []);

  return (
    <div className="accounting-hub-container">
      <div className="hub-header">
        <h1>Accounting Research Hub</h1>
        <p>Research actual filing practice, find early adopters, filter by auditor, and turn disclosure search results into something your team can use.</p>
      </div>

      <div className="hub-layout">
        <aside className="hub-sidebar glass-card">
          <nav className="hub-nav" aria-label="Accounting Research sections">
            <button type="button" aria-pressed={activeTab === 'research'} className={`nav-btn ${activeTab === 'research' ? 'active' : ''}`} onClick={() => setActiveTab('research')}>
              <Building2 size={18} /> Filing Research
            </button>
            <button type="button" aria-pressed={activeTab === 'standards'} className={`nav-btn ${activeTab === 'standards' ? 'active' : ''}`} onClick={() => setActiveTab('standards')}>
              <BookOpen size={18} /> Standards Directory
            </button>
            <button type="button" aria-pressed={activeTab === 'checklist'} className={`nav-btn ${activeTab === 'checklist' ? 'active' : ''}`} onClick={() => setActiveTab('checklist')}>
              <CheckSquare size={18} /> Review Checklist
            </button>
            <button type="button" aria-pressed={activeTab === 'ai'} className={`nav-btn ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveTab('ai')}>
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

        <section className="hub-main glass-card">
          {activeTab === 'research' && (
            <div className="tab-pane fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h2>Early Adoption & Policy Research</h2>
                  <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0', maxWidth: '900px' }}>
                    Search for how companies are actually addressing a standard in their filings, benchmark disclosure language across peers, and save alerts for future filings.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    aria-pressed={researchMode === 'semantic'}
                    className={`secondary-btn ${researchMode === 'semantic' ? 'active' : ''}`}
                    onClick={() => setResearchMode('semantic')}
                    style={{ borderColor: researchMode === 'semantic' ? 'var(--accent-primary)' : undefined }}
                  >
                    Filing Research
                  </button>
                  <button
                    type="button"
                    aria-pressed={researchMode === 'boolean'}
                    className={`secondary-btn ${researchMode === 'boolean' ? 'active' : ''}`}
                    onClick={() => setResearchMode('boolean')}
                    style={{ borderColor: researchMode === 'boolean' ? 'var(--accent-primary)' : undefined }}
                  >
                    Boolean / w/#
                  </button>
                </div>
              </div>

              <form onSubmit={event => { event.preventDefault(); void runResearch(); }} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', padding: '12px 14px' }}>
                  <Search size={16} style={{ color: 'var(--text-muted)' }} />
                  <input
                    value={researchQuery}
                    onChange={event => setResearchQuery(event.target.value)}
                    aria-label="Accounting disclosure research query"
                    placeholder='Try "ASU 2023-09", DISE, or ASC 842 adoption w/10 lease'
                    style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.92rem' }}
                  />
                </div>
                <button type="submit" className="primary-btn" disabled={researchLoading}>
                  {researchLoading ? <Loader2 size={16} className="spinner" /> : <Search size={16} />} Search
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleSaveAlert}
                  disabled={!hasResearchSearchCriteria(researchQuery, researchFilters)}
                >
                  <BellRing size={16} /> Save Alert
                </button>
                <button type="button" className="secondary-btn" onClick={() => void handleGenerateMemo()} disabled={researchResults.length === 0 || researchMemoLoading}>
                  {researchMemoLoading ? <Loader2 size={16} className="spinner" /> : <Sparkles size={16} />} Generate Memo
                </button>
              </form>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {ADOPTION_SEARCHES.map(sample => (
                  <button
                    type="button"
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
                  showAccountingFramework: true,
                  formTypeOptions: ['10-K', '10-Q', '20-F', '8-K', 'S-1'],
                }}
                filters={researchFilters}
                onChange={setResearchFilters}
                onSearch={() => void runResearch()}
                loading={researchLoading}
              />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div className="glass-card" style={{ padding: '14px' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' }}>Matched Filings</div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 700 }}>{researchResults.length}</div>
                </div>
                <div className="glass-card" style={{ padding: '14px' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' }}>Issuers</div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.6rem', fontWeight: 700 }}>{researchMetrics.issuers}</div>
                </div>
                <div className="glass-card" style={{ padding: '14px' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase' }}>Top Auditor</div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 600 }}>{researchMetrics.topAuditor}</div>
                </div>
              </div>

              {alertMessage && (
                <div role="status" style={{ padding: '10px 12px', borderRadius: '4px', border: '1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)', background: 'color-mix(in srgb, var(--accent-primary) 8%, var(--surface-panel))', color: 'var(--text-primary)' }}>
                  {alertMessage}
                </div>
              )}

              <SearchIntegrityNotice integrity={integrity} resultCount={researchResults.length} />

              {researchError && (
                <div role="alert" style={{ padding: '10px 12px', borderRadius: '4px', border: '1px solid color-mix(in srgb, var(--status-error) 30%, transparent)', background: 'var(--status-error-bg)', color: 'var(--status-error)' }}>
                  {researchError}
                </div>
              )}

              {researchMemoError && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '10px 12px', borderRadius: '4px', border: '1px solid color-mix(in srgb, var(--status-error) 30%, transparent)', background: 'var(--status-error-bg)', color: 'var(--status-error)' }}>
                  <span>{researchMemoError}</span>
                  <button type="button" className="secondary-btn" onClick={() => void handleGenerateMemo()}>Retry memo</button>
                </div>
              )}

              {(researchMemo || researchMemoLoading) && (
                <div style={{ borderLeft: '4px solid var(--accent-primary)', background: 'var(--surface-subtle)', borderRadius: '4px', padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <Sparkles size={18} style={{ color: 'var(--accent-primary)' }} />
                    <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1rem' }}>Accounting Research Memo</h3>
                  </div>
                  {researchMemoLoading ? (
                    <div role="status" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                  rowKey={row => row.id}
                />
              </div>
            </div>
          )}

          {activeTab === 'standards' && (
            <div className="tab-pane fade-in">
              <div className="pane-header">
                <h2>Curated ASC Topic Directory</h2>
                <div className="search-bar">
                  <Search size={16} className="search-icon" />
                  <label className="sr-only" htmlFor="standards-directory-search">Search accounting standards topics</label>
                  <input
                    id="standards-directory-search"
                    type="search"
                    value={standardsQuery}
                    onChange={event => setStandardsQuery(event.target.value)}
                    placeholder="Search topic number or name..."
                  />
                </div>
              </div>

              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.6 }}>
                Browse a curated set of frequently researched Codification topics. For complete and authoritative coverage,{' '}
                <a href={FASB_CODIFICATION_URL} target="_blank" rel="noopener noreferrer">open the full FASB Accounting Standards Codification</a>.
              </p>

              <div className="topics-grid">
                {filteredFasbTopics.map(topic => (
                  <a
                    key={topic.id}
                    href={ascTopicUrl(topic.id)}
                    target="_blank"
                    rel="noopener noreferrer"
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
                {filteredFasbTopics.length === 0 && (
                  <div className="accounting-empty-state" role="status">
                    <p>“{standardsQuery}” is not in this curated directory.</p>
                    <a href={FASB_CODIFICATION_URL} target="_blank" rel="noopener noreferrer">Search the full FASB Codification</a>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'checklist' && (
            <div className="tab-pane fade-in">
              <div className="pane-header flex justify-between items-center">
                <h2>Technical Accounting Review Checklist</h2>
                <button
                  type="button"
                  className="primary-btn sm"
                  onClick={() => setAddingChecklistItem(true)}
                >
                  + New Item
                </button>
              </div>

              {addingChecklistItem && (
                <form className="checklist-editor" onSubmit={addChecklistItem}>
                  <label htmlFor="new-checklist-item">New review item</label>
                  <input
                    id="new-checklist-item"
                    autoFocus
                    value={newChecklistText}
                    onChange={event => setNewChecklistText(event.target.value)}
                    placeholder="Describe the review step"
                  />
                  <button type="submit" className="primary-btn sm" disabled={!newChecklistText.trim()}>Add</button>
                  <button type="button" className="secondary-btn" onClick={() => { setAddingChecklistItem(false); setNewChecklistText(''); }}>Cancel</button>
                </form>
              )}

              <div className="checklist-container mt-6">
                <div className="checklist-header">
                  <h3>Quarter-End Research Review</h3>
                  <span className="progress-text">{checklistItems.filter(item => item.done).length} / {checklistItems.length} Completed</span>
                </div>

                <ul className="checklist-items">
                  {checklistItems.map(item => (
                    <li key={item.id} className={`checklist-item ${item.done ? 'completed' : ''}`}>
                      <label className="checkbox-wrap">
                        <input aria-label={`Mark ${item.text} ${item.done ? 'incomplete' : 'complete'}`} type="checkbox" checked={item.done} onChange={() => toggleChecklist(item.id)} />
                        <span className="checkbox-custom"></span>
                      </label>
                      {editingChecklistId === item.id ? (
                        <div className="checklist-inline-editor">
                          <label className="sr-only" htmlFor={`edit-checklist-${item.id}`}>Edit review item</label>
                          <input
                            id={`edit-checklist-${item.id}`}
                            autoFocus
                            value={editingChecklistText}
                            onChange={event => setEditingChecklistText(event.target.value)}
                            onKeyDown={event => {
                              if (event.key === 'Enter') saveChecklistEdit(item.id);
                              if (event.key === 'Escape') setEditingChecklistId(null);
                            }}
                          />
                          <button type="button" className="secondary-btn" onClick={() => saveChecklistEdit(item.id)} disabled={!editingChecklistText.trim()}>Save</button>
                          <button type="button" className="secondary-btn" onClick={() => setEditingChecklistId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <span className="item-text">{item.text}</span>
                      )}
                      <div className="checklist-item-actions">
                        <button type="button" className="icon-btn" aria-label={`Edit ${item.text}`} onClick={() => { setEditingChecklistId(item.id); setEditingChecklistText(item.text); }}><Pencil size={16} /></button>
                        <button type="button" className="icon-btn" aria-label={`Delete ${item.text}`} onClick={() => removeChecklistItem(item.id)}><Trash2 size={16} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
                {deletedChecklistItem && (
                  <div role="status" className="checklist-undo-bar">
                    <span>Removed “{deletedChecklistItem.item.text}”.</span>
                    <button type="button" className="secondary-btn sm" onClick={undoRemoveChecklistItem}>Undo</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="tab-pane fade-in ai-pane">
              <div className="ai-intro text-center py-8">
                <Sparkles size={24} style={{ color: 'var(--accent-primary)', margin: '0 auto 12px' }} />
                <h2>Ask AI for Accounting Guidance</h2>
                <p className="text-muted max-w-lg mx-auto">Describe the transaction, accounting issue, or disclosure question and get a fast ASC-oriented starting point.</p>
              </div>

              <div className="ai-chat-area">
                {aiError && (
                  <div role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px 14px', borderRadius: '4px', border: '1px solid color-mix(in srgb, var(--status-error) 30%, transparent)', background: 'var(--status-error-bg)', color: 'var(--status-error)' }}>
                    <span>{aiError}</span>
                    <button type="button" className="secondary-btn" onClick={() => void submitAscLookup()} disabled={isAiLoading}>Retry guidance</button>
                  </div>
                )}

                {aiResponse && (
                  <div className="ai-response-box">
                    <div className="ai-avatar">AI</div>
                    <div className="ai-text md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiResponse) }} />
                  </div>
                )}

                {isAiLoading && (
                  <div className="ai-response-box loading text-muted" role="status">
                    <Loader2 size={18} className="spinner inline mr-2" /> Connecting to technical accounting guidance...
                  </div>
                )}
              </div>

              <form className="ai-input-form" onSubmit={handleAiSubmit}>
                <input
                  type="text"
                  className="ai-input"
                  aria-label="Technical accounting guidance question"
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
        </section>
      </div>
    </div>
  );
}
