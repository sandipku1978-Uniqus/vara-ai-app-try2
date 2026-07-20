/**
 * Memo tray — the citation ledger behind the Evidence Ledger redesign.
 *
 * Researchers collect filings/letters as citations while they work, annotate
 * them, and turn them into a memo. Local-first: the tray persists per browser
 * (same posture as watchlist and annotations) and never invents evidence —
 * every entry carries the metadata and excerpt it was cited with.
 */
import { scopedStorageKey } from './storageNamespace';

export interface MemoCitation {
  id: string;               // `${cik}:${accession}` — one citation per filing
  kind: 'filing' | 'letter';
  cik: string;
  accessionNumber: string;
  company: string;
  form: string;
  fileDate: string;
  excerpt: string;          // the snippet visible when the user cited it
  sourceUrl: string;        // canonical SEC.gov URL
  note: string;             // user's own annotation
  addedAt: string;
}

const STORAGE_KEY = 'urc.memo.tray.v1';

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: MemoCitation[] | null = null;

function storageKey(): string | null {
  return scopedStorageKey(STORAGE_KEY);
}

function read(): MemoCitation[] {
  if (cache) return cache;
  if (typeof window === 'undefined') return [];
  try {
    const key = storageKey();
    const raw = key ? window.localStorage.getItem(key) : null;
    cache = raw ? (JSON.parse(raw) as MemoCitation[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: MemoCitation[]): void {
  cache = items;
  try {
    const key = storageKey();
    if (key) window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Quota/private-mode failures keep the tray in-memory for the session.
  }
  listeners.forEach(listener => listener());
}

export function subscribeMemoTray(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMemoCitations(): MemoCitation[] {
  return read();
}

export function citationId(cik: string, accessionNumber: string): string {
  return `${cik}:${accessionNumber}`;
}

export function isCited(cik: string, accessionNumber: string): boolean {
  return read().some(item => item.id === citationId(cik, accessionNumber));
}

export function addCitation(input: Omit<MemoCitation, 'id' | 'note' | 'addedAt'>): void {
  const id = citationId(input.cik, input.accessionNumber);
  const existing = read();
  if (existing.some(item => item.id === id)) return;
  write([...existing, { ...input, id, note: '', addedAt: new Date().toISOString() }]);
}

export function removeCitation(id: string): void {
  write(read().filter(item => item.id !== id));
}

export function updateCitationNote(id: string, note: string): void {
  write(read().map(item => (item.id === id ? { ...item, note } : item)));
}

export function clearMemoTray(): void {
  write([]);
}

/** Numbered plain-text citations, ready to paste into a memo or email. */
export function formatCitationsText(items: MemoCitation[]): string {
  return items
    .map((item, index) =>
      `[${index + 1}] ${item.company} — Form ${item.form}, filed ${item.fileDate} ` +
      `(accession ${item.accessionNumber}). ${item.sourceUrl}`)
    .join('\n');
}

/** Markdown export: citations plus the user's notes and cited excerpts. */
export function formatMemoMarkdown(items: MemoCitation[]): string {
  const lines: string[] = ['# Research memo — cited evidence', ''];
  items.forEach((item, index) => {
    lines.push(`## [${index + 1}] ${item.company} — Form ${item.form} (${item.fileDate})`);
    lines.push(`Source: ${item.sourceUrl}`);
    if (item.excerpt.trim()) lines.push(`> ${item.excerpt.trim()}`);
    if (item.note.trim()) lines.push(`Note: ${item.note.trim()}`);
    lines.push('');
  });
  lines.push('---');
  lines.push(formatCitationsText(items));
  return lines.join('\n');
}
