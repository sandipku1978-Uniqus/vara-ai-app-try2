/**
 * GET /api/company-cik?ticker=XOM — which CIK actually carries this ticker's
 * filing history.
 *
 * SEC's `company_tickers.json` follows the ticker, so a holding-company
 * reorganization leaves it pointing at the successor shell: XOM maps to CIK
 * 2115436 "ExxonMobil Holdings Corp" (created 2026-07-01, no annual report)
 * while Exxon's history sits on CIK 34088. EDGAR's own ticker lookup resolves
 * this correctly.
 *
 * It needs its own route because that lookup returns Atom, and /api/sec-proxy
 * runs every response through the HTML sanitizer — which strips <cik> and
 * leaves behind digits (including the registrant's phone number) that cannot
 * be told apart from a CIK. Parsing happens here, on the raw response, rather
 * than by loosening the sanitizer for everyone.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import {
  buildSecTargetUrl,
  fetchSecResponse,
  readResponseWithLimit,
} from '../../../lib/sec-upstream';

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_ATOM_BYTES = 512 * 1024;

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'company-cik' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const ticker = (new URL(request.url).searchParams.get('ticker') || '').trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    return NextResponse.json({ ok: false, error: 'Invalid ticker.' }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      action: 'getcompany',
      ticker,
      type: '10-K',
      dateb: '',
      owner: 'include',
      count: '1',
      output: 'atom',
    });
    const target = buildSecTargetUrl('proxy', 'cgi-bin/browse-edgar', params);
    const response = await fetchSecResponse(target, 'proxy', request.signal, USER_AGENT);
    if (!response.ok) return NextResponse.json({ ok: true, cik: null });

    const bytes = await readResponseWithLimit(response, MAX_ATOM_BYTES, request.signal);
    const atom = new TextDecoder().decode(bytes);

    const match = atom.match(/<cik>(\d{1,10})<\/cik>/i);
    // Unpadded, so it compares equal to the directory's CIK strings.
    return NextResponse.json({ ok: true, cik: match ? String(Number(match[1])) : null });
  } catch {
    // A lookup we cannot make is never worse than the directory value the
    // caller already holds — it falls back on null.
    return NextResponse.json({ ok: true, cik: null });
  }
}
