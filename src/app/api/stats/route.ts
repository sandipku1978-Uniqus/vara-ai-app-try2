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
import { dbErrorResponse, newCorrelationId } from '../../../lib/db-observability';

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const db = getWebSupabase();
  if (!db) return NextResponse.json({ error: 'Stats not configured with a restricted database role.' }, { status: 503 });
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'stats' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  try {
    const { data, error } = await db.rpc('urc_data_stats');
    if (error) return dbErrorResponse({ route: 'stats', rpc: 'urc_data_stats', error, correlationId, startedAt });
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
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
  } catch (error) {
    console.error('[stats] failed:', error);
    return NextResponse.json({ error: 'Stats failed' }, { status: 502 });
  }
}
