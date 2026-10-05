# Uniqus Research

Uniqus Research is a Next.js application for researching SEC filings, comparing disclosures and financial data, reviewing comment-letter correspondence, and producing evidence-linked AI analyses. It is designed for authenticated legal, accounting, financial, and compliance research workflows.

## What is implemented

- SEC filing search with exact Boolean, `NOT`, grouping, and proximity validation against filing text; a text-validated result shows up to three passages from the text that was read, each with its section breadcrumb, the number of hits in that document, and the matched exhibits listed under the parent filing
- Filing viewer with a find bar (Ctrl/⌘+F while the viewer has focus; case-insensitive, optional whole-word matching, match count, Enter / Shift+Enter to step), an "All hits in this filing" list of every hit of the search that opened the filing (Boolean phrases and `W/n` / `P/n` proximity as the engine evaluates them) with section breadcrumbs, annotations, table extraction, historical redlines, and export. Find and the hit list work on HTML documents rendered in the viewer, not on PDF or XML documents or the parsed Form 3/4/5 view
- Company dossiers, XBRL financial comparisons, PCAOB auditor information, and comment-letter review episodes
- Disclosure benchmarking, board, ESG, M&A, IPO, earnings, exhibit, exempt-offering, and accounting research workflows
- Evidence-linked Claude analysis through authenticated server routes
- Responsive light/dark application shell, command palette, and keyboard-accessible shared controls

Each result surface identifies its source and limitations. Features that lack an authoritative source are not presented as live research data.

## Stack

- Next.js 16 App Router, React 18, and TypeScript
- Supabase for research metadata and persisted server-side data
- Clerk for authentication and feature entitlements
- Anthropic Claude through server-only API routes
- Vercel KV for distributed AI limits and cached summaries
- Vitest, Testing Library, TypeScript, and ESLint for verification

## Local setup

Requirements: Node.js 22.22.2 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev -- -p 3033
```

Open `http://localhost:3033`. Next.js otherwise defaults to port 3000.

Local development may use Clerk's keyless development flow. The current internal pilot deliberately permits a configured Clerk development instance without a research entitlement; missing keys still fail closed. Live Clerk keys and `CLERK_RESEARCH_FEATURE` remain prerequisites for an external production launch and are intentionally outside this branch.

## Environment

Use [.env.example](.env.example) as the complete template. The principal settings are:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and—before external production launch—`CLERK_RESEARCH_FEATURE` for strict access control
- `VERCEL_AI_GATEWAY_KEY` (or the gateway's documented name, `AI_GATEWAY_API_KEY`) for AI routes: with a gateway key every model in `src/lib/ai-models.ts` runs through the Vercel AI Gateway. `ANTHROPIC_API_KEY` is the no-gateway fallback: without a gateway key only the default model runs, directly on Anthropic, and other models report unavailable. Either key makes `/api/health` report AI as configured; its `checks.ai` names the path (`gateway`, `anthropic-direct` or `none`) and which key variables are set, never their values
- optional `ANTHROPIC_MODEL`: set it to a registry id (for example `anthropic/claude-sonnet-5.5`) to make that model the default for requests that name none. Any value that is not a registry id is treated as the Anthropic API model id the no-gateway path runs (default `claude-sonnet-5`) and leaves the registry default in place. `/api/ai/models` lists the registry and which models this deployment can call
- web search (off unless a request asks for it): models with native search use their provider's own tool; every other model gets web context retrieved first, through the gateway, from Perplexity Sonar (`perplexity/sonar`). The gateway refuses Sonar (`no_zdr_providers_available`) on accounts that enforce zero data retention, because Perplexity is not a ZDR provider and a per-request opt-out cannot override a team setting. Retrieval then falls back to GPT-5.6 Luna's native OpenAI web search (`openai/gpt-5.6-luna`), which runs under ZDR; Sonar is skipped for ten minutes after a refusal on that instance. If no retriever answers, the model answers without web results and the response's `webSearch` report says why (`src/lib/ai-web-search.ts`)
- `URC_USER_DATA_SIGNING_SECRET` (32+ characters, server only, Sensitive): the HMAC secret the `/api/user/*` routes sign the Clerk identity with; the same value goes in `public.urc_user_signing_key` (migration 026). Unset, saved research (memo, watchlists, peer sets and the rest) stays browser-local
- `CRON_SECRET` (16+ characters, server only, Sensitive): Vercel Cron sends it as `Authorization: Bearer …` to `/api/search-jobs/continue` (scheduled in `vercel.json`), which continues long full-text search jobs; the route fails closed when it is unset
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `AI_DAILY_TOKEN_BUDGET_PER_USER`, and optional `AI_MAX_CONCURRENT_*` values for distributed limits and budgets
- `URC_SUPABASE_URL` and `URC_SUPABASE_WEB_KEY` for production read routes that operate under database policy
- `URC_SUPABASE_SERVICE_KEY` as a server-only secret for trusted ingestion/maintenance jobs and the three audited cache-writer routes; it is never a web-read identity
- `NEXT_PUBLIC_EDGAR_USER_AGENT` for SEC requests, in `Organization contact@example.com` form
- optional `NEXT_PUBLIC_POSTHOG_*` settings for consent-aware analytics

Never expose a service-role key, AI Gateway or Anthropic key, Clerk secret, KV token, signing or cron secret, or other server credential through a `NEXT_PUBLIC_*` variable.

## Verification

Run all local quality gates before submitting a change:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm audit
```

Targeted Vitest files can be run with `npx vitest run path/to/test.ts`.

## Data pipeline

The application uses SEC EDGAR/EFTS as the filing source and Supabase for enriched metadata such as auditor, issuer, SIC, and comment-letter data. Pipeline setup and ingestion commands are documented in [data-pipeline/README.md](data-pipeline/README.md). The historical external search index and Vite proxy are retired.

Use a descriptive SEC user agent, respect upstream rate limits, retry bounded transient failures, and display partial coverage rather than presenting capped candidate windows as exact corpus totals.

## Vercel deployment

1. Import the repository into Vercel.
2. Use `npm run build`; no custom output directory is required.
3. Configure the application-runtime variables from `.env.example` with live credentials. Production reads use only `URC_SUPABASE_WEB_KEY`. If shared cache warming/self-healing is enabled, add `URC_SUPABASE_SERVICE_KEY` as a Vercel Sensitive, server-only variable solely for the three audited cache-writer routes; it must never be exposed through `NEXT_PUBLIC_*` or used as a read fallback.
4. Apply the required Supabase migrations and separately configure `URC_SUPABASE_SERVICE_KEY` as a protected secret for scheduled ingestion and release-evidence workflows.
5. Verify anonymous access is denied for protected pages and APIs, AI limits use KV, and the quality-gate commands pass. The internal pilot currently logs the deliberate Clerk development-instance/no-entitlement warning; require that warning to be absent only after live keys and `CLERK_RESEARCH_FEATURE` are configured for external production launch.

SEC documents are fetched through the application routes as sanitized inert content; do not reintroduce a same-origin active HTML proxy or unsandboxed document rendering.
