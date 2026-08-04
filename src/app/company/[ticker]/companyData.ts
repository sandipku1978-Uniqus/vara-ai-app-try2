import { unstable_cache } from 'next/cache';
import { isLocalE2eBypass } from '../../../lib/clerk-config';
import { fetchSecJson } from '../../../lib/sec-upstream';
import {
  LOCAL_E2E_DOSSIER_CIK,
  LOCAL_E2E_DOSSIER_SUBMISSION,
} from './dossierE2eFixture';

const SEC_USER_AGENT = 'Uniqus Research Center contact@uniqus.com';
const DOSSIER_REVALIDATE_SECONDS = 86_400;
const RECENT_FILING_LIMIT = 15;
const DOSSIER_SUBMISSIONS_MAX_BYTES = 20 * 1024 * 1024;

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
  const payload = await fetchSecJson({
    upstream: 'data',
    path: `submissions/CIK${cik}.json`,
    userAgent: SEC_USER_AGENT,
    maxBytes: DOSSIER_SUBMISSIONS_MAX_BYTES,
  });

  // The projected result below is the persistent cache entry. The central SEC
  // helper always reads the raw response no-store, avoiding Next's per-entry
  // data-cache limit for large issuers while this small projection keeps ISR.
  const projected = projectDossierCompanyData(payload);
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
  // Playwright cannot intercept this Server Component's outbound SEC request.
  // The existing localhost-only auth bypass is the single test-mode boundary;
  // Vercel always sets VERCEL, so this branch is unreachable on hosted builds.
  if (isLocalE2eBypass() && cik === LOCAL_E2E_DOSSIER_CIK) {
    return Promise.resolve(projectDossierCompanyData(LOCAL_E2E_DOSSIER_SUBMISSION));
  }

  const pending = inFlight.get(cik);
  if (pending) return pending;

  const request = loadDossierCompanyDataCached(cik)
    .catch(() => null)
    .finally(() => inFlight.delete(cik));
  inFlight.set(cik, request);
  return request;
}
