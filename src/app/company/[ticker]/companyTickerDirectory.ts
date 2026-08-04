import { unstable_cache } from 'next/cache';
import { fetchSecJson } from '../../../lib/sec-upstream';

const SEC_USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT
  || 'Uniqus Research Center contact@uniqus.com';
const DOSSIER_REVALIDATE_SECONDS = 86_400;
const COMPANY_TICKERS_MAX_BYTES = 5 * 1024 * 1024;

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseCompanyTickerEntry(value: unknown): CompanyTickerEntry | null {
  const entry = record(value);
  const cik = entry?.cik_str;
  const ticker = entry?.ticker;
  if (
    !Number.isSafeInteger(cik)
    || Number(cik) <= 0
    || Number(cik) > 9_999_999_999
    || typeof ticker !== 'string'
    || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(ticker)
  ) {
    return null;
  }
  return { cik_str: Number(cik), ticker };
}

/** Reduce the SEC directory to the only fields the dossier resolver needs. */
export function projectCompanyTickerDirectory(value: unknown): Record<string, string> | null {
  const payload = record(value);
  if (!payload || Object.keys(payload).length === 0) return null;

  const directory: Record<string, string> = {};
  for (const rawEntry of Object.values(payload)) {
    const entry = parseCompanyTickerEntry(rawEntry);
    if (!entry || directory[entry.ticker]) return null;
    directory[entry.ticker] = String(entry.cik_str).padStart(10, '0');
  }
  return directory;
}

async function loadCompanyTickerDirectory(): Promise<Record<string, string>> {
  const payload = await fetchSecJson({
    upstream: 'proxy',
    path: 'files/company_tickers.json',
    userAgent: SEC_USER_AGENT,
    maxBytes: COMPANY_TICKERS_MAX_BYTES,
  });
  const directory = projectCompanyTickerDirectory(payload);
  if (!directory) throw new Error('SEC company ticker directory was malformed.');
  return directory;
}

const loadCompanyTickerDirectoryCached = unstable_cache(
  loadCompanyTickerDirectory,
  ['issuer-dossier-company-ticker-directory-v1'],
  { revalidate: DOSSIER_REVALIDATE_SECONDS },
);

let directoryInFlight: Promise<Record<string, string>> | null = null;

function getCompanyTickerDirectory(): Promise<Record<string, string>> {
  if (directoryInFlight) return directoryInFlight;
  directoryInFlight = loadCompanyTickerDirectoryCached()
    .finally(() => { directoryInFlight = null; });
  return directoryInFlight;
}

export async function resolveDossierCik(raw: string): Promise<string | null> {
  let trimmed: string;
  try {
    trimmed = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }

  const cikMatch = trimmed.match(/^(?:cik)?0*(\d{1,10})$/i);
  if (cikMatch) return cikMatch[1].padStart(10, '0');

  try {
    const directory = await getCompanyTickerDirectory();
    return directory[trimmed.toUpperCase()] || null;
  } catch {
    return null;
  }
}
