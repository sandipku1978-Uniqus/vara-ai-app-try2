-- 012: the denominator.
--
-- A keyword search shows a handful of validated rows and never says what they
-- were drawn from, so a partial answer and an exhaustive one look identical.
-- The metadata corpus (6.4M filings, 2010-01-02 onward) can state the
-- population exactly, which turns "here are 50 filings" into "50 validated of
-- N matching, searched against M in scope".
--
-- Deliberately scoped, not global: counting a single root_form over a date
-- range rides urc_sec_filings_form_date_idx and returns in ~0.2s, while the
-- same aggregation across the whole corpus takes ~6.5s. The API therefore
-- requires a form or date scope rather than offering a total that would be
-- too slow to render.

create or replace function urc_filing_scope_stats(
  p_forms text[]  default null,
  p_start date    default null,
  p_end   date    default null,
  p_cik   bigint  default null
) returns table (
  year        int,
  filings     bigint,
  total_count bigint
) language sql stable as $$
  with scoped as (
    select date_filed
    from public.urc_sec_filings
    where (p_forms is null or root_form = any(p_forms))
      and (p_start is null or date_filed >= p_start)
      and (p_end   is null or date_filed <= p_end)
      and (p_cik   is null or cik = p_cik)
  ),
  by_year as (
    select extract(year from date_filed)::int as year, count(*) as filings
    from scoped group by 1
  )
  select
    by_year.year,
    by_year.filings,
    -- Repeated on every row so one round trip carries both the histogram and
    -- the population, matching urc_search_filings' total_count convention.
    (select coalesce(sum(filings), 0) from by_year) as total_count
  from by_year
  order by by_year.year;
$$;

comment on function urc_filing_scope_stats is
  'Per-year filing counts and the in-scope population for a form/date/issuer scope.';

grant execute on function urc_filing_scope_stats(text[], date, date, bigint) to anon;
