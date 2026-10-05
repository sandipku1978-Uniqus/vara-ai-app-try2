/**
 * /api/search-jobs/[id] — one job's status and one page of its verified
 * filings (GET), or cancel it (POST {"action":"cancel"}).
 *
 * Hits are paged on the server, newest filing first with a stable tie-break,
 * so a job's answer can grow far past the 500-row on-screen cap without the
 * browser ever holding more than one page.
 */

import { requireApiAccess } from '../../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { withRouteObservability } from '../../../../lib/route-observability';
import { SEARCH_JOB_LIMITS } from '../../../../services/searchJobs';
import { isJobId, jsonError, jsonResponse, readJsonBody, searchJobStore, STORE_UNAVAILABLE } from '../_server/http';

/** Platform budget (seconds). Two writer RPCs under a 15 s HTTP deadline each. */
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function handleGet(request: Request, context?: RouteContext) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'search-jobs-read', userLimit: 600 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const id = (await context?.params)?.id;
  if (!isJobId(id)) return jsonError(400, 'Unknown search job.');
  const params = new URL(request.url).searchParams;
  const offset = Math.min(Math.max(Math.trunc(Number(params.get('offset')) || 0), 0), 100_000);
  const limit = Math.min(
    Math.max(Math.trunc(Number(params.get('limit')) || SEARCH_JOB_LIMITS.hitsPageSize), 1),
    SEARCH_JOB_LIMITS.maxHitsPageSize
  );

  const store = searchJobStore();
  if (!store) return jsonError(503, STORE_UNAVAILABLE);
  try {
    const [job, page] = await Promise.all([
      store.get(access.identity.userId, id),
      store.hitsPage(access.identity.userId, id, offset, limit),
    ]);
    // Another user's job and a missing job are indistinguishable by design.
    if (!job) return jsonError(404, 'Unknown search job.');
    return jsonResponse({
      ok: true,
      job,
      hits: { total: page?.total ?? job.verified, offset, limit, items: page?.hits ?? [] },
    });
  } catch (error) {
    console.error('[search-jobs] read failed:', error);
    return jsonError(502, 'The search job could not be loaded.');
  }
}

async function handlePost(request: Request, context?: RouteContext) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'search-jobs-create', userLimit: 20 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const id = (await context?.params)?.id;
  if (!isJobId(id)) return jsonError(400, 'Unknown search job.');
  const body = await readJsonBody(request, 1_000);
  if (body instanceof Response) return body;
  if ((body as { action?: unknown })?.action !== 'cancel') return jsonError(400, 'Supported action: cancel.');

  const store = searchJobStore();
  if (!store) return jsonError(503, STORE_UNAVAILABLE);
  try {
    const job = await store.cancel(access.identity.userId, id);
    if (!job) return jsonError(404, 'Unknown search job.');
    return jsonResponse({ ok: true, job });
  } catch (error) {
    console.error('[search-jobs] cancel failed:', error);
    return jsonError(502, 'The search job could not be cancelled.');
  }
}

// Next passes the params context to every call of a dynamic route; the
// wrapper's optional context parameter is narrowed back to that contract.
type DynamicRouteHandler = (request: Request, context: RouteContext) => Promise<Response>;
export const GET = withRouteObservability('search-jobs/[id]', handleGet) as DynamicRouteHandler;
export const POST = withRouteObservability('search-jobs/[id]', handlePost) as DynamicRouteHandler;
