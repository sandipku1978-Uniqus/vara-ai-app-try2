# Back-test harness — how we prove the output is right

Version 0.1.0 · Filing AI

---

## The core idea

**EDGAR hosts labelled ground truth for free.** If a filing was later amended, we know something was wrong with the original — and the amendment tells us *what*. So:

> Run the engine on the **original** filing and measure whether it flags what the **amendment** actually fixed.

That yields a real recall number computed on real filings, not a demo. This is the single strongest asset in the product thesis, and it is something Memo AI structurally cannot do — a memo's correctness can only be judged by an expert, whereas a filing defect has a documented correction.

---

## Corpus construction

### Step 1 — Pair originals with amendments

For each amendment (`10-K/A`, `10-Q/A`) in the target window:
- Resolve the original filing it amends (same CIK, same period, prior accession)
- Store the pair `(original_accession, amendment_accession)`

Target: **FY2021–2025**, all filers. Expect a few thousand pairs.

> **Data source warning.** Use the SEC DERA dataset *Number of EDGAR Filings by Form Type* and the EDGAR quarterly `form.idx` files for counts and enumeration. **Do not use EDGAR full-text search for counts** — it returns *document* counts (each exhibit indexed separately), not filing counts, and materially understates amendment rates. This error was made and caught during research; do not repeat it.

### Step 2 — Extract the delta

Diff original vs amendment:
- Document text diff (section-level)
- Exhibit set diff (added / removed / replaced)
- XBRL fact-level diff
- Explanatory note extraction (the amendment usually states its purpose)

### Step 3 — Classify each pair

| Class | Meaning | Use in scoring |
|---|---|---|
| **A — Planned** | Part III incorporation, XBRL-only refile, Rule 3-09 financials | **Excluded from recall.** Not defects. |
| **B — Mechanical/submission** | Missing exhibit, defective certification, period mismatch, signature | Primary recall target |
| **C — Presentation/disclosure** | Omitted conclusion, non-GAAP arithmetic, narrative/table conflict | Recall target |
| **D — Accounting error** | Restatement / revision | Measured separately; expected recall is low at Tier 0–1 and that is correct |
| **E — Unclear** | Cannot determine | Excluded, reported as a count |

Classification is LLM-assisted on the explanatory note, **with a hand-labelled sample of ~600 by Uniqus technical accounting** to train and validate the classifier. Report classifier agreement.

### Step 4 — Negative controls

Sample **~1,000 filings that were never amended** (no `/A` within 24 months), stratified by filer size and industry to match the positive set. Every finding raised here is a **candidate false positive**.

Without this set, precision cannot be measured and the engine will drift toward flagging everything.

---

## Metrics

Computed **per rule** and **per layer**:

```
recall_layer    = defects_in_class_flagged / defects_in_class_total
precision_rule  = true_positives / (true_positives + false_positives)
fp_per_filing   = total_findings_on_negative_controls / count(negative_controls)
```

### Release thresholds (P0)

| Layer | Recall | Precision |
|---|---|---|
| Mechanical | ≥ 90% | ≥ 95% |
| XBRL | ≥ 85% | ≥ 93% |
| Consistency | ≥ 80% | ≥ 90% |
| Disclosure | ≥ 70% | ≥ 85% |
| Continuity (P1) | ≥ 75% | ≥ 85% |
| Judgment (P2) | n/a | n/a — reviewer acceptance rate only |

**False-positive budget: ≤3 findings per filing across the negative control set.** A rule that breaches its budget is automatically demoted to advisory (non-blocking) until fixed — the user is never "retrained" to tolerate noise.

---

## Class D honesty

Recall on accounting errors will be **low at Tier 0 and Tier 1, and that is the correct result** — the filing alone does not contain the information needed to detect them. Report it explicitly rather than hiding it. It is the evidence base for the Tier 2 upsell and it keeps the coverage statement truthful.

---

## Operating cadence (G4)

- **Quarterly**: rebuild the corpus with newly amended filings; re-run the full back-test. The corpus grows automatically as companies amend — the product's validation improves over time without manual effort.
- **On every rule change**: back-test the changed rule before it may reach `Approved`.
- **On every escaped defect**: if a client amends a filing that we passed clean, run a root-cause review and either add a rule or record why it was undetectable at that tier.

---

## Implementation notes

- Store corpus as immutable snapshots with a `corpus_version`; back-test results reference the version so results stay comparable.
- Cache parsed CFMs for corpus filings — re-parsing thousands of filings per run is the main cost.
- Run back-tests in CI on a sampled subset (fast) and nightly on the full corpus (slow).
- Persist per-rule results to the catalog so `rule.backtest.{recall, precision, corpus_version, last_run}` is always current.
