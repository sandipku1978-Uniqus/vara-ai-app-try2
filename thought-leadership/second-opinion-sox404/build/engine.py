# -*- coding: utf-8 -*-
"""
Uniqus Insights publication engine.

Renders a branded A4 publication with a repeating, clickable sidebar
navigation, a design-system component library, a separately rendered cover,
and a PDF outline. See ../SKILL.md for the workflow and
../references/engine-notes.md for why the layout is built this way.
"""
import json, os, re, subprocess

# ----------------------------------------------------------------- palette
PURPLE  = "#482879"
MAGENTA = "#B21E7D"
PMID    = "#A28BBD"
PLIGHT  = "#E1D9EB"
PINKL   = "#EED8E6"
DARK    = "#202429"
GBODY   = "#333333"
GMETA   = "#7A7A85"
HEADCOL = "#3E3E4A"

# ----------------------------------------------------------------- geometry
PAGE_W_MM, PAGE_H_MM = 210.0, 297.0
MARGIN_TOP, MARGIN_RIGHT, MARGIN_BOTTOM, MARGIN_LEFT = 24.0, 18.0, 24.0, 58.0
CONTENT_W_MM = PAGE_W_MM - MARGIN_LEFT - MARGIN_RIGHT   # 134mm

GF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts") + "/"
LOGO_COLOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "Logo_Color.png")
LOGO_WHITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "Logo_White_Color.png")


# ===================================================================
#  Component helpers — each returns an HTML fragment.
# ===================================================================
class H:
    """Component library. Compose these into section bodies."""

    # --- structure -------------------------------------------------
    @staticmethod
    def sec(nav_index, body):
        """Start a NEW section on a fresh page, with sidebar item `nav_index` active."""
        return '<div class="sec" style="page:s%d">%s</div>' % (nav_index, body)

    @staticmethod
    def cont(nav_index, body):
        """Continue the SAME section without forcing a page break.
        Use for sub-sections (3.2, 3.3 ...) — see engine-notes.md."""
        return '<div style="page:s%d">%s</div>' % (nav_index, body)

    @staticmethod
    def h1(text):
        return "<h1>%s</h1>" % text

    @staticmethod
    def h2(text):
        return "<h2>%s</h2>" % text

    @staticmethod
    def h3(text):
        return "<h3>%s</h3>" % text

    @staticmethod
    def p(text):
        return "<p>%s</p>" % text

    @staticmethod
    def ul(items, purple=False):
        cls = ' class="pur"' if purple else ""
        return "<ul%s>%s</ul>" % (cls, "".join("<li>%s</li>" % i for i in items))

    @staticmethod
    def note(text):
        return '<p class="note">%s</p>' % text

    # --- executive summary ----------------------------------------
    @staticmethod
    def tiles(items):
        """items: list of (value, caption). Four reads best; alternates purple/magenta."""
        out = ['<div class="tiles">']
        for i, (v, c) in enumerate(items):
            cls = "tile m" if i % 2 else "tile"
            out.append('<div class="%s"><div class="box"><div class="v">%s</div>'
                       '<div class="c">%s</div></div><div class="bar"></div></div>' % (cls, v, c))
        out.append("</div>")
        return "".join(out)

    @staticmethod
    def qa(question, paras, ref=None):
        body = "".join("<p>%s</p>" % x for x in paras)
        if ref:
            body += '<p class="ref">%s</p>' % ref
        return ('<div class="qa"><div class="q"><span class="i">?</span>%s</div>%s</div>'
                % (question, body))

    @staticmethod
    def sig(name, title_lines):
        return ('<div class="sig"><div class="nm">%s</div><div class="ttl">%s</div></div>'
                % (name, "<br/>".join(title_lines)))

    # --- callouts --------------------------------------------------
    @staticmethod
    def pov(header, bullets=None, paras=None, kicker=None, keep=False):
        """The signature pink 'point of view' box."""
        body = ""
        if paras:
            body += "".join("<p>%s</p>" % x for x in paras)
        if bullets:
            body += "<ul>%s</ul>" % "".join("<li>%s</li>" % b for b in bullets)
        if kicker:
            body += '<p class="kicker">%s</p>' % kicker
        cls = "pov keep" if keep else "pov"
        return ('<div class="%s"><div class="hd">%s</div><div class="bd">%s</div></div>'
                % (cls, header, body))

    @staticmethod
    def prac(header, paras, long=None):
        """long=True lets a box longer than about half a page split across pages.
        Left as None, boxes over ~900 characters are treated as long."""
        body = "".join("<p>%s</p>" % x for x in paras)
        if long is None:
            long = len(re.sub(r"<[^>]+>", "", body)) > 900
        return ('<div class="prac%s"><div class="hd">%s</div><div class="bd">%s</div></div>'
                % (" long" if long else "", header, body))

    @staticmethod
    def impl(title, text, magenta=False):
        """Dashed 'key implication' block with a coloured left tab."""
        return ('<div class="impl%s"><span class="t">%s</span>%s</div>'
                % (" m" if magenta else "", title, text))

    @staticmethod
    def rec(items, header="Accounting recommendation"):
        return ('<div class="rec"><div class="hd">%s</div><ul>%s</ul></div>'
                % (header, "".join("<li>%s</li>" % i for i in items)))

    @staticmethod
    def closing(paras):
        return ('<div class="closing">%s</div>'
                % "".join("<p>%s</p>" % x for x in paras))

    # --- cards -----------------------------------------------------
    @staticmethod
    def card(title, subtitle, rows, highlight=False, tag=None):
        """A titled card with labelled rows. rows: list of (LABEL, text)."""
        cls = "arr ok" if highlight else "arr"
        tg = '<div class="tag">%s</div>' % tag if (highlight and tag) else ""
        body = "".join('<div class="row"><span class="lb">%s</span>%s</div>' % (l, t)
                       for l, t in rows)
        return ('<div class="%s"><div class="top">%s<div class="ti">%s</div>'
                '<div class="ex">%s</div></div>%s</div>' % (cls, tg, title, subtitle, body))

    @staticmethod
    def quad(cells):
        """Four dashed boxes in a 2x2 grid. cells: list of (heading, [bullets])."""
        out = ['<div class="quad">']
        for r in range(2):
            out.append('<div class="r">')
            for c in range(2):
                i = r * 2 + c
                if i >= len(cells):
                    continue
                head, bl = cells[i]
                klass = "c m" if (i % 3 == 1) else "c"
                out.append('<div class="%s"><div class="h">%s</div><ul>%s</ul></div>'
                           % (klass, head, "".join("<li>%s</li>" % b for b in bl)))
            out.append("</div>")
        out.append("</div>")
        return "".join(out)

    # --- tables ----------------------------------------------------
    @staticmethod
    def table(headers, rows, widths=None):
        """headers: list of str. rows: list of list of str (use '**bold**' inline HTML).
        widths: list of ints summing to 100. Header repeats across page breaks."""
        th = []
        for i, h in enumerate(headers):
            w = ' style="width:%d%%"' % widths[i] if widths else ""
            th.append("<th%s>%s</th>" % (w, h))
        body = ""
        for r in rows:
            body += "<tr>" + "".join("<td>%s</td>" % c for c in r) + "</tr>"
        return "<table><tr>%s</tr>%s</table>" % ("".join(th), body)

    # --- exhibits --------------------------------------------------
    @staticmethod
    def exhibit(caption, img, source, width_mm=None, tall=False):
        """Figure with caption above and an italic source line below.
        tall=True constrains a portrait graphic so caption+image fit one page."""
        cls = "exh tall" if tall else "exh"
        style = ' style="width:%smm;margin:0 auto;"' % width_mm if width_mm else ""
        return ('<div class="%s"><div class="cap">%s</div><img src="%s"%s/>'
                '<p class="src">%s</p></div>' % (cls, caption, img, style, source))

    @staticmethod
    def art(img, height_mm):
        """Decorative band that fills trailing space at a section end.
        Size it to (measured gap - 20mm); see qa_pages.py."""
        return ('<div class="fill"><img src="%s" style="height:%dmm;object-fit:cover;"/></div>'
                % (img, height_mm))



# ----- extended components (added for text-rich, explanatory publications) -----
class _Ext:
    @staticmethod
    def subhead(text):
        """Purple run-in heading inside a section (not numbered)."""
        return '<div class="subhead">%s</div>' % text

    @staticmethod
    def question(text):
        """A rhetorical question the paragraph turns on — set apart, not buried."""
        return '<div class="question">%s</div>' % text

    @staticmethod
    def callout(lead, paras):
        """Lavender highlight box: a lead line and one or more short paragraphs."""
        return ('<div class="callout"><div class="lead">%s</div>%s</div>'
                % (lead, "".join("<p>%s</p>" % p for p in paras)))

    @staticmethod
    def pull(text):
        return '<div class="pull">%s</div>' % text

    @staticmethod
    def flow(steps):
        """A → B → C chevron line; the final step is highlighted."""
        cells = []
        for i, s in enumerate(steps):
            if i: cells.append('<div class="ar">&#8594;</div>')
            cells.append('<div class="st%s">%s</div>' % (" last" if i == len(steps) - 1 else "", s))
        return '<div class="flow">%s</div>' % "".join(cells)

    @staticmethod
    def impbox(items, header="Implementation matters"):
        """items: list of (bold lead, text)."""
        body = "".join('<div class="it"><b>%s</b>%s</div>' % (l, t) for l, t in items)
        return '<div class="impbox"><div class="hd">%s</div>%s</div>' % (header, body)

    @staticmethod
    def objective(text):
        return '<div class="objective">%s</div>' % text

    @staticmethod
    def compare(left_title, left_items, right_title, right_items):
        """Two side-by-side lists — for/against, before/after, oil/compute."""
        def col(cls, t, items):
            return ('<div class="cl %s"><div class="h">%s</div><ul>%s</ul></div>'
                    % (cls, t, "".join("<li>%s</li>" % i for i in items)))
        return ('<div class="compare">%s%s</div>'
                % (col("a", left_title, left_items), col("b", right_title, right_items)))

    @staticmethod
    def sigrow(people):
        """Several signatories side by side. people: list of (name, title)."""
        cells = "".join('<div class="s"><div class="nm">%s</div><div class="ttl">%s</div></div>'
                        % (n, t) for n, t in people)
        return '<div class="sigrow">%s</div>' % cells

    @staticmethod
    def team(people, per_row=3):
        """Contact grid for the closing page. people: list of (name, title)."""
        rows = []
        for i in range(0, len(people), per_row):
            cells = "".join('<div class="p"><div class="nm">%s</div><div class="tt">%s</div></div>'
                            % (n, t) for n, t in people[i:i + per_row])
            rows.append('<div class="r">%s</div>' % cells)
        return '<div class="team">%s</div>' % "".join(rows)

    # ----- diagrams built in HTML: crisp vector text at true print size -----
    @staticmethod
    def exhibit_html(caption, inner, source, breakable=False):
        """breakable=True for tall table-based exhibits (e.g. H.era) that may span pages."""
        return ('<div class="exh%s"><div class="cap">%s</div><div class="dg">%s</div>'
                '<p class="src">%s</p></div>' % (" brk" if breakable else "", caption, inner, source))

    @staticmethod
    def era(rows):
        """Timeline table. rows: (period, TITLE, subtitle, description, stat, stat_caption)."""
        out = ['<table class="era">']
        for per, ti, sub, desc, stat, cap in rows:
            out.append('<tr><td class="e1"><div class="per">%s</div><div class="ti">%s</div>'
                       '<div class="sub">%s</div></td><td class="e2">%s</td>'
                       '<td class="e3"><div class="st">%s</div><div class="sc">%s</div></td></tr>'
                       % (per, ti, sub, desc, stat, cap))
        out.append("</table>")
        return "".join(out)

    @staticmethod
    def chain(steps, highlight_last=True):
        """Horizontal process chain. steps: list of (title, subtitle)."""
        cells = []
        for i, (t, s) in enumerate(steps):
            if i: cells.append('<td class="ca">&#9654;</td>')
            last = highlight_last and i == len(steps) - 1
            cells.append('<td class="cs%s"><div class="ct">%s</div><div class="cd">%s</div></td>'
                         % (" hl" if last else "", t, s))
        return '<table class="chain"><tr>%s</tr></table>' % "".join(cells)

    @staticmethod
    def parallel(col_heads, rows):
        """Two or more chains aligned column by column.
        rows: list of (row_label, [(title, detail), ...])."""
        out = ['<table class="par"><tr><td class="pl"></td>']
        for i, h in enumerate(col_heads):
            if i: out.append('<td class="pa"></td>')
            out.append('<td class="ph">%s</td>' % h)
        out.append("</tr>")
        for j, (lab, cells) in enumerate(rows):
            out.append('<tr class="r%d"><td class="pl">%s</td>' % (j, lab))
            for i, (t, d) in enumerate(cells):
                if i: out.append('<td class="pa">&#9654;</td>')
                out.append('<td class="pc"><div class="ct">%s</div><div class="cd">%s</div></td>' % (t, d))
            out.append("</tr>")
        out.append("</table>")
        return "".join(out)

    @staticmethod
    def panels(left, right):
        """Two dashed panels of stacked boxes.
        left/right: dict(title, items=[(head, text)], foot_head, foot_text)."""
        def panel(cls, p):
            items = "".join('<div class="bx"><div class="bh">%s</div><div class="bt">%s</div></div>'
                            % (h, t) for h, t in p["items"])
            return ('<td class="pn %s"><div class="pt">%s</div>%s<div class="pf"><b>%s</b><br/>%s</div></td>'
                    % (cls, p["title"], items, p["foot_head"], p["foot_text"]))
        return ('<table class="panels"><tr>%s<td class="gap"></td>%s</tr></table>'
                % (panel("l", left), panel("r", right)))

    @staticmethod
    def layers(layers, inward="Cash flows inward", outward="Risk flows outward",
               inward_note="each layer pays the one inside it", outward_note="it settles at the edge"):
        """Nested exposure layers, outermost first.
        layers: list of (TITLE, subtitle, who, exposure)."""
        inner = ""
        for i in range(len(layers) - 1, -1, -1):
            t, s, w, e = layers[i]
            inner = ('<div class="ly l%d"><div class="lt">%s <span>%s</span></div>'
                     '<div class="lw">%s</div><div class="le">%s</div>%s</div>'
                     % (i, t, s, w, e, inner))
        return ('<table class="lyr"><tr><td class="la"><div class="in"><b>%s &#8595;</b><br/>%s</div>'
                '<div class="out"><b>%s &#8593;</b><br/>%s</div></td><td>%s</td></tr></table>'
                % (inward, inward_note, outward, outward_note, inner))

    @staticmethod
    def bars(rows, legend, note=""):
        """Stacked horizontal bars. rows: (label, [share,...]); legend: segment names."""
        cols = ["#482879", "#7C5AA6", "#C879AB", "#B21E7D"]
        out = ['<table class="bars">']
        for lab, shares in rows:
            segs = "".join('<td style="width:%s%%;background:%s">%s</td>'
                           % (sh, cols[i % len(cols)], legend[i] if sh >= 24 else "")
                           for i, sh in enumerate(shares))
            out.append('<tr><td class="bl">%s</td><td class="bb"><table class="seg"><tr>%s</tr></table></td></tr>'
                       % (lab, segs))
        out.append("</table>")
        key = "".join('<span class="k"><i style="background:%s"></i>%s</span>' % (cols[i % len(cols)], l)
                      for i, l in enumerate(legend))
        return "".join(out) + '<div class="key">%s</div>' % key + ('<div class="bn">%s</div>' % note if note else "")


for _n in [n for n in dir(_Ext) if not n.startswith("_")]:
    setattr(H, _n, staticmethod(getattr(_Ext, _n)))

# card() gains an optional narrative block between the title and the rows
_orig_card = H.card
def _card(title, subtitle, rows, highlight=False, tag=None, narrative=None):
    html = _orig_card(title, subtitle, rows, highlight, tag)
    if narrative:
        cut = html.index('<div class="row">') if '<div class="row">' in html else html.rindex("</div>")
        html = html[:cut] + '<div class="nar">%s</div>' % narrative + html[cut:]
    return html
H.card = staticmethod(_card)


# ===================================================================
#  Stylesheet
# ===================================================================

EXTRA_CSS = """
.subhead{ font-weight:600; font-size:10.4pt; color:%(pur)s; margin:4mm 0 1.8mm 0; page-break-after:avoid; }
.question{ font-weight:600; font-size:9.5pt; color:%(pur)s; margin:1.5mm 0 3.4mm 0;
           padding:0.4mm 0 0.4mm 3.2mm; border-left:1.2mm solid %(mag)s; page-break-inside:avoid; }
.callout{ page-break-inside:avoid; background:#F5F1F9; border-left:1.4mm solid %(pur)s;
          border-radius:0 2mm 2mm 0; padding:3mm 4mm 2mm 4mm; margin:3mm 0 4mm 0; }
.callout .lead{ font-weight:600; color:%(pur)s; font-size:9.1pt; margin-bottom:1.4mm; }
.callout p{ margin:0 0 1.2mm 0; font-size:8.8pt; text-align:left; }
.pull{ page-break-inside:avoid; text-align:center; font-size:12.5pt; font-weight:500; color:%(mag)s;
       margin:5mm 6mm; padding:3.2mm 0; border-top:1px solid #E2DDEA; border-bottom:1px solid #E2DDEA; }
.flow{ display:table; width:100%%; margin:2mm 0 4.2mm 0; page-break-inside:avoid; }
.flow .st{ display:table-cell; vertical-align:middle; text-align:center; background:%(plight)s; color:%(pur)s;
           font-weight:600; font-size:8pt; padding:2.4mm 1.6mm; border-radius:1.6mm; line-height:1.25; }
.flow .st.last{ background:%(mag)s; color:#fff; }
.flow .ar{ display:table-cell; vertical-align:middle; text-align:center; width:6mm; color:%(mag)s;
           font-weight:700; font-size:11pt; }
.impbox{ page-break-inside:avoid; border:1px solid #E2DDEA; border-radius:3mm; background:#FCFBFD;
         padding:0 0 1.6mm 0; margin:4mm 0 0 0; }
.impbox .hd{ display:table; page-break-after:avoid; background:%(pur)s; color:#fff; font-weight:600; font-size:9pt;
             padding:1.5mm 4.5mm; border-radius:2.2mm; margin:0 0 2.4mm 4mm; position:relative; top:-1.2mm; }
.impbox .it{ padding:0 5mm; margin-bottom:2.2mm; font-size:8.5pt; line-height:1.45; }
.impbox .it b{ color:%(pur)s; display:block; margin-bottom:0.4mm; }
.objective{ page-break-inside:avoid; margin:3mm 0 3mm 0; padding:2.6mm 3.6mm; border-left:1.2mm solid %(mag)s;
            background:#FDF6FA; font-weight:600; font-size:8.8pt; color:%(head)s; line-height:1.45; }
.compare{ display:table; width:100%%; border-spacing:2.6mm 0; margin:2mm 0 4mm -2.6mm; page-break-inside:avoid; }
.compare .cl{ display:table-cell; width:50%%; vertical-align:top; border-radius:2.5mm; padding:3mm 3.4mm 1.6mm 3.4mm; }
.compare .cl.a{ background:#F3EEF8; }
.compare .cl.b{ background:#FBEFF5; }
.compare .h{ font-weight:600; font-size:9pt; margin-bottom:2mm; }
.compare .a .h{ color:%(pur)s; } .compare .b .h{ color:%(mag)s; }
.compare li{ font-size:8.2pt; text-align:left; margin-bottom:1.3mm; }
.compare .a li:before{ color:%(pur)s; }
.sigrow{ display:table; width:100%%; margin-top:5mm; page-break-inside:avoid; }
.sigrow .s{ display:table-cell; width:33%%; vertical-align:top; padding-right:4mm; }
.sigrow .nm{ font-weight:600; color:%(mag)s; font-size:9.4pt; }
.sigrow .ttl{ font-style:italic; font-size:7.6pt; color:#55555F; line-height:1.4; }
.team{ display:table; width:100%%; border-spacing:2mm; margin:2mm 0 0 -2mm; }
.team .r{ display:table-row; }
.team .p{ display:table-cell; width:33%%; border:1px solid #E2DDEA; border-radius:2mm; padding:2.4mm 3mm; vertical-align:top; }
.team .nm{ font-weight:600; color:%(mag)s; font-size:8.6pt; }
.team .tt{ font-size:7pt; color:#55555F; line-height:1.35; margin-top:0.6mm; }

.arr .nar{ padding:2.4mm 3.6mm 1.4mm 3.6mm; border-top:1px solid #EFECF4; font-size:8.1pt; line-height:1.45; background:#FFFFFF; }
.arr .nar p{ margin:0 0 1.4mm 0; text-align:left; }
.arr .nar .mh{ font-weight:600; color:%(pur)s; font-size:7.8pt; margin:2mm 0 0.8mm 0; text-transform:uppercase; letter-spacing:0.25pt; }
.arr .nar .fl{ background:#F5F1F9; border-radius:1mm; padding:0.8mm 2.2mm; margin:0.6mm 0; font-size:7.8pt; color:%(head)s; }
.arr .nar .tk{ background:#FBEFF5; border-radius:1.4mm; padding:1.6mm 2.4mm; margin:2mm 0 1mm 0; font-weight:600; color:%(mag)s; }
.arr .nar ul{ margin:0.6mm 0 1.4mm 0; } .arr .nar li{ margin-bottom:0.8mm; text-align:left; }
.arr .row ul{ margin:0.8mm 0 0 0; } .arr .row li{ margin-bottom:0.7mm; text-align:left; }
.arr .row p{ margin:0 0 1mm 0; text-align:left; }

.dg{ margin:1mm 0 0 0; }
table.era{ border-collapse:separate; border-spacing:0 1.6mm; font-size:7.8pt; margin:0; }
table.era td{ border:none; background:#F8F6FB; vertical-align:middle; padding:2.4mm 2.8mm; }
table.era tr:nth-child(even) td{ background:#F8F6FB; }
table.era td.e1{ width:26%%; border-left:1.2mm solid %(pur)s; border-radius:1.6mm 0 0 1.6mm; }
table.era td.e3{ width:25%%; background:#FBEFF5; border-radius:0 1.6mm 1.6mm 0; text-align:center; }
table.era tr:nth-child(even) td.e3{ background:#FBEFF5; }
table.era .per{ font-weight:700; color:%(mag)s; font-size:8pt; }
table.era .ti{ font-weight:600; color:%(pur)s; font-size:8.4pt; text-transform:uppercase; letter-spacing:0.2pt; }
table.era .sub{ font-style:italic; color:#7A7A85; font-size:7.1pt; }
table.era .st{ font-weight:700; color:%(mag)s; font-size:11pt; line-height:1.15; }
table.era .sc{ font-size:6.8pt; color:#55555F; line-height:1.3; margin-top:0.6mm; }

table.chain{ border-collapse:separate; border-spacing:0; margin:1mm 0 0 0; }
table.chain td{ border:none; background:none; vertical-align:middle; }
table.chain td.cs{ background:%(plight)s; border-radius:2mm; padding:2.6mm 2.2mm; text-align:center; }
table.chain td.cs.hl{ background:%(mag)s; }
table.chain td.cs.hl .ct, table.chain td.cs.hl .cd{ color:#fff; }
table.chain td.ca{ width:5mm; text-align:center; color:%(mag)s; font-size:8pt; padding:0; }
table.chain .ct{ font-weight:600; color:%(pur)s; font-size:8pt; line-height:1.25; }
table.chain .cd{ color:#55555F; font-size:6.9pt; line-height:1.3; margin-top:0.8mm; }

table.par{ border-collapse:separate; border-spacing:0 1.8mm; margin:0; }
table.par td{ border:none; background:none; vertical-align:middle; }
table.par td.ph{ text-align:center; font-weight:700; color:%(pur)s; font-size:7.6pt; letter-spacing:0.4pt;
                 text-transform:uppercase; padding:0 1mm 0.6mm 1mm; }
table.par td.pl{ width:15mm; font-weight:700; font-size:7.8pt; letter-spacing:0.4pt; padding-right:2mm; }
table.par tr.r0 td.pl{ color:%(pur)s; } table.par tr.r1 td.pl{ color:%(mag)s; }
table.par td.pc{ border-radius:2mm; padding:2.4mm 2.4mm; text-align:center; }
table.par tr.r0 td.pc{ background:%(plight)s; } table.par tr.r1 td.pc{ background:%(pinkl)s; }
table.par td.pa{ width:4.5mm; text-align:center; color:#9A9AA2; font-size:7pt; padding:0; }
table.par .ct{ font-weight:600; font-size:8pt; line-height:1.25; }
table.par tr.r0 .ct{ color:%(pur)s; } table.par tr.r1 .ct{ color:%(mag)s; }
table.par .cd{ color:#55555F; font-size:6.9pt; line-height:1.3; margin-top:0.8mm; }

table.panels{ border-collapse:separate; border-spacing:0; margin:0; }
table.panels td{ border:none; background:none; vertical-align:top; }
table.panels td.gap{ width:3mm; }
table.panels td.pn{ width:50%%; border:1.3px dashed %(pur)s; border-radius:2.4mm; padding:2.6mm; background:#F7F3FA; }
table.panels td.pn.r{ border-color:%(mag)s; background:#FBEFF5; }
table.panels .pt{ font-weight:700; font-size:8.6pt; text-align:center; color:%(pur)s; margin-bottom:2mm; }
table.panels td.r .pt{ color:%(mag)s; }
table.panels .bx{ background:#fff; border:1px solid #DDD6E6; border-radius:1.8mm; padding:2mm 2.4mm; margin-bottom:1.8mm; text-align:center; }
table.panels .bh{ font-weight:600; font-size:8pt; color:%(pur)s; line-height:1.25; }
table.panels td.r .bh{ color:%(mag)s; }
table.panels .bt{ font-size:6.9pt; color:#55555F; line-height:1.3; margin-top:0.6mm; }
table.panels .pf{ text-align:center; font-size:7pt; color:#6E6E78; font-style:italic; margin-top:1mm; line-height:1.35; }
table.panels .pf b{ font-style:normal; color:%(pur)s; font-size:7.6pt; }
table.panels td.r .pf b{ color:%(mag)s; }

table.lyr{ border-collapse:collapse; margin:0; }
table.lyr td{ border:none; background:none; padding:0; vertical-align:top; }
table.lyr td.la{ width:22mm; padding-right:2.4mm; font-size:6.9pt; color:#6E6E78; line-height:1.35; }
table.lyr .in{ margin-top:2mm; } table.lyr .in b{ color:%(dark)s; font-size:7.6pt; }
table.lyr .out{ margin-top:48mm; } table.lyr .out b{ color:%(mag)s; font-size:7.6pt; }
.ly{ border-radius:2.2mm; padding:2.2mm 2.6mm 2.4mm 2.6mm; border:1.4px solid #fff; }
.ly .ly{ margin-top:2mm; }
.ly.l0{ background:#EFE8F5; } .ly.l1{ background:#D8C9E8; } .ly.l2{ background:#A98BC8; }
.ly.l3{ background:#6A4496; } .ly.l4{ background:%(dark)s; }
.ly .lt{ font-weight:700; font-size:8pt; color:%(pur)s; line-height:1.25; }
.ly .lt span{ font-weight:500; font-style:italic; font-size:7.2pt; }
.ly .lw{ font-size:7pt; color:%(pur)s; line-height:1.3; margin-top:0.5mm; }
.ly .le{ font-size:7pt; font-weight:600; color:%(pur)s; line-height:1.3; margin-top:0.4mm; }
.ly.l2 .lt, .ly.l2 .lw, .ly.l2 .le, .ly.l3 .lt, .ly.l3 .lw, .ly.l3 .le,
.ly.l4 .lt, .ly.l4 .lw, .ly.l4 .le{ color:#fff; }

table.bars{ border-collapse:collapse; margin:0 0 1mm 0; }
table.bars td{ border:none; background:none; padding:1.2mm 0; vertical-align:middle; }
table.bars td.bl{ width:26mm; font-weight:600; font-size:7.8pt; color:%(pur)s; padding-right:2mm; }
table.seg{ border-collapse:collapse; margin:0; height:9mm; }
table.seg td{ color:#fff; font-size:6.6pt; font-weight:600; text-align:center; padding:0 1mm; height:9mm;
              border-right:1.2px solid #fff; line-height:1.15; }
.key{ margin:1.4mm 0 0 28mm; font-size:6.8pt; color:#55555F; }
.key .k{ margin-right:3.2mm; } .key i{ display:inline-block; width:2.6mm; height:2.6mm; border-radius:0.6mm;
          margin-right:1mm; vertical-align:-0.4mm; }
.bn{ margin:1.6mm 0 0 28mm; font-size:6.8pt; color:#7A7A85; font-style:italic; }
"""


def build_css(nav_count, footer_title):
    page_rules = "\n".join(
        "@page s%d { background-image:url('bg_%d.png'); background-size:%smm %smm; "
        "background-position:-%smm -%smm; background-repeat:no-repeat; }"
        % (i, i, PAGE_W_MM, PAGE_H_MM, MARGIN_LEFT, MARGIN_TOP)
        for i in range(nav_count))

    return """
@font-face { font-family:'Pop'; src:url('file://%(gf)sPoppins-Regular.ttf'); font-weight:400; }
@font-face { font-family:'Pop'; src:url('file://%(gf)sPoppins-Medium.ttf'); font-weight:500; }
@font-face { font-family:'Pop'; src:url('file://%(gf)sPoppins-Bold.ttf'); font-weight:700; }
@font-face { font-family:'Pop'; src:url('file://%(gf)sPoppins-Light.ttf'); font-weight:300; }
@font-face { font-family:'Pop'; src:url('file://%(gf)sPoppins-Italic.ttf'); font-style:italic; font-weight:400; }

@page { size:A4; margin:%(mt)smm %(mr)smm %(mb)smm %(ml)smm;
  @bottom-right { content:"Page " counter(page); font-family:'Pop'; font-size:7.6pt;
                  color:#9A9AA2; vertical-align:top; padding-top:4.6mm; } }
@page cover { margin:0; background-image:url('page_cover.png');
  background-size:%(pw)smm %(ph)smm; background-repeat:no-repeat;
  @bottom-right { content:""; } }
%(pages)s

html,body{ margin:0; padding:0; }
body{ font-family:'Pop'; font-size:9.0pt; line-height:1.50; color:%(gbody)s; }
p{ margin:0 0 3.0mm 0; text-align:justify; orphans:2; widows:2; }
b,strong{ font-weight:600; color:#2B2B33; }
.cover{ page:cover; height:%(ph)smm; }
.sec{ page-break-before:always; }

h1{ font-family:'Pop'; font-weight:300; font-size:21pt; color:%(head)s; line-height:1.18;
    margin:0 0 6mm 0; letter-spacing:-0.2pt; bookmark-level:1; bookmark-label:content(); page-break-after:avoid; }
h2{ page-break-after:avoid; font-weight:600; font-size:12.4pt; color:%(mag)s;
    margin:6mm 0 3mm 0; line-height:1.25; bookmark-level:2; bookmark-label:content(); }
h3{ page-break-after:avoid; font-weight:600; font-size:9.6pt; color:%(pur)s; margin:4.5mm 0 2mm 0; }
.lead{ font-size:9.4pt; }

ul{ margin:0 0 3.2mm 0; padding:0; list-style:none; }
li{ position:relative; padding-left:4.6mm; margin-bottom:1.7mm; text-align:justify; }
li:before{ content:"\\2022"; position:absolute; left:0.6mm; top:-0.2mm; color:%(mag)s;
           font-size:11pt; line-height:1.2; }
ul.pur li:before{ color:%(pur)s; }

/* clickable sidebar overlay — offset by the page margins on purpose */
.navlinks{ position:fixed; left:-%(ml)smm; top:-%(mt)smm; width:56mm; height:%(ph)smm; }
.navlinks a{ position:absolute; left:7mm; width:43mm; display:block;
             color:transparent; text-decoration:none; font-size:1pt; line-height:1; }

.tiles{ display:table; width:100%%; border-spacing:2.2mm 0; margin:0 0 5mm 0; }
.tile{ display:table-cell; width:25%%; vertical-align:top; }
.tile .box{ border:1px solid #DCD6E6; border-top:3px solid %(pur)s; border-radius:2mm 2mm 0 0;
            padding:2.8mm; height:39mm; box-sizing:border-box; overflow:hidden; }
.tile.m .box{ border-top-color:%(mag)s; }
.tile .v{ font-weight:700; font-size:11.2pt; color:%(pur)s; line-height:1.15; margin-bottom:1.6mm; }
.tile.m .v{ color:%(mag)s; }
.tile .c{ font-size:6.6pt; line-height:1.38; color:#4A4A55; text-align:left; }
.tile .bar{ height:2.6mm; background:%(pur)s; border-radius:0 0 1mm 1mm; }
.tile.m .bar{ background:%(mag)s; }

.qa{ page-break-inside:avoid; border:1px solid #E2DDEA; border-radius:2.5mm;
     padding:2.9mm 3.6mm 2.6mm 3.6mm; margin:0 0 2.8mm 0; }
.qa .q{ font-weight:600; font-size:9.5pt; color:%(pur)s; margin-bottom:1.8mm; }
.qa .q span.i{ color:%(mag)s; font-weight:700; margin-right:2mm; }
.qa p{ margin-bottom:1.5mm; font-size:8.5pt; }
.qa .ref{ font-weight:600; font-size:8.0pt; color:%(head)s; margin:0; }

.pov.keep{ page-break-inside:avoid; }
.pov{ background:#FBEFF5; border-radius:3mm; padding:0 0 4mm 0; margin:4mm 0; }
.pov .hd{ display:table; page-break-after:avoid; background:%(mag)s; color:#fff; font-weight:600; font-size:9.6pt;
          padding:1.8mm 5mm; border-radius:2.4mm; margin:0 0 3mm 4mm; position:relative; top:-1.2mm; }
.pov .bd{ padding:0 5mm; }
.pov li{ font-size:8.7pt; margin-bottom:1.5mm; line-height:1.45; }
.pov .kicker{ font-weight:600; color:%(pur)s; font-size:9.2pt; margin-top:2.5mm; }

.prac{ page-break-inside:avoid; border:1px solid #E2DDEA; border-radius:3mm;
       padding:0 0 3.6mm 0; margin:4mm 0; background:#FCFBFD; }
.prac .hd{ display:table; page-break-after:avoid; background:%(mag)s; color:#fff; font-weight:600; font-size:9pt;
           padding:1.5mm 4.5mm; border-radius:2.2mm; margin:0 0 2.5mm 4mm; position:relative; top:-1.2mm; }
.prac .bd{ padding:0 5mm; }
.prac.long{ page-break-inside:auto; }
.prac .hd{ page-break-after:avoid; }
.prac p{ font-size:8.7pt; }

.impl{ page-break-inside:avoid; border:1px dashed #C9BFD8; border-radius:2mm;
       padding:2.6mm 3.4mm; margin:0 0 2.4mm 0; font-size:8.6pt; position:relative; }
.impl:before{ content:""; position:absolute; left:0; top:3mm; bottom:3mm; width:1.1mm;
              background:%(pur)s; border-radius:1mm; }
.impl.m:before{ background:%(mag)s; }
.impl .t{ font-weight:600; color:%(pur)s; display:block; margin-bottom:1mm; }

.rec{ page-break-inside:avoid; border:1px solid %(pinkl)s; border-radius:3mm;
      padding:3.4mm 4.5mm 3.6mm 4.5mm; margin:4mm 0 0 0; background:#FEFAFC; }
.rec .hd{ font-weight:600; font-size:9.8pt; color:%(pur)s; margin-bottom:2.2mm; }
.rec li{ font-size:8.6pt; }

.arr{ border:1px solid #E2DDEA; border-radius:2.5mm; margin:0 0 3.4mm 0; }
.arr .top{ page-break-after:avoid; page-break-inside:avoid; }
.arr .row{ page-break-inside:avoid; }
.arr .top{ background:%(plight)s; padding:2.4mm 3.6mm; }
.arr .top .ti{ font-weight:600; font-size:9.2pt; color:%(pur)s; }
.arr .top .ex{ font-size:7.6pt; color:#55555F; margin-top:0.8mm; line-height:1.4; }
.arr .row{ padding:2.1mm 3.4mm; border-top:1px solid #EFECF4; font-size:8.1pt; line-height:1.45; }
.arr .row .lb{ font-weight:600; color:%(mag)s; font-size:7.4pt; text-transform:uppercase;
               letter-spacing:0.3pt; display:block; margin-bottom:0.7mm; }
.arr.ok{ border-color:%(mag)s; }
.arr.ok .top{ background:%(pinkl)s; }
.arr.ok .top .ti{ color:%(mag)s; }
.arr.ok .tag{ display:inline-block; background:%(mag)s; color:#fff; font-size:6.4pt;
              font-weight:600; letter-spacing:0.3pt; padding:0.7mm 2.2mm;
              border-radius:1.4mm; margin-bottom:1.2mm; }

table{ width:100%%; border-collapse:collapse; font-size:7.6pt; margin:0 0 2.5mm 0; }
th{ background:%(pur)s; color:#fff; font-weight:600; text-align:left; padding:2.2mm 2.4mm; font-size:7.6pt; }
td{ border:1px solid #E4E0EB; padding:2.2mm 2.4mm; vertical-align:top; line-height:1.45; }
tr:nth-child(even) td{ background:#F8F6FB; }
td.k{ font-weight:600; color:%(pur)s; }
tr{ page-break-inside:avoid; }
thead{ display:table-header-group; }

.exh{ margin:4mm 0 2mm 0; page-break-inside:avoid; }
.exh .cap{ font-weight:600; font-size:9pt; color:%(pur)s; margin-bottom:2mm; page-break-after:avoid; }
.exh.brk{ page-break-inside:auto; }
.exh img{ width:100%%; display:block; }
.exh.tall img{ width:112mm; margin:0 auto; }
.src{ font-style:italic; font-size:6.8pt; color:#8A8A95; line-height:1.4; margin:1.8mm 0 0 0; text-align:left; }

.quad{ display:table; width:100%%; border-spacing:2.6mm; margin:2mm 0 0 -2.6mm; }
.quad .r{ display:table-row; }
.quad .c{ display:table-cell; width:50%%; vertical-align:top; border:1px dashed #C9BFD8;
          border-radius:2.5mm; padding:2.6mm 3mm; }
.quad .c .h{ font-weight:600; font-size:9.4pt; color:%(pur)s; margin-bottom:1.8mm; }
.quad .c.m{ border-color:%(pinkl)s; }
.quad .c.m .h{ color:%(mag)s; }
.quad li{ font-size:7.5pt; margin-bottom:1.1mm; text-align:left; }

.closing{ page-break-inside:avoid; border:1px dashed #C9BFD8; border-radius:2.5mm;
          padding:3mm 3.6mm; margin-top:2mm; }
.note{ font-size:7.4pt; color:#8A8A95; line-height:1.45; }
.sig .nm{ font-weight:600; color:%(mag)s; font-size:9.4pt; }
.sig .ttl{ font-style:italic; font-size:7.8pt; color:#55555F; line-height:1.4; }
.fill{ margin-top:4mm; page-break-inside:avoid; }
.fill img{ width:100%%; display:block; border-radius:2mm; }
""" % dict(gf=GF, mt=MARGIN_TOP, mr=MARGIN_RIGHT, mb=MARGIN_BOTTOM, ml=MARGIN_LEFT,
           pw=PAGE_W_MM, ph=PAGE_H_MM, pages=page_rules, gbody=GBODY, head=HEADCOL,
           mag=MAGENTA, pur=PURPLE, pinkl=PINKL, plight=PLIGHT) + EXTRA_CSS % dict(
           pur=PURPLE, mag=MAGENTA, plight=PLIGHT, pinkl=PINKL, head=HEADCOL, dark=DARK)


# ===================================================================
#  Build
# ===================================================================
def _add_thead(html):
    """Wrap each table's first row in <thead> so headers repeat across pages."""
    def fix(m):
        t = m.group(0)
        rm = re.search(r"<tr>.*?</tr>", t, re.S)
        if not rm or "<th" not in rm.group(0):
            return t
        return t.replace(rm.group(0), "<thead>" + rm.group(0) + "</thead>", 1)
    return re.sub(r"<table(?: class=\"[^\"]*\")?>.*?</table>", fix, html, flags=re.S)


def build(meta, nav, blocks, outdir=".", stem=None):
    """Render the publication. Returns the output PDF path.

    meta   : dict(title, subtitle, date, author, author_title, footer)
    nav    : list of sidebar labels (index 0 is usually 'Executive Summary')
    blocks : list of HTML fragments; blocks[0] must be '<div class="cover"></div>'
    """
    from weasyprint import HTML
    from pypdf import PdfWriter, PdfReader
    import gen_assets

    cwd = os.getcwd()
    os.chdir(outdir)
    try:
        gen_assets.generate(meta, nav)
        css = build_css(len(nav), meta.get("footer", meta["title"]))
        rects = json.load(open("nav_rects.json"))

        navhtml = ['<div class="navlinks">']
        for i, r in enumerate(rects):
            navhtml.append('<a href="#nav%d" style="top:%.2fmm;height:%.2fmm">.</a>'
                           % (i, r["top_mm"], r["height_mm"]))
        navhtml.append("</div>")

        joined = "".join(blocks[1:])
        cnt = [0]

        def tag(m):
            i = cnt[0]; cnt[0] += 1
            return '<div id="nav%d" class="sec"' % i if i < len(rects) else m.group(0)
        joined = re.sub(r'<div class="sec"', tag, joined)

        # a discarded spacer page makes the cover count as page 1
        spacer = '<div style="page-break-after:always;height:2mm"></div>'
        body_html = ("<html><head><meta charset='utf-8'><style>%s</style></head><body>%s%s%s</body></html>"
                     % (css, "".join(navhtml), spacer, joined))
        body_html = _add_thead(body_html)
        open("_body.html", "w").write(body_html)
        HTML(string=body_html, base_url=os.getcwd() + "/").write_pdf("_body.pdf")

        cover_css = css.replace("@page { size:A4; margin:%smm %smm %smm %smm;"
                                % (MARGIN_TOP, MARGIN_RIGHT, MARGIN_BOTTOM, MARGIN_LEFT),
                                "@page { size:A4; margin:0;")
        cover_html = ("<html><head><meta charset='utf-8'><style>%s</style></head><body>%s</body></html>"
                      % (cover_css, blocks[0]))
        HTML(string=cover_html, base_url=os.getcwd() + "/").write_pdf("_cover.pdf")

        name = (stem or re.sub(r"[^A-Za-z0-9]+", "_", meta["title"]).strip("_")) + ".pdf"
        w = PdfWriter()
        w.append(PdfReader("_cover.pdf"))
        b = PdfReader("_body.pdf")
        w.append(fileobj=b, pages=(1, len(b.pages)))
        with open(name, "wb") as fh:
            w.write(fh)
        return os.path.abspath(name)
    finally:
        os.chdir(cwd)
