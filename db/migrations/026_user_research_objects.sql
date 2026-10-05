-- 026_user_research_objects.sql
--
-- WHY: nothing a user creates is stored on the server. The watchlist, saved
-- alerts, peer sets, memo tray and memo draft, filing annotations and the
-- accounting review checklist live in localStorage; research tabs live in
-- sessionStorage and die with the browser. No table in 001–025 carries a
-- user or organization column. A researcher who changes machines, clears a
-- browser, or simply restarts it loses the work (gap analysis 2026-10-04,
-- row 1 and recommendation 1).
--
-- WHAT THIS ADDS
--   * urc_user_projects — a minimal named project (name + question). Every
--     other object may hang off one through project_id.
--   * One table per object type: urc_user_saved_searches, urc_user_alerts,
--     urc_user_peer_sets, urc_user_memo_items (citations plus one draft row),
--     urc_user_annotations, urc_user_research_tabs, urc_user_watchlist and
--     urc_user_checklists. Every row carries owner_user_id (the Clerk user
--     id), org_id (the Clerk organization id, null for a personal account),
--     project_id, created_at/updated_at, and a client_key so the browser's
--     own ids upsert idempotently while localStorage is migrated.
--   * Three RPCs the web routes call — urc_user_list, urc_user_upsert,
--     urc_user_delete — plus two private helpers.
--
-- HOW WRITES ARE AUTHORIZED (and why this is not the 014 read contract)
--   014 gives the web identity (the publishable key, which lands as `anon`)
--   read access to public SEC data and nothing else. User rows are private,
--   so neither `anon` nor `authenticated` nor `urc_web` receives any table
--   privilege here, and production routes still never escalate to the
--   service key (the three audited cache writers remain the only exception).
--
--   Instead:
--   1. A dedicated NOLOGIN role, urc_user_writer, holds SELECT/INSERT/UPDATE/
--      DELETE on exactly these tables and nothing else in the URC schema.
--   2. Every table has RLS enabled and FORCED, with one policy for
--      urc_user_writer that scopes rows to
--        owner_user_id = current_setting('urc.user_id', true) and
--        org_scope     = coalesce(current_setting('urc.org_id', true), '').
--      With neither setting present no row is visible or writable.
--   3. The three public RPCs are SECURITY DEFINER functions OWNED BY
--      urc_user_writer, so they run with that role's privileges and under
--      its RLS policies — never as postgres or service_role. Each first calls
--      urc_user_assume(), which sets urc.user_id / urc.org_id
--      transaction-locally (set_config(..., true)) and only after verifying
--      an identity assertion.
--   4. The assertion is an HMAC-SHA256, signed by the route with
--      URC_USER_DATA_SIGNING_SECRET after Clerk has authenticated the request
--      (requireApiAccess), over: purpose, operation, object kind, user id,
--      org id and a short expiry. The same secret lives in
--      urc_user_signing_key, readable only by urc_user_writer. The publishable
--      key is designed to be public, so "anon may call the RPC" alone would
--      let anyone write anyone's rows; the signature is what makes the
--      database, not the route, enforce whose rows a call touches. The route
--      takes the user and org from the Clerk session only — never the body.
--
--   Why not the alternatives:
--   * A custom-role JWT is not possible: this project signs tokens with
--     non-exportable asymmetric keys (see src/lib/supabase-web.ts).
--   * Granting `authenticated` plus Clerk third-party auth would contradict
--     the live schema contract, which requires `authenticated` to hold no
--     privilege on any urc_* relation, and needs dashboard configuration in
--     two services that cannot be verified from the repository.
--   * The service key is reserved for trusted jobs and the three audited
--     cache-writer routes (migrationSecurity guardrail).
--
--   The scheduled alert evaluator (a trusted job, not a web route) reads and
--   updates urc_user_alerts with service_role, which is granted the tables
--   explicitly below.
--
-- OPERATOR STEPS (after applying, as postgres in the Supabase SQL editor):
--   insert into public.urc_user_signing_key (singleton, secret)
--   values (true, '<the same value as URC_USER_DATA_SIGNING_SECRET>')
--   on conflict (singleton) do update set secret = excluded.secret,
--     rotated_at = now();
--   and set URC_USER_DATA_SIGNING_SECRET (at least 32 characters) in Vercel.
--   Until both are present every user-data route answers 503 and the browser
--   keeps its local behaviour, exactly as before this migration.
--
-- Idempotent; forward-only. Requires pgcrypto (preinstalled on Supabase in
-- the `extensions` schema). `notify pgrst` at the end reloads the schema.

-- ── 0. pgcrypto for HMAC ─────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pgcrypto') then
    create schema if not exists extensions;
    create extension pgcrypto with schema extensions;
  end if;
  if pg_catalog.to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
    raise exception 'user research objects: pgcrypto must be installed in the extensions schema (extensions.hmac(bytea,bytea,text) is missing)';
  end if;
end $$;

-- ── 1. The writer role ───────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_user_writer') then
    create role urc_user_writer nologin noinherit;
  end if;
end $$;
-- Attributes beyond LOGIN/INHERIT need superuser to change on Supabase; the
-- post-conditions in section 6 verify the role carries none of them.
alter role urc_user_writer nologin noinherit;
-- The migration owner must be a member to hand function ownership to it.
do $$ begin
  execute format('grant urc_user_writer to %I', current_user);
end $$;
grant usage on schema public to urc_user_writer;
do $$ begin
  if not pg_catalog.has_schema_privilege('urc_user_writer', 'extensions', 'usage') then
    execute 'grant usage on schema extensions to urc_user_writer';
  end if;
  if not pg_catalog.has_function_privilege('urc_user_writer', 'extensions.hmac(bytea,bytea,text)', 'execute') then
    execute 'grant execute on function extensions.hmac(bytea, bytea, text) to urc_user_writer';
  end if;
end $$;

-- ── 2. Tables ────────────────────────────────────────────────────────────────
-- Identity columns are constrained to the shape of Clerk ids; org_scope is
-- the non-null form of org_id so the upsert key works for personal accounts.

create table if not exists public.urc_user_projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  client_key text not null check (char_length(client_key) between 1 and 300),
  name text not null check (char_length(name) between 1 and 120),
  question text not null default '' check (char_length(question) <= 2000),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_projects_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_saved_searches (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  label text not null default '' check (char_length(label) <= 200),
  query text not null default '' check (char_length(query) <= 4000),
  mode text not null default 'semantic' check (mode in ('semantic', 'boolean')),
  filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 16384),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_saved_searches_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  -- Either a reference to a saved search or the inline search contract.
  saved_search_id uuid references public.urc_user_saved_searches (id) on delete set null,
  name text not null default '' check (char_length(name) <= 200),
  query text not null default '' check (char_length(query) <= 4000),
  mode text not null default 'semantic' check (mode in ('semantic', 'boolean')),
  filters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 16384),
  default_forms text not null default '' check (char_length(default_forms) <= 400),
  cadence text not null default 'daily' check (cadence in ('daily', 'weekly')),
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_hit_count integer not null default 0 check (last_hit_count >= 0),
  last_seen_accessions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(last_seen_accessions) = 'array' and jsonb_array_length(last_seen_accessions) <= 5000),
  latest_new_accessions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(latest_new_accessions) = 'array' and jsonb_array_length(latest_new_accessions) <= 5000),
  engine_version integer,
  last_check_coverage jsonb
    check (last_check_coverage is null or octet_length(last_check_coverage::text) <= 65536),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_alerts_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_peer_sets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  name text not null check (char_length(name) between 1 and 120),
  tickers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tickers) = 'array' and jsonb_array_length(tickers) <= 200),
  ciks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ciks) = 'array' and jsonb_array_length(ciks) <= 200),
  as_of timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_peer_sets_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_memo_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  -- 'citation': one memo-tray citation record; 'draft': the generated memo.
  item_kind text not null check (item_kind in ('citation', 'draft')),
  accession text check (accession is null or char_length(accession) <= 25),
  cik text check (cik is null or cik ~ '^[0-9]{1,10}$'),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_memo_items_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_annotations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  -- The viewer's filing address (cik_accession_document) and its accession.
  filing_key text not null check (char_length(filing_key) between 1 and 400),
  accession text check (accession is null or char_length(accession) <= 25),
  -- Where the note is anchored: the quoted passage and its section.
  anchor jsonb not null default '{}'::jsonb
    check (jsonb_typeof(anchor) = 'object' and octet_length(anchor::text) <= 16384),
  note text not null check (char_length(note) between 1 and 8000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_annotations_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_research_tabs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  title text not null default '' check (char_length(title) <= 200),
  -- The serialized research tab (query, filters, results, coverage).
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 524288),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_research_tabs_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_watchlist (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  ticker text not null check (ticker ~ '^[A-Z0-9./-]{1,15}$'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_watchlist_client_key_uq unique (owner_user_id, org_scope, client_key)
);

create table if not exists public.urc_user_checklists (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null check (owner_user_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_id text check (org_id is null or org_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  org_scope text generated always as (coalesce(org_id, '')) stored,
  project_id uuid references public.urc_user_projects (id) on delete set null,
  client_key text not null check (char_length(client_key) between 1 and 300),
  name text not null default '' check (char_length(name) <= 200),
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and octet_length(items::text) <= 65536),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint urc_user_checklists_client_key_uq unique (owner_user_id, org_scope, client_key)
);

-- The HMAC secret the RPCs verify assertions with. One row; set by the
-- operator (see header), never by a migration.
create table if not exists public.urc_user_signing_key (
  singleton boolean primary key default true check (singleton),
  secret text not null check (char_length(secret) >= 32),
  rotated_at timestamptz not null default now()
);

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
create index if not exists urc_user_projects_owner_idx on public.urc_user_projects (owner_user_id, org_id);
create index if not exists urc_user_saved_searches_owner_idx on public.urc_user_saved_searches (owner_user_id, org_id);
create index if not exists urc_user_alerts_owner_idx on public.urc_user_alerts (owner_user_id, org_id);
create index if not exists urc_user_peer_sets_owner_idx on public.urc_user_peer_sets (owner_user_id, org_id);
create index if not exists urc_user_memo_items_owner_idx on public.urc_user_memo_items (owner_user_id, org_id);
create index if not exists urc_user_annotations_owner_idx on public.urc_user_annotations (owner_user_id, org_id);
create index if not exists urc_user_research_tabs_owner_idx on public.urc_user_research_tabs (owner_user_id, org_id);
create index if not exists urc_user_watchlist_owner_idx on public.urc_user_watchlist (owner_user_id, org_id);
create index if not exists urc_user_checklists_owner_idx on public.urc_user_checklists (owner_user_id, org_id);
-- The scheduled evaluator's scan: enabled alerts by cadence, stalest first.
create index if not exists urc_user_alerts_due_idx
  on public.urc_user_alerts (cadence, last_checked_at nulls first) where enabled;
-- Foreign-key lookups when a project or saved search is deleted.
create index if not exists urc_user_saved_searches_project_idx on public.urc_user_saved_searches (project_id) where project_id is not null;
create index if not exists urc_user_alerts_project_idx on public.urc_user_alerts (project_id) where project_id is not null;
create index if not exists urc_user_alerts_saved_search_idx on public.urc_user_alerts (saved_search_id) where saved_search_id is not null;
create index if not exists urc_user_peer_sets_project_idx on public.urc_user_peer_sets (project_id) where project_id is not null;
create index if not exists urc_user_memo_items_project_idx on public.urc_user_memo_items (project_id) where project_id is not null;
create index if not exists urc_user_annotations_project_idx on public.urc_user_annotations (project_id) where project_id is not null;
create index if not exists urc_user_research_tabs_project_idx on public.urc_user_research_tabs (project_id) where project_id is not null;
create index if not exists urc_user_watchlist_project_idx on public.urc_user_watchlist (project_id) where project_id is not null;
create index if not exists urc_user_checklists_project_idx on public.urc_user_checklists (project_id) where project_id is not null;

-- ── 4. Privileges and row-level security ────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'urc_user_projects', 'urc_user_saved_searches', 'urc_user_alerts',
    'urc_user_peer_sets', 'urc_user_memo_items', 'urc_user_annotations',
    'urc_user_research_tabs', 'urc_user_watchlist', 'urc_user_checklists'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
      execute format('revoke all on table public.%I from urc_web', t);
    end if;
    execute format('grant select, insert, update, delete on table public.%I to urc_user_writer', t);
    -- Trusted jobs only (the scheduled alert evaluator); never a web route.
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('drop policy if exists urc_user_owner_rows on public.%I', t);
    execute format(
      'create policy urc_user_owner_rows on public.%I as permissive for all to urc_user_writer '
      'using (owner_user_id = current_setting(''urc.user_id'', true) '
      'and org_scope = coalesce(current_setting(''urc.org_id'', true), '''')) '
      'with check (owner_user_id = current_setting(''urc.user_id'', true) '
      'and org_scope = coalesce(current_setting(''urc.org_id'', true), ''''))',
      t
    );
  end loop;
end $$;

alter table public.urc_user_signing_key enable row level security;
alter table public.urc_user_signing_key force row level security;
revoke all on table public.urc_user_signing_key from public, anon, authenticated, service_role;
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'revoke all on table public.urc_user_signing_key from urc_web';
  end if;
end $$;
grant select on table public.urc_user_signing_key to urc_user_writer;
drop policy if exists urc_user_signing_key_read on public.urc_user_signing_key;
create policy urc_user_signing_key_read on public.urc_user_signing_key
  as permissive for select to urc_user_writer using (true);

-- ── 5. Functions ─────────────────────────────────────────────────────────────

-- Object kind → table, writable columns (in upsert order) and row cap. The
-- column lists are the write whitelist: identity columns are never in them.
create or replace function public.urc_user_kind(
  p_kind text,
  out table_name text,
  out writable_columns text[],
  out max_rows integer,
  out max_items integer
)
language plpgsql immutable
set search_path = pg_catalog, public
as $$
begin
  case p_kind
    when 'projects' then
      table_name := 'urc_user_projects';
      writable_columns := array['id', 'client_key', 'name', 'question', 'position', 'archived_at', 'created_at'];
      max_rows := 100; max_items := 100;
    when 'saved-searches' then
      table_name := 'urc_user_saved_searches';
      writable_columns := array['id', 'client_key', 'project_id', 'label', 'query', 'mode', 'filters', 'position', 'created_at'];
      max_rows := 500; max_items := 100;
    when 'alerts' then
      table_name := 'urc_user_alerts';
      writable_columns := array['client_key', 'project_id', 'saved_search_id', 'name', 'query', 'mode', 'filters',
        'default_forms', 'cadence', 'enabled', 'last_checked_at', 'last_hit_count', 'last_seen_accessions',
        'latest_new_accessions', 'engine_version', 'last_check_coverage', 'position', 'created_at'];
      max_rows := 100; max_items := 100;
    when 'peer-sets' then
      table_name := 'urc_user_peer_sets';
      writable_columns := array['client_key', 'project_id', 'name', 'tickers', 'ciks', 'as_of', 'position', 'created_at'];
      max_rows := 100; max_items := 100;
    when 'memo' then
      table_name := 'urc_user_memo_items';
      writable_columns := array['client_key', 'project_id', 'item_kind', 'accession', 'cik', 'payload', 'position', 'created_at'];
      max_rows := 1000; max_items := 200;
    when 'annotations' then
      table_name := 'urc_user_annotations';
      writable_columns := array['client_key', 'project_id', 'filing_key', 'accession', 'anchor', 'note', 'position', 'created_at'];
      max_rows := 5000; max_items := 200;
    when 'research-tabs' then
      -- The browser keeps eight tabs; the server bound leaves room for two
      -- devices converging without rejecting a write mid-sync.
      table_name := 'urc_user_research_tabs';
      writable_columns := array['client_key', 'project_id', 'title', 'payload', 'position', 'created_at'];
      max_rows := 16; max_items := 8;
    when 'watchlist' then
      table_name := 'urc_user_watchlist';
      writable_columns := array['client_key', 'project_id', 'ticker', 'position', 'created_at'];
      max_rows := 500; max_items := 200;
    when 'checklists' then
      table_name := 'urc_user_checklists';
      writable_columns := array['client_key', 'project_id', 'name', 'items', 'position', 'created_at'];
      max_rows := 50; max_items := 50;
    else
      raise exception 'urc_user: unknown object kind' using errcode = '22023';
  end case;
end $$;

-- Verify the route's identity assertion and scope this transaction to it.
create or replace function public.urc_user_assume(
  p_operation text,
  p_kind text,
  p_user_id text,
  p_org_id text,
  p_expires_at bigint,
  p_signature text
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  v_secret text;
  v_expected text;
begin
  if p_user_id is null or p_user_id !~ '^[A-Za-z0-9_:-]{1,128}$'
     or (p_org_id is not null and p_org_id <> '' and p_org_id !~ '^[A-Za-z0-9_:-]{1,128}$') then
    raise exception 'urc_user: identity assertion rejected' using errcode = '28000';
  end if;
  -- Short-lived: the route signs with a 120 s lifetime; anything outside
  -- [now, now + 600 s] is expired or forged.
  if p_expires_at is null or p_expires_at < v_now or p_expires_at > v_now + 600 then
    raise exception 'urc_user: identity assertion expired' using errcode = '28000';
  end if;
  select k.secret into v_secret from public.urc_user_signing_key k where k.singleton;
  if v_secret is null then
    raise exception 'urc_user: signing key is not provisioned' using errcode = '28000';
  end if;
  v_expected := encode(
    extensions.hmac(
      convert_to(concat_ws(E'\n', 'urc-user-v1', p_operation, p_kind, p_user_id, coalesce(p_org_id, ''), p_expires_at::text), 'UTF8'),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  if p_signature is null or lower(p_signature) <> v_expected then
    raise exception 'urc_user: identity assertion rejected' using errcode = '28000';
  end if;
  perform set_config('urc.user_id', p_user_id, true);
  perform set_config('urc.org_id', coalesce(p_org_id, ''), true);
end $$;

create or replace function public.urc_user_list(
  p_kind text,
  p_user_id text,
  p_org_id text,
  p_expires_at bigint,
  p_signature text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_kind record;
  v_result jsonb;
begin
  select * into v_kind from public.urc_user_kind(p_kind);
  perform public.urc_user_assume('list', p_kind, p_user_id, p_org_id, p_expires_at, p_signature);
  -- RLS limits the scan to the asserted identity's rows.
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) - ''owner_user_id'' - ''org_id'' - ''org_scope'' '
    'order by t.position, t.created_at, t.client_key), ''[]''::jsonb) from public.%I t',
    v_kind.table_name
  ) into v_result;
  return v_result;
end $$;

create or replace function public.urc_user_upsert(
  p_kind text,
  p_items jsonb,
  p_user_id text,
  p_org_id text,
  p_expires_at bigint,
  p_signature text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_kind record;
  v_column text;
  v_insert_columns text := '';
  v_select_columns text := '';
  v_update_columns text := '';
  v_result jsonb;
  v_count bigint;
begin
  select * into v_kind from public.urc_user_kind(p_kind);
  perform public.urc_user_assume('upsert', p_kind, p_user_id, p_org_id, p_expires_at, p_signature);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'urc_user: items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > v_kind.max_items then
    raise exception 'urc_user: too many items in one request' using errcode = '54000';
  end if;
  if jsonb_array_length(p_items) = 0 then
    return '[]'::jsonb;
  end if;

  foreach v_column in array v_kind.writable_columns loop
    v_insert_columns := v_insert_columns || ', ' || quote_ident(v_column);
    v_select_columns := v_select_columns || ', ' || case v_column
      when 'id' then 'coalesce(r.id, gen_random_uuid())'
      when 'created_at' then 'coalesce(r.created_at, now())'
      when 'position' then 'coalesce(r.position, 0)'
      -- A reference to a project or saved search survives only when the
      -- asserted identity can see it (RLS); anything else becomes null, so a
      -- row can never point into another user's objects.
      when 'project_id' then '(select p.id from public.urc_user_projects p where p.id = r.project_id)'
      when 'saved_search_id' then '(select s.id from public.urc_user_saved_searches s where s.id = r.saved_search_id)'
      else 'r.' || quote_ident(v_column)
    end;
    if v_column in ('project_id', 'saved_search_id') then
      -- A write that does not name a project keeps the one already stored:
      -- browser stores that predate projects cannot carry the id, and an
      -- edit there must not detach the object from its project.
      v_update_columns := v_update_columns || format('%1$I = coalesce(excluded.%1$I, t.%1$I), ', v_column);
    elsif v_column not in ('id', 'client_key', 'created_at') then
      v_update_columns := v_update_columns || quote_ident(v_column) || ' = excluded.' || quote_ident(v_column) || ', ';
    end if;
  end loop;

  execute format(
    'with written as ('
    '  insert into public.%1$I as t (owner_user_id, org_id%2$s)'
    '  select $2, $3%3$s from jsonb_populate_recordset(null::public.%1$I, $1) r'
    '  on conflict (owner_user_id, org_scope, client_key) do update set %4$s updated_at = now()'
    '  returning t.id, t.client_key, t.updated_at'
    ') select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''client_key'', client_key, ''updated_at'', updated_at)), ''[]''::jsonb) from written',
    v_kind.table_name, v_insert_columns, v_select_columns, v_update_columns
  ) into v_result using p_items, p_user_id, nullif(p_org_id, '');

  execute format('select count(*) from public.%I', v_kind.table_name) into v_count;
  if v_count > v_kind.max_rows then
    -- Raising rolls the whole write back.
    raise exception 'urc_user: object limit reached' using errcode = '54000';
  end if;
  return v_result;
end $$;

create or replace function public.urc_user_delete(
  p_kind text,
  p_client_keys text[],
  p_user_id text,
  p_org_id text,
  p_expires_at bigint,
  p_signature text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_kind record;
  v_count bigint;
begin
  select * into v_kind from public.urc_user_kind(p_kind);
  perform public.urc_user_assume('delete', p_kind, p_user_id, p_org_id, p_expires_at, p_signature);
  if p_client_keys is null or cardinality(p_client_keys) = 0 then
    return jsonb_build_object('deleted', 0);
  end if;
  if cardinality(p_client_keys) > 500 then
    raise exception 'urc_user: too many keys in one request' using errcode = '54000';
  end if;
  execute format(
    'with removed as (delete from public.%I t where t.client_key = any($1) returning 1) select count(*) from removed',
    v_kind.table_name
  ) into v_count using p_client_keys;
  return jsonb_build_object('deleted', v_count);
end $$;

-- Ownership: the three public RPCs run as urc_user_writer, so the RLS
-- policies above bind them. ALTER ... OWNER requires the new owner to hold
-- CREATE on the schema at that moment; it is granted for the transfer only.
grant create on schema public to urc_user_writer;
alter function public.urc_user_kind(text) owner to urc_user_writer;
alter function public.urc_user_assume(text, text, text, text, bigint, text) owner to urc_user_writer;
alter function public.urc_user_list(text, text, text, bigint, text) owner to urc_user_writer;
alter function public.urc_user_upsert(text, jsonb, text, text, bigint, text) owner to urc_user_writer;
alter function public.urc_user_delete(text, text[], text, text, bigint, text) owner to urc_user_writer;
revoke create on schema public from urc_user_writer;

revoke all on function public.urc_user_kind(text) from public, anon, authenticated, service_role;
revoke all on function public.urc_user_assume(text, text, text, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.urc_user_kind(text) to urc_user_writer;
grant execute on function public.urc_user_assume(text, text, text, text, bigint, text) to urc_user_writer;

revoke all on function public.urc_user_list(text, text, text, bigint, text) from public, authenticated;
revoke all on function public.urc_user_upsert(text, jsonb, text, text, bigint, text) from public, authenticated;
revoke all on function public.urc_user_delete(text, text[], text, text, bigint, text) from public, authenticated;
grant execute on function public.urc_user_list(text, text, text, bigint, text) to anon, service_role;
grant execute on function public.urc_user_upsert(text, jsonb, text, text, bigint, text) to anon, service_role;
grant execute on function public.urc_user_delete(text, text[], text, text, bigint, text) to anon, service_role;
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web') then
    execute 'revoke all on function public.urc_user_kind(text) from urc_web';
    execute 'revoke all on function public.urc_user_assume(text, text, text, text, bigint, text) from urc_web';
    execute 'grant execute on function public.urc_user_list(text, text, text, bigint, text) to urc_web';
    execute 'grant execute on function public.urc_user_upsert(text, jsonb, text, text, bigint, text) to urc_web';
    execute 'grant execute on function public.urc_user_delete(text, text[], text, text, bigint, text) to urc_web';
  end if;
end $$;

-- ── 6. Post-conditions: fail the migration rather than ship a weaker shape ──
do $$
declare
  t text;
  leaked text;
begin
  foreach t in array array[
    'urc_user_projects', 'urc_user_saved_searches', 'urc_user_alerts',
    'urc_user_peer_sets', 'urc_user_memo_items', 'urc_user_annotations',
    'urc_user_research_tabs', 'urc_user_watchlist', 'urc_user_checklists',
    'urc_user_signing_key'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception 'user research objects: % must have forced row-level security', t;
    end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || t, 'select')
       or pg_catalog.has_table_privilege('anon', 'public.' || t, 'insert')
       or pg_catalog.has_table_privilege('anon', 'public.' || t, 'update')
       or pg_catalog.has_table_privilege('anon', 'public.' || t, 'delete')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'select')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'insert')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'update')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || t, 'delete') then
      raise exception 'user research objects: a generic web role holds a privilege on %', t;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
       and (
         pg_catalog.has_table_privilege('urc_web', 'public.' || t, 'select')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || t, 'insert')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || t, 'update')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || t, 'delete')
       ) then
      raise exception 'user research objects: urc_web holds a privilege on %', t;
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'urc_user_writer'
      and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)
  ) then
    raise exception 'user research objects: urc_user_writer must be a NOLOGIN role without elevated attributes';
  end if;
  if pg_catalog.has_schema_privilege('urc_user_writer', 'public', 'create') then
    raise exception 'user research objects: urc_user_writer must not hold CREATE on public';
  end if;
  if not pg_catalog.has_function_privilege('urc_user_writer', 'extensions.hmac(bytea,bytea,text)', 'execute') then
    raise exception 'user research objects: urc_user_writer cannot execute extensions.hmac';
  end if;

  select string_agg(c.relname, ', ') into leaked
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname like 'urc\_%' escape '\'
    and c.relname not like 'urc\_user\_%' escape '\'
    and c.relkind in ('r', 'p', 'v', 'm')
    and (
      pg_catalog.has_table_privilege('urc_user_writer', c.oid, 'select')
      or pg_catalog.has_table_privilege('urc_user_writer', c.oid, 'insert')
      or pg_catalog.has_table_privilege('urc_user_writer', c.oid, 'update')
      or pg_catalog.has_table_privilege('urc_user_writer', c.oid, 'delete')
    );
  if leaked is not null then
    raise exception 'user research objects: urc_user_writer reaches non-user relations: %', leaked;
  end if;

  if pg_catalog.has_function_privilege('anon', 'public.urc_user_assume(text, text, text, text, bigint, text)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.urc_user_kind(text)', 'execute') then
    raise exception 'user research objects: private helpers must not be executable by anon';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_roles r on r.oid = p.proowner
    where n.nspname = 'public' and p.proname = 'urc_user_upsert'
      and p.prosecdef and r.rolname = 'urc_user_writer'
  ) then
    raise exception 'user research objects: urc_user_upsert must be SECURITY DEFINER owned by urc_user_writer';
  end if;
end $$;

notify pgrst, 'reload schema';

-- BEGIN URC PROVENANCE STAMP
-- Generated by: node scripts/schema-provenance.mjs
insert into public.urc_schema_version (
  singleton, version, migration_count, chain_checksum, checksum_algorithm
) values (
  true,
  '026',
  28,
  -- URC CHAIN CHECKSUM VALUE
  'b8c3c32931be7aaf2fc0f6cd173d0e7292cb687c6b223e231bc888416e0307c2',
  'sha256-v2'
)
on conflict (singleton) do update set
  version = excluded.version,
  migration_count = excluded.migration_count,
  chain_checksum = excluded.chain_checksum,
  checksum_algorithm = excluded.checksum_algorithm,
  applied_at = now();
