-- 007: value-aware plans for urc_search_filings.
--
-- Found by the 1,000-point e2e suite after the 2010-2018 backfill took
-- urc_sec_filings to 4.09M rows: through PostgREST the function ran off
-- generic plans (parameter placeholders keep the planner from pruning the
-- `p_x is null or ...` branches), turning 60ms index scans into multi-second
-- sweeps that piled up into 17s+ statement timeouts under concurrency.
-- Direct psql calls inline with constants and were always fast — the
-- regression only shows on the production REST path.
--
-- Rewrite as plpgsql + EXECUTE: the WHERE clause is assembled from only the
-- parameters actually provided, so every call is planned with real values.
-- Signature and return shape are unchanged (same-signature replace — no
-- PostgREST overload ambiguity).

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

  return query execute
    'with filtered as ('
    || '  select f.accession, f.cik, f.company_name, f.form, f.root_form,'
    || '         f.is_amendment, f.date_filed, f.filename,'
    || '         a.firm_canonical as auditor, c.sic, c.sic_description, c.tickers'
    || '  from urc_sec_filings f'
    || '  left join urc_current_auditors a on a.issuer_cik = f.cik'
    || '  left join urc_sec_companies c on c.cik = f.cik'
    || '  where ' || conds
    || ') select *, count(*) over () as total_count'
    || '  from filtered'
    || '  order by date_filed desc, accession'
    || '  limit $7 offset $8'
  using p_forms, p_start, p_end, p_auditor, p_entity, p_sic, p_limit, p_offset;
end $$;
