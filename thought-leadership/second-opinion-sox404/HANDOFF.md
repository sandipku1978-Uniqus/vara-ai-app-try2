# The Second Opinion (SOX 404) — v2 working set

Editorial review and rebuild of the Uniqus Insights paper *The Second Opinion: SOX 404 Before, Now and After* (October 2026).
v1 draft: `output/The_Second_Opinion_v1_draft.pdf`. v2: `output/The_Second_Opinion_v2.pdf`. **Current v3: `output/The_Second_Opinion_v3.pdf` (22 pages, October 9, 2026).** `build.py` still writes `build/The_Second_Opinion_v2.pdf`; copy it to `output/` under the version name.

v3 applied the plan in `plan/` (see `plan/README.md`): fact fixes from the sec.gov files and structure edits (`build/patch_v3_facts.py`), then the language pass (`plan/lang_front_applied.md`, `plan/lang_back_applied.md`).
Review page (private): https://claude.ai/artifact/ENePofky5VFNGCW18WM8Nq

## Rebuild

```bash
pip install --break-system-packages weasyprint pypdf python-docx beautifulsoup4 Pillow matplotlib
cd build
python3 -c "import charts; charts.ex2_record(); charts.ex3_two_series(); charts.ex4_positions(); charts.ex5_cost(); charts.ex6_line(); charts.ex7_from_data()"
python3 -c "import hero; hero.hero('cover_hero.png'); hero.bands()"
python3 build.py                      # writes build/The_Second_Opinion_v2.pdf
python3 qa_pages.py The_Second_Opinion_v2.pdf
python3 verify_nav.py The_Second_Opinion_v2.pdf nav_rects.json "Executive Summary" "1. How Section 404 Evolved" \
  "2. What the SEC Proposed" "3. What the SEC Heard" "4. Two Questions Left Open" \
  "5. How the Final Rule Could Change" "6. Capital Markets and the Mid-Market" \
  "7. Actions to Consider Before a Final Rule" "How Uniqus Can Help"
```

- `build/so_v2.py` holds the content; `build/charts.py`, `hero.py`, `html_ex.py` hold the exhibits.
- `build/patch_*.py` are the corrections, applied in order E, A1/C, A1b, A2, B, D, then `patch_sec.py` (S). They are already applied to `so_v2.py`; keep them as the audit trail, do not re-run.
- `build/changelog.tsv` records every edit against its register ID.
- `factcheck/fc_*.md` are the seven registers (237 claims; S added 2026-10-09). `factcheck/register.json` is the merged register with v2 status. They name audit firms for internal QA only; the paper must not.
- `data/` holds the verified World Bank, Renaissance and restatement series.

## Open items after v3

The sec.gov checks are closed (see `plan/check_release.md`, `plan/check_letters.md`). What remains:

1. **Coding counts.** "12 of 118", "Twenty of them", "55 of 74", "13" (revenue test), the 24/15/3/9 split of 51 and "four commenters" on disclosure come from the original coding and can only be re-derived by re-reading all 188 public comments (index: `plan/S7-2026-18_docket_index_2026-10-09.csv`).
2. **Docket snapshot.** v3 keeps the October 5 coded snapshot (192 entries, 172 commenters) and states the three later letters' positions. The October 9 listing has 195 entries.

## Other open items

- The India 2017 exemption (G.S.R. 583(E)) is still in force per July–August 2026 practitioner guides. Confirm on mca.gov.in.
- The full Ideagen May 2026 restatements report is behind a sign-up form. Downloading it would give the 2023-2024 SPAC counts, which would let Exhibit 3 sit on one basis.
- Durations and scope in "How Uniqus Can Help" are proposals until Sandip confirms them.
