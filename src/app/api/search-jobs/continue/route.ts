/**
 * /api/search-jobs/continue — the search-job worker.
 *
 * Each invocation advances jobs by bounded waves — the executor's own
 * resumable entry point with the unchanged per-wave policy — and persists
 * cursor and hits atomically. Two triggers share one code path:
 *
 *   GET  — Vercel Cron, every minute (vercel.json), authenticated with
 *          `Authorization: Bearer $CRON_SECRET`. Leases the runnable job that
 *          has waited longest, runs a wave, and repeats while its time budget
 *          allows, so jobs keep moving after the user navigates away.
 *   POST — the job's owner, while the results pane is open: {"jobId"} runs
 *          one wave of that job right away (session-authenticated, owner-
 *          scoped). The pane re-posts when the wave returns.
 *
 * The path is exempt from the session proxy (config/routes PUBLIC_API_PATHS)
 * only so the cron request can reach this handler; both methods authenticate
 * here, and fail closed.
 *
 * Controls: one running job per user (database), one lease per job
 * (database), at most one wave per user and two deployment-wide at a time
 * (resource concurrency), every SEC request through the central pacer, and
 * document fetches through the shared document pool.
 */

import { requireApiAccess } from '../../../../lib/api-auth';
import {
  acquireResourceConcurrency,
  checkResourceRateLimit,
  rateLimitResponse,
  releaseAiConcurrency,
  type RateLimitIdentity,
} from '../../../../lib/rate-limit';
import { withRouteObservability } from '../../../../lib/route-observability';
import { SEARCH_JOB_LIMITS, type SearchJobSummary } from '../../../../services/searchJobs';
import { buildServerWaveClients } from '../_server/clients';
import {
  isAuthorizedCron,
  isJobId,
  jsonError,
  jsonResponse,
  readJsonBody,
  searchJobStore,
  STORE_UNAVAILABLE,
} from '../_server/http';
import type { ClaimedSearchJob, SearchJobStore } from '../_server/store';
import { advanceClaimedSearchJob, type AdvanceSearchJobOutcome } from '../_server/worker';

/** Platform budget (seconds). Cron runs waves back to back until CRON_START_BUDGET_MS; each wave is hard-stopped at WAVE_HARD_DEADLINE_MS and persisted under a 15 s HTTP deadline. */
export const maxDuration = 300;

/** A wave's validation stops at 45 s (policy); collection and slow SEC
 *  responses get the rest. Anything still running then is aborted and the
 *  partial wave is persisted — the cursor stays exact either way. */
const WAVE_HARD_DEADLINE_MS = 110_000;
/** Cron starts no new wave after this, leaving a full wave of headroom. */
const CRON_START_BUDGET_MS = 150_000;
const CRON_MAX_WAVES = 4;

const WAVE_CAPACITY = {
  operation: 'search-job-wave',
  userLimit: 1,
  orgLimit: 3,
  ipLimit: 8,
  globalLimit: 2,
  leaseSeconds: SEARCH_JOB_LIMITS.leaseSeconds,
} as const;

type WaveResult =
  | { kind: 'busy'; job: SearchJobSummary | null }
  | AdvanceSearchJobOutcome;

async function runOneWave(request: Request, store: SearchJobStore, job: ClaimedSearchJob): Promise<WaveResult> {
  const identity: RateLimitIdentity = { userId: job.ownerUserId, orgId: job.orgId };
  const capacity = await acquireResourceConcurrency(request, identity, WAVE_CAPACITY);
  if (!capacity.allowed) {
    // Not a failure of the job: hand the lease back untouched.
    const released = await store.release(job.id, job.leaseToken, 'wave capacity busy', false);
    return { kind: 'busy', job: released === 'lease-lost' ? null : released };
  }
  const deadline = AbortSignal.timeout(WAVE_HARD_DEADLINE_MS);
  try {
    return await advanceClaimedSearchJob(job, {
      store,
      clients: buildServerWaveClients({ request, identity }, deadline),
      signal: deadline,
    });
  } catch (error) {
    // Store or client failure outside the wave itself: release and count it.
    const reason = error instanceof Error ? error.message : 'The worker failed.';
    console.error('[search-jobs] wave failed:', error);
    try {
      const released = await store.release(job.id, job.leaseToken, reason, true);
      return { kind: 'failed', job: released === 'lease-lost' ? null : released, reason };
    } catch {
      return { kind: 'failed', job: null, reason };
    }
  } finally {
    await releaseAiConcurrency(capacity.lease);
  }
}

function describe(result: WaveResult) {
  if (result.kind === 'advanced') return { outcome: 'advanced', jobId: result.job.id, status: result.job.status, newFilings: result.newFilings };
  if (result.kind === 'failed') return { outcome: 'failed', jobId: result.job?.id ?? null, reason: result.reason };
  if (result.kind === 'busy') return { outcome: 'busy', jobId: result.job?.id ?? null };
  return { outcome: 'lease-lost' };
}

async function handleCron(request: Request) {
  if (!isAuthorizedCron(request)) return jsonError(401, 'Unauthorized.');
  const store = searchJobStore();
  if (!store) return jsonError(503, STORE_UNAVAILABLE);

  const startedAt = Date.now();
  const waves: Array<ReturnType<typeof describe>> = [];
  try {
    while (waves.length < CRON_MAX_WAVES && Date.now() - startedAt < CRON_START_BUDGET_MS) {
      const job = await store.claim({ id: null, ownerUserId: null, leaseSeconds: SEARCH_JOB_LIMITS.leaseSeconds });
      if (!job) break;
      const result = await runOneWave(request, store, job);
      waves.push(describe(result));
      // Deployment-wide capacity is full: let the running waves finish.
      if (result.kind === 'busy') break;
    }
  } catch (error) {
    console.error('[search-jobs] cron pass failed:', error);
    return jsonResponse({ ok: false, waves }, 502);
  }
  return jsonResponse({ ok: true, waves });
}

async function handleOwnerWave(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'search-job-wave', userLimit: 30 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await readJsonBody(request, 1_000);
  if (body instanceof Response) return body;
  const jobId = (body as { jobId?: unknown })?.jobId;
  if (!isJobId(jobId)) return jsonError(400, 'Provide the jobId to continue.');

  const store = searchJobStore();
  if (!store) return jsonError(503, STORE_UNAVAILABLE);
  try {
    const job = await store.claim({ id: jobId, ownerUserId: access.identity.userId, leaseSeconds: SEARCH_JOB_LIMITS.leaseSeconds });
    if (!job) {
      // Not running, not the caller's, or a wave is already in flight.
      const current = await store.get(access.identity.userId, jobId);
      if (!current) return jsonError(404, 'Unknown search job.');
      return jsonResponse({ ok: true, advanced: false, job: current });
    }
    const result = await runOneWave(request, store, job);
    const latest = result.kind === 'advanced' ? result.job : await store.get(access.identity.userId, jobId);
    return jsonResponse({ ok: true, advanced: result.kind === 'advanced', wave: describe(result), job: latest });
  } catch (error) {
    console.error('[search-jobs] owner wave failed:', error);
    return jsonError(502, 'The search job could not be advanced.');
  }
}

export const GET = withRouteObservability('search-jobs/continue', handleCron);
export const POST = withRouteObservability('search-jobs/continue', handleOwnerWave);
