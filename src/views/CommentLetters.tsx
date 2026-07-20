'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

import { Mail, Search, Loader2, ExternalLink, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import CiteButton from '../components/memo/CiteButton';
import { useApp } from '../context/AppState';

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
  background: 'var(--surface-panel)',
  border: '1px solid var(--input-border)',
  borderRadius: '12px',
  padding: '16px',
  transition: 'border-color 0.2s',
};

function edgarUrl(filename: string): string {
  return `https://www.sec.gov/Archives/${filename}`;
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
      .replace(/&lt;b&gt;/g, '<mark style="background:rgba(214,108,174,0.25);color:#F9A8D4;padding:0 2px;border-radius:2px;">')
      .replace(/&lt;\/b&gt;/g, '</mark>'),
  };
}

function FormBadge({ form }: { form: string }) {
  const isStaff = form === 'UPLOAD';
  return (
    <span style={{
      fontSize: '0.7rem',
      color: isStaff ? '#FBBF24' : '#6EE7B7',
      background: isStaff ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
      padding: '2px 8px',
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
    return <div style={{ padding: '16px', color: 'var(--text-muted)' }}><Loader2 size={16} className="spinner" /> Loading conversation…</div>;
  }

  if (lettersError) {
    return (
      <div role="alert" style={{ ...cardStyle, marginTop: '10px', color: '#FCA5A5' }}>
        <p>{lettersError}</p>
        <button type="button" className="secondary-btn" onClick={() => setReloadKey(key => key + 1)}>Retry conversation</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 0 4px' }}>
      {aiSummary === 'checking' ? (
        <div style={{ ...cardStyle, padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Loader2 size={14} className="spinner" /> Checking for a cached review summary…
        </div>
      ) : aiSummary === 'generating' ? (
        <div role="status" style={{ ...cardStyle, padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Loader2 size={14} className="spinner" /> Generating the AI review summary from the source letters…
        </div>
      ) : aiSummary && typeof aiSummary === 'object' ? (
        <div style={{ ...cardStyle, padding: '14px 16px', borderLeft: '3px solid rgba(179,31,126,0.6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-soft)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Review summary
            </span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              AI-generated{aiSummary.model ? ` · ${aiSummary.model}` : ''}{aiSummary.generatedAt ? ` · ${aiSummary.generatedAt.slice(0, 10)}` : ''} · verify against the letters below
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
            {aiSummary.summary.replace(/\*\*/g, '')}
          </div>
          {aiSummary.coverage && (
            <div style={{ marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {aiSummary.coverage.lettersRepresented}/{aiSummary.coverage.totalLetters} letters represented · {aiSummary.coverage.lettersWithText} with extracted text
              {aiSummary.coverage.truncatedLetters > 0 ? ` · ${aiSummary.coverage.truncatedLetters} long letters excerpted from opening and closing` : ''}
              {aiSummary.coverage.missingTextLetters > 0 ? ` · ${aiSummary.coverage.missingTextLetters} unavailable` : ''}
              {aiSummary.coverage.omittedLetters > 0 ? ` · ${aiSummary.coverage.omittedLetters} letters omitted` : ' · no letters omitted'}
            </div>
          )}
        </div>
      ) : aiSummary === 'not-generated' ? (
        <div style={{ ...cardStyle, padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
          <p style={{ marginTop: 0 }}>No current cached AI summary exists. Generating one uses AI capacity and summarizes the extracted source-letter evidence.</p>
          <button type="button" className="secondary-btn" onClick={() => void generateSummary()}>Generate AI summary</button>
        </div>
      ) : aiSummary === 'error' ? (
        <div role="alert" style={{ ...cardStyle, padding: '12px 14px', color: '#FCA5A5', fontSize: '0.78rem' }}>
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
          padding: '12px 14px',
          marginLeft: letter.form === 'UPLOAD' ? 0 : '28px',
          borderLeft: letter.form === 'UPLOAD' ? '3px solid rgba(245,158,11,0.5)' : '3px solid rgba(16,185,129,0.5)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FormBadge form={letter.form} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{letter.date_filed}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                  sourceUrl: edgarUrl(letter.filename),
                }}
              />
              <a href={edgarUrl(letter.filename)} target="_blank" rel="noreferrer"
                style={{ color: '#D66CAE', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Full letter <ExternalLink size={11} />
              </a>
            </div>
          </div>
          {letter.has_text ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
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
        <div style={{ paddingTop: '4px' }}>
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

export default function CommentLetters() {
  const { pendingSearchIntent, setPendingSearchIntent } = useApp();
  const searchParams = useSearchParams();
  const requestedCompany = searchParams?.get('company') || '';
  const requestedThreadId = searchParams?.get('thread') || searchParams?.get('thread_id') || '';
  const [keyword, setKeyword] = useState('');
  const [companyFilter, setCompanyFilter] = useState(() => requestedCompany);
  const [formFilter, setFormFilter] = useState<'' | 'UPLOAD' | 'CORRESP'>('');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [matchesTotal, setMatchesTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [expandedThread, setExpandedThread] = useState<string | null>(() => requestedThreadId || null);
  const [unavailable, setUnavailable] = useState(false);
  const [browseReloadKey, setBrowseReloadKey] = useState(0);
  const [searchError, setSearchError] = useState('');
  const [requestedThreadError, setRequestedThreadError] = useState('');
  const [requestedThreadLookupFailed, setRequestedThreadLookupFailed] = useState(false);
  const [letterStats, setLetterStats] = useState<{
    count: number;
    withText: number;
    through: string | null;
    lastTextFetch: string | null;
    retryPending: number;
  } | null>(null);

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
    setBrowseLoading(true);
    setUnavailable(false);
    setRequestedThreadError('');
    setRequestedThreadLookupFailed(false);
    const params = new URLSearchParams({ size: requestedThreadId ? '25' : '12' });
    if (companyFilter.trim()) params.set('company', companyFilter.trim());
    const browseRequest = fetch(`/api/letters?${params.toString()}`).then(response => {
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
        const merged = mergeRequestedThreadLookup(
          requestedThreadId,
          (payload.threads ?? []) as ThreadSummary[],
          requestedLookup.summary,
          requestedLookup.failed
        );
        setRequestedThreadError(merged.error);
        setRequestedThreadLookupFailed(merged.retryable);
        setThreads(merged.threads);
        setThreadsTotal(Math.max(payload.total ?? 0, merged.threads.length));
      })
      .catch(() => { if (!cancelled) setUnavailable(true); })
      .finally(() => { if (!cancelled) setBrowseLoading(false); });
    return () => { cancelled = true; };
  }, [browseReloadKey, companyFilter, requestedThreadId]);

  useEffect(() => {
    if (requestedCompany !== companyFilter) setCompanyFilter(requestedCompany);
  }, [companyFilter, requestedCompany]);

  useEffect(() => {
    if (!requestedThreadId || !threads.some(thread => thread.thread_id === requestedThreadId)) return;
    setExpandedThread(requestedThreadId);
    window.requestAnimationFrame(() => {
      document.getElementById(`thread-card-${requestedThreadId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [requestedThreadId, threads]);

  const runSearch = useCallback(async (query: string, form: '' | 'UPLOAD' | 'CORRESP', company: string) => {
    if (!query.trim() && !company.trim()) return;
    setLoading(true);
    setSearchError('');
    setSearched(Boolean(query.trim()));
    setExpandedThread(null);
    if (!query.trim()) { setLoading(false); return; } // company-only filters the browse list via effect
    try {
      const params = new URLSearchParams({ q: query.trim(), size: '50' });
      if (form) params.set('form', form);
      if (company.trim()) params.set('company', company.trim());
      const response = await fetch(`/api/letters?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      setMatches(payload.matches ?? []);
      setMatchesTotal(payload.total ?? 0);
    } catch {
      setMatches([]);
      setMatchesTotal(0);
      setSearchError('The full-text letter search failed. The zero-result state is not authoritative.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pendingSearchIntent || pendingSearchIntent.surface !== 'comment-letters') return;
    setKeyword(pendingSearchIntent.query);
    runSearch(pendingSearchIntent.query, '', '');
    setPendingSearchIntent(null);
  }, [pendingSearchIntent, runSearch, setPendingSearchIntent]);

  const showBrowse = !searched || (!loading && matches.length === 0 && !keyword.trim());

  return (
    <div style={{ padding: '32px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <Mail size={28} style={{ color: '#D66CAE' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>Comment Letters</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>
        SEC review conversations since 2005 — Staff letters (UPLOAD) threaded with company responses
        (CORRESP), full-text searchable{threadsTotal > 0 ? ` across ${threadsTotal.toLocaleString()} review episodes` : ''}.
      </p>

      {letterStats && (
        <div style={{ ...cardStyle, marginBottom: '16px', padding: '12px 16px', borderLeft: '3px solid rgba(214,108,174,0.65)' }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 650, fontSize: '0.86rem' }}>
            {letterStats.withText.toLocaleString()} of {letterStats.count.toLocaleString()} letters searchable
            {letterStats.count > 0 ? ` (${((letterStats.withText / letterStats.count) * 100).toFixed(2)}%)` : ''}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '4px' }}>
            Metadata through {letterStats.through || 'unknown'} · last successful text extraction {letterStats.lastTextFetch ? new Date(letterStats.lastTextFetch).toLocaleString() : 'not reported'}
            {letterStats.retryPending > 0 ? ` · ${letterStats.retryPending.toLocaleString()} transient fetch failures queued for retry` : ''}
          </div>
        </div>
      )}

      {unavailable && (
        <div role="alert" style={{ ...cardStyle, borderColor: 'rgba(245,158,11,0.4)', color: '#FBBF24', fontSize: '0.85rem', marginBottom: '16px' }}>
          <p>The letter corpus is not reachable right now.</p>
          <button type="button" className="secondary-btn" onClick={() => setBrowseReloadKey(key => key + 1)}>Retry letter corpus</button>
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder='e.g. revenue recognition principal agent, "material weakness", segment reporting'
            aria-label="Search inside SEC comment letters"
            onKeyDown={e => e.key === 'Enter' && runSearch(keyword, formFilter, companyFilter)}
            style={{ width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <div style={{ minWidth: '220px' }}>
          {/* Letters are keyed by registrant name, so suggestion picks pass
              the company title; free text still filters as typed. */}
          <CompanySearchInput
            selectValue="title"
            initialValue={companyFilter}
            placeholder="Company name…"
            onTextChange={text => setCompanyFilter(text)}
            onSelect={title => {
              setCompanyFilter(title);
              if (keyword.trim()) runSearch(keyword, formFilter, title);
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {([['', 'All'], ['UPLOAD', 'Staff letters'], ['CORRESP', 'Responses']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={formFilter === value} onClick={() => { setFormFilter(value); if (searched && keyword.trim()) runSearch(keyword, value, companyFilter); }}
              style={{
                padding: '7px 12px', borderRadius: '8px', fontSize: '0.78rem', cursor: 'pointer',
                border: '1px solid ' + (formFilter === value ? 'rgba(214,108,174,0.6)' : 'var(--input-border)'),
                background: formFilter === value ? 'var(--interactive-hover-strong)' : 'var(--input-bg)',
                color: formFilter === value ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => runSearch(keyword, formFilter, companyFilter)} disabled={loading}
          style={{ padding: '9px 20px', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
        </button>
      </div>

      {/* Topic-first entry — fires a tuned corpus query per issue */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {TOPIC_CHIPS.map(chip => (
          <button key={chip.label} type="button"
            onClick={() => { setKeyword(chip.query); runSearch(chip.query, formFilter, companyFilter); }}
            style={{
              padding: '6px 12px', borderRadius: '999px', fontSize: '0.75rem', cursor: 'pointer',
              border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-secondary)',
            }}>
            {chip.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
          <Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} />
          <div>Searching inside letters…</div>
        </div>
      ) : searched && keyword.trim() ? (
        matches.length > 0 ? (
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '8px 0 12px' }}>
              {matchesTotal.toLocaleString()} matching letters — ranked by relevance
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {matches.map(match => (
                <div key={`${match.accession}:${match.cik}`} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <a href={`/company/${match.cik}`} title="Open issuer dossier"
                        style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                        {match.company_name}
                      </a>
                      <FormBadge form={match.form} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{match.date_filed}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button type="button" aria-expanded={expandedThread === match.thread_id} onClick={() => setExpandedThread(expandedThread === match.thread_id ? null : match.thread_id)}
                        style={{ color: 'var(--accent-primary)', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <MessageSquare size={12} /> {expandedThread === match.thread_id ? 'Hide conversation' : 'View conversation'}
                      </button>
                      <a href={edgarUrl(match.filename)} target="_blank" rel="noreferrer"
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
                          sourceUrl: edgarUrl(match.filename),
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}
                    dangerouslySetInnerHTML={renderHeadline(match.headline || '')} />
                  {expandedThread === match.thread_id && <ThreadConversation threadId={match.thread_id} />}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div role={searchError ? 'alert' : undefined} style={{ textAlign: 'center', padding: '48px', color: searchError ? 'var(--status-error)' : 'var(--text-muted)' }}>
            <p>{searchError || 'No searchable letter text matched. Check the corpus coverage above before treating this as no precedent.'}</p>
            {searchError && <button type="button" className="secondary-btn" onClick={() => void runSearch(keyword, formFilter, companyFilter)}>Retry letter search</button>}
          </div>
        )
      ) : null}

      {showBrowse && !loading && (
        <div style={{ marginTop: searched ? '8px' : '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <MessageSquare size={18} style={{ color: '#F59E0B' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Latest review conversations</h2>
          </div>
          {browseLoading ? (
            <div role="status" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
              <Loader2 size={20} className="spinner" style={{ marginBottom: '8px' }} /><div>Loading conversations…</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {requestedThreadError && (
                <div role="alert" style={{ ...cardStyle, color: 'var(--status-error)', background: 'var(--status-error-bg)' }}>
                  <p>{requestedThreadError}</p>
                  {requestedThreadLookupFailed && (
                    <button type="button" className="secondary-btn" onClick={() => setBrowseReloadKey(key => key + 1)}>Retry requested episode</button>
                  )}
                </div>
              )}
              {threads.map(thread => {
                const days = Math.max(1, Math.round(
                  (Date.parse(thread.last_letter) - Date.parse(thread.first_letter)) / 86_400_000
                ));
                const isLongReview = thread.uploads >= 3;
                return (
                  <div key={thread.thread_id} id={`thread-card-${thread.thread_id}`} style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedThread(expandedThread === thread.thread_id ? null : thread.thread_id)}
                        aria-expanded={expandedThread === thread.thread_id}
                        aria-controls={`thread-${thread.thread_id}`}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', cursor: 'pointer', flexWrap: 'wrap', flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          {expandedThread === thread.thread_id ? <ChevronDown size={16} style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />}
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {thread.company_name}
                          </span>
                        {/* Round count is the accountant's severity signal — long
                            contested reviews are the richest precedents */}
                        <span style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', whiteSpace: 'nowrap',
                          color: isLongReview ? 'var(--accent-primary)' : 'var(--text-muted)',
                          background: isLongReview ? 'var(--interactive-hover-strong)' : 'var(--surface-subtle)',
                        }}>
                          {thread.uploads} round{thread.uploads === 1 ? '' : 's'} · {days}d
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--status-warning)' }}>{thread.uploads} Staff</span>
                        <span style={{ color: 'var(--status-success)' }}>{thread.corresps} responses</span>
                        <span>{thread.first_letter} → {thread.last_letter}</span>
                        </div>
                      </button>
                      <a href={`/company/${thread.cik}`} aria-label={`Open ${thread.company_name} issuer dossier`} title="Open issuer dossier"
                        style={{ color: 'var(--accent-primary)', display: 'inline-flex', padding: '6px', borderRadius: '6px' }}>
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    </div>
                    {expandedThread === thread.thread_id && <div id={`thread-${thread.thread_id}`}><ThreadConversation threadId={thread.thread_id} /></div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
