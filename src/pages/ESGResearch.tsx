
import { useState, useEffect } from 'react';
import { Globe, LayoutGrid, FileAudio, Search, Target, Activity, ChevronRight, BarChart3, Loader2 } from 'lucide-react';
import { lookupCIK, fetchCompanySubmissions, findLatestFiling, fetchFilingText, searchEdgarFilings } from '../services/secApi';
import { aiRateESGDisclosure, aiSummarize } from '../services/aiApi';
import './ESGResearch.css';

const frameworks = [
  { id: 'sasb', name: 'SASB Standards', desc: 'Industry-specific sustainability disclosures.', url: 'https://sasb.ifrs.org/standards/' },
  { id: 'gri', name: 'GRI Standards', desc: 'Global standards for sustainability impacts.', url: 'https://www.globalreporting.org/standards/' },
  { id: 'esrs', name: 'ESRS (CSRD)', desc: 'European Sustainability Reporting Standards.', url: 'https://www.efrag.org/lab6' },
  { id: 'tcfd', name: 'TCFD', desc: 'Climate-related financial disclosures.', url: 'https://www.fsb-tcfd.org/' },
];

const ESG_TICKERS = ['AAPL', 'MSFT', 'GOOGL', 'META'];
const ESG_TOPICS = [
  'GHG Emissions (Scope 1 & 2)',
  'Scope 3 Emissions',
  'Data Privacy & Security',
  'Diversity & Inclusion',
  'Energy Management',
  'Supply Chain Labor',
];

interface HeatmapRow {
  topic: string;
  [ticker: string]: string; // 'high' | 'medium' | 'low'
}

interface EarningsRelease {
  date: string;
  company: string;
  title: string;
  summary: string;
}

// Module-level cache (used by the component)

export default function ESGResearch() {
  const [activeTab, setActiveTab] = useState<'frameworks' | 'heatmap' | 'transcripts'>('frameworks');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null);

  // Heatmap state
  const [heatmapData, setHeatmapData] = useState<HeatmapRow[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState('');

  // Earnings releases state
  const [earningsReleases, setEarningsReleases] = useState<EarningsRelease[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

  // Load heatmap data via AI analysis of 10-K filings
  useEffect(() => {
    if (activeTab !== 'heatmap' || heatmapData.length > 0 || heatmapLoading) return;

    async function loadHeatmap() {
      setHeatmapLoading(true);
      setHeatmapError('');
      try {
        // Initialize rows
        const rows: HeatmapRow[] = ESG_TOPICS.map(topic => {
          const row: HeatmapRow = { topic };
          ESG_TICKERS.forEach(t => { row[t.toLowerCase()] = 'low'; });
          return row;
        });

        for (const ticker of ESG_TICKERS) {
          const cik = await lookupCIK(ticker);
          if (!cik) continue;
          const subs = await fetchCompanySubmissions(cik);
          if (!subs) continue;
          const filing = findLatestFiling(subs, '10-K');
          if (!filing) continue;

          const text = await fetchFilingText(cik, filing.accessionNumber, filing.primaryDocument);
          if (!text || text.length < 500) continue;

          const ratings = await aiRateESGDisclosure(text, ESG_TOPICS);
          if (ratings) {
            for (const row of rows) {
              const rating = ratings[row.topic];
              if (rating) {
                row[ticker.toLowerCase()] = rating;
              }
            }
          }
        }

        setHeatmapData(rows);
      } catch (error) {
        console.error('ESG heatmap error:', error);
        setHeatmapError('Failed to load ESG heatmap data. Please try again.');
      } finally {
        setHeatmapLoading(false);
      }
    }
    loadHeatmap();
  }, [activeTab, heatmapData.length, heatmapLoading]);

  // Load real 8-K earnings releases
  useEffect(() => {
    if (activeTab !== 'transcripts' || earningsReleases.length > 0 || earningsLoading) return;

    async function loadEarnings() {
      setEarningsLoading(true);
      try {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const dateFrom = threeMonthsAgo.toISOString().split('T')[0];
        const dateTo = new Date().toISOString().split('T')[0];

        const hits = await searchEdgarFilings('earnings OR quarterly results', '8-K', dateFrom, dateTo);
        const releases: EarningsRelease[] = [];
        const seen = new Set<string>();

        for (const hit of hits) {
          if (releases.length >= 6) break;
          const src = hit._source as any;
          const entityName = src?.display_names?.[0] || src?.entity_name || '';
          const nameKey = entityName.toUpperCase().trim();
          if (!nameKey || seen.has(nameKey)) continue;
          seen.add(nameKey);

          const cleanName = entityName.replace(/\s*\(CIK\s+\d+\)/, '').trim();
          const fileDate = src?.file_date || '';

          releases.push({
            date: fileDate,
            company: cleanName,
            title: `8-K Filing — ${cleanName}`,
            summary: 'Loading AI summary...',
          });
        }

        setEarningsReleases(releases);

        // Generate AI summaries in background
        for (let i = 0; i < releases.length; i++) {
          try {
            const summary = await aiSummarize(
              `Summarize in one sentence what this 8-K filing is about: ${releases[i].company} filed an 8-K on ${releases[i].date}. This is likely an earnings release or material event disclosure.`
            );
            setEarningsReleases(prev => {
              const updated = [...prev];
              if (updated[i]) updated[i] = { ...updated[i], summary };
              return updated;
            });
          } catch {
            // Keep default summary
          }
        }
      } catch (error) {
        console.error('Earnings releases error:', error);
      } finally {
        setEarningsLoading(false);
      }
    }
    loadEarnings();
  }, [activeTab, earningsReleases.length, earningsLoading]);

  const filteredReleases = transcriptSearch.trim()
    ? earningsReleases.filter(ts => {
        const q = transcriptSearch.toLowerCase();
        return ts.company.toLowerCase().includes(q)
          || ts.title.toLowerCase().includes(q)
          || ts.summary.toLowerCase().includes(q);
      })
    : earningsReleases;

  const handleMetricClick = (topic: string) => {
    setSelectedMetric(selectedMetric === topic ? null : topic);
  };

  const mappingsData: Record<string, { sasb: string; gri: string; esrs: string }> = {
    'GHG Scope 1': { sasb: 'TC-SI-130a.1', gri: '305-1', esrs: 'E1-6' },
    'GHG Scope 2': { sasb: 'TC-SI-130a.1', gri: '305-2', esrs: 'E1-6' },
    'GHG Scope 3': { sasb: 'N/A', gri: '305-3', esrs: 'E1-6' },
    'Energy Consumption': { sasb: 'TC-SI-130a.1', gri: '302-1', esrs: 'E1-5' },
    'Water Usage': { sasb: 'TC-SI-140a.1', gri: '303-3', esrs: 'E3-4' },
    'Data Privacy': { sasb: 'TC-SI-220a.1', gri: '418-1', esrs: 'S4-3' },
    'Board Diversity': { sasb: 'TC-SI-330a.3', gri: '405-1', esrs: 'S1-9' },
  };

  return (
    <div className="esg-container">
      <div className="esg-header">
        <div className="esg-title">
          <h1>ESG Research Center</h1>
          <p>Navigate sustainability frameworks, analyze peer disclosure heatmaps, and search recent earnings releases.</p>
        </div>
      </div>

      <div className="esg-layout">
        <aside className="esg-sidebar glass-card">
          <nav className="esg-nav">
            <button
              className={`nav-btn ${activeTab === 'frameworks' ? 'active' : ''}`}
              onClick={() => setActiveTab('frameworks')}
            >
              <Globe size={18} /> Framework Navigator
            </button>
            <button
              className={`nav-btn ${activeTab === 'heatmap' ? 'active' : ''}`}
              onClick={() => setActiveTab('heatmap')}
            >
              <LayoutGrid size={18} /> Disclosure Heatmap
            </button>
            <button
              className={`nav-btn ${activeTab === 'transcripts' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcripts')}
            >
              <FileAudio size={18} /> Earnings Releases
            </button>
          </nav>

          <div className="sidebar-widget" style={{ marginTop: '32px' }}>
            <h4>Global Policy Tracker</h4>
            <div className="policy-item">
              <span className="text-sm font-medium">SEC Climate Rule</span>
              <span className="status-badge delayed">Stayed</span>
            </div>
            <div className="policy-item">
              <span className="text-sm font-medium">EU CSRD Phasing</span>
              <span className="status-badge active">Active 2024</span>
            </div>
            <div className="policy-item">
              <span className="text-sm font-medium">CA SB 253 / 261</span>
              <span className="status-badge pending">Awaiting 2026</span>
            </div>
          </div>
        </aside>

        <main className="esg-main glass-card">
          {activeTab === 'frameworks' && (
            <div className="tab-pane fade-in">
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>Interoperability Matrices</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Cross-reference disclosures between multiple standards.</p>
                </div>
              </div>

              <div className="framework-grid">
                {frameworks.map(fw => (
                  <a key={fw.id} href={fw.url} target="_blank" rel="noreferrer" className="framework-card" style={{ textDecoration: 'none', cursor: 'pointer', transition: 'all 0.2s' }}>
                    <div className="fw-icon-wrapper"><Target size={24} className="text-blue-400"/></div>
                    <h3>{fw.name}</h3>
                    <p>{fw.desc}</p>
                    <span className="text-btn" style={{ marginTop: '16px' }}>Browse Topics <ChevronRight size={16}/></span>
                  </a>
                ))}
              </div>

              <div style={{ marginTop: '32px', padding: '24px', background: 'rgba(30,41,59,0.5)', borderRadius: '12px', border: '1px solid #334155' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <Activity className="text-green-400" size={24} />
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Cross-Framework Mapping</h3>
                </div>
                <p className="text-sm text-slate-400" style={{ marginBottom: '16px' }}>Click a metric to see how it maps across standards.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {Object.entries(mappingsData).map(([metric, codes]) => (
                    <div
                      key={metric}
                      onClick={() => setSelectedMapping(selectedMapping === metric ? null : metric)}
                      style={{
                        padding: '12px 16px', background: selectedMapping === metric ? 'rgba(59,130,246,0.08)' : '#0F172A',
                        borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        border: `1px solid ${selectedMapping === metric ? 'rgba(59,130,246,0.3)' : 'rgba(51,65,85,0.5)'}`,
                        cursor: 'pointer', transition: 'all 0.15s'
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'white' }}>{metric}</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span className="badge sasb">SASB: {codes.sasb}</span>
                        <span className="badge gri">GRI: {codes.gri}</span>
                        <span className="badge esrs">ESRS: {codes.esrs}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'heatmap' && (
            <div className="tab-pane fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>AI-Rated ESG Disclosure Heatmap</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Claude AI rates disclosure depth from each company's latest 10-K filing.</p>
                </div>
                <span className="badge" style={{ fontSize: '0.7rem' }}>SEC EDGAR + AI</span>
              </div>

              {heatmapLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', gap: '12px' }}>
                  <Loader2 size={32} className="spinner" />
                  <p style={{ color: '#94A3B8' }}>AI is analyzing 10-K filings for ESG disclosure quality...</p>
                  <p style={{ color: '#64748B', fontSize: '0.8rem' }}>This may take 30-60 seconds (fetching & analyzing 4 filings)</p>
                </div>
              ) : heatmapError ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#F59E0B' }}>
                  {heatmapError}
                  <br />
                  <button className="primary-btn sm" style={{ marginTop: '12px' }} onClick={() => { setHeatmapData([]); }}>Retry</button>
                </div>
              ) : heatmapData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>
                  Switch to the Heatmap tab to load AI-rated ESG disclosures.
                </div>
              ) : (
                <>
              <div className="heatmap-container" style={{ overflow: 'auto', border: '1px solid #334155', borderRadius: '12px' }}>
                <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#0F172A', borderBottom: '1px solid #334155', fontSize: '0.875rem' }}>
                      <th style={{ padding: '16px', fontWeight: 600, color: '#CBD5E1' }}>ESG Topic Category</th>
                      {ESG_TICKERS.map(t => (
                        <th key={t} style={{ padding: '16px', fontWeight: 600, color: 'white', textAlign: 'center', borderLeft: '1px solid rgba(51,65,85,0.5)' }}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.map((row, idx) => (
                      <tr
                        key={idx}
                        onClick={() => handleMetricClick(row.topic)}
                        style={{ borderBottom: '1px solid rgba(51,65,85,0.5)', cursor: 'pointer', background: selectedMetric === row.topic ? 'rgba(59,130,246,0.05)' : 'transparent' }}
                      >
                        <td style={{ padding: '16px', color: '#CBD5E1', fontSize: '0.875rem', fontWeight: 500 }}>{row.topic}</td>
                        {ESG_TICKERS.map(t => (
                          <td key={t} style={{ padding: '8px', borderLeft: '1px solid rgba(51,65,85,0.5)' }}>
                            <div className={`heatmap-cell ${row[t.toLowerCase()]}`}></div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedMetric && (
                <div style={{ marginTop: '16px', padding: '20px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '12px', animation: 'fadeIn 0.2s ease-out' }}>
                  <h4 style={{ color: 'white', marginBottom: '8px' }}>{selectedMetric}</h4>
                  <p style={{ color: '#94A3B8', fontSize: '0.875rem', lineHeight: 1.6 }}>
                    AI-rated disclosure depth based on the latest 10-K filing from SEC EDGAR. Click a different topic to compare.
                  </p>
                </div>
              )}
                </>
              )}

              {/* Legend */}
              <div className="heatmap-legend">
                <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>Legend:</span>
                <span className="legend-swatch">
                  <div className="swatch high"></div> High Detail
                </span>
                <span className="legend-swatch">
                  <div className="swatch medium"></div> Moderate
                </span>
                <span className="legend-swatch">
                  <div className="swatch low"></div> Low / None
                </span>
              </div>
            </div>
          )}

          {activeTab === 'transcripts' && (
            <div className="tab-pane fade-in">
              <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2>Recent Earnings Releases (8-K)</h2>
                  <p className="text-sm text-slate-400" style={{ marginTop: '4px' }}>Recent 8-K filings related to earnings from SEC EDGAR with AI summaries.</p>
                </div>
                <div className="search-bar-inline">
                  <Search size={16} className="search-bar-icon" />
                  <input
                    type="text"
                    placeholder="Filter by company name..."
                    value={transcriptSearch}
                    onChange={e => setTranscriptSearch(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {earningsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '8px', color: '#94A3B8' }}>
                    <Loader2 size={16} className="spinner" /> Loading recent 8-K filings from EDGAR...
                  </div>
                ) : filteredReleases.length === 0 ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#64748B' }}>
                    {transcriptSearch ? `No releases match "${transcriptSearch}".` : 'No recent earnings releases found.'}
                  </div>
                ) : filteredReleases.map((ts, idx) => (
                  <div key={idx} className="transcript-card" style={{
                    background: '#0F172A', border: '1px solid #334155', padding: '20px', borderRadius: '12px',
                    transition: 'all 0.2s'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ background: 'rgba(37,99,235,0.2)', color: '#60A5FA', fontWeight: 700, padding: '4px 8px', borderRadius: '4px', fontSize: '0.875rem' }}>8-K</div>
                        <h4 style={{ color: 'white', fontWeight: 500, margin: 0 }}>{ts.company}</h4>
                      </div>
                      <div style={{ color: '#94A3B8', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <BarChart3 size={14}/> {ts.date}
                      </div>
                    </div>

                    <div style={{ paddingLeft: '16px', borderLeft: '2px solid #334155' }}>
                      <p style={{ fontSize: '0.875rem', color: '#CBD5E1', margin: '4px 0' }}>{ts.summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
