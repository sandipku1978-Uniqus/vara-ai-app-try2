# -*- coding: utf-8 -*-
"""Render every HTML diagram in the publication (div.dg, div.flow) to a
cropped 300-dpi PNG so the Word version can carry it as an image.

    python render_diagrams.py _body.html

Writes dg_<hash>.png next to the HTML and dg_map.json mapping hash -> file.
The era timeline (table.era) is skipped: Word renders it as a real table.
"""
import hashlib, json, os, subprocess, sys, tempfile
from bs4 import BeautifulSoup
from PIL import Image, ImageChops

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine


def dg_key(el):
    return hashlib.md5(str(el).encode("utf8")).hexdigest()[:12]


def crop(path, pad=12):
    im = Image.open(path).convert("RGB")
    bg = Image.new("RGB", im.size, "white")
    box = ImageChops.difference(im, bg).getbbox()
    if box:
        l, t, r, b = box
        im = im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))
    im.save(path)


def render(body_html, workdir="."):
    from weasyprint import HTML
    soup = BeautifulSoup(open(body_html).read(), "html.parser")
    css = engine.build_css(1, "") + "\n@page { size:%smm 520mm; margin:0; @bottom-right{ content:none; } }\nbody{ margin:0; }" % engine.CONTENT_W_MM
    # only the <style> blocks inside <body>: the <head> stylesheet carries the A4 page
    # rule and page-number footer, which would override the diagram page size
    extra = "".join(str(s) for s in soup.body.find_all("style"))
    mapping, tmp = {}, tempfile.mkdtemp()
    for el in soup.select("div.dg, div.flow"):
        if el.select_one("table.era"):
            continue
        key = dg_key(el)
        if key in mapping:
            continue
        html = ("<html><head><meta charset='utf-8'><style>%s</style>%s</head><body>%s</body></html>"
                % (css, extra, str(el)))
        pdf = os.path.join(tmp, key + ".pdf")
        HTML(string=html, base_url=os.path.abspath(workdir) + "/").write_pdf(pdf)
        out = os.path.join(workdir, "dg_" + key)
        subprocess.run(["pdftoppm", "-png", "-r", "300", "-f", "1", "-l", "1", "-singlefile", pdf, out], check=True)
        crop(out + ".png")
        mapping[key] = "dg_" + key + ".png"
    json.dump(mapping, open(os.path.join(workdir, "dg_map.json"), "w"), indent=1)
    return mapping


if __name__ == "__main__":
    m = render(sys.argv[1], os.path.dirname(os.path.abspath(sys.argv[1])))
    print("diagrams rendered:", len(m))
