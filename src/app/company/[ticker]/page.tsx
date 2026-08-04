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

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWebSupabase } from '../../../lib/supabase-web';
import { fetchDossierCompanyData } from './companyData';
import { resolveDossierCik } from './companyTickerDirectory';
import DossierTabs from './DossierTabs';

export const revalidate = 86400; // 24h ISR
export const dynamicParams = true;

async function fetchAuditor(cik: string): Promise<{ auditor: string; periodEnd: string | null } | null> {
  const db = getWebSupabase();
  if (!db) return null;
  try {
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
  // SEC access is centrally paced and hosted production deliberately fails
  // closed without the distributed pacer. Generate dossiers on first request
  // so a build never needs SEC/KV access; the 24-hour ISR contract is retained.
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const cik = await resolveDossierCik(ticker);
  if (!cik) return { title: 'Company Not Found | Uniqus Research Center' };
  const data = await fetchDossierCompanyData(cik);
  const companyName = data?.name ?? ticker.toUpperCase();
  return {
    title: `${companyName} — Issuer Dossier | Uniqus Research Center`,
    description: `SEC filings, comment-letter history, auditor, and financial benchmarks for ${companyName}. Powered by Uniqus Research Center.`,
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px',
};
const valueStyle: React.CSSProperties = { fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--text-primary)' };

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const cik = await resolveDossierCik(ticker);
  if (!cik) notFound();

  const [data, auditorInfo] = await Promise.all([
    fetchDossierCompanyData(cik!),
    fetchAuditor(cik!),
  ]);
  if (!data) notFound();

  const primaryTicker = data!.tickers?.[0] || null;

  return (
    <section style={{ width: '100%', maxWidth: 1000, margin: '0 auto', padding: '40px 24px', color: 'var(--text-primary)' }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
        <Link href="/dashboard" style={{ color: 'var(--text-secondary)' }}>Home</Link>
        <span> / </span>
        <Link href="/search" style={{ color: 'var(--text-secondary)' }}>Research</Link>
        <span> / </span>
        <span aria-current="page" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data!.name}</span>
      </nav>

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{data!.name}</h1>
          {primaryTicker && (
            <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent-primary)', letterSpacing: '0.05em' }}>
              {data!.tickers.join(' · ')}
            </span>
          )}
        </div>
        <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 14 }}>
          CIK {Number(cik)}{data!.exchanges?.length ? ` · ${data!.exchanges.filter(Boolean).join(', ')}` : ''}
        </p>
      </div>

      <section style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20,
        marginBottom: 36, padding: 22, backgroundColor: 'var(--surface-panel)', borderRadius: 16, border: '1px solid var(--border-color)', boxShadow: 'var(--glow-shadow)',
      }}>
        <div>
          <p style={labelStyle}>Current auditor</p>
          <p style={{ ...valueStyle, color: auditorInfo ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
            {auditorInfo ? auditorInfo.auditor : 'Not on record'}
          </p>
          {auditorInfo?.periodEnd && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              per Form AP · FY ended {auditorInfo.periodEnd}
            </p>
          )}
        </div>
        <div>
          <p style={labelStyle}>Industry (SIC)</p>
          <p style={valueStyle}>{data!.sicDescription || 'N/A'}</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{data!.sic || ''}</p>
        </div>
        <div>
          <p style={labelStyle}>State of incorporation</p>
          <p style={valueStyle}>{data!.stateOfIncorporation || 'N/A'}</p>
        </div>
      </section>

      <DossierTabs
        key={cik}
        cik={Number(cik)}
        companyName={data!.name}
        recentFilings={data!.filings.recent}
      />

      <footer style={{ marginTop: 56, paddingTop: 24, borderTop: '1px solid var(--border-color)', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Filings: SEC EDGAR · Auditor: PCAOB Form AP · Financials: XBRL company facts. Powered by Uniqus Research Center.
        </p>
      </footer>
    </section>
  );
}
