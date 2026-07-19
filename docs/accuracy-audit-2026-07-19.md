# Uniqus Research Center — SEC Data Accuracy Audit (2026-07-19)

Four-track audit (ingest pipeline, search path, XBRL financials, AI grounding) plus live
production probes. Root question: "we used to struggle with the accuracy pulled out of the
SEC database." Answer: the struggles are real, systemic, and largely fixable. The five
root causes, in causal order:

## Root cause 1 — The Elasticsearch index is unreachable (P0)

- `src/services/secApi.ts:820` fetches `/api/es-search`, **which does not exist** — never
  migrated into `src/app/api/`. `src/__tests__/esSearchApi.test.ts` imports a module that
  isn't in the repo.
- The enable flag reads `NEXT_PUBLIC_USE_ELASTICSEARCH` while `.env.example`, tests, and
  comments all say `VITE_USE_ELASTICSEARCH`.
- Net effect: ~850K ingested filings, with auditor/accelerated-filer enrichment, are dead
  weight. All production search silently uses EDGAR EFTS (verified live), which caps at
  ~10 hits/page and has none of the enrichment fields the UI renders.
- And when ES *is* enabled and fails, `searchEdgarFilings` throws with **no EFTS
  fallback** (`secApi.ts:856-868`).

## Root cause 2 — EFTS recall is crippled by a pagination bug (P0)

`secApi.ts:878-932`: page size up to 100 requested, but EDGAR EFTS returns ~10/page; loop
breaks after page one (`pageHits.length < pageSize`) and would skip hits 10–99 by offset
stride anyway. **Every live search is effectively capped at ~10 candidate filings**, then
auditor/SIC/boolean filters run client-side over those ~10 → filtered searches return
almost nothing. Compounding: undated searches silently floor at 2020-01-01; relevance
scoring is computed then ignored (date-sort only, `filingResearch.ts:580-586`); 10-K/A,
10-Q/A excluded from the default form scope while 8-K/A is included.

## Root cause 3 — Ingest never captured what the UI advertises (P0)

- `elasticsearch/ingest.ts:291` parses the form column as `(\S+)` — **every multi-word
  form (DEF 14A, SC 13D, SC 13G, SC TO-T, SC 14D9, PRE 14A) was dropped at parse time**.
  Empirically verified. Proxy statements and M&A/ownership filings are absent from the index.
- ~2,800 "errors" in the last run = fully-downloaded filings lost to ES bulk timeouts with
  no dead-letter/retry (`ingest.ts:531-562`); progress advances past them.
- ~9,598 "skips" = submissions lookup capped at the recent-1000 window (`:478-483`,
  prolific filers systematically dropped), transient fetch failures cached as permanent
  null (`:416-430`), doc fetches swallowed to `''` (`:434-442`) — all uncategorized.
- Content truncated at 500K chars *before* auditor detection; hex entities undecoded;
  amendments indexed alongside originals with no supersession marker.
- Run counters are broken (indexed > processed; negative ETA), so run quality is unknowable.

## Root cause 4 — XBRL numbers are wrong in specific, material ways (P0/P1)

- **TotalDebt = first matching tag** (usually LongTermDebt) — short-term debt never
  summed → understated D/E (`secApi.ts:308,560-591`).
- **OperatingIncome falls back to pre-tax income** for filers without OperatingIncomeLoss
  (banks!) → inflated operating margins (`:296,516`).
- **Bank Revenue can resolve to net interest income** → wildly overstated net margin (`:293`).
- **Restatements lose**: dedup keys on `fy`, strips `/A`, never consults `filed` — the
  pre-restatement original wins (`:392-393,439-452`).
- **FYE misalignment**: fiscal year = calendar year of period end, so a Jan-FYE retailer's
  "FY2024" is ~11 months offset from a Dec-FYE peer under the same column header.
- **Cross-year ratio mixing** in AccountingAnalytics (no pinned year → ROE numerator and
  denominator from different years).
- **Currency**: EUR/DKK filers plotted on a "$ Billions" axis with no conversion; derived
  metrics drop the currency field; FCF hardcodes USD.
- **Missing coerced to 0** in margin charts, radar, and balance-sheet composition — a
  company that didn't tag GrossProfit renders as a real 0% margin.
- The two "accuracy test" scripts assert nothing (no thresholds, no CI, no ground truth,
  no recorded pass rate). Accuracy was effectively unmeasured.

## Root cause 5 — The AI layer can answer from nothing (P0)

- System prompt hardcodes `{DYNAMIC_FILING_CONTEXT}` — **never substituted anywhere**
  (`src/lib/systemPrompts.ts:37-42`). Endpoints tell Claude to "ground ALL answers" in an
  empty placeholder; direct Q&A answers come from model priors.
- No citation/grounding validation exists; the prompt *mandates* EDGAR links, encouraging
  fabricated URLs.
- Filing summary still generates confidently when the text fetch silently returned `''`
  (`aiApi.ts:438-461`).
- Cache poisoning: compare cache key ignores content (tickers+section+**array length**);
  claude/stream keys omit `frameworks` and effective temperature; temp-1 extended-thinking
  outputs cached 7 days; no invalidation on amended filings.
- Structured extractors instructed to output "reasonable defaults" (0 / N/A) —
  fabrication rendered as data.
- Live-verified: `/api/claude` responds 200 to unauthenticated POSTs (open token burn).

## Execution plan (this session, in commit order)

1. **fix(search): EFTS recall** — pagination stride, 2001 date floor, amendment forms in
   scope, ES→EFTS fallback, honor relevance sort.
2. **fix(search): intent accuracy** — word-boundary ticker matching, uppercase-only
   boolean operators, no cross-query filter contamination.
3. **feat(search): restore /api/es-search** — Next.js route handler implementing the query
   contract the test expects; standardize the env flag; exact-phrase subfield note.
4. **fix(xbrl): numeric accuracy** — TotalDebt summed, OperatingIncome no pre-tax
   fallback, bank revenue aliases, dedup prefers latest-filed//A, UTC-safe year, pinned
   year in AccountingAnalytics, currency threading, charts render null not 0.
5. **fix(ai): grounding** — split grounded vs general prompts (kill the dead
   placeholder), content-hashed compare cache key, frameworks+effective-params in cache
   keys, TTL from effective temperature, short-circuit summary on empty text.
6. **fix(ingest): coverage + resilience** — fixed-width idx parsing (multi-word forms),
   dead-letter for failed bulks, no null-caching of transient failures, categorized skip
   counters, fixed progress math, paginated submissions shards.

Deferred (needs infra/decisions, tracked in improvement-plan-2026-07.md): auth gating of
AI routes (verified open in prod), re-ingest/backfill run after parser fixes, ES index
freshness check + scheduled ingest, ground-truth XBRL benchmark suite in CI, FYE-aligned
benchmarking UX, common-currency conversion, model upgrade off `claude-sonnet-4-6`.

Full agent findings (file:line for every item) are preserved in the session transcript;
this document is the prioritized synthesis.
