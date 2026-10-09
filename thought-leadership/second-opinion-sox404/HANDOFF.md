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
- `build/patch_*.py` are the corrections, applied in order E, A1/C, A1b, A2, B, D, then `patch_sec.py` (S). They are already applied to `so_v2.py`; keep them as the audit trail, do not re-run.
- `build/changelog.tsv` records every edit against its register ID.
- `factcheck/fc_*.md` are the seven registers (237 claims; S added 2026-10-09). `factcheck/register.json` is the merged register with v2 status. They name audit firms for internal QA only; the paper must not.
- `data/` holds the verified World Bank, Renaissance and restatement series.

## Open items: need www.sec.gov PDFs

Session of 2026-10-09 (register `factcheck/fc_S.md`, patch `build/patch_sec.py`, changelog S-01 to S-05):
- `curl` to www.sec.gov still gets proxy 403, so `www.sec.gov` is still not in Allowed domains.
- The TinyFish fetch tool reads sec.gov **HTML** but returns `target_unreachable` for **every sec.gov PDF**, and it only ever returns page 0 (30 rows) of the docket listing.
- Applied: the Society for Corporate Governance source pages and wording (S-01 to S-03, checked on the Society's own copy), and the late-letter note in the Exhibit 4 source (S-04, Olema read). S-05 only tightens wording so page 12 still fits.

Still open. Each needs the SEC PDF or the full docket. Fetch with a User-Agent that includes a contact email.

1. **Release page cites** (S-08 to S-14). Check every cite against https://www.sec.gov/files/rules/proposed/2026/33-11419.pdf:
   - p. 42 for the $1.15bn and $3.85bn lines;
   - EA Tables 5-7 at pp. 139-142 and EA Table 13 at p. 207;
   - the Exhibit 1, 2, 5, 6 and 8 source lines and the §2 table source;
   - §7.2 pp. 61, 62, 139, which conflicts with EA Table 5 also being on p. 139.

   The FR public-inspection copy puts these elsewhere (A1-15, A1-16, A1-17, A1-22).
2. **Comment-letter page cites** (S-15 to S-22). Most of the wording is corroborated by search snippets; no page is confirmed:
   - Nasdaq p. 4; OPERS p. 9; Dambra p. 2; Linklaters p. 2;
   - Connor Group p. 3; AAA FRPC p. 7 (check it is not the AAA Auditing Standards Committee letter);
   - Crowe p. 4; Rajgopal/Wong/Zhao pp. 2-4.
3. **Avalo Therapeutics** (S-23). Not on docket page 0. A tracker snippet dates a letter from CFO Chris Sullivan to June 21, 2026, so it is probably on docket pages 3-6. Confirm "$500–$1M" (hyphen or en dash) and the page. Remove it only if the full docket shows no such letter.
4. **"Seven firms"** (S-24). Still four confirmed. Read Deloitte, KPMG, GT, CBIZ, Crowe, Baker Tilly, CohnReznick and Connor.
5. **Late letters** (S-04). Olema (Oct 5) is read. It supports the proposal as drawn, and counting it would make the totals 193/173/119 and the tiles "75 of 119" and "12 of 119", with the audit-firm figures unchanged. RSM (Oct 7) and Schumacher (Oct 8) are PDFs and unread. The paper keeps the October 5 snapshot and notes the three letters. Recount if RSM's second letter changes its position.
6. **Docket totals** (S-25, S-05). 192 entries, 172 distinct commenters, the roundtable transcript and the TXCPA docket link all need the full seven-page listing.
7. **Coding counts** (S-26). "12 of 118", "Twenty of them", "55 of 74", "13" (revenue test), 24/15/3/9 of 51: re-derive from a full read of the docket.

## Other open items

- The India 2017 exemption (G.S.R. 583(E)) is still in force per July–August 2026 practitioner guides. Confirm on mca.gov.in.
- The full Ideagen May 2026 restatements report is behind a sign-up form. Downloading it would give the 2023-2024 SPAC counts, which would let Exhibit 3 sit on one basis.
- Durations and scope in "How Uniqus Can Help" are proposals until Sandip confirms them.
