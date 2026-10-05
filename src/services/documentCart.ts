/**
 * Document cart — filings selected across searches and pages for one bulk
 * action (section download, list export, add to memo, benchmark).
 *
 * Selection is session state: it lives in sessionStorage under the signed-in
 * identity's namespace (storageNamespace), so it survives navigation and a
 * refresh but not a new browser session, and one user's cart is never read
 * under another's scope. The cart holds filing identity and the metadata the
 * row showed — never text — so nothing in it can drift from the filing.
 *
 * The state transitions are pure functions over an item list (tested
 * directly); the store below wraps them with persistence and subscriptions in
 * the same shape as the memo tray store.
 */
import { scopedStorageKey } from './storageNamespace';
import { normalizeAccession } from './evidencePackage';
import type { FilingResearchResult } from './filingResearch';
import type { MemoCitation } from './memoTray';

export type CartOrigin = 'search' | 'section-matrix' | 'yoy' | 'dossier' | 'exhibit';

export interface CartFiling {
  /** `${cik}:${dashed accession}` — one entry per filing, whichever surface added it. */
  id: string;
  cik: string;
  accessionNumber: string;
  company: string;
  form: string;
  fileDate: string;
  ticker?: string;
  /**
   * The filing's primary document, when the adding surface knew it. Exhibit
   * rows leave this empty (their document is the exhibit), and bulk actions
   * resolve the primary document from EDGAR instead of guessing.
   */
  primaryDocument?: string;
  /** Short description the row showed (search snippet, exhibit description). */
  description?: string;
  sourceUrl: string;
  origin: CartOrigin;
  addedAt: string;
}

export type CartFilingInput = Omit<CartFiling, 'id' | 'addedAt' | 'accessionNumber'> & { accessionNumber: string };

/** Bulk actions read every selected filing; this bounds that work. */
export const CART_LIMIT = 50;

export function cartFilingId(cik: string, accessionNumber: string): string {
  return `${String(cik).replace(/^0+/, '') || '0'}:${normalizeAccession(accessionNumber)}`;
}

/** The filing's EDGAR index page — the SEC link for a filing as a whole. */
export function filingIndexUrl(cik: string, accessionNumber: string): string {
  const dashed = normalizeAccession(accessionNumber);
  return `https://www.sec.gov/Archives/edgar/data/${String(cik).replace(/^0+/, '')}/${dashed.replace(/-/g, '')}/${dashed}-index.htm`;
}

export function cartContains(items: readonly CartFiling[], cik: string, accessionNumber: string): boolean {
  const id = cartFilingId(cik, accessionNumber);
  return items.some(item => item.id === id);
}

export type CartAddResult = { items: CartFiling[]; added: boolean; reason?: 'duplicate' | 'full' | 'invalid' };

/**
 * Add one filing. Duplicates (same CIK + accession from any surface) are a
 * no-op that keeps the first entry, but a later surface may fill in a ticker
 * or primary document the first one lacked.
 */
export function addCartFiling(items: readonly CartFiling[], input: CartFilingInput, now: Date = new Date()): CartAddResult {
  const accessionNumber = normalizeAccession(input.accessionNumber);
  if (!input.cik || !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) return { items: [...items], added: false, reason: 'invalid' };
  const id = cartFilingId(input.cik, accessionNumber);
  const existing = items.find(item => item.id === id);
  if (existing) {
    const enriched = {
      ...existing,
      ticker: existing.ticker || input.ticker || undefined,
      primaryDocument: existing.primaryDocument || input.primaryDocument || undefined,
    };
    return { items: items.map(item => (item.id === id ? enriched : item)), added: false, reason: 'duplicate' };
  }
  if (items.length >= CART_LIMIT) return { items: [...items], added: false, reason: 'full' };
  const entry: CartFiling = {
    ...input,
    cik: String(input.cik),
    accessionNumber,
    ticker: input.ticker?.trim().toUpperCase() || undefined,
    primaryDocument: input.primaryDocument?.trim() || undefined,
    id,
    addedAt: now.toISOString(),
  };
  return { items: [...items, entry], added: true };
}

export function removeCartFiling(items: readonly CartFiling[], id: string): CartFiling[] {
  return items.filter(item => item.id !== id);
}

export function toggleCartFiling(items: readonly CartFiling[], input: CartFilingInput, now: Date = new Date()): CartAddResult {
  const id = cartFilingId(input.cik, input.accessionNumber);
  if (items.some(item => item.id === id)) return { items: removeCartFiling(items, id), added: false };
  return addCartFiling(items, input, now);
}

/** Unique tickers for Benchmarking, plus how many filings had none to offer. */
export function cartTickers(items: readonly CartFiling[]): { tickers: string[]; withoutTicker: number } {
  const tickers: string[] = [];
  let withoutTicker = 0;
  for (const item of items) {
    const ticker = item.ticker?.trim().toUpperCase();
    if (!ticker) { withoutTicker += 1; continue; }
    if (!tickers.includes(ticker)) tickers.push(ticker);
  }
  return { tickers, withoutTicker };
}

const ORIGIN_LABEL: Record<CartOrigin, string> = {
  search: 'Selected from search results',
  'section-matrix': 'Selected from the Section Matrix',
  yoy: 'Selected from the YoY change matrix',
  dossier: 'Selected from the issuer dossier',
  exhibit: 'Selected from exhibit search',
};

/**
 * Cart rows in the search-result shape resultExport writes. Fields the cart
 * never observed (auditor, industry, match section) stay empty rather than
 * filled from elsewhere; the match-basis column says where the row came from.
 */
export function cartAsResearchResults(items: readonly CartFiling[]): FilingResearchResult[] {
  return items.map(item => ({
    id: item.id,
    entityName: item.company,
    fileDate: item.fileDate,
    formType: item.form,
    documentType: item.form,
    cik: item.cik,
    accessionNumber: item.accessionNumber,
    primaryDocument: item.primaryDocument || '',
    filingPrimaryDocument: item.primaryDocument || '',
    description: item.description || '',
    matchSnippet: item.description || '',
    matchReason: ORIGIN_LABEL[item.origin],
    score: 0,
    relevanceScore: 0,
    filingUrl: item.sourceUrl,
    companyName: item.company,
    tickers: item.ticker ? [item.ticker] : [],
    sic: '',
    sicDescription: '',
    exchange: '',
    stateOfIncorporation: '',
    fiscalYearEnd: '',
    headquarters: '',
    fileNumber: '',
    auditor: '',
    acceleratedStatus: '',
  }));
}

/** Memo-tray citations for every cart filing: identity and link, the row's description as excerpt. */
export function cartAsCitations(items: readonly CartFiling[]): Array<Omit<MemoCitation, 'id' | 'note' | 'addedAt'>> {
  return items.map(item => ({
    kind: 'filing' as const,
    cik: item.cik,
    accessionNumber: item.accessionNumber,
    company: item.company,
    form: item.form,
    fileDate: item.fileDate,
    excerpt: item.description || '',
    sourceUrl: item.sourceUrl,
  }));
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'urc.document-cart.v1';
type Listener = () => void;
const listeners = new Set<Listener>();
let cache: CartFiling[] | null = null;
let cacheKey: string | null | undefined;

function isCartFiling(value: unknown): value is CartFiling {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.cik === 'string' && typeof record.accessionNumber === 'string';
}

function read(): CartFiling[] {
  if (typeof window === 'undefined') return cache || [];
  const key = scopedStorageKey(STORAGE_KEY);
  if (cache && cacheKey === key) return cache;
  if (!key) {
    cache = cache || [];
    cacheKey = key;
    return cache;
  }
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const stored = Array.isArray(parsed) ? parsed.filter(isCartFiling) : [];
    // Selections made before the identity scope arrived live only in memory —
    // keep them rather than dropping either side. Only those: a cart hydrated
    // under another identity is that identity's, and never carries across.
    const pending = cacheKey === null
      ? (cache || []).filter(item => !stored.some(existing => existing.id === item.id))
      : [];
    cache = [...stored, ...pending].slice(0, CART_LIMIT);
    cacheKey = key;
    if (pending.length > 0) persist(cache, key);
  } catch {
    cache = cache || [];
    cacheKey = key;
  }
  return cache;
}

function persist(items: CartFiling[], key: string): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage blocked or full: the cart stays in memory for this page.
  }
}

function write(items: CartFiling[]): void {
  read();
  cache = items;
  const key = scopedStorageKey(STORAGE_KEY);
  cacheKey = key;
  if (key && typeof window !== 'undefined') persist(items, key);
  listeners.forEach(listener => listener());
}

export function subscribeDocumentCart(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDocumentCart(): CartFiling[] {
  return read();
}

export function addToDocumentCart(input: CartFilingInput): CartAddResult {
  const result = addCartFiling(read(), input);
  if (result.added || result.reason === 'duplicate') write(result.items);
  return result;
}

export function toggleInDocumentCart(input: CartFilingInput): CartAddResult {
  const result = toggleCartFiling(read(), input);
  if (result.reason !== 'full' && result.reason !== 'invalid') write(result.items);
  return result;
}

export function removeFromDocumentCart(id: string): void {
  write(removeCartFiling(read(), id));
}

export function clearDocumentCart(): void {
  write([]);
}
