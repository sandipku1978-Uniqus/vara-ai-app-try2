/**
 * Issuer Dossier — the company-centric hub the UX audit called the single
 * biggest lever: header identity (name, tickers, exchange, SIC, state,
 * CURRENT AUDITOR from PCAOB Form AP) + tabs for Filings, Comment-Letter
 * threads, and Financials.
 *
 * Accepts ANY ticker (resolved via SEC's full company_tickers.json, server-
 * side, cached daily) or a raw CIK number — the old page 404'd everything
 * outside eight hardcoded tickers.
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import DossierTabs from './DossierTabs';

export const revalidate = 86400; // 24h ISR
export const dynamicParams = true;

const SEC_USER_AGENT = 'Uniqus Research Center contact@uniqus.com';

interface SECSubmission {
  name: string;
  tickers: string[];
  exchanges: string[];
  sicDescription: string;
  sic: string;
  stateOfIncorporation: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

async function resolveCik(raw: string): Promise<string | null> {
  const trimmed = decodeURIComponent(raw).trim();
  // Raw CIK: digits, optionally prefixed CIK
  const cikMatch = trimmed.match(/^(?:cik)?0*(\d{1,10})$/i);
  if (cikMatch) return cikMatch[1].padStart(10, '0');

  try {
    const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_USER_AGENT },
      next: { revalidate: 86400 },
    });
    if (!response.ok) return null;
    const data = await response.json() as Record<string, { cik_str: number; ticker: string }>;
    const upper = trimmed.toUpperCase();
    for (const entry of Object.values(data)) {
      if (entry.ticker === upper) return String(entry.cik_str).padStart(10, '0');
    }
  } catch { /* resolution failure → 404 below */ }
  return null;
}

async function fetchCompanyData(cik: string): Promise<SECSubmission | null> {
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': SEC_USER_AGENT },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchAuditor(cik: string): Promise<{ auditor: string; periodEnd: string | null } | null> {
  const url = process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await db
      .from('urc_current_auditors')
      .select('firm_canonical, fiscal_period_end')
      .eq('issuer_cik', Number(cik))
      .maybeSingle();
    if (!data) return null;
    return { auditor: String(data.firm_canonical), periodEnd: data.fiscal_period_end ?? null };
  } catch {
    return null;
  }
}

export async function generateStaticParams() {
  // Prebuild the majors; everything else renders on demand via ISR
  return ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'JPM', 'AMZN', 'META', 'NVDA'].map(
    (ticker) => ({ ticker })
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const cik = await resolveCik(ticker);
  if (!cik) return { title: 'Company Not Found | Uniqus Research Center' };
  const data = await fetchCompanyData(cik);
  const companyName = data?.name ?? ticker.toUpperCase();
  return {
    title: `${companyName} — Issuer Dossier | Uniqus Research Center`,
    description: `SEC filings, comment-letter history, auditor, and financial benchmarks for ${companyName}. Powered by Uniqus Research Center.`,
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px',
};
const valueStyle: React.CSSProperties = { fontSize: 17, fontWeight: 600, margin: 0, color: '#f1f5f9' };

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const cik = await resolveCik(ticker);
  if (!cik) notFound();

  const [data, auditorInfo] = await Promise.all([
    fetchCompanyData(cik!),
    fetchAuditor(cik!),
  ]);
  if (!data) notFound();

  const primaryTicker = data!.tickers?.[0] || null;

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px', fontFamily: 'system-ui, sans-serif', color: '#e2e8f0' }}>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
        <a href="/dashboard" style={{ color: '#94a3b8' }}>Home</a>
        <span> / </span>
        <a href="/search" style={{ color: '#94a3b8' }}>Research</a>
        <span> / </span>
        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{data!.name}</span>
      </p>

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0, color: '#ffffff' }}>{data!.name}</h1>
          {primaryTicker && (
            <span style={{ fontSize: 20, fontWeight: 600, color: '#4ade80', letterSpacing: '0.05em' }}>
              {data!.tickers.join(' · ')}
            </span>
          )}
        </div>
        <p style={{ marginTop: 8, color: '#94a3b8', fontSize: 14 }}>
          CIK {Number(cik)}{data!.exchanges?.length ? ` · ${data!.exchanges.filter(Boolean).join(', ')}` : ''}
        </p>
      </div>

      <section style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20,
        marginBottom: 36, padding: 22, backgroundColor: '#0f172a', borderRadius: 12, border: '1px solid #1e293b',
      }}>
        <div>
          <p style={labelStyle}>Current auditor</p>
          <p style={{ ...valueStyle, color: auditorInfo ? '#f9a8d4' : '#64748b' }}>
            {auditorInfo ? auditorInfo.auditor : 'Not on record'}
          </p>
          {auditorInfo?.periodEnd && (
            <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0' }}>
              per Form AP · FY ended {auditorInfo.periodEnd}
            </p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Industry (SIC)</p>
          <p style={valueStyle}>{data!.sicDescription || 'N/A'}</p>
          <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0' }}>{data!.sic || ''}</p>
        </div>
        <div>
          <p style={labelStyle}>State of incorporation</p>
          <p style={valueStyle}>{data!.stateOfIncorporation || 'N/A'}</p>
        </div>
      </section>

      <DossierTabs
        cik={Number(cik)}
        companyName={data!.name}
        recentFilings={data!.filings.recent}
      />

      <footer style={{ marginTop: 56, paddingTop: 24, borderTop: '1px solid #1e293b', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: '#475569' }}>
          Filings: SEC EDGAR · Auditor: PCAOB Form AP · Financials: XBRL company facts. Powered by Uniqus Research Center.
        </p>
      </footer>
    </main>
  );
}
