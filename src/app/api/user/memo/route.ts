/**
 * /api/user/memo — the signed-in identity's saved memo (migration 026).
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
  return handleUserDataRequest('memo', request, access.identity);
}

export const GET = withRouteObservability('user/memo', handle);
export const PUT = withRouteObservability('user/memo', handle);
export const DELETE = withRouteObservability('user/memo', handle);
