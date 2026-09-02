'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

import { Mail, Search, Loader2, ExternalLink, MessageSquare, ChevronDown, ChevronRight, X } from 'lucide-react';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import CiteButton from '../components/memo/CiteButton';
import { useApp } from '../context/AppState';
import {
  BROWSE_PAGE_SIZE,
  DEEP_LINK_BROWSE_PAGE_SIZE,
  EPISODE_NOUN,
  MATCH_NOUN,
  SEARCH_PAGE_SIZE,
  SEARCH_POOL_DEPTH,
  appendPagedList,
  companyScopeFromSelection,
  companyScopeFromText,
  companyScopeFromUrl,
  companyScopeText,
  describeCompanyScope,
  describeRemaining,
  describeShown,
  emptyPagedList,
  letterBrowseParams,
  letterSearchParams,
  pagingStatus,
  startPagedList,
  type CompanyScope,
  type LetterFormFilter,
  type LetterSearchCriteria,
  type PagedList,
  type PagingStatus,
} from '../domain/commentLetterPaging';

/** Topic-first entry points — accountants start from an issue, not a query.
 *  Each chip fires a tuned full-text query over the letter corpus. */
const TOPIC_CHIPS: Array<{ label: string; query: string }> = [
  { label: 'Revenue (ASC 606)', query: 'revenue recognition performance obligation principal agent' },
  { label: 'Segments (ASC 280)', query: 'segment reporting CODM operating segments' },
  { label: 'ICFR / Material weakness', query: 'material weakness internal control remediation' },
  { label: 'Non-GAAP', query: 'non-GAAP measure prominence reconciliation' },
  { label: 'Goodwill impairment', query: 'goodwill impairment reporting unit fair value' },
  { label: 'Climate', query: 'climate related risks disclosure' },
];

export interface ThreadSummary {
  thread_id: string;
  cik: number;
  company_name: string;
  letters: number;
  uploads: number;
  corresps: number;
  first_letter: string;
  last_letter: string;
}

export interface ThreadLetter {
  accession: string;
  cik: number;
  company_name: string;
  form: string;
  date_filed: string;
  filename: string;
  has_text: boolean;
  preview: string;
}

export function summarizeThreadLetters(threadId: string, letters: ThreadLetter[]): ThreadSummary | null {
  if (letters.length === 0) return null;
  const dates = letters.map(letter => letter.date_filed).filter(Boolean).sort();
  const first = letters[0];
  return {
    thread_id: threadId,
    cik: first.cik,
    company_name: first.company_name,
    letters: letters.length,
    uploads: letters.filter(letter => letter.form === 'UPLOAD').length,
    corresps: letters.filter(letter => letter.form === 'CORRESP').length,
    first_letter: dates[0] || '',
    last_letter: dates[dates.length - 1] || '',
  };
}

export function mergeRequestedThreadLookup(
  requestedThreadId: string,
  browseThreads: ThreadSummary[],
  requestedSummary: ThreadSummary | null,
  lookupFailed: boolean
): { threads: ThreadSummary[]; error: string; retryable: boolean } {
  const threads = [...browseThreads];
  if (requestedSummary && !threads.some(thread => thread.thread_id === requestedSummary.thread_id)) {
    threads.unshift(requestedSummary);
  }

  if (!requestedThreadId || threads.some(thread => thread.thread_id === requestedThreadId)) {
    return { threads, error: '', retryable: false };
  }
  if (lookupFailed) {
    return {
      threads,
      error: 'The requested review episode could not be loaded. Retry the comment-letter lookup.',
      retryable: true,
    };
  }
  return {
    threads,
    error: 'The requested review episode could not be found in the current comment-letter corpus.',
    retryable: false,
  };
}

interface SearchMatch {
  accession: string;
  cik: number;
  company_name: string;
  form: string;
  date_filed: string;
  thread_id: string;
  filename: string;
  headline: string;
  rank: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '11px 12px',
};

/**
 * Letters filed as PDFs are uuencoded inside the raw .txt submission file, so
 * linking it shows gibberish. The filing index page lists the actual letter
 * document (PDF or HTML) for native viewing.
 */
function edgarLetterIndexUrl(cik: number | string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`;
}

/** ts_headline emits only <b> tags; letter text itself was tag-stripped at
 *  ingest. Escape everything, then re-enable the highlight markers. */
function renderHeadline(headline: string): { __html: string } {
  const escaped = headline
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return {
    __html: escaped
      .replace(/&lt;b&gt;/g, '<mark style="background:var(--interactive-hover-strong);color:var(--accent-primary);padding:0 2px;border-radius:2px;">')
      .replace(/&lt;\/b&gt;/g, '</mark>'),
  };
}

function FormBadge({ form }: { form: string }) {
  const isStaff = form === 'UPLOAD';
  return (
    <span style={{
      fontSize: '0.7rem',
      color: isStaff ? 'var(--status-warning)' : 'var(--status-success)',
      background: isStaff
        ? 'color-mix(in srgb, var(--status-warning) 14%, transparent)'
        : 'color-mix(in srgb, var(--status-success) 14%, transparent)',
      padding: '1px 6px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
    }}>
      {isStaff ? 'SEC Staff' : 'Company response'}
    </span>
  );
}

interface ThreadSummaryPayload {
  summary: string;
  model: string | null;
  generatedAt: string | null;
  coverage?: {
    totalLetters: number;
    lettersWithText: number;
    lettersRepresented: number;
    truncatedLetters: number;
    missingTextLetters: number;
    omittedLetters: number;
    method: string;
    evidenceFingerprint?: string;
  } | null;
}

type SummaryState = ThreadSummaryPayload | 'checking' | 'generating' | 'not-generated' | 'error' | null;

export function ThreadConversation({ threadId }: { threadId: string }) {
  const [letters, setLetters] = useState<ThreadLetter[] | null>(null);
  const [aiSummary, setAiSummary] = useState<SummaryState>(null);
  const [summaryError, setSummaryError] = useState('');
  const [summaryErrorPhase, setSummaryErrorPhase] = useState<'lookup' | 'generation'>('lookup');
  const [summaryReloadKey, setSummaryReloadKey] = useState(0);
  const [lettersError, setLettersError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLetters(null);
    setLettersError('');
    fetch(`/api/letters?thread=${encodeURIComponent(threadId)}`)
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(payload => { if (!cancelled) setLetters(payload.letters ?? []); })
      .catch(() => { if (!cancelled) { setLetters([]); setLettersError('This letter conversation could not be loaded from the corpus.'); } });
    return () => { cancelled = true; };
  }, [reloadKey, threadId]);

  useEffect(() => {
    let cancelled = false;
    setAiSummary('checking');
    setSummaryError('');
    fetch(`/api/letters/summary?thread=${encodeURIComponent(threadId)}`)
      .then(async response => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(payload => {
        if (cancelled) return;
        if (payload?.summary) {
          setAiSummary({ summary: payload.summary, model: payload.model ?? null, generatedAt: payload.generatedAt ?? null, coverage: payload.coverage ?? null });
        } else {
          setAiSummary('not-generated');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummaryErrorPhase('lookup');
          setSummaryError('The cached-summary lookup failed. No AI generation was started.');
          setAiSummary('error');
        }
      });
    return () => { cancelled = true; };
  }, [summaryReloadKey, threadId]);

  const generateSummary = useCallback(async () => {
    setAiSummary('generating');
    setSummaryError('');
    try {
      const response = await fetch(`/api/letters/summary?thread=${encodeURIComponent(threadId)}`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.summary) {
        throw new Error(payload?.error || String(response.status));
      }
      setAiSummary({
        summary: payload.summary,
        model: payload.model ?? null,
        generatedAt: payload.generatedAt ?? null,
        coverage: payload.coverage ?? null,
      });
    } catch (error) {
      setSummaryErrorPhase('generation');
      setSummaryError(error instanceof Error && error.message
        ? `AI summary generation failed: ${error.message}`
        : 'AI summary generation failed.');
      setAiSummary('error');
    }
  }, [threadId]);

  if (letters === null) {
    return <div style={{ padding: '10px 12px', color: 'var(--text-muted)' }}><Loader2 size={16} className="spinner" /> Loading conversation…</div>;
  }

  if (lettersError) {
    return (
      <div role="alert" style={{ ...cardStyle, marginTop: '6px', color: 'var(--status-error)', background: 'var(--status-error-bg)' }}>
        <p>{lettersError}</p>
        <button type="button" className="secondary-btn" onClick={() => setReloadKey(key => key + 1)}>Retry conversation</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 0 2px' }}>
      {aiSummary === 'checking' ? (
        <div style={{ ...cardStyle, padding: '9px 11px', color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Loader2 size={14} className="spinner" /> Checking for a cached review summary…
        </div>
      ) : aiSummary === 'generating' ? (
        <div role="status" style={{ ...cardStyle, padding: '9px 11px', color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Loader2 size={14} className="spinner" /> Generating the AI review summary from the source letters…
        </div>
      ) : aiSummary && typeof aiSummary === 'object' ? (
        <div style={{ ...cardStyle, padding: '10px 12px', borderLeft: '3px solid var(--accent-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-soft)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Review summary
            </span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              AI-generated{aiSummary.model ? ` · ${aiSummary.model}` : ''}{aiSummary.generatedAt ? ` · ${aiSummary.generatedAt.slice(0, 10)}` : ''} · verify against the letters below
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, whiteSpace: 'pre-line' }}>
            {aiSummary.summary.replace(/\*\*/g, '')}
          </div>
          {aiSummary.coverage && (
            <div style={{ marginTop: '6px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {aiSummary.coverage.lettersRepresented}/{aiSummary.coverage.totalLetters} letters represented · {aiSummary.coverage.lettersWithText} with extracted text
              {aiSummary.coverage.truncatedLetters > 0 ? ` · ${aiSummary.coverage.truncatedLetters} long letters excerpted from opening and closing` : ''}
              {aiSummary.coverage.missingTextLetters > 0 ? ` · ${aiSummary.coverage.missingTextLetters} unavailable` : ''}
              {aiSummary.coverage.omittedLetters > 0 ? ` · ${aiSummary.coverage.omittedLetters} letters omitted` : ' · no letters omitted'}
            </div>
          )}
        </div>
      ) : aiSummary === 'not-generated' ? (
        <div style={{ ...cardStyle, padding: '9px 11px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
          <p style={{ marginTop: 0 }}>No current cached AI summary exists. Generating one uses AI capacity and summarizes the extracted source-letter evidence.</p>
          <button type="button" className="secondary-btn" onClick={() => void generateSummary()}>Generate AI summary</button>
        </div>
      ) : aiSummary === 'error' ? (
        <div role="alert" style={{ ...cardStyle, padding: '9px 11px', color: 'var(--status-error)', background: 'var(--status-error-bg)', fontSize: '0.78rem' }}>
          <p>{summaryError}</p>
          {summaryErrorPhase === 'lookup' ? (
            <button type="button" className="secondary-btn" onClick={() => setSummaryReloadKey(key => key + 1)}>Retry cached-summary lookup</button>
          ) : (
            <button type="button" className="secondary-btn" onClick={() => void generateSummary()}>Retry AI summary</button>
          )}
        </div>
      ) : null}
      {letters.map(letter => (
        <div key={`${letter.accession}:${letter.form}`} style={{
          ...cardStyle,
          padding: '9px 11px',
          marginLeft: letter.form === 'UPLOAD' ? 0 : '20px',
          borderLeft: letter.form === 'UPLOAD'
            ? '3px solid color-mix(in srgb, var(--status-warning) 55%, transparent)'
            : '3px solid color-mix(in srgb, var(--status-success) 55%, transparent)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FormBadge form={letter.form} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{letter.date_filed}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CiteButton
                compact
                citation={{
                  kind: 'letter',
                  cik: String(letter.cik),
                  accessionNumber: letter.accession,
                  company: letter.company_name,
                  form: letter.form,
                  fileDate: letter.date_filed,
                  excerpt: letter.has_text ? letter.preview.slice(0, 400) : '',
                  sourceUrl: edgarLetterIndexUrl(letter.cik, letter.accession),
                }}
              />
              <a href={edgarLetterIndexUrl(letter.cik, letter.accession)} target="_blank" rel="noreferrer"
                style={{ color: 'var(--accent-primary)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Full letter <ExternalLink size={11} />
              </a>
            </div>
          </div>
          {letter.has_text ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.42, whiteSpace: 'pre-line' }}>
              {letter.preview}{letter.preview.length >= 700 ? '…' : ''}
            </div>
          ) : (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Text not yet extracted for this letter — open the full letter on EDGAR.
            </div>
          )}
        </div>
      ))}
      {letters.length > 0 && (
        <div style={{ paddingTop: '2px' }}>
          <AskCopilotButton
            prompt={`Summarize this SEC comment-letter conversation for ${letters[0].company_name}: what did the Staff challenge, how did the company respond, and how was it resolved?\n\nThe letters, in order:\n\n${letters
              .map(letter => `--- ${letter.form === 'UPLOAD' ? 'SEC STAFF LETTER' : 'COMPANY RESPONSE'} (${letter.date_filed}) ---\n${letter.has_text ? letter.preview : '[text not yet extracted]'}`)
              .join('\n\n')}\n\nGround the summary strictly in the letter excerpts above; note that excerpts are truncated.`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The control beneath a list: Load more while the server has rows to give,
 * otherwise the reason it cannot — the header above never claims rows that
 * are not on screen, and this explains the gap.
 */
function LoadMoreControls({ status, label, loading, error, remaining, cappedNote, onLoadMore }: {
  status: PagingStatus;
  label: string;
  loading: boolean;
  error: string;
  remaining: string;
  cappedNote: string;
  onLoadMore: () => void;
}) {
  if (status === 'complete') return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start', marginTop: '8px' }}>
      {status === 'more' && (
        <button type="button" className="secondary-btn" onClick={onLoadMore} disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          {loading && <Loader2 size={13} className="spinner" />} {label}
        </button>
      )}
      {status === 'capped' && (
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{cappedNote}</p>
      )}
      {status === 'exhausted' && (
        <p role="status" style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          The corpus returned no further rows for this scope although its total reports {remaining}; the total may have changed since the first page. Rerun to refresh.
        </p>
      )}
      {error && <p role="alert" style={{ margin: 0, fontSize: '0.76rem', color: 'var(--status-error)' }}>{error}</p>}
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '3px 8px',
  borderRadius: '4px',
  fontSize: '0.76rem',
  color: 'var(--accent-primary)',
  background: 'var(--interactive-hover-strong)',
  border: '1px solid var(--accent-primary)',
};

export default function CommentLetters() {
  const { pendingSearchIntent, setPendingSearchIntent } = useApp();
  const searchParams = useSearchParams();
  const requestedCompany = searchParams?.get('company') || '';
  const requestedCik = searchParams?.get('cik') || '';
  const requestedThreadId = searchParams?.get('thread') || searchParams?.get('thread_id') || '';
  const requestedScopeKey = `${requestedCik} ${requestedCompany}`;
  const [keyword, setKeyword] = useState('');
  const [companyScope, setCompanyScope] = useState<CompanyScope | null>(
    () => companyScopeFromUrl(requestedCompany, requestedCik)
  );
  // A deep link that changes while mounted (one dossier's episode, then
  // another's) replaces the scope once; everything typed afterwards is the
  // reader's. Mirroring the URL on every render made the box untypable.
  const [appliedScopeKey, setAppliedScopeKey] = useState(requestedScopeKey);
  if (appliedScopeKey !== requestedScopeKey) {
    setAppliedScopeKey(requestedScopeKey);
    setCompanyScope(companyScopeFromUrl(requestedCompany, requestedCik));
  }
  const [formFilter, setFormFilter] = useState<LetterFormFilter>('');
  const [threadPage, setThreadPage] = useState<PagedList<ThreadSummary>>(emptyPagedList);
  const [matchPage, setMatchPage] = useState<PagedList<SearchMatch>>(emptyPagedList);
  // The criteria the visible matches were fetched with — Load more must page
  // that search, not whatever the inputs say now.
  const [activeSearch, setActiveSearch] = useState<LetterSearchCriteria | null>(null);
  const [loading, setLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [loadingMoreMatches, setLoadingMoreMatches] = useState(false);
  const [threadPageError, setThreadPageError] = useState('');
  const [matchPageError, setMatchPageError] = useState('');
  const [searched, setSearched] = useState(false);
  const [expandedThread, setExpandedThread] = useState<string | null>(() => requestedThreadId || null);
  // Search results can contain several letters from the same review thread.
  // Track the activated row as well as its thread so expanding one match does
  // not duplicate the complete conversation beneath every sibling match.
  const [expandedSearchMatch, setExpandedSearchMatch] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [browseReloadKey, setBrowseReloadKey] = useState(0);
  const [searchError, setSearchError] = useState('');
  const [requestedThreadError, setRequestedThreadError] = useState('');
  const [requestedThreadLookupFailed, setRequestedThreadLookupFailed] = useState(false);
  // A page appended after the list it belongs to was replaced (scope changed,
  // search rerun) would splice stale rows into the new list; each list
  // generation only accepts its own responses.
  const browseGeneration = useRef(0);
  const searchGeneration = useRef(0);
  const [letterStats, setLetterStats] = useState<{
    count: number;
    withText: number;
    through: string | null;
    lastTextFetch: string | null;
    retryPending: number;
  } | null>(null);

  const browsePageSize = requestedThreadId ? DEEP_LINK_BROWSE_PAGE_SIZE : BROWSE_PAGE_SIZE;
  const browseScopeKey = letterBrowseParams(companyScope, { from: 0, size: browsePageSize }).toString();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(payload => { if (!cancelled) setLetterStats(payload.letters ?? null); })
      .catch(() => { if (!cancelled) setLetterStats(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    browseGeneration.current += 1;
    setBrowseLoading(true);
    setUnavailable(false);
    setThreadPageError('');
    setRequestedThreadError('');
    setRequestedThreadLookupFailed(false);
    const browseRequest = fetch(`/api/letters?${browseScopeKey}`).then(response => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    });
    const requestedThreadRequest = requestedThreadId
      ? fetch(`/api/letters?thread=${encodeURIComponent(requestedThreadId)}`)
          .then(response => {
            if (!response.ok) throw new Error(String(response.status));
            return response.json() as Promise<{ letters?: ThreadLetter[] }>;
          })
          .then(payload => ({
            summary: summarizeThreadLetters(requestedThreadId, payload.letters ?? []),
            failed: false,
          }))
          .catch(() => ({ summary: null, failed: true }))
      : Promise.resolve({ summary: null, failed: false });

    Promise.all([browseRequest, requestedThreadRequest])
      .then(([payload, requestedLookup]) => {
        if (cancelled) return;
        const rows = (payload.threads ?? []) as ThreadSummary[];
        const merged = mergeRequestedThreadLookup(
          requestedThreadId,
          rows,
          requestedLookup.summary,
          requestedLookup.failed
        );
        setRequestedThreadError(merged.error);
        setRequestedThreadLookupFailed(merged.retryable);
        setThreadPage(startPagedList({ items: merged.threads, fetched: rows.length, total: payload.total ?? 0 }));
      })
      .catch(() => { if (!cancelled) setUnavailable(true); })
      .finally(() => { if (!cancelled) setBrowseLoading(false); });
    return () => { cancelled = true; };
  }, [browseReloadKey, browseScopeKey, requestedThreadId]);

  const loadMoreThreads = useCallback(async () => {
    const generation = browseGeneration.current;
    setLoadingMoreThreads(true);
    setThreadPageError('');
    try {
      const params = letterBrowseParams(companyScope, { from: threadPage.fetched, size: browsePageSize });
      const response = await fetch(`/api/letters?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      if (generation !== browseGeneration.current) return;
      setThreadPage(current => appendPagedList(
        current,
        { items: (payload.threads ?? []) as ThreadSummary[], total: payload.total ?? 0 },
        thread => thread.thread_id
      ));
    } catch {
      if (generation === browseGeneration.current) {
        setThreadPageError('The next page of review episodes could not be loaded. The episodes above are unchanged.');
      }
    } finally {
      if (generation === browseGeneration.current) setLoadingMoreThreads(false);
    }
  }, [browsePageSize, companyScope, threadPage.fetched]);

  useEffect(() => {
    if (!requestedThreadId || !threadPage.items.some(thread => thread.thread_id === requestedThreadId)) return;
    setExpandedThread(requestedThreadId);
    setExpandedSearchMatch(null);
    window.requestAnimationFrame(() => {
      document.getElementById(`thread-card-${requestedThreadId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [requestedThreadId, threadPage.items]);

  const runSearch = useCallback(async (query: string, form: LetterFormFilter, scope: CompanyScope | null) => {
    const trimmed = query.trim();
    if (!trimmed && !scope) return;
    setLoading(true);
    setSearchError('');
    setMatchPageError('');
    setSearched(Boolean(trimmed));
    setExpandedThread(null);
    setExpandedSearchMatch(null);
    if (!trimmed) { setLoading(false); return; } // company-only filters the browse list via effect
    searchGeneration.current += 1;
    const generation = searchGeneration.current;
    const criteria: LetterSearchCriteria = { query: trimmed, form, scope };
    setActiveSearch(criteria);
    try {
      const params = letterSearchParams(criteria, { from: 0, size: SEARCH_PAGE_SIZE });
      const response = await fetch(`/api/letters?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      if (generation !== searchGeneration.current) return;
      setMatchPage(startPagedList({
        items: (payload.matches ?? []) as SearchMatch[],
        total: payload.total ?? 0,
        totalIsFloor: Boolean(payload.totalIsFloor),
      }));
    } catch {
      if (generation !== searchGeneration.current) return;
      setMatchPage(emptyPagedList());
      setSearchError('The full-text letter search failed. The zero-result state is not authoritative.');
    } finally {
      if (generation === searchGeneration.current) setLoading(false);
    }
  }, []);

  const loadMoreMatches = useCallback(async () => {
    if (!activeSearch) return;
    const generation = searchGeneration.current;
    setLoadingMoreMatches(true);
    setMatchPageError('');
    try {
      const params = letterSearchParams(activeSearch, { from: matchPage.fetched, size: SEARCH_PAGE_SIZE });
      const response = await fetch(`/api/letters?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      if (generation !== searchGeneration.current) return;
      setMatchPage(current => appendPagedList(
        current,
        {
          items: (payload.matches ?? []) as SearchMatch[],
          total: payload.total ?? 0,
          totalIsFloor: Boolean(payload.totalIsFloor),
        },
        match => `${match.accession}:${match.cik}`
      ));
    } catch {
      if (generation === searchGeneration.current) {
        setMatchPageError('The next page of matches could not be loaded. The matches above are unchanged.');
      }
    } finally {
      if (generation === searchGeneration.current) setLoadingMoreMatches(false);
    }
  }, [activeSearch, matchPage.fetched]);

  useEffect(() => {
    if (!pendingSearchIntent || pendingSearchIntent.surface !== 'comment-letters') return;
    // An intent from another surface is a fresh search: the visible criteria
    // are reset to match what actually ran.
    setKeyword(pendingSearchIntent.query);
    setFormFilter('');
    setCompanyScope(null);
    runSearch(pendingSearchIntent.query, '', null);
    setPendingSearchIntent(null);
  }, [pendingSearchIntent, runSearch, setPendingSearchIntent]);

  const clearCompanyScope = useCallback(() => {
    setCompanyScope(null);
    if (searched && keyword.trim()) runSearch(keyword, formFilter, null);
  }, [formFilter, keyword, runSearch, searched]);

  const matches = matchPage.items;
  const threads = threadPage.items;
  const showBrowse = !searched || (!loading && matches.length === 0 && !keyword.trim());
  const matchStatus = pagingStatus(matchPage, SEARCH_POOL_DEPTH);
  const threadStatus = pagingStatus(threadPage);

  return (
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <Mail size={24} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>Comment Letters</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '0.86rem' }}>
        SEC review conversations since 2005 — Staff letters (UPLOAD) threaded with company responses
        (CORRESP), full-text searchable.
      </p>

      {letterStats && (
        <div style={{ ...cardStyle, marginBottom: '10px', padding: '8px 12px', borderLeft: '3px solid var(--accent-primary)' }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 650, fontSize: '0.86rem' }}>
            {letterStats.withText.toLocaleString()} of {letterStats.count.toLocaleString()} letters searchable
            {letterStats.count > 0 ? ` (${((letterStats.withText / letterStats.count) * 100).toFixed(2)}%)` : ''}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>
            Metadata through {letterStats.through || 'unknown'} · last successful text extraction {letterStats.lastTextFetch ? new Date(letterStats.lastTextFetch).toLocaleString() : 'not reported'}
            {letterStats.retryPending > 0 ? ` · ${letterStats.retryPending.toLocaleString()} transient fetch failures queued for retry` : ''}
          </div>
        </div>
      )}

      {unavailable && (
        <div role="alert" style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--status-warning) 40%, transparent)', color: 'var(--status-warning)', fontSize: '0.85rem', marginBottom: '10px' }}>
          <p>The letter corpus is not reachable right now.</p>
          <button type="button" className="secondary-btn" onClick={() => setBrowseReloadKey(key => key + 1)}>Retry letter corpus</button>
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder='e.g. revenue recognition principal agent, "material weakness", segment reporting'
            aria-label="Search inside SEC comment letters"
            onKeyDown={e => e.key === 'Enter' && runSearch(keyword, formFilter, companyScope)}
            style={{ width: '100%', padding: '7px 10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.84rem', outline: 'none' }} />
        </div>
        <div style={{ minWidth: '200px' }}>
          {/* A suggestion pick resolves the registrant to its CIK, which is
              what the episode list filters by. Typed text that is never
              picked stays a registrant-name match and is labeled as one. */}
          <CompanySearchInput
            selectValue="title"
            initialValue={companyScopeText(companyScope)}
            placeholder="Company name…"
            onTextChange={text => setCompanyScope(current => companyScopeFromText(current, text))}
            onSelect={(title, cik) => {
              const scope = companyScopeFromSelection(title, cik);
              setCompanyScope(scope);
              if (keyword.trim()) runSearch(keyword, formFilter, scope);
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {([['', 'All'], ['UPLOAD', 'Staff letters'], ['CORRESP', 'Responses']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={formFilter === value} onClick={() => { setFormFilter(value); if (searched && (keyword.trim() || companyScope)) runSearch(keyword, value, companyScope); }}
              style={{
                padding: '5px 9px', borderRadius: '4px', fontSize: '0.76rem', cursor: 'pointer',
                border: '1px solid ' + (formFilter === value ? 'var(--accent-primary)' : 'var(--input-border)'),
                background: formFilter === value ? 'var(--interactive-hover-strong)' : 'var(--input-bg)',
                color: formFilter === value ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => runSearch(keyword, formFilter, companyScope)} disabled={loading}
          style={{ padding: '7px 14px', background: 'var(--accent-primary)', color: 'white', border: '1px solid var(--accent-primary)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </div>

      {companyScope?.kind === 'cik' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span style={chipStyle}>
            {companyScope.title} · CIK {companyScope.cik}
            <button type="button" aria-label="Remove company filter" onClick={clearCompanyScope}
              style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        </div>
      )}

      {/* Topic-first entry — fires a tuned corpus query per issue */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {TOPIC_CHIPS.map(chip => (
          <button key={chip.label} type="button"
            onClick={() => { setKeyword(chip.query); runSearch(chip.query, formFilter, companyScope); }}
            style={{
              padding: '4px 8px', borderRadius: '4px', fontSize: '0.73rem', cursor: 'pointer',
              border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-secondary)',
            }}>
            {chip.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
          <Loader2 size={20} className="spinner" style={{ marginBottom: '6px' }} />
          <div>Searching inside letters…</div>
        </div>
      ) : searched && keyword.trim() ? (
        matches.length > 0 ? (
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '6px 0 8px' }}>
              <div>{describeShown(matchPage, MATCH_NOUN)} — ranked by relevance</div>
              {activeSearch?.scope && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginTop: '2px' }}>
                  {describeCompanyScope(activeSearch.scope, 'search')}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {matches.map(match => {
                const matchExpansionKey = `${match.thread_id}:${match.accession}:${match.cik}`;
                const isMatchExpanded = expandedThread === match.thread_id && expandedSearchMatch === matchExpansionKey;
                return (
                  <div key={`${match.accession}:${match.cik}`} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                        <a href={`/company/${match.cik}`} title="Open issuer dossier"
                          style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                          {match.company_name}
                        </a>
                        <FormBadge form={match.form} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{match.date_filed}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <button
                          type="button"
                          aria-expanded={isMatchExpanded}
                          onClick={() => {
                            setExpandedThread(isMatchExpanded ? null : match.thread_id);
                            setExpandedSearchMatch(isMatchExpanded ? null : matchExpansionKey);
                          }}
                          style={{ color: 'var(--accent-primary)', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <MessageSquare size={12} /> {isMatchExpanded ? 'Hide conversation' : 'View conversation'}
                        </button>
                        <a href={edgarLetterIndexUrl(match.cik, match.accession)} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          EDGAR <ExternalLink size={11} />
                        </a>
                        <CiteButton
                          compact
                          citation={{
                            kind: 'letter',
                            cik: String(match.cik),
                            accessionNumber: match.accession,
                            company: match.company_name,
                            form: match.form,
                            fileDate: match.date_filed,
                            excerpt: (match.headline || '').replace(/<\/?b>/g, '').slice(0, 400),
                            sourceUrl: edgarLetterIndexUrl(match.cik, match.accession),
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}
                      dangerouslySetInnerHTML={renderHeadline(match.headline || '')} />
                    {isMatchExpanded && <ThreadConversation threadId={match.thread_id} />}
                  </div>
                );
              })}
            </div>
            <LoadMoreControls
              status={matchStatus}
              label="Load more matches"
              loading={loadingMoreMatches}
              error={matchPageError}
              remaining={describeRemaining(matchPage, MATCH_NOUN)}
              cappedNote={`The ranked pool covers only the ${SEARCH_POOL_DEPTH.toLocaleString()} most recent matches; ${describeRemaining(matchPage, MATCH_NOUN)} exist beyond it. Narrow the query, company, or form scope to reach them.`}
              onLoadMore={() => void loadMoreMatches()}
            />
          </div>
        ) : (
          <div role={searchError ? 'alert' : undefined} style={{ textAlign: 'center', padding: '28px', color: searchError ? 'var(--status-error)' : 'var(--text-muted)' }}>
            <p>{searchError || 'No searchable letter text matched. Check the corpus coverage above before treating this as no precedent.'}</p>
            {searchError && <button type="button" className="secondary-btn" onClick={() => void runSearch(keyword, formFilter, companyScope)}>Retry letter search</button>}
          </div>
        )
      ) : null}

      {showBrowse && !loading && (
        <div style={{ marginTop: searched ? '6px' : '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <MessageSquare size={16} style={{ color: 'var(--status-warning)' }} />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>Latest review conversations</h2>
            {!browseLoading && !unavailable && threads.length > 0 && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>· {describeShown(threadPage, EPISODE_NOUN)}</span>
            )}
          </div>
          {companyScope && !browseLoading && !unavailable && (
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              {describeCompanyScope(companyScope, 'browse')}
            </div>
          )}
          {browseLoading ? (
            <div role="status" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
              <Loader2 size={18} className="spinner" style={{ marginBottom: '6px' }} /><div>Loading conversations…</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {requestedThreadError && (
                <div role="alert" style={{ ...cardStyle, color: 'var(--status-error)', background: 'var(--status-error-bg)' }}>
                  <p>{requestedThreadError}</p>
                  {requestedThreadLookupFailed && (
                    <button type="button" className="secondary-btn" onClick={() => setBrowseReloadKey(key => key + 1)}>Retry requested episode</button>
                  )}
                </div>
              )}
              {threads.length === 0 && (
                <div role="status" style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No review conversations to show{companyScope ? ' for this company filter — remove it or choose the issuer from the suggestions' : ' yet; the corpus may still be loading'}.
                </div>
              )}
              {threads.map(thread => {
                const days = Math.max(1, Math.round(
                  (Date.parse(thread.last_letter) - Date.parse(thread.first_letter)) / 86_400_000
                ));
                const isLongReview = thread.uploads >= 3;
                return (
                  <div key={thread.thread_id} id={`thread-card-${thread.thread_id}`} style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedThread(expandedThread === thread.thread_id ? null : thread.thread_id);
                          setExpandedSearchMatch(null);
                        }}
                        aria-expanded={expandedThread === thread.thread_id}
                        aria-controls={`thread-${thread.thread_id}`}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', cursor: 'pointer', flexWrap: 'wrap', flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                          {expandedThread === thread.thread_id ? <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />}
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {thread.company_name}
                          </span>
                        {/* Round count is the accountant's severity signal — long
                            contested reviews are the richest precedents */}
                        <span style={{
                          fontSize: '0.69rem', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap',
                          color: isLongReview ? 'var(--accent-primary)' : 'var(--text-muted)',
                          background: isLongReview ? 'var(--interactive-hover-strong)' : 'var(--surface-subtle)',
                        }}>
                          {thread.uploads} round{thread.uploads === 1 ? '' : 's'} · {days}d
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--status-warning)' }}>{thread.uploads} Staff</span>
                        <span style={{ color: 'var(--status-success)' }}>{thread.corresps} response{thread.corresps === 1 ? '' : 's'}</span>
                        <span>{thread.first_letter} → {thread.last_letter}</span>
                        </div>
                      </button>
                      <a href={`/company/${thread.cik}`} aria-label={`Open ${thread.company_name} issuer dossier`} title="Open issuer dossier"
                        style={{ color: 'var(--accent-primary)', display: 'inline-flex', padding: '4px', borderRadius: '4px' }}>
                        <ExternalLink size={14} aria-hidden="true" />
                      </a>
                    </div>
                    {expandedThread === thread.thread_id && <div id={`thread-${thread.thread_id}`}><ThreadConversation threadId={thread.thread_id} /></div>}
                  </div>
                );
              })}
              <LoadMoreControls
                status={threadStatus}
                label="Load more episodes"
                loading={loadingMoreThreads}
                error={threadPageError}
                remaining={describeRemaining(threadPage, EPISODE_NOUN)}
                cappedNote=""
                onLoadMore={() => void loadMoreThreads()}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
