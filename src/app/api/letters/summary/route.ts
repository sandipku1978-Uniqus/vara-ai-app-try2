/**
 * GET /api/letters/summary?thread=<id> — persisted AI summary of a comment-
 * letter review episode: what the Staff pushed on, how the company responded,
 * how it resolved, and the round count. Generated once per thread with Claude
 * (grounded strictly in the letter texts), cached in urc_thread_summaries,
 * and regenerated only if the episode has grown since generation.
 */

import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkAiRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_LETTER_CHARS = 6000;
const MAX_LETTERS = 24;

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

interface LetterRow {
  form: string;
  date_filed: string;
  company_name: string;
  content: string | null;
}

const SUMMARY_PROMPT = `You are an SEC reporting specialist summarizing a comment-letter review episode between the SEC Staff (UPLOAD letters) and a registrant (CORRESP responses).

Using ONLY the letter texts provided, produce a compact markdown summary:

**Issues raised** — each distinct Staff challenge, with the accounting/disclosure topic (cite ASC/Reg references only if they appear in the letters).
**Company position** — how the registrant responded to each issue (revised disclosure, defended treatment, provided support).
**Resolution** — whether the record indicates the review closed, which issues were conceded vs. defended successfully, and anything left open.
**Rounds** — the number of Staff letters and the elapsed time.

Rules: quote key phrases sparingly; never invent issues, standards references, or outcomes not evidenced in the text; if letter texts are missing or truncated, say what cannot be determined.`;

export async function GET(request: Request) {
  const rate = checkAiRateLimit(request);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

  const db = getSupabase();
  if (!db) return NextResponse.json({ error: 'Letter corpus not configured' }, { status: 503 });

  const threadId = new URL(request.url).searchParams.get('thread');
  if (!threadId) return NextResponse.json({ error: "Missing 'thread'" }, { status: 400 });

  try {
    const { data: lettersData, error: lettersError } = await db
      .from('urc_comment_letters')
      .select('form, date_filed, company_name, content')
      .eq('thread_id', threadId)
      .order('date_filed', { ascending: true });
    if (lettersError) throw new Error(lettersError.message);
    const letters = (lettersData ?? []) as LetterRow[];
    if (letters.length === 0) return NextResponse.json({ error: 'Unknown thread' }, { status: 404 });

    // Cached and still current?
    const { data: cached } = await db
      .from('urc_thread_summaries')
      .select('summary, letters_count, model, generated_at')
      .eq('thread_id', threadId)
      .maybeSingle();
    if (cached && Number(cached.letters_count) === letters.length) {
      return NextResponse.json({
        thread: threadId,
        summary: cached.summary,
        model: cached.model,
        generatedAt: cached.generated_at,
        cached: true,
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Summary generation unavailable (no model key configured)' },
        { status: 503 }
      );
    }

    const withText = letters.filter(letter => letter.content);
    if (withText.length === 0) {
      return NextResponse.json(
        { error: 'Letter text not yet extracted for this thread — try again after the nightly backfill.' },
        { status: 409 }
      );
    }

    const transcript = letters.slice(0, MAX_LETTERS).map(letter =>
      `--- ${letter.form === 'UPLOAD' ? 'SEC STAFF LETTER' : 'COMPANY RESPONSE'} · ${letter.date_filed} ---\n` +
      (letter.content ? letter.content.slice(0, MAX_LETTER_CHARS) : '[text not yet extracted]')
    ).join('\n\n');

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      temperature: 0.2,
      system: [{ type: 'text', text: SUMMARY_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Registrant: ${letters[0].company_name}\nLetters in the episode: ${letters.length}\n\n${transcript}`,
      }],
    });

    const summary = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();
    if (!summary) throw new Error('empty generation');

    await db.from('urc_thread_summaries').upsert({
      thread_id: threadId,
      summary,
      letters_count: letters.length,
      model: CLAUDE_MODEL,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'thread_id' });

    return NextResponse.json({
      thread: threadId,
      summary,
      model: CLAUDE_MODEL,
      generatedAt: new Date().toISOString(),
      cached: false,
    });
  } catch (error) {
    console.error('[letters/summary] failed:', error);
    return NextResponse.json({ error: 'Summary generation failed' }, { status: 502 });
  }
}
