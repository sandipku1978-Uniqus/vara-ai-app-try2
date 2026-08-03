-- 019_schema_version_registry.sql
--
-- Database provenance for the release gate (readiness audit R0/R3): the
-- application SHA, database migration state, and accuracy result are one
-- indivisible release candidate — but until now the database could not SAY
-- what migration state it was in. That is exactly how production ran
-- migration-016 behavior while application code expected 017, and how 017's
-- flawed ordering went live unnoticed: nothing asserted the pairing.
--
-- This registry is the database's own answer. /api/version reports it, and
-- the accuracy consolidator fails closed when it does not match the schema
-- version the repository expects.
--
-- CONVENTION FROM HERE ON: every future migration's LAST statement updates
-- this row to its own number. A migration that forgets stamps nothing —
-- and the release gate then reports the mismatch, which is the correct
-- failure: an unstamped apply is indistinguishable from a missed one.
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent. Apply AFTER 018
-- (this stamps '019', which asserts 018's function body is present too —
-- see the probe).

create table if not exists urc_schema_version (
  singleton  boolean primary key default true check (singleton),
  version    text not null,
  applied_at timestamptz not null default now()
);

-- Write path is postgres/service only; the web tier may read, never write.
revoke all on urc_schema_version from public;
do $$ begin
  execute 'grant select on urc_schema_version to anon, service_role';
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant select on urc_schema_version to urc_web';
  end if;
end $$;

alter table urc_schema_version enable row level security;
drop policy if exists schema_version_read on urc_schema_version;
create policy schema_version_read on urc_schema_version for select using (true);

-- Read RPC so the application does not need table-shape knowledge.
create or replace function urc_schema_version() returns text
language sql stable
set search_path = pg_catalog, public
as $$
  select version from urc_schema_version where singleton;
$$;

do $$ begin
  execute 'revoke all on function urc_schema_version() from public';
  execute 'grant execute on function urc_schema_version() to anon, service_role';
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant execute on function urc_schema_version() to urc_web';
  end if;
end $$;

-- Stamp. Every future migration ends with this statement, bearing its own
-- number.
insert into urc_schema_version (singleton, version) values (true, '019')
on conflict (singleton) do update set version = excluded.version, applied_at = now();

-- ── Probe (separate statements) ─────────────────────────────────────────────
-- 1.   select urc_schema_version();
--    Expect: '019'.
-- 2. The stamp implies 018 is present — verify the pairing this registry
--    exists to protect:
--      select proconfig from pg_proc where proname = 'urc_search_letters';
--    Expect: contains 'search_path=pg_catalog, public' (018's signature
--    hardening). If this is absent while the version says 019, apply 018.
-- 3. As the web identity (separate transaction):
--      set local role anon; select urc_schema_version();
--    Expect: '019' — the release gate reads through this key.
