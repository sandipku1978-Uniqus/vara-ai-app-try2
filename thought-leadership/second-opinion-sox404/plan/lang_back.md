# Language pass, back half: Sections 4 to 7, How Uniqus Can Help, About

Scope: so_v2.py lines 330-515, plus EX8 (580-600), DECISIONS (605-625), AUDITOR_TABLE (628-645), CROSS (648-667), HELP (670-691), ABOUT (694-711) and the NAV entries for sections 4 and 7 (line 20-23). v2 pages 13-22.
Nothing here changes a fact, figure, quotation, citation or source line. Where a source line contains prose that breaks the guide, it is noted under "Left alone" rather than proposed.

## Patterns found (counts are passages proposed for change, by tag; most passages carry more than one tag)

| Pattern | Count | Typical example |
|---|---|---|
| shorthand: "the file" | 9 (h1, NAV, 4.2, sec 5 deck, table header, sec 5 close, sec 6, 6.1, HELP) + 1 in disclaimer | "The file does not supply the missing evidence." |
| shorthand: "the release" | 11 (4.1 x2, 4.2, sec 6 x3, 6.1, EX8 footer, DECISIONS #2 and #4, CROSS none) | "Its own input is..." / "the release offers none" |
| shorthand: "the line" / "a line" | 8 (Exhibit 6 title, table row, sec 5 close, 6.1 x2, EX8 footer x2, DECISIONS #2) | "less risk of being moved across a line by its share price" |
| shorthand: "the opinion" / "keep, drop" verbs | 12 (objective box, 7.1 table x4, para after AUDITOR_TABLE, DECISIONS #3/#5, CROSS x2, HELP x2) | "Dropping the opinion does not take the auditor out..." |
| AI-tell: punchy fragment / stacked short sentences | 11 | "Both can be true. The first... The second..."; "Capital itself is not short."; "Nothing changes. The attestation continues." |
| AI-tell: colon-then-reveal | 8 | "points elsewhere: abundant private capital..."; "The backdrop is real."; "Neither set of numbers answers the controller's question: ..." |
| AI-tell: "not X, but/not Y" contrast | 5 | "shows where the arguments are, not how the vote will go"; "not a saving to be booked"; "not to the US floor" |
| AI-tell: rhetorical question | 2 | Sec 6 deck "Will this bring the mid-market back?"; HELP card titles "In or out?" |
| AI-tell: quip table cells | 3 | "The saving, in whole"; "Simplicity: the substitute has to..."; "In or out?" |
| register: bare imperatives (section 7) | 8 of 8 decision leads, plus "Start by locating the company." and 3 trailing imperatives ("Ask...", "watch the effective date", "Have the answer ready") | "Price the saving from a fee proposal, not from the release." |
| register: glib or casual verbs/nouns | 10 | "drop it", "price the saving", "audit bill", "overlays", "cut the other way", "concedes", "marquee" |
| hedge: unattributed authorial claims | 5 | "the proposal works against its own purpose"; "Only a fee proposal for a specific company answers that." |
| heading (incl. exhibit titles, box headers) | 14 | "4. Two Questions the File Leaves Open"; "7.1 Keep, drop or replace" |
| house rule: >3 sentences in a paragraph/list item (if the bold lead counts as a sentence) | 3 | DECISIONS #3, DECISIONS #7, CROSS "India" |
| spelling (British) | 0 | None found in scope. |
| flow / punctuation | 4 | double full stop after the Linklaters quotation; Oxford comma and "The Company"/"The company" in ABOUT |

Total proposals: 78 (L-B01 to L-B78).

Top patterns, in order of how much they shape the read: (1) "the file" / "the release" / "the line" shorthand runs through every section; (2) every section 7 decision opens with a curt imperative; (3) closing lines of paragraphs are built as reveals or "not X but Y" contrasts; (4) table cells and card titles written as quips.

Already reads well (light or no change proposed): 4.1 survey paragraph (L-B07, flow only); 6.1 Rajgopal paragraph second and third sentences; 7.2 opening paragraph (quotations carry it); AUDITOR_TABLE rows 1, 2, 4; CROSS "Foreign private issuers" and "Saudi Arabia" bodies; the disclaimer (legal text, one word changed).

Page-fit notes: net change across all 78 proposals is about +5.7% in characters (p13 +4.7%, p14 +0.9%, p15 +7.3%, p16 +4.8%, p17 +4.4%, p18 +4.1%, p19 +9.5%, p20 +5.8%, p21 +5.7%, p22 +5.1%). p19 is the one to watch: the eight decisions run longer because each bold imperative becomes a fuller phrase; merging the two rec boxes into one list removes a header and a box frame, which should absorb most of it. p14 and p21 have slack (p14 ends with whitespace after the objective box; p21 ends about a third short). If p19 or p22 overflows, take the optional items first out of the set (L-B13, L-B25, L-B36, L-B62, L-B63) and revert L-B49 and L-B53 to the shorter leads noted there.

Cross-reference for the front-half editor: the WHO exhibit (so_v2.py lines 715-735, executive-summary spread) echoes section 7 wording that this pass changes: "Keep, drop or replace, minuted on evidence..." (see L-B53/L-B57/L-B73), "Price the saving from the auditor's fee proposal" (L-B52), "List who expects it, and prepare the answer for the first investor who asks" (L-B51/L-B55), "Write down the evidence standard" (L-B54) and "Build one control framework to the most demanding market" (L-B70). Whichever wording is adopted for section 7 should be mirrored there.

---

## Section 4 (v2 pages 13-14)

### L-B01
- v2 page: 13 (and sidebar on every page); so_v2.py lines 331 (h1) and 21 (NAV)
- CURRENT (h1): 4. Two Questions the File<br/>Leaves Open
- PROPOSED (h1): 4. Two Questions the Comment<br/>Letters Leave Open
- CURRENT (NAV): 4. Two Questions the File Leaves Open
- PROPOSED (NAV): 4. Two Open Questions
- Tags: shorthand, heading

### L-B02
- v2 page: 13; line 332 (deck)
- CURRENT: How much is saved, and what investors will do about it.
- PROPOSED: What the exemption may save, and how investors may respond.
- Tags: register, hedge

### L-B03
- v2 page: 13; line 333 (h2)
- CURRENT: 4.1 How much is actually saved
- PROPOSED: 4.1 The likely cost saving
- Tags: heading

### L-B04
- v2 page: 13; lines 334-336
- CURRENT: The release cannot isolate the attestation fee, because companies disclose total audit fees only. Its own input is <b>$202,500 of outside cost and 375 internal hours</b> per annual report, a 2020 estimate adjusted for inflation.
- PROPOSED: The SEC's proposal cannot isolate the attestation fee, because companies disclose only total audit fees. Its estimate instead rests on <b>$202,500 of outside cost and 375 internal hours</b> per annual report, a 2020 figure adjusted for inflation.
- Tags: shorthand, register ("its own input" is modeling jargon)

### L-B05
- v2 page: 13; lines 337-339
- CURRENT: Issuers put the figure higher. One listed company cited by Nasdaq and one biotech CFO each put it at $500,000 to $1 million a year, a range that spans the top estimates the release itself reports, $759,000 and $800,000. A governance association's member survey points the same way.
- PROPOSED: Issuers that commented put the figure higher. One listed company cited by Nasdaq and one biotech CFO each put it at $500,000 to $1 million a year, a range spanning the two highest estimates in the proposing release, $759,000 and $800,000. A governance association's member survey points the same way.
- Tags: shorthand, AI-tell (opening fragment), hedge (attributes "issuers" to commenters)

### L-B06
- v2 page: 13; line 340 (exhibit title only; source line untouched)
- CURRENT: Exhibit 5 — The SEC's number and the companies' number
- PROPOSED: Exhibit 5 — The SEC's estimate and companies' estimates
- Tags: heading, register

### L-B07
- v2 page: 13; lines 352-355
- CURRENT: The same survey suggests the saving companies expect is smaller than the cost they report. <b>Taken together, its two top cost bands put the attestation's cost at $500,000 or more a year for 39% of respondents, but only 3% expect non-accelerated status to save them more than $500,000</b>, and 55% could not quantify the saving at all (pp. 6 and 7).
- PROPOSED: The same survey suggests that the saving companies expect is smaller than the cost they report. <b>Taken together, its two highest cost bands put the attestation's cost at $500,000 or more a year for 39% of respondents, yet only 3% expect non-accelerated status to save them more than $500,000</b>, while 55% could not quantify the saving at all (pp. 6 and 7).
- Tags: flow (already reads well; minor polish only)

### L-B08
- v2 page: 13; lines 356-358
- CURRENT: Neither set of numbers answers the controller's question: what the financial statement audit will cost once the auditor no longer tests controls for an opinion of its own. <b>Only a fee proposal for a specific company answers that.</b>
- PROPOSED: Neither set of figures answers the controller's central question, which is what the financial statement audit will cost once the auditor no longer tests controls for a separate opinion. <b>In our view, only a company-specific fee proposal can answer it.</b>
- Tags: AI-tell (colon-then-reveal, punchy closer), hedge
- FORCE FLAG: the bold line is a deliberate landing point that section 7 (decision 4) builds on. If "In our view" feels too soft here, keep: <b>Only a fee proposal for the specific company can answer it.</b>

### L-B09
- v2 page: 13; line 359 (h2)
- CURRENT: 4.2 What investors will do
- PROPOSED: 4.2 How investors may respond
- Tags: heading, hedge

### L-B10
- v2 page: 13-14; lines 360-365
- CURRENT: Opponents argue that investors will charge for the missing opinion through a higher cost of capital. The figures offered trace largely to one 2009 study that measured how the cost of equity moved when auditor-tested reports showed controls weakening or being fixed; it did not study the removal of the auditor's opinion. The only study we found on the file that measured the cost of capital after an actual exemption, of issuers with revenue under $100 million in 2020, found no significant difference; it is the study the release cites on reporting quality.
- PROPOSED: Opposing commenters argue that investors will price the missing attestation into a higher cost of capital. The figures they cite trace largely to one 2009 study that measured how the cost of equity moved when auditor-tested reports showed controls weakening or being remediated; it did not study the removal of the auditor's opinion. The only study we found in the comment letters that measured the cost of capital after an actual exemption, of issuers with revenue under $100 million in 2020, found no significant difference; the SEC cites the same study on reporting quality.
- Tags: shorthand, register ("charge for the missing opinion", "being fixed")
- Length: +6 words on a paragraph that straddles p13/p14; p14 has slack.

### L-B11
- v2 page: 14; lines 366-368
- CURRENT: Companies are not sure either. In the same survey, 12% of respondents said they would likely keep the attestation voluntarily and 15% were confident they would drop it. <b>52% said it would depend on investor demand.</b>
- PROPOSED: Companies appear undecided too. In the same survey, 12% of respondents said they would likely retain the attestation voluntarily and 15% were confident they would discontinue it; <b>52% said it would depend on investor demand.</b>
- Tags: AI-tell (fragment opener; sentence starting with a numeral), register ("drop it")

### L-B12
- v2 page: 14; lines 377-378 (objective box)
- CURRENT: Both can be true. The first describes the price of the opinion. The second describes what the opinion is for.
- PROPOSED: In our view, both can be true. The first speaks to the attestation's cost; the second, to its purpose.
- Tags: AI-tell (three stacked short sentences), shorthand, register
- FORCE FLAG: the original is a deliberate pivot line. A version that keeps its snap: "Both views can be right: one speaks to the price of the attestation, the other to its purpose."

## Section 5 (v2 page 15)

### L-B13
- v2 page: 15; line 383 (h1), NAV line 22
- CURRENT: 5. Where the Final Rule<br/>Could Move
- PROPOSED: 5. How the Final Rule<br/>Could Change
- NAV: 5. How the Final Rule Could Change (same length as today)
- Tags: heading (optional; current heading is acceptable)

### L-B14
- v2 page: 15; line 384 (deck)
- CURRENT: The Commission can adopt the proposal as written. If it moves, the file shows where.
- PROPOSED: The Commission may adopt the proposal as written. If it changes course, the comment letters suggest where.
- Tags: shorthand, AI-tell (clipped second sentence), hedge

### L-B15
- v2 page: 15; line 385 (exhibit title; source line untouched)
- CURRENT: Exhibit 6 — Where the line could sit, and how many companies stay in scope
- PROPOSED: Exhibit 6 — Alternative thresholds and the companies that would remain in scope
- Tags: shorthand, heading

### L-B16
- v2 page: 15; line 392 (table header)
- CURRENT: Element | What the file says | What to watch for
- PROPOSED: Element | What commenters said | What to watch for
- Tags: shorthand

### L-B17
- v2 page: 15; lines 393-395 (row 1, middle cell)
- CURRENT: <b>55 of the 74</b> commenters that addressed it rejected or questioned a flat 60 months
- PROPOSED: <b>55 of the 74</b> commenters that addressed it rejected or questioned a uniform 60 months
- Tags: register

### L-B18
- v2 page: 15; line 396 (row 2, first cell)
- CURRENT: Float as the only test
- PROPOSED: Float as the sole test
- Tags: register

### L-B19
- v2 page: 15; lines 401-402 (row 4)
- CURRENT: Crossing a line in 2026 | One association and two issuers asked for interim relief; none is proposed | A grace period, or status held until the final rule
- PROPOSED: Crossing a threshold in 2026 | One association and two issuers asked for interim relief; none is proposed | A grace period, or status held until the final rule
- Tags: shorthand, register

### L-B20
- v2 page: 15; lines 403-404 (row 5, middle cell)
- CURRENT: Left at $75 million; law firms asked for parity, now or in the foreign issuer rulemaking
- PROPOSED: Kept at $75 million; law firms asked for parity, now or in the foreign issuer rulemaking
- Tags: AI-tell (subjectless fragment), flow

### L-B21
- v2 page: 15; lines 405-406 (row 6, middle cell)
- CURRENT: 4 commenters asked that companies disclose whether an attestation was obtained
- PROPOSED: Four commenters asked that companies disclose whether an attestation was obtained
- Tags: register (numeral at start of a cell; "Four" matches DECISIONS #7)

### L-B22
- v2 page: 15; lines 408-410
- CURRENT: The on-ramp is where the file comes closest to agreement; a change there would not touch a seasoned mid-market company, but a second test or a lower line would. A count of letters shows where the arguments are, not how the vote will go.
- PROPOSED: The on-ramp is where commenters come closest to agreement; a change there would not affect a seasoned mid-market company, whereas a second test or a lower threshold would. A count of letters shows where the arguments lie rather than how the Commission will vote.
- Tags: shorthand, AI-tell ("not X, not Y" closer), register
- FORCE FLAG: the last sentence is a deliberate caution against reading the tally as a forecast, so the proposal keeps its shape and only names the Commission. A fully softened alternative, if wanted: "A count of letters indicates where the arguments are concentrated; it does not predict how the Commission will vote." (+15% on a tight page.)

## Section 6 (v2 pages 16-17)

### L-B23
- v2 page: 16; lines 415-416 (deck)
- CURRENT: Will this bring the mid-market back? It lowers the cost of staying public. The decision to go public turns on other things.
- PROPOSED: The proposal would lower the cost of remaining public, but the decision to go public depends largely on other factors.
- Tags: AI-tell (rhetorical question, stacked sentences), register
- FORCE FLAG: the question frames section 6 for readers who will ask exactly that. If the authors want to keep a question, use a measured one: "Will the proposal bring the mid-market back? It lowers the cost of staying public, but the decision to go public turns largely on other factors."

### L-B24
- v2 page: 16; lines 417-418
- CURRENT: The proposal's stated purpose is to encourage more companies to go and stay public. The backdrop is real. The number of companies listed on US exchanges fell from 8,090 in 1996 to 3,908 in 2025.
- PROPOSED: The proposal's stated purpose is to encourage more companies to go and stay public. The decline is well documented, with the number of companies listed on US exchanges falling from 8,090 in 1996 to 3,908 in 2025.
- Tags: AI-tell (three-word sentence), flow

### L-B25
- v2 page: 16; line 419 (exhibit title; SRC7 untouched)
- CURRENT: Exhibit 7 — Fewer listed companies, but no shortage of capital
- PROPOSED: Exhibit 7 — Fewer listed companies alongside ample IPO capital
- Tags: AI-tell ("X, but Y"), heading. Optional; current title is serviceable.

### L-B26
- v2 page: 16; lines 421-424
- CURRENT: The release does not claim to know the effect. It gives no estimate of additional listings and says the “magnitude and direction of the effect is difficult to predict”. It also notes that approximately 88% of 2024 IPOs, excluding funds and direct listings, were by emerging growth companies, which already have the exemption for up to five years.
- PROPOSED: The SEC is careful not to quantify the effect. The proposing release gives no estimate of additional listings and states that the “magnitude and direction of the effect is difficult to predict”. It also notes that approximately 88% of 2024 IPOs, excluding funds and direct listings, were by emerging growth companies, which already have the exemption for up to five years.
- Tags: shorthand, register

### L-B27
- v2 page: 16; lines 425-427
- CURRENT: The file does not supply the missing evidence. Supporters assert that listings will follow and none estimates how many. The academic whose study the release cites for the JOBS Act's effect on IPOs is supportive of the five-year on-ramp but cautious about widening the exemption, and wrote:
- PROPOSED: The comment letters do not fill that gap. Supporters argue that listings will follow, but none estimates how many. The academic whose study the proposing release cites on the JOBS Act's effect on IPOs supports the five-year on-ramp but is cautious about widening the exemption, and wrote:
- Tags: shorthand, AI-tell (blunt opener), register

### L-B28
- v2 page: 16-17; lines 432-435
- CURRENT: Much of the research the release cites points elsewhere: abundant private capital and small companies choosing to be acquired. Three of the authors of one of those studies, updating it in 2025 with a co-author, date the US listing gap to 1999, three years before Sarbanes-Oxley, and find that it widened only slowly through 2023.
- PROPOSED: Much of the research the SEC cites attributes the decline to other factors, notably abundant private capital and small companies choosing to be acquired. Three of the authors of one of those studies, updating it in 2025 with a co-author, date the US listing gap to 1999, three years before Sarbanes-Oxley, and find that it widened only slowly through 2023.
- Tags: shorthand, AI-tell (colon-then-reveal)

### L-B29
- v2 page: 17; lines 436-437
- CURRENT: The count of listed companies points the same way: by the end of 2001, before the Act, it had fallen from 8,090 to 6,177, which is 46% of the whole decline to 2025.
- PROPOSED: The listing data are consistent with this. By the end of 2001, before the Act took effect, the count had fallen from 8,090 to 6,177, or 46% of the total decline to 2025.
- Tags: AI-tell (colon-then-reveal), flow
- Note: "before the Act took effect" is a touch more precise than "before the Act" (enacted July 2002); if the owner prefers no added words, keep "before the Act".

### L-B30
- v2 page: 17; lines 438-439
- CURRENT: Capital itself is not short. US IPOs raised $147.5 billion in the first nine months of 2026, more than in all of 2021, and two offerings account for $101.5 billion of it.
- PROPOSED: Capital also remains available. US IPOs raised $147.5 billion in the first nine months of 2026, more than in all of 2021, though two offerings account for $101.5 billion of it.
- Tags: AI-tell (punchy fragment), hedge ("although" makes the concentration caveat do its work)

### L-B31
- v2 page: 17; line 441 (h2)
- CURRENT: 6.1 What it does for a mid-market company
- PROPOSED: 6.1 Implications for mid-market companies
- Tags: heading

### L-B32
- v2 page: 17; lines 442-443
- CURRENT: For a listed company below $2 billion of float that has the attestation today, the benefit is direct: a lower audit bill and less risk of being moved across a line by its share price.
- PROPOSED: For a listed company below $2 billion of float that has the attestation today, the benefits are direct: lower audit fees and less risk of a share price move carrying it across a threshold.
- Tags: shorthand, register ("audit bill")

### L-B33
- v2 page: 17; lines 444-448
- CURRENT: For a private company deciding whether to list, the change is narrower than it looks. A candidate small enough to be an emerging growth company already has five years. What is new is relief for the candidate too large for that status, and one audit firm described the companies between its preferred line and $2 billion as generally “large and seasoned public companies rather than the private companies weighing whether to enter the public markets” (comment letter, p. 4).
- PROPOSED: For a private company considering a listing, the change is narrower than it may appear. A candidate small enough to qualify as an emerging growth company already has up to five years of relief. The new relief is for candidates too large for that status, and one audit firm described the companies between its preferred threshold and $2 billion as generally “large and seasoned public companies rather than the private companies weighing whether to enter the public markets” (comment letter, p. 4).
- Tags: shorthand, AI-tell ("What is new is..."), register
- Note: "up to five years" matches the paper's own wording at lines 424 and 532; not a change of fact.

### L-B34
- v2 page: 17; lines 449-453
- CURRENT: Two effects cut the other way, and both come from the one data set on the file built on the companies affected (Professors Rajgopal, Wong and Zhao, comment letter, pp. 2 to 4). The auditor reported ineffective controls at <b>12.8%</b> ... against 3.8% above $2 billion. The typical newly exempted company is followed by <b>4 to 6 analysts</b>, against 12 for companies that stay in scope.
- PROPOSED: Two findings point the other way, both from the only data set in the comment letters built on the affected companies (Professors Rajgopal, Wong and Zhao, comment letter, pp. 2 to 4). Auditors reported ineffective controls at <b>12.8%</b> ... compared with 3.8% above $2 billion. The typical newly exempted company is followed by <b>4 to 6 analysts</b>, compared with 12 for companies that remain in scope.
- Tags: shorthand, register ("cut the other way")
- Note: the middle of sentence 2 is unchanged ("of companies with $250 million to $700 million of float and <b>8.5%</b> at $700 million to $2 billion,").

### L-B35
- v2 page: 17; lines 454-461
- CURRENT: For foreign issuers the proposal works against its own purpose: a foreign private issuer on Form 20-F would still need the auditor's opinion from $75 million of worldwide float, unless it is an emerging growth company, while a domestic competitor is exempt up to $2 billion, and the SEC is holding back relief until it completes the eligibility review it opened in June 2025. The release concedes this “could result in competitive disadvantages”. One international law firm wrote of the wider gap between the domestic and foreign issuer regimes: “We believe this gap will make U.S. listings significantly less attractive for foreign issuers, thereby reducing the investment opportunities available to U.S. investors.” (Linklaters LLP, comment letter, p. 2).
- PROPOSED: For foreign issuers, the proposal may work against its own purpose, since a foreign private issuer on Form 20-F would still need the auditor's attestation from $75 million of worldwide float, unless it is an emerging growth company, while a domestic competitor would be exempt up to $2 billion; the SEC is deferring relief until it completes the eligibility review it opened in June 2025. The proposing release acknowledges this “could result in competitive disadvantages”. One international law firm wrote of the wider gap between the domestic and foreign issuer regimes: “We believe this gap will make U.S. listings significantly less attractive for foreign issuers, thereby reducing the investment opportunities available to U.S. investors” (Linklaters LLP, comment letter, p. 2).
- Tags: hedge, shorthand, register ("concedes", "holding back"), AI-tell (colon-then-reveal), flow (double full stop after the quotation; dropping the closing stop inside the quotation before a parenthetical citation is standard and does not alter the quoted words)
- FORCE FLAG: the SEC itself acknowledges the competitive disadvantage, so "works against its own purpose" is supportable. If the authors want to keep it unhedged: "For foreign issuers, the proposal works against its own stated purpose, since..."
- HOUSE-RULE QUERY: "Linklaters LLP" is a law firm, so it falls outside "never name accounting, audit or advisory firms" as written. Flag for the owner in case the rule is meant to cover all professional-services firms; the in-text phrase "One international law firm" already carries the point without the name.

### L-B36
- v2 page: 17; line 462 (POV title)
- CURRENT: Uniqus Point of View: an option to be priced
- PROPOSED: Uniqus Point of View: an option, not a saving
- Tags: heading. Optional alternative that avoids the contrast: "Uniqus Point of View: valuing the exemption as an option".

### L-B37
- v2 page: 17; lines 463-466 (POV para 1)
- CURRENT: <b>The proposal lowers the cost of staying public. It does little to change the decision to go public</b>, because most companies making that decision are exempt already and the reasons they stay private are untouched: ample private capital, valuation and litigation exposure.
- PROPOSED: <b>In our view, the proposal lowers the cost of staying public but does little to change the decision to go public.</b> Most companies making that decision are already exempt, and the main reasons companies stay private, namely ample private capital, valuation and litigation exposure, are unaffected.
- Tags: AI-tell (stacked short sentences; colon-then-list reveal), hedge (POV is explicitly attributed)

### L-B38
- v2 page: 17; lines 467-468 (POV para 2)
- CURRENT: For a mid-market company the attraction of a US listing rests on valuation, liquidity and research coverage. A control record that holds up under outside testing supports all three.
- PROPOSED: For a mid-market company, the appeal of a US listing rests on valuation, liquidity and research coverage, and a control record that withstands independent testing supports all three.
- Tags: AI-tell (short closer sentence), flow

### L-B39
- v2 page: 17; line 469 (POV kicker)
- CURRENT: Treat the exemption as an option to be priced, not a saving to be booked.
- PROPOSED: The exemption is best treated as an option to be priced, not a saving to be booked.
- Tags: register (imperative), AI-tell ("not X")
- FORCE FLAG: this is the line the POV box exists to land, and the proposal keeps the contrast deliberately. A softer alternative: "Companies may wish to treat the exemption as an option to be priced rather than a saving to be booked." (+40%; p17 ends with the POV box, so prefer the proposal.) Keeping the original imperative is also defensible for a kicker.

## Section 7 (v2 pages 18-21)

### L-B40
- v2 page: 18 (and sidebar); line 473 (h1), NAV line 23
- CURRENT (h1): 7. What To Do Before the<br/>Final Rule
- PROPOSED (h1): 7. Actions to Consider<br/>Before a Final Rule
- CURRENT (NAV): 7. What To Do Before the Final Rule
- PROPOSED (NAV): 7. Actions Before a Final Rule
- Tags: heading, register

### L-B41
- v2 page: 18; line 474 (deck)
- CURRENT: For the person who runs the SOX program: eight decisions, in order.
- PROPOSED: Eight decisions for SOX program leaders, in the order they arise.
- Tags: AI-tell (colon-then-reveal), register

### L-B42
- v2 page: 18; lines 475-476
- CURRENT: Start by locating the company. Three questions decide where it lands, and only one of the three outcomes calls for work now.
- PROPOSED: The first step is to locate the company. Three questions decide where it lands, and only one of the three outcomes calls for action now.
- Tags: register (imperative), AI-tell (clipped opener)

### L-B43
- v2 page: 18; line 598 (EX8 title; source line untouched)
- CURRENT: Exhibit 8 — Where a company lands under the proposal
- PROPOSED: Exhibit 8 — Determining filer status under the proposal
- Tags: heading, register

### L-B44
- v2 page: 18; lines 583-584 (EX8 row 1 outcome text)
- CURRENT: The auditor's attestation continues from $75 million of worldwide float, unless an emerging growth company.
- PROPOSED: The auditor's attestation continues from $75 million of worldwide float, unless it is an emerging growth company.
- Tags: flow (elliptical clause)

### L-B45
- v2 page: 18; line 587 (EX8 row 2 outcome text)
- CURRENT: The attestation is no longer required. Management's assessment continues.
- PROPOSED: The attestation is no longer required; management's assessment continues.
- Tags: AI-tell (stacked short sentences). Minor.

### L-B46
- v2 page: 18; line 590 (EX8 row 3 outcome text)
- CURRENT: Nothing changes. The attestation continues. If no, it is a non-accelerated filer.
- PROPOSED: No change; the attestation continues. If not, it is a non-accelerated filer.
- Tags: AI-tell (stacked fragments), flow ("If no" is ambiguous in a ladder whose labels are yes/no)
- Length: +4 words in a three-line cell; if the cell must not grow, use "No change; the attestation continues. If not, it is a non-accelerated filer."

### L-B47
- v2 page: 18; lines 593-597 (EX8 footer band)
- CURRENT: <b>Until a final rule takes effect, today's lines still apply.</b> A company that crossed a line on June 30, 2026 needs the attestation for fiscal 2026 unless a final rule takes effect before it files that annual report: under the proposed transition, status is reassessed as of the fiscal year-end before the effective date, and relief applies from the next filing. <em>The release proposes no interim relief.</em>
- PROPOSED: <b>Until a final rule takes effect, the current thresholds still apply.</b> A company that crossed a threshold on June 30, 2026 needs the attestation for fiscal 2026 unless a final rule takes effect before it files that annual report; under the proposed transition, status is reassessed as of the fiscal year-end before the effective date, and relief applies from the next filing. <em>The proposing release provides no interim relief.</em>
- Tags: shorthand, flow (colon to semicolon)

### L-B48
- v2 page: 19; line 478-479 (rec box header)
- CURRENT: Eight decisions for the SOX program leader / Eight decisions for the SOX program leader, continued
- PROPOSED: Eight decisions for SOX program leaders (single header once the two boxes are merged into one numbered list)
- Tags: heading

The eight decisions (DECISIONS, lines 605-625), written assuming they become a numbered list 1-8. Each keeps the bold lead plus no more than two sentences, so every item stays within the three-sentence rule even if the bold lead is counted as a sentence (two items do not today: see #3 and #7).

### L-B49 (Decision 1)
- v2 page: 19; lines 606-607
- CURRENT: <b>Fix your status under both rule sets.</b> Compute public float at the last two second-quarter ends on today's single-day basis and on the proposed 10-trading-day average, and count your months of reporting history.
- PROPOSED: <b>Confirm filer status under the current and proposed rules.</b> Compute public float at the last two second-quarter ends on today's single-day basis and on the proposed 10-trading-day average, and confirm the months of reporting history.
- Tags: register (imperative, "fix"), heading
- Shorter lead if p19 is tight: <b>Confirm filer status under both rule sets.</b>

### L-B50 (Decision 2)
- v2 page: 19; lines 608-610
- CURRENT: <b>If you crossed a line at June 30, 2026, plan on the current rules.</b> Three commenters asked for interim relief and the release offers none. Relief for fiscal 2026 would come only if a final rule takes effect before you file, so watch the effective date.
- PROPOSED: <b>Plan on the current rules if the company crossed a threshold at June 30, 2026.</b> Three commenters asked for interim relief, but the proposal offers none. Relief for fiscal 2026 would come only if a final rule takes effect before the company files, so the effective date warrants monitoring.
- Tags: shorthand, register (imperative; second person)
- FORCE FLAG: the bold lead is a real warning for companies that crossed $700 million in June 2026. Keeping "Plan on the current rules" first in the sentence preserves the force; do not soften to "Companies may wish to consider...".

### L-B51 (Decision 3)
- v2 page: 19; lines 611-614
- CURRENT: <b>List who else expects the opinion.</b> A bank of $5 billion of assets or more stays under the FDIC's rule even if its holding company is exempt. In the governance survey, 97% named investor expectations and analyst coverage among the factors that would most influence whether they use the new accommodations, and 65% debt or equity offering requirements. Ask lenders, rating agencies and your largest holders before deciding.
- PROPOSED: <b>Identify who else relies on the attestation.</b> A bank with $5 billion or more of assets stays under the FDIC's rule even if its holding company is exempt. In the governance survey, 97% named investor expectations and analyst coverage among the factors that would most influence whether they use the new accommodations, and 65% debt or equity offering requirements; lenders, rating agencies and the largest holders are worth consulting before deciding.
- Tags: shorthand, register (imperative), house rule (4 sentences today counting the bold lead; 3 proposed)
- Note: "$5 billion of assets or more" to "$5 billion or more of assets" is word order only.

### L-B52 (Decision 4)
- v2 page: 19; lines 615-616
- CURRENT: <b>Price the saving from a fee proposal, not from the release.</b> Ask the auditor what the audit costs without an opinion on controls; seven firms told the SEC the financial statement audit will absorb part of the work.
- PROPOSED: <b>Base the saving on a fee proposal rather than the SEC's average.</b> Ask the auditor what the audit would cost without an opinion on internal control; seven firms told the SEC the financial statement audit will absorb part of the work.
- Tags: shorthand, register ("price the saving"), AI-tell ("not X")
- FORCE FLAG: the contrast is the point, since section 4 shows the SEC's average and individual company figures diverge. A version that keeps the edge: <b>Estimate the saving from a company-specific fee proposal, not from the SEC's average.</b>

### L-B53 (Decision 5)
- v2 page: 19; lines 617-618
- CURRENT: <b>Take keep, drop or replace to the audit committee with evidence.</b> Material weaknesses and restatements in the last three years, turnover in finance, system changes under way, and who owns the shares.
- PROPOSED: <b>Take the retain, discontinue or replace decision to the audit committee with evidence.</b> That means material weaknesses and restatements in the last three years, finance turnover, system changes under way and the shareholder base.
- Tags: register, AI-tell (verbless second sentence), shorthand ("keep, drop or replace")
- Shorter lead if p19 is tight: <b>Take the decision to the audit committee with evidence.</b>

### L-B54 (Decision 6)
- v2 page: 19; lines 619-620
- CURRENT: <b>Set the evidence standard for an assessment nobody else tests.</b> Scope, sample sizes, tester independence and deficiency evaluation need to be written down, because the auditor's file will no longer supply them.
- PROPOSED: <b>Define the evidence standard for an assessment no one else will test.</b> Scope, sample sizes, tester independence and deficiency evaluation should be documented, because the auditor's work papers will no longer provide them.
- Tags: register, shorthand ("the auditor's file")
- FORCE FLAG: "an assessment no one else will test" is the sharp point of section 7.2; keep it rather than "a management assessment that is not independently tested".

### L-B55 (Decision 7)
- v2 page: 19; lines 621-622
- CURRENT: <b>Decide what you will say.</b> Beyond the cover-page check box, the proposal requires no statement on whether an attestation was obtained. Four commenters asked for one. Have the answer ready for the first investor who asks.
- PROPOSED: <b>Decide how to explain the choice.</b> Beyond the cover-page check box, the proposal requires no statement on whether an attestation was obtained, though four commenters asked for one. An answer should be ready for the first investor who asks.
- Tags: register, AI-tell (stacked short sentences), house rule (4 sentences today counting the bold lead; 3 proposed)

### L-B56 (Decision 8)
- v2 page: 19; lines 623-624
- CURRENT: <b>Keep what is hard to rebuild.</b> Control documentation, IT general control evidence and trained people. A company whose float stays at or above $2 billion for two consecutive years is back in scope.
- PROPOSED: <b>Preserve what is hard to rebuild.</b> This includes control documentation, IT general control evidence and trained staff. A company whose float stays at or above $2 billion for two consecutive years is back in scope.
- Tags: register, AI-tell (verbless fragment)

### L-B57
- v2 page: 19; line 481 (h2)
- CURRENT: 7.1 Keep, drop or replace
- PROPOSED: 7.1 Retain, discontinue or replace
- Tags: heading, register (no nav impact; h2)

### L-B58
- v2 page: 19-20; line 482 (table header)
- CURRENT: Option | When it fits | What you give up
- PROPOSED: Option | When it may fit | What is given up
- Tags: register, hedge

### L-B59
- v2 page: 19; lines 483-484 (row 1)
- CURRENT: <b>Keep the integrated audit voluntarily</b> | A recent material weakness or restatement; a capital raise ahead; lenders who ask | The saving, in whole
- PROPOSED: <b>Retain the integrated audit voluntarily</b> | A recent material weakness or restatement; a planned capital raise; lenders that require it | The full cost saving
- Tags: AI-tell (quip cell), register

### L-B60
- v2 page: 19; lines 485-486 (row 2)
- CURRENT: <b>Drop it and rely on management's assessment</b> | Stable business and systems; a clean control record; concentrated ownership | An independent test of your own conclusion
- PROPOSED: <b>Discontinue it and rely on management's assessment</b> | Stable business and systems; a clean control record; concentrated ownership | Independent testing of management's conclusion
- Tags: register ("drop it"; second person)

### L-B61
- v2 page: 20; lines 487-489 (row 3)
- CURRENT: <b>Replace it with something scaled</b> | A program that wants outside challenge, from internal audit or a periodic outside review, without an annual opinion | Simplicity: the substitute has to be designed and explained
- PROPOSED: <b>Replace it with a scaled alternative</b> | A program that seeks independent challenge, from internal audit or a periodic external review, without an annual opinion | Simplicity, since the alternative must be designed and explained
- Tags: AI-tell (colon quip), register

### L-B62
- v2 page: 20; line 491 (h2)
- CURRENT: 7.2 When management's assessment stands alone
- PROPOSED: 7.2 Relying on management's assessment alone
- Tags: heading. Optional; current heading reads well.

### L-B63
- v2 page: 20; lines 492-493 (first sentences only; quotations unchanged)
- CURRENT: The second option carries a known risk. An advisory firm that does not audit told the SEC that without the external attestation ...
- PROPOSED: The second option carries a recognized risk. An advisory firm that does not audit told the SEC that without the external attestation ...
- Tags: register. Rest of the paragraph reads well.

### L-B64
- v2 page: 20; lines 629, 632-633, 638-639, 641-642 (AUDITOR_TABLE)
- CURRENT (header): The auditor's work | With the attestation | Without it
- PROPOSED (header): The auditor's work | With the attestation | Without the attestation
- CURRENT (row 2 label): Testing that controls operate
- PROPOSED (row 2 label): Testing whether controls operate
- CURRENT (row 2, col 3): Where the auditor relies on controls or cannot get enough evidence without them
- PROPOSED (row 2, col 3): Where the auditor relies on controls or cannot obtain enough evidence without them
- CURRENT (row 5, col 3): Goes in writing to management and the audit committee; <b>no public report</b>
- PROPOSED (row 5, col 3): Communicated in writing to management and the audit committee; <b>no public report</b>
- CURRENT (row 6, col 3): <b>Unchanged</b>: the certification is now the main formal check on what management discloses
- PROPOSED (row 6, col 3): <b>Unchanged</b>; the certification becomes the main formal check on what management discloses
- Tags: register, AI-tell (colon reveal). Rows 1, 3 and 4 read well; source note untouched.

### L-B65
- v2 page: 20; lines 499-501
- CURRENT: Dropping the opinion does not take the auditor out of internal control. The last two rows are the substance of the change: management's conclusion becomes the only public conclusion on internal control, so the evidence behind it has to stand on its own.
- PROPOSED: Discontinuing the attestation does not remove the auditor from internal control. The substance of the change lies in the last two rows: management's conclusion becomes the only public conclusion on internal control, so the evidence behind it must stand on its own.
- Tags: shorthand, register ("dropping the opinion"), AI-tell (colon-then-reveal)

### L-B66
- v2 page: 20; line 502 (practice box header)
- CURRENT: Cross-border implications — the United States, India and the Middle East
- PROPOSED: Cross-border implications: the United States, India and the Middle East
- Tags: AI-tell (em dash). Exhibit titles keep the house "Exhibit N —" form.

### L-B67 (CROSS item 1)
- v2 page: 20-21; lines 649-651
- CURRENT: <b>Foreign private issuers.</b> A company from India or the Gulf that lists in the US on Form 20-F keeps the auditor's opinion from $75 million of worldwide float unless it is an emerging growth company, or it can switch to domestic forms to obtain the relief. A domestic filer of the same size would be exempt up to $2 billion.
- PROPOSED: <b>Foreign private issuers.</b> A company from India or the Gulf that lists in the US on Form 20-F remains subject to the auditor's attestation from $75 million of worldwide float unless it is an emerging growth company, although it may switch to domestic forms to obtain the relief. A domestic filer of the same size would be exempt up to $2 billion.
- Tags: shorthand ("keeps the auditor's opinion" reads as a choice), flow

### L-B68 (CROSS item 2)
- v2 page: 21; lines 652-656
- CURRENT: <b>India already asks for more.</b> Section 143(3)(i) of the Companies Act, 2013 has the auditor report on whether internal financial controls with reference to financial statements are adequate and operating effectively, for listed and unlisted companies alike. Private companies are exempt if they are one person or small companies, or have turnover under INR 50 crore or borrowings under INR 25 crore, and are up to date with their filings (MCA notification G.S.R. 583(E), June 13, 2017). A US parent that drops its attestation may still have an Indian subsidiary whose auditor reports on controls every year.
- PROPOSED: <b>India already requires more.</b> Under Section 143(3)(i) of the Companies Act, 2013, the auditor reports on whether internal financial controls with reference to financial statements are adequate and operating effectively, for listed and unlisted companies alike; private companies are exempt if they are one person or small companies, or have turnover under INR 50 crore or borrowings under INR 25 crore, and are up to date with their filings (MCA notification G.S.R. 583(E), June 13, 2017). A US parent that discontinues its attestation may therefore still have an Indian subsidiary whose auditor reports on controls every year.
- Tags: register ("asks", "drops"), house rule (4 sentences counting the bold lead; 3 proposed)
- Note: the semicolon join makes sentence 2 long. If the owner does not count the bold lead as a sentence, keep the current split and change only the verbs ("requires", "Under ... the auditor reports", "discontinues").

### L-B69 (CROSS item 3)
- v2 page: 21; lines 657-661
- CURRENT: <b>The UAE is moving the other way.</b> ... The UAE's capital markets regulator requires listed public joint-stock companies to obtain an external auditor's opinion on internal control over financial reporting for 2026, unpublished, and to publish it with the board's internal control report from financial year 2027.
- PROPOSED: <b>The UAE is moving in the opposite direction.</b> ... The UAE's capital markets regulator requires listed public joint-stock companies to obtain, but not yet publish, an external auditor's opinion on internal control over financial reporting for 2026, and to publish it with the board's internal control report from financial year 2027.
- Tags: flow ("for 2026, unpublished," is clipped). The Abu Dhabi sentence is unchanged.

### L-B70 (CROSS item 4)
- v2 page: 21; lines 662-666
- CURRENT: <b>Saudi Arabia asks the board and the audit committee.</b> The board reviews ... (CMA Corporate Governance Regulations, Articles 21, 87 and 88). A group reporting in more than one of these markets should build one control framework to the most demanding requirement it faces, not to the US floor.
- PROPOSED: <b>Saudi Arabia looks to the board and the audit committee.</b> The board reviews ... (CMA Corporate Governance Regulations, Articles 21, 87 and 88). In our view, a group reporting in more than one of these markets should build one control framework to the most demanding requirement it faces, rather than to the US minimum.
- Tags: register ("asks"), hedge, AI-tell ("not X")
- FORCE FLAG: this is the box's recommendation, so the proposal keeps "should" and adds only "In our view". A softer alternative if the owner prefers: "In our view, a group reporting in more than one of these markets would be well served by a single control framework built to the most demanding requirement it faces, rather than to the US minimum." (p21 has slack, so either fits.)

## How Uniqus Can Help (v2 page 22)

### L-B71
- v2 page: 22; lines 507-510
- CURRENT: This section is for four readers, each with a decision to take. If your company will remain a large accelerated filer, or is an emerging growth company in its first five years, nothing here changes your program. We do not audit, so no audit fee of ours depends on whether a company keeps the attestation.
- PROPOSED: We support companies at each of the four decision points below. For a company that will remain a large accelerated filer, or an emerging growth company in its first five years, the proposal does not change the SOX program. Because we do not provide audits, we have no audit fee at stake in whether a company retains the attestation.
- Tags: register (services-page voice), flow
- Note: the last sentence keeps the factual claim exactly (no audit fee depends on the choice) and does not add an "independence" claim.

### L-B72 (HELP card 1)
- v2 page: 22; lines 675-678
- CURRENT: In or out? | Before fiscal 2026 audit planning closes | <b>Filer status memo, one week.</b> Public float on both measurement bases for the last two years, months of reporting history, FDIC and contractual overlays, and your expected status under the proposal and under the two alternatives the file most supports.
- PROPOSED: Confirming filer status | Before fiscal 2026 audit planning closes | <b>Filer status memo, one week.</b> An analysis of public float on both measurement bases for the last two years, months of reporting history, FDIC and contractual requirements, and your expected status under the proposal and the two alternatives commenters most support.
- Tags: AI-tell (question as title), shorthand, register ("overlays")
- Duration left as is (owner to confirm).

### L-B73 (HELP card 2)
- v2 page: 22; lines 679-682
- CURRENT: Keep, drop or replace? | Before the audit committee approves the next audit plan | <b>Audit committee decision paper, three weeks.</b> An evidence file on control history, what investors and lenders expect, a fee comparison built from your auditor's own proposal, and a recommendation the committee can minute.
- PROPOSED: Retain, discontinue or replace | Before the audit committee approves the next audit plan | <b>Audit committee decision paper, three weeks.</b> An evidence base on control history and investor and lender expectations, a fee comparison built from your auditor's own proposal, and a recommendation the committee can record in its minutes.
- Tags: AI-tell (question title), register, shorthand

### L-B74 (HELP card 3)
- v2 page: 22; lines 684-686
- CURRENT: What stands behind a management-only assessment? | Before the first year without the opinion | <b>404(a) evidence standard, six weeks.</b> Scoping, testing and deficiency evaluation written to the SEC's 2007 guidance for management, with a tester-independence model and a first-year test plan.
- PROPOSED: Supporting a management-only assessment | Before the first year without the auditor's attestation | <b>404(a) evidence standard, six weeks.</b> Scoping, testing and deficiency evaluation documented in line with the SEC's 2007 guidance for management, together with a tester-independence model and a first-year test plan.
- Tags: AI-tell (question title), shorthand, register

### L-B75 (HELP card 4)
- v2 page: 22; lines 687-690
- CURRENT: Foreign private issuer or multi-market group? | Before your next Form 20-F | <b>Cross-border control map, four weeks.</b> One framework mapped to Section 404, India's internal financial controls reporting and UAE or Saudi requirements, showing where a single test serves all of them.
- PROPOSED: Foreign private issuers and multi-market groups | Before your next Form 20-F | <b>Cross-border control map, four weeks.</b> A single framework mapped to Section 404, India's internal financial controls reporting and UAE or Saudi requirements, identifying where one test can satisfy several regimes.
- Tags: AI-tell (question title), register

### L-B76
- v2 page: 22; lines 512-513
- CURRENT: To start any of these, write to <b>Sandip Khetan</b>, Co-Founder and Global Head of Accounting &amp; Reporting Consulting, through www.uniqus.com.
- PROPOSED: To discuss any of these, please contact <b>Sandip Khetan</b>, Co-Founder and Global Head of Accounting &amp; Reporting Consulting, through www.uniqus.com.
- Tags: register

### L-B77 (ABOUT, body paragraph)
- v2 page: 22; lines 694-700
- CURRENT: Uniqus Consultech is an AI and global tech-enabled consulting company that specializes in Accounting &amp; Reporting Consulting, Governance, Risk &amp; Compliance, Sustainability &amp; Climate Consulting, Tech Consulting, and Valuations. The Company is co-founded by consulting veterans Jamil Khatri and Sandip Khetan and backed by marquee investors such as Nexus Venture Partners, Sorin Investments, and UST. Uniqus has a global team of 800 professionals, led by 100 Partners and Directors, across 13 offices in the USA, the Middle East, and India. The company serves more than 400 clients, including marquee names in each of the markets it operates in.
- PROPOSED: Uniqus Consultech is a global, AI- and technology-enabled consulting firm specializing in Accounting &amp; Reporting Consulting, Governance, Risk &amp; Compliance, Sustainability &amp; Climate Consulting, Tech Consulting and Valuations. The firm was co-founded by consulting veterans Jamil Khatri and Sandip Khetan and is backed by investors including Nexus Venture Partners, Sorin Investments and UST. Uniqus has a global team of 800 professionals, led by 100 partners and directors, across 13 offices in the United States, the Middle East and India, and serves more than 400 clients, including leading organizations in each of its markets.
- Tags: register ("marquee" twice reads as hype), flow ("The Company is co-founded" tense; "The Company"/"The company" capitalization; Oxford comma used here but not elsewhere in the paper; "USA" vs "US" elsewhere), house rule (4 sentences today; 3 proposed)
- Note: About text is often corporate boilerplate fixed by marketing. All numbers kept; confirm with the owner whether the standard boilerplate may be edited. If not, the minimum fix is "The Company is co-founded" to "The Company was co-founded" and "The company serves" to "The Company serves".

### L-B78 (ABOUT, disclaimer)
- v2 page: 22; lines 701-702
- CURRENT: ...is based on the SEC’s proposing release, the public comment file, regulatory materials...
- PROPOSED: ...is based on the SEC’s proposing release, the public comment letters, regulatory materials...
- Tags: shorthand. Rest of the disclaimer is legal text and reads appropriately; no other change.

---

## Left alone (and why)

- Exhibit 5 source line ends "so the exhibit shows a gap between them, not an error in either" (a "not X" construction) and Exhibit 6 source uses "comment file S7-2026-18" and "float line". Source lines are out of bounds under rule 9; "comment file S7-2026-18" is also the SEC's formal docket term, so it is correct there. Flag only, if the owner wants to relax rule 9 for prose inside source notes.
- Quotations (Nasdaq, OPERS, Dambra, Linklaters, AAA, advisory firm) unchanged.
- The ladder branch labels ("yes", "no", "No: go to question 2", "Yes: go to question 3") are functional and read fine.
- The BAND image and SRC7 have no editable prose in scope.
- Chart internals (outside scope, for the owner's information): charts.py x6 axis label "Public float line (logarithmic scale)" and the 2026 timeline label "Proposal: line to $2bn" use "line"; "threshold" would match the text if the text changes are adopted.
- No British spellings found in scope.
