# Uniqus Research

Uniqus Research is a Next.js application for researching SEC filings, comparing disclosures and financial data, reviewing comment-letter correspondence, and producing evidence-linked AI analyses. It is designed for authenticated legal, accounting, financial, and compliance research workflows.

## What is implemented

- SEC filing search with exact Boolean, `NOT`, grouping, and proximity validation against filing text
- Filing viewer with within-document search, annotations, table extraction, historical redlines, and export
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

Requirements: Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev -- -p 3033
```

Open `http://localhost:3033`. Next.js otherwise defaults to port 3000.

Local development may use Clerk's keyless development flow. Production deliberately fails closed unless live Clerk keys and a research entitlement are configured.

## Environment

Use [.env.example](.env.example) as the complete template. The principal settings are:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_RESEARCH_FEATURE` for production access control
- `ANTHROPIC_API_KEY` and optional `ANTHROPIC_MODEL` for AI routes
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `AI_DAILY_TOKEN_BUDGET_PER_USER`, and optional `AI_MAX_CONCURRENT_*` values for distributed limits and budgets
- `URC_SUPABASE_URL` and `URC_SUPABASE_WEB_KEY` for production read/write routes that operate under database policy
- `URC_SUPABASE_SERVICE_KEY` only for trusted ingestion and maintenance jobs
- `NEXT_PUBLIC_EDGAR_USER_AGENT` for SEC requests, in `Organization contact@example.com` form
- optional `NEXT_PUBLIC_POSTHOG_*` settings for consent-aware analytics

Never expose a service-role key, Anthropic or Clerk secret, KV token, or other server credential through a `NEXT_PUBLIC_*` variable.

## Verification

Run all local quality gates before submitting a change:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Targeted Vitest files can be run with `npx vitest run path/to/test.ts`.

## Data pipeline

The application uses SEC EDGAR/EFTS as the filing source and Supabase for enriched metadata such as auditor, issuer, SIC, and comment-letter data. Pipeline setup and ingestion commands are documented in [data-pipeline/README.md](data-pipeline/README.md). The historical external search index and Vite proxy are retired.

Use a descriptive SEC user agent, respect upstream rate limits, retry bounded transient failures, and display partial coverage rather than presenting capped candidate windows as exact corpus totals.

## Vercel deployment

1. Import the repository into Vercel.
2. Use `npm run build`; no custom output directory is required.
3. Configure the application-runtime variables from `.env.example` with live credentials. Do not add `URC_SUPABASE_SERVICE_KEY` to Vercel; the web application uses only `URC_SUPABASE_WEB_KEY`.
4. Apply the required Supabase migrations and configure `URC_SUPABASE_SERVICE_KEY` only as a secret for the scheduled ingestion workflows.
5. Verify anonymous access is denied for protected pages and APIs, AI limits use KV, the production Clerk development-key warning is absent, and the quality-gate commands pass.

SEC documents are fetched through the application routes as sanitized inert content; do not reintroduce a same-origin active HTML proxy or unsandboxed document rendering.
