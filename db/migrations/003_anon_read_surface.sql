-- F-03 least-privilege web tier, take 2.
-- This Supabase project uses asymmetric JWT signing keys, so custom-role
-- (urc_web) tokens cannot be minted (private key is not exportable). The
-- supported least-privilege identity for the web tier is the publishable/anon
-- key. Grant anon exactly the read surface the web routes use — all public
-- SEC data — and nothing else. Loaders keep the service key.
grant usage on schema public to anon;
grant select on public.urc_sec_companies,
                public.urc_current_auditors,
                public.urc_thread_summaries,
                public.urc_comment_letters to anon;

-- RLS is enabled on three of these; anon needs explicit read policies.
do $$ declare t text;
begin
  foreach t in array array['urc_sec_companies','urc_thread_summaries','urc_comment_letters']
  loop
    execute format('drop policy if exists anon_read on public.%I', t);
    execute format('create policy anon_read on public.%I for select to anon using (true)', t);
  end loop;
end $$;

-- Letters RPCs used by /api/letters.
do $$ declare fn record;
begin
  for fn in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname in ('urc_search_letters','urc_thread_detail','urc_recent_threads','urc_data_stats','urc_search_filings')
  loop
    execute format('grant execute on function %s to anon', fn.sig);
  end loop;
end $$;
