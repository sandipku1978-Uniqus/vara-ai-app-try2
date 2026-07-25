# Accuracy gate

Closes readiness finding **F-09**. The previous accuracy number (894/950, 2026-07-20)
was produced by hand, could not be re-run, and predated most of the search work, so it
could not gate anything.

```bash
npm run accuracy                          # all suites
npm run accuracy -- --suite boolean       # one suite
npm run accuracy -- --json report.json    # machine-readable report
```

Exits non-zero below `ACCURACY_THRESHOLD` (default 90%).

## Design rule

**Nothing here asserts "the app still does what it did."** A snapshot of our own output
only proves we did not change, not that we are right. Every expectation is either read
from SEC at run time, or is a structural invariant that must hold for any correct
implementation.

Unreachable sources are **skipped, not failed** — scoring SEC downtime as a miss is how
the previous run produced uninvestigated 502s.

## Suites

| Suite | Ground truth | What it catches |
|---|---|---|
| `entity` | `company_tickers.json` | ticker/name failing to reach its own registrant |
| `filing-entity` | submissions + EDGAR ticker lookup | a ticker pointing at an entity with no filings |
| `xbrl` | `companyconcept` API | scale and sign errors in reported financials |
| `boolean` | live EDGAR corpus | union/intersection/phrase relationships; invalid syntax reaching EDGAR |
| `equivalence` | real 10-K text | the server pre-screen's safety claim, on real filings rather than synthetic strings |
| `disclosure` | real 10-K text + the filing's own `dei:AuditorName` | topic locator returning off-topic passages; wrong auditor of record |

The `disclosure` corpus is **32 issuers across 20 sectors** (`ACCURACY_DISCLOSURE_SAMPLE`
to trim it). Sector spread is the point: filing style varies far more by industry than by
size, and both defects reported from the product so far were disclosure-extraction bugs
that a large-cap tech corpus would not have caught.

Auditor ground truth is the filing's own `dei:AuditorName` iXBRL tag — required on annual
reports since 2021 — so the check compares our prose detector against the registrant's
structured declaration. Two independent readings of the same document, and no fixture to
go stale.

The `equivalence` suite exists specifically because the pre-screen's correctness argument
("server and browser reach identical verdicts") was only ever demonstrated on synthetic
strings. It now runs every probe over real mega-cap 10-Ks.

## Run — 2026-07-25 (after the successor-entity fix)

| Suite | Score |
|---|---|
| entity | 16/16 — 100% |
| filing-entity | 58/58 — 100% |
| xbrl | 18/18 — 100% |
| boolean | 5/5 — 100% |
| equivalence | 8/8 — 100% |
| disclosure | 20/20 — 100% |
| **Total** | **125/125 — 100%** |

Skipped (not scored): CYATY and KXIAY — newly listed ADRs with no annual report anywhere
in EDGAR, so there is nothing to correct to; JNJ revenue/equity — no annual facts under
the queried tags.

The first run scored 65/67 and surfaced one real defect, now fixed.

### Fixed — ticker resolved to a non-filing successor entity

`company_tickers.json` maps **XOM → CIK 2115436 "ExxonMobil Holdings Corp"**, created
2026-07-01, whose only filings are 8-K, S-8 POS, POSASR and **8-K12B** — the successor
form for a holding-company reorganization. It has **no annual report**. Exxon's entire
filing history is at **CIK 34088 "EXXON MOBIL CORP"** (10-K 2026-02-18). Both claim the
ticker; SEC's directory follows the ticker, so it points at the shell, and the shell has
no `formerNames` entry linking back.

Anyone searching XOM was routed to a CIK with no annual filings, so benchmarking,
dossier, financials and issuer-scoped Boolean search all returned nothing for a mega-cap.

`src/services/filingEntity.ts` now re-resolves through EDGAR's own ticker lookup when the
directory CIK has no annual report, accepting the candidate only if it genuinely files.
It is opt-in (`resolveCompanyInput(text, { verifyFilingHistory: true })`) because it costs
a submissions read: enabled where an empty issuer is the failure mode, off on the
speculative prefix probes that run per keystroke. Any failure falls back to the directory
value, so it can only improve resolution.

The lookup needs its own route, `/api/company-cik`. EDGAR answers in Atom and
`/api/sec-proxy` sanitizes every response as HTML, which strips `<cik>` and leaves loose
digits behind — including the registrant's phone number — that cannot be told apart from
a CIK. Parsing happens server-side on the raw response rather than by loosening the
sanitizer for every caller.

## Run — 2026-07-25, after widening across sectors

| Suite | Score |
|---|---|
| entity | 64/64 — 100% |
| filing-entity | 58/58 — 100% |
| xbrl | 20/20 — 100% |
| boolean | 5/5 — 100% |
| equivalence | 8/8 — 100% |
| disclosure | 158/159 — 99.4% |
| **Total** | **313/314 — 99.7%** |

Widening the corpus from 8 issuers to 32 across 20 sectors took the gate from 125 to 314
checks and surfaced four defects, two of them user-facing.

### Fixed — auditor attributed to the wrong firm

Detection scanned the first 60,000 characters, then the last 40,000, for bare firm names
and returned the first entry in the catalogue that matched anywhere. Two real failures:

- **NextEra** was attributed to **RSM**, because the filing writes "rate stabilization
  mechanism (RSM)" in its rate-agreement discussion at ~31k. The real auditor, Deloitte,
  sits past 260k — outside the window.
- **Home Depot** was attributed to **EY**, because the signed report (`/s/ KPMG LLP`) is
  at 189k, in the unscanned middle, while a **director's biography** mentioning Ernst &
  Young at 315k fell inside the tail.

Detection is now anchored to the audit report itself, in precision order: the `/s/`
signature, then the tenure sentence ("We have served as the Company's auditor since"),
then the report heading — each with a bounded window. Within a window the *earliest*
firm wins, rather than the first entry in the catalogue, so the answer no longer depends
on how the catalogue happens to be ordered. Documents with no anchor at all fall back to
a whole-document scan.

### Fixed — policy notes passed over for tables

Two independent scoring bugs in `locateTopicPassage`, both found on Apple's lease note:

- A single digit-ratio threshold vetoed genuine policy prose. Real notes embed maturity
  and rate tables, so `"Note 8 – Leases"` scored 0.127 and was rejected while the bare
  table header `"Leases Total"` scored 0.118 and was accepted — despite carrying no lease
  vocabulary at all. Vocabulary is now the positive evidence and the digit ratio only a
  veto for weak candidates: two or more distinct topic terms is prose no table produces.
- Heading specificity was a proxy for line length, so `"Note 8 – Leases"` (13 chars → 47)
  lost to `"Leases Total"` (12 chars → 48) **by one point, for carrying its note number**.
  A leading note or item designator is now stripped before scoring, so a numbered note
  compares on its subject.

### Fixed — revenue recognition retrieval, 13 issuers → 1

Reading the filings separated three different problems hiding behind one symptom.

**A heading names a subject; a table row carries data.** `looksLikeHeading` accepted any
line under 90 characters that did not end in punctuation, so financial-statement line
items qualified. American Tower matched an MD&A row `"Revenue $ — $ 911.2 (100) %"` over
its real revenue note, and Honeywell matched `"Deferred revenue (175) (244)"` out of a
deferred-tax table. Currency, percentages, parenthesised negatives and grouped figures now
disqualify a line — after stripping any note designator, so `"5. REVENUE RECOGNITION"`
still reads as a heading.

**A run-in heading ends with a period.** Filings write `"Revenue Recognition."` as a
heading, and rejecting every line ending in `.` sent Prologis to a density match in the
MD&A. Only *sentences* are excluded now, on word count.

**The vocabulary was ASC 606 jargon.** A plainly-worded retail note — "revenue is
recognized at the point of sale, net of returns" — matched none of the topic's terms, so
Walmart, Costco and Target failed confirmation on a correctly-located heading and fell
through to density somewhere in the MD&A. The topic now also carries how filings outside
software and industrials actually word the policy.

**The heading locates the note; the policy is not always at its top.** Deere, Honeywell
and Simon Property all open their revenue note with a disaggregation table, putting the
recognition policy 5,000–8,000 characters past the heading — outside the passage window.
A confirmed heading now scans the note for its densest passage, so the reader gets the
policy rather than a table of numbers.

The gate's own expectation was also too narrow, and that was corrected: a note saying
"recognizes revenue when control transfers" is the revenue policy whether or not it says
"performance obligation". The bare phrase "revenue recognition" is deliberately *not*
accepted, since any passage under a "Revenue Recognition" heading would satisfy it
without containing a policy.

### Fixed — financial statements incorporated by reference

Progressive's 10-K primary document contains no notes at all: `deferred tax`,
`right-of-use` and `performance obligation` are absent from the whole file, which instead
says "incorporated by reference" and "Exhibit 13". Its financial statements ship as the
glossy annual report exhibit — 3.4 MB of `pgr-20251231_d2.htm` against a 1.3 MB 10-K.

Reading only the primary document left those issuers with nothing to show, which reads as
"this company discloses nothing" rather than "we looked in the wrong file".

`fetchAnnualDisclosureText` now follows the exhibit when the 10-K body carries no notes,
detected by `containsFinancialStatementNotes` — a predicate deliberately built on
notes-only vocabulary (`deferred tax`, `significant accounting policies`,
`accumulated depreciation`, `basis of presentation`) rather than terms MD&A also uses.
The separation is clean: Progressive's 10-K scores 0 of those markers, its exhibit 2, and
every ordinary filing 3 or more. Falls back to the primary document whenever the exhibit
cannot be identified or read, so it can only add coverage.

### Fixed — revenue recognition is not only ASC 606

An insurer earns premiums under ASC 944 and a REIT recognises rents as lessor under
ASC 842, and their notes are titled and worded accordingly. The topic knew only ASC 606,
so an accountant benchmarking revenue policy across an insurance or property peer group
got MD&A prose instead of the policy that governs them — Progressive's "insurance
premiums written are earned into income on a pro rata basis" and Simon Property's "we
accrue fixed lease income on a straight-line basis" were both unreachable.

The topic now carries those headings and that vocabulary, and the gate accepts them as
what they are: revenue recognition policies. One caution learned here — a generic
`lease income` heading was tried and reverted, because it collided with the lease topic
and matched Target's `"Sublease income (c)"` table row as its revenue note.

### Open — Microsoft lease policy (1 check)

The bare heading `"Leases"` at offset 264,564 titles a maturity table whose column
captions ("Operating Leases", "Finance Leases") are enough to confirm it, and the only
other `right-of-use` text in the filing is the balance-sheet line item
`"Operating lease right-of-use assets 24,823"`. Scanning forward within the note does not
reach policy prose, so the passage returned is a schedule.

Deliberately not fixed by further threshold tuning — the remaining cases are ones where
the policy sits *before* its table under a caption the heading pass does not see, which
needs a different approach (note-boundary detection) rather than another cutoff.

### Why `filing-entity` is property-based

It asserts a property over the largest ~60 tickers rather than comparing against
hand-written CIKs, so it needs no maintenance and will catch the *next* holdco
reorganization without anyone updating a fixture. The `entity` suite's per-issuer CIK
assertions were removed for the same reason: they reported XOM as broken when the real
defect was that SEC had repointed the ticker — the fixture was wrong, not the ranking.

Sample size is `ACCURACY_ENTITY_SAMPLE` (default 60).

## CI

Deliberately **not** a blocking CI check: it depends on SEC availability, and a gate that
fails on someone else's downtime trains people to ignore it. Run it before a release and
after any change to retrieval, extraction or entity resolution.
