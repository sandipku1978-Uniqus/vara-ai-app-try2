'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BellRing, ChevronDown, X } from 'lucide-react';
import { AUDITOR_OPTIONS, canonicalizeAuditorInput } from '../../services/auditors';

interface AuditorLookupFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const shellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '9px 12px',
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  borderRadius: '12px',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--text-primary)',
  fontSize: '0.82rem',
  padding: 0,
  minWidth: 0,
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function AuditorLookupField({
  id,
  value,
  onChange,
  placeholder = 'Select auditor',
}: AuditorLookupFieldProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const matches = useMemo(() => {
    const normalizedQuery = normalize(value);
    if (!normalizedQuery) {
      return AUDITOR_OPTIONS.slice(0, 10);
    }

    return AUDITOR_OPTIONS
      .map(option => {
        const aliases = [option.label, ...option.aliases];
        let score = 0;

        for (const alias of aliases) {
          const normalizedAlias = normalize(alias);
          if (!normalizedAlias) continue;
          if (normalizedAlias === normalizedQuery) score = Math.max(score, 120);
          else if (normalizedAlias.startsWith(normalizedQuery)) score = Math.max(score, 90);
          else if (normalizedAlias.includes(normalizedQuery)) score = Math.max(score, 60);
        }

        return { option, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label))
      .slice(0, 10)
      .map(item => item.option);
  }, [value]);

  const handleSelect = (nextValue: string) => {
    onChange(canonicalizeAuditorInput(nextValue));
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={shellStyle}>
        <BellRing size={14} style={{ color: 'var(--text-muted)' }} />
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={event => {
            onChange(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => { setOpen(true); setActiveIndex(matches.length > 0 ? 0 : -1); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && matches.length > 0) {
              event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp' && matches.length > 0) {
              event.preventDefault(); setOpen(true); setActiveIndex(index => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && open && activeIndex >= 0) {
              event.preventDefault(); handleSelect(matches[activeIndex].label);
            } else if (event.key === 'Escape') {
              setOpen(false); setActiveIndex(-1);
            }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-label="Accountant or auditor"
          onBlur={() => {
            if (!open) {
              onChange(canonicalizeAuditorInput(value));
            }
          }}
          placeholder={placeholder}
          style={inputStyle}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear accountant or auditor"
            onClick={() => {
              onChange('');
              setOpen(false);
              setActiveIndex(-1);
              inputRef.current?.focus();
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        ) : (
          <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
        )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Auditor matches"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 40,
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
            background: 'var(--surface-panel-strong)',
            boxShadow: '0 18px 42px rgba(58,30,65,0.12)',
            maxHeight: '320px',
            overflowY: 'auto',
          }}
        >
          {matches.length > 0 ? (
            matches.map((option, index) => (
              <button
                key={option.label}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseDown={event => event.preventDefault()}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => handleSelect(option.label)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: index === activeIndex ? 'var(--interactive-hover)' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text-primary)',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{option.label}</div>
                <div style={{ marginTop: '2px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {option.aliases.slice(0, 3).join(' | ')}
                </div>
              </button>
            ))
          ) : (
            <div style={{ padding: '12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {value.trim() ? 'No auditors match that search yet.' : 'Start typing to pick an auditor.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
