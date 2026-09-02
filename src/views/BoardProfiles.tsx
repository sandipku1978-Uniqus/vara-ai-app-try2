'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { Users, PieChart, DollarSign, Search, CheckCircle2, Loader2, BarChart3, ExternalLink } from 'lucide-react';
import { buildSecFilingIndexUrl, resolveCompanyInput, type SecSubmission } from '../services/secApi';
import { loadBoardProfile, type BoardProfile, type BoardProfileOutcome } from '../services/boardProfiles';
import {
  describeBoardFailure,
  describeHeadcount,
  describeProxyAttribution,
  resolveHeadcount,
  type BoardLoadFailure,
  type ProxyAttributionLabels,
} from '../lib/boardProxy';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import './BoardProfiles.css';

interface CompanyEntry {
  ticker: string;
  loading: boolean;
  profile: BoardProfile | null;
  companyData: SecSubmission | null;
  failure: BoardLoadFailure | null;
}

/** A field the proxy was read for and does not state — distinct from a failed read. */
const NOT_STATED = 'Not stated in this proxy';
const NOT_STATED_SHORT = 'not stated in proxy';

function pendingEntry(ticker: string): CompanyEntry {
  return { ticker, loading: true, profile: null, companyData: null, failure: null };
}

function settledEntry(ticker: string, outcome: BoardProfileOutcome): CompanyEntry {
  return outcome.ok
    ? { ticker, loading: false, profile: outcome.profile, companyData: outcome.profile.companyData, failure: null }
    : { ticker, loading: false, profile: null, companyData: outcome.companyData, failure: outcome.failure };
}

/** A percentage outside 0–100 is an extraction error, shown as not stated rather than clamped. */
function validPercent(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function formatPercent(value: number | null | undefined, fallback = NOT_STATED_SHORT): string {
  const percent = validPercent(value);
  return percent == null ? fallback : `${percent}%`;
}

function statedText(value: string | null | undefined, fallback = NOT_STATED): string {
  return value && value.trim() ? value.trim() : fallback;
}

function attributionLabels(profile: BoardProfile): ProxyAttributionLabels | null {
  return profile.attribution ? describeProxyAttribution(profile.attribution, profile.source) : null;
}

function sourceSentence(profile: BoardProfile): string {
  const { ticker, source, attribution } = profile;
  const meeting = attribution ? ` for the ${attribution.meetingYear} annual meeting` : '';
  return `AI-extracted from ${ticker}'s ${source.form} filed ${source.filingDate} (accession ${source.accessionNumber})${meeting}.`;
}

function ProxySourceLinks({ profile }: { profile: BoardProfile }) {
  const { ticker, source } = profile;
  return (
    <span className="board-provenance__links">
      <a
        href={source.documentUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${ticker} proxy on SEC.gov — ${source.form} filed ${source.filingDate}`}
      >
        <ExternalLink size={12} aria-hidden="true" /> Proxy on SEC.gov
      </a>
      <a
        href={source.indexUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${ticker} ${source.form} filing index — accession ${source.accessionNumber}`}
      >
        Filing index
      </a>
    </span>
  );
}

/** Form, filing date, accession, attribution, and the SEC links — the trace for every value on the page. */
function ProxyProvenance({ profile, compact = false }: { profile: BoardProfile; compact?: boolean }) {
  const { source } = profile;
  const labels = attributionLabels(profile);
  return (
    <div className={`board-provenance${compact ? ' board-provenance--compact' : ''}`}>
      <span className="board-provenance__filing">
        {source.form} · filed {source.filingDate} · accession {source.accessionNumber}
      </span>
      <span className="board-provenance__attribution">
        {labels
          ? `Covers the ${labels.meetingLabel}; compensation for ${labels.fiscalLabel}.`
          : 'Meeting and fiscal year could not be attributed: the filing date is unreadable.'}
      </span>
      <ProxySourceLinks profile={profile} />
    </div>
  );
}

function FailureNotice({ failure, onRetry }: { failure: BoardLoadFailure; onRetry?: () => void }) {
  const description = describeBoardFailure(failure);
  const filingIndex = 'filing' in failure
    ? { filing: failure.filing, url: buildSecFilingIndexUrl(failure.cik, failure.filing.accessionNumber) }
    : null;
  return (
    <div
      role={description.severity === 'error' ? 'alert' : 'status'}
      className={`board-failure board-failure--${description.severity}`}
    >
      <p className="board-failure__title">{description.title}</p>
      <p className="board-failure__message">{description.message}</p>
      {filingIndex && (
        <a
          href={filingIndex.url}
          target="_blank"
          rel="noopener noreferrer"
          className="board-failure__link"
          aria-label={`${failure.ticker} ${filingIndex.filing.form} filing index — accession ${filingIndex.filing.accessionNumber}`}
        >
          Filing index on SEC.gov
        </a>
      )}
      {description.retryable && onRetry && (
        <button type="button" className="primary-btn sm" style={{ marginTop: '8px' }} onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}

interface ComparisonRow {
  label: string;
  render: (profile: BoardProfile) => ReactNode;
}

const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    label: 'Source filing',
    render: profile => (
      <a
        href={profile.source.documentUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${profile.ticker} proxy on SEC.gov — ${profile.source.form} filed ${profile.source.filingDate}`}
      >
        {profile.source.form} filed {profile.source.filingDate}
      </a>
    ),
  },
  {
    label: 'Proxy for annual meeting',
    render: profile => profile.attribution
      ? `${profile.attribution.meetingYear}${profile.attribution.meetingYearBasis === 'filing-date' ? ' (from filing date)' : ''}`
      : '—',
  },
  {
    label: 'Compensation fiscal year',
    render: profile => profile.attribution
      ? `FY${profile.attribution.fiscalYear}${profile.attribution.fiscalYearBasis === 'assumed-calendar-year-end' ? ' (calendar year-end assumed)' : ''}`
      : '—',
  },
  { label: 'Board Size', render: profile => profile.boardData.boardSize != null ? String(profile.boardData.boardSize) : NOT_STATED_SHORT },
  { label: 'Independence %', render: profile => formatPercent(profile.boardData.independencePercent) },
  { label: 'Female %', render: profile => formatPercent(profile.boardData.diversity.femalePercent) },
  { label: 'CEO Pay Ratio', render: profile => statedText(profile.boardData.ceoPayRatio, NOT_STATED_SHORT) },
  {
    label: 'Say-on-Pay Approval (earlier vote, as reported in proxy)',
    render: profile => statedText(profile.boardData.sayOnPayApproval, NOT_STATED_SHORT),
  },
];

export default function BoardProfiles() {
  const [activeTab, setActiveTab] = useState<'directors' | 'diversity' | 'compensation'>('directors');
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [currentTicker, setCurrentTicker] = useState('AAPL');
  const [target, setTarget] = useState<CompanyEntry>(() => pendingEntry('AAPL'));
  const targetRequestRef = useRef(0);

  // Multi-company comparison state
  const [compareTickers, setCompareTickers] = useState<string[]>(['AAPL']);
  const [compareEntries, setCompareEntries] = useState<Map<string, CompanyEntry>>(new Map());
  const compareRequestsRef = useRef(new Set<string>());

  const fetchData = useCallback(async (ticker: string) => {
    const requestId = targetRequestRef.current + 1;
    targetRequestRef.current = requestId;
    setTarget(pendingEntry(ticker));
    const outcome = await loadBoardProfile(ticker);
    // Only the newest target request may update the view.
    if (targetRequestRef.current !== requestId) return;
    setTarget(settledEntry(ticker, outcome));
  }, []);

  // Fetch data for a compare ticker and store in compareEntries
  const fetchCompareData = useCallback(async (ticker: string) => {
    const upper = ticker.toUpperCase();
    if (compareRequestsRef.current.has(upper)) return;
    compareRequestsRef.current.add(upper);
    setCompareEntries(prev => new Map(prev).set(upper, pendingEntry(upper)));
    const outcome = await loadBoardProfile(upper);
    setCompareEntries(prev => {
      // Removed from the cohort while loading: do not resurrect it.
      if (!compareRequestsRef.current.has(upper)) return prev;
      return new Map(prev).set(upper, settledEntry(upper, outcome));
    });
  }, []);

  useEffect(() => {
    void fetchData(currentTicker);
  }, [currentTicker, fetchData]);

  // Fetch compare data whenever compareTickers changes
  useEffect(() => {
    if (compareTickers.length < 2) return;
    for (const ticker of compareTickers) {
      void fetchCompareData(ticker);
    }
  }, [compareTickers, fetchCompareData]);

  const retryTarget = useCallback(() => {
    const ticker = currentTicker;
    if (compareTickers.includes(ticker)) {
      // Its comparison column failed on the same load. Refresh it too; the
      // loader shares one in-flight request between the two.
      compareRequestsRef.current.delete(ticker);
      void fetchCompareData(ticker);
    }
    void fetchData(ticker);
  }, [compareTickers, currentTicker, fetchCompareData, fetchData]);

  const addCompareTicker = useCallback((ticker: string) => {
    const upper = ticker.toUpperCase();
    if (compareTickers.includes(upper) || compareTickers.length >= 3) return;
    setCompareTickers(prev => [...prev, upper]);
    // Also set as current ticker for single-company view
    setCurrentTicker(upper);
    setTickerInput(upper);
  }, [compareTickers]);

  const removeCompareTicker = useCallback((ticker: string) => {
    compareRequestsRef.current.delete(ticker);
    setCompareEntries(prev => {
      const next = new Map(prev);
      next.delete(ticker);
      return next;
    });
    const remaining = compareTickers.filter(t => t !== ticker);
    setCompareTickers(remaining);
    // If we removed the current ticker, switch to the first remaining one
    if (ticker === currentTicker && remaining.length > 0) {
      setCurrentTicker(remaining[0]);
      setTickerInput(remaining[0]);
    }
  }, [compareTickers, currentTicker]);

  const handleTickerSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tickerInput.trim()) {
      const typed = tickerInput.trim();
      void (async () => {
        const resolved = await resolveCompanyInput(typed);
        const upper = (resolved?.ticker || typed).toUpperCase();
        setCurrentTicker(upper);
        setTickerInput(upper);
        if (!compareTickers.includes(upper) && compareTickers.length < 3) {
          setCompareTickers(prev => [...prev, upper]);
        }
      })();
    }
  };

  const profile = target.profile;
  const companyName = target.companyData?.name || currentTicker;
  // null = not disclosed in the proxy (extractor no longer fabricates 0 defaults)
  const boardData = profile?.boardData ?? null;
  const boardSize = boardData?.boardSize ?? null;
  const independence = validPercent(boardData?.independencePercent);
  const labels = profile ? attributionLabels(profile) : null;
  const showTabs = profile != null && !target.loading;

  return (
    <div className="board-container">
      <div className="board-header">
        <div className="board-title">
          <h1>Board Profiles & Executive Compensation</h1>
          <p>AI-extracted governance structures, board diversity metrics, and compensation analytics from DEF 14A proxy statements, each traced to its source filing.</p>
        </div>

        <div className="board-company-controls">
          <div className="ticker-selector glass-card" style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '8px' }}>Target Company:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--input-bg)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--input-border)' }}>
              <Search size={14} className="text-blue-400" />
              <input
                type="text"
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={handleTickerSearch}
                placeholder="Enter ticker..."
                aria-label="Target company ticker"
                style={{ background: 'transparent', border: 'none', outline: 'none', width: '80px', color: 'var(--text-primary)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
              />
            </div>
            {target.loading && <Loader2 size={16} className="spinner" style={{ marginLeft: '6px' }} />}
          </div>
          <div className="board-compare-controls">
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Compare (up to 3):</span>
            {compareTickers.map(t => (
              <span key={t} className="board-compare-chip" style={{
                background: currentTicker === t ? 'color-mix(in srgb, var(--accent-primary) 14%, transparent)' : 'var(--surface-subtle)',
                color: 'var(--accent-primary)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem',
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                border: currentTicker === t ? '1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent)' : '1px solid var(--border-color)',
              }}>
                <button type="button" className="board-compare-select" aria-pressed={currentTicker === t} onClick={() => { setCurrentTicker(t); setTickerInput(t); }}>
                  {t}
                </button>
                {compareTickers.length > 1 && (
                  <button type="button" aria-label={`Remove ${t} from comparison`} onClick={() => removeCompareTicker(t)}
                    style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: 0, fontSize: '0.85rem', lineHeight: 1 }}>
                    &times;
                  </button>
                )}
              </span>
            ))}
            {compareTickers.length < 3 && (
              <div style={{ width: '180px' }}>
                <CompanySearchInput onSelect={addCompareTicker} placeholder="Add ticker..." />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="board-layout">
        <aside className="board-sidebar glass-card">
          <nav className="board-nav" aria-label="Board research views">
            <button type="button" aria-pressed={activeTab === 'directors'} className={`nav-btn ${activeTab === 'directors' ? 'active' : ''}`} onClick={() => setActiveTab('directors')}>
              <Users size={18} /> Director Profiles
            </button>
            <button type="button" aria-pressed={activeTab === 'diversity'} className={`nav-btn ${activeTab === 'diversity' ? 'active' : ''}`} onClick={() => setActiveTab('diversity')}>
              <PieChart size={18} /> Board Diversity
            </button>
            <button type="button" aria-pressed={activeTab === 'compensation'} className={`nav-btn ${activeTab === 'compensation' ? 'active' : ''}`} onClick={() => setActiveTab('compensation')}>
              <DollarSign size={18} /> Executive Comp (PvP)
            </button>
          </nav>

          <div className="sidebar-widget" style={{ marginTop: '20px' }}>
            <h4>Governance Overview — {currentTicker}</h4>
            <div className="gov-metric" style={{ marginTop: '10px' }}>
              <span className="text-sm text-slate-400">Company</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--text-primary)' }}>{companyName}</span>
            </div>
            <div className="gov-metric" style={{ marginTop: '8px' }}>
              <span className="text-sm text-slate-400">Board Size</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: 'var(--text-primary)' }} title={profile ? 'Board size as extracted from the proxy' : undefined}>
                {target.loading ? '...' : profile ? boardSize ?? NOT_STATED_SHORT : '—'}
              </span>
            </div>
            <div className="gov-metric" style={{ marginTop: '8px' }}>
              <span className="text-sm text-slate-400">Independence</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: 'var(--status-success)' }}>
                {target.loading ? '...' : profile ? formatPercent(independence) : '—'}
              </span>
            </div>
            <div className="gov-metric" style={{ marginTop: '8px' }}>
              <span className="text-sm text-slate-400">CEO Pay Ratio</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--accent-primary)' }}>
                {target.loading ? '...' : profile ? statedText(boardData?.ceoPayRatio, NOT_STATED_SHORT) : '—'}
              </span>
            </div>
            <div className="gov-metric" style={{ marginTop: '8px' }}>
              <span className="text-sm text-slate-400">Source filing</span>
              {target.loading
                ? <span>...</span>
                : profile
                  ? <ProxyProvenance profile={profile} compact />
                  : <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No proxy loaded</span>}
            </div>
          </div>
        </aside>

        <section className="board-main glass-card" style={{ overflow: 'auto' }}>
          {target.loading && (
            <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px', gap: '8px' }}>
              <Loader2 size={32} className="spinner" />
              <p style={{ color: 'var(--text-secondary)' }}>AI is analyzing the DEF 14A proxy statement...</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>This may take 15-30 seconds</p>
            </div>
          )}

          {!target.loading && target.failure && (
            <FailureNotice failure={target.failure} onRetry={retryTarget} />
          )}

          {activeTab === 'directors' && showTabs && profile && boardData && (
            <div className="tab-pane fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <h2>Board of Directors — {companyName}</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>{sourceSentence(profile)}</p>
                  <ProxyProvenance profile={profile} compact />
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>AI extracted</span>
              </div>

              {boardData.directors.length === 0 && (
                <p role="status" className="text-sm text-slate-400" style={{ marginBottom: '12px' }}>
                  No director table was extracted from this proxy. The filing was read; the extraction found no director list in it.
                </p>
              )}

              <div className="board-table-scroll" style={{ border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.875rem' }}>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Director Name</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Role</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Independent</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Committees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boardData.directors.map((dir, i) => (
                      <tr key={`${dir.name}-${i}`} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 500, color: 'var(--text-primary)' }}>{dir.name}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{dir.role || NOT_STATED_SHORT}</td>
                        <td style={{ padding: '9px 12px' }}>
                          {dir.independent ? (
                            <span style={{ background: 'color-mix(in srgb, var(--status-success) 14%, transparent)', color: 'var(--status-success)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid color-mix(in srgb, var(--status-success) 28%, transparent)' }}>Yes</span>
                          ) : (
                            <span style={{ background: 'var(--surface-subtle)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid var(--border-color)' }}>No</span>
                          )}
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{dir.committees.length > 0 ? dir.committees.join(', ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'diversity' && showTabs && profile && boardData && (
            <div className="tab-pane fade-in">
              <div style={{ marginBottom: '16px' }}>
                <h2>Board Diversity — {companyName}</h2>
                <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>
                  Gender breakdown as AI-extracted from the proxy. Percentages are the disclosed figures; a headcount is shown as fact only when the proxy states it, otherwise it is labelled derived.
                </p>
              </div>

              <div className="board-diversity-grid">
                <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--border-color)', padding: '16px', borderRadius: '6px' }}>
                  <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    Gender Identity
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }} title="Board size as extracted from the proxy">
                      Board size: {boardSize ?? NOT_STATED_SHORT}
                    </span>
                  </h3>
                  <div style={{ display: 'flex', gap: '24px', height: '180px', alignItems: 'flex-end', marginBottom: '8px' }}>
                    {[
                      { label: 'Male', percent: boardData.diversity.malePercent, count: boardData.diversity.maleCount, color: 'var(--accent-primary)' },
                      { label: 'Female', percent: boardData.diversity.femalePercent, count: boardData.diversity.femaleCount, color: 'var(--accent-secondary)' },
                    ].map(bar => {
                      const percent = validPercent(bar.percent);
                      const headcount = resolveHeadcount(bar.count, percent, boardSize);
                      return (
                        <div key={bar.label} className="board-gender-bar">
                          <span className="board-gender-bar__value">{percent != null ? `${percent}%` : NOT_STATED_SHORT}</span>
                          <div className="board-gender-bar__track">
                            <div className="board-gender-bar__fill" style={{ background: bar.color, height: `${percent ?? 0}%` }}></div>
                          </div>
                          <span className="board-gender-bar__label">{bar.label}</span>
                          <span className={`board-headcount board-headcount--${headcount.kind}`}>{describeHeadcount(headcount)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--border-color)', padding: '16px', borderRadius: '6px' }}>
                  <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '12px' }}>Key Governance Metrics</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '4px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Board Independence</span>
                        <span style={{ fontWeight: 700, color: 'var(--status-success)' }}>{formatPercent(independence, NOT_STATED)}</span>
                      </div>
                      <div style={{ width: '100%', background: 'var(--surface-subtle)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ background: 'var(--status-success)', height: '100%', width: `${independence ?? 0}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Say-on-Pay Approval</span>
                        <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{statedText(boardData.sayOnPayApproval)}</span>
                      </div>
                      <p className="board-metric-note">
                        {labels
                          ? labels.sayOnPayLabel
                          : `As reported in the ${profile.source.form} filed ${profile.source.filingDate}; a proxy reports an earlier meeting's vote.`}
                      </p>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>CEO Pay Ratio</span>
                        <span style={{ fontWeight: 700, color: 'var(--status-warning)' }}>{statedText(boardData.ceoPayRatio)}</span>
                      </div>
                      <p className="board-metric-note">
                        {labels
                          ? `As disclosed for ${labels.fiscalLabel} in the ${profile.source.form} filed ${profile.source.filingDate}.`
                          : `As disclosed in the ${profile.source.form} filed ${profile.source.filingDate}.`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="board-source-card">
                <CheckCircle2 className="text-blue-400" size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Data Source</h4>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{sourceSentence(profile)}</p>
                  <ProxyProvenance profile={profile} compact />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'compensation' && showTabs && profile && boardData && (
            <div className="tab-pane fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <h2>Executive Compensation — {companyName}</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>
                    {labels
                      ? `Named Executive Officers (NEOs): ${labels.fiscalLabel} compensation, as disclosed in the ${profile.source.form} filed ${profile.source.filingDate}.`
                      : `Named Executive Officers (NEOs) as disclosed in the ${profile.source.form} filed ${profile.source.filingDate}.`}
                  </p>
                  <ProxyProvenance profile={profile} compact />
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>AI extracted</span>
              </div>

              {boardData.compensation.length === 0 && (
                <p role="status" className="text-sm text-slate-400" style={{ marginBottom: '12px' }}>
                  No compensation table was extracted from this proxy. The filing was read; the extraction found no NEO table in it.
                </p>
              )}

              <div className="board-table-scroll" style={{ border: '1px solid var(--border-color)', borderRadius: '6px', marginBottom: '20px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.875rem' }}>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)' }}>NEO</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Title</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>Base Salary</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>Stock Awards</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boardData.compensation.map((d, i) => (
                      <tr key={`${d.name}-${i}`} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 500, color: 'var(--text-primary)' }}>{d.name}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)' }}>{d.title || NOT_STATED_SHORT}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)', textAlign: 'right' }}>{d.salary || NOT_STATED_SHORT}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-secondary)', textAlign: 'right' }}>{d.stockAwards || NOT_STATED_SHORT}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-primary)', fontWeight: 700, textAlign: 'right' }}>{d.total || NOT_STATED_SHORT}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h2 style={{ fontSize: '1.1rem', marginBottom: '12px', marginTop: '4px' }}>Pay vs. Performance (PvP)</h2>
              <div className="board-comp-grid">
                <div className="board-comp-card">
                  <h4>CEO Pay Ratio</h4>
                  <div className="board-comp-card__value">{statedText(boardData.ceoPayRatio)}</div>
                  <p className="board-metric-note board-metric-note--center">
                    {labels
                      ? `As disclosed for ${labels.fiscalLabel} in the ${profile.source.form} filed ${profile.source.filingDate}.`
                      : `As disclosed in the ${profile.source.form} filed ${profile.source.filingDate}.`}
                  </p>
                </div>
                <div className="board-comp-card">
                  <h4>Say-on-Pay Approval</h4>
                  <div className="board-comp-card__value" style={{ color: 'var(--status-success)' }}>{statedText(boardData.sayOnPayApproval)}</div>
                  <p className="board-metric-note board-metric-note--center">
                    {labels
                      ? labels.sayOnPayShort
                      : `As reported in the ${profile.source.form} filed ${profile.source.filingDate}; a proxy reports an earlier meeting's vote.`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Multi-company comparison table (shown when 2+ tickers selected) */}
          {compareTickers.length >= 2 && (
            <div style={{ marginTop: '16px', padding: '16px', background: 'var(--surface-subtle)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <BarChart3 size={20} style={{ color: 'var(--accent-primary)' }} />
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Side-by-Side Comparison</h2>
              </div>
              {compareTickers.some(t => compareEntries.get(t)?.loading) && (
                <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', marginBottom: '10px', fontSize: '0.85rem' }}>
                  <Loader2 size={14} className="spinner" /> Loading comparison data...
                </div>
              )}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <caption className="sr-only">Board governance comparison for selected companies</caption>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.85rem' }}>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Metric</th>
                      {compareTickers.map(t => (
                        <th scope="col" key={t} style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center', borderLeft: '1px solid var(--border-color)' }}>
                          {compareEntries.get(t)?.companyData?.name || t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_ROWS.map(row => (
                      <tr key={row.label} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                        <th scope="row" style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--text-secondary)' }}>{row.label}</th>
                        {compareTickers.map(t => {
                          const entry = compareEntries.get(t);
                          let cell: ReactNode;
                          if (!entry || entry.loading) {
                            cell = <Loader2 size={12} className="spinner" />;
                          } else if (entry.failure) {
                            const description = describeBoardFailure(entry.failure);
                            cell = <span className="board-compare-failure" title={description.message}>{description.title}</span>;
                          } else if (entry.profile) {
                            cell = row.render(entry.profile);
                          } else {
                            cell = '—';
                          }
                          return (
                            <td key={t} style={{ padding: '8px 12px', textAlign: 'center', borderLeft: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                              {cell}
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
        </section>
      </div>
    </div>
  );
}
