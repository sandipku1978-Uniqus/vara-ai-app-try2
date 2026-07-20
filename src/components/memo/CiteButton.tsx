'use client';

import { BookMarked } from 'lucide-react';
import { useMemoTray } from '../../hooks/useMemoTray';
import { addCitation, citationId, removeCitation, type MemoCitation } from '../../services/memoTray';

interface CiteButtonProps {
  citation: Omit<MemoCitation, 'id' | 'note' | 'addedAt'>;
  /** Chip-sized variant for table rows and letter cards. */
  compact?: boolean;
  className?: string;
}

/** One shared cite control so every corpus feeds the same memo tray. */
export default function CiteButton({ citation, compact = false, className = '' }: CiteButtonProps) {
  const citations = useMemoTray();
  const id = citationId(citation.cik, citation.accessionNumber);
  const cited = citations.some(item => item.id === id);

  return (
    <button
      type="button"
      className={className}
      aria-pressed={cited}
      title={cited ? 'Remove from memo tray' : 'Cite in memo tray'}
      onClick={event => {
        event.stopPropagation();
        event.preventDefault();
        if (cited) removeCitation(id);
        else addCitation(citation);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: compact ? '2px 8px' : '6px 12px',
        borderRadius: '999px',
        border: '1px solid ' + (cited ? 'var(--accent-primary)' : 'var(--input-border)'),
        background: cited ? 'var(--interactive-hover-strong)' : 'transparent',
        color: cited ? 'var(--accent-primary)' : 'var(--text-secondary)',
        fontSize: compact ? '0.7rem' : '0.8rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <BookMarked size={compact ? 11 : 14} /> {cited ? 'Cited ✓' : 'Cite'}
    </button>
  );
}
