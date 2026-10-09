# -*- coding: utf-8 -*-
"""v3, step 3: comment-letter counts re-derived from the double-coded re-read of all
188 letters (plan/coding/, tally_2026-10-09.txt). Distinct commenters follow the
paper's definition: entries less memoranda, the transcript and duplicates (174);
117 addressed the attestation, 57 did not."""
import sys
from patch import run

SO = [
("C-F", 'entries="192", commenters="172", addressed="118", silent="54",\n    oppose="75", support="32", nopos="11", toobroad="32", dne="43",',
 'entries="192", commenters="174", addressed="117", silent="57",\n    oppose="80", support="31", nopos="6", toobroad="33", dne="47",'),
("C-tile2", """("75 of 118", "Commenters addressing the attestation who called the exemption too broad "
                          "(nine in guarded terms) or said it should not be expanded"),""",
 """("80 of 117", "Commenters addressing the attestation who called the exemption too broad "
                          "(16 in guarded terms) or said it should not be expanded"),"""),
("C-tile4", """("12 of 118", "Commenters who offered concrete guidance on what a company should do "
                          "once the attestation is not required"),""",
 """("58 of 75", "Commenters addressing the five-year on-ramp who rejected or questioned a "
                         "uniform 60 months"),"""),
("C-Q2a", """Of the 118 commenters who addressed the attestation, <b>75 said the exemption is too broad "
              "or should not be expanded</b>, nine of them in guarded terms, and 32 supported it or sought a wider one.""",
 """Of the 117 commenters who addressed the attestation, <b>80 said the exemption is too broad "
              "or should not be expanded</b>, 16 of them in guarded terms, and 31 supported it or sought a wider one."""),
("C-Q2b", """"25 of the 27 investors and investor advocates that addressed the exemption called it too "
              "broad or opposed any expansion.\"""",
 """"all 24 investors and investor advocates that addressed the exemption called it too "
              "broad or opposed any expansion.\""""),
("C-ex4title", "Exhibit 4 — Where 118 commenters stood", "Exhibit 4 — Where 117 commenters stood"),
("C-ex4nopos", """"The 11 with no position are associations 1, venture capital and "
                  "policy groups 1, audit profession bodies 1, accounting firms 2, academics 3, individuals 2 and "
                  "investors 1. """,
 """"The 6 with no position are business associations 1, venture capital and "
                  "policy groups 2, academics 2 and individuals 1. """),
("C-ex4guard", "nine of those 32 \"\n                  \"say so in guarded terms.",
 "16 of those 33 \"\n                  \"say so in guarded terms."),
("C-inv", "<b>25 of the 27</b> that addressed the", "<b>all 24</b> that addressed the"),
("C-middle", """Thirty-two commenters accepted that the "
            "threshold should rise but objected to its extent; 20 proposed another threshold or test.""",
 """Thirty-three commenters accepted that the "
            "threshold should rise but objected to its extent; 26 proposed another threshold or test."""),
("C-31", """<b>Nine of "
            "the twelve said the exemption is, or may be, too broad, two took no position and one supported it; "
            "none endorsed the $2 billion threshold as proposed.</b>\"""",
 """<b>Read on "
            "what each letter leads with, nine of the twelve said the exemption is, or may be, too broad, two "
            "asked for more evidence and one would leave the choice to the market; none endorsed the $2 billion "
            "threshold as proposed.</b> Because those three also ask for a narrower exemption in some respect, "
            "Exhibit 4 counts all twelve as too broad.\""""),
("C-method", """"<b>Approach.</b> Every entry was read and coded with AI under the direction of Uniqus "
            "professionals. All but two letters had two independent passes, with differences resolved "
            "by re-reading the letter.""",
 """"<b>Approach.</b> Every letter was coded twice, independently, with AI under the direction of "
            "Uniqus professionals, and every difference was resolved by a third reading of the letter. Each "
            "code rests on a quoted passage."""),
("C-onramp", """"<b>55 of the 74</b> commenters that addressed it rejected or \"""",
 """"<b>58 of the 75</b> commenters that addressed it rejected or \""""),
("C-rev", "\"13 commenters proposed a revenue test or asked the SEC to consider one\"",
 "\"14 commenters proposed a revenue test or asked the SEC to consider one\""),
("C-2bn", """"Of the 51 that addressed the figure, 24 supported it, 15 wanted it "
             "lower, 3 higher and 9 opposed any increase",""",
 """"Of the 51 that addressed the figure, 18 supported it, 16 wanted it "
             "lower, 4 higher and 12 opposed any increase; one gave no direction","""),
("C-disc", "\"Four commenters asked that companies disclose \"", "\"Five commenters asked that companies disclose \""),
("C-dec7", "though four commenters asked for one.", "though five commenters asked for one."),
]

CHARTS = [
("C-ex4rows", """def ex4_positions(name="x4_positions.png", rows=None, totals=(32, 11, 32, 43)):
    # constituency, addressed, support, no position, too broad, do not expand
    rows = rows or [
        ("Company and industry associations", 9, 8, 1, 0, 0),
        ("Companies", 5, 5, 0, 0, 0),
        ("Law firms and bar committee", 6, 5, 0, 1, 0),
        ("Stock exchanges", 2, 2, 0, 0, 0),
        ("Venture capital and policy groups", 2, 1, 1, 0, 0),
        ("Government and state regulators", 2, 1, 0, 0, 1),
        ("Data and filing vendors", 1, 0, 0, 0, 1),
        ("Audit profession bodies", 7, 1, 1, 5, 0),
        ("Accounting firms", 12, 1, 2, 9, 0),
        ("Academics", 16, 2, 3, 6, 5),
        ("Individuals", 29, 5, 2, 4, 18),
        ("Investors and investor advocates", 27, 1, 1, 7, 18),
    ]""",
 """def ex4_positions(name="x4_positions.png", rows=None, totals=(31, 6, 33, 47)):
    # constituency, addressed, support, no position, too broad, do not expand
    # from the double-coded re-read (plan/coding/final_batch*.jsonl)
    rows = rows or [
        ("Company and industry associations", 9, 8, 1, 0, 0),
        ("Companies", 5, 5, 0, 0, 0),
        ("Law firms and bar committee", 6, 5, 0, 1, 0),
        ("Stock exchanges", 2, 2, 0, 0, 0),
        ("Venture capital and policy groups", 4, 1, 2, 1, 0),
        ("Government and state regulators", 2, 1, 0, 1, 0),
        ("Data and filing vendors", 1, 0, 0, 0, 1),
        ("Audit profession bodies", 5, 1, 0, 4, 0),
        ("Accounting and advisory firms", 12, 0, 0, 12, 0),
        ("Academics", 19, 2, 2, 6, 9),
        ("Individuals", 28, 6, 1, 4, 17),
        ("Investors and investor advocates", 24, 0, 0, 4, 20),
    ]"""),
("C-ex4lab", "\"75 of 118 say too broad or do not expand\"", "\"80 of 117 say too broad or do not expand\""),
("C-ex4all", "\"All 118 commenters that addressed the attestation\"", "\"All 117 commenters that addressed the attestation\""),
("C-ex6a", "\"15 commenters wanted it lower\"", "\"16 commenters wanted it lower\""),
("C-ex6b", "\"3 wanted it higher\"", "\"4 wanted it higher\""),
("C-ex6c", "\"24 supported\\n$2bn\"", "\"18 supported\\n$2bn\""),
]

HERO = [
("C-h1", 'The cover claims "172 commenters, one dot each"', 'The cover claims "174 commenters, one dot each"'),
("C-h2", 'COUNTS = dict(oppose=75, support=32, nopos=11, silent=54)   # 118 addressed + 54 silent\n'
         'assert sum(COUNTS.values()) == 172 and COUNTS["oppose"] + COUNTS["support"] + COUNTS["nopos"] == 118',
 'COUNTS = dict(oppose=80, support=31, nopos=6, silent=57)    # 117 addressed + 57 silent\n'
 'N = sum(COUNTS.values())\n'
 'assert N == 174 and COUNTS["oppose"] + COUNTS["support"] + COUNTS["nopos"] == 117'),
("C-h3", "# 172 dots, one per distinct commenter", "# 174 dots, one per distinct commenter"),
("C-h4", "while len(pts) < 172:                       # blue-noise", "while len(pts) < N:                         # blue-noise"),
("C-h5", "sizes = rng.uniform(9, 26, 172)", "sizes = rng.uniform(9, 26, N)"),
("C-h6", "assert len(pts) == 172", "assert len(pts) == N"),
("C-h7", '"172 commenters, one dot each"', '"174 commenters, one dot each"'),
("C-h8", 'items = [(PINK, "Too broad or do not expand (75)"), (LAV, "Supports the exemption (32)"),\n'
         '             (WHITE, "No position (11)"), (SILENT, "Silent on attestation (54)")]',
 'items = [(PINK, "Too broad or do not expand (80)"), (LAV, "Supports the exemption (31)"),\n'
 '             (WHITE, "No position (6)"), (SILENT, "Silent on attestation (57)")]'),
("C-h9", "cols = ([PINK] * 75 + [LAV] * 32 + [WHITE] * 11 + [SILENT] * 54); rng.shuffle(cols)",
 "cols = ([PINK] * COUNTS[\"oppose\"] + [LAV] * COUNTS[\"support\"] + [WHITE] * COUNTS[\"nopos\"] +\n"
 "                [SILENT] * COUNTS[\"silent\"]); rng.shuffle(cols)"),
("C-h10", "        while len(pts) < 172:\n            p = (rng.uniform", "        while len(pts) < N:\n            p = (rng.uniform"),
("C-h11", "s=rng.uniform(2, 7, 172)", "s=rng.uniform(2, 7, N)"),
("C-h12", "what 172 commenters said", "what 174 commenters said"),
]


def run_other(path, edits, tag):
    s = open(path).read()
    log = open("changelog.tsv", "a")
    for rid, old, new in edits:
        if old not in s:
            if new in s:
                print("already applied", rid); continue
            print("MISSING", rid, repr(old[:70])); sys.exit(1)
        s = s.replace(old, new, 1)
        log.write("%s\t%s\t%s\n" % (rid, old.replace("\n", " ")[:160], new.replace("\n", " ")[:220]))
    open(path, "w").write(s)
    print(tag, "applied", len(edits))


if __name__ == "__main__":
    run(SO, "v3-coding")
    run_other("charts.py", CHARTS, "v3-coding charts")
    run_other("hero.py", HERO, "v3-coding hero")
