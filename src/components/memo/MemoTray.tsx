'use client';

import { useCallback, useState } from 'react';
import { BookMarked, Copy, Download, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { useMemoDraft, useMemoTray } from '../../hooks/useMemoTray';
import {
  clearMemoDraft,
  clearMemoTray,
  formatCitationsText,
  formatMemoMarkdown,
  removeCitation,
  setMemoDraft,
  updateCitationNote,
} from '../../services/memoTray';
import { aiDraftMemoFromCitations } from '../../services/aiApi';
import { fetchFilingText, resolvePrimaryDocumentPath } from '../../services/secApi';
import MemoDraft from './MemoDraft';
import '../../styles/evidence-ledger.css';
import './MemoTray.css';

export default function MemoTray() {
  const citations = useMemoTray();
  const draftRecord = useMemoDraft();
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [copied, setCopied] = useState<'citations' | 'draft' | ''>('');

  const draft = draftRecord?.text || '';
  const draftIsStale = Boolean(
    draftRecord &&
    draftRecord.citationIds.join('|') !== citations.map(citation => citation.id).join('|')
  );

  const copyText = useCallback(async (text: string, which: 'citations' | 'draft') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setCopied('');
    }
  }, []);

  const exportMarkdown = useCallback(() => {
    const blob = new Blob([formatMemoMarkdown(citations)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `urc-memo-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [citations]);

  const draftMemo = useCallback(async () => {
    setDrafting(true);
    setDraftError('');
    try {
      // A citation captured from a metadata match carries almost no text —
      // read the actual filing so the memo has real evidence to work from.
      const enriched = await Promise.all(citations.map(async citation => {
        let excerpt = citation.excerpt;
        if (citation.kind === 'filing' && excerpt.trim().length < 200) {
          try {
            const doc = await resolvePrimaryDocumentPath(citation.cik, citation.accessionNumber);
            const text = doc ? await fetchFilingText(citation.cik, citation.accessionNumber, doc) : '';
            if (text && text.trim().length > excerpt.trim().length) {
              excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 2400);
            }
          } catch {
            // Metadata-only citation stays as captured.
          }
        }
        return {
          company: citation.company,
          form: citation.form,
          fileDate: citation.fileDate,
          accessionNumber: citation.accessionNumber,
          excerpt,
          note: citation.note,
        };
      }));
      const memo = await aiDraftMemoFromCitations(enriched);
      setMemoDraft(memo, citations.map(citation => citation.id));
    } catch (error) {
      console.error('Memo draft failed:', error);
      setDraftError('The memo draft could not be generated. The cited evidence is unchanged — retry when ready.');
    } finally {
      setDrafting(false);
    }
  }, [citations]);

  return (
    <>
      <button
        type="button"
        className="memo-tray-trigger"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-label={`Open memo tray (${citations.length} citation${citations.length === 1 ? '' : 's'})`}
      >
        <BookMarked size={16} />
        <span>Memo</span>
        {citations.length > 0 && <span className="memo-tray-count">{citations.length}</span>}
      </button>

      {open && (
        <aside className="memo-tray el-scope" aria-label="Memo tray">
          <header className="memo-tray-header">
            <div>
              <div className="memo-tray-eyebrow">Citation ledger</div>
              <h2>Memo tray</h2>
            </div>
            <button type="button" className="memo-tray-icon-btn" onClick={() => setOpen(false)} aria-label="Close memo tray">
              <X size={16} />
            </button>
          </header>

          {citations.length === 0 ? (
            <div className="el-state memo-tray-empty">
              <strong>No citations yet.</strong>
              <span>Cite filings from the Research Workbench preview — each citation keeps its excerpt and source link, ready for a memo.</span>
            </div>
          ) : (
            <>
              <div className="memo-tray-list">
                {citations.map((citation, index) => (
                  <article key={citation.id} className="memo-tray-item">
                    <div className="memo-tray-item-top">
                      <span className="el-badge el-badge-citation">[{index + 1}]</span>
                      <span className="el-mono">{citation.fileDate}</span>
                      <span className="el-badge el-badge-neutral">{citation.form}</span>
                      <button
                        type="button"
                        className="memo-tray-icon-btn"
                        onClick={() => removeCitation(citation.id)}
                        aria-label={`Remove citation ${index + 1}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="memo-tray-company">{citation.company}</div>
                    {citation.excerpt.trim() && <blockquote className="el-excerpt">{citation.excerpt}</blockquote>}
                    <textarea
                      value={citation.note}
                      placeholder="Add your note for this citation..."
                      onChange={event => updateCitationNote(citation.id, event.target.value)}
                      rows={2}
                    />
                    <a className="el-link" href={citation.sourceUrl} target="_blank" rel="noreferrer">SEC.gov source</a>
                  </article>
                ))}
              </div>

              <div className="memo-tray-actions">
                <button type="button" className="el-btn el-btn-secondary" onClick={() => void copyText(formatCitationsText(citations), 'citations')}>
                  <Copy size={14} /> {copied === 'citations' ? 'Copied' : 'Copy citations'}
                </button>
                <button type="button" className="el-btn el-btn-secondary" onClick={exportMarkdown}>
                  <Download size={14} /> Export .md
                </button>
                <button type="button" className="el-btn el-btn-primary" onClick={() => void draftMemo()} disabled={drafting}>
                  {drafting ? <Loader2 size={14} className="spinner" /> : <Sparkles size={14} />} Draft memo with AI
                </button>
                <button type="button" className="memo-tray-clear" onClick={() => { clearMemoTray(); clearMemoDraft(); }}>
                  Clear all
                </button>
              </div>

              {draftError && <div className="el-state el-state-error memo-tray-empty">{draftError}</div>}
              {draft && (
                <div className="memo-tray-draft">
                  {draftIsStale && (
                    <div className="memo-tray-draft-stale">
                      Citations changed since this draft was generated — regenerate to reflect the current evidence.
                    </div>
                  )}
                  <div className="memo-tray-draft-head">
                    <span>
                      AI draft
                      {draftRecord?.generatedAt ? ` — ${new Date(draftRecord.generatedAt).toLocaleString()}` : ''}
                      {` — grounded only in ${draftRecord?.citationIds.length ?? citations.length} citation${(draftRecord?.citationIds.length ?? citations.length) === 1 ? '' : 's'}`}
                    </span>
                    <button type="button" className="memo-tray-icon-btn" onClick={() => void copyText(draft, 'draft')} aria-label="Copy memo draft">
                      <Copy size={13} /> {copied === 'draft' ? 'Copied' : ''}
                    </button>
                  </div>
                  <MemoDraft text={draft} />
                </div>
              )}
            </>
          )}
        </aside>
      )}
    </>
  );
}
