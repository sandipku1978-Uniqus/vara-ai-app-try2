'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Building2, Loader2, X } from 'lucide-react';
import { loadSicDirectory, type SicDirectoryEntry } from '../../services/referenceData';

interface SicLookupFieldProps {
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

function scoreOption(option: SicDirectoryEntry, query: string): number {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 1;

  const title = normalize(option.title);
  const code = normalize(option.code);
  const office = normalize(option.office);
  let score = 0;

  if (code === normalizedQuery) score += 120;
  if (title === normalizedQuery) score += 100;
  if (code.startsWith(normalizedQuery)) score += 95;
  if (title.startsWith(normalizedQuery)) score += 80;
  if (title.split(' ').some(word => word.startsWith(normalizedQuery))) score += 60;
  if (title.includes(normalizedQuery)) score += 40;
  if (office.includes(normalizedQuery)) score += 20;

  return score;
}

export default function SicLookupField({
  id,
  value,
  onChange,
  placeholder = 'Search SIC code or industry...',
}: SicLookupFieldProps) {
  const [options, setOptions] = useState<SicDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const directory = await loadSicDirectory();
      if (!cancelled) {
        setOptions(directory);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
    return options
      .map(option => ({ option, score: scoreOption(option, value) }))
      .filter(item => !normalizedQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.option.title.localeCompare(b.option.title))
      .slice(0, 14)
      .map(item => item.option);
  }, [options, value]);

  function chooseOption(option: SicDirectoryEntry) {
    onChange(`${option.code} - ${option.title}`);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={shellStyle}>
        {loading ? <Loader2 size={14} className="spinner" /> : <Building2 size={14} style={{ color: 'var(--text-muted)' }} />}
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
              event.preventDefault(); chooseOption(matches[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false); setActiveIndex(-1);
            }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-label="Industry or SIC code"
          placeholder={placeholder}
          style={inputStyle}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear industry or SIC code"
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
        )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="SIC code matches"
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
                key={option.code}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => chooseOption(option)}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{option.title}</span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{option.code}</span>
                </div>
                <div style={{ marginTop: '2px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{option.office}</div>
              </button>
            ))
          ) : (
            <div style={{ padding: '12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {value.trim() ? 'No SIC codes match that search yet.' : 'Click or type to browse the full SEC SIC code list.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
