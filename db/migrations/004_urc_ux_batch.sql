-- Week-1 UX batch: issuer filtering on letters, cheap data-freshness stats.

-- Changing a parameter list creates an overload rather than replacing the
-- function — drop the old signatures first so RPC resolution stays unambiguous.
drop function if exists urc_search_letters(text, text, date, date, int, int);
drop function if exists urc_recent_threads(int, int);

-- Company filter for letter search (issuer-first research entry)
create or replace function urc_search_letters(
  p_query  text,
  p_form   text default null,
  p_start  date default null,
  p_end    date default null,
  p_limit  int  default 20,
  p_offset int  default 0,
  p_company text default null
) returns table (
  accession text, cik bigint, company_name text, form text, date_filed date,
  thread_id text, filename text, headline text, rank real, total_count bigint
) language sql stable as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq),
  matched as (
    select l.accession, l.cik, l.company_name, l.form, l.date_filed,
           l.thread_id, l.filename,
           ts_headline('english', left(coalesce(l.content,''), 20000), q.tsq,
                       'MaxFragments=2, MaxWords=30, MinWords=10') as headline,
           ts_rank(l.fts, q.tsq) as rank
    from urc_comment_letters l, q
    where l.fts @@ q.tsq
      and (p_form is null or l.form = p_form)
      and (p_start is null or l.date_filed >= p_start)
      and (p_end is null or l.date_filed <= p_end)
      and (p_company is null or l.company_name ilike '%' || p_company || '%')
  )
  select *, count(*) over () as total_count
  from matched
  order by rank desc, date_filed desc
  limit p_limit offset p_offset;
$$;

create or replace function urc_recent_threads(
  p_limit int default 20, p_offset int default 0, p_company text default null
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
    group by thread_id
  )
  select *, count(*) over () as total_count
  from t
  order by last_letter desc, thread_id
  limit p_limit offset p_offset;
$$;

-- Freshness/coverage stats for the UI trust chips. Row-count estimates come
-- from planner statistics (reltuples) so this stays instant; max dates use
-- the existing indexes.
create or replace function urc_data_stats()
returns table (
  filings_estimate bigint, filings_through date,
  auditors_estimate bigint,
  letters_estimate bigint, letters_with_text bigint, letters_through date
)
language sql stable as $$
  select
    (select reltuples::bigint from pg_class where relname = 'urc_sec_filings'),
    (select max(date_filed) from urc_sec_filings),
    (select reltuples::bigint from pg_class where relname = 'urc_sec_auditors'),
    (select reltuples::bigint from pg_class where relname = 'urc_comment_letters'),
    (select count(*) from urc_comment_letters where content is not null),
    (select max(date_filed) from urc_comment_letters);
$$;
