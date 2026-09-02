import { NextResponse } from 'next/server';
import { withRouteObservability } from '../../../../lib/route-observability';

/**
 * Historical endpoint retained as an explicit tombstone so old bookmarks and
 * deployment probes cannot trigger model work. The application proxy applies
 * normal platform authorization before this handler is reached.
 */
async function handleGet() {
  return NextResponse.json(
    { error: 'This placeholder precompute job has been retired.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export const GET = withRouteObservability('cron/precompute', handleGet);
