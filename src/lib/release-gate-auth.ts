/**
 * Verification for short-lived staged-production release credentials.
 *
 * The GitHub release environment owns the P-256 private key. The Vercel
 * production deployment contains only its public key, so application code can
 * verify a five-minute credential but can never mint one. A credential is
 * bound to the canonical deployment host, deployment ID, Git SHA, HTTP method,
 * and pathname. It is therefore rejected across routes and through the public
 * production alias after promotion.
 */
import {
  configuredReleaseGateNotAfter,
  isReleaseGateWindowActive,
} from './release-gate-window';

export const RELEASE_GATE_HEADER = 'x-urc-release-gate-token';
export const RELEASE_GATE_TOKEN_VERSION = 'v3';
export const MAX_RELEASE_GATE_TOKEN_TTL_SECONDS = 10 * 60;
export const RELEASE_GATE_API_METHOD_PATHS: ReadonlySet<string> = new Set([
  'GET /api/es-search',
  'GET /api/letters',
  'GET /api/enrich',
  'POST /api/enrich',
  'GET /api/filing-text',
  'POST /api/boolean-validate',
  'GET /api/sec-efts',
]);

export function releaseGateMethodPath(pathname: string, method: string): string {
  return `${method.toUpperCase()} ${pathname}`;
}

function decodeBase64(value: string): ArrayBuffer | null {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): ArrayBuffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return decodeBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

function requestHost(requestHeaders: Pick<Headers, 'get'>): string {
  return (requestHeaders.get('host') || '').split(':')[0].toLowerCase();
}

/**
 * The route allowlist is checked both here and at each route's authorization
 * call site. Production aliases, previews, arbitrary custom environments and
 * all write/AI/SEC proxy APIs remain on Clerk authentication.
 */
export async function hasStagedProductionReleaseGateAccess(
  requestHeaders: Pick<Headers, 'get'>,
  pathname: string,
  method: string,
): Promise<boolean> {
  const requestMethod = method.toUpperCase();
  if (!RELEASE_GATE_API_METHOD_PATHS.has(releaseGateMethodPath(pathname, requestMethod))) return false;
  if (
    process.env.VERCEL !== '1' ||
    process.env.VERCEL_ENV !== 'production' ||
    process.env.VERCEL_TARGET_ENV !== 'production'
  ) return false;

  const publicKey = decodeBase64((process.env.URC_RELEASE_GATE_PUBLIC_KEY || '').trim());
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || '';
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
  if (
    !publicKey ||
    !deploymentId ||
    !/^[0-9a-f]{40}$/i.test(sha)
  ) {
    return false;
  }

  const token = requestHeaders.get(RELEASE_GATE_HEADER) || '';
  const [
    version,
    expiresRaw,
    tokenDeploymentId,
    tokenSha,
    tokenHostRaw,
    tokenMethod,
    tokenPathRaw,
    signatureRaw,
    ...extra
  ] = token.split('.');
  const tokenHostBytes = decodeBase64Url(tokenHostRaw || '');
  const tokenHost = tokenHostBytes
    ? new TextDecoder().decode(tokenHostBytes).toLowerCase()
    : '';
  const tokenPathBytes = decodeBase64Url(tokenPathRaw || '');
  const tokenPath = tokenPathBytes ? new TextDecoder().decode(tokenPathBytes) : '';
  const deploymentHost = (process.env.VERCEL_URL || '').trim().toLowerCase();
  if (
    extra.length > 0 ||
    version !== RELEASE_GATE_TOKEN_VERSION ||
    tokenDeploymentId !== deploymentId ||
    tokenSha !== sha ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(tokenHost) ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(deploymentHost) ||
    requestHost(requestHeaders) !== tokenHost ||
    tokenHost !== deploymentHost ||
    tokenMethod !== requestMethod ||
    tokenPath !== pathname
  ) {
    return false;
  }

  const expires = Number(expiresRaw);
  const now = Math.floor(Date.now() / 1000);
  const releaseGateNotAfter = configuredReleaseGateNotAfter();
  if (
    !releaseGateNotAfter
    || !isReleaseGateWindowActive(now)
    || !Number.isInteger(expires)
    || expires < now
    || expires > now + MAX_RELEASE_GATE_TOKEN_TTL_SECONDS
    || expires > releaseGateNotAfter
  ) {
    return false;
  }

  const signature = decodeBase64Url(signatureRaw || '');
  if (!signature) return false;
  const payload = `${version}\n${expires}\n${deploymentId}\n${sha}\n${tokenHost}\n${tokenMethod}\n${tokenPath}`;

  try {
    const key = await crypto.subtle.importKey(
      'spki',
      publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}
