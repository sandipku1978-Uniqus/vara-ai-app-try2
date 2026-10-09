# -*- coding: utf-8 -*-
"""Confidence score (1-10) for every claim in the merged register, as the claim reads in v2.

Reads ../review/register.json, writes a `score`, `kind` and `why` to each row there,
and writes confidence.csv beside this file.

Scale
  10  Arithmetic or internal consistency, checked.
   9  Matches the primary source (release, statute, CFR, PCAOB standard, data series, the letter itself).
   8  Matches the source, but the wording carries a judgement a reader could press, or the source is
      the author's own copy or a reliable secondary report.
   7  Partly checked: the core holds, one element rests on secondary sources or our own reading.
   6  Corroborated but not confirmed: a search snippet, the commenter's own site, a consistent pager.
   5  Plausible and unconfirmed: page cites that the Federal Register copy does not match, counts we could
      not re-derive.
   4  Known gap: the evidence found so far falls short of the number printed.
 1-3  Known to be wrong in v2 (none).
  -   Not in v2 (the claim was removed).
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REG = os.path.join(HERE, "..", "review", "register.json")

PAGE_CITES = {"A1-15", "A1-17", "A1-22", "A1-53", "A2-38", "S-01", "S-08", "S-09", "S-10", "S-11", "S-12",
              "S-13", "S-14", "S-15", "S-16", "S-17", "S-18", "S-19", "S-20", "S-21", "S-22"}
COUNTS = {"A1-02", "A1-03", "A2-31", "A2-36", "A2-37", "B-14a", "B-14b", "B-14c", "B-14d", "B-14e", "C-27",
          "S-04", "S-05", "S-24", "S-25", "S-26"}
REMOVED = {"A2-12": "The $10bn and $3.85bn commenter labels were taken off Exhibit 6 in v2.",
           "B-15": "The manufacturers' association label is no longer in v2.",
           "C-23": "The $10bn label is no longer in v2.",
           "D-20": "A request for data, not a claim in the paper."}

# id: (score, why). Rows not listed take the default for their verdict and v2 status.
OVR = {
    # Release figures whose only weak point is the page cite (scored on the page-cite rows S-08 to S-14).
    "A1-15": (5, "The basis difference is explained in v2. The p. 207 cite is unconfirmed; the Federal Register copy has Table 13 at p. 177 (S-10)."),
    "A1-17": (5, "Page cite. The Federal Register copy paginates differently; v2 keeps the draft's SEC-PDF pages until checked (S-11)."),
    "A1-22": (5, "Page cite. The Federal Register copy has these tables at pp. 119 to 122; the SEC PDF is unchecked (S-09)."),
    "A1-53": (5, "Page cite, unchecked against the SEC PDF (S-12)."),
    "A2-38": (5, "Page cites to Release 33-11419 as a group; none checked against the SEC PDF."),
    "A1-16": (9, "Both figures are in the release; \"strongest argument\" removed. The p. 42 cite is scored at S-08."),
    "A1-03": (6, "Disclosed as an October 5 snapshot. The docket pager (seven pages) fits 181 to 210 entries; 192 and 172 were not recounted."),
    "A1-02": (6, "75 of 118 adds up and 0 of 11 checks against the firm letters; 12 of 118 rests on coding we could not re-derive."),
    "A1-32": (9, "CAQ counts verified in register D (D-13 to D-15); Ideagen 391 verified from its 2026 report page."),
    "A2-37": (8, "The snapshot date is now stated and the three late letters are noted in the Exhibit 4 source line."),
    "B-14a": (8, "Snapshot wording fixed; the recount after October 5 is still pending (S-04)."),
    "B-14b": (6, "Staff memoranda confirmed; the roundtable transcript was not found on the docket page that loads."),
    "B-14e": (6, "The society's own copy was read; the broken docket link was not re-tested."),
    "S-05": (6, "Same as B-14e: the link sits on a docket page that would not load."),
    "S-04": (8, "Snapshot is disclosed. Olema (read) would not change the headline counts; RSM's October 7 letter is unread."),
    "S-25": (5, "Only one of seven docket pages loads, so 192 and 172 cannot be recounted; no transcript seen on that page."),
    "S-26": (5, "Our own coding of the letters. Needs a full re-read of the docket to re-derive."),
    "S-24": (4, "Only four firms confirmed from their own published letters; the other letters are sec.gov PDFs we could not open."),
    "C-11": (4, "Same as S-24: four of seven confirmed. Fall back to \"at least four firms\" if the rest are not confirmed."),
    "C-10": (5, "The \"let the market decide\" firm's suggestion of a lower line is not confirmed against its letter."),
    "C-20": (5, "55 of 74 is our coding; not re-derived."),
    "C-21": (5, "At least six found; 13 is our coding."),
    "C-22": (5, "The 24 / 15 / 3 / 9 split of 51 is our coding; the third \"higher\" commenter is unconfirmed."),
    "C-25": (5, "Four commenters asking for disclosure is our coding; not all four confirmed."),
    "C-07": (7, "Three of the five fixes confirmed from primary letters; the two from the audit firm and the advisory firm rest on secondary copies."),
    "C-08": (7, "Which firm asked for refreshed PCAOB guidance is unconfirmed; the PCAOB agenda point is verified."),
    "C-12": (7, "Six of the ten confirmed from primary text; four firm letters are sec.gov PDFs we could not open."),
    "C-05": (8, "Nine / two / one matches our reading; two firms are coded \"no side\" because they asked for more evidence."),
    "C-06": (8, "No audit-firm letter endorses $2bn as drawn; the supporter suggested considering a lower line."),
    # Quotations: wording corroborated, page not confirmed. The page cite is scored on the S row.
    "B-01": (8, "Wording matches a snippet of the Nasdaq PDF and an independent copy; p. 4 is scored at S-15."),
    "B-02": (8, "Wording, curly quotes and dash match a snippet of the OPERS PDF; p. 9 is scored at S-16."),
    "B-03": (5, "A public tracker lists the Avalo CFO's letter of June 21, 2026; the quoted wording itself is unconfirmed."),
    "S-23": (5, "Same as B-03. Remove from Exhibit 5 only if a full docket read shows the letter is absent."),
    "B-05a": (8, "Wording corroborated; ellipsis now marks the cut. p. 2 is scored at S-17."),
    "B-06": (8, "12.8%, 8.5%, 3.8% and 4 to 6 vs 12 analysts match the letter's text as found; pages scored at S-22."),
    "B-07": (7, "Wording matches a snippet; that the letter is Linklaters' is corroborated but not confirmed on the PDF."),
    "B-08": (8, "Wording and author corroborated; the paper does not name the firm. p. 3 is scored at S-19."),
    "C-15": (8, "Same quote as B-08."),
    "B-09": (7, "Wording and study corroborated; two AAA committees wrote, so the attribution needs the PDF (S-20)."),
    "B-10": (7, "Wording and author corroborated; p. 4 and the end of the quote unconfirmed."),
    "C-14": (7, "Same quote as B-10."),
    "S-15": (5, "Page cite; the PDF would not open."),
    "S-16": (5, "Page cite; the PDF would not open."),
    "S-17": (5, "Page cite; the letter's PDF would not open."),
    "S-18": (5, "Page cite; the PDF would not open."),
    "S-19": (5, "Page cite; the PDF would not open."),
    "S-20": (4, "Page cite and committee attribution both unconfirmed; a second AAA committee also wrote."),
    "S-21": (5, "Page cite; the letter's PDF would not open."),
    "S-22": (5, "Pages 2 to 4; the letter is not identified with certainty on the docket."),
    "S-08": (5, "Page cite. The Federal Register copy has both figures at p. 34, note 137, and $3.85bn at p. 42."),
    "S-09": (5, "Page cite. Federal Register copy: pp. 119, 120 and 122."),
    "S-10": (5, "Page cite. Federal Register copy: p. 177."),
    "S-11": (5, "Page cites, unchecked against the SEC PDF."),
    "S-12": (5, "Page cites, unchecked against the SEC PDF."),
    "S-13": (5, "Page cites, unchecked against the SEC PDF."),
    "S-14": (4, "p. 139 is also given for EA Table 5, so one of the two cites may be wrong."),
    "S-01": (9, "Fixed from the Society's own copy of the letter (p. 7; survey size at p. 1, note 1)."),
    # Judgement calls a reader could press.
    "D-09": (8, "Four major steps since 2005 is fair; a reader could count the repeated deferrals as more."),
    "D-23": (8, "Reworded to match both the release and the underlying study; the study's reading is ours."),
    "A2-06": (8, "Softened to \"the only study we found\"; we did not read every letter."),
    "B-12": (8, "Same sentence as A2-06."),
    "B-05b": (8, "\"Supportive of the on-ramp but cautious about widening\" is our reading of the letter."),
    "A2-04": (8, "Reworded to the two issuer figures actually on file; the Avalo half rests on B-03."),
    "E-12": (8, "Sum of the three 2026 quarterly reviews as restated in the Q3 review; may move with later restatement."),
    "E-24": (8, "Practitioner guides from July and August 2026 say the exemption still applies; not confirmed on mca.gov.in."),
    "E-26": (8, "Primary regulator requirement found; how far it has been phased in is reported, not confirmed."),
    "E-28": (9, "Updated to your figures: 800 professionals."),
    "E-29": (9, "Updated to your figures: 100 Partners and Directors."),
    "E-30": (9, "Updated to your figures: 13 offices."),
    "E-35": (9, "Updated boilerplate, Valuations added."),
}

EXTRA = [
    {"reg": "R", "id": "R-01", "page": "6 (Exh. 3)", "claim": "Exhibit 3, Ideagen basis: 391 restatements in 2025",
     "verdict": "VERIFIED", "status": "Added in v2", "score": 9,
     "why": "Ideagen's own May 2026 report page: \"from 477 to 391\"; Accounting Today confirms 2020 at 375."},
    {"reg": "R", "id": "R-02", "page": "6 (Exh. 3)", "claim": "Exhibit 3, Ideagen basis: 477 in 2024",
     "verdict": "VERIFIED", "status": "Added in v2", "score": 9,
     "why": "Same Ideagen page. The 2025 edition said 479; v2 uses the latest vintage."},
    {"reg": "R", "id": "R-03", "page": "6 (Exh. 3)", "claim": "Exhibit 3, Ideagen basis: 434 in 2023",
     "verdict": "VERIFIED-WITH-NUANCE", "status": "Added in v2", "score": 7,
     "why": "From a secondary report of the 2025 edition; the 2024 edition said 430. The full report is behind a sign-up form."},
    {"reg": "R", "id": "R-04", "page": "6 (Exh. 3)", "claim": "Exhibit 3, Ideagen basis: 458 in 2022 (marked *)",
     "verdict": "VERIFIED-WITH-NUANCE", "status": "Added in v2", "score": 7,
     "why": "From Bloomberg Tax's report of the 2024 edition; later editions may restate it."},
    {"reg": "U", "id": "U-01", "page": "21-22", "claim": "How Uniqus Can Help: durations and scope of each offer",
     "verdict": "COULD NOT VERIFY", "status": "Open: needs your confirmation", "score": 4,
     "why": "These are our proposals, not facts yet. They need your sign-off."},
]


def kind(r):
    i = r["id"]
    if i in PAGE_CITES: return "Page cite"
    if i in COUNTS or r["reg"] == "C": return "Comment-file count"
    if r["reg"] in ("B", "S"): return "Comment-letter content"
    if r["reg"] in ("A1", "A2"): return "Release fact"
    if r["reg"] in ("D", "R"): return "History and standards"
    if r["reg"] == "U": return "About Uniqus"
    if r["reg"] == "E":
        n = int(i.split("-")[1])
        return "Market data" if n <= 17 else ("Cross-border" if n <= 27 else "About Uniqus")
    return "Release fact"


def default(r):
    v, s = r["verdict"], r["status"]
    if "arithmetic" in r.get("vraw", "") or "internal" in r.get("vraw", ""):
        return 10, "Arithmetic or internal consistency, checked."
    if s.startswith("Fixed"):
        return 9, "Corrected in v2 from the primary source."
    if v == "VERIFIED":
        return 9, "Matches the primary source."
    if v == "VERIFIED-WITH-NUANCE":
        return 8, "Matches the source; the nuance is noted and the wording was kept."
    raise ValueError("no score for %s (%s / %s)" % (r["id"], v, s))


def main():
    rows = json.load(open(REG))
    raw = {x["id"]: x["verdict"] for x in json.load(open(os.path.join(HERE, "register.json")))}
    rows = [r for r in rows if r["reg"] not in ("R", "U")]
    for r in rows:
        r["vraw"] = raw.get(r["id"], "")
        if r["id"] in REMOVED:
            r["score"], r["why"] = None, REMOVED[r["id"]]
        elif r["id"] in OVR:
            r["score"], r["why"] = OVR[r["id"]]
        else:
            r["score"], r["why"] = default(r)
        r.pop("vraw")
    for e in EXTRA:
        e.setdefault("evidence", e["why"]); e.setdefault("fix", "None")
    rows += EXTRA
    for r in rows:
        r["kind"] = kind(r)
    json.dump(rows, open(REG, "w"), ensure_ascii=False, indent=1)
    with open(os.path.join(HERE, "confidence.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ID", "v2 page", "Claim", "Kind", "Confidence (1-10)", "Why", "Verdict", "v2 status"])
        for r in rows:
            w.writerow([r["id"], r["page"], r["claim"], r["kind"], "" if r["score"] is None else r["score"],
                        r["why"], r["verdict"], r["status"]])
    scored = [r for r in rows if r["score"] is not None]
    from collections import Counter
    print(len(rows), "rows;", len(scored), "scored; mean %.1f" % (sum(r["score"] for r in scored) / len(scored)))
    print(sorted(Counter(r["score"] for r in scored).items()))
    for k, n in Counter(r["kind"] for r in scored).items():
        ks = [r["score"] for r in scored if r["kind"] == k]
        print("%-22s %3d  mean %.1f  min %d" % (k, n, sum(ks) / len(ks), min(ks)))


if __name__ == "__main__":
    main()
