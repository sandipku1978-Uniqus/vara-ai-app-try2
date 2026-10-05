-- Snapshot every explicit writer ACL, role attribute and membership as sorted text.
-- Assert effective scope too: inherited/PUBLIC privileges cannot hide from the audit.
do $$ declare obj record; privilege_name text; begin
  if (select count(*) from pg_roles where rolname='urc_user_writer')<>1 then raise exception 'writer-role: expected one role'; end if;
  if exists(select from pg_roles where rolname='urc_user_writer' and
    (rolcanlogin or rolinherit or rolsuper or rolcreaterole or rolcreatedb or rolbypassrls)) then raise exception 'writer-role: elevated attributes'; end if;
  if has_schema_privilege('urc_user_writer','public','CREATE') then raise exception 'writer-role: CREATE on public'; end if;
  if exists(select from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='urc_user_writer') then raise exception 'writer-role: member of another role'; end if;
  for obj in select c.oid,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname like 'urc\_%' escape '\'
      and c.relname not like 'urc\_user\_%' escape '\' and c.relname not like 'urc\_search\_job%' escape '\'
      and c.relkind in ('r','p','v','m','S') loop
    if obj.relkind='S' then
      if has_sequence_privilege('urc_user_writer',obj.oid,'USAGE,SELECT,UPDATE') then raise exception 'writer-role: outside sequence %',obj.relname; end if;
    else
      foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege('urc_user_writer',obj.oid,privilege_name) then raise exception 'writer-role: % on outside relation %',privilege_name,obj.relname; end if;
      end loop;
      if has_any_column_privilege('urc_user_writer',obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'writer-role: outside column privilege %',obj.relname; end if;
    end if;
  end loop;
end $$;
with writer as (select oid from pg_roles where rolname='urc_user_writer'), lines as (
  select 'attributes'||E'\t'||rolname||E'\t'||concat_ws(',',rolcanlogin,rolinherit,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolconnlimit) line from pg_roles where rolname='urc_user_writer'
  union all
  select 'relation'||E'\t'||n.nspname||'.'||c.relname||E'\t'||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||E'\t'||a.privilege_type||E'\t'||a.is_grantable||E'\t'||pg_get_userbyid(a.grantor)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a,writer w where w.oid in (a.grantee,a.grantor)
  union all
  select 'column'||E'\t'||n.nspname||'.'||c.relname||'.'||col.attname||E'\t'||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||E'\t'||a.privilege_type||E'\t'||a.is_grantable||E'\t'||pg_get_userbyid(a.grantor)
    from pg_attribute col join pg_class c on c.oid=col.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(col.attacl) a,writer w where w.oid in (a.grantee,a.grantor)
  union all
  select 'function'||E'\t'||n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')'||E'\t'||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||E'\t'||a.privilege_type||E'\t'||a.is_grantable||E'\t'||pg_get_userbyid(a.grantor)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a,writer w where w.oid in (a.grantee,a.grantor)
  union all
  select 'schema'||E'\t'||n.nspname||E'\t'||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||E'\t'||a.privilege_type||E'\t'||a.is_grantable||E'\t'||pg_get_userbyid(a.grantor)
    from pg_namespace n cross join lateral aclexplode(n.nspacl) a,writer w where w.oid in (a.grantee,a.grantor)
  union all
  select 'membership'||E'\t'||pg_get_userbyid(m.roleid)||E'\t'||pg_get_userbyid(m.member)||E'\t'||m.admin_option||','||m.inherit_option||','||m.set_option
    from pg_auth_members m,writer w where w.oid in (m.roleid,m.member)
) select line from lines order by line collate "C";
