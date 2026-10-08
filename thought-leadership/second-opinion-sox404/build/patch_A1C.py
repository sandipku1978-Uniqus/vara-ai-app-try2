# -*- coding: utf-8 -*-
from patch import run

A1 = [
("A1-04", """        H.p("Most finance leaders read the SEC's May 2026 filer status proposal as a cost saving \"""",
 """        H.p("Most finance leaders read the SEC's filer status proposal of May 19, 2026 (Release No. "
            "33-11419, <em>Enhancement of Emerging Growth Company Accommodations and Simplification of Filer "
            "Status for Reporting Companies</em>) as a cost saving \""""),
("A1-06", """adoption it captured 18% of companies, and today it captures <b>35.4% of registrants</b>. \"""",
 """adoption it captured 18% of companies on US markets, and today it captures <b>35.4% of registrants</b>. \""""),
("A1-09", """and in 2020 the SEC took issuers "
            "with revenue under $100 million out of accelerated filer status.")""",
 """and in 2020 the SEC took issuers "
            "eligible to be smaller reporting companies with revenue under $100 million out of accelerated and "
            "large accelerated filer status.")"""),
("A1-16", """        H.p("The $700 million line was set in 2005 and has not moved. At adoption it captured 18% of "
            "companies; today the same line captures <b>35.4% of registrants</b>. That drift is the SEC's "
            "strongest argument: adjusted for consumer prices the line would be $1.15 billion, and tracking "
            "the S&amp;P 500 it would be $3.85 billion.")))""",
 """        H.p("The $700 million line was set in 2005 and has not moved. At adoption it captured 18% of "
            "companies on US markets; today the same line captures <b>35.4% of registrants</b>. The SEC did "
            "not index it: adjusted for consumer prices the line would be $1.15 billion, and tracking the "
            "S&amp;P 500 it would be $3.85 billion. It chose $2 billion to restore coverage of “nearly 95 "
            "percent” of public float, and estimates that line covers 93.5%.")))"""),
("A1-22/A1-20/A1-21", """                  "Source: SEC Release 33-11419, EA Tables 5, 6 and 7 (pp. 139 to 142), SEC staff analysis of "
                  "Audit Analytics data. Categories are those of the current rules. Restatements are those "
                  "correcting errors material to previously issued financial statements; in that table the "
                  "accelerated and non-accelerated columns exclude emerging growth companies, whose rate was "
                  "14.7%. Of 757 accelerated filers, 125 are emerging growth companies and are not subject to "
                  "attestation. Differences reflect company size as well as regime.")""",
 """                  "Source: SEC Release 33-11419, EA Tables 5, 6 and 7 (pp. 118 to 122), SEC staff analysis of "
                  "Audit Analytics data. Categories are 2024 filer status under the current rules. EA Tables 5 "
                  "and 6 include emerging growth companies in each column; of 757 accelerated filers, 125 are "
                  "emerging growth companies and are not subject to attestation. Restatements are those "
                  "correcting errors material to previously issued financial statements; in that table the "
                  "accelerated and non-accelerated columns exclude emerging growth companies, whose rate was "
                  "14.7% (31.4% in fiscal 2021, when the SEC staff's statement on SPAC warrants drove "
                  "restatements). Differences reflect company size as well as regime.")"""),
("A1-24", """rate for non-accelerated filers is “only slightly higher” than for accelerated filers. \"""",
 """rate for non-accelerated filers is “only slightly higher” than for accelerated filers, and the "
            "non-accelerated group holds more low- or zero-revenue issuers, which restate less often. \""""),
("A1-27", """though "
            "fewer answered that question than others.""",
 """though "
            "the response rate to that question was lower than for others."""),
("A1-30", """the release cites one recent study that found no decline in reporting quality after the 2020 "
            "exemption,""",
 """the release cites a 2024 working paper that found no decline in internal control or financial "
            "reporting quality at issuers exempted in 2020,"""),
("A1-33", """             "Average closing price over the last 10 trading days of that quarter"],""",
 """             "Average closing price over the last 10 trading days of that quarter, times non-affiliate "
             "shares at quarter end"],"""),
("A1-34", """and $60 million for accelerated status", "Two""",
 """and $60 million for accelerated status, or on qualifying under the revenue test", "Two"""),
("A1-37", """["<b>Foreign private issuers on Form 20-F</b>", "Attestation from $75 million of float", "<b>Unchanged</b>"],""",
 """["<b>Foreign private issuers on Form 20-F</b>", "Attestation from $75 million of float", "<b>Unchanged</b>: "
             "$75 million of worldwide float, measured on a single day"],"""),
("A1-44", """must disclose material "
             "unresolved staff comments"],""",
 """must disclose material "
             "unresolved staff comments, which is new for them"],"""),
("A1-43", """             "Stays by statute, though the SEC expects it to be unnecessary in most circumstances"],""",
 """             "Stays by statute; the SEC expects reliance on it to be unnecessary in most circumstances. Only "
             "emerging growth companies keep confidential draft registration statements and the exemption from "
             "critical audit matters"],"""),
("A1-39", """total assets of $35 million or less at each of the last two second-quarter ends; "
             "10-K in 120 days, 10-Q in 50"],""",
 """total assets of $35 million or less at each of the last two second-quarter ends; "
             "10-K in 120 days, 10-Q in 50. The SEC estimates 1,072 companies"],"""),
("A1-53", """        H.note("Source: SEC Release 33-11419, pp. 9 to 13, 20 to 21, 28 to 33, 37 to 48, 56, 66 to 69, 83, 96 "
               "and 103.""",
 """        H.note("Source: SEC Release 33-11419, pp. 8 to 10, 16 to 17, 23, 25 to 33, 35 to 51, 56, 66 to 71, "
               "73 to 74, 83 and 87 to 88."""),
("A1-46/A1-47", """may present two "
            "years of financial statements where it now presents three, and is exempt from say-on-pay votes. "
            "The option to defer new accounting standards is narrower: it runs only for the first five years "
            "after initial registration.")""",
 """may present two "
            "years of financial statements where it now presents three, and would be exempt from say-on-pay, "
            "say-on-frequency and golden-parachute votes, an emerging growth company accommodation the SEC "
            "proposes to extend to all non-accelerated filers. It could also omit risk factors from Forms 10-K "
            "and 10-Q, market risk disclosure, the compensation discussion and analysis, pay ratio and pay "
            "versus performance. The option to defer new accounting standards to private-company dates is "
            "limited to a filer's first five years after registration, so most large accelerated filers that "
            "convert will not have it.")"""),
("A1-49", """from the attestation: %s that are large accelerated filers today and %s accelerated filers."
            % (""",
 """from the attestation: %s that are large accelerated filers today and %s accelerated filers. The "
            "other five of today's large accelerated filers lack the float data to classify. The 1,596 are 60% "
            "of the registrants that obtain an attestation today."
            % ("""),
("A1-50/A1-37", """        H.p("Two groups get less than the headline suggests. Banks are counted in the %s but stay subject to "
            "the FDIC's separate attestation rule, which since January 1, 2026 applies at $5 billion of assets "
            "or more. Foreign private issuers filing on Form 20-F or 40-F are outside the proposal and keep "
            "today's $75 million trigger." % F["exempt"]) +""",
 """        H.p("Two groups get less than the headline suggests. Banks are counted in the %s, but an insured "
            "bank with $5 billion or more of total assets remains subject to the FDIC's attestation requirement "
            "under 12 CFR Part 363, a threshold in effect since January 1, 2026; smaller banks lose the "
            "attestation with everyone else. The SEC estimates that 87 of 153 banking large accelerated filers "
            "would become non-accelerated. Foreign private issuers filing on Form 20-F or 40-F stay outside "
            "the new categories and keep today's $75 million trigger, measured on a single day." % F["exempt"]) +"""),
("A1-03", """        H.p("The docket holds %s entries, the latest dated September 8, 2026. Setting aside SEC staff \"""",
 """        H.p("As posted on October 5, 2026, the docket held %s entries, the latest dated September 8, 2026; "
            "letters posted since are not counted here. Setting aside SEC staff \""""),
("A1-15", """                  "EA Table 13, p. 207; Uniqus coding of comment file S7-2026-18 for commenter positions on the "
                  "level. EA Table 13 varies only the float line within the proposal, so its $700 million row "
                  "(1,665) differs from today's 2,115 large accelerated filers; the release does not reconcile the "
                  "two. Shares are of total public float.")""",
 """                  "EA Table 13, p. 177; Uniqus coding of comment file S7-2026-18 for the 51 commenters that "
                  "addressed the $2 billion figure. EA Table 13 applies the proposal's 60-month seasoning and "
                  "two-year test at each float line, so its $700 million row (1,665 large accelerated filers holding "
                  "95.2% of float) is not comparable with today's 2,115 holding 98.8%. Shares are of total public "
                  "float.")"""),
("A1-17/A1-12/A1-14", """"Source: SEC Release 33-11419 (May 19, 2026), pp. 12, 20 to 34, 40 to 42 and 150; SEC \"""",
 """"Source: SEC Release 33-11419 (May 19, 2026), pp. 9, 15 to 20, 27, 29 to 35 and 40 to 42; SEC \""""),
]

C = [
("C-split", """            ["<b>The $2 billion level</b>", "24 supported it, 15 wanted it lower, 3 higher; 9 opposed any increase",""",
 """            ["<b>The $2 billion level</b>", "Of the 51 that addressed the figure, 24 supported it, 15 wanted it "
             "lower, 3 higher and 9 opposed any increase","""),
("C-assoc", """The split runs by constituency. Every company, exchange and industry association that took "
              "a side supported the exemption.""",
 """The split runs by constituency. Every company, both exchanges and every business trade association "
              "that took a side supported the exemption."""),
("C-ex4", """The counts describe who wrote; they are not a forecast of how the "
                  "Commission will weigh each letter.")""",
 """Positions are on the exemption, not on the $2 billion figure. The "
                  "counts describe who wrote; they are not a forecast of how the Commission will weigh each letter.")"""),
]

if __name__ == "__main__":
    run(A1, "A1")
    run(C, "C")
