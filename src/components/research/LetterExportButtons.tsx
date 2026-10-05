'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

interface LetterExportButtonsProps {
  /** What is exported, for accessible names ("this episode", "these matches"). */
  subject: string;
  onCsv: () => Promise<void> | void;
  onDocx: () => Promise<void> | void;
  disabled?: boolean;
}

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '4px',
  border: '1px solid var(--input-border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: '0.72rem',
  cursor: 'pointer',
};

/** CSV and Word export for a comment-letter list or episode. */
export default function LetterExportButtons({ subject, onCsv, onDocx, disabled }: LetterExportButtonsProps) {
  const [busy, setBusy] = useState<'csv' | 'docx' | null>(null);
  const [error, setError] = useState('');

  const run = async (kind: 'csv' | 'docx') => {
    setBusy(kind);
    setError('');
    try {
      await (kind === 'csv' ? onCsv() : onDocx());
    } catch (exportError) {
      setError(exportError instanceof Error && exportError.message ? exportError.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <button type="button" style={buttonStyle} disabled={disabled || busy !== null}
        aria-label={`Export ${subject} as CSV`} onClick={() => void run('csv')}>
        {busy === 'csv' ? <Loader2 size={11} className="spinner" aria-hidden="true" /> : <Download size={11} aria-hidden="true" />} CSV
      </button>
      <button type="button" style={buttonStyle} disabled={disabled || busy !== null}
        aria-label={`Export ${subject} as Word`} onClick={() => void run('docx')}>
        {busy === 'docx' ? <Loader2 size={11} className="spinner" aria-hidden="true" /> : <Download size={11} aria-hidden="true" />} Word
      </button>
      {error && <span role="status" style={{ fontSize: '0.72rem', color: 'var(--status-error)' }}>{error}</span>}
    </span>
  );
}
