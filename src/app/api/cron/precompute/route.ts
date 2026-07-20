import { NextResponse } from 'next/server';

/**
 * Historical endpoint retained as an explicit tombstone so old bookmarks and
 * deployment probes cannot trigger model work. The application proxy applies
 * normal platform authorization before this handler is reached.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'This placeholder precompute job has been retired.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
