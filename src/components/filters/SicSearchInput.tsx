'use client';

import { useEffect, useState } from 'react';
import { loadSicDirectory, type SicDirectoryEntry } from '../../services/referenceData';

interface SicSearchInputProps {
  value: string;
  onChange: (code: string) => void;
  ariaLabel?: string;
}

/**
 * Industry (SIC) lookup: accepts a 3-4 digit code directly, or an industry
 * name with suggestions from the official SEC SIC directory. Always shows
 * the resolved industry title so a bare code is never unexplained.
 */
export default function SicSearchInput({ value, onChange, ariaLabel }: SicSearchInputProps) {
  const [directory, setDirectory] = useState<SicDirectoryEntry[]>([]);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSicDirectory().then(entries => {
      if (!cancelled) setDirectory(entries);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setText(current => (current.trim() === value ? current : value));
  }, [value]);

  const trimmed = text.trim();
  const isCode = /^\d{3,4}$/.test(trimmed);
  const resolved = isCode ? directory.find(entry => entry.code === trimmed) : undefined;
  const lower = trimmed.toLowerCase();
  const suggestions = !trimmed
    ? []
    : directory
        .filter(entry => entry.code.startsWith(trimmed) || entry.title.toLowerCase().includes(lower))
        .slice(0, 8);

  return (
    <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0, maxWidth: '420px' }}>
      <input
        value={text}
        onChange={event => {
          setText(event.target.value);
          setOpen(true);
          const typed = event.target.value.trim();
          if (/^\d{3,4}$/.test(typed)) onChange(typed);
          else if (!typed) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Industry — type a SIC code (3571) or a name (pharmaceutical)..."
        aria-label={ariaLabel || 'Industry SIC code or name'}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        style={{
          width: '100%', padding: '8px 10px', background: 'var(--input-bg)',
          border: '1px solid var(--input-border)', borderRadius: '8px',
          color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
        }}
      />
      {resolved && (
        <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          SIC {resolved.code} — {resolved.title}
        </div>
      )}
      {open && suggestions.length > 0 && !(isCode && suggestions.length === 1 && resolved) && (
        <div role="listbox" aria-label="Industry suggestions" style={{
          position: 'absolute', top: 'calc(100% - 0px)', left: 0, right: 0, zIndex: 30,
          marginTop: '4px', borderRadius: '8px', overflow: 'hidden',
          background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
          boxShadow: 'var(--glow-shadow)', maxHeight: '260px', overflowY: 'auto',
        }}>
          {suggestions.map(entry => (
            <button
              key={entry.code}
              type="button"
              role="option"
              aria-selected={entry.code === value}
              onMouseDown={event => {
                event.preventDefault();
                setText(`${entry.code} — ${entry.title}`);
                onChange(entry.code);
                setOpen(false);
              }}
              style={{
                display: 'flex', gap: '10px', alignItems: 'baseline', width: '100%',
                padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: 'transparent', color: 'var(--text-primary)', fontSize: '0.82rem',
              }}
              onMouseEnter={event => { event.currentTarget.style.background = 'var(--interactive-hover)'; }}
              onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}
            >
              <strong style={{ color: 'var(--accent-primary)', minWidth: '46px', fontVariantNumeric: 'tabular-nums' }}>{entry.code}</strong>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
