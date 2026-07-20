import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { getClerkProductionConfigError, getResearchFeature, isLocalE2eBypass } from './lib/clerk-config';
import { PUBLIC_PAGE_PATHS } from './config/routes';

const PUBLIC_PATHS = new Set([
  ...PUBLIC_PAGE_PATHS,
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

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (isLocalE2eBypass()) return NextResponse.next();
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
