# Pending keys & decisions — the items only Sandip can close

> Status as of 2026-07-31 (post pre-release audit). Everything
> engineering-side for these is either built or trivially wired once the
> credential/decision exists. Each item lists exactly what to obtain, where
> to put it, and what turns on.
>
> **The two starred items below are release-gating for multi-user use.**

## 0. ★ Verify `URC_SUPABASE_WEB_KEY` is set in Vercel

- Without it, every web-facing read route silently falls back to the
  **service-role key** (RLS bypass) with only a console warning
  (`src/lib/supabase-web.ts`). The least-privilege grants in migration 010
  are then inert. Verify in Vercel → Env Vars; it should be the
  `sb_publishable_...` key set 2026-07-24.

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

## 3. ★ Vercel KV — verify before wider rollout (release-gating)

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
