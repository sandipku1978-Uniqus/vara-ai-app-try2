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
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#D66CAE', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              View <ExternalLink size={12} />
            </a>
            <AskCopilotButton compact prompt={`Analyze Form ${row.form} insider filing for ${row.entityName} from ${row.filingDate}`} />
          </span>
        );
      }
    },
  ];

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <UserCheck size={28} style={{ color: '#D66CAE' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'white' }}>Insider Trading</h1>
      </div>
      <p style={{ color: '#94A3B8', marginBottom: '24px', fontSize: '0.9rem' }}>
        Forms 3, 4, and 5 insider ownership and transaction filings from SEC EDGAR.
      </p>

      <div style={{ marginBottom: '24px', maxWidth: '400px' }}>
        <CompanySearchInput onSelect={addCompany} placeholder="Add company by ticker..." />
      </div>

      {companies.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {companies.map(c => (
            <span key={c.ticker} style={{
              background: 'rgba(214,108,174,0.15)', color: '#D66CAE', padding: '4px 12px',
              borderRadius: '16px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px'
            }}>
              {c.ticker}
              <button onClick={() => setCompanies(prev => prev.filter(x => x.ticker !== c.ticker))}
                style={{ background: 'none', border: 'none', color: '#D66CAE', cursor: 'pointer', padding: 0, fontSize: '1rem' }}>
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <div style={{ color: '#F87171', marginBottom: '16px' }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>
          <Loader2 size={24} className="spinner" style={{ marginBottom: '8px' }} />
          <div>Loading insider filings...</div>
        </div>
      ) : filings.length > 0 ? (
        <>
          <ResultsToolbar data={filings} columns={columns} label="insider filings" />
          <DataTable columns={columns} data={filings} pageSize={25} />
        </>
      ) : companies.length > 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>No insider filings found.</div>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748B' }}>Add companies above to view insider trading filings.</div>
      )}
    </div>
  );
}

