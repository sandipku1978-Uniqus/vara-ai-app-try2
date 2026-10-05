-- 029_alert_hits_and_scheduled_evaluation.sql
--
-- DEFECT (gap analysis 2026-10-04, row 2 / recommendation 3): saved alerts
-- are only checked while the Dashboard is open — three stale alerts per
-- visit, twenty results each, run by the browser. A user who does not open
-- the Dashboard is never told a filing matched, and what an alert found is
-- reduced to a list of accession numbers: no company, no form, no passage.
-- 026 moved alerts server-side but nothing evaluates them there.
--
-- FIX
--   * urc_user_alert_hits — one row per filing an alert found that was new
--     to it: company, form, filing date, the section breadcrumb and the
--     matched passage the validator read (empty, and labelled 'not-read',
--     when EDGAR full-text search alone answered and no text was fetched),
--     whether it amends a filing the alert already surfaced for the same
--     period, and seen_at (null until the owner marks it seen).
--   * Evaluator RPCs (plain invoker functions, service_role only) for the
--     scheduled job in src/app/api/alerts/evaluate: claim one due alert under
--     a lease, look up its earlier hits for amendment pairing, and record one
--     check atomically (hits + the alert's check state + lease release).
--   * Owner RPCs (SECURITY DEFINER, owned by urc_user_writer, signed identity
--     assertion — exactly the 026 contract) for /api/user/alert-hits: page
--     the caller's hits (unseen first) and mark hits seen.
--   * A guard on urc_user_alerts so evaluation state never moves backwards:
--     a browser that last synced before the server checked an alert (a
--     rename, a toggle) cannot overwrite the server's newer check with its
--     stale copy, which would re-announce filings already reported.
--
-- ACCESS MODEL
--   * urc_user_alert_hits follows 026: RLS enabled and FORCED; one policy for
--     urc_user_writer scoping rows to urc.user_id / urc.org_id (set only by
--     urc_user_assume after the HMAC check); no privilege of any kind for
--     anon, authenticated or urc_web, plus a RESTRICTIVE deny for them so a
--     replay of 014's read sweep cannot reopen the rows. urc_user_writer may
--     SELECT and UPDATE (seen_at only) — it never inserts or deletes hits.
--   * service_role (the trusted evaluator, through the audited
--     getUserWriterSupabase transport) holds the table and the evaluator
--     functions. Hit rows take owner and org from the leased alert row in SQL,
--     never from the caller.
--   * Evaluator functions are invoker functions with a pinned search_path and
--     no web grant; the two owner functions are the only new SECURITY DEFINER
--     functions and are declared in scripts/accuracy/schema-contract.ts.
--
-- Requires 026 (urc_user_alerts, urc_user_writer, urc_user_assume).
-- Idempotent; forward-only. Apply in the Supabase SQL editor as postgres,
-- after 028, then reload PostgREST.

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
do $$ begin
  if pg_catalog.to_regclass('public.urc_user_alerts') is null then
    raise exception '029: urc_user_alerts is missing; apply 026 first';
  end if;
  if pg_catalog.to_regprocedure('public.urc_user_assume(text, text, text, text, bigint, text)') is null then
    raise exception '029: urc_user_assume is missing; apply 026 first';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_user_writer') then
    raise exception '029: role urc_user_writer is missing; apply 026 first';
  end if;
end $$;

-- ── 1. Evaluation lease on alerts ────────────────────────────────────────────
-- One evaluator holds an alert for one check. Not in urc_user_kind's write
-- whitelist, so the browser can neither set nor clear it.
alter table public.urc_user_alerts add column if not exists evaluation_lease uuid;
alter table public.urc_user_alerts add column if not exists evaluation_lease_until timestamptz;

-- Evaluation state never moves backwards. Every writer of urc_user_alerts
-- (the browser through urc_user_upsert, the evaluator through
-- urc_alert_eval_record) passes through this guard.
create or replace function public.urc_user_alerts_keep_evaluation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.last_checked_at is not null
     and (new.last_checked_at is null or new.last_checked_at < old.last_checked_at) then
    new.last_checked_at := old.last_checked_at;
    new.last_hit_count := old.last_hit_count;
    new.last_seen_accessions := old.last_seen_accessions;
    new.latest_new_accessions := old.latest_new_accessions;
    new.engine_version := old.engine_version;
    new.last_check_coverage := old.last_check_coverage;
  end if;
  return new;
end $$;
revoke all on function public.urc_user_alerts_keep_evaluation() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'revoke all on function public.urc_user_alerts_keep_evaluation() from urc_web';
  end if;
end $$;

drop trigger if exists urc_user_alerts_keep_evaluation on public.urc_user_alerts;
create trigger urc_user_alerts_keep_evaluation
  before update on public.urc_user_alerts
  for each row execute function public.urc_user_alerts_keep_evaluation();

-- ── 2. Alert hits ────────────────────────────────────────────────────────────
create table if not exists public.urc_user_alert_hits (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.urc_user_alerts (id) on delete cascade,
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  accession text not null check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  cik text not null check (cik ~ '^[0-9]{1,10}$'),
  company text not null default '' check (char_length(company) <= 300),
  form text not null default '' check (char_length(form) <= 40),
  filed_at date,
  -- EDGAR's period of report, when full-text search supplied one; the key
  -- for pairing an amendment with its original.
  period_ending date,
  -- The document to open in the viewer (the parent filing, or the exhibit
  -- that carried the match).
  document text not null default '' check (char_length(document) <= 255 and document ~ '^[A-Za-z0-9._-]*$'),
  section_path text not null default '' check (char_length(section_path) <= 500),
  passage text not null default '' check (char_length(passage) <= 1200),
  -- 'validated-text': passage is from filing text the validator fetched and
  -- matched. 'not-read': EDGAR full-text search answered on its own and no
  -- text was fetched, so passage is empty rather than an unread highlight.
  passage_basis text not null default 'not-read' check (passage_basis in ('validated-text', 'not-read')),
  -- True only when this filing amends one this alert already surfaced for
  -- the same issuer, base form and period (10-K/A against that 10-K).
  is_amendment boolean not null default false,
  amends_accession text check (amends_accession is null or amends_accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  constraint urc_user_alert_hits_alert_accession_uq unique (alert_id, accession),
  constraint urc_user_alert_hits_amendment_shape check (amends_accession is null or is_amendment)
);

-- The owner's list: unseen first, newest first.
create index if not exists urc_user_alert_hits_owner_idx
  on public.urc_user_alert_hits (owner_user_id, org_scope, created_at desc, id);
-- The bell's unread count.
create index if not exists urc_user_alert_hits_unseen_idx
  on public.urc_user_alert_hits (owner_user_id, org_scope, alert_id) where seen_at is null;
-- Amendment pairing during a check.
create index if not exists urc_user_alert_hits_alert_cik_idx
  on public.urc_user_alert_hits (alert_id, cik);

alter table public.urc_user_alert_hits enable row level security;
alter table public.urc_user_alert_hits force row level security;
revoke all on table public.urc_user_alert_hits from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'revoke all on table public.urc_user_alert_hits from urc_web';
  end if;
end $$;
-- The owner may read and mark seen; nothing else.
revoke all on table public.urc_user_alert_hits from urc_user_writer;
grant select on table public.urc_user_alert_hits to urc_user_writer;
grant update (seen_at) on table public.urc_user_alert_hits to urc_user_writer;
-- Trusted job only (the scheduled evaluator); never a web route.
grant select, insert, update, delete on table public.urc_user_alert_hits to service_role;

drop policy if exists urc_user_owner_rows on public.urc_user_alert_hits;
create policy urc_user_owner_rows on public.urc_user_alert_hits
  as permissive for all to urc_user_writer
  using (owner_user_id = current_setting('urc.user_id', true)
         and org_scope = coalesce(current_setting('urc.org_id', true), ''))
  with check (owner_user_id = current_setting('urc.user_id', true)
              and org_scope = coalesce(current_setting('urc.org_id', true), ''));
drop policy if exists urc_user_alert_hits_web_denied on public.urc_user_alert_hits;
create policy urc_user_alert_hits_web_denied on public.urc_user_alert_hits
  as restrictive for all to anon, authenticated using (false) with check (false);
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'drop policy if exists urc_user_alert_hits_urc_web_denied on public.urc_user_alert_hits';
    execute 'create policy urc_user_alert_hits_urc_web_denied on public.urc_user_alert_hits as restrictive for all to urc_web using (false) with check (false)';
  end if;
end $$;

-- ── 3. Owner functions (signed identity, 026 contract) ──────────────────────

-- One page of the caller's hits, unseen first then newest first, with the
-- unread counts the bell and the Dashboard show. p_alert_client_key limits
-- the page to one alert; p_since limits it to hits recorded since then (the
-- digest). Counts in byAlert ignore both filters.
create or replace function public.urc_user_alert_hits_page(
  p_alert_client_key text,
  p_unseen_only boolean,
  p_since timestamptz,
  p_offset integer,
  p_limit integer,
  p_user_id text,
  p_org_id text,
  p_expires_at bigint,
  p_signature text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_result jsonb;
begin
  perform public.urc_user_assume('list', 'alert-hits', p_user_id, p_org_id, p_expires_at, p_signature);
  -- RLS limits both tables to the asserted identity's rows.
  with scoped as (
    select h.*, a.client_key as alert_client_key, a.name as alert_name
      from public.urc_user_alert_hits h
      join public.urc_user_alerts a on a.id = h.alert_id
     where (p_alert_client_key is null or a.client_key = p_alert_client_key)
       and (p_since is null or h.created_at >= p_since)
       and (not coalesce(p_unseen_only, false) or h.seen_at is null)
  ),
  page as (
    select s.* from scoped s
     order by (s.seen_at is not null), s.created_at desc, s.id
    offset v_offset
     limit v_limit
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'unseen', (select count(*) from scoped s where s.seen_at is null and not s.is_amendment),
    'unseenAmendments', (select count(*) from scoped s where s.seen_at is null and s.is_amendment),
    'byAlert', coalesce((
      select jsonb_object_agg(counts.client_key, counts.unseen)
        from (
          select a.client_key, count(*) as unseen
            from public.urc_user_alert_hits h
            join public.urc_user_alerts a on a.id = h.alert_id
           where h.seen_at is null and not h.is_amendment
           group by a.client_key
        ) counts
    ), '{}'::jsonb),
    'hits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'alertClientKey', p.alert_client_key,
        'alertName', p.alert_name,
        'accession', p.accession,
        'cik', p.cik,
        'company', p.company,
        'form', p.form,
        'filedAt', p.filed_at,
        'periodEnding', p.period_ending,
        'document', p.document,
        'sectionPath', p.section_path,
        'passage', p.passage,
        'passageBasis', p.passage_basis,
        'isAmendment', p.is_amendment,
        'amendsAccession', p.amends_accession,
        'seenAt', p.seen_at,
        'createdAt', p.created_at
      ) order by (p.seen_at is not null), p.created_at desc, p.id)
        from page p
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- Mark hits seen: the listed ids, every hit of one alert, or (p_all) every
-- hit. A call naming none of the three marks nothing.
create or replace function public.urc_user_alert_hits_mark_seen(
  p_hit_ids uuid[],
  p_alert_client_key text,
  p_all boolean,
  p_user_id text,
  p_org_id text,
  p_expires_at bigint,
  p_signature text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_count bigint;
  v_by_ids boolean := p_hit_ids is not null and cardinality(p_hit_ids) > 0;
begin
  perform public.urc_user_assume('upsert', 'alert-hits', p_user_id, p_org_id, p_expires_at, p_signature);
  if v_by_ids and cardinality(p_hit_ids) > 500 then
    raise exception 'urc_user: too many hits in one request' using errcode = '54000';
  end if;
  if not v_by_ids and p_alert_client_key is null and not coalesce(p_all, false) then
    return jsonb_build_object('marked', 0);
  end if;
  with marked as (
    update public.urc_user_alert_hits h
       set seen_at = now()
     where h.seen_at is null
       and (not v_by_ids or h.id = any(p_hit_ids))
       and (p_alert_client_key is null or h.alert_id in (
         select a.id from public.urc_user_alerts a where a.client_key = p_alert_client_key
       ))
    returning 1
  )
  select count(*) into v_count from marked;
  return jsonb_build_object('marked', v_count);
end $$;

grant create on schema public to urc_user_writer;
alter function public.urc_user_alert_hits_page(text, boolean, timestamptz, integer, integer, text, text, bigint, text) owner to urc_user_writer;
alter function public.urc_user_alert_hits_mark_seen(uuid[], text, boolean, text, text, bigint, text) owner to urc_user_writer;
revoke create on schema public from urc_user_writer;

revoke all on function public.urc_user_alert_hits_page(text, boolean, timestamptz, integer, integer, text, text, bigint, text) from public, authenticated;
revoke all on function public.urc_user_alert_hits_mark_seen(uuid[], text, boolean, text, text, bigint, text) from public, authenticated;
grant execute on function public.urc_user_alert_hits_page(text, boolean, timestamptz, integer, integer, text, text, bigint, text) to anon, service_role;
grant execute on function public.urc_user_alert_hits_mark_seen(uuid[], text, boolean, text, text, bigint, text) to anon, service_role;
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'grant execute on function public.urc_user_alert_hits_page(text, boolean, timestamptz, integer, integer, text, text, bigint, text) to urc_web';
    execute 'grant execute on function public.urc_user_alert_hits_mark_seen(uuid[], text, boolean, text, text, bigint, text) to urc_web';
  end if;
end $$;

-- ── 4. Evaluator functions (service_role only) ──────────────────────────────

-- Lease one alert for one check. Without an owner: the stalest DUE enabled
-- alert (daily: last checked at least p_daily_after_seconds ago; weekly: at
-- least p_weekly_after_seconds; never checked: always due). With an owner and
-- client key: that alert, due or not (the owner's "Run now"). SKIP LOCKED plus
-- the lease make concurrent evaluators take different alerts.
create or replace function public.urc_alert_eval_claim(
  p_owner_user_id text,
  p_org_id text,
  p_client_key text,
  p_daily_after_seconds integer,
  p_weekly_after_seconds integer,
  p_lease_seconds integer
) returns jsonb
language plpgsql volatile
set search_path = pg_catalog, public
as $$
declare
  v_daily interval := make_interval(secs => greatest(coalesce(p_daily_after_seconds, 72000), 3600));
  v_weekly interval := make_interval(secs => greatest(coalesce(p_weekly_after_seconds, 518400), 3600));
  target uuid;
  claimed public.urc_user_alerts;
begin
  if p_owner_user_id is null then
    select a.id into target
      from public.urc_user_alerts a
     where a.enabled
       and (a.evaluation_lease_until is null or a.evaluation_lease_until < now())
       and (
         a.last_checked_at is null
         or (a.cadence = 'daily' and a.last_checked_at <= now() - v_daily)
         or (a.cadence = 'weekly' and a.last_checked_at <= now() - v_weekly)
       )
     order by a.last_checked_at nulls first, a.id
     limit 1
     for update skip locked;
    if target is null then return null; end if;
  else
    if p_client_key is null then
      raise exception 'an owner claim names the alert';
    end if;
    select a.id into target
      from public.urc_user_alerts a
     where a.owner_user_id = p_owner_user_id
       and a.org_scope = coalesce(p_org_id, '')
       and a.client_key = p_client_key
     limit 1
     for update skip locked;
    if target is null then
      if exists (
        select 1 from public.urc_user_alerts a
         where a.owner_user_id = p_owner_user_id and a.org_scope = coalesce(p_org_id, '')
           and a.client_key = p_client_key
      ) then
        return jsonb_build_object('error', 'busy');
      end if;
      return jsonb_build_object('error', 'not-found');
    end if;
    if exists (
      select 1 from public.urc_user_alerts a
       where a.id = target and a.evaluation_lease_until is not null and a.evaluation_lease_until >= now()
    ) then
      return jsonb_build_object('error', 'busy');
    end if;
  end if;

  update public.urc_user_alerts
     set evaluation_lease = gen_random_uuid(),
         evaluation_lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 180), 30), 900))
   where id = target
  returning * into claimed;

  return jsonb_build_object(
    'id', claimed.id,
    'ownerUserId', claimed.owner_user_id,
    'orgId', claimed.org_id,
    'clientKey', claimed.client_key,
    'name', claimed.name,
    'query', claimed.query,
    'mode', claimed.mode,
    'filters', claimed.filters,
    'defaultForms', claimed.default_forms,
    'cadence', claimed.cadence,
    'enabled', claimed.enabled,
    'lastCheckedAt', claimed.last_checked_at,
    'lastSeenAccessions', claimed.last_seen_accessions,
    'engineVersion', claimed.engine_version,
    'lastCheckCoverage', claimed.last_check_coverage,
    'leaseToken', claimed.evaluation_lease
  );
end $$;

-- Originals this alert already surfaced for the given issuers, for pairing
-- an amendment with its original. Lease-scoped.
create or replace function public.urc_alert_eval_prior_hits(
  p_alert_id uuid,
  p_lease_token uuid,
  p_ciks text[]
) returns jsonb
language sql stable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'accession', h.accession,
    'cik', h.cik,
    'form', h.form,
    'periodEnding', h.period_ending
  )), '[]'::jsonb)
    from public.urc_user_alert_hits h
    join public.urc_user_alerts a on a.id = h.alert_id
   where a.id = p_alert_id
     and a.evaluation_lease = p_lease_token
     and a.evaluation_lease_until >= now()
     and h.cik = any(p_ciks[1:500])
     and h.period_ending is not null
     and h.form !~ '/A$';
$$;

-- Record one check atomically: the new hits, the alert's check state, and
-- the lease release. A lost lease writes nothing. Owner and org of every hit
-- come from the alert row. Retention: seen hits older than 180 days, and
-- anything beyond the newest 5,000 per alert, are removed.
create or replace function public.urc_alert_eval_record(
  p_alert_id uuid,
  p_lease_token uuid,
  p_last_hit_count integer,
  p_seen jsonb,
  p_latest_new jsonb,
  p_engine_version integer,
  p_coverage jsonb,
  p_hits jsonb
) returns jsonb
language plpgsql volatile
set search_path = pg_catalog, public
as $$
declare
  current_alert public.urc_user_alerts;
  inserted integer := 0;
begin
  if jsonb_typeof(p_seen) <> 'array' or jsonb_array_length(p_seen) > 5000 then
    raise exception 'seen accessions must be an array of at most 5000 entries';
  end if;
  if jsonb_typeof(p_latest_new) <> 'array' or jsonb_array_length(p_latest_new) > 5000 then
    raise exception 'new accessions must be an array of at most 5000 entries';
  end if;
  if jsonb_typeof(p_hits) <> 'array' or jsonb_array_length(p_hits) > 100 then
    raise exception 'hits must be an array of at most 100 entries';
  end if;
  if jsonb_typeof(p_coverage) <> 'object' or octet_length(p_coverage::text) > 65536 then
    raise exception 'coverage must be an object of at most 64 KB';
  end if;

  select * into current_alert
    from public.urc_user_alerts
   where id = p_alert_id and evaluation_lease = p_lease_token and evaluation_lease_until >= now()
   for update;
  if current_alert.id is null then
    return jsonb_build_object('error', 'lease-lost');
  end if;

  insert into public.urc_user_alert_hits (
    alert_id, owner_user_id, org_id, accession, cik, company, form, filed_at, period_ending,
    document, section_path, passage, passage_basis, is_amendment, amends_accession
  )
  select current_alert.id, current_alert.owner_user_id, current_alert.org_id,
         r.accession, r.cik,
         left(coalesce(r.company, ''), 300),
         left(coalesce(r.form, ''), 40),
         case when r.filed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then r.filed_at::date end,
         case when r.period_ending ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then r.period_ending::date end,
         coalesce(r.document, ''),
         left(coalesce(r.section_path, ''), 500),
         left(coalesce(r.passage, ''), 1200),
         case when r.passage_basis = 'validated-text' then 'validated-text' else 'not-read' end,
         coalesce(r.is_amendment, false),
         case when coalesce(r.is_amendment, false) then r.amends_accession end
    from jsonb_to_recordset(p_hits) as r(
      accession text, cik text, company text, form text, filed_at text, period_ending text,
      document text, section_path text, passage text, passage_basis text,
      is_amendment boolean, amends_accession text
    )
  on conflict (alert_id, accession) do nothing;
  get diagnostics inserted = row_count;

  update public.urc_user_alerts
     set last_checked_at = now(),
         last_hit_count = greatest(coalesce(p_last_hit_count, 0), 0),
         last_seen_accessions = p_seen,
         latest_new_accessions = p_latest_new,
         engine_version = p_engine_version,
         last_check_coverage = p_coverage,
         evaluation_lease = null,
         evaluation_lease_until = null,
         updated_at = now()
   where id = p_alert_id;

  delete from public.urc_user_alert_hits h
   where h.alert_id = p_alert_id
     and h.seen_at is not null
     and h.created_at < now() - interval '180 days';
  delete from public.urc_user_alert_hits h
   where h.id in (
     select x.id from public.urc_user_alert_hits x
      where x.alert_id = p_alert_id
      order by x.created_at desc, x.id
     offset 5000
   );

  return jsonb_build_object('inserted', inserted);
end $$;

-- Hand a lease back without recording a check (capacity was busy).
create or replace function public.urc_alert_eval_release(
  p_alert_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql volatile
set search_path = pg_catalog, public
as $$
begin
  update public.urc_user_alerts
     set evaluation_lease = null, evaluation_lease_until = null
   where id = p_alert_id and evaluation_lease = p_lease_token;
  return found;
end $$;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'urc\_alert\_eval\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
      execute format('revoke all on function %s from urc_web', fn.sig);
    end if;
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- ── 5. Post-conditions ───────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'urc_user_alert_hits'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception '029: urc_user_alert_hits must have forced row-level security';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.urc_user_alert_hits', 'select')
     or pg_catalog.has_table_privilege('anon', 'public.urc_user_alert_hits', 'insert')
     or pg_catalog.has_table_privilege('anon', 'public.urc_user_alert_hits', 'update')
     or pg_catalog.has_table_privilege('anon', 'public.urc_user_alert_hits', 'delete')
     or pg_catalog.has_table_privilege('authenticated', 'public.urc_user_alert_hits', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.urc_user_alert_hits', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.urc_user_alert_hits', 'update')
     or pg_catalog.has_table_privilege('authenticated', 'public.urc_user_alert_hits', 'delete') then
    raise exception '029: a generic web role holds a privilege on urc_user_alert_hits';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
     and (
       pg_catalog.has_table_privilege('urc_web', 'public.urc_user_alert_hits', 'select')
       or pg_catalog.has_table_privilege('urc_web', 'public.urc_user_alert_hits', 'insert')
       or pg_catalog.has_table_privilege('urc_web', 'public.urc_user_alert_hits', 'update')
       or pg_catalog.has_table_privilege('urc_web', 'public.urc_user_alert_hits', 'delete')
     ) then
    raise exception '029: urc_web holds a privilege on urc_user_alert_hits';
  end if;
  if pg_catalog.has_table_privilege('urc_user_writer', 'public.urc_user_alert_hits', 'insert')
     or pg_catalog.has_table_privilege('urc_user_writer', 'public.urc_user_alert_hits', 'delete') then
    raise exception '029: urc_user_writer may only read and mark alert hits seen';
  end if;
  if pg_catalog.has_schema_privilege('urc_user_writer', 'public', 'create') then
    raise exception '029: urc_user_writer must not hold CREATE on public';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'urc\_alert\_eval\_%' escape '\'
      and (p.prosecdef
           or pg_catalog.has_function_privilege('anon', p.oid, 'execute')
           or pg_catalog.has_function_privilege('authenticated', p.oid, 'execute'))
  ) then
    raise exception '029: evaluator functions must be invoker functions closed to web roles';
  end if;
  if (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and p.proname in ('urc_user_alert_hits_page', 'urc_user_alert_hits_mark_seen')
      and p.prosecdef and r.rolname = 'urc_user_writer'
  ) <> 2 then
    raise exception '029: the alert-hit owner functions must be SECURITY DEFINER owned by urc_user_writer';
  end if;
end $$;

notify pgrst, 'reload schema';

-- BEGIN URC PROVENANCE STAMP
-- Generated by: node scripts/schema-provenance.mjs
insert into public.urc_schema_version (
  singleton, version, migration_count, chain_checksum, checksum_algorithm
) values (
  true,
  '029',
  31,
  -- URC CHAIN CHECKSUM VALUE
  'ca9937097d3e1f3a9f018f642fc583437382b034d3e253137e1a89b16216d9de',
  'sha256-v2'
)
on conflict (singleton) do update set
  version = excluded.version,
  migration_count = excluded.migration_count,
  chain_checksum = excluded.chain_checksum,
  checksum_algorithm = excluded.checksum_algorithm,
  applied_at = now();
