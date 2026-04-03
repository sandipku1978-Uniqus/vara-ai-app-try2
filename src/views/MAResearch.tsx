'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileSearch, Scale, Link2, Search, Briefcase, Loader2 } from 'lucide-react';
import { searchEdgarFilings, fetchFilingText } from '../services/secApi';
import { aiExtractDealDetails, aiExtractClauses, type DealDetailsResult } from '../services/aiApi';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import AIResultsSummary from '../components/tables/AIResultsSummary';
import './MAResearch.css';

interface DealFiling {
  entityName: string;
  fileDate: string;
  formType: string;
  accessionNumber: string;
  cik: string;
  primaryDocument: string;
  // AI-extracted fields (loaded on demand)
  extractedDetails?: DealDetailsResult | null;
  extracting?: boolean;
}

// Clause types available for extraction
const CLAUSE_TYPES = [
  'Material Adverse Effect (MAE)',
  'Termination Fee (Reverse Breakup)',
  'Ordinary Course of Business Covenants',
  'Representations & Warranties',
  'Non-Solicitation / No-Shop',
  'Conditions to Closing',
];

// Module-level cache
const dealDetailsCache = new Map<string, DealDetailsResult | null>();
const clauseCache = new Map<string, Record<string, { text: string; section: string }>>();

export default function MAResearch() {
  const [activeTab, setActiveTab] = useState<'screener' | 'clauses'>('screener');
  const [searchQuery, setSearchQuery] = useState('');

  // Deal screener state
  const [dealFilings, setDealFilings] = useState<DealFiling[]>([]);
  const [dealLoading, setDealLoading] = useState(false);

  // Clause library state
  const [selectedClause, setSelectedClause] = useState(CLAUSE_TYPES[0]);
  const [clauseResults, setClauseResults] = useState<Record<string, { text: string; section: string }> | null>(null);
  const [clauseLoading, setClauseLoading] = useState(false);
  const [clauseFilingQuery, setClauseFilingQuery] = useState('');
  const [clauseFilingSearching, setClauseFilingSearching] = useState(false);
  const [clauseFilings, setClauseFilings] = useState<DealFiling[]>([]);
  const [selectedClauseFiling, setSelectedClauseFiling] = useState<DealFiling | null>(null);

  // Load deal screener on mount
  useEffect(() => {
    async function loadDeals() {
      setDealLoading(true);
      try {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const dateFrom = oneYearAgo.toISOString().split('T')[0];
        const dateTo = new Date().toISOString().split('T')[0];

        const hits = await searchEdgarFilings(
          'merger agreement OR acquisition',
          '8-K,SC 13D,SC TO-T',
          dateFrom,
          dateTo
        );

        const seen = new Set<string>();
        const filings: DealFiling[] = [];

        for (const hit of hits) {
          if (filings.length >= 15) break;
          const src = hit._source as any;
          const entityName = src?.display_names?.[0] || src?.entity_name || '';
          const nameKey = entityName.toUpperCase().trim();
          if (!nameKey || seen.has(nameKey)) continue;
          seen.add(nameKey);

          const cleanName = entityName.replace(/\s*\(CIK\s+\d+\)/, '').trim();
          const idParts = hit._id.split(':');

          filings.push({
            entityName: cleanName,
            fileDate: src?.file_date || '',
            formType: src?.file_type || src?.form || '8-K',
            accessionNumber: src?.adsh || '',
            cik: (src?.ciks?.[0] || '').replace(/^0+/, ''),
            primaryDocument: idParts.length > 1 ? idParts[1] : '',
          });
        }
        setDealFilings(filings);
      } catch (error) {
        console.error('M&A deal screener error:', error);
      } finally {
        setDealLoading(false);
      }
    }
    loadDeals();
  }, []);

  // Extract deal details on demand
  const handleExtractDetails = useCallback(async (idx: number) => {
    const filing = dealFilings[idx];
    if (!filing || filing.extracting || filing.extractedDetails !== undefined) return;

    // Check cache
    if (dealDetailsCache.has(filing.accessionNumber)) {
      setDealFilings(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], extractedDetails: dealDetailsCache.get(filing.accessionNumber)! };
        return updated;
      });
      return;
    }

    setDealFilings(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], extracting: true };
      return updated;
    });

    try {
      let text = '';
      if (filing.cik && filing.primaryDocument) {
        text = await fetchFilingText(filing.cik, filing.accessionNumber, filing.primaryDocument);
      }

      let details: DealDetailsResult | null = null;
      if (text && text.length > 200) {
        details = await aiExtractDealDetails(text);
      }
      dealDetailsCache.set(filing.accessionNumber, details);

      setDealFilings(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], extractedDetails: details, extracting: false };
        return updated;
      });
    } catch {
      setDealFilings(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], extractedDetails: null, extracting: false };
        return updated;
      });
    }
  }, [dealFilings]);

  // Filter deals by search
  const filteredDeals = searchQuery.trim()
    ? dealFilings.filter(d => {
        const q = searchQuery.toLowerCase();
        return d.entityName.toLowerCase().includes(q) ||
          (d.extractedDetails?.target || '').toLowerCase().includes(q) ||
          (d.extractedDetails?.acquirer || '').toLowerCase().includes(q);
      })
    : dealFilings;

  // Search for filings for clause extraction
  const handleClauseFilingSearch = useCallback(async () => {
    if (!clauseFilingQuery.trim()) return;
    setClauseFilingSearching(true);
    try {
      const hits = await searchEdgarFilings(clauseFilingQuery, '8-K,SC 13D');
      const filings: DealFiling[] = [];
      const seen = new Set<string>();
      for (const hit of hits) {
        if (filings.length >= 5) break;
        const src = hit._source as any;
        const name = (src?.display_names?.[0] || src?.entity_name || '').replace(/\s*\(CIK\s+\d+\)/, '').trim();
        if (!name || seen.has(name.toUpperCase())) continue;
        seen.add(name.toUpperCase());
        const idParts = hit._id.split(':');
        filings.push({
          entityName: name,
          fileDate: src?.file_date || '',
          formType: src?.file_type || '8-K',
          accessionNumber: src?.adsh || '',
          cik: (src?.ciks?.[0] || '').replace(/^0+/, ''),
          primaryDocument: idParts.length > 1 ? idParts[1] : '',
        });
      }
      setClauseFilings(filings);
    } catch {
      setClauseFilings([]);
    } finally {
      setClauseFilingSearching(false);
    }
  }, [clauseFilingQuery]);

  // Extract clauses from selected filing
  const handleExtractClauses = useCallback(async () => {
    if (!selectedClauseFiling) return;
    const cacheKey = `${selectedClauseFiling.accessionNumber}:${selectedClause}`;
    if (clauseCache.has(cacheKey)) {
      setClauseResults(clauseCache.get(cacheKey)!);
      return;
    }

    setClauseLoading(true);
    setClauseResults(null);
    try {
      let text = '';
      if (selectedClauseFiling.cik && selectedClauseFiling.primaryDocument) {
        text = await fetchFilingText(selectedClauseFiling.cik, selectedClauseFiling.accessionNumber, selectedClauseFiling.primaryDocument);
      }
      if (text && text.length > 200) {
        const result = await aiExtractClauses(text, [selectedClause]);
        if (result) {
          clauseCache.set(cacheKey, result);
          setClauseResults(result);
        }
      }
    } catch (error) {
      console.error('Clause extraction error:', error);
    } finally {
      setClauseLoading(false);
    }
  }, [selectedClauseFiling, selectedClause]);

  return (
    <div className="ma-container">
      <div className="ma-header">
        <div className="ma-title">
          <h1>M&A and Transactional Research</h1>
          <p>Screen real M&A filings from SEC EDGAR, extract deal details with AI, and compare negotiated clauses.</p>
        </div>
      </div>

      <div className="ma-layout">
        <aside className="ma-sidebar glass-card">
          <nav className="ma-nav">
            <button className={`nav-btn ${activeTab === 'screener' ? 'active' : ''}`} onClick={() => setActiveTab('screener')}>
              <Briefcase size={18} /> Deal Screener
            </button>
            <button className={`nav-btn ${activeTab === 'clauses' ? 'active' : ''}`} onClick={() => setActiveTab('clauses')}>
              <Scale size={18} /> Clause Library
            </button>
          </nav>

          <div className="sidebar-filters" style={{ marginTop: '32px' }}>
            <h4>Data Source</h4>
            <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(179,31,126,0.05)', border: '1px solid rgba(179,31,126,0.2)', borderRadius: '8px' }}>
              <p style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                Deal data sourced from SEC EDGAR full-text search. Click "Extract" on any deal to run AI analysis on the filing text.
              </p>
            </div>
          </div>
        </aside>

        <main className="ma-main glass-card" style={{ overflow: 'auto' }}>
          {activeTab === 'screener' && (
            <div className="tab-pane fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>Recent M&A Filings</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>8-K, SC 13D, and SC TO-T filings mentioning mergers or acquisitions (past 12 months).</p>
                </div>
                <div className="search-bar-inline">
                  <Search size={16} className="search-bar-icon" />
                  <input
                    type="text"
                    placeholder="Filter by entity name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {dealLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px', color: '#94A3B8' }}>
                  <Loader2 size={16} className="spinner" /> Loading M&A filings from EDGAR...
                </div>
              ) : (
              <>
              {filteredDeals.length > 0 && (
                <>
                  <AIResultsSummary
                    query={searchQuery || 'merger agreement OR acquisition'}
                    resultsSummary={filteredDeals.slice(0, 8).map(d => `${d.entityName} (${d.formType}, ${d.fileDate})${d.extractedDetails ? ` — ${d.extractedDetails.target}/${d.extractedDetails.acquirer}, ${d.extractedDetails.value}` : ''}`).join('\n')}
                    resultCount={filteredDeals.length}
                    moduleLabel="M&A filings"
                    cacheKey={`ma-${searchQuery}-${filteredDeals.length}`}
                  />
                  <ResultsToolbar
                    data={filteredDeals}
                    columns={[
                      { key: 'entityName', header: 'Entity' },
                      { key: 'formType', header: 'Form' },
                      { key: 'fileDate', header: 'Filed' },
                    ]}
                    label="M&A filings"
                  />
                </>
              )}
              <div style={{ border: '1px solid rgba(51,65,85,0.5)', borderRadius: '12px', overflow: 'hidden', marginBottom: '32px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#0F172A', borderBottom: '1px solid rgba(51,65,85,0.5)', fontSize: '0.875rem' }}>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Entity</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Form</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>Filed</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>AI Details</th>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeals.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>No M&A filings found.</td></tr>
                    ) : filteredDeals.map((deal, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(51,65,85,0.3)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '16px', fontWeight: 500, color: 'white' }}>{deal.entityName}</td>
                        <td style={{ padding: '16px' }}>
                          <span style={{ background: '#1E293B', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', color: '#94A3B8' }}>{deal.formType}</span>
                        </td>
                        <td style={{ padding: '16px', color: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{deal.fileDate}</td>
                        <td style={{ padding: '16px' }}>
                          {deal.extracting ? (
                            <span style={{ color: '#94A3B8', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Loader2 size={12} className="spinner" /> Extracting...
                            </span>
                          ) : deal.extractedDetails ? (
                            <div style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>
                              <div>{deal.extractedDetails.target} / {deal.extractedDetails.acquirer}</div>
                              <div style={{ color: '#4ADE80' }}>{deal.extractedDetails.value} — {deal.extractedDetails.dealType}</div>
                            </div>
                          ) : deal.extractedDetails === null ? (
                            <span style={{ color: '#64748B', fontSize: '0.75rem' }}>No details found</span>
                          ) : (
                            <button
                              onClick={() => handleExtractDetails(dealFilings.indexOf(deal))}
                              style={{ background: 'rgba(179,31,126,0.1)', border: '1px solid rgba(179,31,126,0.3)', color: '#D66CAE', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                            >
                              Extract with AI
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                            <a
                              href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&accession=${deal.accessionNumber}&type=${deal.formType}&dateb=&owner=include&count=1`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#D66CAE', fontSize: '0.75rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                            >
                              <FileSearch size={14} /> SEC.gov
                            </a>
                            <AskCopilotButton compact prompt={`Analyze the ${deal.extractedDetails?.dealType || deal.formType || 'M&A'} deal: ${deal.extractedDetails?.target || deal.entityName}`} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
              )}
            </div>
          )}

          {activeTab === 'clauses' && (
            <div className="tab-pane fade-in">
              <div style={{ marginBottom: '24px' }}>
                <h2>AI Clause Extraction</h2>
                <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Search for a merger filing, then extract specific clause types with AI.</p>
              </div>

              {/* Step 1: Find a filing */}
              <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid #334155', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
                <label style={{ fontSize: '0.75rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                  Step 1: Search for a merger filing
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="e.g., merger agreement, acquisition..."
                    value={clauseFilingQuery}
                    onChange={e => setClauseFilingQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleClauseFilingSearch()}
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '0.85rem' }}
                  />
                  <button className="primary-btn sm" onClick={handleClauseFilingSearch} disabled={clauseFilingSearching}>
                    {clauseFilingSearching ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
                  </button>
                </div>

                {clauseFilings.length > 0 && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {clauseFilings.map((f, i) => (
                      <div
                        key={i}
                        onClick={() => setSelectedClauseFiling(f)}
                        style={{
                          padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                          background: selectedClauseFiling?.accessionNumber === f.accessionNumber ? 'rgba(179,31,126,0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${selectedClauseFiling?.accessionNumber === f.accessionNumber ? 'rgba(179,31,126,0.3)' : 'rgba(255,255,255,0.05)'}`,
                          color: 'white'
                        }}
                      >
                        {f.entityName} <span style={{ color: '#94A3B8' }}>— {f.formType} ({f.fileDate})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 2: Select clause type and extract */}
              <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid #334155', padding: '16px', borderRadius: '12px', marginBottom: '24px', display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                    Step 2: Select clause type
                  </label>
                  <select
                    className="select-input"
                    style={{ width: '100%' }}
                    value={selectedClause}
                    onChange={e => { setSelectedClause(e.target.value); setClauseResults(null); }}
                  >
                    {CLAUSE_TYPES.map(k => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="primary-btn sm"
                  onClick={handleExtractClauses}
                  disabled={!selectedClauseFiling || clauseLoading}
                >
                  {clauseLoading ? <Loader2 size={14} className="spinner" /> : <Link2 size={16} />} Extract Clause
                </button>
              </div>

              {/* Results */}
              {clauseLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px', color: '#94A3B8' }}>
                  <Loader2 size={16} className="spinner" /> AI is extracting clause language...
                </div>
              )}

              {clauseResults && !clauseLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {Object.entries(clauseResults).map(([clauseType, data]) => (
                    <div key={clauseType} style={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#D66CAE' }}>{clauseType}</h3>
                        <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{data.section}</span>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.6 }}>{data.text}</p>
                      <div style={{ marginTop: '12px', fontSize: '0.75rem', color: '#64748B' }}>
                        From: {selectedClauseFiling?.entityName} ({selectedClauseFiling?.fileDate})
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!clauseLoading && !clauseResults && selectedClauseFiling && (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
                  Select a clause type and click "Extract Clause" to analyze the filing.
                </div>
              )}

              {!selectedClauseFiling && !clauseLoading && (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
                  Search for a merger filing above, then select it to extract clauses.
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

