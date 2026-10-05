# Dependency advisories, October 2026

Status as of 2026-10-04. GitHub reported 16 open Dependabot alerts on `main`
(2 critical, 4 high, 6 moderate, 4 low). `npm audit` after a clean `npm ci`
reported 15 vulnerable packages (1 critical, 9 high, 4 moderate, 1 low); the
counts differ because npm groups advisories per package and also reports two
advisories Dependabot does not (`brace-expansion`, `braces`).

All 16 Dependabot alerts are resolved by one `npm audit fix`, within the existing
semver ranges, in the manner of #117. `package.json` is unchanged: `next`,
`@clerk/nextjs`, `@anthropic-ai/sdk`, `react`, `react-dom` and `typescript` did
not move across a major, and the existing `overrides` (`dompurify`, `postcss`,
`sharp`) still hold. One advisory has no published fix and is left open (below).

## Resolved by the lockfile bump

"Reachable" is a judgement from reading how the app uses the package; it is
marked "unknown" where the code path could not be established.

| Alert | Advisory | Package | Severity | Scope | Chain | Was, now (fixed in) | Reachable from the app |
|---|---|---|---|---|---|---|---|
| 21 | GHSA-p293-qw3h-jr36 | next | critical | runtime | direct (also `@clerk/nextjs` peer) | 16.3.0, 16.3.8 (16.3.3) | No as described: unauthenticated RCE on Windows-hosted servers; production is expected to be Linux (Vercel). Fixed regardless. |
| 22 | GHSA-2xp9-vwfh-vxw4 | next | critical | runtime | direct | 16.3.0, 16.3.8 (16.3.3) | Possibly. `next/image` is used (`src/components/brand/URCBrand.tsx`), so `/_next/image` is served. `next.config.mjs` does not enable AVIF. Treat as reachable until proven otherwise. |
| (npm audit) | GHSA-vcvr-r3jv-pc5j | next | critical | runtime | direct | 16.3.0, 16.3.8 | No: `next/og` / `ImageResponse` is not used. |
| 20 | GHSA-rgj7-g3m4-5g8c | sharp | high | runtime | `next` > `sharp` (pinned by override `^0.35.3`) | 0.35.3, 0.35.5 (0.35.4) | Possibly: sharp is the image optimizer's decoder. The advisory concerns libheif (HEIC/HEIF input); the app serves only its own static images. |
| 23 | GHSA-2883-xcg3-v3hh | js-yaml | high | dev | `eslint` > `@eslint/eslintrc` > `js-yaml` | 4.3.1, 4.3.2 (4.3.2) | No: parses ESLint config only. |
| 28 | GHSA-w293-vg96-wgc3 | undici | high | dev | `jsdom` > `undici` | 8.10.0, 8.11.2 (8.10.2) | No: test environment only; no production import of `undici` or `jsdom`. |
| 25 | GHSA-vp8m-p9jh-q5pm | undici | high | dev | `jsdom` > `undici` | 8.10.0, 8.11.2 (8.10.2) | No: as above. |
| 32, 29 | GHSA-pmjh-fq2x-6v4x, GHSA-2jfj-6hjv-fm6j | undici | moderate | dev | `jsdom` > `undici` | 8.10.0, 8.11.2 (8.10.2) | No: as above. |
| 34, 30, 27 | GHSA-2gqq-gqf2-x968, GHSA-r53p-7pc4-xj5r, GHSA-8436-99hf-9mmv | undici | low | dev | `jsdom` > `undici` | 8.10.0, 8.11.2 (8.10.2) | No: as above. |
| 19, 18 | GHSA-82fw-gwwq-j7x9 | vitest, @vitest/mocker | moderate | dev | direct / `vitest` > `@vitest/mocker` | 4.1.10, 4.1.11 (4.1.11) | No: needs the Vitest dev server with a redirect mock; tests run headless in CI. |
| 17 | GHSA-8cw4-87c7-c6xx | csv-parse | moderate | dev | direct (devDependency) | 7.0.1, 7.0.3 (7.0.2) | No: used only by `data-pipeline/load-auditors.ts`, an offline loader reading a file we control, and not with `group_columns_by_name`. |
| 16 | GHSA-px8p-9vwx-vf98 | fflate | moderate | runtime | `posthog-js` > `fflate` | 0.4.8, 0.4.9 (0.4.9) | Unknown. Pulled in only by `posthog-js` (the app never imports it directly). The vulnerable path is `unzipSync` on a malformed ZIP64 archive; the app's code never unzips anything, but what posthog-js does internally was not audited. |
| 35 | GHSA-p98j-92pf-mc4p | dompurify | low | runtime | `posthog-js` > `dompurify` (pinned by override `^3.4.12`) | 3.4.14, 3.4.16 (3.4.16) | Unknown, likely not. `src` never imports `dompurify` (the app's own sanitizing uses `sanitize-html`, `src/lib/sec-upstream.ts`), so it is reachable only through `posthog-js` internals, and only for an `IN_PLACE` sanitize with a node-removing `afterSanitize` hook. What posthog-js does internally was not audited. |

The two `next` alert rows above are the two Dependabot alerts (21, 22); the
`next/og` advisory is listed by `npm audit` only.

`brace-expansion` (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p,
high, dev-only; `eslint` > `minimatch` and `typescript-eslint` > `minimatch`)
is also fixed by the bump (5.0.9 to 5.0.12 and 1.1.18 to 1.1.21). It is not a
reachable path from the app: ESLint globbing runs on our own file patterns.

## Left open

### braces (GHSA-vfj7-8cjw-p6xm, high, dev-only) — no patched version exists

- Chain: `eslint-config-next` > `@next/eslint-plugin-next` > `fast-glob@3.3.1` >
  `micromatch@4.0.8` > `braces@3.0.3`.
- Advisory: stack exhaustion on deeply nested brace patterns, affects
  `braces <= 3.0.3`. The newest published release is 3.0.3, so there is no
  `first_patched_version`. Dependabot raised no alert for it (no patch to
  propose); `npm audit` reports it.
- Why it was left: `npm audit fix --force` offers to "fix" it by installing
  `eslint-config-next@14.2.35`, a major downgrade that does not match Next 16 and
  is rejected. An `overrides` entry has nothing to point at.
- Mitigation: it is a development-only dependency of the lint step. The only
  glob patterns passed through it are the fixed ones `@next/eslint-plugin-next`
  builds from our own repository layout, so no attacker-supplied pattern reaches
  `braces`. `npm audit --omit=dev` reports 0 vulnerabilities, so nothing in the
  shipped dependency tree is affected.
- Unblock when: `braces` publishes a release above 3.0.3, or
  `@next/eslint-plugin-next` drops `fast-glob`. Then `npm update braces` (or
  bump `eslint-config-next`) and delete this section.

Consequence for CI: `.github/workflows/ci.yml` runs
`npm audit --audit-level=high` over the full tree, so this advisory keeps that
step red until a patch ships. This commit does not change the workflow (out of
scope). The decision for the maintainer is either to run the gate as
`npm audit --omit=dev --audit-level=high` (matches the 0 result above and the
"production dependency security" priority in `.github/dependabot.yml`), or to
accept the red step until `braces` is patched.

## Verification

Run in a clean worktree after `npm ci` and `npm audit fix`:

- `npm audit --omit=dev`: found 0 vulnerabilities.
- `npm audit`: 5 high (all one advisory, `braces`, and the four packages that
  depend on it up to `eslint-config-next`).
- `npm run typecheck`: clean. `npm run lint`: clean.
- `npm test`: 176 files, 1919 tests passed.
- `npm run build`: succeeded (Next.js 16.3.8, Turbopack).
