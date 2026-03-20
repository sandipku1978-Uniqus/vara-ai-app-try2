# SEC Compliance Intelligence Platform (Intelligize+ Clone)

A comprehensive, production-grade SEC compliance and research platform modeled after industry-standard tools like Intelligize. Designed for legal, financial, and compliance professionals to seamlessly research SEC filings, benchmark disclosures, analyze accounting standards, and derive AI-driven insights.

## Core Features
1. **Advanced SEC Search & Discovery:** Full-text semantic and boolean search emulation filtering by form type, industry, date, and ESG criteria.
2. **Disclosure Benchmarking Matrix:** Side-by-side structural comparison of sections (e.g., Risk Factors, MD&A) across up to 10 peers, highlighting unique language vs. boilerplate.
3. **Filing Viewer & Redlining:** Deep-dive document analysis with Year-over-Year text diffing and extractable financial/compensation tables.
4. **Accounting Standards Hub:** Explore FASB ASC codifications, build custom US GAAP disclosure checklists, and query technical accounting knowledge.
5. **ESG Research Center:** Map interoperability between GRI, SASB, ESRS, and TCFD frameworks. Visualize competitor ESG depth via heatmaps.
6. **Board & Exec Comp Profiles:** Track board diversity matrices, analyze Executive Compensation (PvP, Summary Comp tables).
7. **IPO Readiness Center:** Track global IPO pipelines, benchmark deal sizes, and analyze frequently drafted S-1 risk factors.
8. **M&A Transactional Screener:** Screen precedent Merger Agreements and compare negotiated clauses (e.g., Material Adverse Effect definitions).
9. **Protege AI Layer:** A unified generative AI assistant (powered by Claude) integrated across the platform for answering technical queries, summarizing filings, and generating peer comparisons.

## Tech Stack
- **Framework:** React 18, Vite, TypeScript
- **State Management:** React Context API (`AppState.tsx`)
- **Routing:** React Router DOM (v6)
- **Styling:** Custom Vanilla CSS with a Dark Mode Glassmorphism aesthetic (Deep Navy `#0A0F1E` backgrounds, CSS variables)
- **Icons & Charts:** `lucide-react`, `recharts`
- **AI Integration:** Anthropic Claude via a server-side `/api/claude` endpoint

## Setup & Run Instructions

### Prerequisites
- Node.js (v18+ recommended)
- `npm` or `yarn`

### Installation
1. Clone or navigate to the repository:
   ```bash
   cd comparableAI
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Environment Setup
Add a `.env` file at the root to configure the live SEC API and Claude integration:
```env
# Required for SEC EDGAR requests (Format: Name Email)
VITE_EDGAR_USER_AGENT="YourName contact@yourdomain.com"
# Required for all Protege AI insights and comparisons
ANTHROPIC_API_KEY="sk-ant-..."
# Optional override if you want a different Claude model
ANTHROPIC_MODEL="claude-sonnet-4-20250514"
```

### Running Locally
Start the local Vite development server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

The Vite dev server now exposes `/api/claude` locally, so Claude-backed features work in development without exposing the Anthropic key to the browser.

## Deploying To Vercel

This repo includes Vercel serverless SEC proxy routes in `api/` plus route handling in `vercel.json`, so the SEC fetch/search endpoints continue working after deployment instead of only on localhost.

### Recommended Setup
1. Push this repo to GitHub.
2. Import the repo into Vercel.
3. Confirm these project settings:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add these environment variables in Vercel:
   ```env
   VITE_EDGAR_USER_AGENT="Your Name contact@yourdomain.com"
   ANTHROPIC_API_KEY="sk-ant-..."
   ANTHROPIC_MODEL="claude-sonnet-4-20250514"
   ```
5. Deploy.

### Important Notes
- `/sec-proxy/*` is proxied through a Vercel function to `https://www.sec.gov/*`
- `/sec-data/*` is proxied through a Vercel function to `https://data.sec.gov/*`
- `/sec-efts/*` is proxied through a Vercel function to `https://efts.sec.gov/*`
- `/api/claude` is handled server-side so the Anthropic API key stays off the client
- SPA routes fall back to the app entry point through `vercel.json`
- Use `.env.example` as the template and do not commit your real `.env`

## Architecture Notes
- **API Strategy:** To ensure a structured demo without hitting prohibitive SEC rate limits or CORS boundaries, the platform uses a hybrid approach. Certain features fetch live SEC JSON schemas (e.g., fetching 10-Ks), while specialized analytical views (ESG mapping, M&A clauses, Board tables) orchestrate highly realistic mock data to simulate proprietary NLP extraction pipelines.
- **AI "Protege":** The `src/services/aiApi.ts` layer governs all generative tasks, routing Claude requests through `/api/claude` so the Anthropic API key stays server-side. Always verified alongside the `ResponsibleAIBanner`.
