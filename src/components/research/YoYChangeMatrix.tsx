'use client';

/**
 * Year-over-year section change matrix (benchmark C2–C4).
 *
 * Two shapes, chosen by selection:
 *  - PEERS (several companies): rows are the taxonomy's section concepts,
 *    one column per peer, each cell classifying how much of that section
 *    changed between the filer's two most recent annual reports.
 *  - CHRONOLOGICAL (one company): the same rows, one column per consecutive
 *    pair of annual periods (FY22→23, FY23→24, …), showing how each section
 *    evolved across up to six years — the single-filer mode of the benchmark.
 *
 * Cells are heat-shaded by the deterministic bucket, show the exact changed
 * percentage, and click through to the redline of the two section texts.
 * Measurement runs on the same engine-normalized slices the section-scope
 * filter uses; the redline is labelled as normalized text, never passed off
 * as the filing's typography.
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchFilingText, type SecSubmission } from '../../services/secApi';
import { extractResolvedSection, resolveSectionScope, SECTION_CONCEPT_LIST } from '../../utils/sectionTaxonomy';
import { CHANGE_BUCKET_LABELS, computeSectionChange, type SectionChange } from '../../utils/sectionDiff';
import { TextDiffViewer } from './TextDiffViewer';

interface AnnualPeriod {
  accession: string;
  primaryDocument: string;
  reportDate: string;
}

interface MatrixCell {
  change: SectionChange;
  priorSlice: string;
  currentSlice: string;
}

interface MatrixColumn {
  key: string;
  headerTop: string;
  headerSub: string;
  cells: Record<string, MatrixCell>;
  error?: string;
}

/** The filer's most recent annual periods, amendments winning their period. */
export function pickAnnualPeriods(submission: SecSubmission, limit = 2): AnnualPeriod[] {
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
    .slice(0, limit);
}

/** Per-concept slices for one period's filing text. */
function sliceConcepts(filingText: string): Record<string, string> {
  const slices: Record<string, string> = {};
  for (const concept of SECTION_CONCEPT_LIST) {
    const resolved = resolveSectionScope(concept.key, '10-K');
    if (!resolved) continue;
    slices[concept.key] = extractResolvedSection(filingText, resolved);
  }
  return slices;
}

function cellsForPair(priorSlices: Record<string, string>, currentSlices: Record<string, string>): Record<string, MatrixCell> {
  const cells: Record<string, MatrixCell> = {};
  for (const concept of SECTION_CONCEPT_LIST) {
    const priorSlice = priorSlices[concept.key] ?? '';
    const currentSlice = currentSlices[concept.key] ?? '';
    cells[concept.key] = { change: computeSectionChange(priorSlice, currentSlice), priorSlice, currentSlice };
  }
  return cells;
}

const CHRONO_PERIODS = 6;

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
  const [columns, setColumns] = useState<MatrixColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ column: string; concept: string } | null>(null);
  const chronological = tickers.length === 1;

  useEffect(() => {
    let cancelled = false;

    async function textFor(cik: string, period: AnnualPeriod): Promise<string> {
      return fetchFilingText(cik, period.accession.replace(/-/g, ''), period.primaryDocument);
    }

    async function loadChronological(ticker: string, submission: SecSubmission) {
      const periods = pickAnnualPeriods(submission, CHRONO_PERIODS);
      if (periods.length < 2) {
        setColumns([{ key: ticker, headerTop: ticker, headerSub: 'Fewer than two annual reports on file', cells: {} }]);
        return;
      }
      const cik = String(submission.cik);
      // Oldest first, so columns read left → right through time. Each period
      // is fetched and sliced exactly once, then consecutive pairs diff.
      const ordered = [...periods].reverse();
      const slicesByPeriod: Array<Record<string, string> | null> = [];
      for (const period of ordered) {
        const text = await textFor(cik, period).catch(() => '');
        slicesByPeriod.push(text ? sliceConcepts(text) : null);
        if (cancelled) return;
      }
      const next: MatrixColumn[] = [];
      for (let i = 1; i < ordered.length; i += 1) {
        const prior = slicesByPeriod[i - 1];
        const current = slicesByPeriod[i];
        const label = `${ordered[i - 1].reportDate.slice(0, 4)} → ${ordered[i].reportDate.slice(0, 4)}`;
        next.push({
          key: label,
          headerTop: label,
          headerSub: `${ordered[i].reportDate}`,
          cells: prior && current ? cellsForPair(prior, current) : {},
          error: prior && current ? undefined : 'Filing text could not be retrieved',
        });
        setColumns([...next]);
      }
    }

    async function loadPeers() {
      const next: MatrixColumn[] = [];
      for (const ticker of tickers) {
        const submission = companiesData[ticker];
        if (!submission) continue;
        const periods = pickAnnualPeriods(submission, 2);
        if (periods.length < 2) {
          next.push({ key: ticker, headerTop: ticker, headerSub: 'Fewer than two annual reports on file', cells: {} });
          setColumns([...next]);
          continue;
        }
        const cik = String(submission.cik);
        const [current, prior] = periods;
        const [currentText, priorText] = await Promise.all([
          textFor(cik, current).catch(() => ''),
          textFor(cik, prior).catch(() => ''),
        ]);
        if (cancelled) return;
        if (!currentText || !priorText) {
          next.push({ key: ticker, headerTop: ticker, headerSub: 'Filing text could not be retrieved', cells: {} });
        } else {
          next.push({
            key: ticker,
            headerTop: ticker,
            headerSub: `${prior.reportDate.slice(0, 4)} → ${current.reportDate.slice(0, 4)}`,
            cells: cellsForPair(sliceConcepts(priorText), sliceConcepts(currentText)),
          });
        }
        setColumns([...next]);
      }
    }

    async function load() {
      setLoading(true);
      setSelectedCell(null);
      setColumns([]);
      try {
        if (chronological) {
          const ticker = tickers[0];
          const submission = companiesData[ticker];
          if (submission) await loadChronological(ticker, submission);
        } else {
          await loadPeers();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (tickers.length > 0 && Object.keys(companiesData).length > 0) void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join('|'), companiesData, chronological]);

  const selected = useMemo(() => {
    if (!selectedCell) return null;
    const column = columns.find(c => c.key === selectedCell.column);
    const cell = column?.cells[selectedCell.concept];
    if (!column || !cell) return null;
    const concept = SECTION_CONCEPT_LIST.find(c => c.key === selectedCell.concept);
    return { column, cell, conceptLabel: concept?.label || selectedCell.concept };
  }, [selectedCell, columns]);

  const subjectName = chronological
    ? companiesData[tickers[0]]?.name || tickers[0]
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="glass-card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
            {chronological
              ? `Section changes over time — ${subjectName}, annual report to annual report`
              : 'Year-over-year section changes — latest 10-K vs prior'}
          </h4>
          <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Deterministic change measure: percentage of section tokens added or removed between the two periods.
            Click a cell for the redline.{chronological ? ' Add more companies to compare peers instead.' : ' Select a single company for its multi-year history.'}
            {loading ? ' Comparing…' : ''}
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
          <thead>
            <tr style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)' }}>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Section</th>
              {(columns.length > 0 ? columns : tickers.map((t): MatrixColumn => ({ key: t, headerTop: t, headerSub: 'Loading…', cells: {} }))).map(column => (
                <th scope="col" key={column.key} style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {column.headerTop}
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    {column.error || column.headerSub}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ fontSize: '0.82rem' }}>
            {SECTION_CONCEPT_LIST.map(concept => (
              <tr key={concept.key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th scope="row" style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>{concept.label}</th>
                {columns.map(column => {
                  const cell = column.cells[concept.key];
                  if (!cell) {
                    return <td key={column.key} style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>—</td>;
                  }
                  const { change } = cell;
                  // A section absent from BOTH periods is "not found", never
                  // "unchanged" — an empty comparison earns no verdict.
                  if (change.priorTokens === 0 && change.currentTokens === 0) {
                    return <td key={column.key} style={{ padding: '12px 16px', color: 'var(--text-muted)' }} title="Section not found in either period">n/a</td>;
                  }
                  const style = BUCKET_STYLE[change.bucket];
                  const isSelected = selectedCell?.column === column.key && selectedCell?.concept === concept.key;
                  return (
                    <td key={column.key} style={{ padding: '6px 8px' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedCell({ column: column.key, concept: concept.key })}
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
                            : `${Math.round(change.changedRatio * 100)}% of tokens${change.changedPassages > 0 ? ` · ${change.changedPassages} passage${change.changedPassages === 1 ? '' : 's'}` : ''}`}
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
                {chronological ? subjectName : selected.column.headerTop} — {selected.conceptLabel}: {chronological ? selected.column.headerTop : selected.column.headerSub}
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
