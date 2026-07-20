# Review of the audit remediation — problem areas

**Review date:** 2026-07-20
**Reviewing:** the uncommitted working tree against `HEAD` = `190e5e1` (pre-remediation baseline)
**Subject:** the 74 findings closed in `docs/full-codebase-audit-2026-07-19.md`
**Status:** temporary review doc — findings only, no code was changed

---

## Method

Seventeen independent reviewers read the actual code for every finding cluster plus four cross-cutting sweeps (deletion inventory, over-engineering, test quality, new-bug consistency). Every problem they raised was then handed to a separate agent whose job was to **refute** it by reading the code directly. A completeness critic then hunted for what the review itself missed.

- 99 candidate problems raised
- **41 refuted** and discarded (the code did hold up, or the claimed capability never existed pre-fix)
- **58 upheld** + 11 additional from the completeness pass
- 150 remediations independently confirmed as genuinely fixed

I also reproduced the audit's own gates: `typecheck` clean, `lint` clean, **626 tests pass**, production build generates **46/46 pages**. Those claims are true.

**Headline:** the remediation is mostly real work, not a whitewash. Auth, SSRF/XSS hardening, CSV injection, Boolean search validation, official-source parsers, and the dependency cleanup are genuine fixes with real tests. But there are **four issues where the fix does not achieve what the doc claims**, **five bugs the remediation itself introduced**, and a systematic problem with the *evidence*: a meaningful slice of the "626 tests" assert on source text rather than behavior. The 3.58-second suite runtime is the tell.

---

## A. Where the change does not actually solve the issue

### A1. `SEC-01` — the sanitizer breaks the filing viewer's tables (HIGH)

`src/lib/sec-upstream.ts:188` puts `style` in `nonTextTags`, so `<style>` blocks are dropped content-and-all, while `class` is still preserved at `:173` — class selectors survive with nothing to resolve against. The attribute allowlist (`:172-183`) permits no `align`, `valign`, `bgcolor`, `nowrap`, `cellpadding`, `cellspacing`, or `border`, and `SAFE_HTML_TAGS` (`:17-26`) omits `font` and `center`.

Pre-2010 SEC financial statements right-align numeric columns with `align="right"` on `<td>` and set column proportions with `width`/`cellpadding`. All of it is stripped. The filing remains readable prose, but the tables — the entire point of the viewer — render as ragged left-aligned text. No test asserts that any legitimate filing markup survives; `securityHardening.test.ts:64-77` only checks that a `<p>` and an `<a href>` come through.

**Simpler and better:** allowlist the presentational attributes and keep `font`/`center`. None are script-bearing and the CSP already blocks scripts. ~6 lines, no loss of the SSRF/XSS guarantee.

### A2. `LETTERS-01` — coverage is now *measured*, not *increased* (HIGH)

The finding was "only a small fraction of comment letters was searchable." The retry queue (`data-pipeline/fetch-letter-text.ts:336-338`, index at `010:19-20`) covers only `content_error IS NULL OR = 'fetch_failed'`. Everything classified at `:193` as `pdf_only`, `pdf_unreadable`, or `no_text_extracted` is excluded from the queue permanently — a repo-wide grep finds no code anywhere that clears or reprocesses those buckets.

The file's own header comment (`:10`) says PDF extraction failure is the common case for Staff letters. So if the shortfall is PDF-dominated, coverage does not move at all — the change adds an exact percentage that reports the same gap.

Worse, the new legacy-identifier phase at `:282-301` *selects exactly those permanent-error rows*, pays the full EDGAR download at `:295`, and then never calls `extractLetterText` on the payload it already has.

**Simpler and better:** call `extractLetterText` on the payload already fetched in that loop, and add a `--reprocess-error` mode so those rows re-enter the queue after parser changes. ~15 lines, and it would actually raise the percentage.

### A3. `INDEX-01` — the headline claim is false on the error path

The audit says the fix "reports request/parse failures instead of returning a fabricated empty list." Parsing genuinely is fixed (`src/services/secApi.ts:1247-1263`). But `:1264-1267` is still `catch { console.error(...); return []; }` — semantically identical to HEAD. `:1245` is a second silent-empty path. A 403 remains indistinguishable from a filing with no documents, which is precisely the `ERROR-01` defect class this same remediation claims to have closed. And the function has **no production callers** — only its own test — so no user-visible capability was restored.

### A4. `SOURCE-05` / `SOURCE-06` — "exact types are requested" is not what the code does

`src/views/ExhibitSearch.tsx:85-95` requests a generic form set with `limit: 250`, then filters exhibit types **client-side** at `:93-94`. `selectedTypes` never reaches EDGAR — `filingResearch.ts:1084` forwards only `normalizeFormTypes`, and EFTS has no document-type parameter. When the post-filter empties the list, the UI says "No exhibit documents matched these criteria" (`:189`).

So a real EX-2.1 sitting at candidate #300 of a 250-row window is silently dropped and reported as a genuine zero — the exact `ERROR-01` pattern, reintroduced at the specialist surfaces. Same shape in `EarningsTranscripts.tsx:88-93`.

**Simpler and better:** keep the client-side filter, but thread the existing `onCoverage` callback into both views: *"No EX-99.1 documents among the 250 most recent matching filings; narrow the date range."* ~10 lines reusing machinery already built.

### A5. Others in this class

| Finding | Problem |
|---|---|
| `SOURCE-01` | IAPD search hardcodes `nrows: '12'` (`officialSources.ts:61-69`); the caller's `limit: 100` maps to an inert `r` param. Confirmed against the live API: a search for a common name shows 12 of ~19,927 with no pagination control, while the UI renders the true total. |
| `ESG-02` | The "clearly labeled built-in topic mapping" was never implemented. `mappingsData` (`ESGResearch.tsx:337-345`) is **byte-identical to HEAD** — still 7 hard-coded SASB/GRI/ESRS rows with no provenance. Only the sidebar policy tracker was fixed. |
| `SEARCH-04` | `shouldHandleExternalResearchRoute` returns false whenever `tab=` is present (`researchSessions.ts:119-126`), and every URL the app writes contains `tab`. Sessions live in per-tab `sessionStorage`. Copy a Research URL into a new tab and it loads with zero results despite `q`, `mode`, and all filters being in the URL. The code comment at `:69-72` claims the opposite. |
| `AI-02` | `selectFilingText` returns `{sourceLength, selectedLength, complete}`, but **five of six call sites discard it** (`aiApi.ts:507-511, 528-534, 558-562, 576-580`; `systemPrompts.ts:304-307`). The audit says "prompts and UI prohibit exhaustive claims" — the prompt half is real, the UI half exists in exactly one view. Board data, deal details, and clause extracts render with no indication that ~93% of the filing was skipped. |
| `AI-03` | When every claim fails evidence validation, `aiApi.ts:211-213` returns an explanatory *string* as a successful return, and `FilingDetail.tsx:899-906` caches it as a summary with no retry affordance. |
| `SOURCE-06` | `matchesDocumentTypePrefixes` (`filingResearch.ts:315-322`) requires exact-segment match, so real-world `EX-99.01` filings don't match a selected `EX-99.1`. |
| `PRIV-02` | No migration off the legacy unscoped keys. Existing users silently lose watchlist, saved alerts, and filing annotations on upgrade (`AppState.tsx:205` re-seeds `['AAPL','MSFT']`), and the old data stays in localStorage forever. ~10 lines would fix both halves. |

---

## B. Bugs the remediation introduced

### B1. The whole app unmounts and remounts once Clerk resolves (HIGH)

`src/context/AppState.tsx:418-422` gates children on `hydratedStorageScope === storageScope`. `storageScope` is derived synchronously during render (`:167`); `hydratedStorageScope` only advances inside a `useEffect` (`:199-225`). The sequence is deterministic on **every page load**: render 1 has both `null` → children render; Clerk resolves → `storageScope` non-null, `hydratedStorageScope` still `null` → **the provider commits `null`, unmounting the entire tree**; the effect then remounts it under a new `key`.

This interacts badly with `SSR-01`. 21 page files dropped `dynamic(..., {ssr: false})` so the tree now server-renders — and then React throws that render away one commit later. That is strictly worse than the `ssr:false` it replaced: same blank-then-content flash, plus new server CPU, plus a full remount that re-fires every mount-time data-fetching effect (SEC/EDGAR, `/api/*`) **twice per page load**.

Masked in tests because `setup.ts:66-71` starts with `isLoaded: true`, so the null-render step never occurs in the harness.

**Simpler and better:** drop the key-based remount entirely. The load-on-scope-change effect plus the existing write-gate already solve the per-identity storage problem without unmounting.

Related: `AppState.tsx:169` calls `setActiveBrowserStorageScope(storageScope)` as a **side effect during render**, which React's concurrent renderer may execute for renders it discards.

### B2. The SEC proxy lost its shared upstream cache (HIGH)

HEAD fetched with `next: { revalidate: 3600 }` — a deployment-wide cache shared across all users. The rewrite hardcodes `cache: 'no-store'` (`sec-upstream.ts:234`) and returns `Cache-Control: private, max-age=…`. This proxy fronts multi-MB `companyfacts` payloads and every EDGAR Archives document. **One upstream fetch per hour per resource became one per user per 5 minutes.** Given SEC's fair-access policy, this is the most likely thing to break in production first.

### B3. Migration 010 drops a deliberate 300s statement timeout

`003_urc_enrichment_helpers.sql:3-6` exists *solely* to raise `urc_thread_letters()` to `300s`, with a comment saying the 500K-row window scan exceeds the role default. `010:35-38` rewrites the function with `CREATE OR REPLACE`, which replaces the entire SET-clause list — only `search_path` survives. The function now does strictly *more* work (an extra partitioned window at `010:39-58`) with the default timeout restored. Migration 009 got this right by using additive `ALTER FUNCTION`; 010 is the one that regressed.

### B4. Migration 010 replaces the fetch-queue index with one that defeats its own `ORDER BY`

The old index (`002:26-27`) was `(date_filed desc)` — an exact ordering match. 010 drops it (`:17`) and leads with `content_next_retry_at`, so Postgres cannot walk it in `date_filed desc` order and must scan the full partial index and sort, on a ~450–500K row corpus.

### B5. The Copilot prompt declares a population it doesn't supply

`ResultsToolbar.tsx:67-72` builds `data.slice(0, 20)` but writes *"Analyze these ${data.length} results"* and then *"based only on this immutable result snapshot."* No production view passes `copilotPrompt`, so this is the path all nine call sites take. With 137 loaded results the model is told the 20 rows it sees are the population, and states "patterns and outliers" over 117 rows it never saw. Same defect class as `AI-02`, which this remediation claims to have closed.

**Also worth fixing:** `COPILOT-01`'s queue uses `slice(-10)`, which discards the **oldest** pending prompts while still returning a success id to the caller (`AppState.tsx:293-303`).

---

## C. Fixes where the feature was hidden rather than repaired

This was your third question, and it deserves a precise answer: **most of the deletions were legitimate — they removed things that never worked.** The adversarial pass killed several claims here, including the SEC Enforcement "relabel-only" claim (the parser was genuinely repaired), the ADV "reduced to link-outs" claim (it still returns live IAPD data), and the Elasticsearch/Vite deletions (verifiably dead code at the baseline).

What survives:

| # | Change | Assessment |
|---|---|---|
| C1 | **`/earnings` narrowed to EX-99.1 exhibits only.** HEAD honored the user's form selection and returned 8-Ks unfiltered. Now `EarningsTranscripts.tsx:74-92` defaults to `['EX-99.1']` and hard-filters every result; a plain 8-K selection falls through to that default (`filingResearch.ts:322-332`), and the only form options offered are 8-K/8-K/A/6-K/EX-99.1, so there is no in-page bypass. **A user who tracked Item 5.02 officer changes or Item 1.01 agreements here can no longer do so.** The narrowing is documented and users are redirected to the Research Workbench — but this is a product decision that arrived as an audit side effect. |
| C2 | **Comment-letter AI summaries: automatic → manual click.** HEAD's GET generated on cache miss; the new GET returns 404 with *"Generate it with an authenticated POST"* (`letters/summary/route.ts:165-168`). Defensible — the job makes up to 11 sequential model calls — and it has a real regression test. But it is a behavior downgrade unrelated to the stated defect (threads merging), booked as part of the fix. |
| C3 | **Open Graph / social card generation deleted.** `api/og/route.tsx` and `company/[ticker]/opengraph-image.tsx` removed, `@vercel/og` dropped — while `layout.tsx:20-23` still declares `card: 'summary_large_image'`. Every shared link now renders an empty preview card with a large blank image slot reserved. A working feature killed for a privacy concern that scoping (public routes only) would have solved. |
| C4 | **Comment letters now require a signed-in, entitled identity.** `letters/route.ts:31-32` adds `requireApiAccess()` where HEAD had none. Correct posture, but browsing the letter corpus went from public to entitlement-gated with no note in the doc. |
| C5 | **Support Center dropped ADV Registrations** — both the guide step and the nav link — even though the route is live and working. Collateral damage from the copy purge. |
| C6 | **The four landing hero panels relabeled "Illustrative."** Legitimate honesty fix (the panels were static), but its only test is `expect(landingSource.match(/Illustrative /g)).toHaveLength(4)` — a file-wide string count that passes if a fifth unlabeled fake card is added, as long as one label appears twice. |

**The broader point:** `SUPPORT-01` and `APIUI-01` removed roughly a dozen product claims from marketing and help copy. Each individual removal is honest. Collectively they are a list of capabilities the product promised and **nobody rebuilt** — that list should be a roadmap input, not a closed audit row.

---

## D. Over-engineering

The remediation added ~16k lines. Most is proportionate. These are not:

| # | Item | Cost | Simpler |
|---|---|---|---|
| D1 | **The entire faceted-search path in `/api/es-search` is dead.** `route.ts:226` gates ~120 lines on `auditor \|\| sicCode`, but `buildEnrichedSearchParams` (`filingResearch.ts:965-985`) no longer returns either — they were deleted from the returned object. The 1000-candidate scan, the 422 window error, and the global concurrency lease have **no production caller**; only `esSearchRoute.test.ts` exercises them, giving false confidence about the path users actually take. | ~120 lines + misleading tests | Delete the branch, or re-enable it as the fast path and drop the client-side SIC hydration — but not both. |
| D2 | **Four-tier concurrency config for one caller that sets every tier to 1.** `acquireResourceConcurrency` supports user/org/ip/global limits; its single caller (`es-search/route.ts:312-319`) passes `1` for all four. With `globalLimit: 1` the other three scopes are unreachable — each costs a `zremrangebyscore`+`zadd`+`expire`+`zcard` round-trip that can never deny anything. | ~40 lines + 3 needless KV round-trips per search | One `acquireGlobalLease(operation, ttl)`. |
| D3 | **`acquireAiConcurrency` and `acquireResourceConcurrency` are near-identical 55-line copies.** `rate-limit.ts:302-322` and `:365-385` are byte-identical except a log string. | ~55 lines, silent divergence risk | One helper; the two exports become ~15 lines each. |
| D4 | **The bounded streaming body reader is implemented twice.** `ai-input.ts:50-101` and `sec-upstream.ts:251-306` are the same algorithm line-for-line — including the subtle double-check of the `cancellation` flag inside both the loop and the catch. This is the trickiest code in the remediation (stream cancellation races), duplicated. | ~50 lines | One `readStreamWithLimit(body, opts)`; callers supply the error factory. |
| D5 | **The Rulemaking tab issues up to 51 proxied SEC fetches per load** (`officialSources.ts:132-151`) to scrape one regex field, each downloading up to 25 MB and running full server-side sanitization against a 180-request user budget. Three interactions nearly exhaust it, degrading unrelated pages. The payoff is one column that renders `—` whenever the regex misses. | ~150 requests per 3 loads | Fetch the effective date lazily on row expand, or drop the column. |
| D6 | Minor: `buildWatchlistAnalytics` runs twice over identical inputs per watchlist change (`Dashboard.tsx:89, 93-99`); `shouldRethreadLetters` is a one-line single-caller helper with a tautological test; several rate-limit call sites pass options identical to the function's own defaults. | | |

Also worth noting: `sanitizeSecHtml` runs synchronously over up to 25 MB fully buffered in the request handler — chunks + concatenated copy + UTF-16 JS string puts peak resident memory well over 100 MB for one large 10-K.

---

## E. The test evidence is weaker than the audit implies

The audit's central evidence is "626 tests passed." They do pass — in **3.58 seconds across 58 files**, which is not possible for a suite that exercises much real behavior.

The census: roughly **21 of ~157 `it`-blocks assert on source text or config constants** rather than behavior. That's a minority, and most new tests are genuinely behavioral (`esSearchRoute.test.ts`, `filingResearchExecution.test.ts`, `supabaseWeb.test.ts`, `officialSources.test.ts` are real). But the weak ones cluster on exactly the findings that most need proof:

- **`rateLimit.test.ts`** — 5 of 8 tests are `readFileSync` + `indexOf` over route source. `:52-61` asserts `indexOf('reserveAiTokenBudget(') > indexOf('acquireAiConcurrency(')` — **textual position, not execution order**. `:79` asserts `ai-runtime.ts` contains the literal `AI_MODEL_CALL_TIMEOUT_MS = 165_000`, i.e. greps a file for its own declaration; it would pass if `createAnthropicClient` were never called. A real assertion (`expect(createAnthropicClient('k').timeout).toBe(165_000)`) was one line away. Cited as evidence for `API-01`, `API-03`, and `LETTERS-01`.
- **`productCopyTruth.test.ts`** — the sole test for `APIUI-01` and `SUPPORT-01`. Every assertion is a substring check on view source. A marketing-string blacklist cannot distinguish "the feature works" from "the feature is gone and the sentence was deleted."
- **`migrationSecurity.test.ts`** — two of three assertions grep `.sql` text; the grants are never executed. (The third, which walks `src/` for service-key usage, is real and load-bearing.)
- **`systemPrompts.test.ts`** — asserts the prompt contains the exact phrases that were added to it. String-echo.
- **`filingDetailHooks.test.tsx:32`** mocks `useSearchParams` to an always-empty `URLSearchParams` with no per-test override — so every `VIEWER-01` path (highlight terms, `returnTo`, session restore) takes the no-op branch in all six tests. Deleting the highlight effect entirely would not fail this suite. This same file is also cited as the regression evidence for `MOBILE-02`, which it does not mention at all.
- **`dataTableSemantics.test.tsx:27-31`** never clicks anything and never asserts `aria-sort`, the sort button, or the paging labels — the entire `A11Y-01` fix.

**14 audit rows cite no test file at all**, several substituting "full UI suite" or a manual browser pass — including `MOBILE-01`, `MOBILE-03`, `THEME-01`, `A11Y-03`, and `A11Y-06`. And `secApi.test.ts` is cited for `SOURCE-05`/`SOURCE-06` but contains no assertions on document types.

---

## F. Places where the audit doc misstates what the code does

Worth correcting so the next reviewer doesn't inherit them:

1. `INDEX-01` — "reports request/parse failures" — it still returns `[]` (§A3).
2. `ESG-02` — "clearly labeled built-in topic mapping" — the mapping block is byte-identical to HEAD (§A5).
3. `SOURCE-05` — "exact exhibit document types are **requested**" — they are post-filtered client-side (§A4).
4. `SEARCH-01` — "Assisted mode is **relabeled**" — the UI label string is byte-identical before and after; no relabeling occurred (and no vector retrieval ever existed, so nothing was lost).
5. `ACCOUNTING-01` — "curated official ASC/**ASU** sources" — `accountingTopics.ts` contains only 20 ASC topic links; no ASU URL exists.
6. `EXPORT-01` — cites `filingExport.ts` / `docExport.ts` / `docExport.test.ts` for CSV injection; neither file contains any CSV code. (The actual fix in `utils/csv.ts:10` is complete and correct.)
7. `MOBILE-02` — cites a test file containing zero drawer assertions.

---

## G. What genuinely holds up

For balance — these were attacked and survived:

- **`AUTH-01`**: HEAD had no middleware at all. All ten non-public handlers enforce `requireApiAccess` in the handler body, not just at the proxy. The 503 is a genuine fail-closed guard, not a disabled feature.
- **`EXPORT-01`**: complete and correct.
- **`SEC-01` SSRF allowlist / iframe sandbox**: every real call site traced; `allow-same-origin` preserves anchor navigation; the image transform is a net improvement.
- **`SEARCH-01/02/03`**: Boolean AND/OR/NOT/proximity genuinely validated against real filing text; paging strides by rows actually returned; `gte` vs exact propagated; secondary SIC codes preserved end-to-end with a real EDGAR-submissions fallback.
- **`SOURCE-02/03/04`**: real data-source fixes. HEAD searched EDGAR for `RW,RW WD` and `CORRESP,UPLOAD,NSAR` — genuinely wrong sources — now replaced with real parsers over the correct SEC pages, failing loud on zero parses.
- **`AI-01`, `AI-04`**: the pre-fix behavior was fabrication and unprompted spend respectively; auto→manual is the correct fix, not a removal.
- **`DATASEC-01` grants**: every relation the web code touches is covered — verified by enumerating all Supabase access in `src/` against the migration.
- **`DEPS-01`**: `elasticsearch/` and `vite.config.ts` were verifiably dead at the baseline. Clean removal.
- **`ALERT-01`, `DOSSIER-01`, `LETTERS-02` (fidelity + cache staleness)**: genuinely fixed with real tests.

---

## Suggested order of work

**Before deploying:**
1. B2 — restore shared upstream caching on the SEC proxy (SEC fair-access risk).
2. B1 — remove the `AppState` remount gate (doubles all upstream calls on every page load).
3. B3 — re-apply the `300s` timeout to `urc_thread_letters()` with `ALTER FUNCTION`.
4. A1 — restore presentational attributes to the sanitizer allowlist (~6 lines).
5. Verify the new CI workflow actually passes — `npm run build` runs with no `env:` block under `NODE_ENV=production` with `ClerkProvider` in the root layout, and static routes prerender through it.

**Next:**
6. A2 — make the letters retry path actually reprocess PDF/no-text rows.
7. A4 — surface candidate-window coverage on the exhibit/earnings zero states.
8. B4 — fix the fetch-queue index ordering.
9. A5 — IAPD `nrows`, ESG mapping provenance, `SEARCH-04` copied-URL restore, `AI-02` coverage surfacing, `PRIV-02` storage migration.

**Product decisions to make explicitly, not inherit:**
10. C1 (8-K browsing removed from `/earnings`), C2 (manual summaries), C3 (social cards), C4 (letters now gated).
11. The list of capabilities removed from Support/Landing copy under `SUPPORT-01` — treat as roadmap, not as closed.

**Cleanup:**
12. D1–D5 (~300 lines and several needless round-trips).
13. Replace the source-text assertions in `rateLimit.test.ts`, `productCopyTruth.test.ts`, and `systemPrompts.test.ts` with behavioral ones; give `filingDetailHooks.test.tsx` per-test `useSearchParams` overrides so `VIEWER-01` is actually covered.

---

## Bottom line

**Does it solve the issue?** Mostly yes — about 150 of the closures verified as genuine. Four do not deliver what the doc claims (`SEC-01` tables, `LETTERS-01` coverage, `INDEX-01`, `SOURCE-05/06`), and seven doc rows misdescribe the code.

**Is it over-engineered?** In places, and the pattern is consistent: duplicated infrastructure (three cases of the same algorithm written twice) and one substantial dead code path with tests that imply it's live.

**Is it a hidden-feature fix?** Largely no — the deletions were mostly of things that never worked, and the adversarial pass killed most claims in this category. But six changes did trade capability for correctness (§C), and none was flagged as a product decision. The one to watch is `/earnings`: general 8-K event browsing genuinely worked before and does not now.
