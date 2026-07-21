'use client';

/**
 * ⌘K / Ctrl+K command palette — jump to any page, open an issuer dossier by
 * name or ticker, or fire a filing search, without touching the mouse.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FileSearch, Navigation } from 'lucide-react';
import { resolveCompanyEntity, type CompanyDirectoryEntry } from '../../services/secApi';
import { PRODUCT_ROUTES } from '../../config/routes';

interface PaletteItem {
  kind: 'page' | 'company' | 'search';
  label: string;
  hint: string;
  href: string;
}

export function trapCommandPaletteFocus(
  event: { key: string; shiftKey: boolean; preventDefault: () => void },
  dialog: HTMLElement
): void {
  if (event.key !== 'Tab') return;

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('input,button:not([disabled]),a[href]')
  ).filter(element => element.tabIndex >= 0);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState<CompanyDirectoryEntry | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  const openPalette = useCallback(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
    setQuery('');
    setCompany(null);
    setHighlighted(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) closePalette(); else openPalette();
      } else if (event.key === 'Escape') {
        if (open) closePalette();
      }
    };
    const onOpenRequest = () => openPalette();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('urc:open-command-palette', onOpenRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('urc:open-command-palette', onOpenRequest);
    };
  }, [closePalette, open, openPalette]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
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
  for (const page of PRODUCT_ROUTES.filter(route => route.palette)) {
    if (!normalized || page.label.toLowerCase().includes(normalized) || page.keywords.includes(normalized)) {
      items.push({ kind: 'page', label: page.label, hint: 'Go to page', href: page.path });
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
    closePalette();
    router.push(item.href);
  }, [closePalette, router]);

  if (!open) return null;

  return (
    <div
      onClick={closePalette}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,10,31,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', paddingTop: '14vh' }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick navigation and filing search"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (dialogRef.current) trapCommandPaletteFocus(event, dialogRef.current);
        }}
        style={{ width: 'min(560px, 92vw)', height: 'fit-content', background: 'var(--surface-panel-strong)', border: '1px solid var(--border-color)', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
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
          role="combobox"
          aria-label="Quick navigation search"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-activedescendant={visible[highlighted] ? `${listboxId}-option-${highlighted}` : undefined}
          style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.95rem', outline: 'none' }}
        />
        <div id={listboxId} role="listbox" aria-label="Command palette results">
          {visible.map((item, index) => (
            <button
              key={`${item.kind}:${item.href}`}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              tabIndex={-1}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => go(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
                padding: '10px 16px', background: index === highlighted ? 'rgba(179,31,126,0.18)' : 'transparent',
                border: 'none', cursor: 'pointer',
              }}>
              {item.kind === 'company' ? <Building2 size={15} style={{ color: 'var(--accent-soft)' }} />
                : item.kind === 'search' ? <FileSearch size={15} style={{ color: 'var(--text-muted)' }} />
                : <Navigation size={15} style={{ color: 'var(--text-muted)' }} />}
              <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', flex: 1 }}>{item.label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{item.hint}</span>
            </button>
          ))}
          {visible.length === 0 && (
            <div style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No matches.</div>
          )}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  );
}
