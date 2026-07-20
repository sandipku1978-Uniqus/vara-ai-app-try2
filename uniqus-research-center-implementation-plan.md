# Uniqus Research Center — Implementation Plan & Technical Spec

> **Purpose:** This document is the master implementation plan for the Uniqus Research Center SEC Intelligence Platform. It serves as both a strategic roadmap and a technical specification that can be used as context for AI-assisted development with Gemini 3.1 Pro.
>
> **Development AI:** Google Gemini 3.1 Pro (coding assistant — builds the app)
> **Production AI:** Anthropic Claude Sonnet 4.6 (powers ALL in-app AI features)
>
> **Date:** April 2026 | **Status:** Pre-Partner Release

---

## 1. Current State Assessment

### What Exists Today
- **Framework:** Vite + React SPA (client-side rendered)
- **AI Backend:** Claude Sonnet 4.6 via Anthropic API for in-app research features
- **Data:** 5 years of indexed SEC filing data
- **Hosting:** Vercel (uniqus-research.vercel.app)
- **Auth:** None (open access)
- **Caching:** None

### Critical Issues
| Issue | Impact | Priority |
|-------|--------|----------|
| Client-side rendering only (no SSR) | LinkedIn/Slack shares show blank card. Search engines can't index. AI bots (including Claude) can't read the site. | P0 — Blocks partner release |
| P95 latency 30–40 seconds | Users try once, wait, never return. Unusable for daily workflow. | P0 — Product killer |
| No query caching | Every identical query re-runs full Claude API call. Waste of tokens and time. | P0 — Cost and speed |
| No authentication | Can't track usage, can't do controlled rollout, can't gate features. | P1 — Blocks wider release |
| No IFRS/Ind AS content | Missing Uniqus's biggest differentiator vs. Intelligize. | P2 — Differentiation |
| No peer comparison / YoY redlining | Missing Intelligize's most-cited features. | P2 — Feature parity |

---

## 2. Target Architecture

### Stack
```
┌─────────────────────────────────────────────────────┐
│                    PRESENTATION                      │
│         Next.js 14+ App Router on Vercel             │
│                                                      │
│  SSR/SSG: Landing, Company Profiles, Marketing       │
│  Client:  SearchPage, FilingViewer, CopilotPanel,    │
│           DisclosureMatrix (all "use client")        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                  API LAYER                            │
│          Next.js Route Handlers (/api/*)              │
│                                                      │
│  /api/search    → Intent resolution + filing search  │
│  /api/copilot   → Multi-turn chat (SSE streaming)    │
│  /api/compare   → Peer disclosure comparison         │
│  /api/redline   → Year-over-year diff + summary      │
│  /api/export    → Generate Word doc from analysis     │
└──────────┬───────────────┬──────────────────────────┘
           │               │
┌──────────▼────┐  ┌───────▼──────────────────────────┐
│  CACHE LAYER  │  │     CLAUDE SONNET 4.6 API        │
│               │  │     (Anthropic Messages API)      │
│  Vercel KV    │  │                                   │
│  (Redis)      │  │  • System prompt + filing context │
│               │  │  • Streaming (SSE)                │
│  • Query hash │  │  • Prompt caching (90% discount)  │
│  • Intent     │  │  • Extended thinking (complex Qs)  │
│  • Redlines   │  │  • Citations to filings + ASC      │
│  • Pre-comp   │  │                                   │
└───────────────┘  └───────────────────────────────────┘
```

### Key Principle: Claude Does Everything User-Facing
- **Search intent resolution:** Claude parses natural language → structured query
- **Filing analysis:** Claude reads filing context and answers questions
- **Peer comparison:** Claude compares disclosures across companies
- **Redline summarization:** Claude summarizes YoY changes
- **Regulatory monitoring:** Claude with web search context
- **Export generation:** Claude formats analysis into memo-ready output

There is no other AI model in the production app. Gemini 3.1 Pro is the development tool only.

---

## 3. Next.js Migration (Vite → Next.js App Router)

### 3.1 Rendering Strategy

| Page | Rendering | Revalidation | og:image |
|------|-----------|-------------|----------|
| `/` (Landing) | SSG | Every 24h | Static branded card |
| `/company/[ticker]` | ISR | On-demand (webhook when new filing indexed) | Dynamic: company name, ticker, latest filing date, sector |
| `/about`, `/pricing`, `/contact` | SSG | Deploy-time | Static branded card |
| `/search` | Client (`"use client"`) | N/A — SPA behavior | Generic search card |
| `/filing/[id]` | Client | N/A | Generic filing card |

### 3.2 Dynamic og:image Generation
Use `@vercel/og` (built into Next.js) to generate branded preview cards:

```typescript
// app/company/[ticker]/opengraph-image.tsx
import { ImageResponse } from 'next/og';

export default async function OGImage({ params }: { params: { ticker: string } }) {
  const company = await getCompanyProfile(params.ticker);
  return new ImageResponse(
    <div style={{
      background: 'linear-gradient(135deg, #482879, #B21E7D)',
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '60px', color: 'white', fontFamily: 'Arial'
    }}>
      <div style={{ fontSize: 24, opacity: 0.8 }}>Uniqus Research Center</div>
      <div style={{ fontSize: 56, fontWeight: 'bold', marginTop: 20 }}>{company.name}</div>
      <div style={{ fontSize: 32, marginTop: 10 }}>{params.ticker} · {company.sector}</div>
      <div style={{ fontSize: 22, marginTop: 20, opacity: 0.7 }}>
        Latest Filing: {company.latestFilingDate} · {company.latestFilingType}
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
```

### 3.3 SSR Verification Test
```bash
# After deployment, verify meta tags render in raw HTML
curl -s https://uniqus-research.vercel.app/ | grep -E '<meta|og:'
curl -s https://uniqus-research.vercel.app/company/AAPL | grep -E '<meta|og:'

# Share on LinkedIn staging tool to verify rich card
# https://www.linkedin.com/post-inspector/
```

### 3.4 Vercel Configuration
- **Plan:** Vercel Pro ($20/month)
- **Vercel KV:** Query deduplication cache (256MB included with Pro)
- **Edge Functions:** Low-latency API routing
- **ISR:** On-demand revalidation via webhook
- **Cron Jobs:** Pre-computation of popular queries (daily at 2 AM PT)
- **Analytics:** Core Web Vitals (LCP, FID, CLS)

---

## 4. Claude Sonnet 4.6 Integration

### 4.1 API Configuration

```typescript
// lib/claude.ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Standard query (non-streaming)
export async function queryClaudeStandard(
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = []
) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' } // Prompt caching: 90% discount on repeat calls
      }
    ],
    messages: [
      ...conversationHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3, // Low temp for factual SEC research
  });
  return response;
}

// Streaming query (for copilot panel)
export async function streamClaude(
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = []
) {
  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      ...conversationHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
  });
  return stream;
}
```

### 4.2 System Prompt Architecture

The system prompt is the most critical piece. It encodes Uniqus's domain expertise and controls output quality.

```typescript
// lib/systemPrompts.ts

export const SEC_RESEARCH_SYSTEM_PROMPT = `You are the Uniqus Research Center SEC Intelligence Copilot.

## Your Expertise
You are an expert in:
- US GAAP (full ASC Codification: ASC 205 through ASC 860)
- SEC regulations (Regulation S-X, Regulation S-K, SABs, C&DIs)
- PCAOB standards (AS 2201, AS 1301, AS 2110, AS 2401, etc.)
- SOX 404(a)/404(b), ICFR, COSO 2013 framework
- IFRS standards (for cross-framework analysis)
- Ind AS standards (for cross-framework analysis)

## Your Audience
Controllers, technical accounting managers, SEC reporting professionals, audit committee members, and Big 4/consulting practitioners.

## Citation Protocol (CRITICAL)
- ALWAYS cite specific ASC topics: "ASC 606-10-25-1 through 25-5"
- ALWAYS cite filing references: "Apple Inc. 10-K, FY2025, Item 1A Risk Factors"
- ALWAYS include EDGAR links when referencing specific filings
- NEVER make unsupported claims about disclosure practices
- When information is NOT found in the provided filing context, explicitly say so

## Output Format Rules
- For comparison queries: produce markdown tables with company columns
- For analysis queries: use headers + bullets, professional prose
- For memo-ready output: formal prose with hedging ("Based on the disclosed information...", "The filing indicates...")
- For quick lookups: concise, direct answers

## Filing Context
The following filing excerpts are provided as context for your analysis. Ground ALL answers in this context.

<filing_context>
{DYNAMIC_FILING_CONTEXT}
</filing_context>

If the user asks about information not present in the filing context above, say:
"This information is not available in the filing sections currently loaded. You may want to search for [specific filing type/section] to find this data."`;

export const SEARCH_INTENT_SYSTEM_PROMPT = `You are a SEC filing search query resolver.

Given a natural language research question, extract:
1. **entities**: Company names, tickers, CIK numbers
2. **filing_types**: 10-K, 10-Q, 8-K, DEF 14A, S-1, comment letters, etc.
3. **sections**: Item 1, Item 1A, Item 7, Item 8, Note X, etc.
4. **topics**: Revenue recognition, goodwill impairment, material weakness, etc.
5. **date_range**: Fiscal years or date bounds
6. **sic_codes**: Industry codes if sector is mentioned
7. **framework**: US GAAP (default), IFRS, Ind AS

Respond ONLY with valid JSON. No explanation.

Example:
Input: "How do SaaS companies disclose ARR as a non-GAAP measure in their 10-Ks from 2023-2024?"
Output:
{
  "entities": [],
  "filing_types": ["10-K"],
  "sections": ["Item 7"],
  "topics": ["non-GAAP measures", "ARR", "annual recurring revenue"],
  "date_range": { "start": "2023-01-01", "end": "2024-12-31" },
  "sic_codes": ["7372"],
  "framework": "US GAAP"
}`;

export const COMPARISON_SYSTEM_PROMPT = `You are a SEC disclosure comparison analyst.

You will receive disclosure sections from multiple companies' SEC filings.
Produce a structured comparison with these sections:

## Key Similarities
What disclosure patterns are common across all companies.

## Key Differences
Material differences in disclosure approach, language, or substance.

## Notable Outliers
Any company whose disclosure significantly deviates from the peer group.

## Trend Analysis
Changes in disclosure practices over time if multi-year data is available.

## Recommendation
What a practitioner should note when benchmarking their own disclosures.

Format as clean markdown. Use tables where comparing specific data points.`;

export const REDLINE_SUMMARY_PROMPT = `You are a SEC filing change analyst.

You will receive a text diff showing additions and deletions between two years of a SEC filing section.
Additions are marked with [+added text+]. Deletions are marked with [-deleted text-].

Summarize the MATERIAL changes only:
1. New risks or topics added
2. Risks or topics removed
3. Substantive language changes (not just rewording)
4. Quantitative changes (new numbers, changed thresholds)

Ignore: formatting changes, minor rewording without substance change, boilerplate updates.
Be concise. A controller reading this should know in 30 seconds what changed and whether it matters.`;
```

### 4.3 Anthropic Prompt Caching

This is the single biggest cost optimization. Anthropic's prompt caching gives a 90% discount on cached input tokens.

**How it works:**
- Add `cache_control: { type: 'ephemeral' }` to the system prompt message block
- On the first request, the system prompt is cached server-side by Anthropic
- On subsequent requests with the same system prompt prefix, cached tokens are charged at 10% of standard input rate
- Cache TTL: ~5 minutes (refreshed on each use)

**What to cache:**
1. **System prompt** (~3K tokens): Static across all requests. Cache always hits after first call.
2. **Filing context** (10K–100K tokens): When a user is exploring a specific filing, the filing content stays the same across multiple questions. Append it to the system prompt with `cache_control` so follow-up questions get the 90% discount.

**Cost impact:**
- Claude Sonnet 4.6 pricing: $3.00/1M input, $15.00/1M output
- Cached input: $0.30/1M (90% off)
- A 50K-token filing context viewed across 10 questions:
  - Without caching: 50K × 10 = 500K tokens × $3.00/1M = $1.50
  - With caching: 50K × $3.00/1M (first call) + 50K × 9 × $0.30/1M = $0.15 + $0.135 = $0.285
  - **81% savings**

### 4.4 Streaming (Server-Sent Events)

The copilot panel MUST stream responses. A 30-second wait for a complete response is unacceptable; streaming shows tokens arriving in <1 second.

```typescript
// app/api/copilot/route.ts
import { streamClaude } from '@/lib/claude';
import { SEC_RESEARCH_SYSTEM_PROMPT } from '@/lib/systemPrompts';
import { getFilingContext } from '@/lib/filings';

export async function POST(req: Request) {
  const { message, ticker, filingId, conversationHistory } = await req.json();

  // Assemble filing context
  const filingContext = filingId ? await getFilingContext(filingId) : '';
  const systemPrompt = SEC_RESEARCH_SYSTEM_PROMPT.replace(
    '{DYNAMIC_FILING_CONTEXT}',
    filingContext
  );

  // Stream Claude's response
  const stream = await streamClaude(systemPrompt, message, conversationHistory);

  // Convert to SSE stream
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
          );
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### 4.5 Extended Thinking (for Complex Queries)

Enable extended thinking for complex multi-document analysis (peer comparison, cross-framework questions). This lets Claude reason through the problem before responding, producing higher-quality analysis.

```typescript
// For complex queries only — adds ~$0.10-0.50 per query
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6-20250514',
  max_tokens: 16000,
  thinking: {
    type: 'enabled',
    budget_tokens: 10000 // Allow up to 10K tokens of internal reasoning
  },
  temperature: 1, // Required when thinking is enabled
  system: systemPrompt,
  messages: [...conversationHistory, { role: 'user', content: userMessage }],
});
```

**When to enable:** Peer comparison (2+ companies), cross-framework analysis (US GAAP vs IFRS), memo generation, complex regulatory questions.

**When to disable:** Simple lookups, filing navigation, single-company questions. Save cost.

---

## 5. Caching & Performance (Target: <5s P95)

### 5.1 Four-Layer Caching Architecture

```
Request → L1 (Query Dedup) → L2 (Intent Cache) → L3 (Prompt Cache) → Claude API
              ↓ HIT                ↓ HIT               ↓ HIT
          Return cached        Skip intent           90% token
          full response        resolution             discount
          <200ms               <500ms                 Faster TTFB
```

| Layer | Technology | What's Cached | TTL | Expected Hit Rate |
|-------|-----------|---------------|-----|-------------------|
| L1: Query Dedup | Vercel KV | Full response for exact query hash | 24 hours | 40–50% |
| L2: Intent Cache | Vercel KV | NL → structured intent mapping | 24 hours | 60–70% |
| L3: Prompt Cache | Anthropic API | System prompt + filing context tokens | ~5 min (auto-refresh) | 80%+ for multi-turn |
| L4: Pre-Computed | Vercel KV | Results for top 200 query patterns | 7 days | Covers first-time users |

### 5.2 Query Deduplication (L1)

```typescript
// lib/cache.ts
import { kv } from '@vercel/kv';
import crypto from 'crypto';

export function queryHash(query: string, filters: Record<string, any>): string {
  const normalized = query.toLowerCase().trim();
  const key = JSON.stringify({ q: normalized, f: filters });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export async function getCachedResult(hash: string) {
  return await kv.get(`qr:${hash}`);
}

export async function setCachedResult(hash: string, result: any, ttlSeconds = 86400) {
  await kv.set(`qr:${hash}`, result, { ex: ttlSeconds });
}
```

### 5.3 Pre-Computed "Starter" Results (L4) — Retired Proposal

This April proposal was never implemented beyond a placeholder. The Vercel schedule has
been removed, and `/api/cron/precompute` is now an authenticated, fail-closed tombstone.
Do not reinstate a background job that can spend model tokens without per-user controls;
the supported design is request-time, identity-scoped caching after authorization and
rate/cost enforcement. The patterns below remain historical product-research ideas only.

**Top 20 query patterns to pre-compute first:**
1. Revenue recognition disclosures by industry (SaaS, manufacturing, retail, financial services)
2. Material weakness disclosures (current year + remediation language)
3. Goodwill impairment triggers and testing methodology
4. Going concern disclosures
5. Related party transactions
6. Cybersecurity risk factor disclosures (post-SEC cyber rule)
7. Non-GAAP measure reconciliations
8. Lease accounting (ASC 842) implementation disclosures
9. DISE / ASU 2024-03 expense disaggregation early adopter disclosures
10. SEC comment letter trends by topic
11. Stock-based compensation disclosures
12. Segment reporting (ASC 280) disclosures
13. Income tax provision and uncertain tax positions
14. Debt covenant disclosures
15. Business combination / PPA disclosures (ASC 805)
16. Fair value measurement hierarchy (ASC 820)
17. Contingency and litigation disclosures (ASC 450)
18. Subsequent events disclosures
19. Critical audit matters (CAMs) in audit reports
20. Climate / ESG disclosure trends in 10-K risk factors

The old placeholder code and `vercel.json` cron example were removed because they did
not represent a working or cost-safe production feature.

### 5.4 Perceived Performance (UI)

Even with caching, some queries will take 5–10 seconds. Use progressive loading:

```typescript
// components/SearchResults.tsx
// Show stages to manage perceived latency
const LOADING_STAGES = [
  { after: 0, text: 'Analyzing your question...' },
  { after: 2000, text: 'Searching 500K+ SEC filings...' },
  { after: 5000, text: 'Found relevant filings. Generating analysis...' },
  { after: 10000, text: 'Performing deep analysis. Almost there...' },
];
```

---

## 6. Feature Specifications

### 6.1 Multi-Turn Copilot

**User flow:**
1. User opens a filing (e.g., Apple 10-K FY2025)
2. Copilot panel opens on the right side of the FilingViewer
3. User asks: "What are the key revenue recognition policies?"
4. Claude responds with cited analysis from the filing
5. User follows up: "How does this compare to their approach last year?"
6. Claude maintains context from turn 1 and references both years
7. After 8+ turns, system auto-summarizes conversation to stay within context limits

**State management:**
```typescript
// AppState.tsx (or Zustand/Jotai store)
interface CopilotState {
  activeFilingId: string | null;
  activeFilingContext: string; // Filing text loaded from search index
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  isStreaming: boolean;
}

// On filing change: clear conversation, load new filing context
// On turn 8+: summarize conversation via Claude, replace history with summary
```

**Conversation summarization (after 8 turns):**
```typescript
async function summarizeConversation(history: Message[]): Promise<string> {
  const response = await queryClaudeStandard(
    'Summarize this SEC research conversation in <500 tokens. Preserve all specific findings, citations, and open questions.',
    history.map(m => `${m.role}: ${m.content}`).join('\n\n')
  );
  return response.content[0].text;
}
```

### 6.2 Peer Comparison (AI Compare)

**User flow:**
1. User selects 2–5 companies via search chips
2. User selects disclosure section: Revenue Recognition, Risk Factors, Goodwill, etc.
3. System retrieves relevant sections from each company's latest 10-K
4. All sections sent to Claude with `COMPARISON_SYSTEM_PROMPT`
5. Claude returns structured comparison (similarities, differences, outliers, trends)
6. Rendered in Disclosure Matrix Panel
7. "Export to Memo" generates downloadable Word document

**Implementation:**
```typescript
// app/api/compare/route.ts
export async function POST(req: Request) {
  const { tickers, section, filingType = '10-K' } = await req.json();

  // Retrieve filing sections for each company
  const filingContexts = await Promise.all(
    tickers.map(async (ticker: string) => {
      const filing = await getLatestFiling(ticker, filingType);
      const sectionText = await extractSection(filing.id, section);
      return { ticker, companyName: filing.companyName, text: sectionText };
    })
  );

  // Build comparison prompt with all filing contexts
  const comparisonContext = filingContexts.map(f =>
    `<company ticker="${f.ticker}" name="${f.companyName}">\n${f.text}\n</company>`
  ).join('\n\n');

  const systemPrompt = COMPARISON_SYSTEM_PROMPT + `\n\n<filings>\n${comparisonContext}\n</filings>`;

  // Use extended thinking for complex multi-doc comparison
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 8192,
    thinking: { type: 'enabled', budget_tokens: 10000 },
    temperature: 1,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Compare the ${section} disclosures across these ${tickers.length} companies. Focus on material differences a practitioner would need to know for benchmarking.` }],
  });

  return Response.json({ analysis: response.content });
}
```

### 6.3 Year-over-Year Redlining

**Pipeline:**
1. Retrieve prior-year and current-year 10-K sections from filing index
2. Normalize: strip XBRL tags, normalize whitespace, standardize headers
3. Run `diff-match-patch` client-side for visual diff
4. Send additions/deletions summary to Claude for AI summary
5. Render: visual diff (green/red) + AI summary sidebar
6. Cache result in Vercel KV (TTL: 7 days, key: `redline:{ticker}:{section}:{yearPair}`)

```typescript
// lib/redline.ts
import { diff_match_patch } from 'diff-match-patch';

export function computeRedline(previousText: string, currentText: string) {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(previousText, currentText);
  dmp.diff_cleanupSemantic(diffs);

  // Convert to structured format for rendering
  return diffs.map(([op, text]) => ({
    type: op === 0 ? 'unchanged' : op === 1 ? 'added' : 'deleted',
    text
  }));
}

export function diffSummaryForClaude(diffs: Array<{ type: string; text: string }>) {
  // Extract only additions and deletions for Claude to summarize
  return diffs
    .filter(d => d.type !== 'unchanged')
    .map(d => d.type === 'added' ? `[+${d.text}+]` : `[-${d.text}-]`)
    .join('\n');
}
```

**Pre-computation (Phase 2):**
- Vercel Cron Job runs daily at 2 AM PT
- Pre-computes redlines for S&P 500 companies where new 10-K was filed
- Stores in Vercel KV: `precomp:redline:{ticker}:{section}:{yearPair}`
- Enables instant-load diffs for most-viewed companies

### 6.4 Search with Intent Resolution

**Flow:**
1. User types NL query: "How do SaaS companies disclose ARR as a non-GAAP measure?"
2. Check Vercel KV for L1 cache hit (exact query hash) → return cached result if found
3. Check Vercel KV for L2 cache hit (intent hash) → skip Claude intent call if found
4. On cache miss: call Claude with `SEARCH_INTENT_SYSTEM_PROMPT` to extract structured intent
5. Cache intent in Vercel KV (L2, 24h TTL)
6. Execute structured query against SEC EFTS and the enriched filing metadata store
7. Return filing results + optional AI summary
8. Cache full result in Vercel KV (L1, 24h TTL)

### 6.5 IFRS & Ind AS Content Layer

**Phase 1 (Curated Knowledge Base):**
- Build structured JSON/markdown files covering IFRS and Ind AS standards
- Index via separate search namespace
- Add framework toggle in SearchFilterBar: `US GAAP | IFRS | Ind AS`
- Claude system prompt updated to reference correct framework when filters active

**Phase 2 (Cross-Framework Research):**
- Enable queries like: "How should I account for a hedge under both ASC 815 and Ind AS 109?"
- Claude receives context from both framework knowledge bases
- System prompt includes cross-framework reconciliation instructions

---

## 7. Authentication & Analytics

### 7.1 Authentication (Clerk)
- Clerk for auth (SSO, email/password, social login)
- Tier gating: Partners (full access) → Managers → Staff (controlled rollout)
- API routes protected via Clerk middleware

### 7.2 Usage Analytics (PostHog or Mixpanel)
Track every query:
- Query text, intent extracted, results returned
- Time to first byte (TTFB), total response time
- Cache hit/miss (L1, L2, L3)
- Copilot: turns per session, filing sections explored
- Drop-off points (where users leave)

---

## 8. Sprint Plan (8 Weeks)

### Sprint 1 — Weeks 1–2: Foundation
**Goal:** Unblock partner feedback loop. Fix the two P0 issues (SSR + latency).

- [ ] Migrate to Next.js App Router (Vite → Next.js)
- [ ] SSR for landing page + company profile pages
- [ ] Dynamic og:image via @vercel/og
- [ ] Vercel KV setup + L1/L2 query caching
- [ ] Pre-compute top 20 query patterns (L4 cache)
- [ ] Deploy to Vercel Pro
- [ ] Verify: `curl` shows meta tags, LinkedIn preview card works

**Success:** LinkedIn share shows rich preview. Cached queries respond in <3 seconds.

### Sprint 2 — Weeks 3–4: Copilot Quality
**Goal:** Ship a copilot that practitioners trust.

- [ ] Claude Sonnet 4.6 integration with streaming (SSE)
- [ ] System prompt engineering (SEC_RESEARCH_SYSTEM_PROMPT)
- [ ] Anthropic prompt caching on system prompt + filing context
- [ ] Multi-turn conversation state management
- [ ] Conversation summarization after 8 turns
- [ ] Build 25-query benchmark suite, score accuracy
- [ ] Add Clerk authentication (partner-tier gating)

**Success:** Copilot accuracy ≥85% on benchmark. Multi-turn coherent across 10 turns.

### Sprint 3 — Weeks 5–6: Differentiating Features
**Goal:** Features that Intelligize charges $20K/seat for.

- [ ] YoY Redlining (diff-match-patch + Claude summary)
- [ ] AI Compare (peer disclosure comparison, 2–5 companies)
- [ ] Export-to-Memo (downloadable Word doc from comparison)
- [ ] Disclosure Matrix Panel UI
- [ ] Filing normalization pipeline (strip XBRL, standardize sections)

**Success:** Accurate diff for 10 test companies. Comparison output rated "client-ready" by 3 partners.

### Sprint 4 — Weeks 7–8: Moat & Scale
**Goal:** Differentiation that no competitor has + usage intelligence.

- [ ] IFRS/Ind AS curated knowledge base + framework filter toggles
- [ ] Cross-framework search (ASC 815 ↔ Ind AS 109)
- [ ] Pre-computed redlines for S&P 500 (Vercel Cron)
- [ ] PostHog/Mixpanel analytics integration
- [ ] Extended thinking enabled for complex queries
- [ ] SEC comment letter surfacing in search results

**Success:** Cross-framework query works. Auth gated. Analytics tracking all queries.

---

## 9. Verification Plan

### Automated
- [ ] SSR: `curl` test for `<meta>` and `og:` tags on landing + company profiles
- [ ] Load: k6/Artillery test — 100 concurrent users, P95 < 5s for cached queries
- [ ] Copilot: 25-query benchmark scored on accuracy, citations, hallucination
- [ ] Cache: Vercel KV hit rate monitoring (target: 50%+ L1 after 2 weeks)

### Manual
- [ ] LinkedIn Share: Deploy to staging, share URL, verify rich preview card
- [ ] Multi-Turn: Open 10-K, 5-turn conversation, verify context maintained
- [ ] Redline: Compare YoY diff for Apple, MSFT, Tesla risk factors vs manual review
- [ ] Partner Blind Test: 3 Uniqus partners × 5 real queries × 1–5 score

---

## 10. Open Questions

| # | Question | Recommendation |
|---|----------|---------------|
| 1 | Vercel Pro account: existing or new? | Set up immediately. $20/month. Blocks Sprint 1. |
| 2 | Anthropic API key: use existing or dedicated for Research Center? | Dedicated key with $500/month spend alert. |
| 3 | YoY redlining: pre-compute for all S&P 500 or on-demand only? | Start on-demand (Sprint 3), add pre-compute as cron job (Sprint 4). |
| 4 | SEC comment letters: are they in the current 5-year index? | Verify. If not, prioritize indexing — highest consulting-engagement value. |
| 5 | IFRS/Ind AS: full text indexing or curated knowledge base? | Curated KB first (faster, higher quality). Full index in v2. |
| 6 | Filing viewer: render full filing HTML or extracted text sections? | Extracted text sections. Full HTML is slow and hard to navigate. |
| 7 | Who manages the Vercel deployment? Sandip/Aarav or DevOps? | Sandip/Aarav for now. Move to DevOps after wider release. |

---

## 11. Cost Summary

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| Claude Sonnet 4.6 API | $800–$1,200 | At 5K queries/day with prompt caching |
| Vercel Pro | $20 | Includes KV, Edge Functions, Analytics |
| Vercel KV overages | $0–$50 | Based on query volume |
| Clerk auth | $0–$25 | Free tier covers initial rollout |
| PostHog analytics | $0 | Free tier for <1M events/month |
| **Total** | **$820–$1,295/month** | |

Compare: Intelligize charges $15K–$30K+ per seat per year. Uniqus Research Center's total infrastructure cost is less than a single Intelligize seat.

---

*This document is the source of truth for the Uniqus Research Center build. Use it as context when working with Gemini 3.1 Pro for development. Update the "Current Phase" section in your project's CLAUDE.md (or equivalent) as sprints complete.*
