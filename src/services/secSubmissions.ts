/**
 * Leaf client for SEC company-submissions data.
 *
 * Keep this module dependency-free within `src`: both the public SEC service
 * facade and filing-entity correction depend on it. Importing either of those
 * higher-level modules here would recreate the secApi <-> filingEntity cycle.
 */

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const MAX_FILING_SERIES_ROWS = 10_000;
const MAX_SUBMISSION_HISTORY_FILES = 1_000;
const FILING_SERIES_KEYS = [
  'accessionNumber',
  'filingDate',
  'reportDate',
  'acceptanceDateTime',
  'act',
  'form',
  'fileNumber',
  'primaryDocument',
  'primaryDocDescription',
] as const;

export interface SecFilingSeries {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[];
  fileNumber: string[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

export interface SecSubmission {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  ein: string;
  description: string;
  sic: string;
  sicDescription: string;
  /**
   * MMDD ("0930"), as SEC sends it. Optional and passed through unvalidated:
   * consumers parse it themselves (lib/boardProxy) and treat anything
   * malformed as unknown rather than assuming a calendar year.
   */
  fiscalYearEnd?: string;
  filings: {
    recent: SecFilingSeries;
    files?: Array<{
      name: string;
      filingCount?: number;
      filingFrom?: string;
      filingTo?: string;
    }>;
  };
}

const submissionHistoryCache = new Map<string, Promise<SecFilingSeries | null>>();

class NonRetryableSecSubmissionsError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maxLength: number, allowEmpty = true): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && (allowEmpty || value.trim().length > 0)
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function normalizeCik(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!/^\d{1,10}$/.test(raw)) return null;
  const numeric = Number(raw);
  return Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 9_999_999_999
    ? String(numeric)
    : null;
}

function validIsoDate(value: string, allowEmpty = false): boolean {
  if (!value) return allowEmpty;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

export function parseSecFilingSeries(value: unknown): SecFilingSeries | null {
  const source = record(value);
  if (!source) return null;
  const accessionNumbers = source.accessionNumber;
  if (!Array.isArray(accessionNumbers) || accessionNumbers.length > MAX_FILING_SERIES_ROWS) return null;
  const rowCount = accessionNumbers.length;
  for (const key of FILING_SERIES_KEYS) {
    const entries = source[key];
    if (
      !Array.isArray(entries)
      || entries.length !== rowCount
      || entries.some(entry => !boundedString(entry, 1_000))
    ) return null;
  }
  if ((source.accessionNumber as string[]).some(value => !/^\d{10}-\d{2}-\d{6}$/.test(value))) return null;
  if ((source.filingDate as string[]).some(value => !validIsoDate(value))) return null;
  if ((source.reportDate as string[]).some(value => !validIsoDate(value, true))) return null;
  if ((source.form as string[]).some(value => !value.trim() || value.length > 40)) return null;
  return source as unknown as SecFilingSeries;
}

export function parseSecSubmissionPayload(value: unknown, requestedCik: string): SecSubmission | null {
  const source = record(value);
  const expectedCik = normalizeCik(requestedCik);
  const observedCik = normalizeCik(source?.cik);
  if (!source || typeof source.cik !== 'string' || !expectedCik || observedCik !== expectedCik) return null;
  for (const [key, maxLength, allowEmpty] of [
    ['name', 1_000, false],
    ['ein', 20, true],
    ['description', 20_000, true],
    ['sic', 10, true],
    ['sicDescription', 1_000, true],
  ] as const) {
    // SEC omits these or sends an explicit null for real filers — KKR & Co.
    // (CIK 1404912) returns "ein": null. Treating absence as a validation
    // FAILURE rejected a payload that is entirely well-formed, and the
    // rejection then cascaded (see fetchCompanySubmissionsBatch). Only the
    // required fields — those with allowEmpty false, i.e. `name` — may not be
    // absent; optional ones are allowed to be null/undefined.
    if (allowEmpty && (source[key] === null || source[key] === undefined)) continue;
    if (!boundedString(source[key], maxLength, allowEmpty)) return null;
  }
  if (
    !Array.isArray(source.tickers)
    || !Array.isArray(source.exchanges)
    || source.tickers.length !== source.exchanges.length
    || source.tickers.length > 100
    || source.tickers.some(item => !boundedString(item, 64, false))
    || source.exchanges.some(item => !boundedString(item, 128))
  ) return null;

  const filings = record(source.filings);
  const recent = parseSecFilingSeries(filings?.recent);
  if (!filings || !recent) return null;
  if (filings.files !== undefined) {
    if (!Array.isArray(filings.files) || filings.files.length > MAX_SUBMISSION_HISTORY_FILES) return null;
    const paddedCik = expectedCik.padStart(10, '0');
    for (const value of filings.files) {
      const file = record(value);
      if (!file || file.name === undefined || !boundedString(file.name, 80, false)) return null;
      if (!new RegExp(`^CIK${paddedCik}-submissions-\\d{3}\\.json$`).test(file.name)) return null;
      if (
        file.filingCount !== undefined
        && (!Number.isSafeInteger(file.filingCount) || Number(file.filingCount) < 0 || Number(file.filingCount) > 100_000)
      ) return null;
      for (const dateKey of ['filingFrom', 'filingTo'] as const) {
        if (file[dateKey] !== undefined && (
          typeof file[dateKey] !== 'string' || !validIsoDate(file[dateKey] as string)
        )) return null;
      }
    }
  }
  return source as unknown as SecSubmission;
}

function getHeaders(): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'gzip, deflate',
  };
}

function buildSubmissionDataUrl(path: string): string {
  const params = new URLSearchParams({
    upstream: 'data',
    path: path.replace(/^\/+/, ''),
  });
  // Preserve the readable URL shape produced by secApi's public URL builder.
  return `/api/sec-proxy?${params.toString().replace(/%2F/gi, '/')}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch company submissions by formatted CIK.
 * SEC payloads require 10-digit zero-padded CIK strings.
 */
export async function fetchCompanySubmissions(cik: string): Promise<SecSubmission | null> {
  const normalizedCik = normalizeCik(cik);
  if (!normalizedCik) return null;
  const paddedCik = normalizedCik.padStart(10, '0');
  try {
    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(buildSubmissionDataUrl(`submissions/CIK${paddedCik}.json`), {
          headers: getHeaders(),
        });
        lastResponse = response;

        if (response.ok) {
          const parsed = parseSecSubmissionPayload(await response.json(), normalizedCik);
          if (parsed) return parsed;
          if (attempt >= 2) throw new Error('SEC submissions payload failed validation');
        } else if (!(response.status === 403 || response.status === 429 || response.status >= 500)) {
          throw new NonRetryableSecSubmissionsError(
            `SEC API Error: ${response.status} ${response.statusText}`
          );
        } else if (attempt >= 2) {
          throw new Error(`SEC API Error: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        if (error instanceof NonRetryableSecSubmissionsError) throw error;
        if (attempt >= 2) throw error;
      }
      if (attempt < 2) {
        await delay(500 * (attempt + 1));
      }
    }

    throw new Error(`SEC API Error: ${lastResponse?.status || 0} ${lastResponse?.statusText || 'Unknown error'}`);
  } catch (error) {
    console.error('Failed to fetch SEC Submissions:', error);
    return null;
  }
}

/** Fetch one official SEC historical-submissions segment referenced by filings.files. */
export async function fetchSubmissionHistory(fileName: string): Promise<SecFilingSeries | null> {
  const safeName = fileName.trim().replace(/^\/+/, '');
  if (!/^CIK\d{10}-submissions-\d{3}\.json$/.test(safeName)) return null;

  if (!submissionHistoryCache.has(safeName)) {
    const loadPromise = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await fetch(buildSubmissionDataUrl(`submissions/${safeName}`), { headers: getHeaders() });
            if (response.ok) {
              const parsed = parseSecFilingSeries(await response.json());
              if (parsed) return parsed;
              if (attempt >= 2) throw new Error('SEC submission history payload failed validation');
            } else if (!(response.status === 403 || response.status === 429 || response.status >= 500)) {
              throw new NonRetryableSecSubmissionsError(
                `SEC submission history error: ${response.status}`
              );
            } else if (attempt >= 2) {
              throw new Error(`SEC submission history error: ${response.status}`);
            }
          } catch (error) {
            if (error instanceof NonRetryableSecSubmissionsError) throw error;
            if (attempt >= 2) throw error;
          }
          await delay(500 * (attempt + 1));
        }
        return null;
      } catch (error) {
        console.error('Failed to fetch SEC submission history:', error);
        return null;
      }
    })();
    submissionHistoryCache.set(safeName, loadPromise);
    void loadPromise.then(result => {
      if (!result && submissionHistoryCache.get(safeName) === loadPromise) {
        submissionHistoryCache.delete(safeName);
      }
    });
  }
  return submissionHistoryCache.get(safeName)!;
}

/** Test seam for deterministic cache-poisoning regressions. */
export function __clearSecSubmissionsCache(): void {
  submissionHistoryCache.clear();
}
