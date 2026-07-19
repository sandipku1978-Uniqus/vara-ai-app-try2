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
2. **Env** (locally and in Vercel):
   ```
   URC_SUPABASE_URL=https://<project>.supabase.co
   URC_SUPABASE_SERVICE_KEY=<service role key>
   NEXT_PUBLIC_USE_ENRICHED_SEARCH=true
   ```
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

## How search uses it

`/api/es-search` (name kept for the frontend contract): text queries hit EFTS
for candidates, then join `urc_current_auditors` + `urc_sec_companies` for
exact auditor/SIC facets and enrichment. Facet-only browses (no text query)
are served entirely from Postgres via the `urc_search_filings` function.
If the Supabase env is absent the route returns 503 and the frontend falls
back to plain EFTS automatically — the app never hard-depends on this layer.
