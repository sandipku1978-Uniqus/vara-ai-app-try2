# Language pass, front half: applied

Base: a2744f68ef7e8c8b1c4ccead521f88f97cb918bb. Patch: lang_front.patch (so_v2.py only, not committed).
Scope edited: META subtitle, executive summary, Sections 1 to 3 (before `P.append(H.sec(4,`), EX1, WHO and CAL. EX3 is unchanged because no proposal touched it. NAV needed no change after step 1.

Checks: `import so_v2` and `so_v2.blocks(engine.H)` pass. A full `python3 build.py` gives **22 pages**, and qa_pages reports no LOW-INK page. The only SHORT pages are 14, 18 and 21, which are section ends that were already short. Section 3 now ends on p. 12 with about 11 mm to spare (before this pass it ran onto a near-empty p. 13 and the build was 23 pages). Every other section's page breaks match the step-1 build. No paragraph, list item or table cell in scope has more than three sentences.

## Section 3 net change
Rendered text, measured with tags stripped: **-220 characters** (sec block -90, cont block -130). This is short of the 250 target, but the page fits with about two lines to spare. Rows 1 and 2 of table 3.1, the opening paragraph and the box's second item each lost a line.

## Skipped
- L-F02, L-F24: already done in step 1. Only the title part of L-F03, L-F04, L-F10, L-F11 and L-F14 was already done; I applied the rest of each.

## Adapted
- **L-F01**: applied as proposed.
- **L-F08**: "would no longer be required **for** 1,596 companies" rather than "at", to match the cover.
- **L-F14**: the framework label is "the retain, discontinue or replace decision". "estimate the saving from" became "base the saving on", to mirror Section 7's lead "Base the saving on a fee proposal…". "SOX program lead" became "SOX program leader", to match the Section 7 list header and the WHO row.
- **L-F18 to L-F21 (WHO)**: the decision cells mirror the Section 7 leads:
  - "Retain, discontinue or replace, recorded on evidence…"
  - "Base the saving on the auditor's fee proposal, and decide how to explain the choice."
  - "Define the evidence standard for scope, sampling, …" (L-F20 had "Document")
  - "Identify who else relies on it, and prepare a response for the first investor who asks."
  The "What changes" cells are as proposed. L-F22 and L-F23 are as proposed. The grid stays on p. 4 and grows by about 7 mm.
- **L-F35**: applied on top of the step-1 text. It reads "The underlying study, of 2,901 insiders, is less favorable, finding that…", so 2,901 stays with the study and the spelling is fixed.
- **L-F47**: applied on top of step-1 (g), giving three sentences. The 60% clause moved into the second sentence, and the step-1 sentence "The SEC could not classify the other five of today's 2,115 large accelerated filers because their float data is missing." is kept unchanged as the third. The `%%` escape is kept.
- **L-F52**: "As posted on October 5, 2026" became "On October 5, 2026". I also dropped "; letters posted since are not counted here", because the Exhibit 4 source already says which letters posted October 5 to 8 are not counted. "Excluding … , of whom" is as proposed. I kept "docket" and did not add "comment" (page fit).
- **L-F53, L-F61**: the box title is the shorter "How we reviewed the letters" rather than "How we reviewed the comment letters" (page fit). The Exhibit 4 source citation is changed to match. In the first item I also cut "in this paper" and "went through" became "had", for page fit.
- **L-F54**: "Support came mainly from those who bear the cost" rather than "the parties that bear the cost", and "most securities lawyers who commented". The last sentence ends "or opposed any expansion" rather than "said it should not be expanded", to match the Q2 wording in the executive summary.
- **L-F55**: "20 proposed another threshold or test" rather than "a different threshold" (shorter).
- **L-F57**: the D-7 change "the four largest" is applied. "the other nine did not comment" was shortened to "the other nine did not".
- **L-F59**:
  - Row 1: "retain today's $700 million threshold", "a threshold of about $1.1 billion", "inflation-adjusted thresholds", "or retention after a recent material weakness" and "If the SEC adopts any, some companies…".
  - Row 2: "the number of companies exempted", "a test beyond public float alone", "not on the PCAOB's September 30, 2026 standard-setting agenda" and the bold "Even firms with no alternative question the breadth, adding weight to a second test beside float."
  - Row 3: the bold is "The SEC's estimated saving may be overstated." and the body reads "include control work auditors must still perform".
  - Row 4: as proposed.
  All of these are shorter than the proposal (page fit).
- **L-F60**: the leads are as proposed. Building on the step-1 (i) text, the body now reads "as auditors must still understand controls and often test them or do more substantive work", which is shorter.
- **L-F62**: reads "Each distinct filer counts once, including a letter with 115 signatories, most of them academics, and a joint letter from 49 organizations." I dropped "staff memoranda of meetings are excluded" because the opening paragraph of Section 3 already says staff memoranda are excluded. The second sentence is "A position reflects only what a letter says about the attestation; one that never mentions…".
- **Exhibit 4 source**: beyond the box-title citation, I shortened the closing sentence to "The counts describe who wrote, not how the Commission will weigh each letter." (page fit; the meaning is unchanged). The step-1 text (h) is untouched.
- Everything else (L-F05 to L-F07, L-F09, L-F10 to L-F13 apart from their titles, L-F15 to L-F17, L-F25 to L-F34, L-F36 to L-F46, L-F48 to L-F51, L-F56, L-F58) is applied as proposed, with the framework label "retain, discontinue or replace" wherever a proposal had "keep, discontinue or replace".
