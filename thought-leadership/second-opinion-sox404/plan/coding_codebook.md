# Coding codebook: S7-2026-18 comment letters (re-read, October 2026)

Purpose: re-derive every count the paper takes from the comment letters, using the definitions the paper prints.
One record per public comment (188 on the October 9 listing). Code what the letter says, not what the coder thinks of it.
Quote the sentence that supports each non-default code, with the page where the letter prints one.

## Fields

| Field | Values | Rule |
|---|---|---|
| `file` | file name | From the docket index. |
| `commenter` | text | As listed. |
| `late` | true / false | True for the three entries dated October 5, 7 and 8, 2026 (Olema, RSM second letter, Schumacher); the paper's counts exclude them. |
| `same_filer_as` | file or null | A second letter from a filer already counted (e.g. RSM, XBRL US, the same individual twice). Each distinct filer counts once. |
| `not_a_comment` | true / false | True for the roundtable transcript and for letters filed to S7-2026-18 that are about another proposal only. |
| `constituency` | company · exchange · business_trade_association · securities_law_firm · vc_policy_group · audit_profession_body · accounting_firm · advisory_firm · academic · individual · investor · other | Investor includes asset managers, pension funds, investor associations and investor advocates. Accounting_firm = a firm that audits. Audit_profession_body = state CPA societies, CAQ, AICPA committees and the like. Individual = a person writing in a personal capacity (a CPA writing for themselves is an individual). |
| `addresses_attestation` | true / false | True if the letter says anything about Section 404(b), the auditor's attestation or the exemption from it. Otherwise "silent". |
| `position` | support · no_position · too_broad · do_not_expand · null | Only if `addresses_attestation`. **support**: supports the exemption as proposed, or wants it wider. **too_broad**: accepts some widening of the exemption but objects to its extent. **do_not_expand**: opposes any increase in the exemption. **no_position**: discusses the attestation but takes no side (e.g. asks for more evidence). |
| `guarded` | true / false | For `too_broad` only: says so in guarded terms ("may be", "should consider", "we are concerned that"). |
| `names_alternative` | true / false | Proposes another threshold or test (a different float line, indexing, a revenue limit, retention after a material weakness, etc.). |
| `alternative` | text | What it proposes. |
| `addresses_2bn_figure` | true / false | Comments on the $2 billion number itself. |
| `view_2bn` | supports · lower · higher · oppose_any_increase · null | Lower = wants a figure between $700 million and $2 billion. Higher = above $2 billion. Oppose_any_increase = keep $700 million. |
| `addresses_onramp` | true / false | Comments on the 60-month seasoning / five-year on-ramp. |
| `onramp_view` | supports · rejects_or_questions · null | Rejects_or_questions = objects to a flat 60 months for all, suggests size-based exits or a shorter period. |
| `revenue_test` | true / false | Proposes a revenue test or asks the SEC to consider one. |
| `asks_disclosure` | true / false | Asks that companies disclose whether they obtained an attestation (beyond the cover-page check box). |
| `asks_interim_relief` | true / false | Asks for relief for companies crossing a threshold before a final rule. |
| `fpi_parity` | true / false | Asks for foreign private issuer parity, now or in the FPI rulemaking. |
| `guidance_for_companies` | true / false | Offers concrete guidance on what a company should do once the attestation is not required (e.g. how to support management's assessment, governance steps, voluntary attestation criteria). |
| `quotes` | list | Supporting sentences with page numbers. |

## Counts this re-derives (paper v3)

| Paper figure | Definition |
|---|---|
| 192 entries, 172 distinct commenters (Oct 5) | Entries on the listing at Oct 5; distinct filers net of memoranda, the transcript and duplicates. |
| 118 addressed / 54 silent | `addresses_attestation` among distinct, non-late filers. |
| 75 of 118 | `too_broad` + `do_not_expand`. |
| Exhibit 4: 32 support / 11 no position / 32 too broad / 43 do not expand | `position`, by `constituency`. |
| Nine of 32 "too broad" in guarded terms | `guarded`. |
| 20 named a different line or test | `names_alternative` among `too_broad`. |
| 12 of 118 offered concrete guidance | `guidance_for_companies`. |
| 25 of 27 investors | `investor` constituency addressing the attestation; `too_broad` + `do_not_expand`. |
| Every company, both exchanges, every business trade association that took a side supported | Check by constituency. |
| 55 of 74 on the on-ramp | `addresses_onramp`; `rejects_or_questions`. |
| 13 on a revenue test | `revenue_test`. |
| 51 on the $2 billion figure: 24 / 15 / 3 / 9 | `view_2bn`. |
| Interim relief: one association and two issuers | `asks_interim_relief` by constituency. |
| Four asked for disclosure | `asks_disclosure`. |
| Law firms asked for FPI parity | `fpi_parity` by constituency. |

## Method

Every letter is coded twice, independently, by two coders working from this codebook. Disagreements are resolved by a third read of the letter. The paper's own method box says the same ("two independent passes, with differences resolved by re-reading the letter").
