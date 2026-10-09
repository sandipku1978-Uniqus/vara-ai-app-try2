# -*- coding: utf-8 -*-
"""v3, step 1: fact fixes from the sec.gov files (F-01 to F-11), structure edits
(P-01 to P-06) and the section titles agreed at D-2. See ../plan/README.md."""
from patch import run

V3 = [
("F-01 quote", "“between $500–$1M annually”", "“between $500-$1M annually”"),
("F-01 cite", "Avalo Therapeutics (p. 1)", "Avalo Therapeutics (web comment)"),
("F-02", """IPOs is supportive of the five-year on-ramp but cautious about widening the exemption, and wrote:")""",
 """IPOs supports the proposal, including the five-year on-ramp, while warning that the wider exemption "
            "is “not costless”, and wrote:")"""),
("F-03", """The release says "
            "respondents to a 2008 and 2009 survey of 2,901 corporate insiders found the benefits to outweigh the "
            "costs, “especially as they gained experience with section 404(b)”. The study behind the survey "
            "is less favourable:""",
 """The release says "
            "respondents to a 2008 and 2009 survey of corporate insiders found the benefits to outweigh the "
            "costs, “especially as they gained experience with section 404(b)”. The study behind the survey, "
            "of 2,901 insiders, is less favourable:"""),
("F-04", """14.7% (31.4% in fiscal 2021, when the SEC staff's statement on SPAC warrants drove "
                  "restatements).""",
 """14.7% (31.4% in fiscal 2021, when restatements coincided with the SEC staff's statement on SPAC "
                  "warrants)."""),
("F-05", "pp. 12, 20 to 34, 40 to 42 and 150; SEC ", "pp. 12, 20 to 34, 40 to 42, 150 and 207; SEC "),
("F-06", """pp. 9 to 13, 20 to 21, 28 to 33, 37 to 48, 56, 66 to 69, 83, 96 "
               "and 103. Smaller""",
 """pp. 9 to 13, 20 to 21, 28 to 33, 37 to 48, 55 to 56, 61, 66 to 69, 81 "
               "to 84, 87 to 88, 96 and 103 to 106. Smaller"""),
("F-07a", "EA Tables 5, 6 and 7 (pp. 139 to 142), SEC staff analysis",
 "EA Tables 5, 6 and 7 (pp. 139 to 142) and EA Table 2 (p. 132), SEC staff analysis"),
("F-07b", "pp. 153 to 155 and 214 to 218, including GAO-25-107500",
 "pp. 153 to 155, 215 and 218, including GAO-25-107500"),
("F-08a", """Seven firms said the financial statement "
              "audit will absorb part of the work""",
 """Seven audit firms said the financial statement "
              "audit would absorb part of the work"""),
("F-08b", "seven firms told the SEC the financial statement audit will absorb part of the work.",
 "seven audit firms told the SEC the financial statement audit would absorb part of the work."),
("F-09", "from a biotech CFO in support, an audit firm already counted and one other. ",
 "from a biotech CFO in support, an audit firm already counted that restates its position, and a former "
 "PCAOB staff member who calls the exemption too broad. "),
("F-11", "opportunities available to U.S. investors.” (Linklaters LLP, comment letter, p. 2).",
 "opportunities available to U.S. investors” (Linklaters LLP, comment letter, p. 2)."),
("P-01", """"<b>New</b>: total assets of $35 million or less at each of the last two second-quarter ends; "
             "10-K in 120 days, 10-Q in 50. The SEC estimates 1,072 companies\"""",
 """"<b>New</b>: total assets of $35 million or less on the last day of the second fiscal quarter in "
             "each of the last two years, ending once assets exceed $35 million at both; 10-K in 120 days, "
             "10-Q in 50. The SEC estimates 1,072 companies\""""),
("P-02", """        ], widths=[27, 36, 37]) +
        H.h2("2.1 The filer categories, today and under the proposal") +""",
 """        ], widths=[27, 36, 37]) +
        H.p("Under the proposal, status would change only after two years on the same side of the threshold. "
            "For example, a calendar-year company with 60 months of reporting whose float first reaches "
            "$2 billion on June 30, 2027 would not be a large accelerated filer for fiscal 2027, but would "
            "become one for fiscal 2028 if its float is still $2 billion or more on June 30, 2028; a large "
            "accelerated filer would likewise need two years below $2 billion to leave, with no lower exit "
            "level like today's $560 million. The transition is the exception: when a final rule takes effect, "
            "a current large accelerated filer below $2 billion in either of the two prior years becomes "
            "non-accelerated.") +
        H.h2("2.1 The filer categories, today and under the proposal") +"""),
("P-03", "A company whose float stays at or above $2 billion for two consecutive years is back in scope.",
 "A company whose float stays at or above $2 billion for two consecutive years is back in scope (see the "
 "example in Section 2)."),
("P-04", "The \"\n            \"other five of today's large accelerated filers lack the float data to classify.",
 "The SEC \"\n            \"could not classify the other five of today's 2,115 large accelerated filers because their float "
 "data is missing."),
("P-05", """        H.rec(DECISIONS[:4], header="Eight decisions for the SOX program leader") +
        H.rec(DECISIONS[4:], header="Eight decisions for the SOX program leader, continued")))""",
 """        REC_OL(DECISIONS, "Eight decisions for the SOX program leader")))"""),
("P-05 css", ".rec li b{ color:#B21E7D; }",
 ".rec li b{ color:#B21E7D; }\n"
 ".rec ol.num{ margin:0; padding-left:6.2mm; }\n"
 ".rec ol.num li{ font-size:8.6pt; margin:0 0 1.3mm; padding-left:1mm; }\n"
 ".rec ol.num li::marker{ color:#B21E7D; font-weight:600; }"),
("P-05 fn", "\nDECISIONS = [",
 "\ndef REC_OL(items, header):\n"
 "    return ('<div class=\"rec\"><div class=\"hd\">%s</div><ol class=\"num\">%s</ol></div>'\n"
 "            % (header, \"\".join(\"<li>%s</li>\" % i for i in items)))\n\n\nDECISIONS = ["),
("P-06", "\"4,825 registrants; 1,596 newly exempt\"",
 "\"4,825 registrants in all: 1,596 newly exempt, and 3,229 that have no attestation today\""),
("D-2 nav", """NAV = ["Executive Summary", "1. How Section 404 Got Here", "2. What the SEC Proposed",
       "3. What the SEC Heard", "4. Two Questions the File Leaves Open",""",
 """NAV = ["Executive Summary", "1. How Section 404 Evolved", "2. What the SEC Proposed",
       "3. What the SEC Heard", "4. Two Questions Left Open","""),
("D-2 nav7", "\"7. What To Do Before the Final Rule\", \"How Uniqus Can Help\"]",
 "\"7. Actions Before a Final Rule\", \"How Uniqus Can Help\"]"),
("D-2 ref1", "(Refer Section 1: How Section 404 Got Here)", "(Refer Section 1: How Section 404 Evolved)"),
("D-2 ref4", "Two Questions the File Leaves Open)", "Two Questions Left Open)"),
("D-2 ref7", "(Refer Section 7: What To Do Before the Final Rule)",
 "(Refer Section 7: Actions to Consider Before a Final Rule)"),
("D-2 h1", "H.h1(\"1. How Section 404 Got Here\")", "H.h1(\"1. How Section 404 Evolved\")"),
("D-2 h4", "H.h1(\"4. Two Questions the File<br/>Leaves Open\")", "H.h1(\"4. Two Questions Left Open\")"),
("D-2 h7", "H.h1(\"7. What To Do Before the<br/>Final Rule\")",
 "H.h1(\"7. Actions to Consider Before<br/>a Final Rule\")"),
("D-2 h71", "H.h2(\"7.1 Keep, drop or replace\")", "H.h2(\"7.1 Retain, discontinue or replace\")"),
]

if __name__ == "__main__":
    run(V3, "v3-facts")
