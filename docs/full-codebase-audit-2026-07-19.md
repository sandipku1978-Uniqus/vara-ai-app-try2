# Full codebase audit and remediation report

**Audit date:** 2026-07-19  
**Repository:** `vara-ai-app-try2` / package `comparable-ai`  
**Discovery baseline:** `main` at `190e5e1`  
**Corrected state:** current uncommitted working tree  
**Local application:** `http://localhost:3033`  
**Live application:** `https://uniqus-research.vercel.app`  
**Finding closure:** **74 of 74 registered findings closed in source**  
**Deployment closure:** **Pending — the Vercel URL still serves the pre-remediation release**

## Executive summary

The corrected codebase is now a credible release candidate at the source level. The audit originally found release-blocking authorization, untrusted-document, search-correctness, dependency, data-access, AI-evidence, product-truth, mobile, accessibility, and error-state problems. All 74 registered findings now have a checked closure below, with a concrete source location and verification reference. Follow-up sweeps also fixed live SEC parser drift, query coverage misreporting, duplicate IPO analysis, specialist-workspace false-zero states, ambiguous XBRL and filing-TOC failures, misleading marketing/help copy, and an oversized Next.js cache entry.

The website's strongest assets remain intact: broad SEC filing research, exact Boolean/proximity validation, a deep filing viewer, company dossiers, XBRL comparisons, PCAOB auditor data, comment-letter episodes, official regulation/no-action/litigation sources, exports, annotations, and evidence-grounded AI workflows. The automated suite is now 626 passing tests, the production build generates all 46 pages, lint and TypeScript are clean, and both full and production-only dependency audits report zero known vulnerabilities.

The largest remaining risk is operational rather than an unfixed code defect: **the live Vercel site has not been redeployed**. Production must receive live Clerk credentials and the existing research entitlement, the restricted Supabase web key, existing Anthropic and Vercel KV configuration, and migrations `009` and `010`. Until that happens, the live URL should be treated as the old audited build. The corrected production server deliberately returns `503` for protected pages and APIs when live Clerk configuration is absent; public pages remain available.

### Biggest issues, in present order

1. **Release drift:** Vercel is still running the vulnerable/inaccurate pre-remediation build.
2. **Deployment configuration:** the corrected build fails closed until existing Clerk, Supabase, Anthropic, and KV values are configured correctly.
3. **Database rollout:** least-privilege ACL/RLS and comment-letter integrity changes require migrations `009_web_role_security.sql` and `010_comment_letter_integrity.sql`.
4. **Data reconciliation:** comment-letter review identities, retry state, searchable-text coverage, and summaries need the existing backfill/reconciliation job after migration.
5. **Ongoing source operations:** official SEC page parsers and AI outputs require monitoring and source review even though current contracts and failure states are now explicit.

### Priority implementation and deployment order

| Order | Action | Acceptance condition |
|---:|---|---|
| 1 | Configure the existing production integrations | Live Clerk publishable/secret keys, `CLERK_RESEARCH_FEATURE`, `URC_SUPABASE_URL`, restricted `URC_SUPABASE_WEB_KEY`, Anthropic key/model/budgets, KV URL/token, site URL, and SEC contact identity are present. |
| 2 | Apply database migrations | Apply `008` where needed, then `009_web_role_security.sql` and `010_comment_letter_integrity.sql`; confirm `urc_web` grants/RLS and service-role-only maintenance RPCs. |
| 3 | Deploy the corrected tree to Vercel | Build completes, public routes return 200, anonymous protected routes return Clerk auth rather than content, and unauthorized entitlements return 403. |
| 4 | Run existing reconciliation/backfill workflows | Comment-letter identity reconciliation, text retry/backfill, coverage statistics, and summary regeneration complete without overlapping leases. |
| 5 | Run post-deploy acceptance | Exercise search exactness/coverage, hostile SEC markup, filings, exports, comment threads, official-source parsers, AI error states, mobile navigation, and both themes. |
| 6 | Enable ongoing monitoring | Alert on parser zero-counts/drift, incomplete search coverage, comment-letter retry backlog, AI budget/capacity rejections, and protected-route authorization regressions. |

## No new external services are required

Every remediation uses infrastructure already represented in the project:

| Existing integration | Purpose after remediation |
|---|---|
| Clerk | Server authentication and user/org feature entitlement. Production requires live keys; no replacement identity provider is needed. |
| Supabase/Postgres | Existing application data plus the new internal `urc_web` least-privilege role. This role is configuration inside Supabase, not another service. |
| Vercel KV | Existing distributed rate limits, concurrency, budgets, leases, and summary caching. |
| Anthropic | Existing AI extraction/summarization, now authenticated, bounded, source-grounded, and explicit about evidence coverage. |
| SEC/PCAOB public endpoints | Existing authoritative filings, submissions, XBRL, rulemaking, staff guidance, no-action, litigation, IAPD, and auditor sources. |
| PostHog | Optional existing analytics only; it remains disabled unless explicitly enabled and consented. The product does not require it. |

## Verification record

| Gate | Result |
|---|---|
| Automated regression suite | ✅ `58` test files, `626` tests passed serially. |
| TypeScript | ✅ `npm run typecheck` passed. |
| ESLint | ✅ `npm run lint` passed with no findings. |
| Patch integrity | ✅ `git diff --check` passed. |
| Dependency audit | ✅ `npm audit --json`: 0 vulnerabilities; `npm audit --omit=dev --json`: 0 vulnerabilities. |
| Dependency tree | ✅ `npm ls --depth=0` exited successfully. Optional WASM support packages are reported by npm as extraneous platform artifacts but are not source dependencies or audit vulnerabilities. |
| Production build | ✅ Next.js `16.2.10`; compile/type/static generation passed; `46/46` pages generated. `/company/[ticker]` remains one-day ISR and no longer attempts to cache a 6 MB raw SEC payload. |
| Production fail-closed smoke | ✅ `/` and `/support` returned 200; `/dashboard` and `/api/stats` returned 503 with `Cache-Control: no-store` when live Clerk keys were intentionally absent. |
| Crawler contract | ✅ `robots.txt` disallows APIs and protected products; `sitemap.xml` contains only `/`, `/support`, `/privacy`, and `/terms`. |
| Local browser/mobile | ✅ 390 px landing/support had `scrollWidth === innerWidth`; drawer focus/body lock/Escape restore and command-palette focus containment/restore passed. |
| Browser console | ✅ Fresh landing and support tabs produced no error logs. Earlier duplicate-key and transient compile errors did not recur after fixes. |
| Theme | ✅ Light/dark selection, tokenized surfaces, and pre-hydration preference behavior were exercised. |
| Official-source live probes | ✅ Rulemaking (43), staff guidance (9), CorpFin no-action (1,338), Investment Management no-action (70), Trading & Markets no-action (714), and litigation-release rows (100/100) parsed during the audit. |
| Live Vercel comparison | ⚠️ Still the old build at audit close; deployment is intentionally not performed by this report. |

## P0 release blockers — all closed in source

| Finding | Closure | Source and regression evidence |
|---|---|---|
| ✅ AUTH-01 — Authentication and entitlements were not enforced | Added one explicit public allowlist, Clerk server proxy protection, per-API identity/feature enforcement, and a production live-key/feature guard that fails closed. | `src/proxy.ts`; `src/lib/clerk-config.ts`; `src/lib/api-auth.ts`; `src/config/routes.ts`; `src/__tests__/apiAuth.test.ts`. |
| ✅ SEARCH-01 — Boolean/NOT/proximity and “semantic” claims were unreliable | Candidate retrieval is now separate from deterministic filing-text validation; AND/OR/NOT/phrases/proximity and text-dependent predicates are checked before display. Assisted mode is labeled deterministic Filing Research, not vector/semantic retrieval. | `src/services/filingResearch.ts`; `src/utils/booleanSearch.ts`; `src/views/SearchPage.tsx`; `src/__tests__/filingResearchExecution.test.ts`; `filingResearch.test.ts`. |
| ✅ SEARCH-02 — Pagination, caps, and totals were inconsistent | Client/server share 100-row paging; offsets advance by returned rows; bounded retries/deadlines apply; exact versus `gte`, examined/upstream counts, and incomplete coverage are surfaced. | `src/app/api/es-search/route.ts`; `src/services/secApi.ts`; `src/services/searchCoverage.ts`; `src/__tests__/esSearchRoute.test.ts`; `searchCoverage.test.ts`; `secApi.test.ts`. |
| ✅ SEARCH-03 — SIC filtering removed valid filings | All EFTS SIC values are retained/normalized and checked; missing enrichment can fall back to official EDGAR submissions instead of converting valid results to zero. | `src/app/api/es-search/route.ts`; `src/services/filingResearch.ts`; `src/__tests__/esSearchRoute.test.ts`; `filingResearchExecution.test.ts`. |
| ✅ SEC-01 — Active SEC HTML ran as same-origin application content | SEC origins/paths/queries/redirects are allowlisted; content type, timeout, size, sanitization, CSP, and response headers are enforced; filing iframes are sandboxed and external opening is isolated. | `src/lib/sec-upstream.ts`; `src/app/api/sec-proxy/route.ts`; `src/app/api/sec-efts/route.ts`; `src/views/FilingDetail.tsx`; `src/__tests__/securityHardening.test.ts`. |
| ✅ SEC-02 — Print/export preserved executable markup | Filing and document export use strict sanitization, strip event/SVG/script hazards, neutralize popup openers, and isolate generated windows. | `src/services/filingExport.ts`; `src/services/docExport.ts`; `src/__tests__/filingExport.test.ts`; `docExport.test.ts`; `securityHardening.test.ts`. |
| ✅ DEPS-01 — Production dependencies had critical vulnerabilities | Vulnerable/retired packages and obsolete Vite/Elastic tooling were removed; Next, Clerk, SDKs, sanitizer, test/lint stack, overrides, lockfile, and pinned CI actions were updated. | `package.json`; `package-lock.json`; `.github/workflows/ci.yml`; final full/prod npm audits both 0. |

## P1 high-priority findings — all closed in source

### Security, privacy, data, and capacity

| Finding | Closure | Source and regression evidence |
|---|---|---|
| ✅ API-01 — AI endpoints were anonymous and weakly bounded | All AI routes require identity/entitlement, strict payload schemas and size bounds; Anthropic has a bounded timeout/no SDK retry; per-user/org concurrency, rate, and token budgets are distributed and fail closed in production. | `src/app/api/{claude,compare,enrich,stream}/route.ts`; `src/lib/ai-input.ts`; `ai-runtime.ts`; `rate-limit.ts`; `src/__tests__/aiInput.test.ts`; `apiQuery.test.ts`; `rateLimit.test.ts`; `aiCapacityOrder.test.ts`; `aiApi.test.ts`. |
| ✅ API-02 — Cron auth failed open and precompute was a placeholder | Placeholder cron is retired with 410; scheduled workflows use explicit secrets/concurrency and no false success marker is exposed as product functionality. | `src/app/api/cron/precompute/route.ts`; `.github/workflows/data-refresh.yml`; `.github/workflows/letters-backfill.yml`; `src/__tests__/apiAuth.test.ts`. |
| ✅ DATASEC-01 — Web routes used broad Supabase service-role access | Production web reads use restricted `urc_web`; service-role access is limited to ingestion/maintenance; ACLs, RLS, view security, RPC execution, default privileges, and function search paths are explicit. | `src/lib/supabase-web.ts`; `db/migrations/008_current_auditors_materialized.sql`; `009_web_role_security.sql`; `010_comment_letter_integrity.sql`; `src/__tests__/migrationSecurity.test.ts`; `supabaseWeb.test.ts`. |
| ✅ API-03 — Public proxy/search routes lacked resource controls | Authentication, upstream allowlists, redirect checks, timeouts, byte caps, paging/deadlines, retry/backoff, and bounded heavy EFTS concurrency were added. | `src/lib/sec-upstream.ts`; `src/app/api/{sec-proxy,sec-efts,es-search}/route.ts`; `src/lib/rate-limit.ts`; `src/__tests__/securityHardening.test.ts`; `esSearchRoute.test.ts`; `rateLimit.test.ts`. |
| ✅ PRIV-01 — Queries/prompts lacked an adequate privacy boundary | Analytics is opt-in, manual, and path-only; product/privacy copy describes AI and browser-local data; prompts are authenticated and caches are scoped/TTL-bound. | `src/components/providers/PostHogProvider.tsx`; `src/config/analytics.ts`; `src/app/privacy/page.tsx`; `src/lib/api-auth.ts`; `src/__tests__/AppState.test.tsx`; `securityHardening.test.ts`. |
| ✅ PRIV-02 — Browser data crossed Clerk identities | Storage keys and cached research state are identity-namespaced, migrated safely, TTL-bound, and cleared/reloaded when the active identity changes. | `src/services/storageNamespace.ts`; `researchSessions.ts`; `src/context/AppState.tsx`; `src/__tests__/researchSessions.test.ts`; `AppState.test.tsx`. |
| ✅ AISEC-01 — Untrusted filing text occupied privileged prompt context | Source evidence is delimited and labeled untrusted; instructions forbid following document commands; planner actions are schema-validated and unknown/save mutations are dropped. | `src/lib/systemPrompts.ts`; `src/services/agentPlanner.ts`; `src/types/agent.ts`; `src/__tests__/systemPrompts.test.ts`; `agentPlanner.test.ts`. |
| ✅ EXPORT-01 — CSV formula injection was possible | Every CSV/export path neutralizes spreadsheet formula prefixes and hostile cells before download. | `src/utils/csv.ts`; `src/services/filingExport.ts`; `docExport.ts`; `src/__tests__/filingExport.test.ts`; `docExport.test.ts`; `securityHardening.test.ts`. |

### Data coverage, official sources, and error truth

| Finding | Closure | Source and regression evidence |
|---|---|---|
| ✅ LETTERS-01 — Only a small fraction of comment letters was searchable | Fetching now uses a 90-day overlap, bounded retries/backoff/next-attempt state, source identifiers, leases/deadlines, exact coverage statistics, and reconciliation/backfill instructions. | `data-pipeline/fetch-letter-text.ts`; `db/migrations/010_comment_letter_integrity.sql`; `data-pipeline/README.md`; `src/__tests__/letterExtraction.test.ts`; `rateLimit.test.ts`. |
| ✅ LETTERS-02 — Threading/summaries could merge reviews or omit resolution | Review identity uses referenced accession or file/subject keys before date fallback; summaries cover the complete hierarchical letter set with input coverage, consented POST generation, and lease protection. | `db/migrations/010_comment_letter_integrity.sql`; `src/services/commentLetterSummary.ts`; `src/app/api/letters/summary/route.ts`; `src/__tests__/commentLetterSummary.test.ts`; `commentLetterSummaryConsent.test.tsx`; `commentLetterDeepLink.test.ts`. |
| ✅ SOURCE-01 — ADV queried issuer EDGAR instead of adviser data | ADV is now an authoritative IAPD/IARD reference/search workflow with its source limitation stated. | `src/services/officialSources.ts`; `src/views/ADVRegistrations.tsx`; `src/__tests__/officialSources.test.ts`. |
| ✅ SOURCE-02 — Regulation mapped rules/guidance to issuer filings | Securities Regulation now parses official SEC rulemaking and current staff-guidance pages with independent failures. | `src/services/officialSources.ts`; `src/views/SecRegulation.tsx`; `src/__tests__/officialSources.test.ts`. |
| ✅ SOURCE-03 — No-Action returned issuer comment correspondence | Dedicated CorpFin, Investment Management, and Trading & Markets official sources are parsed independently, including bounded legacy chronology handling. | `src/services/officialSources.ts`; `src/views/NoActionLetters.tsx`; `src/__tests__/officialSources.test.ts`. |
| ✅ SOURCE-04 — Enforcement parser drifted | The product is correctly scoped/labeled as SEC Litigation Releases and parses the current release index; it does not claim administrative/trading-suspension coverage. | `src/config/enforcement.ts`; `src/services/officialSources.ts`; `src/views/SECEnforcement.tsx`; `src/__tests__/enforcementScope.test.ts`; `officialSources.test.ts`. |
| ✅ SOURCE-05 — Exhibit filtering/labels used parent filing types | Exact exhibit document types are requested, retained, displayed, and separated from parent form metadata. | `src/views/ExhibitSearch.tsx`; `src/services/filingResearch.ts`; `src/__tests__/specialistDocumentSearch.test.ts`; `secApi.test.ts`. |
| ✅ SOURCE-06 — Earnings offered a document type then excluded it | Earnings is explicitly EX-99.1 release-document research and accepts the correct 8-K, 8-K/A, and 6-K parent forms. | `src/config/earnings.ts`; `src/views/EarningsTranscripts.tsx`; `src/__tests__/specialistDocumentSearch.test.ts`; `secApi.test.ts`. |
| ✅ ERROR-01 — Failures were rendered as legitimate zero results | Search, official sources, company facts, comment threads, IPO, M&A, Form D, filing metadata/TOC/redline, and AI summaries now distinguish loading, unavailable, partial, error, and true empty states with retries where useful. | `src/views/{SearchPage,AccountingAnalytics,ExemptOfferings,MAResearch,FilingDetail,ESGResearch}.tsx`; `src/__tests__/specialistFailureStates.test.tsx`; `accountingAnalyticsFailures.test.tsx`; `filingDetailHooks.test.tsx`; `esgSummaryError.test.tsx`. |

### AI and workflow correctness

| Finding | Closure | Source and regression evidence |
|---|---|---|
| ✅ AI-01 — ESG summaries were generated without filing content | The selected 8-K source document is fetched first; no summary runs without evidence; source/selected character coverage and retryable errors are visible. | `src/views/ESGResearch.tsx`; `src/utils/filingTextSelection.ts`; `src/__tests__/esgSummaryError.test.tsx`; `filingTextSelection.test.ts`. |
| ✅ AI-02 — Whole-document analyses saw only the first prefix | Evidence selection samples beginning, relevant spans, and ending within a bound and returns complete/source/selected coverage; prompts and UI prohibit exhaustive claims when text is omitted. | `src/utils/filingTextSelection.ts`; `src/services/aiApi.ts`; `src/lib/systemPrompts.ts`; `src/__tests__/filingTextSelection.test.ts`; `aiApi.test.ts`. |
| ✅ AI-03 — Redline summaries could confidently infer unsupported facts | Redline analysis is strict: source failures/invalid outputs throw, are not cached as success, and appear as retryable UI errors with source review language. | `src/services/filingDetailTools.ts`; `src/views/FilingDetail.tsx`; `src/__tests__/filingDetailTools.test.ts`; `filingDetailHooks.test.tsx`. |
| ✅ AI-04 — Auto summaries spent unexpectedly and hid errors | Result summaries are user-triggered, bounded, show busy/error state, retain deterministic result statistics on failure, and label the fallback rather than presenting it as AI output. | `src/components/tables/AIResultsSummary.tsx`; `src/services/searchTrendReport.ts`; `src/__tests__/aiResultsSummary.test.tsx`; `searchTrendReport.test.ts`. |
| ✅ COPILOT-01 — Per-row Ask Copilot never executed | External prompts enter a real AppState queue consumed by the mounted panel executor; state and errors resolve instead of leaving a phantom run. | `src/context/AppState.tsx`; `src/components/AIQnAPanel.tsx`; `AskCopilotButton.tsx`; `src/__tests__/copilotQueueIntegration.test.tsx`. |
| ✅ COPILOT-02 — ResultsToolbar dropped supplied context | Toolbar preserves the caller prompt plus an immutable result snapshot and queues the actual context for Copilot. | `src/components/tables/ResultsToolbar.tsx`; `src/context/AppState.tsx`; `src/__tests__/copilotQueueIntegration.test.tsx`. |
| ✅ SEARCH-04 — Incoming `?q=` lost to an old session | External route intent has precedence, can address a preferred session, restores filters/mode, and handles stale session IDs deterministically. | `src/services/researchSessions.ts`; `src/views/SearchPage.tsx`; `src/__tests__/researchSessions.test.ts`. |
| ✅ SEARCH-05 — Filter-only searches silently did nothing | A shared criteria predicate supports queryless browse/filter execution; Search and Accounting pass filters consistently and saved alerts retain them. | `src/services/filingResearch.ts`; `src/services/researchSessions.ts`; `src/views/{SearchPage,AccountingHub}.tsx`; `src/__tests__/filingResearchExecution.test.ts`; `alertRoutes.test.ts`. |
| ✅ ALERT-01 — Opening an alert lost most criteria | Alert route serialization/deserialization round-trips query, mode, every supported filter, and explicit overrides; Dashboard uses that contract. | `src/services/alertRoutes.ts`; `src/views/Dashboard.tsx`; `src/__tests__/alertRoutes.test.ts`; `researchSessions.test.ts`. |
| ✅ VIEWER-01 — Return/highlight/redline support was unreachable or silent | Search sends durable route/session metadata and highlight terms; Filing Detail restores context, highlights terms, handles prior-filings explicitly, and keeps hooks unconditional. | `src/services/researchSessions.ts`; `src/views/{SearchPage,FilingDetail}.tsx`; `src/services/filingDetailTools.ts`; `src/__tests__/filingDetailHooks.test.tsx`; `filingHighlights.test.ts`; `researchSessions.test.ts`. |
| ✅ ESG-01 — Effects could repeat expensive SEC/AI work | Requests are event/state driven with stable dependencies, per-company coverage, isolated errors, and no self-triggering result dependency. | `src/views/ESGResearch.tsx`; `src/__tests__/esgSummaryError.test.tsx`; full React regression suite. |
| ✅ ESG-02 — Policy tracker was hard-coded and time-sensitive | Static status claims were replaced by official framework links and a clearly labeled built-in topic mapping; live claims come from selected filing evidence. | `src/lib/framework-context.ts`; `src/views/ESGResearch.tsx`; `src/lib/systemPrompts.ts`; `src/__tests__/systemPrompts.test.ts`. |
| ✅ DASH-01 — Dashboard overstated the measured population | Analytics are explicitly watchlist scoped; missing companies remain unavailable/null rather than zero; charts and copy state the actual population. | `src/services/dashboardAnalytics.ts`; `src/views/Dashboard.tsx`; `src/__tests__/dashboardAnalytics.test.ts`. |
| ✅ IPO-01 — Capped filing feed was mixed with static market intelligence | Correct IPO forms are used; authoritative total and loaded 100-row window are separate; metrics derive from loaded sources; monitors are explicitly local/manual; per-section analysis reports errors. | `src/views/IPOCenter.tsx`; `src/services/secApi.ts`; `src/__tests__/ipoResearch.test.ts`; `secApi.test.ts`. |
| ✅ APIUI-01 — API Portal was a first-class mock surface | The fake portal route, styles, navigation, landing claims, and fictitious production indicators were removed. | Deleted `src/app/api-portal/*` and `src/views/APIPortal*`; `src/config/routes.ts`; `src/views/LandingPage.tsx`; `src/__tests__/productCopyTruth.test.ts`. |
| ✅ ACCOUNTING-01 — Standards search/checklist were facades | Standards topics now link to curated official ASC/ASU sources; filing search is real; the editable checklist persists in the current browser. | `src/config/accountingTopics.ts`; `src/views/AccountingHub.tsx`; `src/__tests__/accountingTopics.test.ts`; `filingResearchExecution.test.ts`. |
| ✅ SUPPORT-01 — Documentation exceeded implementation | Support and landing copy now describe exact filters, local-only state, watchlist scope, real IPO/M&A/ESG/board/insider/dossier fields, official-source limits, AI source review, and illustrative previews. | `src/views/SupportCenter.tsx`; `src/views/LandingPage.tsx`; `src/__tests__/productCopyTruth.test.ts`. |

### Mobile and theme

| Finding | Closure | Source and regression evidence |
|---|---|---|
| ✅ MOBILE-01 — Mobile navigation control was inert | A real button opens a focus-managed drawer, locks body scroll, supports Escape/backdrop close, and restores trigger focus. | `src/components/layout/Layout.tsx`; `Layout.css`; final 390 px browser interaction. |
| ✅ MOBILE-02 — Filing tools disappeared below 900 px | Filing sidebar/tools are available through the responsive drawer/tabs instead of display-none removal. | `src/views/FilingDetail.tsx`; `FilingDetail.css`; `src/__tests__/filingDetailHooks.test.tsx`; mobile browser pass. |
| ✅ MOBILE-03 — Landing/workspaces overflowed or clipped | Responsive grids, intrinsic widths, table scrolling, and mobile controls were corrected; final landing/support had no horizontal overflow at 390 px. | `src/views/LandingPage.css`; shared/view CSS changes; final browser `scrollWidth === innerWidth`. |
| ✅ THEME-01 — Light theme was unreadable | Hard-coded dark surfaces and missing purple/background variables were replaced with shared tokens across pages, tables, dossier, M&A, and Disclosure Matrix. | `src/index.css`; view/component CSS; `src/components/research/DisclosureMatrix.module.css`; lint/build and light/dark browser pass. |

## P2 medium-priority findings — all closed in source

### Accessibility and shared navigation

| Finding | Closure | Source and regression evidence |
|---|---|---|
| ✅ A11Y-01 — Shared DataTable lacked keyboard semantics and clipped | Sort controls, `aria-sort`, row interaction, named paging, captions/scopes, and horizontal scrolling are implemented. | `src/components/tables/DataTable.tsx`; `DataTable.css`; `src/__tests__/dataTableSemantics.test.tsx`. |
| ✅ A11Y-02 — Cards were mouse-only pseudo-links | Interactive Dashboard, ESG, M&A, Support, and specialist cards/rows use buttons or links with keyboard behavior. | Relevant `src/views/*.tsx`; `src/__tests__/internalNavigation.test.ts`; full UI suite. |
| ✅ A11Y-03 — Company typeaheads were not comboboxes | Company/auditor/SIC fields expose combobox/listbox/option relationships, active descendants, arrow/Escape handling, and named clear controls. | `src/components/filters/{CompanySearchInput,CompanyLookupField,AuditorLookupField,SicLookupField}.tsx`; full UI suite. |
| ✅ A11Y-04 — Comment Letters nested a link inside a button | Episode disclosure and external source navigation are separate semantic controls. | `src/views/CommentLetters.tsx`; `src/__tests__/commentLetterDeepLink.test.ts`. |
| ✅ A11Y-05 — Search tabs nested mouse-only close controls | Search uses tablist/tab/tabpanel semantics and separate labeled close buttons with keyboard behavior. | `src/views/SearchPage.tsx`; `src/__tests__/researchSessions.test.ts`. |
| ✅ A11Y-06 — Filter labels/states were incomplete | Labels, expanded state, removable-pill names, combobox relations, and control IDs are connected. | `src/components/filters/SearchFilterBar.tsx`; filter components; full UI suite. |
| ✅ A11Y-07 — AI insight/Copilot controls lacked names/state | AI controls are real named buttons with expanded, busy, and status semantics. | `src/components/tables/{AIResultsSummary,AskCopilotButton}.tsx`; `src/__tests__/aiResultsSummary.test.tsx`; `copilotQueueIntegration.test.tsx`. |
| ✅ PALETTE-01 — Command Palette was hidden and lacked a focus trap | A visible trigger, complete shared route registry, dialog/combobox/listbox semantics, true-tab-stop trap, Escape close, and focus restore are present. | `src/components/layout/{Layout,CommandPalette}.tsx`; `src/config/routes.ts`; `src/__tests__/commandPaletteFocus.test.ts`; final browser keyboard pass. |
| ✅ CONTEXT-01 — Copilot labeled many pages only “Workspace” | Navigation, palette, breadcrumbs, and Copilot context derive from the shared product route registry, including dynamic filing/company labels. | `src/config/routes.ts`; `src/components/layout/Layout.tsx`; `src/components/AIQnAPanel.tsx`. |
| ✅ BREADCRUMB-01 — Breadcrumbs hard-reloaded and had bad contrast | Internal breadcrumbs use Next `Link`, preserve client state, include navigation semantics, and use theme tokens. | `src/components/layout/Layout.tsx`; `src/app/company/[ticker]/page.tsx`; `src/__tests__/internalNavigation.test.ts`. |
| ✅ AUTHUI-01 — Auth-disabled mode showed a fake “JD” identity | The UI reports authentication unavailable or renders real Clerk signed-in/signed-out controls; no invented user remains. | `src/components/layout/Layout.tsx`; `src/lib/clerk-config.ts`; production fail-closed smoke. |
| ✅ SSR-01 — Pages disabled SSR and lacked route artifacts | Client views are imported normally; shared loading/error/not-found shells plus robots, sitemap, manifest, and filing metadata are present. | `src/app/loading.tsx`; `error.tsx`; `not-found.tsx`; `robots.ts`; `sitemap.ts`; `manifest.ts`; `src/app/filing/[...slug]/layout.tsx`; 46-page build. |
| ✅ META-01 — Metadata declared conflicting canonical hosts | One environment-driven canonical origin feeds metadata, Open Graph, robots, and sitemap; arbitrary protected OG data was removed. | `src/app/layout.tsx`; `src/config/routes.ts`; `src/app/{robots,sitemap}.ts`; `.env.example`; `src/__tests__/apiAuth.test.ts`. |
| ✅ ERRORUI-01 — Global error/404 recovery was weak and dark-only | Tokenized error/not-found pages expose retry, Home, and Support paths with appropriate route state. | `src/app/error.tsx`; `src/app/not-found.tsx`; `src/components/layout/RouteState.module.css`; production build. |
| ✅ PRIVUI-01 — Privacy/Terms were false destinations | Real public Privacy and Terms pages exist and footer links target them; crawler/public-route contracts include both. | `src/app/privacy/page.tsx`; `src/app/terms/page.tsx`; `src/views/LandingPage.tsx`; `src/config/routes.ts`; `src/__tests__/apiAuth.test.ts`. |
| ✅ LANDING-01 — Two landing implementations could drift | `src/app/page.tsx` now delegates to the single `LandingPage` implementation. | `src/app/page.tsx`; `src/views/LandingPage.tsx`; `src/__tests__/productCopyTruth.test.ts`. |
| ✅ THEME-02 — Theme flashed light before hydration | An inline pre-hydration script applies persisted/system preference before React paints; AppState then owns changes. | `src/app/layout.tsx`; `src/context/AppState.tsx`; `src/__tests__/AppState.test.tsx`. |

### Feature wiring and correctness

| Finding | Closure | Source and regression evidence |
|---|---|---|
| ✅ BOARD-01 — Nullable governance values rendered `null%`/bad widths | Nullable values render unavailable markers and bar widths are numeric/clamped only when valid. | `src/views/BoardProfiles.tsx`; full UI/type suite. |
| ✅ DOSSIER-01 — Comment episode links lost the selected episode | Dossier links carry `thread_id`; Comment Letters hydrates requested threads beyond the recent window, distinguishes lookup failure/not-found, expands, and scrolls. | `src/app/company/[ticker]/DossierTabs.tsx`; `src/views/CommentLetters.tsx`; `src/__tests__/commentLetterDeepLink.test.ts`. |
| ✅ IPO-02 — Run All used brittle DOM automation | A sequential analysis queue invokes functions directly, enforces max concurrency one, rejects overlap, and continues with per-section errors. | `src/views/IPOCenter.tsx`; `src/__tests__/ipoResearch.test.ts`. |
| ✅ CSS-01 — M&A/API styles used undefined tokens/utilities | M&A uses real design tokens; the API portal is removed; Disclosure Matrix uses a local CSS module instead of nonexistent utility classes; undefined purple variables are gone. | `src/views/MAResearch.css`; `src/components/research/DisclosureMatrix.module.css`; final token scan, lint, and build. |
| ✅ FILTER-01 — AdvancedFilterPanel was dead duplicate code | The unused component/styles were removed; one live filter contract remains. | Deleted `src/components/filters/AdvancedFilterPanel.{tsx,css}`; `SearchFilterBar.tsx`; full build. |
| ✅ CLIPBOARD-01 — Copy actions could lie or fail silently | Remaining copy action awaits success, reports rejection, and has no fake API Portal copy state. | `src/components/tables/ResultsToolbar.tsx`; removed API Portal; `src/__tests__/copilotQueueIntegration.test.tsx`. |
| ✅ PDF-01 — Working PDF memo export was unexposed | Benchmarking exposes the supported PDF/print memo export alongside document exports. | `src/views/Benchmarking.tsx`; `src/services/docExport.ts`; `src/__tests__/docExport.test.ts`. |
| ✅ INDEX-01 — `fetchFilingIndex()` always returned empty | Filing index parsing now extracts document metadata and reports request/parse failures instead of returning a fabricated empty list. | `src/services/secApi.ts`; `src/__tests__/secApi.test.ts`. |
| ✅ ALERT-02 — Local alerts were presented as scheduled monitoring | Dashboard/Search/Accounting/IPO/Support explicitly say alerts/monitors are browser-local, manual reruns with no background notifications. | `src/views/{Dashboard,SearchPage,AccountingHub,IPOCenter,SupportCenter}.tsx`; `src/__tests__/productCopyTruth.test.ts`; `alertRoutes.test.ts`. |
| ✅ ACCOUNTING-02 — Ratios used only ending balances | ROE, ROA, and asset turnover use average beginning/end balances when available with an explicit ending-balance fallback; current and D/E remain point-in-time and are disclosed. | `src/services/secApi.ts`; `src/views/AccountingAnalytics.tsx`; `src/__tests__/financialRatios.test.ts`. |
| ✅ FILING-01 — Conditional hooks could break route changes | FilingDetail hooks are unconditional; invalid route state renders after hook setup; route and iframe/metadata/TOC failures have explicit states. | `src/views/FilingDetail.tsx`; `src/__tests__/filingDetailHooks.test.tsx`. |
| ✅ ESG-03 — ESG controls were mouse-only and loading count was hard-coded | Controls use buttons/labels and dynamic per-company progress/coverage; AI failure does not masquerade as evidence. | `src/views/ESGResearch.tsx`; `src/__tests__/esgSummaryError.test.tsx`; full UI suite. |

## Additional residuals found and fixed during closure

These were discovered after the original register and were fixed before final verification:

| Residual | Resolution and evidence |
|---|---|
| Current SEC HTML structure changed after the first parser implementation | Added the current staff `.field--name-field-text` selector, bounded legacy no-action chronology parsing, and independent source requirements. `officialSources.test.ts` passed; live counts are in the verification table. |
| A degraded or deadline-interrupted search could publish a generic zero | Coverage now follows the actual text-validation stage; 45-second interruption is incomplete/degraded, and partial coverage overrides generic empty state. `filingResearchExecution.test.ts`, `searchCoverage.test.ts`, and route deadline tests pass. |
| IPO “Run all” could overlap or duplicate analysis | Replaced with a guarded sequential queue; `ipoResearch.test.ts` verifies concurrency, overlap suppression, and continuation. |
| Form D and M&A failures still resembled empty data | Recent versus search versus extraction failures have separate alerts/retries; AI deal/clause extraction throws on invalid output. `specialistFailureStates.test.tsx` and `aiApi.test.ts` cover them. |
| Trend, ESG summary, filing redline/metadata, and requested comment thread still had ambiguous failures | Each now has a discriminated error state and retry, and no failure is cached/rendered as evidence or not-found. Covered by `searchTrendReport.test.ts`, `esgSummaryError.test.tsx`, `filingDetailHooks.test.tsx`, and `commentLetterDeepLink.test.ts`. |
| Accounting Analytics silently skipped failed companies | Added ticker-specific total/partial XBRL coverage and retry; no zero-data conclusion is asserted. `accountingAnalyticsFailures.test.tsx` covers total and partial failure. |
| Filing section inspection failure looked like “no sections” | Waiting, unsupported XML, true no-sections, iframe load failure, and inspection failure are distinct; retry restores navigation without removing the filing. `filingDetailHooks.test.tsx` simulates a `SecurityError` then success. |
| Landing preview looked live and several help claims exceeded behavior | Static cards are labeled “Illustrative”; team/cross-device/context-preservation claims were removed; exact limits are now described. `productCopyTruth.test.ts` and final browser copy checks pass. |
| Landing matrix emitted duplicate React keys | Keys now include stable row position; a fresh browser tab has no duplicate-key error. |
| Crawler metadata exposed protected/arbitrary routes | One public-route registry drives proxy, sitemap, and robots; protected company OG generation was removed. `apiAuth.test.ts` and production smoke pass. |
| Large issuer submissions exceeded Next's 2 MB data-cache entry limit | The raw SEC response is uncached, projected to identity plus the 15 rendered filings, then cached for 24 hours; concurrent metadata/page calls dedupe. `issuerDossierCompanyData.test.ts` passes and the build retains one-day ISR with no oversized-cache warning. |
| Brand lockup emitted a one-axis image resize warning | Lockup CSS width and height now exactly match the calculated image attributes, preserving aspect ratio without rounding mismatch. `brandImageSizing.test.tsx` verifies both lockup axes and the compact square mark. |

## Current product assessment

| Area | Corrected state |
|---|---|
| Identity and authorization | Server-enforced, explicit public allowlist, feature entitlement, API defense in depth, production fail-closed. |
| Filing research | Deterministic Boolean/proximity/text filtering, normalized metadata, explicit pagination and coverage, durable sessions/alerts. |
| Filing viewer | Sandboxed/sanitized document boundary, highlights/back context, explicit metadata/TOC/redline errors, annotations/tables/exports, mobile tools. |
| Company dossier and XBRL | Arbitrary ticker/CIK, restricted auditor lookup, recent submissions, deep-linked letter episodes, financials, bounded 24h projected cache. |
| Comment letters | Retryable ingestion, exact coverage metrics, source-derived review identity, complete-summary coverage, leases/consent. |
| Official-source modules | IAPD reference, SEC rulemaking/staff guidance, three no-action corpora, current litigation releases, exact exhibits/earnings scope. |
| AI | Authenticated and capacity-bounded; untrusted evidence is isolated; selected-source coverage and failures are visible; human source review remains required. |
| Privacy | Identity-scoped browser state, explicit local-only behavior, consent-aware optional analytics, real policy pages. |
| Mobile/accessibility/theme | Working drawer and filing tools, semantic shared controls, focus management, responsive tables/layout, tokenized light/dark themes. |
| Engineering operations | 626 tests, clean type/lint/build/audit gates, current README/env docs, pinned CI, obsolete stacks removed. |

## Deployment prerequisites and post-deploy checks

1. Copy the documented variables from `.env.example` into the existing Vercel project using real production values. Do not expose `CLERK_SECRET_KEY`, `URC_SUPABASE_SERVICE_KEY`, Anthropic, or KV secrets to the client.
2. Apply migrations `009` and `010` in Supabase and provision/rotate a JWT whose `role` claim is `urc_web` for `URC_SUPABASE_WEB_KEY`.
3. Confirm `URC_SUPABASE_SERVICE_KEY` is present only in trusted ingestion/maintenance/release environments and, if enabled in Vercel, as a Sensitive server-only variable used solely by the three audited cache-writer routes. Production reads must use `URC_SUPABASE_WEB_KEY` without fallback.
4. Deploy, then verify anonymous, signed-in/unentitled, user-entitled, and org-entitled cases across every protected page and API.
5. Run comment-letter reconciliation/text backfill with the existing GitHub workflows or data-pipeline commands; verify retry backlog and `input_coverage` statistics.
6. Repeat the exact Boolean/NOT/proximity fixtures against live filings and verify incomplete/degraded coverage labels under upstream interruption.
7. Re-run hostile SEC HTML, export formula, prompt-injection, AI budget/concurrency, mobile drawer, command palette, both themes, and screen-reader smoke tests.
8. Confirm live product/help copy no longer exposes API Portal, broad enforcement, semantic/vector, scheduled monitoring, or team/shared-state claims.

## Limitations and accepted operating constraints

- Docker was unavailable in the audit environment, so migrations were inspected and regression-tested but not executed against a disposable local Supabase instance. Production migration application and rollback rehearsal remain operator steps.
- No deployment was authorized or performed. The live Vercel URL remains evidence of the old build until a new release is confirmed.
- The local environment intentionally lacks live Clerk production keys. This prevented an end-to-end entitled-user browser session, but production guard behavior, route contracts, and auth branches are covered by tests and the fail-closed server smoke.
- Privacy and Terms pages are functional product disclosures, not a substitute for counsel review or final operator/company details.
- SEC/IAPD page markup and upstream availability can change. Current parsers have independent errors/tests, but production should alert on zero counts and structural drift.
- AI outputs remain research assistance, not authoritative conclusions. The product now exposes source/coverage/failure state, but users must inspect source filings.
- Saved searches, watchlists, annotations, and monitors are deliberately same-browser individual state. Cross-device/team collaboration would be a separate future feature, not a missing dependency for this release.

## Final recommendation

**Code-level recommendation: go for deployment preparation.** All registered audit findings and closure residuals are fixed and verified in the current working tree.

**Live-release recommendation: no-go until the priority deployment actions and post-deploy checks above are completed.** The gating work does not require any new external service; it requires correct configuration and migration of services already in use, deployment of the corrected build, and post-deploy acceptance against the live environment.
