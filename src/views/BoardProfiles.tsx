'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Users, PieChart, DollarSign, Search, CheckCircle2, Loader2, BarChart3 } from 'lucide-react';
import { fetchCompanySubmissions, lookupCIK, lookupCIKFlexible, resolveCompanyInput, findLatestFiling, fetchFilingText, SecSubmission } from '../services/secApi';
import { aiExtractBoardData, BoardDataResult } from '../services/aiApi';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import './BoardProfiles.css';

// Module-level cache for board data
const boardDataCache = new Map<string, BoardDataResult>();

// Multi-company cache and state
interface CompanyEntry {
  ticker: string;
  companyData: SecSubmission | null;
  boardData: BoardDataResult | null;
  loading: boolean;
  error: string;
}

function clampPercent(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
}

function formatPercent(value: number | null | undefined): string {
  const percent = clampPercent(value);
  return percent == null ? '—' : `${percent}%`;
}

export default function BoardProfiles() {
  const [activeTab, setActiveTab] = useState<'directors' | 'diversity' | 'compensation'>('directors');
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [currentTicker, setCurrentTicker] = useState('AAPL');
  const [companyData, setCompanyData] = useState<SecSubmission | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [boardData, setBoardData] = useState<BoardDataResult | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState('');

  // Multi-company comparison state
  const [compareTickers, setCompareTickers] = useState<string[]>(['AAPL']);
  const [compareEntries, setCompareEntries] = useState<Map<string, CompanyEntry>>(new Map());
  const compareRequestsRef = useRef(new Set<string>());

  const fetchData = useCallback(async (ticker: string) => {
    setIsLoading(true);
    setBoardError('');
    const cik = await lookupCIKFlexible(ticker);
    if (!cik) {
      setCompanyData(null);
      setIsLoading(false);
      setBoardData(null);
      return;
    }
    const data = await fetchCompanySubmissions(cik);
    setCompanyData(data);
    setIsLoading(false);

    // Check cache
    if (boardDataCache.has(ticker.toUpperCase())) {
      setBoardData(boardDataCache.get(ticker.toUpperCase())!);
      return;
    }

    // Extract board data from DEF 14A
    if (data) {
      setBoardLoading(true);
      setBoardData(null);
      try {
        const proxyFiling = findLatestFiling(data, 'DEF 14A');
        if (!proxyFiling) {
          setBoardError('No DEF 14A proxy statement found for this company.');
          setBoardLoading(false);
          return;
        }
        const text = await fetchFilingText(cik, proxyFiling.accessionNumber, proxyFiling.primaryDocument);
        if (!text || text.length < 500) {
          setBoardError('Could not retrieve proxy statement text.');
          setBoardLoading(false);
          return;
        }
        const extracted = await aiExtractBoardData(text);
        if (extracted) {
          boardDataCache.set(ticker.toUpperCase(), extracted);
          setBoardData(extracted);
        } else {
          setBoardError('AI extraction returned no data. The proxy filing may not contain standard governance disclosures.');
        }
      } catch (error) {
        console.error('Board data extraction error:', error);
        setBoardError('Failed to extract board data. Please try again.');
      } finally {
        setBoardLoading(false);
      }
    }
  }, []);

  // Fetch data for a compare ticker and store in compareEntries
  const fetchCompareData = useCallback(async (ticker: string) => {
    const upper = ticker.toUpperCase();
    if (compareRequestsRef.current.has(upper)) return;
    compareRequestsRef.current.add(upper);

    setCompareEntries(prev => {
      const next = new Map(prev);
      next.set(upper, { ticker: upper, companyData: null, boardData: null, loading: true, error: '' });
      return next;
    });

    try {
      // Check boardDataCache first
      if (boardDataCache.has(upper)) {
        const cik = await lookupCIK(upper);
        const data = cik ? await fetchCompanySubmissions(cik) : null;
        setCompareEntries(prev => {
          const next = new Map(prev);
          next.set(upper, { ticker: upper, companyData: data, boardData: boardDataCache.get(upper)!, loading: false, error: '' });
          return next;
        });
        return;
      }

      const cik = await lookupCIK(upper);
      if (!cik) {
        setCompareEntries(prev => {
          const next = new Map(prev);
          next.set(upper, { ticker: upper, companyData: null, boardData: null, loading: false, error: 'Ticker not found.' });
          return next;
        });
        return;
      }
      const data = await fetchCompanySubmissions(cik);
      if (!data) {
        setCompareEntries(prev => {
          const next = new Map(prev);
          next.set(upper, { ticker: upper, companyData: null, boardData: null, loading: false, error: 'No submissions found.' });
          return next;
        });
        return;
      }
      const proxyFiling = findLatestFiling(data, 'DEF 14A');
      if (!proxyFiling) {
        setCompareEntries(prev => {
          const next = new Map(prev);
          next.set(upper, { ticker: upper, companyData: data, boardData: null, loading: false, error: 'No DEF 14A found.' });
          return next;
        });
        return;
      }
      const text = await fetchFilingText(cik, proxyFiling.accessionNumber, proxyFiling.primaryDocument);
      if (!text || text.length < 500) {
        setCompareEntries(prev => {
          const next = new Map(prev);
          next.set(upper, { ticker: upper, companyData: data, boardData: null, loading: false, error: 'Could not retrieve proxy text.' });
          return next;
        });
        return;
      }
      const extracted = await aiExtractBoardData(text);
      if (extracted) {
        boardDataCache.set(upper, extracted);
      }
      setCompareEntries(prev => {
        const next = new Map(prev);
        next.set(upper, { ticker: upper, companyData: data, boardData: extracted, loading: false, error: extracted ? '' : 'AI extraction returned no data.' });
        return next;
      });
    } catch (err) {
      console.error('Compare fetch error:', err);
      setCompareEntries(prev => {
        const next = new Map(prev);
        next.set(upper, { ticker: upper, companyData: null, boardData: null, loading: false, error: 'Failed to extract board data.' });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    fetchData(currentTicker);
  }, [currentTicker, fetchData]);

  // Fetch compare data whenever compareTickers changes
  useEffect(() => {
    if (compareTickers.length < 2) return;
    for (const ticker of compareTickers) {
      fetchCompareData(ticker);
    }
  }, [compareTickers, fetchCompareData]);

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
    setCompareTickers(prev => {
      const next = prev.filter(t => t !== ticker);
      // If we removed the current ticker, switch to the first remaining one
      if (ticker === currentTicker && next.length > 0) {
        setCurrentTicker(next[0]);
        setTickerInput(next[0]);
      }
      return next;
    });
  }, [currentTicker]);

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

  const companyName = companyData?.name || currentTicker;
  // null = not disclosed in the proxy (extractor no longer fabricates 0 defaults)
  const boardSize = boardData?.boardSize ?? null;
  const independence = clampPercent(boardData?.independencePercent);

  return (
    <div className="board-container">
      <div className="board-header">
        <div className="board-title">
          <h1>Board Profiles & Executive Compensation</h1>
          <p>AI-extracted governance structures, board diversity metrics, and compensation analytics from DEF 14A proxy statements.</p>
        </div>

        <div className="board-company-controls">
          <div className="ticker-selector glass-card" style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: '12px' }}>Target Company:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--input-bg)', padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--input-border)' }}>
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
            {(isLoading || boardLoading) && <Loader2 size={16} className="spinner" style={{ marginLeft: '8px' }} />}
          </div>
          <div className="board-compare-controls">
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Compare (up to 3):</span>
            {compareTickers.map(t => (
              <span key={t} className="board-compare-chip" style={{
                background: currentTicker === t ? 'rgba(214,108,174,0.25)' : 'rgba(214,108,174,0.1)',
                color: 'var(--accent-primary)', padding: '3px 10px', borderRadius: '16px', fontSize: '0.75rem',
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                border: currentTicker === t ? '1px solid rgba(214,108,174,0.4)' : '1px solid transparent',
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

          <div className="sidebar-widget" style={{ marginTop: '32px' }}>
            <h4>Governance Overview — {currentTicker}</h4>
            <div className="gov-metric" style={{ marginTop: '16px' }}>
              <span className="text-sm text-slate-400">Company</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--text-primary)' }}>{companyName}</span>
            </div>
            <div className="gov-metric" style={{ marginTop: '12px' }}>
              <span className="text-sm text-slate-400">Board Size</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                {boardLoading ? '...' : boardSize ?? '—'}
              </span>
            </div>
            <div className="gov-metric" style={{ marginTop: '12px' }}>
              <span className="text-sm text-slate-400">Independence</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: 'var(--status-success)' }}>
                {boardLoading ? '...' : independence != null ? `${independence}%` : '—'}
              </span>
            </div>
            <div className="gov-metric" style={{ marginTop: '12px' }}>
              <span className="text-sm text-slate-400">CEO Pay Ratio</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--accent-primary)' }}>
                {boardLoading ? '...' : boardData?.ceoPayRatio || '—'}
              </span>
            </div>
          </div>
        </aside>

        <main className="board-main glass-card" style={{ overflow: 'auto' }}>
          {!companyData && !isLoading && (
            <div role="status" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p>Ticker "{currentTicker}" not found in SEC EDGAR. Try any public company ticker (e.g., AAPL, MSFT, GOOGL).</p>
            </div>
          )}

          {boardLoading && (
            <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', gap: '12px' }}>
              <Loader2 size={32} className="spinner" />
              <p style={{ color: 'var(--text-secondary)' }}>AI is analyzing the DEF 14A proxy statement...</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>This may take 15-30 seconds</p>
            </div>
          )}

          {boardError && !boardLoading && (
            <div role="alert" style={{ padding: '40px', textAlign: 'center', color: 'var(--status-error)' }}>
              {boardError}
              <br />
              <button type="button" className="primary-btn sm" style={{ marginTop: '12px' }} onClick={() => fetchData(currentTicker)}>Retry</button>
            </div>
          )}

          {activeTab === 'directors' && companyData && boardData && !boardLoading && (
            <div className="tab-pane fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>Board of Directors — {companyName}</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>AI-extracted from most recent DEF 14A proxy statement.</p>
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>AI extracted</span>
              </div>

              <div className="board-table-scroll" style={{ border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.875rem' }}>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Director Name</th>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Role</th>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Independent</th>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Committees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boardData.directors.map((dir, i) => (
                      <tr key={`${dir.name}-${i}`} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>{dir.name}</td>
                        <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>{dir.role}</td>
                        <td style={{ padding: '16px' }}>
                          {dir.independent ? (
                            <span style={{ background: 'color-mix(in srgb, var(--status-success) 14%, transparent)', color: 'var(--status-success)', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem', border: '1px solid color-mix(in srgb, var(--status-success) 28%, transparent)' }}>Yes</span>
                          ) : (
                            <span style={{ background: 'var(--surface-subtle)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem' }}>No</span>
                          )}
                        </td>
                        <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>{dir.committees.length > 0 ? dir.committees.join(', ') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'diversity' && companyData && boardData && !boardLoading && (
            <div className="tab-pane fade-in">
              <div style={{ marginBottom: '24px' }}>
                <h2>Board Diversity — {companyName}</h2>
                <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>AI-extracted gender breakdown from DEF 14A.</p>
              </div>

              <div className="board-diversity-grid">
                <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--border-color)', padding: '24px', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
                    Gender Identity
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>Total: {boardSize ?? '—'}</span>
                  </h3>
                  <div style={{ display: 'flex', gap: '24px', height: '160px', alignItems: 'flex-end', marginBottom: '8px' }}>
                    {[{ label: 'Male', pct: boardData.diversity.malePercent, color: 'var(--accent-primary)' },
                      { label: 'Female', pct: boardData.diversity.femalePercent, color: 'var(--accent-secondary)' }].map(bar => {
                      const percent = clampPercent(bar.pct);
                      const count = boardSize != null && percent != null ? Math.round(boardSize * percent / 100) : null;
                      return (
                        <div key={bar.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>{count ?? '—'}</span>
                          <div style={{ width: '100%', background: 'var(--surface-subtle)', borderRadius: '6px 6px 0 0', position: 'relative', height: '100%' }}>
                            <div style={{ position: 'absolute', bottom: 0, width: '100%', background: bar.color, borderRadius: '6px 6px 0 0', height: `${percent ?? 0}%`, transition: 'height 0.3s' }}></div>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{bar.label} ({percent != null ? `${percent}%` : 'not disclosed'})</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--border-color)', padding: '24px', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '16px' }}>Key Governance Metrics</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Board Independence</span>
                        <span style={{ fontWeight: 700, color: 'var(--status-success)' }}>{formatPercent(independence)}</span>
                      </div>
                      <div style={{ width: '100%', background: 'var(--surface-subtle)', height: '8px', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div style={{ background: 'var(--status-success)', height: '100%', width: `${independence ?? 0}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Say-on-Pay Approval</span>
                        <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{boardData.sayOnPayApproval}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>CEO Pay Ratio</span>
                        <span style={{ fontWeight: 700, color: 'var(--status-warning)' }}>{boardData.ceoPayRatio}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(179,31,126,0.05)', border: '1px solid rgba(179,31,126,0.2)', borderRadius: '12px', display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                <CheckCircle2 className="text-blue-400" size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Data Source</h4>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>All data AI-extracted from {currentTicker}&apos;s latest DEF 14A proxy statement filed with SEC EDGAR.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'compensation' && companyData && boardData && !boardLoading && (
            <div className="tab-pane fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>Executive Compensation — {companyName}</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Named Executive Officers (NEOs) from DEF 14A proxy statement.</p>
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>AI extracted</span>
              </div>

              <div className="board-table-scroll" style={{ border: '1px solid var(--border-color)', borderRadius: '12px', marginBottom: '32px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.875rem' }}>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>NEO</th>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Title</th>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>Base Salary</th>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>Stock Awards</th>
                      <th scope="col" style={{ padding: '16px', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boardData.compensation.map((d, i) => (
                      <tr key={`${d.name}-${i}`} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>{d.name}</td>
                        <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>{d.title}</td>
                        <td style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'right' }}>{d.salary}</td>
                        <td style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'right' }}>{d.stockAwards}</td>
                        <td style={{ padding: '16px', color: 'var(--text-primary)', fontWeight: 700, textAlign: 'right' }}>{d.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h2 style={{ fontSize: '1.1rem', marginBottom: '16px', marginTop: '8px' }}>Pay vs. Performance (PvP)</h2>
              <div className="board-comp-grid">
                <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-color)', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
                  <h4 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>CEO Pay Ratio</h4>
                  <div style={{ fontSize: '1.875rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: '4px' }}>{boardData.ceoPayRatio}</div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Based on median employee salary</p>
                </div>
                <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-color)', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
                  <h4 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Say-on-Pay Approval</h4>
                  <div style={{ fontSize: '1.875rem', fontFamily: 'var(--font-mono)', color: 'var(--status-success)', marginBottom: '4px' }}>{boardData.sayOnPayApproval}</div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>From latest annual shareholder meeting</p>
                </div>
              </div>
            </div>
          )}

          {/* Multi-company comparison table (shown when 2+ tickers selected) */}
          {compareTickers.length >= 2 && (
            <div style={{ marginTop: '24px', padding: '24px', background: 'var(--surface-subtle)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <BarChart3 size={20} style={{ color: 'var(--accent-primary)' }} />
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Side-by-Side Comparison</h2>
              </div>
              {compareTickers.some(t => compareEntries.get(t)?.loading) && (
                <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.85rem' }}>
                  <Loader2 size={14} className="spinner" /> Loading comparison data...
                </div>
              )}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'auto' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <caption className="sr-only">Board governance comparison for selected companies</caption>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.85rem' }}>
                      <th scope="col" style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Metric</th>
                      {compareTickers.map(t => (
                        <th scope="col" key={t} style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center', borderLeft: '1px solid var(--border-color)' }}>
                          {compareEntries.get(t)?.companyData?.name || t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Board Size', getValue: (bd: BoardDataResult | null) => bd?.boardSize != null ? String(bd.boardSize) : '—' },
                      { label: 'Independence %', getValue: (bd: BoardDataResult | null) => formatPercent(bd?.independencePercent) },
                      { label: 'Female %', getValue: (bd: BoardDataResult | null) => formatPercent(bd?.diversity.femalePercent) },
                      { label: 'CEO Pay Ratio', getValue: (bd: BoardDataResult | null) => bd?.ceoPayRatio || '—' },
                      { label: 'Say-on-Pay Approval', getValue: (bd: BoardDataResult | null) => bd?.sayOnPayApproval || '—' },
                    ].map(metric => (
                      <tr key={metric.label} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                        <th scope="row" style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>{metric.label}</th>
                        {compareTickers.map(t => {
                          const entry = compareEntries.get(t);
                          return (
                            <td key={t} style={{ padding: '12px 16px', textAlign: 'center', borderLeft: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                              {entry?.loading ? <Loader2 size={12} className="spinner" /> : entry?.error ? <span style={{ color: 'var(--status-warning)', fontSize: '0.75rem' }}>{entry.error}</span> : metric.getValue(entry?.boardData || null)}
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
        </main>
      </div>
    </div>
  );
}
