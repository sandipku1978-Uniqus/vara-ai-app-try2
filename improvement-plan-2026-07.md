# Uniqus Research Center — Improvement Plan (July 2026)

> Status check against `uniqus-research-center-implementation-plan.md` (April 2026),
> performed 2026-07-19. Repo `vara-ai-app-try2`, live at uniqus-research.vercel.app.
> Last commit: 2026-04-05 (`090bcb1`), local = origin/main.

## Where we are — April plan scorecard

| April sprint item | Status | Evidence |
|---|---|---|
| Next.js App Router migration + SSR | ✅ Done | `src/app/*`, `vercel.json` framework=nextjs, live site serves `_next` |
| Vercel KV caching | ✅ Done | `src/lib/cache.ts`, `@vercel/kv` dep |
| Pre-computed starter results (cron) | ✅ Done | `/api/cron/precompute` daily 09:00 |
| Claude streaming + compare + redline | ✅ Done | `/api/stream`, `/api/compare`, redline commits |
| og:image cards | ✅ Done | `/api/og` |
| PostHog analytics | ✅ Done | `PostHogProvider.tsx` |
| Clerk authentication (partner gating) | ⚠️ Half-done | `ClerkProvider` mounted, but **no `middleware.ts`** — nothing is actually gated |
| Daily ES ingest | ⚠️ At risk | `elasticsearch/daily-ingest.ts` exists but has **no cron/scheduler**; last local ingest log shows 2,800 errors / 9,598 skipped |
| 25-query copilot benchmark | ❌ Not built | no eval suite in repo (TCA has one to port) |
| IFRS/Ind AS cross-framework layer | 🟡 Partial | multi-currency IFRS filers landed (`090bcb1`); no curated KB / framework toggle |
| Custom domain research.uniqus.com | ❌ Not done | still uniqus-research.vercel.app (repo index lists domain as "planned") |

## P0 — Data freshness (the silent killer)

The ES index (`sec-filings`) is only as fresh as the last manual `daily-ingest.ts` run.
No scheduler exists — Vercel cron only hits `precompute`, and a full ingest can't run
inside a Vercel function timeout anyway. If nothing ran since early April, **the index
is missing ~3.5 months of filings** — including Q1 10-Qs and proxy season. TCA's
`src/lib/sec/es-client.ts` queries the same index, so staleness leaks into champion
answers too.

1. **Verify index freshness first**: query max `filedAt` in the `sec-filings` index.
2. **Automate ingest off-Vercel**: GitHub Actions scheduled workflow (or the existing
   TCA Railway worker) running `npx tsx elasticsearch/daily-ingest.ts --since 3` daily,
   with retry.
3. **Backfill the gap** once scheduled (`--since <days-since-April-5>`), rate-limit safe.
4. **Ingest health telemetry**: write a `last_ingest` doc (timestamp, indexed/skipped/error
   counts) and expose `/api/health`; alert via the same Teams error webhook TCA uses when
   ingest is >48h stale or error rate spikes. Triage the 2,800 errors from the last run.

## P1 — Actually gate the platform

- Add `src/middleware.ts` with `clerkMiddleware()`; protect `/api/claude`, `/api/stream`,
  `/api/compare` (today anyone can burn Anthropic tokens anonymously), keep SSR marketing
  + company pages public for SEO/link-preview value.
- Per-user rate limiting on the Claude-backed routes (port TCA's `checkRateLimit` keyed
  by userId).
- Decide public vs partner tier: public read-only filing viewer (keeps TCA citation links
  working logged-out) + partner-gated AI features is the natural split. **Confirm with
  Sandip before gating**, since TCA deep-links depend on logged-out viewing.

## P2 — Model + cost refresh

- `/api/claude/route.ts` pins `claude-sonnet-4-6`. Upgrade to the current Sonnet, and
  route complex queries (redline summaries, multi-peer compare) to a stronger model with
  extended thinking, per the original plan.
- Adopt 1h prompt caching on system prompt + filing context (TCA already ships this
  pattern — copy it).

## P3 — Quality harness

- Port TCA's eval-runner pattern: 25-query benchmark (accuracy, citation validity,
  hallucination) with regression floors in CI, mirroring `evals/` in advisor-uniqus.
- Redline spot-check: AAPL/MSFT/TSLA risk-factor YoY vs manual review (from the April
  verification plan — never executed).

## P4 — Product depth (differentiation)

- **IFRS / Ind AS curated KB + framework filter** — the "no competitor has this" item;
  still the biggest gap vs Intelligize. Curated KB first, full-text index later.
- **Cross-framework mapping** (ASC 815 ↔ IFRS 9 ↔ Ind AS 109) surfaced in search.
- **Comment-letter coverage check**: `CommentLetters.tsx` exists — verify comment letters
  (UPLOAD/CORRESP) are actually in the ES index; April plan flagged this as highest
  consulting-engagement value.
- **TCA ↔ URC loop closing**: URC filing viewer gets an "Ask a Topic Champion" button
  deep-linking into TCA with filing context; both apps already share the ES index and
  brand. Consider shared Clerk instance for SSO.

## P5 — Launch hygiene

- Custom domain `research.uniqus.com` + og-card verification on LinkedIn.
- Load test cached-query P95 < 5s (never run).
- Error webhook → Teams (reuse TCA's `ERROR_WEBHOOK_URL` adaptive-card payload).

## Suggested sequence (4 weeks)

| Week | Focus |
|---|---|
| 1 | P0 ingest automation + backfill + health endpoint; verify index freshness |
| 2 | P1 Clerk middleware + rate limits (after tiering decision); P2 model/caching refresh |
| 3 | P3 eval harness + redline verification; P5 domain + webhook |
| 4 | P4 IFRS/Ind AS KB v1 + comment-letter coverage + TCA deep-link button |
