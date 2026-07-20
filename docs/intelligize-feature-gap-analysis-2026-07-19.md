# Intelligize feature gap analysis

**Date:** July 19, 2026  
**Scope:** Product comparison and improvement opportunities only; this document is not an implementation plan.

## Executive summary

The website already covers many Intelligize-shaped modules. The largest opportunity is not adding more destinations; it is making research persistent, connected, curated, and defensible.

An experienced Intelligize user will expect:

- Research that survives across sessions and can be shared.
- Filings, comments, exhibits, rules, and standards linked together.
- Curated topics and clauses rather than only keyword matches.
- Batch workflows for collecting, comparing, exporting, and monitoring.
- Transparent evidence and reproducible results.

Intelligize promotes nearly 2,000 tagged sections and topics, “What’s Market” analytics, reusable peer searches, precise alerts, connected content, and document-cart batch operations. Its current AI experience analyzes up to 20 filings with visible search logic and Word/PDF-ready outputs.

The product should therefore focus on deepening the central research workflow rather than continuing to add standalone modules.

## Existing strengths

The earlier internal gap roadmap is partly outdated. The current product already includes:

- Natural-language, Boolean, and proximity search.
- Substantial issuer, filing, auditor, SIC, exchange, location, accounting-framework, and filer-status filters.
- Search tabs and a split-pane filing preview.
- Search-level trend insights and alert creation.
- Filing redlines, annotations, table extraction, PDF output, and AI analysis.
- Threaded comment-letter conversations with review-episode summaries.
- Financial, disclosure-text, and audit comparison with inputs capped at 20 companies.
- A strong Copilot foundation with citations, evidence packets, action logs, and filing-level navigation.

These capabilities should be extended instead of replaced.

## Highest-value feature gaps

| Priority | Area | Current state | Improvement opportunity |
|---|---|---|---|
| P0 | Persistent research workspaces | Search tabs live in `sessionStorage`; watchlists, alerts, and annotations are browser-local. | Create cloud projects containing saved searches, selected documents, annotations, peer sets, reports, and Copilot conversations. Support folders, sharing, ownership, and reopenable research history. |
| P0 | Real alert delivery | Alerts are saved locally and checked from the dashboard. | Add scheduled server-side evaluation, email and in-app delivery, daily digests, frequency controls, and section-level change explanations showing exactly what triggered an alert. |
| P0 | Curated topic and section taxonomy | Search offers strong metadata filters, but section keywords remain text filtering. | Index filings by normalized Item, section, subsection, footnote, table type, accounting topic, risk topic, and disclosure concept. Add post-search facet counts, synonym expansion, similar-disclosure discovery, and topic-frequency analytics. |
| P0 | Connected-document graph | Filings, letters, exhibits, regulations, standards, and company dossiers are largely separate modules. | Connect a filing to amendments, incorporated exhibits, comment-letter episodes, changed disclosures, cited rules, related ASC topics, enforcement matters, and prior-year versions. Surface amended and SEC-comment badges directly in results. |
| P0 | Dedicated source fidelity | Some named collections appear to approximate their content through generic EDGAR searches. For example, the No-Action Letters page searches `CORRESP`, `UPLOAD`, and `NSAR`. | Build authoritative, collection-specific ingestion and schemas for no-action letters, regulatory releases, staff guidance, registered offerings, and enforcement. This is essential for practitioner trust. |
| P1 | Issue-level comment-letter intelligence | Conversations and summaries exist, but the review unit remains the whole letter or a truncated preview. | Segment every letter into individual staff comments and corresponding responses. Add issue, examiner, law firm, status, round count, resolution, and affected-filing-section filters. Offer similar-comment discovery and show how the disclosure ultimately changed. |
| P1 | Agreement and clause intelligence | Exhibit search has six exhibit families, while M&A performs limited, on-demand AI extraction over five deal fields and six clause types. | Persistently parse and index clauses, definitions, parties, compensation terms, deal points, covenants, conditions, and cross-references. Enable clause-level search, side-by-side comparison, market-frequency statistics, and complete deal packages. |
| P1 | Reusable peer cohorts | Users can manually add companies or discover peers primarily through SIC. | Add one-click peers extracted from proxy disclosures, market-cap, revenue, and assets filters, saved cohort versions, custom peer lists, and reuse of a cohort across search, benchmarking, comments, ESG, and alerts. |
| P1 | Document cart and batch review | Some table modules export CSV and benchmarking exports XLSX/DOCX, but the main research workbench lacks a multi-select research cart. | Let users select filings across searches, deduplicate them, add them to a project, bulk download or export them, compare chosen sections, and run Copilot only over the selected corpus. Preserve citations in every output. |
| P1 | Compliance and drafting workspaces | The accounting checklist is currently a small in-memory list, while standards search mainly links to FASB. | Add persistent 10-K, 10-Q, S-1, accounting-policy, and disclosure checklists linked to rules, standards, peer examples, and comment letters. Include owners, due dates, evidence, review status, versioning, and Word export. |
| P2 | Company 360-degree dossier | The dossier currently focuses on filings, comment letters, and latest-year financials. | Add amendments, exhibits, governance documents, insider activity, transcripts and Q&A, investor presentations, ESG reports, enforcement, news, analyst material, peer groups, and active alerts in one timeline. |
| P2 | Personalized analytics dashboard | Filing-volume cohorts and research themes are currently fixed in code. | Offer configurable widgets driven by saved cohorts and searches: new filings, SEC review intensity, disclosure adoption curves, accounting-rule adoption, active deals, and upcoming reporting tasks. |
| P2 | Enterprise collaboration and auditability | Clerk UI and AI rate limiting exist, but research objects are not organization-scoped. | Add organizations, role-based access, SSO, team templates, audit history, retention controls, report approvals, source snapshots, and reproducibility records. Extend the Copilot evidence view into a downloadable research audit package. |

## Detailed comparison

### 1. Persistent research workspaces

The current product has useful research tabs, but the state is temporary and device-specific. This will feel fragile to an experienced Intelligize user who expects research to be saved, organized, and reused.

A first-class workspace should support:

- Named projects and folders.
- Saved searches and filters.
- Selected documents and document collections.
- Filing annotations and team notes.
- Saved peer groups.
- Copilot conversations and evidence packets.
- Shareable read-only or collaborative links.
- Research history and versioning.

This is the most important platform-level gap because it turns individual features into an ongoing workflow.

### 2. Server-side monitoring and alerts

The current alert experience is useful as a prototype, but alerts are stored locally and checked through the dashboard. A professional monitoring workflow should run whether or not the user opens the site.

Recommended alert capabilities include:

- Immediate, daily, weekly, and custom schedules.
- Email, in-app, and digest delivery.
- Alerts based on companies, cohorts, forms, topics, clauses, comments, and accounting standards.
- Deduplication and amendment handling.
- A highlighted explanation of the new matching language.
- Alert ownership, sharing, pausing, and expiration.
- A review state such as unread, reviewed, assigned, and dismissed.

### 3. Topic taxonomy and “What’s Market” analytics

The current search filters are broad, but they do not yet provide the curated disclosure taxonomy associated with Intelligize. Users should be able to search for a known disclosure concept without guessing all of its textual variations.

The taxonomy should begin with high-value practitioner areas rather than attempting to tag everything at once:

- Risk Factors.
- MD&A.
- Significant accounting policies.
- Critical accounting estimates.
- Non-GAAP measures.
- Critical Audit Matters.
- Cybersecurity.
- Climate and human capital.
- Executive compensation and pay-versus-performance.
- Segment reporting.
- Going concern and material weaknesses.
- Common M&A clauses and defined terms.

Once normalized, the platform can calculate adoption rates, frequency, first adopters, changes over time, and missing disclosures within a peer cohort.

### 4. Connected research graph

Intelligize’s advantage is often the relationship between documents rather than the individual document databases. The website should make those relationships explicit.

For a filing, the user should be able to move directly to:

- Its amendments and prior-year version.
- Incorporated exhibits and underlying agreements.
- Associated comment-letter episodes.
- The disclosure changed in response to an SEC comment.
- Relevant regulations, interpretations, and accounting standards.
- Related enforcement actions or no-action positions.
- Peer disclosures on the same topic.

The same graph should work in reverse. An ASC topic, staff comment, clause, or rule should lead back to relevant filings and precedents.

### 5. Comment letters at the issue level

Threading is now implemented, so basic conversation linking is no longer the primary gap. The next step is issue-level intelligence.

Each staff letter should be broken into numbered or inferred comments and connected to:

- The corresponding company response.
- The relevant filing and disclosure section.
- The issue taxonomy.
- The examiner and responding advisers, where available.
- Whether the issue was resolved, repeated, or led to an amendment.

This would support “find comments similar to this one,” resolution analytics, review-duration comparisons, and SEC-focus trend dashboards.

### 6. Agreements, clauses, and transaction terms

The current exhibit and M&A tools are good entry points, but the extraction is primarily on demand. Intelligize users will expect a pre-indexed clause and deal-point database.

The platform should support:

- Clause-title and clause-language search.
- Normalized definitions and alternate clause labels.
- Deal packages linking the definitive agreement, amendments, disclosure schedules, and related filings.
- Structured deal terms such as consideration, deal size, termination fees, reverse termination fees, financing conditions, go-shop provisions, and closing conditions.
- Clause comparison and market-frequency analysis.
- Filtering employment agreements by role, compensation, severance, and restrictive covenants.

### 7. Dedicated authoritative collections

Several current pages reuse the general filing-search service. This is efficient during development but can create false confidence when a module name implies a complete specialist corpus.

Priority collections should include:

- SEC no-action letters with position, division, topic, and outcome metadata.
- SEC rules, releases, interpretations, bulletins, and compliance guidance.
- Registered offering data and offering-specific terms.
- Enforcement releases, administrative proceedings, and related company records.
- Accounting and auditing guidance with stable document identifiers and change history.

Until a collection is complete, the interface should state its coverage and source limitations clearly.

### 8. Peer groups as reusable objects

Peer cohorts should be saved entities, not temporary ticker lists. Users should be able to create a cohort once and apply it everywhere.

Useful cohort sources and filters include:

- Peers disclosed in a company’s proxy statement.
- SIC and NAICS industry.
- Exchange and filer status.
- Market capitalization.
- Revenue, assets, and geographic exposure.
- Auditor.
- Custom inclusions and exclusions.

Saved cohorts should retain their membership as of a reporting date while also offering an option to refresh dynamically.

### 9. Document cart, batch analysis, and report builder

Experienced research users regularly collect documents from several searches before analyzing them. A document cart should be global and persist across modules.

From the cart, users should be able to:

- Remove duplicates and organize documents into collections.
- Bulk download filings and exhibits.
- Export a results index to Excel.
- Compare chosen sections or tables.
- Run Copilot against only the selected sources.
- Generate a citation-preserving matrix, checklist, memo, or executive summary.
- Export to Word and PDF or copy into an existing work product.

The report builder should preserve the underlying search, filters, document versions, citations, and generation date.

### 10. Drafting and compliance workflows

The current checklist demonstrates the concept but is not yet a persistent compliance system. A stronger implementation would connect research directly to filing preparation.

Recommended workflows include:

- 10-K, 10-Q, 8-K, S-1, and accounting-policy checklists.
- Assignment, due date, status, reviewer, and approval fields.
- Evidence links to rules, standards, peer disclosures, and comment letters.
- Peer-coverage analysis identifying potentially missing disclosures.
- Rule and form-change tracking.
- Disclosure-language libraries with approved internal wording.
- Version comparison and review comments.
- Word-friendly export and, eventually, Microsoft Word integration.

### 11. Company intelligence

The company dossier should become the organizing view for everything known about an issuer. In addition to filings, comments, and financials, it could include:

- Filing and amendment timeline.
- Exhibit and agreement library.
- SEC review history and open issues.
- Governance and committee materials.
- Board and compensation history.
- Insider trading.
- Earnings materials and transcript Q&A.
- Investor presentations and ESG reports.
- Enforcement and litigation releases.
- Saved peer groups, alerts, and internal notes.

Licensed news, firm memos, analyst material, and SEDAR content would broaden this view further but should follow improvements to the owned SEC corpus.

### 12. AI defensibility

The existing Copilot evidence and action-log design is a meaningful strength. It should be extended into a reproducible research record.

Recommended additions include:

- Per-claim citations rather than only a list of supporting sources.
- Visible generated Boolean and conceptual search logic.
- Source inclusion and exclusion controls.
- Frozen source sets for finalized reports.
- Search, filter, model, prompt, and generation metadata.
- A downloadable research audit package.
- A way to flag unsupported claims or incorrect citations.
- Organization-level policies governing allowed sources and retention.

## Recommended sequencing

### Phase 1: Make research durable

1. Cloud research projects and folders.
2. Global document cart.
3. Saved searches, peer groups, watchlists, and annotations as server-side objects.
4. Scheduled alerts with email and in-app delivery.
5. Organization ownership, sharing, and basic audit history.

### Phase 2: Add practitioner-grade intelligence

1. High-value filing-section and disclosure-topic taxonomy.
2. Post-search facets and “What’s Market” analytics.
3. Connected filing, amendment, exhibit, and comment-letter graph.
4. Issue-level comment-letter segmentation and similar-comment discovery.
5. Dedicated no-action and regulatory collections.

### Phase 3: Deepen transactions and outputs

1. Persistent agreement and clause extraction.
2. Structured transaction and deal-point screening.
3. Batch AI analysis over selected documents.
4. Citation-preserving report builder and Word/PDF exports.
5. Persistent drafting and compliance checklists.

### Phase 4: Expand content breadth

1. Earnings transcripts and investor presentations.
2. Governance and company-site materials.
3. Firm memos and professional guidance.
4. News and negative-news monitoring.
5. Analyst research, market data, and SEDAR coverage where licensing permits.

## Recommended top three investments

If only three areas are funded first:

1. **Cloud research projects, document cart, and server-side alerts.** This changes the product from a collection of tools into a daily system of record.
2. **Curated section and topic taxonomy with “What’s Market” analytics.** This is the clearest gap between keyword research and Intelligize-style precedent intelligence.
3. **Connected content with issue-level comment letters and clause-level agreements.** These are the workflows experienced users are most likely to judge immediately.

## Product positioning

The product should not attempt to recreate Intelligize’s full historical tagging system all at once. A better strategy is to:

- Match Intelligize on the research workflows practitioners use every day.
- Concentrate curated tagging on the highest-value accounting and disclosure topics.
- Differentiate through XBRL financial analytics, transparent agent actions, stronger drafting assistance, and Uniqus practice knowledge.
- Treat citations, source coverage, and reproducibility as product features rather than background infrastructure.

The core strategic principle is: **deepen the research system before expanding the navigation.**

## Sources

- [Intelligize product overview](https://www.lexisnexis.com/assets/en-ca/pdf/Intelligize_Product-Overview.pdf)
- [Intelligize+ AI: 2026 Protégé announcement](https://www.lexisnexis.com/community/pressroom/b/news/posts/intelligize-ai-unveils-next-evolution-of-protege-for-deeper-unified-sec-filings-research)
- [Introducing Intelligize+ AI](https://www.lexisnexis.com/community/insights/legal/b/product-announcement/posts/introducing-intelligize-ai-powering-smarter-sec-compliance-research)
- [Intelligize accounting solutions](https://www.intelligize.com/solution/strategy/accounting-solutions/)
- [Intelligize ESG overview](https://www.lexisnexis.com/assets/en-ca/pdf/Intelligize_Environmental-Social-Governance.pdf)

## Relevant implementation references

- `src/views/SearchPage.tsx`
- `src/services/researchSessions.ts`
- `src/context/AppState.tsx`
- `src/views/FilingDetail.tsx`
- `src/views/CommentLetters.tsx`
- `src/views/ExhibitSearch.tsx`
- `src/views/NoActionLetters.tsx`
- `src/views/Benchmarking.tsx`
- `src/views/MAResearch.tsx`
- `src/views/AccountingHub.tsx`
- `src/views/Dashboard.tsx`
- `src/components/AIQnAPanel.tsx`
