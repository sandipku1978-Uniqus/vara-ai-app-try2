# -*- coding: utf-8 -*-
"""Generates the cover page, one sidebar background per section, and the
nav hit-box coordinates the engine uses to place clickable links."""
from PIL import Image, ImageDraw, ImageFont
import json, os

PURPLE = "#482879"; MAGENTA = "#B21E7D"; PMID = "#A28BBD"; PLIGHT = "#E1D9EB"
GF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts") + "/"
LOGO_COLOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "Logo_Color.png")
LOGO_WHITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "Logo_White_Color.png")

DPI = 150
MM = DPI / 25.4
W, H = int(210 * MM), int(297 * MM)

NAV_TOP_MM   = 80      # where the sidebar list starts
NAV_TEXT_X   = 11      # left inset of the label text
NAV_MAXW_MM  = 34      # wrap width
LINE_MM      = 4.3
PAD_MM       = 2.4


def _f(name, size):
    return ImageFont.truetype(GF + name, size)


def _wrap(draw, text, font, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def nav_rects(nav):
    """Clickable rectangle per nav item, in millimetres from the sheet edge."""
    d = ImageDraw.Draw(Image.new("RGB", (W, H), "white"))
    f = _f("Poppins-Regular.ttf", int(7.4 * MM / 2.2))
    y, out = int(NAV_TOP_MM * MM), []
    for item in nav:
        lines = _wrap(d, item, f, int(NAV_MAXW_MM * MM))
        block = len(lines) * int(LINE_MM * MM) + int(PAD_MM * MM)
        top = (y - int(2.0 * MM)) / MM
        bot = (y + block - int(0.6 * MM)) / MM
        out.append({"top_mm": round(top, 2), "height_mm": round(bot - top, 2)})
        y += block + int(PAD_MM * MM)
    return out


def make_background(nav, active, path, footer_title):
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, int(5 * MM), H], fill=PURPLE)          # spine
    f  = _f("Poppins-Regular.ttf", int(7.4 * MM / 2.2))
    fb = _f("Poppins-Medium.ttf",  int(7.4 * MM / 2.2))
    y = int(NAV_TOP_MM * MM)
    for i, item in enumerate(nav):
        lines = _wrap(d, item, f, int(NAV_MAXW_MM * MM))
        block = len(lines) * int(LINE_MM * MM) + int(PAD_MM * MM)
        on = (i == active)
        if on:
            d.rounded_rectangle([int(7 * MM), y - int(2.0 * MM), int(50 * MM),
                                 y + block - int(0.6 * MM)],
                                radius=int(1.2 * MM), fill=PLIGHT)
        yy = y
        for ln in lines:
            d.text((int(NAV_TEXT_X * MM), yy), ln, font=(fb if on else f),
                   fill=(PURPLE if on else "#9A9AA2"))
            yy += int(LINE_MM * MM)
        y += block + int(PAD_MM * MM)
    fy = int(283 * MM)
    d.line([int(58 * MM), fy, int(192 * MM), fy], fill="#CFC7DA", width=2)
    d.text((int(58 * MM), fy - int(4.6 * MM)), footer_title,
           font=_f("Poppins-Regular.ttf", int(3.1 * MM)), fill="#B9B9C2")
    im.save(path, dpi=(DPI, DPI))


def make_cover(meta, path="page_cover.png", hero="cover_hero.png"):
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([int(120 * MM), int(28 * MM), int(230 * MM), int(150 * MM)],
                        radius=int(30 * MM), fill="#F7F3FA")
    if os.path.exists(LOGO_COLOR):
        logo = Image.open(LOGO_COLOR).convert("RGBA")
        lw = int(38 * MM); lh = int(lw * logo.height / logo.width)
        im.paste(logo.resize((lw, lh), Image.LANCZOS), (int(14 * MM), int(14 * MM)),
                 logo.resize((lw, lh), Image.LANCZOS))
    d = ImageDraw.Draw(im)
    fd = _f("Poppins-Medium.ttf", int(3.5 * MM))
    dt = meta.get("date", "")
    d.text((W - int(14 * MM) - d.textlength(dt, font=fd), int(16 * MM)), dt, font=fd, fill=PURPLE)
    d.line([int(14 * MM), int(32 * MM), int(14 * MM), int(88 * MM)], fill=PMID, width=2)
    d.text((int(20 * MM), int(84 * MM)), meta.get("kicker", "Insights"),
           font=_f("Poppins-Regular.ttf", int(4.6 * MM)), fill=PURPLE)
    ft = _f("Poppins-Bold.ttf", int(11.2 * MM))
    yy = int(93 * MM)
    for line in meta["title_lines"]:
        d.text((int(19 * MM), yy), line, font=ft, fill=PURPLE)
        yy += int(14 * MM)
    if meta.get("strap"):
        d.text((int(19 * MM), yy + int(0.5 * MM)), meta["strap"], font=_f("Poppins-Light.ttf", int(6.2 * MM)), fill=PURPLE)
    fs = _f("Poppins-Regular.ttf", int(3.9 * MM))
    yy = int(130 * MM)
    for line in meta.get("subtitle_lines", []):
        d.text((int(19 * MM), yy), line, font=fs, fill=MAGENTA)
        yy += int(5.4 * MM)
    if os.path.exists(hero):
        hi = Image.open(hero).convert("RGB")
        hw = int(182 * MM); hh = int(hw * hi.height / hi.width)
        im.paste(hi.resize((hw, hh), Image.LANCZOS), (int(14 * MM), int(148 * MM)))
    im.save(path, dpi=(DPI, DPI))


def make_hero(path="cover_hero.png", seed=7):
    """Abstract brand-palette cover art. Replace with a photo if one exists."""
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt, numpy as np
    from matplotlib.patches import Circle
    rng = np.random.default_rng(seed)
    fig, ax = plt.subplots(figsize=(8.0, 6.4), dpi=150)
    fig.patch.set_facecolor("#14101F"); ax.set_facecolor("#14101F")
    ax.set_xlim(-6, 6); ax.set_ylim(-4.8, 4.8); ax.axis("off")
    radii = [1.1, 2.0, 2.9, 3.8, 4.6]
    for r, a in zip(radii, [0.75, 0.6, 0.46, 0.34, 0.24]):
        ax.add_patch(Circle((0, 0), r, fill=False, edgecolor="#7A4FA8", lw=1.1, alpha=a))
    for idx, (r, a, n, c) in enumerate(zip(radii, [1, .9, .8, .7, .6], [26, 40, 54, 68, 84],
                                           ["#E8D9F5", "#C879AB", "#B21E7D", "#8E62B8", "#5E3A91"])):
        th = np.linspace(0, 2 * np.pi, n, endpoint=False) + rng.random() * 2
        ax.scatter(r * np.cos(th), r * np.sin(th), s=[7, 6, 5.5, 4.5, 3.6][idx],
                   color=c, alpha=a, zorder=3, linewidths=0)
    ax.add_patch(Circle((0, 0), 0.5, facecolor="#B21E7D", edgecolor="none", alpha=0.95, zorder=5))
    ax.add_patch(Circle((0, 0), 0.86, fill=False, edgecolor="#E8D9F5", lw=1.4, alpha=0.8, zorder=5))
    plt.savefig(path, facecolor="#14101F", bbox_inches="tight", pad_inches=0)
    plt.close()


def generate(meta, nav):
    if not os.path.exists("cover_hero.png"):
        make_hero()
    make_cover(meta)
    footer = meta.get("footer", meta.get("title", ""))
    for i in range(len(nav)):
        make_background(nav, i, "bg_%d.png" % i, footer)
    json.dump(nav_rects(nav), open("nav_rects.json", "w"))
