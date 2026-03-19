import { useState, useEffect, useCallback } from 'react';
import { Users, PieChart, DollarSign, Search, CheckCircle2, Loader2 } from 'lucide-react';
import { fetchCompanySubmissions, lookupCIK, findLatestFiling, fetchFilingText, SecSubmission } from '../services/secApi';
import { aiExtractBoardData, BoardDataResult } from '../services/geminiApi';
import './BoardProfiles.css';

// Module-level cache for board data
const boardDataCache = new Map<string, BoardDataResult>();

export default function BoardProfiles() {
  const [activeTab, setActiveTab] = useState<'directors' | 'diversity' | 'compensation'>('directors');
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [currentTicker, setCurrentTicker] = useState('AAPL');
  const [companyData, setCompanyData] = useState<SecSubmission | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [boardData, setBoardData] = useState<BoardDataResult | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState('');

  const fetchData = useCallback(async (ticker: string) => {
    setIsLoading(true);
    setBoardError('');
    const cik = await lookupCIK(ticker.toUpperCase());
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

  useEffect(() => {
    fetchData(currentTicker);
  }, [currentTicker, fetchData]);

  const handleTickerSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tickerInput.trim()) {
      setCurrentTicker(tickerInput.trim().toUpperCase());
    }
  };

  const companyName = companyData?.name || currentTicker;
  const boardSize = boardData?.boardSize || 0;
  const independence = boardData?.independencePercent || 0;

  return (
    <div className="board-container">
      <div className="board-header">
        <div className="board-title">
          <h1>Board Profiles & Executive Compensation</h1>
          <p>AI-extracted governance structures, board diversity metrics, and compensation analytics from DEF 14A proxy statements.</p>
        </div>

        <div className="ticker-selector glass-card" style={{ padding: '4px 16px', display: 'flex', alignItems: 'center', borderRadius: '12px', border: '1px solid #334155' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#94A3B8', marginRight: '12px' }}>Target Company:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#0F172A', padding: '6px 12px', borderRadius: '4px', border: '1px solid #334155' }}>
            <Search size={14} className="text-blue-400" />
            <input
              type="text"
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={handleTickerSearch}
              placeholder="Enter ticker..."
              style={{ background: 'transparent', border: 'none', outline: 'none', width: '80px', color: 'white', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
            />
          </div>
          {(isLoading || boardLoading) && <Loader2 size={16} className="spinner" style={{ marginLeft: '8px' }} />}
        </div>
      </div>

      <div className="board-layout">
        <aside className="board-sidebar glass-card">
          <nav className="board-nav">
            <button className={`nav-btn ${activeTab === 'directors' ? 'active' : ''}`} onClick={() => setActiveTab('directors')}>
              <Users size={18} /> Director Profiles
            </button>
            <button className={`nav-btn ${activeTab === 'diversity' ? 'active' : ''}`} onClick={() => setActiveTab('diversity')}>
              <PieChart size={18} /> Board Diversity
            </button>
            <button className={`nav-btn ${activeTab === 'compensation' ? 'active' : ''}`} onClick={() => setActiveTab('compensation')}>
              <DollarSign size={18} /> Executive Comp (PvP)
            </button>
          </nav>

          <div className="sidebar-widget" style={{ marginTop: '32px' }}>
            <h4>Governance Overview — {currentTicker}</h4>
            <div className="gov-metric" style={{ marginTop: '16px' }}>
              <span className="text-sm text-slate-400">Company</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'white' }}>{companyName}</span>
            </div>
            <div className="gov-metric" style={{ marginTop: '12px' }}>
              <span className="text-sm text-slate-400">Board Size</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: 'white' }}>
                {boardLoading ? '...' : boardData ? boardSize : '—'}
              </span>
            </div>
            <div className="gov-metric" style={{ marginTop: '12px' }}>
              <span className="text-sm text-slate-400">Independence</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', color: '#4ADE80' }}>
                {boardLoading ? '...' : boardData ? `${independence}%` : '—'}
              </span>
            </div>
            <div className="gov-metric" style={{ marginTop: '12px' }}>
              <span className="text-sm text-slate-400">CEO Pay Ratio</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#60A5FA' }}>
                {boardLoading ? '...' : boardData?.ceoPayRatio || '—'}
              </span>
            </div>
          </div>
        </aside>

        <main className="board-main glass-card" style={{ overflow: 'auto' }}>
          {!companyData && !isLoading && (
            <div style={{ padding: '48px', textAlign: 'center', color: '#64748B' }}>
              <p>Ticker "{currentTicker}" not found in SEC EDGAR. Try any public company ticker (e.g., AAPL, MSFT, GOOGL).</p>
            </div>
          )}

          {boardLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', gap: '12px' }}>
              <Loader2 size={32} className="spinner" />
              <p style={{ color: '#94A3B8' }}>AI is analyzing the DEF 14A proxy statement...</p>
              <p style={{ color: '#64748B', fontSize: '0.8rem' }}>This may take 15-30 seconds</p>
            </div>
          )}

          {boardError && !boardLoading && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#F59E0B' }}>
              {boardError}
              <br />
              <button className="primary-btn sm" style={{ marginTop: '12px' }} onClick={() => fetchData(currentTicker)}>Retry</button>
            </div>
          )}

          {activeTab === 'directors' && companyData && boardData && !boardLoading && (
            <div className="tab-pane fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>Board of Directors — {companyName}</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>AI-extracted from most recent DEF 14A proxy statement.</p>
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>Gemini AI Extracted</span>
              </div>

              <div style={{ border: '1px solid rgba(51,65,85,0.5)', borderRadius: '12px', overflow: 'hidden' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#0F172A', borderBottom: '1px solid rgba(51,65,85,0.5)', fontSize: '0.875rem' }}>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Director Name</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Role</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Independent</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Committees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boardData.directors.map((dir, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(51,65,85,0.3)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '16px', fontWeight: 500, color: 'white' }}>{dir.name}</td>
                        <td style={{ padding: '16px', color: '#CBD5E1' }}>{dir.role}</td>
                        <td style={{ padding: '16px' }}>
                          {dir.independent ? (
                            <span style={{ background: 'rgba(22,163,74,0.15)', color: '#4ADE80', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem', border: '1px solid rgba(22,163,74,0.2)' }}>Yes</span>
                          ) : (
                            <span style={{ background: '#1E293B', color: '#94A3B8', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem' }}>No</span>
                          )}
                        </td>
                        <td style={{ padding: '16px', color: '#94A3B8' }}>{dir.committees.length > 0 ? dir.committees.join(', ') : '—'}</td>
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

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
                <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid #334155', padding: '24px', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '0.875rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
                    Gender Identity
                    <span style={{ color: '#60A5FA', fontWeight: 700 }}>Total: {boardSize}</span>
                  </h3>
                  <div style={{ display: 'flex', gap: '24px', height: '160px', alignItems: 'flex-end', marginBottom: '8px' }}>
                    {[{ label: 'Male', pct: boardData.diversity.malePercent, color: '#3B82F6' },
                      { label: 'Female', pct: boardData.diversity.femalePercent, color: '#A855F7' }].map(bar => {
                      const count = Math.round(boardSize * bar.pct / 100);
                      return (
                        <div key={bar.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>{count}</span>
                          <div style={{ width: '100%', background: '#1E293B', borderRadius: '6px 6px 0 0', position: 'relative', height: '100%' }}>
                            <div style={{ position: 'absolute', bottom: 0, width: '100%', background: bar.color, borderRadius: '6px 6px 0 0', height: `${bar.pct}%`, transition: 'height 0.3s' }}></div>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{bar.label} ({bar.pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid #334155', padding: '24px', borderRadius: '12px' }}>
                  <h3 style={{ fontSize: '0.875rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.025em', marginBottom: '16px' }}>Key Governance Metrics</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: '#CBD5E1' }}>Board Independence</span>
                        <span style={{ fontWeight: 700, color: '#4ADE80' }}>{independence}%</span>
                      </div>
                      <div style={{ width: '100%', background: '#1E293B', height: '8px', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div style={{ background: '#4ADE80', height: '100%', width: `${independence}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: '#CBD5E1' }}>Say-on-Pay Approval</span>
                        <span style={{ fontWeight: 700, color: '#60A5FA' }}>{boardData.sayOnPayApproval}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                        <span style={{ color: '#CBD5E1' }}>CEO Pay Ratio</span>
                        <span style={{ fontWeight: 700, color: '#FB923C' }}>{boardData.ceoPayRatio}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '12px', display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                <CheckCircle2 className="text-blue-400" size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#DBEAFE', marginBottom: '4px' }}>Data Source</h4>
                  <p style={{ fontSize: '0.875rem', color: 'rgba(191,219,254,0.7)' }}>All data AI-extracted from {currentTicker}'s latest DEF 14A proxy statement filed with SEC EDGAR.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'compensation' && companyData && boardData && !boardLoading && (
            <div className="tab-pane fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>Executive Compensation — {companyName}</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Named Executive Officers (NEOs) from DEF 14A proxy statement.</p>
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>Gemini AI Extracted</span>
              </div>

              <div style={{ border: '1px solid rgba(51,65,85,0.5)', borderRadius: '12px', overflow: 'hidden', marginBottom: '32px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#0F172A', borderBottom: '1px solid rgba(51,65,85,0.5)', fontSize: '0.875rem' }}>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>NEO</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Title</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1', textAlign: 'right' }}>Base Salary</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1', textAlign: 'right' }}>Stock Awards</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: 'white', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boardData.compensation.map((d, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(51,65,85,0.3)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '16px', fontWeight: 500, color: 'white' }}>{d.name}</td>
                        <td style={{ padding: '16px', color: '#94A3B8' }}>{d.title}</td>
                        <td style={{ padding: '16px', color: '#CBD5E1', textAlign: 'right' }}>{d.salary}</td>
                        <td style={{ padding: '16px', color: '#CBD5E1', textAlign: 'right' }}>{d.stockAwards}</td>
                        <td style={{ padding: '16px', color: 'white', fontWeight: 700, textAlign: 'right' }}>{d.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h2 style={{ fontSize: '1.1rem', marginBottom: '16px', marginTop: '8px' }}>Pay vs. Performance (PvP)</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
                <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid #334155', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
                  <h4 style={{ fontSize: '0.75rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>CEO Pay Ratio</h4>
                  <div style={{ fontSize: '1.875rem', fontFamily: 'var(--font-mono)', color: 'white', marginBottom: '4px' }}>{boardData.ceoPayRatio}</div>
                  <p style={{ fontSize: '0.75rem', color: '#64748B' }}>Based on median employee salary</p>
                </div>
                <div style={{ background: 'rgba(30,41,59,0.5)', border: '1px solid #334155', padding: '20px', borderRadius: '12px', textAlign: 'center' }}>
                  <h4 style={{ fontSize: '0.75rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Say-on-Pay Approval</h4>
                  <div style={{ fontSize: '1.875rem', fontFamily: 'var(--font-mono)', color: '#4ADE80', marginBottom: '4px' }}>{boardData.sayOnPayApproval}</div>
                  <p style={{ fontSize: '0.75rem', color: '#64748B' }}>From latest annual shareholder meeting</p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
