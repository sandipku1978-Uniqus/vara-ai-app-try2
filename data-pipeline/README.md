# URC data pipeline — SEC metadata & facets (Elastic replacement)

Full-text search lives on EDGAR EFTS (free). This pipeline maintains the
facet/enrichment layer in Supabase Postgres that the retired Elastic Cloud
cluster used to provide — at ~$0/month:

| Table | Source | Contents |
|---|---|---|
| `urc_sec_filings` | EDGAR `master.idx` (quarterly, free) | one row per (filing, filer): form, date, amendment flag |
| `urc_sec_auditors` | PCAOB Form AP `FirmFilings.zip` (free) | every audit report: firm → issuer CIK, canonicalized names |
| `urc_sec_companies` | EDGAR submissions (lazy) | SIC, tickers, filer category |

## One-time setup

1. **Apply the migration** — paste `db/migrations/001_urc_sec_metadata.sql`
   into the Supabase SQL editor (service-role REST cannot run DDL).
2. **Env** (locally and in the relevant protected environment):
   ```
   URC_SUPABASE_URL=https://<project>.supabase.co
   URC_SUPABASE_WEB_KEY=<restricted publishable/anon web key>
   URC_SUPABASE_SERVICE_KEY=<service role key>
   NEXT_PUBLIC_USE_ENRICHED_SEARCH=true
   ```
   Production application reads use only `URC_SUPABASE_WEB_KEY`. The service
   key is a protected job secret for these loaders and, when configured as a
   Vercel Sensitive server-only variable, is restricted to the three audited
   cache-writer routes. It is never a web-read fallback.
3. **Backfill** (minutes, not days — metadata only):
   ```
   npm run ingest:metadata -- --start 2021-01-01
   npm run ingest:auditors
   ```

## Keeping it fresh

Daily (GitHub Actions / Railway cron / launchd):
```
npm run ingest:metadata -- --since 3
```
Weekly is fine for auditors (PCAOB refreshes continuously, engagements churn slowly):
```
npm run ingest:auditors
```

Both loaders support `--dry-run` (writes JSONL locally, no DB writes) and
`--limit N` for smoke tests.

The auditor loader fails closed on uneven CSV rows and on production inputs
that are materially smaller than the known PCAOB corpus. The current floors
are 125,000 valid rows, 120,000 rows marked latest, and 65,000 latest ordinary-
issuer rows with CIK/report-date coverage; skipped rows may not exceed either
250 records or 0.1% of the input. These deliberately buffered guardrails are
anchored to the official archive observed on 2026-08-03 (155,269 valid,
149,652 latest, and 85,370 fully covered latest ordinary-issuer rows). A small
sample is accepted only through explicit `--dry-run`; `--limit` is never valid
for a production write.

### Comment-letter identity and text backfill

After applying `db/migrations/010_comment_letter_integrity.sql`, run:

```text
npm run ingest:letter-text -- --max-minutes 300 --identifier-limit 20000 --identifier-refetch-limit 5000
```

The command first derives review identifiers from already-stored letter text,
then performs a bounded header refetch for legacy permanent-error rows. Each
row is checkpointed with `identifier_checked_at`, so reruns are idempotent.
It invokes `urc_thread_letters` after any identity or content update; do not
run the threading function before this reconciliation phase completes.

## How search uses it

`/api/es-search` (name kept for the frontend contract): text queries hit EFTS
for candidates, then join filing-date Form AP evidence + `urc_sec_companies`
for auditor/SIC facets and enrichment. The scalar auditor is emitted only for
an unambiguous ordinary-issuer report on or before that SEC filing date;
investment-company, benefit-plan, multi-firm, and not-yet-covered events stay
unresolved. Issuer profiles separately use `urc_current_auditors` and must not
copy that current value onto historical filings. Facet-only browses (no text
query) are served entirely from Postgres via `urc_search_filings`.
If the Supabase env is absent the route returns 503 and the frontend falls
back to plain EFTS automatically — the app never hard-depends on this layer.

After applying migration 022, run a complete `load-auditors.ts` import before
the production accuracy gate. Existing Form AP rows need the newly retained
`Audit Report Type`, and the loader refreshes both auditor materializations;
any refresh failure exits non-zero so a stale evidence view cannot look green.
