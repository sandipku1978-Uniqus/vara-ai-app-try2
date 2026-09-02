# UI action execution evidence

The UI inventory contains 136 actionable-control contracts and one required
content contract. A source file merely containing a title is not proof that a
test was discovered or executed, so CI joins both inventories to Playwright's
runtime reporter output by exact `{file,title}`.

## Evidence contract

- `src/__tests__/uiActionCoverage.ts` is the canonical action-to-test mapping.
  `UI_ACTION_TEST_MAP` is a JSON-serializable projection with bounded action,
  reference, path, and title limits. `UI_CONTENT_TEST_MAP` is deliberately
  separate so static copy cannot masquerade as an executed control.
- `scripts/ui-actions/playwright-reporter.ts` emits
  `urc.playwright-action-run.v1`. It records only test identity, project,
  outcome, retry status, duration, assertion/interaction counts, and bounded
  per-action proof counts. It never records URLs, errors, stdout, attachments,
  cookies, or traces.
- `scripts/ui-actions/validate.ts` emits `urc.ui-action-evidence.v1`, including
  the exact commit SHA, full and scoped mapping digests, every action and test
  reference, counts, problems, and the final decision.

The validator fails when a mapped test is absent from discovery, has no result,
is only skipped, lacks action-specific proof with both an assertion and a real
user-like Playwright interaction, has any failed/timed-out/interrupted attempt,
is flaky after retry, or comes from a different commit SHA. A test identity
owned by one action is its bounded action scope. Any identity shared by several
actions must execute explicit `ui-action:<id>` steps; aggregate clicks cannot
satisfy those actions, and unknown/misplaced markers fail as forgery. Content
contracts require assertions but never interaction counts. Environment-specific
skips are accepted only when another supplied report cleanly executes that exact
test; this joins development-only gallery coverage to the production run.

## CI split

The regular browser job validates 134 actions / 151 exact test references plus
1 content contract / 1 exact reference from the development-gallery and
production-build runs. The protected-main Clerk lifecycle validates the
remaining 3 actions / 4 exact test references. The
workflow retains the following metadata-only artifacts for 30 days:

- `ui-action-evidence-browser-<sha>`
- `ui-action-evidence-auth-<sha>`

Both workflows pass `github.sha` to the reporter and validator. Missing or
mismatched SHA evidence makes the workflow fail. Production Clerk configuration
is not read or changed; the credentialed lifecycle continues to use only the
existing Clerk development test identity.

Local validation uses the same command:

```sh
npm run validate:ui-actions -- \
  --scope browser \
  --report /path/to/development/ui-action-run.json \
  --report /path/to/production/ui-action-run.json \
  --out /path/to/ui-action-evidence-browser.json
```
