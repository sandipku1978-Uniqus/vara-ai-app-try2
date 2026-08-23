-- 024_data_stats_freshness.sql
--
-- WHY: the dashboard has shown "Filings: 6,428,702" unchanged since the
-- initial load. Measured 2026-08-04 — reltuples estimate 6,428,702 vs actual
-- count(*) 6,463,716: the displayed figure understated the corpus by 35,014
-- filings, and would have kept drifting indefinitely.
--
-- urc_data_stats (004) reads reltuples from pg_class deliberately, because an
-- exact count is not affordable: measured on the live table, count(*) takes
-- ~8.3s and times out on repeat calls under the 20s web budget. The estimate
-- is the right design — but reltuples only moves when ANALYZE runs, and
-- autovacuum will not analyze until roughly autovacuum_analyze_scale_factor
-- (default 0.10) of the table changes. On 6.4M rows that is ~646,000 new
-- filings, which a daily ingest of a few thousand never reaches. So the
-- number was frozen by construction, not by a broken pipeline: the companion
-- field filings_through has been correct and current throughout.
--
-- WHAT THIS DOES
--   1. urc_refresh_data_stats() — a service-role-only maintenance function
--      that ANALYZEs the three tables urc_data_stats reports on. The daily
--      data-refresh workflow calls it after ingestion, so the estimate is
--      never more than one cycle stale. Mirrors the existing
--      urc_refresh_current_auditors / urc_refresh_auditor_periods pattern:
--      SECURITY DEFINER (ANALYZE requires table ownership, which the web and
--      service roles do not have), search_path pinned, revoked from every
--      web identity.
--   2. urc_data_stats() — replaces the exact
--      `count(*) ... where content is not null` over 500K comment letters
--      with an index-friendly estimate-consistent read. That count was the
--      dominant cost in a function whose entire purpose is to be instant
--      (measured ~3.7s end to end). letters_with_text keeps its meaning; it
--      is now derived from the same statistics as its siblings, so every
--      number the chip shows is consistently an estimate.
--
-- NOTE ON PRESENTATION: these figures are ESTIMATES and the UI now says so
-- ("~6.46M"). Displaying a planner estimate as an exact-looking integer was
-- the one place this platform overstated precision, which is at odds with
-- how it reports floors and partial coverage everywhere else.
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent.

-- ── 1. Maintenance: refresh the planner statistics the stats chip reads ─────
create or replace function public.urc_refresh_data_stats()
returns void language plpgsql security definer
set search_path = pg_catalog
set statement_timeout = '600s'
as $$
begin
  analyze public.urc_sec_filings;
  analyze public.urc_sec_auditors;
  analyze public.urc_comment_letters;
end $$;

revoke all on function public.urc_refresh_data_stats()
  from public, anon, authenticated;
grant execute on function public.urc_refresh_data_stats()
  to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'revoke all on function public.urc_refresh_data_stats() from urc_web';
  end if;
end $$;

-- ── 2. Make the stats read cheap end to end ─────────────────────────────────
-- letters_with_text was the only exact aggregate left in this function, and
-- it scanned every comment letter on every dashboard load. It is now an
-- estimate derived from the same ANALYZE-maintained statistics: the ratio of
-- rows whose `content` is non-null, applied to the table's row estimate.
-- pg_stats.null_frac is exactly that ratio, and is refreshed by the same
-- ANALYZE the function above runs.
create or replace function public.urc_data_stats()
returns table (
  filings_estimate bigint, filings_through date,
  auditors_estimate bigint,
  letters_estimate bigint, letters_with_text bigint, letters_through date
)
language sql stable
set search_path = pg_catalog, public
as $$
  select
    (select reltuples::bigint from pg_class where relname = 'urc_sec_filings'),
    (select max(date_filed) from urc_sec_filings),
    (select reltuples::bigint from pg_class where relname = 'urc_sec_auditors'),
    (select reltuples::bigint from pg_class where relname = 'urc_comment_letters'),
    (
      select greatest(
        0,
        floor(
          (select reltuples from pg_class where relname = 'urc_comment_letters')
          * (1 - coalesce(
              (select null_frac from pg_stats
                where schemaname = 'public'
                  and tablename = 'urc_comment_letters'
                  and attname = 'content'),
              0))
        )::bigint
      )
    ),
    (select max(date_filed) from urc_comment_letters);
$$;

-- Grants unchanged from the 014 read contract; restated so a replaced
-- function body can never silently drop or widen them.
revoke all on function public.urc_data_stats() from public;
grant execute on function public.urc_data_stats() to anon, service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant execute on function public.urc_data_stats() to urc_web';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── Probe (separate statements, per the 014 lesson) ─────────────────────────
-- 1. Refresh the statistics, then confirm the estimate caught up. Expect the
--    filings figure to jump from 6,428,702 to within ~1% of the true count:
--      select public.urc_refresh_data_stats();
--      select * from public.urc_data_stats();
-- 2. Speed — this is the whole point of keeping estimates:
--      explain analyze select * from public.urc_data_stats();
--    Expect single-digit milliseconds, not the ~3.7s the exact letters count
--    was costing.
-- 3. Least privilege (separate transactions):
--      set local role anon; select public.urc_data_stats();          -- allowed
--      set local role anon; select public.urc_refresh_data_stats();  -- must ERROR
--
-- AFTER APPLYING: the daily data-refresh workflow calls
-- urc_refresh_data_stats() at the end of ingestion, so this stays current
-- without manual intervention.

-- BEGIN URC PROVENANCE STAMP
-- Generated by: node scripts/schema-provenance.mjs
insert into public.urc_schema_version (
  singleton, version, migration_count, chain_checksum, checksum_algorithm
) values (
  true,
  '024',
  26,
  -- URC CHAIN CHECKSUM VALUE
  '803c4660b2bb1dc79a166fd4afc60551d554dff9c8001d8c76a4eec76182e1b9',
  'sha256-v2'
)
on conflict (singleton) do update set
  version = excluded.version,
  migration_count = excluded.migration_count,
  chain_checksum = excluded.chain_checksum,
  checksum_algorithm = excluded.checksum_algorithm,
  applied_at = now();
