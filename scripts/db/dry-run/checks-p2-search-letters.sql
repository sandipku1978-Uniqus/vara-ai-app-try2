-- Prove one letters overload, old/new named and positional calls, filtering and maintenance ACLs.
begin;
insert into public.urc_sec_companies(cik,name,sic) values(9000001,'Dryrun SIC Issuer','2834')
on conflict(cik) do update set sic=excluded.sic;
insert into public.urc_letter_facets(accession,cik,reviewed_forms,reviewed_forms_basis,derivation_version)
select accession,cik,array['S-1'],'Registration Statement on Form S-1',1
from public.urc_comment_letters where cik=9000001 and accession like 'dryrun_letter_%'
on conflict(accession,cik) do update set reviewed_forms=excluded.reviewed_forms;
set local role anon;
do $$ declare positional jsonb; named jsonb; ids text[]; c int; total bigint; r real; begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='urc_search_letters') <> 1
    or to_regprocedure('public.urc_search_letters(text,text,date,date,integer,integer,text)') is not null then
    raise exception 'P2: expected exactly one ten-argument letters overload'; end if;
  select jsonb_agg(to_jsonb(x) order by rn) into positional from
    (select *,row_number() over () rn from public.urc_search_letters('fair value',null,null,null,10,0,null)) x;
  -- Actual 027 names are p_start/p_end/p_company (not p_date_from/p_thread_id).
  select jsonb_agg(to_jsonb(x) order by rn) into named from
    (select *,row_number() over () rn from public.urc_search_letters(p_query=>'fair value',p_form=>null,p_start=>null,p_end=>null,p_limit=>10,p_offset=>0,p_company=>null)) x;
  if positional is null or positional is distinct from named then raise exception 'P2: old named/positional calls differ'; end if;
  select count(*),max(total_count) into c,total from public.urc_search_letters('segment',null,null,null,100,0,null,9000001,'2834',array['S-1']);
  if c<>30 or total is distinct from 30 then raise exception 'P2: combined new filters: count % total %',c,total; end if;
  select count(*),max(rank),max(total_count) into c,r,total from public.urc_search_letters(p_query=>' ',p_cik=>9000001,p_sic=>'2834',p_reviewed_forms=>array['S-1'],p_limit=>100);
  if c<>30 or r is distinct from 0::real or total is distinct from 30 then raise exception 'P2: filter-only results: %, %, %',c,r,total; end if;
  select array_agg(accession order by rn) into ids from (select accession,row_number() over () rn
    from public.urc_search_letters('',null,null,null,3,0,null,9000001,'2834',array['S-1'])) x;
  if ids is distinct from array['dryrun_letter_0291','dryrun_letter_0281','dryrun_letter_0271'] then raise exception 'P2: filter-only recency order: %',ids; end if;
  if exists(select from public.urc_search_letters(' ',null,null,null,10,0,null)) then raise exception 'P2: blank unfiltered search returns rows'; end if;
  begin perform * from public.urc_letters_needing_facets(); raise exception 'P2: anon executed facet reader';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin perform * from public.urc_letters_needing_facets(); end $$;
rollback;
