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
| `entity` | `company_tickers.json` + submissions | ticker/name → wrong or non-filing CIK |
| `xbrl` | `companyconcept` API | scale and sign errors in reported financials |
| `boolean` | live EDGAR corpus | union/intersection/phrase relationships; invalid syntax reaching EDGAR |
| `equivalence` | real 10-K text | the server pre-screen's safety claim, on real filings rather than synthetic strings |
| `disclosure` | real 10-K text | topic locator returning off-topic passages; wrong auditor of record |

The `equivalence` suite exists specifically because the pre-screen's correctness argument
("server and browser reach identical verdicts") was only ever demonstrated on synthetic
strings. It now runs every probe over real mega-cap 10-Ks.

## Run — 2026-07-25

| Suite | Score |
|---|---|
| entity | 14/16 — 87.5% |
| xbrl | 18/18 — 100% |
| boolean | 5/5 — 100% |
| equivalence | 8/8 — 100% |
| disclosure | 20/20 — 100% |
| **Total** | **65/67 — 97.0%** |

Skipped: JNJ revenue/equity (no annual facts under the queried tags).

### Open finding — ticker resolves to a non-filing successor entity

Both `entity` failures are one real bug, and it is not a stale fixture.

`company_tickers.json` maps **XOM → CIK 2115436 "ExxonMobil Holdings Corp"**, an entity
created 2026-07-01 whose only filings are 8-K, S-8 POS, POSASR and **8-K12B** — the
successor-registrant form for a holding-company reorganization. It has **no annual
report**. Exxon's entire filing history lives at **CIK 34088 "EXXON MOBIL CORP"** (10-K
filed 2026-02-18). Both CIKs claim the ticker; SEC's directory points at the shell.

Impact: anyone searching XOM is routed to a CIK with no annual filings, so benchmarking,
dossier, financials and issuer-scoped Boolean search all return nothing for a mega-cap
issuer. The holdco has no `formerNames` entry, so there is no link back.

Scale: 2 of the 40 largest registrants (XOM, and CYATY — a new ADR that may simply not
have filed an annual yet).

**Verified remedy:** EDGAR's own ticker lookup resolves this correctly.

```
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=XOM&output=atom
  → <cik>0000034088</cik> EXXON MOBIL CORP
```

So the fix is a fallback in the ticker → CIK resolution path: when the directory-mapped
CIK has no annual filings, re-resolve through `browse-edgar` and prefer the entity that
actually files. Not yet implemented.

## CI

Deliberately **not** a blocking CI check: it depends on SEC availability, and a gate that
fails on someone else's downtime trains people to ignore it. Run it before a release and
after any change to retrieval, extraction or entity resolution.
