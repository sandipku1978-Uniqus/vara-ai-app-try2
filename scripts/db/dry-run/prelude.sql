-- Reproduce Supabase roles, ownership, extensions and permissive per-schema defaults.
-- Cluster setup is repeatable; only the harness's disposable database is replaced.
\getenv dry_password DRYRUN_DB_PASSWORD
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if;
  if not exists (select from pg_roles where rolname='urc_migrator') then
    create role urc_migrator login createrole createdb bypassrls nosuperuser;
  end if;
end $$;
alter role urc_migrator password :'dry_password';
-- PG16 requires ADMIN to alter pre-existing roles, even with CREATEROLE.
-- These grants let the non-superuser rehearse platform role-budget changes.
grant anon, authenticated, authenticator, service_role to urc_migrator with admin option;
drop database if exists urc_dry with (force);
create database urc_dry owner :migration_role;
\connect urc_dry
alter schema public owner to :migration_role;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
-- The migrator needs grant authority here, as on Supabase's extensions schema.
grant usage on schema extensions to urc_migrator with grant option;
alter default privileges for role urc_migrator in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role urc_migrator in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role urc_migrator in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
