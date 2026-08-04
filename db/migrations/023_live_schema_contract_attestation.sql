-- 023_live_schema_contract_attestation.sql
--
-- A repository checksum stored by the database is a declaration, not proof
-- that every preceding migration actually produced its intended live state.
-- This head migration therefore refuses to stamp unless independently
-- observable structural, security, and function-semantic contracts from the
-- prior chain are present. It also exposes raw, ordered pg_catalog evidence
-- through a service-role-only RPC. Protected-main release code evaluates that
-- evidence independently of /api/version.
--
-- LIMITATION: this attests the enumerated live contracts, not byte-for-byte
-- historical execution. It does not prove corpus completeness, freshness,
-- planner choice, or latency; the accuracy/performance suites remain separate.
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent. Apply AFTER 022.

-- ── 0. Require the known parent declaration before making any change ──────
do $$
declare
  v text;
  n integer;
  checksum text;
  algorithm text;
  registry_owner name;
begin
  select r.rolname
    into registry_owner
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    join pg_catalog.pg_roles r on r.oid = c.relowner
    where ns.nspname = 'public' and c.relname = 'urc_schema_version';
  if registry_owner is null or current_user <> registry_owner then
    raise exception 'schema contract: migration must run as registry owner %, current user is %',
      coalesce(registry_owner, 'NULL'), current_user;
  end if;

  select version, migration_count, chain_checksum, checksum_algorithm
    into v, n, checksum, algorithm
    from public.urc_schema_version where singleton;

  if v = '021' then
    if n <> 23
       or checksum <> '4f83f9f24b7b4fe533bced46405f7956c4992c116470778825e5d5ad333d4db8'
       or algorithm <> 'sha256-v2' then
      raise exception 'schema contract: parent 021 declaration is not the expected immutable parent';
    end if;
  elsif v = '023' then
    -- Idempotent reapply: every live check below still runs. Validate shape,
    -- then restamp the exact repository checksum at the end.
    if n <> 25 or checksum !~ '^[0-9a-f]{64}$' or algorithm <> 'sha256-v2' then
      raise exception 'schema contract: existing 023 declaration is malformed';
    end if;
  else
    raise exception 'schema contract: expected parent 021 or idempotent head 023, found %', coalesce(v, 'NULL');
  end if;
end $$;

-- Filing text cached before the raw SEC response guard existed cannot be
-- distinguished from a padded HTTP-200 throttle page by inspecting extracted
-- text alone. Keep existing rows unversioned so the application refetches each
-- one once; only bytes that passed the bounded raw-response guard are written
-- with version 1. This avoids both trusting legacy poison and repeatedly
-- purging a legitimate long filing that merely quotes an SEC notice.
alter table public.urc_filing_text
  add column if not exists source_validation_version smallint;

do $$ begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'urc_filing_text'
        and c.conname = 'urc_filing_text_source_validation_version_check'
  ) then
    alter table public.urc_filing_text
      add constraint urc_filing_text_source_validation_version_check
      check (source_validation_version is null or source_validation_version = 1);
  end if;
end $$;

-- 013 replaced this SQL function after 010 pinned the prior overload. Repair
-- the forward-only chain before attesting the complete function contract.
alter function public.urc_filing_scope_stats(text[], date, date, bigint)
  set search_path = pg_catalog, public;

-- The role-level 20s budget in 015 is the public request ceiling. Migration
-- 005 left a hoisted 60s function override on this read RPC; remove it so the
-- role budget cannot be widened by calling one particular endpoint.
alter function public.urc_recent_threads(integer, integer, text, bigint)
  reset statement_timeout;

-- Per-schema defaults can only add to PostgreSQL's global defaults; they
-- cannot remove the hard-wired PUBLIC EXECUTE on new functions. Earlier
-- `IN SCHEMA public REVOKE` statements therefore did not close that default.
-- Repair the migration owner's global defaults, including the optional web
-- role that this chain provisions in 010.
alter default privileges revoke all on tables
  from public, anon, authenticated, urc_web;
alter default privileges revoke all on sequences
  from public, anon, authenticated, urc_web;
alter default privileges revoke execute on functions
  from public, anon, authenticated, urc_web;

-- ── 1. Required relation kinds and RLS boundaries ──────────────────────────
do $$
declare missing text[];
begin
  select array_agg(required.name order by required.name)
    into missing
  from (values
    ('urc_sec_filings', 'r'::"char"),
    ('urc_sec_auditors', 'r'::"char"),
    ('urc_sec_companies', 'r'::"char"),
    ('urc_comment_letters', 'r'::"char"),
    ('urc_filing_text', 'r'::"char"),
    ('urc_thread_summaries', 'r'::"char"),
    ('urc_schema_version', 'r'::"char"),
    ('urc_current_auditors', 'v'::"char"),
    ('urc_current_auditors_mat', 'm'::"char"),
    ('urc_filing_year_form', 'm'::"char"),
    ('urc_auditor_periods_mat', 'm'::"char")
  ) as required(name, kind)
  left join (
    select c.relname as name, c.relkind as kind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ) as actual using (name)
  where actual.name is null or actual.kind <> required.kind;

  if missing is not null then
    raise exception 'schema contract: missing/wrong relation(s): %', array_to_string(missing, ', ');
  end if;

  select array_agg(c.relname order by c.relname)
    into missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'urc_sec_filings', 'urc_sec_auditors', 'urc_sec_companies',
      'urc_comment_letters', 'urc_filing_text', 'urc_thread_summaries',
      'urc_schema_version'
    ])
    and not c.relrowsecurity;

  if missing is not null then
    raise exception 'schema contract: RLS disabled on: %', array_to_string(missing, ', ');
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'urc_current_auditors_mat', 'urc_filing_year_form',
        'urc_auditor_periods_mat'
      )
      and not c.relispopulated
  ) then
    raise exception 'schema contract: a required materialized view is not populated';
  end if;
end $$;

-- ── 2. Columns that distinguish the forward fixes from partial history ─────
do $$
declare missing text[];
begin
  select array_agg(required.relation || '.' || required.column_name order by 1)
    into missing
  from (values
    ('urc_sec_filings', 'root_form'),
    ('urc_sec_filings', 'date_filed'),
    ('urc_sec_auditors', 'audit_report_date'),
    ('urc_sec_auditors', 'audit_report_type'),
    ('urc_sec_auditors', 'audit_fund_series'),
    ('urc_comment_letters', 'fts'),
    ('urc_comment_letters', 'review_key'),
    ('urc_comment_letters', 'identifier_checked_at'),
    ('urc_comment_letters', 'content_next_retry_at'),
    ('urc_filing_text', 'fetched_at'),
    ('urc_filing_text', 'source_validation_version'),
    ('urc_thread_summaries', 'input_coverage'),
    ('urc_schema_version', 'migration_count'),
    ('urc_schema_version', 'chain_checksum'),
    ('urc_schema_version', 'checksum_algorithm'),
    ('urc_auditor_periods_mat', 'effective_from'),
    ('urc_auditor_periods_mat', 'effective_to'),
    ('urc_auditor_periods_mat', 'form_filing_ids'),
    ('urc_auditor_periods_mat', 'auditor_candidates'),
    ('urc_auditor_periods_mat', 'audit_report_types'),
    ('urc_auditor_periods_mat', 'resolution_status')
  ) as required(relation, column_name)
  left join (
    select c.relname as relation, a.attname as column_name
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
  ) as actual using (relation, column_name)
  where actual.column_name is null;

  if missing is not null then
    raise exception 'schema contract: missing column(s): %', array_to_string(missing, ', ');
  end if;
end $$;

-- ── 3. Required valid indexes ───────────────────────────────────────────────
do $$
declare
  required record;
  actual_relation text;
  is_valid boolean;
  is_ready boolean;
  is_unique boolean;
  definition text;
  fragment text;
begin
  for required in
    select * from (values
      ('urc_sec_filings_form_date_idx', 'urc_sec_filings', false, array['root_form', 'date_filed desc']::text[]),
      ('urc_sec_filings_cik_date_idx', 'urc_sec_filings', false, array['cik', 'date_filed desc']::text[]),
      ('urc_sec_filings_date_accession_idx', 'urc_sec_filings', false, array['date_filed desc', 'accession']::text[]),
      ('urc_letters_fts_idx', 'urc_comment_letters', false, array['using gin', 'fts']::text[]),
      ('urc_current_auditors_mat_pk', 'urc_current_auditors_mat', true, array['issuer_cik']::text[]),
      ('urc_filing_year_form_pk', 'urc_filing_year_form', true, array['year', 'root_form']::text[]),
      ('urc_sec_auditors_temporal_idx', 'urc_sec_auditors', false, array['issuer_cik', 'audit_report_date', 'is_latest']::text[]),
      ('urc_auditor_periods_mat_pk', 'urc_auditor_periods_mat', true, array['issuer_cik', 'effective_from']::text[]),
      ('urc_auditor_periods_mat_firm_idx', 'urc_auditor_periods_mat', false, array['firm_canonical', 'effective_from', 'effective_to', 'resolution_status = ''resolved''']::text[])
    ) as contract(name, relation_name, unique_required, fragments)
  loop
    select t.relname, x.indisvalid, x.indisready, x.indisunique,
           lower(pg_catalog.pg_get_indexdef(i.oid))
      into actual_relation, is_valid, is_ready, is_unique, definition
    from pg_catalog.pg_index x
    join pg_catalog.pg_class i on i.oid = x.indexrelid
    join pg_catalog.pg_class t on t.oid = x.indrelid
    join pg_catalog.pg_namespace n on n.oid = i.relnamespace
    where n.nspname = 'public' and i.relname = required.name;

    if actual_relation is distinct from required.relation_name
       or is_valid is distinct from true
       or is_ready is distinct from true
       or (required.unique_required and is_unique is distinct from true) then
      raise exception 'schema contract: missing/invalid/wrong-relation index %', required.name;
    end if;
    foreach fragment in array required.fragments loop
      if position(fragment in definition) = 0 then
        raise exception 'schema contract: index % lacks required fragment %', required.name, fragment;
      end if;
    end loop;
  end loop;
end $$;

-- ── 4. Function signatures and semantic forward-fix markers ────────────────
do $$
declare
  missing text[];
  definition text;
  view_definition text;
  required record;
  function_config text[];
  is_security_definer boolean;
begin
  select array_agg(candidate.signature order by candidate.signature)
    into missing
  from unnest(array[
    'public.urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)',
    'public.urc_search_letters(text,text,date,date,integer,integer,text)',
    'public.urc_resolve_filing_auditors(jsonb)',
    'public.urc_recent_threads(integer,integer,text,bigint)',
    'public.urc_thread_detail(text)',
    'public.urc_data_stats()',
    'public.urc_filing_scope_stats(text[],date,date,bigint)',
    'public.urc_schema_version()',
    'public.urc_schema_provenance()',
    'public.urc_refresh_current_auditors()',
    'public.urc_refresh_auditor_periods()',
    'public.urc_companies_needing_sic(integer)',
    'public.urc_thread_letters()'
  ]) as candidate(signature)
  where pg_catalog.to_regprocedure(candidate.signature) is null;

  if missing is not null then
    raise exception 'schema contract: missing function(s): %', array_to_string(missing, ', ');
  end if;

  for required in
    select * from (values
      ('public.urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)', 'search_path=pg_catalog, public', false, true),
      ('public.urc_search_letters(text,text,date,date,integer,integer,text)', 'search_path=pg_catalog, public', false, true),
      ('public.urc_resolve_filing_auditors(jsonb)', 'search_path=pg_catalog, public', false, true),
      ('public.urc_recent_threads(integer,integer,text,bigint)', 'search_path=pg_catalog, public', false, true),
      ('public.urc_thread_detail(text)', 'search_path=pg_catalog, public', false, true),
      ('public.urc_data_stats()', 'search_path=pg_catalog, public', false, true),
      ('public.urc_filing_scope_stats(text[],date,date,bigint)', 'search_path=pg_catalog, public', false, true),
      ('public.urc_schema_version()', 'search_path=pg_catalog, public', false, true),
      ('public.urc_schema_provenance()', 'search_path=pg_catalog, public', false, true),
      ('public.urc_refresh_current_auditors()', 'search_path=pg_catalog', true, false),
      ('public.urc_refresh_auditor_periods()', 'search_path=pg_catalog', true, false),
      ('public.urc_companies_needing_sic(integer)', 'search_path=pg_catalog, public', false, false),
      ('public.urc_thread_letters()', 'search_path=pg_catalog, public', false, false)
    ) as contract(signature, required_config, security_definer, anon_read)
  loop
    select p.proconfig, p.prosecdef
      into function_config, is_security_definer
      from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure(required.signature);
    if not coalesce(function_config, array[]::text[]) @> array[required.required_config]
       or is_security_definer is distinct from required.security_definer then
      raise exception 'schema contract: unsafe function configuration on %', required.signature;
    end if;
    if required.anon_read and exists (
      select 1 from unnest(coalesce(function_config, array[]::text[])) setting
      where setting like 'statement_timeout=%'
    ) then
      raise exception 'schema contract: public read RPC overrides the role timeout on %', required.signature;
    end if;
  end loop;

  select lower(pg_catalog.pg_get_functiondef(
    'public.urc_search_letters(text,text,date,date,integer,integer,text)'::regprocedure
  )) into definition;
  if position('order by l.date_filed desc, l.accession, l.cik' in definition) = 0
     or position('limit 10001' in definition) = 0
     or position('limit 1000' in definition) = 0
     or position('least(greatest(p_limit, 1), 100)' in definition) = 0
     or position('least(greatest(p_offset, 0), 1000)' in definition) = 0 then
    raise exception 'schema contract: deterministic/bounded letter search is absent';
  end if;

  select lower(pg_catalog.pg_get_functiondef(
    'public.urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)'::regprocedure
  )) into definition;
  if position('public.urc_auditor_periods_mat' in definition) = 0
     or position('f.date_filed >= a.effective_from' in definition) = 0
     or position('f.date_filed < a.effective_to' in definition) = 0
     or position('a.resolution_status = ''resolved''' in definition) = 0
     or position('f.root_form = any($1)' in definition) = 0
     or position('least(greatest(coalesce(p_limit, 20), 1), 100)' in definition) = 0 then
    raise exception 'schema contract: temporal/index-shaped filing search is absent';
  end if;

  select lower(pg_catalog.pg_get_functiondef(
    'public.urc_resolve_filing_auditors(jsonb)'::regprocedure
  )) into definition;
  if position('jsonb_array_length(p_filings) > 5000' in definition) = 0
     or position('r.file_date >= a.effective_from' in definition) = 0
     or position('r.file_date < a.effective_to' in definition) = 0
     or position('no_prior_form_ap_report' in definition) = 0
     or position('latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date' in definition) = 0 then
    raise exception 'schema contract: bounded temporal auditor resolver is absent';
  end if;

  select lower(pg_catalog.pg_get_viewdef('public.urc_auditor_periods_mat'::regclass, true))
    into view_definition;
  if position('lead(' in view_definition) = 0
     or position('resolution_status' in view_definition) = 0
     or position('coverage_pending' in view_definition) = 0
     or position('unsupported_entity_scope' in view_definition) = 0
     or position('ambiguous' in view_definition) = 0
     or position('issuer, other than employee benefit plan or investment company' in view_definition) = 0 then
    raise exception 'schema contract: evidence-scoped auditor intervals are absent';
  end if;

  select lower(pg_catalog.pg_get_viewdef('public.urc_current_auditors'::regclass, true))
    into view_definition;
  if position('urc_auditor_periods_mat' in view_definition) = 0
     or position('effective_to is null' in view_definition) = 0
     or position('resolution_status = ''resolved''' in view_definition) = 0 then
    raise exception 'schema contract: current-auditor view does not use resolved temporal evidence';
  end if;
end $$;

-- ── 5. Least privilege and role-level work budget ──────────────────────────
do $$
declare
  relation_name text;
  function_signature text;
  catalog_function record;
begin
  foreach relation_name in array array[
    'urc_sec_filings', 'urc_sec_auditors', 'urc_sec_companies',
    'urc_comment_letters', 'urc_filing_text', 'urc_thread_summaries',
    'urc_schema_version', 'urc_current_auditors',
    'urc_current_auditors_mat', 'urc_filing_year_form',
    'urc_auditor_periods_mat'
  ] loop
    if not pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'select') then
      raise exception 'schema contract: anon cannot SELECT %', relation_name;
    end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'insert')
       or pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'update')
       or pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'delete') then
      raise exception 'schema contract: anon retains a write privilege on %', relation_name;
    end if;
    if pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'insert')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'update')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'delete') then
      raise exception 'schema contract: authenticated retains a write privilege on %', relation_name;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
       and (
         not pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'select')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'insert')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'update')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'delete')
       ) then
      raise exception 'schema contract: urc_web relation privilege is wrong on %', relation_name;
    end if;
  end loop;

  -- Do not limit mutation checks to the required application surface. Any
  -- out-of-band urc_* relation is evidence too, and web-role writes on one
  -- are a contract violation even when its name is not in the allowlist.
  for relation_name in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'urc\_%' escape '\'
      and c.relkind in ('r', 'p', 'v', 'm')
  loop
    if pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'select') then
      raise exception 'schema contract: authenticated can SELECT inventoried relation %', relation_name;
    end if;
    if relation_name <> all(array[
         'urc_sec_filings', 'urc_sec_auditors', 'urc_sec_companies',
         'urc_comment_letters', 'urc_filing_text', 'urc_thread_summaries',
         'urc_schema_version', 'urc_current_auditors',
         'urc_current_auditors_mat', 'urc_filing_year_form',
         'urc_auditor_periods_mat'
       ])
       and (
         pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'select')
         or (
           exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
           and pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'select')
         )
       ) then
      raise exception 'schema contract: unexpected relation is web-readable: %', relation_name;
    end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'insert')
       or pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'update')
       or pg_catalog.has_table_privilege('anon', 'public.' || relation_name, 'delete')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'insert')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'update')
       or pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'delete') then
      raise exception 'schema contract: a generic web role retains a write privilege on %', relation_name;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
       and (
         pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'insert')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'update')
         or pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'delete')
       ) then
      raise exception 'schema contract: urc_web retains a write privilege on %', relation_name;
    end if;
  end loop;

  foreach relation_name in array array[
    'urc_sec_filings', 'urc_sec_auditors', 'urc_sec_companies',
    'urc_comment_letters', 'urc_filing_text', 'urc_thread_summaries',
    'urc_schema_version'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename = relation_name
        and lower(p.permissive) = 'permissive'
        and lower(p.cmd) in ('select', 'all')
        and ('anon' = any(p.roles) or 'public' = any(p.roles))
        and btrim(lower(coalesce(p.qual, '')), '() ') = 'true'
    ) then
      raise exception 'schema contract: unconditional anon SELECT policy is absent on %', relation_name;
    end if;
  end loop;

  if not pg_catalog.has_schema_privilege('anon', 'public', 'usage')
     or pg_catalog.has_schema_privilege('anon', 'public', 'create')
     or pg_catalog.has_schema_privilege('authenticated', 'public', 'create')
     or not pg_catalog.has_schema_privilege('service_role', 'public', 'usage') then
    raise exception 'schema contract: public schema privileges violate the web/service boundary';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
     and (
       not pg_catalog.has_schema_privilege('urc_web', 'public', 'usage')
       or pg_catalog.has_schema_privilege('urc_web', 'public', 'create')
     ) then
    raise exception 'schema contract: urc_web public-schema privileges are wrong';
  end if;

  -- Evaluate the effective defaults for the role that owns the registry (the
  -- migration owner), falling back to PostgreSQL's built-in defaults when no
  -- pg_default_acl override exists. In particular, a missing function override
  -- would restore implicit PUBLIC EXECUTE and must fail closed.
  if exists (
    with object_owner as (
      select c.relowner as owner_oid
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'urc_schema_version'
    ), object_kind(object_type, acl_default_type) as (
      values
        ('r'::"char", 'r'::"char"),
        ('S'::"char", 's'::"char"),
        ('f'::"char", 'f'::"char")
    ), effective_default as (
      select acl.grantee
      from object_owner o
      cross join object_kind k
      left join pg_catalog.pg_default_acl d
        on d.defaclrole = o.owner_oid
       and d.defaclnamespace = 0
       and d.defaclobjtype = k.object_type
      cross join lateral pg_catalog.aclexplode(
        coalesce(d.defaclacl, pg_catalog.acldefault(k.acl_default_type, o.owner_oid))
      ) acl

      union all

      select acl.grantee
      from object_owner o
      cross join object_kind k
      join pg_catalog.pg_default_acl d
        on d.defaclrole = o.owner_oid
       and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = k.object_type
      cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
    )
    select 1
    from effective_default acl
    left join pg_catalog.pg_roles r on r.oid = acl.grantee
    where acl.grantee = 0
       or r.rolname in ('anon', 'authenticated', 'urc_web')
  ) then
    raise exception 'schema contract: future URC objects have a web/public default privilege';
  end if;

  foreach function_signature in array array[
    'public.urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)',
    'public.urc_search_letters(text,text,date,date,integer,integer,text)',
    'public.urc_resolve_filing_auditors(jsonb)',
    'public.urc_recent_threads(integer,integer,text,bigint)',
    'public.urc_thread_detail(text)',
    'public.urc_data_stats()',
    'public.urc_filing_scope_stats(text[],date,date,bigint)',
    'public.urc_schema_version()',
    'public.urc_schema_provenance()'
  ] loop
    if not pg_catalog.has_function_privilege('anon', function_signature, 'execute')
       or not pg_catalog.has_function_privilege('service_role', function_signature, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_signature, 'execute') then
      raise exception 'schema contract: required read RPC privilege is absent on %', function_signature;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
       and not pg_catalog.has_function_privilege('urc_web', function_signature, 'execute') then
      raise exception 'schema contract: urc_web cannot execute required read RPC %', function_signature;
    end if;
  end loop;

  -- Every inventoried function is deny-by-default. Exact public read RPC
  -- signatures are the only web-executable functions, and the two refresh
  -- functions are the only intentional SECURITY DEFINER routines.
  for catalog_function in
    select
      p.oid,
      p.proname || '(' || replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '') || ')' as function_key,
      p.prosecdef
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'urc\_%' escape '\'
  loop
    if catalog_function.prosecdef
       and catalog_function.function_key <> all(array[
         'urc_refresh_auditor_periods()',
         'urc_refresh_current_auditors()'
       ]) then
      raise exception 'schema contract: unexpected SECURITY DEFINER function %', catalog_function.function_key;
    end if;
    if pg_catalog.has_function_privilege('anon', catalog_function.oid, 'execute')
       and catalog_function.function_key <> all(array[
         'urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)',
         'urc_search_letters(text,text,date,date,integer,integer,text)',
         'urc_resolve_filing_auditors(jsonb)',
         'urc_recent_threads(integer,integer,text,bigint)',
         'urc_thread_detail(text)',
         'urc_data_stats()',
         'urc_filing_scope_stats(text[],date,date,bigint)',
         'urc_schema_version()',
         'urc_schema_provenance()'
       ]) then
      raise exception 'schema contract: anon can execute unexpected function %', catalog_function.function_key;
    end if;
    if pg_catalog.has_function_privilege('authenticated', catalog_function.oid, 'execute') then
      raise exception 'schema contract: authenticated can execute function %', catalog_function.function_key;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
       and pg_catalog.has_function_privilege('urc_web', catalog_function.oid, 'execute')
       and catalog_function.function_key <> all(array[
         'urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)',
         'urc_search_letters(text,text,date,date,integer,integer,text)',
         'urc_resolve_filing_auditors(jsonb)',
         'urc_recent_threads(integer,integer,text,bigint)',
         'urc_thread_detail(text)',
         'urc_data_stats()',
         'urc_filing_scope_stats(text[],date,date,bigint)',
         'urc_schema_version()',
         'urc_schema_provenance()'
       ]) then
      raise exception 'schema contract: urc_web can execute unexpected function %', catalog_function.function_key;
    end if;
  end loop;

  foreach function_signature in array array[
    'public.urc_refresh_auditor_periods()',
    'public.urc_refresh_current_auditors()',
    'public.urc_companies_needing_sic(integer)',
    'public.urc_thread_letters()'
  ] loop
    if pg_catalog.has_function_privilege('anon', function_signature, 'execute')
       or pg_catalog.has_function_privilege('authenticated', function_signature, 'execute')
       or not pg_catalog.has_function_privilege('service_role', function_signature, 'execute') then
      raise exception 'schema contract: maintenance RPC privilege is wrong on %', function_signature;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'urc_web')
       and pg_catalog.has_function_privilege('urc_web', function_signature, 'execute') then
      raise exception 'schema contract: urc_web can execute maintenance RPC %', function_signature;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'anon'
      and coalesce(rolconfig, array[]::text[]) @> array['statement_timeout=20s']
  ) then
    raise exception 'schema contract: anon statement_timeout=20s is absent';
  end if;
end $$;

-- ── 6. Raw live evidence, service-role only ─────────────────────────────────
create or replace function public.urc_schema_contract_evidence() returns jsonb
language sql stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'registry', (
      select jsonb_build_object(
        'version', version,
        'migrationCount', migration_count,
        'chainChecksum', chain_checksum,
        'checksumAlgorithm', checksum_algorithm
      )
      from public.urc_schema_version where singleton
    ),
    'schemas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', n.nspname,
        'roles', (
          select jsonb_agg(jsonb_build_object(
            'name', r.rolname,
            'usage', pg_catalog.has_schema_privilege(r.oid, n.oid, 'usage'),
            'create', pg_catalog.has_schema_privilege(r.oid, n.oid, 'create')
          ) order by r.rolname)
          from pg_catalog.pg_roles r
          where r.rolname in ('anon', 'authenticated', 'urc_web', 'service_role')
        )
      ) order by n.nspname)
      from pg_catalog.pg_namespace n where n.nspname = 'public'
    ), '[]'::jsonb),
    'defaultPrivileges', coalesce((
      with object_owner as (
        select c.relowner as owner_oid
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'urc_schema_version'
      ), object_kind(object_type, acl_default_type) as (
        values
          ('r'::"char", 'r'::"char"),
          ('S'::"char", 's'::"char"),
          ('f'::"char", 'f'::"char")
      ), effective_default as (
        select o.owner_oid, k.object_type,
               acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
        from object_owner o
        cross join object_kind k
        left join pg_catalog.pg_default_acl d
          on d.defaclrole = o.owner_oid
         and d.defaclnamespace = 0
         and d.defaclobjtype = k.object_type
        cross join lateral pg_catalog.aclexplode(
          coalesce(d.defaclacl, pg_catalog.acldefault(k.acl_default_type, o.owner_oid))
        ) acl

        union all

        select o.owner_oid, k.object_type,
               acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
        from object_owner o
        cross join object_kind k
        join pg_catalog.pg_default_acl d
          on d.defaclrole = o.owner_oid
         and d.defaclnamespace = 'public'::regnamespace
         and d.defaclobjtype = k.object_type
        cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
      )
      select jsonb_agg(jsonb_build_object(
        'owner', pg_catalog.pg_get_userbyid(e.owner_oid),
        'objectType', e.object_type,
        'grantee', case when e.grantee = 0 then 'PUBLIC'
          else pg_catalog.pg_get_userbyid(e.grantee) end,
        'privilege', e.privilege_type,
        'grantable', e.is_grantable
      ) order by e.object_type, e.grantee, e.privilege_type)
      from effective_default e
    ), '[]'::jsonb),
    'relations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'kind', c.relkind,
        'rls', c.relrowsecurity,
        'forceRls', c.relforcerowsecurity,
        'populated', c.relispopulated,
        'anonSelect', has_table_privilege('anon', c.oid, 'select'),
        'anonInsert', has_table_privilege('anon', c.oid, 'insert'),
        'anonUpdate', has_table_privilege('anon', c.oid, 'update'),
        'anonDelete', has_table_privilege('anon', c.oid, 'delete'),
        'authenticatedSelect', has_table_privilege('authenticated', c.oid, 'select'),
        'authenticatedInsert', has_table_privilege('authenticated', c.oid, 'insert'),
        'authenticatedUpdate', has_table_privilege('authenticated', c.oid, 'update'),
        'authenticatedDelete', has_table_privilege('authenticated', c.oid, 'delete'),
        'urcWebSelect', has_table_privilege('urc_web', c.oid, 'select'),
        'urcWebInsert', has_table_privilege('urc_web', c.oid, 'insert'),
        'urcWebUpdate', has_table_privilege('urc_web', c.oid, 'update'),
        'urcWebDelete', has_table_privilege('urc_web', c.oid, 'delete')
      ) order by c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname like 'urc\_%' escape '\'
        and c.relkind in ('r', 'p', 'v', 'm')
    ), '[]'::jsonb),
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'relation', c.relname,
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'notNull', a.attnotnull,
        'generated', a.attgenerated
      ) order by c.relname, a.attnum)
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname like 'urc\_%' escape '\'
        and a.attnum > 0 and not a.attisdropped
    ), '[]'::jsonb),
    'views', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'kind', c.relkind,
        'definition', pg_catalog.pg_get_viewdef(c.oid, true)
      ) order by c.relname)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname like 'urc\_%' escape '\'
        and c.relkind in ('v', 'm')
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.relname,
        'relation', t.relname,
        'valid', x.indisvalid,
        'ready', x.indisready,
        'definition', pg_catalog.pg_get_indexdef(i.oid)
      ) order by i.relname)
      from pg_catalog.pg_index x
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      join pg_catalog.pg_class t on t.oid = x.indrelid
      join pg_catalog.pg_namespace n on n.oid = i.relnamespace
      where n.nspname = 'public'
        and (i.relname like 'urc\_%' escape '\' or t.relname like 'urc\_%' escape '\')
    ), '[]'::jsonb),
    'functions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.proname,
        'identityArguments', pg_catalog.oidvectortypes(p.proargtypes),
        'language', l.lanname,
        'volatility', p.provolatile,
        'securityDefiner', p.prosecdef,
        'config', coalesce(to_jsonb(p.proconfig), '[]'::jsonb),
        'anonExecute', pg_catalog.has_function_privilege('anon', p.oid, 'execute'),
        'authenticatedExecute', pg_catalog.has_function_privilege('authenticated', p.oid, 'execute'),
        'urcWebExecute', pg_catalog.has_function_privilege('urc_web', p.oid, 'execute'),
        'serviceExecute', pg_catalog.has_function_privilege('service_role', p.oid, 'execute'),
        'definition', pg_catalog.pg_get_functiondef(p.oid)
      ) order by p.proname, pg_catalog.oidvectortypes(p.proargtypes))
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      join pg_catalog.pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and p.proname like 'urc\_%' escape '\'
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'relation', tablename,
        'name', policyname,
        'permissive', permissive,
        'roles', to_jsonb(roles),
        'command', cmd,
        'qual', qual,
        'withCheck', with_check
      ) order by tablename, policyname)
      from pg_catalog.pg_policies
      where schemaname = 'public' and tablename like 'urc\_%' escape '\'
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', rolname,
        'config', coalesce(to_jsonb(rolconfig), '[]'::jsonb)
      ) order by rolname)
      from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'urc_web', 'service_role')
    ), '[]'::jsonb),
    'extensions', coalesce((
      select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion) order by extname)
      from pg_catalog.pg_extension where extname in ('pg_trgm')
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.urc_schema_contract_evidence()
  from public, anon, authenticated;
grant execute on function public.urc_schema_contract_evidence()
  to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'revoke all on function public.urc_schema_contract_evidence() from urc_web';
  end if;
  if has_function_privilege('anon', 'public.urc_schema_contract_evidence()', 'execute')
     or not has_function_privilege('service_role', 'public.urc_schema_contract_evidence()', 'execute') then
    raise exception 'schema contract: evidence RPC privilege boundary is wrong';
  end if;
end $$;

-- BEGIN URC PROVENANCE STAMP
-- Generated by: node scripts/schema-provenance.mjs
insert into public.urc_schema_version (
  singleton, version, migration_count, chain_checksum, checksum_algorithm
) values (
  true,
  '023',
  25,
  -- URC CHAIN CHECKSUM VALUE
  '0ae43502dee42603a4943157a171e5d513ece45065e80f58768b998765f3cfa7',
  'sha256-v2'
)
on conflict (singleton) do update set
  version = excluded.version,
  migration_count = excluded.migration_count,
  chain_checksum = excluded.chain_checksum,
  checksum_algorithm = excluded.checksum_algorithm,
  applied_at = now();

notify pgrst, 'reload schema';

-- Runtime release evidence:
--   select public.urc_schema_contract_evidence(); -- service_role only
