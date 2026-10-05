'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { Bookmark, Clock, Eye, FileText, Loader2, TrendingUp, X } from 'lucide-react';
import { useApp } from '../context/AppState';
import { BRAND } from '../config/brand';
import { fetchCompanySubmissions, type SecSubmission, lookupCIK } from '../services/secApi';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import ProjectSelector from '../components/projects/ProjectSelector';
import SearchJobsCard from '../components/research/SearchJobsCard';
import { describeForm } from '../lib/formLabels';
import { buildResearchRouteParams } from '../services/researchSessions';
import { buildWatchlistAnalytics } from '../services/dashboardAnalytics';
import AlertCenterCard from '../components/alerts/AlertCenterCard';
import { SavedSearchesList } from '../components/alerts/SavedSearchesList';
import './Dashboard.css';

const CHART_COLORS = ['#B31F7E', '#482A7A', '#E8B15E', '#247BA0', '#3A8D5D', '#D65A4A'];

export default function Dashboard() {
  const {
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
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

  return (
    <div className="dashboard-container">
      <header className="page-header">
        <h1>Overview Dashboard</h1>
        <p>{BRAND.productName} monitoring and benchmarking workspace.</p>
        {dataStats && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
            {[
              // These row counts come from planner statistics (pg_class.reltuples),
              // not COUNT(*) — an exact count takes ~8s on 6.4M filings and times
              // out. The "~" says so. Everywhere else this product reports floors
              // and partial coverage honestly; rendering an estimate as an exact
              // integer was the one place it implied precision it does not have.
              // The DATE is exact — it is a real max(date_filed).
              `Filings: ~${dataStats.filings.count.toLocaleString()} through ${dataStats.filings.through ?? '—'} · ${dataStats.filings.source}`,
              `Auditors: ~${dataStats.auditors.count.toLocaleString()} engagements · ${dataStats.auditors.source}`,
              `Comment letters: ~${dataStats.letters.count.toLocaleString()} (~${dataStats.letters.withText.toLocaleString()} full-text) · ${dataStats.letters.source}`,
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

      <ProjectSelector />

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
              const recentFilings: {
                ticker: string;
                issuer: string;
                form: string;
                date: string;
                cik: string;
                accessionNumber: string;
                primaryDocument: string;
              }[] = [];

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
                    cik: secData.cik,
                    accessionNumber: recent.accessionNumber[i] || '',
                    primaryDocument: recent.primaryDocument[i] || '',
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
                  aria-label={`Open ${filing.issuer} ${filing.form} filed ${filing.date}`}
                  onClick={() => {
                    if (filing.cik && filing.accessionNumber && filing.primaryDocument) {
                      navigate.push(`/filing/${Number(filing.cik)}_${filing.accessionNumber}_${filing.primaryDocument}`);
                      return;
                    }
                    // Malformed upstream rows still retain a useful issuer
                    // research fallback instead of becoming inert.
                    navigate.push(`/search?q=${filing.ticker}`);
                  }}
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

        <AlertCenterCard />

        <section className="glass-card rss-card">
          <div className="card-header">
            <h3>Saved Searches</h3>
            <Bookmark size={18} className="text-blue" />
          </div>
          <SavedSearchesList emptyMessage="No saved searches yet. Use “Save search” in the Research Workbench to keep a question you want to re-run; “Make alert” turns one into a server-checked alert." />
        </section>

        <SearchJobsCard />
      </div>
    </div>
  );
}
