# The Second Opinion (SOX 404) — v2 working set

Editorial review and rebuild of the Uniqus Insights paper *The Second Opinion: SOX 404 Before, Now and After* (October 2026).
v1 draft: `output/The_Second_Opinion_v1_draft.pdf`. Current v2: `output/The_Second_Opinion_v2.pdf` (22 pages).
Review page (private): https://claude.ai/artifact/ENePofky5VFNGCW18WM8Nq

## Rebuild

```bash
pip install --break-system-packages weasyprint pypdf python-docx beautifulsoup4 Pillow matplotlib
cd build
python3 -c "import charts; charts.ex2_record(); charts.ex3_two_series(); charts.ex4_positions(); charts.ex5_cost(); charts.ex6_line(); charts.ex7_from_data()"
python3 -c "import hero; hero.hero('cover_hero.png'); hero.bands()"
python3 build.py                      # writes build/The_Second_Opinion_v2.pdf
python3 qa_pages.py The_Second_Opinion_v2.pdf
python3 verify_nav.py The_Second_Opinion_v2.pdf nav_rects.json "Executive Summary" "1. How Section 404 Got Here" \
  "2. What the SEC Proposed" "3. What the SEC Heard" "4. Two Questions the File Leaves Open" \
  "5. Where the Final Rule Could Move" "6. Capital Markets and the Mid-Market" \
  "7. What To Do Before the Final Rule" "How Uniqus Can Help"
```

- `build/so_v2.py` holds the content; `build/charts.py`, `hero.py`, `html_ex.py` hold the exhibits.
- `build/patch_*.py` are the corrections, applied in order E, A1/C, A1b, A2, B, D. They are already applied to `so_v2.py`; keep them as the audit trail, do not re-run.
- `build/changelog.tsv` records every edit against its register ID.
- `factcheck/fc_*.md` are the six registers (211 claims). `factcheck/register.json` is the merged register with v2 status. They name audit firms for internal QA only; the paper must not.
- `data/` holds the verified World Bank, Renaissance and restatement series.

## Open items: need www.sec.gov

The previous session's network policy blocked www.sec.gov. A new session in this environment, with `www.sec.gov` in Allowed domains, should be able to close these. Fetch with a User-Agent that includes a contact email.

1. **Release page citations.** Check every page cite against https://www.sec.gov/files/rules/proposed/2026/33-11419.pdf. The Federal Register copy paginates roughly 1.17x shorter in the economic analysis, so v2 keeps the draft's cites: EA Tables 5-7 at pp. 139-142, EA Table 13 at p. 207, Exhibit 1 pp. 12, 20-34, 40-42, 150, and the §2 table source pages.
2. **Comment-letter page cites** (wording already corroborated):
   - Nasdaq p. 4
   - OPERS p. 9
   - Dambra p. 2
   - Linklaters p. 2
   - Connor Group p. 3 (the "advisory firm"; not named in the paper)
   - AAA Financial Reporting Policy Committee p. 7
   - Crowe p. 4 (an "audit firm"; not named in the paper)
   - Rajgopal/Wong/Zhao pp. 2-4
3. **Avalo Therapeutics letter.** Not found. Confirm it exists and that it quotes "between $500–$1M annually".
4. **"Seven firms" on audit absorption.** Only four are confirmed (from letters on the firms' own sites). Check the remaining firm letters on the docket.
5. **Recount after the October 5, 2026 snapshot.** Read the second RSM letter (October 7, s7202618-1087339-3795249.pdf), the Olema Oncology letter (October 5) and the October 8 letter. Decide whether the counts or the "0 of 11" / "9 of 12" figures change.
6. **Docket totals.** Confirm 192 entries and 172 distinct commenters as of October 5. Also confirm the roundtable transcript entry and the TXCPA broken docket link.
7. **Unconfirmed comment-file counts.** Re-derive from the coding if possible: tile "12 of 118", "Twenty of them named a different line or test", §5 "55 of 74", "13" (revenue test) and the 24/15/3/9 split of 51.

## Other open items

- The India 2017 exemption (G.S.R. 583(E)) is still in force per July–August 2026 practitioner guides. Confirm on mca.gov.in.
- The full Ideagen May 2026 restatements report is behind a sign-up form. Downloading it would give the 2023-2024 SPAC counts, which would let Exhibit 3 sit on one basis.
- Durations and scope in "How Uniqus Can Help" are proposals until Sandip confirms them.
