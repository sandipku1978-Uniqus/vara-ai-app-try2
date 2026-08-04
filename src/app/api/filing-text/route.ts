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
import {
  acquireResourceConcurrency,
  checkResourceRateLimit,
  rateLimitResponse,
  releaseAiConcurrency,
} from '../../../lib/rate-limit';
import { getCacheWriterSupabase, getWebSupabase } from '../../../lib/supabase-web';
import { extractDocumentTextFromHtmlServer } from '../../../lib/filingTextServer';
import {
  assertSecDocumentResponse,
  buildSecTargetUrl,
  fetchSecResponse,
  looksLikeSecErrorResponse,
  looksLikeSecErrorText,
  readResponseWithLimit,
  SEC_DOCUMENT_CONCURRENCY_OPTIONS,
  SecUpstreamError,
} from '../../../lib/sec-upstream';

/** The platform default would kill this route mid-flight; see the in-route budgets. */
export const maxDuration = 60;

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_NAME_LENGTH = 255;
/** Filing documents are immutable once filed, so a hit never needs revalidation. */
const CACHE_TABLE = 'urc_filing_text';
const SOURCE_VALIDATION_VERSION = 1;
const CACHE_MUTATION_TIMEOUT_MS = 2_000;

interface CacheMutationResult {
  error: { message: string } | null;
}

async function settleCacheMutation(
  label: string,
  mutation: () => PromiseLike<CacheMutationResult>,
): Promise<void> {
  const timedOut = Symbol('cache-mutation-timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve(mutation()),
      new Promise<typeof timedOut>(resolve => {
        timer = setTimeout(() => resolve(timedOut), CACHE_MUTATION_TIMEOUT_MS);
      }),
    ]);
    if (result === timedOut) {
      console.error(`[filing-text] ${label} timed out.`);
    } else if (result.error) {
      console.error(`[filing-text] ${label} failed: ${result.error.message}`);
    }
  } catch (error) {
    console.error(`[filing-text] ${label} failed:`, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const access = await requireApiAccess(true, '/api/filing-text', 'GET');
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-text' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const url = new URL(request.url);
  const rawCik = url.searchParams.get('cik') || '';
  const rawAccession = url.searchParams.get('accession') || '';
  const document = url.searchParams.get('document') || '';

  if (!/^\d{1,10}$/.test(rawCik) || /^0+$/.test(rawCik)) {
    return badRequest('cik must contain 1 to 10 digits and identify a nonzero issuer.');
  }
  if (!/^(?:\d{18}|\d{10}-\d{2}-\d{6})$/.test(rawAccession)) {
    return badRequest('accession must contain exactly 18 digits, optionally in 10-2-6 dashed form.');
  }
  // The document becomes part of an SEC path and shared cache key. Require a
  // bounded basename rather than repairing attacker-controlled input.
  if (
    document.length === 0
    || document.length > MAX_DOCUMENT_NAME_LENGTH
    || document.includes('..')
    || !/^[A-Za-z0-9._-]+$/.test(document)
  ) {
    return badRequest('Invalid document name.');
  }

  const cik = rawCik.replace(/^0+/, '');
  const cleanAccession = rawAccession.replace(/-/g, '');

  // ── Cache read (least-privilege role) ──
  // A cache-layer transport failure must degrade to a cache MISS (the SEC
  // fetch below still serves the request), never to a bare 500.
  const db = getWebSupabase();
  if (db) {
    try {
      const { data } = await db
        .from(CACHE_TABLE)
        .select('text, source_validation_version')
        .eq('cik', cik)
        .eq('accession', cleanAccession)
        .eq('document', document)
        .maybeSingle();

      if (data?.text) {
        // Revalidate on READ (audit R1): rows cached before the fetch-time
        // guard existed can hold SEC error pages as if they were filing
        // text. A poisoned row is deleted (best-effort, service role) and
        // the request falls through to a live fetch — self-healing, one row
        // at a time, no bulk migration over 100k+ cached documents.
        const poisonSignature = looksLikeSecErrorText(data.text);
        const sourceValidated = data.source_validation_version === SOURCE_VALIDATION_VERSION;
        if (sourceValidated && !poisonSignature) {
          return NextResponse.json(
            { ok: true, text: data.text, cached: true },
            { headers: { 'Cache-Control': 'private, max-age=3600' } },
          );
        }
        const reason = poisonSignature
          ? `SEC error page detected ("${poisonSignature}")`
          : 'legacy row lacks raw-response validation provenance';
        console.error(`[filing-text] cached ${reason} for ${cik}/${cleanAccession}/${document}; purging and refetching.`);
        const writer = getCacheWriterSupabase();
        if (writer) {
          await settleCacheMutation(
            'poison purge',
            () => writer
              .from(CACHE_TABLE)
              .delete()
              .eq('cik', cik)
              .eq('accession', cleanAccession)
              .eq('document', document),
          );
        }
      }
    } catch (error) {
      console.error('[filing-text] cache read failed; falling through to SEC:', error);
    }
  }

  // ── Miss: fetch once, extract, share ──
  const capacity = await acquireResourceConcurrency(
    request,
    access.identity,
    SEC_DOCUMENT_CONCURRENCY_OPTIONS,
  );
  if (!capacity.allowed) return rateLimitResponse(capacity);

  let text: string;
  try {
    const target = buildSecTargetUrl('proxy', `Archives/edgar/data/${cik}/${cleanAccession}/${document}`, new URLSearchParams());
    const response = await fetchSecResponse(target, 'proxy', request.signal, USER_AGENT);
    // An SEC error page or binary document must never be extracted or cached
    // as filing text — the cache is shared and treated as immutable.
    assertSecDocumentResponse(response);
    const bytes = await readResponseWithLimit(response, MAX_DOCUMENT_BYTES, request.signal);
    if (looksLikeSecErrorResponse(bytes)) {
      throw new SecUpstreamError('SEC returned an error page with a successful HTTP status.', 502);
    }
    text = extractDocumentTextFromHtmlServer(new TextDecoder().decode(bytes));
    if (looksLikeSecErrorText(text)) {
      throw new SecUpstreamError('SEC returned an error page with a successful HTTP status.', 502);
    }
  } catch (error) {
    const status = error instanceof SecUpstreamError ? error.status : 502;
    return NextResponse.json({ ok: false, error: 'Filing text could not be retrieved.' }, { status });
  } finally {
    await releaseAiConcurrency(capacity.lease);
  }

  // Storing is best-effort: the caller already has its answer, and a cache
  // write failure must never turn a successful fetch into an error.
  if (text) {
    const writer = getCacheWriterSupabase();
    if (writer) {
      await settleCacheMutation(
        'cache write',
        () => writer.from(CACHE_TABLE).upsert(
          {
            cik,
            accession: cleanAccession,
            document,
            text,
            bytes: text.length,
            source_validation_version: SOURCE_VALIDATION_VERSION,
          },
          { onConflict: 'cik,accession,document' },
        ),
      );
    }
  }

  return NextResponse.json(
    { ok: true, text, cached: false },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  );
}
