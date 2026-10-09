# -*- coding: utf-8 -*-
"""v3, step 4: How Uniqus Can Help rebuilt around the GRC practice (source: Uniqus GRC
brochure supplied by Sandip Khetan, October 9, 2026). The 'no audit fee at stake'
sentence is removed at his request."""
from patch import run
HELPED = [
("H-intro", """H.p("We support companies at each of the four decision points below. For a company that will remain a "
            "large accelerated filer, or an emerging growth company in its first five years, the proposal does "
            "not change the SOX program. Because we do not provide audits, we have no audit fee at stake in "
            "whether a company retains the attestation.") +
        HELP(H) +
        H.p("To discuss any of these, please contact <b>Sandip Khetan</b>, Co-Founder and Global Head of "
            "Accounting &amp; "
            "Reporting Consulting, through www.uniqus.com.") +""",
 """H.p("Our Governance, Risk &amp; Compliance practice supports companies at each of the four decision "
            "points below. For a company that will remain a large accelerated filer, or an emerging growth "
            "company in its first five years, the proposal does not change the SOX program.") +
        HELP(H) +
        GRC() +
        H.p("To discuss any of these, please contact <b>Sandip Khetan</b>, Co-Founder and Global Head of "
            "Accounting &amp; Reporting Consulting, or <b>Nagaraj Uchil</b>, who leads our Governance, Risk "
            "&amp; Compliance practice, through www.uniqus.com.") +"""),
("H-fn", "\n\nABOUT = (",
 """

GRC_ITEMS = [
    ("Internal controls", "Design and management testing of controls under SOX in the US, internal financial "
     "controls in India and ICOFR requirements in the Middle East."),
    ("Internal audit", "Financial and controls, IT and AI, compliance and operational audits, guided by the "
     "IIA's Global Internal Audit Standards."),
    ("Enterprise risk management", "Maturity assessments, frameworks and policy, risk appetite, key risk "
     "indicators, and risk monitoring and reporting."),
    ("Compliance, policies and procedures", "Compliance risk assessments and obligation registers; board "
     "charters, delegation of authority and codes of conduct."),
    ("Organizational resilience", "Business impact analysis, business continuity and IT disaster recovery, "
     "and cyber and supply chain resilience."),
    ("Risk UniVerse", "Our GRC platform: AI-driven control testing, and an engine that turns meeting "
     "transcripts and recordings into process narratives, flow diagrams and risk and control matrices."),
]


def GRC():
    cells = ['<td><div class="g">%s</div><p>%s</p></td>' % (t, d) for t, d in GRC_ITEMS]
    rows = "".join("<tr>%s</tr>" % "".join(cells[i:i + 3]) for i in range(0, 6, 3))
    return ('<div class="grc"><div class="gh">Our Governance, Risk &amp; Compliance practice</div>'
            '<table>%s</table></div>' % rows)


ABOUT = ("""),
("H-css", ".rec li b{ color:#B21E7D; }",
 ".rec li b{ color:#B21E7D; }\n"
 ".grc{ margin:1mm 0 2.4mm 0; page-break-inside:avoid; }\n"
 ".grc .gh{ font-weight:600; font-size:9.4pt; color:#482879; margin:0 0 1.4mm 0; }\n"
 ".grc table{ border-collapse:separate; border-spacing:2mm 1.6mm; margin:0 0 0 -2mm; width:102.7%; }\n"
 ".grc td{ width:33.3%; vertical-align:top; background:#F5F1F9; border-radius:2mm; padding:1.8mm 2.4mm; border:none; }\n"
 ".grc .g{ font-weight:600; font-size:7.6pt; color:#B21E7D; margin-bottom:0.6mm; }\n"
 ".grc p{ font-size:6.9pt; line-height:1.38; text-align:left; margin:0; color:#33333D; }"),
]
if __name__ == "__main__":
    run(HELPED, "v3-help")
