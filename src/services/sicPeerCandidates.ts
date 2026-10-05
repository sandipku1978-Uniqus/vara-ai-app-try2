/**
 * SIC peer candidates: the whole listed population of one SIC code from the
 * company store (/api/peer-candidates), plus the order in which to read
 * their sizes.
 *
 * Reading company facts costs one SEC request per company, so sizes are read
 * in batches, nearest first. "Nearest" before any size is known means
 * nearest in SEC's ticker directory, which SEC orders roughly by market
 * value — a reading order only. Whether a company is inside the band is
 * decided by the facts read, never by its directory position.
 */

import type { CompanyDirectoryEntry } from './secApi';

export interface SicCandidate {
  cik: string;
  name: string;
  /** The ticker Benchmarking will load: SEC directory's first ticker for this CIK when it has one. */
  ticker: string;
  sic: string;
  sicDescription: string | null;
  /** Position in SEC's directory, or null when the registrant is not in it. */
  directoryRank: number | null;
}

export interface SicCandidateList {
  sic: string;
  sicDescription: string | null;
  candidates: SicCandidate[];
  matched: number;
  capped: boolean;
}

export type SicCandidateOutcome =
  | { ok: true; list: SicCandidateList }
  | { ok: false; status: number; error: string };

interface RouteCompany {
  cik: string;
  name: string;
  tickers: string[];
  sic: string;
  sicDescription: string | null;
}

/** Pure: shape the route's rows against the directory. */
export function toSicCandidates(companies: RouteCompany[], directory: CompanyDirectoryEntry[]): SicCandidate[] {
  const byCik = new Map<string, { ticker: string; rank: number }>();
  directory.forEach((entry, rank) => {
    if (!byCik.has(entry.cik)) byCik.set(entry.cik, { ticker: entry.ticker, rank });
  });
  return companies.flatMap(company => {
    const cik = String(Number(company.cik));
    const listed = byCik.get(cik);
    const ticker = listed?.ticker ?? company.tickers.find(item => /^[A-Z0-9.-]{1,12}$/.test(item.toUpperCase()))?.toUpperCase();
    if (!ticker) return [];
    return [{
      cik,
      name: company.name,
      ticker,
      sic: company.sic,
      sicDescription: company.sicDescription,
      directoryRank: listed?.rank ?? null,
    }];
  });
}

export async function fetchSicCandidates(sic: string, directory: CompanyDirectoryEntry[]): Promise<SicCandidateOutcome> {
  try {
    const response = await fetch(`/api/peer-candidates?sic=${encodeURIComponent(sic)}`);
    const payload = await response.json().catch(() => null) as {
      companies?: RouteCompany[];
      matched?: number;
      capped?: boolean;
      error?: string;
    } | null;
    if (!response.ok || !payload || !Array.isArray(payload.companies)) {
      return { ok: false, status: response.status, error: payload?.error || 'Peer candidates could not be loaded.' };
    }
    const candidates = toSicCandidates(payload.companies, directory);
    return {
      ok: true,
      list: {
        sic,
        sicDescription: payload.companies.find(company => company.sicDescription)?.sicDescription ?? null,
        candidates,
        matched: typeof payload.matched === 'number' ? payload.matched : candidates.length,
        capped: payload.capped === true,
      },
    };
  } catch {
    return { ok: false, status: 0, error: 'Peer candidates could not be loaded.' };
  }
}

/**
 * The next candidates whose size should be read: not yet read, nearest the
 * seed in directory order first; registrants missing from the directory go
 * last, in store order.
 */
export function nextSizingBatch(
  candidates: SicCandidate[],
  seedRank: number | null,
  alreadyRead: (cik: string) => boolean,
  batchSize: number,
): SicCandidate[] {
  const pending = candidates.filter(candidate => !alreadyRead(candidate.cik));
  const anchor = seedRank ?? 0;
  return pending
    .map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => {
      const rankA = a.candidate.directoryRank;
      const rankB = b.candidate.directoryRank;
      if (rankA === null && rankB === null) return a.order - b.order;
      if (rankA === null) return 1;
      if (rankB === null) return -1;
      return Math.abs(rankA - anchor) - Math.abs(rankB - anchor) || rankA - rankB;
    })
    .slice(0, batchSize)
    .map(entry => entry.candidate);
}
