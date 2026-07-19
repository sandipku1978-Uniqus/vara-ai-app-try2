# URC UX audit — through a technical accountant's eyes (2026-07-19)

Persona: SEC reporting manager / technical accountant at a filer or advisory firm.
Their real jobs, in frequency order:

- **J1** "How do peers disclose / account for X?" (precedent language)
- **J2** "Draft a response to this SEC comment" (comment-letter precedent)
- **J3** "Benchmark us vs. peers" (metrics + disclosure depth)
- **J4** "What does the standard actually require?" (standards reference)
- **J5** "Tell me when something new happens" (monitoring)
- **J6** "Turn what I found into a memo" (deliverable)

Framework: Uniqus enterprise-ui-ux design system (3-second rule, progressive
disclosure, trust signals, HITL patterns).

---

## The one-sentence verdict

The data under the product is now excellent; the UI still makes the accountant
do the connecting. The biggest wins are (a) a company-centric "issuer dossier"
so research pivots around *companies*, (b) topic-first entry points so users
don't have to invent search syntax, and (c) making every result exportable into
the memo workflow.

---

## Global findings (affect every screen)

| # | Finding | Why it hurts | Change |
|---|---|---|---|
| G1 | **17 flat sidebar items** across loosely labeled groups; jobs are scattered (search on 3 pages, letters separate, benchmarking separate) | Accountant must already know the product's taxonomy to start | Regroup nav by job: **Research** (Workbench, Comment Letters, Exhibits), **Benchmark** (Compare, Analytics), **Monitor** (Dashboard, Alerts, 8-K events), **Reference** (Standards, Regulation, No-Action, Enforcement). Demote API Portal/Support to footer |
| G2 | **No breadcrumbs anywhere**; back button is the only wayfinding | Violates the design system's non-negotiable; deep links feel like dead ends | Add `Home > Research > [query] > [Filing]` breadcrumb bar |
| G3 | **No company/issuer hub.** `company/[ticker]` exists but is hardcoded to 8 tickers (audit F22) and shows filings only | Accountants think issuer-first ("what's going on at Coinbase?") — the platform thinks form-first | Build the **Issuer Dossier**: header (name, ticker, SIC, exchange, **current auditor**, filer status) + tabs: Filings / Comment Letters (threads!) / Financials / Peers. All the data now exists in Supabase. Every company name anywhere links here |
| G4 | **No ⌘K command palette** | Fastest-growing expectation from Stripe/Linear-class tools; time-starved users navigate by keyboard | Global palette: type a ticker → dossier; a topic → search; a page name → navigate |
| G5 | **No "send to memo" from result sets.** Generate Memo exists only inside Accounting Hub | J6 is the endpoint of every other job; today users screenshot/copy-paste | Persistent "Add to memo" action on every result row, letter thread, and comparison — accumulating into a memo drafting tray (this *is* the memo.AI on-ramp) |
| G6 | **Trust signals incomplete.** "SEC EDGAR LIVE" chip is good; AI outputs show no model/confidence; auditor/letter layers show no freshness | Design system §1.4: accountants won't cite what they can't source | Footer chip per data layer ("Auditors: PCAOB Form AP · Jul 19", "Letters: 500,248 docs"); model + confidence chip on every AI panel |
| G7 | **Dark-mode-only mindset.** Research output gets pasted into memos/emails; light mode exists but printing a thread or comparison produces dark rectangles | Deliverables live in Word/print | Print stylesheet + "Copy as citation" (Company · Form · Date · URL) on filings and letters |
| G8 | **Click-targets that aren't buttons** (thread rows, dashboard cards are divs) | Keyboard users and screen readers can't operate them; WCAG failure | Make rows `<button>`/links with focus rings; add Enter/Space handlers |

## J1 — Precedent research (Research Workbench)

| # | Finding | Change |
|---|---|---|
| R1 | "Boolean / Proximity" toggle is engineer language; `w/10` syntax is Intelligize-user knowledge | Rename to "Exact phrases & near-terms" with inline hint `"lease" w/5 "incremental borrowing rate" — within 5 words`; keep chips as the teacher |
| R2 | Result reason label says "Matched filing metadata" — tells the accountant nothing | Show *what* matched: "Matched: 'material weakness' in Item 9A" (data exists in match reasons; surface the term + section when known) |
| R3 | "Auditor unavailable" repeats on every card while enrichment backfills | Suppress the row when unknown, or one-time banner: "Auditor facets cover 2017+ (PCAOB Form AP)" |
| R4 | No sort control (relevance is default; accountants often want newest-first for adoption questions) | Sort toggle: Relevance / Newest — wired to the (already fixed) preferRelevance path |
| R5 | No peer-set concept: watchlist exists on Dashboard but can't be used as a search filter | "My watchlist" chip in filters → scopes search to those CIKs (EFTS supports ciks) |
| R6 | Saved searches ("Save Alert") live in localStorage — invisible on a second device, no notification | Label honestly ("saved in this browser") until server-side alerts ship; prioritize that roadmap item |

## J2 — Comment-letter work (new page)

| # | Finding | Change |
|---|---|---|
| L1 | Search requires knowing the phrase; accountants often start from a *topic* | Topic chips above search: Revenue (ASC 606) · Segments (ASC 280) · ICFR/MW · Non-GAAP · Goodwill · Climate — each a canned, tuned query |
| L2 | No issuer filter — can't pull "all letters for CIK/ticker X" | Company autocomplete filter (join urc_sec_companies) + link from Issuer Dossier |
| L3 | Round-count is the accountant's severity signal but isn't emphasized | Badge threads "4 rounds · 53 days" — long reviews = rich precedent; sortable |
| L4 | "Ask Copilot" thread prompt references the thread id, but the copilot has no tool to *fetch* the thread text | Give the copilot a letters tool (server-side call to /api/letters?thread=) so summaries are grounded in the actual letters — until then the button under-delivers |
| L5 | No outcome signal (did the Staff accept?) | Phase-2: Claude batch pass tagging threads with topic + resolution ("resolved after 2 rounds; company added disclosure") — becomes THE differentiator vs Intelligize |

## J3 — Benchmarking

| # | Finding | Change |
|---|---|---|
| B1 | FY columns hide fiscal-year misalignment (Jan-FYE retailer vs Dec-FYE peer under one "FY2024" header) — audit F7 still open | Show period-end date under each column header: "FY2024 · ended 2024-01-28" |
| B2 | Auditor row still text-scraped/unavailable | Wire to urc_current_auditors — exact, and consistent with search facets |
| B3 | No common-size view | Toggle: absolute / % of revenue — accountants normalize instinctively |
| B4 | Export is CSV-ish at best; deliverables are Excel | XLSX export with number formats on every table (comparison, ratios) |

## J4 — Standards hub
Solid bones (workflows, DISE/ASU chips, Generate Memo). Fix "TOP AUDITOR:
Unknown" (same B2 wiring); add cross-links from a standard to (a) precedent
search preloaded, (b) comment letters on that topic (L1 chips reused).

## J5 — Monitoring (Dashboard)
| # | Finding | Change |
|---|---|---|
| D1 | Filing-volume-by-industry chart is decoration; the accountant's question is "what changed for MY names/topics?" | Replace hero with: Watchlist activity + saved-search hits + **letter threads updated** (we have this data); volume chart moves to L2 |
| D2 | KPI cards don't drill into filtered views (3-second rule half-passes) | Every card click-through to the corresponding filtered list |
| D3 | Watchlist add is ticker-only, no confirmation of what it monitors | On add: "Monitoring filings + comment letters + auditor changes" checklist |

## Quick wins vs. structural

**Week 1 (mostly wiring data that already exists):** R2, R3, R4, B2, L2, L3,
D2, G6 freshness chips, G8 button semantics, standards-hub auditor fix.

**Weeks 2–4 (product-shaping):** G3 Issuer Dossier (highest single lever — it
composes everything built today), G1 nav regroup + G2 breadcrumbs, L1 topic
chips, G5 memo tray v1, B1/B3/B4, L4 copilot letters tool, G4 ⌘K palette.

**Strategic (with memo.AI):** L5 thread outcome tagging; memo tray → memo.AI
drafting with embedded citations; peer-set management as a first-class object
shared across search/benchmark/letters.

---
*Method note: audited against the Uniqus enterprise-ui-ux design system via
live walkthrough (desktop + narrow viewport) plus code-level review of all 33
views. One environment caveat: the embedded browser could not reliably type
into the workbench's search input — retest Enter-to-search across browsers with
real users; if reports corroborate, wrap the input in a proper form element.*
