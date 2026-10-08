# -*- coding: utf-8 -*-
from patch import run

A1b = [
("A1-08", """        ("May 19, 2026", "Proposal issued, with companion proposals on semiannual reporting and registered offerings", ""),""",
 """        ("May 2026", "Proposal issued May 19, beside proposals on semiannual reporting (May 5) and registered offering reform (May 19)", ""),"""),
("A1-12", """'<td><div class="l">2005, at adoption</div><div class="v">18%</div><div class="s">of listed companies; '""",
 """'<td><div class="l">2005, at adoption</div><div class="v">18%</div><div class="s">of companies on US markets; '"""),
("A1-12/A1-14", """listed companies and of their float, and “nearly 95 percent” is the SEC's wording, "
                          "so the 2005 and 2024 columns are not on the same base.")""",
 """companies on the NYSE, Amex, Nasdaq, OTC Bulletin Board and Pink Sheets and of their float, and "
                          "“nearly 95 percent” is the SEC's wording, so the 2005 and 2024 columns are not on the "
                          "same base. The $2 billion figures also apply the proposed 60-month seasoning and two-year "
                          "test; with today's 12-month seasoning the count would be 1,234 (20.6% of registrants).")"""),
]

if __name__ == "__main__":
    run(A1b, "A1b")
