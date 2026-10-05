/**
 * Alert-evaluation persistence: thin, typed wrappers over the migration-029
 * evaluator RPCs (urc_alert_eval_*), reached through the audited
 * service-role transport. Every write is scoped by the lease token the claim
 * returned; an owner claim is scoped by the owner id and org the route took
 * from its verified Clerk session. Responses are validated before use.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserWriterSupabase } from '../../../../lib/supabase-web';
import {
  ALERT_EVALUATION_LIMITS,
  parseClaimedAlert,
  parsePriorAlertHits,
  type AlertEvaluationStore,
  type ClaimedAlert,
} from '../../../../services/alertEvaluation';

export class AlertStoreError extends Error {}

export type OwnerClaim = ClaimedAlert | { error: 'busy' | 'not-found' };

export interface AlertClaimStore extends AlertEvaluationStore {
  claimDue(): Promise<ClaimedAlert | null>;
  claimOwned(ownerUserId: string, orgId: string | null, clientKey: string): Promise<OwnerClaim>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createSupabaseAlertStore(db: SupabaseClient): AlertClaimStore {
  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new AlertStoreError(`${fn} failed: ${error.message}`);
    return data;
  };

  const claimArgs = {
    p_daily_after_seconds: Math.round(ALERT_EVALUATION_LIMITS.dailyAfterMs / 1000),
    p_weekly_after_seconds: Math.round(ALERT_EVALUATION_LIMITS.weeklyAfterMs / 1000),
    p_lease_seconds: ALERT_EVALUATION_LIMITS.leaseSeconds,
  };

  return {
    async claimDue() {
      const data = await call('urc_alert_eval_claim', {
        p_owner_user_id: null,
        p_org_id: null,
        p_client_key: null,
        ...claimArgs,
      });
      if (data === null || data === undefined) return null;
      const alert = parseClaimedAlert(data);
      if (!alert) throw new AlertStoreError('urc_alert_eval_claim returned an invalid alert.');
      return alert;
    },

    async claimOwned(ownerUserId, orgId, clientKey) {
      const data = await call('urc_alert_eval_claim', {
        p_owner_user_id: ownerUserId,
        p_org_id: orgId,
        p_client_key: clientKey,
        ...claimArgs,
      });
      if (isRecord(data) && (data.error === 'busy' || data.error === 'not-found')) return { error: data.error };
      const alert = parseClaimedAlert(data);
      if (!alert) throw new AlertStoreError('urc_alert_eval_claim returned an invalid alert.');
      if (alert.ownerUserId !== ownerUserId) throw new AlertStoreError('urc_alert_eval_claim returned another owner\'s alert.');
      return alert;
    },

    async priorOriginals(alertId, leaseToken, ciks) {
      if (ciks.length === 0) return [];
      const data = await call('urc_alert_eval_prior_hits', {
        p_alert_id: alertId,
        p_lease_token: leaseToken,
        p_ciks: ciks.slice(0, 500),
      });
      return parsePriorAlertHits(data);
    },

    async record(input) {
      const data = await call('urc_alert_eval_record', {
        p_alert_id: input.alertId,
        p_lease_token: input.leaseToken,
        p_last_hit_count: input.lastHitCount,
        p_seen: input.seen,
        p_latest_new: input.latestNew,
        p_engine_version: input.engineVersion,
        p_coverage: input.coverage,
        p_hits: input.hits,
      });
      if (isRecord(data) && data.error === 'lease-lost') return 'lease-lost';
      if (!isRecord(data)) throw new AlertStoreError('urc_alert_eval_record returned nothing.');
      return { inserted: Number.isSafeInteger(data.inserted) ? Number(data.inserted) : 0 };
    },

    async release(alertId, leaseToken) {
      await call('urc_alert_eval_release', { p_alert_id: alertId, p_lease_token: leaseToken });
    },
  };
}

/** The writer-backed store, or null when the deployment has no writer credential. */
export function alertEvaluationStore(): AlertClaimStore | null {
  const db = getUserWriterSupabase();
  return db ? createSupabaseAlertStore(db) : null;
}

export const ALERT_STORE_UNAVAILABLE = 'Scheduled alert checks are not configured for this deployment.';
