/**
 * Accuracy gate (readiness finding F-09).
 *
 * Scores the app's core claims against SEC's own data. The previous accuracy
 * number was produced by hand, could not be re-run, and predated most of the
 * search work — so it could not gate anything. This is repeatable and exits
 * non-zero below threshold.
 *
 *   npm run accuracy            # full run
 *   npm run accuracy -- --suite boolean
 *   npm run accuracy -- --json report.json
 *
 * Design rule: nothing here asserts "the app still does what it did". Every
 * expectation is derived at run time from SEC, or is a structural invariant
 * that must hold for any correct implementation.
 */

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  auditorFromIxbrl,
  fetchCompanyConcept,
  fetchDisclosureHtml,
  fetchFilingHtml,
  latestFiling,
  secFetch,
  secJson,
  secText,
} from './sources';
import {
  missingBoundedAccessions,
  normalizedFilingTextSha256,
  validateIndependentFilingText,
} from './evaluator-validity';
import { BOOLEAN_CASES, ISSUERS, TOPIC_CASES, XBRL_CONCEPTS } from './cases';
import { compileBooleanQuery, booleanQueryMatches } from '../../src/utils/booleanSearch';
import { extractDocumentTextFromHtmlServer } from '../../src/lib/filingTextServer';
import { findDisclosureTopic, locateTopicPassage } from '../../src/services/disclosureTopics';
import {
  locateTopicInBlocks,
  parseFilingSummary,
  stripSgmlEnvelope,
  stripXbrlReportChrome,
} from '../../src/services/filingStructure';
import { detectAuditorInText, canonicalizeAuditorInput } from '../../src/services/auditors';
import { rankCompanyMatches } from '../../src/services/companyLookup';
import {
  COMPANY_BRAND_ALIASES,
  extractFinancials,
  resolveCompanyInput,
  type CompanyFacts,
  type SearchCandidateCoverage,
} from '../../src/services/secApi';
import { compileSearchPlan } from '../../src/services/filingResearchPlan';
import {
  executeFilingResearchSearch,
  type FilingResearchResult,
} from '../../src/services/filingResearch';
import { defaultSearchFilters } from '../../src/domain/searchFilters';
import { candidateRequestHeaders } from './request';

interface Check {
  suite: string;
  name: string;
  passed: boolean;
  detail: string;
  /** Set when the check could not be run — excluded from the score entirely. */
  skipped?: boolean;
  evidence?: CheckEvidence;
}

interface CheckEvidence {
  sourceUrls: string[];
  target: Record<string, unknown>;
  expected: unknown;
  actual: unknown;
}

interface Exclusion {
  suite: string;
  name: string;
  detail: string;
}

interface FilingEntityAnnualRow {
  accession: string;
  form: string;
  filingDate: string;
  primaryDocument: string;
}

interface FilingEntitySubmissionsWitness {
  sourceUrl: string;
  responseStatus: 200;
  contentType: string;
  payloadBytes: number;
  payloadSha256: string;
  requestedCik: string;
  responseCik: string;
  annualFilings: FilingEntityAnnualRow[];
  annualEvidenceSha256: string;
}

interface FilingEntityAtomWitness {
  sourceUrl: string;
  responseStatus: 200;
  contentType: string;
  payloadBytes: number;
  payloadSha256: string;
  payloadText: string;
  returnedCik: string | null;
}

interface FilingEntityHttpFailureWitness {
  sourceUrl: string;
  responseStatus: number;
  contentType: string;
  payloadBytes: number;
  payloadSha256: string;
  payloadText: string;
}

interface FilingEntitySelectionRow {
  directoryOrdinal: number;
  ticker: string;
  officialCik: string;
  title: string;
  outcome: 'selected' | 'excluded';
  reasonCode: string | null;
  scoredOrdinal: number | null;
  expectedCik: string | null;
  exclusion: { name: string; detail: string } | null;
  decisionEvidence: Record<string, unknown> | null;
}

const checks: Check[] = [];
const exclusions: Exclusion[] = [];
const filingEntitySelectionTrace: FilingEntitySelectionRow[] = [];
let filingEntityDirectoryEvidence: {
  count: number;
  projectionDigest: string;
} | null = null;
const coverage: Record<string, Record<string, number>> = {};
const coverageTargets = new Map<string, { target: number; examineLimit: number }>();
const semanticAvailability = {
  logicalRequests: 0,
  httpAttempts: 0,
  serverErrorResponses: 0,
  requestErrors: 0,
};
// Exact conservative candidate HTTP ceiling for the default full run:
// 60 filing-entity probes + five residual executors at 61 calls each + five
// delegated phrase windows at 16 calls each + the four-request immutable
// Boolean canary. Local SEC truth calls are not candidate traffic. Keep
// release rate-cap arithmetic bound to this value.
export const MAX_SEMANTIC_CANDIDATE_REQUESTS = 449;
const replayEvidence: Record<string, unknown[]> = {
  boolean: [],
  booleanRejected: [],
  booleanDeployedCanary: [],
};
const booleanExecutionEvidence = {
  hybridExactShaExecutor: true,
  deployedCanary: {
    required: true,
    pass: false,
    candidateBase: candidateBase(),
    candidateRequests: 0,
    secEftsGet: false,
    filingTextGet: false,
    positiveValidate: false,
    negativeValidate: false,
  },
};

function setCoverageTarget(suite: string, target: number, examineLimit = target) {
  coverageTargets.set(suite, { target, examineLimit });
}

function candidateBase(): string | null {
  const baseIndex = process.argv.indexOf('--base');
  const cliBase = baseIndex >= 0 ? process.argv[baseIndex + 1] || '' : '';
  const raw = (cliBase || process.env.CANDIDATE_URL || process.env.ACCURACY_PRODUCT_BASE || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin === raw.replace(/\/$/, '') ? url.origin : null;
  } catch {
    return null;
  }
}

async function candidateRequestJson(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; payload: Record<string, unknown> } | null> {
  const base = candidateBase();
  semanticAvailability.logicalRequests += 1;
  if (!base) {
    semanticAvailability.requestErrors += 1;
    return null;
  }

  try {
    const method = (init.method || 'GET').toUpperCase();
    const pathname = new URL(path, 'https://accuracy.invalid').pathname;
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(candidateRequestHeaders(pathname, method, {
      requestOrigin: base,
    }))) {
      headers.set(key, value);
    }
    semanticAvailability.httpAttempts += 1;
    const response = await fetch(`${base}${path}`, {
      ...init,
      method,
      headers,
      redirect: 'manual',
      signal: init.signal || AbortSignal.timeout(65_000),
    });
    if (response.status >= 500) semanticAvailability.serverErrorResponses += 1;
    if (!response.ok) return null;
    return {
      status: response.status,
      payload: await response.json() as Record<string, unknown>,
    };
  } catch {
    semanticAvailability.requestErrors += 1;
    return null;
  }
}

async function candidateJson(path: string): Promise<Record<string, unknown> | null> {
  return (await candidateRequestJson(path))?.payload ?? null;
}

/** Execute the checked-out product orchestrator while forwarding every
 * browser-relative API dependency to the attested immutable candidate. */
async function withCandidateProductFetch<T>(run: () => Promise<T>): Promise<T> {
  const base = candidateBase();
  if (!base) throw new Error('immutable candidate base is missing');
  const nativeFetch = globalThis.fetch;
  const deployedPaths = new Set(['/api/es-search', '/api/enrich']);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!raw.startsWith('/')) return nativeFetch(input, init);

    const target = new URL(raw, base);
    // Keep the staged release credential intentionally narrow. SEC/text
    // dependencies are evaluated with the exact checked-out implementation
    // against official SEC data; only product retrieval/enrichment crosses the
    // immutable candidate boundary.
    if (target.pathname === '/api/sec-efts') {
      const path = (target.searchParams.get('path') || '').replace(/^\/+/, '');
      if (!path || path.includes('..')) return new Response('invalid SEC path', { status: 400 });
      const params = new URLSearchParams(target.searchParams);
      params.delete('path');
      const suffix = params.size > 0 ? `?${params}` : '';
      return secFetch(`https://efts.sec.gov/${path}${suffix}`);
    }
    if (target.pathname === '/api/filing-text') {
      const cik = (target.searchParams.get('cik') || '').replace(/\D/g, '');
      const accession = (target.searchParams.get('accession') || '').replace(/-/g, '');
      const document = target.searchParams.get('document') || '';
      if (!cik || !accession || !/^[A-Za-z0-9._-]+$/.test(document)) {
        return Response.json({ ok: false, error: 'invalid filing target' }, { status: 400 });
      }
      const html = await fetchFilingHtml(cik, accession, document);
      if (!html) return Response.json({ ok: false, error: 'official filing unavailable' }, { status: 502 });
      return Response.json({ ok: true, text: extractDocumentTextFromHtmlServer(html), cached: false });
    }
    if (target.pathname === '/api/boolean-validate') {
      let payload: {
        query?: unknown;
        candidates?: unknown;
        maxUpstreamAttempts?: unknown;
      } = {};
      try {
        const rawBody = typeof init?.body === 'string'
          ? init.body
          : request ? await request.clone().text() : '';
        payload = JSON.parse(rawBody || '{}') as typeof payload;
      } catch {
        return Response.json({ ok: false, error: 'invalid validation body' }, { status: 400 });
      }
      const query = typeof payload.query === 'string' ? payload.query : '';
      const compiled = compileBooleanQuery(query);
      if (!compiled.ok) return Response.json({ ok: false, error: compiled.message }, { status: 400 });
      const candidates = Array.isArray(payload.candidates)
        ? payload.candidates.slice(0, 40) as Array<Record<string, unknown>>
        : [];
      const maximum = Math.max(0, Math.floor(Number(payload.maxUpstreamAttempts) || candidates.length));
      let attempts = 0;
      const verdicts: Array<Record<string, unknown>> = [];
      for (const candidate of candidates) {
        const cik = String(candidate.cik ?? '').replace(/\D/g, '');
        const accession = String(candidate.accession ?? '').replace(/-/g, '');
        const document = String(candidate.document ?? '');
        if (!cik || !accession || !/^[A-Za-z0-9._-]+$/.test(document) || attempts >= maximum) {
          verdicts.push({ cik, accession, document, matched: false, validated: false });
          continue;
        }
        attempts += 1;
        const html = await fetchFilingHtml(cik, accession, document);
        const filingText = html ? extractDocumentTextFromHtmlServer(html) : '';
        verdicts.push({
          cik,
          accession,
          document,
          matched: Boolean(filingText) && booleanQueryMatches(compiled.residual || query, filingText),
          validated: Boolean(filingText),
        });
      }
      return Response.json({
        ok: true,
        verdicts,
        summary: {
          upstreamAttempts: attempts,
          cacheHits: 0,
          budgetExhausted: attempts >= maximum && verdicts.some(verdict => verdict.validated !== true),
        },
      });
    }
    if (!deployedPaths.has(target.pathname)) {
      semanticAvailability.requestErrors += 1;
      throw new Error(`Boolean accuracy adapter refuses unexpected product route ${target.pathname}`);
    }

    const method = (init?.method || request?.method || 'GET').toUpperCase();
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    for (const [key, value] of Object.entries(candidateRequestHeaders(target.pathname, method, {
      requestOrigin: target.origin,
    }))) {
      headers.set(key, value);
    }
    let body = init?.body;
    if (body === undefined && request && method !== 'GET' && method !== 'HEAD') {
      body = await request.clone().arrayBuffer();
    }

    semanticAvailability.logicalRequests += 1;
    semanticAvailability.httpAttempts += 1;
    try {
      const response = await nativeFetch(target, {
        ...init,
        method,
        body,
        headers,
        redirect: 'manual',
        signal: init?.signal || request?.signal,
      });
      if (response.status >= 500) semanticAvailability.serverErrorResponses += 1;
      if (!response.ok) semanticAvailability.requestErrors += 1;
      return response;
    } catch (error) {
      semanticAvailability.requestErrors += 1;
      throw error;
    }
  };

  try {
    return await run();
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

/**
 * Run browser-facing SEC services in Node against the same official upstreams.
 * This invokes the actual product resolver/extractor from the protected SHA;
 * the adapter only supplies the relative same-origin routes a browser provides.
 */
async function withOfficialSecProductFetch<T>(run: () => Promise<T>): Promise<T> {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!raw.startsWith('/api/')) return nativeFetch(input, init);

    const local = new URL(raw, 'https://accuracy.invalid');
    if (local.pathname === '/api/company-cik') {
      const ticker = local.searchParams.get('ticker') || '';
      const params = new URLSearchParams({
        action: 'getcompany', ticker, type: '10-K', dateb: '', owner: 'include', count: '1', output: 'atom',
      });
      const upstream = await secFetch(`https://www.sec.gov/cgi-bin/browse-edgar?${params}`);
      if (!upstream.ok) return new Response(JSON.stringify({ ok: true, cik: null }), { status: 200 });
      const atom = await upstream.text();
      const match = atom.match(/<cik>(\d{1,10})<\/cik>/i);
      return Response.json({ ok: true, cik: match ? String(Number(match[1])) : null });
    }

    if (local.pathname === '/api/sec-proxy' || local.pathname === '/api/sec-efts') {
      const path = (local.searchParams.get('path') || '').replace(/^\/+/, '');
      if (!path || path.includes('..')) return new Response('invalid path', { status: 400 });
      const upstreamKind = local.pathname === '/api/sec-efts'
        ? 'efts'
        : local.searchParams.get('upstream') === 'data' ? 'data' : 'www';
      const origin = upstreamKind === 'efts'
        ? 'https://efts.sec.gov'
        : upstreamKind === 'data' ? 'https://data.sec.gov' : 'https://www.sec.gov';
      const query = new URLSearchParams(local.searchParams);
      query.delete('path');
      query.delete('upstream');
      const suffix = query.size > 0 ? `?${query}` : '';
      return secFetch(`${origin}/${path}${suffix}`);
    }

    throw new Error(`Accuracy adapter refuses unexpected product route ${local.pathname}`);
  };

  try {
    return await run();
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

function record(
  suite: string,
  name: string,
  passed: boolean,
  detail: string,
  evidence?: CheckEvidence,
) {
  const canonicalEvidence = evidence ?? {
    sourceUrls: suite === 'entity' || suite === 'filing-entity'
      ? ['https://www.sec.gov/files/company_tickers.json']
      : suite === 'xbrl'
        ? ['https://data.sec.gov/api/xbrl/companyconcept/']
        : suite === 'boolean' || suite === 'boolean-deployed'
          ? [candidateBase() || 'missing-immutable-candidate']
          : ['https://www.sec.gov/Archives/edgar/data/'],
    target: { suite, check: name },
    expected: { pass: true },
    actual: { pass: passed, detail },
  };
  checks.push({ suite, name, passed, detail, evidence: canonicalEvidence });
  process.stdout.write(`  ${passed ? '✓' : '✗'} ${name}${passed ? '' : ` — ${detail}`}\n`);
}

/**
 * An unreachable source is not an accuracy failure. Scoring SEC's downtime as
 * a miss is exactly how the previous run produced uninvestigated 502s.
 */
function skip(suite: string, name: string, detail: string) {
  checks.push({ suite, name, passed: false, detail, skipped: true });
  process.stdout.write(`  ~ ${name} — skipped: ${detail}\n`);
}

function exclude(suite: string, name: string, detail: string) {
  exclusions.push({ suite, name, detail });
  process.stdout.write(`  · ${name} — excluded from deterministic sample: ${detail}\n`);
}

function filingEntityCik(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,10}$/.test(raw)) return null;
  const normalized = raw.replace(/^0+/, '') || '0';
  return normalized === '0' ? null : normalized;
}

function filingEntityAnnualProjection(
  recent: {
    accessionNumber?: unknown;
    form?: unknown;
    filingDate?: unknown;
    primaryDocument?: unknown;
  },
  expectedCik: string,
): FilingEntityAnnualRow[] {
  const accessionNumber = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const primaryDocuments = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const annual: FilingEntityAnnualRow[] = [];
  for (const [index, rawForm] of forms.entries()) {
    const form = String(rawForm ?? '');
    if (!ANNUAL_FORMS.has(form)) continue;
    const row = {
      accession: String(accessionNumber[index] ?? ''),
      form,
      filingDate: String(filingDates[index] ?? ''),
      primaryDocument: String(primaryDocuments[index] ?? ''),
    };
    if (
      !/^\d{10}-\d{2}-\d{6}$/.test(row.accession)
      || !/^\d{4}-\d{2}-\d{2}$/.test(row.filingDate)
      || !row.accession.replace(/-/g, '').startsWith(expectedCik.padStart(10, '0'))
      || row.accession.slice(11, 13) !== row.filingDate.slice(2, 4)
      || !row.primaryDocument
    ) throw new Error('SEC submissions annual-filing projection is malformed');
    annual.push(row);
  }
  return annual;
}

async function fetchFilingEntitySubmissions(
  cik: string,
): Promise<{
  recent: { accessionNumber: string[]; form: string[]; filingDate: string[]; primaryDocument: string[] } | null;
  witness: FilingEntitySubmissionsWitness | null;
  failure: FilingEntityHttpFailureWitness | null;
}> {
  const requestedCik = filingEntityCik(cik);
  if (!requestedCik) throw new Error(`invalid submissions CIK ${cik}`);
  const sourceUrl = `https://data.sec.gov/submissions/CIK${requestedCik.padStart(10, '0')}.json`;
  const response = await secFetch(sourceUrl);
  const payloadText = await response.text();
  if (!response.ok) return {
    recent: null,
    witness: null,
    failure: {
      sourceUrl,
      responseStatus: response.status,
      contentType: response.headers.get('content-type') || '',
      payloadBytes: Buffer.byteLength(payloadText),
      payloadSha256: createHash('sha256').update(payloadText).digest('hex'),
      payloadText,
    },
  };
  let payload: {
    cik?: unknown;
    filings?: { recent?: {
      accessionNumber?: unknown;
      form?: unknown;
      filingDate?: unknown;
      primaryDocument?: unknown;
    } };
  };
  try {
    payload = JSON.parse(payloadText) as typeof payload;
  } catch {
    throw new Error(`SEC submissions for CIK ${requestedCik} returned malformed JSON`);
  }
  const responseCik = filingEntityCik(payload.cik);
  const rawRecent = payload.filings?.recent;
  if (!responseCik || responseCik !== requestedCik || !rawRecent) {
    throw new Error(`SEC submissions response identity does not match requested CIK ${requestedCik}`);
  }
  const recent = {
    accessionNumber: Array.isArray(rawRecent.accessionNumber) ? rawRecent.accessionNumber.map(String) : [],
    form: Array.isArray(rawRecent.form) ? rawRecent.form.map(String) : [],
    filingDate: Array.isArray(rawRecent.filingDate) ? rawRecent.filingDate.map(String) : [],
    primaryDocument: Array.isArray(rawRecent.primaryDocument) ? rawRecent.primaryDocument.map(String) : [],
  };
  const annualFilings = filingEntityAnnualProjection(recent, responseCik);
  const annualEvidenceSha256 = createHash('sha256').update(JSON.stringify({
    requestedCik,
    responseCik,
    annualFilings,
  })).digest('hex');
  return {
    recent,
    failure: null,
    witness: {
      sourceUrl,
      responseStatus: 200,
      contentType: response.headers.get('content-type') || '',
      payloadBytes: Buffer.byteLength(payloadText),
      payloadSha256: createHash('sha256').update(payloadText).digest('hex'),
      requestedCik,
      responseCik,
      annualFilings,
      annualEvidenceSha256,
    },
  };
}

async function lookupTickerViaEdgar(ticker: string): Promise<{
  reachable: boolean;
  cik: string | null;
  witness: FilingEntityAtomWitness | null;
  failure: FilingEntityHttpFailureWitness | null;
}> {
  const sourceUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=1&output=atom`;
  const response = await secFetch(sourceUrl);
  const payloadText = await response.text();
  if (!response.ok) return {
    reachable: false,
    cik: null,
    witness: null,
    failure: {
      sourceUrl,
      responseStatus: response.status,
      contentType: response.headers.get('content-type') || '',
      payloadBytes: Buffer.byteLength(payloadText),
      payloadSha256: createHash('sha256').update(payloadText).digest('hex'),
      payloadText,
    },
  };
  const matches = [...payloadText.matchAll(/<cik>(\d{1,10})<\/cik>/gi)]
    .map(match => filingEntityCik(match[1]))
    .filter((value): value is string => value !== null);
  const cik = matches[0] ?? null;
  return {
    reachable: true,
    cik,
    failure: null,
    witness: {
      sourceUrl,
      responseStatus: 200,
      contentType: response.headers.get('content-type') || '',
      payloadBytes: Buffer.byteLength(payloadText),
      payloadSha256: createHash('sha256').update(payloadText).digest('hex'),
      payloadText,
      returnedCik: cik,
    },
  };
}

function recordFilingEntityExclusion(
  row: { ticker: string; title: string; cik_str: number },
  directoryOrdinal: number,
  reasonCode: string,
  name: string,
  detail: string,
  decisionEvidence: Record<string, unknown>,
) {
  exclude('filing-entity', name, detail);
  filingEntitySelectionTrace.push({
    directoryOrdinal,
    ticker: row.ticker,
    officialCik: String(row.cik_str),
    title: row.title,
    outcome: 'excluded',
    reasonCode,
    scoredOrdinal: null,
    expectedCik: null,
    exclusion: { name, detail },
    decisionEvidence,
  });
}

// ── Suite: every ticker must resolve to an entity that actually files ───────
/**
 * Generalises the XOM finding. Deliberately property-based: no hand-written
 * CIKs, so it needs no maintenance and catches the NEXT holdco reorganization
 * without anyone updating a fixture.
 *
 * A holding-company reorganization mints a fresh CIK that inherits the ticker
 * and files an 8-K12B, while the reporting history stays on the predecessor.
 * SEC's directory follows the ticker, so it points at the shell.
 */
async function suiteFilingEntity() {
  const requestedSample = Number(process.env.ACCURACY_ENTITY_SAMPLE || 60);
  const sampleSize = Number.isFinite(requestedSample) ? Math.max(1, Math.floor(requestedSample)) : 60;
  const requestedExamineLimit = Number(process.env.ACCURACY_ENTITY_EXAMINE_LIMIT || sampleSize * 2);
  const configuredExamineLimit = Math.max(
    sampleSize,
    Number.isFinite(requestedExamineLimit) ? Math.floor(requestedExamineLimit) : sampleSize * 2,
  );
  setCoverageTarget('filing-entity', sampleSize, configuredExamineLimit);
  process.stdout.write(`\nFiling entity — do ${sampleSize} scoreable tickers from the canonical SEC directory prefix resolve to a filer?\n`);

  const directory = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    'https://www.sec.gov/files/company_tickers.json'
  );
  if (!directory) return skip('filing-entity', 'directory reachable', 'company_tickers.json unavailable');

  // Canonicalize the complete official directory before selecting. The same
  // ticker/CIK order is committed by the full-directory coverage artifact, so
  // the consolidator can prove every examined, selected, and replaced row.
  filingEntitySelectionTrace.length = 0;
  const rows = Object.values(directory).map(row => ({
    ticker: String(row.ticker || '').trim().toUpperCase(),
    title: String(row.title || '').trim(),
    cik_str: Number(row.cik_str),
  })).sort((left, right) => (
    left.ticker.localeCompare(right.ticker)
    || String(left.cik_str).localeCompare(String(right.cik_str))
  ));
  if (new Set(rows.map(row => row.ticker)).size !== rows.length) {
    throw new Error('official directory contains duplicate canonical tickers');
  }
  filingEntityDirectoryEvidence = {
    count: rows.length,
    projectionDigest: createHash('sha256').update(JSON.stringify(rows.map(row => ({
      ticker: row.ticker,
      officialCik: String(row.cik_str),
      title: row.title,
    })))).digest('hex'),
  };
  const examineLimit = Math.min(
    rows.length,
    configuredExamineLimit,
  );
  setCoverageTarget('filing-entity', sampleSize, examineLimit);
  let corrected = 0;
  let examined = 0;
  let scored = 0;
  const exclusionsAtStart = exclusions.length;

  for (const [directoryOrdinal, row] of rows.slice(0, examineLimit).entries()) {
    if (scored >= sampleSize) break;
    examined += 1;
    const directoryCik = String(row.cik_str);
    const officialResult = await fetchFilingEntitySubmissions(directoryCik);
    if (!officialResult.witness) {
      recordFilingEntityExclusion(
        row, directoryOrdinal, 'official-submissions-unreachable',
        `${row.ticker} submissions`, 'unreachable; replaced by next deterministic directory row',
        { officialSubmissionsFailure: officialResult.failure },
      );
      continue;
    }

    const hasAnnual = officialResult.witness.annualFilings.length > 0;
    let expectedCik = directoryCik;
    let edgarLookupCik: string | null = null;
    let edgarCandidateHasAnnual = false;
    let atomEvidence: FilingEntityAtomWitness | null = null;
    let candidateSubmissions: FilingEntitySubmissionsWitness | null = null;
    if (!hasAnnual) {
      // The directory entry is a non-filer. Official EDGAR ticker lookup is
      // the independent truth source for the reporting-history entity.
      const lookup = await lookupTickerViaEdgar(row.ticker);
      if (!lookup.reachable) {
        recordFilingEntityExclusion(
          row, directoryOrdinal, 'edgar-atom-unreachable',
          `${row.ticker} EDGAR ticker lookup`, 'unreachable; replaced by next deterministic directory row',
          { officialSubmissions: officialResult.witness, atomFailure: lookup.failure },
        );
        continue;
      }
      atomEvidence = lookup.witness;
      const candidate = lookup.cik;
      const candidateResult = candidate ? await fetchFilingEntitySubmissions(candidate) : null;
      if (candidate && !candidateResult?.witness) {
        recordFilingEntityExclusion(
          row, directoryOrdinal, 'candidate-submissions-unreachable',
          `${row.ticker} candidate submissions`, 'unreachable; replaced by next deterministic directory row',
          {
            officialSubmissions: officialResult.witness,
            atomEvidence,
            candidateSubmissionsFailure: candidateResult?.failure ?? null,
          },
        );
        continue;
      }
      candidateSubmissions = candidateResult?.witness ?? null;
      const candidateFiles = candidateSubmissions?.annualFilings.length ? true : false;
      if (!candidate || !candidateFiles) {
        // There is no scoreable expected filer. Replace it; never count an
        // unresolvable/empty target as a successful product resolution.
        recordFilingEntityExclusion(
          row,
          directoryOrdinal,
          'no-annual-reporting-entity',
          `${row.ticker} (${row.title})`,
          'official sources expose no annual-reporting entity; replaced by next deterministic row',
          {
            officialSubmissions: officialResult.witness,
            atomEvidence,
            candidateSubmissions,
          },
        );
        continue;
      }
      expectedCik = candidate;
      edgarLookupCik = candidate;
      edgarCandidateHasAnnual = candidateFiles;
    }

    // Invoke the real product resolver from the exact evaluator SHA. Its
    // browser-relative SEC clients are adapted to official SEC hosts above.
    const resolved = await withOfficialSecProductFetch(
      () => resolveCompanyInput(row.ticker, { verifyFilingHistory: true }),
    );
    const productCik = resolved?.cik ? String(Number(resolved.cik)) : '';

    // Then prove the immutable deployed candidate can retrieve the reporting
    // history selected by that resolver. This prevents a local-only helper
    // check from certifying a deployment wired to a different data path.
    const params = new URLSearchParams({
      cik: productCik || expectedCik,
      forms: '10-K,20-F,40-F',
      size: '1',
    });
    const deployed = await candidateJson(`/api/es-search?${params}`);
    const hits = Array.isArray((deployed?.hits as { hits?: unknown[] } | undefined)?.hits)
      ? (deployed!.hits as { hits: Array<{ _source?: { ciks?: unknown[]; root_forms?: unknown[] } }> }).hits
      : [];
    const deployedHasExpected = hits.some(hit => {
      const ciks = Array.isArray(hit._source?.ciks) ? hit._source!.ciks!.map(value => String(Number(value))) : [];
      const forms = Array.isArray(hit._source?.root_forms) ? hit._source!.root_forms!.map(String) : [];
      return ciks.includes(String(Number(expectedCik))) && forms.some(form => ANNUAL_FORMS.has(form));
    });
    const passed = productCik === String(Number(expectedCik)) && deployedHasExpected;
    if (!hasAnnual && passed) corrected += 1;
    record(
      'filing-entity',
      `${row.ticker} product resolver → reporting CIK ${expectedCik}`,
      passed,
      `product resolved ${productCik || 'nothing'}; deployed annual filing ${deployedHasExpected ? 'found' : 'missing'}`,
      {
        sourceUrls: [
          'https://www.sec.gov/files/company_tickers.json',
          `https://data.sec.gov/submissions/CIK${directoryCik.padStart(10, '0')}.json`,
          ...(!hasAnnual ? [
            `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(row.ticker)}&type=10-K&dateb=&owner=include&count=1&output=atom`,
          ] : []),
          ...(expectedCik !== directoryCik
            ? [`https://data.sec.gov/submissions/CIK${expectedCik.padStart(10, '0')}.json`]
            : []),
          `${candidateBase()}/api/es-search?${params}`,
        ],
        target: {
          kind: 'filing-entity', ticker: row.ticker,
          officialCik: String(Number(row.cik_str)), expectedCik,
          resolutionMode: hasAnnual ? 'official-directory-cik' : 'edgar-successor-correction',
          officialHasAnnual: hasAnnual,
          officialSubmissions: officialResult.witness,
          edgarCorrection: {
            required: !hasAnnual,
            reachable: !hasAnnual,
            resolvedCik: edgarLookupCik,
            candidateHasAnnual: edgarCandidateHasAnnual,
            atomEvidence,
            candidateSubmissions,
          },
          selection: {
            directoryOrdinal,
            scoredOrdinal: scored + 1,
            replacementCountBefore: directoryOrdinal - scored,
          },
        },
        expected: { resolvedCik: String(Number(expectedCik)), deployedAnnual: true },
        actual: { resolvedCik: productCik, deployedAnnual: deployedHasExpected },
      },
    );
    filingEntitySelectionTrace.push({
      directoryOrdinal,
      ticker: row.ticker,
      officialCik: directoryCik,
      title: row.title,
      outcome: 'selected',
      reasonCode: null,
      scoredOrdinal: scored + 1,
      expectedCik,
      exclusion: null,
      decisionEvidence: null,
    });
    scored += 1;
  }

  coverage['filing-entity'] = {
    target: sampleSize,
    examined,
    scored,
    examineLimit,
    exclusions: exclusions.length - exclusionsAtStart,
  };

  if (scored < sampleSize) {
    record(
      'filing-entity',
      `scoreable sample reaches ${sampleSize}`,
      false,
      `only ${scored} scoreable issuers after examining the hard ceiling of ${examined}`,
    );
  }

  if (corrected) {
    process.stdout.write(`  → ${corrected} ticker(s) needed the successor-entity correction\n`);
  }
}

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

// ── Suite: entity resolution ────────────────────────────────────────────────
async function suiteEntity() {
  setCoverageTarget('entity', ISSUERS.length * 2);
  process.stdout.write('\nEntity resolution — ticker/name → CIK\n');
  const directory = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    'https://www.sec.gov/files/company_tickers.json'
  );
  if (!directory) return skip('entity', 'directory reachable', 'company_tickers.json unavailable');

  const tickerMap: Record<string, string> = {};
  const titleMap: Record<string, string> = {};
  for (const row of Object.values(directory)) {
    tickerMap[row.ticker.toUpperCase()] = String(row.cik_str);
    titleMap[row.ticker.toUpperCase()] = row.title;
  }

  // Asserted against the TICKER, not a hand-written CIK. Pinning CIKs is what
  // made this suite report XOM as broken when the real defect was that SEC had
  // repointed the ticker at a successor shell — the fixture, not the ranking.
  // Whether a CIK is usable is a property, and `filing-entity` checks it at
  // sixty times this scale.
  for (const issuer of ISSUERS) {
    const byTicker = rankCompanyMatches(issuer.ticker, { tickerMap, titleMap, aliasMap: COMPANY_BRAND_ALIASES });
    record(
      'entity',
      `${issuer.ticker} ticker resolves to itself`,
      byTicker[0]?.ticker === issuer.ticker,
      `got ${byTicker[0]?.ticker ?? 'nothing'} (${byTicker[0]?.title ?? '-'})`,
      {
        sourceUrls: ['https://www.sec.gov/files/company_tickers.json'],
        target: { kind: 'entity-ticker', ticker: issuer.ticker },
        expected: { ticker: issuer.ticker },
        actual: { ticker: byTicker[0]?.ticker ?? null },
      },
    );

    // Name search must reach the same registrant — this is the path that
    // silently failed for SpaceX.
    const firstWord = issuer.title.split(/[\s,]+/)[0];
    const byName = rankCompanyMatches(firstWord, { tickerMap, titleMap, aliasMap: COMPANY_BRAND_ALIASES });
    record(
      'entity',
      `"${firstWord}" reaches ${issuer.ticker} in the visible rows`,
      byName.some(row => row.ticker === issuer.ticker),
      `top: ${byName.slice(0, 3).map(r => r.ticker).join(', ') || 'nothing'}`,
      {
        sourceUrls: ['https://www.sec.gov/files/company_tickers.json'],
        target: { kind: 'entity-name', query: firstWord, ticker: issuer.ticker },
        expected: { visibleTicker: issuer.ticker },
        actual: { visibleTickers: byName.map(row => row.ticker) },
      },
    );
  }
}

// ── Suite: XBRL financial values ────────────────────────────────────────────
async function suiteXbrl() {
  const sample = ISSUERS.slice(0, 5);
  setCoverageTarget('xbrl', sample.length * XBRL_CONCEPTS.length);
  process.stdout.write('\nXBRL values — product extraction vs SEC companyconcept ground truth\n');

  const productMetric: Record<string, string> = {
    revenue: 'Revenues',
    netIncome: 'NetIncome',
    assets: 'TotalAssets',
    equity: 'StockholdersEquity',
  };
  const authoritativeAliases: Record<string, string[]> = {
    revenue: [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'RevenuesNetOfInterestExpense',
      'InterestAndDividendIncomeOperating',
    ],
    netIncome: ['NetIncomeLoss', 'ProfitLoss'],
    assets: ['Assets'],
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  };

  for (const issuer of sample) {
    const padded = issuer.cik.padStart(10, '0');
    const facts = await secJson<CompanyFacts>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
    );
    if (!facts) {
      for (const concept of XBRL_CONCEPTS) {
        skip('xbrl', `${issuer.ticker} ${concept.key}`, 'companyfacts unavailable');
      }
      continue;
    }
    const extracted = extractFinancials(facts);

    for (const concept of XBRL_CONCEPTS) {
      const tags = authoritativeAliases[concept.key] || [concept.tag, ...concept.alternates];
      const annual: Array<{ tag: string; end: string; val: number; form: string; fp: string; start?: string }> = [];
      for (const tag of tags) {
        const units = await fetchCompanyConcept(issuer.cik, concept.taxonomy, tag);
        for (const unit of units || []) {
          if (!/^10-K(?:\/A)?$/.test(unit.form || '') || unit.fp !== 'FY' || !Number.isFinite(unit.val)) continue;
          const start = (unit as typeof unit & { start?: string }).start;
          const isAnnual = start
            ? Number.isFinite(Date.parse(unit.end) - Date.parse(start))
              && Date.parse(unit.end) - Date.parse(start) >= 300 * 24 * 60 * 60 * 1000
            : concept.key === 'assets' || concept.key === 'equity';
          if (isAnnual) annual.push({
            tag, end: unit.end, val: unit.val, form: unit.form, fp: unit.fp,
            ...((unit as typeof unit & { start?: string }).start ? { start: (unit as typeof unit & { start?: string }).start } : {}),
          });
        }
      }
      annual.sort((a, b) => b.end.localeCompare(a.end));

      if (!annual.length) {
        skip('xbrl', `${issuer.ticker} ${concept.key}`, `no annual ${tags.join('/')} facts`);
        continue;
      }

      const actual = extracted[productMetric[concept.key]];
      // Ground truth chooses the newest official annual period ACROSS every
      // supported concept alias. Anchoring expected truth to the product's own
      // period let a stale 2010/2018 extraction self-certify.
      const latestEnd = annual[0].end;
      const expected = annual.filter(item => item.end === latestEnd);
      const passed = Boolean(
        actual
        && expected.some(item => item.val === actual.value)
        && actual.periodEnd === latestEnd
        && actual.year === Number(latestEnd.slice(0, 4)),
      );

      record(
        'xbrl',
        `${issuer.ticker} product ${concept.key} equals latest official annual fact for ${latestEnd}`,
        passed,
        `product ${actual?.value ?? 'missing'} @ ${actual?.periodEnd ?? 'none'}; SEC candidates [${expected.map(item => `${item.tag}=${item.val}`).join(', ')}] @ ${latestEnd}`,
        {
          sourceUrls: [
            `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
            ...tags.map(tag => (
              `https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/${concept.taxonomy}/${tag}.json`
            )),
          ],
          target: { kind: 'xbrl-latest-annual', ticker: issuer.ticker, cik: issuer.cik, concept: concept.key },
          expected: { candidates: expected, periodEnd: latestEnd, year: Number(latestEnd.slice(0, 4)) },
          actual: actual
            ? { value: actual.value, periodEnd: actual.periodEnd, year: actual.year }
            : null,
        },
      );
    }
  }
}

// ── Suite: Boolean semantics against the live corpus ────────────────────────
interface ProductBooleanExecution {
  query: string;
  results: FilingResearchResult[];
  coverage: SearchCandidateCoverage | null;
  degraded: string[];
  requestDelta: number;
}

async function executeProductBoolean(query: string, limit = 120): Promise<ProductBooleanExecution> {
  let coverage: SearchCandidateCoverage | null = null;
  const degraded: string[] = [];
  const before = semanticAvailability.logicalRequests;
  const results = await withCandidateProductFetch(() => executeFilingResearchSearch({
    query,
    filters: {
      ...defaultSearchFilters,
      dateFrom: '2022-01-01',
      dateTo: new Date().toISOString().slice(0, 10),
      formTypes: ['10-K', '10-Q', '8-K'],
    },
    mode: 'boolean',
    defaultForms: '',
    limit,
    useEnrichedSearch: true,
    hydrateTextSignals: true,
    deferTextValidation: false,
    preferFastCandidateCollection: false,
    includeExhibits: false,
    entityScope: 'off',
    onCoverage: value => { coverage = value; },
    onDegraded: message => { degraded.push(message); },
  }));
  return {
    query,
    results,
    coverage,
    degraded,
    requestDelta: semanticAvailability.logicalRequests - before,
  };
}

interface VerifiedBooleanResultSet {
  errors: string[];
  branchWitnesses: Record<string, string[]>;
  manifest: Array<Record<string, string>>;
}

const booleanOfficialTextCache = new Map<string, string | null>();

async function officialBooleanResultText(result: FilingResearchResult): Promise<string | null> {
  const accession = result.accessionNumber.replace(/-/g, '');
  const document = result.matchedDocumentName || result.primaryDocument;
  const key = `${result.cik}:${accession}:${document}`;
  if (!booleanOfficialTextCache.has(key)) {
    const html = await fetchFilingHtml(result.cik, accession, document);
    booleanOfficialTextCache.set(key, html ? extractDocumentTextFromHtmlServer(html) : null);
  }
  return booleanOfficialTextCache.get(key) ?? null;
}

async function verifyBooleanResultSet(
  execution: ProductBooleanExecution,
  branches: string[] = [],
): Promise<VerifiedBooleanResultSet> {
  const errors: string[] = [];
  const branchWitnesses = Object.fromEntries(branches.map(branch => [branch, [] as string[]]));
  const manifest: Array<Record<string, string>> = [];

  if (execution.results.length === 0) errors.push('product executor returned no results');
  for (const result of execution.results) {
    const accession = result.accessionNumber.replace(/-/g, '');
    const document = result.matchedDocumentName || result.primaryDocument;
    const text = await officialBooleanResultText(result);
    if (!text) {
      errors.push(`official filing text unavailable for ${result.cik}/${accession}/${document}`);
      continue;
    }
    if (!booleanQueryMatches(execution.query, text)) {
      errors.push(`${accession} does not independently satisfy ${execution.query}`);
      continue;
    }
    for (const branch of branches) {
      if (booleanQueryMatches(branch, text)) branchWitnesses[branch].push(accession);
    }
    manifest.push({
      accession,
      cik: result.cik,
      form: result.formType,
      fileDate: result.fileDate,
      document,
      officialTextSha256: normalizedFilingTextSha256(text),
    });
  }
  return { errors, branchWitnesses, manifest };
}

function requiredBooleanLaneProblems(
  coverage: SearchCandidateCoverage | null,
  expectedBranches: string[],
): string[] {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const required = (coverage?.branches || []).filter(branch => branch.required);
  const problems: string[] = [];
  for (const expected of expectedBranches) {
    const lane = required.find(branch => normalize(branch.branch) === normalize(expected));
    if (!lane) {
      problems.push(`missing required executor lane ${expected}`);
    } else if (lane.pages <= 0 || lane.examined <= 0 || lane.matched <= 0) {
      problems.push(
        `required lane ${expected} did not contribute verified results ` +
        `(pages=${lane.pages}, examined=${lane.examined}, matched=${lane.matched})`,
      );
    }
  }
  return problems;
}

function deployedBooleanVerdictMatches(
  payload: Record<string, unknown> | null,
  expected: { cik: string; accession: string; document: string; matched: boolean },
): boolean {
  if (!payload || payload.ok !== true || !Array.isArray(payload.verdicts) || payload.verdicts.length !== 1) {
    return false;
  }
  const verdict = payload.verdicts[0] && typeof payload.verdicts[0] === 'object'
    ? payload.verdicts[0] as Record<string, unknown>
    : {};
  const summary = payload.summary && typeof payload.summary === 'object'
    ? payload.summary as Record<string, unknown>
    : {};
  return String(verdict.cik ?? '').replace(/^0+/, '') === expected.cik.replace(/^0+/, '')
    && String(verdict.accession ?? '').replace(/\D/g, '') === expected.accession.replace(/\D/g, '')
    && verdict.document === expected.document
    && verdict.validated === true
    && verdict.matched === expected.matched
    && Number(summary.requested) === 1
    && Number(summary.validated) === 1
    && Number(summary.matched) === (expected.matched ? 1 : 0)
    && summary.budgetExhausted === false;
}

/** A small route-level proof complements the broad checked-out executor sweep.
 * It cannot be replaced by local fetch emulation: all four calls cross the
 * immutable candidate and exercise the deployed cache/extractor/matcher. */
async function suiteBooleanDeployedCanary() {
  const suite = 'boolean-deployed';
  setCoverageTarget(suite, 1);
  process.stdout.write('\nBoolean deployed canary — immutable filing text + positive/negative validation\n');
  const before = semanticAvailability.logicalRequests;
  const problems: string[] = [];
  const issuer = ISSUERS[0];
  const filing = await latestFiling(issuer.cik, '10-K');
  if (!filing) {
    record(suite, 'immutable Boolean route canary', false, `official ${issuer.ticker} 10-K target unavailable`);
    return;
  }

  const target = {
    cik: String(Number(issuer.cik)),
    accession: filing.accession,
    form: '10-K',
    dateFiled: filing.filed,
    document: filing.document,
  };
  const secEftsParams = new URLSearchParams({
    path: 'LATEST/search-index',
    q: issuer.ticker,
    forms: '10-K',
    dateRange: 'custom',
    startdt: filing.filed,
    enddt: filing.filed,
    ciks: issuer.cik.padStart(10, '0'),
    from: '0',
    size: '100',
  });
  const secEftsResponse = await candidateRequestJson(`/api/sec-efts?${secEftsParams}`);
  const secEftsHits = Array.isArray(
    (secEftsResponse?.payload.hits as { hits?: unknown } | undefined)?.hits,
  )
    ? (secEftsResponse?.payload.hits as { hits: Array<Record<string, unknown>> }).hits
    : [];
  const secEftsGet = secEftsHits.some(hit => {
    const source = hit._source && typeof hit._source === 'object'
      ? hit._source as Record<string, unknown>
      : {};
    const ciks = Array.isArray(source.ciks) ? source.ciks : [source.ciks];
    return String(source.adsh ?? '').replace(/\D/g, '') === filing.accession.replace(/\D/g, '')
      && ciks.some(cik => String(cik ?? '').replace(/^0+/, '') === target.cik)
      && String(source.file_type ?? '') === '10-K'
      && String(source.file_date ?? '') === filing.filed;
  });
  if (!secEftsGet) problems.push('immutable /api/sec-efts did not return the exact official filing target');

  const filingTextPath = `/api/filing-text?${new URLSearchParams(target)}`;
  const officialHtml = await fetchFilingHtml(target.cik, target.accession, target.document);
  const officialText = officialHtml ? extractDocumentTextFromHtmlServer(officialHtml) : '';
  const filingTextResponse = await candidateRequestJson(filingTextPath);
  const filingText = typeof filingTextResponse?.payload.text === 'string'
    ? filingTextResponse.payload.text
    : '';
  const textIdentityProblem = validateIndependentFilingText(officialText, filingText);
  const filingTextGet = filingTextResponse?.payload.ok === true && textIdentityProblem === null;
  if (!filingTextGet) {
    problems.push(
      `immutable /api/filing-text did not return the independently verified target: ${textIdentityProblem || 'invalid response envelope'}`,
    );
  }

  const positiveTerm = ['revenue', 'assets', 'income', 'cash', 'financial', 'tax']
    .find(term => booleanQueryMatches(term, officialText));
  let sentinel = `zzzurcreleasecanary${filing.accession.slice(-8)}`;
  while (officialText.toLowerCase().includes(sentinel)) sentinel += 'x';
  if (!positiveTerm) problems.push('deployed filing carried no deterministic positive canary term');
  const positiveQuery = positiveTerm ? `${positiveTerm} NOT ${sentinel}` : '';
  const negativeQuery = positiveTerm ? `${positiveTerm} AND ${sentinel}` : '';
  if (
    !positiveQuery
    || !booleanQueryMatches(positiveQuery, officialText)
    || booleanQueryMatches(negativeQuery, officialText)
  ) {
    problems.push('independent matcher could not establish positive and negative residual truth');
  }

  const validate = async (query: string) => candidateRequestJson('/api/boolean-validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, candidates: [target], maxUpstreamAttempts: 4 }),
  });
  const positiveResponse = positiveQuery ? await validate(positiveQuery) : null;
  const negativeResponse = negativeQuery ? await validate(negativeQuery) : null;
  const positiveValidate = deployedBooleanVerdictMatches(positiveResponse?.payload ?? null, {
    ...target, matched: true,
  });
  const negativeValidate = deployedBooleanVerdictMatches(negativeResponse?.payload ?? null, {
    ...target, matched: false,
  });
  if (!positiveValidate) problems.push('immutable positive residual was not validated=true/matched=true');
  if (!negativeValidate) problems.push('immutable negative residual was not validated=true/matched=false');

  const candidateRequests = semanticAvailability.logicalRequests - before;
  if (candidateRequests !== 4) problems.push(`deployed canary made ${candidateRequests}/4 required requests`);
  Object.assign(booleanExecutionEvidence.deployedCanary, {
    pass: problems.length === 0,
    candidateBase: candidateBase(),
    candidateRequests,
    secEftsGet,
    filingTextGet,
    positiveValidate,
    negativeValidate,
  });
  replayEvidence.booleanDeployedCanary.push({
    candidateBase: candidateBase(),
    target,
    officialTextSha256: officialText ? normalizedFilingTextSha256(officialText) : null,
    deployedTextSha256: filingText ? normalizedFilingTextSha256(filingText) : null,
    positiveQuery,
    negativeQuery,
    candidateRequests,
    secEftsGet,
    filingTextGet,
    positiveValidate,
    negativeValidate,
  });
  record(
    suite,
    'immutable filing-text GET and positive/negative Boolean POST verdicts pass',
    problems.length === 0,
    problems.length > 0
      ? problems.join('; ')
      : `${issuer.ticker} ${filing.filed}: four exact-candidate requests, EFTS target and both residual outcomes independently confirmed`,
  );
}

async function suiteBoolean() {
  setCoverageTarget('boolean', BOOLEAN_CASES.length);
  process.stdout.write('\nBoolean semantics — complete product executor against immutable deployed APIs\n');

  for (const testCase of BOOLEAN_CASES) {
    const plan = compileSearchPlan({
      query: testCase.query,
      filters: {
        ...defaultSearchFilters,
        formTypes: [],
        exchange: [],
        acceleratedStatus: [],
      },
      mode: 'boolean',
      defaultForms: '',
      limit: 50,
      includeExhibits: false,
      deferTextValidation: false,
      preferFastCandidateCollection: false,
      hydrateTextSignals: false,
      useEnrichedSearch: true,
    });

    if (testCase.expect.kind === 'rejected-before-retrieval') {
      const compiled = compileBooleanQuery(testCase.query);
      const execution = await executeProductBoolean(testCase.query);
      record(
        'boolean',
        `"${testCase.query}" is rejected before retrieval`,
        !compiled.ok && plan === null && execution.results.length === 0 && execution.requestDelta === 0,
        compiled.ok || plan !== null || execution.results.length > 0 || execution.requestDelta > 0
          ? `executor returned ${execution.results.length} rows after ${execution.requestDelta} deployed request(s)`
          : `rejected before network work: ${compiled.message}`,
      );
      replayEvidence.booleanRejected.push({
        query: testCase.query,
        category: testCase.expect.kind,
        compiled: compiled.ok,
        planned: plan !== null,
        resultCount: execution.results.length,
        requestDelta: execution.requestDelta,
      });
      continue;
    }

    const compiled = compileBooleanQuery(testCase.query);
    if (!compiled.ok || !plan) {
      record(
        'boolean',
        `"${testCase.query}" compiles`,
        false,
        !compiled.ok ? compiled.message : 'product execution planner returned no plan',
      );
      continue;
    }

    const execution = await executeProductBoolean(testCase.query);
    const verified = await verifyBooleanResultSet(execution, testCase.branches ?? []);
    const requiredQueries = plan.filteredServerQueries.slice(0, plan.requiredBooleanBranches);
    const laneProblems = requiredBooleanLaneProblems(execution.coverage, requiredQueries);
    const problems = [...verified.errors, ...laneProblems];

    if (testCase.expect.kind === 'union-superset-of-branches') {
      const combinedAccessions = new Set(verified.manifest.map(item => item.accession));
      for (const branch of testCase.branches ?? []) {
        if ((verified.branchWitnesses[branch] || []).length === 0) {
          problems.push(`merged product result has no independent witness for OR branch ${branch}`);
        }
        const branchExecution = await executeProductBoolean(branch, 20);
        const branchVerified = await verifyBooleanResultSet(branchExecution);
        problems.push(...branchVerified.errors.map(problem => `${branch}: ${problem}`));
        const expectedBranchWindow = branchVerified.manifest.map(item => item.accession);
        if (expectedBranchWindow.length === 0) {
          problems.push(`bounded branch execution ${branch} produced no independently verified accessions`);
        }
        const missing = missingBoundedAccessions(expectedBranchWindow, combinedAccessions);
        if (missing.length > 0) {
          problems.push(`merged OR result dropped ${missing.length}/${expectedBranchWindow.length} bounded ${branch} accessions: ${missing.join(', ')}`);
        }
        replayEvidence.boolean.push({
          query: branchExecution.query,
          role: 'or-branch-window',
          results: branchVerified.manifest,
          coverage: branchExecution.coverage,
          degraded: branchExecution.degraded,
        });
      }
      record(
        'boolean',
        `"${testCase.query}" merges every required OR lane and returns only verified matches`,
        problems.length === 0,
        problems.length > 0
          ? problems.join('; ')
          : `${execution.results.length} merged rows; witnesses ${JSON.stringify(verified.branchWitnesses)} — ${testCase.note}`,
      );
    }

    if (testCase.expect.kind === 'intersection-subset-of-each-branch') {
      const combinedAccessions = new Set(verified.manifest.map(item => item.accession));
      const boundedAndExpected = new Set<string>();
      for (const branch of testCase.branches ?? []) {
        const branchExecution = await executeProductBoolean(branch, 40);
        const branchVerified = await verifyBooleanResultSet(branchExecution, [testCase.query]);
        problems.push(...branchVerified.errors.map(problem => `${branch}: ${problem}`));
        for (const accession of branchVerified.branchWitnesses[testCase.query] || []) {
          boundedAndExpected.add(accession);
        }
        replayEvidence.boolean.push({
          query: branchExecution.query,
          role: 'and-candidate-window',
          results: branchVerified.manifest,
          fullExpressionWitnesses: branchVerified.branchWitnesses[testCase.query] || [],
          coverage: branchExecution.coverage,
        });
      }
      if (boundedAndExpected.size === 0) {
        problems.push('bounded independent branch windows produced no positive AND witness');
      }
      const missingAnd = missingBoundedAccessions([...boundedAndExpected], combinedAccessions);
      if (missingAnd.length > 0) {
        problems.push(`AND executor dropped ${missingAnd.length}/${boundedAndExpected.size} independently classified accessions: ${missingAnd.join(', ')}`);
      }

      // An anchor+NOT expression forces broad candidate retrieval followed by
      // the same residual-filter stage as AND. Independently validating every
      // returned filing makes a skipped/incorrect filter a release failure.
      const residualExecution = await executeProductBoolean('lease NOT sublease');
      const residualVerified = await verifyBooleanResultSet(residualExecution);
      const residualAccessions = new Set(residualVerified.manifest.map(item => item.accession));
      const residualAnchorExecution = await executeProductBoolean('lease', 40);
      const residualAnchorVerified = await verifyBooleanResultSet(
        residualAnchorExecution,
        ['lease NOT sublease'],
      );
      const expectedResidual = residualAnchorVerified.branchWitnesses['lease NOT sublease'] || [];
      const negativeResidualControls = residualAnchorVerified.manifest
        .map(item => item.accession)
        .filter(accession => !expectedResidual.includes(accession));
      const residualWork = residualExecution.coverage?.work;
      const residualProblems = [...residualVerified.errors, ...residualAnchorVerified.errors];
      if (expectedResidual.length === 0 || negativeResidualControls.length === 0) {
        residualProblems.push(
          `residual candidate window lacks ${expectedResidual.length === 0 ? 'positive matches' : 'anchor-only negative controls'}`,
        );
      }
      const missingResidual = missingBoundedAccessions(expectedResidual, residualAccessions);
      if (missingResidual.length > 0) {
        residualProblems.push(
          `residual executor dropped ${missingResidual.length}/${expectedResidual.length} independently classified accessions: ${missingResidual.join(', ')}`,
        );
      }
      if (!residualWork || residualWork.docFetches <= 0) {
        residualProblems.push('residual-control executor did not hydrate any candidate documents');
      }
      problems.push(...residualProblems);
      record(
        'boolean',
        `"${testCase.query}" and residual controls return only full-expression matches`,
        problems.length === 0,
        problems.length > 0
          ? problems.join('; ')
          : `${execution.results.length} AND rows and ${residualExecution.results.length} independently verified residual rows — ${testCase.note}`,
      );
      replayEvidence.boolean.push({
        query: residualExecution.query,
        results: residualVerified.manifest,
        boundedExpected: expectedResidual,
        boundedNegativeControls: negativeResidualControls,
        coverage: residualExecution.coverage,
        degraded: residualExecution.degraded,
      });
    }

    if (testCase.expect.kind === 'phrase-stricter-than-tokens') {
      const phraseAccessions = new Set(verified.manifest.map(item => item.accession));
      const looseQuery = testCase.branches?.[0] || '';
      const looseExecution = await executeProductBoolean(looseQuery, 40);
      const looseVerified = await verifyBooleanResultSet(looseExecution, [testCase.query]);
      problems.push(...looseVerified.errors.map(problem => `loose-token window: ${problem}`));
      const exactExpected = looseVerified.branchWitnesses[testCase.query] || [];
      const looseOnly = looseVerified.manifest
        .map(item => item.accession)
        .filter(accession => !exactExpected.includes(accession));
      if (exactExpected.length === 0 || looseOnly.length === 0) {
        problems.push(`loose-token window lacks ${exactExpected.length === 0 ? 'exact-phrase positives' : 'loose-only controls'}`);
      }
      const missingPhrase = missingBoundedAccessions(exactExpected, phraseAccessions);
      if (missingPhrase.length > 0) {
        problems.push(`phrase executor dropped ${missingPhrase.length}/${exactExpected.length} bounded exact-phrase accessions: ${missingPhrase.join(', ')}`);
      }
      record(
        'boolean',
        `"${testCase.query}" delegated phrase returns only exact-phrase filings`,
        problems.length === 0 && plan.delegatedToEfts,
        problems.length > 0
          ? problems.join('; ')
          : `${execution.results.length} exact-phrase rows independently verified — ${testCase.note}`,
      );
      replayEvidence.boolean.push({
        query: looseExecution.query,
        role: 'loose-token-control-window',
        results: looseVerified.manifest,
        exactPhraseExpected: exactExpected,
        looseOnlyControls: looseOnly,
        coverage: looseExecution.coverage,
      });
    }

    replayEvidence.boolean.push({
      query: execution.query,
      requiredQueries,
      results: verified.manifest,
      branchWitnesses: verified.branchWitnesses,
      coverage: execution.coverage,
      degraded: execution.degraded,
    });
  }
}

// ── Suite: server/client matcher equivalence on REAL filings ────────────────
function referenceStem(value: string): string {
  if (value.length <= 3 || value.endsWith('ss')) return value;
  if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith('sses')) return value.slice(0, -2);
  return value.endsWith('s') ? value.slice(0, -1) : value;
}

function referenceWords(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) || []).map(referenceStem);
}

function referenceHasPhrase(text: string[], phrase: string): boolean {
  const expected = referenceWords(phrase);
  if (expected.length === 0) return false;
  for (let index = 0; index <= text.length - expected.length; index += 1) {
    if (expected.every((word, offset) => text[index + offset] === word)) return true;
  }
  return false;
}

async function suiteMatcherEquivalence() {
  const issuerTarget = 4;
  setCoverageTarget('equivalence', issuerTarget * 2, ISSUERS.length * 2);
  process.stdout.write('\nMatcher equivalence — product matcher vs independent reference, on real 10-Ks\n');

  const probes = [
    { query: '"material weakness"', reference: (words: string[]) => referenceHasPhrase(words, 'material weakness') },
    { query: 'goodwill AND impairment', reference: (words: string[]) => words.includes('goodwill') && words.includes('impairment') },
    { query: '"critical audit matter"', reference: (words: string[]) => referenceHasPhrase(words, 'critical audit matter') },
    { query: 'revenue AND "performance obligation"', reference: (words: string[]) => words.includes('revenue') && referenceHasPhrase(words, 'performance obligation') },
    { query: 'lease NOT sublease', reference: (words: string[]) => words.includes('lease') && !words.includes('sublease') },
  ];

  let scoredIssuers = 0;
  for (const [candidateOrdinal, issuer] of ISSUERS.entries()) {
    if (scoredIssuers >= issuerTarget) break;
    const filing = await latestFiling(issuer.cik, '10-K');
    if (!filing) { exclude('equivalence', `${issuer.ticker} 10-K`, 'no 10-K; replaced by next deterministic issuer'); continue; }

    const html = await fetchFilingHtml(issuer.cik, filing.accession, filing.document);
    if (!html) { exclude('equivalence', `${issuer.ticker} 10-K`, 'document fetch failed; replaced by next deterministic issuer'); continue; }

    const text = extractDocumentTextFromHtmlServer(html);
    if (!text || text.length < 5_000) {
      exclude('equivalence', `${issuer.ticker} 10-K`, `extracted only ${text?.length ?? 0} chars; replaced`);
      continue;
    }

    const words = referenceWords(text);
    let agreed = 0;
    for (const probe of probes) {
      const compiled = compileBooleanQuery(probe.query);
      if (!compiled.ok) continue;
      const expression = compiled.residual || probe.query;
      const product = booleanQueryMatches(expression, text);
      if (product === probe.reference(words)) agreed += 1;
    }

    record(
      'equivalence',
      `${issuer.ticker} ${filing.filed} 10-K: product matches independent truth for ${probes.length} probes`,
      agreed === probes.length,
      `${agreed}/${probes.length} agreed over ${text.length.toLocaleString()} chars`,
      {
        sourceUrls: [`https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${filing.accession}/${filing.document}`],
        target: {
          kind: 'equivalence-agreement', ticker: issuer.ticker, cik: issuer.cik,
          accession: filing.accession, date: filing.filed, form: '10-K', document: filing.document,
          selection: {
            candidateOrdinal, scoredOrdinal: scoredIssuers + 1,
            replacementCountBefore: candidateOrdinal - scoredIssuers,
          },
        },
        expected: { agreements: probes.length },
        actual: { agreements: agreed },
      },
    );

    const expectedHits = probes.filter(probe => probe.reference(words)).length;
    record(
      'equivalence',
      `${issuer.ticker} 10-K independent reference has a decidable positive`,
      expectedHits > 0,
      expectedHits > 0 ? `${expectedHits}/${probes.length} reference probes matched` : 'no reference probe matched; sample cannot prove positive retrieval',
      {
        sourceUrls: [`https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${filing.accession}/${filing.document}`],
        target: {
          kind: 'equivalence-positive', ticker: issuer.ticker, cik: issuer.cik,
          accession: filing.accession, date: filing.filed, form: '10-K', document: filing.document,
          selection: {
            candidateOrdinal, scoredOrdinal: scoredIssuers + 1,
            replacementCountBefore: candidateOrdinal - scoredIssuers,
          },
        },
        expected: { minimumHits: 1 },
        actual: { hits: expectedHits },
      },
    );
    scoredIssuers += 1;
  }
}

// ── Suite: topic retrieval + auditor attribution ────────────────────────────
async function suiteDisclosure() {
  const requestedSample = Number(process.env.ACCURACY_DISCLOSURE_SAMPLE || ISSUERS.length);
  const sampleSize = Number.isFinite(requestedSample)
    ? Math.max(1, Math.min(ISSUERS.length, Math.floor(requestedSample)))
    : ISSUERS.length;
  const sample = ISSUERS.slice(0, sampleSize);
  setCoverageTarget('disclosure', sample.length * (TOPIC_CASES.length + 1));
  const sectors = [...new Set(sample.map(i => i.sector))];
  process.stdout.write(
    `\nDisclosure retrieval — topic locator + auditor, ${sample.length} issuers across ` +
    `${sectors.length} sectors (${sectors.join(', ')})\n`
  );

  for (const issuer of sample) {
    const filing = await latestFiling(issuer.cik, '10-K');
    if (!filing) { skip('disclosure', `${issuer.ticker} 10-K`, 'no 10-K'); continue; }
    // Follows the statements exhibit when the 10-K body incorporates the
    // financials by reference, exactly as the product does.
    const resolved = await fetchDisclosureHtml(issuer.cik, filing.accession, filing.document);
    if (!resolved) { skip('disclosure', `${issuer.ticker} 10-K`, 'fetch failed'); continue; }
    const { html } = resolved;
    const text = extractDocumentTextFromHtmlServer(html);
    if (!text || text.length < 5_000) { skip('disclosure', `${issuer.ticker} 10-K`, 'thin extraction'); continue; }
    const filingDirectory = `https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${filing.accession}`;
    const archiveDocumentUrl = `${filingDirectory}/${filing.document}`;
    const resolvedDocumentUrl = `${filingDirectory}/${resolved.document}`;
    const filingSummaryUrl = `${filingDirectory}/FilingSummary.xml`;
    const resolvedTextSha256 = createHash('sha256').update(text).digest('hex');
    const resolvedHtmlSha256 = createHash('sha256').update(html).digest('hex');

    // The registrant's own note index, when the filing carries iXBRL tagging.
    const filingSummaryXml = await secText(filingSummaryUrl) || '';
    const reports = parseFilingSummary(filingSummaryXml);
    const blockText = new Map<string, string>();
    const loadBlock = async (file: string): Promise<string> => {
      if (!blockText.has(file)) {
        const raw = await secText(
          `https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${filing.accession}/${file}`
        );
        blockText.set(file, raw ? extractDocumentTextFromHtmlServer(stripSgmlEnvelope(raw)) : '');
      }
      return blockText.get(file) || '';
    };

    for (const topicCase of TOPIC_CASES) {
      const topic = findDisclosureTopic(topicCase.topicId);
      if (!topic) { skip('disclosure', topicCase.topicId, 'topic not in catalogue'); continue; }

      // Tagged blocks first; the prose locator over the whole filing is the
      // fallback for anything the registrant did not tag.
      const block = reports.length
        ? await locateTopicInBlocks({ reports, topic, loadBlock, locate: locateTopicPassage })
        : null;
      const passage = block?.passage ?? locateTopicPassage(text, topic);
      const source = block ? `block “${block.blockName}”` : 'full document';
      const blockSourceText = block
        ? stripXbrlReportChrome(blockText.get(block.blockFile) || '')
        : '';
      const scoredSource = block
        ? {
            kind: 'filing-summary-block',
            document: block.blockFile,
            url: `${filingDirectory}/${block.blockFile}`,
            blockName: block.blockName,
            textLength: block.sourceTextLength,
            textSha256: createHash('sha256').update(blockSourceText).digest('hex'),
            selectorSource: {
              kind: 'filing-summary',
              document: 'FilingSummary.xml',
              url: filingSummaryUrl,
              payloadSha256: createHash('sha256').update(filingSummaryXml).digest('hex'),
            },
          }
        : {
            kind: 'resolved-annual-document',
            document: resolved.document,
            url: resolvedDocumentUrl,
            textLength: text.length,
            textSha256: resolvedTextSha256,
          };

      const found = passage.matchKind !== 'none';
      const lower = passage.text.toLowerCase();
      const hit = topicCase.mustContain.find(term => lower.includes(term));

      record(
        'disclosure',
        `${issuer.ticker} (${issuer.sector}) → ${topic.label} passage is on-topic`,
        found && Boolean(hit),
        found
          ? hit
            ? `${source}, matched by ${passage.matchKind}, ${passage.text.length} chars, evidence term "${hit}"`
            : `${source}, matched by ${passage.matchKind}, ${passage.text.length} chars, none of ${topicCase.mustContain.join(' / ')}`
          : `${source}, no passage located`,
        {
          sourceUrls: [...new Set([
            archiveDocumentUrl,
            resolvedDocumentUrl,
            ...(block ? [filingSummaryUrl, scoredSource.url] : []),
          ])],
          target: {
            kind: 'disclosure-topic', ticker: issuer.ticker, cik: issuer.cik,
            accession: filing.accession, date: filing.filed, form: '10-K', topic: topicCase.topicId,
            document: filing.document,
            resolvedDocument: resolved.document,
            scoredSource,
          },
          expected: { found: true, mustContain: topicCase.mustContain },
          actual: {
            found, hit: hit ?? null, matchKind: passage.matchKind,
            textLength: passage.text.length,
            sourceTextLength: scoredSource.textLength,
            sourceTextSha256: scoredSource.textSha256,
          },
        },
      );
    }

    // Ground truth is the filing's own dei:AuditorName tag, so this compares
    // our prose detector against the registrant's structured declaration —
    // two independent readings of the same document.
    const declared = auditorFromIxbrl(html);
    if (!declared.name) {
      skip('disclosure', `${issuer.ticker} auditor`, 'filing carries no dei:AuditorName tag');
      continue;
    }

    const detected = canonicalizeAuditorInput(detectAuditorInText(text) || '');
    const expected = canonicalizeAuditorInput(declared.name);
    record(
      'disclosure',
      `${issuer.ticker} auditor matches the filing's own tag (${declared.name})`,
      Boolean(detected) && detected === expected,
      `detected "${detected || 'nothing'}", filing declares "${expected}"` +
      (declared.firmId ? ` (PCAOB ${declared.firmId})` : ''),
      {
        sourceUrls: [...new Set([archiveDocumentUrl, resolvedDocumentUrl])],
        target: {
          kind: 'disclosure-auditor', ticker: issuer.ticker, cik: issuer.cik,
          accession: filing.accession, date: filing.filed, form: '10-K', declaredAuditor: expected,
          document: filing.document,
          resolvedDocument: resolved.document,
          scoredSource: {
            kind: 'resolved-annual-document',
            document: resolved.document,
            url: resolvedDocumentUrl,
            textLength: text.length,
            textSha256: resolvedTextSha256,
            rawHtmlSha256: resolvedHtmlSha256,
          },
        },
        expected: { auditor: expected, pcaobFirmId: declared.firmId ?? null },
        actual: {
          auditor: detected || null,
          sourceTextLength: text.length,
          sourceTextSha256: resolvedTextSha256,
          sourceHtmlSha256: resolvedHtmlSha256,
        },
      },
    );
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────
const SUITES: Record<string, () => Promise<void>> = {
  entity: suiteEntity,
  'filing-entity': suiteFilingEntity,
  xbrl: suiteXbrl,
  'boolean-deployed': suiteBooleanDeployedCanary,
  boolean: suiteBoolean,
  equivalence: suiteMatcherEquivalence,
  disclosure: suiteDisclosure,
};

function finalizeCoverage(selected: string[]): boolean {
  let complete = true;
  for (const suite of selected) {
    const target = coverageTargets.get(suite);
    const suiteChecks = checks.filter(check => check.suite === suite);
    const suiteExclusions = exclusions.filter(item => item.suite === suite).length;
    const existing = coverage[suite] || {};
    const scored = suiteChecks.filter(check => !check.skipped).length;
    const skipped = suiteChecks.filter(check => check.skipped).length;
    const failed = suiteChecks.filter(check => !check.skipped && !check.passed).length;
    const expected = target?.target ?? Number(existing.target ?? 0);
    const examineLimit = target?.examineLimit ?? Number(existing.examineLimit ?? expected);
    const examined = Number(existing.examined ?? (suiteChecks.length + suiteExclusions));
    coverage[suite] = {
      ...existing,
      target: expected,
      scored,
      skipped,
      failed,
      examined,
      examineLimit,
      exclusions: Number(existing.exclusions ?? suiteExclusions),
    };
    if (
      !target
      || expected <= 0
      || scored !== expected
      || skipped !== 0
      || !Number.isSafeInteger(examined)
      || examined < scored + skipped
      || !Number.isSafeInteger(examineLimit)
      || examineLimit <= 0
      || examined > examineLimit
    ) {
      complete = false;
    }
  }
  return complete;
}

/** Below this the gate fails. Raise it as accuracy improves; never lower it. */
const THRESHOLD = Number(process.env.ACCURACY_THRESHOLD || 97);

async function main() {
  const args = process.argv.slice(2);
  const suiteArg = args[args.indexOf('--suite') + 1];
  const jsonArg = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const selected = args.includes('--suite') && SUITES[suiteArg] ? [suiteArg] : Object.keys(SUITES);

  process.stdout.write(`Accuracy gate — suites: ${selected.join(', ')}\n`);
  const startedAt = Date.now();

  for (const name of selected) {
    try {
      await SUITES[name]();
    } catch (error) {
      skip(name, `${name} suite`, `threw: ${(error as Error).message}`);
    }
  }

  const coverageComplete = finalizeCoverage(selected);

  const scored = checks.filter(c => !c.skipped);
  const passed = scored.filter(c => c.passed);
  const skipped = checks.filter(c => c.skipped);
  const score = scored.length ? (passed.length / scored.length) * 100 : 0;

  process.stdout.write('\n' + '─'.repeat(64) + '\n');
  for (const suite of selected) {
    const inSuite = scored.filter(c => c.suite === suite);
    if (!inSuite.length) continue;
    const ok = inSuite.filter(c => c.passed).length;
    process.stdout.write(`  ${suite.padEnd(14)} ${String(ok).padStart(3)}/${String(inSuite.length).padEnd(3)}  ${((ok / inSuite.length) * 100).toFixed(1)}%\n`);
  }
  process.stdout.write('─'.repeat(64) + '\n');
  process.stdout.write(`  SCORE ${passed.length}/${scored.length} = ${score.toFixed(1)}%  (threshold ${THRESHOLD}%)\n`);
  if (skipped.length) {
    process.stdout.write(`  ${skipped.length} check(s) skipped — unreachable sources, not scored:\n`);
    for (const s of skipped) process.stdout.write(`     ~ ${s.name}: ${s.detail}\n`);
  }
  if (exclusions.length) {
    process.stdout.write(`  ${exclusions.length} deterministic replacement exclusion(s), recorded but not counted as skips:\n`);
    for (const item of exclusions) process.stdout.write(`     · [${item.suite}] ${item.name}: ${item.detail}\n`);
  }
  process.stdout.write(`  ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

  const failures = scored.filter(c => !c.passed);
  if (failures.length) {
    process.stdout.write('\n  Failures:\n');
    for (const f of failures) process.stdout.write(`    ✗ [${f.suite}] ${f.name}\n       ${f.detail}\n`);
  }

  if (jsonArg) {
    const replayEvidenceManifest = {
      algorithm: 'sha256',
      count: Object.values(replayEvidence).reduce((sum, rows) => sum + rows.length, 0),
      digest: createHash('sha256').update(JSON.stringify(replayEvidence)).digest('hex'),
    };
    const booleanChecks = checks.filter(check => check.suite === 'boolean');
    for (const [index, check] of booleanChecks.entries()) {
      const testCase = BOOLEAN_CASES[index];
      check.evidence = {
        sourceUrls: [
          candidateBase() || 'missing-immutable-candidate',
          'https://www.sec.gov/Archives/edgar/data/',
        ],
        target: {
          kind: 'boolean-case',
          query: testCase?.query ?? '',
          category: testCase?.expect.kind ?? '',
          branches: testCase?.branches ?? [],
        },
        expected: { replayPass: true },
        actual: { replayEvidenceSha256: replayEvidenceManifest.digest },
      };
    }
    const deployedCheck = checks.find(check => check.suite === 'boolean-deployed');
    if (deployedCheck) {
      const canary = replayEvidence.booleanDeployedCanary[0] as Record<string, unknown> | undefined;
      const target = canary?.target && typeof canary.target === 'object'
        ? canary.target as Record<string, unknown>
        : {};
      deployedCheck.evidence = {
        sourceUrls: [
          candidateBase() || 'missing-immutable-candidate',
          `https://www.sec.gov/Archives/edgar/data/${Number(target.cik)}/${String(target.accession).replace(/-/g, '')}/${String(target.document)}`,
        ],
        target: { kind: 'boolean-deployed-canary', ...target },
        expected: { replayPass: true },
        actual: { replayEvidenceSha256: replayEvidenceManifest.digest },
      };
    }
    const evidenceRows = scored.map(check => ({
      suite: check.suite,
      name: check.name,
      passed: check.passed,
      evidence: check.evidence,
    }));
    const filingEntitySelectionManifest = filingEntityDirectoryEvidence ? {
      schema: 'urc.semantic-filing-entity-selection.v1',
      directorySource: 'https://www.sec.gov/files/company_tickers.json',
      ordering: 'canonical-ticker-cik-v1',
      directoryCount: filingEntityDirectoryEvidence.count,
      directoryProjectionDigest: filingEntityDirectoryEvidence.projectionDigest,
      count: filingEntitySelectionTrace.length,
      rows: filingEntitySelectionTrace,
      algorithm: 'sha256',
      digest: createHash('sha256').update(JSON.stringify(filingEntitySelectionTrace)).digest('hex'),
    } : null;
    writeFileSync(jsonArg, JSON.stringify({
      score,
      threshold: THRESHOLD,
      selectedSuites: selected,
      complete: coverageComplete
        && semanticAvailability.serverErrorResponses === 0
        && semanticAvailability.requestErrors === 0,
      checks,
      evidenceManifest: {
        algorithm: 'sha256',
        count: evidenceRows.length,
        digest: createHash('sha256').update(JSON.stringify(evidenceRows)).digest('hex'),
        rows: evidenceRows,
      },
      exclusions,
      coverage,
      filingEntitySelectionManifest,
      replay: replayEvidence,
      replayEvidenceManifest,
      booleanExecutionEvidence,
      availability: semanticAvailability,
      candidateRequestBudget: { maximum: MAX_SEMANTIC_CANDIDATE_REQUESTS },
      candidateBase: candidateBase(),
    }, null, 2));
    process.stdout.write(`\n  report → ${jsonArg}\n`);
  }

  const complete = coverageComplete
    && semanticAvailability.serverErrorResponses === 0
    && semanticAvailability.requestErrors === 0;
  if (!complete) {
    process.stderr.write('  GATE INCOMPLETE: a suite missed its exact quota, skipped a target, or the deployed path was unavailable.\n');
  }
  process.exit(score >= THRESHOLD && complete ? 0 : 1);
}

main().catch(error => {
  process.stderr.write(`accuracy gate crashed: ${(error as Error).stack}\n`);
  process.exit(1);
});
