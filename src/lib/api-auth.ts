import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { getClerkProductionConfigError, getResearchFeature, isLocalE2eBypass } from './clerk-config';
import {
  hasStagedProductionReleaseGateAccess,
  RELEASE_GATE_HEADER,
} from './release-gate-auth';

export interface ApiIdentity {
  userId: string;
  orgId: string | null;
  cacheScope: string;
  releaseGate?: boolean;
  releaseGateHost?: string;
}

export type ApiAccessResult =
  | { identity: ApiIdentity; response?: never }
  | { identity?: never; response: Response };

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function requireApiAccess(
  requireEntitlement = true,
  releaseGatePath?: string,
  releaseGateMethod?: string,
): Promise<ApiAccessResult> {
  if (isLocalE2eBypass()) {
    return {
      identity: { userId: 'local-e2e', orgId: null, cacheScope: 'local-e2e:personal' },
    };
  }

  // The proxy and route handler independently verify the same canonical-host
  // credential. The second check prevents a direct handler invocation or a
  // proxy configuration mistake from turning middleware bypass into access.
  try {
    const requestHeaders = await headers();
    if (
      releaseGatePath &&
      releaseGateMethod &&
      await hasStagedProductionReleaseGateAccess(requestHeaders, releaseGatePath, releaseGateMethod)
    ) {
      const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || 'unknown';
      return {
        identity: {
          userId: `release-gate:${deploymentId}`,
          orgId: null,
          cacheScope: `release-gate:${deploymentId}`,
          releaseGate: true,
          releaseGateHost: (requestHeaders.get('host') || '').split(':')[0].toLowerCase(),
        },
      };
    }
    if (requestHeaders.has(RELEASE_GATE_HEADER)) {
      return { response: jsonError(401, 'Invalid release candidate credential.') };
    }
  } catch {
    // `headers()` has no request scope in some unit contexts. Continue to
    // normal Clerk authentication; never treat the missing context as access.
  }

  const configError = getClerkProductionConfigError();
  if (configError) {
    console.error(`Protected API disabled: ${configError}`);
    return { response: jsonError(503, 'Authentication is not configured for this deployment.') };
  }

  try {
    const session = await auth();
    if (!session.userId) {
      return { response: jsonError(401, 'Authentication required.') };
    }

    const feature = getResearchFeature();
    if (requireEntitlement && feature && !session.has({ feature })) {
      return { response: jsonError(403, 'Your account is not entitled to this feature.') };
    }

    return {
      identity: {
        userId: session.userId,
        orgId: session.orgId || null,
        cacheScope: `${session.userId}:${session.orgId || 'personal'}`,
      },
    };
  } catch (error) {
    console.error('Authentication verification failed:', error);
    return { response: jsonError(503, 'Authentication could not be verified.') };
  }
}
