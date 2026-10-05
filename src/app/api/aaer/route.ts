import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { isValidIsoDate, parseBoundedInteger } from '../../../lib/api-query';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { withRouteObservability } from '../../../lib/route-observability';
import { getAaerIndex } from '../../../services/aaer';

/** Platform budget: ~34 paced pages within the 100 s service deadline, leaving
 * 20 s for authorization, rate controls, two bounded KV waits and serialization. */
export const maxDuration = 120;

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

async function handleGet(request: Request) {
  const access = await requireApiAccess(true, '/api/aaer', 'GET');
  if (access.response) return access.response;

  const params = new URL(request.url).searchParams;
  const q = params.get('q') ?? '';
  const from = params.get('from');
  const to = params.get('to');
  const rawLimit = params.get('limit');
  const limit = parseBoundedInteger(rawLimit, 100, 1, 500);
  const allowed = new Set(['q', 'from', 'to', 'limit']);
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)
    || q.length > 200 || (from !== null && !isValidIsoDate(from)) || (to !== null && !isValidIsoDate(to))
    || (from !== null && to !== null && from > to) || limit === null || rawLimit === '') {
    return NextResponse.json({ error: 'Invalid AAER query. Use q (max 200 characters), ISO from/to dates and limit (1..500); refresh is unsupported.' }, { status: 400 });
  }

  const rate = await checkResourceRateLimit(request, access.identity, {
    operation: 'aaer', userLimit: 30, orgLimit: 120, ipLimit: 60,
  });
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const result = await getAaerIndex({ signal: request.signal, userAgent: USER_AGENT });
    const query = q.trim().toLowerCase();
    const matching = result.releases.filter(release => (!from || release.date >= from) && (!to || release.date <= to)
      && (!query || [release.title, release.releaseNo, ...release.respondents, ...release.otherReleaseNumbers]
        .some(value => value.toLowerCase().includes(query))));
    const releases = matching.slice(0, limit);
    return NextResponse.json({ releases, total: matching.length, returned: releases.length, coverage: result.coverage, cache: result.cache }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: 'Request cancelled.' }, { status: 499 });
    console.error('AAER collection failed:', error);
    return NextResponse.json({ error: 'Could not collect SEC AAER releases.' }, { status: 502 });
  }
}

export const GET = withRouteObservability('aaer', handleGet);
