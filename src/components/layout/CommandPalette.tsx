'use client';

/**
 * ⌘K / Ctrl+K command palette — jump to any page, open an issuer dossier by
 * name or ticker, or fire a filing search, without touching the mouse.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FileSearch, FolderOpen, Navigation } from 'lucide-react';
import { resolveCompanyEntity, type CompanyDirectoryEntry } from '../../services/secApi';
import { PRODUCT_ROUTES } from '../../config/routes';
import { ACCOUNTING_ISSUES, accountingIssueHref } from '../../config/accountingTopics';
import { getActiveProjectId, getUserDataStatus, listUserProjects } from '../../services/userData';

export interface PaletteItem {
  kind: 'page' | 'company' | 'search' | 'project';
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

/**
 * Accounting issue pages and ASU index entries for a palette query: an issue
 * matches on its label, ASC reference ("842", "asc 606"), or one of its
 * headings; "asu" opens the ASU index; an Update number ("2023-07",
 * "ASU 2023-07") jumps to that row.
 */
export function accountingPaletteItems(normalized: string): PaletteItem[] {
  const query = normalized.trim().toLowerCase();
  if (query.length < 2) return [];
  const items: PaletteItem[] = [];

  const asu = query.match(/^(?:asu\s*(?:no\.\s*)?)?((?:19|20)\d{2})-(\d{1,2})$/);
  if (asu) {
    const number = `${asu[1]}-${asu[2].padStart(2, '0')}`;
    items.push({ kind: 'page', label: `ASU ${number}`, hint: 'ASU index row — PDF · citing filings', href: `/accounting?${new URLSearchParams({ tab: 'asu', asu: number }).toString()}#asu-${number}` });
  } else if ('asu index'.startsWith(query) || query === 'asus' || query.includes('standards update')) {
    items.push({ kind: 'page', label: 'ASU Index', hint: 'FASB Accounting Standards Updates', href: '/accounting?tab=asu' });
  }

  const ascQuery = query.replace(/^asc\s*/, '');
  for (const issue of ACCOUNTING_ISSUES) {
    const asc = (issue.asc || '').toLowerCase();
    const matches = issue.label.toLowerCase().includes(query)
      || (asc && (asc.includes(query) || (/^\d{3}/.test(ascQuery) && asc.replace(/^asc\s*/, '').startsWith(ascQuery))))
      || issue.codificationTopics.some(topic => /^\d{3}/.test(ascQuery) && topic.startsWith(ascQuery))
      || issue.topic.headings.some(heading => heading.includes(query));
    if (matches) {
      items.push({ kind: 'page', label: `Accounting issue: ${issue.label}`, hint: 'Precedents · staff comments · ASUs · guidance', href: accountingIssueHref(issue.id) });
    }
  }
  return items;
}

/**
 * Project entries: the Projects page and "New project" whenever the query
 * names projects, plus each project whose name or question matches. With no
 * query only the active project is offered. Projects come from the account
 * (userData.ts), so signed out or before the account answers there are none.
 */
export function projectPaletteItems(
  normalized: string,
  projects: Array<{ id?: string | null; name: string; question?: string }>,
  activeId: string | null,
): PaletteItem[] {
  const query = normalized.trim().toLowerCase();
  const items: PaletteItem[] = [];
  const namesProjects = query.length >= 3 && ('projects'.startsWith(query) || query.startsWith('project') || 'workspace'.startsWith(query));
  if (namesProjects) {
    items.push({ kind: 'page', label: 'Projects', hint: 'All research projects', href: '/projects' });
  }
  for (const project of projects) {
    if (!project.id) continue;
    const isActive = project.id === activeId;
    const matches = query
      ? namesProjects || project.name.toLowerCase().includes(query) || (project.question || '').toLowerCase().includes(query)
      : isActive;
    if (!matches) continue;
    items.push({
      kind: 'project',
      label: `Project: ${project.name}`,
      hint: isActive ? 'Active project workspace' : 'Project workspace',
      href: `/projects/${encodeURIComponent(project.id)}`,
    });
  }
  if (namesProjects || (query.length >= 3 && 'new project'.startsWith(query))) {
    items.push({ kind: 'page', label: 'New project', hint: 'Start a project with a name and question', href: '/projects?new=1' });
  }
  return items;
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
  const accountProjects = open && getUserDataStatus().mode === 'server' ? listUserProjects() : [];
  items.push(...projectPaletteItems(normalized, accountProjects, accountProjects.length > 0 ? getActiveProjectId() : null));
  items.push(...accountingPaletteItems(normalized));
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
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17, 16, 15, 0.54)', display: 'flex', justifyContent: 'center', paddingTop: '14vh' }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick navigation and filing search"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (dialogRef.current) trapCommandPaletteFocus(event, dialogRef.current);
        }}
        style={{ width: 'min(560px, 92vw)', height: 'fit-content', background: 'var(--surface-panel-strong)', border: '1px solid var(--input-border)', borderRadius: '6px', overflow: 'hidden', boxShadow: '0 14px 36px rgba(0, 0, 0, 0.24)' }}>
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
                padding: '10px 16px', background: index === highlighted ? 'var(--surface-accent)' : 'transparent',
                border: 'none', cursor: 'pointer',
              }}>
              {item.kind === 'company' ? <Building2 size={15} style={{ color: 'var(--accent-primary)' }} />
                : item.kind === 'project' ? <FolderOpen size={15} style={{ color: 'var(--accent-primary)' }} />
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
