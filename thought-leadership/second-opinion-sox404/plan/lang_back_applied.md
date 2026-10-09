# Language pass, back half: applied log

Base: a2744f68ef7e8c8b1c4ccead521f88f97cb918bb. Patch: work/lang_back.patch (so_v2.py, charts.py). Not committed.
All edits sit in so_v2.py from `P.append(H.sec(4,` to the end of blocks(), plus EX8, DECISIONS, AUDITOR_TABLE, CROSS, HELP and the 7.1 table. NAV, the executive summary, sections 1-3, EX1, EX3, WHO, CAL and ABOUT are untouched. `python3 -c "import so_v2, charts"` passes.

## Applied as proposed
L-B02 to L-B12, L-B14 to L-B27 (L-B27 on top of the step-1 text), L-B28 (adapted, see below), L-B29 to L-B32, L-B33 (trimmed, see below), L-B34 to L-B38, L-B41 to L-B48, L-B50 to L-B52, L-B54 to L-B56, L-B58 to L-B76 (including the optional L-B25, L-B36, L-B62 and L-B63).
- Step-1 facts kept: Exhibit 5 source line not touched; §6 "supports the proposal, including the five-year on-ramp, while warning ... “not costless”" kept, with only the L-B27 wording changes around it; the Linklaters quotation and its single full stop kept, Linklaters still named; DECISIONS #4 keeps "seven audit firms ... would absorb"; #8 keeps "(see the example in Section 2)"; EX8 row 2 note not touched.
- HELP: durations and scope are unchanged.

## Skipped
- L-B77 and L-B78 (About and disclaimer), as instructed.
- L-B01, L-B40 and L-B57 titles: these were already done in step 1.
- L-B13 NAV part: NAV was out of scope. I applied the h1 ("5. How the Final Rule<br/>Could Change"), so **NAV entry 5 should become "5. How the Final Rule Could Change"** to match it. The length is about the same. Until that is done, the sidebar label and the h1 differ.

## Adapted for page fit (the build showed overflow in §5, §6 and §7)
With all proposals applied as written, my build went from 23 to 25 pages: §5 spilled 2 lines, the §6 POV box was pushed to a new page, and the 7.1 table split across pages. The listed fallbacks (L-B13/25/36/62/63) are heading-only and saved no lines, so I made these targeted trims:
- L-B22 (§5 closer): "Commenters agree most on the on-ramp; changing it would not affect a seasoned mid-market company, but a second test or a lower threshold would. A count of letters shows where the arguments lie rather than how the Commission will vote." The proposed wording ran to 4 lines. This version keeps the intent and does not use "the file".
- L-B28: "points to other causes, notably" in place of "attributes the decline to other factors, notably".
- L-B33: "already has up to five years." ("of relief" dropped; "up to" kept).
- L-B39 kicker: "The exemption is an option to be priced, not a saving to be booked." This drops "best treated as", is still not an imperative, and fits on one line.
- L-B49: used the listed shorter lead, "Confirm filer status under both rule sets."
- L-B53: used the listed shorter lead, "Take the decision to the audit committee with evidence." Because of this, decision 5 no longer spells out the framework. "Retain, discontinue or replace" is still used in 7.1, the HELP card, §4.2 and CROSS.
- L-B51 (decision 3): "lenders, rating agencies and major holders are worth consulting first" in place of "...the largest holders are worth consulting before deciding".
- L-B54 (decision 6): "as the auditor's work papers..." in place of "because the auditor's work papers...".
- 7.1 table column widths changed from [25, 45, 30] to [28, 42, 30], so the longer option labels ("Discontinue it and rely on management's assessment") wrap one line less. Text is unchanged.

## charts.py
- ex6 x-axis label: "Public float line (logarithmic scale)" changed to "Public float threshold (logarithmic scale)". It renders on Exhibit 6 and fits.
- ex1_timeline labels: "Accelerated filer line set at $75m" became "Accelerated filer threshold: $75m of float", "Large accelerated filer line set" became "...filer threshold set at $700m", and "Proposal: line to $2bn" became "Proposal: threshold to $2bn". Note that ex1_timeline is not called by the build, because EX1 is HTML. The HTML EX1 chain still says "line to $2 billion", which is the front-half editor's scope.

## Rule checks
- No paragraph, list item or table cell in scope has more than 3 sentences. Decisions 3 and 7 and CROSS India were 4 and are now 3, counting the bold lead.
- No figures, quotations, citations or source lines were changed. No accounting, audit or advisory firm is named. US spelling throughout.
- The only remaining "the release" or "line" in scope are inside source lines (Exhibit 5 and 6 sources), which are left alone by design.

## Build result (my worktree; the front half from step 1 still spills one page at p13, so add 1 to target page numbers)
Total 23 pages, the same as the unedited step-1 build. In the target numbering, pages 13 to 22:
- 13-14 (wt 14-15): §4. The compare box, objective and band end on p14, unchanged.
- 15 (wt 16): §5. The table and closing paragraph fit on one page.
- 16-17 (wt 17-18): §6. The POV box fits at the foot of p17 with little room to spare.
- 18 (wt 19): §7 opening and Exhibit 8, with the same short-page gap as before (73.5mm).
- 19 (wt 20): the decisions box and the whole 7.1 table. This is tight: the table ends just above the footer.
- 20-21 (wt 21-22): 7.2, the auditor table, and the cross-border box, which starts on p20 and finishes on p21 as in the step-1 layout.
- 22 (wt 23): How Uniqus Can Help, About and disclaimer, with room left at the foot.
qa_pages flags in my range match the step-1 baseline (short pages at the EX8 page and at the cross-border spill page). There is no new LOW-INK page.

## Cross-reference for the front-half editor
WHO (executive summary) still uses the old section 7 wording ("Keep, drop or replace", "Price the saving..."). It should mirror: "Retain, discontinue or replace"; "Base the saving on a fee proposal rather than the SEC's average"; "Identify who else relies on the attestation"; "Define the evidence standard for an assessment no one else will test".
