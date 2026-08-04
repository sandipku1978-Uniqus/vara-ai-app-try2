#!/usr/bin/env bash
# Migration-chain test (readiness audit R0): replay db/migrations/*.sql from
# an EMPTY database and prove the result behaves — grants, search_path,
# deterministic ordering, sentinel totals, clamps, and empty-page behavior.
#
# This is the test that makes "the migrations, replayed, produce the schema
# production is supposed to have" a checked claim instead of a belief. It
# runs against a disposable Postgres (CI service container or local docker),
# never against Supabase.
#
# Usage: DATABASE_URL=postgres://... tests/db/migration-chain.sh
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to a DISPOSABLE postgres (never Supabase)}"

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

echo "── Supabase-equivalent roles (provided by the platform in production) ──"
"${PSQL[@]}" <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login password 'x'; end if;
end $$;
SQL

echo "── Replay chain in filename order ──"
for f in db/migrations/*.sql; do
  echo "  applying $f"
  "${PSQL[@]}" -f "$f"
done

echo "── Structural assertions ──"
CHAIN_HEAD=$(ls db/migrations/ | grep -oE '^[0-9]{3}' | sort | tail -1)
echo "  chain head from directory: $CHAIN_HEAD"
"${PSQL[@]}" -v chain_head="$CHAIN_HEAD" <<'SQL'
-- 018: search_path pinned on the letters search function
do $$ begin
  if not exists (
    select from pg_proc
    where proname = 'urc_search_letters'
      and proconfig::text like '%search_path=pg_catalog, public%'
  ) then raise exception 'urc_search_letters lacks pinned search_path'; end if;
end $$;

-- Schema version registry stamped with the chain head — derived from the
-- migrations directory, never hardcoded: a hardcoded head silently expires
-- the moment the next migration lands (exactly how PR #96 got stuck: the
-- test demanded 019 while the chain stamped 020).
do $$
declare v text;
begin
  select version into v from urc_schema_version where singleton;
  if v is distinct from :'chain_head' then
    raise exception 'urc_schema_version reports %, chain head expects %', coalesce(v, 'NULL'), :'chain_head';
  end if;
end $$;

-- web tier can execute the read RPCs, and cannot touch maintenance ones
do $$ begin
  if not has_function_privilege('anon', 'urc_schema_version()', 'execute') then
    raise exception 'anon cannot execute urc_schema_version';
  end if;
  if has_function_privilege('anon', 'urc_refresh_current_auditors()', 'execute') then
    raise exception 'anon can execute maintenance fn urc_refresh_current_auditors';
  end if;
end $$;

-- write paths are revoked from the web tier on every urc_ table
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'urc\_%' and c.relkind in ('r','p')
  loop
    if has_table_privilege('anon', format('public.%I', r.relname), 'insert') then
      raise exception 'anon can INSERT into %', r.relname;
    end if;
  end loop;
end $$;
SQL

echo "── Behavioral assertions (seeded corpus incl. sentinel-scale data) ──"
"${PSQL[@]}" <<'SQL'
-- 10,050 matching letters: enough to cross the 10,001 sentinel for real.
insert into urc_comment_letters (accession, cik, company_name, form, date_filed, filename, thread_id, content)
select
  'test-' || lpad(i::text, 6, '0'),
  1000000 + (i % 500),
  'Test Issuer ' || (i % 500),
  case when i % 2 = 0 then 'UPLOAD' else 'CORRESP' end,
  date '2020-01-01' + (i % 2000),
  'edgar/data/test/' || i,
  (1000000 + (i % 500)) || ':2020-01-01',
  'fair value measurement discussion number ' || i
from generate_series(1, 10050) as g(i);

-- also 30 rare-topic rows
insert into urc_comment_letters (accession, cik, company_name, form, date_filed, filename, thread_id, content)
select
  'rare-' || lpad(i::text, 4, '0'),
  2000000 + i,
  'Rare Issuer ' || i,
  'UPLOAD',
  date '2024-01-01' + i,
  'edgar/data/rare/' || i,
  (2000000 + i) || ':2024-01-01',
  'zebra polymorphic covenant clause ' || i
from generate_series(1, 30) as g(i);

-- Sentinel: >10,000 matches report exactly 10001 ("more than 10,000")
do $$
declare t bigint;
begin
  select total_count into t from urc_search_letters('fair value', null, null, null, 1, 0, null) limit 1;
  if t is distinct from 10001 then raise exception 'sentinel: expected 10001, got %', t; end if;
end $$;

-- Exactness below the cap
do $$
declare t bigint;
begin
  select total_count into t from urc_search_letters('zebra polymorphic', null, null, null, 1, 0, null) limit 1;
  if t is distinct from 30 then raise exception 'exact total: expected 30, got %', t; end if;
end $$;

-- Determinism + global recency (the 017 flaw): two runs identical, and page
-- one must be the newest matching rows.
do $$
declare a text; b text; newest date; page1 date;
begin
  select string_agg(accession, ',' order by rn) into a from (
    select accession, row_number() over () rn
    from urc_search_letters('fair value', null, null, null, 5, 0, null)) x;
  select string_agg(accession, ',' order by rn) into b from (
    select accession, row_number() over () rn
    from urc_search_letters('fair value', null, null, null, 5, 0, null)) x;
  if a is distinct from b then raise exception 'nondeterministic pages: % vs %', a, b; end if;

  select max(date_filed) into newest from urc_comment_letters where fts @@ websearch_to_tsquery('english','fair value');
  select max(date_filed) into page1 from urc_search_letters('fair value', null, null, null, 100, 0, null);
  if page1 is distinct from newest then
    raise exception 'page one is not globally recent: newest match % vs page max %', newest, page1;
  end if;
end $$;

-- Clamps: absurd limit comes back bounded
do $$
declare c int;
begin
  select count(*) into c from urc_search_letters('fair value', null, null, null, 5000, 0, null);
  if c > 100 then raise exception 'limit clamp failed: % rows', c; end if;
end $$;

-- Empty page inside range still carries no rows but the FUNCTION is honest:
-- offset past the 30 matches returns zero rows (the ROUTE re-queries for the
-- total; the function must simply not lie).
do $$
declare c int;
begin
  select count(*) into c from urc_search_letters('zebra polymorphic', null, null, null, 10, 500, null);
  if c <> 0 then raise exception 'expected empty page, got % rows', c; end if;
end $$;
SQL

echo "Migration chain: ALL ASSERTIONS PASS"
