-- Uniqus Research Center — SEC metadata/facet layer
-- Replaces the deleted Elastic Cloud cluster with a lightweight Postgres store:
-- full-text search stays on EDGAR EFTS (free); this holds the facets EFTS
-- lacks (auditor, exact form/date/company filters) from free structured
-- sources (EDGAR master.idx, PCAOB Form AP dataset).
--
-- Apply in the Supabase SQL editor (or psql). Tables are urc_-prefixed so the
-- layer can live inside a shared Supabase project without collisions.

create extension if not exists pg_trgm;

-- ── Filing metadata (source: EDGAR full-index master.idx) ──────────────────
create table if not exists urc_sec_filings (
  -- One row per (filing, filer): master.idx lists co-filers (e.g. SC 13D
  -- subject + filing person) as separate lines sharing one accession.
  accession     text not null,             -- 0000320193-26-000001
  cik           bigint not null,
  primary key (accession, cik),
  company_name  text not null,
  form          text not null,             -- 10-K/A, DEF 14A, SCHEDULE 13D...
  root_form     text not null,             -- form with /A stripped
  is_amendment  boolean not null default false,
  date_filed    date not null,
  filename      text not null              -- edgar/data/... path from master.idx
);

create index if not exists urc_sec_filings_form_date_idx
  on urc_sec_filings (root_form, date_filed desc);
create index if not exists urc_sec_filings_cik_date_idx
  on urc_sec_filings (cik, date_filed desc);
create index if not exists urc_sec_filings_company_trgm_idx
  on urc_sec_filings using gin (company_name gin_trgm_ops);

-- ── Auditor engagements (source: PCAOB Form AP FirmFilings.csv) ────────────
create table if not exists urc_sec_auditors (
  form_filing_id    bigint primary key,    -- PCAOB "Form Filing ID"
  is_latest         boolean not null,      -- "Latest Form AP Filing"
  firm_id           bigint,
  firm_name         text not null,
  firm_canonical    text not null,         -- normalized: Deloitte / EY / KPMG / PwC / GT / BDO / ...
  firm_country      text,
  issuer_cik        bigint,                -- null when issuer has no CIK
  issuer_name       text,
  audit_report_date date,
  fiscal_period_end date,
  filing_date       date
);

create index if not exists urc_sec_auditors_issuer_idx
  on urc_sec_auditors (issuer_cik, fiscal_period_end desc);
create index if not exists urc_sec_auditors_firm_idx
  on urc_sec_auditors (firm_canonical) where is_latest;

-- ── Company enrichment (lazily populated from EDGAR submissions) ───────────
create table if not exists urc_sec_companies (
  cik                    bigint primary key,
  name                   text,
  tickers                text[] default '{}',
  exchanges              text[] default '{}',
  sic                    text,
  sic_description        text,
  state_of_incorporation text,
  filer_category         text,             -- from dei:EntityFilerCategory when known
  updated_at             timestamptz not null default now()
);

create index if not exists urc_sec_companies_sic_idx on urc_sec_companies (sic);

-- ── Convenience view: current auditor per issuer ───────────────────────────
create or replace view urc_current_auditors as
select distinct on (issuer_cik)
  issuer_cik, firm_canonical, firm_name, fiscal_period_end
from urc_sec_auditors
where issuer_cik is not null and is_latest
order by issuer_cik, fiscal_period_end desc nulls last;

-- ── Facet-browse search (no text query): join filings ⋈ auditors ⋈ companies
--    server-side so the API doesn't ship thousands of CIKs over REST ────────
create or replace function urc_search_filings(
  p_forms      text[] default null,   -- matches form OR root_form
  p_start      date   default null,
  p_end        date   default null,
  p_auditor    text   default null,   -- canonical label (Deloitte/EY/...) — 'Big 4' matches any of the four
  p_entity     text   default null,   -- company-name substring (trigram-assisted)
  p_sic        text   default null,
  p_limit      int    default 20,
  p_offset     int    default 0
) returns table (
  accession text, cik bigint, company_name text, form text, root_form text,
  is_amendment boolean, date_filed date, filename text,
  auditor text, sic text, sic_description text, tickers text[],
  total_count bigint
) language sql stable as $$
  with filtered as (
    select f.*, a.firm_canonical as auditor, c.sic, c.sic_description, c.tickers
    from urc_sec_filings f
    left join urc_current_auditors a on a.issuer_cik = f.cik
    left join urc_sec_companies c on c.cik = f.cik
    where (p_forms is null or f.form = any(p_forms) or f.root_form = any(p_forms))
      and (p_start is null or f.date_filed >= p_start)
      and (p_end is null or f.date_filed <= p_end)
      and (p_auditor is null
           or a.firm_canonical = p_auditor
           or (p_auditor = 'Big 4' and a.firm_canonical in ('Deloitte','PwC','EY','KPMG')))
      and (p_entity is null or f.company_name ilike '%' || p_entity || '%')
      and (p_sic is null or c.sic = p_sic)
  )
  select *, count(*) over () as total_count
  from filtered
  order by date_filed desc, accession
  limit p_limit offset p_offset;
$$;

-- PostgREST (service role bypasses RLS, but enable RLS so anon key sees nothing)
alter table urc_sec_filings  enable row level security;
alter table urc_sec_auditors enable row level security;
alter table urc_sec_companies enable row level security;
