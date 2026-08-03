-- 017_letters_search_capped_count.sql
--
-- WHY (accuracy-gate run 30787431422): migration 016 took the worst
-- topic searches from killed-at-8s to 2-6s in isolation, but under the
-- gate's 8-way concurrency the broadest terms still exceed the 20s budget
-- (33 of 150 class-C points, all topic searches). Local timings split by
-- term frequency — 2.7s for ~13K matches vs 5.8s for the biggest terms —
-- so the remaining dominant cost is materializing and counting the FULL
-- match set for very common terms ("fair value" matches a large share of
-- 327K letters with content).
--
-- WHAT CHANGES vs 016:
--   1. total_count is exact up to 10,000 and reported as 10,001 beyond it
--      ("more than 10,000") — the count scan stops at 10,001 rows instead
--      of walking every match. The API translates 10,001 into
--      { total: 10000, totalIsFloor: true } and the UI renders "10,000+";
--      nothing anywhere claims a fabricated exact number.
--   2. The ranking pool drops 2,000 → 1,000 most recent matches, halving
--      the tsvector detoast work. Behavior is exactly as before whenever
--      the match set is ≤ 1,000 (every rare/specific topic).
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
) language sql stable as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq),
  hits as materialized (
    select l.accession, l.cik, l.company_name, l.form, l.date_filed,
           l.thread_id, l.filename
    from urc_comment_letters l, q
    where l.fts @@ q.tsq
      and (p_form is null or l.form = p_form)
      and (p_start is null or l.date_filed >= p_start)
      and (p_end is null or l.date_filed <= p_end)
      and (p_company is null or l.company_name ilike '%' || p_company || '%')
    -- Count exactness is capped: beyond 10,001 rows the only thing the
    -- extra scan work buys is a bigger number nobody pages to.
    limit 10001
  ),
  pool as materialized (
    select * from hits order by date_filed desc limit 1000
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
    order by rank desc, date_filed desc
    limit p_limit offset p_offset
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
  order by pg.rank desc, pg.date_filed desc;
$$;

-- ── Probe (separate statements) ─────────────────────────────────────────────
-- 1. Worst case, was 5.8s cold under 016:
--      select count(*) from urc_search_letters('fair value', null, null, null, 10, 0, null);
--    Expect: 10 rows, noticeably under 3s.
-- 2. Cap semantics:
--      select total_count from urc_search_letters('fair value', null, null, null, 1, 0, null) limit 1;
--    Expect: 10001 exactly (meaning "more than 10,000").
-- 3. Rare-topic exactness unchanged:
--      select total_count from urc_search_letters('disaggregation of revenue', null, null, null, 1, 0, null) limit 1;
--    Expect: the same real total as before 017, sub-second.
