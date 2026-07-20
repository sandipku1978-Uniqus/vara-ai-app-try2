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

  try {
    if (threadId) {
      const { data, error } = await db.rpc('urc_thread_detail', { p_thread_id: threadId });
      if (error) throw new Error(error.message);
      return NextResponse.json({ thread: threadId, letters: data ?? [] });
    }

    if (q) {
      const { data, error } = await db.rpc('urc_search_letters', {
        p_query: q,
        p_form: form === 'UPLOAD' || form === 'CORRESP' ? form : null,
        p_start: startdt || null,
        p_end: enddt || null,
        p_limit: size,
        p_offset: from,
        p_company: company,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      return NextResponse.json({
        total: rows.length > 0 ? Number(rows[0].total_count) : 0,
        matches: rows.map(withoutTotalCount),
      });
    }

    const { data, error } = await db.rpc('urc_recent_threads', {
      p_limit: size, p_offset: from, p_company: company, p_cik: cikParam,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return NextResponse.json({
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
      threads: rows.map(withoutTotalCount),
    });
  } catch (error) {
    console.error('[letters] query failed:', error);
    return NextResponse.json({ error: 'Letter query failed' }, { status: 502 });
  }
}
