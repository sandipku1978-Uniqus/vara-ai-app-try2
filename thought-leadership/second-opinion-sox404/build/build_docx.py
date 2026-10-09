# -*- coding: utf-8 -*-
"""Render the publication HTML into a natively styled Word document.

    python render_diagrams.py _body.html      # first: diagrams -> PNG
    python build_docx.py _body.html MyDoc.docx

Every component is mapped explicitly to Word tables, shading and borders, in
Arial per the brand standard. Anything the renderer does not recognise falls
back to plain paragraphs, so text is never silently dropped. Verify with
fidelity.py afterwards.
"""
import json, os, re, sys, hashlib
from bs4 import BeautifulSoup, NavigableString, Tag
from docx import Document
from docx.shared import Pt, Mm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

PURPLE = "482879"; MAGENTA = "B21E7D"; PLIGHT = "E1D9EB"; PINKL = "EED8E6"
GBODY = "333333"; GMETA = "7A7A85"; HEAD = "3E3E4A"
F = "Arial"
CW = 170.0          # A4 minus 20mm margins
IMG_W = 150.0       # width for figures and diagrams

IN = sys.argv[1] if len(sys.argv) > 1 else "_body.html"
OUT = sys.argv[2] if len(sys.argv) > 2 else "publication.docx"
WD = os.path.dirname(os.path.abspath(IN))
_m = os.path.join(WD, "dg_map.json")
DGMAP = json.load(open(_m)) if os.path.exists(_m) else {}

doc = Document()
_s = doc.sections[0]
_s.page_width, _s.page_height = Mm(210), Mm(297)
_s.left_margin = _s.right_margin = Mm(20)
_s.top_margin = _s.bottom_margin = Mm(20)
_st = doc.styles["Normal"]
_st.font.name = F; _st.font.size = Pt(9.5); _st.font.color.rgb = RGBColor.from_string(GBODY)
_st.paragraph_format.space_after = Pt(6); _st.paragraph_format.line_spacing = 1.12

# ------------------------------------------------------------------ helpers
def shade(cell, hexcolor):
    el = OxmlElement("w:shd"); el.set(qn("w:val"), "clear"); el.set(qn("w:color"), "auto"); el.set(qn("w:fill"), hexcolor)
    cell._tc.get_or_add_tcPr().append(el)

def borders(cell, **kw):
    tcPr = cell._tc.get_or_add_tcPr(); b = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        spec = kw.get(edge); e = OxmlElement("w:" + edge)
        if spec is None:
            e.set(qn("w:val"), "nil")
        else:
            sz, col, val = spec; e.set(qn("w:val"), val); e.set(qn("w:sz"), str(sz)); e.set(qn("w:color"), col)
        b.append(e)
    tcPr.append(b)

def margins(cell, t=100, b=100, l=150, r=150):
    tcPr = cell._tc.get_or_add_tcPr(); m = OxmlElement("w:tcMar")
    for tag, v in (("top", t), ("start", l), ("bottom", b), ("end", r)):
        e = OxmlElement("w:" + tag); e.set(qn("w:w"), str(v)); e.set(qn("w:type"), "dxa"); m.append(e)
    tcPr.append(m)

def keep_row(row):
    row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))

def header_row(row):
    """Repeat on every page and never sit alone at a page foot."""
    row._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    for c in row.cells:
        for p in c.paragraphs: p.paragraph_format.keep_with_next = True

def keep_together(table):
    """Hold a short table on one page: rows never split, each row stays with the next."""
    for i, r in enumerate(table.rows):
        keep_row(r)
        if i < len(table.rows) - 1:
            for c in r.cells:
                for p in c.paragraphs: p.paragraph_format.keep_with_next = True

def run(p, text, size=9.5, color=GBODY, bold=False, italic=False):
    r = p.add_run(text); r.font.name = F; r.font.size = Pt(size)
    r.font.color.rgb = RGBColor.from_string(color); r.bold = bold; r.italic = italic
    return r

def inline(node, p, size=9.5, color=GBODY, bold=False, italic=False):
    if isinstance(node, NavigableString):
        t = str(node)
        if t.strip() == "" and "\n" in t:
            return
        run(p, re.sub(r"\s+", " ", t), size, color, bold, italic); return
    if node.name == "br":
        p.add_run().add_break(); return
    b = bold or node.name in ("b", "strong"); i = italic or node.name in ("i", "em")
    col = "2B2B33" if node.name in ("b", "strong") and color == GBODY else color
    for ch in node.children:
        inline(ch, p, size, col, b, i)

def para(container=None, after=6, justify=True, line=1.12):
    p = container.add_paragraph() if container is not None else doc.add_paragraph()
    p.paragraph_format.space_after = Pt(after); p.paragraph_format.line_spacing = line
    if justify: p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    return p

def cell_para(cell, used, after=3, justify=False):
    if not used[0]:
        used[0] = True; p = cell.paragraphs[0]
    else:
        p = cell.add_paragraph()
    p.paragraph_format.space_after = Pt(after); p.paragraph_format.line_spacing = 1.1
    if justify: p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    return p

def bullets(ul, cell=None, size=9.0, color=GBODY, used=None):
    for li in ul.find_all("li", recursive=False):
        p = cell_para(cell, used) if cell is not None else para(None, 3, False, 1.1)
        pf = p.paragraph_format; pf.left_indent = Mm(5); pf.first_line_indent = Mm(-3.4); pf.space_after = Pt(3)
        run(p, "\u2022  ", size, MAGENTA, bold=True)
        for ch in li.children:
            inline(ch, p, size, color)

def heading(text, size, color, bold=True, before=10, after=4):
    p = doc.add_paragraph(); pf = p.paragraph_format
    pf.space_before = Pt(before); pf.space_after = Pt(after); pf.keep_with_next = True
    run(p, text, size, color, bold); return p

def small(el, color=GMETA, italic=True, size=7.4, after=10):
    p = para(None, after, False, 1.05)
    for ch in el.children: inline(ch, p, size, color, italic=italic)
    return p

def box(fill=None, border=(6, "E2DDEA", "single"), accent=None, width=CW):
    t = doc.add_table(rows=1, cols=1); t.autofit = False; t.alignment = WD_TABLE_ALIGNMENT.LEFT
    t.columns[0].width = Mm(width); c = t.rows[0].cells[0]; c.width = Mm(width)
    if fill: shade(c, fill)
    bd = {e: border for e in ("top", "left", "bottom", "right")}
    if accent: bd["left"] = (24, accent, "single")
    borders(c, **bd); margins(c, 120, 120, 180, 180)
    return c

def spacer(after=6):
    doc.add_paragraph().paragraph_format.space_after = Pt(after)

def picture(path, width=IMG_W):
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after = Pt(4)
    p.add_run().add_picture(path, width=Mm(min(width, CW)))

def text_blocks(el, cell, used, size=9.0, color=GBODY):
    for ch in el.children:
        if isinstance(ch, NavigableString):
            if ch.strip():
                p = cell_para(cell, used); run(p, ch.strip(), size, color)
            continue
        cls = ch.get("class") or []
        if ch.name == "ul":
            bullets(ch, cell, size - 0.2, color, used)
        elif ch.name == "p":
            kick = "kicker" in cls
            p = cell_para(cell, used, justify=not kick)
            for x in ch.children: inline(x, p, size, PURPLE if kick else color, bold=kick)
        elif ch.name == "div" and "chips" in cls:
            p = cell_para(cell, used)
            run(p, "   \u00b7   ".join(s.get_text(strip=True) for s in ch.find_all("span")), size, PURPLE, bold=True)
        else:
            p = cell_para(cell, used)
            for x in ch.children: inline(x, p, size, color)

# ------------------------------------------------------------------ components
def c_pov(el):
    c = box(fill="FBEFF5", border=(6, "F2DCE8", "single")); used = [False]
    p = cell_para(c, used, after=5); run(p, el.find("div", class_="hd").get_text(" ", strip=True), 10.5, MAGENTA, True)
    p.paragraph_format.keep_with_next = True
    text_blocks(el.find("div", class_="bd"), c, used, 9.0); spacer()

def c_prac(el):
    c = box(fill="FCFBFD"); used = [False]
    p = cell_para(c, used, after=5); run(p, el.find("div", class_="hd").get_text(" ", strip=True), 10, MAGENTA, True)
    p.paragraph_format.keep_with_next = True
    text_blocks(el.find("div", class_="bd"), c, used, 8.8); spacer()

def c_impl(el):
    accent = MAGENTA if "m" in (el.get("class") or []) else PURPLE
    c = box(border=(4, "C9BFD8", "dashed"), accent=accent); used = [False]
    p = cell_para(c, used, after=0); t = el.find("span", class_="t")
    if t: run(p, t.get_text(" ", strip=True) + "  ", 8.8, PURPLE, True)
    for ch in el.children:
        if isinstance(ch, Tag) and ch.name == "span" and "t" in (ch.get("class") or []): continue
        inline(ch, p, 8.8)
    spacer()

def c_rec(el):
    c = box(fill="FEFAFC", border=(8, PINKL, "single")); used = [False]
    p = cell_para(c, used, after=4); run(p, el.find("div", class_="hd").get_text(" ", strip=True), 10, PURPLE, True)
    p.paragraph_format.keep_with_next = True
    ul = el.find("ul")
    if ul: bullets(ul, c, 8.8, GBODY, used)
    spacer()

def c_impbox(el):
    c = box(fill="FCFBFD"); used = [False]
    p = cell_para(c, used, after=4); run(p, el.find("div", class_="hd").get_text(" ", strip=True), 10, PURPLE, True)
    p.paragraph_format.keep_with_next = True
    for it in el.find_all("div", class_="it"):
        b = it.find("b")
        p = cell_para(c, used, after=1); run(p, b.get_text(" ", strip=True), 8.8, PURPLE, True)
        b.extract()
        p = cell_para(c, used, after=4)
        for x in it.children: inline(x, p, 8.6)
    spacer()

def c_objective(el):
    c = box(fill="FDF6FA", border=(4, "F2DCE8", "single"), accent=MAGENTA); used = [False]
    p = cell_para(c, used, after=0)
    for x in el.children: inline(x, p, 9.0, HEAD, bold=True)
    spacer()

def c_callout(el):
    c = box(fill="F5F1F9", border=(4, "E2DDEA", "single"), accent=PURPLE); used = [False]
    lead = el.find("div", class_="lead")
    p = cell_para(c, used, after=3)
    for x in lead.children: inline(x, p, 9.2, PURPLE, bold=True)
    lead.extract()
    text_blocks(el, c, used, 9.0); spacer()

def c_question(el):
    c = box(border=(2, "FFFFFF", "single"), accent=MAGENTA); used = [False]
    p = cell_para(c, used, after=0)
    for x in el.children: inline(x, p, 9.6, PURPLE, bold=True)
    spacer(4)

def c_pull(el):
    p = para(after=8, justify=False); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    run(p, el.get_text(" ", strip=True), 12.5, MAGENTA, True)

def c_compare(el):
    cols = el.find_all("div", class_="cl")
    t = doc.add_table(rows=1, cols=len(cols)); t.autofit = False
    for i, cl in enumerate(cols):
        c = t.rows[0].cells[i]; c.width = Mm(CW / len(cols))
        shade(c, "F3EEF8" if i == 0 else "FBEFF5")
        borders(c, top=(4, "FFFFFF", "single"), left=(4, "FFFFFF", "single"),
                right=(4, "FFFFFF", "single"), bottom=(4, "FFFFFF", "single"))
        margins(c, 120, 120, 150, 150); used = [False]
        p = cell_para(c, used, after=4)
        run(p, cl.find("div", class_="h").get_text(" ", strip=True), 9.2, PURPLE if i == 0 else MAGENTA, True)
        bullets(cl.find("ul"), c, 8.4, GBODY, used)
    keep_together(t)
    spacer()

def c_card(el):
    ok = "ok" in (el.get("class") or [])
    top = el.find("div", class_="top"); nar = el.find("div", class_="nar")
    rows = el.find_all("div", class_="row", recursive=False)
    n = 1 + (1 if nar else 0) + len(rows)
    t = doc.add_table(rows=n, cols=1); t.autofit = False; t.columns[0].width = Mm(CW)
    edge = (6, MAGENTA if ok else "E2DDEA", "single"); inner = (4, "EFECF4", "single")
    def setup(c, i):
        c.width = Mm(CW); margins(c, 100, 100, 150, 150)
        borders(c, top=edge if i == 0 else inner, left=edge, right=edge, bottom=edge if i == n - 1 else inner)
    c = t.rows[0].cells[0]; setup(c, 0); shade(c, PINKL if ok else PLIGHT); used = [False]
    tag = top.find("div", class_="tag")
    if tag:
        p = cell_para(c, used, after=1); run(p, tag.get_text(strip=True), 6.8, MAGENTA, True)
    p = cell_para(c, used, after=1); run(p, top.find("div", class_="ti").get_text(" ", strip=True), 9.6, MAGENTA if ok else PURPLE, True)
    p = cell_para(c, used, after=0); run(p, top.find("div", class_="ex").get_text(" ", strip=True), 7.8, "55555F")
    i = 1
    if nar:
        c = t.rows[i].cells[0]; setup(c, i); used = [False]; i += 1
        for ch in nar.children:
            if not isinstance(ch, Tag): continue
            cls = ch.get("class") or []
            if "mh" in cls:
                p = cell_para(c, used, after=1); p.paragraph_format.space_before = Pt(4)
                run(p, ch.get_text(" ", strip=True).upper(), 7.6, PURPLE, True)
            elif "fl" in cls:
                p = cell_para(c, used, after=1); p.paragraph_format.left_indent = Mm(3)
                for x in ch.children: inline(x, p, 8.2, HEAD, bold=True)
            elif "tk" in cls:
                p = cell_para(c, used, after=3)
                for x in ch.children: inline(x, p, 8.6, MAGENTA, bold=True)
            elif ch.name == "ul":
                bullets(ch, c, 8.2, GBODY, used)
            else:
                p = cell_para(c, used, after=3)
                for x in ch.children: inline(x, p, 8.4)
    for rw in rows:
        c = t.rows[i].cells[0]; setup(c, i); used = [False]; i += 1
        lb = rw.find("span", class_="lb")
        p = cell_para(c, used, after=1); run(p, lb.get_text(" ", strip=True), 7.4, MAGENTA, True)
        lb.extract()
        text_blocks(rw, c, used, 8.4)
    for r in t.rows: keep_row(r)
    for p in t.rows[0].cells[0].paragraphs: p.paragraph_format.keep_with_next = True
    spacer()

def c_table(el):
    rows = el.find_all("tr")
    hdr = rows[0].find_all(["th", "td"]); ncol = len(hdr)
    widths = []
    for th in hdr:
        m = re.search(r"width:([\d.]+)%", th.get("style") or "")
        widths.append(float(m.group(1)) / 100 * CW if m else CW / ncol)
    t = doc.add_table(rows=len(rows), cols=ncol); t.autofit = False
    for ri, row in enumerate(rows):
        cells = row.find_all(["th", "td"])
        for ci, cd in enumerate(cells[:ncol]):
            c = t.rows[ri].cells[ci]; c.width = Mm(widths[ci]); margins(c, 70, 70, 100, 100)
            if ri == 0:
                shade(c, PURPLE)
                borders(c, top=(4, PURPLE, "single"), left=(4, PURPLE, "single"), right=(4, PURPLE, "single"), bottom=(4, PURPLE, "single"))
            else:
                if ri % 2 == 0: shade(c, "F8F6FB")
                borders(c, top=(4, "E4E0EB", "single"), left=(4, "E4E0EB", "single"), right=(4, "E4E0EB", "single"), bottom=(4, "E4E0EB", "single"))
            col = "FFFFFF" if ri == 0 else (PURPLE if "k" in (cd.get("class") or []) else GBODY)
            p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); p.paragraph_format.line_spacing = 1.08
            for ch in cd.children:
                inline(ch, p, 7.8, col, bold=(ri == 0))
    for r in t.rows: keep_row(r)
    header_row(t.rows[0])
    spacer()

def c_era(tbl):
    rows = tbl.find_all("tr")
    t = doc.add_table(rows=len(rows), cols=3); t.autofit = False
    w = [CW * 0.26, CW * 0.49, CW * 0.25]
    for ri, tr in enumerate(rows):
        tds = tr.find_all("td")
        for ci in range(3):
            c = t.rows[ri].cells[ci]; c.width = Mm(w[ci]); margins(c, 90, 90, 120, 120)
            shade(c, "FBEFF5" if ci == 2 else "F8F6FB")
            borders(c, top=(8, "FFFFFF", "single"), bottom=(8, "FFFFFF", "single"),
                    left=(24, PURPLE, "single") if ci == 0 else (4, "FFFFFF", "single"), right=(4, "FFFFFF", "single"))
        a = tds[0]; used = [False]; c = t.rows[ri].cells[0]
        p = cell_para(c, used, after=0); run(p, a.find("div", class_="per").get_text(" ", strip=True), 8.4, MAGENTA, True)
        p = cell_para(c, used, after=0); run(p, a.find("div", class_="ti").get_text(" ", strip=True).upper(), 8.4, PURPLE, True)
        sub = a.find("div", class_="sub").get_text(" ", strip=True)
        if sub:
            p = cell_para(c, used, after=0); run(p, sub, 7.4, GMETA, italic=True)
        c = t.rows[ri].cells[1]; used = [False]
        for pp in tds[1].find_all("p"):
            p = cell_para(c, used, after=2)
            for x in pp.children: inline(x, p, 8.0)
        c = t.rows[ri].cells[2]; used = [False]
        p = cell_para(c, used, after=1); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run(p, tds[2].find("div", class_="st").get_text(" ", strip=True), 11, MAGENTA, True)
        p = cell_para(c, used, after=0); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run(p, tds[2].find("div", class_="sc").get_text(" ", strip=True), 7.2, "55555F")
    for r in t.rows: keep_row(r)


def c_panels(tbl):
    """Two-panel on/off comparison as an editable Word table."""
    cells = tbl.find_all("td", class_="pn")
    cols = []
    for pn in cells:
        items = [(bx.find("div", class_="bh").get_text(" ", strip=True), bx.find("div", class_="bt").get_text(" ", strip=True))
                 for bx in pn.find_all("div", class_="bx")]
        pf = pn.find("div", class_="pf"); head = pf.find("b").get_text(" ", strip=True)
        foot = pf.get_text(" ", strip=True)[len(head):].strip()
        cols.append((pn.find("div", class_="pt").get_text(" ", strip=True), items, head, foot, "r" in (pn.get("class") or [])))
    n = 2 + max(len(c[1]) for c in cols)
    t = doc.add_table(rows=n, cols=len(cols)); t.autofit = False
    for ci, (title, items, head, foot, right) in enumerate(cols):
        acc = MAGENTA if right else PURPLE; fill = "FBEFF5" if right else "F7F3FA"
        for ri in range(n):
            c = t.rows[ri].cells[ci]; c.width = Mm(CW / len(cols)); margins(c, 90, 90, 130, 130)
            dash = (6, acc, "dashed"); white = (10, fill, "single")
            borders(c, top=dash if ri == 0 else white, bottom=dash if ri == n - 1 else white, left=dash, right=dash)
            shade(c, fill); used = [False]
            if ri == 0:
                p = cell_para(c, used, after=0); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; run(p, title, 9.2, acc, True)
            elif ri <= len(items):
                h, tx = items[ri - 1]; shade(c, "FFFFFF")
                p = cell_para(c, used, after=1); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; run(p, h, 8.6, acc, True)
                p = cell_para(c, used, after=0); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; run(p, tx, 7.6, "55555F")
            else:
                p = cell_para(c, used, after=1); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; run(p, head, 8.2, acc, True)
                p = cell_para(c, used, after=0); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; run(p, foot, 7.6, GMETA, italic=True)
    keep_together(t)

def c_layers(tbl):
    """Nested exposure layers as a graduated Word table, outermost first."""
    la = tbl.find("td", class_="la")
    inb = la.find("div", class_="in"); outb = la.find("div", class_="out")
    layers = []
    ly = tbl.find("div", class_="ly")
    while ly is not None:
        lt = ly.find("div", class_="lt", recursive=False); sp = lt.find("span")
        sub = sp.get_text(" ", strip=True) if sp else ""
        if sp: sp.extract()
        layers.append((lt.get_text(" ", strip=True), sub,
                       ly.find("div", class_="lw", recursive=False).get_text(" ", strip=True),
                       ly.find("div", class_="le", recursive=False).get_text(" ", strip=True)))
        ly = ly.find("div", class_="ly", recursive=False)
    fills = ["EFE8F5", "D8C9E8", "A98BC8", "6A4496", "202429"]
    t = doc.add_table(rows=len(layers) + 1, cols=3); t.autofit = False
    w = [CW * 0.30, CW * 0.36, CW * 0.34]
    heads = [inb.get_text(" ", strip=True), "Who sits in the layer", "Exposure"]
    for ci in range(3):
        c = t.rows[0].cells[ci]; c.width = Mm(w[ci]); shade(c, PURPLE); margins(c, 80, 80, 110, 110)
        borders(c, top=(4, PURPLE, "single"), bottom=(4, PURPLE, "single"), left=(4, PURPLE, "single"), right=(4, PURPLE, "single"))
        p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, heads[ci], 8.2, "FFFFFF", True)
    for ri, (title, sub, who, exp) in enumerate(layers, 1):
        fill = fills[min(ri - 1, len(fills) - 1)]; light = ri - 1 < 2
        tc = PURPLE if light else "FFFFFF"
        for ci in range(3):
            c = t.rows[ri].cells[ci]; c.width = Mm(w[ci]); margins(c, 80, 80, 110, 110)
            shade(c, fill if ci == 0 else ("F8F6FB" if ri % 2 else "FFFFFF"))
            borders(c, top=(4, "E4E0EB", "single"), bottom=(4, "E4E0EB", "single"), left=(4, "E4E0EB", "single"), right=(4, "E4E0EB", "single"))
        used = [False]; c = t.rows[ri].cells[0]
        p = cell_para(c, used, after=0); run(p, title, 8.4, tc, True)
        if sub: p = cell_para(c, used, after=0); run(p, sub, 7.4, tc, italic=True)
        p = t.rows[ri].cells[1].paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, who, 7.8)
        p = t.rows[ri].cells[2].paragraphs[0]; p.paragraph_format.space_after = Pt(0); run(p, exp, 7.8, PURPLE, True)
    keep_together(t)
    p = para(after=2, justify=False); run(p, outb.get_text(" ", strip=True), 8.2, MAGENTA, True)

def c_flow(el):
    steps = [s.get_text(" ", strip=True) for s in el.find_all("div", class_="st")]
    cols = len(steps) * 2 - 1
    t = doc.add_table(rows=1, cols=cols); t.autofit = False
    aw = 8.0; sw = (CW - aw * (len(steps) - 1)) / len(steps)
    k = 0
    for i, s in enumerate(steps):
        if i:
            c = t.rows[0].cells[k]; c.width = Mm(aw); borders(c); k += 1
            p = c.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER; run(p, "\u2192", 11, MAGENTA, True)
        c = t.rows[0].cells[k]; c.width = Mm(sw); k += 1
        last = i == len(steps) - 1
        shade(c, MAGENTA if last else PLIGHT); borders(c); margins(c, 110, 110, 90, 90)
        p = c.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after = Pt(0)
        run(p, s, 8.6, "FFFFFF" if last else PURPLE, True)
    spacer(4)

missing = []
def c_diagram(el):
    key = hashlib.md5(str(el).encode("utf8")).hexdigest()[:12]
    path = os.path.join(WD, DGMAP.get(key, "_none_"))
    if os.path.exists(path):
        picture(path)
    else:
        missing.append(key)
        for x in el.stripped_strings:
            p = para(after=1, justify=False); run(p, x, 8.4)

def c_exhibit(el):
    heading(el.find("div", class_="cap").get_text(" ", strip=True), 9.6, PURPLE, before=10, after=4).paragraph_format.keep_with_next = True
    img = el.find("img", recursive=False); dg = el.find("div", class_="dg")
    if img is not None:
        picture(os.path.join(WD, img["src"]))
    elif dg is not None:
        era = dg.find("table", class_="era"); pan = dg.find("table", class_="panels"); lyr = dg.find("table", class_="lyr")
        if era is not None: c_era(era)
        elif pan is not None: c_panels(pan)
        elif lyr is not None: c_layers(lyr)
        else: c_diagram(dg)
    note = el.find("p", class_="exnote")
    if note:
        p = para(after=2, justify=False); run(p, note.get_text(" ", strip=True), 8.8, MAGENTA, True)
    src = el.find("p", class_="src")
    if src: small(src)

def c_quad(el):
    cells = el.find_all("div", class_="c")
    t = doc.add_table(rows=2, cols=2); t.autofit = False
    for i, cd in enumerate(cells[:4]):
        c = t.rows[i // 2].cells[i % 2]; c.width = Mm(CW / 2)
        m = "m" in (cd.get("class") or [])
        borders(c, top=(4, "C9BFD8", "dashed"), left=(4, "C9BFD8", "dashed"), right=(4, "C9BFD8", "dashed"), bottom=(4, "C9BFD8", "dashed"))
        margins(c, 110, 110, 140, 140); used = [False]
        p = cell_para(c, used, after=3); run(p, cd.find("div", class_="h").get_text(" ", strip=True), 9.6, MAGENTA if m else PURPLE, True)
        bullets(cd.find("ul"), c, 8.0, GBODY, used)
    keep_together(t)
    spacer()

def c_closing(el):
    c = box(border=(4, "C9BFD8", "dashed")); used = [False]
    text_blocks(el, c, used, 9.2); spacer()

def c_people(el, grid):
    groups = el.find_all("div", class_="r") if grid else [el]
    cls = "p" if grid else "s"
    for g in groups:
        ppl = g.find_all("div", class_=cls)
        t = doc.add_table(rows=1, cols=3); t.autofit = False
        for i in range(3):
            c = t.rows[0].cells[i]; c.width = Mm(CW / 3); margins(c, 90, 90, 120, 120)
            if grid and i < len(ppl):
                borders(c, top=(4, "E2DDEA", "single"), left=(4, "E2DDEA", "single"), right=(4, "E2DDEA", "single"), bottom=(4, "E2DDEA", "single"))
            else:
                borders(c)
            if i >= len(ppl): continue
            used = [False]
            p = cell_para(c, used, after=1); run(p, ppl[i].find("div", class_="nm").get_text(" ", strip=True), 9.4, MAGENTA, True)
            tt = ppl[i].find("div", class_="tt" if grid else "ttl")
            p = cell_para(c, used, after=0); run(p, tt.get_text(" ", strip=True), 7.6, "55555F", italic=not grid)
        spacer(3)

DISPATCH = [("pov", c_pov), ("prac", c_prac), ("impl", c_impl), ("rec", c_rec), ("impbox", c_impbox),
            ("objective", c_objective), ("callout", c_callout), ("question", c_question), ("pull", c_pull),
            ("compare", c_compare), ("arr", c_card), ("exh", c_exhibit), ("quad", c_quad), ("closing", c_closing)]

def render(el):
    if isinstance(el, NavigableString):
        if el.strip():
            p = para(); run(p, el.strip())
        return
    name = el.name; cls = el.get("class") or []
    if name in ("style", "script"): return
    if name == "h1": heading(el.get_text(" ", strip=True), 19, HEAD, bold=False, before=0, after=10); return
    if name == "h2": heading(el.get_text(" ", strip=True), 12, MAGENTA, before=12, after=4); return
    if name == "h3": heading(el.get_text(" ", strip=True), 10, PURPLE, before=8, after=3); return
    if name == "p":
        if "src" in cls or "note" in cls: small(el); return
        emph = "emph" in cls
        p = para()
        for ch in el.children: inline(ch, p, 9.5, MAGENTA if emph else GBODY, bold=emph)
        return
    if name == "ul": bullets(el); return
    if name == "table":
        if "era" in cls: c_era(el)
        else: c_table(el)
        return
    if name == "div":
        if "subhead" in cls: heading(el.get_text(" ", strip=True), 10.5, PURPLE, before=8, after=3); return
        if "flow" in cls: c_flow(el); return
        if "sigrow" in cls: c_people(el, grid=False); return
        if "team" in cls: c_people(el, grid=True); return
        if any(k in cls for k in ("fill", "navlinks", "cover", "chdown")): return
        for k, fn in DISPATCH:
            if k in cls: fn(el); return
    for ch in el.children:          # fallback: never drop text silently
        render(ch)

soup = BeautifulSoup(open(IN).read(), "html.parser")
cover = os.path.join(WD, "page_cover.png")
if os.path.exists(cover):
    picture(cover, CW); doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
first = True
for blk in soup.body.children:
    if not isinstance(blk, Tag): continue
    cls = blk.get("class") or []
    if "navlinks" in cls: continue
    if "sec" in cls:
        if not first:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        first = False
        for ch in blk.children: render(ch)
    elif blk.name == "div" and not cls:
        continue                      # layout spacer
    else:
        render(blk)
doc.save(OUT)
print("docx written:", OUT, "| diagrams without an image:", len(missing))
