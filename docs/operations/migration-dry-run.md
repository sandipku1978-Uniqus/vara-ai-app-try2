# Migration dry run

`scripts/db/dry-run-chain.sh` applies the whole migration chain (`db/migrations/001` to the head) to a
throwaway Postgres in Docker and proves, before anything touches production, that the chain applies,
re-applies, stamps itself correctly, passes the release-gate evaluator, and that the write paths the
newer migrations introduce actually work for the roles that are meant to use them and fail for the
roles that are not.

It never connects to Supabase. It does not read `.env*` or any `DATABASE_URL`, `PG*`, `URC_SUPABASE_*`
or `SUPABASE_*` variable (it unsets them), builds every connection string itself for `127.0.0.1` on a
non-default port with a random per-run password, and refuses any psql call that names another host.

## Run it

Prerequisites: Docker (Colima is fine), `psql` (macOS: `brew install libpq`; the script also looks in
`/opt/homebrew/opt/libpq/bin`), `node`, `npx`, `openssl`, and the repo's `node_modules` (the checks run
`npx tsx`).

```
scripts/db/dry-run-chain.sh                 # everything; containers removed afterwards
scripts/db/dry-run-chain.sh --keep          # leave both databases up for poking (masked URLs printed)
scripts/db/dry-run-chain.sh --only provenance,p1-user-data    # prerequisites run automatically
scripts/db/dry-run-chain.sh --port 55000 --report-dir ./dryrun-report
```

It starts two `postgres:16` containers, `urc-migration-dryrun` on port 54329 and
`urc-migration-dryrun-ci` on 54330, removes any stale container of the same name first, and removes both
on every exit path including Ctrl-C (unless `--keep`). It takes a few minutes. Exit status is non-zero on
any FAIL or SKIP. Per-check logs, the full per-file result list (`checks.tsv`), the grant audit
(`grant-audit.tsv`), the schema evidence and the writer-role snapshots are written to the report
directory, which is printed at the end.

## What it proves

Phase A is a Supabase-like database: the roles `anon`, `authenticated`, `service_role`, `authenticator`;
pgcrypto preinstalled in the `extensions` schema; Supabase's default privileges (new public objects are
granted to `anon`, `authenticated` and `service_role`); and the migrations applied by a **non-superuser**
owner (`urc_migrator`: CREATEROLE, CREATEDB, BYPASSRLS) that owns the database and `public`, as
Supabase's `postgres` does. Phase B is a plain Postgres that runs the repo's own
`tests/db/migration-chain.sh`, exactly as CI does.

| Check id | What it proves |
|---|---|
| `chain-apply` | Every migration, in filename order, applies to an empty database. |
| `chain-idempotent` | Every migration applied a second time, immediately, succeeds. Documented exception: 009 (see below). |
| `upgrade-seed`, `upgrade-compat` | At 025 (production's state) a few hundred letters and filings are seeded and the old call shapes (`urc_search_letters` with seven arguments, `urc_search_filings`, `urc_data_stats`) are captured as `anon`; after the later migrations the same calls return identical rows and totals. |
| `writer-snapshot` | `urc_user_writer`'s ACLs, attributes and memberships are captured after each migration above 025. |
| `reapply-head` | With the database at head, every migration above 025 is re-applied in order (an operator retrying). |
| `provenance` | `urc_schema_version` (version, count, checksum, algorithm) and `urc_schema_provenance()` as `anon` equal `node scripts/schema-provenance.mjs`. |
| `schema-contract` | The service-only evidence RPC output passes `scripts/accuracy/schema-contract.ts` with `pass: true` and an empty `problems` array. |
| `p1-user-data` (026) | With a test signing key in place, the application's real signer (`src/lib/user-data-auth.ts`) signs calls that run as `anon`: list, upsert (twice, no duplicate), delete for all nine kinds; user B sees and deletes none of A's rows; org scope is separate from personal scope; a `project_id` into another user's project becomes null; bad, wrong-operation, wrong-kind, tampered, expired and too-far-future signatures are rejected with 28000, an unknown kind with 22023, 201 items with 54000, and an unprovisioned key with 28000. `anon`, `authenticated`, `urc_web` and `service_role` cannot read the signing key; the first three cannot read any `urc_user_*` table; `anon` cannot call the private helpers. |
| `p2-search-letters` (027) | One `urc_search_letters` overload; the old seven-argument call works positionally and by the named arguments PostgREST sends; the new cik/sic/reviewed-forms shape works; filter-only mode is rank 0 and newest first; a blank unfiltered query returns nothing; the facet backfill reader is `service_role` only. |
| `p8-jobs` (028) | The job lifecycle (create, one running job per owner, claim and lease, advance with hits, paging, lookup, lost lease, three failures end a job, cancel keeps recorded hits, expiry) as both `service_role` and `urc_user_writer`; `anon`, `authenticated` and `urc_web` are denied every job function and both tables, which also carry RLS and restrictive deny policies. |
| `p9-alert-hits` (029) | Alerts are created through the signed 026 path; the evaluator functions (claim, prior hits, record, release) work as `service_role`, are denied to every other role (`urc_user_writer` included); the evaluation guard trigger stops a stale browser copy from moving an alert's check state backwards; `urc_user_alert_hits_page` and `urc_user_alert_hits_mark_seen` work through the signed identity under kind `alert-hits`, with user and org isolation and rejected signatures; `urc_user_writer` can read hits and update only `seen_at`. |
| `writer-role` | Exactly one `urc_user_writer` role; attributes never change between migrations; between any two snapshots the only changes are additions on the objects 028 and 029 document (`urc_search_job*`, `urc_user_alert*`); no removals; no privilege on any other `urc_*` relation, no CREATE on `public`, no membership in another role. This is how "026 and 028 both create the role if missing, with no drift" is checked. |
| `grant-audit` | See below. |
| `chain-test` | `tests/db/migration-chain.sh` passes end to end on a plain cluster (its deliberate `permission denied for function urc_schema_contract_evidence` line is expected). |

The summary table folds the per-file rows into one row per check id with counts; `checks.tsv` has every
row. Statuses: `PASS`, `FAIL`, `SKIP` (a prerequisite failed; counts as failure), `NOTE` (documented
exception, not a failure).

### Idempotency, precisely

The chain is forward-only. Running the whole directory a second time against a database already at head
fails by design (004 cannot change `urc_data_stats`'s return type back after 024; 019/020's stamps omit
columns 021 made NOT NULL; 023 refuses a head newer than itself). So idempotency is checked where it is
promised: each migration applied twice in place, and the post-025 migrations re-applied at head.

One consequence to know when retrying on production: **every migration ends by stamping the registry with
its own number, so re-applying 026 or 027 on a database at head moves `urc_schema_version` backwards.
After any retry, re-apply every later migration through the head** so the stamp ends at the head; the
release gate treats a stamp that is not the head as a failure.

Documented exception: `009_facet_search_by_cik.sql` uses a plain `create function`, so its in-place retry
fails with "already exists with same argument types". It is a historical migration that later ones
replace and nobody re-runs; the harness records it as `NOTE` while it fails with exactly that error.

### The grant audit

`scripts/db/dry-run/grant-audit.sql` lists, for `anon`, `authenticated`, `urc_web`, `urc_user_writer` and
`service_role`, every effective privilege (direct, PUBLIC and inherited) on every `urc_*` table, view,
materialized view, sequence and function, the `public` schema, column-level ACLs, role memberships and
role attributes, and compares each to what the migrations' own comments claim (014 web read contract, 023
`authenticated` holds nothing, 026 writer role and signing key, 028 job tables, 029 alert hits). Verdicts:

* `OK` within the documented contract.
* `NOTE` wider than the migration's grant but inherited from the platform. Today: `service_role` also
  holds TRUNCATE, REFERENCES and TRIGGER on every `urc_*` table and view, because Supabase's default
  privileges grant it ALL and the migrations grant it SELECT/INSERT/UPDATE/DELETE. `service_role` is
  BYPASSRLS and already trusted with the data, but the migrations' text understates what it holds.
* `FLAG` wider than any migration claims. The check fails on any FLAG. Run result for the current head: none.

## Reading a failure

1. The first lines of the failing check's log are printed under its FAIL row; the whole log is
   `NNN-<id>.log` in the report directory. psql runs with `ON_ERROR_STOP`, so the first SQL error is the
   cause; `psql:db/migrations/NNN_*.sql:LINE: ERROR:` names the file and line.
2. `chain-apply` FAIL: that migration does not apply on an empty Supabase-like database, and everything
   after it shows SKIP. Fix the migration, not the harness. If the error says a role needs superuser, the
   harness rebuilds the phase with a single superuser owner and records why in `superuser-fallback.txt`;
   logical errors (such as 023's ACL guard) never trigger that fallback.
3. `chain-idempotent` FAIL: the migration is not safe to re-run. Add `if not exists`, `create or replace`
   or a guard.
4. `provenance` FAIL: a migration byte changed without re-stamping the head. Run
   `node scripts/schema-provenance.mjs`, put the new `schemaChainChecksum` in the head migration's
   `-- URC CHAIN CHECKSUM VALUE` literal (only that literal is excluded from the hash), re-run.
5. `schema-contract` FAIL: the evaluator's problems are printed verbatim. A newly added `SECURITY DEFINER`
   function must be declared in `scripts/accuracy/schema-contract.ts`; a new `urc_*` relation needs its
   contract entry.
6. `p1`/`p8`/`p9` FAIL: the exception text starts with `P1:`, `P8:` or `P9:` and names the expectation
   that broke. These run as the real roles (`set local role`), so a "permission denied" where a call was
   expected means a grant is missing, and a success where 42501 was expected means a grant is too wide.
7. `writer-role` FAIL: the lines named `REMOVED` or `UNEXPECTED ADDITION` are the ACL entries that drifted.
8. `grant-audit` FAIL: the FLAG rows. Either the grant is wrong or the audit's allowlist is out of date
   for a deliberate new grant; update both the migration comment and the audit.
9. `chain-test` FAIL while Phase A passes: the plain-cluster path differs (roles created by the test
   script, pgcrypto created by 026 rather than preinstalled). Read `chain-test-raw.log`.

## What it does not prove

* PostgREST itself is not run. The checks call the functions as `anon`, `authenticated`, `urc_web`,
  `service_role` and `urc_user_writer` with `set local role`, which is what PostgREST does per request;
  PostgREST's overload resolution is covered by asserting a single `urc_search_letters` overload.
* Production data volume. The seed is a few hundred rows (CI uses ten thousand letters). It says nothing
  about how long an index build or a refresh takes on the real tables.
* Platform behaviour that cannot be reproduced in a container: Supabase-managed role settings, the SQL
  editor's own timeout and transaction wrapping, dashboard configuration.
* The live database's current state. Before applying anything, read it (see the checklist below).

## Defects the dry run found (fixed in the migrations)

1. **023 and the release gate disagreed about pgcrypto.** `schema-contract.ts` requires pgcrypto in the
   evidence, but 023's evidence RPC reported only `pg_trgm`, so the gate would fail on a complete
   database. 026 now widens that filter in place (re-creating the function from its own definition, so
   owner, ACL and the rest of 023's body are untouched).
2. **026 could not be re-applied after 028.** Its post-condition rejected the job tables 028 grants to
   `urc_user_writer`. The post-condition now excludes `urc_search_job*`.
3. **023 failed on a Supabase-defaults replay.** With platform default privileges, relations created
   before 014 and absent from 010's list (for example `urc_filing_text`) kept SELECT for `authenticated`,
   and 023's own attestation rejected them. 023 now revokes `authenticated` on every `urc_*` relation
   before attesting. This is the "authenticated has default grants on a fresh database" failure; it does
   not appear on the CI path because the test's plain roles have no default grants. Production passed
   023 already, so none of these three changes alter a database that is at 025.

## Applying 026, 027, 028 and 029 to production

Preconditions. All migrations are applied in the Supabase SQL editor as `postgres`, one file per run,
each idempotent. The editor wraps a run in one transaction and runs as a role that bypasses grants, so
run every probe as a **separate** statement (the 014 lesson), impersonating the web identity with
`set local role anon` where a probe says so.

0. Read the current state before applying anything:
   `select version, migration_count from urc_schema_version;` expects `025` / 27 (the stamp 025 wrote).
   If it is anything else, stop and reconcile; the apply order below assumes 025 is the head.
   Confirm a recent backup/point-in-time restore exists, and apply outside the ingestion window (see 027).
1. **026 `026_user_research_objects.sql`.** Creates the nine `urc_user_*` tables, the signing-key table,
   the writer role and the five functions; widens 023's evidence RPC to report pgcrypto. Requires
   pgcrypto in the `extensions` schema (present on Supabase; the migration raises if it is not).
   The migration ends with post-conditions that raise on any weaker shape. No probe block ships, so run:
   * `select version, migration_count from urc_schema_version;` expects `026` / 28 (an intermediate stamp;
     the checksum matches the repository only after 029).
   * `select extname from pg_extension where extname in ('pg_trgm','pgcrypto');` expects both.
   * As anon, in its own transaction: `set local role anon; select * from urc_user_projects;` must fail
     with permission denied; `select urc_user_list('watchlist','probe',null,1,'0');` must fail with
     "identity assertion expired" (28000), not "permission denied" (it proves the function is callable
     and the assertion is enforced).
   * Operator step, as postgres:
     `insert into public.urc_user_signing_key (singleton, secret) values (true, '<the value of URC_USER_DATA_SIGNING_SECRET>') on conflict (singleton) do update set secret = excluded.secret, rotated_at = now();`
     and set `URC_USER_DATA_SIGNING_SECRET` (at least 32 characters) in Vercel. Until both exist every
     user-data route answers 503 and the browser keeps its local behaviour. Do not paste the secret into
     tickets or logs.
2. **027 `027_letters_filters_and_issues.sql`.** Adds `urc_letter_facets`, `urc_letter_issues`, the facet
   reader, a ten-argument `urc_search_letters` (the seven-argument one is dropped, not overloaded), and
   `urc_letters_date_idx` on `urc_comment_letters`. That index is a plain `create index`, so it takes a
   SHARE lock on the letters table and blocks ingestion writes while it builds, and it runs under the SQL
   editor's statement timeout. Apply outside the ingestion window, and check the table size first; the
   dry run cannot tell you the build time. Seven-argument calls keep working through the new function's
   defaults, so the application can be released before or after. Its shipped probes, as separate
   statements (they are at the foot of the file):
   1. `select total_count from urc_search_letters('fair value', null, null, null, 1, 0, null) limit 1;` expects 10001.
   2. `select count(*), min(date_filed) from urc_search_letters('segment', 'UPLOAD', '2024-01-01', null, 100, 0, null, null, '2834', null);` rows on or after 2024-01-01 only, every CIK with SIC 2834.
   3. `select date_filed from urc_search_letters('', 'UPLOAD', '2025-01-01', null, 5, 0, null, null, null, array['S-1']);` the five newest S-1 Staff letters since 2025 (once facets are backfilled; empty before that).
   4. `select count(*) from urc_search_letters('', null, null, null, 5, 0, null);` expects 0.
   Also: `select count(*) from pg_proc where proname = 'urc_search_letters';` expects 1, and
   `select version, migration_count from urc_schema_version;` expects `027` / 28.
3. **028 `028_search_continuation_jobs.sql`.** Adds `urc_search_jobs`, `urc_search_job_hits` and the
   `urc_search_job_*` functions, closed to every web identity; creates `urc_user_writer` only if 026 has
   not. No probe block ships; run:
   * `select version, migration_count from urc_schema_version;` expects `028` / 30.
   * `select count(*) from pg_roles where rolname = 'urc_user_writer';` expects 1.
   * As anon, separate transactions: `set local role anon; select * from urc_search_jobs;` and
     `set local role anon; select urc_search_job_get('probe', gen_random_uuid());` must both fail with
     permission denied.
   * As postgres: `select has_function_privilege('service_role', 'urc_search_job_get(text,uuid)', 'execute');` expects true.
4. **029 `029_alert_hits_and_scheduled_evaluation.sql`.** Requires 026 (it raises otherwise). Adds the
   evaluation lease columns and the guard trigger on `urc_user_alerts`, `urc_user_alert_hits`, the two
   signed owner functions and the service-only `urc_alert_eval_*` functions; ends with its own
   post-conditions. The migration says to apply after 028 and then reload PostgREST (it issues
   `notify pgrst, 'reload schema'`; if the API still cannot see the functions, use Dashboard, API, Reload
   schema). No probe block ships; run:
   * `select version, migration_count, chain_checksum from urc_schema_version;` expects `029` / 31 / the
     value printed by `node scripts/schema-provenance.mjs --field schemaChainChecksum`.
   * As anon, separate transactions: `set local role anon; select * from urc_user_alert_hits;` and
     `set local role anon; select urc_alert_eval_claim(null,null,null,72000,518400,180);` must fail with
     permission denied.
   * As anon: `select urc_user_alert_hits_page(null,false,null,0,1,'probe',null,1,'0');` must fail with
     28000 "identity assertion expired", not permission denied.
5. **Release gate.** After 029, run the live schema contract
   (`npx tsx scripts/accuracy/schema-contract.ts` with the production URL and service key set and the
   `--expect-*` values from `node scripts/schema-provenance.mjs`); it must report no problems. This is
   the step that reads production, and it is read-only (a service-role RPC). Then restart or redeploy
   so `/api/version` reports the new head.

Do not apply a later number before an earlier one. If a migration fails part-way, fix and re-apply that
same file (they are idempotent in place), then continue; if you re-apply an earlier file after a later
one has run, re-apply every later file through 029 so the stamp ends at the head.

## Keeping the dry run current

It derives everything from the migrations directory: a new migration is applied twice, joins the
upgrade-compat and writer-role comparisons, and is covered by `provenance`, `schema-contract` and
`grant-audit` without edits. Add a check file under `scripts/db/dry-run/` and an id in
`scripts/db/dry-run-chain.sh` when a migration adds a write path; extend `grant-audit.sql`'s allowlists
when a migration deliberately grants something new, citing the migration in the audit's header comment.
