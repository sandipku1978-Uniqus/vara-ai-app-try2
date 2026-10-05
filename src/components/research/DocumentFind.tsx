'use client';

import type { KeyboardEvent, RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

import type { useDocumentFind } from '../../hooks/useDocumentFind';
import { isFindShortcut } from '../../utils/documentFind';
import './DocumentFind.css';

type DocumentFindState = ReturnType<typeof useDocumentFind>;

interface DocumentFindBarProps {
  id: string;
  find: DocumentFindState['find'];
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Find bar for the filing viewer: case-insensitive plain-text find with an
 * optional whole-word rule. Enter / Shift+Enter step through matches, Escape
 * closes and returns focus to the document.
 */
export function DocumentFindBar({ id, find, inputRef }: DocumentFindBarProps) {
  if (!find.open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) find.previous();
      else find.next();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      find.closeFind();
      return;
    }
    if (isFindShortcut(event)) {
      // Already open: keep the browser's own find bar out of the way.
      event.preventDefault();
      event.currentTarget.select();
    }
  };

  const noMatches = find.matchCount === 0;
  return (
    <div id={id} className="document-find-bar" role="search" aria-label="Find in document">
      <Search size={14} aria-hidden="true" className="document-find-icon" />
      <input
        ref={inputRef}
        type="text"
        className="document-find-input"
        aria-label="Find in document"
        placeholder="Find in document"
        value={find.query}
        onChange={event => find.setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="document-find-count" role="status" aria-live="polite">
        {find.countLabel}
      </span>
      <button
        type="button"
        className={`document-find-toggle ${find.wholeWord ? 'active' : ''}`}
        aria-pressed={find.wholeWord}
        title="Match whole words only"
        onClick={find.toggleWholeWord}
      >
        Whole word
      </button>
      <button type="button" className="document-find-btn" aria-label="Previous match" title="Previous match (Shift+Enter)" onClick={find.previous} disabled={noMatches}>
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <button type="button" className="document-find-btn" aria-label="Next match" title="Next match (Enter)" onClick={find.next} disabled={noMatches}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <button type="button" className="document-find-btn" aria-label="Close find" title="Close (Esc)" onClick={find.closeFind}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

interface DocumentHitListProps {
  hits: DocumentFindState['hits'];
  query: string;
  mode: 'boolean' | 'semantic';
  /** Set when the document cannot be read inline (PDF, XML, load failure). */
  unavailableReason?: string;
}

/**
 * "All hits in this filing": every place the incoming search query matched
 * in the document as displayed, each with its section breadcrumb. Selecting
 * a hit scrolls the document to it and outlines it.
 */
export function DocumentHitList({ hits, query, mode, unavailableReason }: DocumentHitListProps) {
  const subject = mode === 'boolean' ? 'the Boolean query' : 'the search terms';
  let summary: string;
  if (unavailableReason) summary = unavailableReason;
  else if (hits.loading) summary = 'Reading the document for hits…';
  else if (hits.status === 'invalid-query') summary = 'The search query could not be read by the Boolean engine, so its hits cannot be listed.';
  else if (hits.status === 'no-match') summary = `No hits of ${subject} in this document's text.`;
  else {
    summary = `${hits.total.toLocaleString()} hit${hits.total === 1 ? '' : 's'} of ${subject} in this document's text.`;
    if (hits.total > hits.hits.length) summary += ` Listing the first ${hits.hits.length.toLocaleString()}.`;
  }

  const showList = !unavailableReason && !hits.loading && hits.status === 'ok' && hits.hits.length > 0;
  return (
    <div className="document-hits-panel">
      <h4>All hits in this filing</h4>
      <p className="document-hits-query">
        <span className="document-hits-mode">{mode === 'boolean' ? 'Boolean' : 'Keyword'}</span>
        <code>{query}</code>
      </p>
      <p className="document-hits-summary" role="status">{summary}</p>
      {showList && (
        <ol className="document-hits-list">
          {hits.hits.map((hit, index) => (
            <li key={`${hit.start}-${hit.end}`}>
              <button
                type="button"
                className={hits.focusedIndex === index ? 'active' : ''}
                aria-current={hits.focusedIndex === index ? 'true' : undefined}
                onClick={() => hits.focus(index)}
              >
                <span className="document-hit-meta">
                  <span className="document-hit-number">{index + 1}</span>
                  {hit.sectionPath && <span className="document-hit-path">{hit.sectionPath}</span>}
                </span>
                <span className="document-hit-excerpt">
                  {hit.before}
                  <mark>{hit.match}</mark>
                  {hit.after}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
