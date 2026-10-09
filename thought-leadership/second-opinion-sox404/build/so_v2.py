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
                    "at 1,596 companies. A review of every comment letter, and what comes next."],
    date="October 2026",
    kicker="Insights",
    strap="SOX 404: Before, Now and After",
    footer="The Second Opinion | SOX 404: Before, Now and After",
)

NAV = ["Executive Summary", "1. How Section 404 Evolved", "2. What the SEC Proposed",
       "3. What the SEC Heard", "4. Two Questions Left Open",
       "5. Where the Final Rule Could Move", "6. Capital Markets and the Mid-Market",
       "7. Actions Before a Final Rule", "How Uniqus Can Help"]

# --------------------------------------------------------------- facts
# One number, one value, everywhere: every repeated figure is defined once.
F = dict(
    exempt="1,596", exempt_pct="26.7%", laf_now="2,115", laf_new="1,146",
    laf_pct_now="35.4%", laf_pct_new="19.2%", float_new="93.5%",
    exempt_laf="964", exempt_af="632",
    entries="192", commenters="172", addressed="118", silent="54",
    oppose="75", support="32", nopos="11", toobroad="32", dne="43",
)


def blocks(H):
    P = ['<div class="cover"></div>']

    # ================================================= Executive summary
    P.append(H.sec(0, V2CSS +
        H.h1("Executive Summary") +
        H.tiles([
            (F["exempt"], "Registrants the SEC estimates would be newly exempt from the auditor's "
                          "attestation on internal control: %s of all registrants" % F["exempt_pct"]),
            ("75 of 118", "Commenters addressing the attestation who called the exemption too broad, "
                          "nine in guarded terms, or said it should not be expanded"),
            ("0 of 11", "Audit firms on the file that endorsed the $2 billion line as drawn; "
                        "10 of them questioned the five-year on-ramp"),
            ("12 of 118", "Commenters who said anything concrete about what a company should do "
                          "once the attestation is gone"),
        ]) +
        H.p("Most finance leaders read the SEC's filer status proposal of May 19, 2026 (Release No. "
            "33-11419, <em>Enhancement of Emerging Growth Company Accommodations and Simplification of Filer "
            "Status for Reporting Companies</em>) as a cost saving "
            "and moved on. The large accelerated filer line rises from $700 million to $2 billion of "
            "public float, every new registrant gets five years, and the SEC's requirement for an "
            "auditor's opinion on internal control falls away for <b>%s companies</b>." % F["exempt"]) +
        H.p("The comment file is less settled than that reading. It holds %s entries from <b>%s "
            "distinct commenters</b>, and this paper rests on a review of every one. It follows "
            "Section 404 through its life: how it reached this point, what the SEC has now heard, "
            "and what a finance leader should do before the answer arrives." % (F["entries"], F["commenters"])) +
        H.qa("First, how did Section 404 get here, and what did it deliver?",
             ["It was built between 2002 and 2005 and has been scaled or narrowed four times since; the "
              "proposal would be the fifth. The $700 million line was set in 2005 and has not moved: at "
              "adoption it captured 18% of companies on US markets, and today it captures <b>35.4% of registrants</b>. "
              "Over the same years restatements fell and the SEC's staff concluded from the research that "
              "auditor testing brought out control deficiencies management had not disclosed, though neither can be "
              "credited to Section 404 alone."],
             ref="(Refer Section 1: How Section 404 Evolved)") +
        H.qa("Second, what did the SEC hear?",
             ["Of the 118 commenters that addressed the attestation, <b>75 said the exemption is too broad "
              "or should not be expanded</b>, nine of them in guarded terms, and 32 supported it or wanted more.",
              "The split runs by constituency. Every company, both exchanges and every business trade association "
              "that took a side supported the exemption. No accounting firm endorsed the $2 billion line as drawn, and "
              "25 of the 27 investors and investor advocates that addressed the exemption called it too "
              "broad or opposed any expansion."],
             ref="(Refer Sections 3 and 4: What the SEC Heard; Two Questions Left Open)") +
        H.qa("Third, where could the final rule move?",
             ["No final rule has been adopted. The letters show where one could move: the five-year on-ramp "
              "for very large new listings, a second test beside public float, and relief for companies "
              "that cross today's lines while the rule is pending."],
             ref="(Refer Section 5: Where the Final Rule Could Move)")))
    P.append(H.cont(0,
        H.qa("Fourth, will this bring the mid-market back?",
             ["The proposal lowers the cost of staying public. It does little to change the decision to go "
              "public, because most companies making that decision are exempt already. The release gives "
              "no estimate of additional listings."],
             ref="(Refer Section 6: Capital Markets and the Mid-Market)") +
        H.qa("Fifth, what should a finance leader do before the final rule?",
             ["Fix the company's status under both rule sets, price the saving from the auditor's own fee "
              "proposal, and take keep, drop or replace to the audit committee with evidence. Section 7 sets "
              "out eight decisions for the person who runs the SOX program."],
             ref="(Refer Section 7: Actions to Consider Before a Final Rule)") +
        H.pov("Uniqus Point of View: when management's assessment stands alone",
              paras=["The file argues about where the line should sit; a finance leader has a different "
                     "question. <b>Once the auditor's opinion is optional, management's assessment under "
                     "Section 404(a) is the only report on internal control an investor receives.</b> The "
                     "proposal changes neither that assessment nor the certifications that accompany it.",
                     "We would plan on the core of the proposal surviving and its edges moving. Companies "
                     "below $2 billion of float that have the attestation today should prepare for a year "
                     "in which it becomes a choice."],
              kicker="That choice belongs to the audit committee, and it should be made on evidence before "
                     "a lender, an underwriter or an investor asks about it.", keep=True) +
        H.sig("Sandip Khetan", ["Co-Founder, Global Head of Accounting &amp; Reporting Consulting"]) +
        WHO(H) + BAND("band_before.png")))

    # ================================================= 1
    P.append(H.sec(1,
        H.h1("1. How Section 404 Evolved") +
        DECK("Built between 2002 and 2005. Scaled or narrowed four times since. The proposal would be the fifth.") +
        H.p("Section 404 has two halves. Under 404(a), management assesses internal control over financial "
            "reporting and reports its conclusion. Under 404(b), the auditor attests to that assessment.") +
        H.p("The second half has never applied to everyone, and it has been scaled or narrowed four times. "
            "In 2007 the SEC issued guidance for management and the PCAOB a risk-based audit standard; in "
            "2010 Congress exempted non-accelerated filers from the auditor's attestation by statute, after the "
            "SEC had repeatedly deferred it for them. The JOBS Act added emerging growth companies in 2012, and in 2020 the SEC took issuers "
            "eligible to be smaller reporting companies with revenue under $100 million out of accelerated and "
            "large accelerated filer status.") +
        EX1(H) +
        H.p("The $700 million line was set in 2005 and has not moved. At adoption it captured 18% of "
            "companies on US markets; today the same line captures <b>35.4% of registrants</b>. The SEC did "
            "not index it: adjusted for consumer prices the line would be $1.15 billion, and tracking the "
            "S&amp;P 500 it would be $3.85 billion. It chose $2 billion to restore coverage of “nearly 95 "
            "percent” of public float, and estimates that line covers 93.5%.")))
    P.append(H.cont(1,
        H.h2("1.1 What the record shows") +
        H.p("The SEC's own tables show the control record under each regime. Over 2021 to 2024, management "
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
        H.p("Size explains part of that gradient, and the SEC reads its restatement table cautiously: the "
            "rate for non-accelerated filers is “only slightly higher” than for accelerated filers, and the "
            "non-accelerated group holds more low- or zero-revenue issuers, which restate less often. "
            "The gap is widest on persistence: <b>24.9% of non-accelerated filers reported ineffective "
            "controls in all four years</b>, against 4.2% of accelerated filers.") +
        H.p("Where the attestation is optional, few companies buy it. The SEC estimates that less than six "
            "percent of exempt registrants obtained one voluntarily in 2024.") +
        H.h2("1.2 What the second opinion delivered") +
        H.p("Cost is one side of the ledger. On the other, the SEC's 2011 staff study concluded that auditor "
            "testing “has generally resulted in the disclosure of internal control deficiencies” that "
            "management had not previously disclosed, and that the attestation “appears to have a positive "
            "impact on the informativeness of internal control disclosures and financial reporting "
            "quality”. The release repeats both findings.") +
        H.p("Restatements rose in the first three years of the Act and have fallen since. The Center for Audit "
            "Quality, the audit profession's policy body, counts a 60% decline from 2006 to 2009 and a "
            "further fall from <b>858 in 2013 to 402 in 2022</b>. Ideagen Audit Analytics, counting from the "
            "same database without the Center's adjustment for blank-check companies, recorded 434 in 2023, 477 "
            "in 2024 and 391 in 2025, the second lowest year in its 20-year database after 2020.") +
        EX3(H) +
        H.p("Those closest to the work saw value in it, though on average not enough to outweigh the cost. The release says "
            "respondents to a 2008 and 2009 survey of corporate insiders found the benefits to outweigh the "
            "costs, “especially as they gained experience with section 404(b)”. The study behind the survey, "
            "of 2,901 insiders, is less favourable: on average respondents did not judge the benefits to outweigh the costs, though "
            "perceived net benefits were higher where an auditor attested and rose with experience.") +
        H.p("Compliance costs also fell after 2007, when the PCAOB "
            "issued Auditing Standard No. 5 and the SEC issued its guidance for management.") +
        H.p("The SEC names the wider benefit itself: Section 404(b) “may play a role in improving overall "
            "investor confidence, encouraging investment in public markets”. None of this proves cause: "
            "the Act also created the PCAOB, audit committee independence rules and officer certifications, "
            "the release cites a 2024 working paper that found no decline in internal control or financial "
            "reporting quality at issuers exempted in 2020, and it says auditor testing “may have fewer benefits” at the larger companies "
            "now affected.") +
        H.p("What the record does show is what is being given up: <b>an independent test that, "
            "in the research the SEC staff reviewed in 2011, brought out deficiencies management had not "
            "disclosed.</b> That study covered companies with $75 million to $250 million of float and "
            "recommended against widening the exemption.")))

    # ================================================= 2
    P.append(H.sec(2,
        '<img src="band_now.png" class="band"/>' +
        H.h1("2. What the SEC Proposed") +
        DECK("One line at $2 billion, one clock at five years, and no auditor's opinion below either.") +
        H.table(["Element", "Today", "Proposed"], [
            ["<b>Large accelerated filer line</b>",
             "$700 million of public float", "<b>$2 billion</b> of public float"],
            ["<b>How float is measured</b>", "Share price on the last business day of the second fiscal quarter",
             "Average closing price over the last 10 trading days of that quarter, times non-affiliate "
             "shares at quarter end"],
            ["<b>Moving in or out</b>", "One measurement; exit below $560 million for large accelerated status "
             "and $60 million for accelerated status, or on qualifying under the revenue test", "Two consecutive years above or below the line; no "
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
        H.p("Filer status decides three things: how fast a company must file, how much it must disclose, and "
            "whether its auditor attests to internal control. Today five overlapping labels can apply. The "
            "proposal would leave two that matter, large accelerated and non-accelerated, and add a "
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
             "Stays by statute; the SEC expects reliance on it to be unnecessary in most circumstances. Only "
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
        H.p("A change of status therefore moves more than the attestation. A large accelerated filer that "
            "becomes non-accelerated gains 30 days on its Form 10-K and five on its Form 10-Q, may present two "
            "years of financial statements where it now presents three, and would be exempt from say-on-pay, "
            "say-on-frequency and golden-parachute votes, an emerging growth company accommodation the SEC "
            "proposes to extend to all non-accelerated filers.") +
        H.p("It could also omit risk factors from Forms 10-K "
            "and 10-Q, market risk disclosure, the compensation discussion and analysis, pay ratio and pay "
            "versus performance. The option to defer new accounting standards to private-company dates is "
            "limited to a filer's first five years after registration, so most large accelerated filers that "
            "convert will not have it.") +
        H.p("The SEC estimates that large accelerated filers would fall from %s to %s, from %s to %s of "
            "registrants, while still holding %s of public float. <b>%s registrants</b> would be newly exempt "
            "from the attestation: %s that are large accelerated filers today and %s accelerated filers. The SEC "
            "could not classify the other five of today's 2,115 large accelerated filers because their float data is missing. The 1,596 are 60%% "
            "of the registrants that obtain an attestation today."
            % (F["laf_now"], F["laf_new"], F["laf_pct_now"], F["laf_pct_new"], F["float_new"], F["exempt"],
               F["exempt_laf"], F["exempt_af"])) +
        H.p("Two groups get less than the headline suggests. Banks are counted in the 1,596, but an insured "
            "bank with $5 billion or more of total assets remains subject to the FDIC's attestation requirement "
            "under 12 CFR Part 363, a threshold in effect since January 1, 2026. The FDIC rule applies to the "
            "bank, not the holding company, so a holding company that drops the attestation may still need one "
            "for its bank; the SEC estimates that 87 of 153 banking large accelerated filers "
            "would become non-accelerated.") +
        H.p("Foreign private issuers filing on Form 20-F or 40-F stay outside "
            "the new categories and keep today's $75 million trigger, measured on a single day.") +
        CAL(H)))

    # ================================================= 3
    P.append(H.sec(3,
        H.h1("3. What the SEC Heard") +
        DECK("A file that divides between those who pay for assurance and those who rely on it or provide it.") +
        H.p("As posted on October 5, 2026, the docket held %s entries, the latest dated September 8, 2026; "
            "letters posted since are not counted here. Setting aside SEC staff "
            "memoranda, a roundtable transcript and duplicates leaves <b>%s distinct commenters</b>. Of these, "
            "%s addressed the attestation and %s did not mention it."
            % (F["entries"], F["commenters"], F["addressed"], F["silent"])) +
        H.exhibit("Exhibit 4 — Where 118 commenters stood on the attestation exemption", "x4_positions.png",
                  "Source: Uniqus coding of every entry on SEC comment file S7-2026-18 as posted on October 5, "
                  "2026; the method is set out in “How we read the file”. Not counted: three letters posted October 5 "
                  "to 8, 2026, from a biotech CFO in support, an audit firm already counted that restates its position, and a former PCAOB staff member who calls the exemption too broad. "
                  "The 11 with no position are associations 1, venture capital and "
                  "policy groups 1, audit profession bodies 1, accounting firms 2, academics 3, individuals 2 and "
                  "investors 1. The Texas Society of CPAs letter could not be "
                  "opened on the docket and was read from the society's website. “Too broad” means the "
                  "commenter accepts some widening of the exemption and objects to its extent; nine of those 32 "
                  "say so in guarded terms. Positions are on the exemption, not on the $2 billion figure. The "
                  "counts describe who wrote; they are not a forecast of how the Commission will weigh each letter.") +
        H.p("Supporters are the parties that bear the cost: companies, their associations, both exchanges and "
            "most of the securities lawyers who wrote. Those objecting are led by investors and individual "
            "commenters, joined by academics and by most of the firms and professional bodies that provide "
            "the assurance. Among investors and investor advocates, <b>25 of the 27</b> that addressed the "
            "attestation called the exemption too broad or said it should not be expanded.") +
        H.p("The middle is more informative than either end. Thirty-two commenters accepted that the line "
            "should move and objected to how far. Twenty of them named a different line or test.")))
    P.append(H.cont(3,
        H.h2("3.1 The audit profession, grouped by position") +
        H.p("Eleven of the twenty largest US accounting firms, ranked by revenue in the 2026 INSIDE Public "
            "Accounting list, wrote, including the Big Four, along with one advisory firm that does not audit; "
            "the other nine filed nothing, and nor did the AICPA in its own name, the Institute of Internal "
            "Auditors, Financial Executives International or the Institute of Management Accountants. <b>Nine of "
            "the twelve said the exemption is, or may be, too broad; two took no side; one supported it. None "
            "endorsed the $2 billion line as drawn.</b>") +
        H.table(["What they told the SEC", "How many", "What they asked for, and what it means for you"], [
            ['<b style="color:#482879">The line is too high, and here is where to put it.</b>',
             "Five: four audit firms and the advisory firm",
             "Each named a fix: keep the attestation above today's $700 million line; a line of approximately "
             "$1.1 billion; an inflation adjustment of the thresholds; a revenue limit of $1.235 billion beside "
             "float; or keep it after a recent material weakness. <b>If the SEC takes any of these, some "
             "companies between $700 million and $2 billion of float keep the opinion.</b>"],
            ['<b style="color:#482879">The exempt group may be too wide, but we will not name a number.</b>',
             "Four audit firms", "A second look at how many companies fall out, a test that looks past public "
             "float alone, and refreshed PCAOB guidance on auditing internal control, which is not on the PCAOB's "
             "standard-setting agenda of September 30, 2026. <b>Even firms with no "
             "alternative of their own question the breadth, which adds weight to a second test beside float.</b>"],
            ['<b style="color:#482879">There is not enough evidence to decide yet.</b>', "Two audit firms",
             "Ask investors first, and redo the cost estimate to count the control work an auditor must still "
             "perform. <b>The saving in the release may be overstated.</b>"],
            ['<b style="color:#482879">Let the market decide.</b>', "One audit firm",
             "Make the attestation a choice for most issuers. <b>Even the one supporter suggested the SEC "
             "consider a line below $2 billion.</b>"],
        ], widths=[22, 17, 61]) +
        H.h3("Three points from the firms' letters that bear on planning") +
        H.ul(["<b>The saving is smaller than the fee line implies.</b> Seven audit firms said the financial statement "
              "audit would absorb part of the work, because auditors must still understand controls and, in many "
              "audits, test them or do more substantive work.",
              "<b>Five years is too long for a very large new listing.</b> Ten of the eleven audit firms "
              "questioned a flat 60-month on-ramp.",
              "<b>Fewer firms will keep the capability.</b> One firm estimates, “based on current data”, that only "
              "six firms would likely perform integrated audits for ten or more issuers."]) +
        H.prac("How we read the file", [
            "<b>How it was read.</b> Every entry was read and coded with AI under the direction of Uniqus "
            "professionals. All but two letters went through two independent passes, and differences were "
            "settled by re-reading the letter. Every quotation printed here was checked against the page of "
            "the filed letter.",
            "<b>What counts.</b> Each distinct filer, once: a letter with 115 signatories, most of them academics, "
            "and a joint letter from 49 organizations each count once, and staff memoranda of meetings are excluded. "
            "A position is only what the letter says about the attestation; a letter that never mentions Section "
            "404(b) is recorded as silent."], long=True)))

    # ================================================= 4
    P.append(H.sec(4,
        H.h1("4. Two Questions Left Open") +
        DECK("How much is saved, and what investors will do about it.") +
        H.h2("4.1 How much is actually saved") +
        H.p("The release cannot isolate the attestation fee, because companies disclose total audit fees only. "
            "Its own input is <b>$202,500 of outside cost and 375 internal hours</b> per annual report, a 2020 "
            "estimate adjusted for inflation.") +
        H.p("Issuers put the figure higher. One listed company cited by Nasdaq and one biotech CFO each put it "
            "at $500,000 to $1 million a year, a range that spans the top estimates the release itself reports, "
            "$759,000 and $800,000. A governance association's member survey points the same way.") +
        H.exhibit("Exhibit 5 — The SEC's number and the companies' number", "x5_cost.png",
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
        H.p("The same survey suggests the saving companies expect is smaller than the cost they report. "
            "<b>Taken together, its two top cost bands put the attestation's cost at $500,000 or more a year for 39% "
            "of respondents, but only 3% expect non-accelerated status to save them more than $500,000</b>, and "
            "55% could not quantify the saving at all (pp. 6 and 7).") +
        H.p("Neither set of numbers answers the controller's question: what the financial statement audit will "
            "cost once the auditor no longer tests controls for an opinion of its own. <b>Only a fee proposal "
            "for a specific company answers that.</b>") +
        H.h2("4.2 What investors will do") +
        H.p("Opponents argue that investors will charge for the missing opinion through a higher cost of "
            "capital. The figures offered trace largely to one 2009 study that measured how the cost of "
            "equity moved when auditor-tested reports showed controls weakening or being fixed; it did not "
            "study the removal of the auditor's opinion. The only study we found on the file that "
            "measured the cost of capital after an actual exemption, of issuers with revenue under $100 million "
            "in 2020, found no significant difference; it is the study the release cites on reporting quality.") +
        H.p("Companies are not sure either. In the same survey, 12% of "
            "respondents said they would likely keep the attestation voluntarily and 15% were confident they "
            "would drop it. <b>52% said it would depend on investor demand.</b>") +
        H.compare("Nasdaq, Inc., comment letter, p. 4",
                  ["<em>“One listed company estimated that it spent between $500,000 and $1 million annually "
                   "with independent auditors to comply with this disclosure obligation and observed that such "
                   "expenses could be better deployed on research &amp; development.”</em>"],
                  "Ohio Public Employees Retirement System, comment letter, p. 9",
                  ["<em>“Without an independent “gatekeeper,” management's assessment is inherently "
                   "less credible – in effect, investors are being asked to trust the numbers with one fewer "
                   "check on the system that produced them.”</em>"]) +
        H.objective("Both can be true. The first describes the price of the opinion. The second describes what "
                    "the opinion is for.") +
        BAND("band_after.png")))

    # ================================================= 5
    P.append(H.sec(5,
        H.h1("5. Where the Final Rule<br/>Could Move") +
        DECK("The Commission can adopt the proposal as written. If it moves, the file shows where.") +
        H.exhibit("Exhibit 6 — Where the line could sit, and how many companies stay in scope", "x6_line.png",
                  "Source: SEC Release 33-11419, p. 42 (inflation-adjusted and S&amp;P 500-proportionate lines) and "
                  "EA Table 13, p. 207; Uniqus coding of comment file S7-2026-18 for the 51 commenters that "
                  "addressed the $2 billion figure. EA Table 13 applies the proposal's 60-month seasoning and "
                  "two-year test at each float line, so its $700 million row (1,665 large accelerated filers holding "
                  "95.2% of float) is not comparable with today's 2,115 holding 98.8%. Shares are of total public "
                  "float.") +
        H.table(["Element", "What the file says", "What to watch for"], [
            ["<b>Five-year on-ramp</b>", "<b>55 of the 74</b> commenters that addressed it rejected or "
             "questioned a flat 60 months", "A shorter period, or size-based exits like those for emerging "
             "growth companies"],
            ["<b>Float as the only test</b>", "13 commenters proposed a revenue test or asked the SEC to consider one",
             "A revenue limit at or near $1.235 billion"],
            ["<b>The $2 billion level</b>", "Of the 51 that addressed the figure, 24 supported it, 15 wanted it "
             "lower, 3 higher and 9 opposed any increase",
             "A figure from $1.15 billion to $2 billion, or indexing"],
            ["<b>Crossing a line in 2026</b>", "One association and two issuers asked for interim relief; none "
             "is proposed", "A grace period, or status held until the final rule"],
            ["<b>Foreign private issuers</b>", "Left at $75 million; law firms asked for parity, now or in the "
             "foreign issuer rulemaking", "A statement that the exclusion is transitional"],
            ["<b>Disclosure of whether the auditor attested</b>", "4 commenters asked that companies disclose "
             "whether an attestation was obtained", "A required statement on whether the auditor attested"],
        ], widths=[24, 40, 36]) +
        H.p("The on-ramp is where the file comes closest to agreement; a change there would not touch a "
            "seasoned mid-market company, but a second test or a lower line would. A count of letters shows "
            "where the arguments are, not how the vote will go.")))

    # ================================================= 6
    P.append(H.sec(6,
        H.h1("6. Capital Markets and<br/>the Mid-Market") +
        DECK("Will this bring the mid-market back? It lowers the cost of staying public. The decision to go "
             "public turns on other things.") +
        H.p("The proposal's stated purpose is to encourage more companies to go and stay public. The backdrop "
            "is real. The number of companies listed on US exchanges fell from 8,090 in 1996 to 3,908 in 2025.") +
        H.exhibit("Exhibit 7 — Fewer listed companies, but no shortage of capital", "x7_markets.png",
                  SRC7) +
        H.p("The release does not claim to know the effect. It gives no estimate of additional listings and "
            "says the “magnitude and direction of the effect is difficult to predict”. It also notes "
            "that approximately 88% of 2024 IPOs, excluding funds and direct listings, were by emerging growth companies, which already have the "
            "exemption for up to five years.") +
        H.p("The file does not supply the missing evidence. Supporters assert that listings will follow and "
            "none estimates how many. The academic whose study the release cites for the JOBS Act's effect on "
            "IPOs supports the proposal, including the five-year on-ramp, while warning that the wider exemption "
            "is “not costless”, and wrote:") +
        H.callout("Professor Michael Dambra, University at Buffalo, comment letter, p. 2",
                  ["<em>“While I do not expect the regulation to increase IPO activity in the United States, "
                   "our research indicates that scaling back the burdens of being public enhances the frequency "
                   "and efficiency of corporate investment and innovation …”</em>"]) +
        H.p("Much of the research the release cites points elsewhere: abundant private capital and small "
            "companies choosing to be acquired. Three of the authors of one of those studies, updating it in 2025 "
            "with a co-author, date the US listing gap to 1999, three years before Sarbanes-Oxley, and find "
            "that it widened only slowly through 2023.") +
        H.p("The count of listed companies points the same way: by the end of 2001, before the Act, it had "
            "fallen from 8,090 to 6,177, which is 46% of the whole decline to 2025.") +
        H.p("Capital itself is not short. US IPOs raised $147.5 billion in the first nine months of 2026, more "
            "than in all of 2021, and two offerings account for $101.5 billion of it.")))
    P.append(H.cont(6,
        H.h2("6.1 What it does for a mid-market company") +
        H.p("For a listed company below $2 billion of float that has the attestation today, the benefit is "
            "direct: a lower audit bill and less risk of being moved across a line by its share price.") +
        H.p("For a private company deciding whether to list, the change is narrower than it looks. A candidate "
            "small enough to be an emerging growth company already has five years. What is new is relief for "
            "the candidate too large for that status, and one audit firm described the companies between its "
            "preferred line and $2 billion as generally “large and seasoned public companies rather than the "
            "private companies weighing whether to enter the public markets” (comment letter, p. 4).") +
        H.p("Two effects cut the other way, and both come from the one data set on the file built on the "
            "companies affected (Professors Rajgopal, Wong and Zhao, comment letter, pp. 2 to 4). The auditor "
            "reported ineffective controls at <b>12.8%</b> of companies with $250 million to $700 million of float "
            "and <b>8.5%</b> at $700 million to $2 billion, against 3.8% above $2 billion. The typical newly "
            "exempted company is followed by <b>4 to 6 analysts</b>, against 12 for companies that stay in scope.") +
        H.p("For foreign issuers the proposal works against its own purpose: a foreign private issuer on Form "
            "20-F would still need the auditor's opinion from $75 million of worldwide float, unless it is an "
            "emerging growth company, while a domestic competitor is exempt up to $2 billion, and the SEC is "
            "holding back relief until it completes the eligibility review it opened in June 2025. The release "
            "concedes this “could result in competitive disadvantages”. One international law firm wrote "
            "of the wider gap between the domestic and foreign issuer regimes: “We believe this gap will make "
            "U.S. listings significantly less attractive for foreign issuers, thereby reducing the investment "
            "opportunities available to U.S. investors” (Linklaters LLP, comment letter, p. 2).") +
        H.pov("Uniqus Point of View: an option to be priced",
              paras=["<b>The proposal lowers the cost of staying public. It does little to change the decision "
                     "to go public</b>, because most companies making that decision are exempt already and the "
                     "reasons they stay private are untouched: ample private capital, valuation and litigation "
                     "exposure.",
                     "For a mid-market company the attraction of a US listing rests on valuation, liquidity and "
                     "research coverage. A control record that holds up under outside testing supports all three."],
              kicker="Treat the exemption as an option to be priced, not a saving to be booked.", keep=True)))

    # ================================================= 7
    P.append(H.sec(7,
        H.h1("7. Actions to Consider Before<br/>a Final Rule") +
        DECK("For the person who runs the SOX program: eight decisions, in order.") +
        H.p("Start by locating the company. Three questions decide where it lands, and only one of the three "
            "outcomes calls for work now.") +
        EX8(H) +
        REC_OL(DECISIONS, "Eight decisions for the SOX program leader")))
    P.append(H.cont(7,
        H.h2("7.1 Retain, discontinue or replace") +
        H.table(["Option", "When it fits", "What you give up"], [
            ["<b>Keep the integrated audit voluntarily</b>", "A recent material weakness or restatement; a capital "
             "raise ahead; lenders who ask", "The saving, in whole"],
            ["<b>Drop it and rely on management's assessment</b>", "Stable business and systems; a clean control "
             "record; concentrated ownership", "An independent test of your own conclusion"],
            ["<b>Replace it with something scaled</b>", "A program that wants outside challenge, from internal "
             "audit or a periodic outside review, without an annual opinion", "Simplicity: the substitute has to "
             "be designed and explained"],
        ], widths=[25, 45, 30]) +
        H.h2("7.2 When management's assessment stands alone") +
        H.p("The second option carries a known risk. An advisory firm that does not audit told the SEC that "
            "without the external attestation “the 404(a) process tends over time toward formalism” (p. 3). "
            "The American Accounting Association's Financial Reporting Policy Committee, citing a 2017 study of "
            "small companies, adds that Section 404(a) "
            "alone “only results in the discovery and disclosure of about half of issuers with ineffective "
            "internal controls” (p. 7).") +
        AUDITOR_TABLE(H) +
        H.p("Dropping the opinion does not take the auditor out of internal control. The last two rows are the "
            "substance of the change: management's conclusion becomes the only public conclusion on internal "
            "control, so the evidence behind it has to stand on its own.") +
        H.prac("Cross-border implications — the United States, India and the Middle East", CROSS)))

    # ================================================= Help
    P.append(H.sec(8,
        H.h1("How Uniqus Can Help") +
        H.p("This section is for four readers, each with a decision to take. If your company will remain a large "
            "accelerated filer, or is an emerging growth company in its first five years, nothing here changes "
            "your program. We do not audit, so no audit fee of ours depends on whether a company keeps the "
            "attestation.") +
        HELP(H) +
        H.p("To start any of these, write to <b>Sandip Khetan</b>, Co-Founder and Global Head of Accounting &amp; "
            "Reporting Consulting, through www.uniqus.com.") +
        ABOUT))
    return P


# ===================================================================
#  Pieces kept apart so fact-check edits land in one place
# ===================================================================
def DECK(t):
    return '<p class="deck">%s</p>' % t


def EX1(H):
    built = H.chain([("2002", "Sarbanes-Oxley enacted; accelerated filer line set at $75 million of float"),
                     ("2004", "First auditor attestations, from accelerated filers"),
                     ("2005", "Large accelerated filer line set at $700 million")], highlight_last=False)
    scaled = H.chain([("2007", "SEC guidance for management; PCAOB risk-based AS 5"),
                      ("2010", "Dodd-Frank: non-accelerated filers exempt by statute"),
                      ("2012", "JOBS Act: emerging growth companies exempt for up to five years"),
                      ("2020", "Issuers with revenue under $100 million leave accelerated status"),
                      ("2026", "Proposal: line to $2 billion; 60 months for every new registrant")])
    above = ('<table class="above"><tr>'
             '<td><div class="l">2005, at adoption</div><div class="v">18%</div><div class="s">of companies on US markets; '
             '“nearly 95 percent” of float</div></td>'
             '<td><div class="l">2024, same $700 million line</div><div class="v">35.4%</div><div class="s">of '
             'registrants; 98.8% of float</div></td>'
             '<td class="m"><div class="l">Proposed $2 billion line</div><div class="v">19.2%</div><div class="s">of '
             'registrants; 93.5% of float</div></td></tr></table>')
    inner = ('<div class="tlh">Built, 2002 to 2005: the requirement applied</div>' + built +
             '<div class="tlh m">Scaled or narrowed, 2007 to 2026: the proposal would be the fifth</div>' + scaled +
             '<div class="tlh">Who sits above the large accelerated filer line</div>' + above)
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
         "unless an emerging growth company.", "1,144 filers on these forms in 2024, 498 of them emerging growth "
         "companies", "", "No: go to question 2"),
        ("2", "Was public float <b>$2 billion or more</b> at <b>each</b> of the last two second-quarter ends?",
         "no", "Non-accelerated filer", "The attestation is no longer required. Management's assessment continues.",
         "4,825 registrants in all: 1,596 newly exempt, and 3,229 that have no attestation today", "na", "Yes: go to question 3"),
        ("3", "Has it been an SEC reporting company for <b>60 months</b> or more?", "yes",
         "Large accelerated filer", "Nothing changes. The attestation continues. If no, it is a non-accelerated filer.",
         "1,146 registrants", "", ""),
    ]
    inner = X.ladder(rows, "<b>Until a final rule takes effect, today's lines still apply.</b> A company that "
                           "crossed a line on June 30, 2026 needs the attestation for fiscal 2026 unless a final rule "
                           "takes effect before it files that annual report: under the proposed transition, status is "
                           "reassessed as of the fiscal year-end before the effective date, and relief applies from the "
                           "next filing. <em>The release proposes no interim relief.</em>")
    return H.exhibit_html("Exhibit 8 — Where a company lands under the proposal", inner,
                          "Source: SEC Release 33-11419, pp. 43 to 48, 87 to 89, 114 to 116, 149, 152 and 205; Uniqus "
                          "analysis. On transition, a current large accelerated filer below $2 billion in either of "
                          "the two years, or with less than 60 months of reporting, becomes a non-accelerated filer. "
                          "Counts are the SEC's estimates on calendar 2024 data.")


def REC_OL(items, header):
    return ('<div class="rec"><div class="hd">%s</div><ol class="num">%s</ol></div>'
            % (header, "".join("<li>%s</li>" % i for i in items)))


DECISIONS = [
    "<b>Fix your status under both rule sets.</b> Compute public float at the last two second-quarter ends on "
    "today's single-day basis and on the proposed 10-trading-day average, and count your months of reporting history.",
    "<b>If you crossed a line at June 30, 2026, plan on the current rules.</b> Three commenters asked for interim "
    "relief and the release offers none. Relief for fiscal 2026 would come only if a final rule takes effect before "
    "you file, so watch the effective date.",
    "<b>List who else expects the opinion.</b> A bank of $5 billion of assets or more stays under the FDIC's rule "
    "even if its holding company is exempt. "
    "In the governance survey, 97% named investor expectations and analyst coverage among the factors that would "
    "most influence whether they use the new accommodations, and 65% debt or equity offering requirements. Ask lenders, rating agencies and your largest holders before deciding.",
    "<b>Price the saving from a fee proposal, not from the release.</b> Ask the auditor what the audit costs "
    "without an opinion on controls; seven audit firms told the SEC the financial statement audit would absorb part of the work.",
    "<b>Take keep, drop or replace to the audit committee with evidence.</b> Material weaknesses and restatements "
    "in the last three years, turnover in finance, system changes under way, and who owns the shares.",
    "<b>Set the evidence standard for an assessment nobody else tests.</b> Scope, sample sizes, tester "
    "independence and deficiency evaluation need to be written down, because the auditor's file will no longer supply them.",
    "<b>Decide what you will say.</b> Beyond the cover-page check box, the proposal requires no statement on "
    "whether an attestation was obtained. Four commenters asked for one. Have the answer ready for the first investor who asks.",
    "<b>Keep what is hard to rebuild.</b> Control documentation, IT general control evidence and trained people. "
    "A company whose float stays at or above $2 billion for two consecutive years is back in scope (see the example in Section 2).",
]


def AUDITOR_TABLE(H):
    return (H.table(["The auditor's work", "With the attestation", "Without it"], [
        ["<b>Understanding of controls</b>", "Required", "Still required, for the design and implementation of "
         "relevant controls"],
        ["<b>Testing that controls operate</b>", "Required, to support an opinion on internal control",
         "Where the auditor relies on controls or cannot get enough evidence without them"],
        ["<b>Deficiencies the auditor finds</b>", "All deficiencies in writing to management; significant "
         "deficiencies and material weaknesses also to the audit committee", "Significant deficiencies and material "
         "weaknesses still in writing to both; <b>lesser deficiencies at the auditor's discretion</b>"],
        ["<b>Opinion on internal control</b>", "Public, in the annual report", "<b>None</b>"],
        ["<b>A material weakness that management has not reported</b>", "The auditor must say so in its report",
         "Goes in writing to management and the audit committee; <b>no public report</b>"],
        ["<b>Officers' certifications</b>", "CEO and CFO certify they have disclosed significant deficiencies and "
         "material weaknesses to the auditor and the audit committee", "<b>Unchanged</b>: the certification is now "
         "the main formal check on what management discloses"],
    ], widths=[30, 32, 38]) +
        H.note("Source: SEC Release 33-11419, pp. 61, 62 and 139; PCAOB AS 2110, AS 2301 (including paragraph 17), "
               "AS 1305 (paragraphs 4 and 7) and AS 2201 (paragraphs 78 to 81); Exchange Act Rules 13a-14 and 15d-14."))


CROSS = [
    "<b>Foreign private issuers.</b> A company from India or the Gulf that lists in the US on Form 20-F keeps the "
    "auditor's opinion from $75 million of worldwide float unless it is an emerging growth company, or it can "
    "switch to domestic forms to obtain the relief. A domestic filer of the same size would be exempt up to $2 billion.",
    "<b>India already asks for more.</b> Section 143(3)(i) of the Companies Act, 2013 has the auditor report on "
    "whether internal financial controls with reference to financial statements are adequate and operating "
    "effectively, for listed and unlisted companies alike. Private companies are exempt if they are one person "
    "or small companies, or have turnover under INR 50 crore or borrowings under INR 25 crore, and are up to date "
    "with their filings (MCA notification G.S.R. 583(E), June 13, 2017). A US parent that drops its attestation may still have an Indian subsidiary whose auditor reports on controls every year.",
    "<b>The UAE is moving the other way.</b> Abu Dhabi's Accountability Authority requires the auditor to report on "
    "the effectiveness of internal control over financial reporting at the entities it oversees (Chairman's "
    "Resolution No. 1 of 2017). The UAE's capital markets regulator requires listed public joint-stock companies "
    "to obtain an external auditor's opinion on internal control over financial reporting for 2026, unpublished, "
    "and to publish it with the board's internal control report from financial year 2027.",
    "<b>Saudi Arabia asks the board and the audit committee.</b> The board reviews the effectiveness of internal "
    "control each year and the audit committee publishes its opinion on its adequacy (CMA Corporate Governance "
    "Regulations, Articles 21, 87 and 88). A group reporting in more "
    "than one of these markets should build one control framework to the most demanding requirement it faces, not "
    "to the US floor.",
]


def HELP(H):
    cell = lambda t, when, out, desc, m=False: (
        '<td class="hc%s"><div class="h">%s</div><div class="w">%s</div><p><b>%s</b> %s</p></td>'
        % (" m" if m else "", t, when, out, desc))
    return ('<table class="help"><tr>' +
            cell("In or out?", "Before fiscal 2026 audit planning closes", "Filer status memo, one week.",
                 "Public float on both measurement bases for the last two years, months of reporting history, FDIC "
                 "and contractual overlays, and your expected status under the proposal and under the two "
                 "alternatives the file most supports.") +
            cell("Keep, drop or replace?", "Before the audit committee approves the next audit plan",
                 "Audit committee decision paper, three weeks.", "An evidence file on control history, what "
                 "investors and lenders expect, a fee comparison built from your auditor's own proposal, and a "
                 "recommendation the committee can minute.", True) +
            '</tr><tr>' +
            cell("What stands behind a management-only assessment?", "Before the first year without the opinion",
                 "404(a) evidence standard, six weeks.", "Scoping, testing and deficiency evaluation written to the "
                 "SEC's 2007 guidance for management, with a tester-independence model and a first-year test plan.") +
            cell("Foreign private issuer or multi-market group?", "Before your next Form 20-F",
                 "Cross-border control map, four weeks.", "One framework mapped to Section 404, India's internal "
                 "financial controls reporting and UAE or Saudi requirements, showing where a single test serves "
                 "all of them.", True) +
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
        ("Audit committee chair", "and the committee", "The auditor's opinion on internal control becomes a "
         "choice the committee makes, not a requirement it oversees.", "Keep, drop or replace, minuted on evidence "
         "before the next audit plan is approved.", "7.1"),
        ("CFO and chief accounting officer", "signing 302 and 906 certifications", "Certifications and "
         "management's 404(a) assessment are unchanged; the audit fee and the filing calendar may move.",
         "Price the saving from the auditor's fee proposal, and decide what to tell investors.", "4.1, 7"),
        ("SOX program leader", "and chief audit executive", "No external test of management's conclusion; the "
         "auditor still understands, and may test, controls.", "Write down the evidence standard: scope, samples, "
         "tester independence and deficiency evaluation.", "7.2"),
        ("Treasurer and investor relations", "lenders, rating agencies, holders", "Covenants, bank regulators and "
         "investors may still expect the opinion.", "List who expects it, and prepare the answer for the first "
         "investor who asks.", "7"),
        ("IPO candidate", "and its sponsors", "Five years without the attestation for every new registrant, not "
         "only emerging growth companies.", "Build controls to the standard the listing will need in year six, "
         "not year one.", "6.1"),
        ("Foreign private issuer", "or a group across the US, India and the Gulf", "Nothing, on Form 20-F: the "
         "opinion still starts at $75 million of float.", "Build one control framework to the most demanding "
         "market it reports in.", "7.2"),
    ]), "Source: Uniqus analysis of SEC Release 33-11419 and comment file S7-2026-18.")


def CAL(H):
    # v2: new — the calendar a finance leader plans against
    return H.exhibit_html("Where the rule stands", X.cal([
        ("May 2026", "Proposal issued May 19, beside proposals on semiannual reporting (May 5) and registered offering reform (May 19)", ""),
        ("June 30, 2026", "Fiscal 2026 status measured on today's rules for calendar-year companies", ""),
        ("July 20, 2026", "Comment period closed", ""),
        ("October 2026", "No final rule; the docket holds %s entries" % F["entries"], "now"),
        ("Final rule", "Timing and effective date not yet set; the release proposes no interim relief", "tbd"),
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
