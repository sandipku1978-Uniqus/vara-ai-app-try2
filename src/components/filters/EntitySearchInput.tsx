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
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;
    void getCompanyDirectory().then(loaded => {
      if (!cancelled) setDirectory(loaded);
    });
    return () => { cancelled = true; };
  }, []);

  const suggestions = computeCompanySuggestions(directory, value);

  const chooseSuggestion = (entry: CompanyDirectoryEntry) => {
    if (onPick) onPick(entry);
    else onChange(`${entry.ticker} `);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        id={id}
        value={value}
        onChange={event => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => Math.min(index + 1, suggestions.length - 1));
          } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && open && activeIndex >= 0 && suggestions[activeIndex]) {
            event.preventDefault();
            chooseSuggestion(suggestions[activeIndex]);
          } else if (event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
            onSubmit();
          } else if (event.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        onFocus={() => {
          setOpen(true);
          setActiveIndex(suggestions.length > 0 ? 0 : -1);
        }}
        onBlur={() => window.setTimeout(() => {
          setOpen(false);
          setActiveIndex(-1);
        }, 150)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-controls={open && suggestions.length > 0 ? listboxId : undefined}
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-activedescendant={open && activeIndex >= 0 && suggestions[activeIndex]
          ? `${listboxId}-option-${activeIndex}`
          : undefined}
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
          {suggestions.map((entry, index) => (
            <button
              key={entry.ticker}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onMouseDown={event => {
                event.preventDefault();
                chooseSuggestion(entry);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              style={{
                display: 'flex', gap: '10px', alignItems: 'baseline', width: '100%',
                padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: index === activeIndex ? 'var(--interactive-hover)' : 'transparent',
                color: 'var(--text-primary)', fontSize: '0.82rem',
              }}
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
