'use client';

/**
 * Issuer Dossier tabs: Filings (from EDGAR submissions, passed in by the
 * server page) · Comment Letters (threads from the owned corpus, by CIK) ·
 * Financials (XBRL company facts, latest fiscal year, pinned to one year).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  fetchCompanyFacts,
  extractComparableFinancials,
  getAvailableYears,
  formatFinancialValue,
  type FinancialMetric,
} from '../../../services/secApi';

interface RecentFilings {
  accessionNumber: string[];
  filingDate: string[];
  form: string[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

interface ThreadSummary {
  thread_id: string;
  letters: number;
  uploads: number;
  corresps: number;
  first_letter: string;
  last_letter: string;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-panel)',
  border: '1px solid var(--border-color)',
  borderRadius: 12,
};

const KEY_METRICS: Array<{ key: string; label: string }> = [
  { key: 'Revenues', label: 'Revenue' },
  { key: 'GrossProfit', label: 'Gross profit' },
  { key: 'OperatingIncome', label: 'Operating income' },
  { key: 'NetIncome', label: 'Net income' },
  { key: 'TotalAssets', label: 'Total assets' },
  { key: 'TotalLiabilities', label: 'Total liabilities' },
  { key: 'StockholdersEquity', label: 'Stockholders equity' },
  { key: 'TotalDebt', label: 'Total debt' },
  { key: 'OperatingCashFlow', label: 'Operating cash flow' },
  { key: 'CapitalExpenditures', label: 'Capital expenditures' },
];

export default function DossierTabs({
  cik,
  companyName,
  recentFilings,
}: {
  cik: number;
  companyName: string;
  recentFilings: RecentFilings;
}) {
  const [tab, setTab] = useState<'filings' | 'letters' | 'financials'>('filings');
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [threadsError, setThreadsError] = useState('');
  const [threadReloadKey, setThreadReloadKey] = useState(0);
  const [financials, setFinancials] = useState<{ year: number; metrics: Record<string, FinancialMetric> } | null | 'loading' | 'unavailable' | 'error'>(null);
  const [financialsReloadKey, setFinancialsReloadKey] = useState(0);

  useEffect(() => {
    if (tab !== 'letters' || threads !== null) return;
    setThreadsError('');
    fetch(`/api/letters?cik=${cik}&size=25`)
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(payload => setThreads(payload.threads ?? []))
      .catch(() => { setThreads([]); setThreadsError('The SEC comment-letter corpus could not be loaded for this issuer.'); });
  }, [tab, cik, threadReloadKey, threads]);

  useEffect(() => {
    if (tab !== 'financials' || financials !== null) return;
    setFinancials('loading');
    (async () => {
      try {
        const facts = await fetchCompanyFacts(String(cik).padStart(10, '0'));
        if (!facts) { setFinancials('unavailable'); return; }
        const years = getAvailableYears(facts);
        if (years.length === 0) { setFinancials('unavailable'); return; }
        const metrics = extractComparableFinancials(facts, years[0]);
        setFinancials({ year: years[0], metrics });
      } catch {
        setFinancials('error');
      }
    })();
  }, [tab, cik, financials, financialsReloadKey]);

  const filingCount = Math.min(15, recentFilings.accessionNumber.length);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, overflowX: 'auto' }} role="group" aria-label="Issuer dossier view">
        {([['filings', 'Filings'], ['letters', 'Comment Letters'], ['financials', 'Financials']] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: '1px solid ' + (tab === value ? 'rgba(214,108,174,0.6)' : 'var(--border-color)'),
              backgroundColor: tab === value ? 'rgba(179,31,126,0.18)' : 'var(--surface-panel-strong)',
              color: tab === value ? 'var(--accent-primary)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap',
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'filings' && (
        <div style={{ ...cardStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 14 }}>
            <caption style={{ textAlign: 'left', padding: '0 16px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
              Up to 15 most recent submissions from the SEC company-submissions feed
            </caption>
            <thead>
              <tr>
                {['Date', 'Form', 'Description', 'Document'].map(header => (
                  <th key={header} scope="col" style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: filingCount }).map((_, i) => {
                const accession = recentFilings.accessionNumber[i]?.replace(/-/g, '');
                const doc = recentFilings.primaryDocument[i];
                const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${doc}`;
                return (
                  <tr key={recentFilings.accessionNumber[i]} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--interactive-hover)' }}>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>{recentFilings.filingDate[i]}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, backgroundColor: 'var(--surface-subtle)', color: 'var(--status-success)', fontWeight: 600, fontSize: 13 }}>
                        {recentFilings.form[i]}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>{recentFilings.primaryDocDescription[i] || '-'}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)' }}>
                      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        View <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'letters' && (
        threads === null ? (
          <div role="status" style={{ padding: 32, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={16} className="spinner" /> Loading review history…
          </div>
        ) : threadsError ? (
          <div role="alert" style={{ ...cardStyle, padding: 24, color: 'var(--status-error)', background: 'var(--status-error-bg)', fontSize: 14 }}>
            <p>{threadsError}</p>
            <button type="button" className="secondary-btn" onClick={() => { setThreads(null); setThreadReloadKey(key => key + 1); }}>Retry comment-letter history</button>
          </div>
        ) : threads.length === 0 ? (
          <div style={{ ...cardStyle, padding: 24, color: 'var(--text-muted)', fontSize: 14 }}>
            No SEC comment-letter history on record for {companyName} (corpus covers 2005+).
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {threads.map(thread => {
              const days = Math.max(1, Math.round((Date.parse(thread.last_letter) - Date.parse(thread.first_letter)) / 86_400_000));
              return (
                <Link key={thread.thread_id}
                  href={`/comment-letters?company=${encodeURIComponent(companyName)}&thread=${encodeURIComponent(thread.thread_id)}`}
                  style={{ ...cardStyle, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', textDecoration: 'none' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>
                    Review episode · {thread.first_letter} → {thread.last_letter}
                  </span>
                  <span style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--status-warning)' }}>{thread.uploads} Staff letter{thread.uploads === 1 ? '' : 's'}</span>
                    <span style={{ color: 'var(--status-success)' }}>{thread.corresps} response{thread.corresps === 1 ? '' : 's'}</span>
                    <span>{days}d</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )
      )}

      {tab === 'financials' && (
        financials === 'loading' || financials === null ? (
          <div role="status" style={{ padding: 32, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={16} className="spinner" /> Loading XBRL company facts…
          </div>
        ) : financials === 'error' ? (
          <div role="alert" style={{ ...cardStyle, padding: 24, color: 'var(--status-error)', background: 'var(--status-error-bg)', fontSize: 14 }}>
            <p>The SEC XBRL company-facts request failed. No availability conclusion can be drawn.</p>
            <button type="button" className="secondary-btn" onClick={() => { setFinancials(null); setFinancialsReloadKey(key => key + 1); }}>Retry XBRL company facts</button>
          </div>
        ) : financials === 'unavailable' ? (
          <div style={{ ...cardStyle, padding: 24, color: 'var(--text-muted)', fontSize: 14 }}>
            No XBRL financial data available for this registrant.
          </div>
        ) : (
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: 13 }}>
              Fiscal year {financials.year} · from XBRL company facts (amounts as reported)
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <caption className="sr-only">Fiscal year {financials.year} key financial metrics</caption>
              <tbody>
                {KEY_METRICS.map(({ key, label }) => {
                  const metric = financials.metrics[key];
                  return (
                    <tr key={key}>
                      <th scope="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', textAlign: 'left', fontWeight: 500 }}>{label}</th>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {metric?.value != null ? formatFinancialValue(metric.value, metric.currency || metric.unit) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
