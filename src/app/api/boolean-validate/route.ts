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
import {
  acquireResourceConcurrency,
  checkResourceRateLimit,
  rateLimitResponse,
  releaseAiConcurrency,
} from '../../../lib/rate-limit';
import { getCacheWriterSupabase, getWebSupabase } from '../../../lib/supabase-web';
import { extractDocumentTextFromHtmlServer } from '../../../lib/filingTextServer';
import { booleanQueryMatches, compileBooleanQuery, extractBooleanMatchSnippet } from '../../../utils/booleanSearch';
import {
  assertSecDocumentResponse,
  buildSecTargetUrl,
  fetchSecResponse,
  looksLikeSecErrorResponse,
  looksLikeSecErrorText,
  readResponseWithLimit,
  SEC_DOCUMENT_CONCURRENCY_OPTIONS,
} from '../../../lib/sec-upstream';

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const CACHE_TABLE = 'urc_filing_text';
const SOURCE_VALIDATION_VERSION = 1;
const CACHE_MUTATION_TIMEOUT_MS = 2_000;
/** Bounded per request so one call cannot monopolise a function invocation. */
const MAX_CANDIDATES = 40;
const MAX_DOCUMENT_NAME_LENGTH = 255;
/** Parallel document fetches — enough to be fast, gentle on SEC. */
const FETCH_CONCURRENCY = 4;
/** A candidate can make one initial SEC request plus at most three validated
 * redirects in fetchSecResponse. This cap is also the default when an older
 * caller does not send an explicit remaining budget. */
const MAX_SEC_ATTEMPTS = MAX_CANDIDATES * 4;
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

interface ValidationWork {
  maxUpstreamAttempts: number;
  upstreamAttempts: number;
  cacheHits: number;
  budgetExhausted: boolean;
}

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
      console.error(`[boolean-validate] ${label} timed out.`);
    } else if (result.error) {
      console.error(`[boolean-validate] ${label} failed: ${result.error.message}`);
    }
  } catch (error) {
    console.error(`[boolean-validate] ${label} failed:`, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sanitize(value: unknown): Candidate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const rawCik = String(raw.cik ?? '').trim();
  const rawAccession = String(raw.accession ?? '').trim();
  const document = String(raw.document ?? '').trim();
  if (!/^\d{1,10}$/.test(rawCik)) return null;
  const cik = rawCik.replace(/^0+/, '');
  if (!cik) return null;
  if (!/^(?:\d{18}|\d{10}-\d{2}-\d{6})$/.test(rawAccession)) return null;
  const accession = rawAccession.replace(/-/g, '');
  if (
    document.length === 0
    || document.length > MAX_DOCUMENT_NAME_LENGTH
    || document.includes('..')
    || !/^[A-Za-z0-9._-]+$/.test(document)
  ) return null;
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
async function loadText(
  candidate: Candidate,
  work: ValidationWork,
  request: Request,
  identity: Parameters<typeof acquireResourceConcurrency>[1],
): Promise<string> {
  const db = getWebSupabase();
  if (db) {
    try {
      const { data } = await db
        .from(CACHE_TABLE)
        .select('text, source_validation_version')
        .eq('cik', candidate.cik)
        .eq('accession', candidate.accession)
        .eq('document', candidate.document)
        .maybeSingle();
      if (data?.text) {
        // Rows written before the response guard existed can contain an SEC
        // rate-limit/error page. Boolean validation must apply the same
        // read-time guard as /api/filing-text: never score poisoned prose as a
        // validated filing, purge it best-effort, and re-fetch the document.
        const poisonSignature = looksLikeSecErrorText(data.text);
        const sourceValidated = data.source_validation_version === SOURCE_VALIDATION_VERSION;
        if (sourceValidated && !poisonSignature) {
          work.cacheHits += 1;
          return data.text;
        }

        const reason = poisonSignature
          ? `SEC error page detected ("${poisonSignature}")`
          : 'legacy row lacks raw-response validation provenance';
        console.error(`[boolean-validate] cached ${reason} for ${candidate.cik}/${candidate.accession}/${candidate.document}; purging and refetching.`);
        const writer = getCacheWriterSupabase();
        if (writer) {
          await settleCacheMutation(
            'poison purge',
            () => writer
              .from(CACHE_TABLE)
              .delete()
              .eq('cik', candidate.cik)
              .eq('accession', candidate.accession)
              .eq('document', candidate.document),
          );
        }
      }
    } catch (error) {
      // The shared cache is an accelerator. A read outage must fall through to
      // SEC and leave the candidate decidable, not fail the whole batch.
      console.error('[boolean-validate] cache read failed; falling through to SEC:', error);
    }
  }

  const capacity = await acquireResourceConcurrency(
    request,
    identity,
    SEC_DOCUMENT_CONCURRENCY_OPTIONS,
  );
  if (!capacity.allowed) {
    work.budgetExhausted = true;
    return '';
  }

  let text: string;
  try {
    // Keep target construction in the guarded path as a second line of
    // defence. A rejected SEC path yields an undecided candidate and still
    // releases the shared document lease; it cannot reject the whole batch.
    const target = buildSecTargetUrl(
      'proxy',
      `Archives/edgar/data/${candidate.cik}/${candidate.accession}/${candidate.document}`,
      new URLSearchParams(),
    );
    const response = await fetchSecResponse(
      target,
      'proxy',
      new AbortController().signal,
      USER_AGENT,
      () => {
        // This reservation occurs before the real fetch and on every redirect.
        // The route therefore cannot exceed the caller's remaining allowance,
        // even when several candidate loads are running concurrently.
        if (work.upstreamAttempts >= work.maxUpstreamAttempts) {
          work.budgetExhausted = true;
          return false;
        }
        work.upstreamAttempts += 1;
        return true;
      },
    );
    // An error page or binary document is never filing text: extracting it
    // would both cache-poison urc_filing_text AND hand the matcher prose that
    // yields a false "validated non-match" verdict. Throwing lands in the
    // catch below, which reports the candidate as unvalidated.
    assertSecDocumentResponse(response);
    const bytes = await readResponseWithLimit(response, MAX_DOCUMENT_BYTES, new AbortController().signal);
    if (looksLikeSecErrorResponse(bytes)) {
      throw new Error('SEC returned an error page with a successful HTTP status.');
    }
    text = extractDocumentTextFromHtmlServer(new TextDecoder().decode(bytes));
    if (looksLikeSecErrorText(text)) {
      throw new Error('SEC returned an error page with a successful HTTP status.');
    }
  } catch {
    // A fetch failure is reported as unvalidated, never as a non-match.
    return '';
  } finally {
    await releaseAiConcurrency(capacity.lease);
  }

  if (text) {
    const writer = getCacheWriterSupabase();
    if (writer) {
      await settleCacheMutation(
        'cache write',
        () => writer.from(CACHE_TABLE).upsert(
          {
            ...candidate,
            text,
            bytes: text.length,
            source_validation_version: SOURCE_VALIDATION_VERSION,
          },
          { onConflict: 'cik,accession,document' },
        ),
      );
    }
  }
  return text;
}

export async function POST(request: Request) {
  const access = await requireApiAccess(true, '/api/boolean-validate', 'POST');
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'boolean-validate' });
  if (!rate.allowed) return rateLimitResponse(rate);

  let body: { query?: unknown; candidates?: unknown; maxUpstreamAttempts?: unknown };
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

  const seenCandidates = new Set<string>();
  const candidates = (Array.isArray(body.candidates) ? body.candidates : [])
    .map(sanitize)
    .filter((item): item is Candidate => item !== null)
    .filter(candidate => {
      const key = `${candidate.cik}:${candidate.accession}:${candidate.document}`;
      if (seenCandidates.has(key)) return false;
      seenCandidates.add(key);
      return true;
    })
    .slice(0, MAX_CANDIDATES);

  const rawMaxUpstreamAttempts = Number(body.maxUpstreamAttempts);
  const maxUpstreamAttempts = Number.isFinite(rawMaxUpstreamAttempts)
    ? Math.max(0, Math.min(MAX_SEC_ATTEMPTS, Math.floor(rawMaxUpstreamAttempts)))
    : MAX_SEC_ATTEMPTS;
  const work: ValidationWork = {
    maxUpstreamAttempts,
    upstreamAttempts: 0,
    cacheHits: 0,
    budgetExhausted: false,
  };

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
        const text = await loadText(candidate, work, request, access.identity);
        if (!text) return { ...candidate, matched: false, validated: false };

        const matched = booleanQueryMatches(expression, text);
        const snippet = matched ? extractBooleanMatchSnippet(expression, text)?.excerpt : undefined;
        return { ...candidate, matched, validated: true, excerpt: snippet };
      }),
    );
    verdicts.push(...settled);

    if (work.budgetExhausted && index + batch.length < candidates.length) {
      // No more SEC work may start. Preserve honesty by returning every
      // unvisited candidate as undecided, never as a non-match.
      verdicts.push(...candidates.slice(index + batch.length).map(c => ({
        ...c,
        matched: false,
        validated: false,
      })));
      break;
    }
  }

  return NextResponse.json({
    ok: true,
    verdicts,
    // Lets the caller keep coverage honest without re-deriving it.
    summary: {
      requested: candidates.length,
      validated: verdicts.filter(v => v.validated).length,
      matched: verdicts.filter(v => v.matched).length,
      upstreamAttempts: work.upstreamAttempts,
      cacheHits: work.cacheHits,
      budgetExhausted: work.budgetExhausted,
    },
  });
}
