-- 009: exact-issuer facet browse.
--
-- Entity-resolved searches know the CIK; matching by company-name ILIKE is
-- an approximation (generic names collide, suffixes need normalizing). Add
-- p_cik so resolved browses and the full-directory ticker coverage test
-- assert exact issuer identity. Same-signature-extension: PostgREST treats
-- added defaulted params as the same function only if the old signature is
-- dropped first (overload ambiguity otherwise).

drop function if exists urc_search_filings(text[], date, date, text, text, text, int, int);

create function urc_search_filings(
  p_forms      text[] default null,
  p_start      date   default null,
  p_end        date   default null,
  p_auditor    text   default null,
  p_entity     text   default null,
  p_sic        text   default null,
  p_limit      int    default 20,
  p_offset     int    default 0,
  p_cik        bigint default null
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
  if p_cik is not null then
    -- Exact issuer beats the name approximation entirely
    conds := conds || ' and f.cik = $9';
  elsif p_entity is not null then
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

  execute 'select count(*) from (select 1' || v_joins || ' limit 10000) t'
    into v_total
    using p_forms, p_start, p_end, p_auditor, p_entity, p_sic, p_limit, p_offset, p_cik;

  return query execute
    'select f.accession, f.cik, f.company_name, f.form, f.root_form,'
    || ' f.is_amendment, f.date_filed, f.filename,'
    || ' a.firm_canonical as auditor, c.sic, c.sic_description, c.tickers,'
    || ' ' || v_total || '::bigint as total_count'
    || v_joins
    || ' order by f.date_filed desc, f.accession'
    || ' limit $7 offset $8'
  using p_forms, p_start, p_end, p_auditor, p_entity, p_sic, p_limit, p_offset, p_cik;
end $$;
