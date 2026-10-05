-- grant-audit.sql: effective privileges of the five roles that matter on every
-- urc_* object after the whole migration chain, each compared to what the
-- migrations' own comments claim. Read-only; run as the migration owner or a
-- superuser against a database the chain has been applied to.
--
-- Output (tab-separated, no header): role  kind  object  privileges  verdict
--   verdict OK                 held privileges are within the documented contract
--   verdict NOTE: <why>        wider than the migration's own grant, but inherited
--                              from the platform and recorded in the operations doc
--   verdict FLAG: <why>        wider than any migration claims; the dry run fails
-- Only rows where the role holds something are printed ("list every
-- privilege held"), so an absent row means the role holds nothing there.
--
-- "Effective" means has_*_privilege(): direct grants, PUBLIC grants and
-- inherited role memberships all count, which is what a request running as
-- that role can actually do.
--
-- The contract, from the migrations:
--   014  anon and urc_web: SELECT on every public-data urc_* relation and
--        EXECUTE on the read RPCs; no write path of any kind.
--   023  authenticated: nothing on any urc_* relation or function.
--   026  urc_user_writer: CRUD on urc_user_* and SELECT on urc_user_signing_key
--        only; the web roles and service_role hold nothing on the signing key;
--        urc_user_assume/urc_user_kind are executable by urc_user_writer only;
--        anon/urc_web may call the three signed RPCs (urc_user_list/upsert/
--        delete) but touch no urc_user_* table.
--   029  urc_user_alert_hits: urc_user_writer SELECT plus UPDATE (seen_at) only;
--        service_role CRUD; the evaluator functions (urc_alert_eval_*) and the two
--        owner functions per the 026 pattern (anon/urc_web/service_role may call the
--        signed owner functions; only service_role the evaluator).
--   028  job tables and urc_search_job_* functions: service_role and
--        urc_user_writer only; every web identity denied.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'

with audited_roles(role) as (
  select r.rolname
  from pg_catalog.pg_roles r
  where r.rolname in ('anon', 'authenticated', 'urc_web', 'urc_user_writer', 'service_role')
),
rels as (
  select c.oid, c.relname, c.relkind,
    case
      when c.relname = 'urc_user_signing_key' then 'signing_key'
      when c.relname like 'urc\_user\_%' escape '\' then 'user'
      when c.relname like 'urc\_search\_job%' escape '\' then 'job'
      else 'public_data'
    end as category
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname like 'urc\_%' escape '\'
    and c.relkind in ('r', 'p', 'v', 'm', 'S')
),
rel_held as (
  select a.role, r.relname, r.relkind, r.category,
    case when r.relkind = 'S' then
      array_remove(array[
        case when pg_catalog.has_sequence_privilege(a.role, r.oid, 'usage')  then 'usage'  end,
        case when pg_catalog.has_sequence_privilege(a.role, r.oid, 'select') then 'select' end,
        case when pg_catalog.has_sequence_privilege(a.role, r.oid, 'update') then 'update' end
      ], null)
    else
      array_remove(array[
        case when pg_catalog.has_table_privilege(a.role, r.oid, 'select')     then 'select'     end,
        case when pg_catalog.has_table_privilege(a.role, r.oid, 'insert')     then 'insert'     end,
        case when pg_catalog.has_table_privilege(a.role, r.oid, 'update')     then 'update'     end,
        case when pg_catalog.has_table_privilege(a.role, r.oid, 'delete')     then 'delete'     end,
        case when pg_catalog.has_table_privilege(a.role, r.oid, 'truncate')   then 'truncate'   end,
        case when pg_catalog.has_table_privilege(a.role, r.oid, 'references') then 'references' end,
        case when pg_catalog.has_table_privilege(a.role, r.oid, 'trigger')    then 'trigger'    end
      ], null)
    end as held
  from audited_roles a cross join rels r
),
rel_rows as (
  select h.role,
    case h.relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view'
      when 'm' then 'matview' else 'sequence' end as kind,
    h.relname as object,
    h.held,
    case
      -- Sequences are not granted to anyone by the chain.
      when h.relkind = 'S' then array[]::text[]
      when h.role in ('anon', 'urc_web') and h.category = 'public_data' then array['select']
      when h.role in ('anon', 'urc_web', 'authenticated') then array[]::text[]
      -- 029: the owner functions may read hits and (column-level) mark them seen; nothing else.
      when h.role = 'urc_user_writer' and h.relname = 'urc_user_alert_hits' then array['select']
      when h.role = 'urc_user_writer' and h.category in ('user', 'job') then array['select', 'insert', 'update', 'delete']
      when h.role = 'urc_user_writer' and h.category = 'signing_key' then array['select']
      when h.role = 'urc_user_writer' then array[]::text[]
      when h.role = 'service_role' and h.category = 'signing_key' then array[]::text[]
      when h.role = 'service_role' then array['select', 'insert', 'update', 'delete']
      else array[]::text[]
    end as allowed
  from rel_held h
),
rel_verdict as (
  select role, kind, object, held,
    array(select p from unnest(held) p where p <> all(allowed) order by p) as extra
  from rel_rows
),
funcs as (
  select p.oid, p.proname, p.oid::regprocedure::text as sig
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'urc\_%' escape '\'
),
func_rows as (
  select a.role, f.sig as object,
    pg_catalog.has_function_privilege(a.role, f.oid, 'execute') as can_execute,
    case
      when a.role = 'authenticated' then false
      when a.role in ('anon', 'urc_web') then f.proname in (
        'urc_search_filings', 'urc_search_letters', 'urc_recent_threads', 'urc_thread_detail',
        'urc_data_stats', 'urc_filing_scope_stats', 'urc_schema_version', 'urc_schema_provenance',
        'urc_resolve_filing_auditors', 'urc_user_list', 'urc_user_upsert', 'urc_user_delete',
        'urc_user_alert_hits_page', 'urc_user_alert_hits_mark_seen')
      when a.role = 'urc_user_writer' then f.proname in (
        'urc_user_kind', 'urc_user_assume', 'urc_user_list', 'urc_user_upsert', 'urc_user_delete',
        'urc_user_alert_hits_page', 'urc_user_alert_hits_mark_seen')
        or f.proname like 'urc\_search\_job\_%' escape '\'
      when a.role = 'service_role' then f.proname not in ('urc_user_kind', 'urc_user_assume')
      else false
    end as allowed
  from audited_roles a cross join funcs f
),
schema_rows as (
  select a.role, 'schema' as kind, 'public' as object,
    array_remove(array[
      case when pg_catalog.has_schema_privilege(a.role, 'public', 'usage')  then 'usage'  end,
      case when pg_catalog.has_schema_privilege(a.role, 'public', 'create') then 'create' end
    ], null) as held,
    array['usage']::text[] as allowed
  from audited_roles a
),
column_rows as (
  select g.role, 'column' as kind, g.object, g.held, array[]::text[] as allowed
  from (
    select pg_catalog.pg_get_userbyid(x.grantee) as role,
      c.relname || '.' || a.attname as object,
      array[x.privilege_type::text] as held
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(a.attacl) x
    where n.nspname = 'public' and c.relname like 'urc\_%' escape '\'
      and a.attacl is not null and not a.attisdropped
  ) g
  where g.role in (select role from audited_roles)
),
member_rows as (
  select pg_catalog.pg_get_userbyid(m.member) as role, 'membership' as kind,
    'member of ' || pg_catalog.pg_get_userbyid(m.roleid) as object,
    array['member']::text[] as held,
    case
      when pg_catalog.pg_get_userbyid(m.member) = 'authenticator' then array['member']::text[]
      when exists (select 1 from pg_catalog.pg_roles mr where mr.oid = m.member and mr.rolsuper) then array['member']::text[]
      -- The migration owner (owner of the schema-version registry) is a member
      -- of the roles it creates or administers: 026 does `grant urc_user_writer
      -- to current_user` so it can hand function ownership to the role, and
      -- Supabase's postgres is a member of anon/authenticated/service_role.
      when m.member = (select c.relowner from pg_catalog.pg_class c
                       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relname = 'urc_schema_version') then array['member']::text[]
      else array[]::text[]
    end as allowed
  from pg_catalog.pg_auth_members m
  where pg_catalog.pg_get_userbyid(m.roleid) in (select role from audited_roles)
     or pg_catalog.pg_get_userbyid(m.member) in (select role from audited_roles)
),
attr_rows as (
  select r.rolname as role, 'role-attribute' as kind, 'attributes' as object,
    array_remove(array[
      case when r.rolsuper then 'superuser' end,
      case when r.rolcreaterole then 'createrole' end,
      case when r.rolcreatedb then 'createdb' end,
      case when r.rolbypassrls then 'bypassrls' end,
      case when r.rolcanlogin then 'login' end,
      case when r.rolreplication then 'replication' end
    ], null) as held,
    case when r.rolname = 'service_role' then array['bypassrls']::text[] else array[]::text[] end as allowed
  from pg_catalog.pg_roles r
  where r.rolname in (select role from audited_roles)
),
all_rows as (
  select role, kind, object, array_to_string(held, ',') as privileges,
    case
      when cardinality(extra) = 0 then 'OK'
      when role = 'service_role' and extra <@ array['truncate', 'references', 'trigger']
        then 'NOTE: service_role also holds ' || array_to_string(extra, ',')
          || ' - the Supabase default ACL grants service_role ALL; the migration granted CRUD'
      else 'FLAG: wider than the migrations grant (' || array_to_string(extra, ',') || ')'
    end as verdict
  from rel_verdict
  where cardinality(held) > 0
  union all
  select role, 'function', object, 'execute',
    case when allowed then 'OK' else 'FLAG: EXECUTE not granted by any migration to this role' end
  from func_rows where can_execute
  union all
  select role, kind, object, array_to_string(held, ','),
    case when held <@ allowed then 'OK'
      else 'FLAG: wider than the migrations grant (' ||
        array_to_string(array(select p from unnest(held) p where p <> all(allowed)), ',') || ')' end
  from schema_rows where cardinality(held) > 0
  union all
  select role, kind, object, array_to_string(held, ','),
    case when role = 'urc_user_writer' and object = 'urc_user_alert_hits.seen_at' and held = array['UPDATE']
      then 'OK' else 'FLAG: column-level privilege (only 029 grants one: urc_user_writer UPDATE on urc_user_alert_hits.seen_at)' end
  from column_rows
  union all
  select role, kind, object, array_to_string(held, ','),
    case when held <@ allowed then 'OK' else 'FLAG: role membership no migration grants' end
  from member_rows
  union all
  select role, kind, object, array_to_string(held, ','),
    case when held <@ allowed then 'OK'
      else 'FLAG: elevated or login attribute (' ||
        array_to_string(array(select p from unnest(held) p where p <> all(allowed)), ',') || ')' end
  from attr_rows where cardinality(held) > 0
)
select role, kind, object, privileges, verdict
from all_rows
order by role, kind, object;
