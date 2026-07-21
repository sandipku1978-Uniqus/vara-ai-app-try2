/**
 * GET /api/es-search — enriched SEC filing search.
 *
 * Historically backed by a dedicated full-text index; that account was
 * retired (cost). Same request/response contract, new engine:
 *
 *   text queries  → EDGAR EFTS full-text search (free, always current)
 *   facets/enrich → Supabase Postgres metadata layer (urc_sec_filings,
 *                   urc_current_auditors from PCAOB Form AP, urc_sec_companies)
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
import { buildSecTargetUrl, fetchSecResponse, readResponseWithLimit } from '../../../lib/sec-upstream';

const USER_AGENT =
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

/** Extra candidates fetched beyond the requested page so post-filtering by
 *  auditor/SIC still fills the page. */
const CANDIDATE_CAP = 1_000;
export const EFTS_CANDIDATE_REQUEST_CAP = 100;
export const EFTS_CANDIDATE_TIME_BUDGET_MS = 45_000;
const EFTS_INTER_PAGE_DELAY_MS = 125;

interface EftsHit {
  _id: string;
  _score?: number;
  _source: Record<string, unknown> & { ciks?: string[] };
}

type EftsTotalRelation = 'eq' | 'gte';

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
      && requests < EFTS_CANDIDATE_REQUEST_CAP
      && !loopController.signal.aborted
    ) {
      const pageParams = new URLSearchParams(base);
      pageParams.set('from', String(offset));
      pageParams.set('size', String(Math.min(100, params.cap - collected.length)));
      const target = buildSecTargetUrl('efts', 'LATEST/search-index', pageParams);
      let response: Response;
      try {
        requests += 1;
        response = await fetchSecResponse(target, 'efts', loopController.signal, USER_AGENT);
      } catch (error) {
        if (collected.length === 0) throw error;
        interrupted = true;
        break;
      }
      if (!response.ok) {
        if (collected.length > 0) {
          interrupted = true;
          break;
        }
        throw new Error(`EFTS ${response.status}`);
      }
      const bytes = await readResponseWithLimit(response, 5 * 1024 * 1024, loopController.signal);
      const data = JSON.parse(new TextDecoder().decode(bytes));
      const pageHits: EftsHit[] = data?.hits?.hits ?? [];
      total = Number(data?.hits?.total?.value ?? total);
      if (data?.hits?.total?.relation === 'gte') relation = 'gte';
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
    }
    if (loopController.signal.aborted || requests >= EFTS_CANDIDATE_REQUEST_CAP) {
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
  return raw.map(value => Number(String(value).replace(/\D/g, ''))).filter(Number.isFinite);
}

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

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
    return NextResponse.json({ error: 'Invalid or oversized search parameter.' }, { status: 400 });
  }
  if (params.has('mode') || params.has('acceleratedStatus')) {
    return NextResponse.json(
      { error: 'mode and acceleratedStatus are filing-text predicates and are not supported by this candidate endpoint' },
      { status: 400 }
    );
  }
  const from = parseBoundedInteger(params.get('from'), 0, 0, 10_000);
  const size = parseBoundedInteger(params.get('size'), 10, 1, 100);
  if (from === null || size === null) {
    return NextResponse.json({ error: 'from or size is outside the supported integer range.' }, { status: 400 });
  }
  const facetsApplied = Boolean(auditor || sicCode);
  if (q && facetsApplied && from + size > CANDIDATE_CAP) {
    return NextResponse.json({
      error: `Facet-filtered enriched search is bounded to the first ${CANDIDATE_CAP} upstream candidates. Narrow the query or use a page within that candidate window.`,
      meta: { candidateCoverage: { examined: 0, upstreamTotal: 0, complete: false } },
    }, { status: 422 });
  }

  const db = getWebSupabase();
  if (!db) {
    return NextResponse.json(
      { error: 'Enriched search is not configured with a restricted database role.' },
      { status: 503 }
    );
  }
  const rate = await checkResourceRateLimit(request, access.identity, {
    operation: 'enriched-search',
    userLimit: 90,
    orgLimit: 450,
    ipLimit: 120,
  });
  if (!rate.allowed) return rateLimitResponse(rate);

  // Facet entity matching is a trigram-assisted ILIKE. Corporate suffixes
  // (", Inc.", "Corp") are made of ultra-common trigrams that blow the GIN
  // index up into multi-second scans ("BlackRock, Inc." 36s vs "BlackRock"
  // 0.3s at 4M rows), and stray backslashes in EDGAR names ("CORP \DE\")
  // are LIKE escape chars that silently break the pattern. Strip both.
  const facetEntity = (() => {
    if (!entityName) return null;
    let e = entityName.trim();
    const suffix = /[,.]?\s+(incorporated|inc|corp|corporation|company|co|ltd|llc|llp|lp|plc|nv|sa|se|ag)\.?$/i;
    for (let i = 0; i < 2; i++) {
      const stripped = e.replace(suffix, '');
      if (stripped === e || stripped.length < 4) break;
      e = stripped;
    }
    return e.replace(/[\\%_]/g, (m) => `\\${m}`) || null;
  })();

  try {
    // ── Facet browse: no text query — serve straight from Postgres ─────────
    if (!q) {
      const { data, error } = await db.rpc('urc_search_filings', {
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
      });
      if (error) throw new Error(`urc_search_filings: ${error.message}`);

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      return NextResponse.json({
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
              sic: row.sic ?? '',
              sic_description: row.sic_description ?? '',
              tickers: row.tickers ?? [],
            },
          })),
        },
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
      if (!capacity.allowed) return rateLimitResponse(capacity);
      try {
        efts = await fetchEftsCandidates(candidateRequest);
      } finally {
        await releaseAiConcurrency(capacity.lease);
      }
    } else {
      efts = await fetchEftsCandidates(candidateRequest);
    }


    const allCiks = Array.from(new Set(efts.hits.flatMap(hitCiks)));
    const auditorByCik = new Map<number, string>();
    const companyByCik = new Map<number, { sic: string | null; sic_description: string | null; tickers: string[] }>();

    if (allCiks.length > 0) {
      const [auditorsResult, companiesResult] = await Promise.all([
        db.from('urc_current_auditors').select('issuer_cik, firm_canonical').in('issuer_cik', allCiks),
        db.from('urc_sec_companies').select('cik, sic, sic_description, tickers').in('cik', allCiks),
      ]);
      for (const row of auditorsResult.data ?? []) {
        auditorByCik.set(Number(row.issuer_cik), String(row.firm_canonical));
      }
      for (const row of companiesResult.data ?? []) {
        companyByCik.set(Number(row.cik), {
          sic: row.sic ?? null,
          sic_description: row.sic_description ?? null,
          tickers: row.tickers ?? [],
        });
      }
    }

    const enriched = efts.hits.map(hit => {
      const ciks = hitCiks(hit);
      const hitAuditor = ciks.map(cik => auditorByCik.get(cik)).find(Boolean) || '';
      const company = ciks.map(cik => companyByCik.get(cik)).find(Boolean);
      return {
        ...hit,
        _source: {
          ...hit._source,
          auditor: hitAuditor,
          sic: company?.sic ?? hit._source.sic ?? '',
          sics: Array.from(new Set([
            ...(Array.isArray(hit._source.sics) ? hit._source.sics.map(String) : hit._source.sics ? [String(hit._source.sics)] : []),
            ...(company?.sic ? [company.sic] : []),
          ])),
          sic_description: company?.sic_description ?? '',
          tickers: company?.tickers?.length ? company.tickers : hit._source.tickers ?? [],
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
    return NextResponse.json({
      hits: {
        // When facets filtered the candidate pool we only know the filtered
        // count within the fetched window — report it as a lower bound.
        total: facetsApplied
          ? { value: filtered.length, relation: candidateComplete ? 'eq' : 'gte' }
          : { value: efts.total, relation: efts.relation },
        hits: page,
      },
      meta: {
        ...(facetsApplied
          ? {
              candidateCoverage: {
                examined: efts.hits.length,
                upstreamTotal: efts.total,
                complete: candidateComplete,
              },
            }
          : {
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
  } catch (error) {
    console.error('[es-search] enriched search failed:', error);
    return NextResponse.json({ error: 'Enriched search failed' }, { status: 502 });
  }
}
