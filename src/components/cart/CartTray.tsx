'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart2, BookMarked, Download, FileSpreadsheet, FileText, Layers, Loader2, Trash2, X } from 'lucide-react';
import { useApp } from '../../context/AppState';
import { useDocumentCart } from './useDocumentCart';
import {
  cartAsCitations,
  cartAsResearchResults,
  cartTickers,
  clearDocumentCart,
  removeFromDocumentCart,
} from '../../services/documentCart';
import {
  buildSectionDocument,
  buildSectionIndexCsv,
  collectSectionSlices,
  sectionFileStem,
  type CartSectionSlice,
} from '../../services/cartSectionExport';
import { downloadBlob, packDocx } from '../../services/docxShared';
import { exportResultsWorkbook } from '../../services/resultExport';
import { addCitation, isCited } from '../../services/memoTray';
import { fetchFilingTextOutcome, resolvePrimaryDocumentPath } from '../../services/secApi';
import { SECTION_CONCEPT_LIST } from '../../utils/sectionTaxonomy';
import '../../styles/evidence-ledger.css';
import './DocumentCart.css';

const BENCHMARK_TICKER_LIMIT = 20;

interface SectionBundle {
  /** The selection the bundle was built from; any change voids it. */
  selectionKey: string;
  conceptKey: string;
  generatedAt: Date;
  slices: CartSectionSlice[];
  docx: Blob;
}

/**
 * Header badge + panel for the document cart. The badge shows the selection
 * count from any page; the panel lists the selected filings and runs the
 * bulk actions over them.
 */
export default function CartTray() {
  const items = useDocumentCart();
  const { setPendingCompareIntent } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [conceptKey, setConceptKey] = useState(SECTION_CONCEPT_LIST[0]?.key || '');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [builtBundle, setBundle] = useState<SectionBundle | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const selectionKey = items.map(item => item.id).join('|');
  const bundle = builtBundle?.selectionKey === selectionKey ? builtBundle : null;

  useEffect(() => () => abortRef.current?.abort(), []);

  const { tickers, withoutTicker } = cartTickers(items);
  const busy = progress !== null;

  const downloadSection = useCallback(async () => {
    if (!conceptKey || items.length === 0) return;
    setError('');
    setStatus('');
    setBundle(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: items.length });
    try {
      const generatedAt = new Date();
      const slices = await collectSectionSlices(items, conceptKey, {
        resolvePrimaryDocument: resolvePrimaryDocumentPath,
        fetchText: fetchFilingTextOutcome,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (controller.signal.aborted) {
        setStatus('Section download cancelled.');
        return;
      }
      const docx = await packDocx(buildSectionDocument(slices, conceptKey, generatedAt));
      setBundle({ selectionKey: items.map(item => item.id).join('|'), conceptKey, generatedAt, slices, docx });
      downloadBlob(docx, `${sectionFileStem(conceptKey, generatedAt)}.docx`);
    } catch (caught) {
      console.error('Cart section download failed:', caught);
      setError('The section download could not be assembled. The selection is unchanged — retry when ready.');
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }, [conceptKey, items]);

  const exportList = useCallback(async () => {
    setError('');
    try {
      await exportResultsWorkbook(cartAsResearchResults(items), {
        query: '(none — filings hand-selected into the document cart)',
        mode: 'Document cart',
        coverage: null,
        filterSummary: [],
      });
    } catch (caught) {
      console.error('Cart list export failed:', caught);
      setError('The list could not be exported.');
    }
  }, [items]);

  const addAllToMemo = useCallback(() => {
    let added = 0;
    for (const citation of cartAsCitations(items)) {
      if (isCited(citation.cik, citation.accessionNumber)) continue;
      addCitation(citation);
      added += 1;
    }
    const already = items.length - added;
    setStatus(`Added ${added} citation${added === 1 ? '' : 's'} to the memo tray${already > 0 ? `; ${already} already cited` : ''}.`);
  }, [items]);

  const compareSelected = useCallback(() => {
    if (tickers.length === 0) return;
    const used = tickers.slice(0, BENCHMARK_TICKER_LIMIT);
    const leftOut = [
      withoutTicker > 0 ? `${withoutTicker} selected filing${withoutTicker === 1 ? ' has' : 's have'} no ticker` : '',
      tickers.length > used.length ? `${tickers.length - used.length} ticker${tickers.length - used.length === 1 ? '' : 's'} beyond the ${BENCHMARK_TICKER_LIMIT}-company limit` : '',
    ].filter(Boolean).join('; ');
    setPendingCompareIntent({
      id: `cart-compare-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tickers: used,
      message: `Opened from the document cart with ${used.length} compan${used.length === 1 ? 'y' : 'ies'}${leftOut ? ` (left out: ${leftOut})` : ''}.`,
    });
    setOpen(false);
    router.push('/compare');
  }, [router, setPendingCompareIntent, tickers, withoutTicker]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cart-trigger"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-controls="urc-document-cart"
        aria-label={`${open ? 'Close' : 'Open'} document cart (${items.length} filing${items.length === 1 ? '' : 's'} selected)`}
        title="Document cart"
      >
        <Layers size={16} aria-hidden="true" />
        <span className="cart-trigger-label">Cart</span>
        {items.length > 0 && <span className="cart-count" aria-hidden="true">{items.length}</span>}
      </button>

      {open && (
        <aside ref={panelRef} id="urc-document-cart" className="cart-panel el-scope" aria-label="Document cart">
          <header className="cart-panel-header">
            <div>
              <div className="cart-eyebrow">Selected filings</div>
              <h2>Document cart</h2>
            </div>
            <button type="button" className="cart-icon-btn" onClick={close} aria-label="Close document cart">
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          {items.length === 0 ? (
            <div className="el-state cart-empty">
              <strong>No filings selected.</strong>
              <span>Tick the box on a search result, dossier filing, exhibit, or Section Matrix / YoY column to collect filings here for a bulk section download, an Excel list, memo citations, or a benchmark.</span>
            </div>
          ) : (
            <>
              <ul className="cart-list" aria-label={`${items.length} selected filing${items.length === 1 ? '' : 's'}`}>
                {items.map(item => (
                  <li key={item.id} className="cart-item">
                    <div className="cart-item-main">
                      <span className="el-badge el-badge-neutral">{item.form}</span>
                      <span className="cart-item-company">{item.company}{item.ticker ? ` (${item.ticker})` : ''}</span>
                      <span className="el-mono cart-item-date">{item.fileDate}</span>
                    </div>
                    <button
                      type="button"
                      className="cart-icon-btn"
                      onClick={() => removeFromDocumentCart(item.id)}
                      aria-label={`Remove ${item.company} Form ${item.form} filed ${item.fileDate} from the document cart`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>

              <section className="cart-actions" aria-label="Cart actions">
                <div className="cart-section-row">
                  <label htmlFor="cart-section-concept">Section</label>
                  <select
                    id="cart-section-concept"
                    value={conceptKey}
                    onChange={event => setConceptKey(event.target.value)}
                    disabled={busy}
                  >
                    {SECTION_CONCEPT_LIST.map(concept => (
                      <option key={concept.key} value={concept.key}>{concept.label}</option>
                    ))}
                  </select>
                  {busy ? (
                    <button type="button" className="el-btn el-btn-secondary" onClick={() => abortRef.current?.abort()}>
                      <Loader2 size={14} className="spinner" aria-hidden="true" /> Cancel ({progress.done}/{progress.total})
                    </button>
                  ) : (
                    <button type="button" className="el-btn el-btn-primary" onClick={() => void downloadSection()}>
                      <FileText size={14} aria-hidden="true" /> Download section
                    </button>
                  )}
                </div>
                {busy && (
                  <div role="status" className="cart-note">
                    Reading filing {Math.min(progress.done + 1, progress.total)} of {progress.total} through the shared filing-text route, one at a time.
                  </div>
                )}
                {bundle && (
                  <div className="cart-bundle" role="status">
                    <span>
                      {bundle.slices.filter(slice => slice.status === 'extracted').length} of {bundle.slices.length} extracted.
                      {' '}The Word file has a page per filing; the index lists every filing&apos;s status.
                    </span>
                    <div className="cart-bundle-actions">
                      <button type="button" className="el-btn el-btn-secondary" onClick={() => downloadBlob(bundle.docx, `${sectionFileStem(bundle.conceptKey, bundle.generatedAt)}.docx`)}>
                        <Download size={14} aria-hidden="true" /> Word again
                      </button>
                      <button
                        type="button"
                        className="el-btn el-btn-secondary"
                        onClick={() => downloadBlob(new Blob([buildSectionIndexCsv(bundle.slices)], { type: 'text/csv' }), `${sectionFileStem(bundle.conceptKey, bundle.generatedAt)}_index.csv`)}
                      >
                        <Download size={14} aria-hidden="true" /> Index .csv
                      </button>
                    </div>
                  </div>
                )}

                <div className="cart-button-row">
                  <button type="button" className="el-btn el-btn-secondary" onClick={() => void exportList()} disabled={busy}>
                    <FileSpreadsheet size={14} aria-hidden="true" /> Export list
                  </button>
                  <button type="button" className="el-btn el-btn-secondary" onClick={addAllToMemo} disabled={busy}>
                    <BookMarked size={14} aria-hidden="true" /> Add all to memo
                  </button>
                  <button
                    type="button"
                    className="el-btn el-btn-secondary"
                    onClick={compareSelected}
                    disabled={busy || tickers.length === 0}
                    title={tickers.length === 0 ? 'None of the selected filings carries a ticker' : `Benchmark ${tickers.slice(0, BENCHMARK_TICKER_LIMIT).join(', ')}`}
                  >
                    <BarChart2 size={14} aria-hidden="true" /> Compare selected
                  </button>
                  <button type="button" className="cart-clear" onClick={clearDocumentCart} disabled={busy}>
                    Clear
                  </button>
                </div>
                {status && <div role="status" className="cart-note">{status}</div>}
                {error && <div role="alert" className="el-state el-state-error cart-note">{error}</div>}
              </section>
            </>
          )}
        </aside>
      )}
    </>
  );
}
