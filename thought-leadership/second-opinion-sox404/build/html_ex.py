# -*- coding: utf-8 -*-
"""HTML-built exhibits (vector text at true print size)."""

STYLE = """<style>
.ladder{ width:100%; border-collapse:separate; border-spacing:0 1.8mm; margin:0; font-size:7.8pt; }
.ladder td{ border:none; background:none; vertical-align:middle; padding:0; }
.ladder tr:nth-child(even) td{ background:none; }
.ladder td.q{ width:44%; background:#F5F1F9; border-left:1.2mm solid #482879; border-radius:0 1.8mm 1.8mm 0; padding:2.4mm 3mm; }
.ladder td.q .n{ display:inline-block; background:#B21E7D; color:#fff; font-weight:700; border-radius:50%;
                 width:4.4mm; height:4.4mm; line-height:4.4mm; text-align:center; font-size:6.8pt; margin-right:1.6mm; }
.ladder td.q b{ color:#482879; }
.ladder td.ar{ width:13%; text-align:center; font-size:7pt; font-weight:700; color:#B21E7D; }
.ladder td.ar span{ display:block; color:#B21E7D; font-size:9pt; line-height:1; }
.ladder td.o{ width:43%; border-radius:1.8mm; padding:2.2mm 3mm; border:1px solid #DCD6E6; background:#fff; }
.ladder td.o .t{ font-weight:700; font-size:8.2pt; color:#482879; }
.ladder td.o.na{ background:#FBEFF5; border-color:#E8B7D3; }
.ladder td.o.na .t{ color:#B21E7D; }
.ladder td.o .d{ font-size:7pt; color:#4A4A55; line-height:1.35; margin-top:0.4mm; }
.ladder td.o .c{ font-size:6.6pt; color:#8A8A95; font-style:italic; margin-top:0.6mm; }
.ladder td.down{ text-align:left; padding-left:20mm; color:#9A9AA2; font-size:6.8pt; height:3.2mm; }
.ladder .stop{ font-size:7.2pt; background:#FFF8E8; }
.until{ margin:1.6mm 0 0 0; border:1px solid #E2DDEA; border-radius:1.8mm; padding:2mm 3mm; font-size:7.4pt; background:#FCFBFD; }
.until b{ color:#482879; }
.until em{ color:#B21E7D; font-style:normal; font-weight:600; }

.who{ width:100%; border-collapse:collapse; font-size:7.3pt; }
.who td.r{ font-weight:600; color:#482879; width:21%; }
.who td.r span{ display:block; font-weight:400; color:#7A7A85; font-size:6.5pt; margin-top:0.4mm; }
.who td.s{ width:9%; text-align:center; color:#B21E7D; font-weight:600; }

.cal{ width:100%; border-collapse:separate; border-spacing:1.2mm 0; margin:0 0 0 -1.2mm; }
.cal td{ border:none; background:#F5F1F9; border-radius:1.6mm; padding:2.2mm 2mm; vertical-align:top; width:20%; font-size:6.8pt; line-height:1.35; }
.cal tr:nth-child(even) td{ background:#F5F1F9; }
.cal td .d{ font-weight:700; color:#482879; font-size:7.6pt; }
.cal td .e{ color:#4A4A55; margin-top:0.6mm; }
.cal td.now{ background:#B21E7D; } .cal td.now .d, .cal td.now .e{ color:#fff; }
.cal td.tbd{ background:#fff; border:1px dashed #C9BFD8; }
</style>"""


def ladder(rows, footer):
    """rows: list of (num, question_html, branch_label, outcome_title, outcome_desc, count, cls).
    The 'down' row between steps shows the other branch continuing."""
    out = [STYLE, '<table class="ladder">']
    for i, (n, q, br, ot, od, cnt, cls, cont) in enumerate(rows):
        out.append('<tr><td class="q"><span class="n">%s</span>%s</td>'
                   '<td class="ar">%s<span>&#9654;</span></td>'
                   '<td class="o %s"><div class="t">%s</div><div class="d">%s</div>%s</td></tr>'
                   % (n, q, br, cls, ot, od, ('<div class="c">%s</div>' % cnt) if cnt else ""))
        if cont:
            out.append('<tr><td class="down" colspan="3">&#9660;&nbsp; %s</td></tr>' % cont)
    out.append("</table>")
    out.append('<div class="until">%s</div>' % footer)
    return "".join(out)


def who(rows):
    """rows: (role, role_sub, what_changes, decision, section)."""
    out = ['<table class="who"><tr><th style="width:21%">If you are</th><th style="width:33%">What changes for you</th>'
           '<th style="width:37%">The decision in front of you</th><th style="width:9%">See</th></tr>']
    for r, rs, w, d, s in rows:
        out.append('<tr><td class="r">%s<span>%s</span></td><td>%s</td><td>%s</td><td class="s">%s</td></tr>'
                   % (r, rs, w, d, s))
    out.append("</table>")
    return "".join(out)


def cal(items):
    """items: (date, event, cls)."""
    cells = "".join('<td class="%s"><div class="d">%s</div><div class="e">%s</div></td>' % (c, d, e)
                    for d, e, c in items)
    return '<table class="cal"><tr>%s</tr></table>' % cells
