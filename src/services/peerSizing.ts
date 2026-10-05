/**
 * Size bands for peer candidates, read from each registrant's own XBRL.
 *
 * Two measures, both as filed:
 *  - public float: dei:EntityPublicFloat from the 10-K cover page, the
 *    aggregate market value held by non-affiliates as of the last business
 *    day of the registrant's second fiscal quarter. Reported in USD.
 *  - annual revenue: the same revenue concepts and annual-period selection
 *    Benchmarking's financial grid uses (secApi.extractFinancials), so a
 *    band and the grid can never disagree about what "revenue" was.
 *
 * Every value carries the accession and period it came from. A candidate
 * whose facts could not be read is "unsized", never "out of band"; a value
 * in another currency is "not comparable", never converted.
 */

import { extractFinancials, fetchCompanyFacts, type CompanyFacts, type XbrlFact } from './secApi';
import { mapWithConcurrency } from '../utils/sectionMatrix';

export type SizeMetric = 'publicFloat' | 'revenue';

export interface SizeFact {
  value: number;
  currency: string;
  /** Period end (revenue) or as-of date (public float). */
  asOf: string;
  accession: string | null;
  form: string | null;
  filed: string | null;
  /** Taxonomy concept the value was tagged with, e.g. dei:EntityPublicFloat. */
  concept: string;
}

export interface CompanySize {
  cik: string;
  status: 'read' | 'facts-unavailable';
  publicFloat: SizeFact | null;
  revenue: SizeFact | null;
}

function latestBy(facts: XbrlFact[]): XbrlFact | null {
  let best: XbrlFact | null = null;
  for (const fact of facts) {
    if (!Number.isFinite(fact.val) || !fact.end) continue;
    if (!best || fact.end > best.end || (fact.end === best.end && (fact.filed || '') > (best.filed || ''))) best = fact;
  }
  return best;
}

/**
 * Latest dei:EntityPublicFloat. Issuers occasionally tag it in the us-gaap
 * namespace instead of dei; both are read, and the newest as-of date wins.
 * A zero float (shell companies, wholly-owned subsidiaries that file) is
 * real data, but it cannot anchor a ratio, so it is kept and the band math
 * treats it as not comparable.
 */
export function readPublicFloat(facts: CompanyFacts): SizeFact | null {
  const sources: Array<[string, Record<string, { units: Record<string, XbrlFact[]> }> | undefined]> = [
    ['dei', facts.facts.dei],
    ['us-gaap', facts.facts['us-gaap']],
  ];
  let best: { fact: XbrlFact; concept: string; currency: string } | null = null;
  for (const [ns, namespace] of sources) {
    const concept = namespace?.EntityPublicFloat;
    if (!concept) continue;
    for (const [unit, unitFacts] of Object.entries(concept.units)) {
      if (!/^[A-Z]{3}$/.test(unit)) continue;
      const fact = latestBy(unitFacts);
      if (fact && (!best || fact.end > best.fact.end)) best = { fact, concept: `${ns}:EntityPublicFloat`, currency: unit };
    }
  }
  if (!best) return null;
  return {
    value: best.fact.val,
    currency: best.currency,
    asOf: best.fact.end,
    accession: best.fact.accn || null,
    form: best.fact.form || null,
    filed: best.fact.filed || null,
    concept: best.concept,
  };
}

/** Find the fact behind a selected annual value so the band can cite its filing. */
function factBehind(facts: CompanyFacts, value: number, end: string | undefined): { fact: XbrlFact; concept: string } | null {
  for (const ns of ['us-gaap', 'ifrs-full'] as const) {
    const namespace = facts.facts[ns];
    if (!namespace) continue;
    for (const [name, concept] of Object.entries(namespace)) {
      for (const unitFacts of Object.values(concept.units)) {
        for (const fact of unitFacts) {
          if (fact.val === value && fact.end === end && fact.start) {
            return { fact, concept: `${ns}:${name}` };
          }
        }
      }
    }
  }
  return null;
}

/** Latest annual revenue through the same selection the financial grid uses. */
export function readAnnualRevenue(facts: CompanyFacts): SizeFact | null {
  const metric = extractFinancials(facts).Revenues;
  if (!metric || metric.value === null || !Number.isFinite(metric.value)) return null;
  const source = factBehind(facts, metric.value, metric.periodEnd);
  return {
    value: metric.value,
    currency: metric.currency || 'USD',
    asOf: metric.periodEnd || String(metric.year),
    accession: source?.fact.accn ?? null,
    form: source?.fact.form ?? null,
    filed: source?.fact.filed ?? null,
    concept: source?.concept ?? metric.label,
  };
}

export function sizeFromFacts(cik: string, facts: CompanyFacts | null): CompanySize {
  if (!facts) return { cik, status: 'facts-unavailable', publicFloat: null, revenue: null };
  return { cik, status: 'read', publicFloat: readPublicFloat(facts), revenue: readAnnualRevenue(facts) };
}

// ---------------------------------------------------------------------------
// Band filter
// ---------------------------------------------------------------------------

export interface SizeBand {
  metric: SizeMetric;
  /** Lower multiple of the seed, e.g. 0.5. */
  low: number;
  /** Upper multiple of the seed, e.g. 2. */
  high: number;
}

export const DEFAULT_SIZE_BAND: SizeBand = { metric: 'publicFloat', low: 0.5, high: 2 };

export type BandVerdict =
  | { kind: 'in-band'; ratio: number; fact: SizeFact }
  | { kind: 'out-of-band'; ratio: number; fact: SizeFact }
  /** The candidate's facts were not read (yet, or the read failed). */
  | { kind: 'unsized' }
  /** Facts were read, but the measure is not reported. */
  | { kind: 'not-reported' }
  /** Different currency from the seed, or a zero/negative value: no honest ratio. */
  | { kind: 'not-comparable'; fact: SizeFact; reason: 'currency' | 'non-positive' };

function factFor(size: CompanySize, metric: SizeMetric): SizeFact | null {
  return metric === 'publicFloat' ? size.publicFloat : size.revenue;
}

/**
 * Where a candidate falls relative to the seed. Returns null when the seed
 * itself has no usable value for the metric — then no band exists at all.
 */
export function classifyAgainstSeed(
  seed: CompanySize | null | undefined,
  candidate: CompanySize | null | undefined,
  band: SizeBand,
): BandVerdict | null {
  const seedFact = seed ? factFor(seed, band.metric) : null;
  if (!seedFact || seedFact.value <= 0) return null;
  if (!candidate || candidate.status !== 'read') return { kind: 'unsized' };
  const fact = factFor(candidate, band.metric);
  if (!fact) return { kind: 'not-reported' };
  if (fact.currency !== seedFact.currency) return { kind: 'not-comparable', fact, reason: 'currency' };
  if (fact.value <= 0) return { kind: 'not-comparable', fact, reason: 'non-positive' };
  const ratio = fact.value / seedFact.value;
  return ratio >= band.low && ratio <= band.high
    ? { kind: 'in-band', ratio, fact }
    : { kind: 'out-of-band', ratio, fact };
}

const VERDICT_ORDER: Record<BandVerdict['kind'], number> = {
  'in-band': 0,
  'out-of-band': 1,
  'not-comparable': 2,
  'not-reported': 3,
  unsized: 4,
};

/**
 * Rank candidates for a band: in-band first, closest in size first (by
 * |log ratio|, so 0.5x and 2x are equally far), then out-of-band by
 * closeness, then those without a comparable value. Stable within ties.
 */
export function rankByBand<T>(
  items: T[],
  verdictOf: (item: T) => BandVerdict | null,
): Array<{ item: T; verdict: BandVerdict | null }> {
  return items
    .map((item, index) => ({ item, verdict: verdictOf(item), index }))
    .sort((a, b) => {
      const orderA = a.verdict ? VERDICT_ORDER[a.verdict.kind] : 5;
      const orderB = b.verdict ? VERDICT_ORDER[b.verdict.kind] : 5;
      if (orderA !== orderB) return orderA - orderB;
      const distA = a.verdict && 'ratio' in a.verdict ? Math.abs(Math.log(a.verdict.ratio)) : 0;
      const distB = b.verdict && 'ratio' in b.verdict ? Math.abs(Math.log(b.verdict.ratio)) : 0;
      if (distA !== distB) return distA - distB;
      return a.index - b.index;
    })
    .map(({ item, verdict }) => ({ item, verdict }));
}

/** "0.8x", "12x", "0.04x" — enough precision to read a band at a glance. */
export function formatMultiple(ratio: number): string {
  if (ratio >= 10) return `${Math.round(ratio)}x`;
  if (ratio >= 1) return `${ratio.toFixed(1)}x`;
  return `${ratio.toFixed(ratio >= 0.1 ? 2 : 3)}x`;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const sizeCache = new Map<string, CompanySize>();

function normalizeCik(cik: string): string {
  return String(Number(cik));
}

/** Cached sizes only (sync), for rendering what has already been read. */
export function cachedCompanySize(cik: string): CompanySize | null {
  return sizeCache.get(normalizeCik(cik)) ?? null;
}

/**
 * Read company facts for a candidate set, a few at a time. Every request goes
 * through /api/sec-proxy, whose server side takes a start slot from the
 * shared SEC pacer (lib/sec-request-pacer) before each upstream fetch.
 * Successful reads are cached for the session; failures are not, so a
 * transient error is retried on the next pass.
 */
export async function loadCompanySizes(
  ciks: string[],
  options: {
    concurrency?: number;
    fetchFacts?: (cik: string) => Promise<CompanyFacts | null>;
    onSize?: (size: CompanySize) => void;
    signal?: AbortSignal;
  } = {},
): Promise<Map<string, CompanySize>> {
  const fetchFacts = options.fetchFacts ?? fetchCompanyFacts;
  const result = new Map<string, CompanySize>();
  const pending: string[] = [];
  for (const raw of ciks) {
    const cik = normalizeCik(raw);
    if (!Number.isSafeInteger(Number(cik)) || Number(cik) <= 0 || result.has(cik) || pending.includes(cik)) continue;
    const cached = sizeCache.get(cik);
    if (cached) {
      result.set(cik, cached);
      options.onSize?.(cached);
    } else {
      pending.push(cik);
    }
  }
  await mapWithConcurrency(pending, options.concurrency ?? 3, async cik => {
    if (options.signal?.aborted) return;
    let facts: CompanyFacts | null = null;
    try {
      facts = await fetchFacts(cik);
    } catch {
      facts = null;
    }
    const size = sizeFromFacts(cik, facts);
    if (size.status === 'read') sizeCache.set(cik, size);
    result.set(cik, size);
    options.onSize?.(size);
  });
  return result;
}

/** Test seam. */
export function __clearCompanySizeCache(): void {
  sizeCache.clear();
}
