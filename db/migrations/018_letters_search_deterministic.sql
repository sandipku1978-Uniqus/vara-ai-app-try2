-- 018_letters_search_deterministic.sql
--
-- Forward fix for the flaw the readiness audit correctly flagged in 017
-- (R0): `hits ... limit 10001` had NO ORDER BY, so for terms with more than
-- 10,001 matches Postgres was free to pick an ARBITRARY subset before the
-- "most recent" pool was selected. First-page results for broad terms were
-- neither globally recent nor deterministic across runs. 017 is already
-- applied in production, so this replaces it rather than history-rewriting.
--
-- WHAT CHANGES vs 017:
--   1. DETERMINISTIC CANDIDATES: the capped hit set is the top 10,001 of the
--      GLOBAL match set ordered by date_filed DESC with stable tie-breakers
--      (accession, cik). Repeated queries return identical pages.
--   2. total_count semantics unchanged: exact up to 10,000; 10,001 is the
--      "more than 10,000" sentinel the route translates to totalIsFloor.
--   3. INPUT CLAMPS inside the RPC (audit R0): the publishable key can call
--      this without the application route, so the route's discipline is not
--      a boundary. p_query is capped at 400 chars, p_limit at 1..100,
--      p_offset at 0..1000 (the pool depth).
--   4. SET search_path = pg_catalog, public — pinned per audit R0 so later
--      schema/object shadowing cannot redirect what this function reads.
--
-- COST NOTE: ordering before the cap means the top-N sort sees every match
-- (top-N heapsort over narrow rows — no content/tsvector detoast). Measured
-- corpus: "fair value" = 43,626 matches; the expensive stages (ts_rank pool
-- of 1,000, ts_headline on the page) are unchanged from 017.
--
-- PAGINATION CONTRACT (enforced with the route change shipped alongside):
--   - supported offsets are 0..999 (the ranked pool depth);
--   - an empty page inside the supported range still reports the TRUE total
--     (the route re-queries page 0 for the total instead of fabricating 0);
--   - offsets >= 1000 are rejected by the route with HTTP 422 and coverage
--     metadata, never an empty 200 that reads as "no matches".
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent; signature unchanged.

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
)
language sql stable
set search_path = pg_catalog, public
as $$
  with q as (
    select websearch_to_tsquery('english', left(coalesce(p_query, ''), 400)) as tsq
  ),
  hits as materialized (
    select l.accession, l.cik, l.company_name, l.form, l.date_filed,
           l.thread_id, l.filename
    from urc_comment_letters l, q
    where l.fts @@ q.tsq
      and (p_form is null or l.form = p_form)
      and (p_start is null or l.date_filed >= p_start)
      and (p_end is null or l.date_filed <= p_end)
      and (p_company is null or l.company_name ilike '%' || p_company || '%')
    -- Deterministic global order BEFORE the cap: newest first, stable
    -- tie-breakers. This is the 017 fix.
    order by l.date_filed desc, l.accession, l.cik
    limit 10001
  ),
  pool as materialized (
    -- hits is already newest-first; the ranking pool is its head.
    select * from hits limit 1000
  ),
  ranked as (
    select p.accession, p.cik, p.company_name, p.form, p.date_filed,
           p.thread_id, p.filename, ts_rank(l.fts, q.tsq) as rank
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
         ts_headline('english', left(coalesce(l.content, ''), 20000), q.tsq,
                     'MaxFragments=2, MaxWords=30, MinWords=10') as headline,
         pg.rank,
         (select count(*) from hits) as total_count
  from page pg
  join urc_comment_letters l on l.accession = pg.accession and l.cik = pg.cik
  cross join q
  order by pg.rank desc, pg.date_filed desc, pg.accession, pg.cik;
$$;

-- ── Probe (separate statements, per the 014 lesson) ─────────────────────────
-- 1. Determinism (the 017 flaw — run TWICE, results must be identical):
--      select accession, date_filed from urc_search_letters('fair value', null, null, null, 5, 0, null);
--    Expect: same 5 rows both times, and dates should be RECENT (2025-2026),
--    not an arbitrary vintage.
-- 2. Sentinel unchanged:
--      select total_count from urc_search_letters('fair value', null, null, null, 1, 0, null) limit 1;
--    Expect: 10001.
-- 3. Rare-topic exactness unchanged:
--      select total_count from urc_search_letters('disaggregation of revenue', null, null, null, 1, 0, null) limit 1;
--    Expect: the same exact total as under 017 (~3,045), sub-second.
-- 4. Clamps:
--      select count(*) from urc_search_letters('fair value', null, null, null, 5000, 0, null);
--    Expect: 100 (limit clamped), not 5000.
-- 5. search_path pinned:
--      select proconfig from pg_proc where proname = 'urc_search_letters';
--    Expect: contains 'search_path=pg_catalog, public'.
