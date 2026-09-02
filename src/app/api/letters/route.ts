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
import {
  classifyDbError,
  dbErrorResponse,
  newCorrelationId,
  type SupabaseErrorLike,
} from '../../../lib/db-observability';
import { getWebSupabase } from '../../../lib/supabase-web';
import { withRouteObservability } from '../../../lib/route-observability';

function withoutTotalCount(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  delete copy.total_count;
  return copy;
}

async function handleGet(request: Request) {
  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  let completionLogged = false;
  let dbCallCount = 0;
  const complete = (response: Response, details: {
    outcome: 'success' | 'error' | 'rejected' | 'rate-limited';
    mode: 'thread' | 'search' | 'browse' | 'request';
    errorClass?: string;
    returnedCount?: number;
    total?: number;
    totalIsFloor?: boolean;
    totalRecovery?: boolean;
    errorName?: string;
  }): Response => {
    response.headers.set('x-correlation-id', correlationId);
    if (!completionLogged) {
      completionLogged = true;
      console.info(JSON.stringify({
        kind: 'route-completion',
        route: 'letters',
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        correlationId,
        dbCallCount,
        ...details,
      }));
    }
    return response;
  };
  const access = await requireApiAccess(true, '/api/letters', 'GET');
  if (access.response) {
    return complete(access.response, {
      outcome: 'error',
      mode: 'request',
      errorClass: 'authentication',
    });
  }
  const databaseFailure = (
    rpc: string,
    error: SupabaseErrorLike | null | undefined,
    mode: 'thread' | 'search' | 'browse',
    details: { totalRecovery?: boolean } = {}
  ): Response => {
    const classified = classifyDbError(error);
    return complete(
      dbErrorResponse({ route: 'letters', rpc, error, correlationId, startedAt }),
      { outcome: 'error', mode, errorClass: classified.errorClass, ...details }
    );
  };

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
    return complete(
      NextResponse.json({
        ok: false,
        error: 'Invalid or oversized letter query parameter.',
        errorClass: 'invalid-request',
        correlationId,
      }, { status: 400 }),
      { outcome: 'rejected', mode: 'request', errorClass: 'invalid-request' }
    );
  }

  const db = getWebSupabase();
  if (!db) {
    return complete(
      NextResponse.json({
        ok: false,
        error: 'Letter corpus is not configured with a restricted database role.',
        errorClass: 'configuration',
        correlationId,
      }, { status: 503 }),
      { outcome: 'error', mode: 'request', errorClass: 'configuration' }
    );
  }
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'letters' });
  if (!rate.allowed) {
    const rateResponse = rateLimitResponse(rate);
    const rateBody = await rateResponse.json() as { error?: string };
    const errorClass = rate.reason === 'unavailable' ? 'unexpected' : 'rate-limited';
    return complete(
      NextResponse.json({
        ok: false,
        error: rateBody.error || 'Request controls rejected this request.',
        errorClass,
        correlationId,
      }, { status: rateResponse.status, headers: rateResponse.headers }),
      { outcome: 'rate-limited', mode: 'request', errorClass }
    );
  }

  try {
    if (threadId) {
      dbCallCount += 1;
      const { data, error } = await db.rpc('urc_thread_detail', { p_thread_id: threadId });
      if (error) return databaseFailure('urc_thread_detail', error, 'thread');
      const rows = data ?? [];
      return complete(
        NextResponse.json({ thread: threadId, letters: rows }),
        { outcome: 'success', mode: 'thread', returnedCount: rows.length }
      );
    }

    if (q) {
      // Pagination contract (readiness audit R0): the ranked pool is 1,000
      // deep, so offsets beyond it are UNSUPPORTED — say so with a 422 and
      // coverage metadata rather than a 200 that reads as "no matches".
      const SUPPORTED_DEPTH = 1000;
      if (from >= SUPPORTED_DEPTH) {
        return complete(NextResponse.json(
          {
            ok: false,
            error: `Offsets beyond ${SUPPORTED_DEPTH} are not supported: results are ranked within the ${SUPPORTED_DEPTH} most recent matches.`,
            errorClass: 'invalid-request',
            supportedDepth: SUPPORTED_DEPTH,
            correlationId,
          },
          { status: 422 }
        ), { outcome: 'rejected', mode: 'search', errorClass: 'invalid-request' });
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
      dbCallCount += 1;
      const { data, error } = await db.rpc('urc_search_letters', searchParams);
      if (error) return databaseFailure('urc_search_letters', error, 'search');
      let rows = (data ?? []) as Array<Record<string, unknown>>;
      // An empty page inside the supported range means the offset ran past
      // the real matches — but the TRUE total lives on the rows we did not
      // get. Re-query page 0 for the total instead of fabricating a zero:
      // the audit's probe (offset 2000 on a 3,045-match query) got
      // { total: 0 } from this route, an authoritative-looking lie.
      let totalRows = rows;
      let totalRecovery = false;
      if (rows.length === 0 && from > 0) {
        totalRecovery = true;
        dbCallCount += 1;
        const retry = await db.rpc('urc_search_letters', { ...searchParams, p_limit: 1, p_offset: 0 });
        if (retry.error) {
          return databaseFailure('urc_search_letters', retry.error, 'search', { totalRecovery: true });
        }
        totalRows = (retry.data ?? []) as Array<Record<string, unknown>>;
        rows = [];
      }
      // Migration 017/018 caps count exactness at 10,000: 10,001 means
      // "more than 10,000", not a real total. Translate rather than display
      // it as if it were exact.
      const rawTotal = totalRows.length > 0 ? Number(totalRows[0].total_count) : 0;
      const totalIsFloor = rawTotal > 10_000;
      const total = totalIsFloor ? 10_000 : rawTotal;
      return complete(NextResponse.json({
        total,
        totalIsFloor,
        matches: rows.map(withoutTotalCount),
      }), {
        outcome: 'success',
        mode: 'search',
        returnedCount: rows.length,
        total,
        totalIsFloor,
        totalRecovery,
      });
    }

    const browseParams = {
      p_limit: size, p_offset: from, p_company: company, p_cik: cikParam,
    };
    dbCallCount += 1;
    const { data, error } = await db.rpc('urc_recent_threads', browseParams);
    if (error) return databaseFailure('urc_recent_threads', error, 'browse');
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    let totalRows = rows;
    let totalRecovery = false;
    if (rows.length === 0 && from > 0) {
      // The RPC carries total_count on each returned thread. Once an offset
      // runs past the last thread there is no row to carry that value, so a
      // literal zero would falsely claim the filtered corpus is empty. Recover
      // the total with one bounded page-0 probe using the identical filters.
      totalRecovery = true;
      dbCallCount += 1;
      const retry = await db.rpc('urc_recent_threads', {
        ...browseParams,
        p_limit: 1,
        p_offset: 0,
      });
      if (retry.error) {
        // Do not convert a failed total recovery into a verified zero.
        return databaseFailure('urc_recent_threads', retry.error, 'browse', { totalRecovery: true });
      }
      totalRows = (retry.data ?? []) as Array<Record<string, unknown>>;
    }
    const total = totalRows.length > 0 ? Number(totalRows[0].total_count) : 0;
    return complete(NextResponse.json({
      total,
      threads: rows.map(withoutTotalCount),
    }), {
      outcome: 'success',
      mode: 'browse',
      returnedCount: rows.length,
      total,
      totalRecovery,
    });
  } catch (error) {
    return complete(
      NextResponse.json(
        { ok: false, error: 'Letter query failed unexpectedly. Retry.', errorClass: 'unexpected', correlationId },
        { status: 502 }
      ),
      {
        outcome: 'error',
        mode: threadId ? 'thread' : q ? 'search' : 'browse',
        errorClass: 'unexpected',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }
    );
  }
}

export const GET = withRouteObservability('letters', handleGet);
