/**
 * GET /api/enrich?ciks=320193,789019 — batch issuer enrichment from the facet
 * store: current auditor (PCAOB Form AP) + SIC/tickers/exchange.
 *
 * One call replaces the per-company text-scraping hydration the search results
 * previously used for auditor display (slow, and broken for large filings).
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { parseCik } from '../../../lib/api-query';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { getWebSupabase } from '../../../lib/supabase-web';

const MAX_CIKS = 200;

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const raw = new URL(request.url).searchParams.get('ciks') || '';
  if (raw.length > 2400) return NextResponse.json({ error: 'CIK list is too large.' }, { status: 413 });
  const parsedCiks = raw.split(',').map(parseCik);
  if (parsedCiks.some(cik => cik === null)) {
    return NextResponse.json({ error: 'Every CIK must contain 1 to 10 digits.' }, { status: 400 });
  }
  const ciks = Array.from(new Set(parsedCiks as number[]));
  if (ciks.length === 0) {
    return NextResponse.json({ error: "Provide 'ciks' as a comma-separated list" }, { status: 400 });
  }
  if (ciks.length > MAX_CIKS) {
    return NextResponse.json({ error: `Maximum ${MAX_CIKS} CIKs per request.` }, { status: 400 });
  }

  const db = getWebSupabase();
  if (!db) return NextResponse.json({ error: 'Enrichment store not configured with a restricted database role.' }, { status: 503 });
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'enrich' });
  if (!rate.allowed) return rateLimitResponse(rate);

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
