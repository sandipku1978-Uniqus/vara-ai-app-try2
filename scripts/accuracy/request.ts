/** Authentication headers used only for calls to the immutable candidate. */
import { createPrivateKey, sign } from 'node:crypto';
import {
  RELEASE_GATE_API_METHOD_PATHS,
  releaseGateMethodPath,
} from '../../src/lib/release-gate-auth';

const TOKEN_TTL_SECONDS = 5 * 60;

function normalizedTokenPath(pathname: string): string | null {
  if (!pathname.startsWith('/') || pathname.includes('?') || pathname.includes('#')) return null;
  try {
    const parsed = new URL(pathname, 'https://release-gate.invalid');
    return parsed.pathname === pathname ? pathname : null;
  } catch {
    return null;
  }
}

function createReleaseGateToken(pathname: string, method: string): string | null {
  const privateKeyBase64 = (process.env.URC_RELEASE_GATE_PRIVATE_KEY || '').replace(/\s/g, '');
  const deploymentId = process.env.CANDIDATE_DEPLOYMENT_ID || '';
  const sha = process.env.EXPECTED_SHA || '';
  const base = process.env.CANDIDATE_URL || '';
  if (!privateKeyBase64 || !deploymentId || !/^[0-9a-f]{40}$/i.test(sha) || !base) return null;
  const tokenPath = normalizedTokenPath(pathname);
  const tokenMethod = method.toUpperCase();
  if (!tokenPath || !RELEASE_GATE_API_METHOD_PATHS.has(releaseGateMethodPath(tokenPath, tokenMethod))) return null;

  let host = '';
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return null;
  }

  try {
    const privateKey = createPrivateKey({
      key: Buffer.from(privateKeyBase64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    if (
      privateKey.asymmetricKeyType !== 'ec' ||
      privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) return null;

    const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const payload = `v3\n${expires}\n${deploymentId}\n${sha}\n${host}\n${tokenMethod}\n${tokenPath}`;
    const signature = sign('sha256', Buffer.from(payload), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    const encodedHost = Buffer.from(host).toString('base64url');
    const encodedPath = Buffer.from(tokenPath).toString('base64url');
    return `v3.${expires}.${deploymentId}.${sha}.${encodedHost}.${tokenMethod}.${encodedPath}.${signature}`;
  } catch {
    return null;
  }
}

export interface CandidateRequestTrust {
  /** Origin that will receive these headers. */
  requestOrigin: string;
  /** Origin independently attested by the candidate preflight. */
  trustedOrigin?: string;
}

/**
 * Accept only a canonical Vercel deployment origin. In particular, do not
 * treat a hostname that merely ends in `vercel.app` as a deployment origin.
 */
export function canonicalVercelCandidateOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:'
      || url.port
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(hostname)
      || url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function trustedProtectionBypass(trust: CandidateRequestTrust | undefined): string | null {
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!protectionBypass || !trust) return null;

  const requestOrigin = canonicalVercelCandidateOrigin(trust.requestOrigin);
  const trustedOrigin = canonicalVercelCandidateOrigin(
    trust.trustedOrigin || process.env.TRUSTED_CANDIDATE_ORIGIN,
  );
  return requestOrigin && trustedOrigin && requestOrigin === trustedOrigin
    ? protectionBypass
    : null;
}

export function candidateRequestHeaders(
  pathname: string,
  method: string,
  trust?: CandidateRequestTrust,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = createReleaseGateToken(pathname, method);
  const protectionBypass = trustedProtectionBypass(trust);
  if (token) headers['x-urc-release-gate-token'] = token;
  if (protectionBypass) headers['x-vercel-protection-bypass'] = protectionBypass;
  return headers;
}
