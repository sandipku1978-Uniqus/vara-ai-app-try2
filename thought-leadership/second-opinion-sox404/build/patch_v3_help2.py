# -*- coding: utf-8 -*-
"""v3, step 4b: the GRC practice moves to its own closing page with About Uniqus."""
from patch import run
H2 = [
("H2-move", """        HELP(H) +
        GRC() +
        H.p("To discuss any of these, please contact <b>Sandip Khetan</b>, Co-Founder and Global Head of "
            "Accounting &amp; Reporting Consulting, or <b>Nagaraj Uchil</b>, who leads our Governance, Risk "
            "&amp; Compliance practice, through www.uniqus.com.") +
        ABOUT))""",
 """        HELP(H) +
        H.p("To discuss any of these, please contact <b>Sandip Khetan</b>, Co-Founder and Global Head of "
            "Accounting &amp; Reporting Consulting, or <b>Nagaraj Uchil</b>, who leads our Governance, Risk "
            "&amp; Compliance practice, through www.uniqus.com.")))
    P.append(H.cont(8,
        '<div style="page-break-before:always"></div>' +
        H.h2("Our Governance, Risk &amp; Compliance practice") +
        H.p("We help organizations identify and manage risk, strengthen governance, drive end-to-end "
            "compliance, design and test internal controls, and build resilience. We also deploy platforms "
            "that digitize, automate and apply AI to these functions.") +
        GRC() +
        H.prac("Why Uniqus", WHY_GRC) +
        ABOUT))"""),
("H2-items", '''GRC_ITEMS = [
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
]''',
 '''GRC_ITEMS = [
    ("Internal controls design and testing", "Design of controls and management testing under SOX in the US, "
     "internal financial controls in India and ICOFR requirements in the Middle East, including the evidence "
     "behind a management-only assessment."),
    ("Internal audit", "Risk-based internal audit guided by the IIA's Global Internal Audit Standards: "
     "financial and controls audits, IT and AI audits, compliance, operational and capital project audits, "
     "and special investigations."),
    ("Enterprise risk management", "ERM maturity assessments and program implementation, frameworks and "
     "policy, risk appetite and tolerance, key risk indicators, risk culture, and monitoring and reporting."),
    ("Compliance", "Regulatory risk assessments, compliance obligation registers, monitoring and reporting, "
     "and updates on regulatory developments."),
    ("Policies and procedures", "Board and committee charters, delegation of authority, codes of conduct "
     "and conflict-of-interest policies, with training and support."),
    ("Organizational resilience", "Business impact analysis, business continuity and IT disaster recovery, "
     "and cyber and supply chain resilience."),
]

WHY_GRC = [
    "<b>Risk UniVerse.</b> Our GRC platform centralizes controls data, automates workflows and dashboards, and "
    "uses AI to automate control testing and to turn meeting transcripts and recordings into process "
    "narratives, flow diagrams and risk and control matrices.",
    "<b>Experienced leadership.</b> Nagaraj Uchil leads the practice, with more than 20 years in internal "
    "controls and SOX, enterprise risk, compliance, governance and IPO readiness, supported by local leaders "
    "in each of our markets.",
    "<b>One team across three markets.</b> An integrated team across the US, India and the Middle East "
    "combines onsite presence with offshore delivery, with close partner and director involvement.",
]'''),
("H2-grid", """    rows = "".join("<tr>%s</tr>" % "".join(cells[i:i + 3]) for i in range(0, 6, 3))
    return ('<div class="grc"><div class="gh">Our Governance, Risk &amp; Compliance practice</div>'
            '<table>%s</table></div>' % rows)""",
 """    rows = "".join("<tr>%s</tr>" % "".join(cells[i:i + 2]) for i in range(0, 6, 2))
    return '<div class="grc"><table>%s</table></div>' % rows"""),
("H2-css", ".grc td{ width:33.3%;", ".grc td{ width:50%;"),
("H2-css2", ".grc p{ font-size:6.9pt; line-height:1.38;", ".grc p{ font-size:7.6pt; line-height:1.42;"),
("H2-css3", ".grc .g{ font-weight:600; font-size:7.6pt;", ".grc .g{ font-weight:600; font-size:8.6pt;"),
("H2-css4", ".grc td{ width:50%; vertical-align:top; background:#F5F1F9; border-radius:2mm; padding:1.8mm 2.4mm;",
 ".grc td{ width:50%; vertical-align:top; background:#F5F1F9; border-radius:2mm; padding:2.6mm 3.2mm;"),
]
if __name__ == "__main__":
    run(H2, "v3-help2")
