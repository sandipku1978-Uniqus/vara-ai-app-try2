'use client';

import { useRef, useState } from 'react';
import { ClipboardList, ExternalLink, Loader2, Search } from 'lucide-react';
import DataTable, { type ColumnDef } from '../components/tables/DataTable';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import { searchInvestmentAdvisers, type AdviserFirmResult } from '../services/officialSources';

export default function ADVRegistrations() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdviserFirmResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState('');
  const requestIdRef = useRef(0);

  async function handleSearch(criteria = query) {
    const normalizedCriteria = criteria.trim();
    if (!normalizedCriteria) return;
    const requestId = ++requestIdRef.current;
    setLastSubmittedQuery(normalizedCriteria);
    setLoading(true);
    setSearched(true);
    setError('');
    try {
      const response = await searchInvestmentAdvisers(normalizedCriteria, 100);
      if (requestId !== requestIdRef.current) return;
      setResults(response.firms);
      setTotal(response.total);
    } catch (searchError) {
      console.error('IAPD adviser search failed:', searchError);
      if (requestId !== requestIdRef.current) return;
      setResults([]);
      setTotal(0);
      setError('The official IAPD search service could not be reached. No EDGAR filing forms have been substituted for Form ADV data.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  const columns: ColumnDef<AdviserFirmResult>[] = [
    { key: 'name', header: 'Firm', sortable: true },
    { key: 'crdNumber', header: 'CRD #', sortable: true },
    { key: 'secNumber', header: 'SEC #', sortable: true },
    { key: 'registrationScope', header: 'Registration', sortable: true },
    {
      key: 'city',
      header: 'Principal Office',
      render: row => [row.city, row.state, row.country].filter(Boolean).join(', ') || 'Not reported',
    },
    { key: 'hasDisclosures', header: 'Disclosures', render: row => row.hasDisclosures ? 'Reported' : 'None reported' },
    {
      key: 'url',
      header: 'Official Record',
      render: row => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open the IAPD record for ${row.name} on adviserinfo.sec.gov`}
          style={{ color: 'var(--accent-primary)', display: 'inline-flex', gap: '4px', alignItems: 'center' }}
        >
          IAPD <ExternalLink size={12} aria-hidden="true" />
        </a>
      ),
    },
  ];

  return (
    <div style={{ width: '100%', padding: 'clamp(14px, 2vw, 20px)', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
        <ClipboardList size={24} style={{ color: 'var(--accent-primary)' }} />
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>Investment Adviser Registrations</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '3px', fontSize: '0.86rem' }}>
        Search current firm registrations and Form ADV disclosures from the SEC&apos;s Investment Adviser Public Disclosure (IAPD) system.
      </p>
      <p style={{ color: 'var(--text-muted)', marginBottom: '12px', fontSize: '0.75rem' }}>
        Source: IAPD/IARD. Form ADV is not an EDGAR issuer form; results link to the official firm summary and filed disclosure record.
      </p>

      <form onSubmit={event => { event.preventDefault(); void handleSearch(); }} style={{ display: 'flex', gap: '8px', marginBottom: '12px', maxWidth: '760px', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          aria-label="Firm name, CRD number, or SEC number"
          placeholder="Firm name, CRD number, or SEC number"
          style={{ flex: '1 1 280px', minWidth: 0, padding: '7px 10px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.82rem' }}
        />
        <button type="submit" className="primary-btn" disabled={!query.trim()} aria-busy={loading} style={{ padding: '7px 14px', fontSize: '0.82rem' }}>
          {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search IAPD
        </button>
      </form>

      {error && (
        <div role="alert" style={{ padding: '10px 12px', border: '1px solid var(--status-warning)', borderRadius: '4px', background: 'color-mix(in srgb, var(--status-warning) 8%, var(--bg-elevated))', color: 'var(--text-primary)', marginBottom: '12px' }}>
          {error} <button type="button" className="secondary-btn" onClick={() => void handleSearch(lastSubmittedQuery)}>Retry</button>
        </div>
      )}
      {loading ? (
        <div role="status" aria-live="polite" style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}><Loader2 size={20} className="spinner" /> Loading official IAPD results…</div>
      ) : results.length > 0 ? (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: '0 0 6px' }}>Showing {results.length.toLocaleString()} of {total.toLocaleString()} matching IAPD firms.</p>
          <ResultsToolbar data={results} columns={columns} label="investment advisers" />
          <DataTable columns={columns} data={results} pageSize={25} />
        </>
      ) : searched && !error ? (
        <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No IAPD firms matched that search.</div>
      ) : !searched ? (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Enter a firm name or identifier to search the authoritative IAPD registry.</div>
      ) : null}
    </div>
  );
}
