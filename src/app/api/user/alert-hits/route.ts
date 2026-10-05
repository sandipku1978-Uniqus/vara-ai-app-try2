/**
 * /api/user/alert-hits — the signed-in identity's alert hits (migration 029).
 * GET pages hits (unseen first), PUT marks hits seen.
 * Identity comes from the Clerk session only; see lib/user-data-alert-hits.ts.
 */

import { requireApiAccess } from '../../../../lib/api-auth';
import { handleAlertHitsRequest } from '../../../../lib/user-data-alert-hits';
import { withRouteObservability } from '../../../../lib/route-observability';

/** Platform budget (seconds): 10 s bounded body read + one RPC under the 25 s web-client HTTP deadline. */
export const maxDuration = 45;

async function handle(request: Request): Promise<Response> {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  return handleAlertHitsRequest(request, access.identity);
}

export const GET = withRouteObservability('user/alert-hits', handle);
export const PUT = withRouteObservability('user/alert-hits', handle);
