/**
 * Corrects a ticker that SEC's directory maps to an entity with no filing
 * history.
 *
 * Holding-company reorganizations create a fresh CIK that inherits the ticker
 * and files an 8-K12B as successor registrant, while the entire filing history
 * — every 10-K, every financial statement — stays on the predecessor CIK.
 * `company_tickers.json` follows the ticker, so it points at the shell.
 *
 * The accuracy gate found this live: XOM maps to CIK 2115436 "ExxonMobil
 * Holdings Corp" (created 2026-07-01, no annual report) while Exxon's history
 * is at CIK 34088. Anyone searching XOM got an issuer with nothing in it.
 *
 * The successor carries no `formerNames` entry, so there is no link to follow.
 * EDGAR's own ticker lookup does resolve it, so that is what we fall back to.
 */

import { fetchCompanySubmissions } from './secApi';

/** Forms that mark an entity as the one carrying the reporting history. */
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

export interface EntityFilingStatus {
  cik: string;
  hasAnnualReport: boolean;
  /** Newest annual report date, when there is one. */
  latestAnnual?: string;
}

export async function getEntityFilingStatus(cik: string): Promise<EntityFilingStatus | null> {
  const submissions = await fetchCompanySubmissions(cik);
  if (!submissions) return null;

  const recent = submissions.filings?.recent;
  const forms = recent?.form ?? [];
  for (let i = 0; i < forms.length; i += 1) {
    if (ANNUAL_FORMS.has(forms[i])) {
      return { cik, hasAnnualReport: true, latestAnnual: recent?.filingDate?.[i] };
    }
  }
  return { cik, hasAnnualReport: false };
}

/**
 * Ask EDGAR which CIK it associates with a ticker. Returns null on any
 * failure — a correction we cannot make is never worse than the directory
 * value we already have.
 *
 * Goes through /api/company-cik rather than /api/sec-proxy because EDGAR
 * answers in Atom and the proxy sanitizes every response as HTML, stripping
 * <cik> and leaving loose digits — including the registrant's phone number —
 * that cannot be distinguished from a CIK.
 */
export async function lookupCikByTicker(ticker: string): Promise<string | null> {
  const clean = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(clean)) return null;

  try {
    const response = await fetch(`/api/company-cik?ticker=${encodeURIComponent(clean)}`);
    if (!response.ok) return null;
    const payload = await response.json() as { ok?: boolean; cik?: string | null };
    return payload.ok && payload.cik ? payload.cik : null;
  } catch {
    return null;
  }
}

const corrections = new Map<string, Promise<string>>();

/**
 * Return the CIK that actually carries `ticker`'s reporting history.
 *
 * Costs nothing in the common case: an entity with an annual report is
 * returned as-is after a single submissions read, which most callers have
 * already warmed. Only a directory entry with no annual report triggers the
 * EDGAR lookup, and the outcome is memoised per ticker.
 *
 * Falls back to `directoryCik` whenever the correction cannot be made, so
 * this can only improve resolution, never break it.
 */
export function resolveFilingEntityCik(ticker: string, directoryCik: string): Promise<string> {
  const key = `${ticker.toUpperCase()}:${directoryCik}`;
  const cached = corrections.get(key);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const status = await getEntityFilingStatus(directoryCik);
      // Unreachable submissions must not trigger a rewrite on no evidence.
      if (!status || status.hasAnnualReport) return directoryCik;

      const candidate = await lookupCikByTicker(ticker);
      if (!candidate || candidate === directoryCik) return directoryCik;

      // Only accept a candidate that genuinely carries the history.
      const candidateStatus = await getEntityFilingStatus(candidate);
      if (!candidateStatus?.hasAnnualReport) return directoryCik;

      console.info(
        `[filingEntity] ${ticker}: directory CIK ${directoryCik} has no annual report; ` +
        `using CIK ${candidate} (latest annual ${candidateStatus.latestAnnual})`
      );
      return candidate;
    } catch {
      return directoryCik;
    }
  })();

  corrections.set(key, promise);
  return promise;
}

/** Test seam — the memo would otherwise leak between cases. */
export function __clearFilingEntityCache(): void {
  corrections.clear();
}
