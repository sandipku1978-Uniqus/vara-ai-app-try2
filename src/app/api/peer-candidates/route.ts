/**
 * GET /api/peer-candidates?sic=3571 — every listed registrant the company
 * store files under one SIC code.
 *
 * Benchmarking's "Quick Peer Group" used to walk the first 400 entries of
 * SEC's ticker map in the browser, read each one's submissions, and stop at
 * five matches — so the peers it offered depended on file order, and an
 * industry with its members past entry 400 found none. The company store
 * already carries SIC for every registrant it has seen (44k rows), so the
 * candidate population is one indexed read (urc_sec_companies_sic_idx).
 *
 * Only registrants with a ticker are returned: Benchmarking adds peers by
 * ticker, and a row without one cannot be added. The response says how many
 * matched and how many were returned so a capped list is never presented as
 * the whole industry.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { getWebSupabase } from '../../../lib/supabase-web';
import { withRouteObservability } from '../../../lib/route-observability';

/** Platform budget (seconds). One indexed read under the 25 s web-role HTTP deadline. */
export const maxDuration = 30;

/** Largest SIC populations with tickers run to a few hundred (7372 ≈ 300 rows in total). */
export const MAX_PEER_CANDIDATES = 500;

interface CompanyRow {
  cik: number | string;
  name: string | null;
  tickers: string[] | null;
  exchanges: string[] | null;
  sic: string | null;
  sic_description: string | null;
}

async function handleGet(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const sic = (new URL(request.url).searchParams.get('sic') || '').trim();
  if (!/^\d{3,4}$/.test(sic)) {
    return NextResponse.json({ error: 'Provide a three- or four-digit SIC code.' }, { status: 400 });
  }

  const db = getWebSupabase();
  if (!db) {
    return NextResponse.json({ error: 'Company store not configured with a restricted database role.' }, { status: 503 });
  }
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'peer-candidates' });
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const { data, error, count } = await db
      .from('urc_sec_companies')
      .select('cik, name, tickers, exchanges, sic, sic_description', { count: 'exact' })
      .eq('sic', sic)
      .neq('tickers', '{}')
      .order('cik', { ascending: true })
      .limit(MAX_PEER_CANDIDATES);
    if (error) {
      // An outage must not read as "no companies in this industry".
      console.error('[peer-candidates] read failed:', error);
      return NextResponse.json({ error: 'Company store temporarily unavailable.' }, { status: 503 });
    }

    const companies = ((data ?? []) as CompanyRow[]).flatMap(row => {
      const tickers = (row.tickers ?? []).filter(ticker => typeof ticker === 'string' && ticker.trim());
      if (tickers.length === 0) return [];
      return [{
        cik: String(row.cik),
        name: row.name ?? '',
        tickers,
        exchanges: row.exchanges ?? [],
        sic: row.sic ?? sic,
        sicDescription: row.sic_description ?? null,
      }];
    });

    return NextResponse.json({
      sic,
      companies,
      matched: typeof count === 'number' ? count : companies.length,
      returned: companies.length,
      // More rows matched than the read returned: the list is a prefix, not the industry.
      capped: typeof count === 'number' && count > (data?.length ?? 0),
      source: 'urc_sec_companies',
    });
  } catch (error) {
    console.error('[peer-candidates] failed:', error);
    return NextResponse.json({ error: 'Peer candidate lookup failed.' }, { status: 502 });
  }
}

export const GET = withRouteObservability('peer-candidates', handleGet);
