/**
 * /api/alerts/evaluate — checks saved alerts while the user is away
 * (gap analysis row 2, recommendation 3).
 *
 *   GET  — Vercel Cron, four times an hour at :07, :22, :37 and :52
 *          (vercel.json), authenticated with
 *          `Authorization: Bearer $CRON_SECRET` exactly as the search-job
 *          worker is. Claims due alerts (daily: >20 h since the last check;
 *          weekly: >6 days), stalest first, and checks each with one bounded
 *          wave of the server executor over filings filed since its last
 *          check. Stops after 25 alerts or 50 seconds; the next pass, 15
 *          minutes later, continues.
 *   POST — the alert's owner: {"alertKey"} checks that alert now, due or
 *          not (session-authenticated, owner- and org-scoped).
 *
 * The path is exempt from the session proxy (config/routes PUBLIC_API_PATHS)
 * only so the cron request can reach this handler; both methods authenticate
 * here and fail closed.
 *
 * Controls: one lease per alert (database), at most one check per user and
 * two deployment-wide at a time (resource concurrency), every SEC request
 * through the central pacer, document fetches through the shared pool.
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
import { isEligibleUserDataIdentity } from '../../../../lib/user-data-route';
import { CLIENT_KEY_PATTERN } from '../../../../lib/user-data-kinds';
import { filingResearchStages } from '../../../../services/filingResearch';
import {
  ALERT_EVALUATION_LIMITS,
  evaluateClaimedAlert,
  runAlertEvaluationPass,
  type AlertEvaluationOutcome,
  type ClaimedAlert,
} from '../../../../services/alertEvaluation';
import { buildServerWaveClients } from '../../search-jobs/_server/clients';
import { isAuthorizedCron, jsonError, jsonResponse, readJsonBody } from '../../search-jobs/_server/http';
import { ALERT_STORE_UNAVAILABLE, alertEvaluationStore, type AlertClaimStore } from '../_server/store';

/** Platform budget (seconds): the pass claims for 50 s; a check that starts
 *  then is hard-stopped at 70 s and recorded under a 15 s HTTP deadline. */
export const maxDuration = 180;

const CHECK_CAPACITY = {
  operation: 'alert-check',
  userLimit: 1,
  orgLimit: 3,
  ipLimit: 8,
  globalLimit: 2,
  leaseSeconds: ALERT_EVALUATION_LIMITS.leaseSeconds,
} as const;

async function checkOne(
  request: Request,
  store: AlertClaimStore,
  alert: ClaimedAlert
): Promise<AlertEvaluationOutcome | 'busy'> {
  const identity: RateLimitIdentity = { userId: alert.ownerUserId, orgId: alert.orgId };
  const capacity = await acquireResourceConcurrency(request, identity, CHECK_CAPACITY);
  if (!capacity.allowed) {
    // Not a failure of the alert: hand the lease back untouched.
    await store.release(alert.id, alert.leaseToken).catch(() => undefined);
    return 'busy';
  }
  const deadline = AbortSignal.timeout(ALERT_EVALUATION_LIMITS.waveHardDeadlineMs);
  try {
    return await evaluateClaimedAlert(alert, {
      store,
      clients: buildServerWaveClients({ request, identity }, deadline),
      isExhibitDocumentType: filingResearchStages.isExhibitDocumentType,
      signal: deadline,
    });
  } catch (error) {
    // Store failure while recording: release so the next tick retries.
    const reason = error instanceof Error ? error.message : 'The check failed.';
    console.error('[alerts] check failed:', error);
    await store.release(alert.id, alert.leaseToken).catch(() => undefined);
    return { kind: 'failed', alertId: alert.id, clientKey: alert.clientKey, reason };
  } finally {
    await releaseAiConcurrency(capacity.lease);
  }
}

function describe(outcome: AlertEvaluationOutcome) {
  // The cron log names alerts by id only — never a user's query text.
  if (outcome.kind === 'checked') {
    return { outcome: 'checked', alertId: outcome.alertId, complete: outcome.complete, newFilings: outcome.newFilings, storedHits: outcome.storedHits };
  }
  if (outcome.kind === 'lease-lost') return { outcome: 'lease-lost', alertId: outcome.alertId };
  return { outcome: outcome.kind, alertId: outcome.alertId, reason: outcome.reason };
}

async function handleCron(request: Request) {
  if (!isAuthorizedCron(request)) return jsonError(401, 'Unauthorized.');
  const store = alertEvaluationStore();
  if (!store) return jsonError(503, ALERT_STORE_UNAVAILABLE);
  try {
    const pass = await runAlertEvaluationPass({
      claim: () => store.claimDue(),
      evaluate: alert => checkOne(request, store, alert),
    });
    return jsonResponse({ ok: true, claimed: pass.claimed, stoppedBy: pass.stoppedBy, checks: pass.outcomes.map(describe) });
  } catch (error) {
    console.error('[alerts] cron pass failed:', error);
    return jsonError(502, 'The alert pass could not complete.');
  }
}

async function handleOwnerRun(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  if (!isEligibleUserDataIdentity(access.identity)) {
    return jsonError(403, 'Background alert checks belong to a signed-in account.');
  }
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'alert-run-now', userLimit: 20 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await readJsonBody(request, 2_000);
  if (body instanceof Response) return body;
  const alertKey = (body as { alertKey?: unknown })?.alertKey;
  if (typeof alertKey !== 'string' || !CLIENT_KEY_PATTERN.test(alertKey)) {
    return jsonError(400, 'Provide the alertKey of the alert to check.');
  }

  const store = alertEvaluationStore();
  if (!store) return jsonError(503, ALERT_STORE_UNAVAILABLE);
  try {
    const claimed = await store.claimOwned(access.identity.userId, access.identity.orgId, alertKey);
    if ('error' in claimed) {
      return claimed.error === 'busy'
        ? jsonError(409, 'This alert is being checked right now. Its results appear when the check finishes.', { errorClass: 'busy' })
        : jsonError(404, 'This alert is not saved to your account yet, so it cannot be checked on the server.', { errorClass: 'not-found' });
    }
    const outcome = await checkOne(request, store, claimed);
    if (outcome === 'busy') {
      return jsonError(429, 'Alert checks are at capacity. Retry in a minute.', { errorClass: 'busy' });
    }
    return jsonResponse({ ok: true, check: describe(outcome) });
  } catch (error) {
    console.error('[alerts] owner check failed:', error);
    return jsonError(502, 'The alert could not be checked.');
  }
}

export const GET = withRouteObservability('alerts/evaluate', handleCron);
export const POST = withRouteObservability('alerts/evaluate', handleOwnerRun);
