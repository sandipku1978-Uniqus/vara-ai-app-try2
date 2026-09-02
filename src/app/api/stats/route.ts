/**
 * GET /api/stats — data-layer coverage/freshness for the UI trust chips
 * (design-system §1.4: accountants won't cite what they can't source).
 * Counts are planner estimates so the query is instant. Always dynamic —
 * auth() opts the route out of ISR, so a revalidate export would be inert.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { getWebSupabase } from '../../../lib/supabase-web';
import { classifyDbError, dbErrorResponse, newCorrelationId } from '../../../lib/db-observability';
import { withRouteObservability } from '../../../lib/route-observability';

/** Platform budget (seconds). One planner-estimate RPC; instant when the database answers, bounded when it does not. */
export const maxDuration = 15;

async function handleGet(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  let completionLogged = false;
  const complete = (response: Response, details: {
    outcome: 'success' | 'error' | 'rate-limited';
    errorClass?: string;
    rowCount?: number;
    errorName?: string;
  }): Response => {
    response.headers.set('x-correlation-id', correlationId);
    if (!completionLogged) {
      completionLogged = true;
      console.info(JSON.stringify({
        kind: 'route-completion',
        route: 'stats',
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        correlationId,
        ...details,
      }));
    }
    return response;
  };

  const db = getWebSupabase();
  if (!db) {
    return complete(
      NextResponse.json({
        ok: false,
        error: 'Stats are not configured with a restricted database role.',
        errorClass: 'configuration',
        correlationId,
      }, { status: 503 }),
      { outcome: 'error', errorClass: 'configuration' }
    );
  }
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'stats' });
  if (!rate.allowed) {
    return complete(rateLimitResponse(rate), {
      outcome: 'rate-limited',
      errorClass: 'rate-limited',
    });
  }

  try {
    const { data, error } = await db.rpc('urc_data_stats');
    if (error) {
      const classified = classifyDbError(error);
      return complete(
        dbErrorResponse({ route: 'stats', rpc: 'urc_data_stats', error, correlationId, startedAt }),
        { outcome: 'error', errorClass: classified.errorClass }
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    const response = NextResponse.json({
      filings: { count: Number(row?.filings_estimate ?? 0), through: row?.filings_through ?? null, source: 'SEC EDGAR master index' },
      auditors: { count: Number(row?.auditors_estimate ?? 0), source: 'PCAOB Form AP' },
      letters: {
        count: Number(row?.letters_estimate ?? 0),
        withText: Number(row?.letters_with_text ?? 0),
        through: row?.letters_through ?? null,
        lastTextFetch: row?.letters_last_text_fetch ?? null,
        retryPending: Number(row?.letters_retry_pending ?? 0),
        source: 'SEC EDGAR (UPLOAD/CORRESP)',
      },
    });
    return complete(response, { outcome: 'success', rowCount: row ? 1 : 0 });
  } catch (error) {
    return complete(
      NextResponse.json({
        ok: false,
        error: 'Statistics request failed unexpectedly. Retry.',
        errorClass: 'unexpected',
        correlationId,
      }, { status: 502 }),
      {
        outcome: 'error',
        errorClass: 'unexpected',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }
    );
  }
}

export const GET = withRouteObservability('stats', handleGet);
