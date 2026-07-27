# Pending keys & decisions — the items only Sandip can close

> Status as of 2026-07-27. Everything engineering-side for these is either
> built or trivially wired once the credential/decision exists. Each item
> lists exactly what to obtain, where to put it, and what turns on.

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

## 3. Upstash / Vercel KV — durable rate limits

- **Get**: the existing Vercel KV integration already provides
  `KV_REST_API_URL` / `KV_REST_API_TOKEN`; confirm they are set in Vercel
  (they were configured for AI budgets — if present, nothing to buy).
- **Effect**: `src/lib/rate-limit.ts` already prefers KV and falls back to
  in-memory per-instance limits with a one-time warning. Durable limits are
  ON wherever KV env is present; nothing else to do.

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
