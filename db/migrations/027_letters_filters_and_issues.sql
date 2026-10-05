-- 027_letters_filters_and_issues.sql
--
-- WHY (gap analysis 2026-10-04, row 5 / recommendation 5): comment-letter
-- research could be narrowed by letter type and registrant name only. "What
-- has the Staff asked about segment reporting since ASU 2023-07?" needs a
-- date window; "what did the Staff ask in S-1 reviews of biotech issuers?"
-- needs the reviewed filing form and the issuer's industry. None of those
-- reached urc_search_letters, and a resolved company could not narrow a
-- full-text search by CIK at all (the UI had to fall back to a registrant
-- name pattern and say so). Separately, letters were never split into the
-- Staff's numbered comments, so "which response worked?" had no stored
-- answer.
--
-- WHAT CHANGES
--   1. urc_letter_facets — one row per letter whose text has been read for
--      the filing form it concerns (the "Re:" block of a Staff letter or a
--      response names it: "Form 10-K for the fiscal year ended ...").
--      Derived by the ingest pipeline from the stored text
--      (src/services/commentLetterForms.ts), never guessed: an empty array
--      means the text was read and named no form; a missing row means the
--      letter has not been read yet. The basis line is stored beside the
--      result so the UI can show where a form came from. A side table, not a
--      column, because every UPDATE of urc_comment_letters recomputes its
--      stored to_tsvector over up to 700K characters.
--   2. urc_letters_needing_facets(...) — service-only keyset reader the
--      pipeline uses to backfill facets newest-first.
--   3. urc_letter_issues — the issue-level split of each Staff letter in an
--      episode (numbered comment, filing section, paired response, follow-
--      ups, evidence-based status), keyed by episode and Staff-letter
--      accession, written by the audited service-role cache writer the same
--      way urc_thread_summaries is, and regenerated when the episode's
--      letter set or text changes (episode_fingerprint) or the parser
--      changes (parser_version).
--   4. urc_search_letters gains p_cik, p_sic and p_reviewed_forms. The old
--      seven-argument signature is DROPPED, not overloaded: PostgREST picks
--      a function by the named arguments supplied, and two candidates that
--      both accept the original seven names would be ambiguous (PGRST203).
--      The route sends the new arguments only when a filter is set, so a
--      seven-argument call resolves to this function through its defaults.
--      Every 016-018 guarantee is kept verbatim: GIN-driven match set,
--      deterministic newest-first candidates capped at 10,001 (the "10,000+"
--      sentinel of 017), a 1,000-deep ranking pool, ts_headline only on the
--      returned page, input clamps, pinned search_path.
--      New: a filter-only mode. With a blank query and at least one
--      structured filter, the same capped, deterministic candidate set is
--      taken in date order (rank 0) through the new date index, so "every
--      Staff letter on an S-1 for SIC 2834 since 2024" no longer needs a
--      text query. A blank query with no filter still returns nothing. The
--      two branches are gated by parameter-only predicates, which Postgres
--      evaluates once as a one-time filter; the branch not taken does no
--      work.
--   5. urc_letters_date_idx (date_filed desc, accession, cik) serves the
--      filter-only branch and the facet backfill keyset.
--
-- WEB READ CONTRACT (014): both new tables are public SEC-derived data —
-- SELECT for anon/urc_web with an unconditional RLS read policy, every
-- write path revoked from web identities; the service-role cache writer and
-- the pipeline write. authenticated gets nothing (023 contract).
--
-- APPLY: Supabase SQL editor, as postgres, AFTER 026. Idempotent; forward-
-- only. Reloads the PostgREST schema cache at the end. The application
-- release that sends p_cik/p_sic/p_reviewed_forms must ship with (or after)
-- this migration; seven-argument calls keep working either side of it.

-- ── 1. Facets: the filing form each letter concerns ─────────────────────────
create table if not exists public.urc_letter_facets (
  accession            text not null,
  cik                  bigint not null,
  -- Canonical root forms named in the letter's "Re:" block, e.g. {10-K,10-Q}.
  -- Empty = the text was read and names no recognised form.
  reviewed_forms       text[] not null default '{}',
  -- The "Re:" text the forms were read from (bounded), for display.
  reviewed_forms_basis text,
  derivation_version   smallint not null,
  derived_at           timestamptz not null default now(),
  primary key (accession, cik),
  constraint urc_letter_facets_letter_fk
    foreign key (accession, cik)
    references public.urc_comment_letters (accession, cik)
    on delete cascade,
  constraint urc_letter_facets_basis_len check (
    reviewed_forms_basis is null or length(reviewed_forms_basis) <= 400
  ),
  constraint urc_letter_facets_forms_len check (cardinality(reviewed_forms) <= 12)
);

create index if not exists urc_letter_facets_forms_idx
  on public.urc_letter_facets using gin (reviewed_forms);

alter table public.urc_letter_facets enable row level security;

-- ── 2. Issue-level split, stored per episode and Staff letter ──────────────
create table if not exists public.urc_letter_issues (
  thread_id           text not null,
  staff_accession     text not null,
  cik                 bigint not null,
  staff_date          date not null,
  -- CommentIssue[] (src/services/commentIssues.ts) for this Staff letter.
  issues              jsonb not null,
  parser_version      smallint not null,
  -- sha256 over the episode's (accession, form, date, text) set; a change in
  -- any letter or its text makes every row of the episode stale.
  episode_fingerprint text not null,
  generated_at        timestamptz not null default now(),
  primary key (thread_id, staff_accession),
  constraint urc_letter_issues_array check (jsonb_typeof(issues) = 'array'),
  constraint urc_letter_issues_fingerprint check (episode_fingerprint ~ '^[0-9a-f]{64}$')
);

alter table public.urc_letter_issues enable row level security;

-- ── 3. Web read contract for the new tables (014 pattern) ──────────────────
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array['urc_letter_facets', 'urc_letter_issues'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', relation_name);
    execute format('grant select on public.%I to anon', relation_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation_name);
    execute format('drop policy if exists anon_read on public.%I', relation_name);
    execute format('create policy anon_read on public.%I for select to anon using (true)', relation_name);
    if exists (select 1 from pg_roles where rolname = 'urc_web') then
      execute format('revoke all on public.%I from urc_web', relation_name);
      execute format('grant select on public.%I to urc_web', relation_name);
      execute format('drop policy if exists urc_web_read on public.%I', relation_name);
      execute format('create policy urc_web_read on public.%I for select to urc_web using (true)', relation_name);
    end if;
  end loop;
end $$;

-- ── 4. Date-ordered index for filter-only search and the facet keyset ──────
create index if not exists urc_letters_date_idx
  on public.urc_comment_letters (date_filed desc, accession, cik);

-- ── 5. Facet backfill reader (service role only) ───────────────────────────
-- Newest-first keyset over letters with text whose facets are missing or
-- were derived by an older version of the reader. The pipeline passes the
-- last (date_filed, accession, cik) it saw; the head of the text is enough
-- because the "Re:" block sits in the letter header.
create or replace function public.urc_letters_needing_facets(
  p_limit          int      default 500,
  p_version        smallint default 1,
  p_before_date    date     default null,
  p_after_accession text    default null,
  p_after_cik      bigint   default null
) returns table (accession text, cik bigint, date_filed date, head text)
language sql stable
set search_path = pg_catalog, public
as $$
  select l.accession, l.cik, l.date_filed, left(l.content, 8000) as head
  from urc_comment_letters l
  where l.content is not null
    and (
      p_before_date is null
      or l.date_filed < p_before_date
      or (
        l.date_filed = p_before_date
        and (l.accession, l.cik) > (coalesce(p_after_accession, ''), coalesce(p_after_cik, -1))
      )
    )
    and not exists (
      select 1 from urc_letter_facets f
      where f.accession = l.accession and f.cik = l.cik
        and f.derivation_version >= p_version
    )
  order by l.date_filed desc, l.accession, l.cik
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function public.urc_letters_needing_facets(int, smallint, date, text, bigint)
  from public, anon, authenticated;
grant execute on function public.urc_letters_needing_facets(int, smallint, date, text, bigint)
  to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'revoke all on function public.urc_letters_needing_facets(int, smallint, date, text, bigint) from urc_web';
  end if;
end $$;

-- ── 6. urc_search_letters with date, CIK, industry and reviewed-form filters ─
drop function if exists public.urc_search_letters(text, text, date, date, integer, integer, text);

create or replace function public.urc_search_letters(
  p_query          text,
  p_form           text    default null,
  p_start          date    default null,
  p_end            date    default null,
  p_limit          int     default 20,
  p_offset         int     default 0,
  p_company        text    default null,
  p_cik            bigint  default null,
  p_sic            text    default null,
  p_reviewed_forms text[]  default null
) returns table (
  accession text, cik bigint, company_name text, form text, date_filed date,
  thread_id text, filename text, headline text, rank real, total_count bigint
)
language sql stable
set search_path = pg_catalog, public
as $$
  with q as (
    select websearch_to_tsquery('english', left(coalesce(p_query, ''), 400)) as tsq
  ),
  hits as materialized (
    -- Text branch (016-018 unchanged): GIN-driven match set, deterministic
    -- global newest-first order BEFORE the 10,001 cap.
    (
      select l.accession, l.cik, l.company_name, l.form, l.date_filed,
             l.thread_id, l.filename
      from urc_comment_letters l, q
      where nullif(btrim(coalesce(p_query, '')), '') is not null
        and l.fts @@ q.tsq
        and (p_form is null or l.form = p_form)
        and (p_start is null or l.date_filed >= p_start)
        and (p_end is null or l.date_filed <= p_end)
        and (p_company is null or l.company_name ilike '%' || p_company || '%')
        and (p_cik is null or l.cik = p_cik)
        and (p_sic is null or exists (
          select 1 from urc_sec_companies c
          where c.cik = l.cik and c.sic in (p_sic, ltrim(p_sic, '0'))
        ))
        and (coalesce(cardinality(p_reviewed_forms), 0) = 0 or exists (
          select 1 from urc_letter_facets f
          where f.accession = l.accession and f.cik = l.cik
            and f.reviewed_forms && p_reviewed_forms[1:12]
        ))
      order by l.date_filed desc, l.accession, l.cik
      limit 10001
    )
    union all
    -- Filter-only branch: no query text, at least one structured filter.
    -- Same cap and order, served by urc_letters_date_idx.
    (
      select l.accession, l.cik, l.company_name, l.form, l.date_filed,
             l.thread_id, l.filename
      from urc_comment_letters l
      where nullif(btrim(coalesce(p_query, '')), '') is null
        and (
          p_form is not null or p_start is not null or p_end is not null
          or p_company is not null or p_cik is not null or p_sic is not null
          or coalesce(cardinality(p_reviewed_forms), 0) > 0
        )
        and (p_form is null or l.form = p_form)
        and (p_start is null or l.date_filed >= p_start)
        and (p_end is null or l.date_filed <= p_end)
        and (p_company is null or l.company_name ilike '%' || p_company || '%')
        and (p_cik is null or l.cik = p_cik)
        and (p_sic is null or exists (
          select 1 from urc_sec_companies c
          where c.cik = l.cik and c.sic in (p_sic, ltrim(p_sic, '0'))
        ))
        and (coalesce(cardinality(p_reviewed_forms), 0) = 0 or exists (
          select 1 from urc_letter_facets f
          where f.accession = l.accession and f.cik = l.cik
            and f.reviewed_forms && p_reviewed_forms[1:12]
        ))
      order by l.date_filed desc, l.accession, l.cik
      limit 10001
    )
  ),
  pool as materialized (
    -- The ranking pool is the head of the newest-first candidates.
    select * from hits
    order by date_filed desc, accession, cik
    limit 1000
  ),
  ranked as (
    select p.accession, p.cik, p.company_name, p.form, p.date_filed,
           p.thread_id, p.filename,
           case when nullif(btrim(coalesce(p_query, '')), '') is not null
                then ts_rank(l.fts, q.tsq)
                else 0::real
           end as rank
    from pool p
    join urc_comment_letters l on l.accession = p.accession and l.cik = p.cik
    cross join q
  ),
  page as (
    select * from ranked
    order by rank desc, date_filed desc, accession, cik
    limit least(greatest(p_limit, 1), 100)
    offset least(greatest(p_offset, 0), 1000)
  )
  select pg.accession, pg.cik, pg.company_name, pg.form, pg.date_filed,
         pg.thread_id, pg.filename,
         case when nullif(btrim(coalesce(p_query, '')), '') is not null
              then ts_headline('english', left(coalesce(l.content, ''), 20000), q.tsq,
                               'MaxFragments=2, MaxWords=30, MinWords=10')
              else left(regexp_replace(left(coalesce(l.content, ''), 1200), '\s+', ' ', 'g'), 280)
         end as headline,
         pg.rank,
         (select count(*) from hits) as total_count
  from page pg
  join urc_comment_letters l on l.accession = pg.accession and l.cik = pg.cik
  cross join q
  order by pg.rank desc, pg.date_filed desc, pg.accession, pg.cik;
$$;

-- Read RPC grants, restated for the new signature (014 pattern).
revoke all on function public.urc_search_letters(text, text, date, date, integer, integer, text, bigint, text, text[])
  from public, anon, authenticated;
grant execute on function public.urc_search_letters(text, text, date, date, integer, integer, text, bigint, text, text[])
  to anon, service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute 'grant execute on function public.urc_search_letters(text, text, date, date, integer, integer, text, bigint, text, text[]) to urc_web';
  end if;
end $$;

-- ── 7. Attest what this migration promises before stamping ─────────────────
do $$
declare
  definition text;
begin
  if pg_catalog.to_regprocedure('public.urc_search_letters(text,text,date,date,integer,integer,text)') is not null then
    raise exception '027: the seven-argument urc_search_letters overload still exists';
  end if;
  select lower(pg_catalog.pg_get_functiondef(
    'public.urc_search_letters(text,text,date,date,integer,integer,text,bigint,text,text[])'::regprocedure
  )) into definition;
  if position('order by l.date_filed desc, l.accession, l.cik' in definition) = 0
     or position('limit 10001' in definition) = 0
     or position('limit 1000' in definition) = 0
     or position('least(greatest(p_limit, 1), 100)' in definition) = 0
     or position('least(greatest(p_offset, 0), 1000)' in definition) = 0 then
    raise exception '027: deterministic/bounded letter search guarantees are absent';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.urc_search_letters(text,text,date,date,integer,integer,text,bigint,text,text[])'::regprocedure
      and coalesce(p.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public']
  ) then
    raise exception '027: urc_search_letters lacks its pinned search_path';
  end if;
  if not pg_catalog.has_function_privilege('anon', 'public.urc_search_letters(text,text,date,date,integer,integer,text,bigint,text,text[])', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.urc_search_letters(text,text,date,date,integer,integer,text,bigint,text,text[])', 'execute') then
    raise exception '027: urc_search_letters execute grants are wrong';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.urc_letters_needing_facets(integer,smallint,date,text,bigint)', 'execute') then
    raise exception '027: the facet backfill reader is executable by anon';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.urc_letter_issues', 'insert')
     or pg_catalog.has_table_privilege('anon', 'public.urc_letter_facets', 'update')
     or pg_catalog.has_table_privilege('authenticated', 'public.urc_letter_issues', 'select') then
    raise exception '027: web identities hold a write or authenticated read on a new table';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── Probe (separate statements) ─────────────────────────────────────────────
-- 1. Unchanged sentinel through seven named arguments:
--      select total_count from urc_search_letters('fair value', null, null, null, 1, 0, null) limit 1;
--    Expect: 10001.
-- 2. Date window + industry:
--      select count(*), min(date_filed) from urc_search_letters('segment', 'UPLOAD', '2024-01-01', null, 100, 0, null, null, '2834', null);
--    Expect: rows on or after 2024-01-01 only, every cik with SIC 2834.
-- 3. Filter-only mode is bounded and date ordered:
--      select date_filed from urc_search_letters('', 'UPLOAD', '2025-01-01', null, 5, 0, null, null, null, array['S-1']);
--    Expect: five newest S-1 Staff letters since 2025 (once facets are backfilled).
-- 4. Blank query, no filter: zero rows.
--      select count(*) from urc_search_letters('', null, null, null, 5, 0, null);

-- BEGIN URC PROVENANCE STAMP
-- Generated by: node scripts/schema-provenance.mjs
insert into public.urc_schema_version (
  singleton, version, migration_count, chain_checksum, checksum_algorithm
) values (
  true,
  '027',
  28,
  -- URC CHAIN CHECKSUM VALUE
  '99cc91f73d7b38e972426441cc130d499813676c54430cd5e55aefcf74b016a3',
  'sha256-v2'
)
on conflict (singleton) do update set
  version = excluded.version,
  migration_count = excluded.migration_count,
  chain_checksum = excluded.chain_checksum,
  checksum_algorithm = excluded.checksum_algorithm,
  applied_at = now();
