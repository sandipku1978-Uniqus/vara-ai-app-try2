-- 014: the single authoritative read contract for the web tier.
--
-- Why this exists (remediation handoff 2026-07-31, WP1): the effective ACLs
-- for the web identity cannot be inferred from the migration history.
--   * 010/011 revoked the core RPCs and base tables from `anon` and granted
--     them to `urc_web` — but this project uses asymmetric JWT signing keys,
--     so a urc_web token cannot be minted. The supported least-privilege web
--     identity is the publishable key, which lands as `anon`.
--   * 003_anon_read_surface.sql ("take 2") repaired part of the anon surface
--     AFTER 010/011 chronologically, despite its filename — a fresh replay in
--     filename order re-breaks it.
--   * Even take 2 never granted anon the base tables that urc_search_filings
--     reads. The function is plain `stable` (invoker rights), so under the
--     publishable key it fails with 42501 on urc_sec_filings — masked in
--     production only by the service-key fallback this contract exists to
--     remove.
--
-- This migration is FORWARD-ONLY and idempotent: run it after any earlier
-- state and the result is the same contract. Do not edit or replay older
-- migrations to repair grants. After applying, refresh the PostgREST schema
-- cache (Supabase dashboard → API → Reload schema, or NOTIFY pgrst).
--
-- The contract, in one sentence: the web identity can READ every public-data
-- surface the routes use and EXECUTE the read RPCs — and can do nothing else.
-- All writes stay with the audited service-role cache writer.

-- ── 1. Schema usage, and no CREATE for anyone unprivileged ──────────────────
grant usage on schema public to anon;
revoke create on schema public from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant usage on schema public to urc_web';
    execute 'revoke create on schema public from urc_web';
  end if;
end $$;

-- ── 2. Table/view read surface ───────────────────────────────────────────────
-- Everything here is public SEC data; SELECT is deliberately broad across the
-- URC relations, because the risk boundary is writes, not reads.
do $$ declare r record;
begin
  for r in
    select c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'urc\_%'
      and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('grant select on public.%I to anon', r.relname);
    if exists (select 1 from pg_roles where rolname = 'urc_web') then
      execute format('grant select on public.%I to urc_web', r.relname);
    end if;
    -- Revoke every write path from the web identities and PUBLIC. Sequences
    -- are not granted at all: nothing browser-facing inserts.
    if r.relkind in ('r', 'p') then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from public, anon, authenticated', r.relname);
      if exists (select 1 from pg_roles where rolname = 'urc_web') then
        execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from urc_web', r.relname);
      end if;
    end if;
  end loop;
end $$;

-- ── 3. RLS read policies for anon on every RLS-enabled URC table ────────────
-- A grant without a policy is still a denial once RLS is enabled. All data is
-- public-record SEC content, so the read policy is unconditional.
do $$ declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'urc\_%'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists anon_read on public.%I', r.relname);
    execute format('create policy anon_read on public.%I for select to anon using (true)', r.relname);
  end loop;
end $$;

-- The thread-summaries cache is written by the service-role cache writer as
-- of this contract (the web route no longer upserts it). Remove any write
-- policies earlier states may have left for web identities.
drop policy if exists urc_web_insert_summaries on public.urc_thread_summaries;
drop policy if exists urc_web_update_summaries on public.urc_thread_summaries;

-- ── 4. RPC execute surface ───────────────────────────────────────────────────
-- Grant EVERY current overload of each read RPC by name, so a later
-- re-signature cannot silently strip the web identity (the drift that broke
-- take 1). Maintenance and ingestion functions are explicitly withheld.
do $$ declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'urc_search_filings',
        'urc_search_letters',
        'urc_recent_threads',
        'urc_thread_detail',
        'urc_data_stats',
        'urc_filing_scope_stats'
      )
  loop
    execute format('revoke all on function %s from public', fn.sig);
    execute format('grant execute on function %s to anon, service_role', fn.sig);
    if exists (select 1 from pg_roles where rolname = 'urc_web') then
      execute format('grant execute on function %s to urc_web', fn.sig);
    end if;
  end loop;
end $$;

-- Maintenance/ingestion functions: service role only, never the web tier.
do $$ declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'urc_refresh_current_auditors',
        'urc_companies_needing_sic',
        'urc_thread_letters'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if exists (select 1 from pg_roles where rolname = 'urc_web') then
      execute format('revoke all on function %s from urc_web', fn.sig);
    end if;
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- ── 5. Default privileges: new objects start closed ──────────────────────────
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ── 6. Post-apply verification (run manually with the PUBLISHABLE key) ──────
-- Reads that must succeed:
--   select * from urc_search_filings(null,null,null,null,null,null,1,0,null);
--   select * from urc_search_letters('revenue',null,null,null,1,0,null);
--   select * from urc_recent_threads(1,0,null,null);
--   select * from urc_data_stats();
--   select * from urc_filing_scope_stats(null,null,null,null);
--   select text from urc_filing_text limit 1;
--   select * from urc_current_auditors limit 1;
-- Writes that must fail (42501):
--   insert into urc_thread_summaries (thread_id, summary) values ('probe','x');
--   delete from urc_filing_text where cik = 'probe';
--   select urc_refresh_current_auditors();
