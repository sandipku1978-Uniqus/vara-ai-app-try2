/**
 * Advance one claimed search job by exactly one bounded wave.
 *
 * The wave is the executor's own resumable entry point (runResumableWave) —
 * the same collect/validate stages, the same per-wave policy constants, the
 * same fair-share reservations — fed by the worker's server-side clients.
 * Persistence is one atomic RPC: hits, cursor, counters and status land
 * together or not at all, so a crashed worker can never leave hits that the
 * cursor does not account for (the lease simply expires and the wave reruns).
 */

import {
  runResumableWave,
  type WaveExecutionClients,
  type WaveFilingSignal,
} from '../../../../services/filingResearchExecution';
import { filingResearchStages, type FilingResearchResult } from '../../../../services/filingResearch';
import {
  buildSearchJobCoverage,
  decideSearchJobStatus,
  mergeSearchJobHits,
  recompileStoredPlan,
  SEARCH_JOB_LIMITS,
  searchJobContext,
  searchJobPolicy,
  serializeSearchJobCursor,
  type SearchJobSummary,
} from '../../../../services/searchJobs';
import type { ClaimedSearchJob, SearchJobStore } from './store';

export interface AdvanceSearchJobDeps<TSignal extends WaveFilingSignal> {
  store: SearchJobStore;
  clients: WaveExecutionClients<FilingResearchResult, TSignal>;
  now?: () => number;
  signal?: AbortSignal;
}

export type AdvanceSearchJobOutcome =
  | { kind: 'advanced'; job: SearchJobSummary; newFilings: number }
  | { kind: 'failed'; job: SearchJobSummary | null; reason: string }
  | { kind: 'lease-lost' };

function closeWithoutWave(
  job: ClaimedSearchJob,
  store: SearchJobStore,
  reason: string
): Promise<SearchJobSummary | 'lease-lost'> {
  // A plan or cursor that cannot be resumed is a permanent failure: record
  // it once instead of burning three retries on a deterministic error.
  return store.advance({
    id: job.id,
    leaseToken: job.leaseToken,
    cursor: job.cursor ?? serializeSearchJobCursor({
      version: 1,
      lanes: [],
      seen: [],
      retries: {},
      totals: {
        waves: 0, examined: 0, matchedDocuments: 0, unvalidatedFailures: 0, failureKinds: {},
        pageRequests: 0, docFetches: 0, docHttpAttempts: 0, prescreenRequests: 0, elapsedMs: 0,
      },
    }),
    status: 'failed',
    statusReason: reason,
    examined: job.examined,
    upstreamTotal: job.upstreamTotal ?? 0,
    upstreamTotalIsFloor: job.upstreamTotalIsFloor,
    coverage: job.coverage ?? { examined: job.examined, upstreamTotal: job.upstreamTotal ?? 0, complete: false },
    hits: [],
  });
}

export async function advanceClaimedSearchJob<TSignal extends WaveFilingSignal>(
  job: ClaimedSearchJob,
  deps: AdvanceSearchJobDeps<TSignal>
): Promise<AdvanceSearchJobOutcome> {
  const { store } = deps;
  const now = deps.now ?? Date.now;

  const recompiled = recompileStoredPlan(job.plan);
  if (!recompiled.ok || !job.cursor) {
    const reason = !recompiled.ok ? recompiled.reason : 'The stored cursor failed validation; start a new job.';
    const closed = await closeWithoutWave(job, store, reason);
    return closed === 'lease-lost' ? { kind: 'lease-lost' } : { kind: 'failed', job: closed, reason };
  }
  const { compiled } = recompiled;
  const policy = searchJobPolicy(compiled);

  let wave: Awaited<ReturnType<typeof runResumableWave<FilingResearchResult, TSignal>>>;
  try {
    wave = await runResumableWave<FilingResearchResult, TSignal>({
      cursor: job.cursor,
      search: searchJobContext(compiled, job.plan.input),
      policy,
      clients: deps.clients,
      maxExamined: SEARCH_JOB_LIMITS.maxExamined,
      perQueryResultLimit: compiled.perQueryResultLimit,
      signal: deps.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The wave failed.';
    const released = await store.release(job.id, job.leaseToken, reason, true);
    return { kind: 'failed', job: released === 'lease-lost' ? null : released, reason };
  }

  const accessions = Array.from(new Set(wave.matches.map(match => match.accessionNumber)));
  const existing = await store.lookupHits(job.id, job.leaseToken, accessions);
  const known = new Set(existing.map(hit => hit.accessionNumber));
  const merged = mergeSearchJobHits(existing, wave.matches, filingResearchStages.isExhibitDocumentType);
  const newFilings = merged.writes.filter(write => !known.has(write.accession)).length;

  const decision = decideSearchJobStatus(wave.cursor, {
    now: now(),
    expiresAt: Date.parse(job.expiresAt),
  });
  const coverage = buildSearchJobCoverage(wave.cursor, {
    stoppedEarly: decision.status === 'capped' || decision.status === 'expired',
    cancelled: false,
    verifiedFilings: job.verified + newFilings,
    perWavePolicy: policy,
  });

  const persisted = await store.advance({
    id: job.id,
    leaseToken: job.leaseToken,
    cursor: serializeSearchJobCursor(wave.cursor),
    status: decision.status === 'cancelled' ? 'running' : decision.status,
    statusReason: decision.reason,
    examined: wave.cursor.totals.examined,
    upstreamTotal: coverage.upstreamTotal,
    upstreamTotalIsFloor: Boolean(coverage.upstreamTotalIsFloor),
    coverage,
    hits: merged.writes,
  });
  if (persisted === 'lease-lost') return { kind: 'lease-lost' };
  return { kind: 'advanced', job: persisted, newFilings };
}
