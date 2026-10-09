# Pending edits to v2 (held for one batch)

Agreed with Sandip; not yet applied to `build/so_v2.py`. Page numbers are v2 PDF pages (22 pages).

| # | Where | Change | Why |
|---|---|---|---|
| P-01 | p. 9, filer-categories table, "Small non-accelerated filer" row | "New: total assets of $35 million or less on the last day of the second fiscal quarter, in each of the last two years; 10-K in 120 days, 10-Q in 50. The SEC estimates 1,072 companies." | "At each of the last two second-quarter ends" is hard to read. For a new registrant, the test uses the two fiscal year-end balance sheets in its registration statement (Release 33-11419; register A1-39). |
| P-02 | p. 8, §2.1, a short worked example directly after the table (agreed October 9) | See the draft text below the table. | The table states the two-year rule ("Two consecutive years above or below the line; no separate exit level") but not its effect. On the way up, the attestation starts a year later than under a single-date test. On the way down, exit also takes two years below $2 billion, with no lower exit level ($560 million today). Keep §2.1 from spilling a page; re-run `qa_pages.py` and `verify_nav.py`. |
| P-03 | p. 19, decision 4 | Optional cross-reference to P-02: the "back in scope" sentence already says "for two consecutive years". | Consistency with P-02. |
| P-04 | p. 8, §2 paragraph on 1,596 | Optional: "The SEC could not classify the other five of today's 2,115 large accelerated filers because their float data is missing." Cite Release 33-11419, n. 335 and n. 338 in the section source. | The release does not name the five companies. It treats them only as a reconciling item: 2,115 = 1,146 + 964 + 5. |
| P-05 | p. 19, §7, the eight decisions (agreed October 9) | Merge the two boxes ("Eight decisions for the SOX program leader" and "…, continued") into one box with one header, and number the decisions 1 to 8 instead of bullets. | Both boxes already sit on page 19, so one box saves a header and its padding. The page 18 intro promises "eight decisions, in order", so the numbers carry real sequence. Implementation: in `so_v2.py` replace the two `H.rec(DECISIONS[:4]…)` / `H.rec(DECISIONS[4:]…)` calls with one numbered box. Add an ordered-list variant of `H.rec` in `engine.py` (`<ol>`, numerals in the house magenta) rather than changing `H.rec` itself, which other papers use. Check that page 19 still holds the box plus the start of 7.1, and that later cross-references ("decision 3", "decision 4") still match. |

**P-02 draft text (§2.1, after the table):**

> **An example.** Under the proposal, status changes only after two years on the same side of the line. A calendar-year company with 60 months of reporting whose float first reaches $2 billion on June 30, 2027, at $2.3 billion, is not a large accelerated filer for fiscal 2027; if its float is still $2 billion or more on June 30, 2028, it becomes one for fiscal 2028. The same works in reverse: a large accelerated filer at $1.8 billion on June 30, 2027 and $1.7 billion on June 30, 2028 becomes non-accelerated for fiscal 2028, with no lower exit level like today's $560 million.

Notes on the draft: 2027 and 2028 are used so the example does not depend on the transition rules or the effective date. Float is the proposed 10-trading-day average. Three sentences, per house style. Optionally render it as a two-row table (year, float, status) if that fits the page better.

Not confirmed: the release text checked so far gives no separate exit rule for the $35 million tier. Read it as "both of the last two years at or below $35 million", so one year above ends the status. Confirm against the SEC PDF before saying so in the paper.
