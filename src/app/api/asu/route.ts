/**
 * GET /api/asu — the FASB Accounting Standards Update index.
 *
 *   (no params)        → every issued Update FASB lists, plus proposals open for comment
 *   ?topic=280         → Updates whose titles name ASC 280 (subtopics: ?topic=205-40)
 *   ?number=2023-07    → one Update
 *
 * Read from FASB's public listing API (see src/services/asuIndex.ts) and cached
 * in Vercel KV for 24 hours. fasb.org sits behind Cloudflare bot protection,
 * which refuses many server clients; when it does, each unreadable page is
 * served from the copy saved in src/data/fasb and the coverage object says so,
 * page by page, with the date that copy was read. Nothing here is generated.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { cacheService } from '../../../lib/cache';
import { fetchWithDeadline } from '../../../lib/fetch-with-deadline';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { withRouteObservability } from '../../../lib/route-observability';
import {
  asusForAscReference,
  findAsu,
  loadAsuIndex,
  type AsuSnapshot,
} from '../../../services/asuIndex';
import snapshotJson from '../../../data/fasb/asu-index-snapshot.json';

/** Platform budget (seconds): three parallel FASB reads under an 8 s HTTP deadline, plus KV. */
export const maxDuration = 20;

/** Per-request HTTP deadline for each FASB listing read. */
const FASB_DEADLINE_MS = 8_000;

const SNAPSHOT = snapshotJson as unknown as AsuSnapshot;

async function handleGet(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'asu-index' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const params = new URL(request.url).searchParams;
  const topic = (params.get('topic') || '').trim();
  const number = (params.get('number') || '').trim();
  if ((topic && !/^\d{3}(?:-\d{2,3})?$/.test(topic)) || (number && number.length > 24)) {
    return NextResponse.json(
      { ok: false, error: 'topic must be a three-digit ASC topic (optionally with a subtopic, 205-40); number must be an ASU number.', errorClass: 'invalid-request' },
      { status: 400 },
    );
  }

  const index = await loadAsuIndex({
    fetchImpl: fetchWithDeadline(FASB_DEADLINE_MS),
    cache: cacheService,
    snapshot: SNAPSHOT,
  });

  let entries = index.entries;
  if (topic) entries = asusForAscReference(entries, `ASC ${topic}`);
  if (number) {
    const match = findAsu(entries, number);
    entries = match ? [match] : [];
  }

  if (index.entries.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'The ASU index could not be read from FASB and no saved copy is available.',
        errorClass: 'upstream-unavailable',
        coverage: index.coverage,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      query: { topic: topic || null, number: number || null },
      entries,
      coverage: index.coverage,
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}

export const GET = withRouteObservability('asu', handleGet);
