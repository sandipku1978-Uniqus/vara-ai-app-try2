/**
 * Identity assertions for the user-data RPCs (migration 026).
 *
 * The route authenticates the caller with Clerk (requireApiAccess), then signs
 * a short-lived HMAC-SHA256 assertion of that session's user and org. The
 * database recomputes the HMAC with the same secret (urc_user_signing_key)
 * before it scopes the transaction to that identity, so a caller holding only
 * the publishable key cannot claim anyone's rows. The message format here and
 * in urc_user_assume() must match byte for byte; a test holds them together.
 *
 * Server-only: reads URC_USER_DATA_SIGNING_SECRET and uses node:crypto.
 */

import { createHmac } from 'node:crypto';
import type { UserDataKind } from './user-data-kinds';

export type UserDataOperation = 'list' | 'upsert' | 'delete';

/** The route signs for two minutes; the database accepts at most ten (clock skew). */
export const USER_DATA_ASSERTION_TTL_SECONDS = 120;
export const USER_DATA_SECRET_MIN_LENGTH = 32;
export const USER_DATA_ASSERTION_PURPOSE = 'urc-user-v1';

export interface UserDataAssertion {
  p_user_id: string;
  p_org_id: string | null;
  p_expires_at: number;
  p_signature: string;
}

/** The configured secret, or null when durable user storage is not provisioned. */
export function userDataSigningSecret(): string | null {
  const secret = process.env.URC_USER_DATA_SIGNING_SECRET?.trim() || '';
  return secret.length >= USER_DATA_SECRET_MIN_LENGTH ? secret : null;
}

export function userDataAssertionMessage(
  operation: UserDataOperation,
  kind: UserDataKind,
  userId: string,
  orgId: string | null,
  expiresAt: number,
): string {
  // Mirrors concat_ws(E'\n', 'urc-user-v1', op, kind, user, coalesce(org, ''), expires).
  return [USER_DATA_ASSERTION_PURPOSE, operation, kind, userId, orgId ?? '', String(expiresAt)].join('\n');
}

export function signUserDataAssertion(options: {
  operation: UserDataOperation;
  kind: UserDataKind;
  userId: string;
  orgId: string | null;
  secret: string;
  nowMs?: number;
}): UserDataAssertion {
  const expiresAt = Math.floor((options.nowMs ?? Date.now()) / 1000) + USER_DATA_ASSERTION_TTL_SECONDS;
  const orgId = options.orgId || null;
  const signature = createHmac('sha256', options.secret)
    .update(userDataAssertionMessage(options.operation, options.kind, options.userId, orgId, expiresAt), 'utf8')
    .digest('hex');
  return { p_user_id: options.userId, p_org_id: orgId, p_expires_at: expiresAt, p_signature: signature };
}
