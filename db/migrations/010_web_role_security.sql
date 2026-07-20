-- 009: least-privilege PostgREST role and explicit URC ACLs.
--
-- Vercel web handlers authenticate users with Clerk, then access Supabase with
-- a JWT whose `role` claim is `urc_web`. Offline ingestion alone retains the
-- service-role key. Provision/rotate that JWT outside the repository and set it
-- as URC_SUPABASE_WEB_KEY after applying this migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'urc_web') then
    create role urc_web nologin noinherit nobypassrls;
  end if;
end
$$;

grant urc_web to authenticator;
grant usage on schema public to urc_web;
revoke create on schema public from public, anon, authenticated, urc_web;

-- Base relations are never exposed to generic PostgREST roles.
revoke all on table
  public.urc_sec_filings,
  public.urc_sec_auditors,
  public.urc_sec_companies,
  public.urc_comment_letters,
  public.urc_thread_summaries,
  public.urc_current_auditors,
  public.urc_current_auditors_mat
from public, anon, authenticated;

grant select on table
  public.urc_sec_filings,
  public.urc_sec_auditors,
  public.urc_sec_companies,
  public.urc_comment_letters,
  public.urc_current_auditors,
  public.urc_current_auditors_mat
to urc_web;
grant select, insert, update on table public.urc_thread_summaries to urc_web;

-- Make the normal view honor the caller's RLS policies (Postgres 15+).
alter view public.urc_current_auditors set (security_invoker = true);

-- Repeat the hardened definition here because production environments may
-- already have recorded migration 008 and therefore will not replay edits to
-- that historical file when 009 is applied.
create or replace function public.urc_refresh_current_auditors()
returns void language plpgsql security definer
set search_path = pg_catalog
set statement_timeout = '300s' as $$
begin
  refresh materialized view concurrently public.urc_current_auditors_mat;
end $$;

drop policy if exists urc_web_select_filings on public.urc_sec_filings;
create policy urc_web_select_filings on public.urc_sec_filings
  for select to urc_web using (true);

drop policy if exists urc_web_select_auditors on public.urc_sec_auditors;
create policy urc_web_select_auditors on public.urc_sec_auditors
  for select to urc_web using (true);

drop policy if exists urc_web_select_companies on public.urc_sec_companies;
create policy urc_web_select_companies on public.urc_sec_companies
  for select to urc_web using (true);

drop policy if exists urc_web_select_letters on public.urc_comment_letters;
create policy urc_web_select_letters on public.urc_comment_letters
  for select to urc_web using (true);

drop policy if exists urc_web_select_summaries on public.urc_thread_summaries;
create policy urc_web_select_summaries on public.urc_thread_summaries
  for select to urc_web using (true);
drop policy if exists urc_web_insert_summaries on public.urc_thread_summaries;
create policy urc_web_insert_summaries on public.urc_thread_summaries
  for insert to urc_web with check (true);
drop policy if exists urc_web_update_summaries on public.urc_thread_summaries;
create policy urc_web_update_summaries on public.urc_thread_summaries
  for update to urc_web using (true) with check (true);

-- Revoke implicit PUBLIC execution from every URC RPC/overload created by the
-- migration history. Grant only the read RPCs used by the web application.
revoke all on function public.urc_search_filings(text[], date, date, text, text, text, integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.urc_search_letters(text, text, date, date, integer, integer, text) from public, anon, authenticated;
revoke all on function public.urc_recent_threads(integer, integer, text, bigint) from public, anon, authenticated;
revoke all on function public.urc_thread_detail(text) from public, anon, authenticated;
revoke all on function public.urc_data_stats() from public, anon, authenticated;
revoke all on function public.urc_companies_needing_sic(integer) from public, anon, authenticated;
revoke all on function public.urc_thread_letters() from public, anon, authenticated;
revoke all on function public.urc_refresh_current_auditors() from public, anon, authenticated, urc_web;

grant execute on function public.urc_search_filings(text[], date, date, text, text, text, integer, integer, bigint) to urc_web, service_role;
grant execute on function public.urc_search_letters(text, text, date, date, integer, integer, text) to urc_web, service_role;
grant execute on function public.urc_recent_threads(integer, integer, text, bigint) to urc_web, service_role;
grant execute on function public.urc_thread_detail(text) to urc_web, service_role;
grant execute on function public.urc_data_stats() to urc_web, service_role;
grant execute on function public.urc_companies_needing_sic(integer) to service_role;
grant execute on function public.urc_thread_letters() to service_role;
grant execute on function public.urc_refresh_current_auditors() to service_role;

alter function public.urc_search_filings(text[], date, date, text, text, text, integer, integer, bigint)
  set search_path = pg_catalog, public;
alter function public.urc_search_letters(text, text, date, date, integer, integer, text)
  set search_path = pg_catalog, public;
alter function public.urc_recent_threads(integer, integer, text, bigint)
  set search_path = pg_catalog, public;
alter function public.urc_thread_detail(text)
  set search_path = pg_catalog, public;
alter function public.urc_data_stats()
  set search_path = pg_catalog, public;
alter function public.urc_companies_needing_sic(integer)
  set search_path = pg_catalog, public;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
