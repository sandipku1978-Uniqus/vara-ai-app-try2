'use client';

import { useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { UserCheck, Loader2, ExternalLink } from 'lucide-react';
import CompanySearchInput from '../components/filters/CompanySearchInput';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import InsiderTransactionsPanel from '../components/insiders/InsiderTransactionsPanel';
import { lookupCIK, fetchCompanySubmissions, getInsiderFilings } from '../services/secApi';

interface InsiderFiling {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  entityName: string;
  cik: string;
}

type InsiderView = 'filings' | 'transactions';

const INSIDER_VIEWS: Array<{ id: InsiderView; label: string }> = [
  { id: 'filings', label: 'Filings' },
  { id: 'transactions', label: 'Transactions' },
];

/** Transactions are read per issuer; resolve the CIK when the picker gave only a ticker. */
function TransactionsForCompany({ company }: { company: { ticker: string; cik: string } }) {
  const [resolved, setResolved] = useState<{ ticker: string; cik: string | null } | null>(
    company.cik ? { ticker: company.ticker, cik: company.cik } : null,
  );

  useEffect(() => {
    if (company.cik) { setResolved({ ticker: company.ticker, cik: company.cik }); return; }
    let cancelled = false;
    setResolved(null);
    lookupCIK(company.ticker)
      .then(cik => { if (!cancelled) setResolved({ ticker: company.ticker, cik: cik || null }); })
      .catch(() => { if (!cancelled) setResolved({ ticker: company.ticker, cik: null }); });
    return () => { cancelled = true; };
  }, [company.ticker, company.cik]);

  if (!resolved || resolved.ticker !== company.ticker) {
    return <div role="status" style={{ padding: '20px 0', color: 'var(--text-muted)' }}>Resolving {company.ticker} to its SEC CIK…</div>;
  }
  if (!resolved.cik) {
    return <div role="alert" style={{ padding: '12px', color: 'var(--status-error)', background: 'var(--status-error-bg)', borderRadius: '4px' }}>{company.ticker} could not be matched to an SEC CIK, so its ownership filings cannot be read.</div>;
  }
  return <InsiderTransactionsPanel key={resolved.cik} cik={resolved.cik} companyLabel={company.ticker} />;
}

export default function InsiderTrading() {
  const [view, setView] = useState<InsiderView>('filings');
  const [transactionsTicker, setTransactionsTicker] = useState('');
  const viewRefs = useRef<Record<InsiderView, HTMLButtonElement | null>>({ filings: null, transactions: null });
  const [companies, setCompanies] = useState<{ ticker: string; cik: string }[]>([]);
  const [filings, setFilings] = useState<InsiderFiling[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [skippedTickers, setSkippedTickers] = useState<string[]>([]);

  async function addCompany(ticker: string, cik: string) {
    if (companies.find(c => c.ticker === ticker)) return;
    setCompanies(prev => [...prev, { ticker, cik }]);
  }

  useEffect(() => {
    if (companies.length === 0) { setFilings([]); setSkippedTickers([]); return; }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const allFilings: InsiderFiling[] = [];
        const failed: string[] = [];
        for (const c of companies) {
          const cik = c.cik || await lookupCIK(c.ticker);
          if (!cik) { failed.push(c.ticker); continue; }
          const sub = await fetchCompanySubmissions(cik);
          if (!sub) { failed.push(c.ticker); continue; }
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
        setSkippedTickers(failed);
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

  const onViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = INSIDER_VIEWS.findIndex(item => item.id === view);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? INSIDER_VIEWS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + INSIDER_VIEWS.length) % INSIDER_VIEWS.length;
    const next = INSIDER_VIEWS[nextIndex].id;
    setView(next);
    viewRefs.current[next]?.focus();
  };

  const transactionsCompany = companies.find(c => c.ticker === transactionsTicker) ?? companies[0] ?? null;

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
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View Form ${row.form} insider filing for ${row.entityName}, filed ${row.filingDate}, on SEC.gov`}
              style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
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
        Forms 3, 4, and 5 insider ownership and transaction filings from each company&apos;s recent SEC submissions window (roughly the last 1,000 filings per registrant — high-volume filers&apos; older insider forms roll out of it). The Transactions view reads each filing&apos;s ownership XML into one row per reported transaction.
      </p>

      <div style={{ marginBottom: '12px', maxWidth: '400px' }}>
        <CompanySearchInput onSelect={addCompany} placeholder="Add company by ticker..." />
      </div>

      {skippedTickers.length > 0 && filings.length > 0 && (
        <div role="status" style={{ padding: '8px 12px', marginBottom: '10px', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--status-warning) 30%, transparent)' }}>
          {skippedTickers.join(', ')} could not be loaded from SEC — the list below excludes {skippedTickers.length === 1 ? 'that company' : 'those companies'}.
        </div>
      )}
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

      <div role="tablist" aria-label="Insider data view" style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {INSIDER_VIEWS.map(item => (
          <button
            key={item.id}
            ref={element => { viewRefs.current[item.id] = element; }}
            type="button"
            role="tab"
            id={`insider-tab-${item.id}`}
            aria-selected={view === item.id}
            aria-controls={`insider-panel-${item.id}`}
            tabIndex={view === item.id ? 0 : -1}
            onClick={() => setView(item.id)}
            onKeyDown={onViewKeyDown}
            style={{
              padding: '7px 14px', borderRadius: '6px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer',
              border: '1px solid ' + (view === item.id ? 'var(--accent-primary)' : 'var(--border-color)'),
              background: view === item.id ? 'var(--interactive-hover-strong)' : 'var(--surface-panel-strong)',
              color: view === item.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="insider-panel-transactions" aria-labelledby="insider-tab-transactions" hidden={view !== 'transactions'}>
        {view === 'transactions' && (
          transactionsCompany ? (
            <>
              {companies.length > 1 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Company
                  <select
                    value={transactionsCompany.ticker}
                    onChange={event => setTransactionsTicker(event.target.value)}
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 8px' }}
                  >
                    {companies.map(c => <option key={c.ticker} value={c.ticker}>{c.ticker}</option>)}
                  </select>
                </label>
              )}
              <TransactionsForCompany company={transactionsCompany} />
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>Add a company above to read its insider transactions.</div>
          )
        )}
      </div>

      <div role="tabpanel" id="insider-panel-filings" aria-labelledby="insider-tab-filings" hidden={view !== 'filings'}>
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
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>
          {skippedTickers.length > 0
            ? `No insider filings shown — ${skippedTickers.join(', ')} could not be loaded from SEC (retry by re-adding the ticker).`
            : 'No insider filings found in the recent submissions window for these companies.'}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>Add companies above to view insider trading filings.</div>
      )}
      </div>
    </div>
  );
}
