/**
 * Alert hits in the browser (migration 029): the typed client for
 * /api/user/alert-hits and /api/alerts/evaluate, a small shared store for
 * the unread summary the header bell and the Dashboard both show, and the
 * pure helpers that turn a hit into a viewer link, a memo citation and a
 * document-cart filing.
 *
 * Hits are written only by the scheduled evaluator on the server; the browser
 * reads them and marks them seen. When the deployment has no durable storage
 * (503 "unavailable") or the identity is not a signed-in account (403), the
 * summary says so and the bell stays hidden — nothing is evaluated locally.
 */

import { useSyncExternalStore } from 'react';
import type { MemoCitation } from './memoTray';
import type { CartFilingInput } from './documentCart';
import { filingIndexUrl } from './documentCart';

export interface AlertHit {
  id: string;
  alertClientKey: string;
  alertName: string;
  accession: string;
  cik: string;
  company: string;
  form: string;
  filedAt: string | null;
  periodEnding: string | null;
  document: string;
  sectionPath: string;
  passage: string;
  passageBasis: 'validated-text' | 'not-read';
  isAmendment: boolean;
  amendsAccession: string | null;
  seenAt: string | null;
  createdAt: string;
}

export interface AlertHitsPage {
  total: number;
  /** Unseen hits that are not amendments of an already-surfaced filing. */
  unseen: number;
  unseenAmendments: number;
  /** Unseen (non-amendment) hits per alert client key, across every hit. */
  byAlert: Record<string, number>;
  hits: AlertHit[];
}

export type AlertApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; errorClass: string; error: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchOverride: FetchLike | null = null;

/** Tests inject a fetch; production uses the global one. */
export function setAlertHitsFetchForTests(fetchImpl: FetchLike | null): void {
  fetchOverride = fetchImpl;
}

function activeFetch(): FetchLike | null {
  if (fetchOverride) return fetchOverride;
  return typeof fetch === 'function' ? (input, init) => fetch(input, init) : null;
}

async function callJson<T>(path: string, init: RequestInit): Promise<AlertApiResult<T>> {
  const doFetch = activeFetch();
  if (!doFetch) return { ok: false, status: 0, errorClass: 'transport', error: 'fetch is unavailable' };
  let response: Response;
  try {
    response = await doFetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch (error) {
    return { ok: false, status: 0, errorClass: 'transport', error: error instanceof Error ? error.message : 'network error' };
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = await response.json() as Record<string, unknown>;
  } catch {
    // Non-JSON (a proxy page) is a failure below.
  }
  if (!response.ok || parsed.ok !== true) {
    return {
      ok: false,
      status: response.status,
      errorClass: typeof parsed.errorClass === 'string' ? parsed.errorClass : 'unexpected',
      error: typeof parsed.error === 'string' ? parsed.error : `HTTP ${response.status}`,
    };
  }
  return { ok: true, value: parsed as T };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

/** Validate one wire hit; malformed rows are dropped rather than rendered. */
export function parseAlertHit(value: unknown): AlertHit | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.accession !== 'string' || !ACCESSION.test(value.accession)) return null;
  if (typeof value.cik !== 'string' || typeof value.alertClientKey !== 'string') return null;
  const text = (key: string) => (typeof value[key] === 'string' ? value[key] as string : '');
  const nullable = (key: string) => (typeof value[key] === 'string' && value[key] ? value[key] as string : null);
  return {
    id: value.id,
    alertClientKey: value.alertClientKey,
    alertName: text('alertName'),
    accession: value.accession,
    cik: value.cik,
    company: text('company'),
    form: text('form'),
    filedAt: nullable('filedAt'),
    periodEnding: nullable('periodEnding'),
    document: text('document'),
    sectionPath: text('sectionPath'),
    passage: text('passage'),
    passageBasis: value.passageBasis === 'validated-text' ? 'validated-text' : 'not-read',
    isAmendment: value.isAmendment === true,
    amendsAccession: nullable('amendsAccession'),
    seenAt: nullable('seenAt'),
    createdAt: text('createdAt'),
  };
}

export function parseAlertHitsPage(value: unknown): AlertHitsPage {
  const record = isRecord(value) ? value : {};
  const byAlert: Record<string, number> = {};
  if (isRecord(record.byAlert)) {
    for (const [key, count] of Object.entries(record.byAlert)) {
      const n = Number(count);
      if (Number.isFinite(n) && n > 0) byAlert[key] = n;
    }
  }
  return {
    total: Number(record.total) || 0,
    unseen: Number(record.unseen) || 0,
    unseenAmendments: Number(record.unseenAmendments) || 0,
    byAlert,
    hits: (Array.isArray(record.hits) ? record.hits : [])
      .map(parseAlertHit)
      .filter((hit): hit is AlertHit => hit !== null),
  };
}

export interface AlertHitsQuery {
  alertKey?: string;
  unseenOnly?: boolean;
  since?: Date;
  offset?: number;
  limit?: number;
}

export function alertHitsPath(query: AlertHitsQuery = {}): string {
  const params = new URLSearchParams();
  if (query.alertKey) params.set('alertKey', query.alertKey);
  if (query.unseenOnly) params.set('unseen', '1');
  if (query.since) params.set('since', query.since.toISOString());
  if (query.offset) params.set('offset', String(query.offset));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return qs ? `/api/user/alert-hits?${qs}` : '/api/user/alert-hits';
}

export async function fetchAlertHits(query: AlertHitsQuery = {}): Promise<AlertApiResult<AlertHitsPage>> {
  const result = await callJson<Record<string, unknown>>(alertHitsPath(query), { method: 'GET' });
  return result.ok ? { ok: true, value: parseAlertHitsPage(result.value) } : result;
}

export type MarkSeenTarget = { hitIds: string[] } | { alertKey: string } | { all: true };

export async function markAlertHitsSeen(target: MarkSeenTarget): Promise<AlertApiResult<number>> {
  const result = await callJson<{ marked?: number }>('/api/user/alert-hits', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target),
  });
  if (result.ok) {
    void refreshAlertHitSummary();
    return { ok: true, value: Number(result.value.marked) || 0 };
  }
  return result;
}

export interface AlertRunResult {
  outcome: string;
  complete?: boolean;
  newFilings?: number;
  storedHits?: number;
  reason?: string;
}

/** Ask the server to check one alert now (owner-scoped). */
export async function runAlertNow(alertKey: string): Promise<AlertApiResult<AlertRunResult>> {
  const result = await callJson<{ check?: AlertRunResult }>('/api/alerts/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alertKey }),
  });
  if (result.ok) {
    void refreshAlertHitSummary();
    return { ok: true, value: result.value.check ?? { outcome: 'unknown' } };
  }
  return result;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export interface AlertHitGroup {
  alertClientKey: string;
  alertName: string;
  hits: AlertHit[];
}

/** Group hits by alert, keeping the order of each alert's first hit. */
export function groupHitsByAlert(hits: readonly AlertHit[]): AlertHitGroup[] {
  const groups = new Map<string, AlertHitGroup>();
  for (const hit of hits) {
    let group = groups.get(hit.alertClientKey);
    if (!group) {
      group = { alertClientKey: hit.alertClientKey, alertName: hit.alertName || 'Saved alert', hits: [] };
      groups.set(hit.alertClientKey, group);
    }
    group.hits.push(hit);
  }
  return [...groups.values()];
}

function plainCik(cik: string): string {
  return cik.replace(/^0+/, '') || '0';
}

/** The in-app viewer route for the hit's document, or null when no document is known. */
export function viewerPathForHit(hit: Pick<AlertHit, 'cik' | 'accession' | 'document'>): string | null {
  if (!hit.document) return null;
  return `/filing/${plainCik(hit.cik)}_${hit.accession}_${hit.document}`;
}

/** The canonical SEC.gov URL: the matched document, else the filing index. */
export function secUrlForHit(hit: Pick<AlertHit, 'cik' | 'accession' | 'document'>): string {
  if (hit.document) {
    return `https://www.sec.gov/Archives/edgar/data/${plainCik(hit.cik)}/${hit.accession.replace(/-/g, '')}/${hit.document}`;
  }
  return filingIndexUrl(hit.cik, hit.accession);
}

export function hitToCitation(hit: AlertHit): Omit<MemoCitation, 'id' | 'note' | 'addedAt'> {
  return {
    kind: 'filing',
    cik: plainCik(hit.cik),
    accessionNumber: hit.accession,
    company: hit.company,
    form: hit.form,
    fileDate: hit.filedAt || '',
    // Only the passage the validator read is quoted; an unread hit is a
    // metadata citation.
    excerpt: hit.passageBasis === 'validated-text' ? hit.passage : '',
    sourceUrl: secUrlForHit(hit),
    ...(hit.sectionPath ? { section: hit.sectionPath } : {}),
  };
}

export function hitToCartFiling(hit: AlertHit): CartFilingInput {
  return {
    cik: plainCik(hit.cik),
    accessionNumber: hit.accession,
    company: hit.company,
    form: hit.form,
    fileDate: hit.filedAt || '',
    description: hit.passageBasis === 'validated-text' ? hit.passage.slice(0, 300) : '',
    sourceUrl: secUrlForHit(hit),
    origin: 'search',
  };
}

/** "3 hours ago" style relative time for check stamps. */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ── Shared unread summary ────────────────────────────────────────────────────

export type AlertHitSummaryStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface AlertHitSummary {
  status: AlertHitSummaryStatus;
  unseen: number;
  unseenAmendments: number;
  byAlert: Record<string, number>;
  /** Bumped on every refresh so open panels can reload their page. */
  version: number;
  error: string | null;
}

const INITIAL_SUMMARY: AlertHitSummary = {
  status: 'idle', unseen: 0, unseenAmendments: 0, byAlert: {}, version: 0, error: null,
};

let summary: AlertHitSummary = INITIAL_SUMMARY;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function setSummary(next: Partial<AlertHitSummary>): void {
  summary = { ...summary, ...next };
  listeners.forEach(listener => listener());
}

/** Re-read the unread counts (one small page). Concurrent calls share one request. */
export function refreshAlertHitSummary(): Promise<void> {
  if (inflight) return inflight;
  if (summary.status === 'idle') setSummary({ status: 'loading' });
  inflight = (async () => {
    const result = await fetchAlertHits({ unseenOnly: true, limit: 1 });
    if (result.ok) {
      setSummary({
        status: 'ready',
        unseen: result.value.unseen,
        unseenAmendments: result.value.unseenAmendments,
        byAlert: result.value.byAlert,
        version: summary.version + 1,
        error: null,
      });
    } else if (result.status === 503 || result.status === 403 || result.status === 401) {
      setSummary({ status: 'unavailable', unseen: 0, unseenAmendments: 0, byAlert: {}, version: summary.version + 1, error: result.error });
    } else {
      setSummary({ status: 'error', version: summary.version + 1, error: result.error });
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

export function getAlertHitSummary(): AlertHitSummary {
  return summary;
}

export function subscribeAlertHitSummary(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAlertHitSummary(): AlertHitSummary {
  return useSyncExternalStore(subscribeAlertHitSummary, getAlertHitSummary, () => INITIAL_SUMMARY);
}

export function resetAlertHitsForTests(): void {
  summary = INITIAL_SUMMARY;
  listeners.clear();
  inflight = null;
  fetchOverride = null;
}
