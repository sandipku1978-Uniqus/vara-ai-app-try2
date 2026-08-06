# Filing AI — pre-filing integrity check

A pre-flight check that runs between "draft complete" and "hit submit" on an SEC
filing. It takes a filing package, executes a governed rule catalog across six
check layers, and returns an exception report with evidence, cited authority and
a readiness gate — plus a sealed evidence pack the engagement can retain as
management review control evidence.

It is built inside the Uniqus Research Center application rather than beside it,
because everything the input layer needs — an audited EDGAR fetch path, a filing
text cache, entity reference data, authentication and tenant scoping — already
exists here and is already hardened.

> This module evidences the operation of a management review control. It is not
> an audit, review or attestation, expresses no opinion on the financial
> statements, and does not conclude that a filing is free from error. That
> sentence is stamped onto every result by the serialiser; no caller can remove
> or alter it.

---

## Input → Process → Output → Governance

```
INPUT (I1-I5)  ──►  PROCESS (P1-P6)  ──►  OUTPUT (O1-O7)
                                              │
              GOVERNANCE (G1-G8) ─────────────┘
              spans all three layers
```

**Input is a contract, not an upload.** Six gates decide what may run. The set of
inputs that actually arrive and pass their gate deterministically fixes which
rules execute, and therefore what the output is allowed to claim.

**Process separates the deterministic from the probabilistic.** Rules and
arithmetic on one path; a narrow, retrieval-bound judgment layer on another. The
boundary stays visible all the way to the screen.

**Output states its own blind spots.** The coverage statement is mandatory and
non-suppressible, and the coverage factor multiplies the readiness score so a
partial run cannot arithmetically present as a clean result.

**Governance is what makes it usable as control evidence** rather than an
opinion.

---

## Where each piece lives

| Layer | Concern | Module |
|---|---|---|
| I1–I4 | Artefact acquisition from EDGAR | `src/lib/filing-ai/artifacts.ts` |
| I4 | Authority pinned to the filing period | `resolveAuthority()` in `artifacts.ts` |
| G1–G6 | Input gates | `src/lib/filing-ai/gates.ts` |
| P1 | Normalize → CanonicalFilingModel | `src/lib/filing-ai/normalize.ts`, `ixbrl.ts` |
| — | Rule catalog and selection | `src/lib/filing-ai/catalog.ts`, `rule-catalog.json` |
| — | Rule → predicate bindings | `src/lib/filing-ai/bindings.ts` |
| P2–P4 | Predicate execution | `src/lib/filing-ai/predicates.ts` |
| P6 | Scoring, dedup, coverage | `src/lib/filing-ai/scoring.ts` |
| — | Pipeline orchestration | `src/lib/filing-ai/engine.ts` |
| GR-1…GR-5 | Guardrails and the seal | `src/lib/filing-ai/guardrails.ts` |
| G1, G3, G4, G7 | Engagements, roles, dispositions | `src/lib/filing-ai/governance.ts` |
| G5 | WORM run store, append-only log | `src/lib/filing-ai/store.ts`, `db/migrations/024_filing_ai.sql` |
| O1–O7 | API | `src/app/api/filing-ai/**` |
| O2–O6 | UI | `src/views/filing-ai/**`, `src/app/filing-ai/**` |

---

## INPUT

### What is fetched, and from where

Everything goes through `src/lib/sec-upstream.ts`, the same audited egress path
the research centre uses: a strict target allow-list, central fair-access pacing
across redirects, bounded body reads, media-type validation and error-page
detection. Filing AI adds no new egress surface.

| Ref | What | Source |
|---|---|---|
| I1 | Filing package — primary document, exhibit set, certifications | EDGAR filing index `index.json` and the archive directory |
| I2 | Filing history and prior-period facts as originally reported | `data.sec.gov/submissions`, `data.sec.gov/api/xbrl/companyfacts` |
| I3 | Entity reference — name, CIK, fiscal year end, filer category, exchanges, EIN, state | `data.sec.gov/submissions` |
| I4 | Authority corpus versions | Derived from `period_of_report`, never from `now()` |
| I5 | Client source data — trial balance, mapping, consolidation, cap table | Not ingested in this build; every rule that needs it is suppressed and disclosed |

### The gates

| Gate | Question | Failure behaviour |
|---|---|---|
| G1 | Is the filing package whole enough to test? | Hard stop |
| G2 | Did the normalizer read it? | Suppress the dependent rules and disclose |
| G3 | Is this the filing the caller asked about, for the entity they named? | Hard stop |
| G4 | Can authority be pinned to the filing period? | Hard stop |
| G5 | Is there client source data to reconcile against? | Suppress the tie-out rules and disclose |
| G6 | What tier do the surviving inputs actually support? | Always proceeds; sets the effective tier |

The effective tier is derived from what arrived and passed — never from the
tier the caller declared. A caller claiming Tier 2 without source data gets a
Tier 1 run whose own coverage statement says so.

---

## PROCESS

### P1 — the CanonicalFilingModel

The normalizer is where most of the engineering risk sits. Two principles:

1. **Prefer the structured source.** Numeric facts come from the inline XBRL
   embedded in the primary document, not from HTML tables — filing agents
   produce wildly inconsistent markup. Reading facts from the document a human
   opens also gives every fact a character range, which is what makes a finding
   verifiable.
2. **Never guess.** Anything the parser cannot resolve is recorded in
   `unparsed_regions`, which suppresses the dependent rules and appears in the
   coverage statement. A silent parse failure would become a silent clean
   report — the most dangerous output this product can produce.

`ixbrl.ts` is a deliberate scanner rather than a DOM parse: a 10-K routinely
runs past 10 MB, namespace prefixes vary by filing agent, and a DOM walk
discards the byte offsets the evidence pack needs. It runs one linear pass with
a stack.

**Dimensional facts are excluded from every recomputation.** A segment's revenue
is not the registrant's revenue, and mixing them is the fastest route to a
tie-out engine that flags every filing it sees.

### Rules are data; predicates are code

`rule-catalog.json` holds 176 rules. A rule says *what* is tested and on whose
authority; `bindings.ts` says *how* — which predicate runs, with what
parameters, and under what requirement condition. The rule board can amend a
rule's scope, severity or effective date without a deploy.

Sixteen predicates cover the catalog:

```
exhibit_present            exhibit_index_resolves      exhibit_classification
certification_text_conforms                            certification_cross_reference
signature_block            cover_field                 dei_tag_present
dei_tag_consistent         header_matches              xbrl_structural
recompute                  section_present             section_conclusion
prior_period_diff          unbound
```

`unbound` is not a rule that passes. It is a rule this build cannot evaluate; it
is subtracted from coverage and named in the coverage statement.

### Four outcomes, and the last two are the product

| Outcome | Meaning |
|---|---|
| `pass` | Evaluated; the filing satisfies the rule |
| `fail` | Evaluated; the filing does not |
| `unresolved` | The requirement's condition cannot be answered at this tier — a question for a preparer, never a blocking defect |
| `not_applicable` | The rule does not apply, or the facts it needs were not tagged. Subtracted from coverage, **never** recorded as a pass |

The distinction between the last two is what separates "we looked and it was
fine" from "we could not look". Conditional requirements are encoded explicitly
because a naive "always required" exhibit rule fires on legitimate filings and
destroys trust faster than any false negative.

### Tolerances

Every numeric rule carries an explicit relative band and an absolute floor.
Rounding differences must not generate findings — this is the single largest
false-positive source in tie-out engines. Cover-page share counts get a wider
band because they are stated as of a date after the period end, so ordinary
equity activity legitimately moves them.

---

## OUTPUT

### Readiness and the gate — computed separately

```
raw   = 100 − 25·critical_open − 8·high_open − 3·medium_open − 1·low_open
score = max(0, raw) × coverage_factor

gate  = NOT_READY              if any open blocking finding
        READY_WITH_EXCEPTIONS  elif any open finding
        READY                  else
```

The gate is independent of the score. A single open blocking finding sets
NOT_READY regardless — "92% ready" next to a missing SOX certification is the
kind of number that gets a filing submitted.

### Root-cause de-duplication

One wrong share count that breaks basic EPS, diluted EPS, a non-GAAP measure and
a footnote is **one finding with four symptoms**. The surviving representative
is the most severe member of the group and its blocking flag is the OR across
the group, so grouping can never soften a blocking defect.

### The coverage statement

Assembled from what was actually suppressed, so it cannot drift from the run it
describes. It carries the effective tier and inputs received, rules executed
over rules applicable, every suppression grouped by reason with its gate, every
parsing limitation, the tier's standing blind spots, and the fixed scope
language.

### Reading order on screen

Gate before score; coverage before findings. A reader who sees twelve exceptions
before learning that 35% of the catalog never ran has already drawn the wrong
conclusion.

---

## GOVERNANCE

### Onboarding is a gate, not a wizard

Six blocking steps, each of which prevents a specific later failure: an
unconfirmed registrant makes the cover-page rules test against the wrong
reference data; an unpinned authority corpus measures a FY2022 filing against
FY2025 requirements; a team of one cannot obtain the second approval a critical
acceptance requires.

Runs started before activation are marked **pilot** and say so in their own
coverage statement.

### Roles

| Role | May do |
|---|---|
| Preparer | Start a run; mark a finding remediated |
| Reviewer | Everything above; accept or suppress a finding with a rationale |
| Engagement partner | Everything above; provide the second approval on a critical acceptance; manage members |
| Rule board | Promote and retire catalog rules. Deliberately holds no disposition authority |
| Observer | Read-only |

### Disposition (G3)

Every disposition requires a named actor and a substantive rationale. A
suppression requires an expiry, so it is revisited rather than becoming
permanent. An acceptance at or above the engagement's four-eyes threshold
requires a second, different named approver. A judgment prompt cannot be closed
by remediation.

The check runs **before** the write, so a disposition that would fail G3 never
reaches the append-only log.

### The store (G5)

| Table | Shape |
|---|---|
| `urc_filing_ai_engagements` | Mutable |
| `urc_filing_ai_runs` | Write-once; an update or delete trigger raises |
| `urc_filing_ai_dispositions` | Append-only; a superseding decision is a new row |

A finding's current status is the fold of its disposition log over the sealed
result. The evidence a reviewer relied on is still byte-for-byte in the row they
saw it in.

The `urc_` prefix is load-bearing: migration 023's schema contract inventories
every `urc\_%` relation and raises if a generic web role can read or write one.
These tables are granted to `service_role` only, with no web-role surface at
all, and migration 024 asserts that at the end of its own run.

### Guardrails, as code

| Ref | Constraint | Where |
|---|---|---|
| GR-1 | Never asserts a filing is correct, compliant or free from error | Denylist filter over every prose string, in the serialiser |
| GR-2 | Coverage statement is mandatory and its scope language is stamped, not supplied | `assertCoveragePresent`, `sealRunResult` |
| GR-3 | Deterministic findings carry confidence exactly 1.0 | `assertDeterministicConfidence` |
| GR-4 | Judgment findings never auto-clear | `assertJudgmentNeverAutoClears` |
| GR-5 | Uncited model output is discarded | Same assertion; a judgment finding without a retrieved passage cannot be serialised |
| GR-6 | Authority pinned to the filing period | `resolveAuthority(period_of_report)`; G4 hard-stops on an unusable period |
| GR-7 | Rules are never deleted | Retirement is the only exit; `canPromote` |
| GR-8 | Selection by filing period, never run date | `withinEffectivePeriod` in `selectRules` |

`sealRunResult` is the single exit point. There is one place to audit and no
path to a user that skips it.

Nine seed catalog rules named their *test* using assurance vocabulary
("classification correct", "tagging complete"). Rule names surface verbatim as
finding titles, so the catalog was amended for GR-1 conformance rather than the
guardrail weakened; rule ids, severities, authorities and scopes are unchanged,
and a test now blocks reintroduction.

---

## What this build covers

| Wave | Scope | Deployed |
|---|---|---|
| P0 | Tier 0 — mechanical, XBRL, consistency, disclosure. No client data | Yes |
| P1 | Adds continuity against amounts as originally reported | Partly — `R-CONT-001` |
| P2 | Tier 2 tie-outs and the judgment layer | No |

Form scope is 10-K. Rules scoped to 10-Q are selected out by form, not silently
passed.

**Rules with a deployed predicate are visible on the rule catalog screen**, and
every rule without one carries a stated reason that appears in each run's
coverage statement.

### Known gaps, stated plainly

- **Table-grid reconstruction is not built.** Roll-forwards, maturity schedules,
  tax rate reconciliations and non-GAAP reconciliations depend on it and are
  unbound.
- **Linkbases are not read.** Calculation consistency, element selection,
  axis/member misuse and face-statement tagging completeness depend on them.
- **Narrative number extraction is not built.** It is the largest
  false-positive source in this class of engine and needs its context filter
  before the rules that use it can ship.
- **The judgment layer is not built.** No retrieval index, therefore no prompts.
- **The catalog is pre-approval.** Every seed rule is `Draft`, so a production
  run executes nothing; pilot runs execute the catalog and disclose that they
  did.

---

## Data pipeline reuse from the research centre

| Reused | For |
|---|---|
| `lib/sec-upstream.ts` | Every EDGAR read: allow-list, pacing, bounded reads, error-page detection |
| `lib/sec-request-pacer.ts` | Fair-access spacing shared with all other SEC traffic |
| `lib/filingTextServer.ts` | Text extraction identical to the search path |
| `lib/api-auth.ts` | Authentication and org scoping on every route |
| `lib/rate-limit.ts` | Per-operation limits; a run is limited more tightly than a read |
| `lib/supabase-web.ts` | The audited cache-writer credential |
| Design system | `src/index.css` tokens; light and dark follow the app |
| Layout, command palette, breadcrumbs | New routes are ordinary product routes |
| QA registries | `uiPageContracts`, `uiActionCoverage`, `route-contracts` |

### Not yet wired, and worth doing

- **Comment-letter corpus** → `R-CONT-007` (a matter previously raised by the
  staff recurring in this filing) can read the existing UPLOAD/CORRESP index.
- **Form AP auditor data** → auditor identification and tenure checks
  (`R-DISC-018`) currently read the filing's own text; the PCAOB Form AP tables
  already in `urc_sec_auditors` would make it a cross-source test.
- **`urc_sec_filings`** → filing-history reads could come from Postgres instead
  of a submissions round trip per run.
- **Peer benchmarking** → an exception report could show how often peers carry
  the same finding, which changes an exception from a defect into a signal.

---

## Running it

```
POST /api/filing-ai/runs      { cik, form_type, accession?, tier, engagement_id? }
GET  /api/filing-ai/runs
GET  /api/filing-ai/runs/:id
PATCH /api/filing-ai/runs/:id/findings/:findingId
GET  /api/filing-ai/catalog
GET|POST /api/filing-ai/engagements
```

Screens: `/filing-ai` (console), `/filing-ai/runs/:id` (exception report),
`/filing-ai/catalog` (rule board), `/filing-ai/governance` (engagements).

Without Supabase configured the store falls back to process memory and the
console says so. Applying `db/migrations/024_filing_ai.sql` makes runs durable.

## Tests

```
npx vitest run src/__tests__/filingAi          # engine, 169 assertions
npx playwright test tests/e2e/filing-ai-interactions.spec.ts
```

`src/__tests__/fixtures/filing-ai-10k.ts` builds synthetic 10-K documents with
switchable defects — a missing exhibit, a rewritten certification paragraph, a
balance sheet that does not balance, a cover period that disagrees with the
submission. Building them by hand is what makes those paths testable without
waiting for a registrant to make the mistake.

The back-test harness described in `backtest-harness.md` — real EDGAR filings
paired with the amendments that corrected them — is the acceptance gate for
recall and precision and has not been run. Nothing here substitutes for it.
