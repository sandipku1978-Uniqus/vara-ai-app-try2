-- Prove job lifecycle, owner scope, leases, counters, hit ordering, failures and expiry under RLS.
-- :test_role must be service_role or urc_user_writer; every mutation rolls back.
begin;
create function pg_temp.require(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'P8 (%): %',current_user,message; end if; end $$;
grant execute on function pg_temp.require(boolean,text) to service_role,urc_user_writer;
set local role :test_role;
do $$
declare j uuid; b uuid; cancelled uuid; expired uuid; claimed jsonb; token uuid; result jsonb; page jsonb; i int;
  hits jsonb := '[{"accession":"0001234567-26-000002","fileDate":"2026-09-02","hit":{"accession":"0001234567-26-000002"}},
                  {"accession":"0001234567-26-000001","fileDate":"2026-09-02","hit":{"accession":"0001234567-26-000001"}}]';
begin
  result := public.urc_search_job_create('dryrun_job_a',null,'{"query":"segment"}','{}',86400);
  j := (result#>>'{job,id}')::uuid;
  perform pg_temp.require(j is not null and result#>>'{job,status}'='running','create running job');
  result := public.urc_search_job_create('dryrun_job_a',null,'{}','{}',86400);
  perform pg_temp.require(result->>'error'='active-job-exists' and (result#>>'{job,id}')::uuid=j,'duplicate create must return active-job-exists');
  perform pg_temp.require(public.urc_search_job_get('dryrun_job_b',j) is null,'get leaks other owner');
  perform pg_temp.require(public.urc_search_job_list('dryrun_job_b',20)='[]','list leaks other owner');
  perform pg_temp.require(public.urc_search_job_hits_page('dryrun_job_b',j,0,20) is null,'hits_page leaks other owner');
  result := public.urc_search_job_create('dryrun_job_b',null,'{}','{}',86400);
  b := (result#>>'{job,id}')::uuid;
  perform pg_temp.require(b is not null and b<>j,'different owner create');
  perform pg_temp.require(jsonb_array_length(public.urc_search_job_list('dryrun_job_b',20))=1,'owner list size');
  perform public.urc_search_job_cancel('dryrun_job_b',b);
  claimed := public.urc_search_job_claim(null,null,120);
  token := (claimed->>'leaseToken')::uuid;
  perform pg_temp.require((claimed->>'id')::uuid=j and token is not null,'global claim must lease runnable A');
  perform pg_temp.require(public.urc_search_job_claim(null,null,120) is null,'second global claim while leased');
  result := public.urc_search_job_advance(j,token,'{"offset":2}','running',null,2,10,false,'{}',hits);
  perform pg_temp.require(result#>>'{job,verified}'='2' and result#>>'{job,waves}'='1' and result#>>'{job,examined}'='2' and result#>>'{job,leased}'='false','advance counters and lease release');
  perform pg_temp.require((select count(*)=2 from public.urc_search_job_hits where job_id=j),'hits not persisted');
  perform pg_temp.require((select lease_token is null and lease_until is null and cursor='{"offset":2}'::jsonb from public.urc_search_jobs where id=j),'cursor/lease state');
  page := public.urc_search_job_hits_page('dryrun_job_a',j,0,20);
  perform pg_temp.require(page->>'total'='2' and page#>>'{hits,0,accession}'='0001234567-26-000001' and page#>>'{hits,1,accession}'='0001234567-26-000002','hits page stable accession tie-break');
  perform pg_temp.require(public.urc_search_job_hits_page('dryrun_job_b',j,0,20) is null,'populated hits owner leak');
  perform pg_temp.require(public.urc_search_job_hits_lookup(j,token,array['0001234567-26-000001'])='[]','released token lookup');
  claimed := public.urc_search_job_claim(j,'dryrun_job_a',120); token := (claimed->>'leaseToken')::uuid;
  perform pg_temp.require(jsonb_array_length(public.urc_search_job_hits_lookup(j,token,array['0001234567-26-000001']))=1,'live token lookup');
  perform pg_temp.require(public.urc_search_job_hits_lookup(j,gen_random_uuid(),array['0001234567-26-000001'])='[]','wrong token lookup');
  update public.urc_search_jobs set lease_until=now()-interval '1 second' where id=j;
  perform pg_temp.require(public.urc_search_job_hits_lookup(j,token,array['0001234567-26-000001'])='[]','expired lease lookup');
  update public.urc_search_jobs set lease_until=now()+interval '120 seconds' where id=j;
  result := public.urc_search_job_advance(j,gen_random_uuid(),'{}','finished',null,9,10,false,'{}','[]');
  perform pg_temp.require(result='{"error":"lease-lost"}','wrong token advance');
  perform pg_temp.require(public.urc_search_job_get('dryrun_job_a',j)->>'waves'='1','wrong token changed counters');
  for i in 1..3 loop
    if i>1 then claimed:=public.urc_search_job_claim(j,'dryrun_job_a',120); token:=(claimed->>'leaseToken')::uuid; end if;
    result:=public.urc_search_job_release(j,token,'dryrun worker failure',true);
    perform pg_temp.require(result#>>'{job,status}'=case when i=3 then 'failed' else 'running' end,'release failure status '||i);
    perform pg_temp.require((select consecutive_failures=i from public.urc_search_jobs where id=j),'consecutive failure counter '||i);
  end loop;
  result:=public.urc_search_job_create('dryrun_job_a',null,'{}','{}',86400); cancelled:=(result#>>'{job,id}')::uuid;
  claimed:=public.urc_search_job_claim(cancelled,'dryrun_job_a',120); token:=(claimed->>'leaseToken')::uuid;
  result:=public.urc_search_job_cancel('dryrun_job_a',cancelled);
  perform pg_temp.require(result->>'status'='cancelled','cancel running job');
  result:=public.urc_search_job_advance(cancelled,token,'{}','finished',null,2,2,false,'{}',hits);
  perform pg_temp.require(result#>>'{job,status}'='cancelled' and result#>>'{job,verified}'='2','cancelled wave must keep status and hits');
  -- A third hit on a newer date checks date priority independently of tie-break.
  update public.urc_search_jobs set lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds' where id=cancelled returning lease_token into token;
  result:=public.urc_search_job_advance(cancelled,token,'{}','finished',null,3,3,false,'{}',
    '[{"accession":"0001234567-26-000003","fileDate":"2026-09-03","hit":{"accession":"0001234567-26-000003"}}]');
  page:=public.urc_search_job_hits_page('dryrun_job_a',cancelled,0,20);
  perform pg_temp.require(page->>'total'='3' and page#>>'{hits,0,accession}'='0001234567-26-000003','newest hit first');
  result:=public.urc_search_job_create('dryrun_job_b',null,'{}','{}',86400); expired:=(result#>>'{job,id}')::uuid;
  update public.urc_search_jobs set expires_at=now()-interval '1 second' where id=expired;
  result:=public.urc_search_job_create('dryrun_job_b',null,'{}','{}',86400);
  perform pg_temp.require(result->>'error' is null and public.urc_search_job_get('dryrun_job_b',expired)->>'status'='expired','create closes expired job');
  b:=(result#>>'{job,id}')::uuid;
  update public.urc_search_jobs set expires_at=now()-interval '1 second' where id=b;
  perform pg_temp.require(public.urc_search_job_claim(null,null,120) is null,'claim should not lease expired job');
  perform pg_temp.require(public.urc_search_job_get('dryrun_job_b',b)->>'status'='expired','claim closes expired job');
end $$;
rollback;
