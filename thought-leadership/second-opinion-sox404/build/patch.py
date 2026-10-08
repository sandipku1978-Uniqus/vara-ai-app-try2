# -*- coding: utf-8 -*-
"""Apply fact-check corrections to so_v2.py. Each edit is tagged with its
register ID so the change log can be traced. Run once per register."""
import sys, re

PATH = "so_v2.py"
LOG = "changelog.tsv"


def run(edits, tag):
    s = open(PATH).read()
    log = open(LOG, "a")
    for rid, old, new in edits:
        if old not in s:
            if new in s:
                print("already applied", rid); continue
            print("MISSING", rid, repr(old[:70])); sys.exit(1)
        s = s.replace(old, new, 1)
        log.write("%s\t%s\t%s\n" % (rid, old.replace("\n", " ")[:160], new.replace("\n", " ")[:220]))
    open(PATH, "w").write(s)
    print(tag, "applied", len(edits))
