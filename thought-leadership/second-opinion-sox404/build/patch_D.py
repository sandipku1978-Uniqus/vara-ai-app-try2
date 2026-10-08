# -*- coding: utf-8 -*-
from patch import run

D = [
("D-05", """in "
            "2010 Congress exempted non-accelerated filers by statute, after the SEC had deferred them since "
            "2003.""",
 """in "
            "2010 Congress exempted non-accelerated filers from the auditor's attestation by statute, after the "
            "SEC had repeatedly deferred it for them."""),
("D-23", """        H.p("Those closest to the work came to see value in it. In a survey of corporate insiders in 2008 "
            "and 2009, cited in the release, respondents judged the benefits of Section 404(b) compliance to "
            "outweigh the costs, “especially as they gained experience with section 404(b)”, though "
            "the response rate to that question was lower than for others.""",
 """        H.p("Those closest to the work saw value in it, though not enough to pay for it. The release says "
            "respondents to a 2008 and 2009 survey of 2,901 corporate insiders found the benefits to outweigh the "
            "costs, “especially as they gained experience with section 404(b)”. The study behind the survey "
            "is less favourable: on average respondents did not judge the benefits to outweigh the costs, though "
            "perceived net benefits were higher where an auditor attested and rose with experience."""),
("D-21/22", """What the record does show is what is being given up: <b>an independent test that, "
            "in the SEC staff's own study of accelerated filers, found what management had not.</b>")""",
 """What the record does show is what is being given up: <b>an independent test that, "
            "in the research the SEC staff reviewed in 2011, brought out deficiencies management had not "
            "disclosed.</b> That study covered companies with $75 million to $250 million of float and "
            "recommended against widening the exemption.")"""),
("D-21 exec", """Over the same years restatements fell and the SEC's staff found that auditor testing "
              "brought out control deficiencies management had not disclosed,""",
 """Over the same years restatements fell and the SEC's staff concluded from the research that "
              "auditor testing brought out control deficiencies management had not disclosed,"""),
("D-27", """"Significant deficiencies and material "
         "weaknesses still in writing to both; <b>lesser deficiencies no longer have to be</b>"],""",
 """"Significant deficiencies and material "
         "weaknesses still in writing to both; <b>lesser deficiencies at the auditor's discretion</b>"],"""),
("D-28", """         "Goes to management and the audit committee, to weigh in management's assessment"],""",
 """         "Goes in writing to management and the audit committee; <b>no public report</b>"],"""),
("D-27 src", """AS 1305 and AS 2201 (paragraphs 78 to 81);""", """AS 1305 (paragraphs 4 and 7) and AS 2201 (paragraphs 78 to 81);"""),
("D-30", """Banks are counted in the %s, but an insured "
            "bank with $5 billion or more of total assets remains subject to the FDIC's attestation requirement "
            "under 12 CFR Part 363, a threshold in effect since January 1, 2026; smaller banks lose the "
            "attestation with everyone else.""",
 """Banks are counted in the %s, but an insured "
            "bank with $5 billion or more of total assets remains subject to the FDIC's attestation requirement "
            "under 12 CFR Part 363, a threshold in effect since January 1, 2026. The FDIC rule applies to the "
            "bank, not the holding company, so a holding company that drops the attestation may still need one "
            "for its bank."""),
("D-30b", """"<b>List who else expects the opinion.</b> Banks of $5 billion of assets or more stay under the FDIC's rule. \"""",
 """"<b>List who else expects the opinion.</b> A bank of $5 billion of assets or more stays under the FDIC's rule "
    "even if its holding company is exempt. \""""),
("D-36", """             "Four audit firms", "A second look at how many companies fall out, a test that looks past public "
             "float alone, and refreshed PCAOB guidance on auditing internal control.""",
 """             "Four audit firms", "A second look at how many companies fall out, a test that looks past public "
             "float alone, and refreshed PCAOB guidance on auditing internal control, which is not on the PCAOB's "
             "standard-setting agenda of September 30, 2026."""),
("D-16", """Ideagen Audit Analytics, on its own count, "
            "recorded 391 in 2025, the second lowest year in its 20-year database.""",
 """Ideagen Audit Analytics, counting from the "
            "same database without the Center's adjustment for blank-check companies, recorded 391 in 2025, the "
            "second lowest year in its 20-year database after 2020."""),
]

if __name__ == "__main__":
    run(D, "D")
