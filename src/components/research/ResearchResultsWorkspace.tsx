'use client';

import { useEffect, useMemo, useState, type RefObject, type SyntheticEvent } from 'react';
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
} from 'lucide-react';

import type { SearchFilters } from '../filters/SearchFilterBar';
import type { FilingResearchResult, ResearchSearchMode } from '../../services/filingResearch';
import type { IssuerFreshnessNotice } from '../../services/issuerFreshness';
import type { ResearchSearchSession } from '../../services/researchSessions';
import type { SearchCandidateCoverage } from '../../services/secApi';
import {
  buildResearchEmptyResultMessage,
  buildResultsHeadline,
  formatUpstreamTotal,
} from '../../services/searchCoverage';
import { BRAND } from '../../config/brand';
import ActiveQueryChips from './ActiveQueryChips';
import SearchScopeBanner from './SearchScopeBanner';
import { researchTabId } from './ResearchSessionTabs';

type ResultSort = 'relevance' | 'newest';

interface ResolvedResearchSearch {
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
}

interface ResearchResultsWorkspaceProps {
  activeSession: ResearchSearchSession | null;
  results: FilingResearchResult[];
  candidateCoverage: SearchCandidateCoverage | null;
  resultLimit: number;
  resultPageSize: number;
  canCountExactly: boolean;
  exactCountProgress: string | null;
  onCountExactly: () => void | Promise<void>;
  loading: boolean;
  degradedNotice: string;
  onDismissDegradedNotice: () => void;
  activeResolvedSearch: ResolvedResearchSearch;
  isRefiningResults: boolean;
  issuerFreshness: IssuerFreshnessNotice | null;
  searched: boolean;
  errorMsg: string;
  selectedResult: FilingResearchResult | null;
  previewHighlightTerms: string[];
  onSelectResult: (resultId: string) => void;
  onExportResults: () => void;
  onOpenInsiders: () => void;
  onOpenFiling: (result: FilingResearchResult) => void;
  previewError: boolean;
  selectedPrimaryDocument: string;
  selectedDocumentUrl: string;
  selectedProxyUrl: string;
  previewFrameRef: RefObject<HTMLIFrameElement | null>;
  onPreviewLoad: (event: SyntheticEvent<HTMLIFrameElement>) => void;
  onPreviewError: () => void;
  selectedIsCited: boolean;
  onToggleCitation: () => void;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(text: string, terms: string[]) {
  if (!text.trim()) {
    return text;
  }

  const uniqueTerms = Array.from(
    new Set(
      terms
        .map(term => term.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  )
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);

  if (uniqueTerms.length === 0) {
    return text;
  }

  const pattern = new RegExp(`(${uniqueTerms.map(term => escapeRegex(term)).join('|')})`, 'ig');
  return text.split(pattern).map((part, index) => {
    const isHit = uniqueTerms.some(term => term.toLowerCase() === part.toLowerCase());
    return isHit ? <mark key={`${part}-${index}`}>{part}</mark> : <span key={`${part}-${index}`}>{part}</span>;
  });
}

function formatResultFormLabel(result: FilingResearchResult): string {
  const filingForm = (result.formType || '').trim();
  const documentType = (result.documentType || '').trim();
  if (!documentType || documentType.toUpperCase() === filingForm.toUpperCase()) {
    return filingForm;
  }
  return `${filingForm} · ${documentType}`;
}

function buildAuditorDisplayLabel(
  auditor: string,
  filters: SearchFilters,
  isRefining: boolean
): string {
  if (auditor.trim()) {
    return auditor;
  }

  if (isRefining && filters.accountant.trim()) {
    return 'Validating auditor...';
  }

  return '';
}

/**
 * Presentation and local interaction state for the result list and preview.
 * Search execution, session persistence, and route synchronization stay in
 * SearchPage; sorting, pagination, and transient notices live beside the UI
 * they control.
 */
export default function ResearchResultsWorkspace({
  activeSession,
  results,
  candidateCoverage,
  resultLimit,
  resultPageSize,
  canCountExactly,
  exactCountProgress,
  onCountExactly,
  loading,
  degradedNotice,
  onDismissDegradedNotice,
  activeResolvedSearch,
  isRefiningResults,
  issuerFreshness,
  searched,
  errorMsg,
  selectedResult,
  previewHighlightTerms,
  onSelectResult,
  onExportResults,
  onOpenInsiders,
  onOpenFiling,
  previewError,
  selectedPrimaryDocument,
  selectedDocumentUrl,
  selectedProxyUrl,
  previewFrameRef,
  onPreviewLoad,
  onPreviewError,
  selectedIsCited,
  onToggleCitation,
}: ResearchResultsWorkspaceProps) {
  const [resultSort, setResultSort] = useState<ResultSort>('relevance');
  const [resultPage, setResultPage] = useState(1);
  const [auditorNoticeDismissed, setAuditorNoticeDismissed] = useState(false);

  const sortedResults = useMemo(() => {
    if (resultSort === 'newest') {
      return [...results].sort((a, b) => b.fileDate.localeCompare(a.fileDate));
    }
    return results;
  }, [results, resultSort]);
  const resultPageCount = Math.max(1, Math.ceil(sortedResults.length / resultPageSize));
  const pagedResults = useMemo(() => {
    const start = (resultPage - 1) * resultPageSize;
    return sortedResults.slice(start, start + resultPageSize);
  }, [resultPage, resultPageSize, sortedResults]);

  useEffect(() => {
    setResultPage(1);
  }, [activeSession?.id, resultSort]);

  useEffect(() => {
    setResultPage(current => Math.min(current, resultPageCount));
  }, [resultPageCount]);

  return (
    <div
      className="research-workspace el-scope"
      role={activeSession ? 'tabpanel' : undefined}
      id={activeSession ? `research-panel-${activeSession.id}` : undefined}
      aria-labelledby={activeSession ? researchTabId(activeSession.id) : undefined}
    >
      <div className="research-hit-list glass-card">
        <div className="pane-header">
          <div>
            <div className="eyebrow">Search hits</div>
            <h2>{results.length > 0 ? buildResultsHeadline(results.length, candidateCoverage, resultLimit) : 'No results yet'}</h2>
          </div>
          {results.length > 1 && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {([['relevance', 'Relevance'], ['newest', 'Newest']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setResultSort(value)}
                  aria-pressed={resultSort === value}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
                    border: '1px solid ' + (resultSort === value ? 'rgba(214,108,174,0.6)' : 'var(--input-border)'),
                    background: resultSort === value ? 'rgba(179,31,126,0.25)' : 'var(--surface-panel)',
                    color: resultSort === value ? 'var(--accent-soft)' : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {results.length > 0 && (
            <button
              type="button"
              onClick={onExportResults}
              title="Download this result set as a workbook: results, extracted issuer list, and coverage"
              style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
                border: '1px solid var(--input-border)', background: 'var(--surface-panel)',
                color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px',
              }}
            >
              <Download size={12} aria-hidden="true" /> Export .xlsx
            </button>
          )}
          <div className="pane-hint">Select a filing to preview it here, then open the full workspace only when you need the full toolset.</div>
        </div>

        {!loading && degradedNotice && (
          <div role="status" className="research-refining-banner" style={{ justifyContent: 'space-between' }}>
            <span>{degradedNotice} Filing-text validation and Boolean semantics remain enforced.</span>
            <button type="button" onClick={onDismissDegradedNotice} aria-label="Dismiss EDGAR fallback status" style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>×</button>
          </div>
        )}
        {!loading && (candidateCoverage || pagedResults.length > 0) && (
          <div role="status" style={{ padding: '7px 12px', color: 'var(--text-muted)', fontSize: '0.7rem', borderBottom: '1px solid var(--input-border)' }}>
            {candidateCoverage
              ? `Candidate coverage: examined ${candidateCoverage.examined.toLocaleString()} of ${formatUpstreamTotal(candidateCoverage)} upstream candidates (${candidateCoverage.complete ? 'complete' : 'partial candidate window'}). `
              : ''}
            {(() => {
              const required = candidateCoverage?.branches?.filter(entry => entry.required) ?? [];
              if (required.length < 2) return null;
              const unfinished = required.filter(entry => !entry.exhausted);
              const summary = unfinished.length === 0
                ? `All ${required.length} required branches fully examined. `
                : `${required.length - unfinished.length}/${required.length} required branches fully examined — partial: ${unfinished.map(entry => `“${entry.branch}”${entry.incompleteReason ? ` (${entry.incompleteReason})` : ''}`).join(', ')}. `;
              return <span>{summary}</span>;
            })()}
            {canCountExactly && (
              <button
                type="button"
                onClick={() => void onCountExactly()}
                disabled={exactCountProgress !== null}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-soft)', fontSize: '0.7rem', textDecoration: 'underline' }}
              >
                {exactCountProgress !== null ? `Counting ${exactCountProgress}…` : 'Count exactly'}
              </button>
            )}
            {' '}
            {pagedResults.length > 0
              ? `SIC metadata is available for ${pagedResults.filter(result => Boolean(result.sic.trim())).length}/${pagedResults.length} results on this page; official EDGAR submissions supply missing candidate metadata where available.`
              : ''}
          </div>
        )}

        {loading ? (
          <div className="research-empty-state">
            <Loader2 size={28} className="spinner" />
            <div>Searching EDGAR, validating text matches, and ranking the strongest hits...</div>
          </div>
        ) : results.length > 0 ? (
          <>
            <ActiveQueryChips
              mode={activeResolvedSearch.mode === 'boolean' ? 'boolean' : 'semantic'}
              query={activeResolvedSearch.query}
              entityName={activeResolvedSearch.filters.entityName || undefined}
              auditor={activeResolvedSearch.filters.accountant || undefined}
              forms={activeResolvedSearch.filters.formTypes}
              dateFrom={activeResolvedSearch.filters.dateFrom || undefined}
              dateTo={activeResolvedSearch.filters.dateTo || undefined}
            />
            <SearchScopeBanner
              forms={activeResolvedSearch.filters.formTypes}
              dateFrom={activeResolvedSearch.filters.dateFrom || undefined}
              dateTo={activeResolvedSearch.filters.dateTo || undefined}
              shown={results.length}
            />
            {isRefiningResults && (
              <div className="research-refining-banner">
                <Loader2 size={14} className="spinner" />
                <span>Showing initial hits while {BRAND.shortName} validates filing text and loads more results in the background.</span>
              </div>
            )}
            {results.some(result => !result.auditor?.trim()) && !auditorNoticeDismissed && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 12px', margin: '0 0 8px', borderRadius: '8px', background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--status-warning) 30%, transparent)', fontSize: '0.75rem', color: 'var(--status-warning)' }}>
                <span>Auditor identification covers fiscal 2017+ (PCAOB Form AP); older or non-issuer filings may not show one.</span>
                <button type="button" onClick={() => setAuditorNoticeDismissed(true)} aria-label="Dismiss auditor coverage notice" style={{ background: 'none', border: 'none', color: 'var(--status-warning)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1 }}>×</button>
              </div>
            )}
            {issuerFreshness && (
              <div role="status" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 12px', margin: '0 0 8px', borderRadius: '8px', background: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <span>{issuerFreshness.message}</span>
                {issuerFreshness.insider && (
                  <button type="button" onClick={onOpenInsiders} style={{ whiteSpace: 'nowrap', background: 'none', border: '1px solid var(--input-border)', borderRadius: '6px', padding: '3px 10px', color: 'var(--accent-soft)', cursor: 'pointer', fontSize: '0.72rem' }}>
                    Insider Trading
                  </button>
                )}
              </div>
            )}
            <div className="research-hit-scroll">
              {pagedResults.map(result => (
                <button
                  key={result.id}
                  className={`research-hit-card ${selectedResult?.id === result.id ? 'active' : ''}`}
                  onClick={() => onSelectResult(result.id)}
                >
                  <div className="topline">
                    <span className="date">{result.fileDate}</span>
                    {(() => {
                      const textValidated = Boolean(result.matchReason && !/metadata/i.test(result.matchReason));
                      const badgeClass = textValidated ? 'el-badge-verified' : result.matchReason ? 'el-badge-neutral' : 'el-badge-review';
                      const upstreamMatch = /full-text index/i.test(result.matchReason || '');
                      const badgeLabel = upstreamMatch
                        ? 'SEC index'
                        : textValidated ? 'Text validated' : result.matchReason ? 'Metadata' : 'Preliminary';
                      return <span className={`el-badge ${badgeClass}`}>{badgeLabel}</span>;
                    })()}
                    <span className="form">{formatResultFormLabel(result)}</span>
                  </div>
                  <div className="company">{result.entityName}</div>
                  <div className="meta">
                    {buildAuditorDisplayLabel(result.auditor, activeResolvedSearch.filters, isRefiningResults) && (
                      <span>{buildAuditorDisplayLabel(result.auditor, activeResolvedSearch.filters, isRefiningResults)}</span>
                    )}
                    <span>{result.sicDescription || result.sic || 'Industry unavailable'}</span>
                  </div>
                  <div className="match-reason">{result.matchReason || 'Preliminary match — open the filing to confirm context'}</div>
                  {result.matchSectionPath && (
                    <div className="match-provenance" title="Section derived from the validated filing text">
                      {result.matchSectionPath}
                    </div>
                  )}
                  {result.matchedDocumentType && (
                    <div className="match-provenance">
                      Matched in {result.matchedDocumentType}
                      {result.matchedDocumentCount && result.matchedDocumentCount > 1
                        ? ` (+${result.matchedDocumentCount - 1} more exhibit${result.matchedDocumentCount - 1 === 1 ? '' : 's'})`
                        : ''}
                    </div>
                  )}
                  <div className="snippet">
                    {renderHighlightedText(result.matchSnippet || result.description || 'Matched on filing metadata.', previewHighlightTerms)}
                  </div>
                </button>
              ))}
            </div>
            {resultPageCount > 1 && (
              <nav aria-label="Search result pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px 4px' }}>
                <button type="button" className="secondary-btn" onClick={() => setResultPage(page => Math.max(1, page - 1))} disabled={resultPage === 1}>
                  <ChevronLeft size={14} /> Previous
                </button>
                <span aria-live="polite" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  {`${(resultPage - 1) * resultPageSize + 1}–${Math.min(resultPage * resultPageSize, sortedResults.length)} of ${sortedResults.length}`}
                </span>
                <button type="button" className="secondary-btn" onClick={() => setResultPage(page => Math.min(resultPageCount, page + 1))} disabled={resultPage === resultPageCount}>
                  Next <ChevronRight size={14} />
                </button>
              </nav>
            )}
          </>
        ) : searched ? (
          <div className="research-empty-state">
            <div>{buildResearchEmptyResultMessage(errorMsg, degradedNotice, candidateCoverage)}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px' }}>
              Try a company name or ticker on its own, remove form-type or date filters, or switch the sort to Newest.
            </div>
          </div>
        ) : (
          <div className="research-empty-state">
            <div>Run a search to open a dedicated tab and preview the best hits side-by-side.</div>
          </div>
        )}
      </div>

      <div className="research-preview glass-card">
        {selectedResult ? (
          <>
            <div className="pane-header preview-header">
              <div>
                <div className="eyebrow">{formatResultFormLabel(selectedResult)} preview</div>
                <h2>{selectedResult.entityName}</h2>
                <div className="preview-meta-row">
                  <span>{selectedResult.fileDate}</span>
                  <span>{buildAuditorDisplayLabel(selectedResult.auditor, activeResolvedSearch.filters, isRefiningResults)}</span>
                  <span>{selectedResult.fileNumber || 'File number unavailable'}</span>
                </div>
              </div>
              <div className="preview-actions">
                <button className="secondary-btn" onClick={() => onOpenFiling(selectedResult)}>
                  Open Filing
                </button>
                {selectedResult.cik && (
                  <a href={`/company/${Number(selectedResult.cik)}`} className="secondary-btn" title="Issuer dossier: filings, comment letters, auditor, financials">
                    Issuer dossier
                  </a>
                )}
                {selectedDocumentUrl && (
                  <a href={selectedDocumentUrl} target="_blank" rel="noreferrer" className="secondary-btn">
                    <ExternalLink size={14} /> SEC.gov
                  </a>
                )}
                <button
                  type="button"
                  className="secondary-btn"
                  aria-pressed={selectedIsCited}
                  onClick={onToggleCitation}
                  disabled={!selectedDocumentUrl && !selectedIsCited}
                  title={!selectedDocumentUrl && !selectedIsCited ? 'Locating the official SEC document before it can be cited' : undefined}
                >
                  <BookMarked size={14} /> {selectedIsCited ? 'Cited ✓' : 'Cite'}
                </button>
              </div>
            </div>

            <div className="research-selected-snippet">
              <div className="selected-match-label">
                {selectedResult.matchReason || 'Matched filing text'}
                {selectedResult.matchSectionPath ? ` — ${selectedResult.matchSectionPath}` : ''}
              </div>
              <div>{renderHighlightedText(selectedResult.matchSnippet || selectedResult.description || 'Matched on filing metadata.', previewHighlightTerms)}</div>
            </div>

            <div className="research-preview-frame-wrap">
              {!selectedProxyUrl ? (
                <div className="research-empty-state">
                  <Loader2 size={22} className="spinner" />
                  <div>Locating the official document for this filing on SEC EDGAR...</div>
                </div>
              ) : previewError || /\.(xml|pdf)$/i.test(selectedPrimaryDocument) ? (
                <div className="research-preview-fallback">
                  <FileText size={42} />
                  <h3>Inline preview unavailable</h3>
                  <p>
                    This filing cannot be rendered inline with highlights in the embedded preview. Open the full filing workspace or SEC.gov instead.
                  </p>
                  <div className="preview-actions">
                    <button className="secondary-btn" onClick={() => onOpenFiling(selectedResult)}>
                      Open Filing
                    </button>
                    {selectedDocumentUrl && (
                      <a href={selectedDocumentUrl} target="_blank" rel="noreferrer" className="secondary-btn">
                        <ExternalLink size={14} /> SEC.gov
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <iframe
                  ref={previewFrameRef}
                  src={selectedProxyUrl}
                  title={`${selectedResult.entityName} filing preview`}
                  className="research-preview-frame"
                  sandbox="allow-same-origin"
                  referrerPolicy="no-referrer"
                  onLoad={onPreviewLoad}
                  onError={onPreviewError}
                />
              )}
            </div>
          </>
        ) : (
          <div className="research-empty-state preview-empty">
            <div>Select a result to preview the filing and jump into the strongest matching context.</div>
          </div>
        )}
      </div>
    </div>
  );
}
