'use client';

import { useRef } from 'react';
import { X } from 'lucide-react';

import type { ResearchSearchSession } from '../../services/researchSessions';

export function researchTabId(sessionId: string): string {
  return `research-tab-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

interface ResearchSessionTabsProps {
  sessions: ResearchSearchSession[];
  activeSessionId?: string;
  emptyMessage: string;
  onSelect: (session: ResearchSearchSession) => void;
  onClose: (sessionId: string) => void;
}

/**
 * Accessible tab navigation for saved research sessions.
 *
 * SearchPage owns session persistence and routing; this component owns only
 * the keyboard and focus behavior of the tab strip.
 */
export default function ResearchSessionTabs({
  sessions,
  activeSessionId,
  emptyMessage,
  onSelect,
  onClose,
}: ResearchSessionTabsProps) {
  const tabListRef = useRef<HTMLDivElement>(null);

  const moveFocus = (currentIndex: number, direction: 'previous' | 'next' | 'first' | 'last') => {
    if (sessions.length === 0) return;
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? sessions.length - 1
        : direction === 'previous'
          ? (currentIndex - 1 + sessions.length) % sessions.length
          : (currentIndex + 1) % sessions.length;

    onSelect(sessions[nextIndex]);
    window.requestAnimationFrame(() => {
      tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
    });
  };

  if (sessions.length === 0) {
    return <div className="research-empty-tab">{emptyMessage}</div>;
  }

  return (
    <div ref={tabListRef} className="research-tab-strip" role="tablist" aria-label="Open research searches">
      {sessions.map((session, index) => {
        const isActive = activeSessionId === session.id;
        const tabId = researchTabId(session.id);
        return (
          <div key={session.id} className={`research-tab ${isActive ? 'active' : ''}`} role="presentation">
            <button
              type="button"
              id={tabId}
              className="research-tab-select"
              role="tab"
              aria-selected={isActive}
              aria-controls={`research-panel-${session.id}`}
              tabIndex={isActive || (!activeSessionId && index === 0) ? 0 : -1}
              onClick={() => onSelect(session)}
              onKeyDown={event => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  moveFocus(index, 'previous');
                } else if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  moveFocus(index, 'next');
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  moveFocus(index, 'first');
                } else if (event.key === 'End') {
                  event.preventDefault();
                  moveFocus(index, 'last');
                }
              }}
            >
              <span className="research-tab-title">{session.title}</span>
              <span className="count" aria-label={`${session.results.length} results`}>{session.results.length}</span>
            </button>
            <button
              type="button"
              className="close"
              aria-label={`Close ${session.title} search`}
              onClick={() => onClose(session.id)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
