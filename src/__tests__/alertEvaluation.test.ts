import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilingResearchResult } from '../services/filingResearch';
import type { ResumableWaveCursor } from '../services/filingResearchExecution';

const wave = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock('../services/filingResearchExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/filingResearchExecution')>();
  return { ...actual, runResumableWave: (...args: unknown[]) => wave.run(...args) };
});

import {
  ALERT_ENGINE_VERSION,
  ALERT_EVALUATION_LIMITS,
  amendedBaseForm,
  boundPassage,
  buildAlertHitWrites,
  compileAlertSearch,
  detectAmendments,
  diffAlertFilings,
  evaluateClaimedAlert,
  isAlertDue,
  parseClaimedAlert,
  resolveEvaluationWindow,
  runAlertEvaluationPass,
  selectDueAlerts,
  type AlertCheckRecord,
  type AlertFiling,
  type ClaimedAlert,
} from '../services/alertEvaluation';
import { defaultSearchFilters } from '../domain/searchFilters';

const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function filing(overrides: Partial<AlertFiling> = {}): AlertFiling {
  return {
    accession: '0000320193-26-000001',
    cik: '320193',
    company: 'Apple Inc.',
    form: '10-K',
    fileDate: '2026-10-03',
    periodEnding: '2026-09-27',
    document: 'aapl-2026.htm',
    sectionPath: 'Item 9A · Controls and Procedures',
    passage: 'Management identified a material weakness in internal control.',
    ...overrides,
  };
}

function claimed(overrides: Partial<ClaimedAlert> = {}): ClaimedAlert {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    ownerUserId: 'user_1',
    orgId: null,
    clientKey: 'alert-1',
    name: 'Material weakness',
    query: '"material weakness"',
    mode: 'boolean',
    filters: { ...defaultSearchFilters, formTypes: ['10-K'] } as unknown as Record<string, unknown>,
    defaultForms: '10-K,10-K/A',
    cadence: 'daily',
    enabled: true,
    lastCheckedAt: '2026-10-03T10:00:00.000Z',
    lastSeenAccessions: [],
    engineVersion: ALERT_ENGINE_VERSION,
    lastCheckCoverage: null,
    leaseToken: '00000000-0000-4000-8000-0000000000b2',
    ...overrides,
  };
}

describe('due selection', () => {
  it('treats daily alerts as due after 20 hours and weekly after 6 days', () => {
    expect(isAlertDue({ enabled: true, cadence: 'daily', lastCheckedAt: new Date(NOW - 19 * HOUR).toISOString() }, NOW)).toBe(false);
    expect(isAlertDue({ enabled: true, cadence: 'daily', lastCheckedAt: new Date(NOW - 20 * HOUR).toISOString() }, NOW)).toBe(true);
    expect(isAlertDue({ enabled: true, cadence: 'weekly', lastCheckedAt: new Date(NOW - 5 * 24 * HOUR).toISOString() }, NOW)).toBe(false);
    expect(isAlertDue({ enabled: true, cadence: 'weekly', lastCheckedAt: new Date(NOW - 6 * 24 * HOUR).toISOString() }, NOW)).toBe(true);
  });

  it('checks never-checked alerts first and never checks disabled ones', () => {
    const alerts = [
      { id: 'old', enabled: true, cadence: 'daily' as const, lastCheckedAt: new Date(NOW - 50 * HOUR).toISOString() },
      { id: 'never', enabled: true, cadence: 'weekly' as const, lastCheckedAt: null },
      { id: 'older', enabled: true, cadence: 'daily' as const, lastCheckedAt: new Date(NOW - 90 * HOUR).toISOString() },
      { id: 'fresh', enabled: true, cadence: 'daily' as const, lastCheckedAt: new Date(NOW - HOUR).toISOString() },
      { id: 'off', enabled: false, cadence: 'daily' as const, lastCheckedAt: null },
    ];
    expect(selectDueAlerts(alerts, NOW).map(alert => alert.id)).toEqual(['never', 'older', 'old']);
    expect(selectDueAlerts(alerts, NOW, 2).map(alert => alert.id)).toEqual(['never', 'older']);
  });

  it('keeps the SQL claim on the same thresholds and order', () => {
    const sql = readFileSync(resolve(process.cwd(), 'db', 'migrations', '029_alert_hits_and_scheduled_evaluation.sql'), 'utf8');
    const claim = sql.slice(sql.indexOf('function public.urc_alert_eval_claim('));
    expect(claim).toContain("a.cadence = 'daily' and a.last_checked_at <= now() - v_daily");
    expect(claim).toContain("a.cadence = 'weekly' and a.last_checked_at <= now() - v_weekly");
    expect(claim).toContain('order by a.last_checked_at nulls first');
    expect(claim).toContain('for update skip locked');
    expect(ALERT_EVALUATION_LIMITS.dailyAfterMs).toBe(20 * HOUR);
    expect(ALERT_EVALUATION_LIMITS.weeklyAfterMs).toBe(6 * 24 * HOUR);
  });
});

describe('evaluation window', () => {
  it('searches since the last check, or the last 30 days on the first check', () => {
    expect(resolveEvaluationWindow({ lastCheckedAt: '2026-10-03T10:00:00Z', lastCheckCoverage: null, filters: {} }, NOW))
      .toEqual({ dateFrom: '2026-10-03', dateTo: '2026-10-04', basis: 'since-last-check', empty: false });
    expect(resolveEvaluationWindow({ lastCheckedAt: null, lastCheckCoverage: null, filters: {} }, NOW))
      .toEqual({ dateFrom: '2026-09-04', dateTo: '2026-10-04', basis: 'first-run', empty: false });
  });

  it('carries an incomplete window forward instead of skipping it', () => {
    const window = resolveEvaluationWindow({
      lastCheckedAt: '2026-10-03T10:00:00Z',
      lastCheckCoverage: { source: 'server', complete: false, windowFrom: '2026-09-28' },
      filters: {},
    }, NOW);
    expect(window).toMatchObject({ dateFrom: '2026-09-28', basis: 'carried-from-partial' });
    const capped = resolveEvaluationWindow({
      lastCheckedAt: '2026-10-03T10:00:00Z',
      lastCheckCoverage: { source: 'server', complete: false, windowFrom: '2026-01-01' },
      filters: {},
    }, NOW);
    expect(capped).toMatchObject({ dateFrom: '2026-09-04', basis: 'lookback-capped' });
  });

  it('still honours the alert’s own dates', () => {
    expect(resolveEvaluationWindow({ lastCheckedAt: null, lastCheckCoverage: null, filters: { dateFrom: '2026-10-01' } }, NOW).dateFrom).toBe('2026-10-01');
    expect(resolveEvaluationWindow({ lastCheckedAt: null, lastCheckCoverage: null, filters: { dateTo: '2025-12-31' } }, NOW).empty).toBe(true);
  });
});

describe('new-versus-seen and amendments', () => {
  it('reports only filings missing from the seen-set and extends it', () => {
    const diff = diffAlertFilings({
      filings: [filing(), filing({ accession: '0000789019-26-000002', cik: '789019', company: 'Microsoft' })],
      lastSeenAccessions: ['0000320193-26-000001'],
      lastCheckedAt: '2026-10-03T10:00:00Z',
      previousEngineVersion: ALERT_ENGINE_VERSION,
      complete: true,
      priorOriginals: [],
    });
    expect(diff.fresh.map(item => item.accession)).toEqual(['0000789019-26-000002']);
    expect(diff.latestNew).toEqual(['0000789019-26-000002']);
    expect(diff.nextSeen).toEqual(['0000320193-26-000001', '0000789019-26-000002']);
    expect(diff.rebaseline).toBe(false);
    expect(diff.engineVersion).toBe(ALERT_ENGINE_VERSION);
  });

  it('caps the seen-set at 5,000, dropping the oldest', () => {
    const seen = Array.from({ length: 5000 }, (_, index) => `0000000001-26-${String(index).padStart(6, '0')}`);
    const diff = diffAlertFilings({
      filings: [filing()],
      lastSeenAccessions: seen,
      lastCheckedAt: '2026-10-03T10:00:00Z',
      previousEngineVersion: ALERT_ENGINE_VERSION,
      complete: true,
      priorOriginals: [],
    });
    expect(diff.nextSeen).toHaveLength(5000);
    expect(diff.nextSeen[0]).toBe(seen[1]);
    expect(diff.nextSeen.at(-1)).toBe('0000320193-26-000001');
  });

  it('re-baselines after an engine change, keeping the old marker until a complete check', () => {
    const partial = diffAlertFilings({
      filings: [filing()],
      lastSeenAccessions: [],
      lastCheckedAt: '2026-10-03T10:00:00Z',
      previousEngineVersion: ALERT_ENGINE_VERSION - 1,
      complete: false,
      priorOriginals: [],
    });
    expect(partial.rebaseline).toBe(true);
    expect(partial.fresh).toEqual([]);
    expect(partial.nextSeen).toEqual(['0000320193-26-000001']);
    expect(partial.engineVersion).toBe(ALERT_ENGINE_VERSION - 1);
    const complete = diffAlertFilings({
      filings: [filing()],
      lastSeenAccessions: [],
      lastCheckedAt: '2026-10-03T10:00:00Z',
      previousEngineVersion: ALERT_ENGINE_VERSION - 1,
      complete: true,
      priorOriginals: [],
    });
    expect(complete.engineVersion).toBe(ALERT_ENGINE_VERSION);
  });

  it('does not re-baseline the very first check', () => {
    const diff = diffAlertFilings({
      filings: [filing()],
      lastSeenAccessions: [],
      lastCheckedAt: null,
      previousEngineVersion: null,
      complete: true,
      priorOriginals: [],
    });
    expect(diff.rebaseline).toBe(false);
    expect(diff.latestNew).toEqual(['0000320193-26-000001']);
  });

  it('marks a 10-K/A of an already surfaced 10-K for the same period as an amendment, not a new hit', () => {
    expect(amendedBaseForm('10-K/A')).toBe('10-K');
    expect(amendedBaseForm('10-K')).toBeNull();
    const amendment = filing({ accession: '0000320193-26-000009', form: '10-K/A', fileDate: '2026-10-04' });
    const diff = diffAlertFilings({
      filings: [amendment],
      lastSeenAccessions: ['0000320193-26-000001'],
      lastCheckedAt: '2026-10-03T10:00:00Z',
      previousEngineVersion: ALERT_ENGINE_VERSION,
      complete: true,
      priorOriginals: [{ accession: '0000320193-26-000001', cik: '320193', form: '10-K', periodEnding: '2026-09-27' }],
    });
    expect(diff.fresh).toEqual([expect.objectContaining({ accession: '0000320193-26-000009', amendsAccession: '0000320193-26-000001' })]);
    expect(diff.latestNew).toEqual([]);
  });

  it('pairs within one check, and never across periods, issuers or without a period', () => {
    const original = filing();
    const sameRunAmendment = filing({ accession: '0000320193-26-000009', form: '10-K/A' });
    const otherPeriod = filing({ accession: '0000320193-26-000010', form: '10-K/A', periodEnding: '2025-09-28' });
    const otherIssuer = filing({ accession: '0000789019-26-000011', cik: '789019', form: '10-K/A' });
    const noPeriod = filing({ accession: '0000320193-26-000012', form: '10-K/A', periodEnding: null });
    const amends = detectAmendments([original, sameRunAmendment, otherPeriod, otherIssuer, noPeriod], []);
    expect([...amends.entries()]).toEqual([['0000320193-26-000009', '0000320193-26-000001']]);
  });
});

describe('hit rows', () => {
  it('stores at most 100 per check, new filings before amendments, newest first', () => {
    const fresh = Array.from({ length: 120 }, (_, index) => ({
      ...filing({ accession: `0000320193-26-${String(index).padStart(6, '0')}`, fileDate: `2026-09-${String((index % 28) + 1).padStart(2, '0')}` }),
      amendsAccession: index === 0 ? '0000320193-25-000001' : null,
    }));
    const rows = buildAlertHitWrites(fresh, true);
    expect(rows).toHaveLength(100);
    expect(rows.every(row => !row.is_amendment)).toBe(true);
    expect(rows[0].filed_at! >= rows[99].filed_at!).toBe(true);
  });

  it('quotes only text the validator read, bounded to 1,200 characters', () => {
    const long = 'word '.repeat(600);
    const [validated] = buildAlertHitWrites([{ ...filing({ passage: long }), amendsAccession: null }], true);
    expect(validated.passage.length).toBeLessThanOrEqual(1200);
    expect(validated.passage_basis).toBe('validated-text');
    const [unread] = buildAlertHitWrites([{ ...filing(), amendsAccession: null }], false);
    expect(unread).toMatchObject({ passage: '', passage_basis: 'not-read' });
    expect(boundPassage('short  text')).toBe('short text');
  });
});

describe('claimed alert parsing', () => {
  it('accepts the claim RPC shape and rejects a missing lease', () => {
    expect(parseClaimedAlert({ ...claimed(), filters: { formTypes: ['10-K'] } })).toMatchObject({ clientKey: 'alert-1', cadence: 'daily' });
    expect(parseClaimedAlert({ ...claimed(), leaseToken: 'nope' })).toBeNull();
    expect(parseClaimedAlert({ ...claimed(), mode: 'regex' })).toBeNull();
  });
});

describe('compiling the alert search', () => {
  it('refuses a filter-only alert the server cannot page', () => {
    const window = resolveEvaluationWindow({ lastCheckedAt: null, lastCheckCoverage: null, filters: {} }, NOW);
    const result = compileAlertSearch({ query: '', mode: 'semantic', filters: { ...defaultSearchFilters, sicCode: '7372' } as unknown as Record<string, unknown>, defaultForms: '10-K' }, window);
    expect(result.ok).toBe(false);
  });

  it('restricts the search to the window', () => {
    const window = resolveEvaluationWindow({ lastCheckedAt: '2026-10-03T10:00:00Z', lastCheckCoverage: null, filters: {} }, NOW);
    const result = compileAlertSearch(claimed(), window);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.filters.dateFrom).toBe('2026-10-03');
      expect(result.input.filters.dateTo).toBe('2026-10-04');
    }
  });
});

function finishedCursor(): ResumableWaveCursor<FilingResearchResult> {
  return {
    version: 1,
    lanes: [{
      query: '"material weakness"',
      required: true,
      nextOffset: 2,
      collectionComplete: true,
      windowCapped: false,
      upstreamTotal: 2,
      upstreamTotalIsFloor: false,
      pending: [],
      consecutiveErrors: 0,
      ledger: { branch: '"material weakness"', required: true, pages: 1, candidatesSurfaced: 2, candidatesNew: 2, examined: 2, matched: 2, exhausted: true },
    }],
    seen: ['a', 'b'],
    retries: {},
    totals: {
      waves: 1, examined: 2, matchedDocuments: 2, unvalidatedFailures: 0, failureKinds: {},
      pageRequests: 1, docFetches: 2, docHttpAttempts: 2, prescreenRequests: 0, elapsedMs: 900,
    },
  };
}

function match(accession: string, overrides: Partial<FilingResearchResult> = {}): FilingResearchResult {
  return {
    id: `${accession}:doc.htm`,
    entityName: 'Apple Inc.',
    companyName: 'Apple Inc.',
    fileDate: '2026-10-03',
    formType: '10-K',
    documentType: '10-K',
    cik: '320193',
    accessionNumber: accession,
    primaryDocument: 'aapl-2026.htm',
    filingPrimaryDocument: 'aapl-2026.htm',
    description: '',
    matchSnippet: 'identified a material weakness',
    matchSectionPath: 'Item 9A',
    matchReason: 'text validated',
    score: 1,
    relevanceScore: 1,
    filingUrl: '',
    tickers: [],
    sic: '', sicDescription: '', exchange: '', stateOfIncorporation: '', fiscalYearEnd: '', headquarters: '',
    fileNumber: '', auditor: '', acceleratedStatus: '',
    ...overrides,
  } as FilingResearchResult;
}

describe('evaluateClaimedAlert', () => {
  const store = {
    priorOriginals: vi.fn(),
    record: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    wave.run.mockReset();
    store.priorOriginals.mockReset().mockResolvedValue([]);
    store.record.mockReset().mockResolvedValue({ inserted: 1 });
  });

  it('records new hits with passages, extends the seen-set and reports complete coverage', async () => {
    wave.run.mockResolvedValue({ cursor: finishedCursor(), matches: [match('0000320193-26-000001'), match('0000320193-26-000002')], work: {} });
    const outcome = await evaluateClaimedAlert(claimed({ lastSeenAccessions: ['0000320193-26-000001'] }), {
      store,
      clients: {} as never,
      isExhibitDocumentType: () => false,
      now: () => NOW,
    });
    expect(outcome).toMatchObject({ kind: 'checked', complete: true, newFilings: 1, storedHits: 1 });
    const record = store.record.mock.calls[0][0] as AlertCheckRecord;
    expect(record.hits).toEqual([expect.objectContaining({
      accession: '0000320193-26-000002', passage: 'identified a material weakness', passage_basis: 'validated-text', section_path: 'Item 9A',
    })]);
    expect(record.seen).toEqual(['0000320193-26-000001', '0000320193-26-000002']);
    expect(record.latestNew).toEqual(['0000320193-26-000002']);
    expect(record.lastHitCount).toBe(2);
    expect(record.coverage).toMatchObject({ source: 'server', complete: true, windowFrom: '2026-10-03', reason: null, newFilings: 1 });
    // The wave searched the window, not the alert's full history.
    const waveInput = wave.run.mock.calls[0][0] as { search: { filters: { dateFrom: string } } };
    expect(waveInput.search.filters.dateFrom).toBe('2026-10-03');
  });

  it('records an incomplete check with its reason and keeps the window for next time', async () => {
    const cursor = finishedCursor();
    cursor.lanes[0].collectionComplete = false;
    cursor.lanes[0].ledger.exhausted = false;
    wave.run.mockResolvedValue({ cursor, matches: [], work: {} });
    const outcome = await evaluateClaimedAlert(claimed(), { store, clients: {} as never, isExhibitDocumentType: () => false, now: () => NOW });
    expect(outcome).toMatchObject({ kind: 'checked', complete: false });
    const record = store.record.mock.calls[0][0] as AlertCheckRecord;
    expect(record.coverage.complete).toBe(false);
    expect(record.coverage.reason).toMatch(/carried into the next check/);
    expect(record.coverage.windowFrom).toBe('2026-10-03');
  });

  it('records an unevaluable alert without touching the seen-set', async () => {
    const outcome = await evaluateClaimedAlert(
      claimed({ query: '', mode: 'semantic', filters: { ...defaultSearchFilters, sicCode: '7372' } as unknown as Record<string, unknown>, lastSeenAccessions: ['0000320193-26-000001'] }),
      { store, clients: {} as never, isExhibitDocumentType: () => false, now: () => NOW },
    );
    expect(outcome.kind).toBe('unevaluable');
    expect(wave.run).not.toHaveBeenCalled();
    const record = store.record.mock.calls[0][0] as AlertCheckRecord;
    expect(record.seen).toEqual(['0000320193-26-000001']);
    expect(record.hits).toEqual([]);
    expect(record.coverage.complete).toBe(false);
  });

  it('reports a lost lease', async () => {
    wave.run.mockResolvedValue({ cursor: finishedCursor(), matches: [], work: {} });
    store.record.mockResolvedValue('lease-lost');
    const outcome = await evaluateClaimedAlert(claimed(), { store, clients: {} as never, isExhibitDocumentType: () => false, now: () => NOW });
    expect(outcome.kind).toBe('lease-lost');
  });
});

describe('one scheduled pass', () => {
  it('stops at 25 alerts', async () => {
    let next = 0;
    const pass = await runAlertEvaluationPass({
      claim: async () => claimed({ clientKey: `alert-${next++}` }),
      evaluate: async alert => alert.clientKey,
      now: () => NOW,
      parallelism: 2,
    });
    expect(pass.claimed).toBe(25);
    expect(pass.outcomes).toHaveLength(25);
    expect(pass.stoppedBy).toBe('alert-cap');
  });

  it('stops claiming once 50 seconds have passed', async () => {
    let clock = NOW;
    const pass = await runAlertEvaluationPass({
      claim: async () => claimed(),
      evaluate: async () => { clock += 20_000; return 'ok'; },
      now: () => clock,
      parallelism: 1,
    });
    expect(pass.outcomes).toHaveLength(3);
    expect(pass.stoppedBy).toBe('time-budget');
  });

  it('stops when nothing is due or capacity is full', async () => {
    const empty = await runAlertEvaluationPass({ claim: async () => null, evaluate: async () => 'ok', now: () => NOW });
    expect(empty).toMatchObject({ claimed: 0, stoppedBy: 'no-due-alerts' });
    const busy = await runAlertEvaluationPass({ claim: async () => claimed(), evaluate: async () => 'busy' as const, now: () => NOW, parallelism: 1 });
    expect(busy).toMatchObject({ claimed: 1, outcomes: [], stoppedBy: 'capacity' });
  });
});
