/**
 * Provenance and attribution rules for board data extracted from a DEF 14A.
 *
 * Pure: no fetches, no React. Everything a Board Profiles value is labelled
 * with — which filing it came from, which annual meeting and fiscal year that
 * filing relates to, whether a headcount was disclosed or merely derived, and
 * why a lookup produced nothing — is decided here so it can be unit-tested.
 *
 * The September 2026 audit found three silent approximations on the page: a
 * say-on-pay figure labelled "latest annual meeting" although a proxy is filed
 * BEFORE the meeting it solicits votes for; gender headcounts computed by
 * rounding a percentage of the board size; and every failure collapsed into
 * "not found in EDGAR". The house rule is that a displayed number traces to a
 * filing or is visibly labelled derived, and that a failed lookup is never
 * presented as factual absence.
 */

export const PROXY_FORM = 'DEF 14A';

/** Below this, an extracted document is a stub or an error page, not a proxy. */
export const MIN_PROXY_TEXT_LENGTH = 500;

export interface ProxyFilingRef {
  form: string;
  /** YYYY-MM-DD, as EDGAR's submissions feed reports it. */
  filingDate: string;
  /**
   * EDGAR's "period of report". For a DEF 14A the filer supplies the meeting
   * date here; many leave it blank, which arrives as ''.
   */
  reportDate: string;
  accessionNumber: string;
  primaryDocument: string;
}

export interface ProxyProvenance extends ProxyFilingRef {
  /** Unpadded numeric CIK, the form EDGAR Archives paths use. */
  cik: string;
  /** The primary document on SEC.gov. */
  documentUrl: string;
  /** The filing index listing every document in the submission. */
  indexUrl: string;
}

export interface FilingSeriesLike {
  form: readonly string[];
  filingDate: readonly string[];
  reportDate?: readonly string[];
  accessionNumber: readonly string[];
  primaryDocument: readonly string[];
}

/**
 * The most recently FILED proxy of the requested form. EDGAR's recent series is
 * normally newest-first, but the filing date is the evidence, so it decides.
 */
export function findLatestProxyFiling(recent: FilingSeriesLike, form = PROXY_FORM): ProxyFilingRef | null {
  let latest: ProxyFilingRef | null = null;
  for (let index = 0; index < recent.form.length; index += 1) {
    if (recent.form[index] !== form) continue;
    const candidate: ProxyFilingRef = {
      form,
      filingDate: recent.filingDate[index] ?? '',
      reportDate: recent.reportDate?.[index] ?? '',
      accessionNumber: recent.accessionNumber[index] ?? '',
      primaryDocument: recent.primaryDocument[index] ?? '',
    };
    if (!candidate.accessionNumber) continue;
    if (!latest || candidate.filingDate > latest.filingDate) latest = candidate;
  }
  return latest;
}

export interface RecentFilingWindow {
  count: number;
  from: string | null;
  to: string | null;
}

/** What "no DEF 14A on record" was actually checked against. */
export function describeRecentFilingWindow(recent: Pick<FilingSeriesLike, 'filingDate'>): RecentFilingWindow {
  const dates = recent.filingDate.filter(date => typeof date === 'string' && date.length > 0).sort();
  return {
    count: recent.filingDate.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Meeting / fiscal-year attribution
// ---------------------------------------------------------------------------

export type MeetingYearBasis = 'report-date' | 'filing-date';
export type FiscalYearBasis = 'fiscal-year-end' | 'assumed-calendar-year-end';

export interface ProxyAttribution {
  /** The annual meeting the proxy solicits votes for. */
  meetingYear: number;
  /** The meeting date when EDGAR carries one that follows the filing date. */
  meetingDate: string | null;
  meetingYearBasis: MeetingYearBasis;
  /**
   * The last fiscal year completed before the proxy was filed — the year its
   * compensation tables cover. Named by the calendar year in which it ends.
   */
  fiscalYear: number;
  fiscalYearEndDate: string;
  fiscalYearBasis: FiscalYearBasis;
  /**
   * A proxy is filed before its meeting, so the say-on-pay result it reports
   * came from an earlier meeting — this year at the latest.
   */
  latestPriorMeetingYear: number;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
  time: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string | null | undefined): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const probe = new Date(time);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, time };
}

/** SEC submissions carry fiscalYearEnd as MMDD ("0930"). Anything else is unknown. */
export function parseFiscalYearEnd(value: unknown): { month: number; day: number } | null {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) return null;
  const month = Number(value.slice(0, 2));
  const day = Number(value.slice(2));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** A 29 February year-end in a non-leap year is 28 February, never 1 March. */
function utcDateClamped(year: number, month: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Date.UTC(year, month - 1, Math.min(day, lastDay));
}

function isoFromUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Which meeting and which fiscal year a proxy relates to, from the filing's
 * own dates. A DEF 14A filed in spring 2026 by a calendar-year filer covers the
 * 2026 annual meeting and fiscal-2025 compensation.
 *
 * - Meeting year: EDGAR's period of report when it is on or after the filing
 *   date (a definitive proxy precedes its meeting, so an earlier period cannot
 *   be the meeting and is ignored); otherwise the filing year, flagged as such.
 * - Fiscal year: the last fiscal year-end on or before the filing date, using
 *   the issuer's MMDD year-end; a calendar year-end is assumed — and flagged —
 *   only when EDGAR lists none.
 *
 * Returns null only when the filing date itself is unreadable.
 */
export function attributeProxyFiling(
  filing: { filingDate: string; reportDate?: string | null },
  fiscalYearEnd?: string | null,
): ProxyAttribution | null {
  const filed = parseIsoDate(filing.filingDate);
  if (!filed) return null;

  const reported = parseIsoDate(filing.reportDate);
  const meeting = reported && reported.time >= filed.time ? reported : null;
  const meetingYear = meeting ? meeting.year : filed.year;

  const parsedYearEnd = parseFiscalYearEnd(fiscalYearEnd);
  const yearEnd = parsedYearEnd ?? { month: 12, day: 31 };
  const yearEndInFilingYear = utcDateClamped(filed.year, yearEnd.month, yearEnd.day);
  const fiscalYear = yearEndInFilingYear <= filed.time ? filed.year : filed.year - 1;

  return {
    meetingYear,
    meetingDate: meeting ? isoFromUtc(meeting.time) : null,
    meetingYearBasis: meeting ? 'report-date' : 'filing-date',
    fiscalYear,
    fiscalYearEndDate: isoFromUtc(utcDateClamped(fiscalYear, yearEnd.month, yearEnd.day)),
    fiscalYearBasis: parsedYearEnd ? 'fiscal-year-end' : 'assumed-calendar-year-end',
    latestPriorMeetingYear: meetingYear - 1,
  };
}

export interface ProxyAttributionLabels {
  meetingLabel: string;
  fiscalLabel: string;
  /** Full explanation of what a proxy's say-on-pay figure is and is not. */
  sayOnPayLabel: string;
  /** One-line form of the same statement for cards and tables. */
  sayOnPayShort: string;
}

export function describeProxyAttribution(
  attribution: ProxyAttribution,
  filing: { form: string; filingDate: string },
): ProxyAttributionLabels {
  const meetingLabel = attribution.meetingYearBasis === 'report-date'
    ? `${attribution.meetingYear} annual meeting (meeting date ${attribution.meetingDate}, EDGAR period of report)`
    : `${attribution.meetingYear} annual meeting (year derived from the ${filing.filingDate} filing date; EDGAR lists no meeting date)`;
  const fiscalLabel = attribution.fiscalYearBasis === 'fiscal-year-end'
    ? `fiscal ${attribution.fiscalYear} (fiscal year ended ${attribution.fiscalYearEndDate})`
    : `fiscal ${attribution.fiscalYear} (calendar year-end assumed; EDGAR lists no fiscal year-end)`;
  const sayOnPayLabel = `Reported in the ${filing.form} for the ${attribution.meetingYear} annual meeting (filed ${filing.filingDate}). `
    + 'A proxy is filed before its meeting, so this is the result of an earlier vote the proxy discusses — '
    + `an annual meeting no later than ${attribution.latestPriorMeetingYear} — not the ${attribution.meetingYear} meeting's vote, `
    + 'which the company reports afterwards on Form 8-K (Item 5.07).';
  const sayOnPayShort = `Earlier vote (meeting no later than ${attribution.latestPriorMeetingYear}) as reported in the `
    + `${attribution.meetingYear}-meeting proxy filed ${filing.filingDate}; not the ${attribution.meetingYear} meeting result.`;
  return { meetingLabel, fiscalLabel, sayOnPayLabel, sayOnPayShort };
}

// ---------------------------------------------------------------------------
// Headcounts: disclosed, derived, or not derivable
// ---------------------------------------------------------------------------

export type Headcount =
  | { kind: 'disclosed'; count: number; boardSize: number | null }
  | { kind: 'derived'; count: number; percent: number; boardSize: number }
  | {
      kind: 'unavailable';
      reason: 'no-board-size' | 'no-percent' | 'ambiguous';
      percent: number | null;
      boardSize: number | null;
    };

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/**
 * A headcount is shown as fact only when the proxy stated it. Otherwise a
 * derivation from the disclosed percentage is offered — labelled derived —
 * and only when exactly one whole number rounds to that percentage: 50% of
 * eight directors is four; 50% of seven is nobody's headcount.
 */
export function resolveHeadcount(
  disclosedCount: number | null | undefined,
  percent: number | null | undefined,
  boardSize: number | null | undefined,
): Headcount {
  const count = asCount(disclosedCount);
  const size = asCount(boardSize);
  const share = asPercent(percent);
  if (count != null) return { kind: 'disclosed', count, boardSize: size };
  if (size == null || size < 1) return { kind: 'unavailable', reason: 'no-board-size', percent: share, boardSize: size };
  if (share == null) return { kind: 'unavailable', reason: 'no-percent', percent: null, boardSize: size };

  const estimate = size * share / 100;
  const nearest = Math.round(estimate);
  // A disclosed percentage is rounded to at most half a point, so a whole
  // number further than that from the estimate cannot be what was rounded.
  const tolerance = size * 0.005 + 1e-9;
  if (Math.abs(estimate - nearest) <= tolerance) {
    return { kind: 'derived', count: nearest, percent: share, boardSize: size };
  }
  return { kind: 'unavailable', reason: 'ambiguous', percent: share, boardSize: size };
}

function formatShare(percent: number | null): string {
  return percent == null ? '—' : `${percent}%`;
}

export function describeHeadcount(headcount: Headcount, noun = 'directors'): string {
  switch (headcount.kind) {
    case 'disclosed':
      return headcount.boardSize != null
        ? `${headcount.count} of ${headcount.boardSize} ${noun} — count disclosed in the proxy`
        : `${headcount.count} ${noun} — count disclosed in the proxy`;
    case 'derived':
      return `≈ ${headcount.count} of ${headcount.boardSize} — derived from a rounded ${formatShare(headcount.percent)} of `
        + `${headcount.boardSize} ${noun}, not a disclosed count`;
    case 'unavailable':
      if (headcount.reason === 'no-percent') return 'Share not stated in this proxy';
      if (headcount.reason === 'no-board-size') return 'Headcount not derivable: board size not stated';
      return `Headcount not derivable: ${formatShare(headcount.percent)} of ${headcount.boardSize} ${noun} is not a whole number`;
  }
}

// ---------------------------------------------------------------------------
// Failure modes — each one names what actually happened
// ---------------------------------------------------------------------------

export type ProxyTransportFailure = 'rate-limit' | 'timeout' | 'upstream';
export type ProxyReadFailure = 'not-found' | 'unsupported' | 'cancelled' | 'too-short';

export type BoardLoadFailure =
  /** The ticker resolves to nothing in a directory that DID load. */
  | { kind: 'ticker-unknown'; ticker: string }
  /** SEC or the network failed; nothing is known either way. */
  | { kind: 'lookup-failed'; stage: 'directory'; ticker: string }
  | { kind: 'lookup-failed'; stage: 'submissions'; ticker: string; cik: string }
  | {
      kind: 'lookup-failed';
      stage: 'proxy-text';
      ticker: string;
      cik: string;
      filing: ProxyFilingRef;
      transport: ProxyTransportFailure;
      status?: number;
    }
  /** Submissions loaded and contain no proxy in the recent window. */
  | { kind: 'no-proxy'; ticker: string; cik: string; companyName: string; window: RecentFilingWindow }
  /** The proxy is on record but its document could not be read. */
  | { kind: 'proxy-unreadable'; ticker: string; cik: string; filing: ProxyFilingRef; reason: ProxyReadFailure; status?: number }
  /** The document was read; the model produced nothing usable from it. */
  | { kind: 'extraction-failed'; ticker: string; cik: string; filing: ProxyFilingRef };

export interface BoardFailureDescription {
  /**
   * 'absence' is a truthful empty state (rendered as a status); 'error' is an
   * operation that did not complete (rendered as an alert).
   */
  severity: 'absence' | 'error';
  /** Short form for table cells. */
  title: string;
  message: string;
  /** Whether repeating the same request could reasonably change the outcome. */
  retryable: boolean;
}

function filingPhrase(filing: ProxyFilingRef): string {
  return `${filing.form} filed ${filing.filingDate} (accession ${filing.accessionNumber})`;
}

/** Lookups return ten-digit CIKs; people and EDGAR URLs use the bare number. */
function displayCik(cik: string): string {
  return /^\d+$/.test(cik) ? String(Number(cik)) : cik;
}

function transportPhrase(transport: ProxyTransportFailure, status?: number): string {
  const suffix = status ? ` (HTTP ${status})` : '';
  if (transport === 'rate-limit') return `SEC rate-limited the request${suffix}`;
  if (transport === 'timeout') return `the request timed out${suffix}`;
  return `SEC returned an upstream error${suffix}`;
}

function readFailurePhrase(reason: ProxyReadFailure, status?: number): string {
  if (reason === 'not-found') return `SEC returned ${status ?? 404} for the document`;
  if (reason === 'unsupported') return 'the document format is not supported for text extraction';
  if (reason === 'cancelled') return 'the request was cancelled before the document arrived';
  return `the extracted text is shorter than ${MIN_PROXY_TEXT_LENGTH} characters`;
}

export function describeBoardFailure(failure: BoardLoadFailure): BoardFailureDescription {
  switch (failure.kind) {
    case 'ticker-unknown':
      return {
        severity: 'absence',
        title: 'Ticker not in SEC directory',
        message: `No issuer with ticker "${failure.ticker}" in the SEC company directory. `
          + 'Try a listed ticker such as AAPL, MSFT, or GOOGL.',
        retryable: false,
      };
    case 'lookup-failed':
      if (failure.stage === 'directory') {
        return {
          severity: 'error',
          title: 'SEC lookup failed',
          message: `The SEC company directory could not be loaded, so "${failure.ticker}" could not be resolved to a CIK. `
            + 'This is a lookup failure (SEC or network), not evidence that the ticker is unknown.',
          retryable: true,
        };
      }
      if (failure.stage === 'submissions') {
        return {
          severity: 'error',
          title: 'SEC lookup failed',
          message: `SEC EDGAR submissions could not be loaded for CIK ${displayCik(failure.cik)} (${failure.ticker}). `
            + 'This is a lookup failure (SEC or network), not evidence that the issuer has no proxy statement on record.',
          retryable: true,
        };
      }
      return {
        severity: 'error',
        title: 'SEC lookup failed',
        message: `${filingPhrase(failure.filing)} is on record, but SEC EDGAR did not return its document `
          + `${failure.filing.primaryDocument}: ${transportPhrase(failure.transport, failure.status)}. `
          + 'This is a lookup failure (SEC or network), not evidence about the filing\'s contents.',
        retryable: true,
      };
    case 'no-proxy': {
      const { window } = failure;
      const checked = window.count === 0
        ? 'the recent-filings window is empty'
        : `${window.count} filings from ${window.from} to ${window.to} were checked`;
      return {
        severity: 'absence',
        title: 'No DEF 14A on record',
        message: `No ${PROXY_FORM} proxy statement on record for CIK ${displayCik(failure.cik)} (${failure.companyName}) in EDGAR's `
          + `recent-filings window — ${checked}. Nothing was extracted.`,
        retryable: false,
      };
    }
    case 'proxy-unreadable':
      return {
        severity: 'error',
        title: 'Proxy document unreadable',
        message: `${filingPhrase(failure.filing)} is on record, but its document ${failure.filing.primaryDocument} could not be read: `
          + `${readFailurePhrase(failure.reason, failure.status)}. Nothing was extracted.`,
        retryable: false,
      };
    case 'extraction-failed':
      return {
        severity: 'error',
        title: 'Extraction failed',
        message: `${filingPhrase(failure.filing)} was read, but AI extraction returned no usable data. `
          + 'This is an extraction failure, not evidence that the proxy lacks these disclosures.',
        retryable: true,
      };
  }
}
