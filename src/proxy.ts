import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { getClerkProductionConfigError, getResearchFeature, isLocalE2eBypass } from './lib/clerk-config';
import {
  hasStagedProductionReleaseGateAccess,
  RELEASE_GATE_HEADER,
} from './lib/release-gate-auth';
import { PUBLIC_API_PATHS, PUBLIC_PAGE_PATHS } from './config/routes';

const PUBLIC_PATHS = new Set([
  ...PUBLIC_PAGE_PATHS,
  ...PUBLIC_API_PATHS,
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
]);
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function isPublicRequest(request: NextRequest): boolean {
  return isPublicPath(request.nextUrl.pathname);
}

function unavailableResponse(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Authentication is not configured for this deployment.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return new NextResponse('Authentication is not configured for this deployment.', {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function invalidReleaseCredentialResponse(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Invalid release candidate credential.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return new NextResponse('Invalid release candidate credential.', {
    status: 401,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

const authenticatedProxy = clerkMiddleware(async (auth, request) => {
  if (isPublicRequest(request)) return NextResponse.next();

  const session = await auth.protect();
  const feature = getResearchFeature();
  if (feature && !session.has({ feature })) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Feature entitlement required.' }, { status: 403 });
    }
    return new NextResponse('Feature entitlement required.', { status: 403 });
  }

  return NextResponse.next();
});

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isLocalE2eBypass()) return NextResponse.next();
  if (await hasStagedProductionReleaseGateAccess(request.headers, request.nextUrl.pathname, request.method)) return NextResponse.next();
  // A presented-but-invalid release token is an authentication attempt in its
  // own right. Reject it explicitly instead of falling through to Clerk, whose
  // production configuration is intentionally outside this remediation.
  if (request.headers.has(RELEASE_GATE_HEADER)) return invalidReleaseCredentialResponse(request);
  const configError = getClerkProductionConfigError();
  if (configError) {
    if (isPublicRequest(request)) return NextResponse.next();
    console.error(`Protected route disabled: ${configError}`);
    return unavailableResponse(request);
  }
  return authenticatedProxy(request, event);
}

export const config = {
  matcher: ['/((?!_next/static(?:/|$)|_next/image(?:/|$)).*)'],
};
