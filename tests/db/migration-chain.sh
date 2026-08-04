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
CHAIN_HEAD=$(node scripts/schema-provenance.mjs --field schemaVersion)
CHAIN_COUNT=$(node scripts/schema-provenance.mjs --field schemaMigrationCount)
CHAIN_CHECKSUM=$(node scripts/schema-provenance.mjs --field schemaChainChecksum)
CHAIN_ALGORITHM=$(node scripts/schema-provenance.mjs --field schemaChecksumAlgorithm)
echo "  canonical chain: $CHAIN_HEAD / $CHAIN_COUNT migrations / $CHAIN_ALGORITHM:$CHAIN_CHECKSUM"
"${PSQL[@]}" \
  -v chain_head="$CHAIN_HEAD" \
  -v chain_count="$CHAIN_COUNT" \
  -v chain_checksum="$CHAIN_CHECKSUM" \
  -v chain_algorithm="$CHAIN_ALGORITHM" <<'SQL'
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
-- psql variables do not interpolate inside dollar-quoted DO bodies; hand
-- the value over as a session GUC instead.
set chain.head = :'chain_head';
set chain.count = :'chain_count';
set chain.checksum = :'chain_checksum';
set chain.algorithm = :'chain_algorithm';
do $$
declare
  v text;
  n integer;
  checksum text;
  algorithm text;
  rpc jsonb;
  expected_version text := current_setting('chain.head');
  expected_count integer := current_setting('chain.count')::integer;
  expected_checksum text := current_setting('chain.checksum');
  expected_algorithm text := current_setting('chain.algorithm');
begin
  select version, migration_count, chain_checksum, checksum_algorithm
    into v, n, checksum, algorithm
    from urc_schema_version where singleton;
  if v is distinct from expected_version then
    raise exception 'schema version reports %, repository expects %', coalesce(v, 'NULL'), expected_version;
  end if;
  if n is distinct from expected_count then
    raise exception 'schema migration count reports %, repository expects %', coalesce(n::text, 'NULL'), expected_count;
  end if;
  if checksum is distinct from expected_checksum then
    raise exception 'schema chain checksum reports %, repository expects %', coalesce(checksum, 'NULL'), expected_checksum;
  end if;
  if algorithm is distinct from expected_algorithm then
    raise exception 'schema checksum algorithm reports %, repository expects %', coalesce(algorithm, 'NULL'), expected_algorithm;
  end if;

  select urc_schema_provenance() into rpc;
  if rpc is distinct from jsonb_build_object(
    'schemaVersion', expected_version,
    'schemaMigrationCount', expected_count,
    'schemaChainChecksum', expected_checksum,
    'schemaChecksumAlgorithm', expected_algorithm
  ) then
    raise exception 'urc_schema_provenance RPC does not match repository identity: %', rpc;
  end if;
end $$;

-- web tier can execute the read RPCs, and cannot touch maintenance ones
do $$ begin
  if not has_function_privilege('anon', 'urc_schema_version()', 'execute') then
    raise exception 'anon cannot execute urc_schema_version';
  end if;
  if not has_function_privilege('anon', 'urc_schema_provenance()', 'execute') then
    raise exception 'anon cannot execute urc_schema_provenance';
  end if;
  if not has_function_privilege('anon', 'urc_resolve_filing_auditors(jsonb)', 'execute') then
    raise exception 'anon cannot execute urc_resolve_filing_auditors';
  end if;
  if has_function_privilege('anon', 'urc_refresh_current_auditors()', 'execute') then
    raise exception 'anon can execute maintenance fn urc_refresh_current_auditors';
  end if;
  if has_function_privilege('anon', 'urc_refresh_auditor_periods()', 'execute') then
    raise exception 'anon can execute maintenance fn urc_refresh_auditor_periods';
  end if;
  if has_function_privilege('authenticated', 'urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)', 'execute') then
    raise exception 'authenticated can execute urc_search_filings';
  end if;
  if not has_function_privilege('urc_web', 'urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint)', 'execute') then
    raise exception 'urc_web cannot execute urc_search_filings';
  end if;
  if has_function_privilege('urc_web', 'urc_refresh_auditor_periods()', 'execute') then
    raise exception 'urc_web can execute maintenance fn urc_refresh_auditor_periods';
  end if;
end $$;

-- write paths are revoked from the web tier on every urc_ table
do $$
declare
  r record;
  role_name text;
  privilege_name text;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'urc\_%' and c.relkind in ('r','p','v','m')
  loop
    foreach role_name in array array['anon', 'authenticated', 'urc_web'] loop
      foreach privilege_name in array array['insert', 'update', 'delete'] loop
        if has_table_privilege(role_name, format('public.%I', r.relname), privilege_name) then
          raise exception '% can % %', role_name, upper(privilege_name), r.relname;
        end if;
      end loop;
    end loop;
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

-- Ownership reports and proposed-sale notices are first-class facet rows.
-- Include originals and amendments so the root-family behavior is proven on
-- the fully replayed migration chain rather than assumed from SQL text.
insert into urc_sec_filings
  (accession, cik, company_name, form, root_form, is_amendment, date_filed, filename)
values
  ('ownership-3',     3000000, 'Ownership Test Corp', '3',     '3',   false, '2026-07-01', 'edgar/data/test/ownership-3.txt'),
  ('ownership-3-a',   3000000, 'Ownership Test Corp', '3/A',   '3',   true,  '2026-07-02', 'edgar/data/test/ownership-3-a.txt'),
  ('ownership-4',     3000000, 'Ownership Test Corp', '4',     '4',   false, '2026-07-03', 'edgar/data/test/ownership-4.txt'),
  ('ownership-4-a',   3000000, 'Ownership Test Corp', '4/A',   '4',   true,  '2026-07-04', 'edgar/data/test/ownership-4-a.txt'),
  ('ownership-5',     3000000, 'Ownership Test Corp', '5',     '5',   false, '2026-07-05', 'edgar/data/test/ownership-5.txt'),
  ('ownership-5-a',   3000000, 'Ownership Test Corp', '5/A',   '5',   true,  '2026-07-06', 'edgar/data/test/ownership-5-a.txt'),
  ('ownership-144',   3000000, 'Ownership Test Corp', '144',   '144', false, '2026-07-07', 'edgar/data/test/ownership-144.txt'),
  ('ownership-144-a', 3000000, 'Ownership Test Corp', '144/A', '144', true,  '2026-07-08', 'edgar/data/test/ownership-144-a.txt');

-- Temporal auditor evidence: one ordinary issuer changes from KPMG to
-- Deloitte, plus deliberately ambiguous, unsupported fund, and not-yet-
-- backfilled events. Superseded Form AP amendments must never participate.
insert into urc_sec_auditors
  (form_filing_id, is_latest, firm_name, firm_canonical, issuer_cik,
   audit_report_type, audit_report_date, fiscal_period_end, filing_date)
values
  (400001, true,  'KPMG LLP',                 'KPMG',     4000000, 'Issuer, other than Employee Benefit Plan or Investment Company', '2019-02-20', '2018-12-31', '2019-03-01'),
  (400002, true,  'Deloitte & Touche LLP',    'Deloitte', 4000000, 'Issuer, other than Employee Benefit Plan or Investment Company', '2022-02-20', '2021-12-31', '2022-03-01'),
  (400003, false, 'Ernst & Young LLP',        'EY',       4000000, 'Issuer, other than Employee Benefit Plan or Investment Company', '2022-02-20', '2021-12-31', '2022-02-25'),
  (400004, true,  'KPMG LLP',                 'KPMG',     4000001, 'Issuer, other than Employee Benefit Plan or Investment Company', '2021-02-20', '2020-12-31', '2021-03-01'),
  (400005, true,  'Deloitte & Touche LLP',    'Deloitte', 4000001, 'Issuer, other than Employee Benefit Plan or Investment Company', '2021-02-20', '2020-12-31', '2021-03-02'),
  (400006, true,  'KPMG LLP',                 'KPMG',     4000002, 'Investment Company', '2021-02-20', '2020-12-31', '2021-03-01'),
  (400007, true,  'PricewaterhouseCoopers LLP','PwC',     4000003, null, '2021-02-20', '2020-12-31', '2021-03-01');

insert into urc_sec_filings
  (accession, cik, company_name, form, root_form, is_amendment, date_filed, filename)
values
  ('temporal-pre',         4000000, 'Temporal Test Corp', '10-K', '10-K', false, '2018-03-01', 'edgar/data/test/temporal-pre.txt'),
  ('temporal-old',         4000000, 'Temporal Test Corp', '10-K', '10-K', false, '2020-03-01', 'edgar/data/test/temporal-old.txt'),
  ('temporal-boundary',    4000000, 'Temporal Test Corp', '10-K', '10-K', false, '2022-02-20', 'edgar/data/test/temporal-boundary.txt'),
  ('temporal-new',         4000000, 'Temporal Test Corp', '10-K', '10-K', false, '2023-03-01', 'edgar/data/test/temporal-new.txt'),
  ('temporal-ambiguous',   4000001, 'Ambiguous Test Corp','10-K', '10-K', false, '2022-03-01', 'edgar/data/test/temporal-ambiguous.txt'),
  ('temporal-investment',  4000002, 'Fund Test Trust',    'N-CSR','N-CSR',false, '2022-03-01', 'edgar/data/test/temporal-investment.txt'),
  ('temporal-pending',     4000003, 'Pending Test Corp',  '10-K', '10-K', false, '2022-03-01', 'edgar/data/test/temporal-pending.txt');

select urc_refresh_auditor_periods();
select urc_refresh_current_auditors();

-- All four requested root families are retrievable in deterministic recency
-- order, carry an honest total, and retain amendment identity.
do $$
declare ordered_forms text; min_total bigint; max_total bigint;
begin
  select string_agg(form, ',' order by rn), min(total_count), max(total_count)
    into ordered_forms, min_total, max_total
  from (
    select form, total_count, row_number() over () as rn
    from urc_search_filings(
      array['3','4','5','144'], '2026-01-01', '2026-12-31',
      null, null, null, 100, 0, 3000000
    )
  ) ownership_results;

  if ordered_forms is distinct from '144/A,144,5/A,5,4/A,4,3/A,3' then
    raise exception 'ownership facet order/coverage failed: %', ordered_forms;
  end if;
  if min_total is distinct from 8 or max_total is distinct from 8 then
    raise exception 'ownership facet total expected 8, got min % max %', min_total, max_total;
  end if;
end $$;

-- Current issuer projection is derived from the same resolved evidence. It
-- reports the latest ordinary-issuer firm and suppresses ambiguous/fund CIKs.
do $$
declare current_firm text; unsupported_count integer;
begin
  select firm_canonical into current_firm
  from urc_current_auditors where issuer_cik = 4000000;
  select count(*) into unsupported_count
  from urc_current_auditors where issuer_cik in (4000001, 4000002, 4000003);
  if current_firm is distinct from 'Deloitte' or unsupported_count <> 0 then
    raise exception 'current resolved-auditor projection failed: firm %, unsupported rows %',
      current_firm, unsupported_count;
  end if;
end $$;

-- A caller passing an amendment still selects the whole root family, which
-- is the public API contract introduced by migration 020.
do $$
declare forms_seen text; c int;
begin
  select string_agg(form, ',' order by form), count(*)
    into forms_seen, c
  from urc_search_filings(
    array['4/a'], '2026-01-01', '2026-12-31',
    null, null, null, 100, 0, 3000000
  );
  if forms_seen is distinct from '4,4/A' or c <> 2 then
    raise exception 'Form 4 amendment-family lookup failed: % (% rows)', forms_seen, c;
  end if;
end $$;

-- A historical filing keeps the firm supported at its own date. The new
-- firm's report becomes effective on its report-date boundary; today's firm
-- can never rewrite the old row.
do $$
declare kpmg_rows text; deloitte_rows text;
begin
  select string_agg(accession, ',' order by accession) into kpmg_rows
  from urc_search_filings(
    array['10-K'], null, null, 'KPMG', null, null, 100, 0, 4000000
  );
  select string_agg(accession, ',' order by accession) into deloitte_rows
  from urc_search_filings(
    array['10-K'], null, null, 'Deloitte', null, null, 100, 0, 4000000
  );
  if kpmg_rows is distinct from 'temporal-old' then
    raise exception 'historical KPMG attribution failed: %', kpmg_rows;
  end if;
  if deloitte_rows is distinct from 'temporal-boundary,temporal-new' then
    raise exception 'date-effective Deloitte attribution failed: %', deloitte_rows;
  end if;
end $$;

-- The batch resolver preserves repeated CIKs on different dates, does not
-- extend the first 2017+ observation backward, ignores superseded evidence,
-- and exposes uncertainty instead of choosing one firm/fund series.
do $$
declare resolved jsonb;
begin
  select jsonb_agg(to_jsonb(r) order by request_key)
    into resolved
  from urc_resolve_filing_auditors(jsonb_build_array(
    jsonb_build_object('key','ambiguous','cik','4000001','file_date','2022-03-01'),
    jsonb_build_object('key','boundary','cik','4000000','file_date','2022-02-20'),
    jsonb_build_object('key','investment','cik','4000002','file_date','2022-03-01'),
    jsonb_build_object('key','new','cik','4000000','file_date','2023-03-01'),
    jsonb_build_object('key','old','cik','4000000','file_date','2020-03-01'),
    jsonb_build_object('key','pending','cik','4000003','file_date','2022-03-01'),
    jsonb_build_object('key','pre','cik','4000000','file_date','2018-03-01')
  )) r;

  if resolved #>> '{4,auditor}' is distinct from 'KPMG'
     or resolved #>> '{3,auditor}' is distinct from 'Deloitte'
     or resolved #>> '{1,auditor}' is distinct from 'Deloitte' then
    raise exception 'repeated-CIK/boundary resolution failed: %', resolved;
  end if;
  if resolved #>> '{0,auditor_resolution_status}' is distinct from 'ambiguous'
     or resolved #> '{0,auditor}' <> 'null'::jsonb
     or (resolved #> '{0,auditor_candidates}') ? 'EY' then
    raise exception 'ambiguous/superseded evidence handling failed: %', resolved #> '{0}';
  end if;
  if resolved #>> '{2,auditor_resolution_status}' is distinct from 'unsupported_entity_scope'
     or resolved #>> '{5,auditor_resolution_status}' is distinct from 'coverage_pending'
     or resolved #>> '{6,auditor_resolution_status}' is distinct from 'no_prior_form_ap_report' then
    raise exception 'unsupported/pending/pre-coverage status failed: %', resolved;
  end if;
end $$;

-- Defensive input cap is enforced rather than silently truncating evidence.
do $$
begin
  perform * from urc_resolve_filing_auditors((
    select jsonb_agg(jsonb_build_object(
      'key', i::text, 'cik', '4000000', 'file_date', '2020-03-01'
    )) from generate_series(1, 5001) g(i)
  ));
  raise exception 'temporal resolver accepted more than 5000 inputs';
exception
  when invalid_parameter_value then null;
end $$;

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

echo "── Independent live-schema evidence and drift rejection ──"
SCHEMA_EVIDENCE_DIR=$(mktemp -d)
cleanup_schema_evidence() {
  if [[ -n "${SCHEMA_EVIDENCE_DIR:-}" && -d "$SCHEMA_EVIDENCE_DIR" ]]; then
    rm -rf -- "$SCHEMA_EVIDENCE_DIR"
  fi
}
trap cleanup_schema_evidence EXIT

BASELINE_EVIDENCE="$SCHEMA_EVIDENCE_DIR/baseline-evidence.json"
BASELINE_REPORT="$SCHEMA_EVIDENCE_DIR/baseline-report.json"
DRIFT_EVIDENCE="$SCHEMA_EVIDENCE_DIR/drift-evidence.json"
DRIFT_REPORT="$SCHEMA_EVIDENCE_DIR/drift-report.json"

if "${PSQL[@]}" <<'SQL'
begin;
set local role anon;
select public.urc_schema_contract_evidence();
rollback;
SQL
then
  echo "anon unexpectedly executed the service-only schema evidence RPC" >&2
  exit 1
fi

"${PSQL[@]}" -At -o "$BASELINE_EVIDENCE" <<'SQL'
begin;
set local role service_role;
select public.urc_schema_contract_evidence();
rollback;
SQL
npx tsx scripts/accuracy/schema-contract.ts \
  --evidence "$BASELINE_EVIDENCE" \
  --expect-schema "$CHAIN_HEAD" \
  --expect-migration-count "$CHAIN_COUNT" \
  --expect-schema-checksum "$CHAIN_CHECKSUM" \
  --expect-checksum-algorithm "$CHAIN_ALGORITHM" \
  --out "$BASELINE_REPORT"

# A transaction makes the negative test harmless: capture evidence while one
# required live index is absent, web roles gain mutation authority, an
# unallowlisted SECURITY DEFINER backdoor appears, anon can CREATE in public,
# and future functions inherit PUBLIC EXECUTE. Then roll every change back.
# The report must fail and its deterministic evidence digest must differ from baseline.
"${PSQL[@]}" -At -o "$DRIFT_EVIDENCE" <<'SQL'
begin;
drop index public.urc_auditor_periods_mat_firm_idx;
grant create on schema public to anon;
grant update on table public.urc_filing_text to authenticated;
grant insert on table public.urc_thread_summaries to urc_web;
create table public.urc_backdoor (id bigint primary key);
grant insert on table public.urc_backdoor to anon;
create function public.urc_backdoor() returns void
language plpgsql security definer set search_path = pg_catalog as $$ begin null; end $$;
grant execute on function public.urc_backdoor() to anon;
alter default privileges grant execute on functions to public;
select public.urc_schema_contract_evidence();
rollback;
SQL

if npx tsx scripts/accuracy/schema-contract.ts \
  --evidence "$DRIFT_EVIDENCE" \
  --expect-schema "$CHAIN_HEAD" \
  --expect-migration-count "$CHAIN_COUNT" \
  --expect-schema-checksum "$CHAIN_CHECKSUM" \
  --expect-checksum-algorithm "$CHAIN_ALGORITHM" \
  --out "$DRIFT_REPORT"; then
  echo "schema-contract assessor incorrectly accepted required-index drift" >&2
  exit 1
fi

node - "$BASELINE_REPORT" "$DRIFT_REPORT" <<'NODE'
const { readFileSync } = require('node:fs');
const [baselinePath, driftPath] = process.argv.slice(2);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const drift = JSON.parse(readFileSync(driftPath, 'utf8'));

if (baseline.pass !== true) throw new Error('baseline schema-contract evidence did not pass');
if (drift.pass !== false) throw new Error('drifted schema-contract evidence did not fail');
if (!/^[0-9a-f]{64}$/.test(baseline.observedEvidenceSha256 || '')) {
  throw new Error('baseline evidence digest is missing or malformed');
}
if (baseline.observedEvidenceSha256 === drift.observedEvidenceSha256) {
  throw new Error('catalog drift did not change the evidence digest');
}
if (!(drift.problems || []).some(problem =>
  String(problem).includes('urc_auditor_periods_mat_firm_idx is missing')
)) {
  throw new Error('drift report did not identify the removed required index');
}
if (!(drift.problems || []).some(problem =>
  String(problem).includes('anon role must have USAGE and no CREATE')
)) {
  throw new Error('drift report did not identify public-schema CREATE exposure');
}
if (!(drift.problems || []).some(problem =>
  String(problem).includes('grants EXECUTE to PUBLIC')
)) {
  throw new Error('drift report did not identify unsafe future-function defaults');
}
if (!(drift.problems || []).some(problem =>
  String(problem).includes('authenticated UPDATE denial is absent on urc_filing_text')
)) {
  throw new Error('drift report did not identify authenticated relation mutation authority');
}
if (!(drift.problems || []).some(problem =>
  String(problem).includes('urc_web INSERT denial is absent on urc_thread_summaries')
)) {
  throw new Error('drift report did not identify urc_web relation mutation authority');
}
if (!(drift.problems || []).some(problem =>
  String(problem).includes('unexpected relation urc_backdoor lacks anon INSERT denial')
)) {
  throw new Error('drift report did not identify the unallowlisted writable relation');
}
if (!(drift.problems || []).some(problem =>
  String(problem).includes('unexpected live function urc_backdoor() is SECURITY DEFINER')
)) {
  throw new Error('drift report did not identify the unallowlisted SECURITY DEFINER function');
}
NODE

echo "Migration chain: ALL ASSERTIONS PASS"
