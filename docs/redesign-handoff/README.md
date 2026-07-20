# Uniqus Research Center redesign — developer handoff

Date: 2026-07-20

## Recommendation

Use **Evidence Ledger** as the primary design direction. It is the strongest
option for helping a visitor move from a question to verified evidence and then
to a citation-ready deliverable.

The recommended public-to-product journey is:

1. The visitor enters a company, ticker, filing, disclosure topic, accounting
   standard, or natural-language question in the landing-page search.
2. Autocomplete identifies the intent and offers company, topic, filing, and
   standard matches.
3. The query opens in the Research Workbench with its state preserved.
4. Results show the match reason, filing section, source status, and excerpt.
5. The selected result opens in a persistent evidence/notebook rail.
6. Evidence can be added to a memo, copied as a citation, compared, or opened in
   an issuer dossier.

The public landing-page mockup currently uses a **Start research** button. For
implementation, replace the hero's primary CTA area with a real universal
search field and retain **Request demo** as the secondary action.

## Bundle contents

- `plan/total-redesign-plan-2026-07-19.md` — product, information architecture,
  design-system, migration, and acceptance plan
- `mockups/01-evidence-ledger.png` — preferred Research Workbench direction
- `mockups/02-analyst-console.png` — optional monitoring/dark-mode reference
- `mockups/03-research-desk.png` — document-workflow reference
- `mockups/evidence-ledger-system/04-landing-page.png`
- `mockups/evidence-ledger-system/05-monitor-dashboard.png`
- `mockups/evidence-ledger-system/06-issuer-dossier.png`
- `mockups/evidence-ledger-system/07-filing-detail.png`
- `mockups/evidence-ledger-system/08-company-compare.png`
- `mockups/evidence-ledger-system/09-comment-letters.png`
- `prompts/initial-directions.md` and `prompts/evidence-ledger-system.md` — the
  exact image-generation prompts

Mockups are conceptual design references. Dates, issuer facts, metrics, excerpts,
counts, and generated summaries must be validated against application data.

## Route and source mapping

| Mockup | Route | Primary existing source |
|---|---|---|
| Public landing page | `/` | `src/views/LandingPage.tsx`, `src/views/LandingPage.css` |
| Research Workbench | `/search` | `src/views/SearchPage.tsx`, `src/views/SearchPage.css` |
| Monitor | `/dashboard` | `src/views/Dashboard.tsx`, `src/views/Dashboard.css` |
| Issuer dossier | `/company/[ticker]` | `src/app/company/[ticker]/page.tsx`, `DossierTabs.tsx` |
| Filing detail | `/filing/[...slug]` | `src/views/FilingDetail.tsx`, `src/views/FilingDetail.css` |
| Company compare | `/compare` | `src/views/Benchmarking.tsx`, `src/views/Benchmarking.css` |
| Comment Letters | `/comment-letters` | `src/views/CommentLetters.tsx` |
| Global shell | all product routes | `src/components/layout/Layout.tsx`, `Layout.css`, `src/index.css` |

## Implementation priorities

### 1. Foundations

- Replace ambient gradients, glass surfaces, glow, and broad shadow defaults.
- Introduce warm-neutral canvas, flat white work surfaces, ink/slate text, and
  fine gray dividers.
- Restrict plum to selection, annotation, and primary actions; blue to links and
  citations; green to verification/freshness.
- Standardize 4–6px radii, a 4px spacing base, compact row heights, tabular
  numerals, and a serif face only for source-document text.

### 2. Shell and navigation

- Reorganize around Research, Companies, Compare, Monitor, and Reference.
- Add the global intent-aware search/command bar.
- Keep source freshness visible without turning it into a decorative badge wall.
- Preserve keyboard navigation and deep-linkable URL state.

### 3. Flagship research flow

- Implement the Research Workbench ledger and persistent notebook first.
- Show why each result matched and allow one-action source opening.
- Make add-to-memo and copy-citation available on every evidence-bearing row.
- Use progressive disclosure for filters after the visitor's initial query.

### 4. Reusable page archetypes

- Search/review ledger for filings, letters, exhibits, and enforcement
- Issuer dossier for company-centric research
- Three-pane document workspace for filings, standards, and regulations
- Monitoring activity ledger for watchlists and saved searches
- Sourced comparison matrix for benchmarking

## What should remain invariant

- Primary source content is always more prominent than generated summaries.
- Every generated claim exposes source count, citations, and review state.
- Working screens use one continuous canvas, not a mosaic of equal-weight cards.
- Color communicates state rather than atmosphere.
- Print, Word, and Excel outputs remain light, source-complete, and readable.
- The system remains useful at 1280px and scales to larger desktop widths.

## Developer evaluation checklist

- Can a new visitor submit a useful query without learning product taxonomy?
- Does the first result explain why it matched within one scan?
- Can every evidence item open its primary source in one action?
- Can evidence move into a memo or citation ledger without copy/paste?
- Are filters, selection, source freshness, and verification states unambiguous?
- Are tables usable with keyboard and screen reader navigation?
- Are loading, empty, error, stale-data, and permission states designed?
- Do printed and exported outputs omit navigation and dark application chrome?
- Can the redesign be migrated route by route without duplicating permanent
  design systems?

## Suggested delivery order

1. Tokens and component gallery
2. Shell, command search, and navigation
3. Research Workbench and evidence notebook
4. Filing detail and citation ledger
5. Issuer dossier
6. Monitor and Company Compare
7. Comment Letters and remaining search/review routes
8. Public landing page, responsive hardening, accessibility, and export QA

