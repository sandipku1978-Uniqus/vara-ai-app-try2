'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import { lookupCIK, fetchCompanyFacts, computeFinancialRatios, extractComparableFinancials, getAvailableYears } from '../services/secApi';

interface CompanyRatios {
  ticker: string;
  name: string;
  ratios: Record<string, number | null>;
}

interface RatioCoverageFailure {
  ticker: string;
  reason: string;
}

const RATIO_LABELS: Record<string, string> = {
  grossMargin: 'Gross Margin',
  operatingMargin: 'Operating Margin',
  netMargin: 'Net Margin',
  returnOnEquity: 'ROE',
  returnOnAssets: 'ROA',
  currentRatio: 'Current Ratio',
  debtToEquity: 'D/E Ratio',
  assetTurnover: 'Asset Turnover',
};

const MULTIPLE_RATIOS = new Set(['currentRatio', 'debtToEquity', 'assetTurnover']);
const COLORS = ['#B31F7E', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function formatRatioValue(key: string, value: number | null): string {
  if (value == null) return '-';
  return MULTIPLE_RATIOS.has(key) ? `${value.toFixed(2)}x` : `${value.toFixed(1)}%`;
}

export default function AccountingAnalytics() {
  const [companies, setCompanies] = useState<{ ticker: string; cik: string }[]>([]);
  const [ratioData, setRatioData] = useState<CompanyRatios[]>([]);
  const [coverageFailures, setCoverageFailures] = useState<RatioCoverageFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  async function addCompany(ticker: string, cik: string) {
    if (companies.find(company => company.ticker === ticker)) return;
    setCompanies(prev => [...prev, { ticker, cik }]);
  }

  useEffect(() => {
    if (companies.length === 0) {
      setRatioData([]);
      setCoverageFailures([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setCoverageFailures([]);
      const results: CompanyRatios[] = [];
      const failures: RatioCoverageFailure[] = [];

      for (const company of companies) {
        try {
          const cik = company.cik || await lookupCIK(company.ticker);
          if (!cik) {
            failures.push({ ticker: company.ticker, reason: 'The SEC company identifier could not be resolved.' });
            continue;
          }

          const facts = await fetchCompanyFacts(cik);
          if (!facts) {
            failures.push({ ticker: company.ticker, reason: 'SEC XBRL company facts were unavailable.' });
            continue;
          }

            // Pin every metric to one fiscal year — without a pinned year each
            // metric independently takes its own latest fact, so ratios like
            // ROE could mix a FY2025 numerator with a FY2024 denominator.
            const latestYear = getAvailableYears(facts)[0];
            const priorYear = getAvailableYears(facts).find(year => latestYear != null && year < latestYear);
            const normalizedMetrics = latestYear != null
              ? extractComparableFinancials(facts, latestYear)
              : extractComparableFinancials(facts);
            const normalizedPriorMetrics = priorYear != null
              ? extractComparableFinancials(facts, priorYear)
              : {};
            const metrics: Record<string, { value: number; unit: string }> = {};
            const priorMetrics: Record<string, { value: number; unit: string }> = {};

            for (const [key, metric] of Object.entries(normalizedMetrics)) {
              if (metric.value != null) {
                metrics[key] = { value: metric.value, unit: metric.unit };
              }
            }
            for (const [key, metric] of Object.entries(normalizedPriorMetrics)) {
              if (metric.value != null) {
                priorMetrics[key] = { value: metric.value, unit: metric.unit };
              }
            }

          results.push({
            ticker: company.ticker,
            name: company.ticker,
            ratios: computeFinancialRatios(metrics, priorMetrics),
          });
        } catch (error) {
          console.error(`Ratio load error for ${company.ticker}:`, error);
          failures.push({ ticker: company.ticker, reason: 'SEC XBRL facts could not be loaded or normalized.' });
        }
      }

      if (!cancelled) {
        setRatioData(results);
        setCoverageFailures(failures);
        setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [companies, retryToken]);

  const chartData = Object.entries(RATIO_LABELS).map(([key, label]) => {
    const row: Record<string, number | string | null> = { name: label };
    for (const company of ratioData) {
      row[company.ticker] = company.ratios[key] != null ? +company.ratios[key]!.toFixed(2) : null;
    }
    return row;
  });

  return (
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '10px' }}>
        <TrendingUp size={22} style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>Accounting Analytics</h1>
      </div>

      <p style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '0.86rem', lineHeight: 1.45 }}>
        Financial ratio analysis computed from normalized SEC XBRL data. Add companies to compare profitability, leverage, and operating efficiency using the same metric map used elsewhere in the platform.
      </p>
      <p style={{ color: 'var(--text-muted)', marginBottom: '14px', fontSize: '0.75rem', lineHeight: 1.4 }}>
        Methodology: ROE, ROA, and asset turnover use average beginning/end balances when both fiscal years are available; otherwise the fiscal-year-end balance is used. Current ratio and debt-to-equity use fiscal-year-end balances.
      </p>

      <div style={{ marginBottom: '12px', maxWidth: '400px' }}>
        <CompanySearchInput onSelect={addCompany} placeholder="Add company by ticker..." />
      </div>

      {companies.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {companies.map((company, index) => (
            <span
              key={company.ticker}
              style={{
                background: `${COLORS[index % COLORS.length]}22`,
                color: 'var(--text-primary)',
                border: `1px solid ${COLORS[index % COLORS.length]}66`,
                padding: '3px 9px',
                borderRadius: '4px',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {company.ticker}
              <button
                type="button"
                aria-label={`Remove ${company.ticker}`}
                onClick={() => setCompanies(prev => prev.filter(item => item.ticker !== company.ticker))}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: '1rem' }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {!loading && coverageFailures.length > 0 && (
        <div
          role="alert"
          style={{
            marginBottom: '12px',
            padding: '12px 14px',
            borderRadius: '4px',
            border: '1px solid var(--status-error)',
            background: 'var(--status-error-bg)',
            color: 'var(--text-primary)',
          }}
        >
          <p style={{ margin: 0 }}>
            {ratioData.length > 0
              ? `Partial XBRL coverage: ratios could not be loaded for ${coverageFailures.map(failure => failure.ticker).join(', ')}. Available companies are shown below.`
              : `Ratio data could not be loaded for ${coverageFailures.map(failure => failure.ticker).join(', ')}. No zero-data conclusion can be drawn.`}
          </p>
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            {coverageFailures.map(failure => <li key={failure.ticker}>{failure.ticker}: {failure.reason}</li>)}
          </ul>
          <button type="button" className="secondary-btn" onClick={() => setRetryToken(token => token + 1)} style={{ marginTop: '8px' }}>
            Retry XBRL data
          </button>
        </div>
      )}

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>
          <Loader2 size={22} className="spinner" style={{ marginBottom: '6px' }} />
          <div>Computing financial ratios from normalized XBRL facts...</div>
        </div>
      ) : ratioData.length > 0 ? (
        <div style={{ background: 'var(--surface-panel)', borderRadius: '6px', padding: '14px 16px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 104 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis type="number" stroke="var(--chart-text)" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="var(--chart-text-strong)" fontSize={12} width={110} />
              <Tooltip contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '4px', color: 'var(--text-primary)' }} />
              <Legend />
              {ratioData.map((company, index) => (
                <Bar key={company.ticker} dataKey={company.ticker} fill={COLORS[index % COLORS.length]} radius={[0, 4, 4, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>

          <div style={{ marginTop: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <caption className="sr-only">Financial ratios by company</caption>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--table-header-border)' }}>
                  <th scope="col" style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-secondary)' }}>Metric</th>
                  {ratioData.map(company => (
                    <th key={company.ticker} scope="col" style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)' }}>
                      {company.ticker}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(RATIO_LABELS).map(([key, label]) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th scope="row" style={{ padding: '6px 8px', color: 'var(--text-primary)', textAlign: 'left', fontWeight: 500 }}>{label}</th>
                    {ratioData.map(company => (
                      <td key={company.ticker} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-primary)' }}>
                        {formatRatioValue(key, company.ratios[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : companies.length > 0 && coverageFailures.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>SEC XBRL facts were loaded, but no supported ratios could be computed.</div>
      ) : companies.length > 0 ? null : (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>Add companies above to compute and compare financial ratios.</div>
      )}
    </div>
  );
}
