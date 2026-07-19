/**
 * GET /api/enrich?ciks=320193,789019 — batch issuer enrichment from the facet
 * store: current auditor (PCAOB Form AP) + SIC/tickers/exchange.
 *
 * One call replaces the per-company text-scraping hydration the search results
 * previously used for auditor display (slow, and broken for large filings).
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

const MAX_CIKS = 200;

export async function GET(request: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: 'Enrichment store not configured' }, { status: 503 });

  const raw = new URL(request.url).searchParams.get('ciks') || '';
  const ciks = Array.from(new Set(
    raw.split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value > 0)
  )).slice(0, MAX_CIKS);
  if (ciks.length === 0) {
    return NextResponse.json({ error: "Provide 'ciks' as a comma-separated list" }, { status: 400 });
  }

  try {
    const [auditorsResult, companiesResult] = await Promise.all([
      db.from('urc_current_auditors').select('issuer_cik, firm_canonical, fiscal_period_end').in('issuer_cik', ciks),
      db.from('urc_sec_companies').select('cik, sic, sic_description, tickers, exchanges, state_of_incorporation').in('cik', ciks),
    ]);

    const result: Record<string, Record<string, unknown>> = {};
    for (const cik of ciks) result[String(cik)] = {};
    for (const row of auditorsResult.data ?? []) {
      result[String(row.issuer_cik)] = {
        ...result[String(row.issuer_cik)],
        auditor: row.firm_canonical,
        auditor_period_end: row.fiscal_period_end,
      };
    }
    for (const row of companiesResult.data ?? []) {
      result[String(row.cik)] = {
        ...result[String(row.cik)],
        sic: row.sic ?? null,
        sic_description: row.sic_description ?? null,
        tickers: row.tickers ?? [],
        exchanges: row.exchanges ?? [],
        state_of_incorporation: row.state_of_incorporation ?? null,
      };
    }

    return NextResponse.json({ companies: result });
  } catch (error) {
    console.error('[enrich] failed:', error);
    return NextResponse.json({ error: 'Enrichment failed' }, { status: 502 });
  }
}
