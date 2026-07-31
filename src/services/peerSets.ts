/**
 * Saved peer sets (benchmark C4's "build/load a saved matrix").
 *
 * A named list of tickers, browser-local like sessions and the memo tray.
 * Loading one re-populates the Benchmarking company selection, which drives
 * every view — financials, redline, audit matrix, YoY changes — so one saved
 * set serves them all.
 */

import { scopedStorageKey } from './storageNamespace';

const STORAGE_KEY = 'urc.benchmark.peersets.v1';
const MAX_SETS = 20;

/**
 * Per-identity key, like every other research artifact (sessions, memo tray,
 * alerts). Without this, two analysts sharing a machine saw and overwrote
 * each other's named peer groups — and a saved set drives every Benchmarking
 * view. Falls back to the raw key only when no identity scope exists yet
 * (signed-out dev, tests).
 */
function storageKey(): string {
  return scopedStorageKey(STORAGE_KEY) ?? STORAGE_KEY;
}

export interface SavedPeerSet {
  name: string;
  tickers: string[];
  savedAt: string;
}

function readAll(): SavedPeerSet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed = raw ? JSON.parse(raw) as SavedPeerSet[] : [];
    return Array.isArray(parsed)
      ? parsed.filter(set => set && typeof set.name === 'string' && Array.isArray(set.tickers))
      : [];
  } catch {
    return [];
  }
}

function writeAll(sets: SavedPeerSet[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(sets.slice(0, MAX_SETS)));
  } catch {
    // Quota or privacy mode — saved sets are a convenience, never load-bearing.
  }
}

export function listPeerSets(): SavedPeerSet[] {
  return readAll();
}

/** Save (or overwrite by name). Returns the updated list. */
export function savePeerSet(name: string, tickers: string[]): SavedPeerSet[] {
  const cleanName = name.trim().slice(0, 60);
  const cleanTickers = Array.from(new Set(tickers.map(t => t.trim().toUpperCase()).filter(Boolean)));
  if (!cleanName || cleanTickers.length === 0) return readAll();
  const rest = readAll().filter(set => set.name.toLowerCase() !== cleanName.toLowerCase());
  const next = [{ name: cleanName, tickers: cleanTickers, savedAt: new Date().toISOString() }, ...rest];
  writeAll(next);
  return next;
}

export function deletePeerSet(name: string): SavedPeerSet[] {
  const next = readAll().filter(set => set.name.toLowerCase() !== name.trim().toLowerCase());
  writeAll(next);
  return next;
}
