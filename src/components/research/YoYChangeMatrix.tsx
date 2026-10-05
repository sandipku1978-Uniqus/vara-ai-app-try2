'use client';

/**
 * Year-over-year section change matrix (benchmark C2–C4).
 *
 * Two shapes, chosen by selection:
 *  - PEERS (several companies): rows are the taxonomy's section concepts for
 *    the chosen form, grouped Items / Notes / Proxy, one column per peer,
 *    each cell classifying how much of that section changed between the
 *    filer's two most recent periods of report.
 *  - CHRONOLOGICAL (one company): the same rows, one column per consecutive
 *    pair of periods (FY22→23, FY23→24, …), across up to six years.
 *
 * Cells are heat-shaded by the deterministic bucket, show the exact changed
 * percentage, and click through to the redline of the two section texts.
 * Measurement runs on the same engine-normalized slices the section-scope
 * filter uses; the redline is labelled as normalized text, never passed off
 * as the filing's typography. A section the slicer could not locate in
 * either period says so — it is never measured as "new" or "removed".
 *
 * "Explain changes" (on demand, one cell at a time) sends that cell's marked
 * diff through the existing redline-summary path; every claim it returns
 * quotes changed text that the client verifies against the diff.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { buildSecDocumentUrl, fetchFilingText, type SecSubmission } from '../../services/secApi';
import { aiSummarizeRedline } from '../../services/aiApi';
import { SECTION_GROUPS, conceptsForForm } from '../../utils/sectionTaxonomy';
import { buildMarkedDiff, CHANGE_BUCKET_LABELS } from '../../utils/sectionDiff';
import {
  YOY_FORMS,
  locateConcepts,
  periodLabel,
  pickComparablePeriods,
  yoyCells,
  type ComparedPeriod,
  type YoYCell,
  type YoYForm,
} from '../../utils/yoyChanges';
import { renderMarkdown } from '../../utils/markdownRenderer';
import { TextDiffViewer } from './TextDiffViewer';
import CartToggle from '../cart/CartToggle';

interface MatrixColumn {
  key: string;
  headerTop: string;
  headerSub: string;
  cells: Record<string, YoYCell>;
  error?: string;
  cik?: string;
  ticker?: string;
  /** Company name for the cart; the later period of the pair is what a cart selection adds. */
  company?: string;
  prior?: ComparedPeriod;
  current?: ComparedPeriod;
}

interface Explanation {
  status: 'loading' | 'done' | 'error';
  text?: string;
  note?: string;
}

/** Explanations survive re-selecting a cell; keyed by both accessions and the concept. */
const explanationCache = new Map<string, Explanation>();

const CHRONO_PERIODS = 6;

const BUCKET_STYLE: Record<string, { background: string; color: string }> = {
  major: { background: 'color-mix(in srgb, var(--status-error, #d64545) 22%, transparent)', color: 'var(--status-error, #d64545)' },
  moderate: { background: 'color-mix(in srgb, var(--status-warning, #d69a45) 20%, transparent)', color: 'var(--status-warning, #d69a45)' },
  minor: { background: 'color-mix(in srgb, var(--status-warning, #d69a45) 9%, transparent)', color: 'var(--text-secondary)' },
  unchanged: { background: 'transparent', color: 'var(--text-muted)' },
  new: { background: 'color-mix(in srgb, var(--status-success, #3f9d63) 18%, transparent)', color: 'var(--status-success, #3f9d63)' },
  deleted: { background: 'color-mix(in srgb, var(--status-error, #d64545) 12%, transparent)', color: 'var(--status-error, #d64545)' },
};

const FORM_NOUN: Record<YoYForm, string> = { '10-K': 'annual report', '20-F': 'annual report', 'DEF 14A': 'proxy statement' };

export default function YoYChangeMatrix({
  tickers,
  companiesData,
}: {
  tickers: string[];
  companiesData: Record<string, SecSubmission>;
}) {
  const [form, setForm] = useState<YoYForm>('10-K');
  const [columns, setColumns] = useState<MatrixColumn[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ column: string; concept: string } | null>(null);
  const [explanations, setExplanations] = useState<Record<string, Explanation>>({});
  const chronological = tickers.length === 1;
  const concepts = useMemo(() => conceptsForForm(form), [form]);
  const explaining = Object.values(explanations).some(entry => entry.status === 'loading');

  useEffect(() => {
    let cancelled = false;

    async function textFor(cik: string, period: ComparedPeriod): Promise<string> {
      return fetchFilingText(cik, period.accession.replace(/-/g, ''), period.primaryDocument);
    }

    async function loadChronological(ticker: string, submission: SecSubmission) {
      const periods = pickComparablePeriods(submission, form, CHRONO_PERIODS);
      if (periods.length < 2) {
        setColumns([{ key: ticker, headerTop: ticker, headerSub: `Fewer than two ${form} filings on record`, cells: {} }]);
        return;
      }
      const cik = String(submission.cik);
      // Oldest first, so columns read left → right through time. Each period
      // is fetched and sliced exactly once, then consecutive pairs diff.
      const ordered = [...periods].reverse();
      const located: Array<ReturnType<typeof locateConcepts> | null> = [];
      for (const period of ordered) {
        const text = await textFor(cik, period).catch(() => '');
        if (cancelled) return;
        located.push(text ? locateConcepts(text, form) : null);
      }
      const next: MatrixColumn[] = [];
      for (let i = 1; i < ordered.length; i += 1) {
        const prior = located[i - 1];
        const current = located[i];
        const label = `${periodLabel(ordered[i - 1], form)} → ${periodLabel(ordered[i], form)}`;
        next.push({
          key: label,
          headerTop: label,
          headerSub: `period of report ${ordered[i].reportDate}`,
          cells: prior && current ? yoyCells(form, prior, current) : {},
          error: prior && current ? undefined : 'Filing text could not be retrieved',
          cik,
          ticker,
          company: submission.name || ticker,
          prior: ordered[i - 1],
          current: ordered[i],
        });
        setColumns([...next]);
      }
    }

    async function loadPeers() {
      const next: MatrixColumn[] = [];
      for (const ticker of tickers) {
        const submission = companiesData[ticker];
        if (!submission) continue;
        const periods = pickComparablePeriods(submission, form, 2);
        if (periods.length < 2) {
          next.push({ key: ticker, headerTop: ticker, headerSub: `Fewer than two ${form} filings on record`, cells: {} });
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
            headerSub: `${periodLabel(prior, form)} → ${periodLabel(current, form)}`,
            cells: yoyCells(form, locateConcepts(priorText, form), locateConcepts(currentText, form)),
            cik,
            ticker,
            company: submission.name || ticker,
            prior,
            current,
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
  }, [tickers.join('|'), companiesData, chronological, form]);

  const selected = useMemo(() => {
    if (!selectedCell) return null;
    const column = columns.find(c => c.key === selectedCell.column);
    const cell = column?.cells[selectedCell.concept];
    if (!column || !cell || cell.kind !== 'change') return null;
    const concept = concepts.find(c => c.key === selectedCell.concept);
    const explanationKey = column.prior && column.current
      ? `${column.prior.accession}|${column.current.accession}|${selectedCell.concept}`
      : '';
    return { column, cell, conceptLabel: concept?.label || selectedCell.concept, explanationKey };
  }, [selectedCell, columns, concepts]);

  const explanation = selected?.explanationKey
    ? explanations[selected.explanationKey] ?? explanationCache.get(selected.explanationKey)
    : undefined;

  async function explainSelected() {
    if (!selected || !selected.explanationKey || explaining) return;
    const key = selected.explanationKey;
    const diff = buildMarkedDiff(selected.cell.priorSlice, selected.cell.currentSlice);
    if (!diff.text.trim()) {
      const entry: Explanation = { status: 'done', text: 'No changed text to explain — the two slices are identical after normalization.' };
      explanationCache.set(key, entry);
      setExplanations(prev => ({ ...prev, [key]: entry }));
      return;
    }
    setExplanations(prev => ({ ...prev, [key]: { status: 'loading' } }));
    try {
      const text = await aiSummarizeRedline(diff.text, { throwOnError: true });
      const entry: Explanation = {
        status: 'done',
        text,
        note: diff.truncated
          ? `Covers ${diff.runsIncluded} of ${diff.runsTotal} changed passages — the rest did not fit in one request. Read the redline for the remainder.`
          : undefined,
      };
      explanationCache.set(key, entry);
      setExplanations(prev => ({ ...prev, [key]: entry }));
    } catch {
      setExplanations(prev => ({
        ...prev,
        [key]: { status: 'error', text: 'The explanation could not be generated (the AI service may be busy or your request limit reached). The redline below is unaffected — retry in a moment.' },
      }));
    }
  }

  const subjectName = chronological
    ? companiesData[tickers[0]]?.name || tickers[0]
    : null;
  const placeholderColumns = tickers.map((t): MatrixColumn => ({ key: t, headerTop: t, headerSub: 'Loading…', cells: {} }));
  const visibleColumns = columns.length > 0 ? columns : placeholderColumns;

  const sourceLine = (cik: string | undefined, period: ComparedPeriod | undefined) => {
    if (!cik || !period) return null;
    return (
      <a href={buildSecDocumentUrl(cik, period.accession, period.primaryDocument)} target="_blank" rel="noopener noreferrer"
        style={{ color: 'var(--accent-primary)' }}>
        {period.form} {period.accession} (period of report {period.reportDate})
      </a>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="glass-card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
              {chronological
                ? `Section changes over time — ${subjectName}, ${FORM_NOUN[form]} to ${FORM_NOUN[form]}`
                : `Year-over-year section changes — latest ${form} vs prior`}
            </h4>
            <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: '720px' }}>
              Deterministic change measure: percentage of section tokens added or removed between the two periods of report.
              Click a cell for the redline and an optional explanation.{chronological ? ' Add more companies to compare peers instead.' : ' Select a single company for its multi-year history.'}
              {loading ? ' Comparing…' : ''}
            </div>
          </div>
          <div role="group" aria-label="Form to compare" style={{ display: 'flex', gap: '6px' }}>
            {YOY_FORMS.map(option => (
              <button key={option} type="button" onClick={() => setForm(option)} aria-pressed={form === option}
                style={{
                  padding: '5px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.78rem',
                  border: `1px solid ${form === option ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: form === option ? 'var(--accent-primary)' : 'var(--surface-subtle)',
                  color: form === option ? 'var(--surface-panel)' : 'var(--text-secondary)',
                }}>
                {option}
              </button>
            ))}
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
          <thead>
            <tr style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)' }}>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-muted)', fontWeight: 600 }}>Section</th>
              {visibleColumns.map(column => (
                <th scope="col" key={column.key} style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {column.headerTop}
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    {column.error || column.headerSub}
                  </div>
                  {column.cik && column.current && column.current.filingDate && (
                    <CartToggle
                      className="matrix-column-select"
                      filing={{
                        cik: column.cik,
                        accessionNumber: column.current.accession,
                        company: column.company || column.ticker || column.headerTop,
                        form: column.current.form,
                        fileDate: column.current.filingDate,
                        ticker: column.ticker || '',
                        primaryDocument: column.current.primaryDocument,
                        sourceUrl: buildSecDocumentUrl(column.cik, column.current.accession, column.current.primaryDocument),
                        origin: 'yoy',
                      }}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {SECTION_GROUPS.map(group => {
            const rows = concepts.filter(concept => concept.group === group.key);
            if (rows.length === 0) return null;
            return (
              <tbody key={group.key} style={{ fontSize: '0.82rem' }}>
                <tr>
                  <th scope="colgroup" colSpan={visibleColumns.length + 1}
                    style={{ textAlign: 'left', padding: '8px 20px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--table-header-bg, var(--surface-subtle))' }}>
                    {group.label}
                  </th>
                </tr>
                {rows.map(concept => (
                  <tr key={concept.key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th scope="row" style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--text-secondary)', fontWeight: 500 }}>{concept.label}</th>
                    {columns.map(column => (
                      <Fragment key={column.key}>
                        {renderCell(column, concept.key)}
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>

      {selected && (
        <div className="glass-card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 20px', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
                {chronological ? subjectName : selected.column.headerTop} — {selected.conceptLabel}: {chronological ? selected.column.headerTop : selected.column.headerSub}
              </h4>
              <div style={{ marginTop: '2px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Normalized comparison text (case and punctuation removed) — the same form the change percentage is measured on.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void explainSelected()}
                disabled={!selected.explanationKey || explaining || selected.cell.change.bucket === 'unchanged' || explanation?.status === 'done'}
                title={selected.cell.change.bucket === 'unchanged' ? 'Nothing material changed to explain' : 'Explain what changed and why a reviewer might care'}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {explanation?.status === 'loading' ? <Loader2 size={14} className="spinner" /> : <Sparkles size={14} />}
                Explain changes
              </button>
              <button type="button" onClick={() => setSelectedCell(null)} aria-label="Close section redline"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }}>×</button>
            </div>
          </div>
          {explanation && (
            <div role={explanation.status === 'error' ? 'alert' : 'status'} aria-live="polite"
              style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', borderLeft: '3px solid var(--accent-primary)' }}>
              {explanation.status === 'loading' ? (
                <span style={{ color: 'var(--text-secondary)' }}>Explaining the changed text…</span>
              ) : explanation.status === 'error' ? (
                <span style={{ color: 'var(--status-error)' }}>{explanation.text}</span>
              ) : (
                <>
                  <div className="md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation.text || '') }} />
                  {explanation.note && <div style={{ marginTop: '6px', color: 'var(--status-warning)' }}>{explanation.note}</div>}
                  <div style={{ marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    AI explanation of the changed text only; each quoted phrase was checked against the diff. Compared {sourceLine(selected.column.cik, selected.column.prior)} → {sourceLine(selected.column.cik, selected.column.current)}.
                  </div>
                </>
              )}
            </div>
          )}
          <div style={{ maxHeight: '480px', overflow: 'auto', padding: '12px 16px' }}>
            <TextDiffViewer oldText={selected.cell.priorSlice} newText={selected.cell.currentSlice} />
          </div>
        </div>
      )}
    </div>
  );

  function renderCell(column: MatrixColumn, conceptKey: string) {
    const cell = column.cells[conceptKey];
    if (!cell) {
      return <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>—</td>;
    }
    if (cell.kind === 'not-disclosed') {
      // A section absent from BOTH periods earns no verdict — never "unchanged".
      return <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.74rem' }} title={cell.detail}>Not disclosed</td>;
    }
    if (cell.kind === 'could-not-extract') {
      return (
        <td style={{ padding: '12px 16px', color: 'var(--status-warning)', fontSize: '0.74rem' }} title={cell.detail}>
          Could not extract
        </td>
      );
    }
    const { change } = cell;
    const style = BUCKET_STYLE[change.bucket];
    const isSelected = selectedCell?.column === column.key && selectedCell?.concept === conceptKey;
    return (
      <td style={{ padding: '6px 8px' }}>
        <button
          type="button"
          onClick={() => setSelectedCell({ column: column.key, concept: conceptKey })}
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
  }
}
