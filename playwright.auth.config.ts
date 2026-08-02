import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Next loads .env.local itself, but this config runs OUTSIDE Next, and both
// the guard below and clerkSetup() read process.env directly. Without this,
// `npm run test:auth` fails locally even when the keys are present, because
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY only ever lived in the file. dotenv does
// not overwrite variables that are already set, so CI's real environment
// still wins.
loadEnv({ path: '.env.local', quiet: true });

/**
 * Authentication e2e — a SEPARATE harness from playwright.config.ts.
 *
 * The main suite runs behind URC_E2E_BYPASS_AUTH, which makes proxy.ts return
 * next() for every request. That is deliberate (it removes the Clerk identity
 * flakes documented in tests/e2e/critical-actions.spec.ts) but it also means
 * the main suite CANNOT observe authentication at all: nothing is protected,
 * and with no publishable key in CI the Sign In / Get Started controls never
 * render either.
 *
 * This config runs its own server with the bypass explicitly OFF and real
 * Clerk keys, so the identity surface is the real one. It is a separate
 * config rather than a second project because the two need different server
 * environments, and because an auth outage must not be able to take the main
 * release-evidence suite down with it.
 *
 * REQUIRES (see docs/pending-keys-checklist.md):
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  pk_test_… from a Clerk DEVELOPMENT instance
 *   CLERK_SECRET_KEY                   sk_test_… from the same instance
 * @clerk/testing refuses production keys outright, by design.
 *
 * Verified empirically: with the bypass off and NO secret key, every route —
 * including public ones — returns 500, because clerkMiddleware initialises
 * before proxy.ts's public-path check runs.
 */

const localPort = Number(process.env.QA_AUTH_PORT || 4318);
// MUST be `localhost`, not 127.0.0.1. When a proxy.ts (middleware) is in
// play, Next's router forwards the request to `localhost:PORT` — so binding
// the server to 127.0.0.1 only means the forward resolves to ::1, finds
// nothing listening, and the request hangs until it dies with "socket hang
// up" / "Failed to proxy". The main suite never hit this because
// URC_E2E_BYPASS_AUTH makes proxy.ts return next() before the router's proxy
// hop happens; turning the bypass off is exactly what exposed it.
const host = 'localhost';
const baseURL = `http://${host}:${localPort}`;
const artifactRoot = process.env.QA_OUTPUT_DIR || join(tmpdir(), 'urc-playwright-auth');
const prodBuild = process.env.PW_PROD_BUILD === '1' || Boolean(process.env.CI);

// Checked at CONFIG LOAD, before Playwright starts the web server. Without a
// secret key the server 500s on every route, and Clerk's own "Missing
// secretKey" error floods the output long before globalSetup could report
// anything useful — so the actionable message has to come first.
if (!process.env.CLERK_SECRET_KEY || !(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY)) {
  throw new Error(
    'The authentication suite needs a Clerk DEVELOPMENT instance key pair.\n' +
      '  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…\n' +
      '  CLERK_SECRET_KEY=sk_test_…\n' +
      'Optionally CLERK_TEST_EMAIL=<user>+clerk_test@example.com to include the\n' +
      'sign-in/sign-out round trip. Setup steps: docs/pending-keys-checklist.md.\n' +
      'The main suite is unaffected — run `npx playwright test` for that.'
  );
}

export default defineConfig({
  testDir: './tests/e2e-auth',
  outputDir: join(artifactRoot, 'results'),
  globalSetup: './tests/e2e-auth/global-setup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: join(artifactRoot, 'report'), open: 'never' }]]
    : [['list'], ['html', { outputFolder: join(artifactRoot, 'report'), open: 'never' }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Production build in CI, dev server for local iteration.
    //
    // `next dev` DIES SILENTLY on a GitHub runner: the outer process starts,
    // then every health check returns ECONNRESET ("Failed to proxy … socket
    // hang up") with no Next banner and no error from the inner server, until
    // the webServer timeout. The `browser` job never hit this because it has
    // always built and run `next start`. Using the production build here also
    // restores the WP8 principle that what CI proves is what users get.
    command: prodBuild
      ? `npm run build && npx next start --hostname ${host} --port ${localPort}`
      : `npx next dev --hostname ${host} --port ${localPort}`,
    url: `${baseURL}/privacy`,
    reuseExistingServer: !process.env.CI,
    timeout: prodBuild ? 420_000 : 180_000,
    env: {
      // Explicitly '0', not merely absent: .env.local sets this to '1', and
      // Next reads .env.local into process.env. Unsetting the shell variable
      // is not enough to turn the bypass off. This env applies to the BUILD
      // as well as the server, which matters because the NEXT_PUBLIC_ flags
      // are inlined at build time.
      URC_E2E_BYPASS_AUTH: '0',
      NEXT_PUBLIC_URC_E2E_BYPASS_AUTH: '0',
      NEXT_PUBLIC_SITE_URL: baseURL,
      // `npm run build` pins NEXT_LOCAL_BUILD=1 (writes .next-build);
      // `next start` must read the same distDir.
      NEXT_LOCAL_BUILD: '1',
    },
  },
});
