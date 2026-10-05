# Uniqus Research Center vs Intelligize — gap analysis, October 2026

**Date:** 2026-10-04
**Basis:** code audit of `main` at `ecdce1a` (every claim below about URC cites a file), Intelligize's public product pages and press releases through September 2026, and the July 2026 licensed-session benchmark in [intelligize-benchmark-2026-07-25.md](intelligize-benchmark-2026-07-25.md).
**Weighting:** gaps are ranked by how often a daily Intelligize or URC user hits them, not by how large the feature is. The user in mind is an SEC reporting manager, technical accountant, or securities associate who opens the tool most working days. The usage ranking is judgment, not measured telemetry.
**Revision:** a second reviewer's assessment was checked claim by claim against the code and the cited Intelligize pages; see section 8 for what was confirmed, what was corrected, and what changed in this document as a result.

## 1. What changed since July

The July 25 action plan is largely done. Shipped between July 25 and September 2:

- Corpus total on every search ("N filings match, M validated and shown"), with an exact-count option above EDGAR's 10,000 ceiling.
- Full operator table: `P/n`, `*`, `?`, `#`, `$#`, `%#`, plus the `auditor:` field.
- Section-path breadcrumb on every hit; section-scoped search; "Cites Standard" ASC/ASU filter.
- Cross-form section taxonomy, year-over-year change matrix with Major/Moderate/Minor/New/Deleted buckets, chronological single-filer mode, Section Matrix.
- Excel export of results with an issuer sheet and a coverage sheet.
- Curated research library, saved peer sets, cite-to-memo from every evidence surface.
- Clerk gating, KV rate limits, fail-closed database roles, observability, accuracy gate in CI.

The search engine and the benchmarking core are now credible against Intelligize. The gaps have moved from "the search is thin" to "the research does not persist, the taxonomy is narrow, and several daily modules are shallower than their names imply."

## 2. What a daily Intelligize user does, and where URC stands

Ordered by frequency of use. Status is from the code audit.

| # | Daily workflow | Intelligize | URC today | Gap |
|---|---|---|---|---|
| 1 | Reopen yesterday's research: saved searches, alerts, peer groups, notes, tabs | Server-side, shared across devices and (for matrices and folders) with colleagues | **Everything is browser-local.** Watchlist, alerts, peer sets, memo tray, annotations and the accounting checklist are `localStorage`; research tabs are `sessionStorage` and die with the browser. No table in 25 migrations has a `user_id` or `org_id`. (`src/services/storageNamespace.ts`, `src/context/AppState.tsx:144-145`, `src/services/peerSets.ts:12`, `src/services/memoTray.ts:42`, `src/services/researchSessions.ts:46`) | **Severe.** This is the first thing a seasoned user notices and the one that stops them making URC their system of record. |
| 2 | Get told when a peer files something matching a saved search | Email alerts, scheduled server-side | Alerts are re-run in the browser when the Dashboard loads, 3 per load, 20 results each. No email library in the repo; the Resend key is still on the pending list. (`src/views/Dashboard.tsx:180-272`, [pending-keys-checklist.md](pending-keys-checklist.md)) | **Severe.** Monitoring that only runs when you visit is not monitoring. |
| 3 | Find precedent language in a specific section of a specific form | ~2,000 tagged sections and topics across 10-K, 10-Q, 20-F, S-1, S-3, S-4, F-1, 424B and proxies; topic tags for CAMs, non-GAAP, critical estimates, significant policies, pay-versus-performance | Two separate layers. The disclosure-topic library has **13 accounting topics** (revenue, leases, taxes, goodwill, segments, credit losses, business combinations, fair value, going concern, material weakness, CAMs, stock compensation, estimates) and drives the Text Redline. The cross-form section taxonomy behind section-scoped search and the YoY matrix has **five concepts** (Risk Factors, MD&A, Business, Legal Proceedings, Controls). Having a topic extractor does not give that topic the historical comparison workflow. Section Matrix knows 22 10-K rows but the other two surfaces use the five. **No DEF 14A sections at all.** (`src/services/disclosureTopics.ts`, `src/utils/sectionTaxonomy.ts:85-135`, `src/utils/sectionMatrix.ts:22-80`) | **Large.** Proxy season and notes-to-financials research are the two highest-volume use cases for the accounting audience; the first has no taxonomy and the second has topics but no footnote-level, period-aligned comparison. |
| 4 | Benchmark peers on one topic and see the whole peer set | Saved peer groups; index, market-cap and revenue bands; peer groups lifted from the proxy | SIC only. "Quick Peer Group" scans the first 400 entries of the ticker map and adds at most 5 peers. No proxy-disclosed peer groups, no size bands, no presets. Peer sets are browser-local. (`src/views/Benchmarking.tsx:472-510`) | **Large.** Every benchmarking session starts by rebuilding the peer set. |
| 5 | Research SEC comment letters on a topic | 516K letters; filters by topic, form, industry, date, resolution; a comment linked to its follow-up response | Threading into review episodes and server-stored episode summaries are good. But filters are **letter type and company only. There is no date filter, no topic filter, no form or industry filter, no export, and letters are not split into numbered comments.** Summaries read the first 5,500 and last 2,500 characters of each letter; anything in the middle of a letter longer than 8,000 characters is not seen. (`src/services/commentLetterPaging.ts:218-223`, `src/views/CommentLetters.tsx:40-47`, `src/services/commentLetterSummary.ts:26-29`) | **Large.** "What has the Staff asked about segment reporting since ASU 2023-07?" cannot be answered without a date filter, and "what response worked?" needs the specific comment-to-response pair, not an episode summary. |
| 6 | Navigate ASC guidance and track ASUs | Full Codification, ASUs, proposed ASUs, PCAOB, AICPA, IFRS, Big Four guidance filterable by firm and topic; collaborative 10-K/10-Q GAAP checklists linked to filings and letters | 20 curated ASC topics with FASB links; a grounded Ask-AI over an IFRS/Ind AS knowledge base of about 3 KB; checklist is browser-local and in-memory. (`src/config/accountingTopics.ts`, `src/views/AccountingHub.tsx:36-57`) | **Large.** Intelligize testimonials name "ASC navigation" and "ASU tracking" more often than any feature except benchmarking. Part of this is licensing (Codification text); part is pure build (ASU index, Big Four public handbooks, a real checklist). |
| 7 | Read a 150-page filing and jump between hits | Find-in-document, multiple snippets per hit, "View all hits", exhibits nested under the parent | The viewer highlights the incoming query's terms and scrolls to the first; **there is no find box**. One snippet per result; exhibits show as "+N more" with no expandable list. (`src/views/FilingDetail.tsx:1037`, `src/components/research/ResearchResultsWorkspace.tsx:380-391`) | **Medium, but felt constantly.** The README claims within-document search; the code does not have it. |
| 8 | Get work product into Word and Excel | Protégé exports tables, checklists, briefs to Word and PDF; Excel list; bulk download of sections across documents | Results to Excel, benchmarking to CSV/XLSX/DOCX, filing tables to CSV. **Memo tray exports Markdown only; comment letters export nothing; no bulk download; no document cart.** The `docx` dependency is already installed. (`src/components/memo/MemoTray.tsx:65-73`, `src/services/resultExport.ts`) | **Medium.** The memo is the product's best idea and it cannot leave the browser in the format practitioners use. |
| 9 | Search with synonyms or by concept | "Expand Keywords" synonym expansion; Conceptual search tab | None. The mode named `semantic` is a rule-based plain-language parser; the Support Center text says so. (`src/services/filingResearchPlan.ts:21`, `src/views/SupportCenter.tsx:96`) | **Medium.** Rename the mode now; build expansion later. |
| 10 | Establish that the relevant population was searched, not just that good examples were found | Whole corpus indexed; 4,077 result pages for "material weakness"; the count answers the filtered question | Each run validates at most 120 documents in a 45-second wave; the on-screen ceiling is 500 results. The headline is honest about this: when the user's filters can be pushed to EDGAR it says "N filings match", and when text-checked filters (section scope, filer status, cited standard, numeric operators) are in play it says "N upstream candidates, M validated matches shown", because EDGAR's total cannot reflect those filters. (`src/services/filingResearchExecution.ts:39-62`, `src/services/searchCoverage.ts:64-93`, `src/views/SearchPage.tsx:75-78`) | **Large for conclusions, medium for browsing.** "Which comparable companies disclosed a material weakness involving revenue recognition?" returns correct examples and no defensible prevalence. Showing a bigger upstream number does not fix this; only a search that keeps running past the interactive request, or an indexed universe, gives a count for the filtered question. |
| 11 | Pull tabular data: financial tables, compensation tables, pay-versus-performance | Table search, table extraction and cross-filer table comparison; iXBRL tag search | XBRL ratios in Accounting Analytics; filing tables to CSV one filing at a time. No table search, no comp-table extraction, no iXBRL tag filter. | **Medium for accountants, large during proxy season.** |
| 12 | Agreement and clause precedent (lawyers) | 47K tagged M&A contracts; clause and defined-term search | Six exhibit chips over EDGAR full-text; M&A deal fields and six clause types extracted by AI on demand and held in page memory only. (`src/views/ExhibitSearch.tsx:19-24`, `src/views/MAResearch.tsx:28-35,66`) | **Large for the legal audience, lower frequency for the accounting audience.** |

## 3. Module-by-module honesty check

Several pages carry Intelligize module names but are thinner than the name implies. A practitioner who knows the Intelligize module will test exactly these.

| Module | What URC actually does | Intelligize | Verdict |
|---|---|---|---|
| No-Action Letters | Scrapes the SEC.gov index page, max 500, no stored schema, no topic or division metadata (`src/services/officialSources.ts:251-266`) | 99K documents with position and topic metadata | Rename to "SEC.gov index" or build the schema |
| Enforcement | SEC litigation releases page only; no AAERs, no administrative proceedings (`src/services/secApi.ts:2372`) | Litigation releases, admin proceedings, AAERs | AAERs are what accountants want and the SEC publishes a plain index |
| Earnings | 8-K and 6-K EX-99.1 press releases, not call transcripts (`src/config/earnings.ts:1-5`) | Licensed transcripts | Label it "Earnings releases"; transcripts are a licensing decision |
| Insiders | Lists Form 3/4/5 filings; parses Form 4 XML for display only; no transactions table (`src/utils/ownershipForm.ts`) | Transaction-level insider data | Cheap to build: the parser exists |
| ESG | Static framework links plus an on-demand AI heat map of the latest 10-K (`src/views/ESGResearch.tsx:109-159`) | Year-by-year ESG topic visual across filings, transcripts and reports | On-demand only; nothing accumulates |
| Boards | AI extraction from the DEF 14A on demand, memory-cached (`src/services/boardProfiles.ts:51,201`) | No direct equivalent | A URC advantage, but it evaporates on reload |
| Accounting hub | See row 6 above | Standards and Guidance module | The widest content gap after the taxonomy |
| Company dossier | 15 most recent filings, letter episodes, 10 XBRL metrics (`src/services/companyData.ts:11`, `src/components/research/DossierTabs.tsx:63-72`) | Full company view | Thin for a "360" page |

## 4. Where URC is ahead, and three claims to retire

Genuine advantages, to defend and market:

- **Coverage honesty.** Every result pane states complete versus partial coverage, which query branches were fully examined, and whether a count is a verified total or an upstream candidate count. Intelligize shows a count and nothing about how it was computed.
- **Auditor attribution by filing date.** PCAOB Form AP attributed as of each filing (`022_temporal_auditor_attribution.sql`) and `auditor:` as an inline operand composable with proximity. Intelligize also carries Form AP in Accounting Analytics, so the data itself is not unique; the temporal attribution and the operator are.
- **XBRL financials beside disclosure text.** Accounting Analytics computes ratios live from company facts. Intelligize extracts tables but is text-centric.
- **Agentic range.** A 20-action planner that resolves companies, finds sections, builds cohorts, drafts and exports, with an evidence packet on every answer and a CI accuracy gate behind it.
- **Freshness.** Full text is live EDGAR; filing metadata refreshes daily.
- **Price and practice integration.** Infra pennies against a five-figure seat, and a Topic Champion network LexisNexis cannot copy.

Claims from the July documents that do not survive a check against Intelligize's current pages:

- **"Modules Intelligize lacks: IPO, M&A, ADV, Boards, litigation releases."** Intelligize's filings-search page lists ADV registrations, board profiles and compensation, and SEC administrative and enforcement releases as content sets; its homepage advertises IPO-readiness analytics and its law-firm page 47K M&A contracts. URC's versions of these are built differently, not exclusively.
- **"Intelligize is US-GAAP only; IFRS is ours to take."** Intelligize's Accounting Standards and Guidance module includes IFRS standards. What remains open is IFRS and Ind AS *filer* analysis and cross-framework mapping, and URC has not built that either: the Ind AS and IFRS knowledge base behind the Accounting Hub is about 3 KB.
- **"AI is a URC differentiator."** Protégé offers multi-turn research, 20-filing structured comparison, visible search logic, cited outputs and Word export. URC's edge is the action planner, the model and the drafting depth, not the presence of AI. Persistence of the conversation and output formats currently favour Intelligize.

## 5. What Intelligize did in 2026 that matters

- **March 2026, Protégé in Intelligize+ AI:** multi-turn research that keeps context; benchmarking across up to 20 filings into tables and executive summaries; visible Boolean and conceptual search logic on every answer; export to Word and PDF; a sample-prompt library; a human Customer Research Team to validate AI findings.
- **August 2026, LexisNexis Legal Intelligence Engine:** Protégé rebuilt as an agentic harness that plans before it runs, lets the user edit the plan, pulls Intelligize content into Lexis+ drafting, outputs Word, Excel and PowerPoint, and carries session memory. Intelligize is becoming a content source inside a larger assistant.

Implications: URC's AI is at least as capable per request, but it loses on **persistence of the conversation** (agent runs live in React memory, cleared on reload, `src/context/AppState.tsx:311`) and on **output formats**. Visible search logic is something URC already has in the evidence packet and should expose more prominently.

## 6. Recommendations, in order

The central accounting workflow is: find the companies facing this issue, read what they disclosed, compare their treatment, check what the Staff asked, and save something a reviewer can reopen. Each item below removes a break in that chain. Items 1 and 2 are a tie for first: one decides whether a user comes back, the other decides whether a conclusion can be defended.

1. **Make research durable: a named project, not just saved objects.** One Supabase schema with `user_id` and `org_id` under RLS holding the question, filters and peer population; selected filings, exact excerpts and notes; comparisons and exports; reviewer comments and a dated evidence snapshot. Saved searches, alerts, peer sets, memo tray, annotations, research tabs and agent conversations all hang off it. Migrate the existing `localStorage` payloads on first login. This connects features that already exist; it must not become another destination.
2. **Answer the filtered question completely.** Let a search keep validating past the 120-document wave as a resumable server job and page results in as they complete, so the headline can reach a verified total for text-checked filters. Define and publish the indexed issuer universe and its historical coverage. Extend the accuracy gate, which today checks reference probes and expected accessions, with topic-level recall sets so missed filings are measured alongside wrong ones.
3. **Evaluate alerts on a schedule and email them.** A daily GitHub Action against the persisted saved searches, Resend for delivery, deduplication across amendments, and a digest that quotes the new or changed passage. The pipeline pattern already exists in `data-refresh.yml`.
4. **Footnote-level comparison on the existing benchmarking system.** Deepen revenue, segments, income taxes, leases, goodwill, business combinations, non-GAAP and internal controls first: individual notes and subtopics, their tables, reporting-period alignment, and an explicit difference between "not disclosed" and "could not extract". Promote these topics, plus the DEF 14A sections (CD&A, summary compensation table, pay-versus-performance, director compensation, audit fees, related-party transactions), into the shared taxonomy so each one gets section-scoped search, the YoY matrix and the Section Matrix at once. Keep the token-ratio change buckets, but add a generated explanation of what changed and why a reviewer might care; the AI redline summary in the filing viewer is the model for this and the matrix has none.
5. **Comment letters at the issue level.** Date, form and industry filters are query changes on `urc_comment_letters`. Split UPLOAD letters into numbered Staff comments and pair each with its response and follow-up, cite the exact response, link to the affected filing section, and offer "similar comments". Mark an issue resolved only when the correspondence shows it. Lift the 8,000-character head-and-tail read so long letters are summarised whole. Add CSV and Word export.
6. **Peer groups that build themselves.** Extract the compensation peer group from the DEF 14A (the Board Profiles extractor already reads that document), add market-cap bands from `dei:EntityPublicFloat` and index membership, remove the 400-entry and 5-peer caps, and store the result in the project from item 1.
7. **Filing viewer find-in-document, multiple snippets, all hits per filing.** Correct the README until the find box exists.
8. **A reviewer-ready workpaper with little manual assembly.** Word export for the memo tray, AI compare and comment-letter episodes (the `docx` dependency and `docExport.ts` already exist); a cart that selects documents across searches and bulk-downloads a chosen section; and an evidence package that records the search, filters, document versions, model and generation date so a reviewer can reopen it. This is the output the whole chain exists to produce.
9. **Accounting hub as an issue page before it is a standards library.** For each of the 13 topics, one page that joins URC precedents, related Staff comments, the authoritative external references (ASC topic, ASUs, SAB), and reviewed Uniqus guidance. Index every ASU and proposed ASU from public PDFs and link each to filings through the existing "Cites Standard" filter. Make the checklist a persisted, assignable object linked to filings and letters. Codification text, Big Four handbooks, transcripts and firm memos remain licensing decisions.
10. **Cheap fixes that remove embarrassment:** an insider transactions table from the existing Form 4 parser; AAERs from the SEC's public index; persist Board and M&A extractions instead of re-running them per page load; rename the `semantic` mode and the "Earnings" label to what they are.

Deferred for the accounting audience: transcripts and news licensing, deeper ADV functionality, deal-term analytics. Clause and defined-term search would move into the top five if securities lawyers become the primary users.

## 7. Positioning note

Intelligize's durable advantage is twenty years of tagging and the human research team behind it. URC should not chase tag-for-tag parity, and it should stop describing IFRS, PCAOB data or AI as things Intelligize lacks. The strongest position available is an accounting research workflow that combines a population the user can trust was searched, footnote-level comparisons, issue-level Staff correspondence and Uniqus practice judgment, and ends in a reviewer-ready workpaper. Match Intelligize on the daily five (persistence, alerts, section-scoped precedent search, peer benchmarking, comment letters) and win on coverage honesty, financials beside text, agentic drafting and the practice network. The July 19 principle still holds: **deepen the research system before expanding the navigation.**

## 8. Second review: what was verified

A second reviewer's assessment was received after the first draft. Each of its code citations and source links was checked.

Confirmed, and integrated above:

- 120-document and 45-second limits per run (`src/services/filingResearchExecution.ts:39-62`).
- 13 disclosure topics in one layer and five taxonomy concepts in another (`src/services/disclosureTopics.ts`, `src/utils/sectionTaxonomy.ts`).
- Research tabs in `sessionStorage`, memo tray in `localStorage` (`src/services/researchSessions.ts:245-251`, `src/services/memoTray.ts`).
- Comment-letter summaries read 5,500 head and 2,500 tail characters of each letter (`src/services/commentLetterSummary.ts:26-29`).
- The accounting page is a curated ASC directory with external links (`src/views/AccountingHub.tsx:594`).
- Dashboard-triggered alert checks, three stale alerts per load (`src/views/Dashboard.tsx:180`).
- Change buckets are token-change ratios of 25, 10 and 2 percent with no explanation layer (`src/utils/sectionDiff.ts:46-48`); the YoY matrix calls no model.
- Intelligize advertises alerts across filings, regulations and comment letters, extractable financial and compensation tables, and peer-group filters by index, revenue and market cap (filings-search page). Its accounting module lists IFRS standards and PCAOB Form AP (accounting-solutions page). The "retire the IFRS, PCAOB and AI uniqueness claims" point stands, and section 4 above was rewritten accordingly.

Qualified:

- The reviewer warned against treating upstream totals as a near-complete answer. The shipped headline already distinguishes "filings match" (verified) from "upstream candidates" (unverified), so the display is honest. The underlying point is still right: for text-checked filters the user gets no population count, and a bigger upstream number would not change that. Row 10 and recommendation 2 reflect this.
- "Measure missed results as well as incorrect results." The accuracy gate already checks reference probes and independently expected accessions (`scripts/accuracy/gate.ts:1602`, `scripts/accuracy/evaluator-validity.ts:553`). What I did not find is a topic-level recall set; recommendation 2 asks for that rather than for recall measurement from scratch.

Not supported by the cited source:

- The reviewer cited Intelligize's "Life of a Company" deck for a documented save-documents-and-tabs workspace. That deck shows clause-level S-1 search, "What's Market" analytics and comment-to-response linking; it does not show a workspace. The workspace claim is nonetheless true: the July 25 licensed session observed per-row bookmarks and a Save Tabs control. The claim is kept; the citation is replaced.

## Sources

- [Intelligize+ AI, Protégé evolution, March 30 2026](https://www.intelligize.com/insights/press-releases/intelligize-ai-unveils-next-evolution-of-protege-for-deeper-unified-sec-filings-research/)
- [Intelligize AI page](https://www.intelligize.com/ai/)
- [Intelligize accounting solutions](https://www.intelligize.com/solution/strategy/accounting-solutions/)
- [Intelligize for public companies](https://www.intelligize.com/solution/public-companies/) and [for law firms](https://www.intelligize.com/solution/law-firms/)
- [Intelligize SEC filings search and content sets](https://www.intelligize.com/solution/strategy/sec-company-filings-search/) and [peer benchmarking](https://www.intelligize.com/solution/strategy/peer-benchmarking/)
- [Intelligize "Life of a Company" deck](https://www.intelligize.com/wp-content/uploads/2023/04/Life-of-a-Company.pdf)
- [LawNext on the LexisNexis Legal Intelligence Engine, August 2026](https://www.lawnext.com/2026/08/lexisnexis-unveils-legal-intelligence-engine-rebuilding-protege-around-dynamic-agentic-orchestration.html)
- [Finrep, AI tools for SEC filing research, July 2026](https://www.finrep.ai/blog/ai-tools-for-sec-filing-research-compared-2026-guide)
- Prior internal work: [intelligize-feature-gap-analysis-2026-07-19.md](intelligize-feature-gap-analysis-2026-07-19.md), [intelligize-gap-roadmap-2026-07.md](intelligize-gap-roadmap-2026-07.md), [intelligize-benchmark-2026-07-25.md](intelligize-benchmark-2026-07-25.md)
