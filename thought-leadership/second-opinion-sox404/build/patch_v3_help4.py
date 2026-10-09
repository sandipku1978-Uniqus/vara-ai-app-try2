# -*- coding: utf-8 -*-
"""v3, step 4d: GRC content moved into the four existing help boxes, replacing their
content; the separate GRC page and the 'Why Uniqus' strip are removed (Sandip Khetan,
October 9, 2026: 'very sharp and trimmed ... within the existing boxes')."""
from patch import run
H4 = [
("H4-sec", '''        H.p("Our Governance, Risk &amp; Compliance practice supports companies at each of the four decision "
            "points below. For a company that will remain a large accelerated filer, or an emerging growth "
            "company in its first five years, the proposal does not change the SOX program.") +
        HELP(H) +
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
        WHY() +
        ABOUT))''',
 '''        H.p("Our Governance, Risk &amp; Compliance practice helps companies design, test and sustain internal "
            "control across the US, India and the Middle East. For a company that will remain a large "
            "accelerated filer, or an emerging growth company in its first five years, the proposal does not "
            "change the SOX program.") +
        HELP(H) +
        H.p("To discuss any of these, please contact <b>Sandip Khetan</b>, Co-Founder and Global Head of "
            "Accounting &amp; Reporting Consulting, or <b>Nagaraj Uchil</b>, who leads our Governance, Risk "
            "&amp; Compliance practice, through www.uniqus.com.") +
        ABOUT))'''),
("H4-boxes", '''            cell("Confirming filer status", "Before fiscal 2026 audit planning closes", "Filer status memo, one week.",
                 "An analysis of public float on both measurement bases for the last two years, months of "
                 "reporting history, FDIC and contractual requirements, and your expected status under the "
                 "proposal and the two alternatives commenters most support.") +
            cell("Retain, discontinue or replace", "Before the audit committee approves the next audit plan",
                 "Audit committee decision paper, three weeks.", "An evidence base on control history and investor "
                 "and lender expectations, a fee comparison built from your auditor's own proposal, and a "
                 "recommendation the committee can record in its minutes.", True) +
            '</tr><tr>' +
            cell("Supporting a management-only assessment", "Before the first year without the auditor's attestation",
                 "404(a) evidence standard, six weeks.", "Scoping, testing and deficiency evaluation documented in "
                 "line with the SEC's 2007 guidance for management, together with a tester-independence model and "
                 "a first-year test plan.") +
            cell("Foreign private issuers and multi-market groups", "Before your next Form 20-F",
                 "Cross-border control map, four weeks.", "A single framework mapped to Section 404, India's "
                 "internal financial controls reporting and UAE or Saudi requirements, identifying where one test "
                 "can satisfy several regimes.", True) +''',
 '''            cell("Internal controls design and testing", "For a company relying on management's assessment alone",
                 "SOX, IFC and ICOFR programs.", "Control design and management testing, scoped and documented "
                 "in line with the SEC's 2007 guidance, so the Section 404(a) conclusion rests on its own "
                 "evidence; one framework for groups reporting in more than one market.") +
            cell("Internal audit", "For a company replacing the attestation with a scaled alternative",
                 "Independent challenge without an annual opinion.", "Risk-based internal audit under the IIA's "
                 "Global Internal Audit Standards, covering financial, IT and AI controls, with periodic reviews "
                 "the audit committee can rely on.", True) +
            '</tr><tr>' +
            cell("Risk, compliance and governance", "For boards and audit committees",
                 "Oversight that does not depend on the auditor.", "Enterprise risk frameworks, risk appetite and "
                 "key risk indicators, compliance obligation registers, board and committee charters, delegation "
                 "of authority and business continuity.") +
            cell("Risk UniVerse", "For every option, including a retained attestation",
                 "Our AI-enabled GRC platform.", "Centralizes controls data and workflows, automates control "
                 "testing, and turns walkthrough recordings into process narratives, flow diagrams and risk and "
                 "control matrices.", True) +'''),
("H4-fns", '''GRC_ITEMS = [''', '''_GRC_REMOVED = [''') ,
]
if __name__ == "__main__":
    run(H4, "v3-help4")
