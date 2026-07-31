/**
 * GET /api/filing-text — extracted filing text, read through a shared cache.
 *
 * Every Boolean validation and topic comparison needs a filing's text. Until
 * now each user fetched the raw HTML into their own browser and extracted it
 * there, so nothing was ever reused — two analysts on the same peer group each
 * paid full cost, and neither warmed anything for the other. That is why the
 * per-run document budget is a hard ceiling on recall rather than a cost limit.
 *
 * This serves extracted TEXT (not HTML): a cache hit is instant and costs SEC
 * nothing, a miss fetches once and stores the result for everyone. It also
 * shrinks the client payload substantially, since markup never crosses the wire.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { getCacheWriterSupabase, getWebSupabase } from '../../../lib/supabase-web';
import { extractDocumentTextFromHtmlServer } from '../../../lib/filingTextServer';
import {
  buildSecTargetUrl,
  fetchSecResponse,
  readResponseWithLimit,
  SecUpstreamError,
} from '../../../lib/sec-upstream';

/** The platform default would kill this route mid-flight; see the in-route budgets. */
export const maxDuration = 60;

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Filing documents are immutable once filed, so a hit never needs revalidation. */
const CACHE_TABLE = 'urc_filing_text';

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-text' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const url = new URL(request.url);
  const cik = (url.searchParams.get('cik') || '').replace(/\D/g, '');
  const accession = (url.searchParams.get('accession') || '').replace(/[^0-9-]/g, '');
  const document = url.searchParams.get('document') || '';

  if (!cik || !accession || !document) return badRequest('cik, accession and document are required.');
  // The document name becomes part of an SEC path; keep it to a bare filename.
  if (!/^[A-Za-z0-9._-]+$/.test(document)) return badRequest('Invalid document name.');

  const cleanAccession = accession.replace(/-/g, '');

  // ── Cache read (least-privilege role) ──
  // A cache-layer transport failure must degrade to a cache MISS (the SEC
  // fetch below still serves the request), never to a bare 500.
  const db = getWebSupabase();
  if (db) {
    try {
      const { data } = await db
        .from(CACHE_TABLE)
        .select('text')
        .eq('cik', cik)
        .eq('accession', cleanAccession)
        .eq('document', document)
        .maybeSingle();

      if (data?.text) {
        return NextResponse.json(
          { ok: true, text: data.text, cached: true },
          { headers: { 'Cache-Control': 'private, max-age=3600' } },
        );
      }
    } catch (error) {
      console.error('[filing-text] cache read failed; falling through to SEC:', error);
    }
  }

  // ── Miss: fetch once, extract, share ──
  let text: string;
  try {
    const target = buildSecTargetUrl('proxy', `Archives/edgar/data/${cik}/${cleanAccession}/${document}`, new URLSearchParams());
    const response = await fetchSecResponse(target, 'proxy', request.signal, USER_AGENT);
    const bytes = await readResponseWithLimit(response, MAX_DOCUMENT_BYTES, request.signal);
    text = extractDocumentTextFromHtmlServer(new TextDecoder().decode(bytes));
  } catch (error) {
    const status = error instanceof SecUpstreamError ? error.status : 502;
    return NextResponse.json({ ok: false, error: 'Filing text could not be retrieved.' }, { status });
  }

  // Storing is best-effort: the caller already has its answer, and a cache
  // write failure must never turn a successful fetch into an error.
  if (text) {
    const writer = getCacheWriterSupabase();
    if (writer) {
      void writer
        .from(CACHE_TABLE)
        .upsert(
          { cik, accession: cleanAccession, document, text, bytes: text.length },
          { onConflict: 'cik,accession,document' },
        )
        .then((result: { error: { message: string } | null }) => {
          if (result.error) console.error(`[filing-text] cache write failed: ${result.error.message}`);
        });
    }
  }

  return NextResponse.json(
    { ok: true, text, cached: false },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  );
}
