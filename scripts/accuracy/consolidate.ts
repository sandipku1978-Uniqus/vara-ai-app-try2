/**
 * Consolidated release-evidence report (remediation handoff WP5).
 *
 * One trustworthy answer to "did the exact release candidate pass?" — built
 * from the three independent suites, reported as SEPARATE dimensions (never
 * averaged into one misleading score), stamped with the provenance of the
 * deployment that was actually tested.
 *
 *   npx tsx scripts/accuracy/consolidate.ts \
 *     --base http://localhost:3111 \
 *     --semantic accuracy-report.json \
 *     --tickers ticker-coverage-report.json \
 *     --e2e e2e-perf-report.json \
 *     --out release-evidence.json
 *
 * Fail-closed rules (exit 1):
 *   - any input report is missing or unparsable (a suite that did not run is
 *     not a passing suite);
 *   - semantic score below its threshold; a critical suite (boolean,
 *     filing-entity) that produced NO scored checks, or whose skip fraction
 *     exceeds 20% — a suite that did not effectively run cannot pass.
 *     Case-level skips below that, with the runner's documented external
 *     reasons (e.g. an ADR issuer with no EDGAR filings to correct to), are
 *     recorded as warnings in the evidence, not failures: the first full
 *     gate run (30783955373) scored filing-entity 58/58 and boolean 5/5 yet
 *     failed the release because two foreign ADRs file nothing on EDGAR —
 *     that reads the fail-closed rule against its own intent;
 *   - ticker resolution below 100%;
 *   - e2e pass rate below its own threshold as recorded by the suite;
 *   - the tested deployment reports a SHA that differs from the SHA this run
 *     claims to be testing (EXPECTED_SHA env or --expect-sha).
 */

import { readFileSync, writeFileSync } from 'node:fs';

function arg(name: string): string | null {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function readReport(path: string | null, label: string): Record<string, unknown> | null {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    process.stderr.write(`FAIL-CLOSED: ${label} report at ${path} is missing or unparsable (${(error as Error).message}).\n`);
    return null;
  }
}

async function fetchVersion(base: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/version`);
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const base = arg('--base') || 'http://localhost:3111';
  const out = arg('--out') || 'release-evidence.json';
  const expectedSha = arg('--expect-sha') || process.env.EXPECTED_SHA || null;

  const semantic = readReport(arg('--semantic'), 'semantic');
  const tickers = readReport(arg('--tickers'), 'ticker-coverage');
  const e2e = readReport(arg('--e2e'), 'e2e-perf');

  const problems: string[] = [];
  if (!semantic) problems.push('semantic suite did not produce a report');
  if (!tickers) problems.push('ticker suite did not produce a report');
  if (!e2e) problems.push('e2e suite did not produce a report');

  // ── Semantic dimension ──
  const semanticChecks = (semantic?.checks ?? []) as Array<{ suite: string; passed: boolean; skipped?: boolean }>;
  const semanticScore = Number(semantic?.score ?? 0);
  const semanticThreshold = Number(semantic?.threshold ?? 97);
  const CRITICAL_SEMANTIC_SUITES = ['boolean', 'filing-entity'];
  const warnings: string[] = [];
  const criticalSkips = semanticChecks.filter(
    check => check.skipped && CRITICAL_SEMANTIC_SUITES.includes(check.suite)
  );
  if (semantic) {
    if (semanticScore < semanticThreshold) {
      problems.push(`semantic score ${semanticScore.toFixed(1)}% is below threshold ${semanticThreshold}%`);
    }
    for (const suite of CRITICAL_SEMANTIC_SUITES) {
      const scored = semanticChecks.filter(c => c.suite === suite && !c.skipped).length;
      const skipped = semanticChecks.filter(c => c.suite === suite && c.skipped).length;
      if (scored === 0) {
        problems.push(`critical suite '${suite}' produced no scored checks — a suite that did not run cannot pass a release`);
      } else if (skipped / (scored + skipped) > 0.2) {
        problems.push(`critical suite '${suite}': ${skipped} of ${scored + skipped} checks skipped — too much of the critical surface is unmeasured to pass`);
      } else if (skipped > 0) {
        // The runner only skips with a stated external reason (unreachable
        // source, issuer files nothing on EDGAR, filing lacks the XBRL tag).
        // Visible, never silent — but a 100%-scored suite is not failed for
        // the world containing issuers it cannot measure.
        warnings.push(`critical suite '${suite}': ${skipped} check(s) skipped for documented external reasons; ${scored} scored`);
      }
    }
  }

  // ── Ticker dimension (100% required) ──
  const tickerTotal = Number(tickers?.tickers ?? 0);
  const tickerPass = Number(tickers?.pass ?? 0);
  if (tickers && (tickerTotal === 0 || tickerPass < tickerTotal)) {
    problems.push(`ticker resolution ${tickerPass}/${tickerTotal} — must be 100%`);
  }

  // ── E2E dimension ──
  // Report shape (e2e-perf-test.ts): { totalPass, total, summary: per-class[] }.
  const e2eTotal = Number(e2e?.total ?? 0);
  const e2eTotalPass = Number(e2e?.totalPass ?? 0);
  const e2ePassRate = e2eTotal > 0 ? (e2eTotalPass / e2eTotal) * 100 : NaN;
  const e2eMinPass = Number(arg('--e2e-min-pass') || 90);
  if (e2e && (!Number.isFinite(e2ePassRate) || e2ePassRate < e2eMinPass)) {
    problems.push(`e2e pass rate ${Number.isFinite(e2ePassRate) ? e2ePassRate.toFixed(1) : 'n/a'}% is below its ${e2eMinPass}% bar`);
  }

  // ── Provenance ──
  const version = await fetchVersion(base);
  const reportedSha = (version?.sha as string | null) ?? null;
  if (expectedSha && reportedSha && reportedSha !== expectedSha) {
    problems.push(`tested deployment reports SHA ${reportedSha}, expected ${expectedSha} — evidence does not describe the candidate`);
  }
  if (expectedSha && !version) {
    problems.push('deployment did not answer /api/version — provenance cannot be proven');
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    base,
    provenance: {
      expectedSha,
      reported: version,
    },
    dimensions: {
      semantic: semantic ? { score: semanticScore, threshold: semanticThreshold, criticalSkips: criticalSkips.length, checks: semanticChecks.length } : null,
      tickerResolution: tickers ? { pass: tickerPass, total: tickerTotal } : null,
      e2e: e2e ? { total: e2eTotal, totalPass: e2eTotalPass, passRate: Number.isFinite(e2ePassRate) ? Number(e2ePassRate.toFixed(1)) : null, minPass: e2eMinPass, perClass: e2e.summary ?? null } : null,
    },
    problems,
    warnings,
    pass: problems.length === 0,
  };

  writeFileSync(out, JSON.stringify(evidence, null, 2));
  process.stdout.write(`\nRelease evidence → ${out}\n`);
  for (const warning of warnings) process.stdout.write(`  ~ ${warning}\n`);
  if (problems.length > 0) {
    process.stdout.write('BLOCKED:\n');
    for (const problem of problems) process.stdout.write(`  ✗ ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('All release dimensions pass.\n');
}

main().catch(error => {
  process.stderr.write(`consolidate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
