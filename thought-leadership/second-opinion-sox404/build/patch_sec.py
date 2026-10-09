# -*- coding: utf-8 -*-
"""Register S: items checked against www.sec.gov (and the commenter's own copy
where the SEC PDF could not be fetched). See factcheck/fc_S.md."""
from patch import run

S = [
("S-01", """Governance (pp. 6 to 8; member survey that “attracted nearly 50 responses”). The CFO's letter reads \"""",
 """Governance (p. 7; its member survey “attracted nearly 50 responses”, p. 1, note 1). The CFO's letter reads \""""),
("S-02", """<b>39% of respondents put the attestation's cost at $500,000 or more a year, but only 3% expect to "
            "save more than $500,000</b>, and 55% could not quantify the saving at all (pp. 6 and 7).""",
 """<b>Taken together, its two top cost bands put the attestation's cost at $500,000 or more a year for 39% "
            "of respondents, but only 3% expect non-accelerated status to save them more than $500,000</b>, and "
            "55% could not quantify the saving at all (pp. 6 and 7)."""),
("S-03", """In the governance survey, 97% named investor expectations and analyst coverage as a deciding factor and 65% "
    "debt or equity offering requirements.""",
 """In the governance survey, 97% named investor expectations and analyst coverage among the factors that would "
    "most influence whether they use the new accommodations, and 65% debt or equity offering requirements."""),
("S-04", """the method is set out in “How we read the file”. Constituencies are sorted from "
                  "most supportive to most opposed. The 11""",
 """the method is set out in “How we read the file”. Not counted: three letters posted October 5 "
                  "to 8, 2026, from a biotech CFO in support, an audit firm already counted and one other. "
                  "The 11"""),
("S-05", """One letter, from the Texas Society of CPAs, could not be "
                  "opened on the docket and was read from the society's website.""",
 """The Texas Society of CPAs letter could not be "
                  "opened on the docket and was read from the society's website."""),
]

if __name__ == "__main__":
    run(S, "S")
