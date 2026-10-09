# -*- coding: utf-8 -*-
"""Navigation audit. A link that resolves is not a link that works — this
checks destination, rectangle position AND that the hot-spot actually sits
over its label.

    python verify_nav.py mydoc.pdf nav_rects.json "Nav item 1" "Nav item 2" ...

Checks per item:
  target  the destination page contains text matching the nav label
  rect    the clickable rectangle sits at 7mm from the sheet edge, at the
          height the sidebar artwork drew the label
  cover   the cover page carries no links at all
"""
import sys, json, glob, os, subprocess, tempfile
import numpy as np
from PIL import Image
from pypdf import PdfReader

PT = 72 / 25.4
PH_PT = 841.89


def verify(pdf, rects_json, labels, dpi=72):
    r = PdfReader(pdf)
    nd = r.named_destinations
    rects = json.load(open(rects_json))
    tmp = tempfile.mkdtemp()
    subprocess.run(["pdftoppm", "-jpeg", "-r", str(dpi), "-f", "2", "-l", "2", pdf,
                    os.path.join(tmp, "p")], check=True)
    img = sorted(glob.glob(os.path.join(tmp, "p-*.jpg")))[0]
    a = np.array(Image.open(img).convert("L")); H, W = a.shape
    x0, x1 = int(7 / 210 * W), int(50 / 210 * W)
    ann = r.pages[1].get("/Annots") or []
    ok = True
    print("%-42s%6s  %-8s%-8s%s" % ("nav item", "page", "target", "rect", "over label"))
    for i, label in enumerate(labels):
        d = nd.get("nav%d" % i)
        if d is None:
            print("%-42s  MISSING DESTINATION" % label); ok = False; continue
        pg = r.get_page_number(d.page.get_object()) + 1
        txt = subprocess.run(["pdftotext", "-f", str(pg), "-l", str(pg), pdf, "-"],
                             capture_output=True, text=True).stdout.lower()
        key = label.split(".", 1)[-1].strip().lower()[:18]
        t_ok = key in txt
        o = ann[i].get_object()
        rx0, ry0, ry1 = float(o["/Rect"][0]), float(o["/Rect"][1]), float(o["/Rect"][3])
        r_ok = abs(rx0 / PT - 7.0) < 0.5 and abs((PH_PT - max(ry0, ry1)) / PT - rects[i]["top_mm"]) < 0.5
        y0 = int(rects[i]["top_mm"] / 297 * H)
        y1 = int((rects[i]["top_mm"] + rects[i]["height_mm"]) / 297 * H)
        ink = int((a[y0:y1, x0:x1] < 200).sum())     # light grey labels: use 200, not 160
        h_ok = ink > 60
        ok = ok and t_ok and r_ok and h_ok
        print("%-42s%6d  %-8s%-8s%s" % (label, pg, "OK" if t_ok else "FAIL",
                                        "OK" if r_ok else "FAIL",
                                        "OK (%dpx)" % ink if h_ok else "FAIL"))
    cover = len(r.pages[0].get("/Annots") or [])
    print("\ncover links (must be 0): %d" % cover)
    print("ALL NAVIGATION LINKS WORKING:", ok and cover == 0)
    return ok and cover == 0


if __name__ == "__main__":
    sys.exit(0 if verify(sys.argv[1], sys.argv[2], sys.argv[3:]) else 1)
