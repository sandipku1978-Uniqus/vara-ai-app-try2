-- 013: make the denominator affordable on every search, not just scoped ones.
--
-- 012 required a form or date scope because aggregating 6.4M rows live takes
-- ~6.5s. But the denominator matters MOST on a broad search — that is exactly
-- when a reader cannot tell fifty rows from fifty thousand. Rolling the corpus
-- up by (year, root_form) turns every unscoped or form-scoped question into a
-- lookup over a few thousand rows.
--
-- Issuer-scoped questions still read the base table: per-CIK counts ride
-- urc_sec_filings_cik_date_idx and a CIK dimension would explode the rollup to
-- one row per issuer per year per form.

create materialized view if not exists urc_filing_year_form as
  select
    extract(year from date_filed)::int as year,
    root_form,
    count(*)::bigint                   as filings
  from public.urc_sec_filings
  group by 1, 2;

create unique index if not exists urc_filing_year_form_pk
  on urc_filing_year_form (year, root_form);

comment on materialized view urc_filing_year_form is
  'Filing counts by year and root form. Refresh after each metadata ingest.';

-- Same signature as 012, so callers do not change; only the source does.
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
  with by_year as (
    select r.year, sum(r.filings)::bigint as filings
    from urc_filing_year_form r
    where p_cik is null
      and (p_forms is null or r.root_form = any(p_forms))
      -- Year granularity: a partial-year bound includes its whole year here,
      -- so callers wanting day precision must pass a CIK or accept the year.
      and (p_start is null or r.year >= extract(year from p_start)::int)
      and (p_end   is null or r.year <= extract(year from p_end)::int)
    group by r.year

    union all

    select extract(year from f.date_filed)::int as year, count(*)::bigint
    from public.urc_sec_filings f
    where p_cik is not null
      and f.cik = p_cik
      and (p_forms is null or f.root_form = any(p_forms))
      and (p_start is null or f.date_filed >= p_start)
      and (p_end   is null or f.date_filed <= p_end)
    group by 1
  )
  select
    by_year.year,
    by_year.filings,
    (select coalesce(sum(filings), 0) from by_year) as total_count
  from by_year
  order by by_year.year;
$$;

grant select on urc_filing_year_form to anon;
grant execute on function urc_filing_scope_stats(text[], date, date, bigint) to anon;
