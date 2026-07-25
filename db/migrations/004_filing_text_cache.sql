-- Shared filing-text cache.
--
-- Boolean validation and topic comparison both need the extracted text of a
-- filing. Today every user re-downloads and re-extracts the same documents into
-- their own browser tab, so nothing is ever reused: two analysts researching the
-- same peer group each pay full cost, and the same analyst pays again tomorrow.
-- That is the reason the 120-document budget is a hard ceiling on recall.
--
-- Caching the EXTRACTED text (not the raw HTML) means any future query can be
-- evaluated against it, so coverage compounds across users and queries rather
-- than resetting. Postgres TOAST compresses the text column automatically.

create table if not exists public.urc_filing_text (
  cik          text        not null,
  accession    text        not null,
  document     text        not null,
  -- Extracted by lib/filingText, which is byte-identical in browser and server
  -- (see filingTextEquivalence tests) — a mismatch would silently change which
  -- filings match a Boolean query.
  text         text        not null,
  bytes        integer     not null,
  fetched_at   timestamptz not null default now(),
  primary key (cik, accession, document)
);

-- Cheapest useful eviction signal if the table ever needs trimming: age.
create index if not exists urc_filing_text_fetched_at_idx
  on public.urc_filing_text (fetched_at);

alter table public.urc_filing_text enable row level security;

-- Web tier reads through the anon/publishable role (migration 003 posture);
-- writes happen only from the server cache-writer, which uses the service key
-- and bypasses RLS. Anon must never be able to write filing text.
grant select on public.urc_filing_text to anon;

drop policy if exists anon_read on public.urc_filing_text;
create policy anon_read on public.urc_filing_text
  for select to anon using (true);
