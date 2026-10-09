# -*- coding: utf-8 -*-
"""Page-break audit. Measures ink coverage and where content ends on every
page, so stranded paragraphs and half-empty pages are found mechanically
rather than by eye.

    python qa_pages.py mydoc.pdf

LOW-INK  a page carrying almost nothing — usually one or two lines that
         spilled past a page break. Fix by trimming the section, not by
         nudging margins.
SHORT    content ends more than 70mm above the footer. Fine at the end of a
         section; fill it with H.art() sized to (gap - 20mm).
"""
import sys, glob, os, subprocess, tempfile
import numpy as np
from PIL import Image

L, R, T, B = 58.0, 192.0, 24.0, 273.0     # content box in mm
PW, PH = 210.0, 297.0


def audit(pdf, dpi=72, verbose=True):
    tmp = tempfile.mkdtemp()
    subprocess.run(["pdftoppm", "-jpeg", "-r", str(dpi), pdf, os.path.join(tmp, "p")],
                   check=True)
    pages = sorted(glob.glob(os.path.join(tmp, "p-*.jpg")))
    flagged = []
    for i, f in enumerate(pages, 1):
        a = np.array(Image.open(f).convert("L")); h, w = a.shape
        c = a[int(T / PH * h):int(B / PH * h), int(L / PW * w):int(R / PW * w)]
        ink = c < 200
        rows = ink.sum(axis=1)
        nz = np.nonzero(rows > 2)[0]
        pct = ink.mean() * 100
        if len(nz) == 0:
            flagged.append((i, 0.0, 999.0, "EMPTY")); continue
        last = T + nz[-1] / c.shape[0] * (B - T)
        gap = B - last
        flag = "LOW-INK" if pct < 3.5 else ("SHORT" if gap > 70 else "")
        if flag:
            flagged.append((i, round(pct, 2), round(gap, 1), flag))
    if verbose:
        print("pages: %d" % len(pages))
        if not flagged:
            print("PAGE BREAKS CLEAN — no stranded or half-empty pages")
        for row in flagged:
            print("  page %-3d ink %5.2f%%  trailing gap %6.1fmm  %s" % row)
    return len(pages), flagged


if __name__ == "__main__":
    n, bad = audit(sys.argv[1])
    sys.exit(1 if any(f[3] == "LOW-INK" or f[3] == "EMPTY" for f in bad) else 0)
