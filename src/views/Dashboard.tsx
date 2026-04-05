'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { BellRing, Clock, Eye, FileText, Loader2, Plus, RefreshCw, Search as SearchIcon, TrendingUp, X } from 'lucide-react';
import { useApp } from '../context/AppState';
import { BRAND } from '../config/brand';
import { executeFilingResearchSearch } from '../services/filingResearch';
import { countFilingsByMonth, fetchCompanySubmissions, type SecSubmission, lookupCIK } from '../services/secApi';
import './Dashboard.css';

const INDUSTRY_TICKERS: Record<string, string[]> = {
  Tech: ['AAPL', 'MSFT', 'NVDA'],
  Financials: ['JPM'],
  Auto: ['TSLA'],
};

export default function Dashboard() {
  const {
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    savedAlerts,
    updateSavedAlert,
    removeSavedAlert,
  } = useApp();
  const navigate = useRouter();

  const [watchlistData, setWatchlistData] = useState<Record<string, SecSubmission>>({});
  const [loadingWatchlist, setLoadingWatchlist] = useState(false);
  const [filingVolumeData, setFilingVolumeData] = useState<Record<string, string | number>[]>([]);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [addTickerInput, setAddTickerInput] = useState('');
  const [addError, setAddError] = useState('');
  const [checkingAlerts, setCheckingAlerts] = useState<string[]>([]);

  useEffect(() => {
    async function loadWatchlist() {
      setLoadingWatchlist(true);
      const newMap: Record<string, SecSubmission> = {};

      for (const ticker of watchlist) {
        const cik = await lookupCIK(ticker);
        if (!cik) continue;
        const data = await fetchCompanySubmissions(cik);
        if (data) newMap[ticker] = data;
      }

      setWatchlistData(newMap);
      setLoadingWatchlist(false);
    }

    void loadWatchlist();
  }, [watchlist]);

  useEffect(() => {
    async function loadFilingVolume() {
      setVolumeLoading(true);
      const currentYear = new Date().getFullYear();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const industryCounts: Record<string, Record<string, number>> = {};

      for (const [industry, tickers] of Object.entries(INDUSTRY_TICKERS)) {
        industryCounts[industry] = {};
        months.forEach(month => {
          industryCounts[industry][month] = 0;
        });

        for (const ticker of tickers) {
          const cik = await lookupCIK(ticker);
          if (!cik) continue;
          const submissions = await fetchCompanySubmissions(cik);
          if (!submissions) continue;
          const counts = countFilingsByMonth(submissions, currentYear);
          for (const month of months) {
            industryCounts[industry][month] += counts[month] || 0;
          }
        }
      }

      const currentMonth = new Date().getMonth();
      const chartData = months.slice(0, currentMonth + 1).map(month => {
        const row: Record<string, string | number> = { month };
        for (const industry of Object.keys(INDUSTRY_TICKERS)) {
          row[industry] = industryCounts[industry][month] || 0;
        }
        return row;
      });

      setFilingVolumeData(chartData);
      setVolumeLoading(false);
    }

    void loadFilingVolume();
  }, []);

  const trendingTopics = [
    { topic: 'Artificial Intelligence', count: 'Trending' },
    { topic: 'Cybersecurity Risk', count: 'Trending' },
    { topic: 'Lease Accounting Adoption', count: 'Accounting' },
    { topic: 'Derivative Disclosure', count: 'Search' },
    { topic: 'Climate Disclosure', count: 'Trending' },
  ];

  const handleAddTicker = async () => {
    const ticker = addTickerInput.toUpperCase().trim();
    if (!ticker) return;
    if (watchlist.includes(ticker)) {
      setAddError('Already in watchlist.');
      return;
    }

    setAddError('');
    const cik = await lookupCIK(ticker);
    if (!cik) {
      setAddError(`Ticker "${ticker}" not found in SEC EDGAR.`);
      return;
    }

    addToWatchlist(ticker);
    setAddTickerInput('');
  };

  const checkAlert = async (alertId: string) => {
    const alert = savedAlerts.find(item => item.id === alertId);
    if (!alert) return;

    setCheckingAlerts(prev => [...prev, alertId]);
    try {
      const results = await executeFilingResearchSearch({
        query: alert.query,
        filters: alert.filters,
        mode: alert.mode,
        defaultForms: alert.defaultForms,
        limit: 20,
      });

      const accessions = results.map(result => result.accessionNumber);
      const latestNewAccessions = accessions.filter(accession => !alert.lastSeenAccessions.includes(accession));

      updateSavedAlert(alert.id, {
        lastCheckedAt: new Date().toISOString(),
        lastSeenAccessions: accessions,
        latestNewAccessions,
        latestResultCount: results.length,
      });
    } catch (error) {
      console.error('Alert check failed:', error);
    } finally {
      setCheckingAlerts(prev => prev.filter(id => id !== alertId));
    }
  };

  useEffect(() => {
    const staleAlerts = savedAlerts.filter(alert => {
      if (!alert.lastCheckedAt) return true;
      return Date.now() - new Date(alert.lastCheckedAt).getTime() > 1000 * 60 * 30;
    });

    if (staleAlerts.length === 0) return;

    void Promise.all(staleAlerts.slice(0, 3).map(alert => checkAlert(alert.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAlerts.length]);

  return (
    <div className="dashboard-container">
      <header className="page-header">
        <h1>Overview Dashboard</h1>
        <p>{BRAND.productName} monitoring and benchmarking workspace.</p>
      </header>

      <div className="dashboard-grid">
        <section className="glass-card chart-card">
          <div className="card-header">
            <h3>Filing Volume by Industry (YTD)</h3>
            <span className="badge">SEC EDGAR Live</span>
          </div>
          <div className="chart-container">
            {volumeLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px', color: 'var(--text-muted)' }}>
                <Loader2 size={16} className="spinner" /> Loading filing volume from EDGAR...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filingVolumeData} margin={{ top: 5, right: 20, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(72, 42, 122, 0.08)" />
                  <XAxis dataKey="month" stroke="#8F8390" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8F8390" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: 'var(--surface-panel-strong)', borderColor: 'rgba(72, 42, 122, 0.16)', borderRadius: '16px' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                  />
                  <Line type="monotone" dataKey="Tech" stroke="#B31F7E" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="Financials" stroke="#482A7A" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="Auto" stroke="#E8B15E" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="glass-card trending-card">
          <div className="card-header">
            <h3>Top Research Themes</h3>
            <TrendingUp size={18} className="text-blue" />
          </div>
          <div className="trending-list">
            {trendingTopics.map((item, idx) => (
              <div
                key={idx}
                className="trending-item"
                onClick={() => navigate.push(`/search?q=${encodeURIComponent(item.topic)}`)}
                style={{ cursor: 'pointer' }}
              >
                <span className="rank">#{idx + 1}</span>
                <span className="topic">{item.topic}</span>
                <span className="count">{item.count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-card watchlist-card">
          <div className="card-header">
            <h3>My Watchlist</h3>
            <Eye size={18} className="text-blue" />
          </div>
          <div className="watchlist-list">
            {loadingWatchlist && <div className="text-muted"><Loader2 size={16} className="spinner" /> Loading live EDGAR data...</div>}
            {!loadingWatchlist && watchlist.map(ticker => {
              const secData = watchlistData[ticker];
              const latestForm = secData?.filings.recent.form[0];
              const latestDate = secData?.filings.recent.filingDate[0];
              const companyName = secData?.name || ticker;
              const industry = secData?.sicDescription || '';

              return (
                <div key={ticker} className="watchlist-item">
                  <div className="company-info" onClick={() => navigate.push(`/search?q=${ticker}`)} style={{ cursor: 'pointer', flex: 1 }}>
                    <div className="company-logo-stub">{ticker[0]}</div>
                    <div>
                      <div className="company-name">{companyName}</div>
                      <div className="company-ticker">{ticker} {industry ? `| ${industry}` : ''}</div>
                    </div>
                  </div>
                  <div className="latest-filing">
                    {latestForm ? <span className="f-badge">{latestForm}</span> : <span className="text-muted">No recent</span>}
                    {latestDate && <span className="f-date">{latestDate}</span>}
                    <button
                      className="watchlist-remove-btn"
                      title="Remove from watchlist"
                      onClick={event => {
                        event.stopPropagation();
                        removeFromWatchlist(ticker);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            {!loadingWatchlist && watchlist.length === 0 && (
              <div className="empty-state">No companies in watchlist yet.</div>
            )}
            {!loadingWatchlist && (
              <div className="watchlist-add-hint" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Enter ticker..."
                  value={addTickerInput}
                  onChange={event => {
                    setAddTickerInput(event.target.value);
                    setAddError('');
                  }}
                  onKeyDown={event => event.key === 'Enter' && void handleAddTicker()}
                  style={{ flex: 1, padding: '9px 12px', borderRadius: '12px', border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                />
                <button className="watchlist-add-btn" onClick={() => void handleAddTicker()}>
                  <Plus size={14} /> Add
                </button>
              </div>
            )}
            {addError && <div style={{ color: '#B76B21', fontSize: '0.8rem', marginTop: '4px', paddingLeft: '8px' }}>{addError}</div>}
          </div>
        </section>

        <section className="glass-card activity-card">
          <div className="card-header">
            <h3>Recent Filings</h3>
            <Clock size={18} className="text-blue" />
          </div>
          <div className="activity-list">
            {loadingWatchlist && <div className="text-muted"><Loader2 size={16} className="spinner" /> Loading...</div>}
            {!loadingWatchlist && (() => {
              const recentFilings: { ticker: string; form: string; date: string }[] = [];

              for (const ticker of watchlist) {
                const secData = watchlistData[ticker];
                if (!secData) continue;
                const recent = secData.filings.recent;
                for (let i = 0; i < Math.min(3, recent.form.length); i += 1) {
                  recentFilings.push({
                    ticker,
                    form: recent.form[i],
                    date: recent.filingDate[i],
                  });
                }
              }

              recentFilings.sort((a, b) => b.date.localeCompare(a.date));
              const display = recentFilings.slice(0, 5);

              if (display.length === 0) {
                return <div className="empty-state">Add companies to your watchlist to see recent filings.</div>;
              }

              return display.map((filing, idx) => (
                <div key={idx} className="activity-item" onClick={() => navigate.push(`/search?q=${filing.ticker}`)} style={{ cursor: 'pointer' }}>
                  <FileText size={16} className={filing.form === '8-K' ? 'text-orange' : 'text-blue'} />
                  <div className="activity-details">
                    <p><strong>{filing.ticker}</strong> filed <strong>{filing.form}</strong></p>
                    <span>{filing.date}</span>
                  </div>
                </div>
              ));
            })()}
          </div>
        </section>

        <section className="glass-card rss-card">
          <div className="card-header">
            <h3>Alert Center</h3>
            <span className="badge">Saved Searches</span>
          </div>
          <div className="rss-grid">
            {savedAlerts.length === 0 ? (
              <div className="rss-news-card" style={{ gridColumn: '1 / -1' }}>
                <div className="rss-timestamp">No alerts saved</div>
                <h4 className="rss-headline">Create a recurring filing search from the Research Workbench</h4>
                <p className="rss-summary">Alerts persist locally, can be checked for new filings, and make recurring accounting or disclosure research much easier to monitor.</p>
                <button className="secondary-btn" onClick={() => navigate.push('/search')}>
                  <BellRing size={14} /> Open Research
                </button>
              </div>
            ) : (
              savedAlerts.slice(0, 3).map(alert => {
                const isChecking = checkingAlerts.includes(alert.id);
                return (
                  <div key={alert.id} className="rss-news-card">
                    <div className="rss-timestamp">
                      {alert.lastCheckedAt ? `Last checked ${new Date(alert.lastCheckedAt).toLocaleString()}` : 'Not checked yet'}
                    </div>
                    <h4 className="rss-headline">{alert.name}</h4>
                    <p className="rss-summary">
                      {alert.latestNewAccessions.length > 0
                        ? `${alert.latestNewAccessions.length} new filing${alert.latestNewAccessions.length === 1 ? '' : 's'} detected.`
                        : `${alert.latestResultCount} current match${alert.latestResultCount === 1 ? '' : 'es'} in scope.`}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                      <button
                        className="secondary-btn"
                        onClick={() => navigate.push(`/search?q=${encodeURIComponent(alert.query)}`)}
                      >
                        <SearchIcon size={14} /> Open
                      </button>
                      <button className="secondary-btn" onClick={() => void checkAlert(alert.id)} disabled={isChecking}>
                        {isChecking ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />} Check Now
                      </button>
                      <button className="secondary-btn" onClick={() => removeSavedAlert(alert.id)}>
                        <X size={14} /> Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

