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
// The browser storage scope initializes asynchronously; track which key the
// cache was hydrated under so an early empty read can never clobber citations
// persisted by another page once the scope arrives.
let cacheKey: string | null | undefined;

function storageKey(): string | null {
  return scopedStorageKey(STORAGE_KEY);
}

function read(): MemoCitation[] {
  if (typeof window === 'undefined') return cache || [];
  const key = storageKey();
  if (cache && cacheKey === key) return cache;
  if (!key) {
    cache = cache || [];
    cacheKey = key;
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as MemoCitation[]) : [];
    // Citations captured before the scope was ready live only in memory —
    // merge them instead of losing either side.
    const pending = (cache || []).filter(item => !stored.some(existing => existing.id === item.id));
    cache = [...stored, ...pending];
    cacheKey = key;
    if (pending.length > 0) persist(cache, key);
  } catch {
    cache = cache || [];
    cacheKey = key;
  }
  return cache;
}

function persist(items: MemoCitation[], key: string): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Quota/private-mode failures keep the tray in-memory for the session.
  }
}

function write(items: MemoCitation[]): void {
  // Hydrate from storage first so a stale in-memory cache can never
  // overwrite citations persisted by another page.
  read();
  cache = items;
  const key = storageKey();
  cacheKey = key;
  if (key && typeof window !== 'undefined') persist(items, key);
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

/**
 * The generated memo draft persists next to the citations it was drafted
 * from, so a page refresh never discards work. citationIds lets the tray
 * flag the draft as stale when the evidence set changes afterward.
 */
export interface MemoDraftRecord {
  text: string;
  generatedAt: string;
  citationIds: string[];
}

const DRAFT_STORAGE_KEY = 'urc.memo.draft.v1';
const draftListeners = new Set<Listener>();
let draftCache: MemoDraftRecord | null | undefined;
let draftCacheKey: string | null | undefined;

function draftStorageKey(): string | null {
  return scopedStorageKey(DRAFT_STORAGE_KEY);
}

function persistDraft(record: MemoDraftRecord | null, key: string): void {
  try {
    if (record) window.localStorage.setItem(key, JSON.stringify(record));
    else window.localStorage.removeItem(key);
  } catch {
    // In-memory fallback only.
  }
}

function readDraft(): MemoDraftRecord | null {
  if (typeof window === 'undefined') return draftCache ?? null;
  const key = draftStorageKey();
  if (draftCache !== undefined && draftCacheKey === key) return draftCache;
  if (!key) {
    draftCache = draftCache ?? null;
    draftCacheKey = key;
    return draftCache;
  }
  try {
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as MemoDraftRecord) : null;
    // A draft generated before the scope was ready beats nothing stored.
    if (!stored && draftCache) persistDraft(draftCache, key);
    else draftCache = stored;
    draftCacheKey = key;
  } catch {
    draftCache = draftCache ?? null;
    draftCacheKey = key;
  }
  return draftCache ?? null;
}

export function subscribeMemoDraft(listener: Listener): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

export function getMemoDraft(): MemoDraftRecord | null {
  return readDraft();
}

export function setMemoDraft(text: string, citationIds: string[]): void {
  readDraft();
  draftCache = { text, generatedAt: new Date().toISOString(), citationIds };
  const key = draftStorageKey();
  draftCacheKey = key;
  if (key && typeof window !== 'undefined') persistDraft(draftCache, key);
  draftListeners.forEach(listener => listener());
}

export function clearMemoDraft(): void {
  readDraft();
  draftCache = null;
  const key = draftStorageKey();
  draftCacheKey = key;
  if (key && typeof window !== 'undefined') persistDraft(null, key);
  draftListeners.forEach(listener => listener());
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
