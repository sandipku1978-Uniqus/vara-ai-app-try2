import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const requestedBaseUrl = process.env.QA_BASE_URL?.replace(/\/$/, '');
const localPort = Number(process.env.QA_PORT || 4317);
const baseURL = requestedBaseUrl || `http://127.0.0.1:${localPort}`;
const artifactRoot = process.env.QA_OUTPUT_DIR || join(tmpdir(), 'urc-playwright');

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: join(artifactRoot, 'results'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 45_000,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: join(artifactRoot, 'report'), open: 'never' }]]
    : [['list'], ['html', { outputFolder: join(artifactRoot, 'report'), open: 'never' }]],
  use: {
    baseURL,
    storageState: process.env.QA_STORAGE_STATE || undefined,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // QA_BASE_URL lets the suite inspect an already-running local, preview, or
  // production deployment. QA_STORAGE_STATE can supply an authenticated
  // browser state there; QA_PUBLIC_ONLY=1 limits runs to neutral-visitor pages.
  // Without QA_BASE_URL, Playwright owns an isolated local server and enables
  // the repository's localhost-only authentication bypass.
  //
  // PW_PROD_BUILD=1 serves that local server from `next build` + `next start`
  // instead of the dev server (remediation handoff WP8: release evidence must
  // exercise the production build — dev-mode rendering, compilation and error
  // overlays differ from what users get). CI sets it; local iteration keeps
  // the fast dev default.
  webServer: requestedBaseUrl
    ? undefined
    : {
        command: process.env.PW_PROD_BUILD === '1'
          ? `npm run build && npx next start --hostname 127.0.0.1 --port ${localPort}`
          : `npm run dev -- --hostname 127.0.0.1 --port ${localPort}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: process.env.PW_PROD_BUILD === '1' ? 420_000 : 120_000,
        env: {
          URC_E2E_BYPASS_AUTH: '1',
          // Client-side counterpart, inlined at build. This keeps identity
          // hydrating instantly so the storageScope flip cannot reset state
          // mid-test (the flake root cause diagnosed in #59).
          //
          // It used to say CI runners cannot reach the Clerk dev instance.
          // That was wrong — measured from a runner, the frontend API answers
          // 200 in 0.38s and api.clerk.com in 0.28s. CI simply never had a
          // publishable key, so clerk-js never attempted to load and the
          // symptom was misattributed. The real reason for the bypass here is
          // determinism, not reachability; tests/e2e-auth/ exercises the
          // genuine Clerk surface.
          NEXT_PUBLIC_URC_E2E_BYPASS_AUTH: '1',
          NEXT_PUBLIC_SITE_URL: baseURL,
          // `npm run build` pins NEXT_LOCAL_BUILD=1 (writes .next-build);
          // `next start` must read the same distDir.
          NEXT_LOCAL_BUILD: '1',
        },
      },
});
