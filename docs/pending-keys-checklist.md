# Pending keys & decisions — the items only Sandip can close

> Status as of 2026-07-31 (post pre-release audit). Everything
> engineering-side for these is either built or trivially wired once the
> credential/decision exists. Each item lists exactly what to obtain, where
> to put it, and what turns on.
>
> **The two starred items below are release-gating for multi-user use.**

## 0. ✅ DONE 2026-08-01 — `URC_SUPABASE_WEB_KEY` live; fail-closed merged (#41)

Migration 014 applied and probed (anon reads pass, writes denied); key set in
Vercel preview + production; PR #41 removed the service-key fallback. Web
routes can no longer escalate to service authority under any configuration.
The original procedure is kept below for audit history.

### Original procedure (completed)

- Without the key, every web-facing read route silently falls back to the
  **service-role key** (RLS bypass) with only a console warning
  (`src/lib/supabase-web.ts`).
- **Do NOT just set the key**: the anon grant history has drifted
  (010/011 revoked the core RPCs and base tables from `anon`; the later
  repair never covered `urc_sec_filings` for invoker-rights
  `urc_search_filings`). Setting the publishable key against today's live
  grants would 42501 facet search and letters. The exact order is:
  1. Run `db/migrations/014_web_read_contract.sql` in the Supabase SQL
     editor (idempotent, forward-only), then reload the PostgREST schema
     cache (Dashboard → API → Reload schema).
  2. Run the verification probes at the bottom of that file **with the
     publishable key** — reads succeed, writes fail with 42501.
  3. Set `URC_SUPABASE_WEB_KEY` (the `sb_publishable_...` key) in Vercel
     **Preview** first; exercise search/letters/stats on a preview deploy.
  4. Set it in Production.
  5. Tell Claude — the prepared fail-closed change (removes the service-key
     fallback entirely) merges only after this key is live.

## 1. Voyage AI key — semantic retrieval for memo.AI

- **Get**: an API key from voyageai.com (embeddings; `voyage-3` family).
- **Set**: `VOYAGE_API_KEY` in Vercel env (Sensitive) and `.env.local`.
- **Turns on**: semantic retrieval into the memo tray / citation ledger
  (planned in the Evidence Ledger phase 2 backlog; retrieval code to be wired
  once the key exists — this is the one item with real follow-on engineering).

## 2. Resend key — server-side email alerts

- **Get**: API key from resend.com; verify the sending domain.
- **Set**: `RESEND_API_KEY` in Vercel env.
- **Turns on**: saved-alert email delivery (alerts currently surface on the
  Dashboard only).

## 3. ✅ DONE 2026-08-01 — Vercel KV live (Upstash for Redis installed)

Upstash for Redis installed via the Vercel Marketplace and connected to
vara-ai-app; `KV_REST_API_URL` / `KV_REST_API_TOKEN` confirmed present. From
the next deployment, rate limits, AI concurrency caps, and both daily token
budgets are enforced deployment-wide. Original rationale kept below.

### Original item (completed)

- **Get**: the existing Vercel KV integration already provides
  `KV_REST_API_URL` / `KV_REST_API_TOKEN`; confirm they are set in Vercel.
- **Why it gates the rollout**: without KV, EVERY protection is
  per-serverless-instance, i.e. effectively unenforced under concurrency —
  per-user rate limits, AI concurrency caps, the daily token budgets
  (per-user AND the new deployment-wide `AI_DAILY_TOKEN_BUDGET_GLOBAL`),
  the global EDGAR fair-access lease, the comment-letter generation lock —
  and the AI response cache silently no-ops, so every call bills full price.
- **Also set**: `AI_DAILY_TOKEN_BUDGET_GLOBAL` (deployment-wide daily token
  ceiling; defaults to 8× the per-user budget if unset).

## 4. Custom domain — research.uniqus.com

- **Do**: add the domain in Vercel → Project → Domains; add the CNAME at the
  DNS provider. Then re-verify og:cards on LinkedIn against the new origin.

## 5. Strict Clerk production posture (when external users arrive)

- **Current**: internal pilot on the dev Clerk instance (deliberate decision
  2026-07-24; dev instance caps ~100 users).
- **Do when needed**: create a production Clerk instance, set
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` (live keys) and
  `CLERK_RESEARCH_FEATURE` for entitlement gating; add legal copy + support
  contact (F-12) and the CSP report-only rollout (F-14) alongside.

## 6. Clerk test credentials for the authentication e2e suite

**Why**: `global.authentication` is the last critical action in the WP8
coverage inventory still carrying a manual exception, and it is the root
cause of two more (`support-center.open-summary-route` /
`open-feature-route`, which both assert a route opens "requesting sign-in
if required"). None of it is observable in the main Playwright suite,
which runs behind `URC_E2E_BYPASS_AUTH` so that nothing is protected.

The harness is already built and merged — `playwright.auth.config.ts`,
`tests/e2e-auth/`, and the non-blocking `auth-browser` CI job. It skips
with a notice until the secrets below exist, then runs on every PR.

- **Do (1)**: in the Clerk dashboard, open the **development** instance
  already in use (the same one issuing the `pk_test_…` key in
  `.env.local`) and copy both keys from *API keys*.
- **Do (2)**: add two GitHub repository secrets — Settings → Secrets and
  variables → Actions:
  - `CLERK_PUBLISHABLE_KEY_TEST` = `pk_test_…`
  - `CLERK_SECRET_KEY_TEST` = `sk_test_…`
- **Do (3), optional but recommended**: create one user in that instance
  with a `+clerk_test` email — e.g. `urc-e2e+clerk_test@example.com` —
  and add it as `CLERK_TEST_EMAIL`. This enables the sign-in/sign-out
  round trip, which is the half of the contract that actually matters
  (a sign-out that clears the chrome but leaves the session valid looks
  correct to the user). Clerk's `+clerk_test` addresses need no real
  inbox, and sign-in uses a backend-issued ticket, so **no password is
  created, transmitted, or stored anywhere**.

**Must be a development instance.** `@clerk/testing` refuses production
secret keys by design, and testing tokens are a dev-instance feature.

**To run locally**: put the same two values in `.env.local`
(`CLERK_SECRET_KEY` is currently absent there) and run `npm run test:auth`.
Without them the config fails fast with the exact variables it needs.

**After the secrets land**: the `auth-browser` job goes from "skipped" to
running. Once it is green, flip `global.authentication` in
`src/__tests__/uiActionCoverage.ts` from `manual-exception` to
`automated` pointing at `tests/e2e-auth/authentication.spec.ts`, and
raise the ratchet floor. It is deliberately NOT flipped in advance —
the coverage file's HONESTY RULE forbids claiming automation that has
never been observed to pass.

## 7. URC_SUPABASE_WEB_KEY as a GitHub Actions secret (accuracy gate)

- **Why**: since #41, web routes fail closed without the publishable key.
  The first dispatch of the reworked accuracy gate (2026-08-02) failed with
  100% ticker `API HTTP 503` for exactly this reason — the gate builds and
  serves the app on the runner, and that server has no `URC_SUPABASE_WEB_KEY`.
- **Do**: GitHub → Settings → Secrets and variables → Actions → New
  repository secret: `URC_SUPABASE_WEB_KEY` = the same Supabase publishable
  key already set in Vercel (Vercel → Project → Settings → Environment
  Variables shows it; it is the publishable/anon key, not the service key).
- **After**: dispatch the "Accuracy gate" workflow manually (Actions tab →
  Accuracy gate → Run workflow) or wait for Monday 04:30 UTC. The workflow
  now fails fast with a named-secret error instead of 10,000 cryptic 503s
  if the key is still absent.
