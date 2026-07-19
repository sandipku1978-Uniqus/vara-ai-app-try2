'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

import { Mail, Search, Loader2, ExternalLink, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import AskCopilotButton from '../components/tables/AskCopilotButton';
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

interface ThreadSummary {
  thread_id: string;
  cik: number;
  company_name: string;
  letters: number;
  uploads: number;
  corresps: number;
  first_letter: string;
  last_letter: string;
}

interface ThreadLetter {
  accession: string;
  cik: number;
  company_name: string;
  form: string;
  date_filed: string;
  filename: string;
  has_text: boolean;
  preview: string;
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
}

function ThreadConversation({ threadId }: { threadId: string }) {
  const [letters, setLetters] = useState<ThreadLetter[] | null>(null);
  const [aiSummary, setAiSummary] = useState<ThreadSummaryPayload | 'loading' | 'unavailable' | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/letters?thread=${encodeURIComponent(threadId)}`)
      .then(response => response.json())
      .then(payload => { if (!cancelled) setLetters(payload.letters ?? []); })
      .catch(() => { if (!cancelled) setLetters([]); });
    return () => { cancelled = true; };
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    setAiSummary('loading');
    fetch(`/api/letters/summary?thread=${encodeURIComponent(threadId)}`)
      .then(response => (response.ok ? response.json() : null))
      .then(payload => {
        if (cancelled) return;
        if (payload?.summary) {
          setAiSummary({ summary: payload.summary, model: payload.model ?? null, generatedAt: payload.generatedAt ?? null });
        } else {
          setAiSummary('unavailable');
        }
      })
      .catch(() => { if (!cancelled) setAiSummary('unavailable'); });
    return () => { cancelled = true; };
  }, [threadId]);

  if (letters === null) {
    return <div style={{ padding: '16px', color: 'var(--text-muted)' }}><Loader2 size={16} className="spinner" /> Loading conversation…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 0 4px' }}>
      {aiSummary === 'loading' ? (
        <div style={{ ...cardStyle, padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Loader2 size={14} className="spinner" /> Summarizing the review episode…
        </div>
      ) : aiSummary && aiSummary !== 'unavailable' ? (
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
            <a href={edgarUrl(letter.filename)} target="_blank" rel="noreferrer"
              style={{ color: '#D66CAE', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Full letter <ExternalLink size={11} />
            </a>
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
  const [keyword, setKeyword] = useState('');
  const [companyFilter, setCompanyFilter] = useState(() => searchParams?.get('company') || '');
  const [formFilter, setFormFilter] = useState<'' | 'UPLOAD' | 'CORRESP'>('');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [matchesTotal, setMatchesTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBrowseLoading(true);
    const params = new URLSearchParams({ size: '12' });
    if (companyFilter.trim()) params.set('company', companyFilter.trim());
    fetch(`/api/letters?${params.toString()}`)
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(payload => {
        if (cancelled) return;
        setThreads(payload.threads ?? []);
        setThreadsTotal(payload.total ?? 0);
      })
      .catch(() => { if (!cancelled) setUnavailable(true); })
      .finally(() => { if (!cancelled) setBrowseLoading(false); });
    return () => { cancelled = true; };
  }, [companyFilter]);

  const runSearch = useCallback(async (query: string, form: '' | 'UPLOAD' | 'CORRESP', company: string) => {
    if (!query.trim() && !company.trim()) return;
    setLoading(true);
    setSearched(Boolean(query.trim()));
    setExpandedThread(null);
    if (!query.trim()) { setLoading(false); return; } // company-only filters the browse list via effect
    try {
      const params = new URLSearchParams({ q: query.trim(), size: '50' });
      if (form) params.set('form', form);
      if (company.trim()) params.set('company', company.trim());
      const response = await fetch(`/api/letters?${params.toString()}`);
      const payload = await response.json();
      setMatches(payload.matches ?? []);
      setMatchesTotal(payload.total ?? 0);
    } catch {
      setMatches([]);
      setMatchesTotal(0);
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

      {unavailable && (
        <div style={{ ...cardStyle, borderColor: 'rgba(245,158,11,0.4)', color: '#FBBF24', fontSize: '0.85rem', marginBottom: '16px' }}>
          The letter corpus is not reachable right now — check the enriched-search configuration.
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder='e.g. revenue recognition principal agent, "material weakness", segment reporting'
            onKeyDown={e => e.key === 'Enter' && runSearch(keyword, formFilter, companyFilter)}
            style={{ width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <div style={{ minWidth: '170px' }}>
          <input value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
            placeholder="Company name…"
            aria-label="Filter by company name"
            onKeyDown={e => e.key === 'Enter' && runSearch(keyword, formFilter, companyFilter)}
            style={{ width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {([['', 'All'], ['UPLOAD', 'Staff letters'], ['CORRESP', 'Responses']] as const).map(([value, label]) => (
            <button key={value} onClick={() => { setFormFilter(value); if (searched && keyword.trim()) runSearch(keyword, value, companyFilter); }}
              style={{
                padding: '7px 12px', borderRadius: '8px', fontSize: '0.78rem', cursor: 'pointer',
                border: '1px solid ' + (formFilter === value ? 'rgba(214,108,174,0.6)' : 'var(--input-border)'),
                background: formFilter === value ? 'rgba(179,31,126,0.25)' : 'rgba(255,255,255,0.04)',
                color: formFilter === value ? '#F9A8D4' : '#94A3B8',
              }}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => runSearch(keyword, formFilter, companyFilter)} disabled={loading}
          style={{ padding: '9px 20px', background: '#B31F7E', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
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
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
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
                      <button type="button" onClick={() => setExpandedThread(expandedThread === match.thread_id ? null : match.thread_id)}
                        style={{ color: '#D66CAE', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <MessageSquare size={12} /> {expandedThread === match.thread_id ? 'Hide conversation' : 'View conversation'}
                      </button>
                      <a href={edgarUrl(match.filename)} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        EDGAR <ExternalLink size={11} />
                      </a>
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
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
            No letters matched. Text extraction is still backfilling older years — recent letters are covered first.
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
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
              <Loader2 size={20} className="spinner" style={{ marginBottom: '8px' }} /><div>Loading conversations…</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {threads.map(thread => {
                const days = Math.max(1, Math.round(
                  (Date.parse(thread.last_letter) - Date.parse(thread.first_letter)) / 86_400_000
                ));
                const isLongReview = thread.uploads >= 3;
                return (
                  <div key={thread.thread_id} style={cardStyle}>
                    <button
                      type="button"
                      onClick={() => setExpandedThread(expandedThread === thread.thread_id ? null : thread.thread_id)}
                      aria-expanded={expandedThread === thread.thread_id}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', cursor: 'pointer', flexWrap: 'wrap', width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        {expandedThread === thread.thread_id ? <ChevronDown size={16} style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />}
                        <a href={`/company/${thread.cik}`} title="Open issuer dossier"
                          onClick={event => event.stopPropagation()}
                          style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                          {thread.company_name}
                        </a>
                        {/* Round count is the accountant's severity signal — long
                            contested reviews are the richest precedents */}
                        <span style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', whiteSpace: 'nowrap',
                          color: isLongReview ? '#F9A8D4' : '#94A3B8',
                          background: isLongReview ? 'rgba(179,31,126,0.18)' : 'rgba(255,255,255,0.06)',
                        }}>
                          {thread.uploads} round{thread.uploads === 1 ? '' : 's'} · {days}d
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <span style={{ color: '#FBBF24' }}>{thread.uploads} Staff</span>
                        <span style={{ color: '#6EE7B7' }}>{thread.corresps} responses</span>
                        <span>{thread.first_letter} → {thread.last_letter}</span>
                      </div>
                    </button>
                    {expandedThread === thread.thread_id && <ThreadConversation threadId={thread.thread_id} />}
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
