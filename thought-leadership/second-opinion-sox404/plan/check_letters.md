# Comment-letter check (File No. S7-2026-18): primary SEC copies

Checked 2026-10-09 against the files in `scratchpad/sec_in/sec/`, read with `pdftotext -layout`. These notes name firms for internal QA only. The paper must keep them unnamed.

**Page-number convention.** Where the letter prints page numbers, "p." is the printed number. In every such letter here, the printed number equals the PDF page. Letters with no printed numbers are marked "PDF p.": Dambra, Connor Group, Rajgopal/Wong/Zhao and Grant Thornton (GT). The Avalo and Olema web comments have no pages.

---

## 1. S-15: Nasdaq, p. 4. CONFIRMED

- **File:** s7202618-974119-3031468.pdf. The page number "4" is printed at the page foot and matches PDF p. 4.
- **Letter text:** "One listed company estimated that it spent between $500,000 and $1 million annually with independent auditors to comply with this disclosure obligation and observed that such expenses could be better deployed on research & development."
- **Comparison:** The paper's quotation in the §4 compare box is word for word. `&amp;` renders as "&".
- **Edit needed:** none.

## 2. S-16: OPERS, p. 9. CONFIRMED (wording, page, dash)

- **File:** s7202618-968459-3005226.pdf. The header reads "Page 9 of 11", which is PDF p. 9.
- **Letter text:** Without an independent “gatekeeper,” management’s assessment is inherently less credible – in effect, investors are being asked to trust the numbers with one fewer check on the system that produced them.
  - The quotes are curly (U+201C/U+201D), with the comma inside.
  - The dash is a spaced EN DASH (U+2013), not an em dash.
  - The apostrophe is curly (’).
  - Footnote marker 20 follows "them.".
- **Paper (so_v2.py l.374–376):** “Without an independent “gatekeeper,” management's assessment is inherently less credible – in effect, investors are being asked to trust the numbers with one fewer check on the system that produced them.”
  - The words, the en dash and the quote marks around gatekeeper all match.
  - The only difference is the straight apostrophe in "management's". That is paper-wide house style: so_v2.py uses ' almost everywhere.
- **Edit needed:** none required.
  - Optional typographic point: inside a double-quoted quotation the inner quote is conventionally single. That would mean `“Without an independent “gatekeeper,” management's` → `“Without an independent ‘gatekeeper,’ management's`.

## 3. S-17: Dambra, p. 2. Quote CONFIRMED; characterisation PARTLY WRONG

- **File:** s7202618-948899-2923386.pdf. It has no printed page numbers. The quote is on PDF p. 2.
- **Full sentence in the letter:** "On balance, the weight of our evidence supports the direction of the proposal. While I do not expect the regulation to increase IPO activity in the United States, our research indicates that scaling back the burdens of being public enhances the frequency and efficiency of corporate investment and innovation, both of which are indeed important to our domestic economy. I accordingly support the proposed extension of scaled-disclosure and related accommodations to non-accelerated filers and the simplification of the filer-status framework."
- **The cut:** The paper's "…" replaces only the trailing ", both of which are indeed important to our domestic economy." That cut is fair and changes no meaning.
- **"Supportive of the five-year on-ramp":** correct. PDF p. 3, Q8: "I am supportive of the 60-month seasoning rule for two reasons."
- **"Cautious about widening the exemption":** understates his position. He supports the proposal, including the 404(b) extension:
  - PDF p. 2: "the weight of our evidence supports the direction of the proposal … I accordingly support the proposed extension".
  - PDF p. 4, Q13: "Yes, I believe that the EGC and SRC accommodations should be extended to NAFs".
- **His caution is about cost, not about breadth:**
  - PDF p. 5, Q22: "The Commission should be cognizant and aware of the tradeoff to more internal control exemptions."
  - PDF p. 5: "While I can see the benefits to extending the ICFR exemption, the Commission should be clear it is not costless and experts on the JOBS Act do not expect this to increase IPO volume."
  - PDF p. 6: "perhaps at the cost of lower financial reporting reliability."
- **Edit needed (so_v2.py l.426–427):**
  - Current text: `"IPOs is supportive of the five-year on-ramp but cautious about widening the exemption, and wrote:"`
  - Replacement: `"IPOs supports the proposal, including the five-year on-ramp, while warning that the wider exemption is “not costless”, and wrote:"`
  - The words "not costless" are at PDF p. 5.

## 4. S-18: Linklaters, p. 2, and authorship. CONFIRMED

- **File:** s7202618-967379-3003006.pdf. The footer reads "Page 2 of 5", which is PDF p. 2.
- **Letter text:** "We believe this gap will make U.S. listings significantly less attractive for foreign issuers, thereby reducing the investment opportunities available to U.S. investors."
- **Context:** The sentence concerns "a materially wider gap between the U.S. domestic issuer regime and the FPI regime". That matches the paper's framing.
- **Authorship:** The letter is signed "/s/ Linklaters LLP" (p. 5). The firm describes itself as "a law firm authorised and regulated by the Solicitors Regulation Authority" and "an international firm". It was filed jointly on S7-2026-17 and S7-2026-18 (dated July 20, 2026).
- **Edit needed:** none.

## 5. S-19: Connor Group, p. 3. CONFIRMED

- **File:** s7202618-944379-2915595.pdf. It has no printed numbers. The quote is on PDF p. 3.
- **Letter text:** "Without the external attestation requirement to impose an objective, independent standard, the 404(a) process tends over time toward formalism — “check-the-box” documentation of controls whose operating effectiveness has not been rigorously tested."
- **Paper's description:** The paper calls Connor "an advisory firm that does not audit". The letter's PDF p. 1 supports this: "We do not perform financial statement audits, nor are we subject to PCAOB inspection."
- **Edit needed:** none.

## 6. S-20: AAA, "about half of issuers", p. 7. CONFIRMED; it is the Financial Reporting Policy Committee

- **File:** s7202618-959959-2963086.pdf, the Financial Reporting Policy Committee of the AAA's Financial Accounting and Reporting Section. The page number "7" is printed at the foot and matches PDF p. 7.
- **Letter text** (Table 3, row 3b): "Investors would no longer receive independent assurance on management’s assertions of internal control effectiveness. Section 404(a) alone only results in the discovery and disclosure of about half of issuers with ineffective internal controls[7], which is not only costly to investors …"
- **The 2017 study:** Footnote 7 is "See Ge, Koester and McVay 2017". That is the JAE paper on small firms' internal control disclosures, so "a 2017 study of small companies" is fair.
- **The other committee:** The AAA Auditing Standards Committee letter (s7202618-966979-3001148.pdf) also cites Ge, Koester and McVay at PDF p. 6, but in different words ("reduce ICFR misreporting … from 9.3 to 5.8 percent"). It does not contain the quoted sentence.
- **Edit needed:** none required.
  - Optional precision: the letter says the views are the members' own, "not necessarily … those of the American Accounting Association or the Financial Accounting and Reporting Section".
  - Current text (l.494): `"The American Accounting Association's Financial Reporting Policy Committee, citing"`
  - Replacement: `"The Financial Reporting Policy Committee of the American Accounting Association's financial reporting section, citing"`

## 7. S-21: Crowe, p. 4, and the "preferred line" paraphrase. CONFIRMED

- **File:** s7202618-967580-3003849.pdf. The header reads "Page 4", which is PDF p. 4.
- **Letter text:** "A threshold of approximately $1.1 billion would still provide meaningful relief while remaining closer to a cost- or inflation-calibrated threshold. The issuers between $1.1 billion and $2 billion that would remain large accelerated filers are, generally, large and seasoned public companies rather than the private companies weighing whether to enter the public markets."
- **The ~$1.1bn figure:** It comes from p. 3: "our analysis produced an estimated threshold of approximately $1.1 billion". Crowe also suggests "a revenue measure" on p. 3.
- **Comparison:** The paper's "between its preferred line and $2 billion as generally “large and seasoned …”" is accurate.
- **Edit needed:** none.

## 8. S-22: Rajgopal/Wong/Zhao, pp. 2–4. CONFIRMED

- **File:** s7202618-959159-2961226.pdf. It has no printed numbers.
- **Ineffective-controls figures** (PDF p. 2, table row "Auditor says internal controls don't work (404(b))"):
  - $250M–$700M (newly exempted): 12.8%
  - $700M–$2B (newly exempted): 8.5%
  - ≥$2B (stays fully regulated): 3.8%
- **Analyst coverage:** The sentence runs across PDF pp. 3–4: "The typical newly exempted company is followed by only 4 to 6 stock analysts, versus 12 for companies that stay fully regulated".
- **Further detail:**
  - The table covers filings from January 2025 to July 2026.
  - The 12.8% figure is repeated at PDF p. 6.
  - The analyst data are the FY2025 IBES snapshot (PDF p. 10).
- **Comparison:** "pp. 2 to 4" is correct.
- **Edit needed:** none.

## 9. S-23: Avalo. Hyphen CONFIRMED; the paper's en dash is WRONG

- **File:** s7202618-881799-2686595.html, a web comment.
- **Docket listing:** It is listed as "Chris Sullivan, CFO of Avalo Therapeutics", **June 24, 2026** (docket index row on listing page 6).
- **Letter text:** "We estimate the costs of implementing and maintaining 404b to be between $500-$1M annually." The character after 500 is an ASCII hyphen-minus (verified with `od`).
- **No pages:** It is a web page, so "p. 1" has no basis.
- **Date:** The paper does not print a date, so no edit is needed there. Any tracker or register entry should read June 24, not June 21.
- **Edit needed (so_v2.py l.342–344):**
  - Current: `"Avalo Therapeutics (p. 1)"` → Replacement: `"Avalo Therapeutics (web comment)"`
  - Current: `"“between $500–$1M annually”"` → Replacement: `"“between $500-$1M annually”"`

## 10. C-10: CohnReznick. CONFIRMED

- **File:** s7202618-968599-3005346.pdf. Its footers read "Page x of 4".
- **Support for the proposal** (p. 1): "We support the proposal overall."
- **Market decides** (p. 2): "where investors, lenders, underwriters, or other market participants want an ICFR attestation, they can demand it and allocate capital accordingly. In that sense, the decision for most issuers to obtain a 404(b) attestation should largely be market driven rather than uniformly mandated."
- **Lower line** (p. 3, Recommendations): "Consider a lower threshold than $2 billion in public float for large accelerated filer status to scope in more issuers into the 404b ICFR requirement, and/or · Consider a sunset provision after 5 years, or another timeframe …"
- **Comparison:** The paper's "Make the attestation a choice for most issuers. Even the one supporter suggested the SEC consider a line below $2 billion." is accurate.
- **Edit needed:** none.
  - Optional, for completeness: `"consider a line below $2 billion.</b>"` → `"consider a line below $2 billion, or a sunset review.</b>"`

## 11. S-24 / C-11: "Seven firms said the financial statement audit will absorb part of the work". CONFIRMED (7)

| Firm | Says it? | Evidence |
|---|---|---|
| PwC | Yes | Already confirmed from the firm's own copy (Q20: "may ultimately deliver less cost savings than anticipated") |
| EY | Yes | Already confirmed, p. 4 |
| BDO | Yes | Already confirmed, pp. 4–5 |
| RSM (Jul 17) | Yes | p. 2, Q20: "while some efficiencies may be realized, a significant portion of the audit effort would remain. Further, in the absence of control reliance, auditors would be required to increase substantive testing". p. 4, Q41: "auditors will continue to need to perform control-related procedures in many engagements". |
| Deloitte | Yes | p. 4: "the reductions in audit effort that some may anticipate with exemption from an audit of ICFR may be partially offset by work required for a standalone financial statement audit. Auditors are required to evaluate the design and implementation of controls … where an auditor previously relied on controls … it would likely need to increase substantive testing." |
| KPMG | Yes | p. 4 of 6: "the resulting decrease in overall audit effort and costs would likely be limited because auditors would continue to perform procedures responsive to financial reporting risks, including testing internal controls when appropriate. Consequently, exempting companies from the auditor attestation requirement would not eliminate all, or even most, control-related audit procedures". |
| Baker Tilly | Yes | p. 2 of 4: "exempting additional issuers from Section 404(b) will not eliminate all internal control-related audit work. Auditors must continue to understand relevant controls and, in some circumstances, test controls … When auditors do not rely on controls, additional substantive procedures may be necessary … the cost savings … may be less than the reduction in ICFR attestation fees alone would suggest". |
| CohnReznick | No (borderline) | pp. 2–3: "For financial statement only audits, PCAOB standards already require a robust risk assessment, and allow for testing of controls and … require tests of controls." This is argued for audit quality, not cost, so it is not counted. |
| Crowe | No | p. 1: "relief from Section 404(b) auditor attestation will reduce compliance costs for most, although we observe that the magnitude and distribution of those savings will vary." |
| GT | No | It gives only GAO cost figures (PDF p. 3). |
| CBIZ | No | p. 3: "While cost savings from exemption are real …" |
| RSM (Oct 7) | n/a | This letter does not address the point. |
| Connor (advisory) | No | — |

- **Count:** 7 (PwC, EY, BDO, RSM, Deloitte, KPMG, Baker Tilly). All seven are audit firms.
- **Edit needed:** none on the count. Optional precision, because most letters hedge ("may be partially offset", "would likely be limited", "may be less"):
  - l.312–313: `"Seven firms said the financial statement audit will absorb part of the work"` → `"Seven audit firms said the financial statement audit would absorb part of the work"`
  - l.616: `"seven firms told the SEC the financial statement audit will absorb part of the work."` → `"seven audit firms told the SEC the financial statement audit would absorb part of the work."`

## 12. C-12: "Ten of the 11 audit firms questioned a flat 60-month on-ramp". CONFIRMED (10 of 11)

The 11 firms, per fc_C C-01, are Deloitte, PwC, EY, KPMG, RSM, Baker Tilly, BDO, CBIZ, GT, Crowe and CohnReznick.

| Firm | Questions flat 60 months? | Evidence |
|---|---|---|
| Deloitte | Yes | p. 3: "the proposed 60-month on ramp for companies undertaking an initial public offering ("IPO") could greatly increase the amount of investor capital exempt … companies can enter the market with public floats well in excess of $2 billion and yet under the Proposal have substantial exemptions for 5 years." |
| KPMG | Yes | p. 5 of 6: "A shorter seasoning period (e.g. two or three years) or alternatively, establishing disqualifying criteria, such as a revenue and/or debt criteria like those used for exiting EGC status, may be appropriate". p. 6: "whether the proposed five year seasoning period appropriately balances …". |
| GT | Yes | PDF p. 4: "We recommend that the SEC consider whether certain disqualification provisions (such as those currently included for EGCs) are necessary for larger issuers … mega-cap initial public offerings". |
| CBIZ | Yes | p. 5: "A second alternative would be to shorten the proposed 60-month seasoning period … The Commission could also consider a trigger-based approach". |
| Crowe | Yes | p. 4: "Because the proposal applies a uniform 60-month seasoning period … a company that enters the public markets at several multiples of the proposed large accelerated filer threshold would receive the same five-year deferral". p. 5: "consider whether a uniform 60-month on-ramp is appropriately calibrated". |
| Baker Tilly | Yes | p. 3 of 4: "we believe a uniform 60-month seasoning period is not well matched to companies that enter the public markets with public float materially above the LAF threshold … a separate five-year seasoning period is not necessary". |
| RSM | Yes | Jul 17, p. 4: "we believe the proposal should incorporate disqualifying thresholds similar to those applicable to EGCs". Oct 7, p. 2: a seasoning period of two consecutive years "rather than the proposed 60-month seasoning period". |
| PwC | Yes | Already confirmed from the firm's own copy (24 months) |
| EY | Yes | Already confirmed ("may be unnecessary") |
| BDO | Yes | Already confirmed ("too long"; 2 years) |
| CohnReznick | No | p. 2: "We also agree that the Commission should provide an on-ramp before issuers become subject to the most extensive reporting obligations." It does not challenge the length. |

- **Count:** 10 of 11. Every firm was checked from primary text: eight from the SEC copies here, and PwC, EY and BDO from the firms' own copies (C-11). None remains unchecked. The SEC copies of PwC, EY and BDO are not in this set.
- **Related tile:** "0 of 11 … 10 of them questioned the five-year on-ramp" (l.47–48) is CONFIRMED.
- **Edit needed:** none.

## 13. C-05 to C-08. All CONFIRMED

**C-05: of the 12, nine said too broad, two no side, one supported.**

- **Too broad (9):**
  - Deloitte, p. 3: "the Commission should also consider the risk that the extent of the rollback contemplated by the Proposal is too broad."
  - KPMG, p. 4: "not all companies that would become non-accelerated filers under the Proposal should be excluded from Section 404(b)."
  - Baker Tilly, p. 2: "the proposed $2 billion public-float threshold would classify certain relatively mature, complex, and widely held companies as NAFs … public float alone may not adequately distinguish issuers".
  - CBIZ, p. 1: "defer independent auditor involvement in [ICFR] too broadly and for too long".
  - Crowe, pp. 3–4: proposes ~$1.1bn.
  - Connor, PDF pp. 1, 6 and 9: "the broad exemption"; retain 404(b) after a material weakness.
  - PwC, RSM and BDO: already confirmed.
- **No side (2):**
  - GT, PDF p. 4: "We recommend the Commission perform further outreach with investors to determine whether the proposed reduction … would serve investors' best interest".
  - EY: already confirmed.
- **Supported (1):** CohnReznick, p. 1: "We support the proposal overall."

**C-06: none endorsed the $2bn line as drawn.**

- CohnReznick, the only supporter, makes its "principal recommendation" (pp. 1 and 4) that the SEC "evaluate whether that is the right threshold" and "Consider a lower threshold than $2 billion" (p. 3).
- Crowe asks for economic support "to the extent the Commission concludes that $2 billion is preferable" (p. 4). That is not an endorsement.
- No other firm endorses $2bn.

**C-07: the five named fixes, all confirmed.**

| Fix | Firm | Source |
|---|---|---|
| >$700M | PwC | Already confirmed |
| ~$1.1bn | Crowe | p. 3: "estimated threshold of approximately $1.1 billion"; p. 4 |
| Inflation adjustment | RSM | Jul 17, p. 3: "we support the inflation adjustment of thresholds for ICFR auditor attestation" |
| $1.235bn revenue limit | CBIZ | p. 4: "a company would need to have a public float of less than $2 billion AND revenue of less than $1.235 billion" |
| Keep after a recent material weakness | Connor | PDF p. 6: "exclude from the 404(b) exemption any registrant that has disclosed a material weakness in its ICFR in any of the three fiscal years preceding its reclassification" |

- The paper says "after a recent material weakness". It does not mention restatements, which is correct, because Connor ties the fix to material weaknesses only.

**C-08: the refreshed PCAOB guidance comes from Deloitte**, in the "no number" row.

- Deloitte, p. 4: "there may be an opportunity to consider if input from regulators in the intervening years (including through the PCAOB inspection program) and other external factors have driven changes in the approach to audits of ICFR such that refreshed guidance from the PCAOB focused on the importance of balancing efficiency and effectiveness is warranted."
- **The rest of the row:**
  - "A test that looks past public float alone": Baker Tilly, p. 2.
  - "A second look at how many companies fall out": KPMG, p. 4 ("further evaluate how best to calibrate the population"); Deloitte, p. 3.
- **Other PCAOB asks, not this item:**
  - CohnReznick (the supporter row) also asks the PCAOB for "targeted reminders" under AS 2710 / AI 20 and "additional PCAOB guidance in this area" (p. 4). That concerns other information and management's report, not the conduct of ICFR audits.
  - KPMG asks the Commission, not the PCAOB, for "investor education, interpretive guidance, or supplemental disclosure".

**Edit needed:** none.

## 14. Late letters (posted October 5 to 8)

**RSM, October 7** (s7202618-1087339-3795249.pdf, 6 pp.)

- **What it is:** an addition to the July 17 letter ("incremental to our comments in our letter dated July 17, 2026").
- **What it asks:**
  - p. 2: deem a registrant a large accelerated filer (LAF) upon either:
    - meeting the float threshold, with seasoning equal to the two-year float test "rather than the proposed 60-month seasoning period"; or
    - revenue of "$1.235 billion or more (or another revenue amount, such as one adjusted for inflation since the EGC threshold was established)".
  - The remaining pages are FASB and PBE-definition asks: broker-dealers, private company alternatives, and transition relief for 3-05/3-09 financial statements.
- **Effect:** It does not change RSM's position. RSM stays "too broad, named fix", questions the on-ramp (already counted) and says nothing new on absorption. The 9/2/1, 5/4/2/1, "0 of 11", "10 of 11" and "seven" counts are unchanged.
- **Side effects if the letter were counted** (it is outside the October 5 snapshot):
  - A second firm would back a $1.235bn revenue limit.
  - The §5 count of "13 proposed a revenue test" could rise by one, because RSM's July letter had no revenue test.
- **Edit needed:** none. The Exhibit 4 source note, "an audit firm already counted", is accurate.

**Paul Schumacher, October 8** (s7202618-1087779-3798686.pdf, 19 pp.)

- **Who:** an individual and former PCAOB Associate Director, Risk Analysis.
- **Position:** too broad, not support. p. 1 of 19: "I would support relief for companies of limited complexity, but I am generally opposed to removing the auditor's ICFR opinion for the registrants the Proposal would newly exempt without first assessing each issuer's risk." p. 2: "I would consider modified thresholds for companies with limited complexity."
- **His proposed structure:**
  - Exempt below a "Test Value" of $150M (Test Value = the greater of float and 60% of market capitalization).
  - Subject at $2bn or more.
  - In between, subject if revenue exceeds $250M and a risk indicator is met.
  - 24-month seasoning instead of 60.
- **Effect if counted:** individuals' "too broad" would rise by 1.
- **Third-party count:** He counted "177 substantive comment letters (the 191 docket entries, less seven SEC meeting memoranda and seven duplicate, blank or non-position entries)". The base differs from the paper's.

**Olema, October 5** (s7202618-3784787.htm): **supportive, CONFIRMED.**

- Text: "urge the Commission to adopt the proposed amendments … substantially as proposed, including the increase in the public-float threshold … from $700 million to $2 billion, along with the resulting Section 404(b) relief".
- Cost figures: about $300,000 (excluding internal FTE costs); $750,000 heard from other CFOs.
- The docket lists the signer as "O'Bryne"; the letter is signed "O'Byrne".

**Optional edit (so_v2.py l.268–269):**

- Current: `"from a biotech CFO in support, an audit firm already counted and one other."`
- Replacement: `"from a biotech CFO in support, an audit firm already counted and a former PCAOB staff member who called the exemption too broad."`

## 15. Roundtable transcript (July 13). CONFIRMED, with a nuance

- **File:** s7202617-1035579-3441226.pdf, 89 pp.
- **Listing:** It appears on the S7-2026-18 listing (listing page 5, row 25, "Public Comment", July 13, 2026). The link is https://www.sec.gov/comments/CLL-16/s7202617-1035579-3441226.pdf, under an S7-2026-17 file name.
- **What it is:** an SEC staff event, "Rethinking the Rulebook: Modernizing the IPO Process and Access to Public Capital". It was hosted by the Office of the Advocate for Small Business Capital Formation and the Division of Corporation Finance, with panelists from Cantor, Simpson Thacher, NYSE, Fenwick and OTC Markets.
- **Scope:** It is not specific to this docket. It covers the registered offering, filer status and semiannual proposals (transcript p. 8: "registered offering form, filer status, as well as semiannual reporting"). The filer-status discussion starts at transcript p. 32, and 404(b) attestation costs are discussed around pp. 43–45.
- **Comparison:** The paper's "Setting aside SEC staff memoranda, a roundtable transcript and duplicates" (l.262–263) is accurate.
- **Edit needed:** none.

## 16. Society for Corporate Governance survey figures

Skipped; the letter is not in this set.

---

## Summary

| # | Item | Verdict | Page (printed unless "PDF") | Edit |
|---|---|---|---|---|
| 1 | S-15 Nasdaq quote | CONFIRMED | p. 4 | None |
| 2 | S-16 OPERS quote, quote marks, en dash | CONFIRMED | p. 9 ("Page 9 of 11") | None (optional: single inner quotes) |
| 3 | S-17 Dambra quote and cut | CONFIRMED | PDF p. 2 | None |
| 3 | S-17 Dambra characterisation | PARTLY WRONG | PDF pp. 2–5 | Yes: "supports the proposal, including the five-year on-ramp, while warning that the wider exemption is “not costless”" |
| 4 | S-18 Linklaters quote and authorship | CONFIRMED | p. 2 ("Page 2 of 5") | None |
| 5 | S-19 Connor "formalism" | CONFIRMED | PDF p. 3 | None |
| 6 | S-20 AAA "about half" | CONFIRMED: Financial Reporting Policy Committee (not the Auditing Standards Committee) | p. 7 | None (optional: committee's full name) |
| 7 | S-21 Crowe quote; "preferred line" = ~$1.1bn | CONFIRMED | p. 4 (and p. 3 for $1.1bn) | None |
| 8 | S-22 12.8 / 8.5 / 3.8%; 4–6 vs 12 analysts | CONFIRMED | PDF pp. 2, 3–4 | None |
| 9 | S-23 Avalo wording | WRONG (hyphen, not en dash); "p. 1" has no basis; the SEC dates it June 24 | web page | Yes: `$500-$1M`; "(web comment)" |
| 10 | C-10 CohnReznick: market-driven and below $2bn | CONFIRMED | pp. 2, 3 | None |
| 11 | S-24 / C-11 "seven firms … absorb" | CONFIRMED: PwC, EY, BDO, RSM, Deloitte, KPMG, Baker Tilly | Deloitte p. 4; KPMG p. 4; BT p. 2; RSM pp. 2, 4 | Optional: "seven audit firms … would absorb" |
| 12 | C-12 "ten of the 11 … 60-month" | CONFIRMED 10/11; CohnReznick is the exception; all 11 checked | various | None |
| 13 | C-05 9/2/1 | CONFIRMED | — | None |
| 13 | C-06 none endorsed $2bn | CONFIRMED | — | None |
| 13 | C-07 five fixes | CONFIRMED (Connor's fix is a material weakness in the prior 3 years, PDF p. 6) | — | None |
| 13 | C-08 refreshed PCAOB guidance | CONFIRMED: Deloitte | p. 4 | None |
| 14 | RSM, Oct 7 | Adds $1.235bn revenue / two-year seasoning; no change to RSM's bucket or any count | p. 2 | None |
| 14 | Schumacher, Oct 8 | Too broad ("generally opposed … without first assessing each issuer's risk") | p. 1 of 19 | Optional source-line wording |
| 14 | Olema, Oct 5 | Supportive, CONFIRMED | web page | None |
| 15 | Roundtable transcript on the docket | CONFIRMED: listed on S7-2026-18; SEC staff roundtable covering three proposals, including filer status | — | None |
| 16 | SCG survey | Skipped | — | — |
