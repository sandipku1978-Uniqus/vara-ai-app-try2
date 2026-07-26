'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { BellRing, Clock, Eye, FileText, Loader2, RefreshCw, Search as SearchIcon, TrendingUp, X } from 'lucide-react';
import { useApp } from '../context/AppState';
import { BRAND } from '../config/brand';
import { executeFilingResearchSearch } from '../services/filingResearch';
import { fetchCompanySubmissions, type SecSubmission, lookupCIK } from '../services/secApi';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import { describeForm } from '../lib/formLabels';
import { buildResearchRouteParams } from '../services/researchSessions';
import { BOOLEAN_ENGINE_VERSION } from '../utils/booleanSearch';
import { buildWatchlistAnalytics } from '../services/dashboardAnalytics';
import { buildSavedAlertRouteParams } from '../services/alertRoutes';
import './Dashboard.css';

const CHART_COLORS = ['#B31F7E', '#482A7A', '#E8B15E', '#247BA0', '#3A8D5D', '#D65A4A'];

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
  const [dataStats, setDataStats] = useState<{
    filings: { count: number; through: string | null; source: string };
    auditors: { count: number; source: string };
    letters: { count: number; withText: number; source: string };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then(response => (response.ok ? response.json() : null))
      .then(payload => { if (!cancelled && payload && !payload.error) setDataStats(payload); })
      .catch(() => { /* chips are optional trust signals, never blockers */ });
    return () => { cancelled = true; };
  }, []);

  const [watchlistData, setWatchlistData] = useState<Record<string, SecSubmission>>({});
  const [loadingWatchlist, setLoadingWatchlist] = useState(false);
  const [filingVolumeData, setFilingVolumeData] = useState<Record<string, string | number | null>[]>([]);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [checkingAlerts, setCheckingAlerts] = useState<string[]>([]);
  const [alertErrors, setAlertErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function loadWatchlist() {
      setLoadingWatchlist(true);
      const newMap: Record<string, SecSubmission> = {};

      for (const ticker of watchlist) {
        try {
          const cik = await lookupCIK(ticker);
          if (!cik) continue;
          const data = await fetchCompanySubmissions(cik);
          if (data) newMap[ticker] = data;
        } catch {
          // Missing issuers are surfaced below as unavailable, not zero-volume.
        }
      }

      if (!cancelled) {
        setWatchlistData(newMap);
        setLoadingWatchlist(false);
      }
    }

    void loadWatchlist();
    return () => { cancelled = true; };
  }, [watchlist]);

  useEffect(() => {
    if (loadingWatchlist) {
      setVolumeLoading(true);
      return;
    }

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    setFilingVolumeData(buildWatchlistAnalytics(watchlist, watchlistData, currentYear, currentMonth).filingVolumeData);
    setVolumeLoading(false);
  }, [loadingWatchlist, watchlist, watchlistData]);

  const filingMix = useMemo(() => {
    return buildWatchlistAnalytics(
      watchlist,
      watchlistData,
      new Date().getFullYear(),
      new Date().getMonth()
    ).filingMix;
  }, [watchlist, watchlistData]);

  const unavailableWatchlistTickers = useMemo(
    () => watchlist.filter(ticker => !watchlistData[ticker]),
    [watchlist, watchlistData]
  );

  const handleAddCompany = (ticker: string) => {
    const upper = ticker.toUpperCase().trim();
    if (!upper) return;
    if (watchlist.includes(upper)) {
      setAddError('Already in watchlist.');
      return;
    }
    setAddError('');
    addToWatchlist(upper);
  };

  const checkAlert = async (alertId: string) => {
    const alert = savedAlerts.find(item => item.id === alertId);
    if (!alert) return;

    setCheckingAlerts(prev => [...prev, alertId]);
    setAlertErrors(prev => {
      const next = { ...prev };
      delete next[alertId];
      return next;
    });
    try {
      const results = await executeFilingResearchSearch({
        query: alert.query,
        filters: alert.filters,
        mode: alert.mode,
        defaultForms: alert.defaultForms,
        limit: 20,
      });

      const accessions = results.map(result => result.accessionNumber);
      // The v2 Boolean engine legitimately recalls a different set than the one
      // that produced lastSeenAccessions (independent OR branches, plural and
      // punctuation matching, token-bounded phrases). Treat the first check
      // after a version change as a re-baseline so long-known filings are not
      // announced as new; genuine new filings surface from the next check on.
      const isReBaseline = (alert.engineVersion ?? 1) !== BOOLEAN_ENGINE_VERSION;
      const latestNewAccessions = isReBaseline
        ? []
        : accessions.filter(accession => !alert.lastSeenAccessions.includes(accession));

      updateSavedAlert(alert.id, {
        lastCheckedAt: new Date().toISOString(),
        lastSeenAccessions: accessions,
        latestNewAccessions,
        latestResultCount: results.length,
        engineVersion: BOOLEAN_ENGINE_VERSION,
      });
    } catch (error) {
      console.error('Alert check failed:', error);
      setAlertErrors(prev => ({
        ...prev,
        [alertId]: 'This saved search could not be checked. Existing counts were not replaced; retry when the SEC search is available.',
      }));
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

    // Sequential, not Promise.all: each Boolean run now carries its own request
    // budget (60 pages / 120 documents), so three concurrent broad searches on
    // Dashboard load could exceed the /api/sec-proxy limit and self-inflict 429s.
    void (async () => {
      for (const alert of staleAlerts.slice(0, 3)) {
        await checkAlert(alert.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAlerts.length]);

  return (
    <div className="dashboard-container">
      <header className="page-header">
        <h1>Overview Dashboard</h1>
        <p>{BRAND.productName} monitoring and benchmarking workspace.</p>
        {dataStats && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
            {[
              `Filings: ${dataStats.filings.count.toLocaleString()} through ${dataStats.filings.through ?? '—'} · ${dataStats.filings.source}`,
              `Auditors: ${dataStats.auditors.count.toLocaleString()} engagements · ${dataStats.auditors.source}`,
              `Comment letters: ${dataStats.letters.count.toLocaleString()} (${dataStats.letters.withText.toLocaleString()} full-text) · ${dataStats.letters.source}`,
            ].map(chip => (
              <span key={chip} style={{
                fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--surface-subtle)',
                border: '1px solid var(--input-border)', borderRadius: '4px', padding: '3px 8px',
              }}>
                {chip}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="dashboard-grid">
        <section className="glass-card chart-card">
          <div className="card-header">
            <h3>Watchlist Filing Volume (YTD){watchlist.length > CHART_COLORS.length ? ` — first ${CHART_COLORS.length}` : ''}</h3>
            <span className="badge">SEC EDGAR Live{watchlist.length > CHART_COLORS.length ? ` · ${CHART_COLORS.length}/${watchlist.length} plotted` : ''}</span>
          </div>
          {!volumeLoading && unavailableWatchlistTickers.length > 0 && (
            <div role="alert" style={{ color: 'var(--status-warning)', fontSize: '0.78rem', marginBottom: '8px' }}>
              Live EDGAR data was unavailable for {unavailableWatchlistTickers.join(', ')} in this refresh; those chart series are gaps, not zero filings.
            </div>
          )}
          <div className="chart-container">
            {volumeLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px', color: 'var(--text-muted)' }}>
                <Loader2 size={16} className="spinner" /> Loading filing volume from EDGAR...
              </div>
            ) : watchlist.length === 0 ? (
              <div className="empty-state">Add companies to your watchlist to chart their live filing volume.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filingVolumeData} margin={{ top: 5, right: 20, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="month" stroke="var(--chart-text)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--chart-text)" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', borderColor: 'var(--chart-tooltip-border)', borderRadius: '4px' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                  />
                  {watchlist.slice(0, CHART_COLORS.length).map((ticker, index) => (
                    <Line key={ticker} type="monotone" dataKey={ticker} stroke={CHART_COLORS[index]} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="glass-card trending-card">
          <div className="card-header">
            <h3>Watchlist Filing Mix (YTD)</h3>
            <TrendingUp size={18} className="text-blue" />
          </div>
          <div className="trending-list">
            {filingMix.map((item, idx) => (
              <button
                type="button"
                key={item.form}
                className="trending-item"
                onClick={() => {
                  const params = buildResearchRouteParams('', 'semantic', {
                    ...defaultSearchFilters,
                    formTypes: [item.form],
                  });
                  navigate.push(`/search?${params.toString()}`);
                }}
                style={{ cursor: 'pointer' }}
              >
                <span className="rank">#{idx + 1}</span>
                <span className="topic">
                  {/* A bare numeric form code ("4", "144") reads as a count
                      beside "90 filings" — name it as a form. */}
                  {/^\d+$/.test(item.form) ? `Form ${item.form}` : item.form}
                  {describeForm(item.form) && (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}>
                      {' '}· {describeForm(item.form)}
                    </span>
                  )}
                </span>
                <span className="count">{item.count} filing{item.count === 1 ? '' : 's'}</span>
              </button>
            ))}
            {!loadingWatchlist && filingMix.length === 0 && (
              <div className="empty-state">
                {watchlist.length > 0 && unavailableWatchlistTickers.length === watchlist.length
                  ? 'Live EDGAR watchlist data is unavailable for this refresh; retry by reopening the Dashboard.'
                  : 'No watchlist filings are available for the current year.'}
              </div>
            )}
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
                  <button type="button" className="company-info" onClick={() => navigate.push(`/search?q=${ticker}`)} aria-label={`Research ${companyName}`}>
                    <div className="company-logo-stub">{ticker[0]}</div>
                    <div>
                      <div className="company-name">{companyName}</div>
                      <div className="company-ticker">{ticker} {industry ? `| ${industry}` : ''}</div>
                    </div>
                  </button>
                  <div className="latest-filing">
                    {latestForm
                      ? <span className="f-badge">{latestForm}</span>
                      : <span className="text-muted">{secData ? 'No recent' : 'Data unavailable'}</span>}
                    {latestDate && <span className="f-date">{latestDate}</span>}
                    <button
                      type="button"
                      className="watchlist-remove-btn"
                      title="Remove from watchlist"
                      aria-label={`Remove ${ticker} from watchlist`}
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
              <div className="watchlist-add-hint">
                <CompanySearchInput
                  onSelect={ticker => handleAddCompany(ticker)}
                  placeholder="Add ticker or company name..."
                />
              </div>
            )}
            {addError && <div role="alert" style={{ color: 'var(--status-warning)', fontSize: '0.8rem', marginTop: '4px', paddingLeft: '8px' }}>{addError}</div>}
          </div>
        </section>

        <section className="glass-card activity-card">
          <div className="card-header">
            <h3>Recent Filings</h3>
            <Clock size={18} className="text-blue" />
          </div>
          <div className="recent-filings-ledger">
            <div className="recent-filings-columns" aria-hidden="true">
              <span>Form</span>
              <span>Issuer</span>
              <span>Event</span>
              <span>Date</span>
            </div>
            {loadingWatchlist && <div className="text-muted"><Loader2 size={16} className="spinner" /> Loading...</div>}
            {!loadingWatchlist && (() => {
              const recentFilings: { ticker: string; issuer: string; form: string; date: string }[] = [];

              for (const ticker of watchlist) {
                const secData = watchlistData[ticker];
                if (!secData) continue;
                const recent = secData.filings.recent;
                for (let i = 0; i < Math.min(3, recent.form.length); i += 1) {
                  recentFilings.push({
                    ticker,
                    issuer: secData.name || ticker,
                    form: recent.form[i],
                    date: recent.filingDate[i],
                  });
                }
              }

              recentFilings.sort((a, b) => b.date.localeCompare(a.date));
              const display = recentFilings.slice(0, 5);

              if (display.length === 0) {
                return (
                  <div className="empty-state">
                    {watchlist.length === 0
                      ? 'Add companies to your watchlist to see recent filings.'
                      : unavailableWatchlistTickers.length === watchlist.length
                        ? 'Live EDGAR watchlist data is unavailable for this refresh.'
                        : 'No recent filings were returned for the loaded watchlist companies.'}
                  </div>
                );
              }

              return display.map((filing, idx) => (
                <button
                  type="button"
                  key={`${filing.ticker}-${filing.form}-${filing.date}-${idx}`}
                  className="recent-filing-row"
                  onClick={() => navigate.push(`/search?q=${filing.ticker}`)}
                >
                  <span className="recent-filing-form">
                    <FileText size={14} className={filing.form === '8-K' ? 'text-orange' : 'text-blue'} aria-hidden="true" />
                    <span className="f-badge">{filing.form}</span>
                  </span>
                  <span className="recent-filing-issuer">
                    <strong>{filing.ticker}</strong>
                    <span title={filing.issuer}>{filing.issuer}</span>
                  </span>
                  <span className="recent-filing-event">{describeForm(filing.form) || 'SEC filing'}</span>
                  <time className="recent-filing-date" dateTime={filing.date}>{filing.date}</time>
                </button>
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
                <h4 className="rss-headline">Create a local saved filing search from the Research Workbench</h4>
                <p className="rss-summary">Saved searches persist in this browser and are checked manually or while this dashboard is open; they do not run as scheduled background notifications.</p>
                <button className="secondary-btn" onClick={() => navigate.push('/search')}>
                  <BellRing size={14} /> Open Research
                </button>
              </div>
            ) : (
              savedAlerts.slice(0, 3).map(alert => {
                const isChecking = checkingAlerts.includes(alert.id);
                const checkError = alertErrors[alert.id];
                return (
                  <div key={alert.id} className="rss-news-card">
                    <div className="rss-timestamp">
                      {alert.lastCheckedAt ? `Last checked ${new Date(alert.lastCheckedAt).toLocaleString()}` : 'Not checked yet'}
                    </div>
                    <h4 className="rss-headline">{alert.name}</h4>
                    <p className="rss-summary">
                      {checkError
                        ? <span role="alert" style={{ color: 'var(--status-error)' }}>{checkError}</span>
                        : alert.latestNewAccessions.length > 0
                        ? `${alert.latestNewAccessions.length} new filing${alert.latestNewAccessions.length === 1 ? '' : 's'} detected.`
                        : `${alert.latestResultCount} current match${alert.latestResultCount === 1 ? '' : 'es'} in scope.`}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                      <button
                        className="secondary-btn"
                        onClick={() => {
                          const params = buildSavedAlertRouteParams(alert);
                          navigate.push(`/search?${params.toString()}`);
                        }}
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
