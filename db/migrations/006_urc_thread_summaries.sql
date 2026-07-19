-- Persisted AI thread summaries — the narrative half of comment-letter
-- threading ("what did the Staff push on, how was it resolved, how many
-- rounds"). Generated lazily on first open, cached forever unless the
-- episode grows (letters_count mismatch triggers regeneration).

create table if not exists urc_thread_summaries (
  thread_id     text primary key,
  summary       text not null,
  letters_count int not null,
  model         text,
  generated_at  timestamptz not null default now()
);

alter table urc_thread_summaries enable row level security;
