'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { loadCompanyDirectory } from '../../services/agentEvidence';

interface CompanyLookupFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

interface CompanyOption {
  cik: string;
  ticker: string;
  title: string;
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

function scoreOption(option: CompanyOption, query: string): number {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 1;

  const title = normalize(option.title);
  const ticker = normalize(option.ticker);
  let score = 0;

  if (ticker === normalizedQuery || title === normalizedQuery) score += 120;
  if (ticker.startsWith(normalizedQuery)) score += 90;
  if (title.startsWith(normalizedQuery)) score += 75;
  if (title.split(' ').some(word => word.startsWith(normalizedQuery))) score += 60;
  if (title.includes(normalizedQuery)) score += 40;
  if (ticker.includes(normalizedQuery)) score += 30;

  return score;
}

export default function CompanyLookupField({
  id,
  value,
  onChange,
  placeholder = 'Type company or ticker...',
}: CompanyLookupFieldProps) {
  const [options, setOptions] = useState<CompanyOption[]>([]);
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
      const directory = await loadCompanyDirectory();
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
    const ranked = options
      .map(option => ({ option, score: scoreOption(option, value) }))
      .filter(item => !normalizedQuery || item.score > 0)
      .sort((a, b) => b.score - a.score || a.option.title.localeCompare(b.option.title))
      .slice(0, 14)
      .map(item => item.option);

    return ranked;
  }, [options, value]);

  function chooseOption(option: CompanyOption) {
    onChange(option.title);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={shellStyle}>
        {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} style={{ color: 'var(--text-muted)' }} />}
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
              event.preventDefault();
              setOpen(true);
              setActiveIndex(index => Math.min(index + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp' && matches.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(index => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && open && activeIndex >= 0) {
              event.preventDefault();
              chooseOption(matches[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-label="Company or entity"
          placeholder={placeholder}
          style={inputStyle}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear company or entity"
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
          aria-label="Company matches"
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
                key={`${option.ticker}-${option.cik}`}
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
                  <span style={{ fontSize: '0.74rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>{option.ticker}</span>
                </div>
                <div style={{ marginTop: '2px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>CIK {option.cik}</div>
              </button>
            ))
          ) : (
            <div style={{ padding: '12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {value.trim() ? 'No companies match that search yet.' : 'Start typing to search issuers by company name or ticker.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
