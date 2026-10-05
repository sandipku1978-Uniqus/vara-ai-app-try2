-- Seed repeatable production-shaped SEC rows before the 026–028 upgrade.
insert into public.urc_comment_letters
  (accession,cik,company_name,form,date_filed,filename,thread_id,content)
select 'dryrun_letter_'||lpad(i::text,4,'0'), 9000000+i%10,
  'Dryrun Issuer '||i%10, 'UPLOAD', date '2025-01-01'+i,
  'edgar/data/dryrun/'||i, (9000000+i%10)||':2025-01-01',
  'fair value segment reporting discussion number '||i
from generate_series(1,300) g(i)
on conflict (accession,cik) do nothing;
insert into public.urc_sec_filings
  (accession,cik,company_name,form,root_form,is_amendment,date_filed,filename)
select 'dryrun_filing_'||lpad(i::text,4,'0'),9000000+i%10,
  'Dryrun Issuer '||i%10,'10-K','10-K',false,date '2025-01-01'+i,
  'edgar/data/dryrun/'||i||'.txt'
from generate_series(1,300) g(i)
on conflict do nothing;
insert into public.urc_filing_text (cik,accession,document,text,bytes,source_validation_version)
select (9000000+i%10)::text,'dryrun_filing_'||lpad(i::text,4,'0'),'dryrun.txt',
  'Dryrun financial statements: fair value and segment reporting.',64,1
from generate_series(1,12) g(i)
on conflict do nothing;
do $$ begin
  if (select count(*) from public.urc_comment_letters where accession like 'dryrun_letter_%') <> 300
     or (select count(*) from public.urc_sec_filings where accession like 'dryrun_filing_%') <> 300 then
    raise exception 'dryrun seed: expected 300 letters and 300 filings';
  end if;
end $$;
