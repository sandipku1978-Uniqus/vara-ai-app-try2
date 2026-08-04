/**
 * Pure validity checks shared by the release-candidate evaluators.
 *
 * Keep these separate from the network runners so a false-pass regression can
 * be reproduced with a tiny fixture. The release gate is only useful when an
 * absent target, an over-deep target, and an unrelated non-empty result are
 * failures rather than convenient substitutes for evidence.
 */
import { createHash } from 'node:crypto';

export interface ExpectedFilingTarget {
  accession: string;
  cik?: string | number;
  form?: string;
  dateFiled?: string;
}

export interface SearchHit {
  _id?: unknown;
  _source?: {
    adsh?: unknown;
    ciks?: unknown;
    cik?: unknown;
    form?: unknown;
    file_date?: unknown;
    display_names?: unknown;
    auditor?: unknown;
  };
}

export interface SearchPage {
  hits?: {
    hits?: unknown;
    total?: { value?: unknown; relation?: unknown };
  };
}

export interface FilingPageInspection {
  found: boolean;
  received: number;
  total: number | null;
  relation: 'eq' | 'gte' | null;
  identities: string[];
  invalidHits: number;
}

function digits(value: unknown): string {
  const normalized = String(value ?? '').replace(/\D/g, '');
  return normalized ? String(Number(normalized)) : '';
}

export function normalizeAccession(value: unknown): string {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function filingHitAccessionValue(hit: SearchHit): unknown {
  const adsh = hit?._source?.adsh;
  if (String(adsh ?? '').trim()) return adsh;
  return String(hit?._id ?? '').split(':', 1)[0];
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function exactSecAccession(value: unknown): string | null {
  if (typeof value !== 'string' || (!/^\d{18}$/.test(value) && !/^\d{10}-\d{2}-\d{6}$/.test(value))) {
    return null;
  }
  return value.replace(/-/g, '');
}

function exactSecCik(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : '';
  if (!/^\d{1,10}$/.test(raw)) return null;
  const normalized = raw.replace(/^0+/, '') || '0';
  return normalized === '0' ? null : normalized;
}

/** SEC accessions bind both the filing CIK and the filing year's final two
 * digits. Checking those fields separately permits a foreign filing to be
 * relabelled with the requested issuer/date while retaining a valid-looking
 * accession. */
function exactSecFilingIdentity(
  accessionValue: unknown,
  cikValue: unknown,
  dateValue: unknown,
): boolean {
  const accession = exactSecAccession(accessionValue);
  const cik = exactSecCik(cikValue);
  if (!accession || !cik || !isIsoDate(dateValue)) return false;
  return accession.startsWith(cik.padStart(10, '0'))
    && accession.slice(10, 12) === dateValue.slice(2, 4);
}

interface ExactFilingHitIdentity {
  accessionValue: unknown;
  accession: string;
  ciks: string[];
}

function exactFilingHitIdentity(hit: SearchHit): ExactFilingHitIdentity | null {
  const accessionValue = filingHitAccessionValue(hit);
  const accession = exactSecAccession(accessionValue);
  if (!accession) return null;
  const rawAdsh = hit?._source?.adsh;
  if (String(rawAdsh ?? '').trim() && exactSecAccession(rawAdsh) !== accession) return null;
  const rawId = String(hit?._id ?? '').trim();
  if (rawId) {
    const separator = rawId.indexOf(':');
    const idAccession = separator < 0 ? rawId : rawId.slice(0, separator);
    const idSuffix = separator < 0 ? '' : rawId.slice(separator + 1);
    if (exactSecAccession(idAccession) !== accession || (separator >= 0 && !idSuffix)) return null;
  }

  const rawCiks = hit?._source?.ciks;
  if (!Array.isArray(rawCiks) || rawCiks.length === 0) return null;
  const arrayValues = rawCiks;
  const scalarValue = hit?._source?.cik;
  const scalarPresent = String(scalarValue ?? '').trim() !== '';
  const identityValues = arrayValues;
  const ciks = identityValues.map(exactSecCik);
  if (
    ciks.length === 0 || ciks.some(cik => !cik)
    || new Set(ciks).size !== ciks.length
    || (scalarPresent && (
      exactSecCik(scalarValue) === null
      || (arrayValues.length > 0 && !ciks.includes(exactSecCik(scalarValue)))
    ))
    || !identityValues.some(cik => exactSecFilingIdentity(accessionValue, cik, hit?._source?.file_date))
  ) return null;
  return { accessionValue, accession, ciks: ciks as string[] };
}

export function hitMatchesExpectedFiling(hit: SearchHit, target: ExpectedFilingTarget): boolean {
  const accessionValue = filingHitAccessionValue(hit);
  const accession = normalizeAccession(accessionValue);
  if (accession !== normalizeAccession(target.accession)) return false;
  if (target.form && String(hit?._source?.form ?? '').replace(/\/A$/i, '').toUpperCase()
    !== target.form.replace(/\/A$/i, '').toUpperCase()) return false;
  if (target.dateFiled && hit?._source?.file_date !== target.dateFiled) return false;

  const exactIdentity = target.dateFiled ? exactFilingHitIdentity(hit) : null;
  if (target.dateFiled && !exactIdentity) return false;
  const rawCiks = hit?._source?.ciks;
  const cikValues = Array.isArray(rawCiks) ? rawCiks : [rawCiks, hit?._source?.cik];
  const ciks = exactIdentity?.ciks ?? cikValues.map(digits).filter(Boolean);
  if (target.cik == null) return true;
  if (!ciks.includes(digits(target.cik))) return false;
  return !target.dateFiled || exactSecFilingIdentity(target.accession, target.cik, target.dateFiled);
}

export interface FilingSearchPrecisionConstraints {
  cik?: string | number;
  form: string;
  dateFiled: string;
  entityName?: string;
  queryToken?: string;
  auditor?: string;
}

function normalizedSearchText(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Every row on a scored search page must satisfy the independently selected
 * filters. Recall of one target cannot conceal an ignored filter that mixed
 * unrelated rows into the same result page. */
export function validateFilingSearchPagePrecision(
  payload: unknown,
  constraints: FilingSearchPrecisionConstraints,
): string | null {
  const page = payload && typeof payload === 'object' ? payload as SearchPage : {};
  const hits = Array.isArray(page.hits?.hits) ? page.hits!.hits as SearchHit[] : null;
  if (!hits) return 'filing precision response has no hits array';
  const expectedForm = constraints.form.replace(/\/A$/i, '').trim().toUpperCase();
  const expectedCik = constraints.cik == null ? '' : digits(constraints.cik);
  const expectedEntity = normalizedSearchText(constraints.entityName);
  const expectedToken = normalizedSearchText(constraints.queryToken);
  for (const [index, hit] of hits.entries()) {
    const identity = exactFilingHitIdentity(hit);
    const accession = identity?.accession ?? '';
    const actualForm = String(hit?._source?.form ?? '').replace(/\/A$/i, '').trim().toUpperCase();
    if (!identity) {
      return `filing precision hit ${index + 1} violates accession/CIK/date identity`;
    }
    if (!/^\d{18}$/.test(accession) || actualForm !== expectedForm || hit?._source?.file_date !== constraints.dateFiled) {
      return `filing precision hit ${index + 1} violates accession/form/date scope`;
    }
    if (expectedCik && !identity.ciks.includes(expectedCik)) {
      return `filing precision hit ${index + 1} violates CIK ${expectedCik}`;
    }
    const rawNames = hit?._source?.display_names;
    const names = (Array.isArray(rawNames) ? rawNames : [rawNames]).map(normalizedSearchText).filter(Boolean);
    if (expectedEntity && !names.some(name => name.includes(expectedEntity) || expectedEntity.includes(name))) {
      return `filing precision hit ${index + 1} violates entity scope`;
    }
    if (expectedToken && !names.some(name => name.split(' ').includes(expectedToken))) {
      return `filing precision hit ${index + 1} lacks independent query-token evidence`;
    }
    if (constraints.auditor && hit?._source?.auditor !== constraints.auditor) {
      return `filing precision hit ${index + 1} violates auditor scope`;
    }
  }
  return null;
}

/** Inspect one deployed search page without treating an overflow as success. */
export function inspectFilingSearchPage(
  payload: unknown,
  target: ExpectedFilingTarget,
): FilingPageInspection {
  const page = payload && typeof payload === 'object' ? payload as SearchPage : {};
  const hits = Array.isArray(page.hits?.hits) ? page.hits!.hits as SearchHit[] : [];
  const rawTotal = page.hits?.total?.value;
  const parsedTotal = typeof rawTotal === 'number' ? rawTotal : Number(rawTotal);
  const rawRelation = page.hits?.total?.relation;
  const relation = rawRelation === 'eq' || rawRelation === 'gte' ? rawRelation : null;
  const identities = hits.map(hit => {
    const accession = normalizeAccession(hit?._source?.adsh || hit?._id);
    const rawCiks = hit?._source?.ciks;
    const ciks = (Array.isArray(rawCiks) ? rawCiks : [rawCiks, hit?._source?.cik])
      .map(digits)
      .filter(Boolean)
      .sort();
    return /^\d{18}$/.test(accession) && ciks.length > 0
      ? `${accession}\u0000${ciks.join(',')}`
      : '';
  });
  return {
    found: hits.some(hit => hitMatchesExpectedFiling(hit, target)),
    received: hits.length,
    total: Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : null,
    relation,
    identities,
    invalidHits: identities.filter(identity => !identity).length,
  };
}

/**
 * A negative-control absence is valid only after observing the complete page
 * implied by an exact total. A short or duplicate page can otherwise turn a
 * broken search response into a false proof that the forbidden filing is not
 * present.
 */
export function completeFilingSearchPageProblem(
  inspection: FilingPageInspection,
  from: number,
  size: number,
): string | null {
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(size) || size <= 0) {
    return `invalid page bounds from=${String(from)} size=${String(size)}`;
  }
  if (inspection.total === null || !Number.isSafeInteger(inspection.total) || inspection.relation !== 'eq') {
    return 'search page does not expose an exact finite total';
  }
  if (inspection.invalidHits > 0 || inspection.identities.length !== inspection.received) {
    return `search page contains ${inspection.invalidHits} malformed filing identity row(s)`;
  }
  if (new Set(inspection.identities).size !== inspection.identities.length) {
    return 'search page contains duplicate filing identities';
  }
  const expected = Math.max(0, Math.min(size, inspection.total - from));
  if (inspection.received !== expected) {
    return `search page returned ${inspection.received}/${expected} rows required by exact total ${inspection.total}`;
  }
  return null;
}

function visibleText(value: unknown): string {
  // PostgreSQL ts_headline adds only <b> tags today. Strip any markup rather
  // than letting a tag name satisfy a query token if that contract changes.
  return String(value ?? '').replace(/<[^>]*>/g, ' ');
}

export interface TopicSearchTruth {
  /** Exact direct-table count before the product's documented 10,000 floor. */
  total: number;
  /** Direct-table FTS pool independently selected without the product RPC. */
  matches: Array<{ accession: string; cik: string | number; form?: string; date_filed?: string }>;
  pageSize: number;
  poolDepth: number;
  countSource: 'urc_comment_letters.direct-fts-count';
  rankSource: 'candidate-rank-order-with-independent-fts-pool';
  predicateSource: 'urc_comment_letters.direct-fts-identity';
  predicateEvidenceSha256: string;
}

/**
 * Prove that a non-empty comment-letter response is related to the requested
 * topic. A random headline is not accuracy evidence.
 */
export function validateTopicSearchResult(
  topic: string,
  payload: unknown,
  expectedForm?: string,
  independentTruth?: TopicSearchTruth,
): string | null {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const matches = Array.isArray(data.matches) ? data.matches as Array<Record<string, unknown>> : null;
  if (!matches) return 'no matches array';
  const total = Number(data.total);
  if (matches.length === 0 || total === 0) return `zero matches for topic "${topic}"`;
  if (!Number.isInteger(total) || total < matches.length) {
    return `invalid topic result denominator ${String(data.total)} for ${matches.length} returned matches`;
  }

  if (
    !independentTruth
    || !Number.isInteger(independentTruth.total)
    || independentTruth.total <= 0
  ) return `no independent direct-FTS truth for topic "${topic}"`;

  const totalIsFloor = data.totalIsFloor === true;
  const expectedReportedTotal = independentTruth.total > 10_000 ? 10_000 : independentTruth.total;
  const expectedFloor = independentTruth.total > 10_000;
  if (total !== expectedReportedTotal || totalIsFloor !== expectedFloor) {
    return `topic count ${total}${totalIsFloor ? '+' : ''} != independent ${independentTruth.total}`;
  }

  const normalizedExpectedForm = expectedForm?.trim().toUpperCase() || '';
  if (
    normalizedExpectedForm
    && matches.some(match => String(match.form ?? '').trim().toUpperCase() !== normalizedExpectedForm)
  ) {
    return `topic response ignored requested form ${normalizedExpectedForm}`;
  }

  if (!Number.isInteger(independentTruth.pageSize) || independentTruth.pageSize <= 0) {
    return 'independent topic truth has an invalid page size';
  }
  const predicateDigest = createHash('sha256')
    .update(JSON.stringify(independentTruth.matches))
    .digest('hex');
  if (
    independentTruth.countSource !== 'urc_comment_letters.direct-fts-count'
    || independentTruth.rankSource !== 'candidate-rank-order-with-independent-fts-pool'
    || independentTruth.predicateSource !== 'urc_comment_letters.direct-fts-identity'
    || independentTruth.predicateEvidenceSha256 !== predicateDigest
  ) return 'topic truth did not bind independent count and per-identity FTS predicate evidence';
  const expectedReturned = Math.min(independentTruth.pageSize, independentTruth.total);
  const expectedPoolDepth = Math.min(1_000, independentTruth.total);
  if (
    matches.length !== expectedReturned
    || independentTruth.poolDepth !== expectedPoolDepth
    || independentTruth.matches.length !== expectedPoolDepth
  ) {
    return `topic page returned ${matches.length}/${expectedReturned}; independent FTS pool has ${independentTruth.matches.length}/${expectedPoolDepth}`;
  }
  const truthIdentities = independentTruth.matches.map(match => [
    normalizeAccession(match.accession),
    digits(match.cik),
    String(match.form ?? '').trim().toUpperCase(),
  ].join('\u0000'));
  const validTopicIdentity = (match: { accession?: unknown; cik?: unknown; form?: unknown; date_filed?: unknown }) => (
    exactSecFilingIdentity(match.accession, match.cik, match.date_filed)
    && ['UPLOAD', 'CORRESP'].includes(String(match.form ?? '').trim().toUpperCase())
  );
  if (
    independentTruth.matches.some(match => !validTopicIdentity(match))
    || new Set(truthIdentities).size !== truthIdentities.length
  ) {
    return 'independent topic FTS pool contains malformed or duplicate identities';
  }
  const truthIdentitySet = new Set(truthIdentities);
  const truthDates = new Map(truthIdentities.map((identity, index) => [
    identity, independentTruth.matches[index].date_filed,
  ]));
  const actualIdentities = new Set<string>();
  let previousRank = Number.POSITIVE_INFINITY;
  let previousDate = '';
  let previousIdentity = '';
  for (const [index, match] of matches.entries()) {
    const text = visibleText(match.headline ?? match.excerpt);
    if (!text.trim()) return `topic match ${index + 1}/${matches.length} has no evidence excerpt`;
    const identity = [
      normalizeAccession(match.accession),
      digits(match.cik),
      String(match.form ?? '').trim().toUpperCase(),
    ].join('\u0000');
    if (!validTopicIdentity(match)) return `topic match ${index + 1}/${matches.length} has a malformed identity`;
    if (actualIdentities.has(identity)) return `topic match ${index + 1}/${matches.length} duplicates an earlier identity`;
    actualIdentities.add(identity);
    if (!truthIdentitySet.has(identity)) {
      return `topic match ${index + 1}/${matches.length} is absent from the independent direct-FTS pool`;
    }
    const rank = Number(match.rank);
    const date = String(match.date_filed ?? '');
    if (!Number.isFinite(rank) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return `topic match ${index + 1}/${matches.length} lacks bounded rank/date evidence`;
    }
    if (date !== truthDates.get(identity)) {
      return `topic match ${index + 1}/${matches.length} date differs from independent direct-FTS truth`;
    }
    if (
      rank > previousRank
      || (rank === previousRank && previousDate && date > previousDate)
      || (rank === previousRank && date === previousDate && previousIdentity && identity < previousIdentity)
    ) {
      return `topic match ${index + 1}/${matches.length} violates rank/date/identity ordering`;
    }
    previousRank = rank;
    previousDate = date;
    previousIdentity = identity;
  }
  return null;
}

function routeFacetNeedle(value: string): string {
  let normalized = value.trim().replace(/\s+/g, ' ');
  const suffix = /[,.]?\s(?:incorporated|inc|corp|corporation|company|co|ltd|llc|llp|lp|plc|nv|sa|se|ag)\.?$/i;
  for (let index = 0; index < 2; index += 1) {
    const stripped = normalized.replace(suffix, '');
    if (stripped === normalized || stripped.length < 4) break;
    normalized = stripped;
  }
  return normalized.toLowerCase();
}

/** Select a wrong-entity negative whose route-normalized legal name cannot
 * legitimately match the target. Distinct CIK alone is insufficient because
 * the SEC directory contains duplicate and nested legal names. */
export function isDisjointEntityNameControl(targetName: string, controlName: string): boolean {
  const target = routeFacetNeedle(targetName);
  const control = routeFacetNeedle(controlName);
  if (target.length < 4 || control.length < 4 || target.includes(control) || control.includes(target)) {
    return false;
  }
  const meaningfulTokens = (value: string) => new Set(
    (value.match(/[a-z0-9]+/g) || []).filter(token => token.length >= 4),
  );
  const targetTokens = meaningfulTokens(target);
  const controlTokens = meaningfulTokens(control);
  return [...targetTokens].every(token => !controlTokens.has(token));
}

export interface ExpectedThreadLetter {
  accession: string;
  cik: string | number;
  form: string;
  date_filed: string;
  filename: string;
  review_key?: string | null;
}

function validExpectedThreadIdentity(
  threadId: string,
  letters: ExpectedThreadLetter[],
): boolean {
  const ciks = letters.map(letter => {
    const raw = typeof letter.cik === 'number' && Number.isSafeInteger(letter.cik)
      ? String(letter.cik) : typeof letter.cik === 'string' ? letter.cik : '';
    return /^\d{1,10}$/.test(raw) ? raw.replace(/^0+/, '') : '';
  });
  if (ciks.some(cik => !cik || cik === '0') || new Set(ciks).size !== 1) return false;
  const prefix = `${ciks[0]}:`;
  if (!threadId.startsWith(prefix)) return false;
  const suffix = threadId.slice(prefix.length);
  if (!suffix || suffix.length > 500 || /[\u0000-\u001F\u007F]/.test(suffix)) return false;
  const dates = letters.map(letter => letter.date_filed);
  if (!dates.every(isIsoDate)) return false;
  const reviewKeys = letters.map(letter => (
    typeof letter.review_key === 'string' ? letter.review_key : null
  ));
  const definedReviewKeys = reviewKeys.filter((reviewKey): reviewKey is string => reviewKey !== null);
  if (definedReviewKeys.length > 0) {
    return definedReviewKeys.length === letters.length
      && new Set(definedReviewKeys).size === 1
      && suffix === definedReviewKeys[0];
  }
  const minimumDate = [...dates].sort()[0];
  const bareDateSuffix = /^\d{4}-\d{2}-\d{2}$/.test(suffix) && isIsoDate(suffix);
  if (bareDateSuffix) return suffix === minimumDate;
  if (suffix.startsWith('date:')) return suffix === `date:${minimumDate}`;
  return false;
}

/** A thread-detail response must reproduce the independently read corpus rows
 * in their exact reading order. Equal-sized letters from another conversation
 * are not valid evidence. */
export function validateThreadDetails(
  expectedThreadId: string,
  expectedLetters: ExpectedThreadLetter[],
  payload: unknown,
): string | null {
  if (!expectedThreadId || expectedLetters.length === 0) return 'invalid independent thread evidence';
  if (!validExpectedThreadIdentity(expectedThreadId, expectedLetters)) {
    return 'invalid independent thread identity';
  }
  const validLetter = (letter: {
    accession?: unknown; cik?: unknown; form?: unknown; date_filed?: unknown; filename?: unknown;
  }) => (
    exactSecFilingIdentity(letter.accession, letter.cik, letter.date_filed)
    && ['UPLOAD', 'CORRESP'].includes(String(letter.form ?? '').trim().toUpperCase())
    && Boolean(String(letter.filename ?? '').trim())
  );
  if (expectedLetters.some(letter => !validLetter(letter))) return 'invalid independent thread letter identity';
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (data.thread !== expectedThreadId) {
    return `thread ${String(data.thread ?? 'missing')} != expected ${expectedThreadId}`;
  }
  if (!Array.isArray(data.letters)) return 'no letters array';
  const letters = data.letters;
  if (letters.length !== expectedLetters.length) {
    return `letters ${letters.length} != expected ${expectedLetters.length}`;
  }
  const actualIdentities = letters.map((value, index) => {
    const actual = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (!validLetter(actual)) return `__IDENTITY_ERROR__:${index + 1}`;
    if (index > 0) {
      const previous = letters[index - 1] && typeof letters[index - 1] === 'object'
        ? letters[index - 1] as Record<string, unknown>
        : {};
      const previousDate = String(previous.date_filed ?? '');
      const actualDate = String(actual.date_filed ?? '');
      const previousForm = String(previous.form ?? '');
      const actualForm = String(actual.form ?? '');
      if (actualDate < previousDate || (actualDate === previousDate && actualForm > previousForm)) {
        return `__ORDER_ERROR__:${index + 1}`;
      }
    }
    return [
      normalizeAccession(actual.accession),
      digits(actual.cik),
      String(actual.form ?? ''),
      String(actual.date_filed ?? ''),
      String(actual.filename ?? ''),
    ].join('\u0000');
  });
  const orderError = actualIdentities.find(identity => identity.startsWith('__ORDER_ERROR__:'));
  if (orderError) return `thread letters violate date/form reading order at row ${orderError.split(':')[1]}`;
  const identityError = actualIdentities.find(identity => identity.startsWith('__IDENTITY_ERROR__:'));
  if (identityError) return `thread letter ${identityError.split(':')[1]} has a malformed identity`;
  const expectedIdentities = expectedLetters.map(expected => [
      normalizeAccession(expected.accession),
      digits(expected.cik),
      expected.form,
      expected.date_filed,
      expected.filename,
    ].join('\u0000'));
  actualIdentities.sort();
  expectedIdentities.sort();
  if (actualIdentities.some((identity, index) => identity !== expectedIdentities[index])) {
    return 'letter identity set does not match independent thread evidence';
  }
  return null;
}

/** Return independently expected accessions omitted by a bounded product
 * result. Normalization prevents punctuation-only accession differences from
 * disguising a retrieval loss, while preserving the expected value in the
 * failure evidence. */
export function missingBoundedAccessions(
  expectedAccessions: string[],
  actualAccessions: Iterable<string>,
): string[] {
  const actual = new Set([...actualAccessions].map(normalizeAccession).filter(Boolean));
  const seen = new Set<string>();
  return expectedAccessions.filter(accession => {
    const normalized = normalizeAccession(accession);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return !actual.has(normalized);
  });
}

function normalizedFilingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizedFilingTextSha256(value: string): string {
  return createHash('sha256').update(normalizedFilingText(value)).digest('hex');
}

/** A long response is not proof that the cache returned the requested filing.
 * Bind deployed text to a separately fetched immutable SEC document before
 * using it as the canary matcher's oracle. */
export function validateIndependentFilingText(
  officialText: string,
  deployedText: string,
  minimumChars = 5_000,
): string | null {
  if (normalizedFilingText(officialText).length < minimumChars) return 'independent official filing text is too short';
  if (normalizedFilingText(deployedText).length < minimumChars) return 'deployed filing text is too short';
  if (normalizedFilingTextSha256(officialText) !== normalizedFilingTextSha256(deployedText)) {
    return 'deployed filing text digest does not match the independently fetched SEC target';
  }
  return null;
}

export interface ExpectedCompanyTickers {
  cik: string | number;
  tickers: string[];
}

export interface RawFormApEvidence {
  audit_report_date: string;
  audit_report_type: string | null;
  firm_canonical: string | null;
}

export interface RawAuditorTruth {
  auditor: string | null;
  resolutionStatus:
    | 'resolved'
    | 'no_prior_form_ap_report'
    | 'coverage_pending'
    | 'unsupported_entity_scope'
    | 'ambiguous';
}

/** Reproduce migration 022's evidence-time rule from raw, non-superseded Form
 * AP rows. Callers remain responsible for selecting `is_latest=true` rows. */
export function deriveRawAuditorTruth(
  filingDate: string,
  rows: RawFormApEvidence[],
): RawAuditorTruth {
  const eligible = rows.filter(row => row.audit_report_date <= filingDate);
  const latestReportDate = eligible.reduce(
    (latest, row) => row.audit_report_date > latest ? row.audit_report_date : latest,
    '',
  );
  const latestRows = eligible.filter(row => row.audit_report_date === latestReportDate);
  if (latestRows.length === 0) return { auditor: null, resolutionStatus: 'no_prior_form_ap_report' };

  const reportTypes = new Set(
    latestRows.map(row => String(row.audit_report_type ?? '').trim().toLowerCase()),
  );
  if ([...reportTypes].some(value => !value)) {
    return { auditor: null, resolutionStatus: 'coverage_pending' };
  }
  const ordinaryIssuerType = 'issuer, other than employee benefit plan or investment company';
  if (reportTypes.size !== 1 || !reportTypes.has(ordinaryIssuerType)) {
    return { auditor: null, resolutionStatus: 'unsupported_entity_scope' };
  }
  const firms = [...new Set(
    latestRows.map(row => String(row.firm_canonical ?? '').trim()).filter(Boolean),
  )];
  if (firms.length !== 1) return { auditor: null, resolutionStatus: 'ambiguous' };
  return { auditor: firms[0], resolutionStatus: 'resolved' };
}

/** Validate enrichment against SEC's independent company-ticker directory. */
export function validateCompanyEnrichment(
  expectedCompanies: ExpectedCompanyTickers[],
  payload: unknown,
): string | null {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const companies = data.companies && typeof data.companies === 'object'
    ? data.companies as Record<string, unknown>
    : null;
  if (!companies) return 'no companies object';
  for (const expected of expectedCompanies) {
    const cik = digits(expected.cik);
    const entry = companies[cik] && typeof companies[cik] === 'object'
      ? companies[cik] as Record<string, unknown>
      : null;
    if (!entry) return `cik ${cik} missing`;
    if (!Array.isArray(entry.tickers)) return `cik ${cik} has no ticker array`;
    const actualTickers = [...new Set(entry.tickers.map(value => String(value).trim().toUpperCase()))]
      .filter(Boolean)
      .sort();
    const expectedTickers = [...new Set(expected.tickers.map(value => value.trim().toUpperCase()))]
      .filter(Boolean)
      .sort();
    if (
      actualTickers.length !== expectedTickers.length
      || actualTickers.some((ticker, index) => ticker !== expectedTickers[index])
    ) {
      return `cik ${cik} ticker set ${JSON.stringify(actualTickers)} != official ${JSON.stringify(expectedTickers)}`;
    }
  }
  return null;
}

export type AccuracyClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface E2eQuotaPlan {
  total: number;
  classes: Record<AccuracyClass, number>;
  criticalPaths: { auditor: number; topic: number };
}

export function buildE2eQuotaPlan(total: number): E2eQuotaPlan {
  if (!Number.isInteger(total) || total < 100) {
    throw new Error('Accuracy points must be an integer of at least 100.');
  }
  const A = Math.round(total * 0.45);
  const B = Math.round(total * 0.15);
  const C = Math.round(total * 0.15);
  const D = Math.round(total * 0.15);
  const F = Math.round(total * 0.08);
  const E = total - A - B - C - D - F;
  const topic = Math.round(total * 0.05);
  return {
    total,
    classes: { A, B, C, D, E, F },
    criticalPaths: { auditor: B, topic },
  };
}

/** Exact quotas keep every missing sample in the denominator. */
export function quotaShortfalls(
  plan: E2eQuotaPlan,
  actual: Partial<Record<AccuracyClass, number>>,
  criticalActual: Partial<Record<'auditor' | 'topic', number>> = {},
): string[] {
  const problems: string[] = [];
  for (const cls of Object.keys(plan.classes) as AccuracyClass[]) {
    const got = Number(actual[cls] ?? 0);
    const expected = plan.classes[cls];
    if (!Number.isInteger(got) || got !== expected) {
      problems.push(`class ${cls} generated ${got}/${expected} required points`);
    }
  }
  for (const path of ['auditor', 'topic'] as const) {
    const got = Number(criticalActual[path] ?? 0);
    const expected = plan.criticalPaths[path];
    if (!Number.isInteger(got) || got !== expected) {
      problems.push(`${path} path generated ${got}/${expected} required points`);
    }
  }
  return problems;
}
