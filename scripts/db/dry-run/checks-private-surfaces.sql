-- Prove real permission denials for private tables/functions and restrictive job policies.
-- Connect as disposable superuser so each PostgREST identity can be tested in one rollback.
begin;
set local dryrun.surface = :'surface';
do $$ declare role_name text; relation_name text; fn record; obj record; args text; caught text; begin
  foreach role_name in array array['anon','authenticated','urc_web','service_role'] loop
    if current_setting('dryrun.surface')='p1' then
    for obj in select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'urc\_user\_%' escape '\' loop
      if role_name='service_role' and obj.relname<>'urc_user_signing_key' then continue; end if;
      execute format('set local role %I',role_name);
      caught:=null;
      begin execute format('select * from public.%I limit 1',obj.relname);
      exception when others then get stacked diagnostics caught=returned_sqlstate; end;
      reset role;
      if caught is distinct from '42501' then raise exception 'P1: % SELECT % expected 42501, got %',role_name,obj.relname,coalesce(caught,'success'); end if;
    end loop;
    end if;
    if current_setting('dryrun.surface')='p1' or role_name='service_role' then continue; end if;
    foreach relation_name in array array['urc_search_jobs','urc_search_job_hits'] loop
      execute format('set local role %I',role_name);
      caught:=null;
      begin execute format('select * from public.%I limit 1',relation_name);
      exception when others then get stacked diagnostics caught=returned_sqlstate; end;
      reset role;
      if caught is distinct from '42501' then raise exception 'P8: % SELECT % expected 42501, got %',role_name,relation_name,coalesce(caught,'success'); end if;
      execute format('set local role %I',role_name);
      caught:=null;
      begin execute format('insert into public.%I default values',relation_name);
      exception when others then get stacked diagnostics caught=returned_sqlstate; end;
      reset role;
      if caught is distinct from '42501' then raise exception 'P8: % INSERT % expected 42501, got %',role_name,relation_name,coalesce(caught,'success'); end if;
      if not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=relation_name and c.relrowsecurity) then
        raise exception 'P8: % RLS disabled',relation_name; end if;
      if not exists(select from pg_policies where schemaname='public' and tablename=relation_name
        and permissive='RESTRICTIVE' and cmd='ALL' and role_name::name=any(roles)
        and btrim(qual,'() ')='false' and btrim(with_check,'() ')='false') then
        raise exception 'P8: % lacks restrictive deny for %',relation_name,role_name; end if;
    end loop;
    for fn in select p.oid,p.proname,p.proargtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'urc\_search\_job\_%' escape '\' loop
      select string_agg('null::'||format_type(t,null),',' order by ord) into args
        from unnest(fn.proargtypes::oid[]) with ordinality a(t,ord);
      execute format('set local role %I',role_name);
      caught:=null;
      begin execute format('select public.%I(%s)',fn.proname,args);
      exception when others then get stacked diagnostics caught=returned_sqlstate; end;
      reset role;
      if caught is distinct from '42501' then raise exception 'P8: % executes % (SQLSTATE %)',role_name,fn.oid::regprocedure,coalesce(caught,'success'); end if;
    end loop;
  end loop;
end $$;
rollback;
