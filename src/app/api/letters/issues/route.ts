/**
 * GET /api/letters/issues?thread=<id> — the issue-level split of a review
 * episode: each Staff comment, the filing section it concerns, the company's
 * response excerpt, later follow-ups, and an evidence-based status.
 *
 * Deterministic (no model call). Results are stored in urc_letter_issues
 * (migration 027) by the audited service-role cache writer — the same
 * posture as urc_thread_summaries — and served from storage while the
 * episode's letters and text are unchanged; any change regenerates them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { getCacheWriterSupabase, getWebSupabase } from '../../../../lib/supabase-web';
import { withRouteObservability } from '../../../../lib/route-observability';
import { orderEpisodeLetters, type IssueLetter } from '../../../../services/commentIssues';
import {
  computeEpisodeIssues,
  episodeFingerprint,
  episodeFromRows,
  issueRowsFromEpisode,
  storedIssuesAreCurrent,
  type LetterIssueRow,
} from '../../../../services/commentLetterIssueStore';
import { MAX_COMMENT_LETTERS_PER_SUMMARY } from '../../../../services/commentLetterSummary';

/**
 * Platform budget (seconds): two reads under the 25 s web HTTP deadline and,
 * on a miss, one bounded delete + upsert under the cache writer's 30 s
 * deadline. The split itself is CPU-only and runs in milliseconds.
 */
export const maxDuration = 60;

const THREAD_ID_PATTERN = /^[A-Za-z0-9:._-]{1,160}$/;

interface LetterRow {
  accession: string;
  cik: number;
  form: string;
  date_filed: string;
  company_name: string | null;
  content: string | null;
}

async function loadEpisode(db: SupabaseClient, threadId: string) {
  const [lettersResult, storedResult] = await Promise.all([
    db
      .from('urc_comment_letters')
      .select('accession, cik, form, date_filed, company_name, content')
      .eq('thread_id', threadId)
      .order('date_filed', { ascending: true })
      .limit(MAX_COMMENT_LETTERS_PER_SUMMARY + 1),
    db
      .from('urc_letter_issues')
      .select('thread_id, staff_accession, cik, staff_date, round, letter_kind, issues, parser_version, episode_fingerprint, generated_at')
      .eq('thread_id', threadId)
      .limit(MAX_COMMENT_LETTERS_PER_SUMMARY + 1),
  ]);
  if (lettersResult.error) throw new Error(lettersResult.error.message);
  return {
    letters: (lettersResult.data || []) as LetterRow[],
    stored: storedResult.error ? null : (storedResult.data || []) as LetterIssueRow[],
    storedError: storedResult.error?.message ?? null,
  };
}

async function storeIssues(threadId: string, rows: LetterIssueRow[]): Promise<boolean> {
  const writer = getCacheWriterSupabase();
  if (!writer) {
    console.warn('[letters/issues] cache writer unavailable; issues served unstored.');
    return false;
  }
  // Best-effort, like the summary cache: a failed write never turns a
  // computed answer into an error. Rows for Staff letters no longer in the
  // episode (rethreading) are removed first.
  const keep = rows.map(row => row.staff_accession);
  let remove = writer.from('urc_letter_issues').delete().eq('thread_id', threadId);
  if (keep.length > 0) remove = remove.not('staff_accession', 'in', `(${keep.map(value => `"${value}"`).join(',')})`);
  const { error: deleteError } = await remove;
  if (deleteError) {
    console.error(`[letters/issues] stale-row cleanup failed: ${deleteError.message}`);
    return false;
  }
  if (rows.length === 0) return true;
  const { error } = await writer.from('urc_letter_issues').upsert(rows, { onConflict: 'thread_id,staff_accession' });
  if (error) {
    console.error(`[letters/issues] store failed: ${error.message}`);
    return false;
  }
  return true;
}

async function handleGet(request: Request): Promise<Response> {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const threadId = new URL(request.url).searchParams.get('thread')?.trim() || '';
  if (!THREAD_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "Missing or invalid 'thread'" }, { status: 400 });
  }
  const db = getWebSupabase();
  if (!db) return NextResponse.json({ error: 'Letter corpus not configured' }, { status: 503 });
  const rate = await checkResourceRateLimit(request, access.identity, {
    operation: 'letter-issues',
    userLimit: 120,
    orgLimit: 600,
    ipLimit: 180,
  });
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const { letters: rows, stored, storedError } = await loadEpisode(db, threadId);
    if (rows.length === 0) return NextResponse.json({ error: 'Unknown thread' }, { status: 404 });
    if (rows.length > MAX_COMMENT_LETTERS_PER_SUMMARY) {
      return NextResponse.json({
        error: `This review episode has more than ${MAX_COMMENT_LETTERS_PER_SUMMARY} letters; open the letters directly. No issues were split from a partial episode.`,
      }, { status: 422 });
    }
    if (storedError) console.error(`[letters/issues] stored read failed: ${storedError}`);

    const letters: IssueLetter[] = orderEpisodeLetters(rows.map(row => ({
      accession: row.accession,
      cik: row.cik,
      form: row.form,
      date_filed: String(row.date_filed).slice(0, 10),
      content: row.content,
    })));
    const fingerprint = episodeFingerprint(letters);
    const headers = { 'Cache-Control': 'private, no-store' };
    const company = rows[0].company_name || null;

    if (stored && storedIssuesAreCurrent(stored, letters, fingerprint)) {
      return NextResponse.json({
        thread: threadId,
        company,
        episode: episodeFromRows(stored, letters),
        generatedAt: stored.reduce((latest, row) => (row.generated_at > latest ? row.generated_at : latest), ''),
        stored: true,
      }, { headers });
    }

    const { episode } = computeEpisodeIssues(letters);
    const generatedAt = new Date().toISOString();
    const saved = await storeIssues(threadId, issueRowsFromEpisode(threadId, episode, fingerprint, generatedAt));
    return NextResponse.json({
      thread: threadId,
      company,
      episode,
      generatedAt,
      stored: saved,
    }, { headers });
  } catch (error) {
    console.error('[letters/issues] failed:', error);
    return NextResponse.json({ error: 'Issue split failed' }, { status: 502 });
  }
}

export const GET = withRouteObservability('letters/issues', handleGet);
