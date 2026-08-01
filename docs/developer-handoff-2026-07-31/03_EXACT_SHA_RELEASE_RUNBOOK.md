# Exact-SHA Accuracy and Production Release Runbook

## Rule

Build once, test that immutable deployment, and promote that same deployment. A later rebuild from the same branch is a different artifact and requires revalidation.

## 1. Prepare the release candidate

1. Confirm the worktree contains only intended release changes.
2. Record:
   - candidate Git SHA;
   - source branch and pull request;
   - database migration set/checksum;
   - fixture/corpus version;
   - prior healthy production deployment ID and SHA;
   - release owner and UTC timestamp.
3. Ensure the candidate commit is pushed and immutable.
4. Confirm required checks and production protection rules are active before creating the preview.

Suggested local evidence commands:

```bash
git status --short
git rev-parse HEAD
git log -1 --format='%H %cI %s'
npm ci
npm test -- --no-file-parallelism --maxWorkers=1
npm run typecheck
npm run lint
npm audit --omit=dev
npm run build
```

Do not use the unrelated generated `next-env.d.ts` change as part of the release unless it is independently reviewed and intended.

## 2. Apply and verify the database contract

1. Back up/record current grants and exact RPC signatures.
2. Apply the new forward-only migration to preview/staging.
3. Refresh the PostgREST schema cache through the supported administrative mechanism.
4. Run the restricted-key positive read probes.
5. Run the restricted-key denied-operation probes.
6. Run auditor/topic diagnostics and capture error code, latency, and result correctness.
7. Stop if a route requires service authority for ordinary reads.

Required artifacts:

- migration checksum and application timestamp;
- grants/RPC signature inventory without credentials;
- positive read results;
- denied-operation results;
- auditor/topic latency and error summaries.

## 3. Build the immutable preview

1. Create a Vercel preview from the candidate commit.
2. Record preview URL and deployment ID.
3. Confirm the preview reports the candidate SHA.
4. Confirm preview uses the restricted Supabase web key and intended authentication configuration.
5. Do not promote or rebuild while acceptance is running.

Stop immediately if the preview SHA does not match the recorded candidate SHA.

## 4. Run deterministic release checks

Run all checks on the same commit and production-build mode:

```bash
npm test -- --no-file-parallelism --maxWorkers=1
npm run typecheck
npm run lint
npm audit --omit=dev
npm run build
```

Run browser tests against `next build` plus `next start`, with strict semantic auditing enabled. The release suite must not use `next dev` as its evidence server.

Required browser coverage:

- route smoke;
- neutral visitor;
- Boolean journeys;
- strict semantic census;
- real action/control interactions;
- representative mobile viewport;
- no uncaught console/page errors.

Capture Playwright HTML report, traces/screenshots for any retry or failure, test configuration, and the SHA tested.

## 5. Run the accuracy gate against the preview

Use the preview URL and restricted production-like configuration. The accuracy output must identify the preview deployment and SHA.

Required thresholds:

- Full ticker resolution: 100%.
- Boolean truth-table precision/recall: 100%.
- Branch-exclusive recall: 100%.
- Overall semantic accuracy: at least 97%.
- Auditor/topic application 5xx: 0%.
- Auditor p95: under 5 seconds.
- Topic p95: under 2 seconds.
- Critical skipped/indeterminate cases: zero.

Report semantic misses separately from availability failures. A 502 is not a semantic non-match; it is a release-blocking availability defect.

Stop and fix the candidate if any threshold fails. A threshold change requires an explicit product/engineering decision and does not retroactively pass the run.

## 6. Verify security on the preview

1. Scan CSP and baseline headers across page, API, redirect, authentication, not-found, and error response archetypes.
2. Confirm production web routes cannot fall back to a service credential.
3. Confirm restricted-key writes/maintenance are denied.
4. Review CSP reports and eliminate actionable violations.
5. Confirm dependency, CodeQL, and secret-scanning checks are green or documented according to policy.

## 7. Sign off the preview

The release record must contain:

- candidate SHA;
- preview deployment ID and URL;
- all 20 acceptance-matrix outcomes;
- accuracy raw results and summary;
- browser report;
- security/header report;
- migration/grant verification;
- known limitations, if any;
- approver and approval timestamp;
- rollback deployment ID and SHA.

Every blocking item must be green. Manual exceptions are not allowed for critical search correctness, authentication/authorization, least privilege, CSP presence, or exact-SHA provenance.

## 8. Promote without rebuilding

1. Promote/alias the accepted Vercel preview deployment to production using the platform's promote operation.
2. Do not trigger a fresh build from `main` as a substitute.
3. Record the resulting production deployment ID and promotion timestamp.
4. Verify production reports the same SHA and deployment artifact as the accepted preview.

## 9. Production smoke

Run non-mutating production checks:

- public route availability and neutral-visitor navigation;
- authentication entry/return path;
- one ordinary filing search;
- one Boolean branch-exclusive canary;
- one auditor facet query;
- one topic/comment-letter query;
- one filing detail/evidence navigation;
- CSP/security headers on success and error archetypes;
- production SHA/deployment identity.

Avoid tests that change another user's data, spend avoidable AI budget, or create persistent records without an isolated test account and cleanup contract.

## 10. Rollback conditions

Immediately restore the recorded prior deployment if any of these occur:

- production SHA/artifact differs from the accepted preview;
- auditor/topic application 5xx returns;
- required reads fail under the restricted key;
- Boolean branch-exclusive canary fails;
- CSP blocks a critical authenticated workflow;
- a security/authorization regression is observed;
- error rate or latency materially exceeds the accepted baseline.

After rollback, preserve logs and deployment evidence, classify the incident, and fix forward. Do not modify an applied migration in place.
