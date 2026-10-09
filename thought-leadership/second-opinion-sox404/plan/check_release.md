# Page-cite check: SEC Release 33-11419 against the SEC PDF

Release checked: `sec_in/sec/33-11419.pdf` (318 pages, "Conformed to Federal Register Version", Release Nos. 33-11419; 34-105515; File No. S7-2026-18; "Dated: May 19, 2026", p. 307).

**How the page offset was set.** PDF page index = printed page number (offset 0). Page 1 (the cover) carries no number. Every other page carries its printed number as the last line. I checked this directly with `pdftotext -f N -l N` on PDF pages 42, 139, 149, 207 and 318: each prints the same number at its foot. `release.txt` page k (split on \f) is therefore printed page k. All pages below are printed pages.

The paper's own page numbers: v2 PDF page n = printed "Page n" (checked on all 22 pages of `paper_v2.txt`).

---

## 1. Every citation to the release in the paper

No release page cites in charts.py, html_ex.py or hero.py. All of them are in so_v2.py.

| # | so_v2.py line | v2 PDF page | What is cited | Cited page(s) | Verdict | Correct printed page(s) | Proof from the release |
|---|---|---|---|---|---|---|---|
| 1 | 52-53 | 2 | Release No. 33-11419, title, May 19, 2026 | none | CORRECT | p. 1 (header), p. 307 (date) | p. 1: "[Release Nos. 33-11419; 34-105515; File No. S7-2026-18] … Enhancement of Emerging Growth Company Accommodations and Simplification of Filer Status for Reporting Companies"; p. 307: "Dated: May 19, 2026." |
| 2 | 131-138 | 6 | Exhibit 2: EA Tables 5, 6 and 7 | pp. 139 to 142 | CORRECT | Table 5: pp. 139-140 (heading and 2021-22 rows on p. 139; 2023, 2024 and "All years 5.2% 15.7% 41.8%" on p. 140). Table 6: p. 141. Table 7: p. 142. | p. 139: "EA Table 5: Percentage of Registrants Reporting Management's Assessment of Ineffective ICFR, by Filer Status"; p. 141: "EA Table 6 …"; p. 142: "EA Table 7. Percentage of Registrants Issuing Big R Restatements …" |
| 2a | 133-134 | 6 | (same note) "of 757 accelerated filers, 125 are emerging growth companies" | uncited (only pp. 139-142 given) | Supported, but not by the pages cited | p. 132 (EA Table 2); also p. 152 n. 343 | p. 132: "Accelerated Filer: N = 757 (12.7%)", EGC column 77 + 48 = 125 |
| 3 | 227-228 | 9 (the note sits under the category table; the "Today/Proposed" table is on p. 8) | §2 tables | pp. 9-13, 20-21, 28-33, 37-48, 56, 66-69, 83, 96, 103 | PARTLY WRONG (incomplete). Every page cited is relevant, but five rows rest on pages not cited. | Add pp. 55 and 61 (404(a) unchanged); 81-82 and 84 (confidential DRS and CAM exemption stay EGC-only); 87-88 (Form 20-F $75 million, single day); 104 and 106 (SNF exit rule and the 1,072 count). See section 2, S-12. | p. 61: "NAFs would remain subject to the Commission's rules under section 404(a)"; p. 82: "only statutory EGCs will remain eligible for this accommodation"; p. 84 n. 231: CAMs "does not apply to the audits of EGCs … We are not proposing to extend these EGC accommodations"; p. 88: Form 20-F attestation at "$75 million or more as of the last business day of the issuer's most recently completed second fiscal quarter"; p. 106: "1,072 registrants qualifying for the SNF subcategory" |
| 4 | 341 | 13 | Exhibit 5 (SEC cost figures, GAO) | pp. 153-155 and 214-218 | CORRECT. The 214-218 range is wider than needed. | pp. 153-155 ($73,165, $759,000, ~$800,000, GAO $219,000, audit fees not broken out); pp. 215 and 218 ($202,500 and 375 hours). pp. 214, 216 and 217 do not carry these figures. | p. 215 PRA Table 1: "Decrease in burden hours per response of 375 hours … Decrease in $202,500 costs per response"; p. 218: "resulting in updated professional costs of $202,500" |
| 5 | 386-391 | 15 | Exhibit 6: CPI and S&P 500 lines; EA Table 13 | p. 42; EA Table 13 p. 207 | CORRECT | p. 42 n. 137; p. 207 | p. 42 n. 137: "A proportionate increase to the $700 million threshold would result in a $3.85 billion threshold. Alternatively, adjusting for inflation would result in a $1.15 billion threshold." p. 207: "EA Table 13. Alternative public float thresholds … $700 million 1,665 95.2%" |
| 6 | 545-552 | 5 | Exhibit 1 | pp. 12, 20-34, 40-42, 150 | PARTLY WRONG (incomplete). p. 150 is relevant here, not executive compensation. | Add p. 207. The "1,234 (20.6% of registrants)" figure appears only on p. 207. | p. 207: "from approximately 1,146 (19.2 percent of all registrants) to 1,234 (20.6 percent of all registrants)" |
| 7 | 599-602 | 18 | Exhibit 8 | pp. 43-48, 87-89, 114-116, 149, 152, 205 | CORRECT | as cited | p. 43 (two-year test), p. 47 (60 months), pp. 87-88 (FPIs), pp. 114-116 (transition), p. 149 (4,825; 1,146), p. 152 (1,596), p. 205 n. 456 (1,144; 498) |
| 8 | 644-645 | 20 | §7.2 auditor table | pp. 61, 62, 139 | CORRECT (no conflict with row 2) | p. 61 (understanding of ICFR; tests of controls); p. 62 (SDs/MWs in writing to management and the audit committee); p. 139 n. 315 (unreported MW must be stated in the auditor's report) | p. 139 n. 315: "PCAOB Auditing Standard 2201.91 requires an auditor to make certain disclosures in the auditor's report and notify the audit committee in writing if the auditor has identified a material weakness that has not been included in management's ICFR assessment." |
| 9 | 736 | 4 | "Uniqus analysis of SEC Release 33-11419" | none | n/a | — | — |
| 10 | 742-747 | 10 | Calendar: May 19 proposal; May 5 semiannual; comment close July 20 | none | CORRECT | p. 1, p. 9 n. 13, p. 17 | p. 1: "Comments should be received on or before July 20, 2026"; p. 9 n. 13: "Semiannual Reporting, Release No. 33-11414 (May 5, 2026)"; p. 17: "Registered Offering Reform, Release No. 33-11418 (May 19, 2026)" |

Out of scope: the page cites at lines 342-343, 355, 369, 373, 428, 448, 450, 461, 493 and 497 are to comment letters, not the release. I did not check them here.

---

## 2. Register items S-08 to S-14

| Item | Cite in paper | Verdict | Finding in this PDF |
|---|---|---|---|
| S-08 | p. 42 for $1.15 bn (CPI) and $3.85 bn (S&P 500) | **CORRECT** | Both figures are in n. 137, which sits on p. 42 here; the FR copy's "p. 34" does not apply. Quote above. $3.85 bn also appears in Request for Comment 3, p. 50. |
| S-09 | EA Tables 5-7, pp. 139-142 | **CORRECT** | Table 5 pp. 139-140, Table 6 p. 141, Table 7 p. 142. Do not apply the FR-copy "118-122". |
| S-10 | EA Table 13, p. 207 | **CORRECT** | Heading and all six rows on p. 207 ($700 million 1,665 / 95.2%; $1.0 billion 1,480 / 94.8%; $1.5 billion 1,285 / 94.1%; $2.0 billion 1,146 / 93.5%; $2.5 billion 1,030 / 92.7%; $3.0 billion 944 / 92.1%). It is introduced on p. 206 ("EA Table 13 below provides the number of LAFs and share of public float…"). Do not apply the FR-copy "p. 177". |
| S-11 | Exh. 1: pp. 12, 20-34, 40-42, 150 | **PARTLY WRONG**: p. 207 is missing | p. 12 = Table 2 (LAF 35.4% of registrants, 98.82% of float). pp. 20-34 = history: AF at $75 million in 2002 and LAF at $700 million in 2005 (p. 20); 404(a)/(b), Dodd-Frank and JOBS (pp. 22, 24); 2007 AS 5 and SEC guidance (p. 25); the 2020 low-revenue amendments (pp. 25, 33-34); EGC (p. 30). pp. 40-42 = 19.2% vs 35.4% (p. 40), 18% / "nearly 95 percent" and 98.8% / 35.4% (p. 42). **p. 150 is relevant:** "93.5 percent of the total market public float … 2,115 registrants … approximately 98.8 percent", and the 60-month seasoning in the estimate (n. 340). Register A1-17's "p. 150 = executive compensation" was a FR-copy artefact. Missing: p. 207 for "1,234 (20.6% of registrants)". |
| S-12 | §2 tables: pp. 9-13, 20-21, 28-33, 37-48, 56, 66-69, 83, 96, 103 | **PARTLY WRONG** (incomplete; no irrelevant page) | Covered: deadlines and today's statuses (pp. 9-11); exit at $560M/$60M/revenue test (p. 13; also p. 44 n. 139); today's LAF definition and 12 months (p. 21); SRC scaling (p. 28); SRC $250M / $100M with float under $700M (p. 33); EGC $1.235bn (pp. 10, 30), its accommodations (p. 32); proposal summary, unresolved staff comments, AF/SRC eliminated, n. 124 on EGC reliance (pp. 37-38); $2bn, two-year test, 10-day average, 60 months (pp. 39-48); NAF = "an issuer that is not a large accelerated filer" (p. 56); NAF scaling and unresolved staff comments (pp. 66-69); five-year deferral of new accounting standards (p. 83); say-on-pay exemption (p. 96, Table 6); SNF test and 120/50 days (p. 103). **Not covered:** 404(a) unchanged (pp. 55, 61); confidential DRS and CAM exemption EGC-only (pp. 82, 84 n. 231); Form 20-F $75 million single-day (pp. 87-88); 1,072 SNFs (p. 106). |
| S-13 | Exh. 5: pp. 153-155, 214-218. Exh. 8: pp. 43-48, 87-89, 114-116, 149, 152, 205 | **CORRECT** (both) | Exh. 5: every figure is on pp. 153-155, 215 or 218. pp. 214, 216 and 217 are PRA set-up and SRC-scaling method, so the range is broad but not wrong. Optional tightening: "pp. 153 to 155, 215 and 218". Exh. 8: every page carries cited material. p. 89 only finishes the FPI discussion (2025 FPI concept release), which is harmless. |
| S-14 | §7.2: pp. 61, 62, 139 | **CORRECT**; the "conflict" is not one | p. 139 holds both the start of EA Table 5 and n. 315, the AS 2201.91 statement behind the "auditor must say so in its report" row. Both cites to p. 139 are right. |

---

## 3. Figures re-verified (printed pages)

| Figure in paper | Printed page | Quote |
|---|---|---|
| 1,596 newly exempt (26.7%) | 152 | "We estimate the proposed amendments would result in 1,596 registrants (26.7 percent of all registrants) being newly exempt from the ICFR auditor attestation requirement … representing approximately 60 percent of all registrants that are currently subject to the ICFR auditor attestation requirement." (also p. 60: "expand by 26.7 percent") |
| 964 LAFs + 632 AFs | 152 | "Of these 1,596 registrants, 964 are currently reporting as LAFs and 632 are currently reporting as AFs." |
| 2,115 → 1,146 LAFs | 149-150 | p. 149: "1,146 registrants (19.2 percent of all registrants) continuing to be LAFs"; p. 150: "the 2,115 registrants under the baseline in 2024 that meet the current definition for LAF status" |
| 35.4% → 19.2% | 40 (also 12, 35, 42, 149) | p. 40: "We estimate these proposed conditions would result in 19.2 percent of existing Exchange Act reporting companies being LAFs, as compared to 35.4 percent today." |
| 93.5% and 98.8% of float | 150 (also 40, 42) | p. 150: "approximately 93.5 percent of the total market public float … 2,115 registrants … accounted for approximately 98.8 percent of the total market public float." |
| 4,825 NAFs (80.7%) | 149 | "for an estimated total of 4,825 NAFs (80.7 percent of all registrants) under the proposal" |
| 5,971 registrants | 132 | "EA Table 2: Registrants' Filer Status, N = 5,971". Note: p. 131 (and p. 13) gives 5,976 filers; n. 303 excludes five with missing status. |
| 125 EGC accelerated filers | 132; 152 n. 343 | EA Table 2 AF EGC column 77 + 48 = 125; n. 343: "there are 125 registrants that currently report as AFs but are already not subject to the ICFR auditor attestation requirement because they are also EGCs" |
| 757 accelerated filers | 132; 149 | p. 132: "Accelerated Filer: N = 757 (12.7%)"; p. 149: "964 registrants are currently reporting as LAFs and 757 registrants are currently reporting as AFs" |
| 1,072 SNFs | 106 (also 185, 191) | "setting the SNF asset threshold at $35 million or less would result in 1,072 registrants qualifying for the SNF subcategory, representing 22.2 percent of NAFs and 17.9 percent of all registrants" |
| 1,144 Form 20-F/40-F filers; 498 EGCs | 205 n. 456 | "we estimate that there were 1,144 filers on Form 20-F or 40-F (including 998 filers on Form 20-F and 146 filers on Form 40-F) … Among all Form 20-F and 40-F filers, we estimate that there were 498 EGC filers." (The release's own 20-F breakdown, 293 + 193 + 530 + 1 = 1,017, does not sum to 998. That error is the release's, not the paper's.) |
| EA Table 13 rows (1,665 / 95.2% at $700M, etc.) | 207 | All rows quoted in S-10 above. |
| 1,234 (20.6%) with 12-month seasoning | 207 | "from approximately 1,146 (19.2 percent of all registrants) to 1,234 (20.6 percent of all registrants)". The release also says 20.7% at p. 48 n. 143 ("would increase from 19.2 % to 20.7 %"). The paper follows p. 207. |
| $202,500 and 375 hours | 215, 218 | p. 218: "an average per response burden reduction for Form 10-K of 375 hours and $135,000 in costs … adjusted the cost burden estimate to account for inflation, resulting in updated professional costs of $202,500." |
| $73,165 | 154 n. 351 | "finding an average annual increase in audit fees for the non-exempt of $73,165" (market capitalization "less than $300 million") |
| ~$800,000 | 155 (n. 352, continued) | "a similar cost of 404(b) compliance … of approximately $800,000 using survey data from a sample of between four and seven (depending on cost component) biotech firms" |
| $759,000 | 154 n. 352 | "total costs of section 404(b) compliance (including audit, outside vendors, and internal labor) amount to $759,000 in the first year" |
| GAO median $219,000 | 154 | "with a median increase of around $219,000". The "13%" in Exhibit 5 is not in the release; it must come from GAO-25-107500 itself. |
| less than 6% voluntary attestation | 156 | "In 2024, we estimate less than six percent of exempt registrants voluntarily complied." (p. 155: "Up to about seven percent … from 2005 through 2011") |
| 87 of 153 banking LAFs | 189 | EA Table 8: "Banking 153 87 57%" |
| ~88% of 2024 IPOs by EGCs | 83 n. 229 | "approximately 88% of IPOs during calendar year 2024 (excluding funds and direct listings) were by EGCs" |
| 18% / "nearly 95%" (2005) | 42 (n. 136 on base) | "'companies with a public float of over $700 million represent approximately 18 percent of the total number of companies on these markets and nearly 95 percent of the total public float on these markets.'" n. 136: NYSE, Amex, NASDAQ, OTCBB, Pink Sheets. (p. 41 also has "nearly 95 percent of the U.S. equity market capitalization", a different base. The paper correctly uses the float version.) |
| "nearly 95 percent" target; $2bn → 93.5% | 42 | "we therefore propose to reestablish a public float requirement that would capture nearly 95 percent of total market public float and estimate that setting the threshold at $2 billion would capture approximately 93.5 percent" |
| "only slightly higher"; EGC 14.7% / 31.4% | 142 | "the percentage of registrants reporting Big R restatements is only slightly higher than that for AFs" |

---

## 4. Indeterminate-status footnotes and the 1,721 / 125 reconciliation

These are footnotes 335 and 338 here too, both on **p. 149**; n. 338 runs onto p. 150. The reconciliation is **n. 343, p. 152**.

| Footnote | Printed page | Quote |
|---|---|---|
| n. 335 | 149 | "… The 3,099 current plus 1,721 newly eligible plus four unknown today plus one with missing EGC status sum to the total of 4,825 NAFs. This total of 4,825 NAFs includes 91 that would be NAFs co-filing with an LAF under the proposed amendments and excludes five registrants that are LAFs under the baseline with indeterminate filer status under the proposed amendments." |
| n. 338 | 149-150 | p. 149: "… These estimates do not include five registrants with indeterminate status under the baseline, but these five do not report public float sufficient to meet the threshold to qualify as LAF under the proposed amendments …" p. 150 (continued): "First, we are unable to determine LAF status of five registrants under the proposed amendments because data on public float is missing from their annual filings." |
| n. 343 | 152 | "This number (1,596) is smaller than the number of LAF and AF registrants newly eligible as NAFs (1,721) because, per EA Table 2, there are 125 registrants that currently report as AFs but are already not subject to the ICFR auditor attestation requirement because they are also EGCs." It also covers co-filers and banks: "this total includes banks which, even if they are NAFs, are required under the FDIC rules to have their auditor attest …" |
| Body text | 149 | "1,721 additional registrants … Of these 1,721 additional registrants, 964 registrants are currently reporting as LAFs and 757 registrants are currently reporting as AFs." |

Arithmetic check: 2,115 = 1,146 + 964 + 5 (the five in n. 335 / n. 338 p. 150). 757 − 125 = 632. 964 + 632 = 1,596.

The five in n. 338 on p. 149 ("indeterminate status under the baseline") are a different group: the five excluded from EA Table 2 for missing status, per n. 303 on p. 132. The paper's line "The other five of today's large accelerated filers lack the float data to classify" (so_v2.py line 243, v2 p. 10) matches n. 335 and n. 338 as continued on p. 150.

---

## 5. Exit rules and new-registrant testing

| Question | Answer | Printed page | Quote |
|---|---|---|---|
| Does the release state an SNF ($35M) exit rule? | **Yes.** An SNF leaves on becoming an LAF, or after total assets exceed $35M at each of two consecutive second-quarter ends. | 104 (example pp. 110-111) | p. 104: "Once a registrant becomes an SNF, it would remain in SNF status until it becomes an LAF or reports more than $35 million in total assets as of the end of each of its two most recent second fiscal quarters." p. 111: "if its total assets as of June 30, 2027 were $36 million, but its total assets as of June 30, 2028 were $34 million, it would remain an SNF" |
| Do "two consecutive years" apply on the way down for LAFs? | **Yes**, for ongoing status. At the one-time transition assessment it does not: an existing LAF below $2bn in either year becomes an NAF. | 43, 44, 45, 46-47, 54, 150 n. 338; transition 115 | p. 45: "eliminate the separate, lower threshold for exiting LAF status in favor of a definition with a single public float criterion and a two-year lookback determination (i.e., public float of $2 billion or more for two consecutive fiscal years)". p. 44: "meeting or not meeting the conditions of LAF status for a single year would not suffice to change filer status from NAF to LAF or vice versa." p. 54: "After an NAF qualifies as an LAF and thereby loses its NAF status, it could regain its NAF status if its public float is less than $2 billion for two consecutive years." p. 150 n. 338: "an LAF registrant will continue to be an LAF even with one, but not two, years of public float below the threshold". Transition, p. 115: an existing LAF becomes an NAF if it "(1) has not been subject to the reporting requirements … for the preceding sixty consecutive calendar months, or (2) did not have a public float of $2 billion or more for such fiscal year and the immediately prior fiscal year." |
| How is a new registrant tested? LAF/NAF | It is an NAF from registration for at least 60 months. After that it is tested on the two most recent second-quarter float figures (10-day average), as of fiscal year-end. | 54; 47 n. 140; 80 n. 217 | p. 54: "every registrant would be an NAF beginning at the time of its initial public offering or registration and for at least five years following, as a result of the proposed 60 consecutive calendar months on-ramp". p. 47 n. 140: "a registrant that became subject to the Exchange Act's reporting requirements on July 19, 2025 would satisfy the seasoning requirement for purposes of assessing whether it is an LAF on Aug. 1, 2030." |
| How is a new registrant tested? SNF | On total assets in the two most recent fiscal-year balance sheets in its initial registration statement | 103-104; RFC 32 on p. 112 | pp. 103-104: "a new registrant reporting total assets at or below the threshold would be an SNF upon registration if, in its initial registration statement, it reported total assets of $35 million or less in its financial statements in each of its two most recent fiscal year balance sheets." |

The paper's §2 SNF cell (so_v2.py lines 223-225) gives the entry test only. It leaves out the exit rule (p. 104) and the new-registrant test (pp. 103-104). This is a content gap, not a wrong cite. Register A1-39 made the same point.

---

## Other observations (not page cites; for the editor)

- Exhibit 2 note (line 137): "the SEC staff's statement on SPAC warrants **drove** restatements". The release says the 2021 EGC spike "coincided with" the staff statement (p. 142 n. 319). "Coincided with" is safer.
- Exhibit 2 note (lines 132-133): "EA Tables 5 and 6 include emerging growth companies in each column". The release does not say this outright. n. 312 (p. 139) and n. 316 (p. 140) compute over "all registrants of a given filer type". Only n. 318 (p. 141, Table 7) says the AF and NAF columns exclude EGCs. The reading is a fair inference, but it is an inference.
- §1.2 (line 159): "The release says respondents to a 2008 and 2009 survey of 2,901 corporate insiders…". The figure 2,901 is not in the release. p. 159 says only "One study surveyed corporate insiders on section 404 compliance in 2008-2009", citing the 2013 J. Acct. Econ. study in n. 367. The quote "especially as they gained experience with section 404(b)" is on p. 159. Other §1.2 quotes: "has generally resulted in the disclosure…" p. 157; "positive impact on the informativeness…" p. 158; "may play a role in improving overall investor confidence" p. 160; "may have fewer [benefits]" p. 160. §6: "magnitude and direction of the effect is difficult to predict" p. 205; "competitive disadvantages" p. 205.
- Exhibit 6 note (lines 388-389): "EA Table 13 applies the proposal's 60-month seasoning and two-year test at each float line". The release does not state this for the table. It is consistent: the $2.0bn row (1,146) equals the estimate that p. 149 n. 338 and p. 150 n. 340 say applies both conditions, and p. 207 gives 1,234 without the seasoning change.

---

## Edits to make (so_v2.py)

### Required (wrong or incomplete cites)

1. **Exhibit 1 source, line 545.** Add p. 207, the only page with 1,234 (20.6%).
   - Find: `"Source: SEC Release 33-11419 (May 19, 2026), pp. 12, 20 to 34, 40 to 42 and 150; SEC "`
   - Replace: `"Source: SEC Release 33-11419 (May 19, 2026), pp. 12, 20 to 34, 40 to 42, 150 and 207; SEC "`

2. **§2 table source, lines 227-228.** Add the pages behind the 404(a), EGC-only, Form 20-F and SNF cells.
   - Find (line 227): `H.note("Source: SEC Release 33-11419, pp. 9 to 13, 20 to 21, 28 to 33, 37 to 48, 56, 66 to 69, 83, 96 "`
   - Replace: `H.note("Source: SEC Release 33-11419, pp. 9 to 13, 20 to 21, 28 to 33, 37 to 48, 55 to 56, 61, 66 to 69, 81 to 84, 87 to 88, 96 "`
   - Find (line 228): `"and 103. Smaller reporting and emerging growth status sit on top of the other categories today. "`
   - Replace: `"and 103 to 106. Smaller reporting and emerging growth status sit on top of the other categories today. "`
   - (p. 105 holds the SNF late-filing rationale, so "103 to 106" is contiguous and every page is relevant. For the minimum, use "103, 104 and 106".)

### Optional (cite correct, but could be tighter or fuller)

3. **Exhibit 2 source, line 131.** The 757 / 125 figures come from EA Table 2.
   - Find: `"Source: SEC Release 33-11419, EA Tables 5, 6 and 7 (pp. 139 to 142), SEC staff analysis of "`
   - Replace: `"Source: SEC Release 33-11419, EA Tables 5, 6 and 7 (pp. 139 to 142) and EA Table 2 (p. 132), SEC staff analysis of "`

4. **Exhibit 5 source, line 341.** pp. 214, 216 and 217 carry none of the figures.
   - Find: `"Source: SEC Release 33-11419, pp. 153 to 155 and 214 to 218, including GAO-25-107500; comment "`
   - Replace: `"Source: SEC Release 33-11419, pp. 153 to 155, 215 and 218, including GAO-25-107500; comment "`

5. **Exhibit 2 note, line 137** (wording, per the release's n. 319):
   - Find: `"14.7% (31.4% in fiscal 2021, when the SEC staff's statement on SPAC warrants drove "`
   - Replace: `"14.7% (31.4% in fiscal 2021, which coincided with the SEC staff's statement on SPAC warrants and the resulting "`
   - Line 138 already begins `"restatements). Differences…"`, so the sentence then reads "…coincided with the SEC staff's statement on SPAC warrants and the resulting restatements)."

No change needed: S-08 (p. 42), S-09 (pp. 139-142), S-10 (p. 207), Exhibit 8 source (line 599), §7.2 source (line 644; p. 139 is right there). Do **not** apply the FR-copy page numbers from registers A1/A2 (pp. 118-122, p. 177, p. 34 n. 137). None of them match the SEC PDF.
