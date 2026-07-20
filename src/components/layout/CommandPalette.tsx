'use client';

/**
 * ⌘K / Ctrl+K command palette — jump to any page, open an issuer dossier by
 * name or ticker, or fire a filing search, without touching the mouse.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FileSearch, Navigation } from 'lucide-react';
import { resolveCompanyEntity, type CompanyDirectoryEntry } from '../../services/secApi';

const PAGES: Array<{ label: string; href: string; keywords: string }> = [
  { label: 'Dashboard', href: '/dashboard', keywords: 'home monitor overview' },
  { label: 'Research Workbench', href: '/search', keywords: 'search filings full text' },
  { label: 'Comment Letters', href: '/comment-letters', keywords: 'sec staff upload corresp review' },
  { label: 'Benchmarking', href: '/compare', keywords: 'peers compare financials' },
  { label: 'Accounting Analytics', href: '/accounting-analytics', keywords: 'ratios' },
  { label: 'Accounting Standards', href: '/accounting', keywords: 'asc asu reference' },
  { label: 'ESG Research', href: '/esg', keywords: 'climate sustainability' },
  { label: 'Board Profiles', href: '/boards', keywords: 'governance compensation' },
  { label: 'Insider Trading', href: '/insiders', keywords: 'form 4' },
  { label: '8-K Event Filings', href: '/earnings', keywords: 'events' },
  { label: 'Securities Regulation', href: '/regulation', keywords: 'rules' },
  { label: 'SEC Enforcement', href: '/enforcement', keywords: 'aaer actions' },
  { label: 'IPO Center', href: '/ipo', keywords: 's-1' },
  { label: 'M&A Research', href: '/mna', keywords: 'merger deals' },
  { label: 'Exhibits & Agreements', href: '/exhibits', keywords: 'contracts' },
  { label: 'No-Action Letters', href: '/no-action-letters', keywords: '' },
];

interface PaletteItem {
  kind: 'page' | 'company' | 'search';
  label: string;
  hint: string;
  href: string;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState<CompanyDirectoryEntry | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(prev => !prev);
        setQuery('');
        setCompany(null);
        setHighlighted(0);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setCompany(null); return; }
    debounceRef.current = setTimeout(() => {
      resolveCompanyEntity(query).then(setCompany).catch(() => setCompany(null));
    }, 200);
  }, [query]);

  const normalized = query.trim().toLowerCase();
  const items: PaletteItem[] = [];
  if (company) {
    items.push({
      kind: 'company',
      label: `${company.title} (${company.ticker})`,
      hint: 'Issuer dossier — filings · letters · auditor · financials',
      href: `/company/${company.ticker}`,
    });
  }
  for (const page of PAGES) {
    if (!normalized || page.label.toLowerCase().includes(normalized) || page.keywords.includes(normalized)) {
      items.push({ kind: 'page', label: page.label, hint: 'Go to page', href: page.href });
    }
  }
  if (normalized) {
    items.push({
      kind: 'search',
      label: `Search filings for “${query.trim()}”`,
      hint: 'Full-text research',
      href: `/search?q=${encodeURIComponent(query.trim())}`,
    });
  }
  const visible = items.slice(0, 9);

  const go = useCallback((item: PaletteItem) => {
    setOpen(false);
    router.push(item.href);
  }, [router]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,10,31,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', paddingTop: '14vh' }}>
      <div onClick={event => event.stopPropagation()}
        style={{ width: 'min(560px, 92vw)', height: 'fit-content', background: '#131322', border: '1px solid var(--input-border)', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <input
          ref={inputRef}
          value={query}
          onChange={event => { setQuery(event.target.value); setHighlighted(0); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setHighlighted(prev => Math.min(prev + 1, visible.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setHighlighted(prev => Math.max(prev - 1, 0)); }
            if (event.key === 'Enter' && visible[highlighted]) go(visible[highlighted]);
          }}
          placeholder="Jump to a page, ticker, company, or search…"
          aria-label="Command palette"
          style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--surface-panel)', color: 'var(--text-primary)', fontSize: '0.95rem', outline: 'none' }}
        />
        <div role="listbox" aria-label="Command palette results">
          {visible.map((item, index) => (
            <button
              key={`${item.kind}:${item.href}`}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => go(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
                padding: '10px 16px', background: index === highlighted ? 'rgba(179,31,126,0.18)' : 'transparent',
                border: 'none', cursor: 'pointer',
              }}>
              {item.kind === 'company' ? <Building2 size={15} style={{ color: 'var(--accent-soft)' }} />
                : item.kind === 'search' ? <FileSearch size={15} style={{ color: 'var(--text-secondary)' }} />
                : <Navigation size={15} style={{ color: 'var(--text-secondary)' }} />}
              <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', flex: 1 }}>{item.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{item.hint}</span>
            </button>
          ))}
          {visible.length === 0 && (
            <div style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No matches.</div>
          )}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--surface-panel)', color: '#475569', fontSize: '0.7rem' }}>
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  );
}
