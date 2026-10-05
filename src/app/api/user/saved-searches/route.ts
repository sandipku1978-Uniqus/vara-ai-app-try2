/**
 * /api/user/saved-searches — the signed-in identity's saved saved-searches (migration 026).
 * GET lists, PUT upserts { items } by clientKey, DELETE removes { clientKeys }.
 * Identity comes from the Clerk session only; see lib/user-data-route.ts.
 */

import { requireApiAccess } from '../../../../lib/api-auth';
import { handleUserDataRequest } from '../../../../lib/user-data-route';
import { withRouteObservability } from '../../../../lib/route-observability';

/** Platform budget (seconds): 10 s bounded body read + one RPC under the 25 s web-client HTTP deadline. */
export const maxDuration = 45;

async function handle(request: Request): Promise<Response> {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  return handleUserDataRequest('saved-searches', request, access.identity);
}

export const GET = withRouteObservability('user/saved-searches', handle);
export const PUT = withRouteObservability('user/saved-searches', handle);
export const DELETE = withRouteObservability('user/saved-searches', handle);
