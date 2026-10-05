/**
 * /api/search-jobs — the signed-in user's search continuation jobs.
 *
 * POST creates a job for a search whose browser run ended with partial
 * coverage; GET lists the user's recent jobs (the Dashboard card). A user has
 * at most one running job — the database enforces it — and a second POST
 * answers 409 with the running job so the client can attach to it.
 */

import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { withRouteObservability } from '../../../lib/route-observability';
import {
  compileSearchJobPlan,
  createSearchJobCursor,
  parseSearchJobPlanInput,
  SEARCH_JOB_LIMITS,
} from '../../../services/searchJobs';
import { jsonError, jsonResponse, readJsonBody, searchJobStore, STORE_UNAVAILABLE } from './_server/http';

/** Platform budget (seconds). One or two writer RPCs under a 15 s HTTP deadline each. */
export const maxDuration = 30;

async function handleGet(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'search-jobs-read', userLimit: 600 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const store = searchJobStore();
  if (!store) return jsonError(503, STORE_UNAVAILABLE);
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 10, 1), 50);
  try {
    const jobs = await store.list(access.identity.userId, limit);
    return jsonResponse({ ok: true, jobs });
  } catch (error) {
    console.error('[search-jobs] list failed:', error);
    return jsonError(502, 'Search jobs could not be loaded.');
  }
}

async function handlePost(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'search-jobs-create', userLimit: 20 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await readJsonBody(request, 32_000);
  if (body instanceof Response) return body;
  const input = parseSearchJobPlanInput((body as { search?: unknown })?.search);
  if (!input) return jsonError(400, 'Provide the resolved search: query, mode, filters, defaultForms, includeExhibits, hydrateTextSignals.');

  const today = new Date().toISOString().slice(0, 10);
  const compiled = compileSearchJobPlan(input, today);
  if (!compiled.ok) return jsonError(422, compiled.message, { code: compiled.code });

  const store = searchJobStore();
  if (!store) return jsonError(503, STORE_UNAVAILABLE);
  try {
    const outcome = await store.create({
      ownerUserId: access.identity.userId,
      orgId: access.identity.orgId,
      plan: compiled.plan,
      cursor: createSearchJobCursor(compiled.plan),
      ttlSeconds: SEARCH_JOB_LIMITS.ttlSeconds,
    });
    if (outcome.status === 'active-job-exists') {
      return jsonError(409, 'You already have a search being validated. Cancel it or wait for it to finish.', {
        code: 'active-job-exists',
        job: outcome.job,
      });
    }
    return jsonResponse({ ok: true, job: outcome.job }, 201);
  } catch (error) {
    console.error('[search-jobs] create failed:', error);
    return jsonError(502, 'The search job could not be created.');
  }
}

export const GET = withRouteObservability('search-jobs', handleGet);
export const POST = withRouteObservability('search-jobs', handlePost);
