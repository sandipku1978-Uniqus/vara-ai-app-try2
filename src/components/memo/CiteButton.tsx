'use client';

import { BookMarked } from 'lucide-react';
import { useMemoTray } from '../../hooks/useMemoTray';
import {
  addCitation,
  citationId,
  describeCitation,
  removeCitation,
  type MemoCitation,
} from '../../services/memoTray';

interface CiteButtonProps {
  citation: Omit<MemoCitation, 'id' | 'note' | 'addedAt'>;
  /** Chip-sized variant for table rows and letter cards. */
  compact?: boolean;
  className?: string;
  /**
   * Why this evidence cannot be cited yet (for example, its official SEC
   * document is still being located). Renders the control disabled with the
   * reason as its tooltip; an already-cited item can still be removed.
   */
  disabledReason?: string;
}

/** One shared cite control so every corpus feeds the same memo tray. */
export default function CiteButton({ citation, compact = false, className = '', disabledReason }: CiteButtonProps) {
  const citations = useMemoTray();
  const id = citationId(citation.cik, citation.accessionNumber, citation.section, citation.passageKey);
  const cited = citations.some(item => item.id === id);
  const disabled = Boolean(disabledReason) && !cited;
  // The visible label stays a short "Cite"; the accessible name carries the
  // filing identity so a page full of cite controls is distinguishable.
  const subject = describeCitation(citation);

  return (
    <button
      type="button"
      className={className}
      aria-pressed={cited}
      aria-label={cited ? `Cited ✓ ${subject} — remove from memo tray` : `Cite ${subject} in memo tray`}
      title={disabled ? disabledReason : cited ? 'Remove from memo tray' : 'Cite in memo tray'}
      disabled={disabled}
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
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <BookMarked size={compact ? 11 : 14} aria-hidden="true" /> {cited ? 'Cited ✓' : 'Cite'}
    </button>
  );
}
