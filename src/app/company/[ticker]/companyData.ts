import { unstable_cache } from 'next/cache';

const SEC_USER_AGENT = 'Uniqus Research Center contact@uniqus.com';
const DOSSIER_REVALIDATE_SECONDS = 86_400;
const RECENT_FILING_LIMIT = 15;

export interface DossierCompanyData {
  name: string;
  tickers: string[];
  exchanges: string[];
  sicDescription: string;
  sic: string;
  stateOfIncorporation: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text);
}

function recentTextArray(value: unknown): string[] {
  return textArray(value).slice(0, RECENT_FILING_LIMIT);
}

/** Keep large SEC submissions payloads out of Next's persistent data cache. */
export function projectDossierCompanyData(value: unknown): DossierCompanyData | null {
  const submission = record(value);
  const filings = record(submission?.filings);
  const recent = record(filings?.recent);
  const name = text(submission?.name);
  if (!submission || !recent || !name) return null;

  return {
    name,
    tickers: textArray(submission.tickers),
    exchanges: textArray(submission.exchanges),
    sicDescription: text(submission.sicDescription),
    sic: text(submission.sic),
    stateOfIncorporation: text(submission.stateOfIncorporation),
    filings: {
      recent: {
        accessionNumber: recentTextArray(recent.accessionNumber),
        filingDate: recentTextArray(recent.filingDate),
        form: recentTextArray(recent.form),
        primaryDocument: recentTextArray(recent.primaryDocument),
        primaryDocDescription: recentTextArray(recent.primaryDocDescription),
      },
    },
  };
}

async function loadDossierCompanyData(cik: string): Promise<DossierCompanyData> {
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { 'User-Agent': SEC_USER_AGENT },
    // The projected result below is the persistent cache entry. Caching this raw
    // response would exceed Next's per-entry data-cache limit for large issuers.
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`SEC submissions request failed (${response.status})`);

  const projected = projectDossierCompanyData(await response.json());
  if (!projected) throw new Error('SEC submissions response was malformed');
  return projected;
}

const loadDossierCompanyDataCached = unstable_cache(
  loadDossierCompanyData,
  ['issuer-dossier-company-data-v1'],
  { revalidate: DOSSIER_REVALIDATE_SECONDS },
);

// Metadata and page rendering can request the same CIK concurrently. Keep only
// one cache lookup/upstream request in flight per server process.
const inFlight = new Map<string, Promise<DossierCompanyData | null>>();

export function fetchDossierCompanyData(cik: string): Promise<DossierCompanyData | null> {
  const pending = inFlight.get(cik);
  if (pending) return pending;

  const request = loadDossierCompanyDataCached(cik)
    .catch(() => null)
    .finally(() => inFlight.delete(cik));
  inFlight.set(cik, request);
  return request;
}
