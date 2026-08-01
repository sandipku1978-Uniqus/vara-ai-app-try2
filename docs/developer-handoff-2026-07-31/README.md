# Uniqus Research — Production Remediation Handoff

Prepared: 2026-07-31  
Repository baseline: `d834032b0f103c50ab647ce4fc49bc67c89834a9`  
Production URL: `https://uniqus-research.vercel.app`

## Purpose

This package turns the agreed remediation recommendations into a developer-ready delivery plan. It covers three outcomes:

1. Correct Boolean branch retrieval and eliminate auditor/topic application 502s, then prove accuracy on the exact production candidate SHA.
2. Remove the production Supabase service-key fallback and add CSP plus automated security controls.
3. Decompose the search execution path without changing behavior, then turn the UI control inventory into real interaction tests.

The plan preserves the application's current content and useful feature set. It does not propose new product features, a broad rewrite, or a redesign of the existing user journeys.

## Package contents

- `01_IMPLEMENTATION_PLAN.md` — sequenced, reviewable work packages with dependencies and completion criteria.
- `02_ACCEPTANCE_MATRIX.csv` — 20 blocking tests and measurable release thresholds.
- `03_EXACT_SHA_RELEASE_RUNBOOK.md` — the preview-to-production procedure that prevents testing one revision and shipping another.
- `04_BASELINE_EVIDENCE.md` — confirmed source evidence, current gaps, and hypotheses that require production telemetry.
- `manifest.json` — machine-readable package metadata and file checksums, completed when the ZIP is assembled.

## Recommended execution order

1. Freeze automatic production promotion and make the candidate revision observable.
2. Apply a forward-only database permission/RPC repair and verify it with the restricted web credential.
3. Remove the production service-key fallback and preserve only the narrowly scoped cache writer.
4. Repair Boolean compilation, fair branch retrieval, failure handling, and per-branch coverage.
5. Run the consolidated semantic accuracy gate against an immutable preview.
6. Add CSP and repository security automation.
7. Decompose the executor behind its current public interface.
8. Replace control-inventory assertions with actual interaction coverage.
9. Promote the already-tested preview artifact and run production smoke checks.

## Release decision rule

Do not promote based on a passing local branch or on a rebuild from the same source. Create one immutable preview, record its Git SHA and deployment ID, run every blocking item in `02_ACCEPTANCE_MATRIX.csv` against that preview, and promote that same deployment only when all blocking checks pass.

Recommended release thresholds:

- Ticker resolution: 100%.
- Boolean truth-table precision and recall: 100%.
- Branch-exclusive recall: 100%.
- Overall semantic accuracy: at least 97%.
- Auditor/topic application 5xx responses: 0%.
- Auditor p95 latency: under 5 seconds.
- Topic p95 latency: under 2 seconds.
- Critical skipped tests: zero.
- Production web-route service-key fallback: impossible.
- UI actions: every action is covered by an executable test or a named, owned, expiring manual exception.

## Important handling notes

- The repository had an unrelated local change to `next-env.d.ts` while this package was created. It is intentionally excluded from the ZIP and must not be bundled into remediation commits without separate review.
- No environment values, credentials, raw service keys, production data, or sensitive logs are included.
- The baseline SHA identifies the code reviewed for this plan. Production parity must be reconfirmed at the beginning of the release runbook.
- Database changes must be forward-only. Do not edit or replay an already-applied migration to repair grants.
- Refactoring begins only after correctness fixtures fail for the right reason and then pass. The existing route and service interfaces remain stable during decomposition.

## Definition of done

The work is complete only when the exact production candidate passes the full acceptance matrix, the promoted deployment identifies the same SHA, production smoke checks pass, the prior healthy deployment remains available for rollback, and all evidence artifacts are attached to the release record.
