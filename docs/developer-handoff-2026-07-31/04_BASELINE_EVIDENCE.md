# Baseline Evidence and Open Questions

Baseline source revision: `d834032b0f103c50ab647ce4fc49bc67c89834a9`

This document separates source-confirmed evidence from production hypotheses. It is not a fresh production sign-off; the exact-SHA runbook must reconfirm deployed behavior.

## Confirmed in the reviewed source

### Supabase web credential fallback

`src/lib/supabase-web.ts` currently selects `webKey || serviceKey` inside `getWebSupabase()`. When the production web key is absent, it logs a warning and continues with the service key. The same module also contains a deliberately narrow cache-writer client. The remediation must remove escalation from the read client without making the cache writable to anonymous callers.

Relevant tests:

- `src/__tests__/supabaseWeb.test.ts`
- `src/__tests__/migrationSecurity.test.ts`

### Permission contract drift risk

The migration history contains both broad anon-read grants and later revocations/regrants:

- `db/migrations/003_anon_read_surface.sql`
- `db/migrations/010_web_role_security.sql`
- `db/migrations/011_comment_letter_integrity.sql`

Later feature migrations add additional RPCs and views. The final effective read contract is therefore difficult to infer safely from a single migration. Use a new forward-only migration after inventorying the live schema and exact RPC signatures.

### Auditor/topic route failures are flattened

The filing search route calls `urc_search_filings`; the comment-letter route calls `urc_search_letters`. Generic database errors can be converted into application 502 responses without preserving a stable diagnostic class for release automation.

Primary locations:

- `src/app/api/es-search/route.ts`
- `src/app/api/letters/route.ts`
- current-auditor/auditor route handlers and backing view/RPC definitions.

Probable failure classes to distinguish:

- PostgreSQL permission denied: `42501`.
- Statement timeout: `57014`.
- Missing/stale PostgREST RPC: `PGRST202`.
- Upstream availability/rate-limit failures.

The exact live cause remains a telemetry question until production error codes, RPC signatures, grants, and query plans are inspected.

### Boolean compilation gaps

The compiler/planner path in `src/utils/booleanSearch.ts` can accept expressions whose unsupported or unanchored branch is not represented in all retrieval queries. Edge cases identified for mandatory fixtures include:

- `A OR NOT B`;
- `A OR $#`;
- `A OR crypto*`;
- double negation;
- quote/group-sensitive `auditor:` expressions;
- malformed proximity or operand forms;
- branch expansion beyond a safe complexity limit.

An accepted expression must never have a silently discarded branch.

### Sequential retrieval can starve later OR branches

`src/services/filingResearch.ts` performs a highly branched search/validation flow with global page, document, and time limits. Whole-branch sequential work can allow an early broad branch to consume capacity before a later exclusive branch is adequately retrieved or validated.

The mandatory deterministic fixture is 300 alpha candidates, one beta-exclusive match, and a total validation budget of 120. A fair scheduler must still find beta.

### Aggregate coverage is not a per-branch proof

Coverage in `src/services/filingResearch.ts` combines some counters with `Math.max`, and API/client shapes include both `candidateCoverage` and `pageCoverage`. This cannot prove that every independent Boolean branch was exhausted or validated. Aggregate completeness must be derived from explicit per-branch ledgers and the deduplicated candidate union.

### Invalid upstream documents need hard rejection

The SEC document/prescreen path in `src/services/secApi.ts` and Boolean validation must check HTTP status and response shape before caching/evaluating content. A 404/429/5xx HTML error body must never become filing text, a validated non-match, or evidence supporting complete coverage. Prescreen and retry work must count toward budgets.

### Accuracy automation is split

The repository has a newer semantic command (`npm run accuracy`, implemented under `scripts/accuracy/`) while `.github/workflows/accuracy-gate.yml` runs the high-volume ticker and older performance/availability scripts. These signals should be consolidated but reported as separate dimensions, not averaged into a misleading single score.

### CSP is absent

`next.config.mjs` defines HSTS, frame, MIME-sniffing, referrer, and permissions headers but no Content Security Policy. CSP should be rolled out report-only first using an exact required-origin inventory, then enforced after authenticated and public route verification.

### Browser CI exists but is not yet release-grade for this objective

`.github/workflows/ci.yml` runs the Playwright suite, and `playwright.config.ts` starts `npm run dev` when no external base URL is supplied. Release evidence must instead exercise `next build` plus `next start`. Strict semantic mode and real action coverage must be blocking.

### Control inventory is metadata-heavy

`src/__tests__/uiPageContracts.ts` inventories routes/actions, but inventory validation does not prove that each control produces the intended state, request, navigation, download, or error behavior. Add traceability fields and a meta-test, then implement executable behavior-archetype coverage.

### Maintainability hotspots

The main search UI and execution services are large and coupled:

- `src/views/SearchPage.tsx`
- `src/services/filingResearch.ts`
- `src/services/secApi.ts`

Search domain types are coupled to React UI code, and an import cycle has been observed around search filters, company lookup, and agent evidence. Decompose only after correctness is protected by deterministic fixtures.

## Existing evidence worth consulting in the repository

These are historical references and should not be treated as current release proof:

- `docs/qa/boolean-search-remediation-plan-2026-07-21.md`
- `docs/qa/full-site-interaction-audit-2026-07-21.md`
- `docs/qa/platform-readiness-findings-and-actions-2026-07-23.md`
- `docs/accuracy-gate.md`
- `docs/accuracy-audit-2026-07-19.md`

## Production questions that must be answered with evidence

1. Which exact deployment ID and SHA currently serve the production domain?
2. Which Supabase credential class do production web routes actually use?
3. What are the exact error codes, RPC signatures, and execution times behind auditor/topic failures?
4. Are the live grants identical to the repository's intended final migration state?
5. Does PostgREST expose the current RPC schema or need a cache refresh?
6. Which CSP origins are required by production authentication, Supabase, assets, document rendering, telemetry, and exports?
7. Does the exact candidate pass semantic accuracy rather than only endpoint availability?
8. Do all visible controls have executable behavior evidence in production-build mode?

## Evidence that must not be bundled

- `.env*` files or environment exports.
- Supabase service, publishable, anon, or custom JWT values.
- Clerk keys, cookies, browser storage state, session tokens, or authenticated traces containing private data.
- Vercel access tokens or deployment environment dumps.
- Raw production database exports or filings cached from user-private workflows.
- Unredacted logs containing queries/user identifiers beyond the approved test corpus.

## Local repository note

At package creation time, `next-env.d.ts` was modified outside this handoff. This package neither changes nor includes that file.
