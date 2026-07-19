-- Issuer Dossier: letters thread listing filterable by CIK.
-- (Param-list change ⇒ drop old signature first, or PostgREST sees an
--  ambiguous overload.)

drop function if exists urc_recent_threads(int, int, text);

create or replace function urc_recent_threads(
  p_limit int default 20, p_offset int default 0,
  p_company text default null, p_cik bigint default null
)
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
      and (p_company is null or company_name ilike '%' || p_company || '%')
      and (p_cik is null or cik = p_cik)
    group by thread_id
  )
  select *, count(*) over () as total_count
  from t
  order by last_letter desc, thread_id
  limit p_limit offset p_offset;
$$;
