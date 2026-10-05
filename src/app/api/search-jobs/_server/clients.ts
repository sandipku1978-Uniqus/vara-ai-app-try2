/**
 * Server-side I/O for the search-job worker.
 *
 * The executor's stages are pure; they reach the network only through the
 * clients they are given. In the browser those clients call this app's own
 * routes. On the server the worker calls SEC and the database directly, under
 * the same controls those routes apply: the central SEC request pacer (inside
 * fetchSecResponse), the shared document-fetch concurrency pool, the
 * least-privilege web key for cache and Form AP reads, and the same
 * byte limits and error-page guards. Matching, snippets and ranking come from
 * filingResearchStages — the browser's own functions, not copies.
 */

import { filingResearchStages, type FilingResearchResult } from '../../../../services/filingResearch';
import type {
  CandidateWindow,
  WaveCandidateSearchInput,
  WaveExecutionClients,
} from '../../../../services/filingResearchExecution';
import { companyNamePhrase, normalizeEftsForms, type EdgarSearchHit } from '../../../../services/secApi';
import { canonicalizeAuditorInput } from '../../../../services/auditors';
import { parseSecSubmissionPayload } from '../../../../services/secSubmissions';
import { booleanQueryMatches } from '../../../../utils/booleanSearch';
import { extractResolvedSection, resolveSectionScope } from '../../../../utils/sectionTaxonomy';
import { isValidIsoDate } from '../../../../lib/api-query';
import { extractDocumentTextFromHtmlServer } from '../../../../lib/filingTextServer';
import { acquireResourceConcurrency, releaseAiConcurrency, type RateLimitIdentity } from '../../../../lib/rate-limit';
import {
  assertSecDocumentResponse,
  buildSecTargetUrl,
  fetchSecJson,
  fetchSecResponse,
  looksLikeSecErrorResponse,
  looksLikeSecErrorText,
  parseAndValidateEftsPayload,
  readResponseWithLimit,
  SEC_DOCUMENT_CONCURRENCY_OPTIONS,
  SecUpstreamError,
} from '../../../../lib/sec-upstream';
import { getWebSupabase } from '../../../../lib/supabase-web';

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
/** Same limits as /api/filing-text and /api/sec-efts. */
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_EFTS_BYTES = 5 * 1024 * 1024;
const MAX_SUBMISSIONS_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_NAME_LENGTH = 255;
const CACHE_TABLE = 'urc_filing_text';
const SOURCE_VALIDATION_VERSION = 1;
/** EDGAR full-text search coverage starts 2001 (secApi's floor). */
const EDGAR_FTS_FLOOR = '2001-01-01';
/** EFTS refuses from+size beyond the 10,000-result window. */
const EFTS_MAX_WINDOW = 10_000;
const EFTS_PAGE_SIZE = 10;

type FailureKind = 'not-found' | 'unsupported' | 'rate-limit' | 'timeout' | 'upstream' | 'cancelled';

export interface ServerFilingSignal {
  text: string;
  auditor: string;
  acceleratedStatus: string;
  failure?: FailureKind;
}

export interface ServerClientContext {
  /** The request that is running the wave (cron or the owner's nudge). */
  request: Request;
  /** The job owner: controls are charged to the person whose job this is. */
  identity: RateLimitIdentity;
}

type TextOutcome =
  | { ok: true; text: string; attempts: number }
  | { ok: false; kind: FailureKind; attempts: number };

function classifyStatus(status: number): FailureKind {
  if (status === 404) return 'not-found';
  if (status === 400 || status === 413 || status === 415) return 'unsupported';
  if (status === 429) return 'rate-limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 499) return 'cancelled';
  return 'upstream';
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}

/** One SEC document as extracted text: shared cache first (read-only — the
 *  cache stays writable only by its three audited routes), then one paced
 *  SEC fetch with a single retry for transient failures. */
async function readDocumentText(
  context: ServerClientContext,
  cik: string,
  accessionNumber: string,
  document: string,
  signal?: AbortSignal
): Promise<TextOutcome> {
  const cleanCik = cik.replace(/^0+/, '');
  const cleanAccession = accessionNumber.replace(/-/g, '');
  if (
    !/^\d{1,10}$/.test(cleanCik) ||
    !/^\d{18}$/.test(cleanAccession) ||
    !document ||
    document.length > MAX_DOCUMENT_NAME_LENGTH ||
    document.includes('..') ||
    !/^[A-Za-z0-9._-]+$/.test(document)
  ) {
    return { ok: false, kind: 'unsupported', attempts: 0 };
  }

  const db = getWebSupabase();
  if (db) {
    try {
      const { data } = await db
        .from(CACHE_TABLE)
        .select('text, source_validation_version')
        .eq('cik', cleanCik)
        .eq('accession', cleanAccession)
        .eq('document', document)
        .maybeSingle();
      if (
        data?.text &&
        data.source_validation_version === SOURCE_VALIDATION_VERSION &&
        !looksLikeSecErrorText(data.text)
      ) {
        return { ok: true, text: data.text as string, attempts: 0 };
      }
    } catch (error) {
      // A cache transport failure is a miss, never a verdict.
      console.error('[search-jobs] filing-text cache read failed; fetching from SEC:', error);
    }
  }

  let attempts = 0;
  let last: FailureKind = 'upstream';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) return { ok: false, kind: 'cancelled', attempts };
    const capacity = await acquireResourceConcurrency(context.request, context.identity, SEC_DOCUMENT_CONCURRENCY_OPTIONS);
    if (!capacity.allowed) return { ok: false, kind: 'rate-limit', attempts };
    try {
      const target = buildSecTargetUrl(
        'proxy',
        `Archives/edgar/data/${cleanCik}/${cleanAccession}/${document}`,
        new URLSearchParams()
      );
      const response = await fetchSecResponse(
        target,
        'proxy',
        signal ?? new AbortController().signal,
        USER_AGENT,
        () => { attempts += 1; }
      );
      assertSecDocumentResponse(response);
      const bytes = await readResponseWithLimit(response, MAX_DOCUMENT_BYTES, signal);
      if (looksLikeSecErrorResponse(bytes)) throw new SecUpstreamError('SEC returned an error page.', 502);
      const text = extractDocumentTextFromHtmlServer(new TextDecoder().decode(bytes));
      if (looksLikeSecErrorText(text)) throw new SecUpstreamError('SEC returned an error page.', 502);
      return { ok: true, text, attempts };
    } catch (error) {
      if (isAbort(error, signal)) return { ok: false, kind: 'cancelled', attempts };
      last = error instanceof SecUpstreamError ? classifyStatus(error.status) : 'upstream';
      const retryable = last === 'rate-limit' || last === 'timeout' || last === 'upstream';
      if (!retryable || attempt === 1) return { ok: false, kind: last, attempts };
    } finally {
      await releaseAiConcurrency(capacity.lease);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { ok: false, kind: last, attempts };
}

/** One EDGAR full-text window starting at the lane's stored offset. The
 *  window (and the coverage it implies) is reported only when paging ended
 *  normally: after an error the lane's offset must not move past hits that
 *  were fetched but never handed to the executor. */
async function searchEftsWindow(input: WaveCandidateSearchInput): Promise<EdgarSearchHit[]> {
  const entityName = input.entityName || '';
  const query = input.candidateQuery.trim() || (entityName ? (companyNamePhrase(entityName) || `"${entityName.trim()}"`) : '');
  if (!query) throw new Error('EDGAR full-text search needs query text for this lane.');
  const params = new URLSearchParams({
    q: query,
    forms: normalizeEftsForms(input.formTypes),
    dateRange: 'custom',
    startdt: input.dateFrom || EDGAR_FTS_FLOOR,
    enddt: input.dateTo || new Date().toISOString().slice(0, 10),
  });
  if (input.entityCik) params.set('ciks', input.entityCik.padStart(10, '0'));
  else if (entityName) params.set('entityName', entityName);

  const hits: EdgarSearchHit[] = [];
  const seen = new Set<string>();
  let offset = input.startOffset ?? 0;
  let total = Number.POSITIVE_INFINITY;
  let relation: 'eq' | 'gte' = 'eq';
  let exhausted = false;

  const report = (): EdgarSearchHit[] => {
    if (relation === 'eq' && Number.isFinite(total) && offset >= total) exhausted = true;
    const window: CandidateWindow = {
      nextOffset: offset,
      exhausted,
      windowCapped: !exhausted && offset >= EFTS_MAX_WINDOW,
      upstreamTotal: Math.max(Number.isFinite(total) ? total : offset, offset),
      upstreamTotalIsFloor: relation === 'gte',
    };
    input.onWindow?.(window);
    input.onCoverage({
      examined: offset,
      upstreamTotal: window.upstreamTotal,
      complete: exhausted,
      upstreamTotalIsFloor: window.upstreamTotalIsFloor,
    });
    return hits;
  };

  while (hits.length < input.resultLimit && offset < EFTS_MAX_WINDOW && (relation === 'gte' || offset < total)) {
    if (input.signal?.aborted) break;
    params.set('from', String(offset));
    params.set('size', String(EFTS_PAGE_SIZE));
    let pageHits: EdgarSearchHit[] | null = null;
    for (let attempt = 0; attempt < 2 && pageHits === null; attempt += 1) {
      // Every real attempt is charged to the lane's page budget first; a
      // veto ends the window without spending the request.
      if (input.onUpstreamPage(1) === false) return report();
      const target = buildSecTargetUrl('efts', 'LATEST/search-index', params);
      const response = await fetchSecResponse(target, 'efts', input.signal ?? new AbortController().signal, USER_AGENT);
      if (!response.ok) {
        if ((response.status === 403 || response.status === 429 || response.status >= 500) && attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 700));
          continue;
        }
        throw new Error(`EDGAR full-text search returned ${response.status}.`);
      }
      const bytes = await readResponseWithLimit(response, MAX_EFTS_BYTES, input.signal);
      const payload = parseAndValidateEftsPayload(response.headers.get('content-type'), bytes);
      total = payload.hits.total.value;
      relation = payload.hits.total.relation;
      pageHits = payload.hits.hits as unknown as EdgarSearchHit[];
    }
    if (!pageHits) throw new Error('EDGAR full-text search failed.');
    if (pageHits.length === 0) {
      exhausted = true;
      break;
    }
    for (const hit of pageHits) {
      if (seen.has(hit._id)) continue;
      seen.add(hit._id);
      hits.push(hit);
    }
    offset += pageHits.length;
  }
  return report();
}

interface CompanyMetadata {
  companyName: string;
  tickers: string[];
  sic: string;
  sicDescription: string;
  exchange: string;
  stateOfIncorporation: string;
  fiscalYearEnd: string;
  headquarters: string;
  fileNumbersByAccession: Record<string, string>;
  primaryDocumentsByAccession: Record<string, string>;
}

/** Same field mapping as the browser's getCompanyMetadata (filingResearch). */
async function loadCompanyMetadata(cik: string, signal?: AbortSignal): Promise<CompanyMetadata | null> {
  const clean = cik.replace(/^0+/, '');
  if (!/^\d{1,10}$/.test(clean)) return null;
  try {
    const payload = await fetchSecJson({
      upstream: 'data',
      path: `submissions/CIK${clean.padStart(10, '0')}.json`,
      userAgent: USER_AGENT,
      maxBytes: MAX_SUBMISSIONS_BYTES,
      signal,
    });
    const submissions = parseSecSubmissionPayload(payload, clean);
    if (!submissions) return null;
    const raw = submissions as unknown as Record<string, unknown>;
    const recent = submissions.filings.recent;
    const fileNumbersByAccession: Record<string, string> = {};
    const primaryDocumentsByAccession: Record<string, string> = {};
    recent.accessionNumber.forEach((accession, index) => {
      fileNumbersByAccession[accession] = recent.fileNumber[index] || '';
      primaryDocumentsByAccession[accession] = recent.primaryDocument[index] || '';
    });
    const addresses = raw.addresses as { business?: Record<string, string> } | undefined;
    const business = addresses?.business;
    return {
      companyName: submissions.name || '',
      tickers: submissions.tickers || [],
      sic: String(raw.sic || ''),
      sicDescription: submissions.sicDescription || '',
      exchange: (submissions.exchanges || [])[0] || '',
      stateOfIncorporation: String(raw.stateOfIncorporationDescription || raw.stateOfIncorporation || ''),
      fiscalYearEnd: String(raw.fiscalYearEnd || ''),
      headquarters: [business?.city, business?.stateOrCountryDescription || business?.stateOrCountry].filter(Boolean).join(', '),
      fileNumbersByAccession,
      primaryDocumentsByAccession,
    };
  } catch (error) {
    if (!isAbort(error, signal)) console.error('[search-jobs] company submissions unavailable:', error);
    return null;
  }
}

/**
 * Build the worker's clients for one wave. Per-wave caches mirror the
 * browser's in-memory ones: a document or issuer read twice in one wave
 * costs SEC once.
 */
export function buildServerWaveClients(
  context: ServerClientContext,
  signal?: AbortSignal
): WaveExecutionClients<FilingResearchResult, ServerFilingSignal> {
  const stages = filingResearchStages;
  const signalCache = new Map<string, Promise<{ signal: ServerFilingSignal; attempts: number }>>();
  const companyCache = new Map<string, Promise<CompanyMetadata | null>>();

  const companyMetadata = (cik: string) => {
    if (!companyCache.has(cik)) companyCache.set(cik, loadCompanyMetadata(cik, signal));
    return companyCache.get(cik)!;
  };

  return {
    searchCandidates: searchEftsWindow,
    mapSearchHit: stages.mapSearchHit,
    uniqueById: stages.uniqueById,
    matchesBaseFilters: stages.matchesBaseFilters,
    delay: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    // The shared text cache is consulted per document below; a separate
    // pre-screen pass would read the same rows twice. Declining is a no-op
    // the executor already handles (every candidate takes the document path).
    prescreenBooleanCandidates: async () => null,
    hydrateCompanyMetadataBatch: async results => {
      const hydrated = [...results];
      for (let index = 0; index < hydrated.length; index += 4) {
        await Promise.all(hydrated.slice(index, index + 4).map(async result => {
          const metadata = await companyMetadata(result.cik);
          if (!metadata) return;
          result.companyName = metadata.companyName || result.companyName || result.entityName;
          result.tickers = metadata.tickers;
          result.sic = metadata.sic || result.sic;
          result.sicDescription = metadata.sicDescription || result.sicDescription;
          result.exchange = metadata.exchange || result.exchange;
          result.stateOfIncorporation = metadata.stateOfIncorporation || result.stateOfIncorporation;
          result.fiscalYearEnd = metadata.fiscalYearEnd || result.fiscalYearEnd;
          result.headquarters = metadata.headquarters || result.headquarters;
          result.fileNumber = metadata.fileNumbersByAccession[result.accessionNumber] || result.fileNumber;
          result.filingPrimaryDocument = metadata.primaryDocumentsByAccession[result.accessionNumber] || result.filingPrimaryDocument;
        }));
      }
      return hydrated;
    },
    hydrateRegisteredAuditors: async results => {
      // Same contract as POST /api/enrich: filing-date Form AP evidence only.
      const filings = results
        .filter(result => result.registeredAuditor === undefined && result.registeredAuditorResolutionStatus === undefined)
        .map(result => ({ result, cik: Number(result.cik) }))
        .filter(({ result, cik }) => Number.isFinite(cik) && cik > 0 && isValidIsoDate(result.fileDate))
        .slice(0, 200);
      const db = getWebSupabase();
      if (filings.length === 0 || !db) return;
      try {
        const { data, error } = await db.rpc('urc_resolve_filing_auditors', {
          p_filings: filings.map(({ result, cik }) => ({ key: result.id, cik: String(cik), file_date: result.fileDate })),
        });
        if (error) return;
        const rows = new Map<string, Record<string, unknown>>();
        for (const row of (data ?? []) as Array<Record<string, unknown>>) rows.set(String(row.request_key), row);
        for (const { result } of filings) {
          const row = rows.get(result.id);
          const status = row ? String(row.auditor_resolution_status || '') : 'no_prior_form_ap_report';
          result.registeredAuditorResolutionStatus = status;
          result.registeredAuditorReportDate = (row?.auditor_report_date as string) || undefined;
          result.registeredAuditorBasis = (row?.auditor_basis as string) || undefined;
          if (status === 'resolved' && typeof row?.auditor === 'string' && row.auditor) {
            const canonical = canonicalizeAuditorInput(row.auditor);
            if (canonical) {
              result.registeredAuditor = canonical;
              result.auditor = canonical;
            }
          }
        }
      } catch {
        // Facet store unreachable: the auditor filter falls back to text.
      }
    },
    getSignalCacheKey: stages.getSignalCacheKey,
    hydrateResultSignals: async (result, abortSignal, onUpstreamAttempts) => {
      const key = stages.getSignalCacheKey(result);
      const created = !signalCache.has(key);
      if (created) {
        signalCache.set(key, (async () => {
          const primary = await readDocumentText(context, result.cik, result.accessionNumber, result.primaryDocument, abortSignal ?? signal);
          let attempts = primary.attempts;
          const text = primary.ok ? primary.text : '';
          let auditor = canonicalizeAuditorInput(stages.detectAuditor(text));
          let acceleratedStatus = stages.detectAcceleratedStatus(text);
          let parentText = '';
          if (result.filingPrimaryDocument && result.filingPrimaryDocument !== result.primaryDocument) {
            const parent = await readDocumentText(context, result.cik, result.accessionNumber, result.filingPrimaryDocument, abortSignal ?? signal);
            attempts += parent.attempts;
            parentText = parent.ok ? parent.text : '';
            if (!auditor) auditor = canonicalizeAuditorInput(stages.detectAuditor(parentText));
            if (!acceleratedStatus) acceleratedStatus = stages.detectAcceleratedStatus(parentText);
          }
          const resolvedText = text || parentText;
          return {
            signal: {
              text: resolvedText,
              auditor,
              acceleratedStatus,
              ...(resolvedText ? {} : { failure: primary.ok ? 'unsupported' as const : primary.kind }),
            },
            attempts,
          };
        })());
      }
      const loaded = await signalCache.get(key)!;
      // A failed read is not cached across the wave: a retry must refetch.
      if (!loaded.signal.text) signalCache.delete(key);
      if (created) onUpstreamAttempts?.(loaded.attempts);
      // Resolved Form AP evidence wins over text detection (browser parity).
      result.auditor = result.registeredAuditor || loaded.signal.auditor;
      result.acceleratedStatus = loaded.signal.acceleratedStatus;
      return loaded.signal;
    },
    resolveScopedText: (filingText, sectionScope, formType) => {
      const resolved = resolveSectionScope(sectionScope, formType);
      return resolved ? extractResolvedSection(filingText, resolved) : '';
    },
    matchesBooleanQuery: booleanQueryMatches,
    matchesSignalFilters: stages.matchesSignalFilters,
    annotateResultMatchContext: stages.annotateResultMatchContext,
    sortResearchResults: stages.sortResearchResults,
  };
}
