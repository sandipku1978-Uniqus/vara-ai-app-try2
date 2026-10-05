'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellPlus, Bookmark, Play, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppState';
import { buildResearchRouteParams } from '../../services/researchSessions';
import { deleteSavedSearch, useSavedSearches, type SavedSearch } from '../../services/savedSearches';
import './Alerts.css';

/** The route that re-runs a saved search exactly as saved. */
export function savedSearchRoute(search: Pick<SavedSearch, 'query' | 'mode' | 'filters'>): string {
  return `/search?${buildResearchRouteParams(search.query, search.mode, search.filters).toString()}`;
}

function describeSaved(search: SavedSearch): string {
  const parts = [search.mode === 'boolean' ? 'Boolean' : 'Semantic'];
  if (search.filters.formTypes.length > 0) parts.push(search.filters.formTypes.join(', '));
  if (search.filters.entityName) parts.push(search.filters.entityName);
  if (search.filters.dateFrom || search.filters.dateTo) parts.push(`${search.filters.dateFrom || '…'} → ${search.filters.dateTo || 'today'}`);
  return parts.join(' · ');
}

interface SavedSearchesListProps {
  /** Re-run hook; defaults to navigating to the search page. */
  onRun?: (search: SavedSearch) => void;
  emptyMessage?: string;
}

/** The saved searches with one-click re-run, convert-to-alert and delete. */
export function SavedSearchesList({ onRun, emptyMessage }: SavedSearchesListProps) {
  const searches = useSavedSearches();
  const router = useRouter();
  const { addSavedAlert, savedAlerts } = useApp();
  const [status, setStatus] = useState('');

  if (searches.length === 0) {
    return (
      <p className="saved-search-empty">
        {emptyMessage || 'No saved searches yet. Use “Save search” in the Research Workbench to keep a question you want to re-run.'}
      </p>
    );
  }

  const alreadyAlert = (search: SavedSearch) => savedAlerts.some(alert =>
    alert.query === search.query &&
    alert.mode === search.mode &&
    JSON.stringify(alert.filters) === JSON.stringify(search.filters)
  );

  return (
    <>
      {status && <div role="status" className="saved-search-meta" style={{ marginBottom: 6 }}>{status}</div>}
      <ul className="saved-search-list" aria-label={`${searches.length} saved search${searches.length === 1 ? '' : 'es'}`}>
        {searches.map(search => {
          const isAlert = alreadyAlert(search);
          return (
            <li key={search.clientKey} className="saved-search-item">
              <div className="saved-search-label">{search.label}</div>
              <div className="saved-search-meta">{describeSaved(search)}</div>
              {search.context?.coverageHeadline && (
                <div className="saved-search-meta">
                  When saved{search.context.savedAt ? ` (${search.context.savedAt.slice(0, 10)})` : ''}: {search.context.coverageHeadline}
                </div>
              )}
              <div className="saved-search-actions">
                <button
                  type="button"
                  className="alert-hit-btn"
                  onClick={() => (onRun ? onRun(search) : router.push(savedSearchRoute(search)))}
                  aria-label={`Re-run saved search ${search.label}`}
                >
                  <Play size={12} aria-hidden="true" /> Re-run
                </button>
                <button
                  type="button"
                  className="alert-hit-btn"
                  disabled={isAlert}
                  title={isAlert ? 'An alert with this search already exists' : 'Check this search on the server and notify me of new filings'}
                  onClick={() => {
                    addSavedAlert({
                      name: search.label,
                      query: search.query,
                      mode: search.mode,
                      filters: search.filters,
                      defaultForms: search.context?.defaultForms || '',
                      cadence: 'daily',
                      enabled: true,
                    });
                    setStatus(`“${search.label}” is now a daily alert.`);
                  }}
                  aria-label={`Convert saved search ${search.label} to an alert`}
                >
                  <BellPlus size={12} aria-hidden="true" /> {isAlert ? 'Alert exists' : 'Make alert'}
                </button>
                <button
                  type="button"
                  className="alert-hit-btn"
                  onClick={() => {
                    deleteSavedSearch(search.clientKey);
                    setStatus(`Deleted “${search.label}”.`);
                  }}
                  aria-label={`Delete saved search ${search.label}`}
                >
                  <Trash2 size={12} aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A compact "Saved searches" menu for the research tabs strip. */
export default function SavedSearchesMenu({ onRun }: { onRun?: (search: SavedSearch) => void }) {
  const searches = useSavedSearches();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="saved-search-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="secondary-btn"
        aria-expanded={open}
        // The popover mounts only while open; a closed reference would dangle.
        aria-controls={open ? 'urc-saved-searches' : undefined}
        onClick={() => setOpen(current => !current)}
      >
        <Bookmark size={16} aria-hidden="true" /> Saved ({searches.length})
      </button>
      {open && (
        <div id="urc-saved-searches" className="saved-search-popover" role="region" aria-label="Saved searches">
          <SavedSearchesList
            onRun={onRun ? search => { setOpen(false); onRun(search); } : undefined}
          />
        </div>
      )}
    </div>
  );
}
