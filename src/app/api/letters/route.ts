/**
 * GET /api/letters — the owned comment-letter corpus (urc_comment_letters).
 *
 *   ?thread=<id>            → full conversation, reading order
 *   ?q=<query>[&form=...]   → ranked full-text search with highlighted excerpts
 *   (neither)               → recent review conversations
 *
 * Unlike the old EFTS passthrough, results are threaded (Staff letter ↔
 * response conversations) and searchable inside the letter text.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { isValidIsoDate, parseBoundedInteger, parseCik } from '../../../lib/api-query';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { dbErrorResponse, newCorrelationId } from '../../../lib/db-observability';
import { getWebSupabase } from '../../../lib/supabase-web';

function withoutTotalCount(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  delete copy.total_count;
  return copy;
}

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const params = new URL(request.url).searchParams;
  const threadId = params.get('thread')?.trim() || null;
  const q = (params.get('q') || '').trim();
  const form = params.get('form');
  const company = (params.get('company') || '').trim() || null;
  const startdt = params.get('startdt');
  const enddt = params.get('enddt');
  const from = parseBoundedInteger(params.get('from'), 0, 0, 10_000);
  const size = parseBoundedInteger(params.get('size'), 20, 1, 100);
  const rawCik = params.get('cik');
  const cikParam = rawCik === null || rawCik === '' ? null : parseCik(rawCik);
  if (
    (threadId && !/^[A-Za-z0-9:._-]{1,160}$/.test(threadId))
    || q.length > 2000
    || (company?.length || 0) > 300
    || (form !== null && form !== '' && form !== 'UPLOAD' && form !== 'CORRESP')
    || (startdt && !isValidIsoDate(startdt))
    || (enddt && !isValidIsoDate(enddt))
    || Boolean(startdt && enddt && startdt > enddt)
    || from === null
    || size === null
    || (rawCik !== null && rawCik !== '' && cikParam === null)
  ) {
    return NextResponse.json({ error: 'Invalid or oversized letter query parameter.' }, { status: 400 });
  }

  const db = getWebSupabase();
  if (!db) {
    return NextResponse.json({ error: 'Letter corpus is not configured with a restricted database role.' }, { status: 503 });
  }
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'letters' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  try {
    if (threadId) {
      const { data, error } = await db.rpc('urc_thread_detail', { p_thread_id: threadId });
      if (error) return dbErrorResponse({ route: 'letters', rpc: 'urc_thread_detail', error, correlationId, startedAt });
      return NextResponse.json({ thread: threadId, letters: data ?? [] });
    }

    if (q) {
      // Pagination contract (readiness audit R0): the ranked pool is 1,000
      // deep, so offsets beyond it are UNSUPPORTED — say so with a 422 and
      // coverage metadata rather than a 200 that reads as "no matches".
      const SUPPORTED_DEPTH = 1000;
      if (from >= SUPPORTED_DEPTH) {
        return NextResponse.json(
          {
            error: `Offsets beyond ${SUPPORTED_DEPTH} are not supported: results are ranked within the ${SUPPORTED_DEPTH} most recent matches.`,
            supportedDepth: SUPPORTED_DEPTH,
            correlationId,
          },
          { status: 422 }
        );
      }
      const searchParams = {
        p_query: q,
        p_form: form === 'UPLOAD' || form === 'CORRESP' ? form : null,
        p_start: startdt || null,
        p_end: enddt || null,
        p_limit: size,
        p_offset: from,
        p_company: company,
      };
      const { data, error } = await db.rpc('urc_search_letters', searchParams);
      if (error) return dbErrorResponse({ route: 'letters', rpc: 'urc_search_letters', error, correlationId, startedAt });
      let rows = (data ?? []) as Array<Record<string, unknown>>;
      // An empty page inside the supported range means the offset ran past
      // the real matches — but the TRUE total lives on the rows we did not
      // get. Re-query page 0 for the total instead of fabricating a zero:
      // the audit's probe (offset 2000 on a 3,045-match query) got
      // { total: 0 } from this route, an authoritative-looking lie.
      let totalRows = rows;
      if (rows.length === 0 && from > 0) {
        const retry = await db.rpc('urc_search_letters', { ...searchParams, p_limit: 1, p_offset: 0 });
        if (retry.error) return dbErrorResponse({ route: 'letters', rpc: 'urc_search_letters', error: retry.error, correlationId, startedAt });
        totalRows = (retry.data ?? []) as Array<Record<string, unknown>>;
        rows = [];
      }
      // Migration 017/018 caps count exactness at 10,000: 10,001 means
      // "more than 10,000", not a real total. Translate rather than display
      // it as if it were exact.
      const rawTotal = totalRows.length > 0 ? Number(totalRows[0].total_count) : 0;
      const totalIsFloor = rawTotal > 10_000;
      return NextResponse.json({
        total: totalIsFloor ? 10_000 : rawTotal,
        totalIsFloor,
        matches: rows.map(withoutTotalCount),
      });
    }

    const { data, error } = await db.rpc('urc_recent_threads', {
      p_limit: size, p_offset: from, p_company: company, p_cik: cikParam,
    });
    if (error) return dbErrorResponse({ route: 'letters', rpc: 'urc_recent_threads', error, correlationId, startedAt });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return NextResponse.json({
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
      threads: rows.map(withoutTotalCount),
    });
  } catch (error) {
    console.error(`[letters] query failed (correlationId=${correlationId}):`, error);
    return NextResponse.json({ error: 'Letter query failed', errorClass: 'unexpected', correlationId }, { status: 502 });
  }
}
