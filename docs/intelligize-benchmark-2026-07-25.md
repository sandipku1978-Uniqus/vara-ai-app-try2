# Intelligize+ AI vs Uniqus Research Center — data-feature benchmark

Observed 2026-07-25 in a live licensed Intelligize session. Scope per instruction:
**data features, not AI features.** Protégé (their AI layer) is deliberately out of scope.

## What was actually tested

Five Boolean queries were run and **verified** on Intelligize (Forms = 10-K, Filings +
Exhibits, no date filter). Fewer than the twenty planned: their keyword box turns each
entry into a chip, and a mis-aimed clear leaves the previous query concatenated to the
next one. The first attempt produced exactly that —
`mezzanine"temporary equity"mezzanine OR "temporary equity"` — and two counts that looked
like a headline defect in their OR. They were my automation error. Every count below was
re-run with the keyword box visually confirmed empty first, and the applied-filter chip
read back from the results header.

| # | Query | Intelligize docs |
|---|---|---|
| 1 | `"material weakness"` | 101,909 |
| 2 | `mezzanine` | 29,616 |
| 3 | `"temporary equity"` | 9,199 |
| 4 | `mezzanine OR "temporary equity"` | 36,849 |
| 5 | `"goodwill impairment" W/10 $#` | 19,125 |

**Union check** on 2/3/4: `max(29,616, 9,199) ≤ 36,849 ≤ 29,616 + 9,199`. Their OR is a
true union, with ~1,966 filings carrying both. This is the same property our engine failed
on before the Boolean remediation and now passes in e2e. **No semantic defect was found in
their Boolean engine.**

The operator comparison below is far more informative than more counts would have been,
and it is read from their own in-app syntax help rather than inferred.

## 1. Boolean operators

| Operator | Meaning | Intelligize | URC |
|---|---|---|---|
| `AND` / `OR` / `NOT` | logical | ✅ | ✅ |
| `" "` | exact phrase | ✅ | ✅ |
| `( )` | grouping | ✅ | ✅ |
| `W/n` | within N words (unordered) | ✅ | ✅ |
| `P/n` | **preceding by N words (ordered)** | ✅ | ❌ |
| `*` | multi-character wildcard (`crypto*`) | ✅ | ❌ |
| `?` | single-character wildcard (`wom?n`) | ✅ | ❌ |
| `#` | **any number / `%#` `$#` `£#` `¥#` `€#`** | ✅ | ❌ |
| `auditor:` inline field | audit firm inside the expression | ❌ (filter only) | ✅ |
| Synonym expansion | "Expand Keywords" | ✅ | ❌ |
| Concept mode | "Conceptual" tab | ✅ | ✅ (semantic mode) |

`#` is the standout. `"goodwill impairment" W/10 $#` returns every filing that quantifies a
goodwill impairment — the snippet highlighted `$206.6` and `$194.4` beside the phrase. For
accounting research that single operator replaces a whole manual review pass. `%#` does the
same for rates ("effective tax rate W/5 %#").

## 2. The gap that matters most: scale and count honesty

| | Intelligize | URC |
|---|---|---|
| Corpus total shown | **"Docs: 101,909"** in the tab label | **never shown** |
| Documents evaluated | whole corpus, server-side index | `MAX_DOC_ATTEMPTS = 120` per run |
| Result of a broad query | 101,909 with 4,077 pages of results | tens of validated rows + a partial-coverage notice |

Our results are individually *correct* — that is what the accuracy gate now proves — but a
researcher asking "how many filers disclosed a material weakness?" gets an answer from them
and does not get one from us. We already read `hits.total.value` from EFTS inside
`secApi.ts` for pagination and throw it away.

**This is the single highest-leverage fix in this document and it is nearly free.**

## 3. Search filter surface

Their SEC Filings search exposes 36 filters. Ours exposes roughly a third of them.

**We have no equivalent of:**

| Filter | Why it matters |
|---|---|
| **Section** | scope a keyword to Item 1A / Item 7 / Notes |
| **Keywords in Section Title** | find sections *named* something |
| **Table Type/Title** + **Search In Table** | search inside tables, not just prose |
| **iXBRL Tag** | search by XBRL element — we now *read* blocks, they let users *query* tags |
| **ASC and ASU References** | find every filing citing ASC 842 / ASU 2023-07 |
| Exhibit # | pull EX-10.1 across the market |
| Law Firm, Accountant Fees, Filing Agent/Software | deal and engagement analytics |
| Market Cap / Revenue / Net Income ranges | size-banded peer sets |
| Index, Exchange, Accelerated Status, Incorporated In, HQ | population definition |

We do have `Accountant` equivalence (our `auditor:` filter, plus PCAOB Form AP as the
authority — arguably better sourced) and form/date/company scoping.

## 4. Result list

Theirs, per hit:

- **Section-path breadcrumb on every snippet** —
  `Item 9A. Controls and Procedures › Remediation of Previously Reported Material Weakness`
  and `Item 8 › REPORT OF INDEPENDENT REGISTERED PUBLIC ACCOUNTING FIRM › Basis for opinion`
- Multiple snippets per filing, plus **View All Hits**
- Exhibits nested under the parent filing (EX-23.1, EX-31.1, EX-101 …)
- iXBRL badge, page count, file size, date filed, per-row bookmark
- Toolbar: Download · Email · Share Link · **Excel List** · **Extract Company List** · **Compare**
- One tab per search, each labelled with its count, and **Save Tabs**

We show a flat result row with a single snippet and no structural context.

## 5. Disclosure Benchmarking — the deepest gap

This is their analogue of our Benchmarking view, and it is a different class of product.

**Entire Document Matrix** — year-over-year change detection across a *whole* 10-K:

- Rows = sections (Item 1, Item 1A, Item 1C, Item 2, Item 3, Item 5, Item 7 …)
- Columns = peer companies, each showing `10-K FY2025 vs 10-K FY2024`
- Cells = **count of changed subsections**, heat-shaded by materiality
- Filter chips: **Major Changes / Moderate Changes / Minor Changes / New Section / Deleted Section**
- **Chronological (Single Company)** mode for one filer across time
- Peer-group presets, or build/load a saved matrix

Also: **Section Matrix** (one section across filers), plus separate **ESG Risk Factors** and
**Comment Letters** matrices.

Underneath it sits a **normalized cross-form section taxonomy** — Risk Factors, Notes to
Financial Statements, Business, MD&A, CD&A, Prospectus Summary, Underwriting, Cover Page,
Experts, Financial Statements, Legal Matters, Use of Proceeds — mapped across 10-K, 10-Q,
20-F, S-1, S-3, S-11, F-1, 424B, F-4, S-4 and Proxies. That taxonomy is the data asset that
makes everything above possible.

And a **Research Library** of curated saved searches by category (Cybersecurity, Enforcement,
Finance & Accounting, Governance/ESG, MD&A, Regulatory, Risk Factors, Current Events).

**We do none of this.** Our Benchmarking compares text for one period across peers. We have
no year-over-year diff, no change-materiality classification, no matrix, no chronological view.

## 6. Module inventory

| Module | Intelligize | URC |
|---|---|---|
| SEC Filings search | ✅ | ✅ |
| Disclosure Benchmarking + matrices | ✅ | partial |
| ESG | ✅ | ✅ |
| Insiders | ✅ | ✅ |
| Accounting Standards & Guidance (+ **GAAP Checklists, Handbooks**) | ✅ | partial |
| Accounting Analytics | ✅ | ✅ |
| **Earnings & Event Transcripts** | ✅ | ❌ |
| **Firm Memos** (accounting/law/consulting) | ✅ | ❌ |
| **Newsletters** | ✅ | ❌ |
| ESG Standards & Guidance | ✅ | partial |
| Securities Regulation & Compliance | ✅ | ✅ |
| Comment Letters | ✅ | ✅ |
| No-Action Letters | ✅ | ✅ |
| Agreements & Other Exhibits | ✅ | ✅ |
| Exempt Offerings | ✅ | ✅ |
| SEC Litigation Releases | ❌ | ✅ |
| IPO Center | ❌ | ✅ |
| M&A Research | ❌ | ✅ |
| ADV Registrations | ❌ | ✅ |
| Board Profiles | ❌ | ✅ |

Content licensing (transcripts, firm memos, newsletters, GAAP handbooks) is a
buy-not-build gap and should be treated as a commercial decision, not an engineering one.

---

# Action plan

Ordered by value per unit of effort. Everything here is a data/search capability.

## P0 — close the credibility gap (days)

**A1. Show the corpus total.** EFTS already returns `hits.total.value` and
`secApi.ts` already reads it for pagination. Surface it: "2,340 filings match — 50 validated
and shown". This converts our honest-but-thin result set into an honest *and* complete
answer, and it is the difference between looking bounded and looking broken. Keep the
existing coverage/stop-reason notice underneath it.

**A2. Section-path breadcrumbs on snippets.** We built XBRL block resolution in
`filingStructure.ts` and Item-level extraction in Benchmarking. Reuse both to label each hit
with the Item/section it came from. Highest visible-quality-per-line-of-code item we have.

**A3. `#` numeric operator.** Add `#`, `$#`, `%#` to `booleanSearch.ts` as a term type that
matches a number/currency/percentage token, composable with the existing `W/n`. Small, well
covered by the existing engine tests, and unlocks the "quantified disclosure" query class
that accountants actually run.

## P1 — search parity (weeks)

**B1. `*` and `?` wildcards.** Straightforward in our matcher; note EFTS does not support
them upstream, so they apply at the validation stage and will narrow, not widen, retrieval.
Document that limit rather than pretending parity.

**B2. `P/n` ordered proximity.** We already have unordered `W/n`; ordering is a small
extension of the same AST node.

**B3. Section-scoped keyword filter.** "Item 1A contains X" — we have Item extraction
already; this is exposing it as a filter rather than new machinery.

**B4. ASC / ASU reference filter.** Regex-extract `ASC ###` and `ASU 20##-##` at index time
into a facet. Directly serves the technical-accounting audience and is pure data work.

**B5. Raise the recall ceiling.** `MAX_DOC_ATTEMPTS` is still 120 and the server-side
pre-screen already makes each attempt cheaper. Now that A1 exposes the true total, the gap
between "matched" and "validated" becomes visible and worth closing.

## P2 — the Benchmarking gap (quarters, highest product value)

**C1. Normalized cross-form section taxonomy.** The prerequisite for everything else. Map
10-K Item 1A, S-1 "Risk Factors", 20-F Item 3.D onto one concept. This is the asset, not the
UI.

**C2. Year-over-year section diff.** For one filer, diff each section against the prior
period's same section. We already extract sections and already have a diff view.

**C3. Change materiality classification.** Bucket diffs into Major / Moderate / Minor / New /
Deleted. Start deterministic (percentage of tokens changed, whether a subsection appeared or
vanished) before reaching for a model — it is explainable and cheap.

**C4. The matrix.** Sections as rows, peers as columns, changed-subsection counts as
heat-shaded cells, with a chronological mode for a single filer.

**C5. Curated research library.** Saved searches by category. Low effort, and it is how a new
user discovers what the platform can do.

## P3 — export and workflow

**D1. Excel export and "extract company list"** from any result set.
**D2. Multi-tab searches with counts, and save-tabs.** Researchers run several queries at once
and compare; we force serial work.
**D3. Exhibit nesting** under the parent filing in results.

## Explicitly not recommended now

- Competing with Protégé. Out of scope per instruction, and the data layer is where the
  durable advantage is anyway.
- Licensing transcripts / firm memos / newsletters / GAAP handbooks. Real gaps, but
  commercial decisions.
- Rebuilding what we already lead on: SEC Litigation Releases, IPO Center, M&A Research,
  ADV Registrations and Board Profiles have no Intelligize counterpart in the module list,
  and PCAOB Form AP gives our auditor data a better provenance story than their filter.
