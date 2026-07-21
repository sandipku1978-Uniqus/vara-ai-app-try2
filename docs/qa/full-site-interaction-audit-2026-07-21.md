# Full-site interaction and neutral-visitor audit test design

**Date:** 2026-07-21  
**Scope:** all 25 App Router pages, the authenticated application shell, and every distinct control behavior  
**Production under observation:** `https://uniqus-research.vercel.app`  
**Purpose:** prove that each visible control produces the outcome it promises, and identify experiences that are technically functional but surprising, ambiguous, or hard to trust.

## 1. Decision and testing principle

The site should be tested by **behavioral contract**, not by mechanically clicking every rendered element. The current source contains hundreds of repeated controls—table sort buttons, filing links, row-level Copilot buttons, and repeated cards. A generic click crawler would be destructive, expensive, and misleading: it could prove that a click did not crash while failing to prove that the correct filing, query, source, export, or persisted state resulted.

The accountable unit is therefore:

> one test for every distinct control class and every route-specific outcome, with representative parameter cases for repeated rows.

Every contract in this document must establish all of the following that apply:

1. the control has an accessible name and is operable by keyboard and pointer;
2. it is enabled only when its prerequisites are satisfied;
3. it sends the exact intended query, record identity, or destination;
4. it exposes an observable loading or pending state;
5. success, legitimate zero, partial/degraded data, and upstream failure are distinguishable;
6. Retry repeats the same request rather than changing the user's task;
7. a late response cannot overwrite a newer request;
8. displayed results, AI analysis, exports, and saved searches use the same applied criteria;
9. navigation, download, clipboard, local persistence, or external-source behavior is verifiable; and
10. the interaction produces no uncaught browser error, accessibility regression, or horizontal overflow.

## 2. Current coverage baseline

This baseline is the pre-expansion census from 2026-07-21. It is intentionally stated separately from the target suite so progress can be measured.

| Measure | Current baseline | Interpretation |
|---|---:|---|
| App Router pages | **25** | 21 registered product routes, landing, internal design gallery, company dossier, and filing detail |
| Interactive TSX files | **47** | Files containing at least one static form/control callsite |
| Static control callsites | **369** | 263 buttons, 53 links, 41 form fields, and 12 forms; runtime lists may render more instances |
| Interactive files without a direct test import | **33 of 47** | About 70% of interactive files have no direct component-level test |
| Vitest files | **61** | Predominantly services, parsers, state, and source-string assertions |
| Passing tests before this initiative | **644** | A valuable regression floor, but not evidence of complete UI behavior |
| Explicit UI clicks found in existing tests | **21** | Plus one change/type/keyboard interaction and no link-interaction checks |
| Browser E2E framework in the audited baseline | **None** | Existing production performance scripts exercise APIs, not visitor interaction |

Positive browser evidence already established:

- all 23 static routes plus `/company/AAPL` and a representative Apple filing reached a settled page in the local browser census;
- the local landing query `Apple cybersecurity risk` reached the Research Workbench with 16 results;
- all audited routes had no horizontal overflow at the desktop viewport; and
- production public content rendered, while protected research followed the configured authentication path.

These are smoke results, not complete behavioral coverage.

## 3. Evidence labels

This document uses three labels. They must not be merged in reporting.

| Label | Meaning | Required handling |
|---|---|---|
| **Confirmed defect** | Directly reproduced in a browser or proven by a deterministic source/control path | Open a defect with reproduction, expected/actual result, severity, and regression test |
| **Confusing expectation** | The control performs an implemented action, but a neutral visitor is likely to infer a materially different action | Validate with the visitor protocol; resolve through copy, information architecture, or behavior |
| **Proposed test** | A plausible risk or uncovered state; failure has not yet been reproduced | Add the test first; do not report the risk as a product defect unless it fails |

## 4. Test architecture

### Layer A — unit and component behavior

Use Vitest, Testing Library, and `userEvent` for pure logic, shared controls, and view state machines. Replace source-text checks with rendered behavior wherever the claim is functional. Shared controls are tested once comprehensively; a page using the shared control only needs to prove that its data and callback are wired correctly.

Primary subjects:

- lookup fields, suggestions, chips, filter panels, and form submission;
- DataTable sorting, pagination, row actions, captions, and keyboard behavior;
- Results Toolbar copy/export/Copilot behavior;
- AI Results Summary state and evidence-key invalidation;
- Memo Tray and Cite lifecycle;
- retry, empty, partial, and race behavior in individual views; and
- persistence and identity scoping.

### Layer B — deterministic browser journeys

Use Playwright against a local production build with the existing safe local auth bypass. Intercept `/api/**` calls with committed fixtures. PR tests must not depend on the current SEC site, Supabase, Anthropic, Clerk, wall-clock dates, rate limits, or production credentials.

For every route:

- assert the expected page heading and one primary useful action;
- assert no console error, page error, hydration error, infinite loading state, or horizontal overflow;
- execute every route-specific control contract listed below;
- capture the outgoing request or destination and compare the full meaningful payload;
- exercise success, legitimate zero, failure/retry, and latest-request-wins where the route fetches data; and
- run at 1280×720 and 390×844 for responsive contracts.

Use accessible role/name locators. Add a test identifier only where a stable semantic locator is impossible.

### Layer C — accessibility and visual stability

- Run axe on every page archetype and all open dialogs/drawers.
- Enforce exactly one page-level `main`, a discoverable level-one heading, labeled visible fields, named controls, visible focus, and logical tab order.
- Exercise the sidebar, mobile drawer, command palette, Copilot panel, filing tools, tables, and destructive actions entirely by keyboard.
- Capture stable screenshots for landing, dashboard, workbench, comparison, comment letters, filing detail, and dossier in light/dark desktop, plus representative mobile states. Do not snapshot every transient spinner.

### Layer D — staging and production release smoke

Production checks are read-only and must not spend AI budget, change another user's data, or depend on an entitled production account. Full authenticated workflows belong on staging with a dedicated Clerk test identity and clean storage state.

Production must prove:

- public routes return the intended pages;
- landing search either starts research or clearly says authentication is required before input is accepted;
- an anonymous protected-route redirect preserves the exact intended destination and query;
- production does not display a development authentication banner;
- redirects and fallback navigation do not emit console errors;
- safe official-source links target the expected host and record; and
- security headers, 401/403 behavior, and entitlement boundaries remain intact.

### Deterministic fixture catalog

The route suite should share a small fixture vocabulary so that “success,” “zero,” and “failure” mean the same thing across pages. Freeze the browser clock and timezone for deterministic dates.

| Fixture ID | Contents and purpose |
|---|---|
| `FX-AUTH` | Anonymous, signed-in/unentitled, entitled user, entitled organization, expired session, and unavailable auth provider |
| `FX-ISSUERS` | AAPL and MSFT with distinct CIKs/names; lowercase ticker; raw CIK; unknown issuer; issuer with legitimately no XBRL; directory/submissions/auditor outages |
| `FX-RESULTS` | 25 uniquely identified filings across at least two issuers/forms/dates; zero; partial 20-of-25; malformed row; delayed request A and newer request B |
| `FX-FILINGS` | Sanitized HTML filing with tables/sections, prior-year comparable filing, XML, PDF, missing primary document, and failed document fetch |
| `FX-LETTERS` | Two episodes in the same thread, a deep-linked older thread, a zero-letter episode, cached summary, summary failure, and official source links |
| `FX-OFFICIAL` | Rules, guidance, litigation, no-action, IAPD, and standards records with stable official URLs plus successful empty and structural/upstream failure responses |
| `FX-AI` | Grounded success, empty response, rejected request, delayed response, cached result, changed same-sized evidence set, and 25-row input truncated to 20 |
| `FX-LOCAL` | Four watchlist companies, four saved searches, duplicate record, stale monitor timestamp, annotations, citations, theme/sidebar/consent preferences, and a second identity with empty storage |
| `FX-BROWSER` | Clipboard allowed/rejected, popup allowed/blocked, download capture, mobile viewport, reduced motion, and keyboard-only input |

Every fixture record must expose a stable identity—accession, CIK, URL, thread ID, or evidence hash—so assertions can prove that the right record moved through the interaction rather than merely matching visible text.

## 5. Universal state contracts

Each route row later in this document inherits these contracts. `N/A` must be explicit in the implementation manifest rather than silently skipped.

| ID | State contract | Executable assertion |
|---|---|---|
| `S-01` | Route settlement | Page reaches its useful settled state, correct heading/landmarks exist, and no uncaught console/page error occurs |
| `S-02` | Authentication | Anonymous, signed-in/unentitled, user-entitled, org-entitled, expired-session, and auth-unavailable states have distinct expected outcomes; return URL is exact |
| `S-03` | Initial and loading | Loading appears promptly, duplicate submissions are prevented, and the state terminates |
| `S-04` | Success | Rendered records and counts match the fixture and are attributed to the correct source/window |
| `S-05` | Legitimate zero | A successful empty response explains the searched scope; it is not presented as an outage |
| `S-06` | Failure | Upstream, parsing, authorization, AI, clipboard, popup, and download failures are visible and do not masquerade as zero or fact |
| `S-07` | Retry identity | Retry sends the same applied query, filters, tab, entity, form, dates, and document identity as the failed request |
| `S-08` | Latest request wins | Resolve request A after newer request B; B alone controls results, URL, counts, loading state, analysis, and saved actions |
| `S-09` | Draft versus applied | Editing controls after a search does not silently relabel old results. Analysis/export/save either use the applied snapshot or require rerun |
| `S-10` | Partial/degraded coverage | Missing records and truncated windows are quantified; conclusions do not imply exhaustive coverage |
| `S-11` | Persistence | Reload preserves only the state promised by the UI, with expiry and identity/org isolation; sign-out cannot expose the prior identity's data |
| `S-12` | AI provenance | Prompt contains the exact represented evidence; result coverage/truncation is disclosed; changing row identities invalidates the cache |
| `S-13` | Navigation identity | Destination preserves the exact accession, form, date, ticker/CIK, thread, return path, or tab required to resume the task |
| `S-14` | Destructive action | Clear/remove/dismiss is named, scoped, and confirmable when loss is material; parent row actions do not fire accidentally |
| `S-15` | Accessibility | Programmatic label, role, state, keyboard equivalence, focus movement/restoration, and live status are correct |
| `S-16` | Responsive behavior | No clipping/overflow; mobile alternatives expose every desktop capability; overlays close by button, Escape, and backdrop where promised |
| `S-17` | External and file action | New tab URL/`rel`, popup blocked state, clipboard result, filename, MIME type, and file contents are verified |
| `S-18` | Source truth | Official material, calculated data, local state, illustrative content, and generated AI content are visually and textually distinguishable |

## 6. Distinct control-class matrix

Repeated row controls use one contract with at least two representative records and a parameterized identity check. For example, a filing link is not clicked 100 times; it is tested with two distinct accessions to prove row identity is not accidentally captured from the first row.

| ID | Control class and intended job | Minimum executable checks | Preferred layer |
|---|---|---|---|
| `C-01` | Internal navigation link/card | Exact path and query; client navigation; active state; back/return context | Browser |
| `C-02` | External official-source link | Exact trusted host/record; safe new-tab attributes; no parent action | Component + browser |
| `C-03` | Primary form submit / Enter | Button and Enter send identical normalized payload; blank/invalid state is explained; duplicate submit locked | Component |
| `C-04` | Search/filter field | Programmatic label; edit/clear; draft state visible; special characters and pasted text | Component + axe |
| `C-05` | Autocomplete/combobox | Arrow navigation, active descendant, Enter/click/touch selection, Escape, clear, no stale suggestion overwrite | Component + browser |
| `C-06` | Filter chip / quick date / Clear All | Correct field mutates; removing one does not clear others; applied results are not silently relabeled | Component |
| `C-07` | Tabs/mode selector | Correct panel and ARIA state; arrow/Home/End; current-tab click does not corrupt query/state | Component + browser |
| `C-08` | Disclosure/card expansion | Named expanded state; correct record opens once; content is not duplicated under sibling rows | Component |
| `C-09` | DataTable sort | Only meaningful data columns sortable; asc/desc order and `aria-sort`; rendered action/link columns opt in explicitly | Component |
| `C-10` | Pagination | Correct slice/count; first/last disable; page resets when dataset changes; accessible labels | Component |
| `C-11` | Row action | Correct row identity; event does not trigger row navigation; disabled/loading and retry are row-scoped | Component |
| `C-12` | Retry | Recovers after controlled first failure and repeats the identical request (`S-07`) | Component |
| `C-13` | Copy | Clipboard receives exact intended content; success and rejection feedback; no false success | Component/browser permission fixture |
| `C-14` | CSV/XLSX/DOCX/PDF/Markdown export | Disabled when unavailable; correct filename/schema/content/scope; visible label matches what is exported | Component + browser download |
| `C-15` | Print/popup | Correct sanitized document; blocked popup state; no silent no-op | Browser |
| `C-16` | AI insight/analyze/retry | Explicit invocation unless disclosed otherwise; evidence snapshot, truncation, busy/error/empty/cache states | Component |
| `C-17` | Ask Copilot / Copilot citation | Opens panel once, queues exact context, citation always has a real destination or is non-interactive | Component + browser |
| `C-18` | Cite/Memo Tray | Add/remove one citation, note persistence, draft/copy/export/error, count, clear behavior, source link | Component + browser |
| `C-19` | Sidebar/nav collapse/mobile drawer | All destinations; Monitor before Research; persisted collapse; focus trap/restore; Escape/backdrop close | Browser |
| `C-20` | Command palette | Trigger and shortcut, complete route registry, search, arrow/Enter, focus trap/restore, Escape | Component + browser |
| `C-21` | Theme control | Label describes destination, theme applies before paint, persists, and every archetype remains legible | Browser + visual |
| `C-22` | Authentication/account control | Sign-in/up/out, exact return URL, entitlement denial, account menu, identity-state cleanup | Staging/browser |
| `C-23` | Local saved search/watchlist/monitor | Accurate local-only wording, duplicate behavior, add/remove/check/reopen, persistence and identity scope | Component + browser |
| `C-24` | Dialog/drawer/overlay | Name, modality, focus containment, scroll lock, close mechanisms, and trigger focus restoration | Browser |
| `C-25` | Destructive remove/clear/dismiss | Exact target, loss warning when material, keyboard activation, status feedback | Component |
| `C-26` | Iframe/document text interaction | Load/fallback, source origin, selected text, TOC scroll, highlight, responsive tools | Browser |
| `C-27` | Chart/heatmap interactive mark | Keyboard-accessible equivalent, selected data is accurate and visibly explained, stale selection clears | Component + browser |
| `C-28` | Legal consent preference | Current state visible; accept/decline persists; behavior changes accordingly; privacy explanation linked | Component + browser |

## 7. Global shell contracts

Run these once against a representative protected route and repeat the route-link assertion for every registered navigation destination.

| ID | Control group | Required journey |
|---|---|---|
| `G-01` | Sidebar | Open each of the 19 visible product/support destinations and assert route label/active state. Collapse/expand must not reorder or hide destinations; Monitor remains above Research. |
| `G-02` | Mobile navigation | At 390 px open the drawer, tab through all focusable items, wrap focus, close by Escape/backdrop/close button, and restore focus to the menu trigger. |
| `G-03` | Navbar | Quick Find, theme, Copilot, and account controls have distinct names and do not collide at desktop/mobile widths. |
| `G-04` | Command palette | `Meta+K` and visible trigger open the same dialog; every palette-enabled route is searchable and navigable; dynamic labels are correct. |
| `G-05` | Breadcrumb/context | Home, section, filing, and company paths use client navigation and preserve an exact return context where promised. |
| `G-06` | Copilot panel | Open/resize/close/clear history/select history; Answer/Evidence/Action Log; sample/follow-up prompt; citation destinations; alert Save/Dismiss; failure and retry. |
| `G-07` | Memo Tray | Open/close, citation count, notes, removal, source, copy rejection, Markdown export scope, AI draft, stale-draft warning, and Clear All behavior. |
| `G-08` | Route states | Global loading, error Retry, not-found Home/Support, authentication unavailable, and entitlement-required pages are readable in both themes and by keyboard. |

## 8. Route and control matrix — all 25 pages

Every row includes `S-01`, `S-15`, `S-16`, and the no-console-error check. Data-backed rows also include `S-03` through `S-10`. The IDs below should appear in automated test titles and release reports.

### Public, monitor, and research

| Page ID / route | Visitor job | Distinct route controls | Executable route contract |
|---|---|---|---|
| `P-01` `/` | Understand the product and begin a source-backed research task | Landing search, Start Research, Dashboard/platform cards, auth, theme, Support/Privacy/Terms | Submit `Apple cybersecurity risk` by button and Enter and verify exact `/search` query/return URL (`C-03`, `C-01`). Test anonymous and signed-in flows. All preview content must say whether it is illustrative (`S-18`). All links resolve. Search has a programmatic label. |
| `P-02` `/dashboard` | See what changed for watched companies and reopen saved work | Add/remove watchlist company, filing-mix drilldown, Recent Filings rows, saved-search Open/Check/Remove, chart/list marks | Seed four companies and four alerts. Verify full/partial/unavailable/empty analytics, exact filing navigation, scoped drilldown, persistence, duplicate add, max-auto-check behavior, and discoverability of every alert (`C-23`, `C-27`, `S-13`). |
| `P-03` `/earnings` | Find recent EX-99.1 earnings releases | Company/date/term search, recent cards, Retry, official/internal source, shared result actions | Validate initial 45-day feed success/zero/failure; submit all filters; exact EX-99.1 scope; result identity; retry; applied criteria for insight/export; coverage-window copy (`C-03`, `C-12`, `C-16`). |
| `P-04` `/search` | Find relevant filing evidence and reach the underlying source | Semantic/Boolean mode, primary search, samples, tabs/sessions/close, advanced filters, autocomplete, sort/page, preview, filing/dossier/source/Cite, insight, Save Alert | Test blank, semantic, Boolean/proximity, filter-only, zero, degraded, timeout, and failure. Test parallel searches, copied URL with foreign local tab ID, draft/applied separation, sort/page, preview lookup/fallback, exact filing/dossier/citation destinations, alert duplicate/persistence, and all filter chips (`C-03`–`C-18`, `S-08`–`S-13`). |
| `P-05` `/comment-letters` | Browse or search a company’s SEC comment-letter conversation | Keyword/company/form/topic fields, full-text submit/clear, thread expansion, official letter links, Cite, AI summary, Copilot | Test browse, keyword, topic, company and deep-linked thread; zero, lookup failure, empty thread, summary consent/cache/error/retry. Clearing any field must update the parent filter and restore browse when appropriate. Expanding one result must not duplicate it under sibling results (`C-05`, `C-08`, `S-08`). |
| `P-06` `/exhibits` | Find agreements/exhibits by document type and criteria | Exhibit-type choice, company/query/date search, recent cards, Retry, source links, result toolbar/insight | Validate initial 60-day state, exact document-type matching/window disclosure, search/Enter, no-match versus truncated coverage, retry identity, and applied-snapshot AI/export (`C-03`, `C-07`, `C-16`). |
| `P-07` `/no-action-letters` | Find official no-action guidance and review sources | Official-source query, Search/Retry, sortable table, SEC links, AI insight and result toolbar | Test all corpora represented by fixtures, zero/failure/retry, exact official URL, meaningful sort, copy/export/Copilot, and ensure editing the input cannot relabel the submitted results or summary (`C-09`, `C-12`, `S-09`). |

### Benchmark and reference

| Page ID / route | Visitor job | Distinct route controls | Executable route contract |
|---|---|---|---|
| `P-08` `/compare` | Compare issuers and export evidence | Financial/Text Redline/Audit Matrix modes, cohort/company/year/section controls, AI comparison, CSV/XLSX/DOCX/PDF | For each mode, exercise valid/invalid cohort and years, add/remove companies, loading/partial/error, mode keyboard behavior, evidence-backed matrix cells, redline, AI scope, and only exports valid for that mode (`C-07`, `C-14`, `C-16`). |
| `P-09` `/accounting-analytics` | Compare accounting ratios across issuers | Company lookup/add/remove, fiscal controls, ratio selection, Retry, chart and table | Test full/partial/all-company failure, legitimate absent XBRL, fiscal year visibility, ratio units, mixed percent/multiple chart comprehension, retry, stale result clearing, and table/chart agreement (`C-05`, `C-27`). |
| `P-10` `/esg` | Compare disclosure depth and inspect ESG evidence | Framework/mapping/heatmap/earnings tabs, ticker add/remove, topic cells, filters, summaries, sources | Test default load disclosure, add/remove to zero, per-company progress, partial AI failure, exact topic drilldown, stale data clearing, framework source truth, earnings filter/summary/source, and tab keyboard behavior (`C-07`, `C-27`, `S-12`). |
| `P-11` `/boards` | Review board composition, peers, compensation, and source evidence | Company/peer lookup, director/diversity/compensation tabs, extraction, Retry | Test default-load disclosure, change-company race in reverse completion order, full/partial/error, nullable values, stale company prevention, tab semantics, retry, and evidence coverage (`S-08`, `C-07`, `C-12`). |
| `P-12` `/insiders` | Review Forms 3/4/5 for a company cohort | Company add/remove, source table, row source/Copilot, shared table actions | Test default cohort, duplicate/invalid company, remove down to zero, stale-state clearing, exact form/source identity, sort/page/export, and ensure Copilot describes metadata scope rather than filing evidence (`C-05`, `C-11`, `S-12`). |
| `P-13` `/accounting` | Research standards, maintain a checklist, and ask for guidance | Research/Standards/Checklist/AI tabs, search/filter, memo/alert, official standards links, checklist CRUD, AI prompt | Test each tab and keyboard operation; research success/zero/error/retry; exact standards source; checklist add/edit/toggle/delete/persist/identity scope; AI failure/provenance. Editing criteria after search must not combine old results with a new memo/alert (`C-07`, `C-18`, `C-23`, `S-09`). |
| `P-14` `/regulation` | Find SEC rules or staff guidance | Rules/Guidance tabs, official-source search, Retry, source links, toolbar/insight | Test Rules→Guidance reversed response order, current-tab re-click, query submission, zero/error/retry, exact source URL, applied query for summary, and tab semantics (`S-08`, `C-07`, `C-12`). |
| `P-15` `/enforcement` | Find SEC litigation releases | Client filter/clear, Retry, official links, toolbar/insight/Copilot | Separate official-source empty from local filter no-match, verify clear restores full set, exact source destination, retry, sort/export, and describe metadata-only Copilot scope (`S-05`, `C-04`, `C-17`). |

### Transactions

| Page ID / route | Visitor job | Distinct route controls | Executable route contract |
|---|---|---|---|
| `P-16` `/ipo` | Inspect the SEC IPO feed and analyze a registration statement | Pipeline/Metrics/Activity tabs, local monitor, CSV, analyzer open/back, query/quick pills, result choice, six analysis tabs, Run All/Analyze/Retry | Test feed full/zero/failure/retry; tabs and export; local-only duplicate monitor. In analyzer test blank/Enter/search, quick-pill expectation, filing source failure, selection, whether selection spends AI, sequential Run All, overlap prevention, partial error continuation, re-analysis, and source grounding (`C-07`, `C-14`, `C-16`, `C-23`). |
| `P-17` `/mna` | Find deal filings or extract a clause | Deal/Clause modes, entity autocomplete, Retry, row AI extraction/source/Copilot, clause query, filing/type selection, extraction | Test generic and entity searches, `AAPL → Apple Inc.` mapping, server search versus local filter, retry exact query, per-row extraction/cache/error. Clause blank/success/zero/failure, selection state, stale output clearing, source/citation, and exact filing/type extraction (`C-05`, `C-11`, `S-07`). |
| `P-18` `/exempt-offerings` | Browse/search Form D offerings | Recent feed/cards, primary search, advanced filter toggle/fields/chips, suggestions, Retry, internal/source links, toolbar/insight | Test recent success/zero/failure, exact internal filing identity, button/Enter, every filter/chip/date window, dual-company-field conflict, mouse/touch/keyboard suggestions, zero/error/retry, and consistent destination semantics (`C-05`, `C-06`, `S-13`). |
| `P-19` `/adv-registrations` | Find an adviser by firm, CRD, or SEC number and open IAPD | Search/Enter, Retry, IAPD link, sort/page/export/copy/Copilot | Use firm/CRD/SEC fixtures; blank/loading disable; success/zero/error/retry; exact IAPD profile; result count/window; table actions. Copy must accurately distinguish firm summaries/disclosure flags from individual Form ADV filings (`C-02`, `C-09`–`C-14`, `S-18`). |

### Support, legal, dynamic, and internal pages

| Page ID / route | Visitor job | Distinct route controls | Executable route contract |
|---|---|---|---|
| `P-20` `/support` | Understand how to complete a task and reach the correct tool | Guide search, workflow cards, section anchors, platform links, CTAs, FAQ disclosures, breadcrumb | Test programmatic search label, query filtering/clear/zero, all anchors and 19 platform links, CTA destinations, FAQ keyboard use, and a single main landmark. Verify instructions match actual behavior, especially preview versus filing detail and Dashboard capabilities (`C-01`, `C-04`, `C-08`). |
| `P-21` `/privacy` | Understand data handling and set analytics consent | Consent choices and Home | Test current state, accept/decline persistence and PostHog consequence, identity/browser scope, keyboard use, exact Home destination, public/anonymous access (`C-28`, `C-01`). |
| `P-22` `/terms` | Read terms and return safely | Home link | Verify public/anonymous access, heading/landmarks, all legal links, Home destination, themes, and print/readability (`C-01`). |
| `P-23` `/filing/[...slug]` | Read, navigate, annotate, compare, export, and cite one exact filing | Return, redline, annotation CRUD, table/PDF export, watchlist, SEC links, tools drawer/tabs/TOC, iframe selection/highlight, Copilot | Test invalid/HTML/XML/PDF fixtures; sanitized return context; canonical document across links; metadata/TOC/iframe failure and Retry; drawer/mobile focus; selection/annotation persistence; exact CSV; popup blocked; watchlist eligibility; redline prior filing/result visibility/error/retry; Cite/Copilot (`C-14`–`C-18`, `C-23`–`C-26`). |
| `P-24` `/company/[ticker]` | Review one issuer's filings, letters, financials, auditor, and sources | Breadcrumbs, Filings/Letters/Financials tabs, SEC source, filing View/Cite, thread links, Retry | Test ticker/lowercase/CIK/unknown plus directory/submissions outage. Source absence and outage must differ. Test zero filings, exact filing source/Cite, comment-thread identity/retry, financial success/unavailable/error/retry, auditor outage, tab persistence, and breadcrumb destinations (`C-07`, `C-11`, `S-05`–`S-07`). |
| `P-25` `/design-gallery` | Internal visual specimen only; it must not pretend to be a product page | Search specimen, remove/memo/copy specimens, gallery anchors | Make one explicit product decision: protect/exclude the route from production and mark controls non-interactive, or implement each visible control. The test must reject inert buttons, read-only fields presented as search, missing `#gallery`, missing h1, or indexable public exposure. Do not silently omit this route from the contract manifest. |

## 9. Priority findings from the current audits

The table separates observed/proven defects from expectation problems and tests that still need to determine the outcome. “Source-confirmed” means a deterministic path was inspected but should still receive a regression reproduction in the new browser/component suite.

### Executed baseline on 2026-07-21

| Check | Result | Interpretation |
|---|---|---|
| Existing Vitest and contract suite | 651/651 passed across 62 files | The existing regression baseline is healthy, but it contains little rendered control interaction coverage. |
| Typecheck, lint, production build | Passed; lint reported four warnings | No compile/build blocker. The warnings include one hook dependency and three unsupported `aria-expanded` textbox-role combinations. |
| Route smoke | 24/24 passed | All non-landing route contracts reached their intended workspace; landing is exercised separately by the visitor suite. |
| Semantic census, report mode | 25/25 completed | Every route could be inventoried. Report mode intentionally records defects without stopping at the first route. |
| Semantic census, strict mode | 4/25 passed; 21/25 failed | Only Regulation, ADV Registrations, Privacy, and Terms met every current semantic gate. Findings included 80 unresolved ARIA references across 16 routes, multiple `main` landmarks on seven routes, unnamed inputs on four routes, and missing h1 headings on two routes. No route had document-level horizontal overflow, duplicate IDs, or an uncaught page error. |
| Neutral visitor browser suite | 18/19 passed | The remaining failure is a genuine product defect: the landing search input has no programmatic accessible name. |

The strict audit also observed an XLSX development-chunk 404 on Compare and aborted SEC-proxy requests in Filing Detail. Those are environment-sensitive until they reproduce against deterministic fixtures and a clean server restart.

| Priority / ID | Classification | Evidence and impact | Required acceptance test |
|---|---|---|---|
| `P0 F-01` | **Confirmed defect — browser** | Production authentication visibly says **Development mode** at `settling-puma-25.accounts.dev`. This is unusual and trust-eroding on a professional research product, and conflicts with the documented production release expectation. | `P-01/S-02`: anonymous landing research reaches a production-configured auth experience with no development banner; exact return URL is retained. |
| `P0 F-17` | **Confirmed defect — production/source** | The live Terms page tells the deployment operator to replace or supplement the terms before production, while Privacy says required disclosures and a privacy contact must be documented before offering the app to end users. These are visible unfinished-launch instructions, not visitor-facing policy. | `P-21/P-22`: production legal pages contain approved operator-specific terms, disclosures, retention/deletion details, and a real privacy contact; fail on template/deployment instructions. |
| `P1 F-02` | **Confirmed defect — browser** | Production Start Research caused a Next RSC fetch console error before fallback navigation to sign-in. A visitor sees navigation complete, but the client error is a reliability signal and can mask future route failures. | Capture console/page errors while submitting landing research anonymously; fail on the reproduced RSC error, not merely on a failed final navigation. |
| `P1 F-03` | **Confirmed defect — browser** | Dashboard row `PX14A6G MSFT … 2026-07-02` navigated to a generic `/search?...&q=MSFT`, losing form, date, and accession. The row looks filing-specific but does not reach that filing (`src/views/Dashboard.tsx`). | `P-02/S-13`: two distinct recent rows must open their exact filing or a uniquely scoped search preserving form/date/accession. |
| `P1 F-04` | **Confirmed defect — browser + source** | `/design-gallery` is reachable as a product route but has a read-only search, inert remove/memo/copy controls, no h1, and 10 visible `#gallery` links whose target does not exist (`src/app/design-gallery/page.tsx`). | `P-25`: route is internal/protected and specimens are unmistakably non-interactive, or every visible control becomes functional and every anchor resolves. |
| `P1 F-05` | **Confirmed defect — browser** | Duplicate `main` landmarks were observed on `/esg`, `/boards`, `/accounting`, `/ipo`, `/mna`, `/support`, and the company dossier; filing detail and the gallery had no h1. Nested/duplicate page landmarks make screen-reader orientation ambiguous. | Axe plus custom landmark assertion on all 25 pages: exactly one page-level main and one discoverable h1 (an explicitly justified internal exception must not ship publicly). |
| `P1 F-06` | **Confirmed defect — browser + source** | Landing, Workbench, Support, and gallery search fields lack programmatic labels. Static scan also found unlabeled Memo citation note, Benchmark section selector, and Filing annotation note (`LandingPage.tsx`, `SearchPage.tsx`, `SupportCenter.tsx`, `MemoTray.tsx`, `Benchmarking.tsx`, `FilingDetail.tsx`). Placeholder-only labels disappear on input and are not reliable accessible names. | Query every visible field across settled states and fail if it lacks an associated label/accessible name; type and clear using that accessible name. |
| `P1 F-07` | **Confirmed defect — source** | Comment-letter company Clear can hide the selected value without clearing the parent filter; clearing a successful keyword can leave a blank page; expanding one result can render the same thread conversation under sibling results from that thread (`CompanySearchInput.tsx`, `CommentLetters.tsx`). | `P-05`: clear each filter independently and assert request/browse state; expand two episodes in one thread and assert content appears only under the selected episode. |
| `P1 F-08` | **Confirmed defect — source** | M&A suggestion selection can use ticker `AAPL` to client-filter issuer name `Apple Inc.`, hiding a valid server result. Entity-specific Retry loads the generic feed instead of repeating the failed entity query (`src/views/MAResearch.tsx`). | `P-17`: use Apple fixture and first-fail/then-pass intercept; result remains visible and Retry payload is byte-equivalent in meaningful criteria. |
| `P1 F-09` | **Confirmed defect — source** | Filing YoY Redline can complete in a closed Tools panel, so output is invisible. Destination-less alert citations are rendered as clickable Copilot buttons whose handler has nowhere to go (`FilingDetail.tsx`, `AIQnAPanel.tsx`). | `P-23`: run redline after closing tools and assert panel/result becomes visible. `G-06`: every interactive citation navigates; destination-less evidence renders as non-clickable text. |
| `P1 F-10` | **Confirmed defect — source** | Company-directory or SEC-submissions outages become a 404, and an auditor-source outage can become the factual claim “Not on record” (`src/app/company/[ticker]/page.tsx`). Unavailable source and actual absence are materially different research conclusions. | `P-24`: fixtures for unknown issuer, directory outage, submissions outage, no auditor record, and auditor outage each produce distinct text/status and appropriate retry. |
| `P1 F-11` | **Confirmed defect — source** | Board upstream failures can remain loading and older company responses can replace the current company. Removing all Insider or ESG companies can leave stale results/errors visible (`BoardProfiles.tsx`, `InsiderTrading.tsx`, `ESGResearch.tsx`). | Reverse delayed responses for Boards; reject the first request; remove the last company on Insiders/ESG and assert loading terminates and prior evidence clears. |
| `P2 F-12` | **Confusing expectation — browser/source** | Support has 82 visible controls, a nested main, and its “Home” breadcrumb goes to `/dashboard`. Some help copy says result rows open Filing Detail when they first select a preview and refers to a Dashboard search bar that does not exist (`SupportCenter.tsx`, `SearchPage.tsx`, `Dashboard.tsx`). | Neutral task U-06 plus link/copy assertions. A first-time visitor must predict each destination and complete it without discovering contradictory UI. |
| `P1 F-18` | **Confirmed omission — browser/source** | Support offers extensive self-service guidance but no visible contact, issue-reporting, or escalation channel. A visitor who encounters incorrect SEC data, a failed source, billing/auth trouble, or an inaccessible workflow has no recovery path. | `P-20`: a neutral visitor can identify and activate a real support channel from Support and error states, with enough context to report the affected route/source. |
| `P2 F-13` | **Confusing expectation — source** | “Save Alert” is browser-local saved search state with no background notification; Dashboard shows only the first three. The word alert commonly implies scheduled notification and complete management. | Neutral task U-05: ask what will happen after closing the browser and where the fourth saved alert is found. Require accurate answers from visible UI alone. |
| `P2 F-14` | **Confusing expectation — source** | Results Toolbar says “Analyze these N results” while supplying only the first 20 rows to Copilot. This overstates the evidence population. | With 25 unique rows, capture prompt and visible disclosure. Both must state the same 20-of-25 scope; analysis must not claim all 25. |
| `P2 F-15` | **Confusing expectation — browser** | Landing accepts a substantive research query before revealing that research requires sign-in. The redirect preserves the query, so this is not inherently wrong, but a neutral visitor may perceive it as an unexpected auth wall. | Neutral task U-01: record whether participants predicted authentication, abandoned, or trusted query preservation; decide whether pre-submit copy is needed. |
| `P2 F-16` | **Confusing expectation — information architecture** | Account controls, theme, sidebar preference, and analytics consent live in separate places; no Settings page provides a discoverable home. | Neutral task U-07: find account, visual, and privacy preferences without route hints. Treat inability to locate them as IA evidence, not an automatic feature request. |
| `P1 T-01` | **Proposed test** | Search, Regulation, and Comment Letters launch overlapping asynchronous work without complete browser-level latest-request evidence. A stale response may control the newer task. | Run reversed-delay tests for each surface and enforce `S-08`; classify as defect only where the test fails. |
| `P1 T-02` | **Proposed test** | Several surfaces expose editable draft criteria beside settled results. It is not comprehensively proven that insight, export, memo, and Save Alert use the applied snapshot. | For Workbench, Accounting, Earnings, Exhibits, and No-Action: edit after success, then invoke each derived action and compare evidence/query IDs (`S-09`). |
| `P1 T-03` | **Proposed test** | Auth tests cover route classification but not the complete sign-in return, entitlement, identity switch, storage reload, and sign-out journey. | Staging suite for all `S-02` identities plus storage leakage assertions. |
| `P2 T-04` | **Proposed test** | Downloads, clipboard rejection, popup blocking, iframe selection, mobile overlays, and external links have little or no browser evidence. | Execute `C-02`, `C-13`–`C-15`, `C-24`, and `C-26` with browser fixtures on representative pages. |

## 10. Neutral-visitor protocol

Automation establishes correctness. It cannot establish whether terminology, hierarchy, and transitions make sense to someone who did not build the product.

### Participants and environment

- Recruit at least 6 participants: 3 with accounting/legal/SEC research familiarity and 3 professionals comfortable with web tools but unfamiliar with this product.
- Do not use team members who know the route names or implementation.
- Use a staging deployment with deterministic, realistic data and a test account. Start with clean local storage and a fresh browser profile.
- Record screen, audio, clicks, URL, console, and task timestamps with consent.
- Alternate light/dark starting theme; include at least two mobile sessions.

### Facilitator script

Say only:

> “Please work as you normally would. Think aloud. This is a test of the product, not of you. I cannot teach you where features are, but I may ask what you expect a control to do before you use it.”

Do not mention route names, sidebar groups, Copilot, alert implementation, browser-local storage, or the expected path. After 60 seconds of impasse, record failure before offering a neutral prompt.

### Outcome tasks

| ID | Neutral task prompt | Objective success | Signals to capture |
|---|---|---|---|
| `U-01` | “Find a primary source discussing Apple cybersecurity risk.” | Relevant official filing/source reached within 60 seconds; participant can state whether content is source, metadata, or AI | First click, auth surprise, false starts, query retention, source confidence |
| `U-02` | “You monitor Microsoft. Find what changed most recently and open the exact underlying filing.” | Exact recent filing reached, not a generic Microsoft result list | Interpretation of Recent Filings row, form/date/accession retained, backtracking |
| `U-03` | “Compare disclosure evidence for two issuers and take a copy away for a colleague.” | Correct comparison mode and companies; export opens and matches visible scope | Meaning of Benchmark/Audit Matrix/Redline, export prediction and verification |
| `U-04` | “Find official SEC guidance on a topic and explain which text is official and which is generated.” | Official source reached; participant correctly distinguishes source, app-derived data, and AI | Navigation choice, labels, provenance language, trust rating |
| `U-05` | “Save this research so you can return tomorrow. Explain whether anything will notify you in the background.” | Saved item can be reopened; participant accurately understands local-only/manual behavior | Meaning of Alert, persistence expectation, discoverability after four saved items |
| `U-06` | “Use Help to learn how to open a filing from search, then do it.” | Help instruction and actual behavior agree; filing is reached | Home/breadcrumb expectation, preview-versus-detail confusion, number of detours |
| `U-07` | “Change the visual preference, review privacy consent, and find where account settings would live.” | Theme and consent found; participant identifies account entry or clearly reports no settings home | Whether avatar is recognized, fragmented-preference confusion, requested labels |
| `U-08` | “Capture one piece of filing evidence with a note, make a memo, and retrieve or export it.” | Correct citation, note, memo state, and expected export artifact | Meaning of Cite/Memo/Export, local persistence, source traceability |

### Observer record

For each task, record:

- completion: unassisted / assisted / failed;
- time to first meaningful action and total completion time;
- first click and expected outcome stated before click;
- false starts, reversals, repeated clicks, and backtracking count;
- terms questioned or interpreted incorrectly;
- whether “Illustrative,” “live,” “browser-local,” “alert,” “AI insight,” and “official source” were understood;
- whether the final artifact/source actually matched the requested company, filing, dates, and scope;
- confidence in the final answer from 1–5 and why; and
- concise participant quotes at each confusion point.

### Neutral-visitor acceptance thresholds

- At least 5 of 6 participants complete each critical task (`U-01`–`U-05`) without assistance.
- Median time to primary source for `U-01` and exact filing for `U-02` is at most 60 seconds.
- Median false starts are no more than one per task.
- 100% correctly distinguish official source from generated AI after `U-04`.
- 100% understand before saving that alerts/monitors are browser-local and manual, unless the product is changed to provide scheduled notifications.
- No participant interprets an outage, unrated item, or missing source as proof that the underlying fact does not exist.
- Any control whose expected outcome is predicted incorrectly by at least 3 of 6 participants becomes a copy/IA defect even when technically functional.

## 11. Release gates

The release is a **no-go** if any hard gate fails.

### Hard functional gates

1. All 25 route contracts are represented in the executable manifest; a meta-test fails when a route is added without a contract.
2. Every distinct control class `C-01`–`C-28` has at least one passing behavioral test and every page-specific use is wired through the route matrix.
3. All existing tests, typecheck, lint, and production build pass.
4. All P0/P1 regression tests pass three consecutive clean runs; latest-request tests pass under repeated randomized delays.
5. No Retry changes the applied request, no result action loses record identity, and no stale request overwrites the latest task.
6. Success, true zero, partial/degraded coverage, authentication failure, and upstream failure are distinguishable on every data-backed route.
7. AI, export, saved-search, and memo actions use the same applied evidence snapshot displayed to the user and disclose any truncation.
8. No visible production control is inert. `/design-gallery` is either internal/protected or satisfies its explicit specimen contract.

### Hard browser, accessibility, and production gates

1. Zero uncaught console/page/hydration errors in deterministic route tests and production smoke.
2. Zero axe critical/serious issues in page archetypes and open overlays; exactly one page-level main and a usable h1 on every public/product page.
3. Every visible form field and interactive control has a programmatic accessible name; every task can be completed by keyboard.
4. No horizontal overflow at 1280 px or 390 px; every desktop capability has a usable mobile path.
5. Downloads contain the expected data, external links identify the exact source record, clipboard rejection is reported, and blocked popups have recovery.
6. Production sign-in uses production configuration, displays no “Development mode” warning, preserves the exact return query, and emits no RSC navigation error.
7. Anonymous, unentitled, user-entitled, and org-entitled boundaries produce the expected 200/redirect/403 outcomes without leaking prior identity storage.

### Comprehension gates

1. Neutral-visitor thresholds in section 10 are met for critical tasks.
2. Support instructions agree with actual destinations and control labels.
3. Official evidence, app-derived calculations, local-only state, illustrative content, and AI output are unmistakably distinguished.
4. “Alert,” “monitor,” “export,” “Open/View,” and “Home” never promise an outcome materially different from the implemented action.

## 12. Execution order

1. Convert `F-01` through `F-11` into failing regression tests before fixes.
2. Add the route-contract manifest/meta-test and shared control suites.
3. Cover shell, landing, authentication, Dashboard Recent Filings, and Workbench source navigation first; these are the visitor's entry and trust path.
4. Cover shared table/filter/AI/memo/export controls once, then wire page-level assertions for each consumer.
5. Complete remaining route families: research, benchmark/reference, transactions, dynamic filing/dossier, legal/support, internal gallery.
6. Add accessibility, mobile, visual, and randomized race passes.
7. Run the neutral-visitor protocol on staging; fix copy/IA mismatches and repeat failed tasks.
8. Run production read-only smoke and publish a traceability report before release approval.

## 13. Required test evidence and reporting

Each automated test title must begin with its matrix ID, for example:

```text
P-02 / F-03 — Recent Filing opens the exact accession
C-12 / P-17 — M&A Retry preserves entity query and filters
S-08 / P-14 — Staff Guidance remains visible when older Rules request resolves last
```

On failure, retain:

- expected and actual route/request payload;
- console and page errors;
- Playwright trace;
- screenshot and DOM snapshot at failure;
- downloaded file where relevant;
- fixture and identity/entitlement state; and
- whether the issue is a confirmed defect, confusing expectation, or still only a proposed test.

The release report must give totals for page contracts, control classes, state contracts, accessibility findings, neutral tasks, and known exceptions. A passing raw test count alone is not sufficient evidence that the site does the job it presents to a visitor.

## 14. Implemented starter harness

The repository now includes an executable first layer of this plan:

- `src/__tests__/uiPageContracts.ts` is the 25-page, page-action, and shared-action contract manifest.
- `src/__tests__/uiPageContracts.test.ts` keeps the manifest aligned with registered and dynamic routes.
- `tests/e2e/route-smoke.spec.ts` checks that every route reaches the expected workspace rather than an error shell.
- `tests/e2e/semantic-census.spec.ts` records controls, names, landmarks, duplicate IDs, ARIA references, overflow, first-party request failures, and runtime errors per route.
- `tests/e2e/neutral-visitor.spec.ts` exercises the anonymous entry path, landing search, public destinations, CTA routing, and mobile navigation.

Install the browser once, then run the suites against the live local server:

```bash
npx playwright install chromium
npm test -- src/__tests__/uiPageContracts.test.ts
QA_BASE_URL=http://localhost:3033 npm run test:ui:smoke
QA_BASE_URL=http://localhost:3033 npm run test:ui:audit
QA_BASE_URL=http://localhost:3033 npm run test:ui:visitor
QA_STRICT_AUDIT=1 QA_BASE_URL=http://localhost:3033 npm run test:ui:audit
```

The default audit is evidence-collection mode so it can inventory the current product without hiding later routes behind the first known defect. `QA_STRICT_AUDIT=1` promotes every collected issue to a failing release gate. Playwright traces, screenshots, and JSON attachments are written beneath the configured temporary `QA_OUTPUT_DIR` on failure.
