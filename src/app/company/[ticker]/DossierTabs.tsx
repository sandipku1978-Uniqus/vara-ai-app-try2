'use client';

/**
 * Issuer Dossier tabs: Filings (from EDGAR submissions, passed in by the
 * server page) · Comment Letters (threads from the owned corpus, by CIK) ·
 * Financials (XBRL company facts, latest fiscal year, pinned to one year).
 */

import { useEffect, useState } from 'react';
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
  backgroundColor: '#0f172a',
  border: '1px solid #1e293b',
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
  const [financials, setFinancials] = useState<{ year: number; metrics: Record<string, FinancialMetric> } | null | 'loading' | 'unavailable'>(null);

  useEffect(() => {
    if (tab !== 'letters' || threads !== null) return;
    fetch(`/api/letters?cik=${cik}&size=25`)
      .then(response => (response.ok ? response.json() : { threads: [] }))
      .then(payload => setThreads(payload.threads ?? []))
      .catch(() => setThreads([]));
  }, [tab, cik, threads]);

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
        setFinancials('unavailable');
      }
    })();
  }, [tab, cik, financials]);

  const filingCount = Math.min(15, recentFilings.accessionNumber.length);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {([['filings', 'Filings'], ['letters', 'Comment Letters'], ['financials', 'Financials']] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: '1px solid ' + (tab === value ? 'rgba(214,108,174,0.6)' : '#1e293b'),
              backgroundColor: tab === value ? 'rgba(179,31,126,0.25)' : '#0f172a',
              color: tab === value ? '#f9a8d4' : '#94a3b8',
            }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'filings' && (
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['Date', 'Form', 'Description', 'Document'].map(header => (
                  <th key={header} style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #1e293b' }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: filingCount }).map((_, i) => {
                const accession = recentFilings.accessionNumber[i]?.replace(/-/g, '');
                const doc = recentFilings.primaryDocument[i];
                const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${doc}`;
                return (
                  <tr key={recentFilings.accessionNumber[i]} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' }}>{recentFilings.filingDate[i]}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, backgroundColor: '#1e293b', color: '#4ade80', fontWeight: 600, fontSize: 13 }}>
                        {recentFilings.form[i]}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' }}>{recentFilings.primaryDocDescription[i] || '-'}</td>
                    <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b' }}>
                      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        View <ExternalLink size={12} />
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
          <div style={{ padding: 32, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={16} className="spinner" /> Loading review history…
          </div>
        ) : threads.length === 0 ? (
          <div style={{ ...cardStyle, padding: 24, color: '#94a3b8', fontSize: 14 }}>
            No SEC comment-letter history on record for {companyName} (corpus covers 2005+).
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {threads.map(thread => {
              const days = Math.max(1, Math.round((Date.parse(thread.last_letter) - Date.parse(thread.first_letter)) / 86_400_000));
              return (
                <a key={thread.thread_id}
                  href={`/comment-letters?company=${encodeURIComponent(companyName)}`}
                  style={{ ...cardStyle, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', textDecoration: 'none' }}>
                  <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 14 }}>
                    Review episode · {thread.first_letter} → {thread.last_letter}
                  </span>
                  <span style={{ display: 'flex', gap: 12, fontSize: 13, color: '#94a3b8' }}>
                    <span style={{ color: '#fbbf24' }}>{thread.uploads} Staff letter{thread.uploads === 1 ? '' : 's'}</span>
                    <span style={{ color: '#6ee7b7' }}>{thread.corresps} response{thread.corresps === 1 ? '' : 's'}</span>
                    <span>{days}d</span>
                  </span>
                </a>
              );
            })}
          </div>
        )
      )}

      {tab === 'financials' && (
        financials === 'loading' || financials === null ? (
          <div style={{ padding: 32, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={16} className="spinner" /> Loading XBRL company facts…
          </div>
        ) : financials === 'unavailable' ? (
          <div style={{ ...cardStyle, padding: 24, color: '#94a3b8', fontSize: 14 }}>
            No XBRL financial data available for this registrant.
          </div>
        ) : (
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 13 }}>
              Fiscal year {financials.year} · from XBRL company facts (amounts as reported)
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                {KEY_METRICS.map(({ key, label }) => {
                  const metric = financials.metrics[key];
                  return (
                    <tr key={key}>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>{label}</td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', color: '#f1f5f9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
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
