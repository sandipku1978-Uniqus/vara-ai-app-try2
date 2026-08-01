# Implementation Plan

## Engineering constraints

- Preserve all current useful features and available content.
- Do not introduce product behavior merely to satisfy a mock or simplify a refactor.
- Prefer existing configuration, types, and CSS/design tokens over new parallel systems.
- Use small pull requests with independently reviewable behavior and explicit rollback notes.
- Keep database authority least-privileged: browser-facing reads use the restricted web identity; privileged cache writes stay narrow and audited.
- Never describe a run as complete when any required Boolean branch is untested, any candidate document is unvalidated, or a retry/deadline/request cap interrupted the run.

## Work package 0 — Release provenance and diagnostics

**Objective:** make every subsequent fix testable against one immutable artifact.

**Primary areas**

- Vercel project/deployment configuration.
- `.github/workflows/ci.yml`
- `.github/workflows/accuracy-gate.yml`
- API error response helpers and server logging.

**Changes**

1. Disable automatic production promotion until the required checks are green.
2. Require unit, type, lint, production build, browser, security, and accuracy checks for the release branch.
3. Expose the source SHA in deployment metadata or a protected health/version endpoint; do not expose credentials or build environment values.
4. Give every search request a correlation ID and log route, RPC, database error code, elapsed time, outcome class, and candidate/validation counts.
5. Preserve typed upstream errors instead of flattening every database failure to a generic 502. At minimum distinguish permission failure (`42501`), statement timeout (`57014`), missing/stale RPC (`PGRST202`), rate limiting, invalid request, and unexpected failure.

**Tests**

- A deliberately failing required check cannot be promoted.
- Preview reports the expected SHA and deployment ID.
- Auditor/topic failures produce a stable public error class and a correlated private diagnostic without leaking SQL or credentials.

**Complete when**

- The candidate artifact is immutable, identifiable, and blocked from production until approval.
- An auditor/topic failure can be diagnosed from logs without guessing.

## Work package 1 — Supabase permission contract and auditor/topic 502 repair

**Objective:** repair the database contract before removing the fallback that currently masks permission problems.

**Primary areas**

- `db/migrations/003_anon_read_surface.sql`
- `db/migrations/010_web_role_security.sql`
- `db/migrations/011_comment_letter_integrity.sql`
- A new forward-only migration, expected next number `014` after rechecking migration order.
- `src/app/api/es-search/route.ts`
- `src/app/api/letters/route.ts`
- Auditor/current-auditor route handlers and their RPC/view dependencies.

**Changes**

1. Inventory the exact tables, views, materialized views, and RPC signatures used by every browser-facing read route.
2. Create a forward-only migration that expresses one authoritative least-privilege read contract for the publishable/anon or dedicated `urc_web` identity.
3. Grant only required schema usage, relation reads, sequence access if actually required, and execute privileges on exact RPC signatures.
4. Explicitly revoke writes, DDL, maintenance functions, ingestion RPCs, and unrestricted execution.
5. Verify the search functions use appropriate indexes and do not depend on an outdated PostgREST schema cache. Refresh schema exposure after applying the migration.
6. Run integration probes using the production web credential—not the service key—for auditor facet, topic letter search, ordinary filing search, required views, and denied writes.
7. Map known database failure classes to stable route responses. A temporary dependency outage may be 503; a permission or missing-RPC deployment defect must be surfaced distinctly in telemetry and must fail the release gate.

**Tests**

- Restricted web identity can read every required surface and execute every required read RPC.
- Restricted web identity cannot insert, update, delete, refresh materialized views, invoke ingestion/maintenance functions, or access unrelated schemas.
- Auditor and topic test sets return no application 5xx and meet latency thresholds.
- A migration/RPC signature mismatch produces a diagnosable failing test rather than a generic 502.

**Rollback**

- Roll back application promotion first. Do not destructively reverse a permission migration during an incident unless the exact security impact is understood.
- A corrective forward migration is preferred over modifying an already-applied migration.

**Complete when**

- The restricted credential supports all required reads and no prohibited mutations.
- Auditor/topic application 5xx rate is 0% in the acceptance corpus.
- Auditor p95 is under 5 seconds and topic p95 is under 2 seconds.

## Work package 2 — Remove production service-key fallback

**Objective:** make web-facing reads fail closed when least-privilege configuration is absent.

**Primary areas**

- `src/lib/supabase-web.ts`
- `src/__tests__/supabaseWeb.test.ts`
- `src/__tests__/migrationSecurity.test.ts`
- Vercel production/preview environment configuration.

**Changes**

1. Remove `webKey || serviceKey` from `getWebSupabase()` in production behavior.
2. Return a typed unavailable configuration outcome when the URL or allowed web key is missing/invalid; routes should return a safe 503 rather than silently escalating privilege.
3. Keep `getCacheWriterSupabase()` isolated for the existing filing-text cache write use case only. Do not use it as a read fallback.
4. Retain validation that rejects service-role or secret credentials supplied through `URC_SUPABASE_WEB_KEY`.
5. Add a source-level guard test that fails if a web route imports or initializes a service-role client outside the audited cache-writer boundary.
6. Provision the restricted key in preview first, run all route probes, then provision production.

**Tests**

- Missing production web key returns a safe 503 and never initializes a service client.
- A service/secret credential placed in the web-key variable is rejected.
- Local development behavior is explicit and tested; production semantics cannot depend on a warning-only fallback.
- Cache writes work only through the narrow writer and an unavailable writer degrades to SEC fetch without elevating read authority.

**Complete when**

- No browser-facing request can obtain service-role authority through configuration fallback.
- Required reads pass with the restricted key and forbidden writes fail.

## Work package 3 — Boolean compiler correctness

**Objective:** guarantee that every accepted Boolean expression has an executable plan with preserved meaning.

**Primary areas**

- `src/utils/booleanSearch.ts`
- `src/__tests__/booleanSearch*.test.ts`
- `src/__tests__/booleanOperatorParity.test.ts`
- `src/__tests__/auditorAnchoring.test.ts`
- Search UI parsing in `src/views/SearchPage.tsx`.

**Changes**

1. Compile and validate the complete expression before extracting structured filters.
2. Never silently remove an unsupported or unanchored OR branch. Reject it with a clear validation error and issue zero retrieval requests.
3. Normalize repeated negation correctly so polarity is based on parity (`NOT NOT A` is positive).
4. Parse `auditor:` with the same quote/group-aware syntax tree as other operands. Do not use a regex extraction that turns an OR into a global AND filter.
5. Define explicit behavior for wildcard-only, punctuation-only, malformed proximity, empty grouped terms, negative-only expressions, and unsupported structured-field placement.
6. Apply branch-complexity limits before exponential expansion; return a deterministic validation error when the safe limit is exceeded.
7. Make compiled branches and required branch count inspectable in unit tests.

**Tests**

- Truth-table fixtures cover AND, OR, NOT, nested groups, double negation, phrases, proximity, wildcard, structured auditor filters, and malformed input.
- `A OR NOT B`, `A OR $#`, `A OR crypto*`, and unsafe `auditor:` compositions either execute both branches correctly or are rejected before retrieval; no branch may disappear silently.
- UI and service compiler produce the same normalized plan/error.

**Complete when**

- Boolean truth-table precision and recall are 100% on the deterministic corpus.
- Every accepted expression has complete executable branch coverage.

## Work package 4 — Fair branch retrieval, validation, and truthful coverage

**Objective:** prevent a broad early branch from starving a later exclusive branch and make coverage claims auditable.

**Primary areas**

- `src/services/filingResearch.ts`
- `src/services/secApi.ts`
- `src/app/api/boolean-validate/route.ts`
- `src/app/api/es-search/route.ts`
- `src/__tests__/filingResearchBranchCoverage.test.ts`
- `src/__tests__/delegatedRecallBudget.test.ts`
- `src/__tests__/booleanPrescreen.test.ts`

**Changes**

1. Replace sequential whole-branch retrieval with round-robin cursor paging. Every required branch receives a first page and a reserved validation opportunity before any branch consumes surplus capacity.
2. Deduplicate by stable filing/document identity only after branch attribution is recorded.
3. Track page, document, retry, and prescreen work in the advertised request/time budgets. Retries and prescreen fetches are not free.
4. Reject non-OK SEC responses and validate expected content type/body shape before caching or evaluating filing text. HTML error pages, 404s, 429s, 5xx responses, timeouts, and aborted fetches are never valid filing documents.
5. Maintain a per-branch coverage ledger containing branch ID, queries attempted, cursors/pages, candidates examined, unique documents validated, matched documents, failures, exhausted flag, and incomplete reason.
6. Derive aggregate coverage from the deduplicated union and all branch ledgers. Do not combine independent branch totals with `Math.max`.
7. Set `complete=true` only when every required branch is exhausted and every represented candidate needed for the declared scope was validated. Deadline, cap, retry exhaustion, error, or cancellation always means partial.
8. Select snippets/evidence from a branch that actually evaluates true for the returned document.

**Critical starvation fixture**

- Branch alpha exposes 300 candidates.
- Branch beta exposes one exclusive matching accession.
- Overall validation budget is 120 documents.
- Expected result: beta is requested and validated early enough that the exclusive accession is returned; coverage records both branches truthfully.

**Complete when**

- Branch-exclusive recall is 100%.
- The critical starvation fixture passes.
- Failure injection never reports complete coverage and never caches an invalid upstream response.
- Measured network work stays within the declared budget.

## Work package 5 — Consolidated exact-SHA accuracy gate

**Objective:** produce one trustworthy answer to “did the exact release candidate pass?”

**Primary areas**

- `scripts/accuracy/gate.ts`
- `scripts/accuracy/cases.ts`
- `scripts/ticker-coverage-test.ts`
- `scripts/e2e-perf-test.ts`
- `.github/workflows/accuracy-gate.yml`

**Changes**

1. Consolidate the newer semantic gate with the useful high-volume ticker and availability suites. Do not treat HTTP availability as semantic accuracy.
2. Report separately: ticker resolution, semantic truth-table accuracy, branch-exclusive recall, auditor/topic availability, latency, coverage honesty, and skipped/indeterminate cases.
3. Store the source SHA, deployment ID/URL, environment class, fixture version, start/end time, raw case results, and summary thresholds in artifacts.
4. Fail closed when required secrets/fixtures are absent, a critical suite is skipped, or the tested deployment reports a different SHA.
5. Run first against an immutable preview, then perform a smaller non-mutating production smoke after promotion.

**Complete when**

- Ticker resolution is 100%.
- Boolean truth-table and branch-exclusive recall are 100%.
- Overall semantic accuracy is at least 97%.
- Auditor/topic application 5xx is 0% and latency thresholds pass.
- The report proves tested preview SHA equals promoted production SHA.

## Work package 6 — CSP and security automation

**Objective:** add browser content restrictions and make common security regressions continuously visible.

**Primary areas**

- `next.config.mjs` or a dedicated response-header helper.
- Authentication, Supabase, analytics, image, document, and export origins actually used by the app.
- `.github/dependabot.yml`
- `.github/workflows/codeql.yml`
- Repository security settings and branch protection.

**Changes**

1. Inventory exact required origins from production requests.
2. Introduce `Content-Security-Policy-Report-Only` with narrow directives. Avoid broad `https:` allowances, wildcard origins, and `unsafe-eval`.
3. Collect and triage violations in preview/staging; add explicit sources only when a real product path requires them.
4. Move to enforced CSP after authenticated and public route coverage is clean.
5. Add an automated header test for every route archetype and error response.
6. Enable Dependabot, CodeQL, secret scanning, push protection, required status checks, and protected production promotion where supported.
7. Keep production dependency audit blocking for high/critical findings; track development-tool findings separately with owners and due dates.

**Complete when**

- CSP is present on every application response and does not break required app behavior.
- Automated scans and required checks run on pull requests.
- Secrets are not accepted in pushes where platform support permits prevention.

## Work package 7 — Behavior-preserving search decomposition

**Objective:** reduce change risk in the search executor after correctness is locked down.

**Primary areas**

- `src/services/filingResearch.ts`
- `src/services/secApi.ts`
- `src/views/SearchPage.tsx`
- Search domain types currently coupled to React components.

**Target internal stages**

1. `compileSearchPlan`
2. `collectCandidates`
3. `validateDocuments`
4. `buildCoverageLedger`
5. `enrichResults`
6. `rankAndLimitResults`

**Changes**

1. Move `SearchFilters` and shared search contracts into a framework-neutral domain module.
2. Break the runtime import cycle involving search filters, company lookup, and agent evidence.
3. Extract one pure or narrowly injected stage per pull request, retaining the current public façade and result shape.
4. Keep network clients, retry policy, clocks, and budgets injectable so deterministic tests do not depend on live SEC/Supabase services.
5. Run the complete contract/accuracy suite after every extraction. Do not combine semantic changes with mechanical extraction unless the failing fixture requires it.

**Complete when**

- Existing callers require no product-level rewrite.
- Stage contracts have direct tests and the exact same acceptance corpus passes.
- Search orchestration can be understood and changed without editing one monolithic execution function.

## Work package 8 — Real interaction coverage from the control inventory

**Objective:** ensure visible controls actually perform their stated jobs rather than only existing in metadata or static markup.

**Primary areas**

- `src/__tests__/uiPageContracts.ts`
- `src/__tests__/uiPageContracts.test.ts`
- `tests/e2e/*.spec.ts`
- `playwright.config.ts`

**Changes**

1. Extend each control contract with `coveredBy`, verification level, risk, and—only for a manual exception—owner, reason, and expiry date.
2. Add a meta-test that fails if any action has neither an executable test nor a valid manual exception.
3. Test behavior archetypes rather than duplicating every repeated row: navigation, form/Enter parity, combobox, filter chips, tabs, disclosure, sort, pagination, retry identity, copy, download/export, popup, AI action, Copilot, memo tray, sidebar/mobile drawer, command palette, theme, authentication, saved local state, dialogs, destructive actions, document viewer, chart marks, and consent.
4. Parameterize repeated row actions with at least two distinct stable record identities to catch first-row closure mistakes.
5. Assert success, legitimate zero, loading, failure, retry, latest-request-wins, partial coverage, keyboard operation, and responsive behavior where applicable.
6. Run Playwright against `next build` plus `next start`; do not use `next dev` for release evidence.
7. Enable strict semantic auditing (`QA_STRICT_AUDIT=1`) as a blocking CI check.

**Complete when**

- Every inventory action maps to executable evidence or an owned, expiring exception.
- All critical actions have no manual exception.
- The production-build browser suite passes on desktop and representative mobile viewports.

## Work package 9 — Promotion and post-release proof

Follow `03_EXACT_SHA_RELEASE_RUNBOOK.md` without rebuilding from a different source state.

**Complete when**

- The tested preview deployment is the deployment promoted to production.
- Production reports the same SHA.
- Non-mutating production smoke and header/security checks pass.
- The previous healthy deployment remains identified and usable for rollback.
