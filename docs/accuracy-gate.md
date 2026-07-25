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
| disclosure | 141/159 — 88.7% |
| **Total** | **296/314 — 94.3%** |

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

### Open — revenue recognition retrieval, 13 issuers

The largest remaining cluster, and the broader form of a defect reported from the product.
The locator returns *a* passage for revenue recognition but not the ASC 606 policy prose,
across every sector tested: PGR, MET, PLD, AMT, SPG, JNJ, NEE, WMT, COST, TGT, DE, HON.

Part of this is genuine: insurers recognise premiums under ASC 944 and REITs recognise
rental income under ASC 842, so "performance obligation" may legitimately be absent from
their revenue notes, and the expectation may be wrong rather than the locator. Retail and
industrial filers are ASC 606 and should carry it. Needs its own pass — separating a
wrong expectation from a wrong passage requires reading the filings.

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
