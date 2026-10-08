# -*- coding: utf-8 -*-
from patch import run

E = [
("E-18", """The authors of one of those studies, in a 2025 update, date the "
            "US listing gap to 1999, three years before Sarbanes-Oxley.")""",
 """Three of the authors of one of those studies, updating it in 2025 "
            "with a co-author, date the US listing gap to 1999, three years before Sarbanes-Oxley, and find "
            "that it widened only slowly through 2023.")"""),
("E-19/E-20", """A foreign private issuer on Form "
            "20-F still needs the auditor's opinion at $75 million of float while a domestic competitor is "
            "exempt up to $2 billion.""",
 """A foreign private issuer on Form "
            "20-F would still need the auditor's opinion once its worldwide public float reaches $75 million, "
            "unless it is an emerging growth company, while a domestic competitor is exempt up to $2 billion. "
            "The SEC says it is holding back relief for these issuers until it completes the review of their "
            "eligibility that it opened with a June 2025 concept release."""),
("E-19", """    "<b>Foreign private issuers.</b> A company from India or the Gulf that lists in the US on Form 20-F keeps the "
    "auditor's opinion from $75 million of float. A domestic filer of the same size would be exempt up to $2 billion.",""",
 """    "<b>Foreign private issuers.</b> A company from India or the Gulf that lists in the US on Form 20-F keeps the "
    "auditor's opinion from $75 million of worldwide float unless it is an emerging growth company, or it can "
    "switch to domestic forms to obtain the relief. A domestic filer of the same size would be exempt up to $2 billion.","""),
("E-22", """effectively, for listed and unlisted companies alike, apart from certain small private companies. A US parent "
    "that drops""",
 """effectively, for listed and unlisted companies alike. Private companies are exempt if they are one person "
    "or small companies, or have turnover under INR 50 crore or borrowings under INR 25 crore, and are up to date "
    "with their filings (MCA notification G.S.R. 583(E), June 13, 2017). A US parent that drops"""),
("E-25/E-26/E-27", """    "<b>The UAE is moving the other way.</b> Abu Dhabi's Accountability Authority requires the auditor to report on "
    "the effectiveness of internal control over financial reporting at the entities it oversees, and UAE listed "
    "companies are reported to be in a phased move toward an auditor's opinion on internal control; Saudi Arabia "
    "relies on the board's annual review and the audit committee's published opinion. A group""",
 """    "<b>The UAE is moving the other way.</b> Abu Dhabi's Accountability Authority requires the auditor to report on "
    "the effectiveness of internal control over financial reporting at the entities it oversees (Chairman's "
    "Resolution No. 1 of 2017). The UAE's capital markets regulator requires listed public joint-stock companies "
    "to obtain an external auditor's opinion on internal control over financial reporting for 2026, unpublished, "
    "and to publish it with the board's internal control report from financial year 2027.",
    "<b>Saudi Arabia asks the board and the audit committee.</b> The board reviews the effectiveness of internal "
    "control each year and the audit committee publishes its opinion on its adequacy (CMA Corporate Governance "
    "Regulations, Articles 21, 87 and 88). A group"""),
("E-35", """Uniqus Consultech is a global '
         'tech-enabled consulting company specializing in Accounting &amp; Reporting, Governance, Risk &amp; '
         'Compliance, Sustainability &amp; Climate, and Tech Consulting.""",
 """Uniqus Consultech is an AI and global '
         'tech-enabled consulting company that specializes in Accounting &amp; Reporting Consulting, Governance, '
         'Risk &amp; Compliance, Sustainability &amp; Climate Consulting, Tech Consulting, and Valuations."""),
("E-28/29/30", """Uniqus has a global team of 700+ professionals led by 85+ Partners &amp; '
         'Directors across eleven offices""",
 """Uniqus has a global team of 800 professionals, led by 100 Partners and '
         'Directors, across 13 offices"""),
("E-06", """including foreign companies listed only there and excluding investment funds; 1996 is the peak. \"""",
 """including foreign companies listed only there and excluding investment funds and holding companies, so a "
        "foreign company also listed at home is not counted; 1996 is the peak. \""""),
("E-09/E-12/E-16", """funds, SPACs and, from 2026, unit offerings. 2026 is January to September. The two offerings are SpaceX "
        "($75.0 billion) and SK hynix ($26.5 billion), which was already listed in Korea.")""",
 """funds, SPACs and, from 2026, unit offerings. 2023 is as restated in Renaissance's quarterly series (earlier "
        "reviews: 108 IPOs, $19.4 billion); 2026 is January to September, as restated in the 3Q 2026 review. The "
        "two offerings are SpaceX ($75.0 billion, June 2026) and SK hynix ($26.5 billion of American depositary "
        "receipts, July 2026; its primary listing remains in Seoul).")"""),
]

if __name__ == "__main__":
    run(E, "E")
