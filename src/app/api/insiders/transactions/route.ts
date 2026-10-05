import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../../lib/api-auth';
import { parseBoundedInteger, parseCik } from '../../../../lib/api-query';
import { cacheService } from '../../../../lib/cache';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { withRouteObservability } from '../../../../lib/route-observability';
import { SecUpstreamError } from '../../../../lib/sec-upstream';
import { awaitWithSignal, getInsiderTransactions, type InsiderForm, type InsiderTransactionsResult } from '../../../../services/insiderTransactions';

/** 40 s SEC service + two bounded 2 s KV waits, leaving time for auth/rate controls and serialization. */
export const maxDuration = 60;
const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

/** cacheService has no signal parameter; bound caller waits and ignore a stalled
 * cache. SEC I/O itself receives and honours request cancellation. */
async function cacheOperation<T>(operation: () => Promise<T>, requestSignal: AbortSignal): Promise<T | null> {
  const controller = new AbortController();
  const abort = () => controller.abort(requestSignal.reason);
  if (requestSignal.aborted) abort();
  else requestSignal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Cache deadline exceeded.', 'TimeoutError')), 2000);
  try { return await awaitWithSignal(operation, controller.signal); }
  catch { requestSignal.throwIfAborted(); return null; }
  finally { clearTimeout(timer); requestSignal.removeEventListener('abort', abort); }
}

async function handleGet(request: Request) {
  const access = await requireApiAccess(true, '/api/insiders/transactions', 'GET');
  if (access.response) return access.response;
  const params = new URL(request.url).searchParams;
  const cik = parseCik(params.get('cik') ?? '');
  const limit = parseBoundedInteger(params.get('limit'), 40, 1, 100);
  const formsInput = params.get('forms');
  const rawForms = formsInput === null ? ['3', '4', '5'] : formsInput.split(',').map(form => form.trim());
  if (cik === null || limit === null || !rawForms.length || rawForms.some(form => !/^[345]$/.test(form))) {
    return NextResponse.json({ error: 'Invalid cik, limit (1..100), or forms (3,4,5).' }, { status: 400 });
  }
  const forms = [...new Set(rawForms)].sort() as InsiderForm[];
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'insider-transactions', userLimit: 20, orgLimit: 80, ipLimit: 30 });
  if (!rate.allowed) return rateLimitResponse(rate);
  try {
    // v2 separates other-issuer disclosures from failures in coverage.
    const key = `insiders:transactions:v2:${cik}:${forms.join(',')}:${limit}`;
    const cached = await cacheOperation(() => cacheService.get<InsiderTransactionsResult>(key), request.signal);
    if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, no-store' } });
    const result = await getInsiderTransactions({ cik, maxFilings: limit, formTypes: forms, signal: request.signal, userAgent: USER_AGENT, deadlineMs: 40_000 });
    request.signal.throwIfAborted();
    const ttl = result.coverage.complete && result.coverage.filingsFailed.length === 0 ? 3600 : 300;
    await cacheOperation(() => cacheService.set(key, result, { ex: ttl }), request.signal);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: 'Request cancelled.' }, { status: 499 });
    if (error instanceof SecUpstreamError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return NextResponse.json({ error: 'SEC insider submissions request timed out.' }, { status: 504 });
    }
    return NextResponse.json({ error: 'SEC insider transactions request failed.' }, { status: 502 });
  }
}
export const GET = withRouteObservability('insider-transactions', handleGet);
