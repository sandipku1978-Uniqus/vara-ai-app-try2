# Pending edits to v2 (held for one batch)

Agreed with Sandip; not yet applied to `build/so_v2.py`. Page numbers are v2 PDF pages (22 pages).

| # | Where | Change | Why |
|---|---|---|---|
| P-01 | p. 9, filer-categories table, "Small non-accelerated filer" row | "New: total assets of $35 million or less on the last day of the second fiscal quarter, in each of the last two years; 10-K in 120 days, 10-Q in 50. The SEC estimates 1,072 companies." | "At each of the last two second-quarter ends" is hard to read. For a new registrant, the test uses the two fiscal year-end balance sheets in its registration statement (Release 33-11419; register A1-39). |
| P-02 | p. 8, §2.1 table, "Moving in or out" row (proposed column); or the Exhibit 8 footer | Add: "Because status changes only after two years on the same side of the line, a company that first crosses $2 billion is not a large accelerated filer until the second year." | The table states the two-year rule but not its effect: on the way up, the attestation starts a year later than under today's single-date test. On the way down, exit also takes two years below $2 billion, with no lower exit level ($560 million today). Keep page 8 within its page after the edit; re-run `qa_pages.py`. |
| P-03 | p. 19, decision 4 | Optional cross-reference to P-02: the "back in scope" sentence already says "for two consecutive years". | Consistency with P-02. |

Not confirmed: the release text checked so far gives no separate exit rule for the $35 million tier. Read it as "both of the last two years at or below $35 million", so one year above ends the status. Confirm against the SEC PDF before saying so in the paper.
