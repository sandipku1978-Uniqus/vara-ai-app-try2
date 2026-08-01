/**
 * POST /api/boolean-validate — evaluate a Boolean expression against candidate
 * filings on the server.
 *
 * Validation used to happen in the browser: each user downloaded up to 120
 * filings into their own tab to decide which ones matched. That made the
 * document budget a hard ceiling on RECALL rather than a cost limit, because
 * nothing was shared and every run started cold.
 *
 * Here the client sends candidate identifiers and receives verdicts. Filing text
 * is read through the shared cache (so a document any user has validated before
 * costs nothing), evaluated with the same pure matcher the browser uses, and
 * only the verdict plus a short excerpt crosses the wire — kilobytes instead of
 * megabytes.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { getCacheWriterSupabase, getWebSupabase } from '../../../lib/supabase-web';
import { extractDocumentTextFromHtmlServer } from '../../../lib/filingTextServer';
import { booleanQueryMatches, compileBooleanQuery, extractBooleanMatchSnippet } from '../../../utils/booleanSearch';
import {
  assertSecDocumentResponse,
  buildSecTargetUrl,
  fetchSecResponse,
  readResponseWithLimit,
} from '../../../lib/sec-upstream';

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const CACHE_TABLE = 'urc_filing_text';
/** Bounded per request so one call cannot monopolise a function invocation. */
const MAX_CANDIDATES = 40;
/** Parallel document fetches — enough to be fast, gentle on SEC. */
const FETCH_CONCURRENCY = 4;
/**
 * Stop starting new batches after this long and return what has been decided.
 * A cold run over uncached filings can outlast the caller's patience; returning
 * partial verdicts is strictly better than returning none, because everything
 * undecided is reported unvalidated and simply falls back to the client path.
 */
const SOFT_DEADLINE_MS = 15_000;

/** Well under the platform ceiling, well above the soft deadline above. */
export const maxDuration = 60;

interface Candidate {
  cik: string;
  accession: string;
  document: string;
}

interface Verdict extends Candidate {
  matched: boolean;
  /** Absent text is NOT a non-match; the caller must not score it as one. */
  validated: boolean;
  excerpt?: string;
}

function sanitize(value: unknown): Candidate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const cik = String(raw.cik ?? '').replace(/\D/g, '');
  const accession = String(raw.accession ?? '').replace(/[^0-9-]/g, '').replace(/-/g, '');
  const document = String(raw.document ?? '');
  if (!cik || !accession || !/^[A-Za-z0-9._-]+$/.test(document)) return null;
  return { cik, accession, document };
}

/**
 * Cache first; fetch and store on a miss. Returns '' when unavailable.
 *
 * Deliberately does NOT thread the client's abort signal into the SEC fetch:
 * a candidate fetched here is written to the shared urc_filing_text cache,
 * so finishing an in-flight document after the caller disconnects warms the
 * cache for every future user rather than wasting the SEC request.
 */
async function loadText(candidate: Candidate): Promise<string> {
  const db = getWebSupabase();
  if (db) {
    const { data } = await db
      .from(CACHE_TABLE)
      .select('text')
      .eq('cik', candidate.cik)
      .eq('accession', candidate.accession)
      .eq('document', candidate.document)
      .maybeSingle();
    if (data?.text) return data.text;
  }

  try {
    const target = buildSecTargetUrl(
      'proxy',
      `Archives/edgar/data/${candidate.cik}/${candidate.accession}/${candidate.document}`,
      new URLSearchParams(),
    );
    const response = await fetchSecResponse(target, 'proxy', new AbortController().signal, USER_AGENT);
    // An error page or binary document is never filing text: extracting it
    // would both cache-poison urc_filing_text AND hand the matcher prose that
    // yields a false "validated non-match" verdict. Throwing lands in the
    // catch below, which reports the candidate as unvalidated.
    assertSecDocumentResponse(response);
    const bytes = await readResponseWithLimit(response, MAX_DOCUMENT_BYTES, new AbortController().signal);
    const text = extractDocumentTextFromHtmlServer(new TextDecoder().decode(bytes));

    if (text) {
      const writer = getCacheWriterSupabase();
      if (writer) {
        void writer
          .from(CACHE_TABLE)
          .upsert(
            { ...candidate, text, bytes: text.length },
            { onConflict: 'cik,accession,document' },
          )
          .then((result: { error: { message: string } | null }) => {
            if (result.error) console.error(`[boolean-validate] cache write failed: ${result.error.message}`);
          });
      }
    }
    return text;
  } catch {
    // A fetch failure is reported as unvalidated, never as a non-match.
    return '';
  }
}

export async function POST(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'boolean-validate' });
  if (!rate.allowed) return rateLimitResponse(rate);

  let body: { query?: unknown; candidates?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query : '';
  // Same compiler as every other caller: an invalid expression must issue zero
  // document fetches, here as everywhere else.
  const compiled = compileBooleanQuery(query);
  if (!compiled.ok) {
    return NextResponse.json({ ok: false, error: compiled.message }, { status: 400 });
  }

  const candidates = (Array.isArray(body.candidates) ? body.candidates : [])
    .map(sanitize)
    .filter((item): item is Candidate => item !== null)
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, verdicts: [] });
  }

  const expression = compiled.residual || query;
  const startedAt = Date.now();
  const verdicts: Verdict[] = [];

  for (let index = 0; index < candidates.length; index += FETCH_CONCURRENCY) {
    const batch = candidates.slice(index, index + FETCH_CONCURRENCY);

    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      // Out of budget: report the rest as undecided rather than as non-matches.
      verdicts.push(...candidates.slice(index).map(c => ({ ...c, matched: false, validated: false })));
      break;
    }

    const settled = await Promise.all(
      batch.map(async (candidate): Promise<Verdict> => {
        const text = await loadText(candidate);
        if (!text) return { ...candidate, matched: false, validated: false };

        const matched = booleanQueryMatches(expression, text);
        const snippet = matched ? extractBooleanMatchSnippet(expression, text)?.excerpt : undefined;
        return { ...candidate, matched, validated: true, excerpt: snippet };
      }),
    );
    verdicts.push(...settled);
  }

  return NextResponse.json({
    ok: true,
    verdicts,
    // Lets the caller keep coverage honest without re-deriving it.
    summary: {
      requested: candidates.length,
      validated: verdicts.filter(v => v.validated).length,
      matched: verdicts.filter(v => v.matched).length,
    },
  });
}
