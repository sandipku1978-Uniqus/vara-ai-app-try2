# -*- coding: utf-8 -*-
from patch import run

# Page numbers: A1 compared against the Federal Register public-inspection copy, whose pagination
# diverges from the SEC PDF (A2-38: ratio ~1.17 in the economic analysis). The paper's original page
# citations are consistent with the SEC PDF, so A1's page edits are reverted pending a check on sec.gov.
REVERT = [
("A2-38 revert A1-22", "EA Tables 5, 6 and 7 (pp. 118 to 122)", "EA Tables 5, 6 and 7 (pp. 139 to 142)"),
("A2-38 revert A1-15", "EA Table 13, p. 177;", "EA Table 13, p. 207;"),
("A2-38 revert A1-17", "pp. 9, 15 to 20, 27, 29 to 35 and 40 to 42; SEC", "pp. 12, 20 to 34, 40 to 42 and 150; SEC"),
("A2-38 revert A1-53", """pp. 8 to 10, 16 to 17, 23, 25 to 33, 35 to 51, 56, 66 to 71, "
               "73 to 74, 83 and 87 to 88.""", """pp. 9 to 13, 20 to 21, 28 to 33, 37 to 48, 56, 66 to 69, 83, 96 "
               "and 103."""),
]

A2 = [
("A2-04", """        H.p("Issuers put the figure higher, at or above the top of the range the release itself reports. One "
            "listed company cited by Nasdaq and one biotech CFO each put it at $500,000 to $1 million a year. A "
            "governance association's member survey points the same way.") +""",
 """        H.p("Issuers put the figure higher. One listed company cited by Nasdaq and one biotech CFO each put it "
            "at $500,000 to $1 million a year, a range that spans the top estimates the release itself reports, "
            "$759,000 and $800,000. A governance association's member survey points the same way.") +"""),
("A2-03", """from $73,165 in audit fees "
                  "for companies under $300 million to approximately $800,000 all-in.""",
 """from $73,165 in audit fees "
                  "for companies under $300 million of market capitalization to approximately $800,000 all-in for "
                  "a sample of four to seven biotech companies. GAO measured a median rise of $219,000 (13%) in "
                  "the year companies began the attestation and treats it as a proxy for its cost."""),
("A2-17", """    inner = X.ladder(rows, "<b>Until a final rule takes effect, today's lines still apply.</b> A company that "
                           "becomes an accelerated or large accelerated filer on its 2026 measurement date is in "
                           "scope for fiscal 2026. <em>The release proposes no interim relief.</em>")""",
 """    inner = X.ladder(rows, "<b>Until a final rule takes effect, today's lines still apply.</b> A company that "
                           "crossed a line on June 30, 2026 needs the attestation for fiscal 2026 unless a final rule "
                           "takes effect before it files that annual report: under the proposed transition, status is "
                           "reassessed as of the fiscal year-end before the effective date, and relief applies from the "
                           "next filing. <em>The release proposes no interim relief.</em>")"""),
("A2-17b", """    "<b>If you crossed a line at June 30, 2026, plan on the current rules.</b> Three commenters asked for interim "
    "relief and the release offers none.",""",
 """    "<b>If you crossed a line at June 30, 2026, plan on the current rules.</b> Three commenters asked for interim "
    "relief and the release offers none. Relief for fiscal 2026 would come only if a final rule takes effect before "
    "you file, so watch the effective date.","""),
("A2-14", """         "Outside the proposal", "The auditor's attestation continues from $75 million of float.",
         "1,144 filers on these forms in 2024", "", "No: go to question 2"),""",
 """         "Outside the new categories", "The auditor's attestation continues from $75 million of worldwide float, "
         "unless an emerging growth company.", "1,144 filers on these forms in 2024, 498 of them emerging growth "
         "companies", "", "No: go to question 2"),"""),
("A2-19", """that approximately 88% of 2024 IPOs were by emerging growth companies,""",
 """that approximately 88% of 2024 IPOs, excluding funds and direct listings, were by emerging growth companies,"""),
("A2-24/D", """        ["<b>Deficiencies the auditor finds</b>", "Reported in writing to management and the audit committee",
         "<b>Unchanged</b>"],""",
 """        ["<b>Deficiencies the auditor finds</b>", "All deficiencies in writing to management; significant "
         "deficiencies and material weaknesses also to the audit committee", "Significant deficiencies and material "
         "weaknesses still in writing to both; <b>lesser deficiencies no longer have to be</b>"],"""),
("v2-302", """        ["<b>A material weakness that management has not reported</b>", "The auditor must say so in its report",
         "Goes to management and the audit committee, to weigh in management's assessment"],
    ], widths=[30, 32, 38]) +""",
 """        ["<b>A material weakness that management has not reported</b>", "The auditor must say so in its report",
         "Goes to management and the audit committee, to weigh in management's assessment"],
        ["<b>Officers' certifications</b>", "CEO and CFO certify they have disclosed significant deficiencies and "
         "material weaknesses to the auditor and the audit committee", "<b>Unchanged</b>: the certification is now "
         "the main formal check on what management discloses"],
    ], widths=[30, 32, 38]) +"""),
("v2-302src", """        H.note("Source: SEC Release 33-11419, pp. 61, 62 and 139; PCAOB AS 2110, AS 2301 (including paragraph 17), "
               "AS 1305 and AS 2201."))""",
 """        H.note("Source: SEC Release 33-11419, pp. 61, 62 and 139; PCAOB AS 2110, AS 2301 (including paragraph 17), "
               "AS 1305 and AS 2201 (paragraphs 78 to 81); Exchange Act Rules 13a-14 and 15d-14."))"""),
]

if __name__ == "__main__":
    run(REVERT, "revert")
    run(A2, "A2")
