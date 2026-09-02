/**
 * Loads one issuer's proxy-derived board profile with full provenance.
 *
 * The Board Profiles page used to run two copies of this flow — one for the
 * target company, one per comparison column — each with its own catch-all
 * wording, so the same SEC outage read as "not found" in one place and "no
 * DEF 14A" in another. There is one path now, and every way it can stop is a
 * typed failure the view renders distinctly (see lib/boardProxy).
 *
 * Only successes are cached; a failure is retried on the next request. Two
 * concurrent requests for the same ticker (the target fetch and its own
 * comparison column) share one in-flight load, so the DEF 14A is read and
 * extracted once.
 */

import { aiExtractBoardData, type BoardDataResult } from './aiApi';
import {
  buildSecDocumentUrl,
  buildSecFilingIndexUrl,
  fetchCompanySubmissions,
  fetchFilingTextOutcome,
  getCompanyDirectory,
  lookupCIKFlexible,
  type SecSubmission,
} from './secApi';
import {
  attributeProxyFiling,
  describeRecentFilingWindow,
  findLatestProxyFiling,
  MIN_PROXY_TEXT_LENGTH,
  type BoardLoadFailure,
  type ProxyAttribution,
  type ProxyProvenance,
} from '../lib/boardProxy';

export interface BoardProfile {
  ticker: string;
  /** Ten-digit CIK as the lookup returned it. */
  cik: string;
  companyData: SecSubmission;
  boardData: BoardDataResult;
  source: ProxyProvenance;
  /** Null only if EDGAR's filing date was unreadable, which the parser forbids. */
  attribution: ProxyAttribution | null;
}

export type BoardProfileOutcome =
  | { ok: true; profile: BoardProfile }
  | { ok: false; failure: BoardLoadFailure; companyData: SecSubmission | null };

const profileCache = new Map<string, BoardProfile>();
const inFlight = new Map<string, Promise<BoardProfileOutcome>>();

const PLACEHOLDER_TEXT = /^(?:n\/?a|none|null|unknown|not\s+(?:disclosed|stated|available|applicable|provided)|-+|—)$/i;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A stated value; placeholders the model may emit instead of null become null. */
function statedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !PLACEHOLDER_TEXT.test(trimmed) ? trimmed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

/**
 * The model's JSON is untrusted structure. Missing lists become empty, and a
 * missing or non-numeric figure becomes null — never 0, which downstream could
 * not tell from a disclosed zero. Returns null when nothing usable survives.
 */
export function normalizeBoardData(raw: unknown): BoardDataResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const diversity = source.diversity && typeof source.diversity === 'object' && !Array.isArray(source.diversity)
    ? source.diversity as Record<string, unknown>
    : {};

  const directors = Array.isArray(source.directors)
    ? source.directors.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const director = item as Record<string, unknown>;
        const name = statedText(director.name);
        if (!name) return [];
        return [{
          name,
          role: statedText(director.role) ?? '',
          independent: director.independent === true,
          committees: stringList(director.committees),
        }];
      })
    : [];
  const compensation = Array.isArray(source.compensation)
    ? source.compensation.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const officer = item as Record<string, unknown>;
        const name = statedText(officer.name);
        if (!name) return [];
        return [{
          name,
          title: statedText(officer.title) ?? '',
          salary: statedText(officer.salary) ?? '',
          stockAwards: statedText(officer.stockAwards) ?? '',
          total: statedText(officer.total) ?? '',
        }];
      })
    : [];

  const normalized: BoardDataResult = {
    directors,
    compensation,
    boardSize: finiteNumber(source.boardSize),
    independencePercent: finiteNumber(source.independencePercent),
    diversity: {
      malePercent: finiteNumber(diversity.malePercent),
      femalePercent: finiteNumber(diversity.femalePercent),
      maleCount: finiteNumber(diversity.maleCount),
      femaleCount: finiteNumber(diversity.femaleCount),
    },
    ceoPayRatio: statedText(source.ceoPayRatio),
    sayOnPayApproval: statedText(source.sayOnPayApproval),
  };

  const hasAnyValue = directors.length > 0
    || compensation.length > 0
    || normalized.boardSize != null
    || normalized.independencePercent != null
    || normalized.diversity.malePercent != null
    || normalized.diversity.femalePercent != null
    || normalized.diversity.maleCount != null
    || normalized.diversity.femaleCount != null
    || normalized.ceoPayRatio != null
    || normalized.sayOnPayApproval != null;
  return hasAnyValue ? normalized : null;
}

async function load(ticker: string): Promise<BoardProfileOutcome> {
  let cik: string | null = null;
  try {
    cik = await lookupCIKFlexible(ticker);
  } catch (error) {
    console.error('Board profile CIK lookup error:', error);
    cik = null;
  }
  if (!cik) {
    // The directory swallows its own load failure and resolves nothing; an
    // empty directory is that failure, not an unknown ticker.
    const directory = await getCompanyDirectory().catch(() => []);
    return {
      ok: false,
      companyData: null,
      failure: directory.length === 0
        ? { kind: 'lookup-failed', stage: 'directory', ticker }
        : { kind: 'ticker-unknown', ticker },
    };
  }

  const companyData = await fetchCompanySubmissions(cik);
  if (!companyData) {
    return { ok: false, companyData: null, failure: { kind: 'lookup-failed', stage: 'submissions', ticker, cik } };
  }

  const filing = findLatestProxyFiling(companyData.filings.recent);
  if (!filing) {
    return {
      ok: false,
      companyData,
      failure: {
        kind: 'no-proxy',
        ticker,
        cik,
        companyName: companyData.name,
        window: describeRecentFilingWindow(companyData.filings.recent),
      },
    };
  }

  const outcome = await fetchFilingTextOutcome(cik, filing.accessionNumber, filing.primaryDocument);
  if (!outcome.ok) {
    if (outcome.kind === 'not-found' || outcome.kind === 'unsupported' || outcome.kind === 'cancelled') {
      return {
        ok: false,
        companyData,
        failure: { kind: 'proxy-unreadable', ticker, cik, filing, reason: outcome.kind, status: outcome.status },
      };
    }
    return {
      ok: false,
      companyData,
      failure: { kind: 'lookup-failed', stage: 'proxy-text', ticker, cik, filing, transport: outcome.kind, status: outcome.status },
    };
  }
  if (outcome.text.length < MIN_PROXY_TEXT_LENGTH) {
    return { ok: false, companyData, failure: { kind: 'proxy-unreadable', ticker, cik, filing, reason: 'too-short' } };
  }

  const boardData = normalizeBoardData(await aiExtractBoardData(outcome.text));
  if (!boardData) {
    return { ok: false, companyData, failure: { kind: 'extraction-failed', ticker, cik, filing } };
  }

  const numericCik = String(Number(cik));
  const source: ProxyProvenance = {
    ...filing,
    cik: numericCik,
    documentUrl: buildSecDocumentUrl(numericCik, filing.accessionNumber, filing.primaryDocument),
    indexUrl: buildSecFilingIndexUrl(numericCik, filing.accessionNumber),
  };
  return {
    ok: true,
    profile: {
      ticker,
      cik,
      companyData,
      boardData,
      source,
      attribution: attributeProxyFiling(filing, companyData.fiscalYearEnd),
    },
  };
}

export function loadBoardProfile(rawTicker: string): Promise<BoardProfileOutcome> {
  const ticker = rawTicker.trim().toUpperCase();
  const cached = profileCache.get(ticker);
  if (cached) return Promise.resolve({ ok: true, profile: cached });
  const pending = inFlight.get(ticker);
  if (pending) return pending;

  const work: Promise<BoardProfileOutcome> = load(ticker)
    .then(outcome => {
      if (outcome.ok) profileCache.set(ticker, outcome.profile);
      return outcome;
    })
    .finally(() => {
      if (inFlight.get(ticker) === work) inFlight.delete(ticker);
    });
  inFlight.set(ticker, work);
  return work;
}

/** Test seam. */
export function __clearBoardProfileCache(): void {
  profileCache.clear();
  inFlight.clear();
}
