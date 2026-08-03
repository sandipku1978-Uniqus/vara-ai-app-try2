-- 016_letters_search_bounded_work.sql
--
-- WHY (accuracy-gate runs 30783955373 / 30785239900): every class-C topic
-- search — "fair value", "going concern", "revenue recognition" — times out.
-- 38 of 950 e2e points fail as HTTP 504 at the 20s statement budget; on the
-- service path the same queries die at ~8s. This is the whole remaining
-- e2e gap (94.4% would be ~98.4% without it), and real users hit it in
-- production on every common-topic letters search.
--
-- ROOT CAUSE, in urc_search_letters (004): the `matched` CTE computes
--   ts_headline('english', left(content, 20000), tsq, ...)
-- for EVERY matching row BEFORE the limit. "fair value" matches a large
-- share of the 327K letters with content, so a 10-row page pays for tens of
-- thousands of 20KB headline computations plus a ts_rank detoast of every
-- match's tsvector. The GIN index (urc_letters_fts_idx) finds the rows
-- instantly; everything after it was the timeout.
--
-- WHAT CHANGES:
--   1. ts_headline moves AFTER pagination — computed for the ≤p_limit rows
--      actually returned (the classic fix).
--   2. ts_rank runs over a bounded candidate pool: the 2,000 most recent
--      matches, not all of them. For queries with ≤2,000 matches (every
--      rare/specific topic) behavior is EXACTLY as before. For broader
--      queries, ranking happens within the 2,000 most recent matching
--      letters — "relevance among recent" — instead of timing out. Paging
--      cannot reach past the pool; the UI pages 20 at a time and never gets
--      near 2,000.
--   3. total_count stays EXACT for all queries: counted over the full match
--      set via the GIN-verified rows, with no tsvector detoast and no
--      headline work.
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent (create or replace;
-- the signature is unchanged so no drop is needed).

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
    -- GIN-driven match set: identifying columns only. No rank, no headline,
    -- no content detoast — this stays cheap even for very common terms.
    select l.accession, l.cik, l.company_name, l.form, l.date_filed,
           l.thread_id, l.filename
    from urc_comment_letters l, q
    where l.fts @@ q.tsq
      and (p_form is null or l.form = p_form)
      and (p_start is null or l.date_filed >= p_start)
      and (p_end is null or l.date_filed <= p_end)
      and (p_company is null or l.company_name ilike '%' || p_company || '%')
  ),
  pool as materialized (
    -- Bounded ranking candidates: the 2,000 most recent matches. Exact
    -- passthrough when the match set is smaller than the pool.
    select * from hits order by date_filed desc limit 2000
  ),
  ranked as (
    -- ts_rank detoasts the row's tsvector, so it runs over the pool only.
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
  -- ts_headline is the expensive step (20KB of content per row): it runs
  -- for the returned page ONLY.
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

-- ── Probe (separate statements, per the 014 lesson) ─────────────────────────
--
-- 1. Timing, worst case (previously ~8s+ then killed):
--      select count(*) from urc_search_letters('fair value', null, null, null, 10, 0, null);
--    Expect: completes in well under 5s and returns 10.
--
-- 2. Exactness on a rare topic (behavior must be identical to before):
--      select total_count from urc_search_letters('disaggregation of revenue', null, null, null, 1, 0, null) limit 1;
--    Expect: a real total, headline present, sub-second.
--
-- 3. From the app: /api/letters?q=fair%20value&size=10 → 200 with matches
--    and excerpts. Then re-dispatch the Accuracy gate workflow — class C
--    should recover from 74.7% toward ~100%, taking the suite to ~98%.
