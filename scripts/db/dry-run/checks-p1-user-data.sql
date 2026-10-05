-- Prove signed CRUD for all nine kinds, isolation, rejected assertions and private helpers.
-- Run as the migration owner; :assertions is JSON from the real application signer.
\getenv dry_secret DRYRUN_SIGNING_SECRET
insert into public.urc_user_signing_key(singleton,secret) values(true,:'dry_secret')
on conflict(singleton) do update set secret=excluded.secret;
begin;
set local dryrun.assertions = :'assertions';
create function pg_temp.require(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'P1: %',message; end if; end $$;
create function pg_temp.call_rpc(op text, kind text, assertion_name text, items jsonb default '[]', keys text[] default '{}')
returns jsonb language plpgsql as $$
declare a jsonb := current_setting('dryrun.assertions')::jsonb -> assertion_name;
begin
  if a is null then raise exception 'P1: missing assertion %',assertion_name; end if;
  if op='list' then return public.urc_user_list(kind,a->>'p_user_id',a->>'p_org_id',(a->>'p_expires_at')::bigint,a->>'p_signature');
  elsif op='upsert' then return public.urc_user_upsert(kind,items,a->>'p_user_id',a->>'p_org_id',(a->>'p_expires_at')::bigint,a->>'p_signature');
  else return public.urc_user_delete(kind,keys,a->>'p_user_id',a->>'p_org_id',(a->>'p_expires_at')::bigint,a->>'p_signature'); end if;
end $$;
create function pg_temp.reject_call(op text, kind text, assertion_name text, expected_state text, items jsonb default '[]')
returns void language plpgsql as $$
declare caught text;
begin
  begin perform pg_temp.call_rpc(op,kind,assertion_name,items);
  exception when others then get stacked diagnostics caught=returned_sqlstate; end;
  if caught is distinct from expected_state then raise exception 'P1: %/% assertion %: expected SQLSTATE %, got %',op,kind,assertion_name,expected_state,coalesce(caught,'success'); end if;
end $$;
grant execute on function pg_temp.require(boolean,text), pg_temp.call_rpc(text,text,text,jsonb,text[]),
  pg_temp.reject_call(text,text,text,text,jsonb) to anon;
-- A missing key must reject even a correctly signed request. All changes roll back.
delete from public.urc_user_signing_key;
set local role anon;
select pg_temp.reject_call('list','watchlist','a.watchlist.list','28000');
reset role;
insert into public.urc_user_signing_key(singleton,secret) values(true,:'dry_secret');
set local role anon;
do $$
declare
  k text; item jsonb; rows jsonb; written jsonb; id_before text; a jsonb; all_assertions jsonb;
  project_id text; many jsonb;
begin
  foreach k in array array['projects','saved-searches','alerts','peer-sets','memo','annotations','research-tabs','watchlist','checklists'] loop
    item := jsonb_build_object('client_key','dryrun_'||k,'position',1) || case k
      when 'projects' then '{"name":"SEC research","question":"How is fair value measured?"}'::jsonb
      when 'saved-searches' then '{"label":"Segment disclosures","query":"segment","mode":"boolean","filters":{"forms":["10-K"]}}'::jsonb
      when 'alerts' then '{"name":"Weekly segments","query":"segment","mode":"semantic","filters":{},"default_forms":"10-K","cadence":"weekly","enabled":true,"last_hit_count":0,"last_seen_accessions":[],"latest_new_accessions":[]}'::jsonb
      when 'peer-sets' then '{"name":"Technology peers","tickers":["AAPL","MSFT"],"ciks":["320193","789019"]}'::jsonb
      when 'memo' then '{"item_kind":"citation","accession":"0001234567-26-000001","cik":"1234567","payload":{"quote":"Fair value disclosure"}}'::jsonb
      when 'annotations' then '{"filing_key":"1234567_0001234567-26-000001_report.htm","anchor":{"quote":"Fair value"},"note":"Compare the valuation inputs"}'::jsonb
      when 'research-tabs' then '{"title":"Segments","payload":{"query":"segment","filters":{},"results":[]}}'::jsonb
      when 'watchlist' then '{"ticker":"AAPL"}'::jsonb
      when 'checklists' then '{"name":"Disclosure review","items":[{"label":"Check segments","done":false}]}'::jsonb end;
    written := pg_temp.call_rpc('upsert',k,'a.'||k||'.upsert',jsonb_build_array(item));
    perform pg_temp.require(jsonb_array_length(written)=1,k||' upsert result');
    id_before := written->0->>'id';
    rows := pg_temp.call_rpc('list',k,'a.'||k||'.list');
    perform pg_temp.require(jsonb_array_length(rows)=1 and rows->0->>'client_key'='dryrun_'||k,k||' list returns item');
    perform pg_temp.require(not ((rows->0) ?| array['owner_user_id','org_id','org_scope']),k||' leaks identity keys');
    perform pg_temp.require(rows->0 @> item,k||' realistic payload not preserved');
    written := pg_temp.call_rpc('upsert',k,'a.'||k||'.upsert',jsonb_build_array(item||'{"position":7}'::jsonb));
    rows := pg_temp.call_rpc('list',k,'a.'||k||'.list');
    perform pg_temp.require(jsonb_array_length(rows)=1 and rows->0->>'id'=id_before and rows->0->>'position'='7',k||' duplicate/update regression');
    perform pg_temp.require(pg_temp.call_rpc('list',k,'b.'||k||'.list')='[]'::jsonb,k||' B sees A rows');
    perform pg_temp.require(pg_temp.call_rpc('delete',k,'b.'||k||'.delete','[]',array['dryrun_'||k])='{"deleted":0}',k||' B deletes A row');
    perform pg_temp.require(pg_temp.call_rpc('list',k,'org.'||k||'.list')='[]'::jsonb,k||' org sees personal rows');
    perform pg_temp.call_rpc('upsert',k,'org.'||k||'.upsert',jsonb_build_array(item||'{"position":9}'::jsonb));
    rows := pg_temp.call_rpc('list',k,'a.'||k||'.list');
    perform pg_temp.require(jsonb_array_length(rows)=1 and rows->0->>'position'='7',k||' personal sees org rows');
    rows := pg_temp.call_rpc('list',k,'org.'||k||'.list');
    perform pg_temp.require(jsonb_array_length(rows)=1 and rows->0->>'position'='9',k||' org scope lost');
    perform pg_temp.require(pg_temp.call_rpc('delete',k,'a.'||k||'.delete','[]',array['dryrun_'||k])='{"deleted":1}',k||' delete count');
    perform pg_temp.require(pg_temp.call_rpc('list',k,'a.'||k||'.list')='[]',k||' delete left a row');
    perform pg_temp.require(pg_temp.call_rpc('delete',k,'org.'||k||'.delete','[]',array['dryrun_'||k])='{"deleted":1}',k||' org delete');
  end loop;
  written := pg_temp.call_rpc('upsert','projects','b.projects.upsert','[{"client_key":"dryrun_foreign_project","name":"Private","question":"Private question"}]');
  project_id := written->0->>'id';
  perform pg_temp.call_rpc('upsert','watchlist','a.watchlist.upsert',jsonb_build_array(jsonb_build_object('client_key','dryrun_cross_project','ticker','AAPL','project_id',project_id)));
  rows := pg_temp.call_rpc('list','watchlist','a.watchlist.list');
  perform pg_temp.require(rows->0->'project_id'='null'::jsonb,'cross-user project_id must become null');
  perform pg_temp.reject_call('list','watchlist','a.watchlist.upsert','28000');
  perform pg_temp.reject_call('list','watchlist','a.projects.list','28000');
  perform pg_temp.reject_call('list','watchlist','expired','28000');
  perform pg_temp.reject_call('list','watchlist','future','28000');
  perform pg_temp.reject_call('list','unknown','a.watchlist.list','22023');
  select jsonb_agg(jsonb_build_object('client_key','dryrun_many_'||i,'ticker','AAPL')) into many from generate_series(1,201) g(i);
  perform pg_temp.reject_call('upsert','watchlist','a.watchlist.upsert','54000',many);
  all_assertions := current_setting('dryrun.assertions')::jsonb;
  a := all_assertions->'a.watchlist.list';
  perform set_config('dryrun.assertions',(all_assertions||jsonb_build_object('bad',a||jsonb_build_object('p_signature',repeat('0',64))))::text,true);
  perform pg_temp.reject_call('list','watchlist','bad','28000');
  perform set_config('dryrun.assertions',(all_assertions||jsonb_build_object('tampered',a||'{"p_user_id":"user_dryrun_b"}'::jsonb))::text,true);
  perform pg_temp.reject_call('list','watchlist','tampered','28000');
  -- Invoke private helpers rather than relying only on catalog ACL booleans.
  begin perform public.urc_user_kind('watchlist'); raise exception 'P1: anon executed urc_user_kind';
  exception when insufficient_privilege then null; end;
  begin perform public.urc_user_assume('list','watchlist','user_dryrun_a',null,(a->>'p_expires_at')::bigint,a->>'p_signature');
    raise exception 'P1: anon executed urc_user_assume'; exception when insufficient_privilege then null; end;
end $$;
rollback;
