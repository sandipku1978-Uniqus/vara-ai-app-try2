/**
 * GET /api/stats — data-layer coverage/freshness for the UI trust chips
 * (design-system §1.4: accountants won't cite what they can't source).
 * Cached for 10 minutes; counts are planner estimates so the query is instant.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 600;

export async function GET() {
  const url = process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Stats not configured' }, { status: 503 });

  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('urc_data_stats');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      filings: { count: Number(row?.filings_estimate ?? 0), through: row?.filings_through ?? null, source: 'SEC EDGAR master index' },
      auditors: { count: Number(row?.auditors_estimate ?? 0), source: 'PCAOB Form AP' },
      letters: {
        count: Number(row?.letters_estimate ?? 0),
        withText: Number(row?.letters_with_text ?? 0),
        through: row?.letters_through ?? null,
        source: 'SEC EDGAR (UPLOAD/CORRESP)',
      },
    });
  } catch (error) {
    console.error('[stats] failed:', error);
    return NextResponse.json({ error: 'Stats failed' }, { status: 502 });
  }
}
