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
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

export async function GET(request: Request) {
  const db = getSupabase();
  if (!db) {
    return NextResponse.json({ error: 'Letter corpus is not configured' }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const threadId = params.get('thread');
  const q = (params.get('q') || '').trim();
  const form = params.get('form');
  const from = Math.max(0, Number(params.get('from') || 0) || 0);
  const size = Math.min(Math.max(Number(params.get('size') || 20) || 20, 1), 100);

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
        p_start: params.get('startdt') || null,
        p_end: params.get('enddt') || null,
        p_limit: size,
        p_offset: from,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      return NextResponse.json({
        total: rows.length > 0 ? Number(rows[0].total_count) : 0,
        matches: rows.map(({ total_count: _ignored, ...row }) => row),
      });
    }

    const { data, error } = await db.rpc('urc_recent_threads', { p_limit: size, p_offset: from });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return NextResponse.json({
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
      threads: rows.map(({ total_count: _ignored, ...row }) => row),
    });
  } catch (error) {
    console.error('[letters] query failed:', error);
    return NextResponse.json({ error: 'Letter query failed' }, { status: 502 });
  }
}
