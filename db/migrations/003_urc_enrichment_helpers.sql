-- Enrichment helpers + timeout fixes discovered during the first full load.

-- The 500K-row window scan in urc_thread_letters() exceeds the REST role's
-- default statement timeout; give the function its own budget so the nightly
-- loader's RPC call succeeds.
alter function urc_thread_letters() set statement_timeout = '300s';

-- Issuers that appear in our filing data but still lack SIC enrichment,
-- most recently active first — drives the incremental submissions pass.
-- Recent review conversations, newest activity first — powers the Comment
-- Letters landing view.
create or replace function urc_recent_threads(p_limit int default 20, p_offset int default 0)
returns table (
  thread_id text, cik bigint, company_name text, letters bigint,
  uploads bigint, corresps bigint, first_letter date, last_letter date,
  total_count bigint
)
language sql stable
set statement_timeout = '60s'
as $$
  with t as (
    select thread_id, min(cik) as cik, max(company_name) as company_name,
           count(*) as letters,
           count(*) filter (where form = 'UPLOAD') as uploads,
           count(*) filter (where form = 'CORRESP') as corresps,
           min(date_filed) as first_letter, max(date_filed) as last_letter
    from urc_comment_letters
    where thread_id is not null
    group by thread_id
  )
  select *, count(*) over () as total_count
  from t
  order by last_letter desc, thread_id
  limit p_limit offset p_offset;
$$;

-- One conversation, in reading order (Staff letter before same-day response).
create or replace function urc_thread_detail(p_thread_id text)
returns table (
  accession text, cik bigint, company_name text, form text, date_filed date,
  filename text, has_text boolean, preview text
)
language sql stable as $$
  select accession, cik, company_name, form, date_filed, filename,
         content is not null as has_text,
         left(coalesce(content, ''), 700) as preview
  from urc_comment_letters
  where thread_id = p_thread_id
  order by date_filed, form desc;
$$;

create or replace function urc_companies_needing_sic(p_limit int default 2000)
returns table (cik bigint)
language sql stable
set statement_timeout = '120s'
as $$
  with candidates as (
    select f.cik, max(f.date_filed) as last_activity
    from urc_sec_filings f
    group by f.cik
  )
  select c.cik
  from candidates c
  left join urc_sec_companies sc on sc.cik = c.cik
  where sc.cik is null or sc.sic is null
  order by c.last_activity desc
  limit p_limit;
$$;
