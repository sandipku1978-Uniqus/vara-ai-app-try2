/**
 * GET /api/filing-scope — how many filings a search is being drawn from.
 *
 * A result list without a denominator cannot be read: fifty rows might be the
 * whole answer or the first page of thousands, and the reader has no way to
 * tell. The metadata corpus in Postgres (6.4M filings from 2010 onward) knows
 * the population exactly, so a search can say what it searched rather than
 * only what it found.
 *
 * This is the population count, NOT a keyword-match count — nothing here reads
 * filing text. Callers must present the two separately; conflating them would
 * claim every filing in scope matched the query.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { getWebSupabase } from '../../../lib/supabase-web';

/** Earliest filing in the corpus; anything before this is outside our coverage. */
export const CORPUS_START = '2010-01-02';

interface ScopeRow {
  year: number;
  filings: number;
  total_count: number;
}

export interface FilingScope {
  /** Filings matching the form/date/issuer scope. */
  total: number;
  /** Per-year counts, ascending — the shape of the corpus under this scope. */
  byYear: Array<{ year: number; filings: number }>;
  /** Range actually covered, so the caller never implies more than we hold. */
  coverageStart: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-scope' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const params = new URL(request.url).searchParams;
  const forms = (params.get('forms') || '')
    .split(',')
    .map(form => form.trim().toUpperCase())
    .filter(Boolean);
  const start = params.get('start');
  const end = params.get('end');
  const cik = params.get('cik');

  if ((start && !ISO_DATE.test(start)) || (end && !ISO_DATE.test(end))) {
    return NextResponse.json({ ok: false, error: 'Dates must be YYYY-MM-DD.' }, { status: 400 });
  }
  if (cik && !/^\d{1,10}$/.test(cik)) {
    return NextResponse.json({ ok: false, error: 'CIK must be numeric.' }, { status: 400 });
  }
  // Unscoped is allowed: the year/form rollup (migration 013) answers the whole
  // corpus in ~130ms. It is also the case that needs the denominator most —
  // on a broad search the reader has no other way to tell fifty rows from
  // fifty thousand.

  const db = getWebSupabase();
  if (!db) {
    // No metadata layer configured — the caller shows results without a
    // denominator, exactly as before this endpoint existed.
    return NextResponse.json({ ok: false, error: 'Metadata layer unavailable.' }, { status: 503 });
  }

  const { data, error } = await db.rpc('urc_filing_scope_stats', {
    p_forms: forms.length > 0 ? forms : null,
    p_start: start ?? null,
    p_end: end ?? null,
    p_cik: cik ? Number(cik) : null,
  });

  if (error) {
    console.error(`[filing-scope] ${error.message}`);
    return NextResponse.json({ ok: false, error: 'Scope lookup failed.' }, { status: 502 });
  }

  const rows = (data ?? []) as ScopeRow[];
  const scope: FilingScope = {
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
    byYear: rows.map(row => ({ year: Number(row.year), filings: Number(row.filings) })),
    coverageStart: CORPUS_START,
  };

  return NextResponse.json({ ok: true, scope });
}
