# -*- coding: utf-8 -*-
from patch import run

B = [
("B-04", """the Society for Corporate "
                  "Governance (p. 7; member survey with nearly 50 responses).""",
 """the Society for Corporate "
                  "Governance (pp. 6 to 8; member survey that “attracted nearly 50 responses”)."""),
("B-04/v2", """        H.p("Neither set of numbers answers the controller's question:""",
 """        H.p("The same survey suggests the saving companies expect is smaller than the cost they report. "
            "<b>39% of respondents put the attestation's cost at $500,000 or more a year, but only 3% expect to "
            "save more than $500,000</b>, and 55% could not quantify the saving at all (pp. 6 and 7).") +
        H.p("Neither set of numbers answers the controller's question:"""),
("B-12/A2-06", """The one study on the file that measured the cost "
            "of capital after an actual exemption, for low-revenue issuers in 2020, found no significant "
            "difference.")""",
 """The only study we found on the file that "
            "measured the cost of capital after an actual exemption, of issuers with revenue under $100 million "
            "in 2020, found no significant difference; it is the study the release cites on reporting quality.")"""),
("B-13", """The figures offered trace largely to one 2009 study of companies whose control "
            "deficiencies were later cleared by an auditor.""",
 """The figures offered trace largely to one 2009 study that measured how the cost of "
            "equity moved when auditor-tested reports showed controls weakening or being fixed; it did not "
            "study the removal of the auditor's opinion."""),
("B-05b", """The academic whose study the release cites for the JOBS Act's effect on "
            "IPOs supports the proposal, and wrote:")""",
 """The academic whose study the release cites for the JOBS Act's effect on "
            "IPOs is supportive of the five-year on-ramp but cautious about widening the exemption, and wrote:")"""),
("B-05a", """enhances the frequency "
                   "and efficiency of corporate investment and innovation”</em>"]) +""",
 """enhances the frequency "
                   "and efficiency of corporate investment and innovation …”</em>"]) +"""),
("B-06", """The auditor "
            "reported ineffective controls at <b>8.5%</b> of companies with $700 million to $2 billion of float, "
            "against 3.8% above $2 billion. The typical newly exempted company, with $250 million to $2 billion "
            "of float, is followed by <b>4 to 6 analysts</b>, against 12 for companies that stay in scope.")""",
 """The auditor "
            "reported ineffective controls at <b>12.8%</b> of companies with $250 million to $700 million of float "
            "and <b>8.5%</b> at $700 million to $2 billion, against 3.8% above $2 billion. The typical newly "
            "exempted company is followed by <b>4 to 6 analysts</b>, against 12 for companies that stay in scope.")"""),
("B-06 cite", """Wong and Zhao, comment letter, pp. 2 and 4).""",
 """Wong and Zhao, comment letter, pp. 2 to 4)."""),
("B-11", """<b>Fewer firms will keep the capability.</b> One firm estimates that only six firms would perform "
              "integrated audits for ten or more issuers.""",
 """<b>Fewer firms will keep the capability.</b> One firm estimates, “based on current data”, that only "
              "six firms would likely perform integrated audits for ten or more issuers."""),
("B-09", """An academic committee's letter, citing a 2017 study of small companies, adds""",
 """The American Accounting Association's Financial Reporting Policy Committee, citing a 2017 study of "
            "small companies, adds"""),
("B-14c", """A letter with more than 100 academic "
            "signatories is one commenter,""",
 """A letter with 115 signatories, most of them "
            "academics, is one commenter,"""),
("B-v2 survey", """    "<b>List who else expects the opinion.</b> Banks stay under the FDIC's rule at $5 billion of assets or more. "
    "Ask lenders, rating agencies and your largest holders before deciding.",""",
 """    "<b>List who else expects the opinion.</b> Banks of $5 billion of assets or more stay under the FDIC's rule. "
    "In the governance survey, 97% named investor expectations and analyst coverage as a deciding factor and 65% "
    "debt or equity offering requirements. Ask lenders, rating agencies and your largest holders before deciding.","""),
]

if __name__ == "__main__":
    run(B, "B")
