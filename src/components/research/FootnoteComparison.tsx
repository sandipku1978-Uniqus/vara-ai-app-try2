'use client';

/**
 * Footnote comparison: one note topic across the peer set, side by side, each
 * company's note text with its own tables, aligned by fiscal period (period
 * of report). Every column carries a status chip — Disclosed, Not disclosed,
 * Could not extract, or No filing for period — and names the exact document
 * the note was read from.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import CiteButton from '../memo/CiteButton';
import { boundExcerpt } from '../../services/memoTray';
import { buildSecDocumentUrl, buildSecProxyUrl, type SecSubmission } from '../../services/secApi';
import { splitIntoParagraphs } from '../../lib/filingText';
import { SECTION_CONCEPTS } from '../../utils/sectionTaxonomy';
import { mapWithConcurrency } from '../../utils/sectionMatrix';
import {
  FOOTNOTE_COMPANY_CAP,
  FOOTNOTE_STATUS_LABELS,
  availableFiscalYears,
  fiscalYearOf,
  locateFootnote,
  pickFilingForPeriod,
  type ArchiveLoader,
  type FootnoteResult,
  type FootnoteStatus,
} from '../../services/footnoteComparison';

/** The note topics offered: every Notes concept of the taxonomy except the auditor's CAMs. */
const NOTE_TOPICS = SECTION_CONCEPTS.filter(concept => concept.group === 'notes' && concept.key !== 'critical-audit-matters');

const PREVIEW_CHARS = 5000;
const TABLE_ROW_CAP = 40;

/** Results by accession + topic: switching back to a topic costs nothing. */
const resultCache = new Map<string, FootnoteResult>();

const loadArchive: ArchiveLoader = async path => {
  const response = await fetch(buildSecProxyUrl(path));
  if (!response.ok) throw new Error(`SEC fetch failed (${response.status})`);
  return response.text();
};

const CHIP_STYLE: Record<FootnoteStatus, { color: string; background: string }> = {
  disclosed: { color: 'var(--status-success)', background: 'color-mix(in srgb, var(--status-success) 12%, transparent)' },
  'not-disclosed': { color: 'var(--text-secondary)', background: 'var(--surface-subtle)' },
  'could-not-extract': { color: 'var(--status-warning)', background: 'color-mix(in srgb, var(--status-warning) 12%, transparent)' },
  'no-filing': { color: 'var(--text-muted)', background: 'var(--surface-subtle)' },
};

export default function FootnoteComparison({
  tickers,
  companiesData,
}: {
  tickers: string[];
  companiesData: Record<string, SecSubmission>;
}) {
  const [topicKey, setTopicKey] = useState(NOTE_TOPICS.find(topic => topic.key === 'revenue-recognition')?.key ?? NOTE_TOPICS[0].key);
  const [period, setPeriod] = useState<'latest' | number>('latest');
  const [results, setResults] = useState<Record<string, FootnoteResult | 'loading'>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const cohort = useMemo(() => tickers.slice(0, FOOTNOTE_COMPANY_CAP), [tickers]);
  const years = useMemo(
    () => availableFiscalYears(cohort.map(ticker => companiesData[ticker]).filter(Boolean)),
    [cohort, companiesData],
  );
  const topic = NOTE_TOPICS.find(candidate => candidate.key === topicKey) ?? NOTE_TOPICS[0];

  useEffect(() => {
    let cancelled = false;
    const targets = cohort.filter(ticker => companiesData[ticker]);
    setResults(Object.fromEntries(targets.map(ticker => [ticker, 'loading' as const])));
    void mapWithConcurrency(targets, 3, async ticker => {
      const submission = companiesData[ticker];
      const cik = String(submission.cik);
      const filing = pickFilingForPeriod(submission, period);
      const cacheKey = filing ? `${filing.accession}|${topicKey}` : '';
      let result = cacheKey ? resultCache.get(cacheKey) : undefined;
      if (!result) {
        result = await locateFootnote({ conceptKey: topicKey, cik, filing, load: loadArchive }).catch(() => ({
          status: 'could-not-extract' as const,
          tables: [],
          source: filing ?? undefined,
          detail: 'The note could not be extracted — retry.',
        }));
        // Only verdicts that came from text that was read are cached.
        if (cacheKey && result.status !== 'could-not-extract') resultCache.set(cacheKey, result);
      }
      if (!cancelled) setResults(prev => ({ ...prev, [ticker]: result! }));
    });
    return () => { cancelled = true; };
  }, [cohort, companiesData, topicKey, period]);

  const counts = useMemo(() => {
    const tally: Record<FootnoteStatus, number> = { disclosed: 0, 'not-disclosed': 0, 'could-not-extract': 0, 'no-filing': 0 };
    for (const value of Object.values(results)) if (value !== 'loading') tally[value.status] += 1;
    return tally;
  }, [results]);
  const pending = Object.values(results).filter(value => value === 'loading').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="glass-card" style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Note
          <select className="select-input" value={topicKey} onChange={event => setTopicKey(event.target.value)} aria-label="Note topic to compare">
            {NOTE_TOPICS.map(option => (
              <option key={option.key} value={option.key}>
                {option.label}{option.topic?.asc ? ` (${option.topic.asc})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Fiscal period
          <select
            className="select-input"
            value={String(period)}
            onChange={event => setPeriod(event.target.value === 'latest' ? 'latest' : Number(event.target.value))}
            aria-label="Fiscal period (period of report) to compare"
          >
            <option value="latest">Latest annual report per company</option>
            {years.map(year => <option key={year} value={year}>FY{year} (period of report)</option>)}
          </select>
        </label>
        <span role="status" aria-live="polite" style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {pending > 0
            ? `Reading notes — ${cohort.length - pending} of ${cohort.length} done`
            : `${counts.disclosed} disclosed · ${counts['not-disclosed']} not disclosed · ${counts['could-not-extract']} could not extract${counts['no-filing'] ? ` · ${counts['no-filing']} no filing for period` : ''}`}
        </span>
      </div>
      {tickers.length > FOOTNOTE_COMPANY_CAP && (
        <p role="note" style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          Showing the first {FOOTNOTE_COMPANY_CAP} of {tickers.length} companies.
        </p>
      )}

      <div className="comparison-grid" style={{ overflowX: 'auto', paddingBottom: '16px' }}>
        {cohort.map(ticker => {
          const submission = companiesData[ticker];
          const result = results[ticker];
          const resolved = result && result !== 'loading' ? result : null;
          const source = resolved?.source;
          const sourceUrl = submission && source ? buildSecDocumentUrl(String(submission.cik), source.accession, source.primaryDocument) : '';
          const fullText = resolved?.text || '';
          const isExpanded = expanded[ticker];
          const shown = isExpanded ? fullText : fullText.slice(0, PREVIEW_CHARS);
          return (
            <section key={ticker} className="comparison-column glass-card" style={{ minWidth: '360px' }} aria-label={`${ticker} ${topic.label} note`}>
              <div className="column-header">
                <div className="col-ticker">{ticker}</div>
                <div className="col-name">{submission?.name || 'Company filing index not loaded'}</div>
                {resolved && (
                  <span style={{ display: 'inline-block', marginTop: '6px', padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, ...CHIP_STYLE[resolved.status] }}
                    title={resolved.detail}>
                    {resolved.status === 'no-filing' && typeof period === 'number'
                      ? `No FY${period} filing`
                      : FOOTNOTE_STATUS_LABELS[resolved.status]}
                  </span>
                )}
                {source && (
                  <div className="col-doc" style={{ marginTop: '6px' }}>
                    FY{fiscalYearOf(source)} · period of report {source.reportDate} ·{' '}
                    <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>
                      {source.form} {source.accession}
                    </a>
                  </div>
                )}
                {resolved?.status === 'disclosed' && submission && source && (
                  <div style={{ marginTop: '6px' }}>
                    <CiteButton
                      compact
                      citation={{
                        kind: 'filing',
                        cik: String(submission.cik),
                        accessionNumber: source.accession,
                        company: submission.name,
                        form: source.form,
                        fileDate: source.filingDate,
                        section: `${topic.label} note${resolved.heading ? ` — ${resolved.heading}` : ''}`,
                        excerpt: boundExcerpt(fullText, 2000),
                        sourceUrl,
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="column-body document-text">
                {!resolved ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                    {submission ? <><Loader2 size={16} className="spinner" /> Reading the note…</> : 'Company filing index not loaded.'}
                  </div>
                ) : resolved.status !== 'disclosed' ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{resolved.detail}</p>
                ) : (
                  <>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                      {resolved.detail} {resolved.via === 'xbrl-block' ? `Source: ${resolved.sourceFile}.` : ''}
                      {resolved.truncated ? ' The note ran past the length cap; open the filing for the rest.' : ''}
                    </p>
                    <div className="section-prose">
                      {splitIntoParagraphs(shown).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                    </div>
                    {fullText.length > PREVIEW_CHARS && (
                      <button type="button" className="secondary-btn" onClick={() => setExpanded(prev => ({ ...prev, [ticker]: !isExpanded }))}
                        aria-expanded={isExpanded}>
                        {isExpanded ? 'Show less' : `Show full note (${Math.round(fullText.length / 1000)}k characters)`}
                      </button>
                    )}
                    {resolved.tables.length > 0 && (
                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <h5 style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-primary)' }}>
                          Tables in this note ({resolved.tables.length})
                        </h5>
                        {resolved.tables.map((table, index) => (
                          <div key={index} style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: '0.72rem', minWidth: '100%' }}>
                              <caption style={{ textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', paddingBottom: '4px' }}>{table.title}</caption>
                              <tbody>
                                {table.rows.slice(0, TABLE_ROW_CAP).map((row, rowIndex) => (
                                  <tr key={rowIndex} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    {row.map((cell, cellIndex) => (
                                      <td key={cellIndex} style={{ padding: '3px 6px', color: 'var(--text-primary)', textAlign: cellIndex === 0 ? 'left' : 'right', whiteSpace: cellIndex === 0 ? 'normal' : 'nowrap' }}>{cell}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {table.rows.length > TABLE_ROW_CAP && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {table.rows.length - TABLE_ROW_CAP} more rows — open the filing for the full table.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
