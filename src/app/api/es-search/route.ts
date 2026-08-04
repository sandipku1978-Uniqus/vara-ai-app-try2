/**
 * GET /api/es-search — enriched SEC filing search.
 *
 * Historically backed by a dedicated full-text index; that account was
 * retired (cost). Same request/response contract, new engine:
 *
 *   text queries  → EDGAR EFTS full-text search (free, always current)
 *   facets/enrich → Supabase Postgres metadata layer (urc_sec_filings,
 *                   filing-date Form AP evidence, urc_sec_companies)
 *
 * With a text query: EFTS supplies candidates, Postgres supplies exact
 * auditor/SIC facets and enrichment. Without a text query: pure facet browse
 * straight from Postgres via the urc_search_filings function.
 *
 * Returns EFTS-shaped { hits: { total, hits } } so the frontend treats every
 * backend uniformly. 503 when Supabase env is absent — the client falls back
 * to its plain-EFTS path (see searchEdgarFilings).
 */

import { NextResponse } from 'next/server';
import { canonicalizeAuditorInput } from '../../../services/auditors';
import { normalizeEftsForms } from '../../../services/secApi';
import { requireApiAccess } from '../../../lib/api-auth';
import { isValidIsoDate, parseBoundedInteger } from '../../../lib/api-query';
import {
  acquireResourceConcurrency,
  checkResourceRateLimit,
  rateLimitResponse,
  releaseAiConcurrency,
} from '../../../lib/rate-limit';
import { getWebSupabase } from '../../../lib/supabase-web';
import {
  buildSecTargetUrl,
  fetchSecResponse,
  parseAndValidateEftsPayload,
  readResponseWithLimit,
} from '../../../lib/sec-upstream';
import {
  classifyDbError,
  dbErrorResponse,
  newCorrelationId,
  type DbErrorClass,
} from '../../../lib/db-observability';

/** The platform default would kill this route mid-flight; see the in-route budgets. */
export const maxDuration = 60;

const USER_AGENT =
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

/** Extra candidates fetched beyond the requested page so post-filtering by
 *  auditor/SIC still fills the page. */
const CANDIDATE_CAP = 1_000;
const AUDITOR_LOOKUP_CAP = 5_000;
const COMPANY_LOOKUP_CHUNK = 150;
export const EFTS_CANDIDATE_REQUEST_CAP = 100;
export const EFTS_CANDIDATE_TIME_BUDGET_MS = 45_000;
const EFTS_INTER_PAGE_DELAY_MS = 125;

interface EftsHit {
  _id: string;
  _score?: number;
  _source: Record<string, unknown> & { ciks?: string[] };
}

interface AuditorEvidenceRow {
  request_key: string;
  auditor?: string | null;
  auditor_report_date?: string | null;
  auditor_resolution_status?: string | null;
  auditor_basis?: string | null;
}

type EftsTotalRelation = 'eq' | 'gte';

class EftsCandidateCollectionError extends Error {
  readonly requests: number;

  constructor(error: unknown, requests: number) {
    super(error instanceof Error ? error.message : 'EFTS candidate collection failed.');
    this.name = 'EftsCandidateCollectionError';
    this.requests = requests;
  }
}

interface SearchCompletionDetails {
  outcome: 'success' | 'degraded' | 'error' | 'rejected' | 'rate-limited';
  mode?: 'facet-browse' | 'text';
  errorClass?: DbErrorClass | 'configuration' | 'unsupported-window';
  candidateCount?: number;
  postFacetMatchCount?: number;
  returnedCount?: number;
  upstreamTotal?: number;
  attributionRequestCount?: number;
  auditorEvidenceCount?: number;
  companyEnrichmentCount?: number;
  candidateComplete?: boolean;
  upstreamInterrupted?: boolean;
  upstreamRequestCount?: number;
  degradedSources?: string[];
  errorName?: string;
}

async function delayBetweenEftsPages(signal: AbortSignal): Promise<void> {
  // Unit tests exercise the request bound without waiting through SEC pacing.
  if (process.env.NODE_ENV === 'test') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, EFTS_INTER_PAGE_DELAY_MS);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('EFTS candidate collection cancelled'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    setTimeout(() => signal.removeEventListener('abort', onAbort), EFTS_INTER_PAGE_DELAY_MS + 1);
  });
}

async function fetchEftsCandidates(params: {
  q: string;
  forms?: string;
  startdt?: string;
  enddt?: string;
  entityName?: string;
  startOffset: number;
  cik?: string;

  cap: number;
  requestCap: number;
  signal: AbortSignal;
}): Promise<{
  total: number;
  relation: EftsTotalRelation;
  hits: EftsHit[];
  completeCorpus: boolean;
  interrupted: boolean;
  requests: number;
}> {
  const base = new URLSearchParams({ q: params.q });
  if (params.forms) base.set('forms', normalizeEftsForms(params.forms));
  if (params.startdt || params.enddt) {
    base.set('dateRange', 'custom');
    if (params.startdt) base.set('startdt', params.startdt);
    if (params.enddt) base.set('enddt', params.enddt);
  }
  if (params.cik) {
    // Resolved-issuer text searches filter by CIK: EFTS entityName matching
    // silently misses names with punctuation ("Organon & Co.")
    base.set('ciks', params.cik.padStart(10, '0'));
  } else if (params.entityName) {
    base.set('entityName', params.entityName);
  }

  const collected: EftsHit[] = [];
  const seen = new Set<string>();
  let total = 0;
  let relation: EftsTotalRelation = 'eq';
  let offset = params.startOffset;
  let requests = 0;
  let interrupted = false;
  const loopController = new AbortController();
  const abortFromRequest = () => loopController.abort(params.signal.reason);
  if (params.signal.aborted) loopController.abort(params.signal.reason);
  else params.signal.addEventListener('abort', abortFromRequest, { once: true });
  const deadline = setTimeout(() => loopController.abort('EFTS candidate time budget exceeded'), EFTS_CANDIDATE_TIME_BUDGET_MS);

  try {
    // EFTS controls its own page size; stride by hits actually received.
    while (
      collected.length < params.cap
      && offset <= 10_000
      && requests < params.requestCap
      && !loopController.signal.aborted
    ) {
      const pageParams = new URLSearchParams(base);
      pageParams.set('from', String(offset));
      pageParams.set('size', String(Math.min(100, params.cap - collected.length)));
      const target = buildSecTargetUrl('efts', 'LATEST/search-index', pageParams);
      try {
        const response = await fetchSecResponse(
          target,
          'efts',
          loopController.signal,
          USER_AGENT,
          () => {
            if (requests >= params.requestCap) return false;
            requests += 1;
            return true;
          }
        );
        if (!response.ok) {
          throw new Error(`EFTS ${response.status}`);
        }
        const bytes = await readResponseWithLimit(response, 5 * 1024 * 1024, loopController.signal);
        const data = parseAndValidateEftsPayload(response.headers.get('content-type'), bytes);
        const pageHits = data.hits.hits as EftsHit[];
        total = data.hits.total.value;
        relation = data.hits.total.relation;
        for (const hit of pageHits) {
          if (seen.has(hit._id)) continue;
          seen.add(hit._id);
          collected.push(hit);
          if (collected.length >= params.cap) break;
        }
        if (pageHits.length === 0) break;
        offset += pageHits.length;
        if (relation === 'eq' && offset >= total) break;
        if (collected.length < params.cap) await delayBetweenEftsPages(loopController.signal);
      } catch (error) {
        // Once at least one validated page has been collected, a later fetch,
        // response-body read, or inter-page pacing abort is a bounded partial
        // result — not a route-wide 502 that discards valid evidence.
        if (collected.length === 0) {
          throw new EftsCandidateCollectionError(error, requests);
        }
        interrupted = true;
        break;
      }
    }
    if (loopController.signal.aborted || requests >= params.requestCap) {
      interrupted = !(relation === 'eq' && offset >= total);
    }
  } finally {
    clearTimeout(deadline);
    params.signal.removeEventListener('abort', abortFromRequest);
  }

  return {
    total,
    relation,
    hits: collected,
    completeCorpus: params.startOffset === 0 && relation === 'eq' && offset >= total,
    interrupted,
    requests,
  };
}

function hitCiks(hit: EftsHit): number[] {
  const raw = hit._source?.ciks;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(value => Number(String(value).replace(/\D/g, '')))
    .filter(value => Number.isSafeInteger(value) && value > 0 && value <= 9_999_999_999);
}

function hitFileDate(hit: EftsHit): string | null {
  const value = hit._source?.file_date;
  return typeof value === 'string' && isValidIsoDate(value) ? value : null;
}

async function addEftsErrorMetadata(
  response: Response,
  accounting: { requests: number; requestBudget: number }
): Promise<NextResponse> {
  const payload = await response.json() as Record<string, unknown>;
  const existingMeta = payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta)
    ? payload.meta as Record<string, unknown>
    : {};
  return NextResponse.json({
    ...payload,
    meta: { ...existingMeta, efts: accounting },
  }, {
    status: response.status,
    headers: response.headers,
  });
}

export async function GET(request: Request) {
  const access = await requireApiAccess(true, '/api/es-search', 'GET');
  if (access.response) return access.response;

  const correlationId = newCorrelationId();
  const startedAt = Date.now();
  let completionLogged = false;
  let databaseCallCount = 0;
  const complete = (response: Response, details: SearchCompletionDetails): Response => {
    response.headers.set('x-correlation-id', correlationId);
    if (!completionLogged) {
      completionLogged = true;
      console.info(JSON.stringify({
        kind: 'route-completion',
        route: 'es-search',
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        correlationId,
        databaseCallCount,
        ...details,
      }));
    }
    return response;
  };
  const errorEnvelope = (
    error: string,
    status: number,
    errorClass: SearchCompletionDetails['errorClass'],
    details: Omit<SearchCompletionDetails, 'outcome' | 'errorClass'> = {}
  ): Response => complete(
    NextResponse.json({ ok: false, error, errorClass, correlationId }, { status }),
    { outcome: 'rejected', errorClass, ...details }
  );

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim();
  const forms = params.get('forms') || undefined;
  const startdt = params.get('startdt') || undefined;
  const enddt = params.get('enddt') || undefined;
  const entityName = params.get('entityName') || undefined;
  const cikRaw = (params.get('cik') || '').trim();
  const cik = /^\d{1,10}$/.test(cikRaw) ? cikRaw : undefined;
  const auditorParam = (params.get('auditor') || '').trim();
  const auditor = auditorParam ? canonicalizeAuditorInput(auditorParam) : '';
  const sicCode = (params.get('sicCode') || '').trim();
  if (
    q.length > 2000
    || (forms?.length || 0) > 500
    || (entityName?.length || 0) > 300
    || auditorParam.length > 200
    || (sicCode && !/^\d{4}$/.test(sicCode))
    || (startdt && !isValidIsoDate(startdt))
    || (enddt && !isValidIsoDate(enddt))
    || (startdt && enddt && startdt > enddt)
  ) {
    return errorEnvelope('Invalid or oversized search parameter.', 400, 'invalid-request');
  }
  if (params.has('mode') || params.has('acceleratedStatus')) {
    return errorEnvelope(
      'mode and acceleratedStatus are filing-text predicates and are not supported by this candidate endpoint',
      400,
      'invalid-request'
    );
  }
  const from = parseBoundedInteger(params.get('from'), 0, 0, 10_000);
  const size = parseBoundedInteger(params.get('size'), 10, 1, 100);
  const eftsRequestBudget = parseBoundedInteger(
    params.get('eftsRequestBudget'),
    EFTS_CANDIDATE_REQUEST_CAP,
    1,
    EFTS_CANDIDATE_REQUEST_CAP
  );
  if (from === null || size === null || eftsRequestBudget === null) {
    return errorEnvelope(
      'from, size, or eftsRequestBudget is outside the supported integer range.',
      400,
      'invalid-request'
    );
  }
  const facetsApplied = Boolean(auditor || sicCode);
  if (q && facetsApplied && from + size > CANDIDATE_CAP) {
    const response = NextResponse.json({
      ok: false,
      error: `Facet-filtered enriched search is bounded to the first ${CANDIDATE_CAP} upstream candidates. Narrow the query or use a page within that candidate window.`,
      errorClass: 'unsupported-window',
      correlationId,
      meta: { candidateCoverage: { examined: 0, upstreamTotal: 0, complete: false } },
    }, { status: 422 });
    return complete(response, {
      outcome: 'rejected',
      errorClass: 'unsupported-window',
      mode: 'text',
      candidateCount: 0,
      returnedCount: 0,
      upstreamTotal: 0,
    });
  }

  const db = getWebSupabase();
  if (!db) {
    return errorEnvelope(
      'Enriched search is not configured with a restricted database role.',
      503,
      'configuration',
      { mode: q ? 'text' : 'facet-browse' }
    );
  }
  const rate = await checkResourceRateLimit(request, access.identity, {
    operation: 'enriched-search',
    userLimit: 90,
    orgLimit: 450,
    ipLimit: 120,
  });
  if (!rate.allowed) {
    return complete(rateLimitResponse(rate), {
      outcome: 'rate-limited',
      errorClass: 'rate-limited',
      mode: q ? 'text' : 'facet-browse',
    });
  }

  // Facet entity matching is a trigram-assisted ILIKE. Corporate suffixes
  // (", Inc.", "Corp") are made of ultra-common trigrams that blow the GIN
  // index up into multi-second scans ("BlackRock, Inc." 36s vs "BlackRock"
  // 0.3s at 4M rows), and stray backslashes in EDGAR names ("CORP \DE\")
  // are LIKE escape chars that silently break the pattern. Strip both.
  const facetEntity = (() => {
    if (!entityName) return null;
    // Collapse whitespace first so the suffix expression has no ambiguous
    // repeated group followed by an end anchor (a polynomial ReDoS shape).
    let e = entityName.trim().replace(/\s+/g, ' ');
    const suffix = /[,.]?\s(?:incorporated|inc|corp|corporation|company|co|ltd|llc|llp|lp|plc|nv|sa|se|ag)\.?$/i;
    for (let i = 0; i < 2; i++) {
      const stripped = e.replace(suffix, '');
      if (stripped === e || stripped.length < 4) break;
      e = stripped;
    }
    return e.replace(/[\\%_]/g, (m) => `\\${m}`) || null;
  })();

  let candidateCount = 0;
  let attributionRequestCount = 0;
  let auditorEvidenceCount = 0;
  let companyEnrichmentCount = 0;
  let completedEftsRequestCount = 0;
  const degradedSources: string[] = [];

  try {
    // ── Facet browse: no text query — serve straight from Postgres ─────────
    if (!q) {
      const facetRpcArgs = {
        p_forms: forms ? forms.split(',').map(f => f.trim().toUpperCase()).filter(Boolean) : null,
        p_start: startdt ?? null,
        p_end: enddt ?? null,
        p_auditor: auditor || null,
        p_entity: facetEntity,
        p_sic: sicCode || null,
        p_limit: size,
        p_offset: from,
        // Exact issuer identity beats the name-ILIKE approximation (009)
        p_cik: cik ? Number(cik) : null,
      };
      databaseCallCount += 1;
      const { data, error } = await db.rpc('urc_search_filings', facetRpcArgs);
      if (error) {
        const classified = classifyDbError(error);
        return complete(
          dbErrorResponse({ route: 'es-search', rpc: 'urc_search_filings', error, correlationId, startedAt }),
          { outcome: 'error', errorClass: classified.errorClass, mode: 'facet-browse' }
        );
      }

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      candidateCount = rows.length;
      let total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      if (rows.length === 0 && from > 0) {
        // `total_count` is carried on result rows by the RPC. A valid deep
        // offset beyond the last row therefore has no carrier and used to be
        // reported as an authoritative zero. Probe the first row with exactly
        // the same filters to recover the honest total; if that is also empty,
        // the filtered corpus is genuinely empty.
        databaseCallCount += 1;
        const { data: totalData, error: totalError } = await db.rpc('urc_search_filings', {
          ...facetRpcArgs,
          p_limit: 1,
          p_offset: 0,
        });
        if (totalError) {
          const classified = classifyDbError(totalError);
          return complete(
            dbErrorResponse({ route: 'es-search', rpc: 'urc_search_filings', error: totalError, correlationId, startedAt }),
            {
              outcome: 'error',
              errorClass: classified.errorClass,
              mode: 'facet-browse',
              candidateCount,
            }
          );
        }
        const totalRows = (totalData ?? []) as Array<Record<string, unknown>>;
        total = totalRows.length > 0 ? Number(totalRows[0].total_count) : 0;
      }
      const response = NextResponse.json({
        hits: {
          total: { value: total, relation: total >= 10_000 ? 'gte' : 'eq' },
          hits: rows.map(row => ({
            _id: `${row.accession}:${row.filename}`,
            _score: 0,
            _source: {
              adsh: row.accession,
              ciks: [String(row.cik).padStart(10, '0')],
              display_names: [`${row.company_name} (CIK ${String(row.cik).padStart(10, '0')})`],
              form: row.form,
              root_forms: [row.root_form],
              is_amendment: row.is_amendment,
              file_date: row.date_filed,
              file_type: row.form,
              auditor: row.auditor ?? '',
              auditor_resolution_status: row.auditor ? 'resolved' : 'unresolved',
              auditor_basis: row.auditor
                ? 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date'
                : '',
              sic: row.sic ?? '',
              sic_description: row.sic_description ?? '',
              tickers: row.tickers ?? [],
            },
          })),
        },
      });
      return complete(response, {
        outcome: 'success',
        mode: 'facet-browse',
        candidateCount,
        returnedCount: rows.length,
        upstreamTotal: total,
      });
    }

    // ── Text search: EFTS candidates + Postgres facets/enrichment ──────────
    const needed = from + size;
    // Facet matches can be sparse or clustered late in the upstream order.
    // Scan the full bounded candidate window so an early short page cannot
    // make the client stop before later matching candidates are examined.
    const cap = facetsApplied ? CANDIDATE_CAP : needed;
    const candidateRequest = {
      q,
      forms,
      startdt,
      enddt,
      entityName,
      cik,
      startOffset: facetsApplied ? 0 : from,
      cap: facetsApplied ? cap : size,
      requestCap: eftsRequestBudget,
      signal: request.signal,
    };
    let efts: Awaited<ReturnType<typeof fetchEftsCandidates>>;
    if (facetsApplied) {
      // One sparse facet query can fan out to 100 paced SEC requests. Serialize
      // that path globally so parallel users cannot exceed EDGAR's fair-access
      // envelope; simple one-page text searches remain independent.
      const capacity = await acquireResourceConcurrency(request, access.identity, {
        operation: 'efts-candidate-scan',
        userLimit: 1,
        orgLimit: 1,
        ipLimit: 1,
        globalLimit: 1,
        leaseSeconds: 60,
      });
      if (!capacity.allowed) {
        return complete(rateLimitResponse(capacity), {
          outcome: 'rate-limited',
          errorClass: 'rate-limited',
          mode: 'text',
        });
      }
      try {
        efts = await fetchEftsCandidates(candidateRequest);
      } finally {
        await releaseAiConcurrency(capacity.lease);
      }
    } else {
      efts = await fetchEftsCandidates(candidateRequest);
    }

    completedEftsRequestCount = efts.requests;
    candidateCount = efts.hits.length;

    const allCiks = Array.from(new Set(efts.hits.flatMap(hitCiks)));
    const auditorLookups = efts.hits.flatMap((hit, hitIndex) => {
      const fileDate = hitFileDate(hit);
      if (!fileDate) return [];
      return hitCiks(hit).map((cik, cikIndex) => ({
        key: `${hitIndex}:${cikIndex}`,
        cik: String(cik),
        file_date: fileDate,
      }));
    });
    attributionRequestCount = auditorLookups.length;
    if (auditorLookups.length > AUDITOR_LOOKUP_CAP) {
      const response = NextResponse.json({
        ok: false,
        error: `Auditor attribution exceeded the ${AUDITOR_LOOKUP_CAP}-pair evidence budget. Narrow the query.`,
        errorClass: 'unsupported-window',
        correlationId,
        meta: {
          efts: { requests: efts.requests, requestBudget: eftsRequestBudget },
          candidateCoverage: { examined: efts.hits.length, upstreamTotal: efts.total, complete: false },
        },
      }, { status: 422 });
      return complete(response, {
        outcome: 'rejected',
        errorClass: 'unsupported-window',
        mode: 'text',
        candidateCount,
        returnedCount: 0,
        upstreamTotal: efts.total,
        attributionRequestCount,
        candidateComplete: false,
        upstreamInterrupted: efts.interrupted,
        upstreamRequestCount: efts.requests,
      });
    }
    const auditorEvidenceByHit = new Map<number, AuditorEvidenceRow[]>();
    let auditorReadFailed = false;
    const companyByCik = new Map<number, { sic: string | null; sic_description: string | null; tickers: string[] }>();

    if (allCiks.length > 0) {
      const companyCikChunks = Array.from(
        { length: Math.ceil(allCiks.length / COMPANY_LOOKUP_CHUNK) },
        (_, index) => allCiks.slice(
          index * COMPANY_LOOKUP_CHUNK,
          (index + 1) * COMPANY_LOOKUP_CHUNK
        )
      );
      if (auditorLookups.length > 0) databaseCallCount += 1;
      databaseCallCount += companyCikChunks.length;
      const [auditorsResult, companiesResults] = await Promise.all([
        auditorLookups.length > 0
          ? db.rpc('urc_resolve_filing_auditors', { p_filings: auditorLookups })
          : Promise.resolve({ data: [], error: null }),
        Promise.all(companyCikChunks.map(cikChunk =>
          db.from('urc_sec_companies').select('cik, sic, sic_description, tickers').in('cik', cikChunk)
        )),
      ]);
      const companiesError = companiesResults.find(result => result.error)?.error ?? null;
      // A facet search whose enrichment read failed must NOT proceed: the
      // auditor/SIC post-filter below would then drop every hit and report
      // an authoritative-looking zero. A database outage is a 503, never a
      // silent empty result set.
      const requiredFacetError = (auditor ? auditorsResult.error : null)
        || (sicCode ? companiesError : null);
      if (requiredFacetError) {
        const rpc = auditor && auditorsResult.error
          ? 'urc_resolve_filing_auditors'
          : 'urc_sec_companies.select';
        const classified = classifyDbError(requiredFacetError);
        const dbResponse = dbErrorResponse({
          route: 'es-search',
          rpc,
          error: requiredFacetError,
          correlationId,
          startedAt,
        });
        return complete(
          await addEftsErrorMetadata(dbResponse, {
            requests: efts.requests,
            requestBudget: eftsRequestBudget,
          }),
          {
            outcome: 'error',
            errorClass: classified.errorClass,
            mode: 'text',
            candidateCount,
            returnedCount: 0,
            upstreamTotal: efts.total,
            attributionRequestCount,
            candidateComplete: efts.completeCorpus,
            upstreamInterrupted: efts.interrupted,
            upstreamRequestCount: efts.requests,
          }
        );
      }
      if (auditorsResult.error || companiesError) {
        // Enrichment is cosmetic when no facet depends on it — degrade the
        // labels, never the result set. The single completion event below
        // records which safe source labels were unavailable.
        if (auditorsResult.error) degradedSources.push('auditor-attribution');
        if (companiesError) degradedSources.push('company-metadata');
      }
      auditorReadFailed = Boolean(auditorsResult.error);
      for (const row of auditorsResult.data ?? []) {
        auditorEvidenceCount += 1;
        const hitIndex = Number(String(row.request_key).split(':', 1)[0]);
        if (!Number.isSafeInteger(hitIndex)) continue;
        const evidence = auditorEvidenceByHit.get(hitIndex) ?? [];
        evidence.push(row as AuditorEvidenceRow);
        auditorEvidenceByHit.set(hitIndex, evidence);
      }
      for (const companiesResult of companiesResults) {
        for (const row of companiesResult.data ?? []) {
          companyEnrichmentCount += 1;
          companyByCik.set(Number(row.cik), {
            sic: row.sic ?? null,
            sic_description: row.sic_description ?? null,
            tickers: row.tickers ?? [],
          });
        }
      }
    }

    const enriched = efts.hits.map((hit, hitIndex) => {
      const ciks = hitCiks(hit);
      const auditorEvidence = auditorEvidenceByHit.get(hitIndex) ?? [];
      const resolvedEvidence = auditorEvidence.filter(row =>
        row.auditor_resolution_status === 'resolved' && Boolean(row.auditor)
      );
      const resolvedAuditors = Array.from(new Set(resolvedEvidence.map(row => String(row.auditor))));
      // A multi-CIK filing is resolved only when EVERY issuer lookup returned
      // resolved evidence and every one names the same canonical firm. One
      // resolved co-filer plus one unknown co-filer is partial evidence, not a
      // filing-level KPMG match.
      const everyCikResolved = ciks.length > 0
        && auditorEvidence.length === ciks.length
        && auditorEvidence.every(row =>
          row.auditor_resolution_status === 'resolved' && Boolean(row.auditor)
        );
      const hitAuditor = everyCikResolved && resolvedAuditors.length === 1
        ? resolvedAuditors[0]
        : '';
      const evidenceStatuses = new Set(
        auditorEvidence.map(row => row.auditor_resolution_status || 'unknown')
      );
      const auditorStatus = everyCikResolved && resolvedAuditors.length > 1
        ? 'ambiguous_multiple_ciks'
        : hitAuditor
          ? 'resolved'
          : ciks.length > 1 && (
            resolvedEvidence.length > 0
            || auditorEvidence.length !== ciks.length
            || evidenceStatuses.size > 1
          )
            ? 'incomplete_multiple_ciks'
            : auditorEvidence[0]?.auditor_resolution_status
              || (auditorReadFailed
                ? 'temporarily_unavailable'
                : hitFileDate(hit)
                  ? (ciks.length > 0 ? 'no_prior_form_ap_report' : 'issuer_identity_unavailable')
                  : 'filing_date_unavailable');
      const resolvedSource = hitAuditor
        ? resolvedEvidence.find(row => row.auditor === hitAuditor)
        : undefined;
      const companies = ciks
        .map(cik => companyByCik.get(cik))
        .filter((company): company is NonNullable<typeof company> => Boolean(company));
      const sourceSics = Array.isArray(hit._source.sics)
        ? hit._source.sics.map(String)
        : hit._source.sics
          ? [String(hit._source.sics)]
          : hit._source.sic
            ? [String(hit._source.sic)]
            : [];
      const sics = Array.from(new Set([
        ...sourceSics,
        ...companies.map(company => company.sic).filter((sic): sic is string => Boolean(sic)),
      ])).sort();
      const tickers = Array.from(new Set([
        ...(Array.isArray(hit._source.tickers)
          ? hit._source.tickers.map(String)
          : hit._source.tickers
            ? [String(hit._source.tickers)]
            : []),
        ...companies.flatMap(company => company.tickers.map(String)),
      ])).sort();
      const unambiguousSic = sics.length === 1 ? sics[0] : '';
      const sicDescription = unambiguousSic
        ? companies.find(company => company.sic === unambiguousSic)?.sic_description
          ?? (String(hit._source.sic || '') === unambiguousSic
            ? String(hit._source.sic_description || '')
            : '')
        : '';
      return {
        ...hit,
        _source: {
          ...hit._source,
          auditor: hitAuditor,
          auditor_resolution_status: auditorStatus,
          auditor_report_date: resolvedSource?.auditor_report_date ?? '',
          auditor_basis: resolvedSource?.auditor_basis ?? '',
          sic: unambiguousSic,
          sics,
          sic_description: sicDescription,
          tickers,
        },
      };
    });

    const matchesAuditor = (value: string) =>
      auditor === 'Big 4'
        ? ['Deloitte', 'PwC', 'EY', 'KPMG'].includes(value)
        : value === auditor;

    const filtered = enriched.filter(hit => {
      if (auditor && !matchesAuditor(String(hit._source.auditor || ''))) return false;
      const hitSics = Array.isArray(hit._source.sics)
        ? hit._source.sics.map(String)
        : [String(hit._source.sic || hit._source.sics || '')];
      if (sicCode && !hitSics.includes(sicCode)) return false;
      return true;
    });

    const candidateComplete = efts.completeCorpus;
    const page = facetsApplied ? filtered.slice(from, from + size) : filtered;
    const response = NextResponse.json({
      hits: {
        // When facets filtered the candidate pool we only know the filtered
        // count within the fetched window — report it as a lower bound.
        total: facetsApplied
          ? { value: filtered.length, relation: candidateComplete ? 'eq' : 'gte' }
          : { value: efts.total, relation: efts.relation },
        hits: page,
      },
      meta: {
        efts: {
          requests: efts.requests,
          requestBudget: eftsRequestBudget,
        },
        ...(facetsApplied
          ? {
              candidateCoverage: {
                examined: efts.hits.length,
                upstreamTotal: efts.total,
                complete: candidateComplete,
                upstreamTotalIsFloor: efts.relation === 'gte',
              },
            }
          : {
              // Canonical schema for every response path — the client reads
              // candidateCoverage; without it, missing coverage used to default
              // to complete (readiness finding F-07). `complete` here means the
              // full upstream result set has been delivered through this page
              // contract, not merely that this page was full.
              candidateCoverage: {
                examined: from + page.length,
                upstreamTotal: efts.total,
                complete: !efts.interrupted && efts.relation === 'eq' && from + page.length >= efts.total,
                upstreamTotalIsFloor: efts.relation === 'gte',
              },
              // Compatibility alias for older clients; remove after one release.
              pageCoverage: {
                requestedFrom: from,
                requestedSize: size,
                received: page.length,
                complete: !efts.interrupted && (
                  page.length >= size || (efts.relation === 'eq' && from + page.length >= efts.total)
                ),
                upstreamRequests: efts.requests,
              },
            }),
      },
    });
    return complete(response, {
      outcome: degradedSources.length > 0 ? 'degraded' : 'success',
      mode: 'text',
      candidateCount,
      postFacetMatchCount: filtered.length,
      returnedCount: page.length,
      upstreamTotal: efts.total,
      attributionRequestCount,
      auditorEvidenceCount,
      companyEnrichmentCount,
      candidateComplete,
      upstreamInterrupted: efts.interrupted,
      upstreamRequestCount: efts.requests,
      ...(degradedSources.length > 0 ? { degradedSources } : {}),
    });
  } catch (error) {
    const failedEftsRequestCount = error instanceof EftsCandidateCollectionError
      ? error.requests
      : completedEftsRequestCount;
    const response = NextResponse.json(
      {
        ok: false,
        error: 'Enriched search failed unexpectedly. Retry; results are not a verified zero.',
        errorClass: 'unexpected',
        correlationId,
        ...(failedEftsRequestCount > 0
          ? {
              meta: {
                efts: {
                  requests: failedEftsRequestCount,
                  requestBudget: eftsRequestBudget,
                },
              },
            }
          : {}),
      },
      { status: 502 }
    );
    return complete(response, {
      outcome: 'error',
      errorClass: 'unexpected',
      mode: q ? 'text' : 'facet-browse',
      candidateCount,
      attributionRequestCount,
      auditorEvidenceCount,
      companyEnrichmentCount,
      ...(failedEftsRequestCount > 0
        ? { upstreamRequestCount: failedEftsRequestCount }
        : {}),
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}
