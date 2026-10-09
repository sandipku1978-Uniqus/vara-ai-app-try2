# -*- coding: utf-8 -*-
"""Redesigned exhibits for The Second Opinion v2.

Every chart is drawn at print size (5.25in = the 134mm column) so type prints
at 6.5-8.5pt. Data sit at the top of each function so a fact-check change is
a one-line edit. Palette validated with the dataviz validator:
purple/magenta pass CVD and normal-vision separation; LMAG is an ordinal step
of magenta (too broad < do not expand); GREY is the neutral 'no position'.
"""
import glob, os, csv
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
import numpy as np
import matplotlib.transforms

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "fonts")
for f in glob.glob(os.path.join(FONTS, "Poppins-*.ttf")):
    fm.fontManager.addfont(f)
plt.rcParams.update({
    "font.family": "Poppins", "font.size": 7, "axes.edgecolor": "#CFC7DA",
    "axes.linewidth": 0.6, "xtick.color": "#6E6E78", "ytick.color": "#6E6E78",
    "xtick.labelsize": 6.5, "ytick.labelsize": 6.5, "axes.labelcolor": "#55555F",
    "svg.fonttype": "none", "text.parse_math": False,
})

PURPLE, MAGENTA = "#482879", "#B21E7D"
PMID, LMAG, GREY = "#9479BD", "#DE8DBB", "#C4C4CC"
INK, MUTED, GRID = "#2B2B33", "#6E6E78", "#ECE8F1"
W = 5.25


def _clean(ax, grid_x=True):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.spines["left"].set_visible(False)
    if grid_x:
        ax.grid(axis="x", color=GRID, lw=0.6)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)


def _save(fig, name):
    p = os.path.join(HERE, name)
    fig.savefig(p, dpi=300, bbox_inches="tight", pad_inches=0.04, facecolor="white")
    plt.close(fig)
    return p


# --------------------------------------------------------------- Exhibit 1
def ex1_timeline(name="x1_timeline.png"):
    """Two-track timeline: requirement applied (purple) vs scaled or narrowed
    (magenta). Vertical stems only, no diagonal leaders."""
    ev = [  # year, frac, label, kind, side
        (2002, .55, "Sarbanes-Oxley enacted.\nAccelerated filer\nthreshold: $75m of float", "a", 1),
        (2004, .87, "First auditor\nattestations, from\naccelerated filers", "a", -1),
        (2005, .95, "Large accelerated\nfiler threshold\nset at $700m", "a", 1),
        (2007, .5, "SEC guidance for\nmanagement; PCAOB\nrisk-based AS 5", "n", -1),
        (2010, .55, "Dodd-Frank: non-\naccelerated filers\nexempt by statute", "n", 1),
        (2012, .27, "JOBS Act: emerging\ngrowth companies\nexempt up to 5 years", "n", -1),
        (2020, .25, "Issuers with revenue\nunder $100m leave\naccelerated status", "n", 1),
        (2026, .38, "Proposal: threshold\nto $2bn; 60 months for\nevery new registrant", "p", -1),
    ]
    fig, ax = plt.subplots(figsize=(W, 2.25))
    ax.set_xlim(2000.6, 2027.6); ax.set_ylim(-1.55, 1.55); ax.axis("off")
    ax.plot([2001.2, 2027], [0, 0], color="#CFC7DA", lw=1.2, zorder=1)
    for y in range(2002, 2027, 1):
        ax.plot([y, y], [-0.035, 0.035], color="#CFC7DA", lw=0.6)
    for yr, fr, lab, kind, side in ev:
        x = yr + (fr if yr in (2004, 2005) else 0) * 0
        x = {2004: 2003.9, 2005: 2005.1}.get(yr, yr)
        col = PURPLE if kind == "a" else MAGENTA
        h = 0.5 if side > 0 else -0.5
        ax.plot([x, x], [0, h], color=col, lw=0.8, zorder=2)
        if kind == "p":
            ax.scatter([x], [0], s=95, facecolor="white", edgecolor=MAGENTA, lw=1.6, zorder=4)
            ax.scatter([x], [0], s=22, color=MAGENTA, zorder=5)
        else:
            ax.scatter([x], [0], s=26, color=col, edgecolor="white", lw=1.0, zorder=4)
        ty = h + (0.07 if side > 0 else -0.07)
        va = "bottom" if side > 0 else "top"
        ax.text(x, ty + (0.0), str(yr), ha="center", va=va, fontsize=8.2, weight="bold", color=col)
        ax.text(x, ty + (0.2 if side > 0 else -0.2), lab, ha="center", va=va,
                fontsize=6.0, color=INK, linespacing=1.25)
    ax.scatter([2001.3], [-1.38], s=18, color=PURPLE); ax.text(2001.7, -1.38, "Requirement applied", va="center", fontsize=6.2, color=MUTED)
    ax.scatter([2007.3], [-1.38], s=18, color=MAGENTA); ax.text(2007.7, -1.38, "Requirement scaled or narrowed", va="center", fontsize=6.2, color=MUTED)
    return _save(fig, name)


# --------------------------------------------------------------- Exhibit 2
def ex2_record(name="x2_record.png", data=None):
    data = data or [
        ("Management reported\nineffective controls", "2021 to 2024", [5.2, 15.7, 41.8]),
        ("Ineffective in all\nfour years", "2021 to 2024", [0.4, 4.2, 24.9]),
        ("Restated for a\nmaterial error", "fiscal 2021 to 2023", [1.6, 4.8, 5.4]),
    ]
    names = ["Large accelerated (auditor attests)", "Accelerated (auditor attests unless EGC)",
             "Non-accelerated (management only)"]
    cols = [PURPLE, PMID, MAGENTA]
    fig, ax = plt.subplots(figsize=(W, 2.55))
    bh, gap = 0.26, 0.05
    yt = []
    for gi, (lab, per, vals) in enumerate(data):
        base = -gi * 1.25
        for i, v in enumerate(vals):
            y = base - i * (bh + gap)
            ax.barh(y, v, height=bh, color=cols[i], zorder=3)
            ax.text(v + 0.7, y, "%.1f%%" % v, va="center", fontsize=6.6,
                    weight="bold" if i == 2 else "normal", color=INK)
        yt.append((base - (bh + gap), lab, per))
    ax.set_yticks([t[0] for t in yt]); ax.set_yticklabels([""] * len(yt))
    for y, lab, per in yt:
        ax.text(-1.0, y + 0.08, lab, ha="right", va="center", fontsize=6.8, color=PURPLE, weight="bold", linespacing=1.15)
        ax.text(-1.0, y - 0.36, per, ha="right", va="center", fontsize=5.8, color=MUTED)
    ax.set_xlim(0, 50); ax.set_xticks([0, 10, 20, 30, 40, 50])
    ax.set_xticklabels(["0%", "10%", "20%", "30%", "40%", "50%"])
    _clean(ax)
    hs = [plt.Rectangle((0, 0), 1, 1, color=c) for c in cols]
    ax.legend(hs, names, loc="upper center", bbox_to_anchor=(0.42, 1.16), ncol=3,
              frameon=False, fontsize=6.2, handlelength=1, handleheight=0.8, columnspacing=1.2)
    return _save(fig, name)


# --------------------------------------------------------------- Exhibit 3
def ex3_restatements(name="x3_restatements.png", years=None, counts=None, note=None):
    years = years or list(range(2013, 2023))
    counts = counts or [858, 834, 732, 667, 554, 538, 472, 374, 362, 402]
    fig, ax = plt.subplots(figsize=(W, 2.1))
    cols = [PMID] * len(years)
    cols[0] = PURPLE; cols[-1] = MAGENTA
    ax.bar(years, counts, width=0.62, color=cols, zorder=3)
    for x, v, c in zip(years, counts, cols):
        ax.text(x, v + 14, f"{v:,}", ha="center", va="bottom", fontsize=6.2,
                weight="bold" if c != PMID else "normal", color=INK)
    ax.set_xticks(years); ax.set_xticklabels([str(y) for y in years])
    ax.set_ylim(0, max(counts) * 1.15)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.grid(axis="y", color=GRID, lw=0.6); ax.set_axisbelow(True); ax.tick_params(length=0)
    ax.set_yticks([0, 200, 400, 600, 800])
    if note:
        ax.text(0.99, 0.97, note, transform=ax.transAxes, ha="right", va="top", fontsize=6.2, color=MUTED)
    return _save(fig, name)


# --------------------------------------------------------------- Exhibit 4
def ex4_positions(name="x4_positions.png", rows=None, totals=(31, 6, 33, 47)):
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
    ]
    sup, nop, tb, dne = totals
    assert sum(r[2] for r in rows) == sup and sum(r[3] for r in rows) == nop
    assert sum(r[4] for r in rows) == tb and sum(r[5] for r in rows) == dne
    assert all(r[1] == sum(r[2:]) for r in rows)
    # sort: net position, supporters first
    rows = sorted(rows, key=lambda r: (r[4] + r[5] - r[2], -(r[2])))

    fig = plt.figure(figsize=(W, 2.95))
    # --- summary bar
    a0 = fig.add_axes([0.0, 0.855, 1.0, 0.13]); a0.axis("off")
    tot = sum(totals); x = 0
    segs = [(sup, PURPLE, "Supports the exemption\nor wants more", "white"),
            (nop, GREY, "No\nposition", INK),
            (tb, LMAG, "Too broad", INK),
            (dne, MAGENTA, "Do not expand", "white")]
    for v, c, lab, tc in segs:
        a0.barh(0, v / tot, left=x, height=1, color=c, edgecolor="white", lw=1.5)
        a0.text(x + v / tot / 2, 0, str(v), ha="center", va="center", fontsize=9, weight="bold", color=tc)
        a0.text(x + v / tot / 2, 0.62, lab, ha="center", va="bottom", fontsize=6.0, color=INK, linespacing=1.1)
        x += v / tot
    a0.set_xlim(0, 1); a0.set_ylim(-0.55, 2.0)
    a0.annotate("", xy=(1.0, -0.62), xytext=((sup + nop) / tot, -0.62), xycoords="data",
                arrowprops=dict(arrowstyle="-", color=MAGENTA, lw=1.2))
    a0.text(1.0, -0.8, "80 of 117 say too broad or do not expand", ha="right", va="top",
            fontsize=6.4, weight="bold", color=MAGENTA)
    a0.text(0.0, -0.8, "All 117 commenters that addressed the attestation", ha="left", va="top",
            fontsize=6.0, color=MUTED)

    # --- diverging rows
    ax = fig.add_axes([0.40, 0.0, 0.55, 0.745])
    n = len(rows); ys = np.arange(n)[::-1]
    for y, r in zip(ys, rows):
        lab, adr, s, nposn, t, d = r
        if s:
            ax.barh(y, -s, height=0.62, color=PURPLE, zorder=3)
            ax.text(-s - 0.5, y, str(s), ha="right", va="center", fontsize=6.4, color=INK)
        if t:
            ax.barh(y, t, height=0.62, color=LMAG, zorder=3, edgecolor="white", lw=0.8)
        if d:
            ax.barh(y, d, left=t, height=0.62, color=MAGENTA, zorder=3, edgecolor="white", lw=0.8)
        if t or d:
            ax.text(t + d + 0.5, y, str(t + d), ha="left", va="center", fontsize=6.4, weight="bold", color=INK)
        tr = matplotlib.transforms.blended_transform_factory(ax.transAxes, ax.transData)
        ax.text(-0.03, y, lab, ha="right", va="center", fontsize=6.9, color=INK, transform=tr)
    ax.axvline(0, color="#9A9AA2", lw=0.8, zorder=4)
    ax.set_xlim(-12, 27); ax.set_ylim(-0.7, n - 0.3)
    ax.set_yticks([])
    ax.set_xticks([-10, -5, 0, 5, 10, 15, 20, 25]); ax.set_xticklabels(["10", "5", "0", "5", "10", "15", "20", "25"])
    _clean(ax)
    ax.text(-0.6, n - 0.15, "supports", ha="right", va="bottom", fontsize=6.2, color=PURPLE, weight="bold")
    ax.text(0.6, n - 0.15, "too broad + do not expand", ha="left", va="bottom", fontsize=6.2, color=MAGENTA, weight="bold")
    ax.set_xlabel("Number of distinct commenters", fontsize=6.2, color=MUTED)
    # the -30.6 labels sit left of axes via clip_on False
    for t in ax.texts:
        t.set_clip_on(False)
    return _save(fig, name)


# --------------------------------------------------------------- Exhibit 5
def ex5_cost(name="x5_cost.png"):
    rows = [  # label, sub, lo, hi, colour, value label
        ("The SEC's working figure", "average per annual report, plus\n375 internal hours", 202500, None, PURPLE, "$202,500"),
        ("What GAO measured", "median rise in audit fees in the year\n98 companies began the attestation", 219000, None, PMID, "$219,000"),
        ("What companies told the SEC", "one listed company cited by Nasdaq;\none biotech CFO; per year", 500000, 1000000, MAGENTA, "$500,000 to $1 million"),
    ]
    fig, ax = plt.subplots(figsize=(W, 1.75))
    for i, (lab, sub, lo, hi, c, vl) in enumerate(rows):
        y = -i
        if hi is None:
            ax.plot([0, lo], [y, y], color=c, lw=1.0, zorder=2, alpha=0.5)
            ax.scatter([lo], [y], s=55, color=c, zorder=3, edgecolor="white", lw=1.2)
            ax.text(lo + 22000, y, vl, va="center", fontsize=7, weight="bold", color=INK)
        else:
            ax.plot([lo, hi], [y, y], color=c, lw=7, solid_capstyle="round", zorder=3)
            ax.text((lo + hi) / 2, y + 0.3, vl, ha="center", va="bottom", fontsize=7, weight="bold", color=INK)
        ax.text(-30000, y + 0.11, lab, ha="right", va="center", fontsize=6.8, weight="bold", color=c if c != PMID else PURPLE)
        ax.text(-30000, y - 0.28, sub, ha="right", va="center", fontsize=5.4, color=MUTED, linespacing=1.15)
    ax.set_xlim(0, 1080000); ax.set_ylim(-2.6, 0.75)
    ax.set_xticks([0, 250000, 500000, 750000, 1000000])
    ax.set_xticklabels(["$0", "$250,000", "$500,000", "$750,000", "$1 million"])
    ax.set_yticks([]); _clean(ax)
    for t in ax.texts:
        t.set_clip_on(False)
    return _save(fig, name)


# --------------------------------------------------------------- Exhibit 6
def ex6_line(name="x6_line.png", pts=None):
    pts = pts or [(0.7, 1665, 95.2), (1.0, 1480, 94.8), (1.5, 1285, 94.1),
                  (2.0, 1146, 93.5), (2.5, 1030, 92.7), (3.0, 944, 92.1)]
    fig, ax = plt.subplots(figsize=(W, 2.0))
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    ax.plot(xs, ys, color=PMID, lw=1.6, zorder=3)
    for x, y, s in pts:
        hl = abs(x - 2.0) < 1e-9
        ax.scatter([x], [y], s=60 if hl else 28, color=MAGENTA if hl else PURPLE,
                   edgecolor="white", lw=1.2, zorder=4)
        ax.text(x, y + 55, f"{y:,}", ha="center", va="bottom", fontsize=6.8,
                weight="bold", color=MAGENTA if hl else INK)
        ax.text(x, y - 60, f"{s}% of float", ha="center", va="top", fontsize=5.5, color=MUTED,
                bbox=dict(boxstyle="square,pad=0.1", fc="white", ec="none"), zorder=5)
    marks = [(1.15, "$1.15bn\nCPI-adjusted\n$700m"), (3.85, "$3.85bn\ntracking the\nS&P 500")]
    for x, lab in marks:
        ax.axvline(x, color="#CFC7DA", lw=0.8, zorder=1)
        ax.text(x, 2010, lab, ha="center", va="top", fontsize=5.6, color=MUTED, linespacing=1.15)
    ax.axvline(2.0, color=MAGENTA, lw=0.9, zorder=1, alpha=0.6)
    ax.text(2.0, 2010, "$2bn\nthe proposal", ha="center", va="top", fontsize=5.8, color=MAGENTA, weight="bold", linespacing=1.15)
    # commenter positions on the level
    ax.annotate("", xy=(0.72, 560), xytext=(1.9, 560), arrowprops=dict(arrowstyle="->", color=PURPLE, lw=0.9))
    ax.text(1.17, 585, "16 commenters wanted it lower", ha="center", va="bottom", fontsize=5.8, color=PURPLE)
    ax.annotate("", xy=(4.3, 560), xytext=(2.1, 560), arrowprops=dict(arrowstyle="->", color=PURPLE, lw=0.9))
    ax.text(3.0, 585, "4 wanted it higher", ha="center", va="bottom", fontsize=5.8, color=PURPLE)
    ax.text(2.0, 560, "18 supported\n$2bn", ha="center", va="center", fontsize=5.8, color=MAGENTA, weight="bold",
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="none"), linespacing=1.1)
    ax.set_xscale("log"); ax.set_xlim(0.6, 4.6)
    ticks = [0.7, 1.0, 1.5, 2.0, 3.0, 4.0]
    ax.set_xticks(ticks); ax.set_xticklabels(["$700m", "$1bn", "$1.5bn", "$2bn", "$3bn", "$4bn"])
    ax.minorticks_off()
    ax.set_ylim(350, 2050); ax.set_yticks([500, 1000, 1500, 2000])
    ax.set_yticklabels(["500", "1,000", "1,500", "2,000"])
    ax.set_ylabel("Large accelerated filers left", fontsize=6.2)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.grid(axis="y", color=GRID, lw=0.6); ax.set_axisbelow(True); ax.tick_params(length=0)
    ax.set_xlabel("Public float threshold (logarithmic scale)", fontsize=6.2)
    return _save(fig, name)


# --------------------------------------------------------------- Exhibit 7
def ex7_markets(name="x7_markets.png", series=None, ipo=None, marks=None):
    """series: list of (year, count). ipo: list of (label, count, proceeds_bn, partial)."""
    fig = plt.figure(figsize=(W, 2.45))
    a = fig.add_axes([0.06, 0.16, 0.47, 0.70])
    b = fig.add_axes([0.62, 0.16, 0.38, 0.70])
    xs = [s[0] for s in series]; ys = [s[1] for s in series]
    a.plot(xs, ys, color=PURPLE, lw=1.6, zorder=3)
    off = {1996: (0.6, 250, "left"), 2001: (0.7, 120, "left"), 2012: (0, -330, "center"),
           2021: (0, 260, "center"), 2025: (0, -360, "center")}
    for x, y in series:
        if x in (marks or []):
            dx, dy, ha = off.get(x, (0.6, 260, "left"))
            a.scatter([x], [y], s=22, color=MAGENTA if x == xs[-1] else PURPLE, zorder=4, edgecolor="white", lw=0.8)
            a.text(x + dx, y + dy, f"{y:,}", fontsize=6.2, weight="bold", ha=ha, va="center",
                   color=MAGENTA if x == xs[-1] else INK)
    for yr, lab in ((2002, "Sarbanes-\nOxley Act"), (2012, "JOBS\nAct")):
        a.axvline(yr, color=MAGENTA, lw=0.8, alpha=0.55, zorder=1)
        a.text(yr + 0.5, 1150, lab, fontsize=5.6, color=MAGENTA, va="bottom", linespacing=1.1)
    a.set_ylim(0, 9200); a.set_yticks([0, 2000, 4000, 6000, 8000])
    a.set_yticklabels(["0", "2,000", "4,000", "6,000", "8,000"])
    a.set_xlim(xs[0] - 0.5, xs[-1] + 1)
    for s in ("top", "right"):
        a.spines[s].set_visible(False)
    a.grid(axis="y", color=GRID, lw=0.6); a.set_axisbelow(True); a.tick_params(length=0)
    a.set_title("Listed domestic companies, US exchanges, year end", fontsize=6.8, weight="bold", color=PURPLE, loc="left")
    labs = [i[0] for i in ipo]; cnt = [i[1] for i in ipo]; pr = [i[2] for i in ipo]
    cols = [MAGENTA if i[3] else PMID for i in ipo]
    bx = np.arange(len(ipo))
    b.bar(bx, cnt, width=0.62, color=cols, zorder=3,
          hatch=None)
    for x, c, p, part in zip(bx, cnt, pr, [i[3] for i in ipo]):
        b.text(x, c + 8, str(c), ha="center", va="bottom", fontsize=6.4, weight="bold", color=INK)
        b.text(x, -62, f"${p:.1f}bn", ha="center", va="top", fontsize=5.0,
               color=MAGENTA if part else MUTED, weight="bold" if part else "normal")
    b.text(-0.62, -62, "raised", ha="right", va="top", fontsize=5.2, color=MUTED)
    b.annotate("Two offerings raised\n$101.5bn of the $147.5bn", xy=(5, 170), xytext=(3.75, 330),
               fontsize=5.6, color=MAGENTA, weight="bold", ha="center", linespacing=1.15,
               arrowprops=dict(arrowstyle="->", color=MAGENTA, lw=0.8))
    b.set_xticks(bx); b.set_xticklabels(labs, fontsize=6.2)
    b.set_ylim(0, 450); b.set_yticks([0, 100, 200, 300, 400])
    for s in ("top", "right"):
        b.spines[s].set_visible(False)
    b.grid(axis="y", color=GRID, lw=0.6); b.set_axisbelow(True); b.tick_params(length=0)
    b.set_title("US IPOs, number", fontsize=6.8, weight="bold", color=PURPLE, loc="left")
    for t in b.texts:
        t.set_clip_on(False)
    return _save(fig, name)


if __name__ == "__main__":
    print(ex1_timeline()); print(ex2_record()); print(ex3_restatements())
    print(ex4_positions()); print(ex5_cost()); print(ex6_line())


def ex7_from_data(name="x7_markets.png"):
    import csv
    rows = [r for r in csv.DictReader(open(os.path.join(HERE, "..", "data", "us_listed.csv")))
            if r["listed_domestic_companies"] and int(r["year"]) >= 1990]
    series = [(int(r["year"]), int(float(r["listed_domestic_companies"]))) for r in rows]
    ipo = [("2021", 397, 142.4, False), ("2022", 71, 7.7, False), ("2023", 109, 19.5, False),
           ("2024", 150, 29.6, False), ("2025", 202, 44.0, False), ("2026*", 112, 147.5, True)]
    return ex7_markets(name, series, ipo, marks=[1996, 2001, 2012, 2021, 2025])


def ex3_two_series(name="x3_restatements.png"):
    """CAQ 2013-2022 (excl. SPAC warrant restatements) beside Ideagen 2022-2025 (incl. SPACs).
    2022 appears on both bases so the change of series is visible, not hidden."""
    caq = list(zip(range(2013, 2023), [858, 834, 732, 667, 554, 538, 472, 374, 362, 402]))
    ide = [(2022, 458), (2023, 434), (2024, 477), (2025, 391)]
    fig, ax = plt.subplots(figsize=(W, 2.35))
    xs1 = list(range(len(caq))); gap = 0.9
    xs2 = [len(caq) - 1 + gap + 1 + i for i in range(len(ide))]
    ax.bar(xs1, [v for _, v in caq], width=0.62, color=PMID, zorder=3)
    c2 = [LMAG, LMAG, LMAG, MAGENTA]
    ax.bar(xs2, [v for _, v in ide], width=0.62, color=c2, zorder=3)
    for x, (_, v) in zip(xs1, caq):
        ax.text(x, v + 14, f"{v:,}", ha="center", va="bottom", fontsize=5.9, color=INK,
                weight="bold" if x in (0, len(caq) - 1) else "normal")
    for x, (_, v), c in zip(xs2, ide, c2):
        ax.text(x, v + 14, f"{v:,}", ha="center", va="bottom", fontsize=5.9, color=INK,
                weight="bold" if c == MAGENTA else "normal")
    labs = [str(y) for y, _ in caq] + ["2022*", "2023", "2024", "2025"]
    ax.set_xticks(xs1 + xs2); ax.set_xticklabels(labs, fontsize=5.9)
    bx = (xs1[-1] + xs2[0]) / 2
    ax.axvline(bx, color="#9A9AA2", lw=0.8, ls=(0, (2, 2)), zorder=2)
    ax.text((xs1[0] + xs1[-1]) / 2, 990, "Center for Audit Quality: excludes SPAC warrant restatements",
            ha="center", va="bottom", fontsize=6.0, color=PURPLE, weight="bold")
    ax.text((xs2[0] + xs2[-1]) / 2, 990, "Ideagen: includes SPACs", ha="center", va="bottom",
            fontsize=6.0, color=MAGENTA, weight="bold")
    ax.set_ylim(0, 1060); ax.set_yticks([0, 200, 400, 600, 800])
    ax.set_yticklabels(["0", "200", "400", "600", "800"])
    ax.set_xlim(-0.6, xs2[-1] + 0.6)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.grid(axis="y", color=GRID, lw=0.6); ax.set_axisbelow(True); ax.tick_params(length=0)
    return _save(fig, name)
