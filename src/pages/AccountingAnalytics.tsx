import { useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import { lookupCIK, fetchCompanyFacts, computeFinancialRatios, extractFinancials } from '../services/secApi';

interface CompanyRatios {
  ticker: string;
  name: string;
  ratios: Record<string, number | null>;
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
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function formatRatioValue(key: string, value: number | null): string {
  if (value == null) return '-';
  return MULTIPLE_RATIOS.has(key) ? `${value.toFixed(2)}x` : `${value.toFixed(1)}%`;
}

export default function AccountingAnalytics() {
  const [companies, setCompanies] = useState<{ ticker: string; cik: string }[]>([]);
  const [ratioData, setRatioData] = useState<CompanyRatios[]>([]);
  const [loading, setLoading] = useState(false);

  async function addCompany(ticker: string, cik: string) {
    if (companies.find(company => company.ticker === ticker)) return;
    setCompanies(prev => [...prev, { ticker, cik }]);
  }

  useEffect(() => {
    if (companies.length === 0) {
      setRatioData([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const results: CompanyRatios[] = [];

        for (const company of companies) {
          const cik = company.cik || await lookupCIK(company.ticker);
          if (!cik) continue;

          try {
            const facts = await fetchCompanyFacts(cik);
            if (!facts) continue;

            const normalizedMetrics = extractFinancials(facts);
            const metrics: Record<string, { value: number; unit: string }> = {};

            for (const [key, metric] of Object.entries(normalizedMetrics)) {
              if (metric.value != null) {
                metrics[key] = { value: metric.value, unit: metric.unit };
              }
            }

            results.push({
              ticker: company.ticker,
              name: company.ticker,
              ratios: computeFinancialRatios(metrics),
            });
          } catch {
            // Skip companies with incomplete or unavailable XBRL facts.
          }
        }

        if (!cancelled) {
          setRatioData(results);
        }
      } catch (error) {
        console.error('Ratio load error:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [companies]);

  const chartData = Object.entries(RATIO_LABELS).map(([key, label]) => {
    const row: Record<string, number | string | null> = { name: label };
    for (const company of ratioData) {
      row[company.ticker] = company.ratios[key] != null ? +company.ratios[key]!.toFixed(2) : null;
    }
    return row;
  });

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <TrendingUp size={28} style={{ color: '#60A5FA' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>Accounting Analytics</h1>
      </div>

      <p style={{ color: '#94A3B8', marginBottom: '24px', fontSize: '0.9rem' }}>
        Financial ratio analysis computed from normalized SEC XBRL data. Add companies to compare profitability, leverage, and operating efficiency using the same metric map used elsewhere in the platform.
      </p>

      <div style={{ marginBottom: '24px', maxWidth: '400px' }}>
        <CompanySearchInput onSelect={addCompany} placeholder="Add company by ticker..." />
      </div>

      {companies.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }}>
          {companies.map((company, index) => (
            <span
              key={company.ticker}
              style={{
                background: `${COLORS[index % COLORS.length]}22`,
                color: COLORS[index % COLORS.length],
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '0.8rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {company.ticker}
              <button
                onClick={() => setCompanies(prev => prev.filter(item => item.ticker !== company.ticker))}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: '1rem' }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>
          <Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} />
          <div>Computing financial ratios from normalized XBRL facts...</div>
        </div>
      ) : ratioData.length > 0 ? (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '24px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" stroke="#64748B" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="#94A3B8" fontSize={12} width={110} />
              <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: '8px', color: 'white' }} />
              <Legend />
              {ratioData.map((company, index) => (
                <Bar key={company.ticker} dataKey={company.ticker} fill={COLORS[index % COLORS.length]} radius={[0, 4, 4, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>

          <div style={{ marginTop: '24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', color: '#94A3B8' }}>Metric</th>
                  {ratioData.map(company => (
                    <th key={company.ticker} style={{ textAlign: 'right', padding: '8px', color: '#94A3B8' }}>
                      {company.ticker}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(RATIO_LABELS).map(([key, label]) => (
                  <tr key={key} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '8px', color: '#CBD5E1' }}>{label}</td>
                    {ratioData.map(company => (
                      <td key={company.ticker} style={{ textAlign: 'right', padding: '8px', color: 'white' }}>
                        {formatRatioValue(key, company.ratios[key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : companies.length > 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>No ratio data available.</div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>Add companies above to compute and compare financial ratios.</div>
      )}
    </div>
  );
}
