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
  contact (F-12) alongside. CSP is already enforced in production (and
  report-only during local development), so re-verify Clerk's exact origins
  against the enforced policy when the instance changes.

## 6. Clerk test credentials for the authentication e2e suite

**Why**: `global.authentication` and the two protected support-route actions
are credited as fully automated only because this separate harness exercises
them with authentication enabled. None of it is observable in the main Playwright suite,
which runs behind `URC_E2E_BYPASS_AUTH` so that nothing is protected.

The harness is already built and merged — `playwright.auth.config.ts`,
`tests/e2e-auth/`, and the push-only `auth-lifecycle.yml` workflow. Pull
requests run a meaningful secretless `auth-browser` contract check but receive
no Clerk secret or test identity. The credentialed lifecycle runs only from
the exact revision already accepted onto protected `main`, fails closed if any
required test credential is absent, and is required by exact-SHA release
evidence.

- **Do (1)**: in the Clerk dashboard, open the **development** instance
  already in use (the same one issuing the `pk_test_…` key in
  `.env.local`) and copy both keys from *API keys*.
- **Do (2)**: add three GitHub repository secrets — Settings → Secrets and
  variables → Actions:
  - `CLERK_PUBLISHABLE_KEY_TEST` = `pk_test_…`
  - `CLERK_SECRET_KEY_TEST` = `sk_test_…`
  - `CLERK_TEST_EMAIL` = the test user below
- **Do (3)**: create one user in that instance
  with a `+clerk_test` email — e.g. `urc-e2e+clerk_test@example.com` —
  and store it as `CLERK_TEST_EMAIL`. This enables the sign-in/sign-out
  round trip, which is the half of the contract that actually matters
  (a sign-out that clears the chrome but leaves the session valid looks
  correct to the user). Clerk's `+clerk_test` addresses need no real
  inbox, and sign-in uses a backend-issued ticket, so **no password is
  created, transmitted, or stored anywhere**.

**Must be a development instance.** `@clerk/testing` refuses production
secret keys by design, and testing tokens are a dev-instance feature.

**To run locally**: put the same three values in `.env.local`
(`CLERK_SECRET_KEY` is currently absent there) and run `npm run test:auth`.
Without them the config fails fast with the exact variables it needs.

The coverage inventory points at these tests, so removing any credential or
skipping the lifecycle would make the automation claim dishonest. CI therefore
fails closed when the three values are absent on a protected-main push, while
PR-controlled code remains secretless.

## 7. Supabase credentials for trusted release evidence

- **Why**: the staged Vercel candidate uses its own restricted web identity.
  Protected evaluator code separately derives SEC/database ground truth and
  inspects the live catalog through a service-only RPC. It compares a
  non-secret database-origin fingerprint so evidence from another Supabase
  project cannot be paired with the candidate.
- **Do**: keep `URC_SUPABASE_URL` and `URC_SUPABASE_SERVICE_KEY` only in the
  restricted GitHub `release-candidate` environment. Do not make the service
  key a repository-wide Actions secret and do not pass it to candidate HTTP
  requests or dependency-install steps.
- **Runtime distinction**: the staged Vercel deployment may have its own
  Sensitive, server-only `URC_SUPABASE_SERVICE_KEY` for the three audited
  cache-writer routes. Production reads still use only
  `URC_SUPABASE_WEB_KEY`; there is no service-key read fallback.
- **After**: manually dispatch **Release candidate accuracy** with the
  canonical URL and `dpl_…` ID of an unaliased staged Production deployment.
  This gate does not build localhost, does not run on a weekly schedule, and
  does not promote the deployment.

## 8. Staged-production release gate

- **Vercel project setting**: Production → Branch Tracking → disable
  **Auto-assign Custom Production Domains**. A protected-`main` Git Integration
  build must remain `STAGED` until the evidence workflow passes.
- **Generate one P-256 key pair outside the repository** using the commands in
  `docs/accuracy-gate.md`.
- **GitHub `release-candidate` environment secret**:
  `URC_RELEASE_GATE_PRIVATE_KEY` = base64 PKCS#8 private key. Do not create a
  repository-wide copy.
- **Vercel Production variable**: `URC_RELEASE_GATE_PUBLIC_KEY` = base64 SPKI
  public key. The application receives no private signing material. Use a fresh
  pair for every candidate and set the public key **before** its staged build.
- **Vercel Production variable**: `URC_RELEASE_GATE_NOT_AFTER` = a per-candidate
  ISO timestamp (recommended: four hours ahead) or epoch. Set it before the
  staged build, alongside the fresh public key. Initial preflight requires at
  least two hours remaining, final attestation requires five minutes, and the
  value may not exceed six hours after Vercel ready/created time.
- **GitHub `release-candidate` environment secrets**: confirm `VERCEL_TOKEN`,
  `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, optional
  `VERCEL_AUTOMATION_BYPASS_SECRET`, `URC_SUPABASE_URL`, and
  `URC_SUPABASE_SERVICE_KEY` exist only in the restricted environment.
- **GitHub environment rules**: permit `release-candidate` only from protected
  `main`; protect `production` with required reviewers and no actor bypass.
- **After every evidence run**: delete the candidate private key from GitHub.
  Rotate/remove the Vercel public key and not-after before the next staged
  candidate. Do this on both pass and failure; the old deployment's snapshotted
  not-after remains the hard backstop.

Until the `production` environment has those reviewer/no-bypass rules, the
workflow is deliberately evidence-only. Its final job records the exact tested
deployment ID, canonical URL, and SHA; an operator must select that exact staged
deployment in Vercel and verify the production `/api/version` identity after
promotion.

The gate rejects Preview deployments, local/prebuilt uploads, caller-supplied
Git metadata, candidates with any alias, a candidate already serving Production,
and any deployment that does not match the exact GitHub repository ID/SHA.
