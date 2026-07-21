'use client';

import { useState, useEffect } from 'react';
import { UserCheck, Loader2, ExternalLink } from 'lucide-react';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import { lookupCIK, fetchCompanySubmissions, getInsiderFilings } from '../services/secApi';

interface InsiderFiling {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  entityName: string;
  cik: string;
}

export default function InsiderTrading() {
  const [companies, setCompanies] = useState<{ ticker: string; cik: string }[]>([]);
  const [filings, setFilings] = useState<InsiderFiling[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function addCompany(ticker: string, cik: string) {
    if (companies.find(c => c.ticker === ticker)) return;
    setCompanies(prev => [...prev, { ticker, cik }]);
  }

  useEffect(() => {
    if (companies.length === 0) { setFilings([]); return; }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const allFilings: InsiderFiling[] = [];
        for (const c of companies) {
          const cik = c.cik || await lookupCIK(c.ticker);
          if (!cik) continue;
          const sub = await fetchCompanySubmissions(cik);
          if (!sub) continue;
          const insider = getInsiderFilings(sub, ['3', '4', '5']);
          for (const f of insider) {
            allFilings.push({
              ...f,
              entityName: sub.name || c.ticker,
              cik: cik,
            });
          }
        }
        if (!cancelled) {
          allFilings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
          setFilings(allFilings);
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load insider filings.');
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [companies]);

  const columns: ColumnDef<InsiderFiling>[] = [
    { key: 'filingDate', header: 'Date', sortable: true },
    { key: 'form', header: 'Form', sortable: true },
    { key: 'entityName', header: 'Company', sortable: true },
    {
      key: 'accessionNumber', header: 'Filing', render: (row) => {
        const accNum = row.accessionNumber.replace(/-/g, '');
        const url = `https://www.sec.gov/Archives/edgar/data/${row.cik}/${accNum}/${row.primaryDocument}`;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              View <ExternalLink size={12} aria-hidden="true" />
            </a>
            <AskCopilotButton compact prompt={`Analyze Form ${row.form} insider filing for ${row.entityName} from ${row.filingDate}`} />
          </span>
        );
      }
    },
  ];

  return (
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '10px' }}>
        <UserCheck size={22} style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>Insider Trading</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '14px', fontSize: '0.86rem', lineHeight: 1.45 }}>
        Forms 3, 4, and 5 insider ownership and transaction filings from SEC EDGAR.
      </p>

      <div style={{ marginBottom: '12px', maxWidth: '400px' }}>
        <CompanySearchInput onSelect={addCompany} placeholder="Add company by ticker..." />
      </div>

      {companies.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {companies.map(c => (
            <span key={c.ticker} style={{
              background: 'var(--interactive-hover-strong)', color: 'var(--accent-primary)', padding: '3px 9px',
              border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px'
            }}>
              {c.ticker}
              <button type="button" aria-label={`Remove ${c.ticker}`} onClick={() => setCompanies(prev => prev.filter(x => x.ticker !== c.ticker))}
                style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: 0, fontSize: '1rem' }}>
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <div role="alert" style={{ color: 'var(--status-error)', background: 'var(--status-error-bg)', border: '1px solid var(--status-error)', borderRadius: '4px', padding: '8px 10px', marginBottom: '12px' }}>{error}</div>}

      {loading ? (
        <div role="status" style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>
          <Loader2 size={22} className="spinner" style={{ marginBottom: '6px' }} />
          <div>Loading insider filings...</div>
        </div>
      ) : filings.length > 0 ? (
        <>
          <ResultsToolbar data={filings} columns={columns} label="insider filings" />
          <DataTable columns={columns} data={filings} pageSize={25} />
        </>
      ) : companies.length > 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>No insider filings found.</div>
      ) : (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>Add companies above to view insider trading filings.</div>
      )}
    </div>
  );
}
