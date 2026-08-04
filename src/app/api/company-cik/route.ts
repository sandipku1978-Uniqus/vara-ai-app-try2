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
  looksLikeSecErrorResponse,
  readResponseWithLimit,
} from '../../../lib/sec-upstream';

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_ATOM_BYTES = 512 * 1024;
const SEC_ATOM_CONTENT_TYPE = /^(?:application\/atom\+xml|application\/xml|text\/xml)(?:;|$)/i;

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
    if (!response.ok) {
      return NextResponse.json({ ok: false, cik: null, error: 'SEC company lookup failed.' }, { status: 502 });
    }
    const contentType = response.headers.get('content-type')?.trim() || '';
    if (!SEC_ATOM_CONTENT_TYPE.test(contentType)) {
      return NextResponse.json(
        { ok: false, cik: null, error: 'SEC company lookup returned non-Atom content.' },
        { status: 502 },
      );
    }

    const bytes = await readResponseWithLimit(response, MAX_ATOM_BYTES, request.signal);
    if (looksLikeSecErrorResponse(bytes)) {
      return NextResponse.json(
        { ok: false, cik: null, error: 'SEC company lookup returned an error page.' },
        { status: 502 },
      );
    }
    const atom = new TextDecoder().decode(bytes);
    if (!/<feed(?:\s|>)/i.test(atom) || !/<\/feed>/i.test(atom)) {
      return NextResponse.json(
        { ok: false, cik: null, error: 'SEC company lookup returned malformed Atom.' },
        { status: 502 },
      );
    }
    const matches = Array.from(atom.matchAll(/<cik>(\d{1,10})<\/cik>/gi), match => match[1]);
    if (new Set(matches).size > 1) {
      return NextResponse.json(
        { ok: false, cik: null, error: 'SEC company lookup returned ambiguous CIK evidence.' },
        { status: 502 },
      );
    }
    const cik = matches[0] ? Number(matches[0]) : 0;
    // Unpadded, so it compares equal to the directory's CIK strings.
    return NextResponse.json({ ok: true, cik: cik > 0 ? String(cik) : null });
  } catch {
    // A lookup we cannot make is never worse than the directory value the
    // caller already holds — it falls back on null.
    return NextResponse.json(
      { ok: false, cik: null, error: 'SEC company lookup is unavailable.' },
      { status: 502 },
    );
  }
}
