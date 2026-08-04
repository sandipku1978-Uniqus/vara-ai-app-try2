-- 020_facet_browse_indexed.sql
--
-- WHY: the Dashboard's "Watchlist Filing Mix" click (Form 4 / 144 / 8-K)
-- navigates to /search?v=1&forms=4 — an empty-query facet browse. The route
-- correctly takes its facet path into urc_search_filings, and the RPC times
-- out: 8.5s-then-killed on a QUIET database for p_forms=['4'] over the full
-- window. The client then retries and falls back to paging live EDGAR ten
-- rows at a time through millions of Form 4s — the endless spinner Sandip
-- reported on production (2026-08-03).
--
-- ROOT CAUSE (009): the filter is `(f.form = any($1) OR f.root_form =
-- any($1))` — an OR across two columns with an index on only one of them
-- (urc_sec_filings_form_date_idx covers root_form, nothing covers form).
-- No ordered index walk is possible, so the newest-first browse sorts the
-- entire matching set. Both LEFT JOINs are also always attached, even when
-- no auditor/SIC condition needs them.
--
-- WHAT CHANGES:
--   1. p_forms is NORMALIZED to root families inside the function
--      ('10-K/A' -> '10-K'), and the filter becomes the single indexed
--      condition `f.root_form = any(...)`. Semantics: a form filter selects
--      the FAMILY, amendments included — which is what every existing
--      caller already passes (UI form options are root families; the e2e
--      suite passes root_form). Amendment identity remains visible per-row
--      via is_amendment.
--   2. Joins are attached only when a condition needs them (auditor / SIC).
--      The capped count subquery stops dragging two dead joins.
--   3. 018 conventions: pinned search_path, input clamps (limit 1..100,
--      offset 0..10000), and the version stamp.
--
-- With `root_form = any` + order by (date_filed desc, accession), the
-- planner can walk urc_sec_filings_form_date_idx (root_form, date_filed
-- desc) per family and merge — or the date_accession index directly — and
-- stop at the page size. No full-set sort.
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent.

drop function if exists urc_search_filings(text[], date, date, text, text, text, int, int, bigint);

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
)
language plpgsql stable
set search_path = pg_catalog, public
as $$
declare
  conds text := 'true';
  v_total bigint;
  v_joins text := ' from urc_sec_filings f';
  v_select_auditor text := 'null::text as auditor';
  v_select_company text := 'null::text as sic, null::text as sic_description, null::text[] as tickers';
  v_forms text[];
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if p_forms is not null then
    -- Normalize to root families: '10-K/A' -> '10-K'. One indexed column,
    -- one condition, ordered walks possible.
    select array_agg(distinct regexp_replace(upper(trim(x)), '/A$', ''))
      into v_forms
      from unnest(p_forms) as u(x)
      where trim(x) <> '';
    if v_forms is not null then
      conds := conds || ' and f.root_form = any($1)';
    end if;
  end if;
  if p_start is not null then
    conds := conds || ' and f.date_filed >= $2';
  end if;
  if p_end is not null then
    conds := conds || ' and f.date_filed <= $3';
  end if;
  if p_auditor is not null then
    v_joins := v_joins || ' left join urc_current_auditors_mat a on a.issuer_cik = f.cik';
    v_select_auditor := 'a.firm_canonical as auditor';
    if p_auditor = 'Big 4' then
      conds := conds || ' and a.firm_canonical in (''Deloitte'',''PwC'',''EY'',''KPMG'')';
    else
      conds := conds || ' and a.firm_canonical = $4';
    end if;
  end if;
  if p_cik is not null then
    conds := conds || ' and f.cik = $9';
  elsif p_entity is not null then
    conds := conds || ' and f.company_name ilike ''%'' || $5 || ''%''';
  end if;
  -- Company enrichment (sic/tickers) is part of the row shape every caller
  -- consumes, so the RESULT query always joins it — for p_limit rows that
  -- costs nothing. The capped COUNT subquery below attaches it only when a
  -- SIC condition actually filters on it.
  v_joins := v_joins || ' left join urc_sec_companies c on c.cik = f.cik';
  v_select_company := 'c.sic, c.sic_description, c.tickers';
  if p_sic is not null then
    conds := conds || ' and c.sic = $6';
  end if;

  -- Capped total (10,000 cap predates this migration; unchanged). The count
  -- subquery uses ONLY the filings table plus whichever join a condition
  -- actually references — auditor join only if $4 is set, company join only
  -- if $6 is set.
  execute 'select count(*) from (select 1 from urc_sec_filings f'
    || case when p_auditor is not null then ' left join urc_current_auditors_mat a on a.issuer_cik = f.cik' else '' end
    || case when p_sic is not null then ' left join urc_sec_companies c on c.cik = f.cik' else '' end
    || ' where ' || conds || ' limit 10000) t'
    into v_total
    using v_forms, p_start, p_end, p_auditor, p_entity, p_sic, v_limit, v_offset, p_cik;

  return query execute
    'select f.accession, f.cik, f.company_name, f.form, f.root_form,'
    || ' f.is_amendment, f.date_filed, f.filename,'
    || ' ' || v_select_auditor || ', ' || v_select_company || ','
    || ' ' || v_total || '::bigint as total_count'
    || v_joins
    || ' where ' || conds
    || ' order by f.date_filed desc, f.accession'
    || ' limit $7 offset $8'
  using v_forms, p_start, p_end, p_auditor, p_entity, p_sic, v_limit, v_offset, p_cik;
end $$;

do $$ begin
  execute 'revoke all on function urc_search_filings(text[], date, date, text, text, text, int, int, bigint) from public';
  execute 'grant execute on function urc_search_filings(text[], date, date, text, text, text, int, int, bigint) to anon, service_role';
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant execute on function urc_search_filings(text[], date, date, text, text, text, int, int, bigint) to urc_web';
  end if;
end $$;

insert into urc_schema_version (singleton, version) values (true, '020')
on conflict (singleton) do update set version = excluded.version, applied_at = now();

-- ── Probe (separate statements) ─────────────────────────────────────────────
-- 1. The dashboard's exact click, previously killed at ~8.5s:
--      select count(*) from urc_search_filings(array['4'], '2001-01-01', '2026-08-04', null, null, null, 100, 0, null);
--    Expect: 100 rows, well under 2s.
-- 2. Amendment-family semantics:
--      select distinct form from urc_search_filings(array['10-K'], '2025-01-01', null, null, null, null, 100, 0, null);
--    Expect: may include 10-K and 10-K/A — the family, amendments included.
-- 3. Auditor path unchanged:
--      select count(*) from urc_search_filings(array['10-K'], '2024-01-01', null, 'Deloitte', null, null, 20, 0, null);
--    Expect: 20 rows with auditor labels, fast.
-- 4. Version:
--      select urc_schema_version();  -- '020'
