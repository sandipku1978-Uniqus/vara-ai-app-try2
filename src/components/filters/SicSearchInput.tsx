'use client';

import { useEffect, useState } from 'react';
import { loadSicDirectory, type SicDirectoryEntry } from '../../services/referenceData';

interface SicSearchInputProps {
  value: string;
  onChange: (code: string) => void;
  ariaLabel?: string;
}

/**
 * The SEC's SIC titles use registrar vocabulary ("BIOLOGICAL PRODUCTS"), not
 * the sector names analysts type ("biotech"). Map common sector words to
 * their canonical codes so natural language lands on the right industries.
 */
const SECTOR_ALIASES: Array<{ match: RegExp; codes: string[] }> = [
  { match: /bio\s?tech|life scien/, codes: ['2836', '8731', '2834'] },
  { match: /pharma/, codes: ['2834', '2836'] },
  { match: /software|saas/, codes: ['7372', '7371'] },
  { match: /semiconductor|chip/, codes: ['3674'] },
  { match: /bank/, codes: ['6022', '6021'] },
  { match: /insur/, codes: ['6311', '6331'] },
  { match: /oil|gas|energy/, codes: ['1311', '2911'] },
  { match: /utilit/, codes: ['4911', '4931'] },
  { match: /retail|stores/, codes: ['5331', '5411', '5961'] },
  { match: /e-?commerce/, codes: ['5961'] },
  { match: /airline/, codes: ['4512'] },
  { match: /reit|real estate/, codes: ['6798', '6500'] },
  { match: /telecom/, codes: ['4813'] },
  { match: /auto|vehicle/, codes: ['3711'] },
  { match: /health|hospital/, codes: ['8062', '8011', '8000'] },
  { match: /medical device|medtech|surgical/, codes: ['3841'] },
  { match: /gold|mining/, codes: ['1040'] },
  { match: /aerospace|defen[cs]e/, codes: ['3721', '3812'] },
  { match: /media|entertainment|streaming/, codes: ['7812', '4833'] },
  { match: /restaurant/, codes: ['5812'] },
  { match: /home\s?build|construction/, codes: ['1531'] },
  { match: /fintech|lending|consumer credit/, codes: ['6199', '6141'] },
];

/**
 * Industry (SIC) lookup: accepts a 3-4 digit code directly, or an industry
 * name with suggestions from the official SEC SIC directory. Always shows
 * the resolved industry title so a bare code is never unexplained.
 */
export default function SicSearchInput({ value, onChange, ariaLabel }: SicSearchInputProps) {
  const [directory, setDirectory] = useState<SicDirectoryEntry[]>([]);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSicDirectory().then(entries => {
      if (!cancelled) setDirectory(entries);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Sync an externally-set code into the box — but NEVER while the user is
  // typing, or edits get clobbered back to the old value mid-keystroke.
  useEffect(() => {
    if (focused) return;
    setText(current => (current.trim() === value ? current : value));
  }, [value, focused]);

  const trimmed = text.trim();
  const isCode = /^\d{3,4}$/.test(trimmed);
  const isDigits = /^\d+$/.test(trimmed);
  const resolved = isCode ? directory.find(entry => entry.code === trimmed) : undefined;
  const lower = trimmed.toLowerCase();

  let suggestions: SicDirectoryEntry[] = [];
  if (trimmed) {
    const seen = new Set<string>();
    const push = (entry: SicDirectoryEntry | undefined) => {
      if (entry && !seen.has(entry.code)) {
        seen.add(entry.code);
        suggestions.push(entry);
      }
    };
    // Sector vocabulary first ("biotech" → Biological Products, ...)
    for (const alias of SECTOR_ALIASES) {
      if (alias.match.test(lower)) alias.codes.forEach(code => push(directory.find(entry => entry.code === code)));
    }
    const rest = directory.filter(entry => entry.code.startsWith(trimmed) || entry.title.toLowerCase().includes(lower));
    // Digit input reads as a code prefix — order numerically, not by title.
    if (isDigits) rest.sort((a, b) => a.code.localeCompare(b.code));
    rest.forEach(push);
    suggestions = suggestions.slice(0, 8);
  }

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
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => { setFocused(false); window.setTimeout(() => setOpen(false), 150); }}
        placeholder="Industry — try biotech, software, banks... or a SIC code (3571)"
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
