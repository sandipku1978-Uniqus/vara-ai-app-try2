import { auth } from '@clerk/nextjs/server';
import { getClerkProductionConfigError, getResearchFeature, isLocalE2eBypass } from './clerk-config';

export interface ApiIdentity {
  userId: string;
  orgId: string | null;
  cacheScope: string;
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

export async function requireApiAccess(requireEntitlement = true): Promise<ApiAccessResult> {
  if (isLocalE2eBypass()) {
    return {
      identity: { userId: 'local-e2e', orgId: null, cacheScope: 'local-e2e:personal' },
    };
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
