-- 008: materialize the current-auditor lookup.
--
-- Second finding from the 1,000-point e2e suite: urc_current_auditors is a
-- DISTINCT ON view over 148K Form AP rows. Whenever the planner picks a
-- nested loop (it misestimates selective entity/date filters as ~1 row),
-- the whole view is recomputed once per outer row — the BlackRock
-- SCHEDULE 13G case re-ran it 295 times for a 49s response.
--
-- A materialized view with a unique index turns that inner side into a
-- plain index probe. The weekly auditor load refreshes it via
-- urc_refresh_current_auditors() (concurrently, so reads never block).

create materialized view if not exists urc_current_auditors_mat as
select issuer_cik, firm_canonical, firm_name, fiscal_period_end
from urc_current_auditors;

create unique index if not exists urc_current_auditors_mat_pk
  on urc_current_auditors_mat (issuer_cik);

-- Refresh hook for the auditor loader (service role calls this after upserts)
create or replace function public.urc_refresh_current_auditors()
returns void language plpgsql security definer
set search_path = pg_catalog
set statement_timeout = '300s' as $$
begin
  refresh materialized view concurrently public.urc_current_auditors_mat;
end $$;

revoke all on function public.urc_refresh_current_auditors() from public, anon, authenticated;
grant execute on function public.urc_refresh_current_auditors() to service_role;

-- Point facet search at the materialized lookup (same signature — replace)
create or replace function urc_search_filings(
  p_forms      text[] default null,
  p_start      date   default null,
  p_end        date   default null,
  p_auditor    text   default null,
  p_entity     text   default null,
  p_sic        text   default null,
  p_limit      int    default 20,
  p_offset     int    default 0
) returns table (
  accession text, cik bigint, company_name text, form text, root_form text,
  is_amendment boolean, date_filed date, filename text,
  auditor text, sic text, sic_description text, tickers text[],
  total_count bigint
) language plpgsql stable as $$
declare
  conds text := 'true';
  v_total bigint;
  v_joins text;
begin
  if p_forms is not null then
    conds := conds || ' and (f.form = any($1) or f.root_form = any($1))';
  end if;
  if p_start is not null then
    conds := conds || ' and f.date_filed >= $2';
  end if;
  if p_end is not null then
    conds := conds || ' and f.date_filed <= $3';
  end if;
  if p_auditor is not null then
    if p_auditor = 'Big 4' then
      conds := conds || ' and a.firm_canonical in (''Deloitte'',''PwC'',''EY'',''KPMG'')';
    else
      conds := conds || ' and a.firm_canonical = $4';
    end if;
  end if;
  if p_entity is not null then
    conds := conds || ' and f.company_name ilike ''%'' || $5 || ''%''';
  end if;
  if p_sic is not null then
    conds := conds || ' and c.sic = $6';
  end if;

  v_joins :=
    ' from urc_sec_filings f'
    || ' left join urc_current_auditors_mat a on a.issuer_cik = f.cik'
    || ' left join urc_sec_companies c on c.cik = f.cik'
    || ' where ' || conds;

  -- Total is capped at 10,000 (EFTS-consistent — the UI already renders
  -- capped totals). A windowed count(*) over () forced a full scan of every
  -- match: 20s for an unfiltered browse of 4M rows.
  execute 'select count(*) from (select 1' || v_joins || ' limit 10000) t'
    into v_total
    using p_forms, p_start, p_end, p_auditor, p_entity, p_sic, p_limit, p_offset;

  return query execute
    'select f.accession, f.cik, f.company_name, f.form, f.root_form,'
    || ' f.is_amendment, f.date_filed, f.filename,'
    || ' a.firm_canonical as auditor, c.sic, c.sic_description, c.tickers,'
    || ' ' || v_total || '::bigint as total_count'
    || v_joins
    || ' order by f.date_filed desc, f.accession'
    || ' limit $7 offset $8'
  using p_forms, p_start, p_end, p_auditor, p_entity, p_sic, p_limit, p_offset;
end $$;

-- Newest-first ordering index: every facet browse sorts by date_filed desc,
-- but only composite (form, date) indexes existed — an unfiltered browse had
-- to sort 4M rows (4.7s). Matches the ORDER BY exactly.
create index if not exists urc_sec_filings_date_accession_idx
  on urc_sec_filings (date_filed desc, accession);
