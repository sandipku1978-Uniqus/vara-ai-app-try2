'use client';

/**
 * Year-over-year section change matrix (benchmark C2–C4 seed).
 *
 * Rows are the taxonomy's section concepts, columns are the selected peers,
 * each cell classifies how much of that section changed between the filer's
 * two most recent annual reports — heat-shaded by the deterministic bucket,
 * with the exact changed percentage shown rather than implied. Clicking a
 * cell opens the redline of the two section texts.
 *
 * Measurement runs on the same engine-normalized slices the section-scope
 * filter uses, so "38% changed" is reproducible from search behaviour. The
 * redline therefore shows normalized text (case and punctuation removed) —
 * labelled as such, never passed off as the filing's typography.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchFilingText, type SecSubmission } from '../../services/secApi';
import { extractItemSection } from '../../utils/sectionPath';
import { resolveSectionScope, SECTION_CONCEPT_LIST } from '../../utils/sectionTaxonomy';
import { CHANGE_BUCKET_LABELS, computeSectionChange, type SectionChange } from '../../utils/sectionDiff';
import { TextDiffViewer } from './TextDiffViewer';

interface AnnualPeriod {
  accession: string;
  primaryDocument: string;
  reportDate: string;
}

interface CompanyChanges {
  ticker: string;
  name: string;
  currentDate: string;
  priorDate: string;
  /** concept key → change plus the two slices for the redline. */
  cells: Record<string, { change: SectionChange; priorSlice: string; currentSlice: string }>;
  error?: string;
}

/** The filer's two most recent annual periods, amendments winning their period. */
export function pickAnnualPeriods(submission: SecSubmission): AnnualPeriod[] {
  const recent = submission.filings.recent;
  const byPeriod = new Map<string, AnnualPeriod>();
  recent.form.forEach((form, index) => {
    if (form !== '10-K' && form !== '10-K/A') return;
    const reportDate = recent.reportDate?.[index] || recent.filingDate?.[index] || '';
    if (!reportDate) return;
    const existing = byPeriod.get(reportDate);
    // Amendments are the authoritative text for their period; among equals
    // the earlier-listed (newer) filing wins.
    if (!existing || form === '10-K/A') {
      if (existing && form !== '10-K/A') return;
      byPeriod.set(reportDate, {
        accession: recent.accessionNumber[index],
        primaryDocument: recent.primaryDocument[index],
        reportDate,
      });
    }
  });
  return Array.from(byPeriod.values())
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, 2);
}

const BUCKET_STYLE: Record<string, { background: string; color: string }> = {
  major: { background: 'color-mix(in srgb, var(--status-error, #d64545) 22%, transparent)', color: 'var(--status-error, #d64545)' },
  moderate: { background: 'color-mix(in srgb, var(--status-warning, #d69a45) 20%, transparent)', color: 'var(--status-warning, #d69a45)' },
  minor: { background: 'color-mix(in srgb, var(--status-warning, #d69a45) 9%, transparent)', color: 'var(--text-secondary)' },
  unchanged: { background: 'transparent', color: 'var(--text-muted)' },
  new: { background: 'color-mix(in srgb, var(--status-success, #3f9d63) 18%, transparent)', color: 'var(--status-success, #3f9d63)' },
  deleted: { background: 'color-mix(in srgb, var(--status-error, #d64545) 12%, transparent)', color: 'var(--status-error, #d64545)' },
};

export default function YoYChangeMatrix({
  tickers,
  companiesData,
}: {
  tickers: string[];
  companiesData: Record<string, SecSubmission>;
}) {
  const [rowsByTicker, setRowsByTicker] = useState<Record<string, CompanyChanges>>({});
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ ticker: string; concept: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setSelectedCell(null);
      const next: Record<string, CompanyChanges> = {};

      for (const ticker of tickers) {
        const submission = companiesData[ticker];
        if (!submission) continue;
        const periods = pickAnnualPeriods(submission);
        if (periods.length < 2) {
          next[ticker] = {
            ticker, name: submission.name || ticker, currentDate: periods[0]?.reportDate || '', priorDate: '',
            cells: {}, error: 'Fewer than two annual reports on file',
          };
          continue;
        }

        try {
          const [current, prior] = periods;
          const cik = String(submission.cik);
          const [currentText, priorText] = await Promise.all([
            fetchFilingText(cik, current.accession.replace(/-/g, ''), current.primaryDocument),
            fetchFilingText(cik, prior.accession.replace(/-/g, ''), prior.primaryDocument),
          ]);
          if (!currentText || !priorText) {
            next[ticker] = {
              ticker, name: submission.name || ticker, currentDate: current.reportDate, priorDate: prior.reportDate,
              cells: {}, error: 'Filing text could not be retrieved',
            };
            continue;
          }

          const cells: CompanyChanges['cells'] = {};
          for (const concept of SECTION_CONCEPT_LIST) {
            const resolved = resolveSectionScope(concept.key, '10-K');
            if (!resolved) continue;
            const currentSlice = extractItemSection(currentText, resolved.item, resolved.options);
            const priorSlice = extractItemSection(priorText, resolved.item, resolved.options);
            cells[concept.key] = {
              change: computeSectionChange(priorSlice, currentSlice),
              priorSlice,
              currentSlice,
            };
          }
          next[ticker] = {
            ticker, name: submission.name || ticker,
            currentDate: current.reportDate, priorDate: prior.reportDate, cells,
          };
        } catch {
          next[ticker] = {
            ticker, name: submission.name || ticker, currentDate: '', priorDate: '',
            cells: {}, error: 'Filing text could not be retrieved',
          };
        }
        if (cancelled) return;
        setRowsByTicker({ ...next });
      }
      if (!cancelled) setLoading(false);
    }
    if (tickers.length > 0) void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join('|'), companiesData]);

  const selected = useMemo(() => {
    if (!selectedCell) return null;
    const company = rowsByTicker[selectedCell.ticker];
    const cell = company?.cells[selectedCell.concept];
    if (!company || !cell) return null;
    const concept = SECTION_CONCEPT_LIST.find(c => c.key === selectedCell.concept);
    return { company, cell, conceptLabel: concept?.label || selectedCell.concept };
  }, [selectedCell, rowsByTicker]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="glass-card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
            Year-over-year section changes — latest 10-K vs prior
          </h4>
          <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Deterministic change measure: percentage of section tokens added or removed between the two periods.
            Click a cell for the redline. {loading ? 'Comparing…' : ''}
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
          <thead>
            <tr style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)' }}>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Section</th>
              {tickers.map(ticker => {
                const company = rowsByTicker[ticker];
                return (
                  <th scope="col" key={ticker} style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {ticker}
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                      {company?.error
                        ? company.error
                        : company
                          ? `${company.priorDate.slice(0, 4)} → ${company.currentDate.slice(0, 4)}`
                          : 'Loading…'}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody style={{ fontSize: '0.82rem' }}>
            {SECTION_CONCEPT_LIST.map(concept => (
              <tr key={concept.key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th scope="row" style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>{concept.label}</th>
                {tickers.map(ticker => {
                  const cell = rowsByTicker[ticker]?.cells[concept.key];
                  if (!cell) {
                    return <td key={ticker} style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>—</td>;
                  }
                  const { change } = cell;
                  // A section absent from BOTH periods is "not found", never
                  // "unchanged" — an empty comparison earns no verdict.
                  if (change.priorTokens === 0 && change.currentTokens === 0) {
                    return <td key={ticker} style={{ padding: '12px 16px', color: 'var(--text-muted)' }} title="Section not found in either period">n/a</td>;
                  }
                  const style = BUCKET_STYLE[change.bucket];
                  const isSelected = selectedCell?.ticker === ticker && selectedCell?.concept === concept.key;
                  return (
                    <td key={ticker} style={{ padding: '6px 8px' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedCell({ ticker, concept: concept.key })}
                        aria-pressed={isSelected}
                        title={`${CHANGE_BUCKET_LABELS[change.bucket]} — ${change.addedTokens} tokens added, ${change.removedTokens} removed`}
                        style={{
                          width: '100%', textAlign: 'left', cursor: 'pointer', padding: '7px 10px', borderRadius: '6px',
                          border: isSelected ? '1px solid var(--accent-primary)' : '1px solid transparent',
                          background: style.background, color: style.color, fontSize: '0.78rem', fontWeight: 600,
                        }}
                      >
                        {CHANGE_BUCKET_LABELS[change.bucket]}
                        <span style={{ display: 'block', fontSize: '0.68rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                          {change.bucket === 'new' || change.bucket === 'deleted'
                            ? `${Math.max(change.currentTokens, change.priorTokens).toLocaleString()} tokens`
                            : `${Math.round(change.changedRatio * 100)}% of tokens`}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
                {selected.company.ticker} — {selected.conceptLabel}: {selected.company.priorDate.slice(0, 4)} → {selected.company.currentDate.slice(0, 4)}
              </h4>
              <div style={{ marginTop: '2px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Normalized comparison text (case and punctuation removed) — the same form the change percentage is measured on.
              </div>
            </div>
            <button type="button" onClick={() => setSelectedCell(null)} aria-label="Close section redline"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }}>×</button>
          </div>
          <div style={{ maxHeight: '480px', overflow: 'auto', padding: '12px 16px' }}>
            <TextDiffViewer oldText={selected.cell.priorSlice} newText={selected.cell.currentSlice} />
          </div>
        </div>
      )}
    </div>
  );
}
