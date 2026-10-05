#!/usr/bin/env bash
# Throwaway Postgres only: never reads .env files or connects anywhere except
# its own Docker containers at 127.0.0.1 on non-default ports. Bash 3.2 compatible.
# Usage: scripts/db/dry-run-chain.sh [--keep] [--port N] [--image IMG]
#        [--only ID[,ID...]] [--report-dir DIR]
# Defaults: postgres:16, 54329 (CI uses port+1), mktemp report directory.
# IDs: chain-apply/chain-idempotent apply every file twice immediately;
# upgrade-compat preserves 025 calls through the head; reapply-head retries every post-025 migration;
# provenance compares repository identity; schema-contract independently checks
# service evidence; p1-user-data checks real signed CRUD/isolation/rejections;
# p2-search-letters checks old/new search shapes and filters; p8-jobs exercises
# both job transports and denied web identities; p9-alert-hits checks signed
# hit pages, evaluator leases and private ACLs (only when 029 exists); writer-role compares ACLs and
# attributes at 026/027/028/head; grant-audit consumes supervisor SQL if present;
# chain-test runs the existing end-to-end CI test in a separate plain cluster.
# --only includes necessary Phase A prerequisites (always twice-in-place).
# --keep prints MASKED URLs; recover the password from your own container env.
# Test-only DRYRUN_TEST_NAMES=1 reserves urc-dryrun-codex[-ci], never other names.
set -euo pipefail
set +x
unset DATABASE_URL PGHOST PGHOSTADDR PGSERVICE PGPASSFILE URC_SUPABASE_DB_URL \
  URC_SUPABASE_SERVICE_KEY SUPABASE_SERVICE_ROLE_KEY
# Remove ALL ambient libpq and Supabase variables by name without reading values.
for dry_name in $(compgen -e); do
  case "$dry_name" in PG*|URC_SUPABASE_*|SUPABASE_*|NEXT_PUBLIC_SUPABASE_*|NEXT_PUBLIC_URC_SUPABASE_*) unset "$dry_name";; esac
done
unset NODE_OPTIONS NODE_PATH BASH_ENV ENV
export LC_ALL=C
CALLER_CWD=$PWD
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
SUPPORT="$ROOT/scripts/db/dry-run"
KEEP=0 PORT=54329 IMAGE=postgres:16 ONLY='' REPORT=''
IDS='chain-apply chain-idempotent upgrade-compat reapply-head provenance schema-contract p1-user-data p2-search-letters p8-jobs'
for dry_file in "$ROOT"/db/migrations/029_*.sql; do
  if [ -f "$dry_file" ]; then IDS="$IDS p9-alert-hits"; break; fi
done
IDS="$IDS writer-role grant-audit chain-test"
usage() { sed -n '2,20p' "$ROOT/scripts/db/dry-run-chain.sh"; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1; shift;;
    --port|--image|--only|--report-dir)
      [ "$#" -ge 2 ] || { echo "Missing value for $1" >&2; exit 2; }
      case "$1" in --port) PORT=$2;; --image) IMAGE=$2;; --only) ONLY=$2;; --report-dir) REPORT=$2;; esac
      shift 2;;
    --help|-h) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2;;
  esac
done
case "$PORT" in ''|*[!0-9]*) echo 'Port must be an integer between 1024 and 65534 (excluding 5432).' >&2; exit 2;; esac
[ "${#PORT}" -le 5 ] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65534 ] && [ "$PORT" -ne 5432 ] && [ "$PORT" -ne 5431 ] || { echo 'Invalid/non-disposable port.' >&2; exit 2; }
PORT=$((10#$PORT))
CI_PORT=$((PORT+1))
if [ -n "$ONLY" ]; then
  case "$ONLY" in ,*|*,|*,,*) echo 'Empty --only check ID.' >&2; exit 2;; esac
  old_ifs=$IFS; IFS=,; read -r -a requested <<< "$ONLY"; IFS=$old_ifs
  for id in "${requested[@]}"; do
    case " $IDS " in *" $id "*) ;; *) echo "Unknown check ID: $id" >&2; exit 2;; esac
  done
fi
selected() { [ -z "$ONLY" ] || case ",$ONLY," in *",$1,"*) return 0;; *) return 1;; esac; }
MAIN=urc-migration-dryrun CI=urc-migration-dryrun-ci
if [ "${DRYRUN_TEST_NAMES:-0}" = 1 ]; then MAIN=urc-dryrun-codex; CI=urc-dryrun-codex-ci; fi
umask 077
if [ -z "$REPORT" ]; then REPORT=$(mktemp -d "${TMPDIR:-/tmp}/urc-dryrun-report.XXXXXX"); else
  case "$REPORT" in /*) ;; *) REPORT="$CALLER_CWD/$REPORT";; esac
  mkdir -p "$REPORT"
fi
REPORT=$(cd "$REPORT" && pwd)
TEMP=$(mktemp -d "${TMPDIR:-/tmp}/urc-dryrun-private.XXXXXX")
RESULTS="$REPORT/checks.tsv"
: > "$RESULTS"
COUNT=0 FAILED=0 APPLY_OK=0 APPLY_FAILURE_LOG='' LAST_RESULT=FAIL LOG='' OWNED=0 ACTIVE_PID='' ACTIVE_ID='' ACTIVE_TITLE=''
stop_pg() { docker rm -f "$1" >/dev/null 2>&1 || true; }
kill_check_tree() {
  local child
  # Select PIDs only (never process arguments, which can contain local URLs).
  for child in $(ps -ax -o pid= -o ppid= 2>/dev/null | awk -v parent="$1" '$2 == parent {print $1}' || true); do
    kill_check_tree "$child"
  done
  kill "$1" 2>/dev/null || true
}
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ -n "$ACTIVE_PID" ]; then
    kill_check_tree "$ACTIVE_PID"
    wait "$ACTIVE_PID" 2>/dev/null || true
    printf 'Check interrupted (exit %s)\n' "$rc" >> "$LOG"
    record FAIL "$ACTIVE_ID" "$ACTIVE_TITLE (interrupted)"
  fi
  if [ "$OWNED" = 1 ]; then
    if [ "$KEEP" = 0 ]; then stop_pg "$MAIN"; stop_pg "$CI";
    else
      echo 'Kept containers (masked URLs):'
      if docker inspect "$MAIN" >/dev/null 2>&1; then
        printf '  postgres://%s:***@127.0.0.1:%s/urc_dry\n' "${MIGRATOR:-urc_migrator}" "$PORT"
      fi
      if docker inspect "$CI" >/dev/null 2>&1; then
        printf '  postgres://postgres:***@127.0.0.1:%s/postgres\n' "$CI_PORT"
      fi
    fi
  fi
  rm -rf -- "$TEMP"
  printf '\n%-6s %-20s %s\n' STATUS ID TITLE
  # One row per check id; per-file rows (chain-apply, chain-idempotent, ...) are
  # folded into a count, with the worst status shown. The full list is in checks.tsv.
  awk -F'\t' '
    { if (!($2 in n)) order[++k] = $2; n[$2]++; c[$2 "," $1]++; t[$2] = $3
      rank = ($1 == "FAIL") ? 4 : ($1 == "SKIP") ? 3 : ($1 == "NOTE") ? 2 : 1
      if (rank > w[$2]) { w[$2] = rank; s[$2] = $1 } }
    END { for (i = 1; i <= k; i++) { id = order[i]
      if (n[id] == 1) title = t[id]
      else title = n[id] " runs: " c[id ",PASS"] + 0 " pass, " c[id ",NOTE"] + 0 " documented, " c[id ",FAIL"] + 0 " fail, " c[id ",SKIP"] + 0 " skip"
      printf "%-6s %-20s %s\n", s[id], id, title } }' "$RESULTS"
  printf 'Report directory: %s\n' "$REPORT"
  if [ "$FAILED" -eq 0 ] && [ "$rc" -eq 0 ]; then echo 'RESULT: PASS';
  else printf 'RESULT: FAIL (%s of %s checks failed)\n' "$FAILED" "$COUNT"; [ "$rc" -ne 0 ] || rc=1; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
record() {
  local status=$1 id=$2 title=$3
  COUNT=$((COUNT+1)); case "$status" in PASS|NOTE) ;; *) FAILED=$((FAILED+1));; esac
  printf '%s\t%s\t%s\n' "$status" "$id" "$title" >> "$RESULTS"
  printf '%-4s  %s  %s\n' "$status" "$id" "$title"
  LAST_RESULT=$status
}
run_check() {
  local id=$1 title=$2; shift 2
  LOG="$REPORT/$(printf '%03d' "$((COUNT+1))")-$id.log"
  # Background + wait keeps errexit active INSIDE check functions. Putting a
  # function directly in an `if` would silently disable set -e throughout it.
  ACTIVE_ID=$id; ACTIVE_TITLE=$title
  (set -e; "$@") > "$LOG" 2>&1 &
  ACTIVE_PID=$!
  if wait "$ACTIVE_PID"; then record PASS "$id" "$title";
  else record FAIL "$id" "$title"; sed -n '1,30{s/^/    /;p;}' "$LOG"; fi
  ACTIVE_PID=''; ACTIVE_ID=''; ACTIVE_TITLE=''
}
skip_check() {
  local id=$1 title=$2 reason=$3
  LOG="$REPORT/$(printf '%03d' "$((COUNT+1))")-$id.log"
  printf '%s\n' "$reason" > "$LOG"
  record SKIP "$id" "$title: $reason"
}
requirements() {
  command -v docker >/dev/null || { echo 'Install/start Docker (Colima on macOS).'; return 1; }
  if command -v psql >/dev/null; then command -v psql > "$TEMP/psql-path";
  elif [ -x /opt/homebrew/opt/libpq/bin/psql ]; then echo /opt/homebrew/opt/libpq/bin/psql > "$TEMP/psql-path";
  else echo 'psql missing: brew install libpq; add /opt/homebrew/opt/libpq/bin to PATH.'; return 1; fi
  command -v node >/dev/null; command -v npx >/dev/null; command -v openssl >/dev/null
  docker info --format '{{.ServerVersion}}'
}
# This is the sole psql entry point. It never accepts a caller-supplied URL,
# host, connection option or database. -X ignores potentially unsafe psqlrc.
psql_dry() {
  local phase=$1 role=$2; shift 2
  local port db arg
  case "$phase" in main) port=$PORT; db=urc_dry;; cluster) port=$PORT; db=postgres;; ci) port=$CI_PORT; db=postgres;; *) echo 'Unknown psql phase' >&2; return 1;; esac
  case "$role" in postgres|urc_migrator) ;; *) echo 'Unknown connection role' >&2; return 1;; esac
  for arg in "$@"; do
    case "$arg" in postgres://*|postgresql://*|--host*|-h*|--dbname*|-d*|--username*|-U*|--port*|-p*|--service*) echo 'Refusing psql connection override; host must be 127.0.0.1.' >&2; return 1;; esac
  done
  "$PSQL" "postgres://$role:$DRYRUN_DB_PASSWORD@127.0.0.1:$port/$db?connect_timeout=3" -v ON_ERROR_STOP=1 -X -q "$@"
}
start_pg() {
  local name=$1 port=$2 attempt
  docker run -d --name "$name" --publish "127.0.0.1:$port:5432" \
    --env "POSTGRES_PASSWORD=$DRYRUN_DB_PASSWORD" "$IMAGE" >/dev/null
  for attempt in $(seq 1 60); do
    if docker exec "$name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      if [ "$name" = "$MAIN" ]; then psql_dry cluster postgres -At -c 'select 1' >/dev/null && return 0;
      else psql_dry ci postgres -At -c 'select 1' >/dev/null && return 0; fi
    fi
    # A readiness retry backoff, never an unconditional startup sleep.
    sleep 1
  done
  echo "Postgres readiness failed after 60 retries ($name); check Docker/localhost access."
  docker logs "$name" 2>&1 | tail -30
  return 1
}
prelude() { psql_dry cluster postgres -v "migration_role=$MIGRATOR" -f "$SUPPORT/prelude.sql"; }
apply_migration_twice() {
  local file=$1 label
  APPLY_FAILURE_LOG=''
  label=$(basename "$file")
  APPLY_OK=0
  run_check chain-apply "$label [$MIGRATOR]" psql_dry main "$MIGRATOR" -1 -f "$file"
  if [ "$LAST_RESULT" != PASS ]; then
    APPLY_FAILURE_LOG=$LOG
    skip_check chain-idempotent "$label immediate retry [$MIGRATOR]" 'First apply failed'
    return 0
  fi
  APPLY_OK=1
  # A failed immediate retry rolls back, preserving the successfully applied N.
  # Its FAIL remains in the report, while N+1 can still be meaningfully tested.
  case "$label" in
    009_facet_search_by_cik.sql) retry_known_exception "$file" "$label" 'already exists with same argument types' \
      'historical migration uses plain CREATE FUNCTION; replaced by 010+ and never re-run by operators';;
    *) run_check chain-idempotent "$label immediate retry [$MIGRATOR]" psql_dry main "$MIGRATOR" -1 -f "$file";;
  esac
}
# A migration whose in-place retry is KNOWN to fail for a stated reason is
# reported NOTE (not a failure) only while it fails with exactly that error;
# if it starts passing it is reported PASS, and any other error is a FAIL.
retry_known_exception() {
  local file=$1 label=$2 expected=$3 why=$4
  LOG="$REPORT/$(printf '%03d' "$((COUNT+1))")-chain-idempotent.log"
  if psql_dry main "$MIGRATOR" -1 -f "$file" > "$LOG" 2>&1; then
    record PASS chain-idempotent "$label immediate retry [$MIGRATOR]"
  elif grep -q "$expected" "$LOG"; then
    record NOTE chain-idempotent "$label retry fails as documented ($why)"
  else
    record FAIL chain-idempotent "$label immediate retry [$MIGRATOR]"; sed -n '1,30{s/^/    /;p;}' "$LOG"
  fi
}
snapshot_writer() { psql_dry main "$MIGRATOR" -At -f "$SUPPORT/writer-privileges.sql" > "$REPORT/writer-$1.tsv"; }
capture_old() { psql_dry main "$MIGRATOR" -At -f "$SUPPORT/capture-old-calls.sql" > "$REPORT/$1.json"; }
seed_and_capture() {
  psql_dry main "$MIGRATOR" -1 -f "$SUPPORT/seed-025.sql"
  capture_old pre-upgrade
}
upgrade_compat() {
  capture_old post-upgrade
  node "$SUPPORT/report-tools.mjs" compat "$REPORT/pre-upgrade.json" "$REPORT/post-upgrade.json" \
    "$(node scripts/schema-provenance.mjs --field schemaVersion)"
}
retry_head() {
  local file prefix
  while IFS= read -r file; do
    prefix=$(basename "$file"); prefix=${prefix%%_*}
    if [ "$((10#$prefix))" -gt 25 ]; then echo "Retrying head: $file"; psql_dry main "$MIGRATOR" -1 -f "$file"; fi
  done < "$TEMP/migrations"
  snapshot_writer head
}
identity() {
  VERSION=$(node scripts/schema-provenance.mjs --field schemaVersion)
  MIGRATION_COUNT=$(node scripts/schema-provenance.mjs --field schemaMigrationCount)
  CHECKSUM=$(node scripts/schema-provenance.mjs --field schemaChainChecksum)
  ALGORITHM=$(node scripts/schema-provenance.mjs --field schemaChecksumAlgorithm)
}
provenance() {
  psql_dry main "$MIGRATOR" -v "version=$VERSION" -v "count=$MIGRATION_COUNT" \
    -v "checksum=$CHECKSUM" -v "algorithm=$ALGORITHM" -f "$SUPPORT/provenance.sql"
}
schema_contract() {
  psql_dry main postgres -At -c 'begin; set local role service_role; select public.urc_schema_contract_evidence(); rollback;' > "$REPORT/schema-evidence.json"
  local rc=0
  npx --no-install tsx scripts/accuracy/schema-contract.ts --evidence "$REPORT/schema-evidence.json" \
    --expect-schema "$VERSION" --expect-migration-count "$MIGRATION_COUNT" --expect-schema-checksum "$CHECKSUM" \
    --expect-checksum-algorithm "$ALGORITHM" --out "$REPORT/schema-contract.json" || rc=$?
  node "$SUPPORT/report-tools.mjs" contract "$REPORT/schema-contract.json"
  return "$rc"
}
p1() {
  node "$SUPPORT/assertion-requests.mjs" > "$TEMP/requests.json"
  npx --no-install tsx "$SUPPORT/sign-assertions.ts" < "$TEMP/requests.json" > "$TEMP/assertions.json"
  psql_dry main "$MIGRATOR" -v "assertions=$(cat "$TEMP/assertions.json")" -f "$SUPPORT/checks-p1-user-data.sql"
  psql_dry main postgres -v surface=p1 -f "$SUPPORT/checks-private-surfaces.sql"
}
p8() {
  local role failed=0
  for role in service_role urc_user_writer; do
    echo "Job lifecycle as $role"
    if ! psql_dry main postgres -v "test_role=$role" -f "$SUPPORT/checks-p8-jobs.sql"; then failed=1; fi
  done
  if ! psql_dry main postgres -v surface=p8 -f "$SUPPORT/checks-private-surfaces.sql"; then failed=1; fi
  [ "$failed" -eq 0 ]
}
p9() {
  node "$SUPPORT/assertion-requests.mjs" p9 > "$TEMP/requests.json"
  if ! npx --no-install tsx "$SUPPORT/sign-assertions.ts" < "$TEMP/requests.json" > "$TEMP/assertions.json"; then
    echo 'P9: real application signer failed (including alert-hits); stopping without a substitute signer.' >&2
    return 1
  fi
  psql_dry main postgres -v "assertions=$(cat "$TEMP/assertions.json")" -f "$SUPPORT/checks-p9-alert-hits.sql"
}
writer() {
  snapshot_writer final
  # Snapshots in order: one per upgrade migration (writer-0NNN), the retried head, the final state.
  node "$SUPPORT/report-tools.mjs" writer "$REPORT"/writer-0*.tsv "$REPORT/writer-head.tsv" "$REPORT/writer-final.tsv"
}
grant_audit() {
  psql_dry main "$MIGRATOR" -At -F $'\t' -f "$SUPPORT/grant-audit.sql" > "$REPORT/grant-audit.tsv"
  node "$SUPPORT/report-tools.mjs" audit "$REPORT/grant-audit.tsv"
}
chain_test() {
  # The only DATABASE_URL assignment is this freshly constructed disposable CI URL.
  # A PATH shim enforces -X and rejects every URL except that exact local target.
  mkdir -p "$TEMP/bin"
  cat > "$TEMP/bin/psql" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
[ "${1:-}" = "$DRYRUN_CI_URL" ] || { echo 'CI psql refused non-disposable URL' >&2; exit 1; }
shift
for arg in "$@"; do
  case "$arg" in postgres://*|postgresql://*|--host*|-h*|--dbname*|-d*|--username*|-U*|--port*|-p*|--service*)
    echo 'CI psql refused connection override' >&2; exit 1;; esac
done
exec "$DRYRUN_REAL_PSQL" "$DRYRUN_CI_URL" -X "$@"
WRAPPER
  chmod +x "$TEMP/bin/psql"
  export DRYRUN_CI_URL="postgres://postgres:$DRYRUN_DB_PASSWORD@127.0.0.1:$CI_PORT/postgres"
  export DRYRUN_REAL_PSQL=$PSQL
  PATH="$TEMP/bin:$(dirname "$PSQL"):$PATH" DATABASE_URL="$DRYRUN_CI_URL" bash tests/db/migration-chain.sh > "$REPORT/chain-test-raw.log" 2>&1
  cat "$REPORT/chain-test-raw.log"
  [ "$(tail -n 1 "$REPORT/chain-test-raw.log")" = 'Migration chain: ALL ASSERTIONS PASS' ]
}
run_check setup 'Docker, host psql, node, npx and openssl' requirements
if [ "$LAST_RESULT" != PASS ]; then
  for id in $IDS; do selected "$id" && skip_check "$id" "$id" 'Required tools/Docker unavailable'; done
  exit 1
fi
PSQL=$(cat "$TEMP/psql-path")
DRYRUN_DB_PASSWORD=$(openssl rand -hex 24)
DRYRUN_SIGNING_SECRET=$(openssl rand -hex 24)
export DRYRUN_DB_PASSWORD DRYRUN_SIGNING_SECRET
OWNED=1
stop_pg "$MAIN"; stop_pg "$CI"
NEED_A=0
for id in $IDS; do if [ "$id" != chain-test ] && selected "$id"; then NEED_A=1; fi; done
HEAD_READY=0
MIGRATOR=urc_migrator
if [ "$NEED_A" = 1 ]; then
  run_check setup-a 'Start Supabase-like disposable Postgres' start_pg "$MAIN" "$PORT"
  if [ "$LAST_RESULT" = PASS ]; then
    run_check prelude 'Supabase roles, extensions, defaults and non-superuser owner' prelude
    if [ "$LAST_RESULT" = PASS ]; then
      ls db/migrations/*.sql | sort > "$TEMP/migrations"
      CHAIN_OK=1
      FALLBACK=0
      while :; do
        while IFS= read -r file; do
          prefix=$(basename "$file"); prefix=${prefix%%_*}
          [ "$((10#$prefix))" -le 25 ] || continue
          apply_migration_twice "$file"
          if [ "$APPLY_OK" != 1 ]; then CHAIN_OK=0; FAILED_FILE=$file; break; fi
        done < "$TEMP/migrations"
        if [ "$CHAIN_OK" = 1 ] || [ "$FALLBACK" = 1 ]; then break; fi
        # Only explicit superuser-required errors justify fallback. Logical
        # migration defects (including 023's ACL contract guard) never do.
        if ! grep -Eiq 'must be superuser|only superusers|only roles with.*(BYPASSRLS|SUPERUSER)|permission denied to alter role' "$APPLY_FAILURE_LOG"; then break; fi
        printf 'Non-superuser phase blocked by %s; rebuilding with one postgres owner throughout.\n' "$file" | tee "$REPORT/superuser-fallback.txt"
        sed -n '/ERROR:/p' "$APPLY_FAILURE_LOG" >> "$REPORT/superuser-fallback.txt"
        # PG16 may require superuser for 025 ALTER ROLE on BYPASSRLS service_role.
        # A fresh cluster preserves 023's registry-owner requirement: never
        # switch migration identities halfway through a populated database.
        FALLBACK=1; MIGRATOR=postgres; CHAIN_OK=1
        stop_pg "$MAIN"
        run_check setup-a 'Rebuild phase with superuser after recorded role restriction' start_pg "$MAIN" "$PORT"
        if [ "$LAST_RESULT" != PASS ]; then CHAIN_OK=0; break; fi
        run_check prelude 'Supabase defaults for fallback postgres migration owner' prelude
        if [ "$LAST_RESULT" != PASS ]; then CHAIN_OK=0; break; fi
      done
      if [ "$CHAIN_OK" != 1 ]; then
        REACHED_FAILURE=0
        while IFS= read -r file; do
          if [ "$file" = "${FAILED_FILE:-}" ]; then REACHED_FAILURE=1; continue; fi
          [ "$REACHED_FAILURE" = 1 ] || continue
          label=$(basename "$file")
          skip_check chain-apply "$label [$MIGRATOR]" 'Earlier first apply failed'
          skip_check chain-idempotent "$label immediate retry [$MIGRATOR]" 'Earlier first apply failed'
        done < "$TEMP/migrations"
      fi
      if [ "$CHAIN_OK" = 1 ]; then
        run_check upgrade-seed 'Production-shaped 025 seed and old-call snapshot' seed_and_capture
        if [ "$LAST_RESULT" = PASS ]; then
          UPGRADE_OK=1
          while IFS= read -r file; do
            prefix=$(basename "$file"); prefix=${prefix%%_*}
            if [ "$((10#$prefix))" -gt 25 ]; then
              apply_migration_twice "$file"
              if [ "$APPLY_OK" != 1 ]; then UPGRADE_OK=0; break; fi
              run_check writer-snapshot "Writer ACLs immediately after $prefix" snapshot_writer "0$prefix"
            fi
          done < "$TEMP/migrations"
          if [ "$UPGRADE_OK" = 1 ]; then
            HEAD_READY=1
            run_check upgrade-compat 'Preserve old 025 calls through the chain head' upgrade_compat
            run_check reapply-head 'Retry every post-025 migration on head' retry_head
          fi
        fi
      fi
    fi
  fi
  if [ "$HEAD_READY" != 1 ]; then
    skip_check upgrade-compat 'Preserve old 025 calls through the chain head' 'Phase A prerequisite failed'
    skip_check reapply-head 'Retry every post-025 migration on head' 'Phase A prerequisite failed'
  fi
  for id in $IDS; do
    case "$id" in provenance|schema-contract|p1-user-data|p2-search-letters|p8-jobs|p9-alert-hits|writer-role|grant-audit) ;; *) continue;; esac
    selected "$id" || continue
    if [ "$id" = grant-audit ] && [ ! -f "$SUPPORT/grant-audit.sql" ]; then
      skip_check "$id" 'Supervisor grant audit' 'grant-audit.sql not present'; continue
    fi
    if [ "$HEAD_READY" != 1 ]; then skip_check "$id" "$id" 'Phase A chain/upgrade failed'; continue; fi
    case "$id" in
      provenance) identity; run_check "$id" 'Registry and anon RPC match repository' provenance;;
      schema-contract) identity; run_check "$id" 'Independent service evidence passes with no problems' schema_contract;;
      p1-user-data) run_check "$id" 'Real application signatures, nine-kind CRUD and isolation' p1;;
      p2-search-letters) run_check "$id" 'Old/new calls, filter-only order and facet ACLs' psql_dry main postgres -f "$SUPPORT/checks-p2-search-letters.sql";;
      p8-jobs) run_check "$id" 'Job lifecycle under both transports; web denied' p8;;
      p9-alert-hits) run_check "$id" 'Signed alert hits, evaluator lifecycle and private ACLs' p9;;
      writer-role) run_check "$id" 'Stable attributes; only job and alert-hit ACL additions' writer;;
      grant-audit)
        if [ -f "$SUPPORT/grant-audit.sql" ]; then run_check "$id" 'Supervisor grant audit contains no FLAG' grant_audit;
        else skip_check "$id" 'Supervisor grant audit' 'grant-audit.sql not present'; fi;;
    esac
  done
fi
if selected chain-test; then
  run_check setup-b 'Start separate plain Postgres for CI parity' start_pg "$CI" "$CI_PORT"
  if [ "$LAST_RESULT" = PASS ]; then run_check chain-test 'Existing migration-chain test passes end to end' chain_test;
  else skip_check chain-test 'Existing migration-chain test' 'CI container unavailable'; fi
fi
[ "$FAILED" -eq 0 ]
