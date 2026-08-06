-- Filing AI — pre-filing integrity engine.
--
-- Three tables, and the shape of them is the governance model:
--
--   urc_filing_ai_engagements  mutable  — who is on the engagement and what they may do
--   urc_filing_ai_runs         WORM     — the sealed result of one pre-flight check
--   urc_filing_ai_dispositions append   — every human decision taken on a finding
--
-- A run is never updated. A finding's current status is the fold of its
-- disposition log over the sealed result, which is what makes G5 ("any
-- historical run re-executable against its original rule and authority
-- versions") true by construction rather than by policy: the evidence a
-- reviewer saw is still byte-for-byte in the row they saw it in.
--
-- The `urc_` prefix is load-bearing, not cosmetic. Migration 023's schema
-- contract inventories every `urc\_%` relation and raises if a generic web role
-- can read or write one. Naming these tables outside that prefix would place
-- the most sensitive data in the system — draft filings before they are public
-- — outside the only sweep that would notice a mistaken grant.

create table if not exists public.urc_filing_ai_engagements (
  engagement_id      text primary key,
  org_scope          text not null,
  client_name        text not null,
  cik                text not null,
  forms_in_scope     text[] not null default '{}',
  tier_authorised    smallint not null default 0,
  status             text not null default 'onboarding'
                       check (status in ('onboarding', 'active', 'suspended', 'closed')),
  members            jsonb not null default '[]'::jsonb,
  onboarding         jsonb not null default '[]'::jsonb,
  four_eyes_threshold text not null default 'critical'
                       check (four_eyes_threshold in ('critical', 'high', 'medium', 'low')),
  data_residency     text not null default 'us',
  retention_years    smallint not null default 7,
  created_at         timestamptz not null default now(),
  created_by         text not null,
  updated_at         timestamptz not null default now()
);

create index if not exists urc_filing_ai_engagements_scope_idx
  on public.urc_filing_ai_engagements (org_scope, status);
create index if not exists urc_filing_ai_engagements_cik_idx
  on public.urc_filing_ai_engagements (cik);

create table if not exists public.urc_filing_ai_runs (
  run_id             text primary key,
  org_scope          text not null,
  engagement_id      text references public.urc_filing_ai_engagements (engagement_id),
  cik                text not null,
  registrant         text not null,
  form_type          text not null,
  period_of_report   date,
  accession          text not null,
  gate               text not null check (gate in ('NOT_READY', 'READY_WITH_EXCEPTIONS', 'READY')),
  readiness_score    numeric(5, 1) not null,
  coverage_factor    numeric(6, 4) not null,
  catalog_version    text not null,
  engine_version     text not null,
  -- The sealed RunResult. Insert-only; see the guard trigger below.
  result             jsonb not null,
  result_digest      text not null,
  started_by         text not null,
  created_at         timestamptz not null default now()
);

create index if not exists urc_filing_ai_runs_scope_created_idx
  on public.urc_filing_ai_runs (org_scope, created_at desc);
create index if not exists urc_filing_ai_runs_engagement_idx
  on public.urc_filing_ai_runs (engagement_id, created_at desc);
create index if not exists urc_filing_ai_runs_cik_idx
  on public.urc_filing_ai_runs (cik, created_at desc);

-- WORM. A sealed run is the evidence a reviewer relied on; rewriting it would
-- make the evidence pack worthless for ICFR purposes even if the rewrite were
-- benign. Corrections are made by executing a new run, not by editing an old one.
create or replace function public.urc_filing_ai_runs_are_immutable()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'urc_filing_ai_runs is append-only; execute a new run instead of amending %', old.run_id;
end;
$$;

drop trigger if exists urc_filing_ai_runs_no_update on public.urc_filing_ai_runs;
create trigger urc_filing_ai_runs_no_update
  before update or delete on public.urc_filing_ai_runs
  for each row execute function public.urc_filing_ai_runs_are_immutable();

create table if not exists public.urc_filing_ai_dispositions (
  disposition_id     bigserial primary key,
  run_id             text not null references public.urc_filing_ai_runs (run_id),
  finding_id         text not null,
  rule_id            text not null,
  status             text not null check (status in ('remediated', 'accepted', 'suppressed')),
  actor              text not null,
  actor_role         text not null,
  rationale          text not null,
  four_eyes_by       text,
  expires_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists urc_filing_ai_dispositions_run_idx
  on public.urc_filing_ai_dispositions (run_id, finding_id, created_at desc);
create index if not exists urc_filing_ai_dispositions_rule_idx
  on public.urc_filing_ai_dispositions (rule_id, created_at desc);

-- Append-only for the same reason: the audit trail is the deliverable.
create or replace function public.urc_filing_ai_dispositions_are_append_only()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'urc_filing_ai_dispositions is append-only; record a superseding disposition instead';
end;
$$;

drop trigger if exists urc_filing_ai_dispositions_no_update on public.urc_filing_ai_dispositions;
create trigger urc_filing_ai_dispositions_no_update
  before update or delete on public.urc_filing_ai_dispositions
  for each row execute function public.urc_filing_ai_dispositions_are_append_only();

alter table public.urc_filing_ai_engagements enable row level security;
alter table public.urc_filing_ai_runs enable row level security;
alter table public.urc_filing_ai_dispositions enable row level security;

-- No web-role surface at all. These rows describe draft filings that have not
-- been submitted to the SEC — the most sensitive data the platform holds — and
-- every read and write goes through the server-side cache-writer credential
-- after the route has authenticated the caller and resolved their org scope
-- (G7 tenant isolation). No anonymous policy is defined, and none should be.
revoke all on table
  public.urc_filing_ai_engagements,
  public.urc_filing_ai_runs,
  public.urc_filing_ai_dispositions
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'revoke all on table
      public.urc_filing_ai_engagements,
      public.urc_filing_ai_runs,
      public.urc_filing_ai_dispositions
    from urc_web';
  end if;
end $$;

revoke all on sequence public.urc_filing_ai_dispositions_disposition_id_seq
  from public, anon, authenticated;

grant select, insert on table
  public.urc_filing_ai_engagements,
  public.urc_filing_ai_runs,
  public.urc_filing_ai_dispositions
to service_role;
grant update on table public.urc_filing_ai_engagements to service_role;
grant usage on sequence public.urc_filing_ai_dispositions_disposition_id_seq to service_role;

revoke all on function public.urc_filing_ai_runs_are_immutable() from public, anon, authenticated;
revoke all on function public.urc_filing_ai_dispositions_are_append_only() from public, anon, authenticated;

-- Fail closed if a later change hands a web role access to draft filing data.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'urc_filing_ai_engagements', 'urc_filing_ai_runs', 'urc_filing_ai_dispositions'
  ] loop
    if pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'select')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'select') then
      raise exception 'filing ai: a generic web role can read %', relation_name;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
       and pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'select') then
      raise exception 'filing ai: urc_web can read %', relation_name;
    end if;
  end loop;
end $$;

-- BEGIN URC PROVENANCE STAMP
-- Generated by: node scripts/schema-provenance.mjs
insert into public.urc_schema_version (
  singleton, version, migration_count, chain_checksum, checksum_algorithm
) values (
  true,
  '024',
  26,
  -- URC CHAIN CHECKSUM VALUE
  'aa4bbb76d9a9a924807e0a96ff295affb25804f54301ab17565845d48b2a1fe6',
  'sha256-v2'
)
on conflict (singleton) do update set
  version = excluded.version,
  migration_count = excluded.migration_count,
  chain_checksum = excluded.chain_checksum,
  checksum_algorithm = excluded.checksum_algorithm,
  applied_at = now();

notify pgrst, 'reload schema';
