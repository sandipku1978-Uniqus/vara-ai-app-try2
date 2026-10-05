-- Head-only 029 check. Connect as disposable postgres to SET LOCAL ROLE.
-- Fresh :assertions come from sign-assertions.ts; all fixtures/key changes roll back.
\getenv dry_secret DRYRUN_SIGNING_SECRET
begin;
set local dryrun.assertions = :'assertions';
insert into public.urc_user_signing_key(singleton,secret) values(true,:'dry_secret')
on conflict(singleton) do update set secret=excluded.secret;
-- Only our own client keys, including cascaded hits, are ever cleaned up.
delete from public.urc_user_alerts where client_key like 'dryrun\_p9\_%' escape '\'
  and owner_user_id in ('user_dryrun_a','user_dryrun_b');

create function pg_temp.require(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'P9 (%): %',current_user,message; end if; end $$;
create function pg_temp.reject(sql text, expected_state text, message text) returns void language plpgsql as $$
declare caught text;
begin
  begin execute sql; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
  if caught is distinct from expected_state then
    raise exception 'P9 (%): % expected SQLSTATE %, got %',current_user,message,expected_state,coalesce(caught,'success');
  end if;
end $$;
create function pg_temp.alert_item(k text, cadence text) returns jsonb language sql as $$
  select jsonb_build_object('client_key',k,'name','Segment disclosures','query','segment revenue',
    'mode','semantic','filters','{}'::jsonb,'default_forms','10-K','cadence',cadence,'enabled',true,
    'last_checked_at',null,'last_hit_count',0,'last_seen_accessions','[]'::jsonb,
    'latest_new_accessions','[]'::jsonb,'engine_version',null,'last_check_coverage',null);
$$;
create function pg_temp.upsert(who text, items jsonb) returns jsonb language plpgsql as $$
declare a jsonb := current_setting('dryrun.assertions')::jsonb -> (who||'.alerts.upsert');
begin
  if a is null then raise exception 'P9: missing alerts assertion for %',who; end if;
  return public.urc_user_upsert('alerts',items,a->>'p_user_id',a->>'p_org_id',(a->>'p_expires_at')::bigint,a->>'p_signature');
end $$;
create function pg_temp.page(assertion_name text, k text default null, unseen boolean default false,
  since_at timestamptz default null, off integer default 0, lim integer default 50)
returns jsonb language plpgsql as $$
declare a jsonb := current_setting('dryrun.assertions')::jsonb -> assertion_name;
begin
  if a is null then raise exception 'P9: missing assertion %',assertion_name; end if;
  return public.urc_user_alert_hits_page(k,unseen,since_at,off,lim,
    a->>'p_user_id',a->>'p_org_id',(a->>'p_expires_at')::bigint,a->>'p_signature');
end $$;
create function pg_temp.mark(assertion_name text, ids uuid[] default null, k text default null, all_hits boolean default false)
returns jsonb language plpgsql as $$
declare a jsonb := current_setting('dryrun.assertions')::jsonb -> assertion_name;
begin
  if a is null then raise exception 'P9: missing assertion %',assertion_name; end if;
  return public.urc_user_alert_hits_mark_seen(ids,k,all_hits,
    a->>'p_user_id',a->>'p_org_id',(a->>'p_expires_at')::bigint,a->>'p_signature');
end $$;
grant execute on function pg_temp.require(boolean,text), pg_temp.reject(text,text,text),
  pg_temp.alert_item(text,text), pg_temp.upsert(text,jsonb),
  pg_temp.page(text,text,boolean,timestamptz,integer,integer), pg_temp.mark(text,uuid[],text,boolean)
  to anon,authenticated,service_role,urc_user_writer;
do $$ begin
  if exists(select from pg_roles where rolname='urc_web') then
    grant execute on function pg_temp.require(boolean,text), pg_temp.reject(text,text,text),
      pg_temp.alert_item(text,text), pg_temp.upsert(text,jsonb),
      pg_temp.page(text,text,boolean,timestamptz,integer,integer), pg_temp.mark(text,uuid[],text,boolean) to urc_web;
  end if;
end $$;

-- Setup through the actual signed 026 path, never direct inserts into alerts.
set local role anon;
select pg_temp.require(jsonb_array_length(pg_temp.upsert('a',jsonb_build_array(
  pg_temp.alert_item('dryrun_p9_daily','daily'),pg_temp.alert_item('dryrun_p9_weekly','weekly'))))=2,'signed A setup');
select pg_temp.require(jsonb_array_length(pg_temp.upsert('b',jsonb_build_array(
  pg_temp.alert_item('dryrun_p9_b','daily'))))=1,'signed B setup');
reset role;
select pg_temp.require((select count(*)=3 and bool_and(enabled and last_checked_at is null)
  from public.urc_user_alerts where client_key in ('dryrun_p9_daily','dryrun_p9_weekly','dryrun_p9_b')),
  'three enabled never-checked alerts');

set local role service_role;
do $$
declare c1 jsonb; c2 jsonb; c jsonb; other jsonb; v_id uuid; token uuid; k text; result jsonb; many jsonb;
  hits jsonb := '[
    {"accession":"0001234567-26-000101","cik":"1234567","company":"Dryrun Industries", "form":"10-K",
     "filed_at":"2026-02-15","period_ending":"2025-12-31","document":"dryrun-20251231.htm",
     "section_path":"Item 8 > Note 12 > Segments","passage":"Segment revenue increased by 12 percent.",
     "passage_basis":"validated-text","is_amendment":false,"owner_user_id":"user_dryrun_b","org_id":"org_dryrun"},
    {"accession":"0007654321-26-000102","cik":"7654321","company":"Dryrun Holdings","form":"10-K",
     "filed_at":"2026-02-16","period_ending":"2025-12-31","document":"holdings-20251231.htm",
     "section_path":"Item 7 > Segment results","passage":"","passage_basis":"not-read","is_amendment":false},
    {"accession":"0001234567-26-000103","cik":"1234567","company":"Dryrun Industries","form":"10-K/A",
     "filed_at":"2026-03-01","period_ending":"2025-12-31","document":"dryrun-amendment.htm",
     "section_path":"Item 8 > Note 12 > Segments","passage":"Segment revenue has been restated.",
     "passage_basis":"validated-text","is_amendment":true,"amends_accession":"0001234567-26-000101"}]';
  seen jsonb := '["0001234567-26-000101","0007654321-26-000102","0001234567-26-000103"]';
begin
  c1:=public.urc_alert_eval_claim(null,null,null,72000,518400,180);
  c2:=public.urc_alert_eval_claim(null,null,null,72000,518400,180);
  perform pg_temp.require(c1->>'id' is not null and c1->>'leaseToken' is not null,'first global claim and token');
  perform pg_temp.require(c2->>'id' is not null and c2->>'leaseToken' is not null and c2->>'id'<>c1->>'id','second global claim skips leased alert');
  perform pg_temp.require(c1->>'clientKey' in ('dryrun_p9_daily','dryrun_p9_weekly','dryrun_p9_b')
    and c2->>'clientKey' in ('dryrun_p9_daily','dryrun_p9_weekly','dryrun_p9_b'),'global claims take our fixtures');
  -- At least one of two claims belongs to A; UUID order is intentionally irrelevant.
  if c1->>'ownerUserId'='user_dryrun_a' then c:=c1; other:=c2; else c:=c2; other:=c1; end if;
  v_id:=(c->>'id')::uuid; token:=(c->>'leaseToken')::uuid; k:=c->>'clientKey';
  perform pg_temp.require(public.urc_alert_eval_claim('user_dryrun_a',null,k,72000,518400,180)='{"error":"busy"}','owner claim on live lease');
  perform pg_temp.require(public.urc_alert_eval_claim('user_dryrun_a',null,'dryrun_p9_unknown',72000,518400,180)='{"error":"not-found"}','unknown owner client key');
  perform pg_temp.reject('select public.urc_alert_eval_claim(''user_dryrun_a'',null,null,72000,518400,180)','P0001','owner claim needs client key');
  perform pg_temp.require(public.urc_alert_eval_prior_hits(v_id,token,array['1234567','7654321'])='[]','live lease initially has no prior hits');
  perform pg_temp.require(public.urc_alert_eval_prior_hits(v_id,gen_random_uuid(),array['1234567'])='[]','wrong lease has no prior hits');
  -- Caller GUCs and forged identity fields must not override the alert's owner/org.
  perform set_config('urc.user_id','user_dryrun_b',true);
  perform set_config('urc.org_id','org_dryrun',true);
  result:=public.urc_alert_eval_record(v_id,token,3,seen,seen,9,'{"complete":true}',hits);
  perform pg_temp.require(result='{"inserted":3}','record inserts three realistic hits');
  perform pg_temp.require((select count(*)=3 and bool_and(owner_user_id='user_dryrun_a' and org_id is null)
    from public.urc_user_alert_hits where alert_id=v_id),'hit identity comes from alert, not caller');
  perform pg_temp.require((select last_checked_at=now() and last_hit_count=3 and last_seen_accessions=seen
    and latest_new_accessions=seen and engine_version=9 and last_check_coverage='{"complete":true}'::jsonb
    and evaluation_lease is null and evaluation_lease_until is null from public.urc_user_alerts where urc_user_alerts.id=v_id),
    'record updates check state and clears lease');
  perform pg_temp.require(public.urc_alert_eval_record(v_id,token,99,'[]','[]',0,'{}',hits)='{"error":"lease-lost"}','second record loses released lease');
  c:=public.urc_alert_eval_claim('user_dryrun_a',null,k,72000,518400,180); token:=(c->>'leaseToken')::uuid;
  result:=public.urc_alert_eval_prior_hits(v_id,token,array['1234567','7654321']);
  perform pg_temp.require(jsonb_array_length(result)=2 and result @> '[{"accession":"0001234567-26-000101","periodEnding":"2025-12-31","form":"10-K"}]',
    'prior hits include originals and exclude amendment');
  perform pg_temp.require(public.urc_alert_eval_prior_hits(v_id,gen_random_uuid(),array['1234567'])='[]','wrong token cannot see populated prior hits');
  perform pg_temp.require(public.urc_alert_eval_record(v_id,token,3,seen,seen,9,'{"complete":true}',hits)='{"inserted":0}','duplicate accessions insert zero');
  perform pg_temp.require((select count(*)=3 from public.urc_user_alert_hits where alert_id=v_id),'idempotent record keeps three hits');
  c:=public.urc_alert_eval_claim('user_dryrun_a',null,k,72000,518400,180); token:=(c->>'leaseToken')::uuid;
  select jsonb_agg('x'::text) into many from generate_series(1,5001);
  perform pg_temp.reject(format('select public.urc_alert_eval_record(%L,%L,3,%L,''[]'',9,''{}'',''[]'')',v_id,token,many),'P0001','oversized seen array');
  perform pg_temp.reject(format('select public.urc_alert_eval_record(%L,%L,3,''[]'',%L,9,''{}'',''[]'')',v_id,token,many),'P0001','oversized new array');
  select jsonb_agg('{}'::jsonb) into many from generate_series(1,101);
  perform pg_temp.reject(format('select public.urc_alert_eval_record(%L,%L,3,''[]'',''[]'',9,''{}'',%L)',v_id,token,many),'P0001','oversized hits array');
  perform pg_temp.reject(format('select public.urc_alert_eval_record(%L,%L,3,''[]'',''[]'',9,''[]'',''[]'')',v_id,token),'P0001','non-object coverage');
  perform pg_temp.reject(format('select public.urc_alert_eval_record(%L,%L,3,''[]'',''[]'',9,%L,''[]'')',v_id,token,jsonb_build_object('large',repeat('x',65537))),
    'P0001','oversized coverage');
  perform pg_temp.require(public.urc_alert_eval_release(v_id,token),'release live lease once');
  perform pg_temp.require(not public.urc_alert_eval_release(v_id,token),'release cannot succeed twice');
  perform pg_temp.require(public.urc_alert_eval_release((other->>'id')::uuid,(other->>'leaseToken')::uuid),'release second global claim');
  perform set_config('dryrun.alert_id',v_id::text,true);
  perform set_config('dryrun.alert_key',k,true);
  perform set_config('dryrun.hits',hits::text,true);
  perform set_config('dryrun.seen',seen::text,true);
end $$;
reset role;

-- Give each hit a distinct created_at so ordering does not accidentally pass
-- because of UUIDs or transaction-stable now(). No production timestamps persist.
update public.urc_user_alert_hits set created_at=now()-case accession
  when '0001234567-26-000101' then interval '3 minutes'
  when '0007654321-26-000102' then interval '2 minutes' else interval '1 minute' end
where alert_id=current_setting('dryrun.alert_id')::uuid;
select set_config('dryrun.eval_state',jsonb_build_object('last_checked_at',last_checked_at,
  'last_hit_count',last_hit_count,'last_seen_accessions',last_seen_accessions,
  'latest_new_accessions',latest_new_accessions,'engine_version',engine_version,'last_check_coverage',last_check_coverage)::text,true)
from public.urc_user_alerts where id=current_setting('dryrun.alert_id')::uuid;

set local role anon;
do $$ declare stale jsonb; old_time jsonb; begin
  foreach old_time in array array[to_jsonb(now()-interval '1 day'),'null'::jsonb] loop
    stale:=pg_temp.alert_item(current_setting('dryrun.alert_key'),'daily') ||
      jsonb_build_object('name','Renamed after server evaluation','last_checked_at',old_time,
        'last_hit_count',99,'last_seen_accessions','["stale"]'::jsonb,'latest_new_accessions','["stale"]'::jsonb,
        'engine_version',1,'last_check_coverage','{"stale":true}'::jsonb);
    perform pg_temp.upsert('a',jsonb_build_array(stale));
    perform pg_temp.require((select item @> current_setting('dryrun.eval_state')::jsonb
      and name='Renamed after server evaluation' from jsonb_array_elements(public.urc_user_list('alerts',
        'user_dryrun_a',null,(current_setting('dryrun.assertions')::jsonb#>>'{a.alerts.list,p_expires_at}')::bigint,
        current_setting('dryrun.assertions')::jsonb#>>'{a.alerts.list,p_signature}')) e(item)
      cross join lateral jsonb_to_record(item) as r(client_key text,name text)
      where r.client_key=current_setting('dryrun.alert_key')),'stale/null browser state is guarded while rename applies');
  end loop;
end $$;
reset role;

-- Bad assertions are derived from a real signature; operation and expiry
-- rejection requests themselves were signed by the application's signer.
select set_config('dryrun.assertions',(current_setting('dryrun.assertions')::jsonb || jsonb_build_object(
  'bad.alert-hits.list',current_setting('dryrun.assertions')::jsonb->'a.alert-hits.list'||'{"p_signature":"bad"}'::jsonb,
  'bad.alert-hits.upsert',current_setting('dryrun.assertions')::jsonb->'a.alert-hits.upsert'||'{"p_signature":"bad"}'::jsonb))::text,true);

do $$
declare role_name text; p jsonb; ids uuid[]; k text := current_setting('dryrun.alert_key');
begin
  -- Repeat the signed owner behavior through every granted transport.
  foreach role_name in array array['anon','urc_web','service_role'] loop
    if not exists(select from pg_roles where rolname=role_name) then continue; end if;
    update public.urc_user_alert_hits set seen_at=null where alert_id=current_setting('dryrun.alert_id')::uuid;
    execute format('set local role %I',role_name);
    p:=pg_temp.page('a.alert-hits.list');
    perform pg_temp.require(p->>'total'='3' and p->>'unseen'='2' and p->>'unseenAmendments'='1'
      and p->'byAlert'=jsonb_build_object(k,2),'owner page totals and byAlert keyed by client key');
    perform pg_temp.require(p#>>'{hits,0,accession}'='0001234567-26-000103'
      and p#>>'{hits,1,accession}'='0007654321-26-000102' and p#>>'{hits,2,accession}'='0001234567-26-000101','newest first');
    perform pg_temp.require(p#>>'{hits,2,passageBasis}'='validated-text' and p#>>'{hits,1,passageBasis}'='not-read'
      and p#>>'{hits,1,passage}'='' and p#>>'{hits,0,isAmendment}'='true'
      and p#>>'{hits,0,amendsAccession}'='0001234567-26-000101'
      and p#>>'{hits,2,document}'='dryrun-20251231.htm' and p#>>'{hits,2,company}'='Dryrun Industries'
      and p#>>'{hits,2,sectionPath}'='Item 8 > Note 12 > Segments' and p#>>'{hits,2,filedAt}'='2026-02-15'
      and p#>>'{hits,2,periodEnding}'='2025-12-31' and p#>>'{hits,2,alertName}'='Renamed after server evaluation',
      'page preserves realistic hit metadata');
    perform pg_temp.require(pg_temp.page('a.alert-hits.list',k)->>'total'='3','client key filter includes target');
    p:=pg_temp.page('a.alert-hits.list','dryrun_p9_unknown');
    perform pg_temp.require(p->>'total'='0' and p->'hits'='[]' and p->'byAlert'=jsonb_build_object(k,2),'client key filter excludes target; byAlert ignores filter');
    p:=pg_temp.page('a.alert-hits.list',null,false,now()-interval '90 seconds');
    perform pg_temp.require(p->>'total'='1' and p#>>'{hits,0,accession}'='0001234567-26-000103'
      and p->>'unseen'='0' and p->>'unseenAmendments'='1' and p->'byAlert'=jsonb_build_object(k,2),'since filter and independent byAlert counts');
    p:=pg_temp.page('a.alert-hits.list',null,false,null,1,1);
    perform pg_temp.require(p->>'total'='3' and jsonb_array_length(p->'hits')=1
      and p#>>'{hits,0,accession}'='0007654321-26-000102','offset and limit with unpaged total');
    p:=pg_temp.page('a.alert-hits.list',null,false,null,-10,0);
    perform pg_temp.require(jsonb_array_length(p->'hits')=1 and p#>>'{hits,0,accession}'='0001234567-26-000103','negative offset and zero limit clamp');
    perform pg_temp.require(jsonb_array_length(pg_temp.page('a.alert-hits.list',null,false,null,0,-99)->'hits')=1,'negative limit clamp');
    perform pg_temp.require(jsonb_array_length(pg_temp.page('a.alert-hits.list',null,false,null,null,null)->'hits')=3,'null offset/limit defaults');
    perform pg_temp.require(pg_temp.page('a.alert-hits.list',null,false,null,2147483647,2147483647)->'hits'='[]','large pagination arguments are bounded safely');
    p:=pg_temp.page('b.alert-hits.list');
    perform pg_temp.require(p->>'total'='0' and p->>'unseen'='0' and p->>'unseenAmendments'='0'
      and p->'hits'='[]' and p->'byAlert'='{}','B cannot see A hits or counts');
    p:=pg_temp.page('org.alert-hits.list');
    perform pg_temp.require(p->>'total'='0' and p->'hits'='[]' and p->'byAlert'='{}','org assertion cannot see personal hits');
    p:=pg_temp.page('a.alert-hits.list');
    ids:=array[(p#>>'{hits,0,id}')::uuid];
    perform pg_temp.require(pg_temp.mark('b.alert-hits.upsert',ids)='{"marked":0}','B cannot mark A ids');
    perform pg_temp.require(pg_temp.mark('b.alert-hits.upsert',null,k)='{"marked":0}','B cannot mark A client key');
    perform pg_temp.require(pg_temp.mark('org.alert-hits.upsert',ids)='{"marked":0}','org cannot mark personal ids');
    perform pg_temp.require(pg_temp.mark('a.alert-hits.upsert')='{"marked":0}','nothing named marks zero');
    perform pg_temp.require(pg_temp.mark('a.alert-hits.upsert',ids)='{"marked":1}','ids mark exactly one');
    perform pg_temp.require(pg_temp.mark('a.alert-hits.upsert',ids)='{"marked":0}','already-seen id marks zero');
    p:=pg_temp.page('a.alert-hits.list');
    perform pg_temp.require(p#>>'{hits,0,accession}'='0007654321-26-000102'
      and p#>>'{hits,1,accession}'='0001234567-26-000101' and p#>>'{hits,2,accession}'='0001234567-26-000103'
      and p#>>'{hits,2,seenAt}' is not null and p#>>'{hits,0,seenAt}' is null
      and p->>'unseen'='2' and p->>'unseenAmendments'='0','unseen before newer seen amendment; only named id changed');
    p:=pg_temp.page('a.alert-hits.list',null,true);
    perform pg_temp.require(p->>'total'='2' and jsonb_array_length(p->'hits')=2,'unseen-only filter');
    perform pg_temp.require(pg_temp.mark('a.alert-hits.upsert',null,k)='{"marked":2}','client key marks remaining hits');
    p:=pg_temp.page('a.alert-hits.list',null,true);
    perform pg_temp.require(p->>'total'='0' and p->>'unseen'='0' and p->>'unseenAmendments'='0'
      and p->'hits'='[]' and p->'byAlert'='{}','all seen counters cleared');
    perform pg_temp.reject('select pg_temp.mark(''a.alert-hits.upsert'',array_fill(gen_random_uuid(),array[501]))','54000','more than 500 ids');
    perform pg_temp.reject('select pg_temp.page(''bad.alert-hits.list'')','28000','bad page signature');
    perform pg_temp.reject('select pg_temp.mark(''bad.alert-hits.upsert'')','28000','bad mark signature');
    perform pg_temp.reject('select pg_temp.mark(''a.alert-hits.list'')','28000','list signature used for mark');
    perform pg_temp.reject('select pg_temp.page(''a.alert-hits.upsert'')','28000','upsert signature used for page');
    perform pg_temp.reject('select pg_temp.page(''expired.alert-hits.list'')','28000','expired page assertion');
    perform pg_temp.reject('select pg_temp.mark(''expired.alert-hits.upsert'')','28000','expired mark assertion');
    reset role;
  end loop;
end $$;

-- Larger, temporary fixtures prove the actual upper clamps (a three-row page
-- alone cannot distinguish LIMIT 200 or OFFSET 10000 from unbounded values).
insert into public.urc_user_alert_hits(alert_id,owner_user_id,accession,cik,created_at)
select current_setting('dryrun.alert_id')::uuid,'user_dryrun_a',
  '0009999999-26-'||lpad(i::text,6,'0'),'9999999',now()+make_interval(secs=>i)
from generate_series(1,10002) g(i);
set local role anon;
select pg_temp.require(jsonb_array_length(pg_temp.page('a.alert-hits.list',null,false,null,0,2147483647)->'hits')=200,'upper limit clamps to 200');
select pg_temp.require(jsonb_array_length(pg_temp.page('a.alert-hits.list',null,false,null,2147483647,200)->'hits')=5,'upper offset clamps to 10000');
reset role;
delete from public.urc_user_alert_hits where alert_id=current_setting('dryrun.alert_id')::uuid and cik='9999999';

-- Separate B and org fixtures make writer RLS isolation observable with rows
-- present on both sides, and verify a non-null org comes from the leased alert.
set local role anon;
select pg_temp.upsert('org',jsonb_build_array(pg_temp.alert_item('dryrun_p9_org','weekly')));
reset role;
set local role service_role;
do $$ declare c jsonb; who text; org text; k text; begin
  foreach k in array array['dryrun_p9_b','dryrun_p9_org'] loop
    who:=case when k='dryrun_p9_b' then 'user_dryrun_b' else 'user_dryrun_a' end;
    org:=case when k='dryrun_p9_org' then 'org_dryrun' else null end;
    c:=public.urc_alert_eval_claim(who,org,k,72000,518400,180);
    perform set_config('urc.user_id','user_dryrun_b',true);
    perform set_config('urc.org_id','',true);
    perform pg_temp.require(public.urc_alert_eval_record((c->>'id')::uuid,(c->>'leaseToken')::uuid,1,
      '["0001234567-26-000101"]','[]',9,'{}',jsonb_build_array(current_setting('dryrun.hits')::jsonb->0))='{"inserted":1}',
      'isolated B/org hit setup');
    perform pg_temp.require((select owner_user_id=who and org_id is not distinct from org from public.urc_user_alert_hits
      where alert_id=(c->>'id')::uuid),'B/org hit identity comes from leased alert');
  end loop;
end $$;
reset role;

-- Catalog facts and actual permission errors, using typed NULL argument lists
-- from pg_proc just like checks-private-surfaces.sql (includes future overloads).
do $$
declare role_name text; fn record; args text; col record; caught text;
begin
  perform pg_temp.require((select relrowsecurity and relforcerowsecurity from pg_class
    where oid='public.urc_user_alert_hits'::regclass),'hits RLS enabled and forced');
  foreach role_name in array array['anon','authenticated','urc_web'] loop
    if not exists(select from pg_roles where rolname=role_name) then continue; end if;
    perform pg_temp.require(exists(select from pg_policies where schemaname='public' and tablename='urc_user_alert_hits'
      and permissive='RESTRICTIVE' and cmd='ALL' and role_name::name=any(roles)
      and btrim(qual,'() ')='false' and btrim(with_check,'() ')='false'),'restrictive false policy for '||role_name);
    execute format('set local role %I',role_name);
    perform pg_temp.reject('select * from public.urc_user_alert_hits limit 1','42501','web SELECT hits');
    perform pg_temp.reject('insert into public.urc_user_alert_hits default values','42501','web INSERT hits');
    reset role;
  end loop;
  perform pg_temp.require(exists(select from pg_policies where schemaname='public' and tablename='urc_user_alert_hits'
    and policyname='urc_user_owner_rows' and permissive='PERMISSIVE' and cmd='ALL'
    and roles=array['urc_user_writer']::name[] and qual is not null and with_check is not null),'writer permissive owner policy');
  perform pg_temp.require((select count(*)=2 and bool_and(p.prosecdef and r.rolname='urc_user_writer'
    and coalesce('search_path=pg_catalog, public'=any(p.proconfig),false)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_roles r on r.oid=p.proowner where n.nspname='public'
    and p.proname in ('urc_user_alert_hits_page','urc_user_alert_hits_mark_seen')),'owner functions definer, owner and pinned path');
  perform pg_temp.require((select count(*)>=4 and bool_and(not p.prosecdef and coalesce('search_path=pg_catalog, public'=any(p.proconfig),false))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'urc\_alert\_eval\_%' escape '\'),'every evaluator invoker with pinned path');
  for fn in select p.oid,p.proname,p.proargtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'urc\_alert\_eval\_%' escape '\'
      or p.proname in ('urc_user_alert_hits_page','urc_user_alert_hits_mark_seen','urc_user_assume','urc_user_kind')) loop
    select string_agg('null::'||format_type(t,null),',' order by ord) into args
      from unnest(fn.proargtypes::oid[]) with ordinality a(t,ord);
    foreach role_name in array array['anon','authenticated','urc_web','urc_user_writer','service_role'] loop
      if not exists(select from pg_roles where rolname=role_name) then continue; end if;
      if fn.proname like 'urc\_alert\_eval\_%' escape '\' then
        if role_name='service_role' then
          perform pg_temp.require(has_function_privilege(role_name,fn.oid,'execute'),'service execute ACL '||fn.oid::regprocedure);
          execute format('set local role %I',role_name);
          -- Roll back any NULL-argument invocation that happens to mutate a row.
          caught:=null;
          begin
            execute format('select public.%I(%s)',fn.proname,args);
            raise exception 'rollback execute probe' using errcode='ZX001';
          exception when others then get stacked diagnostics caught=returned_sqlstate; end;
          reset role;
          perform pg_temp.require(caught<>'42501','service can invoke '||fn.oid::regprocedure);
          continue;
        end if;
      elsif fn.proname in ('urc_user_assume','urc_user_kind') then
        if role_name<>'service_role' then continue; end if;
      elsif role_name<>'authenticated' then continue;
      end if;
      execute format('set local role %I',role_name);
      perform pg_temp.reject(format('select public.%I(%s)',fn.proname,args),'42501','private function '||fn.oid::regprocedure);
      reset role;
    end loop;
  end loop;
  -- SELECT and seen_at are the only writer privileges; invoke every other
  -- column update separately so a new writable column cannot go unnoticed.
  set local role urc_user_writer;
  perform set_config('urc.user_id','user_dryrun_a',true); perform set_config('urc.org_id','',true);
  perform pg_temp.require((select count(*)=3 and bool_and(owner_user_id='user_dryrun_a' and org_id is null)
    from public.urc_user_alert_hits),'writer sees only A personal hits');
  perform set_config('urc.user_id','user_dryrun_b',true);
  perform pg_temp.require((select count(*)=1 and bool_and(owner_user_id='user_dryrun_b') from public.urc_user_alert_hits),'writer sees only B hits');
  perform set_config('urc.user_id','user_dryrun_a',true); perform set_config('urc.org_id','org_dryrun',true);
  perform pg_temp.require((select count(*)=1 and bool_and(org_id='org_dryrun') from public.urc_user_alert_hits),'writer sees only A org hits');
  perform set_config('urc.org_id','',true);
  perform pg_temp.reject('insert into public.urc_user_alert_hits default values','42501','writer INSERT');
  perform pg_temp.reject('delete from public.urc_user_alert_hits','42501','writer DELETE');
  for col in select attname from pg_attribute where attrelid='public.urc_user_alert_hits'::regclass
    and attnum>0 and not attisdropped and attname<>'seen_at' loop
    perform pg_temp.reject(format('update public.urc_user_alert_hits set %I=default',col.attname),'42501','writer UPDATE '||col.attname);
  end loop;
  update public.urc_user_alert_hits set seen_at=null;
  perform pg_temp.require((select count(*)=3 and bool_and(seen_at is null) from public.urc_user_alert_hits),'writer can update seen_at');
  reset role;
end $$;

delete from public.urc_user_alerts where client_key like 'dryrun\_p9\_%' escape '\'
  and owner_user_id in ('user_dryrun_a','user_dryrun_b');
select pg_temp.require(not exists(select from public.urc_user_alert_hits where alert_id=current_setting('dryrun.alert_id')::uuid),'fixture cleanup cascades hits');
rollback;
