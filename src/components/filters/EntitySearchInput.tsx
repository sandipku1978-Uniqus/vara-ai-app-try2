'use client';

import { useEffect, useId, useState, type CSSProperties } from 'react';
import {
  computeCompanySuggestions,
  getCompanyDirectory,
  type CompanyDirectoryEntry,
} from '../../services/secApi';

interface EntitySearchInputProps {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Called when a suggestion is picked; default fills "TICKER " into the query. */
  onPick?: (entry: CompanyDirectoryEntry) => void;
  /** Fired on Enter for inputs that live outside a form. */
  onSubmit?: () => void;
  inputStyle?: CSSProperties;
  id?: string;
}

/**
 * Free-text search input with the shared company-suggestion dropdown — the
 * default for every search bar that accepts company names, tickers, or
 * brands, so entity prompting never has to be re-implemented per page.
 */
export default function EntitySearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onPick,
  onSubmit,
  inputStyle,
  id,
}: EntitySearchInputProps) {
  const [directory, setDirectory] = useState<CompanyDirectoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;
    void getCompanyDirectory().then(loaded => {
      if (!cancelled) setDirectory(loaded);
    });
    return () => { cancelled = true; };
  }, []);

  const suggestions = computeCompanySuggestions(directory, value);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        id={id}
        value={value}
        onChange={event => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            setOpen(false);
            onSubmit();
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        style={{
          width: '100%', padding: '8px 12px', background: 'var(--input-bg)',
          border: '1px solid var(--input-border)', borderRadius: '8px',
          color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
          ...inputStyle,
        }}
      />
      {open && suggestions.length > 0 && (
        <div role="listbox" id={listboxId} aria-label="Company suggestions" style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
          marginTop: '4px', borderRadius: '8px', overflow: 'hidden',
          background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
          boxShadow: 'var(--glow-shadow)',
        }}>
          {suggestions.map(entry => (
            <button
              key={entry.ticker}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={event => {
                event.preventDefault();
                if (onPick) onPick(entry);
                else onChange(`${entry.ticker} `);
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
              <strong style={{ color: 'var(--accent-primary)', minWidth: '52px' }}>{entry.ticker}</strong>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
