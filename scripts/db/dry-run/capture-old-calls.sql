-- Capture old positional call results, preserving RPC row order for comparison.
begin;
set local role anon;
select jsonb_build_object(
  'letters', (select coalesce(jsonb_agg(jsonb_build_object('accession',accession,'total_count',total_count) order by rn),'[]')
    from (select accession,total_count,row_number() over () rn
      from public.urc_search_letters('fair value',null,null,null,10,0,null)) r),
  'filings', (select coalesce(jsonb_agg(to_jsonb(r) - 'rn' order by rn),'[]')
    from (select *,row_number() over () rn from public.urc_search_filings(array['10-K'],null,null,null,null,null,10,0,null)) r),
  'stats', (select to_jsonb(r) from public.urc_data_stats() r),
  'version', public.urc_schema_version());
rollback;
