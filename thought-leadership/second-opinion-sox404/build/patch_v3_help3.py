# -*- coding: utf-8 -*-
"""v3, step 4c: 'Why Uniqus' as a compact three-column strip so the GRC page holds on one page."""
from patch import run
H3 = [
("H3-call", 'H.prac("Why Uniqus", WHY_GRC) +', 'WHY() +'),
("H3-data", '''WHY_GRC = [
    "<b>Risk UniVerse.</b> Our GRC platform centralizes controls data, automates workflows and dashboards, and "
    "uses AI to automate control testing and to turn meeting transcripts and recordings into process "
    "narratives, flow diagrams and risk and control matrices.",
    "<b>Experienced leadership.</b> Nagaraj Uchil leads the practice, with more than 20 years in internal "
    "controls and SOX, enterprise risk, compliance, governance and IPO readiness, supported by local leaders "
    "in each of our markets.",
    "<b>One team across three markets.</b> An integrated team across the US, India and the Middle East "
    "combines onsite presence with offshore delivery, with close partner and director involvement.",
]''',
 '''WHY_GRC = [
    ("Risk UniVerse", "Our GRC platform centralizes controls data and workflows, uses AI to automate control "
     "testing, and turns meeting transcripts and recordings into process narratives, flow diagrams and risk "
     "and control matrices."),
    ("Experienced leadership", "Nagaraj Uchil leads the practice, with more than 20 years in internal controls "
     "and SOX, enterprise risk, compliance, governance and IPO readiness."),
    ("One team, three markets", "An integrated team across the US, India and the Middle East combines onsite "
     "presence with offshore delivery and close partner involvement."),
]


def WHY():
    cells = "".join('<td><div class="g">%s</div><p>%s</p></td>' % (t, d) for t, d in WHY_GRC)
    return ('<div class="grc why"><div class="gh">Why Uniqus</div><table><tr>%s</tr></table></div>' % cells)'''),
("H3-css", ".grc td{ width:50%;", ".grc td{ width:50%;"),
]
if __name__ == "__main__":
    run(H3, "v3-help3")
