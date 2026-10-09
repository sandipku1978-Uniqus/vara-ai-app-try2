# -*- coding: utf-8 -*-
"""Cover hero and section bands for The Second Opinion v2.

The cover claims "174 commenters, one dot each", so the dots are generated from
the coded counts and asserted, rather than drawn by hand.
"""
import glob, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
import numpy as np
import matplotlib.lines

HERE = os.path.dirname(os.path.abspath(__file__))
for f in glob.glob(os.path.join(HERE, "..", "fonts", "Poppins-*.ttf")):
    fm.fontManager.addfont(f)
plt.rcParams.update({"font.family": "Poppins", "text.parse_math": False})

BG = "#14101F"
PINK, LAV, WHITE, SILENT = "#E0479E", "#C7B6EC", "#FFFFFF", "#5E5A6B"
COUNTS = dict(oppose=80, support=31, nopos=6, silent=57)    # 117 addressed + 57 silent
N = sum(COUNTS.values())
assert N == 174 and COUNTS["oppose"] + COUNTS["support"] + COUNTS["nopos"] == 117


def strands(ax, rng, x0, x1, fade_b_from=None, n=70, amp=0.55, phase=0.0):
    x = np.linspace(x0, x1, 900)
    for i in range(n):
        j = rng.normal(0, 0.06); k = rng.normal(0, 0.035)
        ya = amp * np.sin(0.95 * x + phase) + j + 0.05 * np.sin(3.1 * x + i)
        yb = -amp * np.sin(0.95 * x + phase) + k + 0.05 * np.cos(2.7 * x + i)
        ax.plot(x, ya, color=PINK, lw=0.35, alpha=0.32)
        if fade_b_from is None:
            ax.plot(x, yb, color=LAV, lw=0.35, alpha=0.28)
        else:
            m = x < fade_b_from
            ax.plot(x[m], yb[m], color=LAV, lw=0.35, alpha=0.28)
            # beyond the fade point each thread survives a random distance, fading out
            stop = fade_b_from + rng.exponential(0.9)
            seg = (x >= fade_b_from) & (x <= stop)
            if seg.any():
                xs, ys = x[seg], yb[seg]
                for a0 in range(0, xs.size - 1, 12):
                    fr = (xs[a0] - fade_b_from) / max(stop - fade_b_from, 1e-6)
                    ax.plot(xs[a0:a0 + 13], ys[a0:a0 + 13], color=LAV, lw=0.35, alpha=0.28 * (1 - fr))
    # the second strand thins into particles
    if fade_b_from is not None:
        npart = int(2600 * (x1 - fade_b_from) / 4.1)
        xs = fade_b_from + (x1 - fade_b_from) * rng.random(npart) ** 1.4
        spread = 0.05 + 0.32 * (xs - fade_b_from)
        ys = -amp * np.sin(0.95 * xs + phase) + rng.normal(0, 1, npart) * spread
        al = np.clip(0.55 - 0.12 * (xs - fade_b_from), 0.05, 0.55)
        cols = np.zeros((npart, 4)); cols[:, :3] = matplotlib.colors.to_rgb(LAV); cols[:, 3] = al
        ax.scatter(xs, ys, s=rng.uniform(0.3, 2.2, npart), c=cols, linewidths=0)


def hero(path="cover_hero.png", seed=11):
    rng = np.random.default_rng(seed)
    fig = plt.figure(figsize=(8.0, 5.95), dpi=200)
    fig.patch.set_facecolor(BG)
    ax = fig.add_axes([0, 0.2, 1, 0.64]); ax.set_facecolor(BG)
    ax.set_xlim(-6.3, 6.3); ax.set_ylim(-2.2, 2.2); ax.axis("off")
    strands(ax, rng, -6.3, 6.3, fade_b_from=2.2)
    fig.text(0.052, 0.935, "The auditor's opinion may go. Management's assessment stays,", color="white",
             fontsize=12.5, weight="medium", va="top")
    fig.text(0.052, 0.885, "and from then on it stands alone.", color="#E0479E", fontsize=12.5, weight="medium", va="top")
    fig.add_artist(matplotlib.lines.Line2D([0.052, 0.17], [0.822, 0.822], color="#B21E7D", lw=2.2))
    # 174 dots, one per distinct commenter
    cols = ([PINK] * COUNTS["oppose"] + [LAV] * COUNTS["support"] +
            [WHITE] * COUNTS["nopos"] + [SILENT] * COUNTS["silent"])
    rng.shuffle(cols)
    pts = []
    while len(pts) < N:                         # blue-noise disc, no overlaps
        r = 1.9 * np.sqrt(rng.random()); t = rng.random() * 2 * np.pi
        p = (r * np.cos(t), r * np.sin(t) * 1.02)
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > 0.155 ** 2 for q in pts):
            pts.append(p)
    pts = np.array(pts)
    sizes = rng.uniform(9, 26, N)
    ax.scatter(pts[:, 0], pts[:, 1], s=sizes, c=cols, linewidths=0, zorder=5, alpha=0.95)
    assert len(pts) == N
    # legend band
    lg = fig.add_axes([0, 0, 1, 0.22]); lg.set_facecolor(BG); lg.axis("off")
    lg.set_xlim(0, 100); lg.set_ylim(0, 22)
    for x, h, s in ((5, "BEFORE", "2002 to 2025"), (40, "NOW", "174 commenters, one dot each"),
                    (70, "AFTER", "one strand carries on")):
        lg.plot([x - 1.2, x - 1.2], [12.5, 19], color="#8A84A0", lw=0.8)
        lg.text(x, 18.2, h, color="white", fontsize=8, weight="bold", va="center")
        lg.text(x, 14, s, color="#CFC9DC", fontsize=7, va="center")
    lg.plot([5, 9], [7.5, 7.5], color=PINK, lw=2.2)
    lg.text(10, 7.5, "Management's assessment, Section 404(a)", color="#CFC9DC", fontsize=6.6, va="center")
    lg.plot([52, 56], [7.5, 7.5], color=LAV, lw=2.2)
    lg.text(57, 7.5, "Auditor's attestation, Section 404(b)", color="#CFC9DC", fontsize=6.6, va="center")
    items = [(PINK, "Too broad or do not expand (80)"), (LAV, "Supports the exemption (31)"),
             (WHITE, "No position (6)"), (SILENT, "Silent on attestation (57)")]
    x = 5
    for c, t in items:
        lg.scatter([x + 0.6], [2.6], s=14, color=c, linewidths=0)
        lg.text(x + 1.8, 2.6, t, color="#CFC9DC", fontsize=6.4, va="center")
        x += 23.5
    fig.savefig(path, facecolor=BG)
    plt.close(fig)
    return path


if __name__ == "__main__":
    print(hero(os.path.join(HERE, "cover_hero.png")))


def band(path, part, title, sub, mode, seed=3):
    """Compact part divider, 134 x 40 mm. mode: before | now | after."""
    rng = np.random.default_rng(seed)
    fig = plt.figure(figsize=(5.276, 1.575), dpi=300)
    fig.patch.set_facecolor(BG)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_facecolor(BG); ax.axis("off")
    ax.set_xlim(-6.3, 6.3); ax.set_ylim(-1.5, 1.5)
    x0 = -6.3
    if mode == "before":
        strands(ax, rng, x0, 6.3, fade_b_from=None, n=45, amp=0.45)
    elif mode == "after":
        strands(ax, rng, x0, 6.3, fade_b_from=1.2, n=45, amp=0.45)
    else:
        strands(ax, rng, x0, 6.3, fade_b_from=None, n=45, amp=0.45)
        cols = ([PINK] * COUNTS["oppose"] + [LAV] * COUNTS["support"] + [WHITE] * COUNTS["nopos"] +
                [SILENT] * COUNTS["silent"]); rng.shuffle(cols)
        pts = []
        while len(pts) < N:
            p = (rng.uniform(0.2, 6.0), rng.uniform(-1.35, 1.35))
            if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > 0.16 ** 2 for q in pts):
                pts.append(p)
        pts = np.array(pts)
        ax.scatter(pts[:, 0], pts[:, 1], s=rng.uniform(2, 7, N), c=cols, linewidths=0, zorder=5)
    # soft fade so the text side reads cleanly
    grad = np.clip(np.linspace(1.15, -0.1, 256), 0, 1)[None, :] ** 0.8
    ax.imshow(np.dstack([np.full((1, 256, 3), matplotlib.colors.to_rgb(BG)), grad[..., None]])[0][None],
              extent=(-6.3, 0.8, -1.5, 1.5), aspect="auto", zorder=6)
    ax.text(-5.85, 0.78, part, color="#E0479E", fontsize=6.4, weight="bold", zorder=7)
    ax.text(-5.9, 0.0, title, color="white", fontsize=21, weight="bold", va="center", zorder=7)
    ax.text(-5.85, -0.75, sub, color="#CFC9DC", fontsize=6.4, zorder=7)
    ax.plot([-5.85, -4.75], [-1.08, -1.08], color="#B21E7D", lw=1.6, zorder=7)
    fig.savefig(path, facecolor=BG)
    plt.close(fig)
    return path


def bands():
    band(os.path.join(HERE, "band_before.png"), "PART ONE", "Before", "2002 to 2025: two signatures on internal control", "before")
    band(os.path.join(HERE, "band_now.png"), "PART TWO", "Now", "2026: the proposal, and what 174 commenters said", "now")
    band(os.path.join(HERE, "band_after.png"), "PART THREE", "After", "When one strand thins out: the rule, the market, the program", "after")
