# URC vs Intelligize+ AI — gap analysis & upgrade roadmap (2026-07-19)

Reference points: Intelligize (LexisNexis), ~$15–30K/seat/yr. Launched
"Intelligize+ AI" Jul 2024; Mar 2026 Protégé update benchmarks up to 20
filings with generated tables/executive summaries. Strengths: decades of
curated + proprietarily tagged content, linked comment-letter threads,
defensible-research positioning.

URC stack today (post accuracy overhaul + Elastic replacement): Next.js 16 on
Vercel; live EDGAR EFTS full text; Supabase facet layer (PCAOB Form AP
auditors ×154,884, filing metadata 2025+ ×356,620, daily/weekly GH Actions
refresh); Claude AI layer (copilot / compare / redline / extraction) with
hardened grounding; XBRL financial benchmarking (numerics fixed).

## Where we already win
- **AI depth**: frontier Claude vs their Protégé; generative drafting, not
  just summarization. Grounding + honest-missing-data now enforced.
- **Financial benchmarking**: XBRL metrics + ratios alongside disclosure text
  (Intelligize is disclosure-text-centric).
- **Freshness**: text always live EDGAR; their content pipeline has lag.
- **Cross-framework potential**: IFRS / Ind AS (Intelligize is US-only) — not
  yet built, but structurally ours to take.
- **Cost**: ~$25–50/mo infra vs a single seat costing $15–30K/yr.
- **Uniqus integration**: TCA topic champions + practice knowledge — LexisNexis
  cannot replicate.

## Where Intelligize is ahead (the gap list)
| Gap | Their capability | Our state |
|---|---|---|
| Comment-letter threading | UPLOAD↔CORRESP linked into conversations w/ resolution | Raw letters only, unthreaded |
| Facet depth | Industry, filer status, law firm, exchange, IPO date, topic tagging | Auditor + form + date (SIC/exchange columns exist, unpopulated) |
| Historical depth | Decades | Facets 2025+; text 2001+ |
| Precedent search | Proprietary disclosure topic tagging | Keyword-only |
| Agreements/clauses | Tagged exhibit/agreement database | Basic exhibit search |
| Multi-doc AI benchmark | 20 filings → tables + exec summary | 10 filings, weaker section extraction |
| Enterprise trust | Auth, audit trail, SOC2, support | No auth (Claude endpoint open!), no audit trail |
| Alerts | Server-side monitored alerts | Client-side localStorage only |

## Roadmap

### Phase 1 — Trust + facet parity (1–2 weeks)
1. **Clerk auth gating + per-user rate limits** on all AI routes (also closes
   the open-token-burn hole verified in prod). Blocker for any partner rollout.
2. **Populate `urc_sec_companies`** from EDGAR bulk submissions data (SIC,
   tickers, exchange, state) + `dei:EntityFilerCategory` for filer-status —
   turns the empty facet columns into working Industry / Filer-status filters.
3. **Server-side alerts**: alerts table + daily GH Action evaluating saved
   searches → email (Resend). Kills the localStorage-only limitation.
4. **Model upgrade** off pinned claude-sonnet-4-6 + post-generation citation
   validator (port TCA's pattern).

### Phase 2 — The crown-jewel gap (2–4 weeks)
5. **Comment-letter threading**: link UPLOAD↔CORRESP by CIK + file number +
   date adjacency into conversation threads; Claude thread summaries ("what
   did the Staff push on, how was it resolved, how many rounds"). Buildable
   entirely from free EDGAR data; this is Intelligize's most-cited feature.
6. **Deepen facet backfill to 2001+** (Supabase Pro, $25/mo) so facets cover
   the full text-search window (~2–4M more rows).

### Phase 3 — Leapfrog (1–2 months)
7. **Semantic precedent search**: extract + embed key sections (Risk Factors,
   MD&A, targeted notes) for a curated universe (S&P 1500) into pgvector;
   "find disclosure examples like X" + Claude drafting *from* precedents —
   beats topic tagging.
8. **20-filing AI benchmarking** with the structured section parser + generated
   comparison tables (match their Mar-2026 Protégé move, add drafting).
9. **IFRS / Ind AS layer** — the differentiator Intelligize structurally
   cannot follow; curated KB first (per original April plan).
10. **TCA ↔ URC loop**: champions cite URC filings; URC escalates technical
    questions to champions. One research fabric across both products.

## Positioning
Don't chase Intelligize's 20 years of tagging seat-for-seat. Win on AI
drafting quality, cross-framework coverage, Uniqus practice integration, and
price — as the internal practice tool and a client-facing differentiator.
Every engagement that would have justified an Intelligize seat now costs
infra pennies.
