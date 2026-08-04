-- 022_temporal_auditor_attribution.sql
--
-- A filing must not be labelled with an issuer's auditor today.  The former
-- facet join used urc_current_auditors_mat by CIK, which rewrote the auditor
-- on every historical SEC filing whenever the issuer changed firms.
--
-- Form AP does not publish an engagement-start date.  The defensible
-- evidence-effective rule is therefore:
--
--   use the latest non-superseded Form AP audit report whose audit_report_date
--   is on or before the SEC filing's date_filed.
--
-- The interval materialization below makes that rule explicit, prevents
-- future Form AP knowledge from leaking into old filings, and keeps auditor
-- facet searches indexed.  Consecutive annual reports by the same firm remain
-- separate evidence intervals so every result can be traced to one Form AP
-- filing.  A CIK is not enough to identify an investment-company series, and
-- an issuer/date can legitimately have more than one firm.  Those cases are
-- retained as evidence events but deliberately resolve to no scalar auditor;
-- search may fall back to the filing itself instead of inventing certainty.
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent. Apply AFTER 021 and in
-- the same release as the next provenance/attestation head migration.

-- Support the materialized-view refresh without repeatedly sorting the full
-- Form AP table by an index that was designed only for fiscal-period lookups.
alter table public.urc_sec_auditors
  add column if not exists audit_report_type text,
  add column if not exists audit_fund_series text;

create index if not exists urc_sec_auditors_temporal_idx
  on public.urc_sec_auditors (
    issuer_cik,
    audit_report_date,
    filing_date desc,
    fiscal_period_end desc,
    form_filing_id desc
  )
  where issuer_cik is not null
    and audit_report_date is not null
    and is_latest;

create materialized view if not exists public.urc_auditor_periods_mat as
with report_event as (
  select
    a.issuer_cik,
    a.audit_report_date,
    max(a.filing_date) as form_ap_filing_date,
    array_agg(a.form_filing_id order by a.form_filing_id) as form_filing_ids,
    array_agg(distinct a.firm_canonical order by a.firm_canonical)
      as auditor_candidates,
    array_agg(distinct a.firm_name order by a.firm_name) as firm_names,
    coalesce(
      array_agg(distinct a.fiscal_period_end order by a.fiscal_period_end)
        filter (where a.fiscal_period_end is not null),
      array[]::date[]
    ) as fiscal_period_ends,
    coalesce(
      array_agg(distinct a.audit_report_type order by a.audit_report_type)
        filter (where a.audit_report_type is not null and trim(a.audit_report_type) <> ''),
      array[]::text[]
    ) as audit_report_types,
    jsonb_agg(
      jsonb_build_object(
        'formFilingId', a.form_filing_id,
        'firmCanonical', a.firm_canonical,
        'firmName', a.firm_name,
        'fiscalPeriodEnd', a.fiscal_period_end,
        'auditReportType', a.audit_report_type
      )
      order by a.form_filing_id
    ) as source_rows,
    count(*)::integer as source_count,
    case
      when bool_or(a.audit_report_type is null or trim(a.audit_report_type) = '')
        then 'coverage_pending'
      when count(distinct lower(trim(a.audit_report_type))) <> 1
        or min(lower(trim(a.audit_report_type))) <>
          'issuer, other than employee benefit plan or investment company'
        then 'unsupported_entity_scope'
      when count(distinct a.firm_canonical) <> 1
        then 'ambiguous'
      else 'resolved'
    end as resolution_status,
    case
      when not bool_or(a.audit_report_type is null or trim(a.audit_report_type) = '')
        and count(distinct lower(trim(a.audit_report_type))) = 1
        and min(lower(trim(a.audit_report_type))) =
          'issuer, other than employee benefit plan or investment company'
        and count(distinct a.firm_canonical) = 1
        then min(a.firm_canonical)
      else null
    end as firm_canonical,
    case
      when not bool_or(a.audit_report_type is null or trim(a.audit_report_type) = '')
        and count(distinct lower(trim(a.audit_report_type))) = 1
        and min(lower(trim(a.audit_report_type))) =
          'issuer, other than employee benefit plan or investment company'
        and count(distinct a.firm_canonical) = 1
        then min(a.firm_name)
      else null
    end as firm_name
  from public.urc_sec_auditors a
  where a.issuer_cik is not null
    and a.audit_report_date is not null
    and a.is_latest
  group by a.issuer_cik, a.audit_report_date
), report_history as (
  select
    issuer_cik,
    audit_report_date as effective_from,
    lead(audit_report_date) over (
      partition by issuer_cik
      order by audit_report_date
    ) as effective_to,
    form_filing_ids,
    auditor_candidates,
    firm_names,
    fiscal_period_ends,
    audit_report_types,
    source_rows,
    source_count,
    firm_canonical,
    firm_name,
    audit_report_date,
    form_ap_filing_date,
    resolution_status
  from report_event
)
select * from report_history;

create unique index if not exists urc_auditor_periods_mat_pk
  on public.urc_auditor_periods_mat (issuer_cik, effective_from);

create index if not exists urc_auditor_periods_mat_firm_idx
  on public.urc_auditor_periods_mat (
    firm_canonical,
    issuer_cik,
    effective_from,
    effective_to
  )
  where resolution_status = 'resolved';

-- Keep issuer-profile "current auditor" surfaces honest as well. The former
-- DISTINCT ON view could choose arbitrarily among fund series or joint firms.
-- The latest interval is exposed only when the same ordinary-issuer evidence
-- rule resolved it; urc_current_auditors_mat picks this up on loader refresh.
create or replace view public.urc_current_auditors as
select
  issuer_cik,
  firm_canonical,
  firm_name,
  fiscal_period_ends[array_length(fiscal_period_ends, 1)] as fiscal_period_end
from public.urc_auditor_periods_mat
where effective_to is null
  and resolution_status = 'resolved';

alter view public.urc_current_auditors set (security_invoker = true);

-- The public-data web identities may read the derived evidence relation, but
-- cannot refresh it.  Explicit grants are required because migration 014
-- deliberately made default privileges closed for every later relation.
revoke all on table public.urc_auditor_periods_mat
  from public, anon, authenticated;
grant select on table public.urc_auditor_periods_mat
  to anon, service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'revoke all on table public.urc_auditor_periods_mat from urc_web';
    execute 'grant select on table public.urc_auditor_periods_mat to urc_web';
  end if;
end $$;

create or replace function public.urc_refresh_auditor_periods()
returns void language plpgsql security definer
set search_path = pg_catalog
set statement_timeout = '300s'
as $$
begin
  refresh materialized view concurrently public.urc_auditor_periods_mat;
end $$;

revoke all on function public.urc_refresh_auditor_periods()
  from public, anon, authenticated;
grant execute on function public.urc_refresh_auditor_periods()
  to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'revoke all on function public.urc_refresh_auditor_periods() from urc_web';
  end if;
end $$;

-- Batch resolver for EFTS candidates and fallback search paths.  Each input
-- row keeps its caller-provided key so co-filers and repeated CIKs on
-- different dates cannot be collapsed into a misleading issuer-level map.
create or replace function public.urc_resolve_filing_auditors(p_filings jsonb)
returns table (
  request_key text,
  cik bigint,
  file_date date,
  auditor text,
  auditor_firm_name text,
  auditor_candidates text[],
  auditor_firm_names text[],
  auditor_form_filing_ids bigint[],
  auditor_report_date date,
  auditor_fiscal_period_ends date[],
  auditor_report_types text[],
  auditor_source_rows jsonb,
  auditor_resolution_status text,
  auditor_basis text
)
language plpgsql stable
set search_path = pg_catalog, public
as $$
begin
  if p_filings is null then
    return;
  end if;
  if jsonb_typeof(p_filings) is distinct from 'array' then
    raise exception 'p_filings must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filings) > 5000 then
    raise exception 'p_filings is limited to 5000 entries' using errcode = '22023';
  end if;

  return query
  with requested as (
    select
      nullif(trim(item.value ->> 'key'), '') as request_key,
      case
        when item.value ->> 'cik' ~ '^[0-9]{1,10}$'
          then (item.value ->> 'cik')::bigint
        else null
      end as cik,
      case
        when item.value ->> 'file_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          then (item.value ->> 'file_date')::date
        else null
      end as file_date,
      item.ordinality
    from jsonb_array_elements(p_filings) with ordinality as item(value, ordinality)
  )
  select
    r.request_key,
    r.cik,
    r.file_date,
    a.firm_canonical,
    a.firm_name,
    coalesce(a.auditor_candidates, array[]::text[]),
    coalesce(a.firm_names, array[]::text[]),
    a.form_filing_ids,
    a.audit_report_date,
    coalesce(a.fiscal_period_ends, array[]::date[]),
    coalesce(a.audit_report_types, array[]::text[]),
    coalesce(a.source_rows, '[]'::jsonb),
    coalesce(a.resolution_status, 'no_prior_form_ap_report'),
    case when a.resolution_status = 'resolved'
      then 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date'::text
      else null::text
    end
  from requested r
  left join public.urc_auditor_periods_mat a
    on a.issuer_cik = r.cik
   and r.file_date >= a.effective_from
   and (a.effective_to is null or r.file_date < a.effective_to)
  where r.request_key is not null
    and r.cik is not null
    and r.file_date is not null
  order by r.ordinality;
end $$;

revoke all on function public.urc_resolve_filing_auditors(jsonb) from public;
grant execute on function public.urc_resolve_filing_auditors(jsonb)
  to anon, service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant execute on function public.urc_resolve_filing_auditors(jsonb) to urc_web';
  end if;
end $$;

-- Replace the current-issuer join introduced by 008/020.  The result query
-- always attaches the date-effective auditor to its bounded page so an
-- unfiltered browse carries honest provenance.  The capped count query joins
-- the interval relation only when an auditor predicate actually needs it.
drop function if exists public.urc_search_filings(
  text[], date, date, text, text, text, int, int, bigint
);

create function public.urc_search_filings(
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
  v_forms text[];
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_auditor_join text :=
    ' left join public.urc_auditor_periods_mat a'
    || ' on a.issuer_cik = f.cik'
    || ' and f.date_filed >= a.effective_from'
    || ' and (a.effective_to is null or f.date_filed < a.effective_to)';
  v_auditor_filter_join text :=
    ' inner join public.urc_auditor_periods_mat a'
    || ' on a.issuer_cik = f.cik'
    || ' and a.resolution_status = ''resolved'''
    || ' and f.date_filed >= a.effective_from'
    || ' and (a.effective_to is null or f.date_filed < a.effective_to)';
  v_company_join text :=
    ' left join public.urc_sec_companies c on c.cik = f.cik';
begin
  if p_forms is not null then
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
    if p_auditor = 'Big 4' then
      conds := conds
        || ' and a.firm_canonical in (''Deloitte'',''PwC'',''EY'',''KPMG'')';
    else
      conds := conds || ' and a.firm_canonical = $4';
    end if;
  end if;
  if p_cik is not null then
    conds := conds || ' and f.cik = $9';
  elsif p_entity is not null then
    conds := conds || ' and f.company_name ilike ''%'' || $5 || ''%''';
  end if;
  if p_sic is not null then
    conds := conds || ' and c.sic = $6';
  end if;

  execute 'select count(*) from (select 1 from public.urc_sec_filings f'
    || case when p_auditor is not null then v_auditor_filter_join else '' end
    || case when p_sic is not null then v_company_join else '' end
    || ' where ' || conds || ' limit 10000) t'
    into v_total
    using v_forms, p_start, p_end, p_auditor, p_entity, p_sic,
          v_limit, v_offset, p_cik;

  return query execute
    'select f.accession, f.cik, f.company_name, f.form, f.root_form,'
    || ' f.is_amendment, f.date_filed, f.filename,'
    || ' a.firm_canonical as auditor, c.sic, c.sic_description, c.tickers,'
    || ' ' || v_total || '::bigint as total_count'
    || ' from public.urc_sec_filings f'
    || v_auditor_join
    || v_company_join
    || ' where ' || conds
    || ' order by f.date_filed desc, f.accession'
    || ' limit $7 offset $8'
  using v_forms, p_start, p_end, p_auditor, p_entity, p_sic,
        v_limit, v_offset, p_cik;
end $$;

revoke all on function public.urc_search_filings(
  text[], date, date, text, text, text, int, int, bigint
) from public;
grant execute on function public.urc_search_filings(
  text[], date, date, text, text, text, int, int, bigint
) to anon, service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant execute on function public.urc_search_filings(text[], date, date, text, text, text, int, int, bigint) to urc_web';
  end if;
end $$;

-- Refresh PostgREST's function catalog after the new resolver appears.
notify pgrst, 'reload schema';

-- The following migration is the release's chain-provenance head and stamps
-- both 022 and its independent live-state attestation.  Applying 022 without
-- that head intentionally leaves the repository/schema provenance gate red.
