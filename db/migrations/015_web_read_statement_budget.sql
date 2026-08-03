-- 015_web_read_statement_budget.sql
--
-- WHY (accuracy-gate run 30782680799, 2026-08-03 — the first run on the real
-- anon-key read path): ticker sweep 10,412/10,412 PASS, but the 1,000-point
-- e2e suite failed its 90% bar at 81.9% — and 165 of 167 failures were
-- HTTP 504 clustered at ~7s. Status 504 is the db-observability mapping of
-- Postgres error 57014 (statement_timeout): the anon role's statement budget
-- kills the heavy read RPCs at ~7s. The old ~94% CI baseline was measured on
-- the SERVICE-ROLE path (pre-#41), which this limit never applied to — the
-- queries did not get slower; the clock got real.
--
-- WHAT: give the web read identities (anon, urc_web if present) a 20s
-- statement budget. Observed need: heaviest passing case 14.9s; failing
-- cases were killed at ~7s. 20s covers the observed P100 with headroom
-- without being unbounded.
--
-- WHY NOT per-function SET on the six RPCs: a function-level
-- `SET statement_timeout` cannot extend the timeout of the statement that is
-- already executing the function — Postgres arms the timer at statement
-- start. Role-level settings are the supported lever: PostgREST applies the
-- switched role's settings per request.
--
-- THE DURABLE FIX IS INDEX WORK, NOT A BIGGER BUDGET. This unblocks the
-- accuracy gate and the live anon-key product path; the WP5 latency-threshold
-- work (blocked on telemetry) is where per-query targets get set and the
-- heavy reads get profiled. Revisit this budget downward once that lands.
--
-- ABUSE NOTE: the publishable key is public by design, so 20s raises the
-- work a stranger can demand per statement. Bounded (not 0), rate limits
-- exist at the app tier, and reads are the risk boundary here, not writes
-- (014 revoked every write path).
--
-- APPLY: Supabase SQL editor, as postgres. Idempotent; safe to re-run.
-- The pgrst reload is required — without it PostgREST keeps serving with the
-- old role settings until its next config reload.

alter role anon set statement_timeout = '20s';

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'urc_web') then
    execute $q$alter role urc_web set statement_timeout = '20s'$q$;
  end if;
end $$;

notify pgrst, 'reload config';

-- ── Probe (run each statement SEPARATELY, per the 014 lesson: the SQL editor
-- runs a whole selection as ONE transaction as postgres, which masks
-- role-scoped behavior) ──────────────────────────────────────────────────────
--
-- 1. Confirm the setting is attached to the role:
--      select rolname, rolconfig from pg_roles
--      where rolname in ('anon','urc_web');
--    Expect: rolconfig contains 'statement_timeout=20s'.
--
-- 2. Confirm PostgREST picked it up (this is the one that matters): from the
--    app or curl, run the heaviest auditor search against /api/es-search —
--    a query that previously 504'd at ~7s should now either complete or run
--    visibly past 7s before any failure.
--
-- 3. Re-dispatch the "Accuracy gate" workflow. The e2e suite's 504 cluster
--    at ~7s should disappear; remaining failures are real content findings.
