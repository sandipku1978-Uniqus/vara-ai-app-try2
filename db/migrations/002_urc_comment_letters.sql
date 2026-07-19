-- Comment-letter corpus (memo.AI precedent pool)
-- UPLOAD = SEC Staff letter, CORRESP = company response. Short documents,
-- bounded volume (~450-500K since 2005) — the one SEC corpus worth owning
-- in full text. Threading groups letters per issuer into review episodes.

create table if not exists urc_comment_letters (
  accession          text not null,
  cik                bigint not null,
  primary key (accession, cik),
  company_name       text,
  form               text not null,             -- UPLOAD | CORRESP
  date_filed         date not null,
  filename           text not null,             -- edgar/data/... path
  thread_id          text,                      -- '<cik>:<episode start date>'
  content            text,                      -- extracted text; null until fetched
  content_fetched_at timestamptz,
  content_error      text,                      -- last fetch error, null on success
  -- to_tsvector has a 1MB-positions ceiling; content is capped at ingest,
  -- and we guard here again so a pathological doc can't break inserts
  fts tsvector generated always as (to_tsvector('english', left(coalesce(content, ''), 700000))) stored
);

create index if not exists urc_letters_cik_date_idx on urc_comment_letters (cik, date_filed);
create index if not exists urc_letters_form_date_idx on urc_comment_letters (form, date_filed desc);
create index if not exists urc_letters_thread_idx on urc_comment_letters (thread_id);
create index if not exists urc_letters_unfetched_idx on urc_comment_letters (date_filed desc)
  where content is null and content_error is null;
create index if not exists urc_letters_fts_idx on urc_comment_letters using gin (fts);

alter table urc_comment_letters enable row level security;

-- Assign thread ids: consecutive letters for the same CIK with gaps <= 180
-- days form one review episode. Idempotent — safe to re-run after each load.
create or replace function urc_thread_letters() returns bigint
language sql volatile as $$
  with ordered as (
    select accession, cik, date_filed,
           case when date_filed - lag(date_filed) over w > 180 or lag(date_filed) over w is null
                then 1 else 0 end as new_episode
    from urc_comment_letters
    window w as (partition by cik order by date_filed, accession)
  ),
  episodes as (
    select accession, cik, date_filed,
           sum(new_episode) over (partition by cik order by date_filed, accession) as episode_no
    from ordered
  ),
  labeled as (
    select e.accession, e.cik,
           e.cik || ':' || min(e.date_filed) over (partition by e.cik, e.episode_no) as new_thread_id
    from episodes e
  ),
  updated as (
    update urc_comment_letters l
    set thread_id = lb.new_thread_id
    from labeled lb
    where l.accession = lb.accession and l.cik = lb.cik
      and l.thread_id is distinct from lb.new_thread_id
    returning 1
  )
  select count(*) from updated;
$$;

-- Full-text search over the corpus, thread-aware
create or replace function urc_search_letters(
  p_query  text,
  p_form   text default null,     -- UPLOAD | CORRESP | null = both
  p_start  date default null,
  p_end    date default null,
  p_limit  int  default 20,
  p_offset int  default 0
) returns table (
  accession text, cik bigint, company_name text, form text, date_filed date,
  thread_id text, filename text, headline text, rank real, total_count bigint
) language sql stable as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq),
  matched as (
    select l.accession, l.cik, l.company_name, l.form, l.date_filed,
           l.thread_id, l.filename,
           ts_headline('english', left(coalesce(l.content,''), 20000), q.tsq,
                       'MaxFragments=2, MaxWords=30, MinWords=10') as headline,
           ts_rank(l.fts, q.tsq) as rank
    from urc_comment_letters l, q
    where l.fts @@ q.tsq
      and (p_form is null or l.form = p_form)
      and (p_start is null or l.date_filed >= p_start)
      and (p_end is null or l.date_filed <= p_end)
  )
  select *, count(*) over () as total_count
  from matched
  order by rank desc, date_filed desc
  limit p_limit offset p_offset;
$$;
