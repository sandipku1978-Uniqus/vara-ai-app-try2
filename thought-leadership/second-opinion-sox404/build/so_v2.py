# -*- coding: utf-8 -*-
"""The Second Opinion: SOX 404 Before, Now and After — v2 content module.

Rebuilt from the October 2026 PDF. Changes from v1 are marked `# v2:` so the
review log can be traced to the text.
"""
import html_ex as X

META = dict(
    title="The Second Opinion",
    title_lines=["The Second Opinion"],
    subtitle_lines=["The SEC proposes to stop requiring the auditor's opinion on internal control",
                    "for 1,596 companies. We review every comment letter and what may come next."],
    date="October 2026",
    kicker="Insights",
    strap="SOX 404: Before, Now and After",
    footer="The Second Opinion | SOX 404: Before, Now and After",
)

NAV = ["Executive Summary", "1. How Section 404 Evolved", "2. What the SEC Proposed",
       "3. What the SEC Heard", "4. Two Questions Left Open",
       "5. How the Final Rule Could Change", "6. Capital Markets and the Mid-Market",
       "7. Actions Before a Final Rule", "How Uniqus Can Help"]

# --------------------------------------------------------------- facts
# One number, one value, everywhere: every repeated figure is defined once.
F = dict(
    exempt="1,596", exempt_pct="26.7%", laf_now="2,115", laf_new="1,146",
    laf_pct_now="35.4%", laf_pct_new="19.2%", float_new="93.5%",
    exempt_laf="964", exempt_af="632",
    entries="192", commenters="174", addressed="117", silent="57",
    oppose="80", support="31", nopos="6", toobroad="33", dne="47",
)


def blocks(H):
    P = ['<div class="cover"></div>']

    # ================================================= Executive summary
    P.append(H.sec(0, V2CSS +
        H.h1("Executive Summary") +
        H.tiles([
            (F["exempt"], "Registrants the SEC estimates would be newly exempt from the auditor's "
                          "attestation on internal control: %s of all registrants" % F["exempt_pct"]),
            ("80 of 117", "Commenters addressing the attestation who called the exemption too broad "
                          "(16 in guarded terms) or said it should not be expanded"),
            ("0 of 11", "Audit firms commenting that endorsed the $2 billion threshold as proposed; "
                        "10 questioned the five-year on-ramp"),
            ("58 of 75", "Commenters addressing the five-year on-ramp who rejected or questioned a "
                         "uniform 60 months"),
        ]) +
        H.p("Many finance leaders have read the SEC's filer status proposal of May 19, 2026 (Release No. "
            "33-11419, <em>Enhancement of Emerging Growth Company Accommodations and Simplification of Filer "
            "Status for Reporting Companies</em>) as a cost saving. The large accelerated filer threshold "
            "would rise from $700 million to $2 billion of public float, every new registrant would have "
            "five years of seasoning, and the auditor's opinion on internal control would no longer be "
            "required for <b>%s companies</b>." % F["exempt"]) +
        H.p("The public comment record suggests the matter is less settled. It holds %s entries from <b>%s "
            "distinct commenters</b>, and this paper draws on a review of each one. We trace how Section "
            "404 reached this point, summarize what the SEC has heard, and consider what finance leaders "
            "may wish to do before a final rule." % (F["entries"], F["commenters"])) +
        H.qa("First, how has Section 404 evolved, and what has it delivered?",
             ["The requirement was put in place between 2002 and 2005 and has been scaled or narrowed four "
              "times since; the proposal would be the fifth. The $700 million threshold set in 2005 has not "
              "moved; it captured 18% of companies on US markets at adoption and captures <b>35.4% of "
              "registrants</b> today. "
              "Over the same period restatements fell, and the SEC staff concluded from the research that "
              "auditor testing brought out control deficiencies management had not disclosed, though neither can be "
              "credited to Section 404 alone."],
             ref="(Refer Section 1: How Section 404 Evolved)") +
        H.qa("Second, what did commenters tell the SEC?",
             ["Of the 117 commenters who addressed the attestation, <b>80 said the exemption is too broad "
              "or should not be expanded</b>, 16 of them in guarded terms, and 31 supported it or sought a wider one.",
              "Views split by constituency. Every company, both exchanges and every business trade association "
              "that took a side supported the exemption. No accounting firm endorsed the $2 billion threshold as proposed, and "
              "all 24 investors and investor advocates that addressed the exemption called it too "
              "broad or opposed any expansion."],
             ref="(Refer Sections 3 and 4: What the SEC Heard; Two Questions Left Open)") +
        H.qa("Third, where could the final rule move?",
             ["No final rule has been adopted. The comment letters suggest where it could change: the five-year "
              "on-ramp for very large new listings, a second test beside public float, and relief for companies "
              "that cross today's thresholds while the rule is pending."],
             ref="(Refer Section 5: How the Final Rule Could Change)")))
    P.append(H.cont(0,
        H.qa("Fourth, will this bring the mid-market back?",
             ["In our view, the proposal would lower the cost of staying public but do little to change the "
              "decision to go public, as most companies making that decision are already exempt. The proposing "
              "release gives no estimate of additional listings."],
             ref="(Refer Section 6: Capital Markets and the Mid-Market)") +
        H.qa("Fifth, what should finance leaders do before a final rule?",
             ["Companies may wish to confirm their status under both rule sets, base the saving on the auditor's "
              "own fee proposal, and take the retain, discontinue or replace decision to the audit committee with "
              "evidence. Section 7 sets out eight decisions for the SOX program leader."],
             ref="(Refer Section 7: Actions to Consider Before a Final Rule)") +
        H.pov("Uniqus Point of View: when management's assessment stands alone",
              paras=["Much of the comment record debates where the threshold should sit; finance leaders face a "
                     "different question. <b>Once the auditor's opinion is optional, management's assessment under "
                     "Section 404(a) becomes the only report on internal control an investor receives.</b> The "
                     "proposal changes neither that assessment nor the certifications that accompany it.",
                     "We would expect the core of the proposal to survive, with changes at the margins. Companies "
                     "below $2 billion of float that obtain the attestation today should prepare for a year "
                     "in which it becomes optional."],
              kicker="That decision rests with the audit committee, and it should be grounded in evidence before "
                     "a lender, underwriter or investor raises the question.", keep=True) +
        H.sig("Sandip Khetan", ["Co-Founder, Global Head of Accounting &amp; Reporting Consulting"]) +
        WHO(H) + BAND("band_before.png")))

    # ================================================= 1
    P.append(H.sec(1,
        H.h1("1. How Section 404 Evolved") +
        DECK("Introduced between 2002 and 2005, and scaled or narrowed four times since; the proposal would be the fifth.") +
        H.p("Section 404 has two parts. Under 404(a), management assesses internal control over financial "
            "reporting and reports its conclusion; under 404(b), the auditor attests to that assessment.") +
        H.p("The attestation has never applied to everyone, and it has been scaled or narrowed four times. "
            "In 2007 the SEC issued guidance for management and the PCAOB a risk-based audit standard; in "
            "2010 Congress exempted non-accelerated filers from the auditor's attestation by statute, after the "
            "SEC had repeatedly deferred it for them. The JOBS Act exempted emerging growth companies in 2012, and in 2020 the SEC removed issuers "
            "eligible to be smaller reporting companies with revenue under $100 million from accelerated and "
            "large accelerated filer status.") +
        EX1(H) +
        H.p("The $700 million threshold set in 2005 has not moved since; it captured 18% of companies on US "
            "markets at adoption and captures <b>35.4% of registrants</b> today. The SEC did not index it; "
            "adjusted for consumer prices the threshold would be $1.15 billion, and tracking the S&amp;P 500, "
            "$3.85 billion. Instead, the SEC chose $2 billion to restore coverage of “nearly 95 percent” of "
            "public float, and estimates that the new threshold covers 93.5%.")))
    P.append(H.cont(1,
        H.h2("1.1 What the record shows") +
        H.p("The SEC's own tables show the control record under each regime. From 2021 to 2024, management "
            "reported ineffective controls at <b>5.2%</b> of large accelerated filers, <b>15.7%</b> of "
            "accelerated filers and <b>41.8%</b> of non-accelerated filers.") +
        H.exhibit("Exhibit 2 — The control record by filer status", "x2_record.png",
                  "Source: SEC Release 33-11419, EA Tables 5, 6 and 7 (pp. 139 to 142) and EA Table 2 (p. 132), SEC staff analysis of "
                  "Audit Analytics data. Categories are 2024 filer status under the current rules. EA Tables 5 "
                  "and 6 include emerging growth companies in each column; of 757 accelerated filers, 125 are "
                  "emerging growth companies and are not subject to attestation. Restatements are those "
                  "correcting errors material to previously issued financial statements; in that table the "
                  "accelerated and non-accelerated columns exclude emerging growth companies, whose rate was "
                  "14.7% (31.4% in fiscal 2021, when restatements coincided with the SEC staff's statement on SPAC "
                  "warrants). Differences reflect company size as well as regime.") +
        H.p("Size explains part of that gradient, and the SEC reads its restatement table cautiously, noting "
            "that the rate for non-accelerated filers is “only slightly higher” than for accelerated filers and "
            "that the non-accelerated group holds more low- or zero-revenue issuers, which restate less often. "
            "The gap is widest on persistence, with <b>24.9% of non-accelerated filers reporting ineffective "
            "controls in all four years</b>, against 4.2% of accelerated filers.") +
        H.p("Where the attestation is optional, few companies obtain it; the SEC estimates that less than six "
            "percent of exempt registrants did so voluntarily in 2024.") +
        H.h2("1.2 What the second opinion has delivered") +
        H.p("Cost is only one side of the ledger; on the other, the SEC's 2011 staff study concluded that auditor "
            "testing “has generally resulted in the disclosure of internal control deficiencies” that "
            "management had not previously disclosed, and that the attestation “appears to have a positive "
            "impact on the informativeness of internal control disclosures and financial reporting "
            "quality”. The proposing release cites both findings.") +
        H.p("Restatements rose in the first three years of the Act and have declined since. The Center for Audit "
            "Quality, the audit profession's policy body, reports a 60% decline from 2006 to 2009 and a "
            "further fall from <b>858 in 2013 to 402 in 2022</b>. Ideagen Audit Analytics, counting from the "
            "same database without the Center's adjustment for blank-check companies, recorded 434 in 2023, 477 "
            "in 2024 and 391 in 2025, the second-lowest year in its 20-year database after 2020.") +
        EX3(H) +
        H.p("Those closest to the work saw value in it, though on average not enough to outweigh the cost. The proposing release says "
            "respondents to a 2008 and 2009 survey of corporate insiders found the benefits to outweigh the "
            "costs, “especially as they gained experience with section 404(b)”. The underlying study, "
            "of 2,901 insiders, is less favorable, finding that on average respondents did not judge the benefits to outweigh the costs, though "
            "perceived net benefits were higher where an auditor attested and rose with experience.") +
        H.p("Compliance costs also fell after 2007, when the PCAOB "
            "issued Auditing Standard No. 5 and the SEC issued its guidance for management.") +
        H.p("The SEC itself notes a wider benefit: Section 404(b) “may play a role in improving overall "
            "investor confidence, encouraging investment in public markets”. None of this proves cause, since "
            "the Act also created the PCAOB, audit committee independence rules and officer certifications. "
            "The proposing release also cites a 2024 working paper that found no decline in internal control or "
            "financial reporting quality at issuers exempted in 2020, and says auditor testing “may have fewer "
            "benefits” at the larger companies now affected.") +
        H.p("What the record does show is what would be given up: <b>an independent test that, "
            "in the research the SEC staff reviewed in 2011, brought out deficiencies management had not "
            "disclosed.</b> That study covered companies with $75 million to $250 million of float and "
            "recommended against widening the exemption.")))

    # ================================================= 2
    P.append(H.sec(2,
        '<img src="band_now.png" class="band"/>' +
        H.h1("2. What the SEC Proposed") +
        DECK("A $2 billion threshold, a five-year seasoning period, and no auditor's opinion below either.") +
        H.table(["Element", "Today", "Proposed"], [
            ["<b>Large accelerated filer threshold</b>",
             "$700 million of public float", "<b>$2 billion</b> of public float"],
            ["<b>How float is measured</b>", "Share price on the last business day of the second fiscal quarter",
             "Average closing price over the last 10 trading days of that quarter, times non-affiliate "
             "shares at quarter end"],
            ["<b>Moving in or out</b>", "One measurement; exit below $560 million for large accelerated status "
             "and $60 million for accelerated status, or on qualifying under the revenue test", "Two consecutive years above or below the threshold; no "
             "separate exit level"],
            ["<b>Seasoning before the status applies</b>", "12 months of reporting",
             "<b>60 months</b>, whatever the company's size"],
            ["<b>Management's assessment, 404(a)</b>", "Required of all", "<b>Unchanged</b>"],
            ["<b>Foreign private issuers on Form 20-F</b>", "Attestation from $75 million of float", "<b>Unchanged</b>: "
             "$75 million of worldwide float, measured on a single day"],
        ], widths=[27, 36, 37]) +
        H.p("Under the proposal, status would change only after two years on the same side of the threshold. "
            "For example, a calendar-year company with 60 months of reporting whose float first reaches "
            "$2 billion on June 30, 2027 would not be a large accelerated filer for fiscal 2027, but would "
            "become one for fiscal 2028 if its float is still $2 billion or more on June 30, 2028; a large "
            "accelerated filer would likewise need two years below $2 billion to leave, with no lower exit "
            "level like today's $560 million. The transition is the exception: when a final rule takes effect, "
            "a current large accelerated filer below $2 billion in either of the two prior years becomes "
            "non-accelerated.") +
        H.h2("2.1 The filer categories, today and under the proposal") +
        H.p("Filer status determines three things: how fast a company must file, how much it must disclose, and "
            "whether its auditor attests to internal control. Today five overlapping categories can apply. The "
            "proposal would keep two main categories, large accelerated and non-accelerated, and add a "
            "sub-category for the smallest companies.") +
        H.table(["Category", "Who it is today", "What it carries today", "Under the proposal"], [
            ["<b>Large accelerated filer</b>", "Public float of $700 million or more at the end of the second "
             "quarter; 12 months of reporting; one annual report filed; not eligible as a smaller reporting "
             "company on the revenue test", "10-K in 60 days, 10-Q in 40; auditor's attestation; full disclosure",
             "<b>$2 billion or more</b> at each of the last two second-quarter ends and 60 months of reporting; "
             "obligations unchanged"],
            ["<b>Accelerated filer</b>", "Float of $75 million to under $700 million, with the same other conditions",
             "10-K in 75 days, 10-Q in 40; attestation unless an emerging growth company",
             "<b>Eliminated</b>; becomes non-accelerated"],
            ["<b>Non-accelerated filer</b>", "Not defined in the rules: every other registrant",
             "10-K in 90 days, 10-Q in 45; no attestation", "Any issuer that is not large accelerated; same "
             "deadlines; <b>no attestation</b>; scaled disclosure, with some exceptions; must disclose material "
             "unresolved staff comments, which is new for them"],
            ["<b>Smaller reporting company</b>", "Float under $250 million, or revenue under $100 million with "
             "float under $700 million", "Scaled disclosure: two years of financial statements and MD&amp;A "
             "instead of three, lighter executive pay disclosure", "<b>Eliminated</b>; its accommodations pass "
             "to non-accelerated filers"],
            ["<b>Emerging growth company</b>", "Revenue under $1.235 billion, for up to five years after IPO",
             "No attestation; scaled disclosure; deferred adoption of new accounting standards",
             "Retained by statute; the SEC expects reliance on it to be unnecessary in most circumstances. Only "
             "emerging growth companies keep confidential draft registration statements and the exemption from "
             "critical audit matters"],
            ["<b>Small non-accelerated filer</b>", "Does not exist", "Not applicable",
             "<b>New</b>: total assets of $35 million or less on the last day of the second fiscal quarter in "
             "each of the last two years, ending once assets exceed $35 million at both; 10-K in 120 days, "
             "10-Q in 50. The SEC estimates 1,072 companies"],
        ], widths=[17, 28, 26, 29]) +
        H.note("Source: SEC Release 33-11419, pp. 9 to 13, 20 to 21, 28 to 33, 37 to 48, 55 to 56, 61, 66 to 69, 81 "
               "to 84, 87 to 88, 96 and 103 to 106. Smaller reporting and emerging growth status sit on top of the other categories today. "
               "Public float is the market value of common equity held by non-affiliates.") +
        H.p("A change of status therefore affects more than the attestation. A large accelerated filer that "
            "becomes non-accelerated gains 30 days on its Form 10-K and five on its Form 10-Q, may present two "
            "years of financial statements where it now presents three, and would be exempt from say-on-pay, "
            "say-on-frequency and golden-parachute votes, an emerging growth company accommodation the SEC "
            "proposes to extend to all non-accelerated filers.") +
        H.p("It could also omit risk factors from Forms 10-K "
            "and 10-Q, market risk disclosure, the compensation discussion and analysis, pay ratio and pay "
            "versus performance. The option to defer new accounting standards to private-company dates is "
            "limited to a filer's first five years after registration, so most large accelerated filers that "
            "change status would not have it.") +
        H.p("The SEC estimates that large accelerated filers would fall from %s to %s, or from %s to %s of "
            "registrants, while still holding %s of public float. In all, <b>%s registrants</b>, 60%% of those "
            "that obtain an attestation today, would be newly exempt, comprising %s current large accelerated "
            "filers and %s accelerated filers. The SEC could not classify the other five of today's 2,115 large "
            "accelerated filers because their float data is missing."
            % (F["laf_now"], F["laf_new"], F["laf_pct_now"], F["laf_pct_new"], F["float_new"], F["exempt"],
               F["exempt_laf"], F["exempt_af"])) +
        H.p("Two groups gain less than the headline suggests. Banks are counted in the 1,596, but an insured "
            "bank with $5 billion or more of total assets remains subject to the FDIC's attestation requirement "
            "under 12 CFR Part 363, a threshold in effect since January 1, 2026. The FDIC rule applies to the "
            "bank, not the holding company, so a holding company that discontinues the attestation may still need one "
            "for its bank; the SEC estimates that 87 of 153 banking large accelerated filers "
            "would become non-accelerated.") +
        H.p("Foreign private issuers filing on Form 20-F or 40-F remain outside "
            "the new categories and retain today's $75 million trigger, measured on a single day.") +
        CAL(H)))

    # ================================================= 3
    P.append(H.sec(3,
        H.h1("3. What the SEC Heard") +
        DECK("The letters divide between those who pay for assurance and those who rely on it or provide it.") +
        H.p("On October 5, 2026, the docket held %s entries, the latest dated September 8, 2026. Excluding SEC staff "
            "memoranda, a roundtable transcript and duplicates leaves <b>%s distinct commenters</b>, of whom "
            "%s addressed the attestation and %s did not mention it."
            % (F["entries"], F["commenters"], F["addressed"], F["silent"])) +
        H.exhibit("Exhibit 4 — Where 117 commenters stood on the attestation exemption", "x4_positions.png",
                  "Source: Uniqus coding of every entry on SEC comment file S7-2026-18 as posted on October 5, "
                  "2026; the method is set out in “How we reviewed the letters”. Not counted: three letters posted October 5 "
                  "to 8, 2026, from a biotech CFO in support, an audit firm already counted that restates its position, and a former PCAOB staff member who calls the exemption too broad. "
                  "The 6 with no position are business associations 1, venture capital and "
                  "policy groups 2, academics 2 and individuals 1. The Texas Society of CPAs letter could not be "
                  "opened on the docket and was read from the society's website. “Too broad” means the "
                  "commenter accepts some widening of the exemption and objects to its extent; 16 of those 33 "
                  "say so in guarded terms. Positions are on the exemption, not on the $2 billion figure.") +
        H.p("Support came mainly from those who bear the cost: companies, their associations, both "
            "exchanges and most securities lawyers who commented. Opposition was led by investors and "
            "individual commenters, joined by academics and most of the firms and professional bodies that "
            "provide assurance. Among investors and investor advocates, <b>all 24</b> that addressed the "
            "attestation called the exemption too broad or opposed any expansion.") +
        H.p("The middle ground is more informative than either end. Thirty-three commenters accepted that the "
            "threshold should rise but objected to its extent; 26 proposed another threshold or test.")))
    P.append(H.cont(3,
        H.h2("3.1 The audit profession's positions") +
        H.p("Eleven of the twenty largest US accounting firms, ranked by revenue in the 2026 INSIDE Public "
            "Accounting list, commented, including the four largest, as did one advisory firm that does not audit; "
            "the other nine did not, nor did the AICPA in its own name, the Institute of Internal "
            "Auditors, Financial Executives International or the Institute of Management Accountants. <b>Read on "
            "what each letter leads with, nine of the twelve said the exemption is, or may be, too broad, two "
            "asked for more evidence and one would leave the choice to the market; none endorsed the $2 billion "
            "threshold as proposed.</b> Exhibit 4 counts all twelve as too broad, as those "
            "three also seek a narrower exemption.") +
        H.table(["What they told the SEC", "How many", "What they asked for, and what it means for you"], [
            ['<b style="color:#482879">The threshold is too high; an alternative is named.</b>',
             "Five: four audit firms and the advisory firm",
             "Each named an alternative: retain today's $700 million threshold; a threshold of about "
             "$1.1 billion; inflation-adjusted thresholds; a revenue limit of $1.235 billion beside "
             "float; or retention after a recent material weakness. <b>If the SEC adopts any, some "
             "companies with $700 million to $2 billion of float would keep the attestation.</b>"],
            ['<b style="color:#482879">The exempt group may be too wide; no number is named.</b>',
             "Four audit firms", "A second look at the number of companies exempted, a test beyond public "
             "float alone, and refreshed PCAOB guidance on auditing internal control, not on the PCAOB's "
             "September 30, 2026 standard-setting agenda. <b>Even firms with no "
             "alternative question the breadth, adding weight to a second test beside float.</b>"],
            ['<b style="color:#482879">The evidence is not yet sufficient to decide.</b>', "Two audit firms",
             "Consult investors first, and revise the cost estimate to include control work auditors must "
             "still perform. <b>The SEC's estimated saving may be overstated.</b>"],
            ['<b style="color:#482879">The market should decide.</b>', "One audit firm",
             "Make the attestation optional for most issuers. <b>Even this supporter suggested the SEC "
             "consider a threshold below $2 billion.</b>"],
        ], widths=[22, 17, 61]) +
        H.h3("Three points from the firms' letters that bear on planning") +
        H.ul(["<b>The net saving may be smaller than the fee suggests.</b> Seven audit firms said the financial "
              "statement audit would absorb part of the work, as auditors must still understand controls and "
              "often test them or do more substantive work.",
              "<b>Five years may be too long for very large new listings.</b> Ten of the eleven audit firms "
              "questioned a flat 60-month on-ramp.",
              "<b>Fewer firms may retain the capability.</b> One firm estimates, “based on current data”, that only "
              "six firms would likely perform integrated audits for ten or more issuers."]) +
        H.prac("How we reviewed the letters", [
            "<b>Approach.</b> Every letter was coded twice, independently, with AI under the direction of "
            "Uniqus professionals, and every difference was resolved by a third reading of the letter. Each "
            "code rests on a quoted passage. Every quotation was checked against the page of "
            "the filed letter.",
            "<b>What is counted.</b> Each distinct filer counts once, including a letter with 115 signatories, "
            "most of them academics, and a joint letter from 49 organizations. A position reflects only what a "
            "letter says about the attestation; one that never mentions Section 404(b) is recorded as silent."], long=True)))

    # ================================================= 4
    P.append(H.sec(4,
        H.h1("4. Two Questions Left Open") +
        DECK("What the exemption may save, and how investors may respond.") +
        H.h2("4.1 The likely cost saving") +
        H.p("The SEC's proposal cannot isolate the attestation fee, because companies disclose only total "
            "audit fees. Its estimate instead rests on <b>$202,500 of outside cost and 375 internal hours</b> "
            "per annual report, a 2020 figure adjusted for inflation.") +
        H.p("Issuers that commented put the figure higher. One listed company cited by Nasdaq and one biotech "
            "CFO each put it at $500,000 to $1 million a year, a range spanning the two highest estimates in "
            "the proposing release, "
            "$759,000 and $800,000. A governance association's member survey points the same way.") +
        H.exhibit("Exhibit 5 — The SEC's estimate and companies' estimates", "x5_cost.png",
                  "Source: SEC Release 33-11419, pp. 153 to 155, 215 and 218, including GAO-25-107500; comment "
                  "letters of Nasdaq, Inc. (p. 4), Avalo Therapeutics (web comment) and the Society for Corporate "
                  "Governance (p. 7; its member survey “attracted nearly 50 responses”, p. 1, note 1). The CFO's letter reads "
                  "“between $500-$1M annually”. In the survey, 21% of respondents put the annual cost "
                  "at $500,000 to $1 million and 18% at $1 million to $5 million; among those expecting to become "
                  "exempt, 23% and 8%. The release also cites estimates on other bases, from $73,165 in audit fees "
                  "for companies under $300 million of market capitalization to approximately $800,000 all-in for "
                  "a sample of four to seven biotech companies. GAO measured a median rise of $219,000 (13%) in "
                  "the year companies began the attestation and treats it as a proxy for its cost. The SEC's figure is an "
                  "average across registrants and the companies' figures are individual reports, so the exhibit "
                  "shows a gap between them, not an error in either.") +
        H.p("The same survey suggests that the saving companies expect is smaller than the cost they report. "
            "<b>Taken together, its two highest cost bands put the attestation's cost at $500,000 or more a "
            "year for 39% of respondents, yet only 3% expect non-accelerated status to save them more than "
            "$500,000</b>, while 55% could not quantify the saving at all (pp. 6 and 7).") +
        H.p("Neither set of figures answers the controller's central question, which is what the financial "
            "statement audit will cost once the auditor no longer tests controls for a separate opinion. <b>In "
            "our view, only a company-specific fee proposal can answer it.</b>") +
        H.h2("4.2 How investors may respond") +
        H.p("Opposing commenters argue that investors will price the missing attestation into a higher cost of "
            "capital. The figures they cite trace largely to one 2009 study that measured how the cost of "
            "equity moved when auditor-tested reports showed controls weakening or being remediated; it did "
            "not study the removal of the auditor's opinion. The only study we found in the comment letters "
            "that measured the cost of capital after an actual exemption, of issuers with revenue under $100 "
            "million in 2020, found no significant difference; the SEC cites the same study on reporting "
            "quality.") +
        H.p("Companies appear undecided too. In the same survey, 12% of respondents said they would likely "
            "retain the attestation voluntarily and 15% were confident they would discontinue it; <b>52% said "
            "it would depend on investor demand.</b>") +
        H.compare("Nasdaq, Inc., comment letter, p. 4",
                  ["<em>“One listed company estimated that it spent between $500,000 and $1 million annually "
                   "with independent auditors to comply with this disclosure obligation and observed that such "
                   "expenses could be better deployed on research &amp; development.”</em>"],
                  "Ohio Public Employees Retirement System, comment letter, p. 9",
                  ["<em>“Without an independent “gatekeeper,” management's assessment is inherently "
                   "less credible – in effect, investors are being asked to trust the numbers with one fewer "
                   "check on the system that produced them.”</em>"]) +
        H.objective("In our view, both can be true. The first speaks to the attestation's cost; the second, to "
                    "its purpose.") +
        BAND("band_after.png")))

    # ================================================= 5
    P.append(H.sec(5,
        H.h1("5. How the Final Rule<br/>Could Change") +
        DECK("The Commission may adopt the proposal as written. If it changes course, the comment letters "
             "suggest where.") +
        H.exhibit("Exhibit 6 — Alternative thresholds and the companies that would remain in scope", "x6_line.png",
                  "Source: SEC Release 33-11419, p. 42 (inflation-adjusted and S&amp;P 500-proportionate lines) and "
                  "EA Table 13, p. 207; Uniqus coding of comment file S7-2026-18 for the 51 commenters that "
                  "addressed the $2 billion figure. EA Table 13 applies the proposal's 60-month seasoning and "
                  "two-year test at each float line, so its $700 million row (1,665 large accelerated filers holding "
                  "95.2% of float) is not comparable with today's 2,115 holding 98.8%. Shares are of total public "
                  "float.") +
        H.table(["Element", "What commenters said", "What to watch for"], [
            ["<b>Five-year on-ramp</b>", "<b>58 of the 75</b> commenters that addressed it rejected or "
             "questioned a uniform 60 months", "A shorter period, or size-based exits like those for emerging "
             "growth companies"],
            ["<b>Float as the sole test</b>", "14 commenters proposed a revenue test or asked the SEC to consider one",
             "A revenue limit at or near $1.235 billion"],
            ["<b>The $2 billion level</b>", "Of the 50 that took a view on the figure, 18 supported it, 16 wanted "
             "it lower, 4 higher and 12 opposed any increase",
             "A figure from $1.15 billion to $2 billion, or indexing"],
            ["<b>Crossing a threshold in 2026</b>", "One association and two issuers asked for interim relief; none "
             "is proposed", "A grace period, or status held until the final rule"],
            ["<b>Foreign private issuers</b>", "Kept at $75 million; law firms asked for parity, now or in the "
             "foreign issuer rulemaking", "A statement that the exclusion is transitional"],
            ["<b>Disclosure of whether the auditor attested</b>", "Five commenters asked that companies disclose "
             "whether an attestation was obtained", "A required statement on whether the auditor attested"],
        ], widths=[24, 40, 36]) +
        H.p("Commenters agree most on the on-ramp, which would not affect a seasoned mid-market company; a "
            "second test or a lower threshold would. The counts show where the arguments lie, not the vote.")))

    # ================================================= 6
    P.append(H.sec(6,
        H.h1("6. Capital Markets and<br/>the Mid-Market") +
        DECK("The proposal would lower the cost of remaining public, but the decision to go public depends "
             "largely on other factors.") +
        H.p("The proposal's stated purpose is to encourage more companies to go and stay public. The decline "
            "is well documented, with the number of companies listed on US exchanges falling from 8,090 in "
            "1996 to 3,908 in 2025.") +
        H.exhibit("Exhibit 7 — Fewer listed companies alongside ample IPO capital", "x7_markets.png",
                  SRC7) +
        H.p("The SEC is careful not to quantify the effect. The proposing release gives no estimate of "
            "additional listings and states that the “magnitude and direction of the effect is difficult to "
            "predict”. It also notes "
            "that approximately 88% of 2024 IPOs, excluding funds and direct listings, were by emerging growth companies, which already have the "
            "exemption for up to five years.") +
        H.p("The comment letters do not fill that gap. Supporters argue that listings will follow, but none "
            "estimates how many. The academic whose study the proposing release cites on the JOBS Act's effect "
            "on IPOs supports the proposal, including the five-year on-ramp, while warning that the wider "
            "exemption "
            "is “not costless”, and wrote:") +
        H.callout("Professor Michael Dambra, University at Buffalo, comment letter, p. 2",
                  ["<em>“While I do not expect the regulation to increase IPO activity in the United States, "
                   "our research indicates that scaling back the burdens of being public enhances the frequency "
                   "and efficiency of corporate investment and innovation …”</em>"]) +
        H.p("Much of the research the SEC cites points to other causes, notably abundant "
            "private capital and small companies choosing to be acquired. Three of the authors of one of those "
            "studies, updating it in 2025 "
            "with a co-author, date the US listing gap to 1999, three years before Sarbanes-Oxley, and find "
            "that it widened only slowly through 2023.") +
        H.p("The listing data are consistent with this. By the end of 2001, before the Act took effect, the "
            "count had fallen from 8,090 to 6,177, or 46% of the total decline to 2025.") +
        H.p("Capital also remains available. US IPOs raised $147.5 billion in the first nine months of 2026, "
            "more than in all of 2021, though two offerings account for $101.5 billion of it.")))
    P.append(H.cont(6,
        H.h2("6.1 Implications for mid-market companies") +
        H.p("For a listed company below $2 billion of float that has the attestation today, the benefits are "
            "direct: lower audit fees and less risk of a share price move carrying it across a threshold.") +
        H.p("For a private company considering a listing, the change is narrower than it may appear. A "
            "candidate small enough to qualify as an emerging growth company already has up to five years. "
            "The new relief is for candidates too large for that status, and one audit firm described "
            "the companies between its preferred threshold and $2 billion as generally “large and seasoned "
            "public companies rather than the "
            "private companies weighing whether to enter the public markets” (comment letter, p. 4).") +
        H.p("Two findings point the other way, both from the only data set in the comment letters built on the "
            "affected companies (Professors Rajgopal, Wong and Zhao, comment letter, pp. 2 to 4). Auditors "
            "reported ineffective controls at <b>12.8%</b> of companies with $250 million to $700 million of "
            "float "
            "and <b>8.5%</b> at $700 million to $2 billion, compared with 3.8% above $2 billion. The typical newly "
            "exempted company is followed by <b>4 to 6 analysts</b>, compared with 12 for companies that "
            "remain in scope.") +
        H.p("For foreign issuers, the proposal may work against its own purpose, since a foreign private "
            "issuer on Form 20-F would still need the auditor's attestation from $75 million of worldwide "
            "float, unless it is an emerging growth company, while a domestic competitor would be exempt up to "
            "$2 billion; the SEC is deferring relief until it completes the eligibility review it opened in "
            "June 2025. The proposing release acknowledges this “could result in competitive disadvantages”. "
            "One international law firm wrote "
            "of the wider gap between the domestic and foreign issuer regimes: “We believe this gap will make "
            "U.S. listings significantly less attractive for foreign issuers, thereby reducing the investment "
            "opportunities available to U.S. investors” (Linklaters LLP, comment letter, p. 2).") +
        H.pov("Uniqus Point of View: an option, not a saving",
              paras=["<b>In our view, the proposal lowers the cost of staying public but does little to change "
                     "the decision to go public.</b> Most companies making that decision are already exempt, "
                     "and the main reasons companies stay private, namely ample private capital, valuation and "
                     "litigation exposure, are unaffected.",
                     "For a mid-market company, the appeal of a US listing rests on valuation, liquidity and "
                     "research coverage, and a control record that withstands independent testing supports all "
                     "three."],
              kicker="The exemption is an option to be priced, not a saving to be booked.", keep=True)))

    # ================================================= 7
    P.append(H.sec(7,
        H.h1("7. Actions to Consider Before<br/>a Final Rule") +
        DECK("Eight decisions for SOX program leaders, in the order they arise.") +
        H.p("The first step is to locate the company. Three questions decide where it lands, and only one of "
            "the three outcomes calls for action now.") +
        EX8(H) +
        REC_OL(DECISIONS, "Eight decisions for SOX program leaders")))
    P.append(H.cont(7,
        H.h2("7.1 Retain, discontinue or replace") +
        H.table(["Option", "When it may fit", "What is given up"], [
            ["<b>Retain the integrated audit voluntarily</b>", "A recent material weakness or restatement; a planned "
             "capital raise; lenders that require it", "The full cost saving"],
            ["<b>Discontinue it and rely on management's assessment</b>", "Stable business and systems; a clean "
             "control record; concentrated ownership", "Independent testing of management's conclusion"],
            ["<b>Replace it with a scaled alternative</b>", "A program that seeks independent challenge, from "
             "internal audit or a periodic external review, without an annual opinion", "Simplicity, since the "
             "alternative must be designed and explained"],
        ], widths=[28, 42, 30]) +
        H.h2("7.2 Relying on management's assessment alone") +
        H.p("The second option carries a recognized risk. An advisory firm that does not audit told the SEC that "
            "without the external attestation “the 404(a) process tends over time toward formalism” (p. 3). "
            "The American Accounting Association's Financial Reporting Policy Committee, citing a 2017 study of "
            "small companies, adds that Section 404(a) "
            "alone “only results in the discovery and disclosure of about half of issuers with ineffective "
            "internal controls” (p. 7).") +
        AUDITOR_TABLE(H) +
        H.p("Discontinuing the attestation does not remove the auditor from internal control. The substance of "
            "the change lies in the last two rows: management's conclusion becomes the only public conclusion "
            "on internal control, so the evidence behind it must stand on its own.") +
        H.prac("Cross-border implications: the United States, India and the Middle East", CROSS)))

    # ================================================= Help
    P.append(H.sec(8,
        H.h1("How Uniqus Can Help") +
        H.p("Our Governance, Risk &amp; Compliance practice helps companies design, test and sustain internal "
            "control across the US, India and the Middle East. For a company that will remain a large "
            "accelerated filer, or an emerging growth company in its first five years, the proposal does not "
            "change the SOX program.") +
        HELP(H) +
        H.p("To discuss any of these, please contact <b>Sandip Khetan</b>, Co-Founder and Global Head of "
            "Accounting &amp; Reporting Consulting, or <b>Sharad Chaudhary</b>, who leads our Governance, Risk "
            "&amp; Compliance practice, through www.uniqus.com.") +
        ABOUT))
    return P


# ===================================================================
#  Pieces kept apart so fact-check edits land in one place
# ===================================================================
def DECK(t):
    return '<p class="deck">%s</p>' % t


def EX1(H):
    built = H.chain([("2002", "Sarbanes-Oxley enacted; accelerated filer threshold set at $75 million of float"),
                     ("2004", "First auditor attestations, from accelerated filers"),
                     ("2005", "Large accelerated filer threshold set at $700 million")], highlight_last=False)
    scaled = H.chain([("2007", "SEC guidance for management; PCAOB risk-based AS 5"),
                      ("2010", "Dodd-Frank: non-accelerated filers exempt by statute"),
                      ("2012", "JOBS Act: emerging growth companies exempt for up to five years"),
                      ("2020", "Issuers with revenue under $100 million leave accelerated status"),
                      ("2026", "Proposal: $2 billion threshold; 60 months for every new registrant")])
    above = ('<table class="above"><tr>'
             '<td><div class="l">2005, at adoption</div><div class="v">18%</div><div class="s">of companies on US markets; '
             '“nearly 95 percent” of float</div></td>'
             '<td><div class="l">2024, same $700 million threshold</div><div class="v">35.4%</div><div class="s">of '
             'registrants; 98.8% of float</div></td>'
             '<td class="m"><div class="l">Proposed $2 billion threshold</div><div class="v">19.2%</div><div class="s">of '
             'registrants; 93.5% of float</div></td></tr></table>')
    inner = ('<div class="tlh">Introduced, 2002 to 2005: the requirement takes effect</div>' + built +
             '<div class="tlh m">Scaled or narrowed, 2007 to 2026: the proposal would be the fifth</div>' + scaled +
             '<div class="tlh">Who sits above the large accelerated filer threshold</div>' + above)
    return H.exhibit_html("Exhibit 1 — The life of Section 404, 2002 to 2026", inner,
                          "Source: SEC Release 33-11419 (May 19, 2026), pp. 12, 20 to 34, 40 to 42, 150 and 207; SEC "
                          "Release 33-8392 for the 2004 compliance date; Uniqus analysis. The 2004 entry is the first "
                          "fiscal year end (on or after November 15, 2004) for which accelerated filers provided the "
                          "auditor's attestation. Shares are the SEC's estimates; the 2005 figures are shares of "
                          "companies on the NYSE, Amex, Nasdaq, OTC Bulletin Board and Pink Sheets and of their float, and "
                          "“nearly 95 percent” is the SEC's wording, so the 2005 and 2024 columns are not on the "
                          "same base. The $2 billion figures also apply the proposed 60-month seasoning and two-year "
                          "test; with today's 12-month seasoning the count would be 1,234 (20.6% of registrants).")


def EX3(H):
    return H.exhibit("Exhibit 3 — Restatements announced by SEC registrants, 2013 to 2025", "x3_restatements.png",
                     "Source: Center for Audit Quality, Financial Restatement Trends in the United States: 2013 to "
                     "2022 (June 2024), p. 15, for 2013 to 2022; Ideagen Audit Analytics, Financial Restatements "
                     "reports (June 2025 for 2023; May 2026 for 2024 and 2025) for 2022* and 2023 to 2025. Both draw "
                     "on the Audit Analytics database and count reissuance and revision restatements in the year "
                     "announced. The Center's figures exclude 1,155 restatements by blank-check companies that "
                     "followed the SEC staff's April 2021 statement on warrants; Ideagen's include them (13 in 2025; "
                     "2023 and 2024 not published), so 2022 is shown on both bases and the two segments should not "
                     "be read as one line. Ideagen revises counts as late filings arrive; 2025 is as first reported. "
                     "The fall cannot be credited to Section 404 alone.")


SRC7 = ("Source: World Federation of Exchanges via World Bank, indicator CM.MKT.LDOM.NO, “Listed domestic "
        "companies, total”, United States, updated July 13, 2026: companies listed on US exchanges at year end, "
        "including foreign companies listed only there and excluding investment funds and holding companies, so a "
        "foreign company also listed at home is not counted; 1996 is the peak. "
        "Renaissance Capital, US IPO Market 2025 Annual Review (December 18, 2025) and 3Q 2026 Quarterly Review "
        "(October 1, 2026): IPOs and direct listings of at least $50 million of market value, excluding closed-end "
        "funds, SPACs and, from 2026, unit offerings. 2023 is as restated in Renaissance's quarterly series (earlier "
        "reviews: 108 IPOs, $19.4 billion); 2026 is January to September, as restated in the 3Q 2026 review. The "
        "two offerings are SpaceX ($75.0 billion, June 2026) and SK hynix ($26.5 billion of American depositary "
        "receipts, July 2026; its primary listing remains in Seoul).")


def EX8(H):
    rows = [
        ("1", "Does the company file as a foreign private issuer on <b>Form 20-F or 40-F</b>?", "yes",
         "Outside the new categories", "The auditor's attestation continues from $75 million of worldwide float, "
         "unless it is an emerging growth company.", "1,144 filers on these forms in 2024, 498 of them emerging "
         "growth companies", "", "No: go to question 2"),
        ("2", "Was public float <b>$2 billion or more</b> at <b>each</b> of the last two second-quarter ends?",
         "no", "Non-accelerated filer", "The attestation is no longer required; management's assessment continues.",
         "4,825 registrants in all: 1,596 newly exempt, and 3,229 that have no attestation today", "na", "Yes: go to question 3"),
        ("3", "Has it been an SEC reporting company for <b>60 months</b> or more?", "yes",
         "Large accelerated filer", "No change; the attestation continues. If not, it is a non-accelerated filer.",
         "1,146 registrants", "", ""),
    ]
    inner = X.ladder(rows, "<b>Until a final rule takes effect, the current thresholds still apply.</b> A "
                           "company that crossed a threshold on June 30, 2026 needs the attestation for fiscal "
                           "2026 unless a final rule takes effect before it files that annual report; under "
                           "the proposed transition, status is "
                           "reassessed as of the fiscal year-end before the effective date, and relief applies from the "
                           "next filing. <em>The proposing release provides no interim relief.</em>")
    return H.exhibit_html("Exhibit 8 — Determining filer status under the proposal", inner,
                          "Source: SEC Release 33-11419, pp. 43 to 48, 87 to 89, 114 to 116, 149, 152 and 205; Uniqus "
                          "analysis. On transition, a current large accelerated filer below $2 billion in either of "
                          "the two years, or with less than 60 months of reporting, becomes a non-accelerated filer. "
                          "Counts are the SEC's estimates on calendar 2024 data.")


def REC_OL(items, header):
    return ('<div class="rec"><div class="hd">%s</div><ol class="num">%s</ol></div>'
            % (header, "".join("<li>%s</li>" % i for i in items)))


DECISIONS = [
    "<b>Confirm filer status under both rule sets.</b> Compute public float at the last two "
    "second-quarter ends on today's single-day basis and on the proposed 10-trading-day average, and confirm the "
    "months of reporting history.",
    "<b>Plan on the current rules if the company crossed a threshold at June 30, 2026.</b> Three commenters asked "
    "for interim relief, but the proposal offers none. Relief for fiscal 2026 would come only if a final rule takes "
    "effect before the company files, so the effective date warrants monitoring.",
    "<b>Identify who else relies on the attestation.</b> A bank with $5 billion or more of assets stays under the "
    "FDIC's rule even if its holding company is exempt. In the governance survey, 97% named investor expectations "
    "and analyst coverage among the factors that would most influence whether they use the new accommodations, and "
    "65% debt or equity offering requirements; lenders, rating agencies and major holders are worth "
    "consulting first.",
    "<b>Base the saving on a fee proposal rather than the SEC's average.</b> Ask the auditor what the audit would "
    "cost without an opinion on internal control; seven audit firms told the SEC the financial statement audit "
    "would absorb part of the work.",
    "<b>Take the decision to the audit committee with evidence.</b> That means "
    "material weaknesses and restatements in the last three years, finance turnover, system changes under way and "
    "the shareholder base.",
    "<b>Define the evidence standard for an assessment no one else will test.</b> Scope, sample sizes, tester "
    "independence and deficiency evaluation should be documented, as the auditor's work papers will no "
    "longer provide them.",
    "<b>Decide how to explain the choice.</b> Beyond the cover-page check box, the proposal requires no statement "
    "on whether an attestation was obtained, though five commenters asked for one. An answer should be ready for "
    "the first investor who asks.",
    "<b>Preserve what is hard to rebuild.</b> This includes control documentation, IT general control evidence and "
    "trained staff. A company whose float stays at or above $2 billion for two consecutive years is back in scope "
    "(see the example in Section 2).",
]


def AUDITOR_TABLE(H):
    return (H.table(["The auditor's work", "With the attestation", "Without the attestation"], [
        ["<b>Understanding of controls</b>", "Required", "Still required, for the design and implementation of "
         "relevant controls"],
        ["<b>Testing whether controls operate</b>", "Required, to support an opinion on internal control",
         "Where the auditor relies on controls or cannot obtain enough evidence without them"],
        ["<b>Deficiencies the auditor finds</b>", "All deficiencies in writing to management; significant "
         "deficiencies and material weaknesses also to the audit committee", "Significant deficiencies and material "
         "weaknesses still in writing to both; <b>lesser deficiencies at the auditor's discretion</b>"],
        ["<b>Opinion on internal control</b>", "Public, in the annual report", "<b>None</b>"],
        ["<b>A material weakness that management has not reported</b>", "The auditor must say so in its report",
         "Communicated in writing to management and the audit committee; <b>no public report</b>"],
        ["<b>Officers' certifications</b>", "CEO and CFO certify they have disclosed significant deficiencies and "
         "material weaknesses to the auditor and the audit committee", "<b>Unchanged</b>; the certification "
         "becomes the main formal check on what management discloses"],
    ], widths=[30, 32, 38]) +
        H.note("Source: SEC Release 33-11419, pp. 61, 62 and 139; PCAOB AS 2110, AS 2301 (including paragraph 17), "
               "AS 1305 (paragraphs 4 and 7) and AS 2201 (paragraphs 78 to 81); Exchange Act Rules 13a-14 and 15d-14."))


CROSS = [
    "<b>Foreign private issuers.</b> A company from India or the Gulf that lists in the US on Form 20-F "
    "remains subject to the auditor's attestation from $75 million of worldwide float unless it is an emerging "
    "growth company, although it may switch to domestic forms to obtain the relief. A domestic filer of the "
    "same size would be exempt up to $2 billion.",
    "<b>India already requires more.</b> Under Section 143(3)(i) of the Companies Act, 2013, the auditor "
    "reports on whether internal financial controls with reference to financial statements are adequate and "
    "operating "
    "effectively, for listed and unlisted companies alike; private companies are exempt if they are one person "
    "or small companies, or have turnover under INR 50 crore or borrowings under INR 25 crore, and are up to date "
    "with their filings (MCA notification G.S.R. 583(E), June 13, 2017). A US parent that discontinues its "
    "attestation may therefore still have an Indian subsidiary whose auditor reports on controls every year.",
    "<b>The UAE is moving in the opposite direction.</b> Abu Dhabi's Accountability Authority requires the "
    "auditor to report on "
    "the effectiveness of internal control over financial reporting at the entities it oversees (Chairman's "
    "Resolution No. 1 of 2017). The UAE's capital markets regulator requires listed public joint-stock companies "
    "to obtain, but not yet publish, an external auditor's opinion on internal control over financial "
    "reporting for 2026, and to publish it with the board's internal control report from financial year 2027.",
    "<b>Saudi Arabia looks to the board and the audit committee.</b> The board reviews the effectiveness of internal "
    "control each year and the audit committee publishes its opinion on its adequacy (CMA Corporate Governance "
    "Regulations, Articles 21, 87 and 88). In our view, a group reporting in more than one of these markets "
    "should build one control framework to the most demanding requirement it faces, rather than to the US "
    "minimum.",
]


def HELP(H):
    cell = lambda t, when, out, desc, m=False: (
        '<td class="hc%s"><div class="h">%s</div><div class="w">%s</div><p><b>%s</b> %s</p></td>'
        % (" m" if m else "", t, when, out, desc))
    return ('<table class="help"><tr>' +
            cell("Internal controls design and testing", "For a company relying on management's assessment alone",
                 "SOX, IFC and ICOFR programs.", "Control design and management testing, scoped and documented "
                 "in line with the SEC's 2007 guidance, so the Section 404(a) conclusion rests on its own "
                 "evidence; one framework for groups reporting in more than one market.") +
            cell("Internal audit", "For a company replacing the attestation with a scaled alternative",
                 "Independent challenge without an annual opinion.", "Risk-based internal audit under the IIA's "
                 "Global Internal Audit Standards, covering financial, IT and AI controls, with periodic reviews "
                 "the audit committee can rely on.", True) +
            '</tr><tr>' +
            cell("Risk, compliance and governance", "For boards and audit committees",
                 "Oversight that does not depend on the auditor.", "Enterprise risk frameworks, risk appetite and "
                 "key risk indicators, compliance obligation registers, board and committee charters, delegation "
                 "of authority and business continuity.") +
            cell("Risk UniVerse", "For every option, including a retained attestation",
                 "Our AI-enabled GRC platform.", "Centralizes controls data and workflows, automates control "
                 "testing, and turns walkthrough recordings into process narratives, flow diagrams and risk and "
                 "control matrices.", True) +
            '</tr></table>')


ABOUT = ('<div class="about"><div class="ah">About Uniqus Consultech</div><p>Uniqus Consultech is an AI and global '
         'tech-enabled consulting company that specializes in Accounting &amp; Reporting Consulting, Governance, '
         'Risk &amp; Compliance, Sustainability &amp; Climate Consulting, Tech Consulting, and Valuations. The Company is co-founded by consulting '
         'veterans Jamil Khatri and Sandip Khetan and backed by marquee investors such as Nexus Venture Partners, '
         'Sorin Investments, and UST. Uniqus has a global team of 800 professionals, led by 100 Partners and '
         'Directors, across 13 offices in the USA, the Middle East, and India. The company serves more than 400 '
         'clients, including marquee names in each of the markets it operates in.</p>'
         '<p class="disc">This publication contains general information only and is based on the SEC’s proposing '
         'release, the public comment file, regulatory materials, academic research and market data available as '
         'of October 2026, including estimates from third parties that are inherently uncertain and subject to '
         'revision. The classification of comment letters reflects Uniqus’s reading of each letter; positions are '
         'summarized, and readers should consult the letters themselves on the SEC’s website. Rules described as '
         'proposed may be adopted in a different form or not at all. Amounts drawn from different sources and bases '
         'are not additive. Nothing herein alleges any breach of accounting standards or securities laws by any '
         'company or firm named, and references to commenters are included to illustrate the range of views on an '
         'unsettled question. This document does not constitute accounting, investment, legal or other professional '
         'advice, and Uniqus Consultech is not, by means of this publication, rendering any such advice or services. '
         'Readers should consult a qualified professional advisor before making any decision or taking any action '
         'that may affect their finances or business. © 2026 Uniqus Consultech. All rights reserved.</p></div>')


def WHO(H):
    # v2: new — the paper's relevance by reader, on the executive-summary spread
    return H.exhibit_html("What this means for you", X.who([
        ("Audit committee chair", "and the committee", "The auditor's opinion on internal control would become "
         "the committee's choice rather than a requirement.", "Retain, discontinue or replace, recorded on evidence "
         "before the next audit plan is approved.", "7.1"),
        ("CFO and chief accounting officer", "signing 302 and 906 certifications", "Certifications and "
         "management's 404(a) assessment are unchanged; the audit fee and filing deadlines may change.",
         "Base the saving on the auditor's fee proposal, and decide how to explain the choice.", "4.1, 7"),
        ("SOX program leader", "and chief audit executive", "No external test of management's conclusion, though the "
         "auditor must still understand, and may test, controls.", "Define the evidence standard for scope, sampling, "
         "tester independence and deficiency evaluation.", "7.2"),
        ("Treasurer and investor relations", "lenders, rating agencies, holders", "Covenants, bank regulators and "
         "investors may still expect the auditor's opinion.", "Identify who else relies on it, and prepare a response "
         "for the first investor who asks.", "7"),
        ("IPO candidate", "and its sponsors", "Every new registrant, not only emerging growth companies, has "
         "five years before the attestation can apply.", "Build controls to the standard the company will need "
         "in year six, not year one.", "6.1"),
        ("Foreign private issuer", "or a group across the US, India and the Gulf", "No change on Form 20-F; the "
         "attestation still applies from $75 million of float.", "Build one control framework to the most demanding "
         "market it reports in.", "7.2"),
    ]), "Source: Uniqus analysis of SEC Release 33-11419 and comment file S7-2026-18.")


def CAL(H):
    # v2: new — the calendar a finance leader plans against
    return H.exhibit_html("Where the rule stands", X.cal([
        ("May 2026", "Proposal issued May 19, alongside proposals on semiannual reporting (May 5) and registered offering reform (May 19)", ""),
        ("June 30, 2026", "Fiscal 2026 status measured on today's rules for calendar-year companies", ""),
        ("July 20, 2026", "Comment period closed", ""),
        ("October 2026", "No final rule yet; the docket holds %s entries" % F["entries"], "now"),
        ("Final rule", "Timing and effective date not yet set; the proposal includes no interim relief", "tbd"),
    ]), "Source: SEC Release 33-11419 and sec.gov docket S7-2026-18, as of October 5, 2026.")


V2CSS = """<style>
p.deck{ font-style:italic; color:#B21E7D; font-size:10pt; line-height:1.4; margin:-3mm 0 5mm 0; text-align:left; }
img.band{ width:100%; display:block; border-radius:2mm; margin:0 0 6mm 0; }
.bandend{ margin-top:7mm; page-break-inside:avoid; }
.bandend img{ width:100%; display:block; border-radius:2mm; }
.tlh{ font-weight:600; font-size:7.6pt; color:#482879; text-transform:uppercase; letter-spacing:0.3pt; margin:2.4mm 0 1.2mm 0; }
.tlh.m{ color:#B21E7D; }
table.chain td.cs .ct{ font-size:9pt; font-weight:700; }
table.chain td.cs{ padding:2.2mm 1.8mm; }
table.above{ border-collapse:separate; border-spacing:1.6mm 0; margin:0 0 0 -1.6mm; width:101.2%; }
table.above td{ border:none; background:#F5F1F9; border-radius:1.6mm; padding:2.2mm 2.8mm; width:33%; vertical-align:top; }
table.above tr:nth-child(even) td{ background:#F5F1F9; }
table.above td.m{ background:#FBEFF5; }
table.above .l{ font-size:6.8pt; color:#55555F; }
table.above .v{ font-size:13pt; font-weight:700; color:#482879; line-height:1.15; margin-top:0.6mm; }
table.above td.m .v{ color:#B21E7D; }
table.above .s{ font-size:6.6pt; color:#55555F; line-height:1.3; }
table.help{ border-collapse:separate; border-spacing:2.6mm; margin:0 0 2mm -2.6mm; width:103.9%; }
table.help td{ border:1px dashed #C9BFD8; border-radius:2.5mm; padding:2.8mm 3.2mm; width:50%; vertical-align:top; background:#fff; }
table.help tr:nth-child(even) td{ background:#fff; }
table.help td.m{ border-color:#E8B7D3; }
table.help .h{ font-weight:600; font-size:9.4pt; color:#482879; line-height:1.25; }
table.help td.m .h{ color:#B21E7D; }
table.help .w{ font-style:italic; font-size:7.2pt; color:#7A7A85; margin:0.8mm 0 1.6mm 0; }
table.help p{ font-size:7.8pt; text-align:left; margin:0; line-height:1.45; }
.about{ border-top:1px solid #E2DDEA; margin-top:5mm; padding-top:3mm; }
.about .ah{ font-weight:600; color:#482879; font-size:9.4pt; margin-bottom:1.6mm; }
.about p{ font-size:7.3pt; color:#55555F; line-height:1.45; }
.about p.disc{ font-size:6.2pt; color:#8A8A95; }
.rec li b{ color:#B21E7D; }
.rec ol.num{ margin:0; padding-left:6.2mm; }
.rec ol.num li{ font-size:8.6pt; margin:0 0 1.3mm; padding-left:1mm; }
.rec ol.num li::marker{ color:#B21E7D; font-weight:600; }
</style>"""


def BAND(img):
    return '<div class="bandend"><img src="%s"/></div>' % img
