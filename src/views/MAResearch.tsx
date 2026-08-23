'use client';

import EntitySearchInput from '../components/filters/EntitySearchInput';
import { useState, useEffect, useCallback } from 'react';
import { FileSearch, Scale, Link2, Search, Briefcase, Loader2 } from 'lucide-react';
import { searchEdgarFilings, fetchFilingText, buildSecFilingIndexUrl } from '../services/secApi';
import { resolveEntityScope } from '../services/filingResearch';
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
  extractedDetails?: DealDetailsResult;
  extracting?: boolean;
  extractionError?: string;
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

/**
 * The phrase counterparties use for a resolved issuer: its EDGAR title with
 * the corporate boilerplate removed, quoted. "ON SEMICONDUCTOR CORP" →
 * "ON SEMICONDUCTOR", which is how Synaptics' Form 425s refer to onsemi.
 * Built from the RESOLVED title, never from what was typed — picking a
 * suggestion hands the view a ticker ("ON"), and a ticker as full text
 * matches every filing containing the word.
 */
export function counterpartyPhrase(title: string): string {
  const core = title
    .replace(/\/[^/]*\//g, ' ')
    .replace(/[,.()]/g, ' ')
    .replace(/\b(corp|corporation|inc|incorporated|llc|ltd|limited|plc|co|company|holdings?|group|nv|sa|ag|se)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return core.length >= 3 ? `"${core}"` : '';
}

// Module-level cache
const dealDetailsCache = new Map<string, DealDetailsResult>();
const clauseCache = new Map<string, Record<string, { text: string; section: string }>>();

export default function MAResearch() {
  const [activeTab, setActiveTab] = useState<'screener' | 'clauses'>('screener');
  const [searchQuery, setSearchQuery] = useState('');

  // Deal screener state
  const [dealFilings, setDealFilings] = useState<DealFiling[]>([]);
  // Whether the rows are the generic recent-deals feed or a server search the
  // user ran for a company. The two are filtered differently (see
  // filteredDeals): the feed is narrowed client-side as you type, a server
  // search already matched the text against filing CONTENT and must not be
  // second-guessed by filer name.
  const [dealSource, setDealSource] = useState<'feed' | 'search'>('feed');
  const [dealLoading, setDealLoading] = useState(false);
  const [dealError, setDealError] = useState('');

  // Clause library state
  const [selectedClause, setSelectedClause] = useState(CLAUSE_TYPES[0]);
  const [clauseResults, setClauseResults] = useState<Record<string, { text: string; section: string }> | null>(null);
  const [clauseLoading, setClauseLoading] = useState(false);
  const [clauseFilingQuery, setClauseFilingQuery] = useState('');
  const [clauseFilingSearching, setClauseFilingSearching] = useState(false);
  const [clauseSearchCompleted, setClauseSearchCompleted] = useState(false);
  const [clauseSearchError, setClauseSearchError] = useState('');
  const [clauseFilings, setClauseFilings] = useState<DealFiling[]>([]);
  const [selectedClauseFiling, setSelectedClauseFiling] = useState<DealFiling | null>(null);
  const [clauseExtractionError, setClauseExtractionError] = useState('');

  const loadDeals = useCallback(async () => {
    setDealLoading(true);
    setDealError('');
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
      setDealFilings(filings.sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || '')));
      setDealSource('feed');
    } catch (error) {
      console.error('M&A deal screener error:', error);
      setDealFilings([]);
      setDealError('Recent M&A filings could not be loaded from SEC EDGAR. No empty-result conclusion can be drawn.');
    } finally {
      setDealLoading(false);
    }
  }, []);

  useEffect(() => { void loadDeals(); }, [loadDeals]);

  // Server-side entity deal search: the text box used to only filter the
  // pre-loaded feed rows client-side, so any deal outside the feed
  // (e.g. Organon / Sun Pharma) looked like it didn't exist.
  const searchDealsForEntity = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) { void loadDeals(); return; }
    setDealLoading(true);
    setDealError('');
    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const dateFrom = oneYearAgo.toISOString().split('T')[0];
      const dateTo = new Date().toISOString().split('T')[0];
      const forms = '8-K,8-K/A,SC 13D,SC TO-T,DEFM14A,S-4,425';
      const scoped = await resolveEntityScope(trimmed, 'aggressive');
      // A deal has two filers. Scoping to the resolved issuer's CIK returns
      // only what THAT company filed (the target's 8-K and 425s), never the
      // acquirer's merger 8-K or S-4 — so the issuer-scoped lane runs beside
      // an unscoped full-text lane for the company's name phrase, which is
      // how the counterparty's documents refer to it. Both lanes are merged;
      // the text lane is best-effort and never sinks the scoped one.
      const phrase = scoped.entityName ? counterpartyPhrase(scoped.entityName) : '';
      const lanes = scoped.entityName
        ? [
            searchEdgarFilings(
              scoped.query || 'merger agreement OR acquisition',
              forms, dateFrom, dateTo, scoped.entityName, 100,
              scoped.cik ? { entityCik: scoped.cik } : {}
            ),
            ...(phrase ? [searchEdgarFilings(phrase, forms, dateFrom, dateTo, undefined, 100).catch(() => [])] : []),
          ]
        : [searchEdgarFilings(trimmed, forms, dateFrom, dateTo, undefined, 100)];
      // Interleave the lanes instead of concatenating them. A prolific filer
      // (Dominion Energy issues a Form 425 almost daily) fills the 30-row cap
      // from its own lane alone, and the counterparty never gets a slot —
      // observed in production: "Dominion Energy" showed 30 Dominion rows
      // and not one NextEra filing. Round-robin gives each side a fair share
      // and lets either lane take the remainder when the other runs dry.
      const laneHits = await Promise.all(lanes);
      const hits: typeof laneHits[number] = [];
      for (let index = 0; laneHits.some(lane => index < lane.length); index += 1) {
        for (const lane of laneHits) if (index < lane.length) hits.push(lane[index]);
      }
      const seen = new Set<string>();
      const filings: DealFiling[] = [];
      for (const hit of hits) {
        if (filings.length >= 30) break;
        const src = hit._source as any;
        const entityName = src?.display_names?.[0] || src?.entity_name || '';
        const accession = src?.adsh || '';
        const rowKey = `${entityName}|${accession}`.toUpperCase();
        if (!entityName || seen.has(rowKey)) continue;
        seen.add(rowKey);
        const idParts = hit._id.split(':');
        filings.push({
          entityName: entityName.replace(/\s*\(CIK\s+\d+\)/, '').trim(),
          fileDate: src?.file_date || '',
          formType: src?.file_type || src?.form || '8-K',
          accessionNumber: accession,
          cik: (src?.ciks?.[0] || '').replace(/^0+/, ''),
          primaryDocument: idParts.length > 1 ? idParts[1] : '',
        });
      }
      setDealFilings(filings.sort((a, b) => (b.fileDate || '').localeCompare(a.fileDate || '')));
      setDealSource('search');
    } catch (error) {
      console.error('M&A entity deal search error:', error);
      setDealError('The entity deal search could not reach SEC EDGAR. No empty-result conclusion can be drawn.');
    } finally {
      setDealLoading(false);
    }
  }, [loadDeals]);

  // Extract deal details on demand
  const handleExtractDetails = useCallback(async (idx: number) => {
    const filing = dealFilings[idx];
    if (!filing || filing.extracting || filing.extractedDetails !== undefined) return;

    // Check cache
    if (dealDetailsCache.has(filing.accessionNumber)) {
      setDealFilings(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], extractedDetails: dealDetailsCache.get(filing.accessionNumber)!, extractionError: undefined };
        return updated;
      });
      return;
    }

    setDealFilings(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], extracting: true, extractionError: undefined };
      return updated;
    });

    try {
      if (!filing.cik || !filing.primaryDocument) {
        throw new Error('The filing document could not be resolved from SEC metadata.');
      }
      const text = await fetchFilingText(filing.cik, filing.accessionNumber, filing.primaryDocument);
      if (text.trim().length <= 200) throw new Error('The filing text was unavailable.');
      const details = await aiExtractDealDetails(text);
      dealDetailsCache.set(filing.accessionNumber, details);

      setDealFilings(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], extractedDetails: details, extracting: false, extractionError: undefined };
        return updated;
      });
    } catch (error) {
      console.error('M&A detail extraction error:', error);
      setDealFilings(prev => {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          extractedDetails: undefined,
          extracting: false,
          extractionError: 'Analysis failed. Reload the source evidence and retry.',
        };
        return updated;
      });
    }
  }, [dealFilings]);

  // Narrow the generic feed as the user types. NEVER applied to a server
  // search: those rows already matched the text against filing content, and
  // re-filtering them by filer name discarded every counterparty document —
  // "Onsemi" fetched 64 deal filings (filed by SYNAPTICS Inc and ON
  // SEMICONDUCTOR CORP, neither name containing "onsemi") and rendered
  // "No M&A filings found".
  const filteredDeals = dealSource === 'search' || !searchQuery.trim()
    ? dealFilings
    : dealFilings.filter(d => {
        const q = searchQuery.toLowerCase();
        return d.entityName.toLowerCase().includes(q) ||
          (d.extractedDetails?.target || '').toLowerCase().includes(q) ||
          (d.extractedDetails?.acquirer || '').toLowerCase().includes(q);
      });

  // Search for filings for clause extraction
  const handleClauseFilingSearch = useCallback(async () => {
    if (!clauseFilingQuery.trim()) return;
    setClauseFilingSearching(true);
    setClauseSearchCompleted(false);
    setClauseSearchError('');
    setSelectedClauseFiling(null);
    setClauseResults(null);
    setClauseExtractionError('');
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
    } catch (error) {
      console.error('M&A clause filing search error:', error);
      setClauseFilings([]);
      setClauseSearchError('The SEC filing search failed. No zero-result conclusion can be drawn; retry the same search.');
    } finally {
      setClauseFilingSearching(false);
      setClauseSearchCompleted(true);
    }
  }, [clauseFilingQuery]);

  // Extract clauses from selected filing
  const handleExtractClauses = useCallback(async () => {
    if (!selectedClauseFiling) return;
    const cacheKey = `${selectedClauseFiling.accessionNumber}:${selectedClause}`;
    if (clauseCache.has(cacheKey)) {
      setClauseExtractionError('');
      setClauseResults(clauseCache.get(cacheKey)!);
      return;
    }

    setClauseLoading(true);
    setClauseResults(null);
    setClauseExtractionError('');
    try {
      if (!selectedClauseFiling.cik || !selectedClauseFiling.primaryDocument) {
        throw new Error('The filing document could not be resolved from SEC metadata.');
      }
      const text = await fetchFilingText(selectedClauseFiling.cik, selectedClauseFiling.accessionNumber, selectedClauseFiling.primaryDocument);
      if (text.trim().length <= 200) throw new Error('The filing text was unavailable.');
      const result = await aiExtractClauses(text, [selectedClause]);
      clauseCache.set(cacheKey, result);
      setClauseResults(result);
    } catch (error) {
      console.error('Clause extraction error:', error);
      setClauseExtractionError('Clause extraction failed. The filing evidence is unchanged; retry when the source and AI service are available.');
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
          <nav className="ma-nav" aria-label="M&A research views">
            <button type="button" aria-pressed={activeTab === 'screener'} className={`nav-btn ${activeTab === 'screener' ? 'active' : ''}`} onClick={() => setActiveTab('screener')}>
              <Briefcase size={18} /> Deal Screener
            </button>
            <button type="button" aria-pressed={activeTab === 'clauses'} className={`nav-btn ${activeTab === 'clauses' ? 'active' : ''}`} onClick={() => setActiveTab('clauses')}>
              <Scale size={18} /> Clause Library
            </button>
          </nav>

          <div className="sidebar-filters" style={{ marginTop: '20px' }}>
            <h4>Data Source</h4>
            <div style={{ marginTop: '8px', padding: '10px', background: 'var(--surface-accent)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Deal data sourced from SEC EDGAR full-text search. Click "Extract" on any deal to run AI analysis on the filing text.
              </p>
            </div>
          </div>
        </aside>

        <section className="ma-main glass-card" style={{ overflow: 'auto' }}>
          {activeTab === 'screener' && (
            <div className="tab-pane fade-in">
              <div className="ma-pane-header">
                <div>
                  <h2>Recent M&A Filings</h2>
                  <p className="text-sm" style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>The 15 most recent 8-K, SC 13D, and SC TO-T filings mentioning mergers or acquisitions — search by company for a specific deal.</p>
                </div>
                <div className="search-bar-inline">
                  <Search size={16} className="search-bar-icon" />
                  <label className="sr-only" htmlFor="ma-entity-filter">Filter M&amp;A filings by entity name</label>
                  <EntitySearchInput
                    id="ma-entity-filter"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search deals by company (press Enter)..."
                    ariaLabel="Filter M&A filings by entity name"
                    onSubmit={() => searchDealsForEntity(searchQuery)}
                    onPick={entry => {
                      setSearchQuery(entry.ticker);
                      void searchDealsForEntity(entry.ticker);
                    }}
                    inputStyle={{ background: 'transparent', border: 'none', borderRadius: 0, padding: 0, fontSize: 'inherit' }}
                  />
                </div>
              </div>

              {dealLoading ? (
                <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', gap: '8px', color: 'var(--text-muted)' }}>
                  <Loader2 size={16} className="spinner" /> Loading M&A filings from EDGAR...
                </div>
              ) : dealError ? (
                <div role="alert" style={{ padding: '24px', textAlign: 'center', color: 'var(--status-error)' }}>
                  <p>{dealError}</p>
                  <button type="button" className="secondary-btn" onClick={() => void loadDeals()} style={{ marginTop: '8px' }}>Retry filings</button>
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
              <div className="ma-table-scroll" style={{ border: '1px solid var(--border-color)', borderRadius: '6px', marginBottom: '20px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <caption className="sr-only">Recent SEC filings associated with mergers and acquisitions</caption>
                  <thead>
                    <tr style={{ background: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-header-border)', fontSize: '0.875rem' }}>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>Entity</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>Form</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>Filed</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>AI Details</th>
                      <th scope="col" style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeals.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>No M&amp;A filings found.</td></tr>
                    ) : filteredDeals.map((deal, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 500, color: 'var(--text-primary)' }}>{deal.entityName}</td>
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{ background: 'var(--surface-subtle)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{deal.formType}</span>
                        </td>
                        <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{deal.fileDate}</td>
                        <td style={{ padding: '9px 12px' }}>
                          {deal.extracting ? (
                            <span role="status" style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Loader2 size={12} className="spinner" /> Extracting...
                            </span>
                          ) : deal.extractedDetails ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                              <div>{deal.extractedDetails.target} / {deal.extractedDetails.acquirer}</div>
                              <div style={{ color: 'var(--status-success)' }}>{deal.extractedDetails.value} — {deal.extractedDetails.dealType}</div>
                            </div>
                          ) : deal.extractionError ? (
                            <span role="alert" style={{ color: 'var(--status-error)', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              {deal.extractionError}
                              <button type="button" className="secondary-btn" onClick={() => void handleExtractDetails(dealFilings.indexOf(deal))}>Retry</button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleExtractDetails(dealFilings.indexOf(deal))}
                              style={{ background: 'var(--interactive-hover)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)', color: 'var(--accent-primary)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                            >
                              Extract with AI
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                            <a
                              href={buildSecFilingIndexUrl(deal.cik, deal.accessionNumber)}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
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
              <div style={{ marginBottom: '16px' }}>
                <h2>AI Clause Extraction</h2>
                <p className="text-sm" style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>Search for a merger filing, then extract specific clause types with AI.</p>
              </div>

              {/* Step 1: Find a filing */}
              <div className="ma-clause-step" style={{ marginBottom: '16px' }}>
                <label htmlFor="ma-clause-filing-search" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Step 1: Search for a merger filing
                </label>
                <div className="ma-clause-search-row">
                  <input
                    id="ma-clause-filing-search"
                    type="text"
                    placeholder="e.g., merger agreement, acquisition..."
                    value={clauseFilingQuery}
                    onChange={e => {
                      setClauseFilingQuery(e.target.value);
                      setClauseSearchCompleted(false);
                      setClauseSearchError('');
                    }}
                    onKeyDown={e => e.key === 'Enter' && handleClauseFilingSearch()}
                    style={{ flex: 1, padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                  />
                  <button type="button" className="primary-btn sm" onClick={handleClauseFilingSearch} disabled={clauseFilingSearching}>
                    {clauseFilingSearching ? <Loader2 size={14} className="spinner" /> : <Search size={14} />} Search
                  </button>
                </div>

                {clauseFilings.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {clauseFilings.map((f, i) => (
                      <button
                        type="button"
                        key={i}
                        className="ma-clause-option"
                        aria-pressed={selectedClauseFiling?.accessionNumber === f.accessionNumber}
                        onClick={() => {
                          setSelectedClauseFiling(f);
                          setClauseResults(null);
                          setClauseExtractionError('');
                        }}
                        style={{
                          background: selectedClauseFiling?.accessionNumber === f.accessionNumber ? 'var(--interactive-hover-strong)' : 'var(--surface-panel-strong)',
                          border: `1px solid ${selectedClauseFiling?.accessionNumber === f.accessionNumber ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        }}
                      >
                        {f.entityName} <span style={{ color: 'var(--text-muted)' }}>— {f.formType} ({f.fileDate})</span>
                      </button>
                    ))}
                  </div>
                )}
                {clauseSearchError && !clauseFilingSearching && (
                  <div role="alert" style={{ marginTop: '8px', color: 'var(--status-error)' }}>
                    <p>{clauseSearchError}</p>
                    <button type="button" className="secondary-btn" onClick={() => void handleClauseFilingSearch()} style={{ marginTop: '6px' }}>Retry filing search</button>
                  </div>
                )}
                {clauseSearchCompleted && !clauseFilingSearching && !clauseSearchError && clauseFilings.length === 0 && (
                  <p style={{ marginTop: '8px', color: 'var(--text-muted)' }}>No matching merger filings were returned.</p>
                )}
              </div>

              {/* Step 2: Select clause type and extract */}
              <div className="ma-clause-step ma-clause-controls" style={{ marginBottom: '16px', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="ma-clause-type" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Step 2: Select clause type
                  </label>
                  <select
                    id="ma-clause-type"
                    className="select-input"
                    style={{ width: '100%' }}
                    value={selectedClause}
                    onChange={e => { setSelectedClause(e.target.value); setClauseResults(null); setClauseExtractionError(''); }}
                  >
                    {CLAUSE_TYPES.map(k => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="primary-btn sm"
                  onClick={handleExtractClauses}
                  disabled={!selectedClauseFiling || clauseLoading}
                >
                  {clauseLoading ? <Loader2 size={14} className="spinner" /> : <Link2 size={16} />} Extract Clause
                </button>
              </div>

              {/* Results */}
              {clauseLoading && (
                <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px', gap: '8px', color: 'var(--text-muted)' }}>
                  <Loader2 size={16} className="spinner" /> AI is extracting clause language...
                </div>
              )}

              {clauseExtractionError && !clauseLoading && (
                <div role="alert" style={{ padding: '24px', textAlign: 'center', color: 'var(--status-error)' }}>
                  <p>{clauseExtractionError}</p>
                  <button type="button" className="secondary-btn" onClick={() => void handleExtractClauses()} style={{ marginTop: '8px' }}>Retry clause extraction</button>
                </div>
              )}

              {clauseResults && !clauseLoading && !clauseExtractionError && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {Object.entries(clauseResults).map(([clauseType, data]) => (
                    <div key={clauseType} style={{ background: 'var(--surface-panel-strong)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--accent-primary)' }}>{clauseType}</h3>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{data.section}</span>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.text}</p>
                      <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        From: {selectedClauseFiling?.entityName} ({selectedClauseFiling?.fileDate})
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!clauseLoading && !clauseResults && !clauseExtractionError && selectedClauseFiling && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Select a clause type and click "Extract Clause" to analyze the filing.
                </div>
              )}

              {!selectedClauseFiling && !clauseLoading && !clauseFilingSearching && !clauseSearchError && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Search for a merger filing above, then select it to extract clauses.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
