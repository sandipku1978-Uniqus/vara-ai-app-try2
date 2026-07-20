-- Comment-letter retry state, source-derived review identity, summary input
-- coverage, and exact corpus freshness metrics.

alter table public.urc_comment_letters
  add column if not exists subject text,
  add column if not exists file_number text,
  add column if not exists referenced_accession text,
  add column if not exists review_key text,
  add column if not exists identifier_checked_at timestamptz,
  add column if not exists content_fetch_attempts integer not null default 0,
  add column if not exists content_last_attempt_at timestamptz,
  add column if not exists content_next_retry_at timestamptz;

alter table public.urc_thread_summaries
  add column if not exists input_coverage jsonb;

drop index if exists public.urc_letters_unfetched_idx;
create index if not exists urc_letters_fetch_queue_idx
  on public.urc_comment_letters (content_next_retry_at nulls first, date_filed desc)
  where content is null and (content_error is null or content_error = 'fetch_failed');
create index if not exists urc_letters_review_key_idx
  on public.urc_comment_letters (cik, review_key, date_filed)
  where review_key is not null;
create index if not exists urc_letters_identifier_backfill_idx
  on public.urc_comment_letters (date_filed desc)
  where identifier_checked_at is null
    and (
      content is not null
      or (content is null and content_error is not null and content_error <> 'fetch_failed')
    );

-- Prefer a review identity derived from the letter header (referenced
-- accession, or file number + subject form/year). Only letters without that
-- identity fall back to the historical 180-day CIK gap heuristic.
create or replace function public.urc_thread_letters() returns bigint
language sql volatile
set search_path = pg_catalog, public
as $$
  with ordered as (
    select accession, cik, date_filed, review_key,
           case
             when review_key is not null then 0
             when lag(date_filed) over fallback_window is null then 1
             when date_filed - lag(date_filed) over fallback_window > 180 then 1
             else 0
           end as new_fallback_episode
    from public.urc_comment_letters
    window fallback_window as (
      partition by cik, (review_key is null)
      order by date_filed, accession
    )
  ),
  episodes as (
    select accession, cik, date_filed, review_key,
           case
             when review_key is not null then 0
             else sum(new_fallback_episode) over (partition by cik order by date_filed, accession)
           end as episode_no
    from ordered
  ),
  labeled as (
    select accession, cik,
           case
             when review_key is not null then cik || ':' || review_key
             else cik || ':date:' || min(date_filed) over (partition by cik, episode_no)
           end as new_thread_id
    from episodes
  ),
  updated as (
    update public.urc_comment_letters letter
    set thread_id = labeled.new_thread_id
    from labeled
    where letter.accession = labeled.accession
      and letter.cik = labeled.cik
      and letter.thread_id is distinct from labeled.new_thread_id
    returning 1
  )
  select count(*) from updated;
$$;

drop function if exists public.urc_data_stats();
create function public.urc_data_stats()
returns table (
  filings_estimate bigint,
  filings_through date,
  auditors_estimate bigint,
  letters_estimate bigint,
  letters_with_text bigint,
  letters_through date,
  letters_last_text_fetch timestamptz,
  letters_retry_pending bigint
)
language sql stable
set search_path = pg_catalog, public
as $$
  select
    (select reltuples::bigint from pg_catalog.pg_class where relname = 'urc_sec_filings'),
    (select max(date_filed) from public.urc_sec_filings),
    (select reltuples::bigint from pg_catalog.pg_class where relname = 'urc_sec_auditors'),
    (select count(*) from public.urc_comment_letters),
    (select count(*) from public.urc_comment_letters where content is not null),
    (select max(date_filed) from public.urc_comment_letters),
    (select max(content_fetched_at) from public.urc_comment_letters where content is not null),
    (select count(*) from public.urc_comment_letters where content is null and content_error = 'fetch_failed');
$$;

revoke all on function public.urc_data_stats() from public, anon, authenticated;
grant execute on function public.urc_data_stats() to urc_web, service_role;
revoke all on function public.urc_thread_letters() from public, anon, authenticated, urc_web;
grant execute on function public.urc_thread_letters() to service_role;
