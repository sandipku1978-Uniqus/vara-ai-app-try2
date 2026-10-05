/**
 * Scheduled alert evaluation (gap analysis row 2, recommendation 3) — the
 * pure half plus a dependency-injected orchestrator.
 *
 * Before this module an alert was checked only while the Dashboard was open,
 * by the browser, three alerts per visit. Now the evaluator route
 * (src/app/api/alerts/evaluate) claims due alerts on a schedule and checks
 * each one with the same server-side executor search continuation jobs use
 * (runResumableWave + the worker's paced SEC clients), restricted to filings
 * filed since the alert was last checked.
 *
 * What a check records, and why:
 *   - new hits are filings the alert had not seen before (last_seen_accessions),
 *     stored with the passage the validator read, so the user sees evidence,
 *     not accession numbers;
 *   - an amendment (10-K/A) of a filing this alert already surfaced for the
 *     same issuer, base form and period is marked as an amendment, not
 *     announced as another new hit;
 *   - coverage says whether the window was examined completely, and if not,
 *     why — and an incomplete window is carried into the next check rather
 *     than skipped, so a partial check never silently loses filings;
 *   - the first check after the Boolean engine changes re-baselines (records
 *     what matches as seen without announcing it), exactly as the browser
 *     check did, so long-known filings are not re-announced as new.
 *
 * No I/O here: the store and the executor clients are injected.
 */

import { compileSearchPlan, type SearchExecutionPlan } from './filingResearchPlan';
import {
  buildWaveExecutionPolicy,
  createResumableCursor,
  isLaneFinished,
  runResumableWave,
  type ResumableWaveCursor,
  type WaveExecutionClients,
  type WaveFilingSignal,
} from './filingResearchExecution';
import type { FilingResearchResult } from './filingResearch';
import {
  buildSearchJobCoverage,
  mergeSearchJobHits,
  parseSearchJobFilters,
  searchJobContext,
  type SearchJobHit,
  type SearchJobPlanInput,
} from './searchJobs';
import type { CandidateCoverageNotice } from './searchCoverage';
import { BOOLEAN_ENGINE_VERSION } from '../utils/booleanSearch';

// ── Limits ───────────────────────────────────────────────────────────────────

export const ALERT_EVALUATION_LIMITS = {
  /** One evaluator pass stops claiming after this many alerts… */
  maxAlertsPerRun: 25,
  /** …or once this much wall time has passed; the next tick continues. */
  runBudgetMs: 50_000,
  /** Alerts evaluated side by side in one pass (the deployment-wide
   *  concurrency limit still applies on top). */
  parallelism: 2,
  /** A daily alert is due after 20 h, a weekly one after 6 days. */
  dailyAfterMs: 20 * 60 * 60 * 1000,
  weeklyAfterMs: 6 * 24 * 60 * 60 * 1000,
  /** First check, or a carried window older than this, looks back this far. */
  lookbackDays: 30,
  /** Hits stored with their passage per alert per check. */
  maxStoredHitsPerCheck: 100,
  /** Seen-accession memory per alert (026's column bound). */
  maxSeenAccessions: 5000,
  /** Stored passage length (029's column bound). */
  maxPassageChars: 1200,
  /** Candidates one check may examine; the wave policy's own ceilings
   *  (120 documents, 45 s) normally stop it first. */
  maxExaminedPerCheck: 500,
  /** Lease one evaluator holds on an alert for one check. */
  leaseSeconds: 180,
  /** A check's wave is hard-stopped here; the partial wave is recorded. */
  waveHardDeadlineMs: 70_000,
} as const;

/** The engine the seen-set was built with; a change forces a re-baseline. */
export const ALERT_ENGINE_VERSION = BOOLEAN_ENGINE_VERSION;

// ── Claimed alert ────────────────────────────────────────────────────────────

export type AlertCadence = 'daily' | 'weekly';

export interface ClaimedAlert {
  id: string;
  ownerUserId: string;
  orgId: string | null;
  clientKey: string;
  name: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters: Record<string, unknown>;
  defaultForms: string;
  cadence: AlertCadence;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastSeenAccessions: string[];
  engineVersion: number | null;
  lastCheckCoverage: Record<string, unknown> | null;
  leaseToken: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORM_LIST = /^[A-Za-z0-9 ,/.-]{0,400}$/;
const DOCUMENT_NAME = /^[A-Za-z0-9._-]{1,255}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the claim RPC's alert before it is trusted. */
export function parseClaimedAlert(value: unknown): ClaimedAlert | null {
  if (!isRecord(value)) return null;
  const {
    id, ownerUserId, orgId, clientKey, name, query, mode, filters, defaultForms,
    cadence, enabled, lastCheckedAt, lastSeenAccessions, engineVersion, lastCheckCoverage, leaseToken,
  } = value;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof leaseToken !== 'string' || !UUID.test(leaseToken)) return null;
  if (typeof ownerUserId !== 'string' || !ownerUserId) return null;
  if (orgId !== null && orgId !== undefined && typeof orgId !== 'string') return null;
  if (typeof clientKey !== 'string' || !clientKey) return null;
  if (typeof query !== 'string' || (mode !== 'semantic' && mode !== 'boolean')) return null;
  if (cadence !== 'daily' && cadence !== 'weekly') return null;
  if (lastCheckedAt !== null && lastCheckedAt !== undefined && (typeof lastCheckedAt !== 'string' || Number.isNaN(Date.parse(lastCheckedAt)))) return null;
  return {
    id,
    ownerUserId,
    orgId: typeof orgId === 'string' && orgId ? orgId : null,
    clientKey,
    name: typeof name === 'string' ? name : '',
    query,
    mode,
    filters: isRecord(filters) ? filters : {},
    defaultForms: typeof defaultForms === 'string' ? defaultForms : '',
    cadence,
    enabled: enabled !== false,
    lastCheckedAt: typeof lastCheckedAt === 'string' ? lastCheckedAt : null,
    lastSeenAccessions: Array.isArray(lastSeenAccessions)
      ? lastSeenAccessions.filter((accession): accession is string => typeof accession === 'string')
      : [],
    engineVersion: Number.isSafeInteger(engineVersion) ? Number(engineVersion) : null,
    lastCheckCoverage: isRecord(lastCheckCoverage) ? lastCheckCoverage : null,
    leaseToken,
  };
}

// ── Due selection ────────────────────────────────────────────────────────────

export interface DueCandidate {
  enabled: boolean;
  cadence: AlertCadence;
  lastCheckedAt: string | null;
}

/** Daily: more than 20 h since the last check. Weekly: more than 6 days. Never checked: due. Disabled: never. */
export function isAlertDue(alert: DueCandidate, now: number): boolean {
  if (!alert.enabled) return false;
  if (!alert.lastCheckedAt) return true;
  const last = Date.parse(alert.lastCheckedAt);
  if (Number.isNaN(last)) return true;
  const after = alert.cadence === 'weekly' ? ALERT_EVALUATION_LIMITS.weeklyAfterMs : ALERT_EVALUATION_LIMITS.dailyAfterMs;
  return now - last >= after;
}

/** The due alerts, stalest first (never checked first) — the order the claim RPC uses. */
export function selectDueAlerts<T extends DueCandidate>(alerts: readonly T[], now: number, limit: number = ALERT_EVALUATION_LIMITS.maxAlertsPerRun): T[] {
  return alerts
    .filter(alert => isAlertDue(alert, now))
    .sort((a, b) => {
      if (!a.lastCheckedAt && !b.lastCheckedAt) return 0;
      if (!a.lastCheckedAt) return -1;
      if (!b.lastCheckedAt) return 1;
      return Date.parse(a.lastCheckedAt) - Date.parse(b.lastCheckedAt);
    })
    .slice(0, Math.max(0, limit));
}

/** When an alert will next be due (for display). Null when disabled. */
export function nextDueAt(alert: DueCandidate): Date | null {
  if (!alert.enabled) return null;
  if (!alert.lastCheckedAt || Number.isNaN(Date.parse(alert.lastCheckedAt))) return new Date(0);
  const after = alert.cadence === 'weekly' ? ALERT_EVALUATION_LIMITS.weeklyAfterMs : ALERT_EVALUATION_LIMITS.dailyAfterMs;
  return new Date(Date.parse(alert.lastCheckedAt) + after);
}

// ── Evaluation window ────────────────────────────────────────────────────────

export type AlertWindowBasis = 'first-run' | 'since-last-check' | 'carried-from-partial' | 'lookback-capped';

export interface AlertEvaluationWindow {
  /** Inclusive filing-date bounds actually searched. */
  dateFrom: string;
  dateTo: string;
  basis: AlertWindowBasis;
  /** The alert's own date filter leaves nothing to search in this window. */
  empty: boolean;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Filings filed since the last check (inclusive of that day: EDGAR dates are
 * days, and the seen-set absorbs the overlap), or the last 30 days on the
 * first check. When the previous server check left its window incomplete,
 * that window's start is carried forward instead, so nothing the partial
 * check missed is skipped — bounded to the 30-day lookback.
 */
export function resolveEvaluationWindow(
  alert: Pick<ClaimedAlert, 'lastCheckedAt' | 'lastCheckCoverage' | 'filters'>,
  now: number
): AlertEvaluationWindow {
  const lookbackFloor = isoDay(now - ALERT_EVALUATION_LIMITS.lookbackDays * 24 * 60 * 60 * 1000);
  const today = isoDay(now);
  let dateFrom: string;
  let basis: AlertWindowBasis;

  const previous = alert.lastCheckCoverage;
  const carried = previous && previous.source === 'server' && previous.complete === false
    && typeof previous.windowFrom === 'string' && ISO_DATE.test(previous.windowFrom)
    ? previous.windowFrom
    : null;
  const lastChecked = alert.lastCheckedAt && !Number.isNaN(Date.parse(alert.lastCheckedAt))
    ? isoDay(Date.parse(alert.lastCheckedAt))
    : null;

  if (carried) {
    dateFrom = carried;
    basis = 'carried-from-partial';
  } else if (lastChecked) {
    dateFrom = lastChecked;
    basis = 'since-last-check';
  } else {
    dateFrom = lookbackFloor;
    basis = 'first-run';
  }
  if (dateFrom < lookbackFloor) {
    dateFrom = lookbackFloor;
    basis = 'lookback-capped';
  }
  if (dateFrom > today) dateFrom = today;

  // The alert's own date filter still binds.
  const ownFrom = typeof alert.filters.dateFrom === 'string' && ISO_DATE.test(alert.filters.dateFrom) ? alert.filters.dateFrom : '';
  const ownTo = typeof alert.filters.dateTo === 'string' && ISO_DATE.test(alert.filters.dateTo) ? alert.filters.dateTo : '';
  if (ownFrom && ownFrom > dateFrom) dateFrom = ownFrom;
  const dateTo = ownTo && ownTo < today ? ownTo : today;
  return { dateFrom, dateTo, basis, empty: dateFrom > dateTo };
}

// ── Search compilation ───────────────────────────────────────────────────────

export type AlertSearchCompilation =
  | { ok: true; input: SearchJobPlanInput; compiled: SearchExecutionPlan }
  | { ok: false; reason: string };

/**
 * The alert's saved search, restricted to the evaluation window and compiled
 * the way search continuation jobs compile theirs (paged EDGAR full-text
 * lanes only — the enriched facet lane is a browser route). Text signals are
 * hydrated so every non-delegated hit carries the passage the validator read.
 */
export function compileAlertSearch(
  alert: Pick<ClaimedAlert, 'query' | 'mode' | 'filters' | 'defaultForms'>,
  window: AlertEvaluationWindow
): AlertSearchCompilation {
  const filters = parseSearchJobFilters(alert.filters);
  if (!filters) return { ok: false, reason: 'The saved filters failed validation; re-save the alert from the Research Workbench.' };
  if (!FORM_LIST.test(alert.defaultForms)) return { ok: false, reason: 'The saved form list failed validation; re-save the alert.' };
  if (alert.query.length > 2_000) return { ok: false, reason: 'The saved query is longer than 2,000 characters.' };

  const input: SearchJobPlanInput = {
    query: alert.query,
    mode: alert.mode,
    filters: { ...filters, dateFrom: window.dateFrom, dateTo: window.dateTo },
    defaultForms: alert.defaultForms,
    includeExhibits: false,
    hydrateTextSignals: true,
  };
  const compiled = compileSearchPlan({
    query: input.query,
    filters: input.filters,
    mode: input.mode,
    defaultForms: input.defaultForms,
    limit: 500,
    includeExhibits: input.includeExhibits,
    deferTextValidation: false,
    preferFastCandidateCollection: false,
    hydrateTextSignals: input.hydrateTextSignals,
    useEnrichedSearch: false,
  });
  if (!compiled) return { ok: false, reason: 'The saved Boolean expression could not be compiled.' };
  const hasIssuer = Boolean(compiled.filters.entityName.trim() || (compiled.filters.entityCik || '').trim());
  if (compiled.filteredServerQueries.some(lane => !lane.trim()) && !hasIssuer) {
    return {
      ok: false,
      reason: 'This alert has no text EDGAR full-text search can page (a filter-only browse), so it cannot be checked in the background. Add a query term or an issuer.',
    };
  }
  return { ok: true, input, compiled };
}

/** Whether the executor fetched and matched filing text for this plan's hits. */
export function passageIsValidated(compiled: Pick<SearchExecutionPlan, 'delegatedToEfts' | 'hydratePerDocumentSignals'>): boolean {
  return compiled.hydratePerDocumentSignals && !compiled.delegatedToEfts;
}

// ── Filings found, diffing and amendments ────────────────────────────────────

/** One filing a check matched (exhibits already rolled up into their filing). */
export interface AlertFiling {
  accession: string;
  cik: string;
  company: string;
  form: string;
  fileDate: string;
  periodEnding: string | null;
  document: string;
  sectionPath: string;
  passage: string;
}

export interface PriorAlertHit {
  accession: string;
  cik: string;
  form: string;
  periodEnding: string | null;
}

export function parsePriorAlertHits(value: unknown): PriorAlertHit[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap(row => {
    if (typeof row.accession !== 'string' || !ACCESSION.test(row.accession)) return [];
    if (typeof row.cik !== 'string' || typeof row.form !== 'string') return [];
    return [{
      accession: row.accession,
      cik: row.cik,
      form: row.form,
      periodEnding: typeof row.periodEnding === 'string' && ISO_DATE.test(row.periodEnding) ? row.periodEnding : null,
    }];
  });
}

/** Trim a passage to the stored bound without cutting mid-word where possible. */
export function boundPassage(text: string, max: number = ALERT_EVALUATION_LIMITS.maxPassageChars): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Roll a wave's matching documents up to one row per filing. */
export function rollUpAlertFilings(
  matches: readonly FilingResearchResult[],
  isExhibitDocumentType: (documentType: string) => boolean,
  periodsByAccession: ReadonlyMap<string, string>
): AlertFiling[] {
  const merged = mergeSearchJobHits([], matches, isExhibitDocumentType);
  return merged.writes.map(({ accession, hit }: { accession: string; hit: SearchJobHit }) => ({
    accession,
    cik: String(hit.cik || '').replace(/^0+/, '') || '0',
    company: hit.companyName || hit.entityName || '',
    form: hit.formType || '',
    fileDate: ISO_DATE.test(hit.fileDate || '') ? hit.fileDate : '',
    periodEnding: periodsByAccession.get(accession) ?? null,
    document: DOCUMENT_NAME.test(hit.primaryDocument || '') ? hit.primaryDocument : '',
    sectionPath: hit.matchSectionPath || '',
    passage: hit.matchSnippet || '',
  }));
}

/** "10-K/A" → "10-K"; null when the form is not an amendment. */
export function amendedBaseForm(form: string): string | null {
  const match = form.trim().toUpperCase().match(/^(.+)\/A$/);
  return match ? match[1].trim() : null;
}

/**
 * Pair each amendment with an original this alert surfaced: same issuer,
 * the amendment's base form, and the same period of report. Originals come
 * from the alert's earlier hits and from this check's own matches. Without a
 * period on both sides no pairing is claimed.
 */
export function detectAmendments(
  filings: readonly AlertFiling[],
  priorOriginals: readonly PriorAlertHit[]
): Map<string, string> {
  const originals = new Map<string, string>();
  const key = (cik: string, form: string, period: string) => `${cik.replace(/^0+/, '')}|${form.trim().toUpperCase()}|${period}`;
  for (const prior of priorOriginals) {
    if (prior.periodEnding && !amendedBaseForm(prior.form)) originals.set(key(prior.cik, prior.form, prior.periodEnding), prior.accession);
  }
  for (const filing of filings) {
    if (filing.periodEnding && !amendedBaseForm(filing.form)) {
      const k = key(filing.cik, filing.form, filing.periodEnding);
      if (!originals.has(k)) originals.set(k, filing.accession);
    }
  }
  const amends = new Map<string, string>();
  for (const filing of filings) {
    const base = amendedBaseForm(filing.form);
    if (!base || !filing.periodEnding) continue;
    const original = originals.get(key(filing.cik, base, filing.periodEnding));
    if (original && original !== filing.accession) amends.set(filing.accession, original);
  }
  return amends;
}

export interface AlertDiffInput {
  filings: readonly AlertFiling[];
  lastSeenAccessions: readonly string[];
  lastCheckedAt: string | null;
  previousEngineVersion: number | null;
  complete: boolean;
  priorOriginals: readonly PriorAlertHit[];
  currentEngineVersion?: number;
}

export interface AlertDiff {
  /** Filings new to this alert (amendments included, marked). */
  fresh: Array<AlertFiling & { amendsAccession: string | null }>;
  /** Accessions of fresh filings that are not amendments of a surfaced original. */
  latestNew: string[];
  /** The seen-set after this check: extended, never replaced, newest kept. */
  nextSeen: string[];
  rebaseline: boolean;
  engineVersion: number | null;
}

/**
 * New-versus-seen. A filing is new when the alert's seen-set does not hold
 * it. The seen-set is extended with everything this check matched (partial
 * checks included: what was matched was verified), capped at 5,000 with the
 * oldest dropped. On the first check after an engine change nothing is
 * announced; a partial re-baseline keeps the old engine marker so the next
 * complete check re-baselines again.
 */
export function diffAlertFilings(input: AlertDiffInput): AlertDiff {
  const current = input.currentEngineVersion ?? ALERT_ENGINE_VERSION;
  const rebaseline = input.lastCheckedAt !== null && (input.previousEngineVersion ?? 1) !== current;
  const seen = new Set(input.lastSeenAccessions);
  const amends = detectAmendments(input.filings, input.priorOriginals);
  const fresh = rebaseline
    ? []
    : input.filings
      .filter(filing => !seen.has(filing.accession))
      .map(filing => ({ ...filing, amendsAccession: amends.get(filing.accession) ?? null }));

  const nextSeenOrdered: string[] = [];
  const included = new Set<string>();
  for (const accession of [...input.lastSeenAccessions, ...input.filings.map(filing => filing.accession)]) {
    if (!ACCESSION.test(accession) || included.has(accession)) continue;
    included.add(accession);
    nextSeenOrdered.push(accession);
  }
  return {
    fresh,
    latestNew: fresh.filter(filing => !filing.amendsAccession).map(filing => filing.accession),
    nextSeen: nextSeenOrdered.slice(-ALERT_EVALUATION_LIMITS.maxSeenAccessions),
    rebaseline,
    engineVersion: rebaseline && !input.complete ? input.previousEngineVersion : current,
  };
}

// ── Hit rows ─────────────────────────────────────────────────────────────────

export interface AlertHitWrite {
  accession: string;
  cik: string;
  company: string;
  form: string;
  filed_at: string | null;
  period_ending: string | null;
  document: string;
  section_path: string;
  passage: string;
  passage_basis: 'validated-text' | 'not-read';
  is_amendment: boolean;
  amends_accession: string | null;
}

/** The rows to store: new filings before amendments, newest first, at most 100. */
export function buildAlertHitWrites(
  fresh: AlertDiff['fresh'],
  validatedText: boolean,
  cap: number = ALERT_EVALUATION_LIMITS.maxStoredHitsPerCheck
): AlertHitWrite[] {
  return [...fresh]
    .sort((a, b) => {
      if (Boolean(a.amendsAccession) !== Boolean(b.amendsAccession)) return a.amendsAccession ? 1 : -1;
      return (b.fileDate || '').localeCompare(a.fileDate || '') || a.accession.localeCompare(b.accession);
    })
    .slice(0, Math.max(0, cap))
    .map(filing => ({
      accession: filing.accession,
      cik: filing.cik,
      company: filing.company.slice(0, 300),
      form: filing.form.slice(0, 40),
      filed_at: filing.fileDate || null,
      period_ending: filing.periodEnding,
      document: filing.document,
      section_path: filing.sectionPath.slice(0, 500),
      passage: validatedText ? boundPassage(filing.passage) : '',
      passage_basis: validatedText ? 'validated-text' : 'not-read',
      is_amendment: Boolean(filing.amendsAccession),
      amends_accession: filing.amendsAccession,
    }));
}

// ── Coverage ─────────────────────────────────────────────────────────────────

/** Stored as last_check_coverage. Carries the executor's coverage fields, so
 *  the Dashboard's existing coverage display reads it unchanged. */
export interface AlertCheckCoverage extends CandidateCoverageNotice {
  source: 'server';
  checkedAt: string;
  engineVersion: number;
  windowFrom: string;
  windowTo: string;
  windowBasis: AlertWindowBasis;
  /** Why the check is not complete; null when complete. */
  reason: string | null;
  matchedFilings: number;
  newFilings: number;
  amendments: number;
  storedHits: number;
  rebaseline: boolean;
  passageBasis: 'validated-text' | 'not-read';
}

/** Why a check's window was not examined completely, from its cursor. */
export function describeIncompleteCheck(
  cursor: ResumableWaveCursor<unknown>,
  options: { aborted: boolean }
): string {
  if (options.aborted) return 'The check reached its time limit before every candidate was read; the unexamined part of the window is carried into the next check.';
  if (cursor.lanes.some(lane => lane.windowCapped)) {
    return 'EDGAR full-text search serves at most 10,000 results per query; narrow the alert (forms, issuer) to reach the rest.';
  }
  if (cursor.lanes.some(lane => lane.consecutiveErrors > 0 && !isLaneFinished(lane))) {
    return 'EDGAR full-text search failed for a retrieval lane; the window is carried into the next check.';
  }
  if (cursor.totals.unvalidatedFailures > 0) {
    return `${cursor.totals.unvalidatedFailures.toLocaleString()} candidate filing${cursor.totals.unvalidatedFailures === 1 ? '' : 's'} could not be read, so they were neither matched nor excluded.`;
  }
  return 'The check reached its per-check budget (documents, pages or 45 seconds) before every candidate was read; the unexamined part of the window is carried into the next check.';
}

/** Coverage for a check that could not run the search at all. */
export function unevaluableCoverage(
  window: AlertEvaluationWindow,
  reason: string,
  checkedAt: Date
): AlertCheckCoverage {
  return {
    source: 'server',
    checkedAt: checkedAt.toISOString(),
    engineVersion: ALERT_ENGINE_VERSION,
    windowFrom: window.dateFrom,
    windowTo: window.dateTo,
    windowBasis: window.basis,
    reason,
    complete: false,
    examined: 0,
    upstreamTotal: 0,
    matchedFilings: 0,
    newFilings: 0,
    amendments: 0,
    storedHits: 0,
    rebaseline: false,
    passageBasis: 'not-read',
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface AlertCheckRecord {
  alertId: string;
  leaseToken: string;
  lastHitCount: number;
  seen: string[];
  latestNew: string[];
  engineVersion: number | null;
  coverage: AlertCheckCoverage;
  hits: AlertHitWrite[];
}

export interface AlertEvaluationStore {
  priorOriginals(alertId: string, leaseToken: string, ciks: string[]): Promise<PriorAlertHit[]>;
  record(input: AlertCheckRecord): Promise<{ inserted: number } | 'lease-lost'>;
  release(alertId: string, leaseToken: string): Promise<void>;
}

export interface EvaluateAlertDeps<TSignal extends WaveFilingSignal> {
  store: AlertEvaluationStore;
  clients: WaveExecutionClients<FilingResearchResult, TSignal>;
  isExhibitDocumentType: (documentType: string) => boolean;
  signal?: AbortSignal;
  now?: () => number;
}

export type AlertEvaluationOutcome =
  | { kind: 'checked'; alertId: string; clientKey: string; complete: boolean; newFilings: number; storedHits: number; reason: string | null }
  | { kind: 'unevaluable'; alertId: string; clientKey: string; reason: string }
  | { kind: 'failed'; alertId: string; clientKey: string; reason: string }
  | { kind: 'lease-lost'; alertId: string; clientKey: string };

/** The EDGAR period of report, kept from the full-text hit (mapSearchHit drops it). */
function capturePeriods<TSignal extends WaveFilingSignal>(
  clients: WaveExecutionClients<FilingResearchResult, TSignal>,
  periods: Map<string, string>
): WaveExecutionClients<FilingResearchResult, TSignal> {
  return {
    ...clients,
    mapSearchHit: hit => {
      const result = clients.mapSearchHit(hit);
      const period = (hit._source as Record<string, unknown> | undefined)?.period_ending;
      if (typeof period === 'string' && ISO_DATE.test(period) && result.accessionNumber) {
        periods.set(result.accessionNumber, period);
      }
      return result;
    },
  };
}

/**
 * Check one claimed alert with exactly one bounded wave, then record the
 * check atomically. A search that cannot run (invalid plan, filter-only) is
 * recorded as an incomplete check with its reason, the seen-set untouched; a
 * failure of the wave itself is recorded the same way, so a broken alert is
 * not re-claimed every tick and the window it missed is carried forward.
 */
export async function evaluateClaimedAlert<TSignal extends WaveFilingSignal>(
  alert: ClaimedAlert,
  deps: EvaluateAlertDeps<TSignal>
): Promise<AlertEvaluationOutcome> {
  const now = deps.now ?? Date.now;
  const window = resolveEvaluationWindow(alert, now());
  const base = { alertId: alert.id, clientKey: alert.clientKey };

  const recordWithoutSearch = async (reason: string, complete: boolean): Promise<AlertEvaluationOutcome> => {
    // An empty window (the alert's own dates exclude it) is a complete check
    // of nothing; anything else that prevents the search is incomplete.
    const coverage = complete
      ? { ...unevaluableCoverage(window, '', new Date(now())), complete: true, reason: null }
      : unevaluableCoverage(window, reason, new Date(now()));
    const recorded = await deps.store.record({
      alertId: alert.id,
      leaseToken: alert.leaseToken,
      lastHitCount: 0,
      seen: alert.lastSeenAccessions.slice(-ALERT_EVALUATION_LIMITS.maxSeenAccessions),
      latestNew: [],
      engineVersion: alert.engineVersion,
      coverage,
      hits: [],
    });
    if (recorded === 'lease-lost') return { kind: 'lease-lost', ...base };
    return complete
      ? { kind: 'checked', ...base, complete: true, newFilings: 0, storedHits: 0, reason: null }
      : { kind: 'unevaluable', ...base, reason };
  };

  if (window.empty) return recordWithoutSearch('', true);

  const compilation = compileAlertSearch(alert, window);
  if (!compilation.ok) return recordWithoutSearch(compilation.reason, false);
  const { compiled, input } = compilation;

  const periods = new Map<string, string>();
  const policy = buildWaveExecutionPolicy(compiled.delegatedToEfts, compiled.requiredBooleanBranches);
  let wave: Awaited<ReturnType<typeof runResumableWave<FilingResearchResult, TSignal>>>;
  try {
    wave = await runResumableWave<FilingResearchResult, TSignal>({
      cursor: createResumableCursor<FilingResearchResult>(compiled.filteredServerQueries, compiled.requiredBooleanBranches),
      search: searchJobContext(compiled, input),
      policy,
      clients: capturePeriods(deps.clients, periods),
      maxExamined: ALERT_EVALUATION_LIMITS.maxExaminedPerCheck,
      perQueryResultLimit: compiled.perQueryResultLimit,
      signal: deps.signal,
    });
  } catch (error) {
    const reason = `The check failed: ${error instanceof Error ? error.message : 'unknown error'}. The window is carried into the next check.`;
    const recorded = await deps.store.record({
      alertId: alert.id,
      leaseToken: alert.leaseToken,
      lastHitCount: 0,
      seen: alert.lastSeenAccessions.slice(-ALERT_EVALUATION_LIMITS.maxSeenAccessions),
      latestNew: [],
      engineVersion: alert.engineVersion,
      coverage: unevaluableCoverage(window, reason, new Date(now())),
      hits: [],
    });
    return recorded === 'lease-lost' ? { kind: 'lease-lost', ...base } : { kind: 'failed', ...base, reason };
  }

  const aborted = Boolean(deps.signal?.aborted);
  const filings = rollUpAlertFilings(wave.matches, deps.isExhibitDocumentType, periods);
  const lanesFinished = wave.cursor.lanes.every(isLaneFinished);
  const executorCoverage = buildSearchJobCoverage(wave.cursor, {
    stoppedEarly: !lanesFinished,
    cancelled: aborted,
    verifiedFilings: filings.length,
    perWavePolicy: policy,
  });
  const complete = executorCoverage.complete && lanesFinished && !aborted;

  const amendmentCiks = Array.from(new Set(filings.filter(filing => amendedBaseForm(filing.form)).map(filing => filing.cik)));
  const priorOriginals = amendmentCiks.length > 0
    ? await deps.store.priorOriginals(alert.id, alert.leaseToken, amendmentCiks)
    : [];

  const diff = diffAlertFilings({
    filings,
    lastSeenAccessions: alert.lastSeenAccessions,
    lastCheckedAt: alert.lastCheckedAt,
    previousEngineVersion: alert.engineVersion,
    complete,
    priorOriginals,
  });
  const validatedText = passageIsValidated(compiled);
  const hits = buildAlertHitWrites(diff.fresh, validatedText);
  const reason = complete ? null : describeIncompleteCheck(wave.cursor, { aborted });

  const coverage: AlertCheckCoverage = {
    ...executorCoverage,
    complete,
    source: 'server',
    checkedAt: new Date(now()).toISOString(),
    engineVersion: ALERT_ENGINE_VERSION,
    windowFrom: window.dateFrom,
    windowTo: window.dateTo,
    windowBasis: window.basis,
    reason,
    matchedFilings: filings.length,
    newFilings: diff.latestNew.length,
    amendments: diff.fresh.filter(filing => filing.amendsAccession).length,
    storedHits: hits.length,
    rebaseline: diff.rebaseline,
    passageBasis: validatedText ? 'validated-text' : 'not-read',
  };

  const recorded = await deps.store.record({
    alertId: alert.id,
    leaseToken: alert.leaseToken,
    lastHitCount: filings.length,
    seen: diff.nextSeen,
    latestNew: diff.latestNew.slice(-ALERT_EVALUATION_LIMITS.maxSeenAccessions),
    engineVersion: diff.engineVersion,
    coverage,
    hits,
  });
  if (recorded === 'lease-lost') return { kind: 'lease-lost', ...base };
  return { kind: 'checked', ...base, complete, newFilings: diff.latestNew.length, storedHits: hits.length, reason };
}

// ── One scheduled pass ───────────────────────────────────────────────────────

export interface AlertPassDeps<TOutcome> {
  /** Claim the next due alert, or null when none is due. */
  claim: () => Promise<ClaimedAlert | null>;
  /** Check one claimed alert; 'busy' when deployment capacity was full (the
   *  alert's lease was handed back and the pass should stop). */
  evaluate: (alert: ClaimedAlert) => Promise<TOutcome | 'busy'>;
  now?: () => number;
  maxAlerts?: number;
  budgetMs?: number;
  parallelism?: number;
}

export interface AlertPassResult<TOutcome> {
  outcomes: TOutcome[];
  claimed: number;
  stoppedBy: 'no-due-alerts' | 'alert-cap' | 'time-budget' | 'capacity';
}

/**
 * Claim and check due alerts until none is due, 25 were claimed, 50 seconds
 * have passed, or deployment capacity is full — whichever comes first. The
 * next scheduled tick continues where this one stopped (the claim always
 * takes the stalest due alert).
 */
export async function runAlertEvaluationPass<TOutcome>(deps: AlertPassDeps<TOutcome>): Promise<AlertPassResult<TOutcome>> {
  const now = deps.now ?? Date.now;
  const maxAlerts = deps.maxAlerts ?? ALERT_EVALUATION_LIMITS.maxAlertsPerRun;
  const budgetMs = deps.budgetMs ?? ALERT_EVALUATION_LIMITS.runBudgetMs;
  const parallelism = Math.max(1, deps.parallelism ?? ALERT_EVALUATION_LIMITS.parallelism);
  const startedAt = now();
  const outcomes: TOutcome[] = [];
  let claimed = 0;
  let stoppedBy: AlertPassResult<TOutcome>['stoppedBy'] | null = null;

  const stop = (reason: NonNullable<typeof stoppedBy>) => { if (!stoppedBy) stoppedBy = reason; };

  const worker = async () => {
    while (!stoppedBy) {
      if (claimed >= maxAlerts) { stop('alert-cap'); return; }
      if (now() - startedAt >= budgetMs) { stop('time-budget'); return; }
      claimed += 1;
      const alert = await deps.claim();
      if (!alert) {
        claimed -= 1;
        stop('no-due-alerts');
        return;
      }
      const outcome = await deps.evaluate(alert);
      if (outcome === 'busy') {
        stop('capacity');
        return;
      }
      outcomes.push(outcome);
    }
  };

  await Promise.all(Array.from({ length: parallelism }, () => worker()));
  return { outcomes, claimed, stoppedBy: stoppedBy ?? 'no-due-alerts' };
}
