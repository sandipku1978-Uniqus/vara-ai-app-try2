-- 028_search_continuation_jobs.sql
--
-- DEFECT (gap analysis 2026-10-04, row 10): a filtered search validates at
-- most 120 documents in one 45-second wave and shows at most 500 rows. When a
-- question needs filing text to answer it — section scope, filer status, a
-- cited standard, numeric operators, proximity — EDGAR's own total does not
-- answer it, so the user is told "N upstream candidates, M validated matches
-- shown" and never learns the population count. There was nowhere to keep
-- the work going after the browser's single wave ended.
--
-- FIX: a server-side continuation job per question. The job stores the
-- compiled search plan (inputs + engine version) and a resumable cursor (per
-- lane upstream offset, candidates collected but not yet examined, the set of
-- candidate ids already seen, cumulative per-branch ledgers, measured work).
-- A worker advances it one bounded wave at a time — the same executor, the
-- same per-wave policy — and records every verified filing as a hit row, so
-- the answer can grow past 500 and end as "N filings match (verified)".
--
-- ACCESS MODEL
--   * These are per-user records, not public SEC data. Unlike every other
--     urc_* relation they are NOT web-readable: anon, authenticated and
--     urc_web get nothing, and a RESTRICTIVE deny policy keeps rows closed
--     even if 014's read-contract sweep (which grants SELECT on every urc_*
--     table) is ever replayed after this migration.
--   * Writes go through the plain (invoker) functions below, executable by
--     service_role (today's server transport, used only from the audited
--     getUserWriterSupabase helper) and by urc_user_writer — the user-object
--     writer role planned in migration 026. It is created here if 026 has not
--     created it yet, so this migration is self-contained and idempotent.
--   * Row scope by owner: every function that reads or changes a user's job
--     takes the owner id the route took from its verified Clerk session and
--     filters on it; the worker's claim/advance pair is scoped by a lease
--     token instead, which only the claiming worker holds.
--   * No SECURITY DEFINER: the release-evidence evaluator
--     (scripts/accuracy/schema-contract.ts) treats any undeclared definer
--     function as a backdoor, and none is needed — callers already hold the
--     privileges these functions use.
--
-- Idempotent; forward-only. Apply in the Supabase SQL editor as postgres
-- (after 025, and after 026/027 when those land), then reload PostgREST.

-- ── 0. The user-object writer role ──────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_user_writer') then
    create role urc_user_writer nologin noinherit;
  end if;
end $$;

-- ── 1. Jobs ──────────────────────────────────────────────────────────────────
create table if not exists public.urc_search_jobs (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           text not null check (char_length(owner_user_id) between 1 and 200),
  org_id                  text check (org_id is null or char_length(org_id) between 1 and 200),
  plan                    jsonb not null check (jsonb_typeof(plan) = 'object'),
  cursor                  jsonb not null check (jsonb_typeof(cursor) = 'object'),
  status                  text not null default 'running'
                          check (status in ('running', 'finished', 'capped', 'expired', 'failed', 'cancelled')),
  status_reason           text check (status_reason is null or char_length(status_reason) <= 500),
  examined                integer not null default 0 check (examined >= 0),
  verified                integer not null default 0 check (verified >= 0),
  upstream_total          integer check (upstream_total is null or upstream_total >= 0),
  upstream_total_is_floor boolean not null default false,
  coverage                jsonb check (coverage is null or jsonb_typeof(coverage) = 'object'),
  waves                   integer not null default 0 check (waves >= 0),
  consecutive_failures    integer not null default 0 check (consecutive_failures >= 0),
  lease_token             uuid,
  lease_until             timestamptz,
  last_wave_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  expires_at              timestamptz not null default now() + interval '24 hours'
);

-- One active job per user, enforced by the database rather than by a race-
-- prone read-then-insert in the route.
create unique index if not exists urc_search_jobs_one_running_per_owner
  on public.urc_search_jobs (owner_user_id) where status = 'running';
-- The worker picks the runnable job that waited longest.
create index if not exists urc_search_jobs_runnable
  on public.urc_search_jobs ((coalesce(last_wave_at, created_at))) where status = 'running';
-- The dashboard lists a user's recent jobs.
create index if not exists urc_search_jobs_owner_recent
  on public.urc_search_jobs (owner_user_id, created_at desc);

-- ── 2. Verified hits, one row per filing ─────────────────────────────────────
create table if not exists public.urc_search_job_hits (
  job_id     uuid not null references public.urc_search_jobs (id) on delete cascade,
  accession  text not null check (accession ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'),
  file_date  date,
  hit        jsonb not null check (jsonb_typeof(hit) = 'object'),
  found_at   timestamptz not null default now(),
  primary key (job_id, accession)
);
create index if not exists urc_search_job_hits_page
  on public.urc_search_job_hits (job_id, file_date desc nulls last, accession);

-- ── 3. Closed to every web identity ──────────────────────────────────────────
alter table public.urc_search_jobs enable row level security;
alter table public.urc_search_job_hits enable row level security;

revoke all on public.urc_search_jobs from public, anon, authenticated;
revoke all on public.urc_search_job_hits from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'revoke all on public.urc_search_jobs from urc_web';
    execute 'revoke all on public.urc_search_job_hits from urc_web';
  end if;
end $$;

grant select, insert, update, delete on public.urc_search_jobs to service_role, urc_user_writer;
grant select, insert, update, delete on public.urc_search_job_hits to service_role, urc_user_writer;

drop policy if exists urc_search_jobs_web_denied on public.urc_search_jobs;
create policy urc_search_jobs_web_denied on public.urc_search_jobs
  as restrictive for all to anon, authenticated using (false) with check (false);
drop policy if exists urc_search_job_hits_web_denied on public.urc_search_job_hits;
create policy urc_search_job_hits_web_denied on public.urc_search_job_hits
  as restrictive for all to anon, authenticated using (false) with check (false);
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'drop policy if exists urc_search_jobs_urc_web_denied on public.urc_search_jobs';
    execute 'create policy urc_search_jobs_urc_web_denied on public.urc_search_jobs as restrictive for all to urc_web using (false) with check (false)';
    execute 'drop policy if exists urc_search_job_hits_urc_web_denied on public.urc_search_job_hits';
    execute 'create policy urc_search_job_hits_urc_web_denied on public.urc_search_job_hits as restrictive for all to urc_web using (false) with check (false)';
  end if;
end $$;

-- urc_user_writer is not BYPASSRLS; give it the rows. Owner scoping is
-- enforced by the functions below, which are its only intended entry points.
drop policy if exists urc_search_jobs_user_writer on public.urc_search_jobs;
create policy urc_search_jobs_user_writer on public.urc_search_jobs
  for all to urc_user_writer using (true) with check (true);
drop policy if exists urc_search_job_hits_user_writer on public.urc_search_job_hits;
create policy urc_search_job_hits_user_writer on public.urc_search_job_hits
  for all to urc_user_writer using (true) with check (true);

-- ── 4. Functions ─────────────────────────────────────────────────────────────
-- Summary shape shared by every function that returns a job (no cursor: it
-- can be large, and only the worker needs it).
create or replace function public.urc_search_job_summary(j public.urc_search_jobs)
returns jsonb language sql stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', j.id,
    'status', j.status,
    'statusReason', j.status_reason,
    'plan', j.plan,
    'examined', j.examined,
    'verified', j.verified,
    'upstreamTotal', j.upstream_total,
    'upstreamTotalIsFloor', j.upstream_total_is_floor,
    'coverage', j.coverage,
    'waves', j.waves,
    'leased', j.lease_until is not null and j.lease_until > now(),
    'lastWaveAt', j.last_wave_at,
    'createdAt', j.created_at,
    'updatedAt', j.updated_at,
    'expiresAt', j.expires_at
  );
$$;

-- Create a job. Refuses a second running job for the same owner and reports
-- the existing one instead. Stale running jobs past expiry are closed first.
create or replace function public.urc_search_job_create(
  p_owner_user_id text,
  p_org_id text,
  p_plan jsonb,
  p_cursor jsonb,
  p_ttl_seconds integer
) returns jsonb language plpgsql volatile
set search_path = pg_catalog, public
as $$
declare
  created public.urc_search_jobs;
  existing public.urc_search_jobs;
begin
  if p_owner_user_id is null or char_length(p_owner_user_id) not between 1 and 200 then
    raise exception 'owner is required';
  end if;
  if octet_length(p_plan::text) > 65536 then
    raise exception 'plan exceeds 64 KB';
  end if;
  if octet_length(p_cursor::text) > 4194304 then
    raise exception 'cursor exceeds 4 MB';
  end if;

  update public.urc_search_jobs
     set status = 'expired', status_reason = 'expired before finishing',
         lease_token = null, lease_until = null, updated_at = now()
   where owner_user_id = p_owner_user_id and status = 'running' and expires_at <= now();

  begin
    insert into public.urc_search_jobs (owner_user_id, org_id, plan, cursor, expires_at)
    values (
      p_owner_user_id, p_org_id, p_plan, p_cursor,
      now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 86400), 600), 604800))
    )
    returning * into created;
  exception when unique_violation then
    select * into existing from public.urc_search_jobs
     where owner_user_id = p_owner_user_id and status = 'running'
     limit 1;
    return jsonb_build_object('error', 'active-job-exists', 'job', public.urc_search_job_summary(existing));
  end;

  return jsonb_build_object('job', public.urc_search_job_summary(created));
end $$;

create or replace function public.urc_search_job_get(p_owner_user_id text, p_id uuid)
returns jsonb language sql stable
set search_path = pg_catalog, public
as $$
  select public.urc_search_job_summary(j)
    from public.urc_search_jobs j
   where j.id = p_id and j.owner_user_id = p_owner_user_id;
$$;

create or replace function public.urc_search_job_list(p_owner_user_id text, p_limit integer)
returns jsonb language sql stable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(public.urc_search_job_summary(j) order by j.created_at desc, j.id), '[]'::jsonb)
    from public.urc_search_jobs j
   where j.id in (
     select r.id from public.urc_search_jobs r
      where r.owner_user_id = p_owner_user_id
      order by r.created_at desc, r.id
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
   );
$$;

-- One page of a job's verified filings, newest first, with a stable
-- tie-break so paging never repeats or skips a row.
create or replace function public.urc_search_job_hits_page(
  p_owner_user_id text,
  p_id uuid,
  p_offset integer,
  p_limit integer
) returns jsonb language sql stable
set search_path = pg_catalog, public
as $$
  select case when j.id is null then null else jsonb_build_object(
    'total', j.verified,
    'hits', coalesce((
      select jsonb_agg(page.hit order by page.file_date desc nulls last, page.accession)
        from (
          select h.hit, h.file_date, h.accession
            from public.urc_search_job_hits h
           where h.job_id = j.id
           order by h.file_date desc nulls last, h.accession
          offset least(greatest(coalesce(p_offset, 0), 0), 100000)
           limit least(greatest(coalesce(p_limit, 50), 1), 200)
        ) page
    ), '[]'::jsonb)
  ) end
    from public.urc_search_jobs j
   where j.id = p_id and j.owner_user_id = p_owner_user_id;
$$;

create or replace function public.urc_search_job_cancel(p_owner_user_id text, p_id uuid)
returns jsonb language plpgsql volatile
set search_path = pg_catalog, public
as $$
declare
  updated public.urc_search_jobs;
begin
  update public.urc_search_jobs
     set status = 'cancelled', status_reason = 'cancelled by the user', updated_at = now()
   where id = p_id and owner_user_id = p_owner_user_id and status = 'running'
  returning * into updated;
  if updated.id is null then
    select * into updated from public.urc_search_jobs
     where id = p_id and owner_user_id = p_owner_user_id;
  end if;
  if updated.id is null then return null; end if;
  return public.urc_search_job_summary(updated);
end $$;

-- Lease one runnable job for one wave. With p_id (and optionally the owner)
-- it leases that job; without, the runnable job that has waited longest.
-- SKIP LOCKED plus the lease make concurrent workers take different jobs and
-- never the same one twice.
create or replace function public.urc_search_job_claim(
  p_id uuid,
  p_owner_user_id text,
  p_lease_seconds integer
) returns jsonb language plpgsql volatile
set search_path = pg_catalog, public
as $$
declare
  target uuid;
  claimed public.urc_search_jobs;
begin
  update public.urc_search_jobs
     set status = 'expired', status_reason = 'expired before finishing',
         lease_token = null, lease_until = null, updated_at = now()
   where status = 'running' and expires_at <= now()
     and (lease_until is null or lease_until < now());

  select j.id into target
    from public.urc_search_jobs j
   where j.status = 'running'
     and (p_id is null or j.id = p_id)
     and (p_owner_user_id is null or j.owner_user_id = p_owner_user_id)
     and (j.lease_until is null or j.lease_until < now())
   order by coalesce(j.last_wave_at, j.created_at)
   limit 1
   for update skip locked;
  if target is null then return null; end if;

  update public.urc_search_jobs
     set lease_token = gen_random_uuid(),
         lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 900))
   where id = target
  returning * into claimed;

  return public.urc_search_job_summary(claimed) || jsonb_build_object(
    'ownerUserId', claimed.owner_user_id,
    'orgId', claimed.org_id,
    'cursor', claimed.cursor,
    'leaseToken', claimed.lease_token
  );
end $$;

-- Stored hits for the given accessions, for merging a filing matched again
-- through another document (exhibit roll-up). Lease-scoped.
create or replace function public.urc_search_job_hits_lookup(
  p_id uuid,
  p_lease_token uuid,
  p_accessions text[]
) returns jsonb language sql stable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(h.hit), '[]'::jsonb)
    from public.urc_search_job_hits h
    join public.urc_search_jobs j on j.id = h.job_id
   where j.id = p_id and j.lease_token = p_lease_token and j.lease_until >= now()
     and h.accession = any(p_accessions[1:1000]);
$$;

-- Persist one wave atomically: hits, cursor, counters and status together,
-- then release the lease. A lost lease (expired, or another worker) writes
-- nothing. A job cancelled mid-wave keeps its cancelled status, but the
-- filings already verified in that wave are still recorded.
create or replace function public.urc_search_job_advance(
  p_id uuid,
  p_lease_token uuid,
  p_cursor jsonb,
  p_status text,
  p_status_reason text,
  p_examined integer,
  p_upstream_total integer,
  p_upstream_total_is_floor boolean,
  p_coverage jsonb,
  p_hits jsonb
) returns jsonb language plpgsql volatile
set search_path = pg_catalog, public
as $$
declare
  current_job public.urc_search_jobs;
  updated public.urc_search_jobs;
  hit_count integer;
begin
  if p_status not in ('running', 'finished', 'capped', 'expired', 'failed') then
    raise exception 'invalid status %', p_status;
  end if;
  if jsonb_typeof(p_hits) <> 'array' or jsonb_array_length(p_hits) > 1000 then
    raise exception 'hits must be an array of at most 1000 entries';
  end if;
  if octet_length(p_cursor::text) > 4194304 then
    raise exception 'cursor exceeds 4 MB';
  end if;

  select * into current_job from public.urc_search_jobs
   where id = p_id and lease_token = p_lease_token and lease_until >= now()
   for update;
  if current_job.id is null then
    return jsonb_build_object('error', 'lease-lost');
  end if;

  insert into public.urc_search_job_hits (job_id, accession, file_date, hit)
  select p_id,
         entry ->> 'accession',
         case when (entry ->> 'fileDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              then (entry ->> 'fileDate')::date end,
         entry -> 'hit'
    from jsonb_array_elements(p_hits) entry
  on conflict (job_id, accession) do update
     set hit = excluded.hit, file_date = excluded.file_date;

  select count(*) into hit_count from public.urc_search_job_hits where job_id = p_id;

  update public.urc_search_jobs
     set cursor = p_cursor,
         status = case when current_job.status = 'running' then p_status else current_job.status end,
         status_reason = case when current_job.status = 'running' then p_status_reason else current_job.status_reason end,
         examined = greatest(coalesce(p_examined, 0), 0),
         verified = hit_count,
         upstream_total = p_upstream_total,
         upstream_total_is_floor = coalesce(p_upstream_total_is_floor, false),
         coverage = p_coverage,
         waves = waves + 1,
         consecutive_failures = 0,
         lease_token = null,
         lease_until = null,
         last_wave_at = now(),
         updated_at = now()
   where id = p_id
  returning * into updated;

  return jsonb_build_object('job', public.urc_search_job_summary(updated));
end $$;

-- Release a lease without persisting a wave. p_failed counts a worker
-- failure: three in a row end the job as failed rather than retrying
-- forever. A wave that never started (capacity was busy) is not a failure.
create or replace function public.urc_search_job_release(
  p_id uuid,
  p_lease_token uuid,
  p_reason text,
  p_failed boolean
) returns jsonb language plpgsql volatile
set search_path = pg_catalog, public
as $$
declare
  updated public.urc_search_jobs;
begin
  update public.urc_search_jobs
     set consecutive_failures = consecutive_failures + case when p_failed then 1 else 0 end,
         lease_token = null,
         lease_until = null,
         updated_at = now()
   where id = p_id and lease_token = p_lease_token
  returning * into updated;
  if updated.id is null then return jsonb_build_object('error', 'lease-lost'); end if;

  if p_failed and updated.status = 'running' and updated.consecutive_failures >= 3 then
    update public.urc_search_jobs
       set status = 'failed',
           status_reason = left(coalesce(p_reason, 'the worker failed repeatedly'), 500),
           updated_at = now()
     where id = p_id
    returning * into updated;
  end if;
  return jsonb_build_object('job', public.urc_search_job_summary(updated));
end $$;

-- Execute surface: the server transport and the writer role only. Never any
-- web identity (023's evaluator rejects anon/urc_web execute on these).
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'urc\_search\_job\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
      execute format('revoke all on function %s from urc_web', fn.sig);
    end if;
    execute format('grant execute on function %s to service_role, urc_user_writer', fn.sig);
  end loop;
end $$;

grant usage on schema public to urc_user_writer;

notify pgrst, 'reload schema';

-- BEGIN URC PROVENANCE STAMP
-- Generated by: node scripts/schema-provenance.mjs
insert into public.urc_schema_version (
  singleton, version, migration_count, chain_checksum, checksum_algorithm
) values (
  true,
  '028',
  30,
  -- URC CHAIN CHECKSUM VALUE
  'af53aa75ff7a3c48b9f6815ae01d92dacd12d5c978559066d1ccb2d0992e0913',
  'sha256-v2'
)
on conflict (singleton) do update set
  version = excluded.version,
  migration_count = excluded.migration_count,
  chain_checksum = excluded.chain_checksum,
  checksum_algorithm = excluded.checksum_algorithm,
  applied_at = now();
