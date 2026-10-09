# Language pass, front half: cover, Executive Summary, Sections 1 to 3, EX1, EX3, WHO, CAL, BAND

Scope: so_v2.py lines 1 to 329, plus EX1 (525 to 552), EX3 (555 to 565), WHO (715 to 736), CAL (739 to 747) and BAND (783 to 784). Page references are to paper_v2.txt (22 pages). Bold in the rendered text is shown as **bold**; implementers should keep the existing `<b>` placement unless a proposal says otherwise. Where a CURRENT passage is built from `%s` placeholders, the rendered values are shown and the placeholders must be kept in the edit.

## Patterns found

| Pattern | Count in scope | Typical instance |
|---|---|---|
| "the line" / "line" used for the filer threshold | 25 (of 28 uses of "line") | "the $2 billion line as drawn", "today's lines", "Proposed $2 billion line" |
| "the file" / "A file" / "comment file" as shorthand for the comment record | 8 | "The file argues about where the line should sit", "How we read the file", "Audit firms on the file" |
| "the release" used bare | 6 | "The release gives no estimate", "The saving in the release" |
| "the opinion" used bare for the auditor's attestation | 3 | "keep the opinion", "may still expect the opinion" |
| Imperatives addressed at the reader | 13 | "Fix the company's status", "Price the saving", "Write down the evidence standard", "Ask investors first" |
| Proposal stated as settled fact (no "would") | 6 | "The large accelerated filer line rises", "every new registrant gets five years", "falls away" |
| Colon-then-reveal | 7 | "None of this proves cause:", "The gap is widest on persistence:" |
| Fragments / verbless standfirsts | 8 | "Built between 2002 and 2005. Scaled or narrowed four times since.", "Nothing, on Form 20-F" |
| Stacked short sentences | 5 | "The proposal lowers the cost of staying public. It does little to change..." |
| Glib or colloquial verbs and phrases | 14 | "and moved on", "price the saving", "drop", "its edges moving", "few companies buy it", "two that matter", "Got Here" |
| "Not X, but Y" / "X, not Y" constructions | 3 | "becomes a choice the committee makes, not a requirement it oversees" |
| House rule: paragraph over 3 sentences | 2 | p. 5 "$700 million line" paragraph (4); p. 10 "SEC estimates" paragraph (4) |
| House rule: British spelling | 1 | "favourable" (line 161); also "minuted" (WHO) reads as British usage |
| House rule: firm naming (borderline) | 1 | "including the Big Four" (line 287) |
| Section-title cross-references that must move together | 5 | NAV, h1 and "(Refer Section ...)" lines for Sections 1, 4 and 7; "How we read the file" box title and the Exhibit 4 source line |

Overall: 62 proposals (L-F01 to L-F62). Each proposal has a Length line. Across all of them, PROPOSED text is 3.0% longer than CURRENT (16,189 to 16,681 characters, about 490 characters, or roughly six body lines across 10 pages). Most of the growth comes from adding "would" where the proposal was stated as settled fact, and from attribution. Every body-prose passage is within ±10%. The only items outside ±10% are short labels and headings (two nav labels, the 1.2 and 3.1 headings, the EX1 tile labels and the Exhibit 4 source citation), and each moves by 15 characters or fewer. Three of them get shorter. Page-fit-sensitive items (tiles, the EX1 chain, the WHO grid, the CAL strip and table cells) are held to substitutions of similar length. Pages to watch in the rebuild: p. 3 (Q4, Q5 and the POV share the page) and p. 7 (Section 1 closes at the foot of the page).

Cross-editor dependencies (the other editor owns these lines; changes must land together or not at all):
- Section 4 title: h1 at line 331 ("4. Two Questions the File Leaves Open") must match NAV (line 21) and the Q2 ref (line 77). Proposed: "4. Two Questions Left Open".
- Section 7 title: h1 at line 473 must match NAV (line 23) and the Q5 ref (line 93). Proposed NAV "7. Actions Before a Final Rule"; h1 "7. Actions to Consider Before a Final Rule".
- "Keep, drop or replace": a named framework used at lines 91, 481 (7.1 heading), 485, 617, 679 and 719. Proposed "Keep, discontinue or replace" everywhere, or keep the label unchanged everywhere. Do not change it in my scope alone.
- "How we read the file" (box title line 319, cited in Exhibit 4 source line 268): if renamed, the citation must change with it.

---

## Cover and navigation

**L-F01**
- v2 page: 1 (cover); so_v2.py 12 to 13
- CURRENT: The SEC proposes to stop requiring the auditor's opinion on internal control / at 1,596 companies. A review of every comment letter, and what comes next.
- PROPOSED: The SEC proposes to stop requiring the auditor's opinion on internal control / for 1,596 companies. We review every comment letter and what may come next.
- Length: 153 to 154 characters (+1%)
- Tags: AI-tell, hedge
- Note: second line is a verbless fragment; "what comes next" asserts an outcome. Line breaks preserved; line 2 is one character longer.

**L-F02**
- v2 page: sidebar (all pages); so_v2.py 20
- CURRENT: 1. How Section 404 Got Here
- PROPOSED: 1. How Section 404 Evolved
- Length: 27 to 26 characters (-4%)
- Tags: heading, register
- Note: must match h1 at line 109 (L-F24) and the ref at line 69 (L-F10).

**L-F03**
- v2 page: sidebar; so_v2.py 21
- CURRENT: 4. Two Questions the File Leaves Open
- PROPOSED: 4. Two Questions Left Open
- Length: 37 to 26 characters (-30%)
- Tags: shorthand, heading
- Note: shorter nav label; h1 at line 331 is the other editor's. Ref at line 77 updated in L-F11.

**L-F04**
- v2 page: sidebar; so_v2.py 23
- CURRENT: 7. What To Do Before the Final Rule
- PROPOSED: 7. Actions Before a Final Rule
- Length: 35 to 30 characters (-14%)
- Tags: heading, register
- Note: suggested h1 for line 473 (other editor): "7. Actions to Consider Before a Final Rule". "a final rule" avoids implying adoption is certain. Ref at line 93 updated in L-F14.

Left as is: strap, footer, nav items "2. What the SEC Proposed", "3. What the SEC Heard", "5. Where the Final Rule Could Move", "6. Capital Markets and the Mid-Market".

## Executive Summary (pp. 2 to 3)

**L-F05**
- v2 page: 2 (tile 2); so_v2.py 45 to 46
- CURRENT: Commenters addressing the attestation who called the exemption too broad, nine in guarded terms, or said it should not be expanded
- PROPOSED: Commenters addressing the attestation who called the exemption too broad (nine in guarded terms) or said it should not be expanded
- Length: 130 to 130 characters (+0%)
- Tags: flow
- Note: the qualifier currently splits the "or" pair. Length unchanged.

**L-F06**
- v2 page: 2 (tile 3); so_v2.py 47 to 48
- CURRENT: Audit firms on the file that endorsed the $2 billion line as drawn; 10 of them questioned the five-year on-ramp
- PROPOSED: Audit firms commenting that endorsed the $2 billion threshold as proposed; 10 questioned the five-year on-ramp
- Length: 111 to 110 characters (-1%)
- Tags: shorthand
- Note: "as proposed" replaces the drafting metaphor "as drawn" throughout (see L-F11, L-F57).

**L-F07**
- v2 page: 2 (tile 4); so_v2.py 49 to 50
- CURRENT: Commenters who said anything concrete about what a company should do once the attestation is gone
- PROPOSED: Commenters who offered concrete guidance on what a company should do once the attestation is not required
- Length: 97 to 105 characters (+8%)
- Tags: register
- Note: still shorter than tile 2, which sets the tile height. "is gone" overstates (a company may still obtain one).

**L-F08**
- v2 page: 2; so_v2.py 52 to 57
- CURRENT: Most finance leaders read the SEC's filer status proposal of May 19, 2026 (Release No. 33-11419, *Enhancement of Emerging Growth Company Accommodations and Simplification of Filer Status for Reporting Companies*) as a cost saving and moved on. The large accelerated filer line rises from $700 million to $2 billion of public float, every new registrant gets five years, and the SEC's requirement for an auditor's opinion on internal control falls away for **1,596 companies**.
- PROPOSED: Many finance leaders have read the SEC's filer status proposal of May 19, 2026 (Release No. 33-11419, *Enhancement of Emerging Growth Company Accommodations and Simplification of Filer Status for Reporting Companies*) as a cost saving. The large accelerated filer threshold would rise from $700 million to $2 billion of public float, every new registrant would have five years of seasoning, and the auditor's opinion on internal control would no longer be required at **1,596 companies**.
- Length: 470 to 482 characters (+3%)
- Tags: register, hedge, shorthand, AI-tell
- Note: "Most ... moved on" is an unsupported generalization and glib; the proposal is described as if adopted. "gets five years" does not say five years of what.

**L-F09**
- v2 page: 2; so_v2.py 58 to 61
- CURRENT: The comment file is less settled than that reading. It holds 192 entries from **172 distinct commenters**, and this paper rests on a review of every one. It follows Section 404 through its life: how it reached this point, what the SEC has now heard, and what a finance leader should do before the answer arrives.
- PROPOSED: The public comment record suggests the matter is less settled. It holds 192 entries from **172 distinct commenters**, and this paper draws on a review of each one. We trace how Section 404 reached this point, summarize what the SEC has heard, and consider what finance leaders may wish to do before a final rule.
- Length: 308 to 308 characters (+0%)
- Tags: shorthand, AI-tell, register
- Note: removes the colon-then-list and "before the answer arrives". Keep `%s` placeholders for 192 and 172.

**L-F10**
- v2 page: 2 (Q1); so_v2.py 62 to 69
- CURRENT: Q: First, how did Section 404 get here, and what did it deliver? / A: It was built between 2002 and 2005 and has been scaled or narrowed four times since; the proposal would be the fifth. The $700 million line was set in 2005 and has not moved: at adoption it captured 18% of companies on US markets, and today it captures **35.4% of registrants**. Over the same years restatements fell and the SEC's staff concluded from the research that auditor testing brought out control deficiencies management had not disclosed, though neither can be credited to Section 404 alone. / (Refer Section 1: How Section 404 Got Here)
- PROPOSED: Q: First, how has Section 404 evolved, and what has it delivered? / A: The requirement was put in place between 2002 and 2005 and has been scaled or narrowed four times since; the proposal would be the fifth. The $700 million threshold set in 2005 has not moved; it captured 18% of companies on US markets at adoption and captures **35.4% of registrants** today. Over the same period restatements fell, and the SEC staff concluded from the research that auditor testing brought out control deficiencies management had not disclosed, though neither can be credited to Section 404 alone. / (Refer Section 1: How Section 404 Evolved)
- Length: 613 to 626 characters (+2%)
- Tags: shorthand, AI-tell, register, heading
- Note: "It was built" has no clear antecedent after the question; colon-reveal removed.

**L-F11**
- v2 page: 2 (Q2); so_v2.py 70 to 77
- CURRENT: Q: Second, what did the SEC hear? / A: Of the 118 commenters that addressed the attestation, **75 said the exemption is too broad or should not be expanded**, nine of them in guarded terms, and 32 supported it or wanted more. / The split runs by constituency. Every company, both exchanges and every business trade association that took a side supported the exemption. No accounting firm endorsed the $2 billion line as drawn, and 25 of the 27 investors and investor advocates that addressed the exemption called it too broad or opposed any expansion. / (Refer Sections 3 and 4: What the SEC Heard; Two Questions the File Leaves Open)
- PROPOSED: Q: Second, what did commenters tell the SEC? / A: Of the 118 commenters who addressed the attestation, **75 said the exemption is too broad or should not be expanded**, nine of them in guarded terms, and 32 supported it or sought a wider one. / Views split by constituency. Every company, both exchanges and every business trade association that took a side supported the exemption. No accounting firm endorsed the $2 billion threshold as proposed, and 25 of the 27 investors and investor advocates that addressed the exemption called it too broad or opposed any expansion. / (Refer Sections 3 and 4: What the SEC Heard; Two Questions Left Open)
- Length: 630 to 641 characters (+2%)
- Tags: shorthand, register, AI-tell, heading
- Note: "wanted more" is colloquial. The ref title must match the Section 4 h1 the other editor settles on.

**L-F12**
- v2 page: 3 (Q3); so_v2.py 78 to 82
- CURRENT: Q: Third, where could the final rule move? / A: No final rule has been adopted. The letters show where one could move: the five-year on-ramp for very large new listings, a second test beside public float, and relief for companies that cross today's lines while the rule is pending.
- PROPOSED: Q: Third, where could the final rule move? / A: No final rule has been adopted. The comment letters suggest where it could change: the five-year on-ramp for very large new listings, a second test beside public float, and relief for companies that cross today's thresholds while the rule is pending.
- Length: 281 to 298 characters (+6%)
- Tags: shorthand, register, hedge
- Note: "show" overstates what letters can establish about a final rule. Ref "(Refer Section 5: Where the Final Rule Could Move)" left unchanged so it matches the Section 5 title; only the question wording changes.

**L-F13**
- v2 page: 3 (Q4); so_v2.py 84 to 88
- CURRENT: Q: Fourth, will this bring the mid-market back? / A: The proposal lowers the cost of staying public. It does little to change the decision to go public, because most companies making that decision are exempt already. The release gives no estimate of additional listings.
- PROPOSED: Q: Fourth, will this bring the mid-market back? / A: In our view, the proposal would lower the cost of staying public but do little to change the decision to go public, as most companies making that decision are already exempt. The proposing release gives no estimate of additional listings.
- Length: 270 to 291 characters (+8%)
- Tags: AI-tell, register, shorthand, hedge
- Note: merges two stacked short sentences. The question is unchanged.

**L-F14**
- v2 page: 3 (Q5); so_v2.py 89 to 93
- CURRENT: Q: Fifth, what should a finance leader do before the final rule? / A: Fix the company's status under both rule sets, price the saving from the auditor's own fee proposal, and take keep, drop or replace to the audit committee with evidence. Section 7 sets out eight decisions for the person who runs the SOX program. / (Refer Section 7: What To Do Before the Final Rule)
- PROPOSED: Q: Fifth, what should finance leaders do before a final rule? / A: Companies may wish to confirm their status under both rule sets, estimate the saving from the auditor's own fee proposal, and bring keep, discontinue or replace to the audit committee with evidence. Section 7 sets out eight decisions for the SOX program lead. / (Refer Section 7: Actions to Consider Before a Final Rule)
- Length: 369 to 387 characters (+5%)
- Tags: register, AI-tell, heading
- Note: three imperatives and two glib verbs ("price", "drop"). "discontinue" depends on the framework decision (see Cross-editor dependencies); if the label stays, use "keep, drop or replace". FORCE FLAG: if the authors want this to read as a firm recommendation, use "We would recommend that companies confirm ..." in place of "Companies may wish to confirm ...".

**L-F15**
- v2 page: 3 (Point of View, para 1); so_v2.py 95 to 98
- CURRENT: The file argues about where the line should sit; a finance leader has a different question. **Once the auditor's opinion is optional, management's assessment under Section 404(a) is the only report on internal control an investor receives.** The proposal changes neither that assessment nor the certifications that accompany it.
- PROPOSED: Much of the comment record debates where the threshold should sit; finance leaders face a different question. **Once the auditor's opinion is optional, management's assessment under Section 404(a) becomes the only report on internal control an investor receives.** The proposal changes neither that assessment nor the certifications that accompany it.
- Length: 324 to 347 characters (+7%)
- Tags: shorthand, register, AI-tell
- Note: the owner's example. Kept to three sentences (house rule) by joining the first two with a semicolon, as the original does. The owner's two-sentence wording ("Much of the public comment focuses on where the threshold should be set. For finance leaders, the more pressing question is a different one.") would put the paragraph at four sentences, so this one merges the two. FORCE FLAG: the bold sentence is the paper's thesis and stays declarative; only "is" becomes "becomes" so it reads as a consequence of the proposal.

**L-F16**
- v2 page: 3 (Point of View, para 2); so_v2.py 99 to 101
- CURRENT: We would plan on the core of the proposal surviving and its edges moving. Companies below $2 billion of float that have the attestation today should prepare for a year in which it becomes a choice.
- PROPOSED: We would expect the core of the proposal to survive, with changes at the margins. Companies below $2 billion of float that obtain the attestation today should prepare for a year in which it becomes optional.
- Length: 197 to 207 characters (+5%)
- Tags: AI-tell, register
- Note: "its edges moving" is glib. FORCE FLAG: "should prepare" is kept deliberately; softening to "may wish to" would undercut the paper's main call to action.

**L-F17**
- v2 page: 3 (Point of View, kicker); so_v2.py 102 to 103
- CURRENT: That choice belongs to the audit committee, and it should be made on evidence before a lender, an underwriter or an investor asks about it.
- PROPOSED: That decision rests with the audit committee, and it should be grounded in evidence before a lender, underwriter or investor raises the question.
- Length: 139 to 145 characters (+4%)
- Tags: register
- Note: FORCE FLAG: the "should" is kept; it is the closing point of the POV.

Left as is: signature block, POV title ("when management's assessment stands alone" reads well).

## What this means for you (WHO exhibit, p. 4)

**L-F18**
- v2 page: 4 (audit committee row); so_v2.py 718 to 720
- CURRENT: What changes: The auditor's opinion on internal control becomes a choice the committee makes, not a requirement it oversees. / Decision: Keep, drop or replace, minuted on evidence before the next audit plan is approved.
- PROPOSED: What changes: The auditor's opinion on internal control would become the committee's choice rather than a requirement. / Decision: Keep, discontinue or replace, recorded on evidence before the next audit plan is approved.
- Length: 219 to 221 characters (+1%)
- Tags: AI-tell, spelling, register, hedge
- Note: "minuted" is British usage; "X, not Y" softened. Framework label per Cross-editor dependencies.

**L-F19**
- v2 page: 4 (CFO row); so_v2.py 721 to 723
- CURRENT: What changes: Certifications and management's 404(a) assessment are unchanged; the audit fee and the filing calendar may move. / Decision: Price the saving from the auditor's fee proposal, and decide what to tell investors.
- PROPOSED: What changes: Certifications and management's 404(a) assessment are unchanged; the audit fee and filing deadlines may change. / Decision: Estimate the saving from the auditor's fee proposal, and decide what to tell investors.
- Length: 223 to 225 characters (+1%)
- Tags: AI-tell, register
- Note: imperatives are acceptable in a "decision in front of you" column; only the glib verb is replaced.

**L-F20**
- v2 page: 4 (SOX program leader row); so_v2.py 724 to 726
- CURRENT: What changes: No external test of management's conclusion; the auditor still understands, and may test, controls. / Decision: Write down the evidence standard: scope, samples, tester independence and deficiency evaluation.
- PROPOSED: What changes: No external test of management's conclusion, though the auditor must still understand, and may test, controls. / Decision: Document the evidence standard for scope, sampling, tester independence and deficiency evaluation.
- Length: 222 to 235 characters (+6%)
- Tags: AI-tell, register
- Note: "the auditor still understands" is ungrammatical as a statement of requirement; colon list removed.

**L-F21**
- v2 page: 4 (Treasurer row); so_v2.py 727 to 729
- CURRENT: What changes: Covenants, bank regulators and investors may still expect the opinion. / Decision: List who expects it, and prepare the answer for the first investor who asks.
- PROPOSED: What changes: Covenants, bank regulators and investors may still expect the auditor's opinion. / Decision: Identify who expects it, and prepare a response for the first investor who asks.
- Length: 173 to 187 characters (+8%)
- Tags: shorthand, register

**L-F22**
- v2 page: 4 (IPO candidate row); so_v2.py 730 to 732
- CURRENT: What changes: Five years without the attestation for every new registrant, not only emerging growth companies. / Decision: Build controls to the standard the listing will need in year six, not year one.
- PROPOSED: What changes: Every new registrant, not only emerging growth companies, has five years before the attestation can apply. / Decision: Build controls to the standard the company will need in year six, not year one.
- Length: 202 to 212 characters (+5%)
- Tags: AI-tell, hedge
- Note: fragment made a sentence, and "can apply" reflects that the attestation follows only if large accelerated status is reached. FORCE FLAG: "year six, not year one" is a deliberate, memorable contrast and is kept.

**L-F23**
- v2 page: 4 (Foreign private issuer row); so_v2.py 733 to 735
- CURRENT: What changes: Nothing, on Form 20-F: the opinion still starts at $75 million of float. / Decision: Build one control framework to the most demanding market it reports in.
- PROPOSED: What changes: No change on Form 20-F; the attestation still applies from $75 million of float. / Decision: Build one control framework to the most demanding market it reports in.
- Length: 170 to 178 characters (+5%)
- Tags: AI-tell, shorthand, register

Left as is: exhibit title "What this means for you"; row labels; source line.

## Section 1 (pp. 5 to 7)

**L-F24**
- v2 page: 5; so_v2.py 109
- CURRENT: 1. How Section 404 Got Here
- PROPOSED: 1. How Section 404 Evolved
- Length: 27 to 26 characters (-4%)
- Tags: heading, register
- Note: matches L-F02 and L-F10.

**L-F25**
- v2 page: 5 (deck); so_v2.py 110
- CURRENT: Built between 2002 and 2005. Scaled or narrowed four times since. The proposal would be the fifth.
- PROPOSED: Introduced between 2002 and 2005, and scaled or narrowed four times since; the proposal would be the fifth.
- Length: 98 to 107 characters (+9%)
- Tags: AI-tell
- Note: three stacked fragments.

**L-F26**
- v2 page: 5; so_v2.py 111 to 112
- CURRENT: Section 404 has two halves. Under 404(a), management assesses internal control over financial reporting and reports its conclusion. Under 404(b), the auditor attests to that assessment.
- PROPOSED: Section 404 has two parts. Under 404(a), management assesses internal control over financial reporting and reports its conclusion; under 404(b), the auditor attests to that assessment.
- Length: 185 to 184 characters (-1%)
- Tags: AI-tell, flow
- Note: light touch; reduces three short sentences to two.

**L-F27**
- v2 page: 5; so_v2.py 113 to 118
- CURRENT: The second half has never applied to everyone, and it has been scaled or narrowed four times. In 2007 the SEC issued guidance for management and the PCAOB a risk-based audit standard; in 2010 Congress exempted non-accelerated filers from the auditor's attestation by statute, after the SEC had repeatedly deferred it for them. The JOBS Act added emerging growth companies in 2012, and in 2020 the SEC took issuers eligible to be smaller reporting companies with revenue under $100 million out of accelerated and large accelerated filer status.
- PROPOSED: The attestation has never applied to everyone, and it has been scaled or narrowed four times. In 2007 the SEC issued guidance for management and the PCAOB a risk-based audit standard; in 2010 Congress exempted non-accelerated filers from the auditor's attestation by statute, after the SEC had repeatedly deferred it for them. The JOBS Act exempted emerging growth companies in 2012, and in 2020 the SEC removed issuers eligible to be smaller reporting companies with revenue under $100 million from accelerated and large accelerated filer status.
- Length: 543 to 547 characters (+1%)
- Tags: register, flow
- Note: "The second half" relies on the previous paragraph's metaphor; "took ... out of" is colloquial.

**L-F28**
- v2 page: 5; so_v2.py 120 to 124
- CURRENT: The $700 million line was set in 2005 and has not moved. At adoption it captured 18% of companies on US markets; today the same line captures **35.4% of registrants**. The SEC did not index it: adjusted for consumer prices the line would be $1.15 billion, and tracking the S&P 500 it would be $3.85 billion. It chose $2 billion to restore coverage of "nearly 95 percent" of public float, and estimates that line covers 93.5%.
- PROPOSED: The $700 million threshold set in 2005 has not moved since; it captured 18% of companies on US markets at adoption and captures **35.4% of registrants** today. The SEC did not index it; adjusted for consumer prices the threshold would be $1.15 billion, and tracking the S&P 500, $3.85 billion. Instead, the SEC chose $2 billion to restore coverage of "nearly 95 percent" of public float, and estimates that the new threshold covers 93.5%.
- Length: 421 to 434 characters (+3%)
- Tags: shorthand, AI-tell, flow (house rule: 4 sentences to 3)
- Note: HOUSE RULE: the current paragraph has four sentences. Quotation unchanged.

**L-F29**
- v2 page: 6; so_v2.py 127 to 129
- CURRENT: The SEC's own tables show the control record under each regime. Over 2021 to 2024, management reported ineffective controls at **5.2%** of large accelerated filers, **15.7%** of accelerated filers and **41.8%** of non-accelerated filers.
- PROPOSED: The SEC's own tables show the control record under each regime. From 2021 to 2024, management reported ineffective controls at **5.2%** of large accelerated filers, **15.7%** of accelerated filers and **41.8%** of non-accelerated filers.
- Length: 225 to 225 characters (+0%)
- Tags: flow
- Note: minor ("Over 2021 to 2024" is non-idiomatic). Otherwise reads well.

**L-F30**
- v2 page: 6; so_v2.py 139 to 143
- CURRENT: Size explains part of that gradient, and the SEC reads its restatement table cautiously: the rate for non-accelerated filers is "only slightly higher" than for accelerated filers, and the non-accelerated group holds more low- or zero-revenue issuers, which restate less often. The gap is widest on persistence: **24.9% of non-accelerated filers reported ineffective controls in all four years**, against 4.2% of accelerated filers.
- PROPOSED: Size explains part of that gradient, and the SEC reads its restatement table cautiously, noting that the rate for non-accelerated filers is "only slightly higher" than for accelerated filers and that the non-accelerated group holds more low- or zero-revenue issuers, which restate less often. The gap is widest on persistence, with **24.9% of non-accelerated filers reporting ineffective controls in all four years**, against 4.2% of accelerated filers.
- Length: 427 to 449 characters (+5%)
- Tags: AI-tell, register
- Note: two colon-reveals.

**L-F31**
- v2 page: 6; so_v2.py 144 to 145
- CURRENT: Where the attestation is optional, few companies buy it. The SEC estimates that less than six percent of exempt registrants obtained one voluntarily in 2024.
- PROPOSED: Where the attestation is optional, few companies obtain it; the SEC estimates that less than six percent of exempt registrants did so voluntarily in 2024.
- Length: 157 to 154 characters (-2%)
- Tags: AI-tell, register
- Note: "buy it" is glib; joins a stacked short sentence.

**L-F32**
- v2 page: 6; so_v2.py 146
- CURRENT: 1.2 What the second opinion delivered
- PROPOSED: 1.2 What the second opinion has delivered
- Length: 37 to 41 characters (+11%)
- Tags: heading
- Note: optional. "Second opinion" is the paper's title motif and is worth keeping in one heading; the tense change matches L-F10. If the authors prefer a plainer heading: "1.2 What the auditor's attestation has delivered".

**L-F33**
- v2 page: 6; so_v2.py 147 to 151
- CURRENT: Cost is one side of the ledger. On the other, the SEC's 2011 staff study concluded that auditor testing "has generally resulted in the disclosure of internal control deficiencies" that management had not previously disclosed, and that the attestation "appears to have a positive impact on the informativeness of internal control disclosures and financial reporting quality". The release repeats both findings.
- PROPOSED: Cost is only one side of the ledger; on the other, the SEC's 2011 staff study concluded that auditor testing "has generally resulted in the disclosure of internal control deficiencies" that management had not previously disclosed, and that the attestation "appears to have a positive impact on the informativeness of internal control disclosures and financial reporting quality". The proposing release cites both findings.
- Length: 409 to 422 characters (+3%)
- Tags: AI-tell, shorthand
- Note: quotations untouched.

**L-F34**
- v2 page: 6; so_v2.py 152 to 156
- CURRENT: Restatements rose in the first three years of the Act and have fallen since. The Center for Audit Quality, the audit profession's policy body, counts a 60% decline from 2006 to 2009 and a further fall from **858 in 2013 to 402 in 2022**. Ideagen Audit Analytics, counting from the same database without the Center's adjustment for blank-check companies, recorded 434 in 2023, 477 in 2024 and 391 in 2025, the second lowest year in its 20-year database after 2020.
- PROPOSED: Restatements rose in the first three years of the Act and have declined since. The Center for Audit Quality, the audit profession's policy body, reports a 60% decline from 2006 to 2009 and a further fall from **858 in 2013 to 402 in 2022**. Ideagen Audit Analytics, counting from the same database without the Center's adjustment for blank-check companies, recorded 434 in 2023, 477 in 2024 and 391 in 2025, the second-lowest year in its 20-year database after 2020.
- Length: 459 to 462 characters (+1%)
- Tags: flow
- Note: light touch only; the paragraph reads well.

**L-F35**
- v2 page: 7; so_v2.py 158 to 162
- CURRENT: Those closest to the work saw value in it, though on average not enough to outweigh the cost. The release says respondents to a 2008 and 2009 survey of 2,901 corporate insiders found the benefits to outweigh the costs, "especially as they gained experience with section 404(b)". The study behind the survey is less favourable: on average respondents did not judge the benefits to outweigh the costs, though perceived net benefits were higher where an auditor attested and rose with experience.
- PROPOSED: Those closest to the work saw value in it, though on average not enough to outweigh the cost. The proposing release says respondents to a 2008 and 2009 survey of 2,901 corporate insiders found the benefits to outweigh the costs, "especially as they gained experience with section 404(b)". The underlying study is less favorable, finding that on average respondents did not judge the benefits to outweigh the costs, though perceived net benefits were higher where an auditor attested and rose with experience.
- Length: 493 to 508 characters (+3%)
- Tags: spelling, shorthand, AI-tell
- Note: HOUSE RULE: "favourable" to "favorable". Colon-reveal removed. Quotation unchanged.

**L-F36**
- v2 page: 7; so_v2.py 165 to 170
- CURRENT: The SEC names the wider benefit itself: Section 404(b) "may play a role in improving overall investor confidence, encouraging investment in public markets". None of this proves cause: the Act also created the PCAOB, audit committee independence rules and officer certifications, the release cites a 2024 working paper that found no decline in internal control or financial reporting quality at issuers exempted in 2020, and it says auditor testing "may have fewer benefits" at the larger companies now affected.
- PROPOSED: The SEC itself notes a wider benefit: Section 404(b) "may play a role in improving overall investor confidence, encouraging investment in public markets". None of this proves cause, since the Act also created the PCAOB, audit committee independence rules and officer certifications. The proposing release also cites a 2024 working paper that found no decline in internal control or financial reporting quality at issuers exempted in 2020, and says auditor testing "may have fewer benefits" at the larger companies now affected.
- Length: 511 to 527 characters (+3%)
- Tags: AI-tell, shorthand
- Note: two colon-reveals; the run-on list mixed a causal caveat with the release's counter-evidence, now separated. Three sentences. Quotations unchanged.

**L-F37**
- v2 page: 7; so_v2.py 171 to 174
- CURRENT: What the record does show is what is being given up: **an independent test that, in the research the SEC staff reviewed in 2011, brought out deficiencies management had not disclosed.** That study covered companies with $75 million to $250 million of float and recommended against widening the exemption.
- PROPOSED: What the record does show is what would be given up: **an independent test that, in the research the SEC staff reviewed in 2011, brought out deficiencies management had not disclosed.** That study covered companies with $75 million to $250 million of float and recommended against widening the exemption.
- Length: 300 to 300 characters (+0%)
- Tags: hedge
- Note: FORCE FLAG: this is the section's landing point, and the colon before the bold clause is a deliberate emphasis, so it stays. Only "is being" becomes "would be", because nothing has yet been given up. A softer version, if wanted: "In our view, the record shows clearly what would be given up: ...".

Left as is: 1.1 heading; Exhibit 2 title and source line; the "Compliance costs also fell after 2007" paragraph (lines 163 to 164).

## Exhibit 1 (EX1, p. 5) and Exhibit 3 (EX3, p. 7)

**L-F38**
- v2 page: 5 (Exhibit 1, chain items); so_v2.py 526, 528, 533
- CURRENT: 2002: Sarbanes-Oxley enacted; accelerated filer line set at $75 million of float / 2005: Large accelerated filer line set at $700 million / 2026: Proposal: line to $2 billion; 60 months for every new registrant
- PROPOSED: 2002: Sarbanes-Oxley enacted; accelerated filer threshold set at $75 million of float / 2005: Large accelerated filer threshold set at $700 million / 2026: Proposal: $2 billion threshold; 60 months for every new registrant
- Length: 210 to 222 characters (+6%)
- Tags: shorthand
- Note: the 2002 and 2005 boxes are wide enough for the five extra characters; the 2026 item is the same length.

**L-F39**
- v2 page: 5 (Exhibit 1, band headers); so_v2.py 541 to 543
- CURRENT: Built, 2002 to 2005: the requirement applied / Scaled or narrowed, 2007 to 2026: the proposal would be the fifth / Who sits above the large accelerated filer line
- PROPOSED: Introduced, 2002 to 2005: the requirement takes effect / Scaled or narrowed, 2007 to 2026: the proposal would be the fifth / Who sits above the large accelerated filer threshold
- Length: 162 to 177 characters (+9%)
- Tags: shorthand, flow
- Note: "Built ... the requirement applied" is terse. These headers are one line in uppercase small caps with plenty of room.

**L-F40**
- v2 page: 5 (Exhibit 1, share tiles); so_v2.py 537, 539
- CURRENT: 2024, same $700 million line / Proposed $2 billion line
- PROPOSED: 2024, same $700 million threshold / Proposed $2 billion threshold
- Length: 55 to 65 characters (+18%)
- Tags: shorthand
- Note: tile labels are one line at 6.8pt in one-third width, with room for the extra characters.

Left as is: Exhibit 1 title and source line; remaining chain items (2004, 2007, 2010, 2012, 2020); "2005, at adoption" tile. Exhibit 3 (EX3): title and source line read well; no change (source lines are out of bounds apart from shorthand, and there is none).

## Section 2 (pp. 8 to 10)

**L-F41**
- v2 page: 8 (deck); so_v2.py 180
- CURRENT: One line at $2 billion, one clock at five years, and no auditor's opinion below either.
- PROPOSED: A $2 billion threshold, a five-year seasoning period, and no auditor's opinion below either.
- Length: 87 to 92 characters (+6%)
- Tags: shorthand, AI-tell
- Note: "one line ... one clock" is a stylized triplet. the deck already wraps to two lines.

**L-F42**
- v2 page: 8 (summary table, row 1 label and row 3 cell); so_v2.py 182, 188 to 189
- CURRENT: Large accelerated filer line / Two consecutive years above or below the line; no separate exit level
- PROPOSED: Large accelerated filer threshold / Two consecutive years above or below the threshold; no separate exit level
- Length: 100 to 110 characters (+10%)
- Tags: shorthand
- Note: the row 1 label already wraps to two lines; the row 3 cell gains one word inside a three-line cell. Other cells read well.

**L-F43**
- v2 page: 8; so_v2.py 197 to 200
- CURRENT: Filer status decides three things: how fast a company must file, how much it must disclose, and whether its auditor attests to internal control. Today five overlapping labels can apply. The proposal would leave two that matter, large accelerated and non-accelerated, and add a sub-category for the smallest companies.
- PROPOSED: Filer status determines three things: how fast a company must file, how much it must disclose, and whether its auditor attests to internal control. Today five overlapping categories can apply. The proposal would keep two main categories, large accelerated and non-accelerated, and add a sub-category for the smallest companies.
- Length: 317 to 327 characters (+3%)
- Tags: register, AI-tell
- Note: "two that matter" is glib. The colon list is a true list, so it stays.

**L-F44**
- v2 page: 9 (filer categories table); so_v2.py 220
- CURRENT: Stays by statute; the SEC expects reliance on it to be unnecessary in most circumstances.
- PROPOSED: Retained by statute; the SEC expects reliance on it to be unnecessary in most circumstances.
- Length: 89 to 92 characters (+3%)
- Tags: register
- Note: the rest of the table reads well and is left alone.

**L-F45**
- v2 page: 9 to 10; so_v2.py 230 to 234
- CURRENT: A change of status therefore moves more than the attestation. A large accelerated filer that becomes non-accelerated gains 30 days on its Form 10-K and five on its Form 10-Q, ...
- PROPOSED: A change of status therefore affects more than the attestation. A large accelerated filer that becomes non-accelerated gains 30 days on its Form 10-K and five on its Form 10-Q, ...
- Length: 178 to 180 characters (+1%)
- Tags: register
- Note: first sentence only; the remainder reads well.

**L-F46**
- v2 page: 10; so_v2.py 237 to 239
- CURRENT: ... The option to defer new accounting standards to private-company dates is limited to a filer's first five years after registration, so most large accelerated filers that convert will not have it.
- PROPOSED: ... The option to defer new accounting standards to private-company dates is limited to a filer's first five years after registration, so most large accelerated filers that change status would not have it.
- Length: 198 to 205 characters (+4%)
- Tags: hedge, register
- Note: second sentence only. "convert" is jargon, and "will" assumes adoption.

**L-F47**
- v2 page: 10; so_v2.py 240 to 246
- CURRENT: The SEC estimates that large accelerated filers would fall from 2,115 to 1,146, from 35.4% to 19.2% of registrants, while still holding 93.5% of public float. **1,596 registrants** would be newly exempt from the attestation: 964 that are large accelerated filers today and 632 accelerated filers. The other five of today's large accelerated filers lack the float data to classify. The 1,596 are 60% of the registrants that obtain an attestation today.
- PROPOSED: The SEC estimates that large accelerated filers would fall from 2,115 to 1,146, or from 35.4% to 19.2% of registrants, while still holding 93.5% of public float. In all, **1,596 registrants**, 60% of those that obtain an attestation today, would be newly exempt, comprising 964 current large accelerated filers and 632 accelerated filers. The other five of today's large accelerated filers lack the float data needed to classify them.
- Length: 447 to 430 characters (-4%)
- Tags: flow (house rule: 4 sentences to 3), AI-tell
- Note: HOUSE RULE: four sentences currently. Also avoids starting a sentence with a numeral. Keep the `%s` placeholders and the `%%` escape for "60%". Figures unchanged.

**L-F48**
- v2 page: 10; so_v2.py 247 to 252
- CURRENT: Two groups get less than the headline suggests. Banks are counted in the 1,596, but an insured bank with $5 billion or more of total assets remains subject to the FDIC's attestation requirement under 12 CFR Part 363, a threshold in effect since January 1, 2026. The FDIC rule applies to the bank, not the holding company, so a holding company that drops the attestation may still need one for its bank; ...
- PROPOSED: Two groups gain less than the headline suggests. Banks are counted in the 1,596, but an insured bank with $5 billion or more of total assets remains subject to the FDIC's attestation requirement under 12 CFR Part 363, a threshold in effect since January 1, 2026. The FDIC rule applies to the bank, not the holding company, so a holding company that discontinues the attestation may still need one for its bank; ...
- Length: 406 to 414 characters (+2%)
- Tags: register, AI-tell
- Note: "get less" and "drops" are colloquial. Remainder unchanged.

**L-F49**
- v2 page: 10; so_v2.py 253 to 254
- CURRENT: Foreign private issuers filing on Form 20-F or 40-F stay outside the new categories and keep today's $75 million trigger, measured on a single day.
- PROPOSED: Foreign private issuers filing on Form 20-F or 40-F remain outside the new categories and retain today's $75 million trigger, measured on a single day.
- Length: 147 to 151 characters (+3%)
- Tags: register

Left as is: h1 "2. What the SEC Proposed"; 2.1 heading; the other cells of both tables; table source note; the "It could also omit risk factors" sentence.

## Where the rule stands (CAL exhibit, p. 10)

**L-F50**
- v2 page: 10; so_v2.py 742, 745, 746
- CURRENT: Proposal issued May 19, beside proposals on semiannual reporting (May 5) and registered offering reform (May 19) / No final rule; the docket holds 192 entries / Timing and effective date not yet set; the release proposes no interim relief
- PROPOSED: Proposal issued May 19, alongside proposals on semiannual reporting (May 5) and registered offering reform (May 19) / No final rule yet; the docket holds 192 entries / Timing and effective date not yet set; the proposal includes no interim relief
- Length: 238 to 246 characters (+3%)
- Tags: register, shorthand
- Note: each cell keeps its line count. Keep the `%s` placeholder for 192. Title, the other two cells and the source line are left as is.

## Section 3 (pp. 11 to 12)

**L-F51**
- v2 page: 11 (deck); so_v2.py 260
- CURRENT: A file that divides between those who pay for assurance and those who rely on it or provide it.
- PROPOSED: Comment letters that divide between those who pay for assurance and those who rely on it or provide it.
- Length: 95 to 103 characters (+8%)
- Tags: shorthand
- Note: a minimal swap that keeps the deck's shape. As a full sentence: "The letters divide between those who pay for assurance and those who rely on it or provide it."

**L-F52**
- v2 page: 11; so_v2.py 261 to 264
- CURRENT: As posted on October 5, 2026, the docket held 192 entries, the latest dated September 8, 2026; letters posted since are not counted here. Setting aside SEC staff memoranda, a roundtable transcript and duplicates leaves **172 distinct commenters**. Of these, 118 addressed the attestation and 54 did not mention it.
- PROPOSED: As posted on October 5, 2026, the comment docket held 192 entries, the latest dated September 8, 2026; letters posted since are not counted here. Excluding SEC staff memoranda, a roundtable transcript and duplicates leaves **172 distinct commenters**, of whom 118 addressed the attestation and 54 did not mention it.
- Length: 310 to 312 characters (+1%)
- Tags: flow, shorthand
- Note: keep `%s` placeholders.

**L-F53**
- v2 page: 11 (Exhibit 4 source line); so_v2.py 268
- CURRENT: ... the method is set out in "How we read the file". ...
- PROPOSED: ... the method is set out in "How we reviewed the comment letters". ...
- Length: 56 to 71 characters (+27%)
- Tags: shorthand
- Note: changes only if L-F61 is adopted. This is the one source-line edit in my scope (shorthand, as permitted). The rest of the source line is unchanged.

**L-F54**
- v2 page: 11; so_v2.py 277 to 281
- CURRENT: Supporters are the parties that bear the cost: companies, their associations, both exchanges and most of the securities lawyers who wrote. Those objecting are led by investors and individual commenters, joined by academics and by most of the firms and professional bodies that provide the assurance. ...
- PROPOSED: Support came mainly from the parties that bear the cost: companies, their associations, both exchanges and most of the securities lawyers who commented. Opposition was led by investors and individual commenters, joined by academics and by most of the firms and professional bodies that provide the assurance. ...
- Length: 303 to 312 characters (+3%)
- Tags: register, hedge
- Note: "Supporters are" overstates (some supporters are not cost-bearers, as the rest of the paper shows). The third sentence is unchanged.

**L-F55**
- v2 page: 11; so_v2.py 282 to 283
- CURRENT: The middle is more informative than either end. Thirty-two commenters accepted that the line should move and objected to how far. Twenty of them named a different line or test.
- PROPOSED: The middle ground is more informative than either end. Thirty-two commenters accepted that the threshold should rise but objected to its extent; 20 proposed a different threshold or test.
- Length: 176 to 188 characters (+7%)
- Tags: shorthand, AI-tell, register
- Note: three stacked short sentences. If the authors want the judgment marked as theirs, start with "In our view," (about +7%).

**L-F56**
- v2 page: 11; so_v2.py 285
- CURRENT: 3.1 The audit profession, grouped by position
- PROPOSED: 3.1 The audit profession's positions
- Length: 45 to 36 characters (-20%)
- Tags: heading

**L-F57**
- v2 page: 11 to 12; so_v2.py 286 to 291
- CURRENT: Eleven of the twenty largest US accounting firms, ranked by revenue in the 2026 INSIDE Public Accounting list, wrote, including the Big Four, along with one advisory firm that does not audit; the other nine filed nothing, and nor did the AICPA in its own name, the Institute of Internal Auditors, Financial Executives International or the Institute of Management Accountants. **Nine of the twelve said the exemption is, or may be, too broad; two took no side; one supported it. None endorsed the $2 billion line as drawn.**
- PROPOSED: Eleven of the twenty largest US accounting firms, ranked by revenue in the 2026 INSIDE Public Accounting list, commented, including the four largest, as did one advisory firm that does not audit; the other nine did not comment, nor did the AICPA in its own name, the Institute of Internal Auditors, Financial Executives International or the Institute of Management Accountants. **Nine of the twelve said the exemption is, or may be, too broad, two took no position and one supported it; none endorsed the $2 billion threshold as proposed.**
- Length: 519 to 536 characters (+3%)
- Tags: shorthand, flow, register
- Note: HOUSE RULE (borderline): "the Big Four" is a collective brand term for named firms, so it is replaced with "the four largest" and the fact is preserved. Two sentences, down from three. "wrote, including ..., along with" was hard to parse.

**L-F58**
- v2 page: 12 (table 3.1, column 1 row labels); so_v2.py 293, 299, 304, 307
- CURRENT: The line is too high, and here is where to put it. / The exempt group may be too wide, but we will not name a number. / There is not enough evidence to decide yet. / Let the market decide.
- PROPOSED: The threshold is too high; an alternative is named. / The exempt group may be too wide; no number is named. / The evidence is not yet sufficient to decide. / The market should decide.
- Length: 188 to 183 characters (-3%)
- Tags: AI-tell, shorthand, register
- Note: the paraphrased first-person voice ("here is where to put it", "we will not name a number") is a stylized device that reads as quotation without being one. Labels are the same length or shorter.

**L-F59**
- v2 page: 12 (table 3.1, column 3); so_v2.py 295 to 309
- CURRENT: Row 1: Each named a fix: keep the attestation above today's $700 million line; a line of approximately $1.1 billion; an inflation adjustment of the thresholds; a revenue limit of $1.235 billion beside float; or keep it after a recent material weakness. **If the SEC takes any of these, some companies between $700 million and $2 billion of float keep the opinion.** / Row 2: A second look at how many companies fall out, a test that looks past public float alone, and refreshed PCAOB guidance on auditing internal control, which is not on the PCAOB's standard-setting agenda of September 30, 2026. **Even firms with no alternative of their own question the breadth, which adds weight to a second test beside float.** / Row 3: Ask investors first, and redo the cost estimate to count the control work an auditor must still perform. **The saving in the release may be overstated.** / Row 4: Make the attestation a choice for most issuers. **Even the one supporter suggested the SEC consider a line below $2 billion.**
- PROPOSED: Row 1: Each named an alternative: keep the attestation above today's $700 million threshold; a threshold of approximately $1.1 billion; an inflation adjustment of the thresholds; a revenue limit of $1.235 billion beside float; or keep it after a recent material weakness. **If the SEC adopts any of these, some companies with $700 million to $2 billion of float would keep the attestation.** / Row 2: A second look at how many companies would be exempted, a test that looks beyond public float alone, and refreshed PCAOB guidance on auditing internal control, which is not on the PCAOB's standard-setting agenda of September 30, 2026. **Even firms with no alternative of their own question the breadth, which adds weight to a second test beside float.** / Row 3: Consult investors first, and revise the cost estimate to include the control work an auditor must still perform. **The saving in the SEC's proposal may be overstated.** / Row 4: Make the attestation optional for most issuers. **Even this supporter suggested the SEC consider a threshold below $2 billion.**
- Length: 999 to 1053 characters (+5%)
- Tags: shorthand, register, hedge, AI-tell
- Note: rows 3 and 4 summarize what the firms asked for, so the imperative mood is acceptable as reported request; only the casual verbs change. The row 2 bold now says whose judgment it is. Each cell stays within about one line of its current depth.

**L-F60**
- v2 page: 12 (bullets); so_v2.py 312 to 318
- CURRENT: **The saving is smaller than the fee line implies.** Seven firms said the financial statement audit will absorb part of the work, because auditors must still understand controls and, in many audits, test them or do more substantive work. / **Five years is too long for a very large new listing.** Ten of the eleven audit firms questioned a flat 60-month on-ramp. / **Fewer firms will keep the capability.** One firm estimates, "based on current data", that only six firms would likely perform integrated audits for ten or more issuers.
- PROPOSED: **The net saving may be smaller than the fee suggests.** Seven firms said the financial statement audit will absorb part of the work, because auditors must still understand controls and, in many audits, test them or do more substantive work. / **Five years may be too long for very large new listings.** Ten of the eleven audit firms questioned a flat 60-month on-ramp. / **Fewer firms may retain the capability.** One firm estimates, "based on current data", that only six firms would likely perform integrated audits for ten or more issuers.
- Length: 523 to 531 characters (+2%)
- Tags: AI-tell, hedge
- Note: the owner cited "the saving is smaller than the fee line implies" as a glib line. The bold leads state the firms' views as fact, but they are attributed claims. FORCE FLAG: if the authors want the first lead to land harder, use "**Expect a smaller net saving than the fee suggests.**" (keeps the point, drops the glib verb).

**L-F61**
- v2 page: 12 ("How we read the file" box); so_v2.py 319 to 323
- CURRENT: Title: How we read the file / **How it was read.** Every entry was read and coded with AI under the direction of Uniqus professionals. All but two letters went through two independent passes, and differences were settled by re-reading the letter. Every quotation printed here was checked against the page of the filed letter.
- PROPOSED: Title: How we reviewed the comment letters / **Approach.** Every entry was read and coded with AI under the direction of Uniqus professionals. All but two letters went through two independent passes, with differences resolved by re-reading the letter. Every quotation in this paper was checked against the relevant page of the filed letter.
- Length: 321 to 336 characters (+5%)
- Tags: shorthand, heading, register
- Note: the title change requires L-F53. The box sits at the foot of p. 12 with spare room, so a two-word-longer title is safe.

**L-F62**
- v2 page: 12 (box, second item); so_v2.py 324 to 327
- CURRENT: **What counts.** Each distinct filer, once: a letter with 115 signatories, most of them academics, and a joint letter from 49 organizations each count once, and staff memoranda of meetings are excluded. A position is only what the letter says about the attestation; a letter that never mentions Section 404(b) is recorded as silent.
- PROPOSED: **What is counted.** Each distinct filer is counted once, so a letter with 115 signatories, most of them academics, and a joint letter from 49 organizations each count as one; staff memoranda of meetings are excluded. A position reflects only what the letter says about the attestation, and a letter that never mentions Section 404(b) is recorded as silent.
- Length: 328 to 353 characters (+8%)
- Tags: AI-tell, flow
- Note: "Each distinct filer, once:" is a fragment followed by a colon-reveal.

Left as is: h1 "3. What the SEC Heard"; Exhibit 4 title and the rest of its source line; "How many" column of table 3.1; h3 "Three points from the firms' letters that bear on planning"; the third sentence of the "Supporters" paragraph.

## BAND

BAND (lines 783 to 784) is an image wrapper with no text, so there is nothing to edit.
