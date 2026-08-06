/**
 * INPUT layer — artefact acquisition (I1 filing package, I2 filing history,
 * I3 entity reference, I4 authority corpus).
 *
 * Every SEC read goes through `sec-upstream`, the same audited path the
 * research centre uses: strict target allow-list, central fair-access pacing
 * across redirects, bounded body reads, media-type validation and error-page
 * detection. Filing AI adds no new egress surface — it inherits one that has
 * already been hardened.
 *
 * Server-only. Importing this into a client bundle would ship the SEC fetch
 * path and its user-agent into the browser.
 */

import { createHash } from 'node:crypto';

import {
  assertSecDocumentResponse,
  buildSecTargetUrl,
  fetchSecJson,
  fetchSecResponse,
  looksLikeSecErrorResponse,
  readResponseWithLimit,
  SecUpstreamError,
} from '../sec-upstream';
import type {
  AuthorityPin,
  EntityReference,
  FilingHistoryEntry,
  SubmissionDocument,
} from './types';

const USER_AGENT =
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_JSON_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Exhibits are small; a certification that large is a parse problem, not a filing. */
const MAX_EXHIBIT_BYTES = 4 * 1024 * 1024;

export function padCik(cik: string): string {
  return cik.replace(/\D/g, '').padStart(10, '0');
}

export function stripCik(cik: string): string {
  return String(Number(cik.replace(/\D/g, '')));
}

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

const FILER_STATUS_MAP: Array<[RegExp, EntityReference['filer_status']]> = [
  [/large accelerated/i, 'large_accelerated'],
  [/non-accelerated|non accelerated/i, 'non_accelerated'],
  [/accelerated/i, 'accelerated'],
];

function mapFilerStatus(category: string): EntityReference['filer_status'] {
  for (const [pattern, status] of FILER_STATUS_MAP) {
    if (pattern.test(category)) return status;
  }
  return 'unknown';
}

export interface SubmissionsBundle {
  entity: EntityReference;
  history: FilingHistoryEntry[];
}

/**
 * I3 entity reference plus I2 filing history, from one submissions document.
 *
 * EDGAR's `filings.recent` covers roughly the last 1,000 filings — deep enough
 * for the eight-quarter amendment window the filer-risk band needs, and for
 * locating the prior annual report the continuity layer diffs against.
 */
export async function fetchSubmissions(cik: string, signal: AbortSignal): Promise<SubmissionsBundle> {
  const padded = padCik(cik);
  const payload = asRecord(
    await fetchSecJson({
      upstream: 'data',
      path: `/submissions/CIK${padded}.json`,
      userAgent: USER_AGENT,
      maxBytes: MAX_JSON_BYTES,
      signal,
    }),
  );

  const category = asString(payload.category);
  const exchanges = asStringArray(payload.exchanges).filter(Boolean);
  const entity: EntityReference = {
    cik: padded,
    legal_name: asString(payload.name),
    fiscal_year_end: asString(payload.fiscalYearEnd) || null,
    filer_status: mapFilerStatus(category),
    is_src: typeof payload.entityType === 'string' ? /smaller reporting/i.test(category) : null,
    is_shell: null,
    state_of_incorporation: asString(payload.stateOfIncorporation) || null,
    ein: asString(payload.ein) || null,
    sic: asString(payload.sic) || null,
    sic_description: asString(payload.sicDescription) || null,
    tickers: asStringArray(payload.tickers),
    exchanges,
    file_number: asStringArray(payload.fileNumber)[0] || asString(payload.fileNumber) || null,
    entity_type: asString(payload.entityType) || null,
  };

  const recent = asRecord(asRecord(payload.filings).recent);
  const accessions = asStringArray(recent.accessionNumber);
  const forms = asStringArray(recent.form);
  const filingDates = asStringArray(recent.filingDate);
  const reportDates = asStringArray(recent.reportDate);
  const primaryDocuments = asStringArray(recent.primaryDocument);

  const history: FilingHistoryEntry[] = accessions.map((accession, index) => ({
    accession,
    form: forms[index] || '',
    filing_date: filingDates[index] || '',
    period_of_report: reportDates[index] || '',
    primary_document: primaryDocuments[index] || '',
    is_amendment: (forms[index] || '').endsWith('/A'),
  }));

  return { entity, history };
}

export interface FilingIndex {
  accession: string;
  accessionCompact: string;
  documents: SubmissionDocument[];
}

/**
 * I1 filing package manifest. The EDGAR filing index is the authoritative list
 * of what was actually submitted — the exhibit index printed inside the primary
 * document is the filer's *claim* about it, and the gap between the two is
 * rule R-MECH-EXH-100.
 */
export async function fetchFilingIndex(
  cik: string,
  accession: string,
  signal: AbortSignal,
): Promise<FilingIndex> {
  const compact = accession.replace(/-/g, '');
  const base = `/Archives/edgar/data/${stripCik(cik)}/${compact}`;
  const payload = asRecord(
    await fetchSecJson({
      upstream: 'proxy',
      path: `${base}/index.json`,
      userAgent: USER_AGENT,
      maxBytes: MAX_JSON_BYTES,
      signal,
    }),
  );

  const items = Array.isArray(asRecord(payload.directory).item)
    ? (asRecord(payload.directory).item as unknown[])
    : [];

  const documents: SubmissionDocument[] = items.map(entry => {
    const item = asRecord(entry);
    const name = asString(item.name);
    return {
      name,
      type: asString(item.type),
      description: asString(item.description) || asString(item.type),
      size: Number(item.size) || 0,
      url: `https://www.sec.gov${base}/${name}`,
    };
  });

  return { accession, accessionCompact: compact, documents };
}

export interface FetchedDocument {
  name: string;
  url: string;
  html: string;
  bytes: number;
  sha256: string;
}

/** Fetch one document from a filing's archive directory. */
export async function fetchFilingDocument(
  cik: string,
  accessionCompact: string,
  documentName: string,
  signal: AbortSignal,
  maxBytes = MAX_DOCUMENT_BYTES,
): Promise<FetchedDocument> {
  const path = `/Archives/edgar/data/${stripCik(cik)}/${accessionCompact}/${documentName}`;
  const target = buildSecTargetUrl('proxy', path, new URLSearchParams());
  const response = await fetchSecResponse(target, 'proxy', signal, USER_AGENT);
  assertSecDocumentResponse(response);
  const bytes = await readResponseWithLimit(response, maxBytes, signal, 20_000, true);
  if (looksLikeSecErrorResponse(bytes)) {
    throw new SecUpstreamError('SEC upstream returned an error page for the filing document.', 502);
  }
  const html = new TextDecoder('utf-8').decode(bytes);
  return {
    name: documentName,
    url: target.toString(),
    html,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

export async function fetchExhibitDocument(
  cik: string,
  accessionCompact: string,
  documentName: string,
  signal: AbortSignal,
): Promise<FetchedDocument> {
  return fetchFilingDocument(cik, accessionCompact, documentName, signal, MAX_EXHIBIT_BYTES);
}

export interface CompanyFact {
  concept: string;
  value: number;
  unit: string;
  start?: string;
  end: string;
  fiscal_year?: number;
  fiscal_period?: string;
  form: string;
  accession: string;
  filed: string;
}

/**
 * I2 continuity source. Company facts carry every value a registrant has
 * reported for a concept together with the accession that reported it, which
 * is what makes "as originally reported" answerable without re-parsing the
 * prior filing's instance.
 */
export async function fetchCompanyFacts(
  cik: string,
  concepts: Set<string>,
  signal: AbortSignal,
): Promise<CompanyFact[]> {
  const padded = padCik(cik);
  const payload = asRecord(
    await fetchSecJson({
      upstream: 'data',
      path: `/api/xbrl/companyfacts/CIK${padded}.json`,
      userAgent: USER_AGENT,
      maxBytes: MAX_JSON_BYTES,
      signal,
    }),
  );

  const facts: CompanyFact[] = [];
  const taxonomies = asRecord(payload.facts);
  for (const taxonomy of ['us-gaap', 'ifrs-full', 'dei']) {
    const conceptMap = asRecord(taxonomies[taxonomy]);
    for (const [concept, conceptEntry] of Object.entries(conceptMap)) {
      if (!concepts.has(concept)) continue;
      const units = asRecord(asRecord(conceptEntry).units);
      for (const [unit, entries] of Object.entries(units)) {
        if (!Array.isArray(entries)) continue;
        for (const rawEntry of entries) {
          const entry = asRecord(rawEntry);
          const value = Number(entry.val);
          const end = asString(entry.end);
          if (!Number.isFinite(value) || !end) continue;
          facts.push({
            concept,
            value,
            unit,
            start: asString(entry.start) || undefined,
            end,
            fiscal_year: typeof entry.fy === 'number' ? entry.fy : undefined,
            fiscal_period: asString(entry.fp) || undefined,
            form: asString(entry.form),
            accession: asString(entry.accn),
            filed: asString(entry.filed),
          });
        }
      }
    }
  }
  return facts;
}

/**
 * I4 authority corpus, pinned from the filing period (GR-6, G8).
 *
 * Resolving these from `now()` is the defect this function exists to prevent:
 * a FY2022 filing measured against the FY2025 taxonomy produces confident,
 * wrong findings. Everything here is derived from `period_of_report`.
 */
export function resolveAuthority(periodOfReport: string): AuthorityPin {
  const year = Number(periodOfReport.slice(0, 4));
  const safeYear = Number.isFinite(year) && year > 2000 ? year : new Date().getUTCFullYear();
  // The taxonomy in force for a period ending in year Y is the Y release; a
  // period ending in the first weeks of Y may still be filed on Y-1, so the
  // engine pins the period's own year and records what it resolved from.
  return {
    regsk_version: `Reg S-K as in force at ${periodOfReport}`,
    regsx_version: `Reg S-X as in force at ${periodOfReport}`,
    asc_asof: periodOfReport,
    taxonomy_year: safeYear,
    dqc_ruleset_version: `DQC ruleset for ${safeYear}`,
    efm_version: `EDGAR Filer Manual in force at ${periodOfReport}`,
    resolved_from: `filing.period_of_report=${periodOfReport}`,
  };
}
