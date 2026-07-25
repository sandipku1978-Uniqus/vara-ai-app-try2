/**
 * Ranking for the company/ticker autocomplete.
 *
 * The previous matcher collected substring hits in whatever order the ticker
 * map happened to iterate, then stopped after 20. For "space" that meant 20
 * mid-word matches ("HowmetAeroSPACE", "RackSPACE", "TalkSPACE") were taken
 * before SPACE EXPLORATION TECHNOLOGIES CORP — which is the 25th match in file
 * order — was ever examined. A company whose name *begins* with the query was
 * unreachable.
 *
 * Matches are now scored by how well they match, ranked, and only then cut.
 * Nothing is skipped during collection.
 */

export interface CompanyCandidate {
  ticker: string;
  cik: string;
  title?: string;
}

/**
 * How a candidate matched, best first. The numeric order IS the ranking, so a
 * name that starts with the query always outranks one that merely contains it.
 */
export enum MatchTier {
  ExactTicker = 0,
  /** Household brand → registrant ("google" → Alphabet Inc.) */
  Alias = 1,
  TickerPrefix = 2,
  /**
   * The query is a prefix of a curated brand name — "space" → SpaceX.
   *
   * This tier exists because SEC's directory order is NOT a reliable
   * prominence signal. It is size-ordered at the head (NVDA, AAPL, GOOGL…)
   * but registrants it has no ranking for are parked in a tail block among
   * ETFs and trusts — SPACE EXPLORATION TECHNOLOGIES sits at 7180 between
   * MDY and DIA. Tie-breaking on file order there ranks a nano-cap SPAC
   * above SpaceX. The curated table is the signal that actually reflects
   * what someone typing a few letters means.
   */
  AliasPrefix = 3,
  /** Registrant name begins with the query — "space" → SPACE EXPLORATION… */
  TitlePrefix = 4,
  /** Query begins a later word — "space" → Extra **Space** Storage */
  TitleWordStart = 5,
  /** Query sits inside a word — "space" → Rack**space** */
  TitleSubstring = 6,
}

const WORD_BOUNDARY = /[\s,./&()-]/;

function titleTier(title: string, query: string): MatchTier | null {
  const index = title.indexOf(query);
  if (index < 0) return null;
  if (index === 0) return MatchTier.TitlePrefix;
  return WORD_BOUNDARY.test(title[index - 1]) ? MatchTier.TitleWordStart : MatchTier.TitleSubstring;
}

export interface RankOptions {
  tickerMap: Record<string, string>;
  titleMap: Record<string, string>;
  aliasTicker?: string | null;
  /** Curated brand name → ticker, matched by prefix. See MatchTier.AliasPrefix. */
  aliasMap?: Record<string, string>;
  limit?: number;
}

/** Below this, a prefix would match too many brands to be a useful signal. */
const MIN_ALIAS_PREFIX = 3;

/**
 * Rank every company matching `rawQuery`, best match first.
 *
 * Source order is preserved within a tier: `company_tickers.json` is ordered
 * roughly by size, so among equally good matches the larger registrant leads.
 */
export function rankCompanyMatches(rawQuery: string, options: RankOptions): CompanyCandidate[] {
  const query = rawQuery.toUpperCase().trim();
  const { tickerMap, titleMap, aliasTicker, aliasMap, limit = 15 } = options;
  if (!query) return [];

  // One entry per ticker, keeping its best tier and first-seen position.
  const best = new Map<string, { tier: MatchTier; order: number; candidate: CompanyCandidate }>();
  let order = 0;

  const consider = (ticker: string, tier: MatchTier, title?: string) => {
    const cik = tickerMap[ticker];
    if (!cik) return;
    const existing = best.get(ticker);
    if (existing && existing.tier <= tier) return;
    best.set(ticker, {
      tier,
      order: existing?.order ?? order++,
      candidate: { ticker, cik, title: title ?? titleMap[ticker] },
    });
  };

  if (tickerMap[query]) consider(query, MatchTier.ExactTicker);
  if (aliasTicker) consider(aliasTicker, MatchTier.Alias);

  for (const ticker of Object.keys(tickerMap)) {
    if (ticker !== query && ticker.startsWith(query)) consider(ticker, MatchTier.TickerPrefix);
  }

  // "space" → SPACEX, "goog" → GOOGLE, "faceb" → FACEBOOK.
  if (aliasMap && query.length >= MIN_ALIAS_PREFIX) {
    for (const [brand, ticker] of Object.entries(aliasMap)) {
      if (brand.startsWith(query)) consider(ticker, MatchTier.AliasPrefix);
    }
  }

  // Every title is examined — no early break. ~10k substring checks per
  // keystroke is imperceptible, and stopping early is exactly what hid SpaceX.
  for (const [ticker, title] of Object.entries(titleMap)) {
    if (!title) continue;
    const tier = titleTier(title.toUpperCase(), query);
    if (tier !== null) consider(ticker, tier, title);
  }

  const ranked = [...best.values()].sort((a, b) => (a.tier - b.tier) || (a.order - b.order));

  // One row per issuer. SEC lists warrants and units as separate tickers on the
  // same CIK (SAAQ / SAAQW / SAAQU; EVTL / EVBWF / EVAWF / EVTWF), and letting
  // each claim a slot pushes distinct companies off the end of the list. The
  // best-ranked ticker for a CIK wins, which is the common share.
  const seenCik = new Set<string>();
  const deduped: CompanyCandidate[] = [];
  for (const entry of ranked) {
    if (seenCik.has(entry.candidate.cik)) continue;
    seenCik.add(entry.candidate.cik);
    deduped.push(entry.candidate);
    if (deduped.length >= limit) break;
  }
  return deduped;
}
